// Ground painter for the renderer proofs of concept.
//
// Derived from public/js/terrain.js (same paving, plazas, lawns, puddles and
// streets) with everything a real 3D engine does for itself taken out: no
// painted trees, no baked contact shadows, no lamp pools, no haze or vignette.
// It returns where the trees belong so the engine can plant real ones.
//
// Derived mechanically (see poc/README.md): change terrain.js and derive again rather than editing this.
import { F, shade } from '/public/js/iso.js';

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
 */
export function paintGround(c, v, wet) {
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
      else { col = shade(PAVING[Math.floor(damp * 3.99)], 0.95 + r * 0.09); level = 0.22 + damp * 0.4; }
      both(col, level, ctx => diamond(ctx, q, 0.4));
      if (kd === 1) continue;
      // Joints: a dark line where slabs meet, a faint wet glint on the upper edges.
      g.lineWidth = 0.55;
      g.strokeStyle = kd === 2 ? 'rgba(40,20,16,.42)' : 'rgba(34,42,52,.38)';
      g.beginPath(); g.moveTo(q.x, q.y + TH / 2); g.lineTo(q.x + TW / 2, q.y); g.moveTo(q.x, q.y + TH / 2); g.lineTo(q.x - TW / 2, q.y); g.stroke();
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

  // --- puddles: standing water that mirrors the sky
  const puddle = (x, y, rx, turn) => {
    const ry = rx * F * (0.55 + rnd() * 0.3);
    const path = ctx => { ctx.ellipse(x, y, rx, ry, turn, 0, TAU); };
    both('rgba(44,56,70,.5)', 0.96, path);
    g.fillStyle = 'rgba(190,208,226,.16)';
    g.beginPath(); g.ellipse(x - rx * 0.12, y - ry * 0.16, rx * 0.72, ry * 0.6, turn, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(214,228,242,.3)';
    g.lineWidth = 0.7;
    g.beginPath(); g.ellipse(x, y, rx, ry, turn, Math.PI * 1.05, Math.PI * 1.9); g.stroke();
  };
  for (let n = Math.round(area / 5200); n > 0; n--) {
    const q = { x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) };
    const i = Math.round(q.x / TW + q.y / TH), j = Math.round(q.y / TH - q.x / TW);
    if (kind.get(key(i, j)) === 1 || cityDist(q) < R + 24) continue;
    const rx = 7 + rnd() * 15;
    puddle(q.x, q.y, rx, (rnd() - 0.5) * 0.5);
    if (rnd() < 0.6) puddle(q.x + rx * (0.5 + rnd() * 0.5), q.y + (rnd() - 0.3) * rx * 0.5, rx * (0.4 + rnd() * 0.4), (rnd() - 0.5) * 0.5);
  }

  // --- sky glints: long pale smears where the wet stone catches the overcast sky
  for (let n = Math.round(area / 9000); n > 0; n--) {
    const q = { x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) };
    const i = Math.round(q.x / TW + q.y / TH), j = Math.round(q.y / TH - q.x / TW);
    if (kind.get(key(i, j)) === 1) continue;
    const gl = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, 26);
    gl.addColorStop(0, 'rgba(214,228,242,.13)');
    gl.addColorStop(1, 'rgba(214,228,242,0)');
    g.fillStyle = gl;
    g.save();
    g.translate(q.x, q.y); g.scale(0.5, 1.3); g.translate(-q.x, -q.y);
    g.beginPath(); g.arc(q.x, q.y, 26, 0, TAU); g.fill();
    g.restore();
  }

  // --- streets: the links troops can travel along
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
  strokeRoads(g, 'rgba(18,22,28,.5)', 33);                // drop shadow of the kerb
  strokeRoads(g, KERB, 30);                               // kerbstones
  strokeRoads(g, '#59626b', 27);                          // gutter
  strokeRoads(g, ASPHALT, 24.5);                          // carriageway
  strokeRoads(g, 'rgba(150,170,192,.10)', 15);            // wet sheen down the middle
  strokeRoads(g, 'rgba(226,232,238,.5)', 1.2, [9, 10]);   // centre line
  strokeRoads(g, 'rgba(226,232,238,.22)', 0.8, null, 10.6);
  strokeRoads(g, 'rgba(226,232,238,.22)', 0.8, null, -10.6);
  if (w) {
    strokeRoads(w, gray(0.3), 30);
    strokeRoads(w, gray(0.62), 24.5);
  }
  // Wheel-worn streaks and a few puddles in the gutters.
  for (const [i, j] of roads) {
    const a = nodes[i], b = nodes[j];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    for (let n = Math.round(l / 46); n > 0; n--) {
      const f = 0.12 + rnd() * 0.76, off = (rnd() - 0.5) * 16;
      const x = a.x + (b.x - a.x) * f - ((b.y - a.y) / l) * off, y = a.y + (b.y - a.y) * f + ((b.x - a.x) / l) * off * F;
      puddle(x, y, 4 + rnd() * 6, Math.atan2(b.y - a.y, b.x - a.x));
    }
  }

  // --- forecourt under every base: dark wet concrete inside a pale kerb ring
  for (const p of nodes) {
    const rx = R + 17, ry = rx * F + 3;
    both('rgba(16,20,26,.55)', 0.5, ctx => ctx.ellipse(p.x + 2, p.y + 3, rx + 4, ry + 3, 0, 0, TAU));
    both(KERB, 0.3, ctx => ctx.ellipse(p.x, p.y + 1, rx + 1.5, ry + 1, 0, 0, TAU));
    both('#3f464e', 0.66, ctx => ctx.ellipse(p.x, p.y + 1, rx - 1, ry - 0.8, 0, 0, TAU));
    g.fillStyle = 'rgba(190,210,230,.07)';
    g.beginPath(); g.ellipse(p.x - 4, p.y - 2, rx * 0.8, ry * 0.75, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(236,196,84,.34)';
    g.lineWidth = 1.5;
    g.setLineDash([7, 7]);
    g.beginPath(); g.ellipse(p.x, p.y + 1, rx - 5, ry - 3, 0, 0, TAU); g.stroke();
    g.setLineDash([]);
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
  return { trees };
}
