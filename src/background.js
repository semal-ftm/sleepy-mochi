/**
 * Dreamy pastel dusk behind the mochi: a soft sky gradient, a star field with a
 * few bright glinting stars and the odd shooting star, a glowing crescent moon,
 * drifting clouds at two depths, twinkling sparkles, and floating bokeh.
 * Drawn on a plain 2D canvas behind the (transparent) WebGL canvas, so it never
 * touches the 3D scene. Throttled to ~30 fps, paused in hidden tabs, and static
 * for people who prefer reduced motion.
 */

const rand = (a, b) => a + Math.random() * (b - a);

function makeCloudSprite(w, h, puffs, alpha) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(6px)'; // ignored where unsupported; the gradients are soft anyway
  for (let i = 0; i < puffs; i++) {
    const t = i / (puffs - 1);
    const x = w * (0.18 + 0.64 * t) + rand(-w * 0.04, w * 0.04);
    const r = h * (0.22 + 0.2 * Math.sin(Math.PI * t)) * rand(0.85, 1.15);
    const y = h * 0.62 - r * 0.35;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.6, `rgba(255,250,252,${alpha * 0.85})`);
    g.addColorStop(1, 'rgba(255,250,252,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function makeMoonSprite(r) {
  const size = Math.ceil(r * 2 + 8);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#fff8dc');
  g.addColorStop(1, '#ffd98c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Bite out the crescent.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx + r * 0.46, cy - r * 0.2, r * 0.86, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function startBackground(parent = document.body) {
  const canvas = document.createElement('canvas');
  canvas.className = 'bg-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  parent.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, dpr = 1;
  let sky = null;
  let moon = null, moonR = 0;
  const clouds = [];
  const stars = [];
  const bokeh = [];
  const dots = []; // tiny background stars
  const bright = []; // a few larger stars with a glow and a cross glint
  const shoot = { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, next: 4 };

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sky: lavender dusk at the top melting into warm peach near the floor.
    sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#d6c3ec');
    sky.addColorStop(0.35, '#ecd0e4');
    sky.addColorStop(0.68, '#f7dcd6');
    sky.addColorStop(1, '#f9e8dd');

    moonR = Math.max(24, Math.min(w, h) * 0.065);
    moon = makeMoonSprite(moonR);

    const unit = Math.min(w, h);
    clouds.length = 0;
    const layers = [
      { n: 3, y: [0.12, 0.34], scale: 0.55, speed: 5, alpha: 0.55 },
      { n: 3, y: [0.3, 0.55], scale: 0.9, speed: 9, alpha: 0.7 },
    ];
    for (const L of layers) {
      for (let i = 0; i < L.n; i++) {
        const cw = unit * L.scale * rand(0.8, 1.2);
        const ch = cw * 0.42;
        clouds.push({
          img: makeCloudSprite(Math.ceil(cw), Math.ceil(ch), 6, L.alpha),
          x: ((i + rand(0.1, 0.9)) / L.n) * (w + cw) - cw,
          y: h * rand(L.y[0], L.y[1]),
          w: cw, h: ch,
          speed: L.speed * rand(0.7, 1.3),
          bob: rand(0, Math.PI * 2),
        });
      }
    }

    stars.length = 0;
    const count = Math.round(Math.min(70, (w * h) / 22000));
    for (let i = 0; i < count; i++) {
      stars.push({
        x: rand(0, w), y: rand(0, h * 0.6),
        r: rand(1.6, 3.8), phase: rand(0, Math.PI * 2), speed: rand(0.6, 1.6),
        tint: Math.random() < 0.35 ? '255,190,220' : Math.random() < 0.6 ? '255,214,150' : '255,255,255',
      });
    }

    dots.length = 0;
    const nDots = Math.round(Math.min(170, (w * h) / 8000));
    for (let i = 0; i < nDots; i++) {
      const y = h * Math.pow(Math.random(), 1.4) * 0.72; // denser toward the top
      dots.push({
        x: rand(0, w), y, r: rand(0.6, 1.5),
        fade: 1 - Math.min(1, Math.max(0, (y / h - 0.3) / 0.42)),
        phase: rand(0, Math.PI * 2), speed: rand(0.8, 2.2),
        tint: Math.random() < 0.2 ? '255,236,200' : '255,255,255',
      });
    }
    bright.length = 0;
    for (let i = 0; i < 7; i++) {
      bright.push({ x: rand(0.04, 0.96) * w, y: rand(0.04, 0.42) * h, r: rand(1.6, 2.4), phase: rand(0, Math.PI * 2), speed: rand(0.5, 1.1) });
    }

    bokeh.length = 0;
    const colors = ['255,190,215', '214,196,255', '255,226,190', '255,255,255'];
    for (let i = 0; i < 16; i++) {
      bokeh.push({
        x: rand(0, w), y: rand(0, h), r: rand(unit * 0.015, unit * 0.05),
        vy: rand(4, 12), drift: rand(0, Math.PI * 2), color: colors[i % colors.length], a: rand(0.12, 0.28),
      });
    }
  }

  function star4(x, y, r) {
    // A soft four-point sparkle.
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2.4);
    ctx.quadraticCurveTo(x, y, x + r * 2.4, y);
    ctx.quadraticCurveTo(x, y, x, y + r * 2.4);
    ctx.quadraticCurveTo(x, y, x - r * 2.4, y);
    ctx.quadraticCurveTo(x, y, x, y - r * 2.4);
    ctx.fill();
  }

  function draw(t) {
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Warm studio glow where the mochi sits.
    const gx = w * 0.5, gy = h * 0.62;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h) * 0.55);
    glow.addColorStop(0, 'rgba(255,246,236,0.7)');
    glow.addColorStop(0.45, 'rgba(255,238,228,0.28)');
    glow.addColorStop(1, 'rgba(255,240,230,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Star field (behind the moon and clouds).
    for (const d of dots) {
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * d.speed + d.phase));
      ctx.fillStyle = `rgba(${d.tint},${0.9 * tw * d.fade})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of bright) {
      const tw = 0.6 + 0.4 * Math.sin(t * b.speed + b.phase);
      const gr = b.r * 5;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, gr);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * tw})`);
      g.addColorStop(0.25, `rgba(255,244,255,${0.35 * tw})`);
      g.addColorStop(1, 'rgba(255,244,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, gr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * tw})`;
      ctx.lineWidth = 1;
      const L = b.r * (4 + 2 * tw);
      ctx.beginPath();
      ctx.moveTo(b.x - L, b.y); ctx.lineTo(b.x + L, b.y);
      ctx.moveTo(b.x, b.y - L); ctx.lineTo(b.x, b.y + L);
      ctx.stroke();
    }

    // Now and then, a shooting star streaks across the upper sky.
    if (!reduceMotion) {
      if (!shoot.active && t > shoot.next) {
        shoot.active = true;
        shoot.life = 0;
        shoot.x = rand(0.35, 0.95) * w;
        shoot.y = rand(0.02, 0.2) * h;
        const sp = Math.max(w, h) * 0.55;
        shoot.vx = -sp * 0.82;
        shoot.vy = sp * 0.36;
        shoot.next = t + rand(7, 13);
      }
      if (shoot.active) {
        shoot.life = Math.min(1.2, shoot.life + 1 / 30);
        const k = shoot.life / 1.1;
        if (k >= 1) shoot.active = false;
        else {
          const hx = shoot.x + shoot.vx * shoot.life, hy = shoot.y + shoot.vy * shoot.life;
          const tx = hx - shoot.vx * 0.22, ty = hy - shoot.vy * 0.22;
          const a = Math.sin(Math.PI * k);
          const g = ctx.createLinearGradient(hx, hy, tx, ty);
          g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }
      }
    }

    // Moon with a soft halo, gently breathing.
    const mx = w * 0.64, my = h * 0.17;
    const halo = ctx.createRadialGradient(mx, my, moonR * 0.4, mx, my, moonR * 4.2);
    const pulse = 0.85 + 0.15 * Math.sin(t * 0.6);
    halo.addColorStop(0, `rgba(255,236,190,${0.6 * pulse})`);
    halo.addColorStop(1, 'rgba(255,246,214,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(mx, my, moonR * 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(moon, mx - moon.width / 2, my - moon.height / 2);

    // Twinkling sparkles.
    for (const s of stars) {
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.fillStyle = `rgba(${s.tint},${0.95 * tw})`;
      star4(s.x, s.y, s.r * (0.7 + 0.3 * tw));
    }

    // Clouds drift slowly to the right and wrap around.
    for (const c of clouds) {
      const x = ((c.x + t * c.speed) % (w + c.w * 2)) - c.w;
      const y = c.y + Math.sin(t * 0.25 + c.bob) * 4;
      ctx.drawImage(c.img, x, y - c.h / 2, c.w, c.h);
    }

    // Floating bokeh lights rise and sway.
    for (const b of bokeh) {
      const y = h + b.r - ((h + b.r * 2 - b.y + t * b.vy) % (h + b.r * 2));
      const x = b.x + Math.sin(t * 0.3 + b.drift) * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, b.r);
      g.addColorStop(0, `rgba(${b.color},${b.a})`);
      g.addColorStop(0.7, `rgba(${b.color},${b.a * 0.6})`);
      g.addColorStop(1, `rgba(${b.color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  layout();
  window.addEventListener('resize', () => {
    layout();
    if (reduceMotion) draw(0);
  });

  if (reduceMotion) {
    draw(0);
    return;
  }
  let last = 0;
  const t0 = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden || now - last < 33) return;
    last = now;
    draw((now - t0) / 1000);
  }
  requestAnimationFrame(frame);
}
