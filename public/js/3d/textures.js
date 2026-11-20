// Procedural surface textures for the 3D renderer.
//
// The models are authored as flat-coloured faces; what makes a wall read as
// poured concrete, a hull as bolted plate or a roof as tarred felt is surface
// detail. Each surface type gets three tileable maps, painted here once:
//   albedo  a near-white detail layer that multiplies the face colour
//           (seams, streaks, wear), so faction and team colours are untouched
//   rough   roughness variation in the green channel (scratches polish, grime dulls)
//   normal  relief derived from a height painting (seams, rivets, ribs, courses)
// All original, all generated in the browser: nothing is downloaded.

const S = 256;

function seeded(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed;
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

/** Value noise that tiles over the texture: `cells` lattice cells per side. */
function tnoise(x, y, cells, seed) {
  const fx = (x / S) * cells, fy = (y / S) * cells;
  const xi = Math.floor(fx), yi = Math.floor(fy), xf = fx - xi, yf = fy - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => hash2(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, seed);
  const top = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
  const bot = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
  return top + (bot - top) * v;
}
const fbm = (x, y, cells, seed) => tnoise(x, y, cells, seed) * 0.55 + tnoise(x, y, cells * 2, seed + 7) * 0.3 + tnoise(x, y, cells * 4, seed + 19) * 0.15;

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return c;
}

/** Three canvases and their contexts, pre-filled: albedo with `base` grey, roughness, flat height. */
function sheet(base, rough) {
  const A = canvas(), R = canvas(), H = canvas();
  const a = A.getContext('2d'), r = R.getContext('2d'), h = H.getContext('2d');
  a.fillStyle = `rgb(${base},${base},${base})`; a.fillRect(0, 0, S, S);
  r.fillStyle = `rgb(0,${rough},0)`; r.fillRect(0, 0, S, S);
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, S, S);
  return { A, R, H, a, r, h };
}

/** Add per-pixel noise: albedo +-amp around its value, roughness +-ramp, height +-hamp. */
function grain(t, cells, seed, amp, ramp = 0, hamp = 0) {
  for (const [ctx, k, ch] of [[t.a, amp, -1], [t.r, ramp, 1], [t.h, hamp, -1]]) {
    if (!k) continue;
    const img = ctx.getImageData(0, 0, S, S), d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = (fbm(x, y, cells, seed + (ch === 1 ? 31 : 0)) - 0.5) * 2 * k, i = (y * S + x) * 4;
        if (ch === 1) d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
        else { d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n)); }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}

/** Draw something that may cross the edge so that it wraps (tiles). */
function wrap(ctx, x, y, w, h, draw) {
  for (const ox of [0, x + w > S ? -S : null, x < 0 ? S : null]) {
    if (ox === null) continue;
    for (const oy of [0, y + h > S ? -S : null, y < 0 ? S : null]) {
      if (oy === null) continue;
      ctx.save(); ctx.translate(ox, oy); draw(ctx); ctx.restore();
    }
  }
}

/** Dark vertical run-off streaks: rain on a wall. */
function streaks(t, rnd, n, alpha, len = [40, 150]) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * S, y = rnd() * S, w = 1.5 + rnd() * 5, l = len[0] + rnd() * (len[1] - len[0]);
    wrap(t.a, x, y, w, l, c => {
      const g = c.createLinearGradient(0, y, 0, y + l);
      g.addColorStop(0, `rgba(20,24,28,${alpha})`); g.addColorStop(1, 'rgba(20,24,28,0)');
      c.fillStyle = g; c.fillRect(x, y, w, l);
    });
    wrap(t.r, x, y, w, l, c => { c.fillStyle = 'rgba(0,255,0,.18)'; c.fillRect(x, y, w, l * 0.7); });
  }
}

const line = (ctx, x0, y0, x1, y1, style, w) => { ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };

const PAINTERS = {
  // Poured concrete: formwork panels, tie holes, mottling, rain streaks, a few hairline cracks.
  concrete(rnd) {
    const t = sheet(212, 226);
    grain(t, 6, 11, 16, 14, 5);
    for (let k = 0; k <= S; k += 128) {
      for (const ctx of [t.a, t.h]) {
        line(ctx, 0, k, S, k, ctx === t.a ? 'rgba(40,44,48,.5)' : 'rgb(86,86,86)', 2);
        line(ctx, k, 0, k, S, ctx === t.a ? 'rgba(40,44,48,.42)' : 'rgb(92,92,92)', 1.6);
      }
      line(t.a, 0, k + 2, S, k + 2, 'rgba(255,255,255,.16)', 1);
    }
    for (let y = 32; y < S; y += 64) for (let x = 32; x < S; x += 64) {
      t.a.fillStyle = 'rgba(30,32,36,.55)'; t.a.beginPath(); t.a.arc(x, y, 2.2, 0, 7); t.a.fill();
      t.h.fillStyle = 'rgb(70,70,70)'; t.h.beginPath(); t.h.arc(x, y, 2.4, 0, 7); t.h.fill();
    }
    streaks(t, rnd, 22, 0.2);
    for (let i = 0; i < 5; i++) {
      let x = rnd() * S, y = rnd() * S;
      t.a.strokeStyle = 'rgba(30,32,36,.4)'; t.a.lineWidth = 0.8; t.a.beginPath(); t.a.moveTo(x, y);
      for (let s = 0; s < 9; s++) { x += (rnd() - 0.5) * 22; y += rnd() * 16; t.a.lineTo(x, y); }
      t.a.stroke();
    }
    return { t, strength: 1.1 };
  },
  // Bolted plate / painted cladding: offset panels, rivets, chipped edges, scratches, grime below seams.
  panel(rnd) {
    const t = sheet(222, 196);
    grain(t, 8, 23, 9, 22, 2);
    const PH = 64, PW = 128;
    for (let row = 0; row * PH < S; row++) {
      const y = row * PH, off = row % 2 ? PW / 2 : 0;
      line(t.a, 0, y, S, y, 'rgba(22,26,30,.62)', 1.8); line(t.a, 0, y + 2, S, y + 2, 'rgba(255,255,255,.2)', 1);
      line(t.h, 0, y, S, y, 'rgb(74,74,74)', 2.4);
      for (let x = off; x <= S; x += PW) {
        line(t.a, x, y, x, y + PH, 'rgba(22,26,30,.55)', 1.6); line(t.a, x + 1.6, y, x + 1.6, y + PH, 'rgba(255,255,255,.16)', 0.8);
        line(t.h, x, y, x, y + PH, 'rgb(78,78,78)', 2.2);
        for (let k = 8; k < PH; k += 16) for (const dx of [-5, 5]) rivet(t, (x + dx + S) % S, y + k);
      }
      for (let x = 8; x < S; x += 16) { rivet(t, x, y + 5); rivet(t, x, y + PH - 5); }
      for (let i = 0; i < 5; i++) {                              // grime running down from the seam
        const x = rnd() * S, l = 14 + rnd() * 34, g = t.a.createLinearGradient(0, y, 0, y + l);
        g.addColorStop(0, 'rgba(24,26,30,.26)'); g.addColorStop(1, 'rgba(24,26,30,0)');
        t.a.fillStyle = g; t.a.fillRect(x, y + 2, 2 + rnd() * 4, l);
      }
    }
    for (let i = 0; i < 26; i++) {                                 // scratches: paler and smoother
      const x = rnd() * S, y = rnd() * S, a = rnd() * 6.28, l = 6 + rnd() * 22;
      line(t.a, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 'rgba(255,255,255,.2)', 0.7);
      line(t.r, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 'rgba(0,90,0,.8)', 1);
    }
    return { t, strength: 1.5 };
  },
  // Bare steel: brushed along one axis, pitted, smoother where it is handled.
  steel(rnd) {
    const t = sheet(218, 150);
    grain(t, 10, 37, 10, 34, 2);
    for (let i = 0; i < 240; i++) {
      const y = rnd() * S, x = rnd() * S, l = 20 + rnd() * 90;
      wrap(t.a, x, y, l, 1, c => line(c, x, y, x + l, y, `rgba(${rnd() < 0.5 ? '255,255,255' : '10,12,14'},${0.06 + rnd() * 0.08})`, 0.7));
    }
    for (let i = 0; i < 40; i++) { t.a.fillStyle = 'rgba(20,22,26,.3)'; t.a.beginPath(); t.a.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 1.4, 0, 7); t.a.fill(); }
    for (let k = 0; k < S; k += 64) { line(t.a, 0, k, S, k, 'rgba(18,20,24,.4)', 1.2); line(t.h, 0, k, S, k, 'rgb(88,88,88)', 1.8); }
    return { t, strength: 0.8 };
  },
  // Corrugated sheet: ribs running up the wall, rust creeping from the fixings.
  corrugated(rnd) {
    const t = sheet(220, 176);
    const P = 16;
    for (const [ctx, lo, hi] of [[t.a, 176, 240], [t.h, 60, 196]]) {
      const img = ctx.getImageData(0, 0, S, S), d = img.data;
      for (let x = 0; x < S; x++) {
        const w = 0.5 + 0.5 * Math.cos((x / P) * Math.PI * 2), v = lo + (hi - lo) * w;
        for (let y = 0; y < S; y++) { const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; }
      }
      ctx.putImageData(img, 0, 0);
    }
    grain(t, 8, 41, 8, 20, 0);
    for (let y = 0; y < S; y += 128) { line(t.a, 0, y, S, y, 'rgba(20,22,26,.5)', 2); line(t.h, 0, y, S, y, 'rgb(70,70,70)', 3); }
    streaks(t, rnd, 16, 0.22, [30, 110]);
    for (let i = 0; i < 12; i++) {
      const x = rnd() * S, y = rnd() * S, l = 10 + rnd() * 40, g = t.a.createLinearGradient(0, y, 0, y + l);
      g.addColorStop(0, 'rgba(120,64,30,.4)'); g.addColorStop(1, 'rgba(120,64,30,0)');
      t.a.fillStyle = g; t.a.fillRect(x, y, 3 + rnd() * 5, l);
    }
    return { t, strength: 1.6 };
  },
  // Brick: stretcher bond, uneven firing, recessed mortar.
  brick(rnd) {
    const t = sheet(170, 232);
    const BH = 16, BW = 32;
    t.h.fillStyle = 'rgb(96,96,96)'; t.h.fillRect(0, 0, S, S);
    for (let row = 0; row * BH < S; row++) {
      const off = row % 2 ? BW / 2 : 0;
      for (let x = -BW; x < S; x += BW) {
        const v = 196 + Math.floor(rnd() * 50), X = x + off;
        t.a.fillStyle = `rgb(${v},${v - 4},${v - 8})`; t.a.fillRect(X + 1, row * BH + 1, BW - 2, BH - 2);
        t.h.fillStyle = 'rgb(150,150,150)'; t.h.fillRect(X + 1.5, row * BH + 1.5, BW - 3, BH - 3);
        if (rnd() < 0.12) { t.a.fillStyle = 'rgba(20,20,22,.22)'; t.a.fillRect(X + 1, row * BH + 1, BW - 2, BH - 2); }
      }
    }
    grain(t, 12, 53, 10, 12, 4);
    streaks(t, rnd, 12, 0.18);
    return { t, strength: 1.4 };
  },
  // Sandbags: stacked, sagging, stitched.
  sandbag(rnd) {
    const t = sheet(150, 240);
    const BH = 32, BW = 64;
    t.h.fillStyle = 'rgb(60,60,60)'; t.h.fillRect(0, 0, S, S);
    for (let row = 0; row * BH < S; row++) {
      const off = row % 2 ? BW / 2 : 0;
      for (let x = -BW; x < S; x += BW) {
        const X = x + off, cx = X + BW / 2, cy = row * BH + BH / 2, v = 200 + Math.floor(rnd() * 40);
        for (const [ctx, c0, c1] of [[t.a, `rgb(${v},${v},${v})`, 'rgb(120,120,120)'], [t.h, 'rgb(210,210,210)', 'rgb(70,70,70)']]) {
          const g = ctx.createRadialGradient(cx - 6, cy - 4, 2, cx, cy, BW * 0.62);
          g.addColorStop(0, c0); g.addColorStop(1, c1);
          ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(X + 1.5, row * BH + 1.5, BW - 3, BH - 3, 9); ctx.fill();
        }
        line(t.a, X + 6, cy + 9, X + BW - 6, cy + 9, 'rgba(30,30,26,.3)', 0.8);
      }
    }
    grain(t, 16, 61, 12, 8, 3);
    return { t, strength: 1.8 };
  },
  // Track links and tyre tread: bars across the direction of travel.
  tread(rnd) {
    const t = sheet(200, 190);
    for (let x = 0; x < S; x += 32) {
      t.a.fillStyle = 'rgb(120,120,120)'; t.a.fillRect(x, 0, 12, S);
      t.a.fillStyle = 'rgba(255,255,255,.22)'; t.a.fillRect(x + 12, 0, 2, S);
      t.h.fillStyle = 'rgb(60,60,60)'; t.h.fillRect(x, 0, 12, S);
      t.r.fillStyle = 'rgb(0,235,0)'; t.r.fillRect(x, 0, 12, S);
    }
    for (let y = 0; y < S; y += 128) { line(t.a, 0, y, S, y, 'rgba(10,10,12,.5)', 3); line(t.h, 0, y, S, y, 'rgb(50,50,50)', 4); }
    grain(t, 12, 67, 12, 16, 0);
    for (let i = 0; i < 18; i++) { t.a.fillStyle = 'rgba(96,84,66,.22)'; t.a.beginPath(); t.a.arc(rnd() * S, rnd() * S, 4 + rnd() * 12, 0, 7); t.a.fill(); }
    return { t, strength: 1.6 };
  },
  // Flat roof: tarred felt in overlapping strips, gravel, ponding stains.
  roof(rnd) {
    const t = sheet(206, 236);
    grain(t, 24, 71, 18, 10, 6);
    for (let y = 0; y < S; y += 64) { line(t.a, 0, y, S, y, 'rgba(18,20,24,.45)', 2); line(t.a, 0, y + 3, S, y + 3, 'rgba(255,255,255,.12)', 1); line(t.h, 0, y, S, y, 'rgb(150,150,150)', 3); }
    for (let i = 0; i < 9; i++) {
      const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 26;
      wrap(t.a, x - r, y - r, r * 2, r * 2, c => { const g = c.createRadialGradient(x, y, 1, x, y, r); g.addColorStop(0, 'rgba(18,22,28,.3)'); g.addColorStop(1, 'rgba(18,22,28,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); });
      wrap(t.r, x - r, y - r, r * 2, r * 2, c => { c.fillStyle = 'rgba(0,70,0,.5)'; c.beginPath(); c.arc(x, y, r * 0.7, 0, 7); c.fill(); });
    }
    return { t, strength: 0.9 };
  },
  // Canvas and netting: a coarse weave with soft folds.
  cloth(rnd) {
    const t = sheet(214, 240);
    for (let k = 0; k < S; k += 4) { line(t.a, 0, k, S, k, 'rgba(20,22,20,.13)', 1); line(t.a, k, 0, k, S, 'rgba(20,22,20,.1)', 1); }
    const img = t.h.getImageData(0, 0, S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = 128 + 46 * Math.sin((x / S) * Math.PI * 6 + Math.sin((y / S) * Math.PI * 4) * 1.4), i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; }
    t.h.putImageData(img, 0, 0);
    grain(t, 8, 79, 12, 6, 0);
    void rnd;
    return { t, strength: 1.0 };
  },
  // Ground detail laid over the whole painted terrain: grit, pitting and hairline cracks, no
  // seams of its own (the painting has the joints), so stone and asphalt stop being smooth.
  ground(rnd) {
    const t = sheet(214, 226);
    grain(t, 12, 91, 16, 18, 16);
    grain(t, 48, 97, 14, 10, 20);
    for (let i = 0; i < 420; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.5 + rnd() * 1.3;
      t.a.fillStyle = `rgba(${rnd() < 0.6 ? '14,18,22' : '236,240,244'},${(0.12 + rnd() * 0.2).toFixed(2)})`; t.a.beginPath(); t.a.arc(x, y, r, 0, 7); t.a.fill();
      t.h.fillStyle = rnd() < 0.6 ? 'rgb(70,70,70)' : 'rgb(186,186,186)'; t.h.beginPath(); t.h.arc(x, y, r + 0.4, 0, 7); t.h.fill();
    }
    for (let i = 0; i < 14; i++) {
      let x = rnd() * S, y = rnd() * S;
      for (const [ctx, style] of [[t.a, 'rgba(18,22,26,.34)'], [t.h, 'rgb(60,60,60)']]) {
        let px = x, py = y;
        ctx.strokeStyle = style; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(px, py);
        const r2 = seeded(i * 977 + 5);
        for (let k = 0; k < 7; k++) { px += (r2() - 0.5) * 26; py += (r2() - 0.5) * 26; ctx.lineTo(px, py); }
        ctx.stroke();
      }
    }
    return { t, strength: 1.5 };
  },
  // Rubber, soot, deep openings: almost featureless, just not perfectly flat.
  dark(rnd) {
    const t = sheet(226, 232);
    grain(t, 10, 83, 12, 10, 2);
    void rnd;
    return { t, strength: 0.4 };
  },
};

function rivet(t, x, y) {
  t.a.fillStyle = 'rgba(16,18,22,.5)'; t.a.beginPath(); t.a.arc(x + 0.6, y + 0.6, 1.5, 0, 7); t.a.fill();
  t.a.fillStyle = 'rgba(255,255,255,.34)'; t.a.beginPath(); t.a.arc(x - 0.3, y - 0.3, 0.9, 0, 7); t.a.fill();
  t.h.fillStyle = 'rgb(190,190,190)'; t.h.beginPath(); t.h.arc(x, y, 1.7, 0, 7); t.h.fill();
}

/** Tangent-space normal map from a height painting (128 = flat), wrapping at the edges. */
function normalFrom(H, strength) {
  const src = H.getContext('2d').getImageData(0, 0, S, S).data;
  const N = canvas(), ctx = N.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
  const h = (x, y) => src[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength * 4, dy = (h(x, y + 1) - h(x, y - 1)) * strength * 4;
      const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return N;
}

const cache = new Map();

/** { albedo, rough, normal } canvases for a texture name, painted on first use. */
export function surfaceTextures(name) {
  let t = cache.get(name);
  if (!t) {
    const { t: sh, strength } = PAINTERS[name](seeded(name.length * 7919 + name.charCodeAt(0) * 131));
    t = { albedo: sh.A, rough: sh.R, normal: normalFrom(sh.H, strength) };
    cache.set(name, t);
  }
  return t;
}
