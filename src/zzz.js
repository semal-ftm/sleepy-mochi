import * as THREE from 'three';
import { smoothstep } from './softbody.js';

const LIFE = 3.2;

/** A tiny pool of floating "z" sprites that drift up from the mochi's head while it sleeps. */
export class ZzzEmitter {
  constructor(scene) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 104px ui-rounded, "Arial Rounded MT Bold", "Nunito", "Trebuchet MS", system-ui, sans-serif';
    ctx.fillText('z', 64, 62);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    this.items = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: '#c58a9c', transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 4;
      scene.add(sprite);
      this.items.push({ sprite, mat, age: 0, active: false, origin: new THREE.Vector3(), size: 1, sway: 0 });
    }
    this.timer = 1.2;
    this.count = 0;
  }

  setColor(color) {
    for (const it of this.items) it.mat.color.copy(color);
  }

  clear() {
    for (const it of this.items) {
      it.active = false;
      it.sprite.visible = false;
    }
    this.timer = 1.5;
  }

  update(dt, emitting, originWorld) {
    if (emitting) {
      this.timer -= dt;
      if (this.timer <= 0) {
        const it = this.items.find((x) => !x.active);
        if (it) {
          it.active = true;
          it.age = 0;
          it.origin.copy(originWorld);
          it.origin.x += 0.2;
          it.size = this.count % 3 === 1 ? 0.75 : 1;
          it.sway = Math.random() * Math.PI * 2;
          it.sprite.visible = true;
          this.count++;
        }
        this.timer = 1.25;
      }
    } else {
      this.timer = Math.max(this.timer, 1.5);
    }

    for (const it of this.items) {
      if (!it.active) continue;
      it.age += dt;
      const t = it.age / LIFE;
      if (t >= 1) {
        it.active = false;
        it.sprite.visible = false;
        continue;
      }
      const s = it.sprite;
      s.position.set(
        it.origin.x + 0.42 * t + 0.07 * Math.sin(it.age * 2.4 + it.sway),
        it.origin.y + 0.15 + 0.85 * t,
        it.origin.z,
      );
      const sc = (0.13 + 0.16 * t) * it.size;
      s.scale.set(sc, sc, 1);
      s.material.rotation = 0.25 * Math.sin(it.age * 1.7 + it.sway);
      let fade = smoothstep(0, 0.12, t) * (1 - smoothstep(0.6, 1, t));
      if (!emitting) fade *= 0.9;
      s.material.opacity = 0.85 * fade;
    }
  }
}
