// Static battlefield backdrop: a city in the rain.
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

/**
 * @param c   canvas to paint (already sized in device pixels)
 * @param v   { k, ox, oy, nodes: [{x,y}], roads: [[a,b]], R, seed, scenery: { blocks, lamps }, bake }
 *            k = device px per view unit. With `bake`, the 3D scenery is painted into the picture
 *            (canvas renderer); otherwise the WebGL renderer draws it as real geometry.
 * @param wet optional canvas of the same size: receives the wetness map (white = mirror, black = dry)
 * @param v.props3d  leave out what the 3D renderer does for real: painted trees, haze and vignette
 * @returns { trees: [{ x, y, s, kind }] }  where the trees are (kind 0 conifer, 1 broadleaf)
 */
export function buildTerrain(c, v, wet) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const { k, ox, oy, nodes, R, seed } = v;
  const roads = v.roads;
  const scenery = v.scenery || { blocks: [], lamps: [] };
  const rnd = seeded(seed);
  let w = null;
  if (wet) {
    wet.width = W; wet.height = H;
    w = wet.getContext('2d');
  }
  const gray = lv => { const n = Math.round(Math.max(0, Math.min(1, lv)) * 255); return `rgb(${n},${n},${n})`; };
  /** Run the same drawing on the picture and on the wetness map. */
  const both = (fill, level, path) => {
    g.fillStyle = fill; g.beginPath(); path(g); g.fill();
    if (w) { w.fillStyle = gray(level); w.beginPath(); path(w); w.fill(); }
  };

  for (const ctx of w ? [g, w] : [g]) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = ctx === g ? PAVING[1] : gray(0.4);
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
      if (kd === 1) { col = shade(LAWN[Math.floor(r * 3)], 0.94 + r * 0.1); level = 0; }
      else if (kd === 2) { col = shade(BRICK[Math.floor(r * 3)], 0.9 + damp * 0.16); level = 0.2 + damp * 0.22; }
      // Paving is laid by district, as a city's is: large cast panels in one block, ordinary
      // slabs in the next, small setts in a third, each a slightly different stone.
      const di = Math.floor(i / 6), dj = Math.floor(j / 6);
      const dh = hash(Math.imul(di, 83492791) ^ Math.imul(dj, 2971215073) ^ seed);
      const style = kd ? 0 : dh % 3, tint = 0.94 + ((dh >>> 8) % 100) / 100 * 0.1;
      if (kd === 0) {
        const big = style === 1 ? hash(Math.imul(i >> 1, 73856093) ^ Math.imul(j >> 1, 19349663) ^ seed) / 4294967296 : r;
        col = shade(PAVING[Math.floor(damp * 3.99)], (0.93 + big * 0.1) * tint); level = 0.2 + damp * 0.36;
      }
      both(col, level, ctx => diamond(ctx, q, 0.4));
      if (kd === 1) continue;
      // Joints: a dark line where slabs meet, a faint wet glint on the upper edges.
      g.lineWidth = style === 1 ? 0.8 : 0.55;
      g.strokeStyle = kd === 2 ? 'rgba(40,20,16,.42)' : 'rgba(30,38,48,.4)';
      g.beginPath();
      if (style !== 1 || (i & 1)) { g.moveTo(q.x, q.y + TH / 2); g.lineTo(q.x + TW / 2, q.y); }
      if (style !== 1 || (j & 1)) { g.moveTo(q.x, q.y + TH / 2); g.lineTo(q.x - TW / 2, q.y); }
      g.stroke();
      if (style === 2) {                                                // setts: each slab quartered, finer joints
        g.lineWidth = 0.35;
        g.strokeStyle = 'rgba(30,38,48,.3)';
        g.beginPath();
        g.moveTo(q.x - TW / 4, q.y - TH / 4); g.lineTo(q.x + TW / 4, q.y + TH / 4);
        g.moveTo(q.x + TW / 4, q.y - TH / 4); g.lineTo(q.x - TW / 4, q.y + TH / 4);
        g.stroke();
      }
      if (kd === 0 && r < 0.07) {                                       // a cracked or patched slab now and then
        g.strokeStyle = 'rgba(24,30,38,.45)'; g.lineWidth = 0.5;
        g.beginPath(); g.moveTo(q.x - TW * 0.3, q.y - TH * 0.1); g.lineTo(q.x - TW * 0.05, q.y + TH * 0.05); g.lineTo(q.x + TW * 0.1, q.y - TH * 0.08); g.lineTo(q.x + TW * 0.32, q.y + TH * 0.12); g.stroke();
      } else if (kd === 0 && r > 0.955) {                               // drain cover
        g.fillStyle = 'rgba(22,26,32,.7)'; g.beginPath(); g.ellipse(q.x, q.y, 4.2, 4.2 * F, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(150,160,170,.5)'; g.lineWidth = 0.6; g.beginPath(); g.ellipse(q.x, q.y, 4.2, 4.2 * F, 0, 0, TAU); g.stroke();
        g.beginPath(); for (let k = -2; k <= 2; k++) { g.moveTo(q.x - 3, q.y + k * 0.9); g.lineTo(q.x + 3, q.y + k * 0.9); } g.stroke();
      }
      g.lineWidth = 0.55;
      g.strokeStyle = 'rgba(220,232,244,.10)';
      g.beginPath(); g.moveTo(q.x - TW / 2 + 1, q.y + 0.6); g.lineTo(q.x, q.y - TH / 2 + 0.9); g.stroke();
      if (kd === 2) {                                                   // brick courses inside the slab
        g.strokeStyle = 'rgba(38,18,14,.3)';
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
        g.fillStyle = rnd() < 0.5 ? 'rgba(18,40,16,.3)' : 'rgba(126,170,88,.2)';
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
        g.strokeStyle = 'rgba(20,26,32,.45)';
        g.lineWidth = 3.2;
        g.beginPath(); g.moveTo(a[0], a[1] + 0.9); g.lineTo(b[0], b[1] + 0.9); g.stroke();
        g.strokeStyle = upper ? KERB : '#c3ccd4';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        if (w) { w.strokeStyle = gray(0.1); w.lineWidth = 3; w.beginPath(); w.moveTo(a[0], a[1]); w.lineTo(b[0], b[1]); w.stroke(); }
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
  strokeRoads(g, 'rgba(14,18,24,.4)', 45);                // the sidewalk's own shadow line
  strokeRoads(g, '#8b959f', 43);                          // sidewalk
  strokeRoads(g, 'rgba(18,22,28,.5)', 31.5);              // drop of the kerb
  strokeRoads(g, KERB, 30);                               // kerbstones
  strokeRoads(g, '#4a525a', 27);                          // gutter
  strokeRoads(g, ASPHALT, 24.5);                          // carriageway
  if (w) {
    strokeRoads(w, gray(0.3), 43);
    strokeRoads(w, gray(0.5), 24.5);
  }
  // Everything that makes it a used road rather than a grey band: flag joints across the
  // sidewalks, aggregate, wheel-polished lanes, repairs, cracks, manholes, worn paint.
  for (const [i, j] of roads) {
    const a = nodes[i], b = nodes[j];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const at = (d, off) => [a.x + ux * d - uy * off, a.y + uy * d + ux * off * F];
    g.strokeStyle = 'rgba(30,38,48,.34)'; g.lineWidth = 0.5;
    g.beginPath();
    for (let d = 4; d < l; d += 7.5) for (const side of [-1, 1]) { const p = at(d, side * 15.4), q = at(d, side * 21.2); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); }
    g.stroke();
    for (const off of [-5.6, 5.6]) {                       // lanes polished by traffic
      const p = at(0, off), q = at(l, off);
      g.strokeStyle = 'rgba(120,134,150,.09)'; g.lineWidth = 4.4;
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
    }
    for (let n = Math.round(l * 1.5); n > 0; n--) {        // aggregate
      const p = at(rnd() * l, (rnd() - 0.5) * 23);
      g.fillStyle = rnd() < 0.5 ? 'rgba(170,180,190,.16)' : 'rgba(8,10,14,.2)';
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
  strokeRoads(g, 'rgba(226,232,238,.42)', 1.1, [9, 11]);  // centre line, worn
  strokeRoads(g, 'rgba(226,232,238,.2)', 0.8, [34, 5], 10.8);
  strokeRoads(g, 'rgba(226,232,238,.2)', 0.8, [34, 5], -10.8);

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
    both('rgba(10,14,20,.3)', 0.4, ctx => yardPath(ctx, p, 5));
    both('#6c737a', 0.42, ctx => yardPath(ctx, p, 0));
    g.save();
    g.beginPath(); yardPath(g, p, 0); g.clip();
    // bays
    g.strokeStyle = 'rgba(26,32,40,.42)'; g.lineWidth = 0.6;
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
      g.fillStyle = `rgba(14,16,20,${(0.08 + rnd() * 0.12).toFixed(2)})`;
      g.beginPath(); g.ellipse(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * F, 3 + rnd() * 8, 1.6 + rnd() * 3.6, rnd() * 3, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(8,12,18,.3)'; g.lineWidth = 9;
    g.beginPath(); yardPath(g, p, 0); g.stroke();
    // driveways and gate thresholds
    for (const [a, b] of roads) {
      if (a !== ci && b !== ci) continue;
      const q = nodes[a === ci ? b : a], gt = gateOf(p, q);
      g.strokeStyle = '#3d444c'; g.lineWidth = 23;
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(gt.x + gt.ux * 6, gt.y + gt.uy * 6); g.stroke();
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
      w.strokeStyle = gray(0.55); w.lineWidth = 23;
      for (const [a, b] of roads) { if (a !== ci && b !== ci) continue; const q = nodes[a === ci ? b : a]; w.beginPath(); w.moveTo(p.x, p.y); w.lineTo(q.x, q.y); w.stroke(); }
      w.restore();
    }
    // pedestrian crossing on each road just outside the gate
    for (const [a, b] of roads) {
      if (a !== ci && b !== ci) continue;
      const q = nodes[a === ci ? b : a], gt = gateOf(p, q);
      g.strokeStyle = 'rgba(226,232,238,.5)'; g.lineWidth = 1.9;
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
    put(g, dark);
    if (w) put(w, shine);
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
    if (q.r < 0.5) {                                      // conifer
      g.fillStyle = 'rgba(6,12,10,.34)';
      g.beginPath(); g.ellipse(x + 5 * s, y + 2 * s, 8 * s, 3.4 * s, 0, 0, TAU); g.fill();
      g.fillStyle = '#2c2218';
      g.fillRect(x - 1 * s, y - 4 * s, 2 * s, 5 * s);
      for (let t = 0; t < 3; t++) {
        const tw = (8 - t * 2) * s, by = y - (3 + t * 6) * s;
        g.fillStyle = '#17301f';
        g.beginPath(); g.moveTo(x - tw, by); g.lineTo(x, by - 10 * s); g.lineTo(x + tw, by); g.closePath(); g.fill();
        g.fillStyle = '#2a4e33';
        g.beginPath(); g.moveTo(x - tw, by); g.lineTo(x, by - 10 * s); g.lineTo(x - tw * 0.15, by); g.closePath(); g.fill();
      }
    } else {                                              // broadleaf
      g.fillStyle = 'rgba(6,12,10,.34)';
      g.beginPath(); g.ellipse(x + 6 * s, y + 2 * s, 10 * s, 4.2 * s, 0, 0, TAU); g.fill();
      g.fillStyle = '#2c2218';
      g.fillRect(x - 1.2 * s, y - 5 * s, 2.4 * s, 6 * s);
      g.fillStyle = '#1c3421';
      g.beginPath(); g.arc(x, y - 10 * s, 8.5 * s, 0, TAU); g.fill();
      g.fillStyle = '#2b4a2e';
      g.beginPath(); g.arc(x - 2 * s, y - 12 * s, 6.4 * s, 0, TAU); g.fill();
      g.fillStyle = '#44663a';
      g.beginPath(); g.arc(x - 3.4 * s, y - 14 * s, 3.6 * s, 0, TAU); g.fill();
    }
  }

  // --- scenery footprints, and the scenery itself where there is no 3D renderer to draw it
  for (const b of scenery.blocks) {
    const hw = (b.a + 4) * Math.SQRT1_2;
    both('rgba(10,14,20,.42)', 0.3, ctx => ctx.ellipse(b.x + 5, b.y + 4, hw * 1.25, hw * 1.25 * F, 0, 0, TAU));
  }
  if (v.bake) {
    for (const b of scenery.blocks) {
      g.save();
      g.translate(b.x, b.y);
      renderModel(g, blockModel(b.key), BLOCK_YAW, false);
      g.restore();
    }
    const lamp = lampModel();
    for (const p of scenery.lamps) {
      g.save();
      g.translate(p.x, p.y);
      renderModel(g, lamp, 0, false);
      g.restore();
    }
  }

  // --- lamp light: warm pools on the wet ground, the one warm note in a cool scene
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

  // --- atmosphere: flat overcast light, haze thickening with distance, soft vignette
  //     (the 3D renderer has real fog, and lights the ground itself)
  const planted = trees.map(q => ({ x: q.x, y: q.y, s: q.s, kind: q.r < 0.5 ? 0 : 1 }));
  if (v.props3d) return { trees: planted };
  g.setTransform(1, 0, 0, 1, 0, 0);
  const haze = g.createLinearGradient(0, 0, 0, H);
  haze.addColorStop(0, `rgba(${FOG},.34)`);
  haze.addColorStop(0.3, `rgba(${FOG},.12)`);
  haze.addColorStop(0.62, `rgba(${FOG},0)`);
  haze.addColorStop(1, 'rgba(10,18,30,.14)');
  g.fillStyle = haze;
  g.fillRect(0, 0, W, H);
  const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(6,10,18,.36)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
  return { trees: planted };
}
