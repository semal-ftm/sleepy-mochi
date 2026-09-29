import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Rest-shape parameters: a slightly flattened, bottom-heavy dome.
const RADIUS_X = 1.2;
const RADIUS_Y = 0.86;
const RADIUS_Z = 1.12;
const FLAT_Y = -0.6; // where the soft-floor flattening begins
const FLAT_K = 0.07; // softness of the flattening transition

const MAX_DISP = 1.25; // hard clamp so geometry can never explode
const MAX_VEL = 30;
const MAX_RIPPLES = 5;
const RIPPLE_SPEED = 2.2;
const RIPPLE_LIFE = 1.7;

/** Accumulate area-weighted face normals into per-vertex normals (no allocations). */
function computeNormals(index, p, out) {
  out.fill(0);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l; out[i + 1] /= l; out[i + 2] /= l;
  }
}

/**
 * A spring-driven soft body. Every vertex stores a displacement from its rest
 * position plus a velocity. Each fixed step applies:
 *  - a restoring spring toward a target (rest, squish field, or grab field)
 *  - Laplacian coupling to neighbours (tension, so dents spread and ripple)
 *  - damping
 *  - a volume-preservation term along rest normals
 *  - a floor constraint
 */
export class SoftBody {
  constructor(material, detail = 32) {
    let src = new THREE.IcosahedronGeometry(1, detail);
    src.deleteAttribute('normal');
    src.deleteAttribute('uv');
    src = mergeVertices(src); // weld seams so normals are smooth and vertices unique

    const n = src.attributes.position.count;
    const unit = src.attributes.position.array;
    const index = src.index.array;
    this.count = n;
    this.index = index;

    // --- rest shape ---
    const rest = new Float32Array(n * 3);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = unit[i * 3], y = unit[i * 3 + 1], z = unit[i * 3 + 2];
      const sag = 1 + 0.13 * (1 - smoothstep(-1, 0.7, y)); // wider near the bottom
      let Y = y * RADIUS_Y;
      const t = (Y - FLAT_Y) / FLAT_K;
      Y = t > 30 ? Y : FLAT_Y + FLAT_K * Math.log1p(Math.exp(t)); // soft max → flat base
      rest[i * 3] = x * RADIUS_X * sag;
      rest[i * 3 + 1] = Y;
      rest[i * 3 + 2] = z * RADIUS_Z * sag;
      if (Y < minY) minY = Y;
      if (Y > maxY) maxY = Y;
    }
    this.rest = rest;
    this.minY = minY;
    this.maxY = maxY;
    this.height = maxY - minY;

    this.restN = new Float32Array(n * 3);
    computeNormals(index, rest, this.restN);

    // --- per-vertex constants ---
    this.hN = new Float32Array(n); // normalised height 0 (floor) .. 1 (top)
    this.bottom = new Float32Array(n); // 1 at the base, 0 above
    this.pinK = new Float32Array(n); // extra stiffness near the base
    this.bulge = new Float32Array(n); // squish bulge profile
    for (let i = 0; i < n; i++) {
      const h = (rest[i * 3 + 1] - minY) / this.height;
      this.hN[i] = h;
      this.bottom[i] = 1 - smoothstep(0, 0.28, h);
      this.pinK[i] = 1 + 1.8 * this.bottom[i];
      this.bulge[i] = 0.35 + 0.75 * Math.sin(Math.PI * clamp(h, 0, 1));
    }

    // --- adjacency (CSR) for Laplacian coupling ---
    const sets = Array.from({ length: n }, () => new Set());
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      sets[a].add(b); sets[a].add(c);
      sets[b].add(a); sets[b].add(c);
      sets[c].add(a); sets[c].add(b);
    }
    this.nStart = new Int32Array(n + 1);
    let total = 0;
    for (let i = 0; i < n; i++) {
      this.nStart[i] = total;
      total += sets[i].size;
    }
    this.nStart[n] = total;
    this.nbr = new Int32Array(total);
    this.invDeg = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let k = this.nStart[i];
      for (const j of sets[i]) this.nbr[k++] = j * 3;
      this.invDeg[i] = 1 / sets[i].size;
    }

    // --- simulation state ---
    this.disp = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.grabW = new Float32Array(n);
    this.grabbing = false;
    this.grabD = new THREE.Vector3();

    // Plate height in local space; drops below the base while the mochi is lifted.
    this.floorY = minY;

    this.squishS = 0;
    this.squishPhase = 0; // 0 idle, 1 pressing, 2 holding
    this.squishT = 0;
    this.squishBoost = 1;
    this.pendingJiggle = null;

    this.ripples = [];
    for (let i = 0; i < MAX_RIPPLES; i++) {
      this.ripples.push({ active: false, x: 0, y: 0, z: 0, age: 0, amp: 0 });
    }
    this._rAmp = new Float32Array(MAX_RIPPLES);
    this._rFront = new Float32Array(MAX_RIPPLES);
    this._rPos = new Float32Array(MAX_RIPPLES * 3);

    // --- geometry ---
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.posAttr = new THREE.BufferAttribute(new Float32Array(rest), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(new Float32Array(this.restN), 3);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.posAttr);
    geometry.setAttribute('normal', this.nrmAttr);
    geometry.setAttribute('restPos', new THREE.BufferAttribute(new Float32Array(rest), 3));
    // Generous fixed bound: the mesh deforms every frame, so we never recompute it.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (minY + maxY) / 2, 0), 3.2);
    this.geometry = geometry;

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.center = new THREE.Vector3(0, (minY + maxY) / 2, 0);
  }

  // ------------------------------------------------------------------ anchors

  /** Find a surface point on the rest shape by casting a ray from the centre, stored as barycentric weights. */
  createAnchor(dir) {
    if (!this._restMesh) {
      const g = new THREE.BufferGeometry();
      g.setIndex(new THREE.BufferAttribute(this.index, 1));
      g.setAttribute('position', new THREE.BufferAttribute(this.rest, 3));
      this._restMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      this._raycaster = new THREE.Raycaster();
    }
    const d = dir.clone().normalize();
    const origin = this.center.clone().addScaledVector(d, 6);
    this._raycaster.set(origin, d.negate());
    const hit = this._raycaster.intersectObject(this._restMesh, false)[0];
    const f = hit.face;
    const r = this.rest;
    const A = new THREE.Vector3().fromArray(r, f.a * 3);
    const B = new THREE.Vector3().fromArray(r, f.b * 3);
    const C = new THREE.Vector3().fromArray(r, f.c * 3);
    const bary = THREE.Triangle.getBarycoord(hit.point, A, B, C, new THREE.Vector3());
    return { i0: f.a * 3, i1: f.b * 3, i2: f.c * 3, w0: bary.x, w1: bary.y, w2: bary.z };
  }

  evalAnchor(a, arr, out) {
    return out.set(
      arr[a.i0] * a.w0 + arr[a.i1] * a.w1 + arr[a.i2] * a.w2,
      arr[a.i0 + 1] * a.w0 + arr[a.i1 + 1] * a.w1 + arr[a.i2 + 1] * a.w2,
      arr[a.i0 + 2] * a.w0 + arr[a.i1 + 2] * a.w1 + arr[a.i2 + 2] * a.w2,
    );
  }

  anchorPoint(a, out) {
    return this.evalAnchor(a, this.posAttr.array, out);
  }

  anchorNormal(a, out) {
    return this.evalAnchor(a, this.nrmAttr.array, out).normalize();
  }

  anchorRestPoint(a, out) {
    return this.evalAnchor(a, this.rest, out);
  }

  /** Map a raycast hit on the deformed mesh back to rest space and the current local normal. */
  hitToRest(hit, outRest, outNormal) {
    const p = this.posAttr.array;
    const f = hit.face;
    const A = _a.fromArray(p, f.a * 3);
    const B = _b.fromArray(p, f.b * 3);
    const C = _c.fromArray(p, f.c * 3);
    _p.copy(hit.point);
    this.mesh.worldToLocal(_p);
    const bary = THREE.Triangle.getBarycoord(_p, A, B, C, _bary) || _bary.set(1 / 3, 1 / 3, 1 / 3);
    const anchor = _hitAnchor;
    anchor.i0 = f.a * 3; anchor.i1 = f.b * 3; anchor.i2 = f.c * 3;
    anchor.w0 = bary.x; anchor.w1 = bary.y; anchor.w2 = bary.z;
    this.evalAnchor(anchor, this.rest, outRest);
    this.anchorNormal(anchor, outNormal);
  }

  // ------------------------------------------------------------ interactions

  /** Local dent with an outward volume ring, plus a travelling ripple. */
  poke(restPoint, inward, strength, radius) {
    const n = this.count, r = this.rest, rn = this.restN, v = this.vel;
    const R = radius, R2 = R * 2.4;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const dx = r[i3] - restPoint.x, dy = r[i3 + 1] - restPoint.y, dz = r[i3 + 2] - restPoint.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= R2) continue;
      const q = d / R;
      if (q < 1) {
        const f = (1 - q * q) * (1 - q * q) * strength;
        v[i3] += inward.x * f;
        v[i3 + 1] += inward.y * f;
        v[i3 + 2] += inward.z * f;
      } else {
        const g = (q - 1) / 1.4;
        const bump = Math.sin(Math.PI * g) * 0.22 * strength;
        v[i3] += rn[i3] * bump;
        v[i3 + 1] += rn[i3 + 1] * bump;
        v[i3 + 2] += rn[i3 + 2] * bump;
      }
    }
    this.addRipple(restPoint, 0.03 * clamp(strength / 2.4, 0.4, 1.6));
  }

  addRipple(p, amp) {
    let slot = this.ripples.find((rp) => !rp.active);
    if (!slot) slot = this.ripples.reduce((o, rp) => (rp.age > o.age ? rp : o)); // recycle oldest
    slot.active = true;
    slot.x = p.x; slot.y = p.y; slot.z = p.z;
    slot.age = 0;
    slot.amp = amp;
  }

  beginGrab(restPoint, radius) {
    const n = this.count, r = this.rest, w = this.grabW;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const dx = r[i3] - restPoint.x, dy = r[i3 + 1] - restPoint.y, dz = r[i3 + 2] - restPoint.z;
      const q = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      w[i] = q < 1 ? (1 - q * q) * (1 - q * q) * (1 - 0.8 * this.bottom[i]) : 0;
    }
    this.grabD.set(0, 0, 0);
    this.grabbing = true;
  }

  setGrab(D) {
    this.grabD.copy(D);
  }

  /** Let go: an extra push toward rest (scaled by bounciness) produces a lively overshoot. */
  endGrab(fling) {
    if (!this.grabbing) return;
    const n = this.count, w = this.grabW, d = this.disp, v = this.vel;
    for (let i = 0; i < n; i++) {
      const f = w[i];
      if (f <= 0) continue;
      const i3 = i * 3;
      v[i3] -= d[i3] * fling * f;
      v[i3 + 1] -= d[i3 + 1] * fling * f;
      v[i3 + 2] -= d[i3 + 2] * fling * f;
    }
    w.fill(0);
    this.grabbing = false;
  }

  squish(boost) {
    this.squishPhase = 1;
    this.squishT = 0;
    this.squishBoost = boost;
  }

  /** Sideways shear plus a vertical dip; the springs turn it into a jelly wobble. */
  jiggle(strength, angle = Math.random() * Math.PI * 2, followUp = true) {
    const n = this.count, v = this.vel, h = this.hN;
    const cx = Math.cos(angle), cz = Math.sin(angle);
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const k = h[i] * strength;
      v[i3] += cx * k * 2.4;
      v[i3 + 1] -= k * 1.1;
      v[i3 + 2] += cz * k * 1.6;
    }
    if (followUp) this.pendingJiggle = { t: 0.17, strength: strength * 0.65, angle: angle + Math.PI };
  }

  reset() {
    this.disp.fill(0);
    this.vel.fill(0);
    this.prev.fill(0);
    this.grabW.fill(0);
    this.grabbing = false;
    this.grabD.set(0, 0, 0);
    this.squishS = 0;
    this.squishPhase = 0;
    this.floorY = this.minY;
    this.pendingJiggle = null;
    for (const rp of this.ripples) rp.active = false;
  }

  // --------------------------------------------------------------- simulation

  _updateTimelines(dt) {
    if (this.pendingJiggle) {
      this.pendingJiggle.t -= dt;
      if (this.pendingJiggle.t <= 0) {
        const pj = this.pendingJiggle;
        this.pendingJiggle = null;
        this.jiggle(pj.strength, pj.angle, false);
      }
    }
    if (this.squishPhase === 1) {
      this.squishT += dt;
      const t = Math.min(1, this.squishT / 0.26);
      this.squishS = 1 - (1 - t) * (1 - t) * (1 - t);
      if (t >= 1) { this.squishPhase = 2; this.squishT = 0; }
    } else if (this.squishPhase === 2) {
      this.squishT += dt;
      this.squishS = 1;
      if (this.squishT >= 0.16) {
        // Release: springs rebound on their own; the boost adds a springy upward pop.
        this.squishPhase = 0;
        this.squishS = 0;
        const n = this.count, v = this.vel, h = this.hN, r = this.rest, b = this.squishBoost;
        for (let i = 0; i < n; i++) {
          const i3 = i * 3;
          v[i3 + 1] += b * h[i] * 1.6;
          v[i3] -= r[i3] * b * 0.35 * this.bulge[i];
          v[i3 + 2] -= r[i3 + 2] * b * 0.35 * this.bulge[i];
        }
      }
    }
  }

  /**
   * ext: per-vertex acceleration in the body frame (gravity sag while lifted minus the
   * frame's own acceleration). The grabbed patch ignores it, so the rest of the body lags and dangles.
   */
  step(dt, P, ext = ZERO) {
    this._updateTimelines(dt);

    const n = this.count;
    const rest = this.rest, rn = this.restN, disp = this.disp, vel = this.vel, prev = this.prev;
    const gw = this.grabW, pinK = this.pinK, bulge = this.bulge;
    const nStart = this.nStart, nbr = this.nbr, invDeg = this.invDeg;
    const minY = this.minY;
    const floorY = this.floorY;
    const ex = ext.x, ey = ext.y, ez = ext.z;
    prev.set(disp);

    const s = this.squishS;
    const sy = 1 - 0.3 * s;
    const sxz = 1 / Math.sqrt(sy) - 1; // volume-preserving sideways bulge
    const syy = sy - 1;

    // Volume term: mean deviation from the (volume-preserving) squish target along normals.
    let mean = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const tx = rest[i3] * sxz * bulge[i];
      const ty = (rest[i3 + 1] - minY) * syy;
      const tz = rest[i3 + 2] * sxz * bulge[i];
      mean += (prev[i3] - tx) * rn[i3] + (prev[i3 + 1] - ty) * rn[i3 + 1] + (prev[i3 + 2] - tz) * rn[i3 + 2];
    }
    mean /= n;

    // Extra damping while pressed keeps the squish firm; the rebound uses the user damping.
    const k = P.k, kG = P.kG, kL = P.kL, c = P.c + 14 * s, kvm = P.kv * mean, kS = 150 * s;
    const grabbing = this.grabbing;
    const Dx = this.grabD.x, Dy = this.grabD.y, Dz = this.grabD.z;
    const maxD2 = MAX_DISP * MAX_DISP;

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      let tx = rest[i3] * sxz * bulge[i];
      let ty = (rest[i3 + 1] - minY) * syy;
      let tz = rest[i3 + 2] * sxz * bulge[i];
      let f = 0;
      if (grabbing) {
        f = gw[i];
        tx += f * Dx; ty += f * Dy; tz += f * Dz;
      }
      const stiff = k * pinK[i] * (1 - f) + kG * f + kS;

      let lx = 0, ly = 0, lz = 0;
      for (let j = nStart[i], e = nStart[i + 1]; j < e; j++) {
        const q = nbr[j];
        lx += prev[q]; ly += prev[q + 1]; lz += prev[q + 2];
      }
      const inv = invDeg[i];
      lx = lx * inv - prev[i3];
      ly = ly * inv - prev[i3 + 1];
      lz = lz * inv - prev[i3 + 2];

      let vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      const free = 1 - f;
      vx += (-stiff * (prev[i3] - tx) + kL * lx - c * vx - kvm * rn[i3] + ex * free) * dt;
      vy += (-stiff * (prev[i3 + 1] - ty) + kL * ly - c * vy - kvm * rn[i3 + 1] + ey * free) * dt;
      vz += (-stiff * (prev[i3 + 2] - tz) + kL * lz - c * vz - kvm * rn[i3 + 2] + ez * free) * dt;

      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > MAX_VEL * MAX_VEL) {
        const sc = MAX_VEL / Math.sqrt(v2);
        vx *= sc; vy *= sc; vz *= sc;
      }

      let dx = prev[i3] + vx * dt, dy = prev[i3 + 1] + vy * dt, dz = prev[i3 + 2] + vz * dt;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxD2) {
        const sc = MAX_DISP / Math.sqrt(d2);
        dx *= sc; dy *= sc; dz *= sc;
        vx *= 0.5; vy *= 0.5; vz *= 0.5;
      }
      // Floor: never sink below the base plane; a little friction when touching it.
      if (rest[i3 + 1] + dy < floorY) {
        dy = floorY - rest[i3 + 1];
        if (vy < 0) vy = 0;
        vx *= 0.85; vz *= 0.85;
      }
      disp[i3] = dx; disp[i3 + 1] = dy; disp[i3 + 2] = dz;
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    }
  }

  /** Compose rest + physics displacement + ripple + breathing into the render mesh. */
  writeOutput(dt, breath) {
    const n = this.count, rest = this.rest, rn = this.restN, disp = this.disp;
    const out = this.posAttr.array;
    const minY = this.minY;
    const floorY = this.floorY;

    let nr = 0;
    for (const rp of this.ripples) {
      if (!rp.active) continue;
      rp.age += dt;
      if (rp.age > RIPPLE_LIFE) { rp.active = false; continue; }
      this._rAmp[nr] = rp.amp * Math.exp(-2.4 * rp.age) * smoothstep(0, 0.06, rp.age);
      this._rFront[nr] = RIPPLE_SPEED * rp.age;
      this._rPos[nr * 3] = rp.x; this._rPos[nr * 3 + 1] = rp.y; this._rPos[nr * 3 + 2] = rp.z;
      nr++;
    }
    const rAmp = this._rAmp, rFront = this._rFront, rPos = this._rPos;
    const bxz = -breath * 0.4;

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const rx = rest[i3], ry = rest[i3 + 1], rz = rest[i3 + 2];
      let rip = 0;
      for (let k = 0; k < nr; k++) {
        const dx = rx - rPos[k * 3], dy = ry - rPos[k * 3 + 1], dz = rz - rPos[k * 3 + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const q = d - rFront[k];
        if (q > 0.6 || q < -0.6) continue;
        rip += (rAmp[k] * Math.exp(-q * q * 16) * Math.cos(q * 20) * smoothstep(0.05, 0.3, d)) / (1 + 1.2 * d);
      }
      const hy = ry - minY;
      let x = rx + disp[i3] + rn[i3] * rip + rx * bxz;
      let y = ry + disp[i3 + 1] + rn[i3 + 1] * rip + hy * breath;
      let z = rz + disp[i3 + 2] + rn[i3 + 2] * rip + rz * bxz;
      if (y < floorY) y = floorY;
      out[i3] = x; out[i3 + 1] = y; out[i3 + 2] = z;
    }
    computeNormals(this.index, out, this.nrmAttr.array);
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
  }

  /** Diagnostics used by the dev test hook. */
  stats() {
    const p = this.posAttr.array, d = this.disp, v = this.vel;
    let minY = Infinity, maxDisp = 0, energy = 0, bad = 0;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      if (!Number.isFinite(p[i3] + p[i3 + 1] + p[i3 + 2])) bad++;
      if (p[i3 + 1] < minY) minY = p[i3 + 1];
      const m = Math.hypot(d[i3], d[i3 + 1], d[i3 + 2]);
      if (m > maxDisp) maxDisp = m;
      energy += v[i3] * v[i3] + v[i3 + 1] * v[i3 + 1] + v[i3 + 2] * v[i3 + 2];
    }
    return { minY, restMinY: this.minY, maxDisp, energy, bad, vertices: this.count };
  }
}

const ZERO = { x: 0, y: 0, z: 0 };
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _bary = new THREE.Vector3();
const _hitAnchor = { i0: 0, i1: 0, i2: 0, w0: 0, w1: 0, w2: 0 };
