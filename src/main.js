import './style.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SoftBody, lerp } from './softbody.js';
import { Face } from './face.js';
import { Expression } from './expression.js';
import { Sfx } from './audio.js';
import { ZzzEmitter } from './zzz.js';
import { startBackground } from './background.js';

const FLAVORS = {
  strawberry: { body: '#eea8b6', sheen: '#fff1f4', cheek: '#ff7590', accent: '#ea8ea2', zzz: '#c58a9c' },
  lavender: { body: '#c4b1ea', sheen: '#f6f1ff', cheek: '#ee84b3', accent: '#a592da', zzz: '#9d8cc6' },
  vanilla: { body: '#efd6a4', sheen: '#fffaf0', cheek: '#f28f74', accent: '#d7ab62', zzz: '#b89a78' },
};

const CUSHION_TOP = 0.02;
const FIXED_DT = 1 / 120;
const MAX_STEPS = 6;
const GRAVITY = 14; // snappy cartoon fall
const CARRY_X = 2.2; // how far the mochi may be carried sideways
const CARRY_TOP = 0.8; // highest lift (keeps it on screen)

const viewport = document.getElementById('viewport');
const fallback = document.getElementById('fallback');
const brandEl = document.querySelector('.brand');
const hintEl = document.querySelector('.hint');
const panelEl = document.querySelector('.panel');

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

function showFallback() {
  fallback.hidden = false;
  document.body.classList.add('no-webgl');
}

startBackground();

if (!hasWebGL()) {
  showFallback();
} else {
  try {
    start();
  } catch (err) {
    console.warn('Sleepy Mochi could not start WebGL:', err);
    showFallback();
  }
}

/** Physical mochi skin: sheen for the powdery look, plus a subtle starch-dust pattern fixed to the rest shape. */
function createMochiMaterial(flavor) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: flavor.body,
    roughness: 0.6,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(flavor.sheen),
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    emissive: new THREE.Color(flavor.body),
    emissiveIntensity: 0.06,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 restPos;\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = restPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRest;
float mHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mHash(i), mHash(i + vec3(1,0,0)), f.x), mix(mHash(i + vec3(0,1,0)), mHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mHash(i + vec3(0,0,1)), mHash(i + vec3(1,0,1)), f.x), mix(mHash(i + vec3(0,1,1)), mHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float mPatch = smoothstep(0.45, 0.85, mNoise(vRest * 4.5));
float mGrain = step(0.9, mHash(floor(vRest * 42.0)));
float mDust = (mPatch * 0.55 + mGrain * 0.45) * (0.5 + 0.5 * smoothstep(-0.3, 0.8, vRest.y));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), mDust * 0.16);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + mDust * 0.2, 0.0, 1.0);',
      );
  };
  mat.customProgramCacheKey = () => 'mochi-skin-v1';
  return mat;
}

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function start() {
  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Sleepy Mochi. Poke or drag the mochi to play.');
  canvas.setAttribute('role', 'img');
  viewport.appendChild(canvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);

  // ------------------------------------------------------------------ lights
  scene.add(new THREE.HemisphereLight(0xfff6ec, 0xf0d2bd, 0.85));
  const key = new THREE.DirectionalLight(0xfff0e0, 1.7);
  key.position.set(2.4, 5.2, 3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe2ea, 0.45);
  fill.position.set(-4, 2, 2.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.75);
  rim.position.set(-1.2, 3, -4);
  scene.add(rim);

  // ------------------------------------------------------- cushion + floor
  const profile = [
    [0, -0.24], [1.88, -0.24], [2.03, -0.21], [2.11, -0.14], [2.12, -0.07],
    [2.08, -0.02], [1.98, 0.012], [1.8, CUSHION_TOP], [0, CUSHION_TOP],
  ].map(([x, y]) => new THREE.Vector2(x * 0.9, y));
  const cushion = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 96),
    new THREE.MeshStandardMaterial({ color: '#f3d9c3', roughness: 0.95, side: THREE.DoubleSide }),
  );
  cushion.receiveShadow = true;
  scene.add(cushion);
  const stitch = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.012, 8, 128),
    new THREE.MeshStandardMaterial({ color: '#e7c3a8', roughness: 1 }),
  );
  stitch.rotation.x = -Math.PI / 2;
  stitch.position.y = CUSHION_TOP + 0.002;
  scene.add(stitch);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.24;
  floor.receiveShadow = true;
  scene.add(floor);

  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(120,70,70,0.42)', 'rgba(120,70,70,0)'),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = CUSHION_TOP + 0.004;
  contact.renderOrder = 1;
  scene.add(contact);

  // ------------------------------------------------------------------- mochi
  let flavor = FLAVORS.strawberry;
  const bodyMat = createMochiMaterial(flavor);
  const body = new SoftBody(bodyMat, 32);
  const basePos = new THREE.Vector3(0, CUSHION_TOP - body.minY, 0);
  body.mesh.position.copy(basePos);
  scene.add(body.mesh);
  const face = new Face(body, bodyMat);
  face.setCheekColor(new THREE.Color(flavor.cheek));
  const expression = new Expression();
  const zzz = new ZzzEmitter(scene);
  zzz.setColor(new THREE.Color(flavor.zzz));
  const sfx = new Sfx();

  const colorTarget = {
    body: new THREE.Color(flavor.body),
    sheen: new THREE.Color(flavor.sheen),
    cheek: new THREE.Color(flavor.cheek),
    zzz: new THREE.Color(flavor.zzz),
  };
  const cheekColor = new THREE.Color(flavor.cheek);
  const zzzColor = new THREE.Color(flavor.zzz);

  expression.onEnter = (name, prev) => {
    if (name === 'grumpy') sfx.play('grumpy');
    else if (name === 'sleeping' && prev !== 'sleeping') sfx.play('sleepy');
  };

  // Frame the mochi and its plate together.
  const lookTarget = new THREE.Vector3(0, 0.62, 0);

  // ------------------------------------------------------------ parameters
  const P = {
    k: 40, kG: 320, kL: 250, kv: 30, c: 4, grabR: 0.7, maxStretch: 0.8, pokeR: 0.36, pokeStrength: 2.4,
    imp: 1, fling: 4, squishBoost: 1, inertia: 0.4, sag: 3, landBounce: 0.25,
  };
  const sliders = {
    softness: document.getElementById('softness'),
    bounciness: document.getElementById('bounciness'),
    damping: document.getElementById('damping'),
  };
  function updateParams() {
    const s = sliders.softness.value / 100;
    const b = sliders.bounciness.value / 100;
    const d = sliders.damping.value / 100;
    P.k = lerp(85, 16, s);
    P.kL = lerp(340, 150, s);
    P.grabR = lerp(0.5, 0.95, s);
    P.maxStretch = lerp(0.55, 1.05, s);
    P.pokeR = lerp(0.28, 0.46, s);
    P.imp = lerp(0.45, 1.5, b);
    P.fling = lerp(0, 8, b);
    P.squishBoost = lerp(0.2, 2.4, b);
    P.pokeStrength = lerp(1.3, 3.4, b) * lerp(0.8, 1.2, s);
    P.c = lerp(0.8, 11, d);
    P.inertia = lerp(0.22, 0.55, s);
    P.sag = lerp(1.5, 4.5, s);
    P.landBounce = lerp(0.05, 0.4, b);
    for (const el of Object.values(sliders)) el.style.setProperty('--fill', `${el.value}%`);
  }
  for (const el of Object.values(sliders)) el.addEventListener('input', updateParams);
  updateParams();

  // How far the mochi can be carried and still stay fully on screen (recomputed on resize).
  const carryLim = { minX: -CARRY_X, maxX: CARRY_X, top: CARRY_TOP };
  const tmpP = new THREE.Vector3();

  // ---------------------------------------------------------------- resize
  function resize() {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const vr = viewport.getBoundingClientRect();
    const pr = panelEl.getBoundingClientRect();
    // Desktop: the canvas fills the window and the panel floats on the right.
    const panelOverlay = pr.left > vr.left + w * 0.45 && pr.top < vr.bottom && pr.bottom > vr.top;
    const botPad = Math.max(0, vr.bottom - hintEl.getBoundingClientRect().top + 6);
    // Desktop centres vertically on the screen; mobile keeps clear of the title above.
    const topPad = panelOverlay ? botPad : Math.max(0, brandEl.getBoundingClientRect().bottom - vr.top + 6);
    const availRight = panelOverlay ? pr.left - vr.left - 24 : w;
    let cx = w / 2;
    let halfW = Math.min(w / 2, availRight - w / 2);
    if (halfW < w * 0.2) {
      // Too narrow to centre on screen without touching the panel: centre in the free area.
      cx = availRight / 2;
      halfW = availRight / 2;
    }
    const halfH = Math.max(60, (h - topPad - botPad) / 2);
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const needH = panelOverlay ? 1.62 : 1.3; // world half-height (plate + lift room on desktop)
    const needW = panelOverlay ? 2.3 : 1.85; // world half-width (whole plate on desktop)
    // Distance at which needH / needW fit into the available pixel half-extents.
    const dist = Math.max((needH * h) / (2 * tanH * halfH), (needW * h) / (2 * tanH * halfW), 5.4);
    camera.setViewOffset(w, h, w / 2 - cx, -(topPad - botPad) / 2, w, h);
    const elev = THREE.MathUtils.degToRad(17);
    camera.position.set(0, lookTarget.y + Math.sin(elev) * dist, Math.cos(elev) * dist);
    camera.lookAt(lookTarget);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // Binary-search carry limits by projecting the mochi's extents into the free screen area.
    const margin = 10;
    const sx = (x, y) => ((tmpP.set(x, y, 0).project(camera).x + 1) / 2) * w;
    const sy = (x, y) => ((1 - tmpP.set(x, y, 0).project(camera).y) / 2) * h;
    const halfBody = 1.4;
    const midY = CUSHION_TOP + body.height * 0.5;
    const search = (ok, max) => {
      let lo = 0, hi = max;
      if (!ok(0)) return 0;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) lo = mid; else hi = mid;
      }
      return lo;
    };
    carryLim.maxX = search((x) => sx(x + halfBody, midY) <= availRight - margin, CARRY_X);
    carryLim.minX = -search((x) => sx(-x - halfBody, midY) >= margin, CARRY_X);
    carryLim.top = search((L) => sy(0, CUSHION_TOP + body.height + L + 0.05) >= margin, CARRY_TOP);
  }
  new ResizeObserver(resize).observe(viewport);
  window.addEventListener('resize', resize);
  resize();

  // ----------------------------------------------------------------- input
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const press = {
    id: null, x0: 0, y0: 0, dragging: false, amt: 0,
    rest: new THREE.Vector3(), hitLocal: new THREE.Vector3(), plane: new THREE.Plane(), D: new THREE.Vector3(),
    pointer: new THREE.Vector3(), hasPointer: false,
  };
  // Whole-body carry: the mochi's offset from its spot on the plate.
  const carry = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), prevVel: new THREE.Vector3(),
    acc: new THREE.Vector3(), target: new THREE.Vector3(), holding: false, airborne: false,
  };
  const ext = new THREE.Vector3();
  const landPt = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  let hoverEvt = null;

  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  function pick(e) {
    setNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(body.mesh, false);
    return hits.length ? hits[0] : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (press.id !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const hit = pick(e);
    if (!hit) return;
    e.preventDefault();
    press.id = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture can fail for synthetic events; we still clean up on pointerup */
    }
    press.x0 = e.clientX;
    press.y0 = e.clientY;
    press.dragging = false;
    press.amt = 0;
    press.hasPointer = false;
    body.hitToRest(hit, press.rest, tmpN);
    press.hitLocal.copy(hit.point);
    body.mesh.worldToLocal(press.hitLocal);
    camera.getWorldDirection(camDir);
    press.plane.setFromNormalAndCoplanarPoint(camDir.negate(), hit.point);

    body.poke(press.rest, tmpN.negate(), P.pokeStrength, P.pokeR);
    expression.poke();
    if (face.popBubble()) sfx.play('bubble');
    sfx.play('pop', P.imp);
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== press.id) {
      if (press.id === null && e.pointerType === 'mouse') hoverEvt = e;
      return;
    }
    if (!press.dragging) {
      if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < 7) return;
      press.dragging = true;
      body.beginGrab(press.rest, P.grabR);
      expression.beginDrag();
      carry.holding = true;
      sfx.play('stretch');
    }
    setNdc(e);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(press.plane, tmpV)) {
      press.pointer.copy(tmpV);
      press.hasPointer = true;
    }
  });

  /** Where the whole body wants to be so the grabbed spot sits under the pointer. */
  function updateCarryTarget() {
    const t = carry.target;
    t.copy(press.pointer).sub(press.hitLocal).sub(basePos);
    t.x = THREE.MathUtils.clamp(t.x, carryLim.minX, carryLim.maxX);
    t.y = THREE.MathUtils.clamp(t.y, 0, carryLim.top);
    t.z = THREE.MathUtils.clamp(t.z, -1, 1);
  }

  /** The grabbed patch stretches toward the pointer by however far the body lags behind it. */
  function updateStretch() {
    const D = press.D;
    D.copy(press.pointer).sub(basePos).sub(carry.pos).sub(press.hitLocal);
    if (D.length() > P.maxStretch) D.setLength(P.maxStretch);
    const floorY = body.floorY + 0.04;
    if (press.hitLocal.y + D.y < floorY) D.y = floorY - press.hitLocal.y;
    body.setGrab(D);
    press.amt = D.length();
    expression.dragAmt = Math.max(press.amt, carry.pos.y * 0.5);
  }

  function onLand(impact) {
    if (impact < 1.2) return;
    const k = Math.min(1.2, impact / 5);
    body.addRipple(landPt.set(0, body.minY + 0.05, 0.9), 0.02 + 0.02 * k);
    if (impact > 3) {
      expression.squish();
      sfx.play('squish', k);
    } else {
      expression.release(0.3);
      sfx.play('pop', k);
    }
  }

  function stepCarry(dt) {
    const p = carry.pos, v = carry.vel;
    carry.prevVel.copy(v);
    if (carry.holding) {
      // Springy follow: a slight lag gives a jelly drag and a visible stretch on fast moves.
      if (press.hasPointer) updateCarryTarget();
      const kC = 110, cC = 16;
      v.x += (kC * (carry.target.x - p.x) - cC * v.x) * dt;
      v.y += (kC * (carry.target.y - p.y) - cC * v.y) * dt;
      v.z += (kC * (carry.target.z - p.z) - cC * v.z) * dt;
      p.addScaledVector(v, dt);
      if (p.y < 0) {
        p.y = 0;
        if (v.y < 0) v.y = 0;
      }
      carry.airborne = p.y > 0.002;
    } else if (carry.airborne || p.y > 0 || v.y > 0) {
      // Falling (or tossed): gravity plus a gentle drift back over the plate.
      v.y -= GRAVITY * dt;
      v.x += (-p.x * 12 - v.x * 3) * dt;
      v.z += (-p.z * 12 - v.z * 3) * dt;
      p.addScaledVector(v, dt);
      if (p.x > carryLim.maxX || p.x < carryLim.minX) {
        p.x = THREE.MathUtils.clamp(p.x, carryLim.minX, carryLim.maxX);
        v.x *= -0.4;
      }
      if (p.y > carryLim.top) {
        p.y = carryLim.top;
        if (v.y > 0) v.y = 0;
      }
      carry.airborne = true;
      if (p.y <= 0 && v.y < 0) {
        const impact = -v.y;
        p.y = 0;
        v.y = impact > 1.5 ? impact * P.landBounce : 0;
        carry.airborne = v.y > 0;
        onLand(impact);
      }
    } else {
      // Resting on the plate: slide home to the middle.
      v.y = 0;
      v.x += (-p.x * 14 - v.x * 7) * dt;
      v.z += (-p.z * 14 - v.z * 7) * dt;
      p.x += v.x * dt;
      p.z += v.z * dt;
    }
    carry.acc.subVectors(v, carry.prevVel).divideScalar(dt);

    // Body-frame acceleration: gravity sag while held up, minus the frame's own motion (inertia),
    // so the body dangles, lags when swung, and splats when it lands.
    ext.copy(carry.acc).multiplyScalar(-P.inertia);
    if (p.y > 0.002 && carry.holding) ext.y -= P.sag;
    const m = ext.length();
    if (m > 120) ext.multiplyScalar(120 / m);
    body.floorY = body.minY - p.y;
    if (press.dragging && press.hasPointer) updateStretch();
  }

  function endPress() {
    if (press.id === null) return;
    const id = press.id;
    press.id = null;
    if (press.dragging) {
      carry.holding = false;
      // A flick tosses it a little; keep it gentle so it stays on screen.
      if (carry.vel.length() > 6) carry.vel.setLength(6);
      carry.airborne = carry.pos.y > 0.002 || carry.vel.y > 0;
      body.endGrab(P.fling);
      expression.release(press.amt);
      if (press.amt > 0.2) sfx.play('boing', Math.min(1.2, press.amt * 1.5));
    }
    press.dragging = false;
    press.amt = 0;
    try {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    } catch {
      /* already released */
    }
    canvas.style.cursor = '';
  }
  const onUp = (e) => {
    if (e.pointerId === press.id) endPress();
  };
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('pointerleave', () => {
    hoverEvt = null;
    if (press.id === null) canvas.style.cursor = '';
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', endPress);

  // -------------------------------------------------------------- controls
  document.getElementById('btn-squish').addEventListener('click', () => {
    body.squish(P.squishBoost);
    expression.squish();
    if (face.popBubble()) sfx.play('bubble');
    sfx.play('squish', P.imp);
  });
  document.getElementById('btn-jiggle').addEventListener('click', () => {
    body.jiggle(P.imp);
    expression.jiggle();
    if (face.popBubble()) sfx.play('bubble');
    sfx.play('boing', P.imp);
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    endPress();
    body.reset();
    carry.pos.set(0, 0, 0);
    carry.vel.set(0, 0, 0);
    carry.acc.set(0, 0, 0);
    ext.set(0, 0, 0);
    carry.holding = false;
    carry.airborne = false;
    body.mesh.position.copy(basePos);
    expression.reset();
    face.reset();
    zzz.clear();
    breathPhase = 0;
    acc = 0;
  });

  const soundBtn = document.getElementById('btn-sound');
  soundBtn.addEventListener('click', async () => {
    const on = await sfx.setEnabled(!sfx.enabled);
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.querySelector('.sound-label').textContent = on ? 'Sound on' : 'Sound off';
    if (on) sfx.play('pop', 0.6);
  });

  const swatches = [...document.querySelectorAll('.swatch')];
  function setFlavor(name) {
    flavor = FLAVORS[name];
    colorTarget.body.set(flavor.body);
    colorTarget.sheen.set(flavor.sheen);
    colorTarget.cheek.set(flavor.cheek);
    colorTarget.zzz.set(flavor.zzz);
    document.documentElement.style.setProperty('--accent', flavor.accent);
    for (const s of swatches) {
      const active = s.dataset.flavor === name;
      s.classList.toggle('is-active', active);
      s.setAttribute('aria-checked', String(active));
    }
  }
  for (const s of swatches) s.addEventListener('click', () => setFlavor(s.dataset.flavor));
  setFlavor('strawberry');

  // ------------------------------------------------------------------- loop
  let last = performance.now();
  let acc = 0;
  let breathPhase = 0;
  let frame = 0;
  const topW = new THREE.Vector3();

  document.addEventListener('visibilitychange', () => {
    // Coming back from a hidden tab: drop the elapsed time instead of simulating it.
    last = performance.now();
    acc = 0;
    if (document.hidden) endPress();
  });

  function tick(now) {
    requestAnimationFrame(tick);
    let dt = (now - last) / 1000;
    last = now;
    // Long gaps (tab restored, debugger, etc.) are dropped; slow frames just run in slow motion.
    if (!(dt > 0) || dt > 0.5) {
      dt = 0;
      acc = 0;
    }
    dt = Math.min(dt, 1 / 20);
    frame++;

    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS) {
      stepCarry(FIXED_DT);
      body.step(FIXED_DT, P, ext);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    body.mesh.position.set(basePos.x + carry.pos.x, basePos.y + carry.pos.y, basePos.z + carry.pos.z);

    const params = expression.update(dt);
    const sleepy = expression.cur.sleepy;
    breathPhase += dt * lerp(2.3, 1.15, sleepy);
    const breath01 = 0.5 + 0.5 * Math.sin(breathPhase);
    const breath = Math.sin(breathPhase) * lerp(0.008, 0.022, sleepy);
    body.writeOutput(dt, breath);

    const asleep = expression.state === 'sleeping' && sleepy > 0.85;
    face.update(params, dt, breath01, asleep);
    zzz.update(dt, asleep, face.topWorld(topW));

    // Soft colour tween so flavour changes never interrupt the animation.
    const ca = 1 - Math.exp(-6 * dt);
    bodyMat.color.lerp(colorTarget.body, ca);
    bodyMat.emissive.copy(bodyMat.color);
    bodyMat.sheenColor.lerp(colorTarget.sheen, ca);
    cheekColor.lerp(colorTarget.cheek, ca);
    face.setCheekColor(cheekColor);
    zzzColor.lerp(colorTarget.zzz, ca);
    zzz.setColor(zzzColor);

    // Contact shadow follows the mochi and fades as it lifts off the plate.
    const lift = carry.pos.y;
    const spread = (1 + 0.25 * body.squishS) / (1 + lift * 0.6);
    contact.scale.set(2.9 * spread, 2.5 * spread, 1);
    contact.position.x = carry.pos.x;
    contact.position.z = carry.pos.z;
    contact.material.opacity = 1 / (1 + lift * 2.5);

    if (hoverEvt && press.id === null && frame % 2 === 0) {
      canvas.style.cursor = pick(hoverEvt) ? 'grab' : '';
      hoverEvt = null;
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  if (import.meta.env.DEV) {
    window.__mochi = { body, face, expression, camera, P, sfx, press, carry, renderer, scene };
  }
}
