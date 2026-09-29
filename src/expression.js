import { lerp, smoothstep } from './softbody.js';

/*
 * Facial parameters (all blended continuously, never switched):
 *  eyeOpen   0 closed … 1 wide open
 *  eyeSize   overall eye scale
 *  arc       closed-eye curve: +1 sleepy "u", 0 flat, -1 happy "^"
 *  lidDrop   upper lid covering the open eye (sleepy / grumpy)
 *  lidTilt   inner corner of the lid lowered (grumpy)
 *  squeeze   ">  <" squeezed eyes
 *  brow      brow visibility, browTilt (+ cross, - worried), browLift (raise)
 *  smile     mouth curve (-1 frown … 1 smile)
 *  mouthOpen small "o"
 *  grin      open happy smile
 *  mouthW    mouth width
 *  blush     cheek intensity
 *  sleepy    0 awake … 1 asleep (drives breathing, Zzz, bubble)
 */
const BASE = {
  eyeOpen: 0, eyeSize: 1, arc: 1, lidDrop: 0.5, lidTilt: 0, squeeze: 0,
  brow: 0, browTilt: 0, browLift: 0,
  smile: 0.35, mouthOpen: 0, grin: 0, mouthW: 0.6,
  blush: 0.7, sleepy: 1,
};
const KEYS = Object.keys(BASE);
const mk = (o) => ({ ...BASE, ...o });

export const STATES = {
  sleeping: mk({ rate: 2.2 }),
  drowsy: mk({ eyeOpen: 0.34, arc: 0, lidDrop: 0.58, smile: 0.25, mouthW: 0.55, blush: 0.75, sleepy: 0.6, rate: 3 }),
  surprised: mk({
    eyeOpen: 1, eyeSize: 1.08, arc: 0, lidDrop: 0, brow: 0.75, browTilt: -0.5, browLift: 1,
    smile: 0, mouthOpen: 0.42, mouthW: 0.5, blush: 0.9, sleepy: 0, rate: 14,
  }),
  stretched: mk({
    eyeOpen: 1, eyeSize: 1.3, arc: 0, lidDrop: 0, brow: 0.85, browTilt: -0.8, browLift: 1,
    smile: 0, mouthOpen: 0.9, mouthW: 0.6, blush: 1.05, sleepy: 0, rate: 12,
  }),
  happy: mk({ eyeOpen: 0, arc: -1, lidDrop: 0, smile: 1, grin: 0.85, mouthW: 0.85, blush: 1.05, sleepy: 0.1, rate: 9 }),
  grumpy: mk({
    eyeOpen: 0.62, eyeSize: 0.95, arc: 0, lidDrop: 0.5, lidTilt: 1, brow: 1, browTilt: 1, browLift: 0,
    smile: -0.75, mouthW: 0.5, blush: 1.25, sleepy: 0, rate: 10,
  }),
  squished: mk({ eyeOpen: 0, arc: 0, squeeze: 1, smile: -0.2, mouthOpen: 0.35, mouthW: 0.55, blush: 1.2, sleepy: 0, rate: 16 }),
};

const pick = (src) => {
  const o = {};
  for (const k of KEYS) o[k] = src[k];
  return o;
};

/**
 * One active state at a time, with an optional queue of follow-up states.
 * The drawn face eases toward the active state's targets, so reactions blend
 * instead of flickering, and new events simply replace the queue.
 */
export class Expression {
  constructor() {
    this.cur = pick(STATES.sleeping);
    this.out = pick(STATES.sleeping);
    this.mix = pick(STATES.sleeping);
    this.state = 'sleeping';
    this.timeLeft = Infinity;
    this.queue = [];
    this.onEnter = null;
    this.heat = 0; // recent-poke "annoyance"
    this.dragAmt = 0;
    this.blinkIn = 2 + Math.random() * 2;
    this.blinkT = -1;
    this.peekIn = 4 + Math.random() * 3;
    this.peekT = -1;
  }

  _set(name, dur) {
    const prev = this.state;
    this.state = name;
    this.timeLeft = dur;
    if (name !== prev && this.onEnter) this.onEnter(name, prev);
  }

  play(seq) {
    this.queue = seq.slice(1);
    this._set(seq[0][0], seq[0][1]);
  }

  poke() {
    this.heat += 1;
    if (this.state === 'stretched') return 'none';
    if (this.heat > 2.8 || this.state === 'grumpy') {
      this.play([['grumpy', 2.4], ['drowsy', 2.4]]);
      return 'grumpy';
    }
    this.play([['surprised', 0.9], ['happy', 0.9], ['drowsy', 2.6]]);
    return 'surprised';
  }

  beginDrag() {
    this.queue = [];
    this.dragAmt = 0;
    this._set('stretched', Infinity);
  }

  release(amount) {
    if (amount > 0.2) this.play([['happy', 1.5], ['drowsy', 2.8]]);
    else this.play([['surprised', 0.4], ['happy', 1.0], ['drowsy', 2.6]]);
  }

  squish() {
    this.play([['squished', 0.6], ['happy', 1.3], ['drowsy', 2.6]]);
  }

  jiggle() {
    this.play([['surprised', 0.55], ['happy', 1.3], ['drowsy', 2.6]]);
  }

  reset() {
    this.queue = [];
    this.state = 'sleeping';
    this.timeLeft = Infinity;
    this.heat = 0;
    this.dragAmt = 0;
    this.blinkT = -1;
    this.peekT = -1;
    this.peekIn = 4 + Math.random() * 3;
    Object.assign(this.cur, pick(STATES.sleeping));
    Object.assign(this.out, this.cur);
  }

  update(dt) {
    this.heat *= Math.exp(-dt / 2.2);

    if (this.timeLeft !== Infinity) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        const next = this.queue.shift() || ['sleeping', Infinity];
        this._set(next[0], next[1]);
      }
    }

    let target = STATES[this.state];
    const rate = target.rate;
    if (this.state === 'stretched') {
      // A small tug looks surprised; a big stretch gets wide eyes and an "o".
      const t = smoothstep(0.04, 0.35, this.dragAmt);
      for (const k of KEYS) this.mix[k] = lerp(STATES.surprised[k], STATES.stretched[k], t);
      target = this.mix;
    }

    const a = 1 - Math.exp(-rate * dt);
    const cur = this.cur, out = this.out;
    for (const k of KEYS) {
      cur[k] += (target[k] - cur[k]) * a;
      out[k] = cur[k];
    }

    // Quick blinks while awake.
    if (cur.eyeOpen > 0.3 && this.state !== 'sleeping' && this.state !== 'stretched') {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0 && this.blinkT < 0) {
        this.blinkT = 0;
        this.blinkIn = 2.2 + Math.random() * 2.8;
      }
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const ph = this.blinkT / 0.17;
      if (ph >= 1) this.blinkT = -1;
      else out.eyeOpen *= 1 - Math.sin(Math.PI * ph) * 0.95;
    }

    // While asleep: an occasional slow, heavy-lidded peek.
    if (this.state === 'sleeping' && cur.sleepy > 0.9) {
      this.peekIn -= dt;
      if (this.peekIn <= 0 && this.peekT < 0) {
        this.peekT = 0;
        this.peekIn = 7 + Math.random() * 5;
      }
    } else {
      this.peekT = -1;
    }
    if (this.peekT >= 0) {
      this.peekT += dt;
      const ph = this.peekT / 2.4;
      if (ph >= 1) this.peekT = -1;
      else {
        const e = Math.sin(Math.PI * ph) ** 2;
        out.eyeOpen = Math.max(out.eyeOpen, 0.3 * e);
        out.lidDrop = Math.max(out.lidDrop, 0.6);
      }
    }
    return out;
  }
}
