import * as THREE from 'three';
import { clamp, smoothstep } from './softbody.js';

const INK = '#3b2731';
const MOUTH_IN = '#6b2f3f';
const TONGUE = '#f08da0';
const TEX = 256;

const EYE_KEYS = ['eyeOpen', 'eyeSize', 'arc', 'lidDrop', 'lidTilt', 'squeeze', 'brow', 'browTilt', 'browLift'];
const MOUTH_KEYS = ['smile', 'mouthOpen', 'grin', 'mouthW'];

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  return c;
}

function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** side = +1 for the viewer-left eye (inner corner toward +x), -1 for the right eye. */
function drawEye(ctx, p, side) {
  ctx.clearRect(0, 0, TEX, TEX);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  const cx = 128, cy = 142;
  const open = p.eyeOpen;
  const sq = clamp(p.squeeze, 0, 1);
  const openA = smoothstep(0.05, 0.22, open) * (1 - sq);
  const closedA = (1 - smoothstep(0.04, 0.2, open)) * (1 - sq);

  if (closedA > 0.01) {
    const w = 50 * p.eyeSize;
    const bend = p.arc * 36;
    ctx.globalAlpha = closedA;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - bend * 0.3);
    ctx.quadraticCurveTo(cx, cy + bend, cx + w, cy - bend * 0.3);
    ctx.stroke();
  }

  if (openA > 0.01) {
    const rx = 40 * p.eyeSize;
    const ry = Math.max(5, 56 * open * p.eyeSize);
    const top = cy - ry;
    const drop = clamp(p.lidDrop, 0, 1) * ry * 1.1;
    const tilt = p.lidTilt * ry * 0.55;
    const yOuter = top + drop - tilt * 0.5;
    const yInner = top + drop + tilt;
    const xOuter = cx - side * rx, xInner = cx + side * rx;
    const slope = (yInner - yOuter) / (xInner - xOuter);
    const yAt = (x) => yOuter + (x - xOuter) * slope;

    ctx.save();
    ctx.globalAlpha = openA;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0) - 1);
    ctx.lineTo(TEX, yAt(TEX) - 1);
    ctx.lineTo(TEX, TEX);
    ctx.lineTo(0, TEX);
    ctx.closePath();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Sparkles: fixed to the upper-left so both eyes agree with the key light.
    ctx.fillStyle = '#ffffff';
    const hr = rx * 0.3 * Math.min(1, ry / rx);
    ctx.beginPath();
    ctx.arc(cx - rx * 0.3, cy - ry * 0.4, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + rx * 0.32, cy + ry * 0.35, hr * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (drop > 2) {
      ctx.globalAlpha = openA * clamp(p.lidDrop * 2, 0, 1);
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(xOuter - side * 6, yAt(xOuter - side * 6));
      ctx.lineTo(xInner + side * 6, yAt(xInner + side * 6));
      ctx.stroke();
    }
  }

  if (sq > 0.01) {
    ctx.globalAlpha = sq;
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(cx - side * 36, cy - 36);
    ctx.lineTo(cx + side * 34, cy);
    ctx.lineTo(cx - side * 36, cy + 36);
    ctx.stroke();
  }

  if (p.brow > 0.01) {
    ctx.globalAlpha = clamp(p.brow, 0, 1);
    ctx.lineWidth = 10;
    const by = 50 - p.browLift * 16;
    const t = p.browTilt * 16;
    ctx.beginPath();
    ctx.moveTo(cx - side * 40, by - t * 0.5);
    ctx.lineTo(cx + side * 38, by + t);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawMouth(ctx, p) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, TEX, TEX);
  // Draw at 1.35x around the mouth centre so small shapes stay readable.
  ctx.setTransform(1.35, 0, 0, 1.35, 128 * -0.35, 100 * -0.35);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = 128, cy = 100;
  const w = 46 * p.mouthW;
  const oA = smoothstep(0.04, 0.25, p.mouthOpen);
  const gA = clamp(p.grin, 0, 1) * (1 - oA);
  const lineA = clamp(1 - oA - gA, 0, 1);

  if (lineA > 0.01) {
    ctx.globalAlpha = lineA;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - p.smile * 10);
    ctx.quadraticCurveTo(cx, cy + p.smile * 34, cx + w, cy - p.smile * 10);
    ctx.stroke();
  }

  if (gA > 0.01) {
    const depth = 20 + 42 * p.grin;
    ctx.globalAlpha = gA;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - 8);
    ctx.quadraticCurveTo(cx, cy, cx + w, cy - 8);
    ctx.quadraticCurveTo(cx, cy - 8 + depth * 2, cx - w, cy - 8);
    ctx.closePath();
    ctx.fillStyle = MOUTH_IN;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = TONGUE;
    ctx.beginPath();
    ctx.ellipse(cx, cy + depth * 0.95, w * 0.55, depth * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - 8);
    ctx.quadraticCurveTo(cx, cy, cx + w, cy - 8);
    ctx.quadraticCurveTo(cx, cy - 8 + depth * 2, cx - w, cy - 8);
    ctx.stroke();
  }

  if (oA > 0.01) {
    const rx = 13 + 18 * p.mouthOpen;
    const ry = 13 + 30 * p.mouthOpen;
    const oy = cy + 8;
    ctx.globalAlpha = oA;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, oy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = MOUTH_IN;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = TONGUE;
    ctx.beginPath();
    ctx.ellipse(cx, oy + ry * 0.75, rx * 0.8, ry * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(cx, oy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawCheek(ctx) {
  ctx.clearRect(0, 0, TEX, TEX);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 124);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX, TEX);
  // Tiny "///" blush strokes.
  ctx.strokeStyle = 'rgba(150,150,150,0.55)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(128 + i * 30 - 9, 146);
    ctx.lineTo(128 + i * 30 + 9, 110);
    ctx.stroke();
  }
}

function drawBubble(ctx) {
  ctx.clearRect(0, 0, TEX, TEX);
  const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 118);
  g.addColorStop(0, 'rgba(225,242,255,0.10)');
  g.addColorStop(0.8, 'rgba(205,232,255,0.35)');
  g.addColorStop(1, 'rgba(180,215,245,0.75)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,200,235,0.8)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(128, 128, 84, Math.PI * 1.08, Math.PI * 1.42);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(170, 76, 9, 0, Math.PI * 2);
  ctx.fill();
}

const _P = new THREE.Vector3();
const _N = new THREE.Vector3();
const _PS = new THREE.Vector3();
const _PU = new THREE.Vector3();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/**
 * Facial features are flat decals parented to the body mesh. Each keeps three
 * barycentric anchors on the body (centre, a point to the side, a point above),
 * evaluated on the *deformed* vertices every frame, so the feature rides the
 * surface, turns with its normal, and stretches with the local skin.
 */
export class Face {
  constructor(body, bodyMaterial) {
    this.body = body;
    this.eyeL = { canvas: makeCanvas() };
    this.eyeR = { canvas: makeCanvas() };
    this.mouth = { canvas: makeCanvas() };
    for (const f of [this.eyeL, this.eyeR, this.mouth]) {
      f.ctx = f.canvas.getContext('2d');
      f.tex = makeTexture(f.canvas);
    }
    const cheekCanvas = makeCanvas();
    drawCheek(cheekCanvas.getContext('2d'));
    const cheekTex = makeTexture(cheekCanvas);

    const plane = new THREE.PlaneGeometry(1, 1);
    const decalMat = (map, extra = {}) =>
      new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
        ...extra,
      });

    this.cheekMat = decalMat(cheekTex, { color: new THREE.Color('#ff8aa1'), opacity: 0.5 });
    this.features = [];
    const add = (mat, dir, w, h, offset, order) => {
      const mesh = new THREE.Mesh(plane, mat);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = order;
      body.mesh.add(mesh);
      const f = this._anchorSet(dir);
      Object.assign(f, { mesh, w, h, offset });
      this.features.push(f);
      return f;
    };

    add(this.cheekMat, new THREE.Vector3(-0.64, -0.08, 1), 0.42, 0.3, 0.024, 1);
    add(this.cheekMat, new THREE.Vector3(0.64, -0.08, 1), 0.42, 0.3, 0.024, 1);
    add(decalMat(this.eyeL.tex), new THREE.Vector3(-0.35, 0.11, 1), 0.31, 0.31, 0.014, 2);
    add(decalMat(this.eyeR.tex), new THREE.Vector3(0.35, 0.11, 1), 0.31, 0.31, 0.014, 2);
    add(decalMat(this.mouth.tex), new THREE.Vector3(0, -0.12, 1), 0.28, 0.28, 0.014, 2);

    // Little rounded feet peeking out at the front of the base.
    const footGeo = new THREE.SphereGeometry(1, 24, 16);
    footGeo.setAttribute('restPos', footGeo.attributes.position.clone());
    this.feet = [-1, 1].map((s) => {
      const mesh = new THREE.Mesh(footGeo, bodyMaterial);
      mesh.scale.set(0.14, 0.08, 0.13);
      mesh.rotation.y = s * 0.4;
      mesh.castShadow = true;
      body.mesh.add(mesh);
      return { mesh, anchor: body.createAnchor(new THREE.Vector3(s * 0.4, -0.7, 1)) };
    });

    // A sleepy nose bubble that swells with each breath.
    const bubbleCanvas = makeCanvas();
    drawBubble(bubbleCanvas.getContext('2d'));
    this.bubble = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeTexture(bubbleCanvas), transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.bubble.renderOrder = 3;
    this.bubble.visible = false;
    body.mesh.add(this.bubble);
    this.bubbleAnchor = body.createAnchor(new THREE.Vector3(0.2, -0.02, 1));
    this.bubbleSize = 0.6;

    this.topAnchor = body.createAnchor(new THREE.Vector3(0.3, 1, 0.15));

    this.lastEye = {};
    this.lastMouth = {};
    this._forceRedraw = true;
  }

  _anchorSet(dir) {
    const b = this.body;
    const a = b.createAnchor(dir);
    const aS = b.createAnchor(_tmp.copy(dir).add(new THREE.Vector3(0.1, 0, 0)));
    const aU = b.createAnchor(_tmp.copy(dir).add(new THREE.Vector3(0, 0.1, 0)));
    b.anchorRestPoint(a, _P);
    b.anchorRestPoint(aS, _PS);
    b.anchorRestPoint(aU, _PU);
    return { a, aS, aU, restSide: _PS.distanceTo(_P), restUp: _PU.distanceTo(_P) };
  }

  setCheekColor(color) {
    this.cheekMat.color.copy(color);
  }

  popBubble() {
    const had = this.bubbleSize > 0.3;
    this.bubbleSize = 0;
    return had;
  }

  reset() {
    this.bubbleSize = 0.6;
    this._forceRedraw = true;
  }

  _changed(keys, p, last) {
    let changed = this._forceRedraw;
    for (const k of keys) {
      if (changed) break;
      if (Math.abs(p[k] - (last[k] ?? 99)) > 0.003) changed = true;
    }
    if (changed) for (const k of keys) last[k] = p[k];
    return changed;
  }

  /** Top-of-head point in world space (for Zzz). */
  topWorld(out) {
    this.body.anchorPoint(this.topAnchor, out);
    return this.body.mesh.localToWorld(out);
  }

  update(p, dt, breath01, asleep) {
    const b = this.body;

    if (this._changed(EYE_KEYS, p, this.lastEye)) {
      drawEye(this.eyeL.ctx, p, 1);
      drawEye(this.eyeR.ctx, p, -1);
      this.eyeL.tex.needsUpdate = true;
      this.eyeR.tex.needsUpdate = true;
    }
    if (this._changed(MOUTH_KEYS, p, this.lastMouth)) {
      drawMouth(this.mouth.ctx, p);
      this.mouth.tex.needsUpdate = true;
    }
    this._forceRedraw = false;
    this.cheekMat.opacity = clamp(0.2 + p.blush * 0.45, 0, 0.85);

    for (const f of this.features) {
      b.anchorPoint(f.a, _P);
      b.anchorNormal(f.a, _N);
      b.anchorPoint(f.aS, _PS);
      b.anchorPoint(f.aU, _PU);
      // Tangent frame from the deformed surface.
      _X.subVectors(_PS, _P);
      _X.addScaledVector(_N, -_X.dot(_N));
      const sx = clamp(_X.length() / f.restSide, 0.75, 1.35);
      _X.normalize();
      _Y.crossVectors(_N, _X);
      _tmp.subVectors(_PU, _P);
      const sy = clamp(Math.abs(_tmp.dot(_Y)) / f.restUp, 0.75, 1.35);
      _X.multiplyScalar(f.w * sx);
      _Y.multiplyScalar(f.h * sy);
      const m = f.mesh.matrix;
      m.makeBasis(_X, _Y, _N);
      _P.addScaledVector(_N, f.offset);
      m.setPosition(_P);
      f.mesh.matrixWorldNeedsUpdate = true;
    }

    for (const foot of this.feet) {
      b.anchorPoint(foot.anchor, _P);
      b.anchorNormal(foot.anchor, _N);
      // Push forward along the horizontal part of the normal so the feet peek out from under the belly.
      const hl = Math.hypot(_N.x, _N.z) || 1;
      _P.x += (_N.x / hl) * 0.015;
      _P.z += (_N.z / hl) * 0.015;
      _P.y = b.minY + 0.065;
      foot.mesh.position.copy(_P);
    }

    const target = asleep ? 1 : 0;
    const rate = target > this.bubbleSize ? 0.35 : 8;
    this.bubbleSize += (target - this.bubbleSize) * (1 - Math.exp(-rate * dt));
    const r = 0.075 * this.bubbleSize * (0.7 + 0.3 * breath01);
    this.bubble.visible = r > 0.004;
    if (this.bubble.visible) {
      b.anchorPoint(this.bubbleAnchor, _P);
      b.anchorNormal(this.bubbleAnchor, _N);
      _P.addScaledVector(_N, r * 0.9 + 0.012);
      this.bubble.position.copy(_P);
      this.bubble.scale.set(r * 2, r * 2, 1);
    }
  }
}
