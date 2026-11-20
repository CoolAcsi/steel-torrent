// Static battlefield backdrop: a city in the rain (or, by `weather`, under snow, in the sun or at night).
//
// Pale wet paving laid on the isometric grid, asphalt streets with kerbs and
// lane markings where troops march, brick plazas around the bases, kerbed
// lawns with trees in the blocks between streets, puddles, and the warm pools
// of the street lamps. Painted once per layout, then blitted.
//
// Alongside the picture it paints a wetness map (how mirror-like each spot of
// ground is), which the WebGL renderer uses to draw reflections: puddles and
// asphalt reflect strongly, paving a little, grass not at all.
import { F, shade, renderModel } from './iso.js';
import { blockModel, lampModel, BLOCK_YAW, YARD } from './scenery.js';

const TAU = Math.PI * 2;

function hash(n) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return (n ^ (n >>> 15)) >>> 0;
}

function seeded(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => hash(Math.imul(a, 374761393) + Math.imul(b, 668265263) + seed) / 4294967296;
  const top = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
  const bot = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
  return top + (bot - top) * v;
}

/** Distance from point q to segment ab, measured on the ground (screen y un-foreshortened). */
function roadDist(q, a, b) {
  const ax = a.x, ay = a.y / F, bx = b.x, by = b.y / F, qx = q.x, qy = q.y / F;
  const ex = bx - ax, ey = by - ay;
  const t = Math.max(0, Math.min(1, ((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey || 1)));
  return Math.hypot(qx - ax - ex * t, qy - ay - ey * t);
}

// Palette, taken from the look of rain-soaked city stone under an overcast sky.
const PAVING = ['#76818c', '#808b96', '#8a95a0', '#97a2ad'];
const BRICK = ['#70443a', '#7a4b3f', '#844f42'];
const LAWN = ['#345a2e', '#3b6433', '#426d38'];
const ASPHALT = '#363d45';
const KERB = '#a3acb5';
const FOG = '168,182,196';

// What the sky does to the ground. 'rain' is the painting as it always was; the others repaint
// the same layout (same slabs, same lawns, same cracks: the seed decides those, not the weather).
//   wet       scales the wetness map (1 = soaked, 0 = dry)      puddles   standing water
//   joints    how clearly slab joints and road wear show        pools     strength of the lamp pools
//   cast      long hard shadows painted behind blocks and trees (the canvas renderer has no light of its own)
const SKY = {
  rain: { paving: PAVING, brick: BRICK, lawn: LAWN, asphalt: ASPHALT, kerb: KERB, kerbLow: '#c3ccd4', sidewalk: '#8b959f', gutter: '#4a525a',
    yard: '#6c737a', drive: '#3d444c', line: '30,38,48', shadow: '10,14,20', wet: 1, puddles: true, joints: 1, pools: 1, cast: false },
  // Snow lies on everything that is not driven on: white paving and lawns, trodden grey-white
  // sidewalks and yards, a ploughed dark carriageway with slush along its edges and centre.
  snow: { paving: ['#dfe6ee', '#e3e9f0', '#e7edf3', '#ebf0f5'], brick: ['#b9adab', '#bfb3b0', '#c5b9b5'], lawn: ['#e8eef4', '#ecf1f6', '#f0f4f8'],
    asphalt: '#565e67', kerb: '#eef2f6', kerbLow: '#fbfcfd', sidewalk: '#d0d8e0', gutter: '#a9b3be',
    yard: '#c3cbd3', drive: '#626a73', line: '70,90,118', shadow: '44,60,88', wet: 0.15, puddles: false, joints: 0.3, pools: 1.15, cast: false },
  // Sun: dry stone is paler and warmer than wet stone, grass is brighter, nothing shines.
  sun: { paving: ['#939490', '#9c9c97', '#a4a49e', '#acaba4'], brick: ['#8a5645', '#945c49', '#9e634e'], lawn: ['#487434', '#517e3b', '#5a8842'],
    asphalt: '#4d5053', kerb: '#bab8ae', kerbLow: '#d0cdc2', sidewalk: '#a5a49b', gutter: '#5c5e60',
    yard: '#86857d', drive: '#525456', line: '44,40,34', shadow: '16,20,34', wet: 0.3, puddles: false, joints: 1, pools: 0, cast: true },
  // Night: the rainy city with the light gone: what is left is what the lamps reach.
  night: { paving: PAVING, brick: BRICK, lawn: LAWN, asphalt: ASPHALT, kerb: KERB, kerbLow: '#c3ccd4', sidewalk: '#8b959f', gutter: '#4a525a',
    yard: '#6c737a', drive: '#3d444c', line: '30,38,48', shadow: '10,14,20', wet: 1, puddles: true, joints: 1, pools: 1, cast: false },
};

/**
 * @param c   canvas to paint (already sized in device pixels)
 * @param v   { k, ox, oy, nodes: [{x,y}], roads: [[a,b]], R, seed, scenery: { blocks, lamps }, bake }
 *            k = device px per view unit. With `bake`, the 3D scenery is painted into the picture
 *            (canvas renderer); otherwise the WebGL renderer draws it as real geometry.
 * @param wet optional canvas of the same size: receives the wetness map (white = mirror, black = dry)
 * @param v.props3d  leave out what the 3D renderer does for real: painted trees, haze and vignette
 * @param v.weather  'rain' (default: the painting as it always was), 'snow', 'sun' or 'night'. Same
 *            layout for a given seed whatever the weather. Night darkens the painting only for the
 *            canvas renderer (`bake`); in 3D the light does that. Alongside the wetness map goes
 *            `wet.lamps`, a small canvas of where lamp light falls, which the 3D renderer lights at night.
 * @returns { trees: [{ x, y, s, kind }] }  where the trees are (kind 0 conifer, 1 broadleaf)
 */
export function buildTerrain(c, v, wet) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const { k, ox, oy, nodes, R, seed } = v;
  const roads = v.roads;
  const scenery = v.scenery || { blocks: [], lamps: [] };
  const weather = SKY[v.weather] ? v.weather : 'rain';
  const S = SKY[weather], snow = weather === 'snow', sun = weather === 'sun', night = weather === 'night';
  const ink = (a, c = S.line) => `rgba(${c},${+(a * S.joints).toFixed(3)})`;      // joints, cracks and wear, fainter under snow
  const rnd = seeded(seed);
  let w = null, mt = null;
  if (wet) {
    wet.width = W; wet.height = H;
    w = wet.getContext('2d');
    // What the ground is made of, for the 3D renderer to give each its own surface: red where
    // it is asphalt, green where it is grass, blue where it is brick; black is stone (flags,
    // slabs, the concrete of a yard). Half resolution: edges between materials are soft anyway.
    const m = wet.mat || (wet.mat = document.createElement('canvas'));
    m.width = Math.ceil(W / 2); m.height = Math.ceil(H / 2);
    mt = m.getContext('2d');
    mt.fillStyle = '#000'; mt.fillRect(0, 0, m.width, m.height);
    mt.setTransform(k / 2, 0, 0, k / 2, ox / 2, oy / 2);
    mt.lineJoin = 'round'; mt.lineCap = 'round';
  }
  const gray = lv => { const n = Math.round(Math.max(0, Math.min(1, lv)) * 255); return `rgb(${n},${n},${n})`; };
  /** Run the same drawing on the picture and on the wetness map. */
  const both = (fill, level, path) => {
    g.fillStyle = fill; g.beginPath(); path(g); g.fill();
    if (w) { w.fillStyle = gray(level * S.wet); w.beginPath(); path(w); w.fill(); }
  };

  for (const ctx of w ? [g, w] : [g]) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = ctx === g ? S.paving[1] : gray(0.4 * S.wet);
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, k, ox, oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  // Visible part of the world.
  const x0 = -ox / k, y0 = -oy / k, x1 = (W - ox) / k, y1 = (H - oy) / k;
  const area = (x1 - x0) * (y1 - y0);

  // --- paving slabs on the isometric grid; each is paving, brick plaza or lawn
  const TW = 40, TH = TW * F;
  const key = (i, j) => (i + 512) * 2048 + (j + 512);
  const centre = (i, j) => ({ x: (i - j) * TW / 2, y: (i + j) * TH / 2 });
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const i = x / TW + y / TH, j = y / TH - x / TW;
    i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
  }
  i0 = Math.floor(i0) - 1; i1 = Math.ceil(i1) + 1; j0 = Math.floor(j0) - 1; j1 = Math.ceil(j1) + 1;

  const cityDist = q => { let d = Infinity; for (const p of nodes) d = Math.min(d, Math.hypot(p.x - q.x, (p.y - q.y) / F)); return d; };
  const roadGap = q => { let d = Infinity; for (const [a, b] of roads) d = Math.min(d, roadDist(q, nodes[a], nodes[b])); return d; };
  const onPlot = q => scenery.blocks.some(b => Math.abs(b.x - q.x) < b.a * 0.9 + 6 && Math.abs(b.y - q.y) < (b.a * 0.9 + 6) * F);

  const kind = new Map();          // 1 lawn, 2 brick
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const q = centre(i, j);
      const dc = cityDist(q), dr = roadGap(q);
      // Lawns come in whole blocks of 3x3 slabs, like the planted squares between city streets.
      const bi = Math.floor(i / 3), bj = Math.floor(j / 3);
      const bq = centre(bi * 3 + 1, bj * 3 + 1);
      const green = hash(Math.imul(bi, 73856093) ^ Math.imul(bj, 19349663) ^ seed) / 4294967296 < 0.36
        && vnoise(bq.x * 0.006, bq.y * 0.011, seed + 3) > 0.45;
      if (green && dr > 34 && dc > R + 58 && !onPlot(q)) kind.set(key(i, j), 1);
      else if (dc < R + 50 && dr > 15) kind.set(key(i, j), 2);
    }
  }

  const diamond = (ctx, q, grow = 0) => {
    ctx.moveTo(q.x, q.y - TH / 2 - grow * F); ctx.lineTo(q.x + TW / 2 + grow, q.y);
    ctx.lineTo(q.x, q.y + TH / 2 + grow * F); ctx.lineTo(q.x - TW / 2 - grow, q.y);
    ctx.closePath();
  };
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const q = centre(i, j);
      if (q.x < x0 - TW || q.x > x1 + TW || q.y < y0 - TH || q.y > y1 + TH) continue;
      const kd = kind.get(key(i, j)) || 0;
      const r = hash(Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ seed) / 4294967296;
      const damp = vnoise(q.x * 0.012, q.y * 0.02, seed + 21);          // broad wet and drier patches
      let col, level;
      if (kd === 1) { col = shade(S.lawn[Math.floor(r * 3)], snow ? 0.96 + damp * 0.05 : 0.94 + r * 0.1); level = 0; }
      else if (kd === 2) { col = shade(S.brick[Math.floor(r * 3)], 0.9 + damp * 0.16); level = 0.2 + damp * 0.22; }
      // Paving is laid by district, as a city's is: large cast panels in one block, ordinary
      // slabs in the next, small setts in a third, each a slightly different stone.
      const di = Math.floor(i / 6), dj = Math.floor(j / 6);
      const dh = hash(Math.imul(di, 83492791) ^ Math.imul(dj, 2971215073) ^ seed);
      const style = kd ? 0 : dh % 3, tint = 0.94 + ((dh >>> 8) % 100) / 100 * 0.1;
      if (kd === 0) {
        const big = style === 1 ? hash(Math.imul(i >> 1, 73856093) ^ Math.imul(j >> 1, 19349663) ^ seed) / 4294967296 : r;
        // under snow the slabs barely differ: what shows is the drift, in broad soft patches
        col = snow ? shade(S.paving[Math.floor(damp * 3.99)], 0.95 + damp * 0.04 + big * 0.02) : shade(S.paving[Math.floor(damp * 3.99)], (0.93 + big * 0.1) * tint);
        level = 0.2 + damp * 0.36;
      }
      both(col, level, ctx => diamond(ctx, q, 0.4));
      if (mt && kd) { mt.fillStyle = kd === 1 ? '#0f0' : '#00f'; mt.beginPath(); diamond(mt, q, 0.4); mt.fill(); }
      if (kd === 1) continue;
      // Joints: a dark line where slabs meet, a faint wet glint on the upper edges.
      g.lineWidth = style === 1 ? 0.8 : 0.55;
      g.strokeStyle = kd === 2 ? ink(0.42, snow ? S.line : '40,20,16') : ink(0.4);
      g.beginPath();
      if (style !== 1 || (i & 1)) { g.moveTo(q.x, q.y + TH / 2); g.lineTo(q.x + TW / 2, q.y); }
      if (style !== 1 || (j & 1)) { g.moveTo(q.x, q.y + TH / 2); g.lineTo(q.x - TW / 2, q.y); }
      g.stroke();
      if (style === 2) {                                                // setts: each slab quartered, finer joints
        g.lineWidth = 0.35;
        g.strokeStyle = ink(0.3);
        g.beginPath();
        g.moveTo(q.x - TW / 4, q.y - TH / 4); g.lineTo(q.x + TW / 4, q.y + TH / 4);
        g.moveTo(q.x + TW / 4, q.y - TH / 4); g.lineTo(q.x - TW / 4, q.y + TH / 4);
        g.stroke();
      }
      if (kd === 0 && r < 0.07) {                                       // a cracked or patched slab now and then
        g.strokeStyle = ink(0.45, snow ? S.line : '24,30,38'); g.lineWidth = 0.5;
        g.beginPath(); g.moveTo(q.x - TW * 0.3, q.y - TH * 0.1); g.lineTo(q.x - TW * 0.05, q.y + TH * 0.05); g.lineTo(q.x + TW * 0.1, q.y - TH * 0.08); g.lineTo(q.x + TW * 0.32, q.y + TH * 0.12); g.stroke();
      } else if (kd === 0 && r > 0.955) {                               // drain cover
        g.fillStyle = 'rgba(22,26,32,.7)'; g.beginPath(); g.ellipse(q.x, q.y, 4.2, 4.2 * F, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(150,160,170,.5)'; g.lineWidth = 0.6; g.beginPath(); g.ellipse(q.x, q.y, 4.2, 4.2 * F, 0, 0, TAU); g.stroke();
        g.beginPath(); for (let k = -2; k <= 2; k++) { g.moveTo(q.x - 3, q.y + k * 0.9); g.lineTo(q.x + 3, q.y + k * 0.9); } g.stroke();
      }
      g.lineWidth = 0.55;
      g.strokeStyle = sun ? 'rgba(255,246,226,.07)' : 'rgba(220,232,244,.10)';   // a wet glint; in the sun only a worn edge
      g.beginPath(); g.moveTo(q.x - TW / 2 + 1, q.y + 0.6); g.lineTo(q.x, q.y - TH / 2 + 0.9); g.stroke();
      if (kd === 2) {                                                   // brick courses inside the slab
        g.strokeStyle = snow ? 'rgba(96,60,52,.22)' : 'rgba(38,18,14,.3)';
        g.lineWidth = 0.4;
        g.beginPath();
        for (let s = 1; s < 4; s++) {
          const f = s / 4;
          g.moveTo(q.x - TW / 2 * (1 - f), q.y - TH / 2 * f); g.lineTo(q.x + TW / 2 * f, q.y + TH / 2 * (1 - f));
        }
        g.stroke();
      }
    }
  }

  // --- lawn texture and kerbs: pale stone on every edge where grass meets paving
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      if (kind.get(key(i, j)) !== 1) continue;
      const q = centre(i, j);
      if (q.x < x0 - TW || q.x > x1 + TW || q.y < y0 - TH || q.y > y1 + TH) continue;
      for (let n = 0; n < 7; n++) {
        const a = rnd(), b = rnd();
        const px = q.x + (a - b) * TW / 2 * 0.9, py = q.y + (a + b - 1) * TH / 2 * 0.9;
        const tuft = rnd() < 0.5;
        g.fillStyle = snow ? (tuft ? 'rgba(74,96,70,.3)' : 'rgba(150,170,196,.2)') : tuft ? 'rgba(18,40,16,.3)' : sun ? 'rgba(170,200,96,.24)' : 'rgba(126,170,88,.2)';   // under snow: a blade showing through, a hollow
        g.fillRect(px, py, 1.6 + rnd() * 1.6, 0.9);
      }
      const edges = [
        [i - 1, j, [q.x - TW / 2, q.y], [q.x, q.y - TH / 2], true],    // upper left
        [i, j - 1, [q.x, q.y - TH / 2], [q.x + TW / 2, q.y], true],    // upper right
        [i + 1, j, [q.x + TW / 2, q.y], [q.x, q.y + TH / 2], false],   // lower right
        [i, j + 1, [q.x, q.y + TH / 2], [q.x - TW / 2, q.y], false],   // lower left
      ];
      for (const [ni, nj, a, b, upper] of edges) {
        if (kind.get(key(ni, nj)) === 1) continue;
        g.strokeStyle = snow ? `rgba(${S.shadow},.24)` : 'rgba(20,26,32,.45)';
        g.lineWidth = 3.2;
        g.beginPath(); g.moveTo(a[0], a[1] + 0.9); g.lineTo(b[0], b[1] + 0.9); g.stroke();
        g.strokeStyle = upper ? S.kerb : S.kerbLow;
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        if (w) { w.strokeStyle = gray(0.1 * S.wet); w.lineWidth = 3; w.beginPath(); w.moveTo(a[0], a[1]); w.lineTo(b[0], b[1]); w.stroke(); }
      }
    }
  }

  // --- streets: the links troops can travel along. Sidewalk, kerb, gutter, carriageway.
  const strokeRoads = (ctx, style, width, dash, offset) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    for (const [i, j] of roads) {
      const a = nodes[i], b = nodes[j];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const px = (-(b.y - a.y) / l) * (offset || 0), py = ((b.x - a.x) / l) * (offset || 0) * F;
      ctx.beginPath(); ctx.moveTo(a.x + px, a.y + py); ctx.lineTo(b.x + px, b.y + py); ctx.stroke();
    }
    ctx.setLineDash([]);
  };
  strokeRoads(g, snow ? `rgba(${S.shadow},.22)` : 'rgba(14,18,24,.4)', 45);   // the sidewalk's own shadow line
  strokeRoads(g, S.sidewalk, 43);                         // sidewalk (under snow: trodden)
  strokeRoads(g, snow ? `rgba(${S.shadow},.3)` : 'rgba(18,22,28,.5)', 31.5);  // drop of the kerb
  strokeRoads(g, S.kerb, 30);                             // kerbstones (under snow: the bank the plough left)
  strokeRoads(g, S.gutter, 27);                           // gutter (slush)
  strokeRoads(g, S.asphalt, 24.5);                        // carriageway
  if (mt) { strokeRoads(mt, '#000', 43); strokeRoads(mt, '#f00', 24.5); }      // sidewalk flags, then the carriageway
  if (w) {
    strokeRoads(w, gray(0.3 * S.wet), 43);
    strokeRoads(w, gray(snow ? 0.27 : 0.5 * S.wet), 24.5);                    // a ploughed road is wet, though not a mirror
  }
  // Everything that makes it a used road rather than a grey band: flag joints across the
  // sidewalks, aggregate, wheel-polished lanes, repairs, cracks, manholes, worn paint.
  for (const [i, j] of roads) {
    const a = nodes[i], b = nodes[j];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const at = (d, off) => [a.x + ux * d - uy * off, a.y + uy * d + ux * off * F];
    g.strokeStyle = ink(0.34); g.lineWidth = 0.5;
    g.beginPath();
    for (let d = 4; d < l; d += 7.5) for (const side of [-1, 1]) { const p = at(d, side * 15.4), q = at(d, side * 21.2); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); }
    g.stroke();
    for (const off of [-5.6, 5.6]) {                       // lanes polished by traffic
      const p = at(0, off), q = at(l, off);
      g.strokeStyle = snow ? 'rgba(22,26,32,.3)' : sun ? 'rgba(150,150,146,.1)' : 'rgba(120,134,150,.09)'; g.lineWidth = 4.4;   // under snow: dark wheel tracks
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
    }
    for (let n = Math.round(l * 1.5); n > 0; n--) {        // aggregate
      const p = at(rnd() * l, (rnd() - 0.5) * 23);
      g.fillStyle = rnd() < 0.5 ? (snow ? 'rgba(226,232,240,.3)' : 'rgba(170,180,190,.16)') : 'rgba(8,10,14,.2)';
      g.fillRect(p[0], p[1], 0.7 + rnd() * 0.9, 0.5 + rnd() * 0.5);
    }
    for (let n = Math.round(l / 90); n > 0; n--) {         // patch repairs: darker, newer tar
      const d = 30 + rnd() * (l - 60), off = (rnd() - 0.5) * 12, hl = 5 + rnd() * 9, hw = 2.5 + rnd() * 3;
      const c = [at(d - hl, off - hw), at(d + hl, off - hw), at(d + hl, off + hw), at(d - hl, off + hw)];
      g.fillStyle = rnd() < 0.6 ? 'rgba(14,16,20,.3)' : 'rgba(96,104,114,.16)';
      g.beginPath(); c.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(8,10,14,.42)'; g.lineWidth = 0.45;
    for (let n = Math.round(l / 60); n > 0; n--) {         // cracks
      let d = 20 + rnd() * (l - 40), off = (rnd() - 0.5) * 18;
      g.beginPath(); g.moveTo(...at(d, off));
      for (let k = 0; k < 5; k++) { d += 2 + rnd() * 5; off += (rnd() - 0.5) * 6; g.lineTo(...at(d, off)); }
      g.stroke();
    }
    if (l > 150) {                                         // a manhole
      const p = at(l * (0.35 + rnd() * 0.3), (rnd() < 0.5 ? -1 : 1) * 5.6);
      g.fillStyle = 'rgba(20,24,28,.75)'; g.beginPath(); g.ellipse(p[0], p[1], 3.4, 3.4 * F, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(128,138,148,.5)'; g.lineWidth = 0.6; g.beginPath(); g.ellipse(p[0], p[1], 3.4, 3.4 * F, 0, 0, TAU); g.stroke();
    }
  }
  if (snow) {                                             // slush thrown to the centre and the edges hides the paint
    strokeRoads(g, 'rgba(214,222,232,.5)', 2.1, [26, 3]);
    strokeRoads(g, 'rgba(222,229,238,.62)', 2.6, null, 11.2);
    strokeRoads(g, 'rgba(222,229,238,.62)', 2.6, null, -11.2);
  } else {
    strokeRoads(g, 'rgba(226,232,238,.42)', 1.1, [9, 11]);  // centre line, worn
    strokeRoads(g, 'rgba(226,232,238,.2)', 0.8, [34, 5], 10.8);
    strokeRoads(g, 'rgba(226,232,238,.2)', 0.8, [34, 5], -10.8);
  }

  // --- compounds: every base stands in a square yard turned to the paving grid (a diamond
  //     on screen). Concrete laid in bays, a driveway in from each road with a painted
  //     threshold where the gate is, and the soft shadow of the wall around it.
  const YA = YARD * Math.SQRT2, YB = YA * F;
  const yardPath = (ctx, p, grow = 0) => {
    ctx.moveTo(p.x, p.y - YB - grow * F); ctx.lineTo(p.x + YA + grow, p.y); ctx.lineTo(p.x, p.y + YB + grow * F); ctx.lineTo(p.x - YA - grow, p.y); ctx.closePath();
  };
  /** Where the road from city p toward q crosses the edge of p's yard, and its direction. */
  const gateOf = (p, q) => {
    const dx = q.x - p.x, dy = q.y - p.y, t = 1 / (Math.abs(dx) / YA + Math.abs(dy) / YB), l = Math.hypot(dx, dy) || 1;
    return { x: p.x + dx * t, y: p.y + dy * t, ux: dx / l, uy: dy / l };
  };
  nodes.forEach((p, ci) => {
    both(`rgba(${S.shadow},${snow ? 0.2 : 0.3})`, 0.4, ctx => yardPath(ctx, p, 5));
    both(S.yard, 0.42, ctx => yardPath(ctx, p, 0));
    if (mt) { mt.fillStyle = '#000'; mt.beginPath(); yardPath(mt, p, 0); mt.fill(); }
    g.save();
    g.beginPath(); yardPath(g, p, 0); g.clip();
    // bays
    g.strokeStyle = ink(0.42, snow ? S.line : '26,32,40'); g.lineWidth = 0.6;
    g.beginPath();
    const T = [p.x, p.y - YB], Rr = [p.x + YA, p.y], B = [p.x, p.y + YB], L = [p.x - YA, p.y];
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      g.moveTo(...lerp(L, B, t)); g.lineTo(...lerp(T, Rr, t));
      g.moveTo(...lerp(L, T, t)); g.lineTo(...lerp(B, Rr, t));
    }
    g.stroke();
    // stains: oil where vehicles stand, damp along the walls
    for (let n = 0; n < 9; n++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * YA * 0.8;
      g.fillStyle = `rgba(${snow ? '70,84,104' : '14,16,20'},${(0.08 + rnd() * 0.12).toFixed(2)})`;
      g.beginPath(); g.ellipse(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * F, 3 + rnd() * 8, 1.6 + rnd() * 3.6, rnd() * 3, 0, TAU); g.fill();
    }
    g.strokeStyle = snow ? `rgba(${S.shadow},.2)` : 'rgba(8,12,18,.3)'; g.lineWidth = 9;
    g.beginPath(); yardPath(g, p, 0); g.stroke();
    // driveways and gate thresholds
    for (const [a, b] of roads) {
      if (a !== ci && b !== ci) continue;
      const q = nodes[a === ci ? b : a], gt = gateOf(p, q);
      g.strokeStyle = S.drive; g.lineWidth = 23;
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(gt.x + gt.ux * 6, gt.y + gt.uy * 6); g.stroke();
      if (mt) { mt.strokeStyle = '#f00'; mt.lineWidth = 23; mt.beginPath(); mt.moveTo(p.x, p.y); mt.lineTo(gt.x + gt.ux * 6, gt.y + gt.uy * 6); mt.stroke(); }
      g.strokeStyle = 'rgba(226,232,238,.3)'; g.lineWidth = 0.8;
      for (const off of [-10.4, 10.4]) { g.beginPath(); g.moveTo(p.x - gt.uy * off, p.y + gt.ux * off * F); g.lineTo(gt.x - gt.uy * off, gt.y + gt.ux * off * F); g.stroke(); }
      // hazard band across the gate
      g.lineWidth = 3.4;
      for (let k = -4; k < 4; k++) {
        g.strokeStyle = k & 1 ? 'rgba(20,22,24,.8)' : 'rgba(228,182,52,.78)';
        const x0h = gt.x - gt.ux * 5 - gt.uy * k * 2.9, y0h = gt.y - gt.uy * 5 + gt.ux * k * 2.9 * F;
        g.beginPath(); g.moveTo(x0h, y0h); g.lineTo(x0h - gt.uy * 2.9, y0h + gt.ux * 2.9 * F); g.stroke();
      }
    }
    g.restore();
    if (w) {
      w.save(); w.beginPath(); yardPath(w, p, 0); w.clip();
      w.strokeStyle = gray(snow ? 0.27 : 0.55 * S.wet); w.lineWidth = 23;
      for (const [a, b] of roads) { if (a !== ci && b !== ci) continue; const q = nodes[a === ci ? b : a]; w.beginPath(); w.moveTo(p.x, p.y); w.lineTo(q.x, q.y); w.stroke(); }
      w.restore();
    }
    // pedestrian crossing on each road just outside the gate
    for (const [a, b] of roads) {
      if (a !== ci && b !== ci) continue;
      const q = nodes[a === ci ? b : a], gt = gateOf(p, q);
      g.strokeStyle = snow ? 'rgba(226,232,238,.24)' : 'rgba(226,232,238,.5)'; g.lineWidth = 1.9;
      for (let k = -4; k <= 4; k++) {
        const cx = gt.x + gt.ux * 9 - gt.uy * k * 2.6, cy = gt.y + gt.uy * 9 + gt.ux * k * 2.6 * F;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + gt.ux * 7, cy + gt.uy * 7); g.stroke();
      }
    }
  });

  // --- standing water. Not ovals: a noise field decides where the ground is low, and the
  //     gutters and the foot of every kerb collect more, so puddles follow the streets.
  //     They darken the surface without hiding its texture; how mirror-like each spot is
  //     goes into the wetness map.
  {
    const Q = 3, PW = Math.ceil(W / Q), PH = Math.ceil(H / Q);
    const rc = document.createElement('canvas');
    rc.width = PW; rc.height = PH;
    const r2 = rc.getContext('2d');
    r2.fillStyle = '#000'; r2.fillRect(0, 0, PW, PH);
    r2.setTransform(k / Q, 0, 0, k / Q, ox / Q, oy / Q);
    r2.lineCap = 'round';
    try { r2.filter = 'blur(1.5px)'; } catch { /* unsupported: sharper gutters */ }
    strokeRoads(r2, '#fff', 27.5);
    strokeRoads(r2, '#000', 19);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {         // no puddles on grass
      if (kind.get(key(i, j)) !== 1) continue;
      r2.fillStyle = '#000'; r2.beginPath(); diamond(r2, centre(i, j), 1.5); r2.fill();
    }
    const gut = r2.getImageData(0, 0, PW, PH).data;
    const dark = new ImageData(PW, PH), shine = new ImageData(PW, PH);
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        const vx = (x * Q - ox) / k, vy = (y * Q - oy) / k, o = (y * PW + x) * 4;
        const n = vnoise(vx * 0.04, vy * 0.072, seed + 77) * 0.44 + vnoise(vx * 0.1, vy * 0.18, seed + 78) * 0.34 + vnoise(vx * 0.27, vy * 0.46, seed + 79) * 0.22;
        const v = n * 0.8 + (gut[o] / 255) * 0.34;
        const a = Math.max(0, Math.min(1, (v - 0.63) / 0.03)), deep = Math.max(0, Math.min(1, (v - 0.65) / 0.08));
        dark.data[o] = 26; dark.data[o + 1] = 34; dark.data[o + 2] = 46; dark.data[o + 3] = a * (16 + deep * 20);
        shine.data[o] = shine.data[o + 1] = shine.data[o + 2] = 255; shine.data[o + 3] = a * (120 + deep * 125);
      }
    }
    const put = (ctx, img) => {
      const c2 = document.createElement('canvas');
      c2.width = PW; c2.height = PH;
      c2.getContext('2d').putImageData(img, 0, 0);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(c2, 0, 0, PW * Q, PH * Q); ctx.restore();
    };
    if (S.puddles) {
      put(g, dark);
      if (w) put(w, shine);
    }
  }

  // --- sun: long, hard shadows thrown up and to the right, as the 3D renderer's key light throws
  //     them. Only where the scenery is painted in; in 3D the shadows are real.
  const CAST = [1.15, -0.36];                              // ground shadow of a point, per unit of its height
  if (S.cast && v.bake) {
    g.fillStyle = `rgba(${S.shadow},.3)`;
    for (const b of scenery.blocks) {
      const hw = b.a * Math.SQRT1_2, hh = hw * F, sx = (b.h || 40) * CAST[0], sy = (b.h || 40) * CAST[1];
      g.beginPath();
      g.moveTo(b.x, b.y - hh); g.lineTo(b.x + sx, b.y - hh + sy); g.lineTo(b.x + hw + sx, b.y + sy);
      g.lineTo(b.x + sx, b.y + hh + sy); g.lineTo(b.x, b.y + hh); g.lineTo(b.x - hw, b.y);
      g.closePath(); g.fill();
    }
  }

  // --- trees: rows on the lawns, like planted city squares
  const trees = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      if (kind.get(key(i, j)) !== 1) continue;
      const q = centre(i, j);
      const r = hash(Math.imul(i, 2654435761) ^ Math.imul(j, 40503) ^ seed) / 4294967296;
      if (r > 0.34 || q.x < x0 - 20 || q.x > x1 + 20 || q.y < y0 - 10 || q.y > y1 + 30) continue;
      if (roadGap(q) < 46) continue;                       // crowns must not lean over a street
      trees.push({ x: q.x, y: q.y, r: r / 0.34, s: 0.85 + (r * 7 % 1) * 0.4 });
    }
  }
  trees.sort((a, b) => a.y - b.y);
  for (const q of v.props3d ? [] : trees) {              // the 3D renderer plants real trees instead
    const { x, y, s } = q;
    if (w) { w.fillStyle = gray(0); w.beginPath(); w.ellipse(x + 4 * s, y + 1.5 * s, 10 * s, 4.4 * s, 0, 0, TAU); w.fill(); }
    const lit = snow ? ['#22382b', '#dfe7ef', '#f4f7fa'] : sun ? ['#1f3d22', '#3a6a36', '#5e8c44'] : null;   // crown colours under this sky
    if (S.cast) {                                         // one long shadow instead of the soft patch underfoot
      g.fillStyle = `rgba(${S.shadow},.34)`;
      g.beginPath(); g.ellipse(x + 11 * s, y - 2.6 * s, 14 * s, 3.4 * s, -0.3, 0, TAU); g.fill();
    }
    if (q.r < 0.5) {                                      // conifer
      g.fillStyle = S.cast ? 'rgba(0,0,0,0)' : snow ? `rgba(${S.shadow},.26)` : 'rgba(6,12,10,.34)';
      g.beginPath(); g.ellipse(x + 5 * s, y + 2 * s, 8 * s, 3.4 * s, 0, 0, TAU); g.fill();
      g.fillStyle = '#2c2218';
      g.fillRect(x - 1 * s, y - 4 * s, 2 * s, 5 * s);
      for (let t = 0; t < 3; t++) {
        const tw = (8 - t * 2) * s, by = y - (3 + t * 6) * s;
        g.fillStyle = sun ? lit[0] : '#17301f';
        g.beginPath(); g.moveTo(x - tw, by); g.lineTo(x, by - 10 * s); g.lineTo(x + tw, by); g.closePath(); g.fill();
        g.fillStyle = sun ? lit[1] : '#2a4e33';
        g.beginPath(); g.moveTo(x - tw, by); g.lineTo(x, by - 10 * s); g.lineTo(x - tw * 0.15, by); g.closePath(); g.fill();
        if (snow) {                                       // snow on the upper side of each tier
          g.fillStyle = lit[2];
          g.beginPath(); g.moveTo(x - tw * 0.86, by - 1.2 * s); g.lineTo(x, by - 10 * s); g.lineTo(x + tw * 0.5, by - 4.6 * s); g.lineTo(x - tw * 0.1, by - 3.4 * s); g.closePath(); g.fill();
        }
      }
    } else {                                              // broadleaf
      g.fillStyle = S.cast ? 'rgba(0,0,0,0)' : snow ? `rgba(${S.shadow},.26)` : 'rgba(6,12,10,.34)';
      g.beginPath(); g.ellipse(x + 6 * s, y + 2 * s, 10 * s, 4.2 * s, 0, 0, TAU); g.fill();
      g.fillStyle = '#2c2218';
      g.fillRect(x - 1.2 * s, y - 5 * s, 2.4 * s, 6 * s);
      g.fillStyle = lit ? lit[0] : '#1c3421';
      g.beginPath(); g.arc(x, y - 10 * s, 8.5 * s, 0, TAU); g.fill();
      g.fillStyle = lit ? lit[1] : '#2b4a2e';
      g.beginPath(); g.arc(x - 2 * s, y - 12 * s, 6.4 * s, 0, TAU); g.fill();
      g.fillStyle = lit ? lit[2] : '#44663a';
      g.beginPath(); g.arc(x - 3.4 * s, y - 14 * s, 3.6 * s, 0, TAU); g.fill();
    }
  }

  // --- scenery footprints, and the scenery itself where there is no 3D renderer to draw it
  for (const b of scenery.blocks) {
    const hw = (b.a + 4) * Math.SQRT1_2;
    if (!b.prop) { both(`rgba(${S.shadow},${snow ? 0.26 : 0.42})`, 0.3, ctx => ctx.ellipse(b.x + 5, b.y + 4, hw * 1.25, hw * 1.25 * F, 0, 0, TAU)); continue; }
    // A plot that is not a tower (props.js) stands on ground of its own: the asphalt of a car
    // park or a forecourt, the concrete of a works yard, a garden; a square turned to the
    // paving like the plot itself. (lx, ly) on the plot's own axes is here on the picture:
    const at = (lx, ly) => [b.x + (lx - ly) * Math.SQRT1_2, b.y + (lx + ly) * Math.SQRT1_2 * F];
    const quad = (ctx, x0, y0, x1, y1) => { [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([lx, ly], i) => { const p = at(lx, ly); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); };
    const kind = b.ground || 'paving', A = b.a / 2;
    if (kind === 'paving') { both(`rgba(${S.shadow},${snow ? 0.12 : 0.2})`, 0.3, ctx => quad(ctx, -A - 1, -A - 1, A + 1, A + 1)); continue; }
    both(`rgba(${S.shadow},${snow ? 0.2 : 0.34})`, 0.3, ctx => quad(ctx, -A - 1.5, -A - 1.5, A + 1.5, A + 1.5));       // the edge of the plot
    both(kind === 'asphalt' ? S.drive : kind === 'lawn' ? S.lawn[1] : S.yard, kind === 'asphalt' ? 0.5 : kind === 'lawn' ? 0 : 0.4, ctx => quad(ctx, -A, -A, A, A));
    if (mt) { mt.fillStyle = kind === 'asphalt' ? '#f00' : kind === 'lawn' ? '#0f0' : '#000'; mt.beginPath(); quad(mt, -A, -A, A, A); mt.fill(); }
    g.lineWidth = 0.7;
    if (kind === 'yard') {                                 // concrete laid in bays
      g.strokeStyle = ink(0.3);
      for (let k = -A + b.a / 3; k < A - 1; k += b.a / 3) { g.beginPath(); g.moveTo(...at(k, -A)); g.lineTo(...at(k, A)); g.moveTo(...at(-A, k)); g.lineTo(...at(A, k)); g.stroke(); }
    } else if (b.prop === 'parking') {                     // painted bays down both sides, worn
      g.strokeStyle = snow ? 'rgba(236,241,247,.3)' : 'rgba(226,232,238,.42)';
      const k = b.scale || 1;
      for (let i = 0; i <= 6; i++) for (const s of [-1, 1]) { const lx = (-16.2 + i * 5.3) * k; g.beginPath(); g.moveTo(...at(lx, s * 5 * k)); g.lineTo(...at(lx, s * 14.5 * k)); g.stroke(); }
    } else if (kind === 'asphalt') {                       // a forecourt: one line round it
      g.strokeStyle = snow ? 'rgba(236,241,247,.2)' : 'rgba(226,232,238,.26)';
      g.beginPath(); quad(g, -A + 2, -A + 2, A - 2, A - 2); g.stroke();
    }
  }
  if (v.bake) {
    for (const b of scenery.blocks) {
      g.save();
      g.translate(b.x, b.y);
      if (b.scale) g.scale(b.scale, b.scale);
      renderModel(g, blockModel(b.key), b.yaw || BLOCK_YAW, !!b.prop);   // a plot of several things is drawn back to front
      g.restore();
      if (snow && b.h && !b.prop) {                       // snow on the roof: its top face, and the setback storey's where there is one
        const [size, , variant] = b.key.split('|').map(Number);
        const flat = (y, hw) => { g.moveTo(b.x, y - hw * F); g.lineTo(b.x + hw, y); g.lineTo(b.x, y + hw * F); g.lineTo(b.x - hw, y); g.closePath(); };
        const hw = b.a * Math.SQRT1_2, ry = b.y - b.h + 1.8, up = variant % 2 === 0 && size >= 2 ? 8.2 : 0;   // (see blockModel)
        g.fillStyle = 'rgba(236,241,247,.82)';
        g.beginPath();
        flat(ry, hw * 0.95);
        if (up) {                                         // leave the storey standing on the roof clear
          const s = hw * 0.62;
          g.moveTo(b.x - s, ry); g.lineTo(b.x - s, ry - up); g.lineTo(b.x, ry - up - s * F); g.lineTo(b.x + s, ry - up); g.lineTo(b.x + s, ry); g.lineTo(b.x, ry + s * F); g.closePath();
        }
        g.fill('evenodd');
        if (up) { g.beginPath(); flat(ry - up, hw * 0.58); g.fill(); }
      }
    }
    const lamp = lampModel();
    for (const p of scenery.lamps) {
      g.save();
      g.translate(p.x, p.y);
      renderModel(g, lamp, 0, false);
      g.restore();
    }
  }

  // --- night, where nothing else will darken the picture (the canvas renderer): the whole
  //     painting sinks into dark blue, and the lamp pools below are what is left of the light
  const dark = night && v.bake;
  if (dark) {
    // (read back through a scratch copy, so the painting itself stays a canvas the browser keeps on the GPU)
    const copy = document.createElement('canvas');
    copy.width = W; copy.height = H;
    const cx = copy.getContext('2d', { willReadFrequently: true });
    cx.drawImage(c, 0, 0);
    const img = cx.getImageData(0, 0, W, H), d = img.data;
    for (let o = 0; o < d.length; o += 4) {
      const r = d[o], gr = d[o + 1], b = d[o + 2];
      if (r > 215 && gr > 140 && r - b > 110) continue;    // a lit window or a lantern: these stay as bright as they were
      d[o] = r * 0.243; d[o + 1] = gr * 0.298; d[o + 2] = b * 0.478;
    }
    g.putImageData(img, 0, 0);
  }

  // --- lamp light: warm pools on the wet ground, the one warm note in a cool scene
  /** Soft round pools of light on the ground: at [{x,y}], radius r, colour rgb, strength a at the centre. */
  const pools = (ctx, at, r, rgb, a) => {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of at) {
      const pool = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r);
      pool.addColorStop(0, `rgba(${rgb},${a})`);
      pool.addColorStop(0.45, `rgba(${rgb},${+(a * 0.36).toFixed(3)})`);
      pool.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = pool;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.scale(1, F + 0.08); ctx.translate(-p.x, -p.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  };
  if (dark) {
    pools(g, nodes, R + 78, '150,170,214', 0.3);          // floodlit yards: every base stands in its own light
    pools(g, scenery.lamps, 52, '255,160,76', 0.62);
    pools(g, scenery.lamps, 15, '255,214,160', 0.4);
  } else if (S.pools === 1) {
    g.globalCompositeOperation = 'lighter';
    for (const p of scenery.lamps) {
      const r = 30;
      const pool = g.createRadialGradient(p.x, p.y, 1, p.x, p.y, r);
      pool.addColorStop(0, 'rgba(255,170,84,.34)');
      pool.addColorStop(0.45, 'rgba(255,150,70,.12)');
      pool.addColorStop(1, 'rgba(255,140,60,0)');
      g.fillStyle = pool;
      g.save();
      g.translate(p.x, p.y); g.scale(1, F + 0.08); g.translate(-p.x, -p.y);
      g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
  } else if (S.pools) {                                   // on snow light cannot be added to white: the pool tints it instead
    for (const p of scenery.lamps) {
      const pool = g.createRadialGradient(p.x, p.y, 1, p.x, p.y, 34);
      pool.addColorStop(0, `rgba(255,178,96,${+(0.42 * S.pools).toFixed(3)})`);
      pool.addColorStop(0.5, `rgba(255,190,120,${+(0.16 * S.pools).toFixed(3)})`);
      pool.addColorStop(1, 'rgba(255,196,130,0)');
      g.fillStyle = pool;
      g.save();
      g.translate(p.x, p.y); g.scale(1, F + 0.08); g.translate(-p.x, -p.y);
      g.beginPath(); g.arc(p.x, p.y, 34, 0, TAU); g.fill();
      g.restore();
    }
  }
  if (w) {
    // Where lamp light falls, for the 3D renderer to light at night: a small map of its own
    // (white = full light), handed over as `wet.lamps`. The pools are soft, so a quarter of the
    // resolution is plenty, and the wetness map itself stays exactly as it was.
    const Q = 4, m = wet.lamps || (wet.lamps = document.createElement('canvas'));
    m.width = Math.ceil(W / Q); m.height = Math.ceil(H / Q);
    const mc = m.getContext('2d');
    mc.fillStyle = '#000'; mc.fillRect(0, 0, m.width, m.height);
    mc.setTransform(k / Q, 0, 0, k / Q, ox / Q, oy / Q);
    pools(mc, nodes, R + 70, '255,255,255', 0.3);
    pools(mc, scenery.lamps, 56, '255,255,255', 1);
  }

  // --- atmosphere: flat overcast light, haze thickening with distance, soft vignette
  //     (the 3D renderer has real fog, and lights the ground itself)
  const planted = trees.map(q => ({ x: q.x, y: q.y, s: q.s, kind: q.r < 0.5 ? 0 : 1 }));
  if (v.props3d) return { trees: planted };
  g.setTransform(1, 0, 0, 1, 0, 0);
  // [haze colour, haze at the top, a third down, tint at the bottom, vignette] for this sky
  const AIR = { rain: [FOG, 0.34, 0.12, 'rgba(10,18,30,.14)', 'rgba(6,10,18,.36)'], snow: ['236,241,247', 0.5, 0.2, 'rgba(96,118,150,.08)', 'rgba(40,56,86,.2)'],
    sun: ['255,240,214', 0.16, 0.06, 'rgba(255,214,150,.07)', 'rgba(30,24,14,.2)'], night: ['10,16,34', 0.5, 0.2, 'rgba(4,8,20,.2)', 'rgba(0,2,10,.55)'] }[weather];
  const haze = g.createLinearGradient(0, 0, 0, H);
  haze.addColorStop(0, `rgba(${AIR[0]},${AIR[1]})`);
  haze.addColorStop(0.3, `rgba(${AIR[0]},${AIR[2]})`);
  haze.addColorStop(0.62, `rgba(${AIR[0]},0)`);
  haze.addColorStop(1, AIR[3]);
  g.fillStyle = haze;
  g.fillRect(0, 0, W, H);
  if (sun) { g.fillStyle = 'rgba(255,226,170,.05)'; g.fillRect(0, 0, W, H); }       // the warmth of direct light over everything
  const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, AIR[4]);
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
  return { trees: planted };
}
