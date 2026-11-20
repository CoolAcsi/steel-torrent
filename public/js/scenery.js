// City scenery around the battlefield: office blocks, the plots that are not office blocks
// (shops, houses, sheds, yards: see props.js) and street lamps.
//
// Everything here is decoration and is placed so that it can never hide
// anything that matters. A block is only built where the strip of screen it
// covers (its footprint and everything behind it, up to its roof) contains no
// city, no city label and no road, so troops never march behind one.
//
// The models are original, built from the same primitives as the bases:
// stepped slabs with banded floors, flat roofs with plant, a few lit windows.
import { F, Model } from './iso.js';
import { PROP_KINDS, propModel } from './props.js';

const SQ = Math.SQRT1_2;

/**
 * Half the side of a base compound, in ground units. The compound is a square
 * yard turned 45 degrees to line up with the paving, so on screen it is a
 * diamond reaching YARD * sqrt(2) left and right of the city and that times F
 * up and down. The terrain painter, the wall builder and the scenery planner
 * all work from this one number.
 */
export const YARD = 42;
const YAW = Math.PI / 4;                 // faces line up with the paving grid

function seeded(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stone, trim, glass and roof for each look. Low saturation on purpose: the
// city is the backdrop, the factions and team colours are the subject.
const LOOKS = [
  { wall: '#57534d', band: '#8e8b84', glass: '#161b22', roof: '#6c6a66', plant: '#3c3f44' },   // brown stone
  { wall: '#4d5258', band: '#9299a0', glass: '#12171e', roof: '#676c72', plant: '#34383d' },   // blue-grey concrete
  { wall: '#625c52', band: '#a09a8e', glass: '#1a1d21', roof: '#74706a', plant: '#40423f' },   // sandstone
];
const LIT = '#ffb866';

/** Footprint side and floor count for each size class. */
const SIZES = [
  { a: 30, floors: 3 },
  { a: 34, floors: 5 },
  { a: 38, floors: 8 },
  { a: 42, floors: 12 },
];
const FLOOR = 7.2;
export const blockHeight = size => 4 + SIZES[size].floors * FLOOR + 3;

/**
 * One plot's model. `key` = "size|look|variant" for an office block, "p|kind|variant" for any
 * other plot; identical plots share a mesh.
 */
export function blockModel(key) {
  if (key[0] === 'p') { const [, kind, variant] = key.split('|'); return propModel(kind, +variant); }
  const [size, look, variant] = key.split('|').map(Number);
  const { a, floors } = SIZES[size], L = LOOKS[look];
  const rnd = seeded(size * 977 + look * 131 + variant * 17 + 5);
  const m = new Model();
  const h = a / 2;

  m.box(-h - 2, h + 2, -h - 2, h + 2, 0, 1.6, '#868d94', { top: '#9aa1a8' });           // pavement plinth
  const body = m.box(-h, h, -h, h, 1.6, 4 + floors * FLOOR, L.wall, { top: L.roof });
  const top = 4 + floors * FLOOR;

  // The two faces the camera sees: a glazed strip and a pale spandrel per floor, a few rooms lit.
  for (let f = 0; f < floors; f++) {
    const z0 = 4 + f * FLOOR;
    for (const side of [0, 1]) {
      const strip = (u0, u1, zz0, zz1, c, glow) => (side
        ? m.onY(body, u0, u1, zz0, zz1, h, c, glow)
        : m.onX(body, u0, u1, zz0, zz1, h, c, glow));
      strip(-h + 1.5, h - 1.5, z0 + 1.2, z0 + 4.6, L.glass);
      strip(-h, h, z0 + 5.4, z0 + 6.4, L.band);
      const bays = Math.round(a / 7);
      for (let b = 0; b < bays; b++) {
        if (rnd() > 0.13) continue;
        const u = -h + 2 + (b + 0.15) * ((a - 4) / bays);
        strip(u, u + (a - 4) / bays * 0.7, z0 + 1.6, z0 + 4.2, LIT, true);
      }
    }
  }
  // Street-level entrance band and corner piers.
  m.onX(body, -h, h, 1.6, 4, h, L.band);
  m.onY(body, -h, h, 1.6, 4, h, L.band);

  // Roof: pale parapet, then plant rooms; taller blocks get a setback storey.
  m.box(-h, h, -h, h, top, top + 1.2, L.band, { top: L.roof });
  if (variant % 2 === 0 && size >= 2) {
    const s = h * 0.62;
    const cap = m.box(-s, s, -s, s, top + 1.2, top + 1.2 + FLOOR, L.wall, { top: L.roof });
    m.onX(cap, -s + 1, s - 1, top + 2.4, top + 5.6, s, L.glass);
    m.onY(cap, -s + 1, s - 1, top + 2.4, top + 5.6, s, L.glass);
    m.box(-s, s, -s, s, top + 1.2 + FLOOR, top + 2.2 + FLOOR, L.band, { top: L.roof });
    m.box(-3, 3, -3, 3, top + 2.2 + FLOOR, top + 6 + FLOOR, L.plant);
  } else {
    m.box(-h * 0.55, -h * 0.05, -h * 0.5, h * 0.1, top + 1.2, top + 4.6, L.plant, { top: '#4a4e53' });
    m.box(h * 0.2, h * 0.62, h * 0.1, h * 0.6, top + 1.2, top + 3.4, L.plant, { top: '#4a4e53' });
    if (size >= 1) m.cyl(h * 0.35, -h * 0.4, 2.4, top + 1.2, top + 5.2, '#7b8187', { n: 8 });
  }
  return m;
}

/** Street lamp: a slim post with a warm lantern. */
export function lampModel() {
  const m = new Model();
  m.cyl(0, 0, 1.5, 0, 1.2, '#2e3338', { n: 6 });
  m.cyl(0, 0, 0.7, 1.2, 15, '#3a4046', { n: 5 });
  m.box(-2.4, 2.4, -0.6, 0.6, 15, 15.8, '#2e3338');
  m.cyl(0, 0, 1.9, 15.8, 18.2, LIT, { n: 6, r1: 1.3, glow: true });
  m.cyl(0, 0, 2.3, 18.2, 18.9, '#2e3338', { n: 6, r1: 0.6 });
  return m;
}

export const BLOCK_YAW = YAW;

// What a district of the city is mostly made of. A plot draws from its district's list, so
// shops stand with shops and sheds with sheds; 'tower' is an office block.
const DISTRICTS = [
  ['tower', 'tower', 'shops', 'tower', 'plaza', 'parking', 'tower', 'fuel'],                                    // offices
  ['houses', 'houses', 'shops', 'houses', 'plaza', 'parking', 'tower', 'houses'],                               // housing
  ['warehouse', 'containers', 'tanks', 'substation', 'construction', 'watertower', 'warehouse', 'parking'],     // works and yards
  ['tower', 'shops', 'construction', 'fuel', 'houses', 'plaza', 'watertower', 'tower'],                         // the mixed edge of town
];
const PLOT = 1.4;                                        // plots are built this much larger than they are modelled: a house has to hold its own beside a tank
const DISTRICT = 250;                                    // a district is about this far across, in view units

function hash2(x, y, seed) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

/**
 * Decide where the scenery goes for one layout.
 * @param v { nodes: [{x,y}] view positions, roads: [[a,b]], R, x0, y0, x1, y1 visible view rectangle, seed }
 * @param v.skyline  also plan the 3D renderer's towers
 * @returns { blocks, lamps, towers, props }
 *   blocks  every plot, back to front: [{ x, y, key, a, h }], with `prop: kind` (and `yaw`) on those that are not office blocks
 *   towers  what the 3D renderer builds as towers [{ x, y, a, floors, look, seed }], plus the other plots
 *           as { x, y, a, h, key, prop } so the ground is painted for them too (the renderer skips those)
 *   props   the plots that are not towers, as the 3D renderer draws them: [{ key, build, x, y, yaw, scale, r, kind }]
 */
export function planScenery(v) {
  const { nodes, roads, R, x0, y0, x1, y1 } = v;
  const rnd = seeded(v.seed ^ 0x51ce);

  // Points along every road, for clearance tests.
  const roadPts = [];
  for (const [i, j] of roads) {
    const A = nodes[i], B = nodes[j];
    const n = Math.max(2, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) / 10));
    for (let s = 0; s <= n; s++) roadPts.push({ x: A.x + (B.x - A.x) * s / n, y: A.y + (B.y - A.y) * s / n });
  }
  const inRect = (p, r, mx, mt, mb) => p.x > r.l - mx && p.x < r.r + mx && p.y > r.t - mt && p.y < r.b + mb;
  /** Nothing a plot of side `a` and height `h` at (x, y) would cover on screen is a city, its ring, its label or a road. */
  const clear = (x, y, a, h, pad = 4) => {
    const hw = (a + pad) * SQ, hd = hw * F;
    const cover = { l: x - hw, r: x + hw, t: y - hd - h, b: y + hd };
    return !nodes.some(p => inRect(p, cover, R + 26, R + 16, R + 44)) && !roadPts.some(p => inRect(p, cover, 24, 30, 40));
  };
  const apart = (list, x, y, a, gap) => !list.some(b => Math.abs(b.x - x) < (b.a + a) * SQ + gap && Math.abs(b.y - y) < (b.a + a) * SQ * F + gap + 2);
  const districtOf = (x, y) => DISTRICTS[Math.floor(hash2(Math.floor(x / DISTRICT), Math.floor(y / (DISTRICT * 0.7)), v.seed ^ 0x7a11) * DISTRICTS.length)];
  /** A plot that is not a tower: the first kind from the district's list, starting at `from`, that fits here. */
  const made = {};                                         // plots of each kind so far
  let madeAll = 0;
  const propAt = (x, y, list, from, others) => {
    for (let k = 0; k < list.length; k++) {
      const kind = list[(from + k) % list.length];
      if (kind === 'tower') continue;
      const K = PROP_KINDS[kind];
      if ((made[kind] || 0) >= 2 + K.share * madeAll) continue;   // enough of those already
      const variant = Math.floor(rnd() * K.variants), h = (K.hv ? K.hv[variant] : K.h) * PLOT, a = K.a * PLOT;
      if (y > y1 - 90 && h > 28) continue;                   // nothing tall along the near edge
      if (!clear(x, y, a, h) || !apart(others, x, y, a, 8)) continue;
      made[kind] = (made[kind] || 0) + 1; madeAll++;
      return { x, y, key: `p|${kind}|${variant}`, a, h, prop: kind, variant, yaw: YAW, scale: PLOT, ground: K.ground };
    }
    return null;
  };

  const blocks = [];
  const cells = [];
  const STEP = 58;
  for (let gx = x0 - 20; gx < x1 + 20; gx += STEP) {
    for (let gy = y0 - 10; gy < y1 + 40; gy += STEP * 0.8) cells.push({ x: gx + rnd() * STEP * 0.6, y: gy + rnd() * STEP * 0.5, r: rnd() });
  }
  cells.sort((p, q) => p.r - q.r);
  const most = Math.round(((x1 - x0) * (y1 - y0)) / 22000);
  for (const q of cells) {
    if (q.r > 0.72 || blocks.length >= most) break;          // leave a good part of the ground open
    const list = districtOf(q.x, q.y), pick = Math.floor(rnd() * list.length);
    let plot = null;
    if (list[pick] === 'tower') {
      for (let size = SIZES.length - 1; size >= 0 && !plot; size--) {
        const a = SIZES[size].a, h = blockHeight(size);
        if (q.y > y1 - 90 && size > 0) continue;             // only low buildings along the near edge, where tall ones would wall off the view
        if (!clear(q.x, q.y, a, h) || !apart(blocks, q.x, q.y, a, 10)) continue;
        const look = Math.floor(rnd() * LOOKS.length), variant = Math.floor(rnd() * 3);
        plot = { x: q.x, y: q.y, key: `${size}|${look}|${variant}`, a, h };
      }
    }
    plot = plot || propAt(q.x, q.y, list, pick, blocks);     // where no tower fits, something lower may
    if (plot) { blocks.push(plot); if (!plot.prop) madeAll++; }
  }
  blocks.sort((p, q) => p.y - q.y);

  // Lamps down both sides of every road, clear of the cities and of each other.
  const lamps = [];
  for (const [i, j] of roads) {
    const A = nodes[i], B = nodes[j];
    const wx = B.x - A.x, wy = (B.y - A.y) / F;              // road in ground units
    const len = Math.hypot(wx, wy) || 1;
    const ux = wx / len, uy = wy / len;
    let side = (i + j) % 2 ? 1 : -1;
    for (let s = R + 34; s < len - R - 30; s += 66, side = -side) {
      const x = A.x + ux * s - uy * 21 * side, y = A.y + (uy * s + ux * 21 * side) * F;
      if (nodes.some(p => Math.hypot(p.x - x, (p.y - y) / F) < R + 22)) continue;
      if (roadPts.some(p => Math.hypot(p.x - x, (p.y - y) / F) < 15)) continue;
      if (lamps.some(p => Math.hypot(p.x - x, (p.y - y) / F) < 26)) continue;
      lamps.push({ x, y });
    }
  }
  // --- towers for the 3D renderer: the office plots above as textured towers, plus a
  //     skyline around the field. Every tower passes the same test as a block (nothing it
  //     covers on screen may be a city, a label or a road), so a tall one is only built
  //     where there is nothing behind it; the storey count is cut down until it fits.
  //     The skyline is a city too: between its towers stand the same lower plots.
  const towers = [];
  if (v.skyline) {
    const fit = (x, y, a, want) => { for (let f = want; f >= 3; f--) if (clear(x, y, a, towerHeight(f), 6)) return f; return 0; };
    for (const b of blocks) {
      if (b.prop) { towers.push(b); continue; }
      const floors = fit(b.x, b.y, b.a, Math.round((b.h - 7) / 7.2) + 1 + Math.floor(rnd() * 3));
      if (floors) towers.push({ x: b.x, y: b.y, a: b.a, floors, look: Math.floor(rnd() * 6), seed: Math.floor(rnd() * 1e6) });
    }
    let fx0 = Infinity, fx1 = -Infinity, fy0 = Infinity;
    for (const p of nodes) { fx0 = Math.min(fx0, p.x); fx1 = Math.max(fx1, p.x); fy0 = Math.min(fy0, p.y); }
    const GRID = 92;
    for (let gx = x0 - 50; gx < x1 + 50; gx += GRID) {
      for (let gy = y0 - 30; gy < y1 - 130; gy += GRID * F) {
        const x = gx + (rnd() - 0.5) * 24, y = gy + (rnd() - 0.5) * 12;
        const behind = fy0 - R - 26 - y;                       // how far beyond the far row of cities
        if (!(behind > 0 || x < fx0 - R - 30 || x > fx1 + R + 30) || rnd() < 0.18) continue;
        const list = districtOf(x, y), pick = Math.floor(rnd() * list.length);
        // Far behind the field the skyline is mostly towers; nearer and at the sides the district decides.
        if (list[pick] === 'tower' || rnd() < Math.min(0.6, Math.max(0, behind) / 400)) {
          const a = 44 + Math.floor(rnd() * 3) * 8;
          if (!apart(towers, x, y, a, 8)) continue;
          const floors = fit(x, y, a, Math.round(8 + rnd() * 8 + Math.max(0, behind) * 0.1));
          if (floors >= 4) { towers.push({ x, y, a, floors, look: Math.floor(rnd() * 6), seed: Math.floor(rnd() * 1e6) }); madeAll++; continue; }
        }
        const p = propAt(x, y, list, pick, towers);
        if (p) towers.push(p);
      }
    }
    towers.sort((p, q) => p.y - q.y);
  }
  const props = (v.skyline ? towers : blocks).filter(b => b.prop).map(b => ({
    key: b.key, build: () => propModel(b.prop, b.variant), x: b.x, y: b.y, yaw: b.yaw, scale: b.scale, r: b.a * SQ, kind: b.prop,
  }));
  return { blocks, lamps, towers, props };
}

/** Roof height of a 3D tower with `floors` storeys, including cornices and roof plant (see 3d/facade.js). */
export function towerHeight(floors) {
  return 2.2 + floors * 8 + 3 * 1.6 + 12;
}
