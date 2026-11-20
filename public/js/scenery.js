// City scenery around the battlefield: office blocks and street lamps.
//
// Everything here is decoration and is placed so that it can never hide
// anything that matters. A block is only built where the strip of screen it
// covers (its footprint and everything behind it, up to its roof) contains no
// city, no city label and no road, so troops never march behind one.
//
// The models are original, built from the same primitives as the bases:
// stepped slabs with banded floors, flat roofs with plant, a few lit windows.
import { F, Model } from './iso.js';

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

/** One office block. `key` = "size|look|variant" so identical blocks share a mesh. */
export function blockModel(key) {
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

/**
 * Decide where the scenery goes for one layout.
 * @param v { nodes: [{x,y}] view positions, roads: [[a,b]], R, x0, y0, x1, y1 visible view rectangle, seed }
 * @param v.skyline  also plan the 3D renderer's towers
 * @returns { blocks: [{ x, y, key, a, h }], lamps: [{ x, y }], towers: [{ x, y, a, floors, look, seed }] }
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

  const blocks = [];
  const cells = [];
  const STEP = 58;
  for (let gx = x0 - 20; gx < x1 + 20; gx += STEP) {
    for (let gy = y0 - 10; gy < y1 + 40; gy += STEP * 0.8) cells.push({ x: gx + rnd() * STEP * 0.6, y: gy + rnd() * STEP * 0.5, r: rnd() });
  }
  cells.sort((p, q) => p.r - q.r);
  const most = Math.round(((x1 - x0) * (y1 - y0)) / 30000);
  for (const q of cells) {
    if (q.r > 0.62 || blocks.length >= most) break;          // leave most of the ground open
    for (let size = SIZES.length - 1; size >= 0; size--) {
      const a = SIZES[size].a, h = blockHeight(size);
      const hw = (a + 4) * SQ, hd = hw * F;
      // Everything this block would cover on screen.
      const cover = { l: q.x - hw, r: q.x + hw, t: q.y - hd - h, b: q.y + hd };
      if (q.y > y1 - 90 && size > 0) continue;               // only low buildings along the near edge, where tall ones would wall off the view
      if (nodes.some(p => inRect(p, cover, R + 26, R + 16, R + 44))) continue;   // a city, its ring or its label
      if (roadPts.some(p => inRect(p, cover, 24, 30, 40))) continue;             // a road, with room for the troops marching on it
      if (blocks.some(b => Math.abs(b.x - q.x) < (b.a + a) * SQ + 10 && Math.abs(b.y - q.y) < (b.a + a) * SQ * F + 12)) continue;
      const look = Math.floor(rnd() * LOOKS.length), variant = Math.floor(rnd() * 3);
      blocks.push({ x: q.x, y: q.y, key: `${size}|${look}|${variant}`, a, h });
      break;
    }
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
  // --- towers for the 3D renderer: the plots above as textured office towers, plus a
  //     skyline around the field. Every tower passes the same test as a block (nothing it
  //     covers on screen may be a city, a label or a road), so a tall one is only built
  //     where there is nothing behind it; the storey count is cut down until it fits.
  const towers = [];
  if (v.skyline) {
    const clear = (x, y, a, h) => {
      const hw = (a + 6) * SQ, hd = hw * F;
      const cover = { l: x - hw, r: x + hw, t: y - hd - h, b: y + hd };
      return !nodes.some(p => inRect(p, cover, R + 26, R + 16, R + 44)) && !roadPts.some(p => inRect(p, cover, 24, 30, 40));
    };
    const fit = (x, y, a, want) => { for (let f = want; f >= 3; f--) if (clear(x, y, a, towerHeight(f))) return f; return 0; };
    for (const b of blocks) {
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
        const a = 44 + Math.floor(rnd() * 3) * 8;
        if (towers.some(t => Math.abs(t.x - x) < (t.a + a) * SQ + 8 && Math.abs(t.y - y) < (t.a + a) * SQ * F + 8)) continue;
        const floors = fit(x, y, a, Math.round(8 + rnd() * 8 + Math.max(0, behind) * 0.1));
        if (floors >= 4) towers.push({ x, y, a, floors, look: Math.floor(rnd() * 6), seed: Math.floor(rnd() * 1e6) });
      }
    }
    towers.sort((p, q) => p.y - q.y);
  }
  return { blocks, lamps, towers };
}

/** Roof height of a 3D tower with `floors` storeys, including cornices and roof plant (see 3d/facade.js). */
export function towerHeight(floors) {
  return 2.2 + floors * 8 + 3 * 1.6 + 12;
}
