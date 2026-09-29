/**
 * Tiny procedural sound kit (Web Audio, no downloads). Starts muted; the
 * AudioContext is only created after the user turns sound on. Every sound goes
 * through a quiet master gain and a compressor, with per-sound rate limits and
 * a voice cap so rapid pokes never pile up into something loud.
 */
const MIN_GAP = { pop: 0.06, bubble: 0.15, squish: 0.25, boing: 0.18, sleepy: 2, grumpy: 0.7, stretch: 0.35 };
const MAX_VOICES = 6;

export class Sfx {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.last = Object.create(null);
    this.voices = 0;
  }

  async setEnabled(on) {
    this.enabled = on;
    if (on) {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          this.enabled = false;
          return false;
        }
        const ctx = new AC();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = 0.5;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -22;
        comp.knee.value = 12;
        comp.ratio.value = 10;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        this.master.connect(comp).connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 0.6);
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      try {
        if (this.ctx.state === 'suspended') await this.ctx.resume();
      } catch {
        /* resume can reject on some browsers if the gesture expired; stay silent */
      }
    } else if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
    return this.enabled;
  }

  play(name, intensity = 1) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (this.last[name] !== undefined && now - this.last[name] < (MIN_GAP[name] ?? 0.1)) return;
    if (this.voices >= MAX_VOICES) return;
    this.last[name] = now;
    const fn = this['_' + name];
    if (fn) fn.call(this, now, Math.min(1.2, Math.max(0.3, intensity)));
  }

  _track(node, stopAt) {
    this.voices++;
    node.onended = () => {
      this.voices--;
    };
    node.stop(stopAt);
  }

  _env(t, attack, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return g;
  }

  _pop(t, k) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    const f = 620 * (0.9 + Math.random() * 0.2);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(190, t + 0.09);
    o.connect(this._env(t, 0.004, 0.22 * k, 0.13));
    o.start(t);
    this._track(o, t + 0.15);
  }

  _bubble(t) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(1800, t + 0.05);
    o.connect(this._env(t, 0.003, 0.12, 0.08));
    o.start(t);
    this._track(o, t + 0.1);
  }

  _squish(t, k) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(1100, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(260, t + 0.38);
    src.connect(bp).connect(this._env(t, 0.03, 0.35 * k, 0.4));
    src.start(t);
    this._track(src, t + 0.42);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(95, t + 0.3);
    o.connect(this._env(t, 0.02, 0.1 * k, 0.32));
    o.start(t);
    o.stop(t + 0.34);
  }

  _boing(t, k) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(360, t + 0.1);
    o.frequency.exponentialRampToValueAtTime(230, t + 0.5);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 13;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(40, t);
    depth.gain.exponentialRampToValueAtTime(2, t + 0.5);
    lfo.connect(depth).connect(o.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    o.connect(lp).connect(this._env(t, 0.01, 0.13 * k, 0.55));
    o.start(t);
    lfo.start(t);
    lfo.stop(t + 0.57);
    this._track(o, t + 0.57);
  }

  _stretch(t) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(540, t + 0.28);
    o.connect(this._env(t, 0.05, 0.05, 0.32));
    o.start(t);
    this._track(o, t + 0.34);
  }

  _grumpy(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(175, t);
    o.frequency.exponentialRampToValueAtTime(118, t + 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    o.connect(lp).connect(this._env(t, 0.015, 0.09, 0.24));
    o.start(t);
    this._track(o, t + 0.26);
  }

  _sleepy(t) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 950;
    lp.connect(this.master);
    const notes = [392, 330];
    notes.forEach((f, i) => {
      const s = t + i * 0.34;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, s);
      o.frequency.exponentialRampToValueAtTime(f * 0.94, s + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.06, s + 0.09);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.6);
      o.connect(g).connect(lp);
      o.start(s);
      if (i === notes.length - 1) this._track(o, s + 0.62);
      else o.stop(s + 0.62);
    });
  }
}
