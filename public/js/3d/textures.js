// Authored surface materials for the 3D renderer.
//
// Every surface type the models use (painted armour, bare steel, track, concrete, brick,
// corrugated sheet, roofing felt, ...) is a small painting made here once, in the browser:
// nothing is downloaded. A material is not a colour with noise on it. Each one is drawn as
// what it is built from (plates and their seams, bolts, welds, formwork lifts, brick courses,
// track links, felt strips), and every feature is written to all of its maps at once, so the
// maps agree with each other:
//
//   albedo   base colour. Where the surface is painted (`paint` = 1) this is a tone that
//            multiplies the face colour the model was given (faction paint, a team marking),
//            so one material serves every faction. Where paint is gone it is the colour of
//            what shows instead: bare steel, rust, mortar, mud, rubber.
//   paint    how much of the face colour applies (the alpha of albedo)
//   ao       ambient occlusion: seams, the foot of a bolt, the gap between two track links
//   rough    roughness: polished scratches and bare metal low, dirt and rust high
//   metal    metalness: paint, rust, rubber and dirt are not metal; what shows through a chip is
//   height   relief, turned into the normal map
//   wear     a chip pattern of the material's own, used by the renderer to break up the paint
//            along the real edges of a model (it knows where those are; a tile does not)
//
// No light is painted in: no highlights beside seams, no shaded sides of bolts. Relief comes
// from the normal map and the renderer's lights. Feature sizes are chosen for the game's zoom:
// a plate is about a third of a tank, a seam a little under a pixel at gameplay zoom and four
// pixels wide close up.
//
// Painters draw in a 512 x 512 space whatever the output size; everything tiles.

const U = 512;                                           // painter units per tile

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

// ---------------------------------------------------------------- tileable noise fields

const fields = new Map();
/** Value noise over an S x S tile with `cells` lattice cells per side, 0..1, cached. */
function field(S, cells, seed) {
  const key = `${S}|${cells}|${seed}`;
  let f = fields.get(key);
  if (f) return f;
  f = new Float32Array(S * S);
  const lat = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lat[j * cells + i] = hash2(i, j, seed);
  const step = cells / S;
  for (let y = 0; y < S; y++) {
    const fy = y * step, yi = Math.floor(fy), yf = fy - yi, v = yf * yf * (3 - 2 * yf), y0 = (yi % cells) * cells, y1 = ((yi + 1) % cells) * cells;
    for (let x = 0; x < S; x++) {
      const fx = x * step, xi = Math.floor(fx), xf = fx - xi, u = xf * xf * (3 - 2 * xf), x0 = xi % cells, x1 = (xi + 1) % cells;
      const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
      f[y * S + x] = a + (b - a) * u + (c + (d - c) * u - a - (b - a) * u) * v;
    }
  }
  fields.set(key, f);
  return f;
}
/** Three octaves from `cells` up, 0..1. */
function fbm(S, cells, seed) {
  const key = `f${S}|${cells}|${seed}`;
  let f = fields.get(key);
  if (f) return f;
  const a = field(S, cells, seed), b = field(S, Math.min(S / 2, cells * 2), seed + 7), c = field(S, Math.min(S / 2, cells * 4), seed + 19);
  f = new Float32Array(S * S);
  for (let i = 0; i < f.length; i++) f[i] = a[i] * 0.55 + b[i] * 0.3 + c[i] * 0.15;
  fields.set(key, f);
  return f;
}

// ---------------------------------------------------------------- the sheet a painter draws on

const LAYERS = ['a', 'p', 'r', 'm', 'o', 'h'];
const grey = (v, alpha = 1) => { const k = Math.round(Math.max(0, Math.min(1, v)) * 255); return alpha >= 1 ? `rgb(${k},${k},${k})` : `rgba(${k},${k},${k},${alpha})`; };
const css = v => (typeof v === 'string' ? v : Array.isArray(v) ? grey(v[0], v[1]) : grey(v));

/**
 * Six canvases, one per map, drawn together. `base` is the untouched surface:
 * { a: albedo tone (0..1 grey or a css colour), p: paint, r: roughness, m: metalness }.
 */
function sheet(S, base) {
  const t = { S, cv: {}, k: S / U };
  for (const l of LAYERS) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = css(l === 'a' ? base.a : l === 'p' ? (base.p == null ? 1 : base.p) : l === 'r' ? base.r : l === 'm' ? (base.m || 0) : l === 'o' ? 1 : 0.5);
    ctx.fillRect(0, 0, S, S);
    ctx.scale(t.k, t.k);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    t.cv[l] = c; t[l] = ctx;
  }
  return t;
}

/**
 * Draw one feature into every map it changes. `styles` names the layers and what the feature is
 * there: a css colour, a grey 0..1, or [grey, alpha]. `fn(ctx)` builds a path and fills or strokes
 * it. The feature is repeated across the tile's edges so the tile wraps; (cx, cy, rad) says where
 * it is, so only the copies that can show are drawn.
 */
function draw(t, styles, fn, cx, cy, rad) {
  const xs = cx == null ? [-U, 0, U] : [0, ...(cx - rad < 0 ? [U] : []), ...(cx + rad > U ? [-U] : [])];
  const ys = cy == null ? [-U, 0, U] : [0, ...(cy - rad < 0 ? [U] : []), ...(cy + rad > U ? [-U] : [])];
  for (const l in styles) {
    const ctx = t[l], st = css(styles[l]);
    ctx.fillStyle = st; ctx.strokeStyle = st;
    for (const ox of xs) for (const oy of ys) {
      if (ox || oy) { ctx.save(); ctx.translate(ox, oy); fn(ctx, l); ctx.restore(); } else fn(ctx, l);
    }
  }
}

// What shows when paint is gone, and what collects in a joint.
const BARE = { a: 'rgb(118,116,112)', p: 0, m: 1, r: 0.34, h: 0.46 };           // steel under the paint
const ALU = { a: 'rgb(160,162,164)', p: 0, m: 1, r: 0.3, h: 0.47 };           // light alloy under a cool finish
const DIRT = { a: 'rgb(46,43,39)', p: 0, m: 0, r: 0.95 };
const rust = alpha => ({ a: `rgba(112,58,30,${alpha})`, p: [0, alpha], m: [0.05, alpha], r: [0.93, alpha] });

const line = (x0, y0, x1, y1, w) => c => { c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
const disc = (x, y, r) => c => { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
const rect = (x, y, w, h) => c => c.fillRect(x, y, w, h);
const rrect = (x, y, w, h, r) => c => { c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };

/** An irregular flake: where paint has chipped, a pit, a stain. */
function flake(rnd, x, y, r, rough = 0.45) {
  const n = 7 + Math.floor(rnd() * 5), pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 6.283, k = r * (1 - rough + rnd() * rough * 2); pts.push([x + Math.cos(a) * k, y + Math.sin(a) * k * (0.6 + rnd() * 0.5)]); }
  return c => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill(); };
}

/** Chips scattered along a line (the lip of a seam, an arris): denser and larger toward its ends. */
function chips(t, rnd, x0, y0, x1, y1, n, size, what) {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
  for (let i = 0; i < n; i++) {
    let f = rnd();
    if (rnd() < 0.45) f = f < 0.5 ? f * f * 2 * 0.5 : 1 - (1 - f) * (1 - f) * 2 * 0.5;      // crowd the ends
    const off = (rnd() - 0.5) * size * 1.6, r = size * (0.35 + rnd() * rnd() * 1.3);
    const x = x0 + (x1 - x0) * f + nx * off, y = y0 + (y1 - y0) * f + ny * off;
    draw(t, what, flake(rnd, x, y, r), x, y, r * 2);
  }
}

/** Something that has run down the surface from (x, y): rain dirt, rust, lime. Fades with distance. */
function run(t, x, y, w, len, rgb, alpha, rough) {
  const g = l => c => {
    const gr = c.createLinearGradient(0, y, 0, y + len);
    if (l === 'a') { gr.addColorStop(0, `rgba(${rgb},${alpha})`); gr.addColorStop(1, `rgba(${rgb},0)`); }
    else { gr.addColorStop(0, grey(rough, alpha)); gr.addColorStop(1, grey(rough, 0)); }
    c.fillStyle = gr; c.fillRect(x - w / 2, y, w, len);
  };
  for (const l of ['a', 'r']) draw(t, { [l]: 0 }, g(l), x, y + len / 2, len);
}

/** A fastener: a raised head with dirt and shade round its foot. Nothing is lit. */
function bolt(t, rnd, x, y, r, chipped) {
  draw(t, { o: [0.4, 0.8], a: 'rgba(40,37,33,.3)', r: [0.95, 0.5] }, disc(x, y, r * 1.5), x, y, r * 2);
  draw(t, { h: 0.86, o: 1, a: [0.8, 1], r: 0.46, p: 1, m: 0 }, disc(x, y, r), x, y, r);
  if (chipped) draw(t, BARE, flake(rnd, x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, r * 0.75), x, y, r * 2);
  draw(t, { h: 0.7, a: 'rgba(20,20,20,.5)' }, line(x - r * 0.5, y, x + r * 0.5, y, r * 0.28), x, y, r);          // the slot
}

/** A recessed joint between two plates, dirt in it and shade beside it. */
function seam(t, x0, y0, x1, y1, w) {
  draw(t, { o: [0.5, 0.35], a: 'rgba(40,37,33,.12)' }, line(x0, y0, x1, y1, w * 4.5));
  draw(t, { o: [0.3, 0.5], h: [0.4, 0.6] }, line(x0, y0, x1, y1, w * 2.2));
  draw(t, { ...DIRT, o: 0.2, h: 0.12 }, line(x0, y0, x1, y1, w));
}

// ---------------------------------------------------------------- the materials

const PAINTERS = {
  /**
   * Painted plate: armour, cladding, anything bolted together and painted. Eight-unit plates in
   * a running bond, bolted along their joints; paint chipped to steel along the lips of the
   * joints and at plate corners; an access hatch and a row of louvres; scratches down to primer
   * and a few to metal; rain dirt run down from every horizontal joint.
   */
  panel(S, rnd, o = {}) {
    const cool = !!o.cool, under = cool ? ALU : BARE;
    const t = sheet(S, { a: 0.92, r: cool ? 0.4 : 0.52, m: 0 });
    const PW = 256, PH = 256, sw = cool ? 3 : 4.5;
    // Each plate was painted on its own day: a slightly different tone.
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
      const x = col * PW + (row ? PW / 2 : 0), y = row * PH, v = 0.86 + rnd() * 0.12, w = (rnd() - 0.5) * 0.03;
      const tone = `rgb(${Math.round((v + w) * 255)},${Math.round(v * 255)},${Math.round((v - w) * 255)})`;
      draw(t, { a: tone }, rect(x, y, PW, PH), x + PW / 2, y + PH / 2, PW);
      const kind = (row * 2 + col + (cool ? 1 : 0)) % 4;
      if (kind === 0) {                                              // access hatch: a joint of its own, four bolts, a hinge
        const hx = x + 70, hy = y + 84, hw = 112, hh = 84;
        draw(t, { o: [0.4, 0.5] }, c => { c.lineWidth = 12; c.beginPath(); c.roundRect(hx, hy, hw, hh, 10); c.stroke(); }, hx + hw / 2, hy + hh / 2, hw);
        draw(t, { ...DIRT, o: 0.25, h: 0.2 }, c => { c.lineWidth = 3.5; c.beginPath(); c.roundRect(hx, hy, hw, hh, 10); c.stroke(); }, hx + hw / 2, hy + hh / 2, hw);
        draw(t, { h: 0.58, a: [1, 0.06] }, rrect(hx + 2, hy + 2, hw - 4, hh - 4, 9), hx + hw / 2, hy + hh / 2, hw);
        for (const [bx, by] of [[10, 10], [hw - 10, 10], [10, hh - 10], [hw - 10, hh - 10]]) bolt(t, rnd, hx + bx, hy + by, 4, rnd() < 0.3);
        draw(t, { h: 0.8, a: [0.8, 1], o: 1 }, rrect(hx + hw / 2 - 16, hy - 5, 32, 9, 3), hx + hw / 2, hy, 20);
        chips(t, rnd, hx, hy + hh, hx + hw, hy + hh, 9, 5, under);
      } else if (kind === 1 && !cool) {                              // louvres: slots with shade inside
        for (let i = 0; i < 5; i++) {
          const ly = y + 70 + i * 22, lx = x + 60;
          draw(t, { a: 'rgb(16,16,17)', p: 0, m: 0, r: 0.9, o: 0.15, h: 0.12 }, rrect(lx, ly, 132, 9, 3), lx + 66, ly, 80);
          draw(t, { h: 0.74, o: 1 }, rect(lx, ly - 5, 132, 5), lx + 66, ly, 80);                                   // the lip over each slot
          run(t, lx + 20 + rnd() * 92, ly + 9, 5 + rnd() * 8, 20 + rnd() * 40, '24,22,20', 0.34, 0.92);
        }
      } else if (kind === 2) {                                       // a doubler plate welded on: a raised patch
        const dx = x + 150, dy = y + 40, dw = 70, dh = 150;
        draw(t, { o: [0.45, 0.6] }, c => { c.lineWidth = 9; c.strokeRect(dx, dy, dw, dh); }, dx + dw / 2, dy + dh / 2, dh);
        draw(t, { h: 0.66, a: [0.84, 0.5] }, rect(dx, dy, dw, dh), dx + dw / 2, dy + dh / 2, dh);
        for (let i = 0; i < 12; i++) draw(t, { h: 0.74, a: 'rgba(40,38,36,.5)', r: [0.8, 0.6] }, disc(dx + (i < 6 ? 0 : dw), dy + 8 + (i % 6) * 26 + rnd() * 6, 4 + rnd() * 2), dx + dw / 2, dy + dh / 2, dh);
        chips(t, rnd, dx, dy, dx + dw, dy, 6, 5, under);
      } else if (cool) {                                             // a round inspection port
        const px = x + 128, py = y + 128;
        draw(t, { o: [0.4, 0.5] }, disc(px, py, 40), px, py, 44);
        draw(t, { ...DIRT, o: 0.25, h: 0.2 }, c => { c.lineWidth = 3; c.beginPath(); c.arc(px, py, 34, 0, 7); c.stroke(); }, px, py, 40);
        draw(t, { h: 0.57, o: 1, a: [0.98, 1] }, disc(px, py, 32), px, py, 34);
        for (let i = 0; i < 6; i++) bolt(t, rnd, px + Math.cos(i * 1.047) * 25, py + Math.sin(i * 1.047) * 25, 3, false);
      }
    }
    // Faded patches: paint chalked by weather, a touch paler and rougher.
    for (let i = 0; i < 7; i++) { const x = rnd() * U, y = rnd() * U, r = 34 + rnd() * 60; draw(t, { a: [1, 0.07], r: [0.72, 0.25] }, flake(rnd, x, y, r, 0.3), x, y, r * 2); }
    // Joints, and the bolts along them.
    for (let row = 0; row < 2; row++) {
      const y = row * PH, off = row ? PW / 2 : 0;
      seam(t, 0, y, U, y, sw);
      for (let x = 32; x < U; x += 64) for (const dy of [-15, 15]) if (cool) draw(t, { h: 0.56, a: 'rgba(30,30,32,.4)', o: [0.6, 0.6] }, disc(x, y + dy, 2.6), x, y + dy, 4); else bolt(t, rnd, x, y + dy, 4.2, rnd() < 0.08);
      for (let col = 0; col < 2; col++) {
        const x = col * PW + off;
        seam(t, x, y, x, y + PH, sw);
        for (let k = 64; k < PH - 16; k += 64) for (const dx of [-15, 15]) if (cool) draw(t, { h: 0.56, a: 'rgba(30,30,32,.4)', o: [0.6, 0.6] }, disc(x + dx, y + k, 2.6), x + dx, y + k, 4); else bolt(t, rnd, x + dx, y + k, 4.2, rnd() < 0.08);
        // Paint goes first along the lips of the joint, and most at the corners where plates meet.
        const amt = cool ? 0.45 : 1;
        for (const d of [-sw, sw]) chips(t, rnd, x + d, y + 6, x + d, y + PH - 6, Math.round(10 * amt), cool ? 3 : 4, under);
        for (let i = 0; i < 3 * amt; i++) { const cx = x + (rnd() - 0.5) * 30, cy = y + (rnd() - 0.5) * 30, r = 4 + rnd() * 8; draw(t, under, flake(rnd, cx, cy, r), cx, cy, r * 2); }
      }
      for (const d of [-sw, sw]) chips(t, rnd, 6, y + d, U - 6, y + d, Math.round(18 * (cool ? 0.45 : 1)), cool ? 3 : 4, under);
      // Rain carries the dirt in the joint down the plate below it.
      for (let i = 0; i < (cool ? 9 : 18); i++) run(t, rnd() * U, y + sw, 4 + rnd() * 11, 36 + rnd() * 150, '26,24,21', 0.2 + rnd() * 0.22, 0.9);
      if (!cool) for (let i = 0; i < 5; i++) { const x = rnd() * U; draw(t, rust(0.75), flake(rnd, x, y + 12, 4 + rnd() * 4), x, y + 12, 12); run(t, x, y + 12, 3 + rnd() * 4, 18 + rnd() * 60, '112,58,30', 0.5, 0.94); }
    }
    // Scratches: most only through the top coat (paler, smoother), a few to the metal.
    for (let i = 0; i < (cool ? 12 : 22); i++) {
      const x = rnd() * U, y = rnd() * U, a = (rnd() - 0.5) * 0.9 + (rnd() < 0.2 ? 1.57 : 0), l = 24 + rnd() * rnd() * 150;
      const x1 = x + Math.cos(a) * l, y1 = y + Math.sin(a) * l, mx = (x + x1) / 2, my = (y + y1) / 2;
      draw(t, { a: [1, 0.3], r: [0.3, 0.7], h: [0.47, 0.6] }, line(x, y, x1, y1, 1.6 + rnd() * 1.6), mx, my, l);
      if (rnd() < 0.32) draw(t, under, line(x + (x1 - x) * 0.2, y + (y1 - y) * 0.2, x + (x1 - x) * 0.8, y + (y1 - y) * 0.8, 1.2), mx, my, l);
    }
    return { t, bump: cool ? 2.0 : 2.8, mottle: [0.05, 4], grain: [0.022, 128], rn: [0.1, 16], hn: [0.012, 64] };
  },
  plating(S, rnd) { return PAINTERS.panel(S, rnd, { cool: true }); },

  /**
   * Blackened steel: barrels, machinery, gantries. Drawn and brushed along its length, oxide
   * coat worn to bright metal where it is handled, weld beads with heat tint either side,
   * oil that has run and dried, freckles of rust.
   */
  steel(S, rnd) {
    const t = sheet(S, { a: 0.9, r: 0.5, m: 0.78 });
    for (let i = 0; i < 520; i++) {                                 // the drawn grain: long fine lines, lighter and darker
      const y = rnd() * U, x = rnd() * U, l = 60 + rnd() * 260, up = rnd() < 0.5;
      draw(t, { a: [up ? 1 : 0.55, 0.05 + rnd() * 0.1], r: [up ? 0.34 : 0.66, 0.3] }, line(x, y, x + l, y, 0.8 + rnd() * 1.4), x + l / 2, y, l);
    }
    for (let i = 0; i < 9; i++) {                                   // handled bright: wide soft bands of polish
      const y = rnd() * U, h = 12 + rnd() * 30;
      draw(t, { a: [1, 0.1], r: [0.24, 0.5], m: [1, 0.5] }, rect(0, y, U, h), 256, y + h / 2, 400);
    }
    for (const y of [128, 384]) {                                   // weld beads, with the blue and straw of heat beside them
      draw(t, { a: 'rgba(58,70,104,.3)', r: [0.42, 0.4] }, rect(0, y - 20, U, 40));
      draw(t, { a: 'rgba(140,104,56,.26)' }, rect(0, y - 9, U, 18));
      draw(t, { o: [0.5, 0.5] }, line(0, y, U, y, 13));
      for (let x = 0; x < U; x += 7) { const yy = y + (rnd() - 0.5) * 2.4; draw(t, { h: 0.8 + rnd() * 0.1, a: [0.68 + rnd() * 0.2, 0.9], r: 0.6, m: 0.9, o: 1 }, c => { c.beginPath(); c.ellipse(x, yy, 5.2, 4.2, 0, 0, 7); c.fill(); }, x, yy, 8); }
    }
    for (let i = 0; i < 70; i++) { const x = rnd() * U, y = rnd() * U, r = 0.8 + rnd() * 2; draw(t, { a: 'rgba(14,14,16,.6)', h: 0.34, o: [0.5, 0.7], r: 0.8 }, disc(x, y, r), x, y, r); }     // pits
    for (let i = 0; i < 7; i++) {                                   // oil: dark, smooth, run downward
      const x = rnd() * U, y = rnd() * U, r = 9 + rnd() * 20;
      draw(t, { a: 'rgba(12,11,10,.5)', r: [0.14, 0.8] }, flake(rnd, x, y, r, 0.3), x, y, r * 2);
      run(t, x, y, r * 0.8, 40 + rnd() * 90, '12,11,10', 0.4, 0.2);
    }
    for (let i = 0; i < 18; i++) {                                  // rust freckles, thickest by the welds
      const y = [128, 384][i % 2] + (rnd() - 0.5) * (rnd() < 0.6 ? 46 : 240), x = rnd() * U, r = 1.5 + rnd() * 4.5;
      draw(t, { a: `rgba(84,44,24,${0.5 + rnd() * 0.3})`, m: [0.1, 0.7], r: [0.93, 0.8] }, flake(rnd, x, y, r), x, y, r * 2);
    }
    for (let i = 0; i < 16; i++) { const x = rnd() * U, y = rnd() * U, l = 20 + rnd() * 90, a = rnd() * 6.28; draw(t, { a: [1, 0.3], r: [0.18, 0.8], m: 1 }, line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 1.4), x, y, l); }   // bright scores
    return { t, bump: 1.5, mottle: [0.07, 4], grain: [0.03, 128], rn: [0.12, 32], hn: [0.01, 128] };
  },

  /** Copper and brass: tarnish in broad patches, verdigris where water sits, riveted bands. */
  copper(S, rnd) {
    const t = sheet(S, { a: 0.9, r: 0.36, m: 1 });
    for (let i = 0; i < 26; i++) { const x = rnd() * U, y = rnd() * U, r = 26 + rnd() * 70; draw(t, { a: `rgba(${rnd() < 0.5 ? '70,44,30' : '255,236,214'},${0.1 + rnd() * 0.14})`, r: [0.3 + rnd() * 0.4, 0.4] }, flake(rnd, x, y, r, 0.35), x, y, r * 2); }
    for (let i = 0; i < 260; i++) { const y = rnd() * U, x = rnd() * U, l = 30 + rnd() * 160; draw(t, { a: [rnd() < 0.5 ? 1 : 0.5, 0.06], r: [0.26, 0.25] }, line(x, y, x + l, y, 1), x + l / 2, y, l); }
    for (const y of [0, 256]) {
      seam(t, 0, y, U, y, 5);
      for (let x = 16; x < U; x += 32) { bolt(t, rnd, x, y - 13, 4.4, false); bolt(t, rnd, x, y + 13, 4.4, false); }
      for (let i = 0; i < 22; i++) {                                // verdigris gathers under the band and runs
        const x = rnd() * U, r = 4 + rnd() * 11;
        draw(t, { a: `rgba(74,150,128,${0.6 + rnd() * 0.3})`, p: [0, 0.8], m: [0, 0.9], r: [0.92, 0.9], h: [0.56, 0.5] }, flake(rnd, x, y + 8 + rnd() * 12, r), x, y + 12, r * 2);
        run(t, x, y + 12, 3 + rnd() * 5, 30 + rnd() * 110, '74,150,128', 0.42, 0.9);
      }
    }
    return { t, bump: 1.4, mottle: [0.09, 4], grain: [0.03, 64], rn: [0.14, 16], hn: [0.01, 64] };
  },

  /** Rubber: moulded, matt, scuffed pale where it rubs, dust in the mould lines. */
  dark(S, rnd) {
    const t = sheet(S, { a: 0.9, r: 0.9, m: 0 });
    for (let y = 0; y < U; y += 64) { draw(t, { h: 0.4, o: [0.6, 0.6], a: 'rgba(92,80,62,.3)', r: 0.96 }, line(0, y, U, y, 4)); draw(t, { h: 0.58 }, line(0, y + 8, U, y + 8, 6)); }
    for (let i = 0; i < 60; i++) { const x = rnd() * U, y = rnd() * U, l = 14 + rnd() * 70, a = rnd() * 6.28; draw(t, { a: [1, 0.16], r: [0.7, 0.5] }, line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 1.5 + rnd() * 3), x, y, l); }
    for (let i = 0; i < 16; i++) { const x = rnd() * U, y = rnd() * U, r = 16 + rnd() * 40; draw(t, { a: 'rgba(120,104,82,.2)', r: [0.98, 0.4], p: [0, 0.2] }, flake(rnd, x, y, r, 0.35), x, y, r * 2); }
    return { t, bump: 1.0, mottle: [0.06, 8], grain: [0.03, 128], rn: [0.05, 16], hn: [0.02, 128] };
  },

  /**
   * Track: links across the direction of travel (u). Each link is a steel shoe carrying a
   * rubber pad, joined to the next by bright worn end connectors and a pin; the gap between
   * links is deep and packed with mud.
   */
  tread(S, rnd) {
    const t = sheet(S, { a: 0.86, r: 0.56, m: 0.85 });
    const P = 128;                                                   // one link
    for (let x = 0; x < U; x += P) {
      draw(t, { a: 'rgb(9,9,10)', p: 0, m: 0, r: 0.9, o: 0.1, h: 0.06 }, rect(x - 7, 0, 14, U));                 // the gap
      draw(t, { o: [0.45, 0.5] }, rect(x - 15, 0, 30, U));
      for (let y = 0; y < U; y += 256) {
        // rubber pad, proud of the shoe, with two moulded grooves
        draw(t, { a: 'rgb(34,34,36)', p: 0, m: 0, r: 0.9, h: 0.7, o: 1 }, rrect(x + 22, y + 34, P - 44, 188, 12), x + 64, y + 128, 110);
        for (const gy of [96, 160]) draw(t, { a: 'rgb(12,12,13)', h: 0.42, o: 0.3, r: 0.95 }, line(x + 30, y + gy + 10, x + P - 30, y + gy - 10, 7), x + 64, y + gy, 60);
        draw(t, { a: 'rgba(120,118,112,.34)', r: [0.7, 0.5] }, rrect(x + 30, y + 44, P - 60, 168, 8), x + 64, y + 128, 100);   // the pad's face is scuffed grey
        // end connectors: bright where they run through the sprocket, a dark pin in each
        for (const cy of [y, y + 256]) {
          draw(t, { a: 'rgb(150,151,154)', p: 0, m: 1, r: 0.26, h: 0.76, o: 1 }, rrect(x + 10, cy - 18, P - 20, 36, 8), x + 64, cy, 70);
          draw(t, { a: 'rgb(20,20,22)', p: 0, m: 0.6, r: 0.6, h: 0.5, o: 0.4 }, disc(x + 20, cy, 7), x + 20, cy, 8);
          draw(t, { a: 'rgb(20,20,22)', p: 0, m: 0.6, r: 0.6, h: 0.5, o: 0.4 }, disc(x + P - 20, cy, 7), x + P - 20, cy, 8);
        }
        // guide horn down the middle of the shoe
        draw(t, { h: 0.84, a: [0.94, 1], m: 1, r: 0.34, p: 1, o: 1 }, rrect(x + P / 2 - 9, y + 4, 18, 24, 4), x + 64, y + 16, 20);
      }
      // mud: packed in the gap, smeared across the leading edge of each shoe
      for (let i = 0; i < 26; i++) { const y = rnd() * U, r = 5 + rnd() * 13, dx = (rnd() - 0.5) * 34; draw(t, { a: `rgba(${86 + Math.floor(rnd() * 24)},${70 + Math.floor(rnd() * 16)},50,${0.5 + rnd() * 0.4})`, p: [0, 0.7], m: [0, 0.9], r: [0.97, 0.9], h: [0.36, 0.5] }, flake(rnd, x + dx, y, r), x + dx, y, r * 2); }
    }
    for (let i = 0; i < 40; i++) { const x = rnd() * U, y = rnd() * U, l = 20 + rnd() * 80; draw(t, { a: [1, 0.2], r: [0.22, 0.7] }, line(x, y, x + l, y + (rnd() - 0.5) * 8, 1.4), x, y, l); }     // scores along the run
    return { t, bump: 2.3, mottle: [0.05, 8], grain: [0.035, 128], rn: [0.08, 32], hn: [0.015, 64] };
  },

  /**
   * Cast concrete: poured in six-unit lifts between formwork panels, so there is a cold joint
   * at every lift and a panel joint in between; tie holes in rows, some weeping rust; bugholes
   * and honeycombing; hairline cracks from the holes; dirt run down from the joints and lime
   * leached out below the cracks. Restrained: it is a wall, not a ruin.
   */
  concrete(S, rnd) {
    const t = sheet(S, { a: 0.9, r: 0.9, m: 0 });
    const LH = 128, PW = 256;
    for (let l = 0; l < 4; l++) {
      const y = l * LH, off = (l % 2) * PW / 2, v = 0.84 + rnd() * 0.12;
      draw(t, { a: grey(v) }, rect(0, y, U, LH));                                    // every pour a slightly different mix
      for (let x = off; x < U + off; x += PW) {
        const v2 = (rnd() - 0.5) * 0.05;
        draw(t, { a: v2 > 0 ? [1, v2 * 2] : [0, -v2 * 2] }, rect(x % U, y, PW, LH), (x % U) + PW / 2, y + LH / 2, PW);
        draw(t, { a: 'rgba(40,40,40,.4)', h: 0.4, o: [0.6, 0.6] }, line(x % U, y + 3, x % U, y + LH - 3, 2.4), x % U, y + LH / 2, LH);   // panel joint: a fin of paste
        for (const hy of [36, 96]) for (const hx of [64, 192]) {                    // tie holes, plugged or not
          const X = (x + hx) % U, Y = y + hy;
          draw(t, { o: [0.3, 0.7] }, disc(X, Y, 9), X, Y, 10);
          draw(t, { a: 'rgb(34,33,32)', h: 0.14, o: 0.2, r: 0.95 }, disc(X, Y, 5), X, Y, 6);
          if (rnd() < 0.35) run(t, X, Y + 4, 4 + rnd() * 3, 26 + rnd() * 70, '120,66,34', 0.4, 0.92);
          else if (rnd() < 0.4) run(t, X, Y + 4, 5 + rnd() * 4, 20 + rnd() * 50, '24,24,24', 0.22, 0.95);
        }
      }
      // cold joint: a dark line, a ragged pale band of paste under it, honeycombing along it
      draw(t, { a: 'rgba(30,30,30,.55)', h: 0.3, o: [0.5, 0.7] }, line(0, y, U, y, 3));
      for (let i = 0; i < 26; i++) { const x = rnd() * U, r = 5 + rnd() * 14; draw(t, { a: [1, 0.1 + rnd() * 0.1], r: [0.8, 0.4] }, flake(rnd, x, y + 6 + rnd() * 8, r, 0.5), x, y + 8, r * 2); }
      for (let i = 0; i < 5; i++) {
        const cx = rnd() * U, cy = y + 8 + rnd() * 14;
        for (let k = 0; k < 16; k++) { const x = cx + (rnd() - 0.5) * 50, yy = cy + (rnd() - 0.5) * 16, r = 1.2 + rnd() * 3; draw(t, { a: `rgba(${rnd() < 0.3 ? '150,136,112' : '30,30,30'},.7)`, h: 0.3, o: [0.5, 0.7] }, disc(x, yy, r), x, yy, r); }
      }
      for (let i = 0; i < 12; i++) run(t, rnd() * U, y + 2, 5 + rnd() * 14, 30 + rnd() * 100, '28,28,27', 0.14 + rnd() * 0.14, 0.96);
    }
    for (let i = 0; i < 380; i++) { const x = rnd() * U, y = rnd() * U, r = 0.7 + rnd() * rnd() * 3.2; draw(t, { a: 'rgba(28,28,28,.6)', h: 0.3, o: [0.55, 0.6] }, disc(x, y, r), x, y, r); }   // bugholes
    for (let i = 0; i < 7; i++) {                                    // hairline cracks, and lime below them
      let x = rnd() * U, y = Math.floor(rnd() * 4) * LH + [36, 96][i % 2];
      const pts = [[x, y]];
      for (let k = 0; k < 9; k++) { x += (rnd() - 0.5) * 26; y += 6 + rnd() * 16; pts.push([x, y]); }
      draw(t, { a: 'rgba(22,22,22,.6)', h: 0.34, o: [0.6, 0.5] }, c => { c.lineWidth = 1.3; c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); });
      if (i % 2) run(t, pts[6][0], pts[6][1], 7 + rnd() * 7, 30 + rnd() * 60, '236,234,226', 0.2, 0.8);
    }
    return { t, bump: 1.7, mottle: [0.1, 4], grain: [0.05, 128], rn: [0.06, 32], hn: [0.03, 64] };
  },

  /**
   * Brick: stretcher bond with a header course every sixth, every brick fired a little
   * differently, a few clinkered dark; mortar recessed and its own colour whatever the brick;
   * arrises chipped pale; soot and water marks; lime bloom.
   */
  brick(S, rnd) {
    const t = sheet(S, { a: 'rgb(150,146,138)', p: 0, r: 0.95, m: 0 });           // the tile starts as mortar
    for (const l of ['h', 'o']) { t[l].fillStyle = grey(l === 'h' ? 0.3 : 0.55); t[l].fillRect(0, 0, U, U); }
    const BH = 32, BW = 64, J = 4;
    for (let row = 0; row * BH < U; row++) {
      const head = row % 6 === 5, w = head ? BW / 2 : BW, off = head ? 0 : (row % 2) * BW / 2;
      for (let x = -w; x < U; x += w) {
        const X = x + off, Y = row * BH, k = rnd(), v = k < 0.07 ? 0.5 + rnd() * 0.1 : k > 0.95 ? 1 : 0.76 + rnd() * 0.2, warm = (rnd() - 0.5) * 0.07;
        const tone = `rgb(${Math.round(Math.min(1, v + warm) * 255)},${Math.round(v * 255)},${Math.round(Math.max(0, v - warm) * 255)})`;
        draw(t, { a: tone, p: 1, h: 0.56 + rnd() * 0.06, o: 1, r: 0.88 + rnd() * 0.08 }, rrect(X + J / 2, Y + J / 2, w - J, BH - J, 2.5), X + w / 2, Y + BH / 2, w);
        if (rnd() < 0.28) { const cx = X + (rnd() < 0.5 ? J : w - J), cy = Y + (rnd() < 0.5 ? J : BH - J), r = 3 + rnd() * 5; draw(t, { a: [1, 0.3], h: 0.4, p: 1 }, flake(rnd, cx, cy, r), cx, cy, r * 2); }   // a chipped arris
        if (rnd() < 0.2) for (let i = 0; i < 4; i++) { const px = X + 6 + rnd() * (w - 12), py = Y + 6 + rnd() * (BH - 12); draw(t, { a: 'rgba(20,16,14,.5)', h: 0.4 }, disc(px, py, 1 + rnd() * 1.4), px, py, 3); }
      }
    }
    for (let i = 0; i < 14; i++) run(t, rnd() * U, rnd() * U, 8 + rnd() * 20, 60 + rnd() * 160, '20,18,17', 0.12 + rnd() * 0.14, 0.97);
    for (let i = 0; i < 9; i++) { const x = rnd() * U, y = rnd() * U, r = 14 + rnd() * 34; draw(t, { a: [1, 0.1 + rnd() * 0.1], r: [0.8, 0.3] }, flake(rnd, x, y, r, 0.4), x, y, r * 2); }
    return { t, bump: 2.2, mottle: [0.06, 4], grain: [0.045, 128], rn: [0.04, 32], hn: [0.03, 128] };
  },

  /**
   * Corrugated sheet: ribs running up the wall, sheets lapped side to side and end to end,
   * fixings on the crests with rust round them and below them, paint lifted from the bottom
   * edge of each sheet to the zinc underneath, dirt lying in the valleys.
   */
  corrugated(S, rnd) {
    const t = sheet(S, { a: 0.92, r: 0.5, m: 0 });
    const P = 32;
    for (const [l, lo, hi] of [['h', 0.24, 0.76], ['a', 0.8, 0.94], ['o', 0.62, 1], ['r', 0.62, 0.46]]) {       // valleys hold the dirt: darker, rougher, shaded
      const ctx = t[l], n = Math.round(U * t.k), img = ctx.getImageData(0, 0, n, n), d = img.data;
      for (let x = 0; x < n; x++) {
        const w = 0.5 - 0.5 * Math.cos(((x / t.k) / P) * Math.PI * 2), v = Math.round((lo + (hi - lo) * w) * 255);
        for (let y = 0; y < n; y++) { const i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; }
      }
      ctx.putImageData(img, 0, 0);
    }
    for (const x of [0, 256]) { draw(t, { ...DIRT, o: 0.3, h: 0.2 }, line(x + 16, 0, x + 16, U, 3)); draw(t, { h: 0.84 }, line(x + 10, 0, x + 10, U, 6)); }   // side laps
    for (const y of [0, 256]) {
      draw(t, { o: [0.3, 0.7], a: 'rgba(20,20,20,.45)' }, rect(0, y, U, 9));                                    // the sheet above overhangs
      draw(t, { h: [0.9, 0.5] }, rect(0, y - 6, U, 6));
      for (let i = 0; i < 16; i++) {                                // paint lifting from the cut edge
        const x = rnd() * U, r = 5 + rnd() * 15;
        draw(t, { a: 'rgb(158,164,170)', p: 0, m: 0.9, r: 0.36 }, flake(rnd, x, y - 8 - rnd() * 16, r), x, y - 12, r * 2);
      }
      for (const fy of [y + 30, y + 150]) for (let x = 16; x < U; x += 64) {                                     // fixings on the crests
        const r = 4 + rnd() * 6;
        draw(t, rust(0.6 + rnd() * 0.3), flake(rnd, x, fy, r + 3), x, fy, r * 2);
        run(t, x, fy, 4 + rnd() * 4, 30 + rnd() * 90, '112,58,30', 0.5, 0.94);
        draw(t, { a: 'rgb(60,60,62)', p: 0, m: 0.7, r: 0.5, h: 0.95, o: 1 }, disc(x, fy, 3.4), x, fy, 4);
      }
    }
    for (let i = 0; i < 12; i++) run(t, rnd() * U, rnd() * U, 6 + rnd() * 12, 50 + rnd() * 130, '24,22,20', 0.16 + rnd() * 0.12, 0.92);
    for (let i = 0; i < 5; i++) { const x = rnd() * U, y = rnd() * U, r = 14 + rnd() * 22; draw(t, { h: [0.3, 0.5] }, disc(x, y, r), x, y, r); }              // dents
    return { t, bump: 2.2, mottle: [0.05, 4], grain: [0.025, 128], rn: [0.08, 16], hn: [0.008, 64] };
  },

  /**
   * Flat roof: mineral felt laid in five-unit strips with tarred laps, granules lost in
   * patches, repairs with newer felt, rings where water has stood and dried, blisters.
   */
  roof(S, rnd) {
    const t = sheet(S, { a: 0.86, r: 0.93, m: 0 });
    for (let y = 0; y < U; y += 128) {
      const v = (rnd() - 0.5) * 0.08;
      draw(t, { a: v > 0 ? [1, v * 2] : [0, -v * 2] }, rect(0, y, U, 128));
      draw(t, { a: 'rgb(18,18,19)', r: 0.5, h: 0.62, o: 1 }, line(0, y, U, y, 5));                               // tar squeezed out of the lap
      draw(t, { h: 0.58 }, rect(0, y, U, 12));
      draw(t, { o: [0.5, 0.5] }, line(0, y + 14, U, y + 14, 5));
      const ex = rnd() * U;
      draw(t, { a: 'rgb(18,18,19)', r: 0.5, h: 0.6 }, line(ex, y, ex, y + 128, 4), ex, y + 64, 70);              // end of a roll
    }
    for (let i = 0; i < 1500; i++) { const x = rnd() * U, y = rnd() * U; draw(t, { a: [rnd() < 0.5 ? 1 : 0.3, 0.2 + rnd() * 0.25], h: 0.5 + (rnd() - 0.5) * 0.3 }, disc(x, y, 0.8 + rnd() * 1.3), x, y, 2); }   // granules
    for (let i = 0; i < 7; i++) { const x = rnd() * U, y = rnd() * U, r = 20 + rnd() * 46; draw(t, { a: 'rgba(12,12,13,.34)', r: [0.7, 0.5], h: [0.46, 0.5] }, flake(rnd, x, y, r, 0.4), x, y, r * 2); }           // granule loss: bare bitumen
    for (let i = 0; i < 4; i++) {                                   // repairs
      const x = rnd() * U, y = rnd() * U, w = 50 + rnd() * 60, h = 34 + rnd() * 40;
      draw(t, { o: [0.5, 0.5] }, c => { c.lineWidth = 8; c.strokeRect(x, y, w, h); }, x + w / 2, y + h / 2, w);
      draw(t, { a: grey(0.72 + rnd() * 0.2), h: 0.6, r: 0.88 }, rect(x, y, w, h), x + w / 2, y + h / 2, w);
      draw(t, { a: 'rgb(16,16,17)', r: 0.45, h: 0.66 }, c => { c.lineWidth = 3.5; c.strokeRect(x, y, w, h); }, x + w / 2, y + h / 2, w);
    }
    for (let i = 0; i < 6; i++) {                                   // ponding: a pale tide line round a darker floor
      const x = rnd() * U, y = rnd() * U, r = 22 + rnd() * 40;
      draw(t, { a: 'rgba(20,22,26,.22)', r: [0.8, 0.4] }, flake(rnd, x, y, r, 0.25), x, y, r * 2);
      draw(t, { a: [1, 0.24] }, c => { c.lineWidth = 2.4; c.beginPath(); c.ellipse(x, y, r, r * 0.8, 0, 0, 7); c.stroke(); }, x, y, r * 1.2);
    }
    for (let i = 0; i < 9; i++) { const x = rnd() * U, y = rnd() * U, r = 5 + rnd() * 9; draw(t, { h: [0.72, 0.6] }, disc(x, y, r), x, y, r); }
    return { t, bump: 1.4, mottle: [0.08, 8], grain: [0.05, 128], rn: [0.04, 32], hn: [0.03, 128] };
  },

  /** Sandbags: stacked, sagging, woven hessian with a sewn end; the bottom of each is damp and dirty. */
  sandbag(S, rnd) {
    const t = sheet(S, { a: 'rgb(26,24,21)', p: 0, r: 0.97, m: 0 });
    for (const l of ['h', 'o']) { t[l].fillStyle = grey(l === 'h' ? 0.2 : 0.3); t[l].fillRect(0, 0, U, U); }
    const BH = 64, BW = 128;
    for (let row = 0; row * BH < U; row++) for (let x = -BW; x < U; x += BW) {
      const X = x + (row % 2) * BW / 2, Y = row * BH, cx = X + BW / 2, cy = Y + BH / 2, v = 0.74 + rnd() * 0.22;
      draw(t, { a: grey(v), p: 1, o: 1, r: 0.95 }, rrect(X + 3, Y + 3, BW - 6, BH - 6, 18), cx, cy, BW);
      draw(t, { h: 0 }, c => { const g = c.createRadialGradient(cx, cy, 4, cx, cy, BW * 0.6); g.addColorStop(0, grey(0.86)); g.addColorStop(1, grey(0.3)); c.fillStyle = g; c.beginPath(); c.roundRect(X + 3, Y + 3, BW - 6, BH - 6, 18); c.fill(); }, cx, cy, BW);
      draw(t, { a: 'rgba(30,28,24,.3)', r: [0.99, 0.5] }, rrect(X + 6, Y + BH * 0.6, BW - 12, BH * 0.36, 12), cx, cy + 16, BW);            // the damp underside
      draw(t, { a: 'rgba(24,22,18,.6)', h: 0.4 }, c => { c.lineWidth = 1.6; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(X + 14, Y + 12); c.lineTo(X + 14, Y + BH - 12); c.stroke(); c.setLineDash([]); }, X + 14, cy, BH);   // the sewn end
    }
    for (let k = 0; k < U; k += 6) { draw(t, { a: 'rgba(20,18,14,.16)', h: [0.42, 0.4] }, line(0, k, U, k, 1.4)); draw(t, { a: 'rgba(20,18,14,.12)', h: [0.42, 0.4] }, line(k, 0, k, U, 1.4)); }   // the weave
    return { t, bump: 2.4, mottle: [0.06, 8], grain: [0.04, 128], rn: [0.03, 32], hn: [0.02, 128] };
  },

  /** Canvas: a coarse weave in folds, a double-stitched seam, brass eyelets, a sewn patch, faded where the sun reaches. */
  cloth(S, rnd) {
    const t = sheet(S, { a: 0.9, r: 0.96, m: 0 });
    const ctx = t.h, n = Math.round(U * t.k), img = ctx.getImageData(0, 0, n, n), d = img.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const X = x / t.k, Y = y / t.k, v = 128 + 50 * Math.sin((X / U) * Math.PI * 6 + Math.sin((Y / U) * Math.PI * 4) * 1.4), i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; }
    ctx.putImageData(img, 0, 0);
    for (let k = 0; k < U; k += 8) { draw(t, { a: 'rgba(20,22,20,.18)', h: [0.4, 0.3] }, line(0, k, U, k, 1.6)); draw(t, { a: 'rgba(20,22,20,.14)', h: [0.4, 0.3] }, line(k, 0, k, U, 1.6)); }
    for (const y of [0, 256]) {
      draw(t, { o: [0.6, 0.5], a: 'rgba(20,20,18,.3)' }, line(0, y, U, y, 10));
      for (const dy of [-5, 5]) draw(t, { a: 'rgba(236,230,214,.6)', h: 0.62 }, c => { c.lineWidth = 1.6; c.setLineDash([7, 5]); c.beginPath(); c.moveTo(0, y + dy); c.lineTo(U, y + dy); c.stroke(); c.setLineDash([]); });
      for (let x = 32; x < U; x += 128) { draw(t, { a: 'rgb(168,140,78)', p: 0, m: 1, r: 0.4, h: 0.78 }, disc(x, y + 20, 7), x, y + 20, 8); draw(t, { a: 'rgb(12,12,12)', p: 0, m: 0, h: 0.2, o: 0.2 }, disc(x, y + 20, 3.4), x, y + 20, 4); }
    }
    { const x = 300, y = 96, w = 90, h = 70;
      draw(t, { a: grey(0.78), h: [0.62, 0.7] }, rect(x, y, w, h), x + w / 2, y + h / 2, w);
      draw(t, { a: 'rgba(236,230,214,.6)' }, c => { c.lineWidth = 1.6; c.setLineDash([6, 5]); c.strokeRect(x + 5, y + 5, w - 10, h - 10); c.setLineDash([]); }, x + w / 2, y + h / 2, w); }
    for (let i = 0; i < 8; i++) { const x = rnd() * U, y = rnd() * U, r = 30 + rnd() * 60; draw(t, { a: [1, 0.08 + rnd() * 0.08] }, flake(rnd, x, y, r, 0.3), x, y, r * 2); }
    for (let i = 0; i < 10; i++) run(t, rnd() * U, rnd() * U, 8 + rnd() * 16, 50 + rnd() * 120, '26,26,22', 0.12, 0.98);
    return { t, bump: 1.6, mottle: [0.06, 4], grain: [0.04, 128], rn: [0.02, 32], hn: [0.02, 128] };
  },

  /**
   * Glazing: panes in a dark metal frame. The glass itself is clean and smooth in the middle of
   * each pane and dull where dirt has collected along the bottom bar and in the corners, so it
   * reflects in a controlled way instead of shining evenly like plastic.
   */
  glass(S, rnd) {
    const t = sheet(S, { a: 0.92, r: 0.07, m: 0 });
    const PW = 128, PH = 256;
    for (let y = 0; y < U; y += PH) for (let x = 0; x < U; x += PW) {
      const v = (rnd() - 0.5) * 0.1;
      draw(t, { a: v > 0 ? [1, v] : [0, -v] }, rect(x, y, PW, PH), x + PW / 2, y + PH / 2, PH);
      draw(t, { a: 0, r: 0 }, (c, l) => { const g = c.createLinearGradient(0, y + PH - 70, 0, y + PH); g.addColorStop(0, l === 'a' ? 'rgba(60,56,50,0)' : grey(0.42, 0)); g.addColorStop(1, l === 'a' ? 'rgba(60,56,50,.3)' : grey(0.42, 0.8)); c.fillStyle = g; c.fillRect(x, y + PH - 70, PW, 70); }, x + PW / 2, y + PH - 35, PW);
      for (let i = 0; i < 4; i++) { const sx = x + 10 + rnd() * (PW - 20); draw(t, { r: [0.3, 0.5], a: 'rgba(200,204,208,.08)' }, line(sx, y + 12, sx + (rnd() - 0.5) * 6, y + 60 + rnd() * 150, 1.6 + rnd() * 2), sx, y + 120, 140); }   // where rain ran
      for (const [cx, cy] of [[x + 8, y + 8], [x + PW - 8, y + 8]]) draw(t, { r: [0.4, 0.6], a: 'rgba(60,56,50,.22)' }, disc(cx, cy, 22), cx, cy, 24);
    }
    for (let x = 0; x < U; x += PW) { draw(t, { o: [0.5, 0.5] }, line(x, 0, x, U, 20)); draw(t, { a: 'rgb(30,32,36)', p: 0, m: 0.6, r: 0.46, h: 0.8, o: 1 }, line(x, 0, x, U, 9)); }
    for (let y = 0; y < U; y += PH) { draw(t, { o: [0.5, 0.5] }, line(0, y, U, y, 22)); draw(t, { a: 'rgb(30,32,36)', p: 0, m: 0.6, r: 0.46, h: 0.82, o: 1 }, line(0, y, U, y, 11)); }
    return { t, bump: 1.6, mottle: [0.03, 4], grain: [0.01, 64], rn: [0.05, 8], hn: [0, 64] };
  },

  /** Timber: sawn planks along u with open joints, grain, knots, nail heads at the butt joints, greyed by weather. */
  wood(S, rnd) {
    const t = sheet(S, { a: 0.9, r: 0.84, m: 0 });
    const PH = 64;
    for (let y = 0; y < U; y += PH) {
      const v = 0.78 + rnd() * 0.2, w = (rnd() - 0.5) * 0.05;
      draw(t, { a: `rgb(${Math.round((v + w) * 255)},${Math.round(v * 255)},${Math.round((v - w * 1.5) * 255)})`, h: 0.5 + (rnd() - 0.5) * 0.08 }, rect(0, y, U, PH));
      for (let i = 0; i < 22; i++) {                                // grain: long lines that wander a little
        let gx = rnd() * U; const gy = y + 5 + rnd() * (PH - 10), pts = [[gx, gy]], len = 80 + rnd() * 300;
        for (let k = 0; k < 8; k++) { gx += len / 8; pts.push([gx, gy + (rnd() - 0.5) * 4]); }
        draw(t, { a: [0.3, 0.14 + rnd() * 0.16], h: [0.42, 0.4] }, c => { c.lineWidth = 1 + rnd(); c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); }, gx - len / 2, gy, len);
      }
      if (rnd() < 0.7) { const kx = rnd() * U, ky = y + 16 + rnd() * (PH - 32), r = 5 + rnd() * 5; draw(t, { a: 'rgba(40,26,16,.7)', h: 0.44 }, c => { c.beginPath(); c.ellipse(kx, ky, r * 1.5, r, 0, 0, 7); c.fill(); }, kx, ky, r * 2); }
      const jx = rnd() * U;                                          // butt joint, two nails each side
      draw(t, { ...DIRT, o: 0.3, h: 0.2 }, line(jx, y + 3, jx, y + PH - 3, 3), jx, y + PH / 2, PH);
      for (const dx of [-10, 10]) for (const dy of [16, 48]) draw(t, { a: 'rgb(70,66,62)', p: 0, m: 0.8, r: 0.5, h: 0.6 }, disc(jx + dx, y + dy, 2.6), jx + dx, y + dy, 3);
      draw(t, { o: [0.4, 0.6] }, line(0, y, U, y, 10));
      draw(t, { ...DIRT, o: 0.2, h: 0.14 }, line(0, y, U, y, 4));
    }
    for (let i = 0; i < 12; i++) { const x = rnd() * U, y = rnd() * U, r = 24 + rnd() * 50; draw(t, { a: 'rgba(150,150,146,.26)', p: [0, 0.26], r: [0.95, 0.4] }, flake(rnd, x, y, r, 0.4), x, y, r * 2); }   // weathered silver-grey
    return { t, bump: 1.9, mottle: [0.06, 8], grain: [0.035, 128], rn: [0.05, 32], hn: [0.02, 128] };
  },

  // ---- the ground. The terrain is a painting: it says where the road is, where the slabs
  // join, where a puddle lies. These say what each kind of ground is made of, and are laid
  // over it in world space, so they hold still under the camera and never stretch. Albedo is a
  // grey tone that multiplies the painting; none of them has joints of its own except the
  // brick, whose bond is the point.

  /** Asphalt: stone chippings in bitumen, utility cuts patched darker, cracks sealed with tar, oil. */
  g_asphalt(S, rnd) {
    const t = sheet(S, { a: 0.8, r: 0.9, m: 0 });
    for (let i = 0; i < 5200; i++) {                                // the aggregate: pale and dark chippings proud of the binder
      const x = rnd() * U, y = rnd() * U, r = 0.8 + rnd() * rnd() * 2.6, up = rnd() < 0.55;
      draw(t, { a: [up ? 1 : 0, 0.14 + rnd() * 0.26], h: up ? 0.66 + rnd() * 0.14 : 0.32, r: [up ? 0.8 : 0.95, 0.5] }, disc(x, y, r), x, y, r + 1);
    }
    for (let i = 0; i < 2; i++) {                                   // a trench cut and reinstated: newer, darker, its edge sealed
      const x = rnd() * U, y = rnd() * U, w = 110 + rnd() * 90, h = 46 + rnd() * 30;
      draw(t, { a: [0, 0.22], r: [0.8, 0.5], h: [0.54, 0.5] }, rect(x, y, w, h), x + w / 2, y + h / 2, w);
      draw(t, { a: [0, 0.5], r: [0.34, 0.9], h: [0.6, 0.8] }, c => { c.lineWidth = 4; c.strokeRect(x, y, w, h); }, x + w / 2, y + h / 2, w);
    }
    for (let i = 0; i < 7; i++) { const x = rnd() * U, y = rnd() * U, r = 22 + rnd() * 48; draw(t, { a: [0, 0.2], r: [0.5, 0.6], h: [0.46, 0.4] }, flake(rnd, x, y, r, 0.35), x, y, r * 2); }   // bitumen bled to the surface: darker, smoother
    for (let i = 0; i < 9; i++) {                                   // cracks; the wide ones have been sealed with a band of tar
      let x = rnd() * U, y = rnd() * U; const pts = [[x, y]], sealed = i < 3;
      for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.5) * 70; pts.push([x, y]); }
      const path = c => { c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); };
      if (sealed) draw(t, { a: [0, 0.5], r: [0.3, 0.9], h: [0.62, 0.8] }, c => { c.lineWidth = 6; path(c); });
      else draw(t, { a: [0, 0.5], h: 0.2 }, c => { c.lineWidth = 1.5; path(c); });
    }
    for (let i = 0; i < 10; i++) { const x = rnd() * U, y = rnd() * U, r = 3 + rnd() * 8; draw(t, { a: [0, 0.4], r: [0.25, 0.9] }, flake(rnd, x, y, r, 0.3), x, y, r * 2); }             // oil
    return { t, bump: 2.0, mottle: [0.07, 6], grain: [0.06, 128], rn: [0.05, 32], hn: [0.05, 128] };
  },
  /** Stone flags and cast slabs: a fine open surface, mineral blotches, the odd spall; no joints (the painting has them). */
  g_stone(S, rnd) {
    const t = sheet(S, { a: 0.85, r: 0.86, m: 0 });
    for (let i = 0; i < 2600; i++) { const x = rnd() * U, y = rnd() * U, r = 0.6 + rnd() * 1.5; draw(t, { a: [0, 0.1 + rnd() * 0.2], h: 0.36 }, disc(x, y, r), x, y, r + 1); }        // pores
    for (let i = 0; i < 16; i++) { const x = rnd() * U, y = rnd() * U, r = 24 + rnd() * 60; draw(t, { a: [rnd() < 0.5 ? 0 : 1, 0.05 + rnd() * 0.06], r: [0.95, 0.3] }, flake(rnd, x, y, r, 0.4), x, y, r * 2); }
    for (let i = 0; i < 26; i++) { const x = rnd() * U, y = rnd() * U, r = 2.5 + rnd() * 6; draw(t, { a: [0, 0.3], h: 0.24, r: 0.96 }, flake(rnd, x, y, r), x, y, r * 2); }           // spalls
    for (let i = 0; i < 5; i++) { let x = rnd() * U, y = rnd() * U; const pts = [[x, y]]; for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; pts.push([x, y]); }
      draw(t, { a: [0, 0.35], h: 0.28 }, c => { c.lineWidth = 1.3; c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); }); }
    return { t, bump: 1.5, mottle: [0.09, 6], grain: [0.05, 128], rn: [0.06, 32], hn: [0.04, 128] };
  },
  /** Brick paving in basket weave: pairs of pavers turned alternately, sand in the joints, every paver its own tone. */
  g_brick(S, rnd) {
    const t = sheet(S, { a: 0.5, r: 0.97, m: 0 });
    t.h.fillStyle = grey(0.28); t.h.fillRect(0, 0, U, U);
    const B = 64, J = 3;
    for (let j = 0; j < U / B; j++) for (let i = 0; i < U / B; i++) for (let k = 0; k < 2; k++) {
      const flip = (i + j) % 2, x = i * B + (flip ? k * B / 2 : 0), y = j * B + (flip ? 0 : k * B / 2), w = flip ? B / 2 : B, h = flip ? B : B / 2;
      const v = 0.72 + rnd() * 0.3;
      draw(t, { a: grey(Math.min(1, v)), h: 0.54 + rnd() * 0.08, r: 0.84 + rnd() * 0.1 }, rrect(x + J / 2, y + J / 2, w - J, h - J, 2), x + w / 2, y + h / 2, B);
      if (rnd() < 0.22) { const cx = x + (rnd() < 0.5 ? J : w - J), cy = y + (rnd() < 0.5 ? J : h - J), r = 3 + rnd() * 4; draw(t, { a: [0.4, 0.8], h: 0.34 }, flake(rnd, cx, cy, r), cx, cy, r * 2); }
    }
    for (let i = 0; i < 10; i++) { const x = rnd() * U, y = rnd() * U, r = 20 + rnd() * 50; draw(t, { a: [0, 0.1], r: [0.98, 0.3] }, flake(rnd, x, y, r, 0.4), x, y, r * 2); }
    return { t, bump: 2.2, mottle: [0.06, 6], grain: [0.05, 128], rn: [0.04, 32], hn: [0.03, 128] };
  },
  /** Mown grass: blades in every direction a mower leaves them, tufts and thin patches, worn to earth in places. */
  g_grass(S, rnd) {
    const t = sheet(S, { a: 0.8, r: 1, m: 0 });
    for (let i = 0; i < 26; i++) { const x = rnd() * U, y = rnd() * U, r = 24 + rnd() * 60; draw(t, { a: [rnd() < 0.5 ? 0 : 1, 0.08 + rnd() * 0.1] }, flake(rnd, x, y, r, 0.45), x, y, r * 2); }
    for (let i = 0; i < 7000; i++) {
      const x = rnd() * U, y = rnd() * U, a = -1.57 + (rnd() - 0.5) * 1.5, l = 4 + rnd() * 8, up = rnd() < 0.5;
      draw(t, { a: [up ? 1 : 0, 0.16 + rnd() * 0.22], h: up ? 0.7 : 0.34 }, line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 1.3), x, y, l);
    }
    for (let i = 0; i < 5; i++) { const x = rnd() * U, y = rnd() * U, r = 10 + rnd() * 22; draw(t, { a: [0.42, 0.55], h: [0.3, 0.6] }, flake(rnd, x, y, r, 0.5), x, y, r * 2); }   // trodden bare
    return { t, bump: 1.8, mottle: [0.1, 6], grain: [0.06, 128], rn: [0, 32], hn: [0.05, 128] };
  },
};

// ---------------------------------------------------------------- from sheet to maps

const cache = new Map();

/**
 * The maps of one material at S x S (a power of two), as RGBA byte arrays with row 0 at the
 * TOP of the painting:
 *   albedo  rgb base colour (sRGB), a = paint
 *   orm     r = ambient occlusion, g = roughness, b = metalness, a = wear pattern
 *   normal  tangent-space normal
 */
export function surfaceTextures(name, S = 512) {
  const key = `${name}|${S}`;
  let out = cache.get(key);
  if (out) return out;
  if (!PAINTERS[name]) throw new Error(`no such surface texture: ${name}`);
  const seed = name.length * 7919 + name.charCodeAt(0) * 131 + name.charCodeAt(name.length - 1) * 17;
  const P = PAINTERS[name](S, seeded(seed));
  const get = l => P.t[l].getImageData(0, 0, S, S).data;
  const a = get('a'), p = get('p'), r = get('r'), m = get('m'), o = get('o'), h = get('h');
  const N = S * S, albedo = new Uint8ClampedArray(N * 4), orm = new Uint8ClampedArray(N * 4), normal = new Uint8ClampedArray(N * 4);
  const mot = fbm(S, P.mottle[1], seed + 1), gr = field(S, Math.min(S / 2, P.grain[1]), seed + 2), rn = fbm(S, P.rn[1], seed + 3), hn = field(S, Math.min(S / 2, P.hn[1]), seed + 4);
  const w1 = fbm(S, 8, seed + 5), w2 = field(S, Math.min(S / 2, 64), seed + 6);
  const H = new Float32Array(N);
  for (let i = 0, q = 0; i < N; i++, q += 4) {
    // Broad mottling and fine grain belong to the surface whatever is on it; both are a few per cent.
    const k = 1 + (mot[i] - 0.5) * 2 * P.mottle[0] + (gr[i] - 0.5) * 2 * P.grain[0];
    albedo[q] = a[q] * k; albedo[q + 1] = a[q + 1] * k; albedo[q + 2] = a[q + 2] * k; albedo[q + 3] = p[q];
    orm[q] = o[q];
    orm[q + 1] = r[q] + (rn[i] - 0.5) * 2 * P.rn[0] * 255;
    orm[q + 2] = m[q];
    // The chip pattern: broad patches broken into small flakes.
    orm[q + 3] = Math.max(0, Math.min(1, (w1[i] - 0.5) * 1.5 + (w2[i] - 0.5) * 1.1 + 0.5)) * 255;
    H[i] = h[q] / 255 + (hn[i] - 0.5) * 2 * P.hn[0];
  }
  const M = S - 1, st = P.bump * 4 * (S / 512);                    // the same slope whatever the resolution
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H[y * S + ((x + 1) & M)] - H[y * S + ((x - 1) & M)]) * st, dy = (H[((y + 1) & M) * S + x] - H[((y - 1) & M) * S + x]) * st;
    const l = Math.hypot(dx, dy, 1), q = (y * S + x) * 4;
    normal[q] = (-dx / l * 0.5 + 0.5) * 255; normal[q + 1] = (dy / l * 0.5 + 0.5) * 255; normal[q + 2] = (1 / l * 0.5 + 0.5) * 255; normal[q + 3] = 255;
  }
  for (const l of LAYERS) { P.t.cv[l].width = P.t.cv[l].height = 0; }   // give the working canvases back
  out = { S, albedo, orm, normal };
  cache.set(key, out);
  return out;
}

/** The names that can be asked for. */
export const TEXTURE_NAMES = Object.keys(PAINTERS);

/** One map of a material as a canvas (for the ground detail and for looking at a material). */
export function textureCanvas(name, map, S = 512) {
  const T = surfaceTextures(name, S), c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), src = T[map === 'paint' || map === 'wear' ? (map === 'paint' ? 'albedo' : 'orm') : map];
  for (let q = 0; q < src.length; q += 4) {
    if (map === 'paint' || map === 'wear') { img.data[q] = img.data[q + 1] = img.data[q + 2] = src[q + 3]; } else { img.data[q] = src[q]; img.data[q + 1] = src[q + 1]; img.data[q + 2] = src[q + 2]; }
    img.data[q + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * One kind of ground as a single RGBA texture, row 0 at the top: r = tone (multiplies the painted
 * terrain), g = roughness, b and a = the x and y of its normal.
 */
export function groundTexture(name, S = 256) {
  const T = surfaceTextures(name, S), out = new Uint8Array(S * S * 4);
  for (let q = 0; q < out.length; q += 4) { out[q] = T.albedo[q]; out[q + 1] = T.orm[q + 1]; out[q + 2] = T.normal[q]; out[q + 3] = T.normal[q + 1]; }
  return out;
}
