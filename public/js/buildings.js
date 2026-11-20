// Base structures: three per faction plus a generic derelict set for neutral
// bases. Each builder fills a Model (authored back to front, never rotated)
// and lists the animated details that are drawn live over the baked sprite.
import { Model, F } from './iso.js';
import { FACTIONS } from './factions.js';
import { YARD } from './scenery.js';

const TAU = Math.PI * 2;
const S = Math.SQRT1_2;
export const BS = 1.38;                    // structures are drawn larger than modelled
export const BASE_LIFT = 1.6;              // height of the foundation slab a base stands on

const GUN = '#2c3035', STEEL = '#626a72', STEEL_D = '#474e56';
const WALL = '#8d8c7c', PANEL = '#7d848a', OLIVE = '#6b7050', KHAKI = '#a39a72';
const BLACK = '#131517', HAZ = '#e8b72c', GLASS_ON = '#ffe9a6', GLASS_OFF = '#2b3137';
const COPPER = '#b56a3a', WHITE_HOT = '#f3fbff';

/** Screen offset of a building-local point (matches the baked sprite). */
export function bp(x, y, z) {
  return [(x - y) * S * BS, ((x + y) * S * F - z) * BS - BASE_LIFT];
}

function slope(m, s, x0, x1, u0, u1, ye, ym, z0, z1, c) {
  const Y = u => ye + (ym - ye) * u, Z = u => z0 + (z1 - z0) * u + 0.02;
  const dy = ym - ye, dz = z1 - z0, l = Math.hypot(dy, dz);
  const n = dy < 0 ? [0, dz / l, -dy / l] : [0, -dz / l, dy / l];
  m.decal(s, [[x0, Y(u0), Z(u0)], [x1, Y(u0), Z(u0)], [x1, Y(u1), Z(u1)], [x0, Y(u1), Z(u1)]], c, n);
}

// ------------------------------------------------------------ shared shapes

/** Gabled hall. Used by the derelict barracks and the Meridian field barracks. */
function gableHall(m, o) {
  const { wall, roof, stripe, door, glass, lit } = o;
  const h = m.box(-16, 14, -12, 7, 0, 10, wall);
  m.onY(h, -16, 14, 0, 1.6, 7, '#5f5e54');
  m.onX(h, -12, 7, 0, 1.6, 14, '#5f5e54');
  m.onY(h, -4, 4, 0, 7.6, 7, BLACK);
  m.onY(h, -4.8, 4.8, 7.6, 8.9, 7, door);
  m.onY(h, -13, -8, 4.2, 7.2, 7, glass, lit);
  m.onY(h, 8, 12, 4.2, 7.2, 7, glass, lit);
  m.onX(h, -9, -4.5, 4.2, 7.2, 14, glass, lit);
  m.onX(h, -0.5, 4, 4.2, 7.2, 14, glass, lit);
  m.tag('corrugated');
  const r = m.ridge(-17.5, 15.5, -13.5, 8.5, 10, 16.5, roof, { gable: wall });
  m.tag(null);
  for (let x = -15; x < 15; x += 4) slope(m, r, x, x + 0.6, 0, 1, 8.5, -2.5, 10, 16.5, o.rib);
  slope(m, r, -17.5, 15.5, 0.62, 0.94, 8.5, -2.5, 10, 16.5, stripe);
  slope(m, r, -17.5, 15.5, 0.62, 0.94, -13.5, -2.5, 10, 16.5, stripe);
}

/** Industrial hall with a control tower and stack(s). Derelict depot / Iron tank works. */
function works(m, o) {
  const { wall, roof, band, glass, lit, tower, stacks } = o;
  const h = m.box(-19, 6, -15, 13, 0, 14, wall);
  m.onY(h, -19, 6, 0, 1.6, 13, '#555b60');
  m.onY(h, -16.3, 3.3, 0, 12.4, 13, band);
  m.onY(h, -15, 2, 0, 10.6, 13, '#2a2f35');                              // roller shutter
  for (let z = 0.9; z < 10.4; z += 1.15) m.onY(h, -14.8, 1.8, z, z + 0.32, 13, '#3d444b');
  for (let i = 0; i < 8; i++) m.onY(h, -15 + i * 2.125, -15 + (i + 1) * 2.125, 10.6, 12.4, 13, i % 2 ? BLACK : HAZ);
  m.onX(h, -5, 13, 0, 1.6, 6, '#555b60');
  m.onX(h, -2, 3, 6, 10, 6, glass, lit);
  m.onX(h, 6.5, 11.5, 6, 10, 6, glass, lit);
  m.onX(h, -5, 13, 2.6, 3.7, 6, STEEL_D);
  m.tag('roof');
  const r = m.box(-17.5, 4.5, -13.5, 11.5, 14, 16.5, roof);
  m.tag(null);
  for (const x of [-13.2, -3.2]) m.onTop(r, x, x + 5, -13.5, 11.5, 16.5, band);
  m.box(-14, -9, -9, -4, 16.5, 19.6, STEEL_D, { top: STEEL });
  m.box(-5, 0, 2, 7, 16.5, 18.8, STEEL_D, { top: STEEL });
  const t = m.box(6, 19, -19, -5, 0, 22, tower);
  m.onY(t, 10, 14, 0, 6.5, -5, BLACK);
  m.onY(t, 8, 17, 14.5, 17.5, -5, glass, lit);
  m.onY(t, 6, 19, 19.6, 22, -5, band);
  m.onX(t, -17, -7, 14.5, 17.5, 19, glass, lit);
  m.onX(t, -19, -5, 19.6, 22, 19, band);
  m.box(5, 20, -20, -4, 22, 23.2, GUN);
  for (const [x, y] of stacks) {
    m.cyl(x, y, 3, 23.2, 33, STEEL, { n: 8 });
    m.cyl(x, y, 3.7, 33, 34.6, GUN, { n: 8, top: BLACK });
  }
  m.cyl(13, 5, 5.4, 0, 8.5, o.tank, { n: 10, top: o.tankTop });
  m.cyl(13, 5, 2, 8.5, 9.6, GUN, { n: 6 });
  m.cyl(-9, 18.5, 2.2, 0, 4.6, '#7d4130', { n: 6 });
  m.cyl(-4.2, 19.6, 2.2, 0, 4.6, OLIVE, { n: 6 });
}

const PYLONS = [[-12, -12], [16.4, -4.4], [-4.4, 16.4]];

/** Crystal lab on pylons. Derelict lab / Meridian beam lab. */
function crystalLab(m, o) {
  const { plinth, plate, core, band, dome, tip, lit } = o;
  const py = ([x, y]) => {
    m.cyl(x, y, 4.2, 5.8, 7.6, band, { n: 6 });
    m.cyl(x, y, 3, 7.6, 25, STEEL_D, { n: 6, r1: 1.9 });
    m.cyl(x, y, 2.3, 25, 27.8, tip, { n: 6, glow: lit });
  };
  m.cyl(0, 0, 25, 0, 5, plinth, { n: 8, rot: Math.PI / 8, top: '#7b8186' });
  m.cyl(0, 0, 21, 5, 5.8, STEEL_D, { n: 8, rot: Math.PI / 8, top: plate });
  py(PYLONS[0]);
  const c = m.cyl(0, 0, 10.5, 5.8, 15, core, { n: 10 });
  m.onY(c, -2.4, 2.4, 5.8, 11, 10.5, BLACK);
  m.cyl(0, 0, 11.3, 11.4, 13.6, band, { n: 10 });
  m.cyl(0, 0, 10.5, 15, 19, dome, { n: 10, r1: 7.2 });
  m.cyl(0, 0, 7.2, 19, 21.6, o.cap, { n: 10, r1: 3.4 });
  m.cyl(0, 0, 1.4, 21.6, 31, GUN, { n: 6 });
  if (!lit) m.cyl(0, 0, 2.8, 31, 37, '#767c82', { n: 4, r1: 0.4 });
  py(PYLONS[1]);
  py(PYLONS[2]);
}

function sandbags(m) {
  const was = m.tag('sandbag');
  m.box(-15, -6, 10, 13, 0, 3, KHAKI);
  m.box(-14, -7, 10.4, 12.6, 3, 5, '#8f8763');
  m.box(6, 14, 10, 13, 0, 3, KHAKI);
  m.tag(was);
}

function flagPole(m, L) {
  m.box(16.6, 17.4, 10.1, 10.9, 0, 24, '#c9cdd1');
  L.push({ k: 'flag', at: [17, 10.5, 24] });
}


// ------------------------------------------------------------ construction kit
// Small parts shared by every faction's buildings and compounds. Each sets the
// surface type it is made of, so the 3D renderer textures it accordingly.

/** Box at any angle (a prism over a turned rectangle). hl, hw = half length, half width. */
function obox(m, cx, cy, hl, hw, ang, z0, z1, c, o) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const pt = (l, w) => [cx + l * cs - w * sn, cy + l * sn + w * cs];
  return m.prism([pt(-hl, -hw), pt(hl, -hw), pt(hl, hw), pt(-hl, hw)], z0, z1, c, o);
}

/** Roof ventilator: louvred box under a cap. */
function vent(m, x, y, z, s = 1, c = STEEL_D) {
  const was = m.tag('plating');
  const b = m.box(x - 2 * s, x + 2 * s, y - 2 * s, y + 2 * s, z, z + 2.6 * s, c);
  for (let k = 0; k < 3; k++) {
    m.onY(b, x - 1.6 * s, x + 1.6 * s, z + (0.5 + k * 0.7) * s, z + (0.8 + k * 0.7) * s, y + 2 * s, BLACK);
    m.onX(b, y - 1.6 * s, y + 1.6 * s, z + (0.5 + k * 0.7) * s, z + (0.8 + k * 0.7) * s, x + 2 * s, BLACK);
  }
  m.box(x - 2.4 * s, x + 2.4 * s, y - 2.4 * s, y + 2.4 * s, z + 2.6 * s, z + 3.2 * s, GUN);
  m.tag(was);
}

/** Air handler: low casing with a fan well. */
function acUnit(m, x, y, z, c = '#8b9197') {
  const was = m.tag('plating');
  const b = m.box(x - 2.6, x + 2.6, y - 1.8, y + 1.8, z, z + 2.2, c, { top: '#a2a8ad' });
  m.onY(b, x - 2.2, x + 2.2, z + 0.4, z + 1.8, y + 1.8, '#3a3f44');
  m.cyl(x, y, 1.3, z + 2.2, z + 2.5, BLACK, { n: 8 });
  m.tag(was);
}

/** Pipe along x or y at height z, with flanges. */
function pipe(m, x0, y0, x1, y1, z, r = 0.7, c = '#6d7379') {
  const was = m.tag('steel');
  const alongX = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  m.box(Math.min(x0, x1) - (alongX ? 0 : r), Math.max(x0, x1) + (alongX ? 0 : r), Math.min(y0, y1) - (alongX ? r : 0), Math.max(y0, y1) + (alongX ? r : 0), z - r, z + r, c);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
  for (let d = 2; d < len - 1; d += 7) {
    const x = alongX ? Math.min(x0, x1) + d : x0, y = alongX ? y0 : Math.min(y0, y1) + d;
    m.box(x - (alongX ? 0.4 : r + 0.4), x + (alongX ? 0.4 : r + 0.4), y - (alongX ? r + 0.4 : 0.4), y + (alongX ? r + 0.4 : 0.4), z - r - 0.4, z + r + 0.4, GUN);
  }
  m.tag(was);
}

/** Horizontal tank on saddles, axis along y. */
function tank(m, x, y0, y1, r, c, band) {
  const was = m.tag('plating');
  const oct = Array.from({ length: 8 }, (_, i) => { const a = (i + 0.5) / 8 * TAU; return [x + Math.cos(a) * r, r + 1.2 + Math.sin(a) * r]; });
  for (const y of [y0 + 1.5, y1 - 1.5]) m.box(x - r * 0.8, x + r * 0.8, y - 0.6, y + 0.6, 0, r + 1.2, GUN);
  m.profile(oct, y0, y1, c);
  if (band) m.profile(oct.map(([px, pz]) => [x + (px - x) * 1.06, r + 1.2 + (pz - r - 1.2) * 1.06]), (y0 + y1) / 2 - 1, (y0 + y1) / 2 + 1, band);
  m.tag(was);
}

function crates(m, x, y, c = OLIVE, n = 3) {
  const was = m.tag('panel');
  const at = [[0, 0, 0], [3.4, 0.4, 0], [1.4, 0.3, 3], [0.2, 3.6, 0], [3.8, 3.8, 0]];
  for (let i = 0; i < n; i++) {
    const [dx, dy, dz] = at[i % at.length];
    const b = m.box(x + dx, x + dx + 3, y + dy, y + dy + 3, dz, dz + 3, i % 2 ? KHAKI : c);
    m.onY(b, x + dx + 0.3, x + dx + 2.7, dz + 1.3, dz + 1.7, y + dy + 3, '#3d4034');
  }
  m.tag(was);
}

function drums(m, x, y, n = 3, c = '#7d4130') {
  const was = m.tag('plating');
  for (let i = 0; i < n; i++) {
    const dx = (i % 2) * 2.6, dy = Math.floor(i / 2) * 2.6;
    m.cyl(x + dx, y + dy, 1.2, 0, 3.4, i % 3 === 1 ? OLIVE : c, { n: 8, top: '#2b2e31' });
    m.cyl(x + dx, y + dy, 1.3, 1.5, 1.9, GUN, { n: 8 });
  }
  m.tag(was);
}

/** Lattice-style mast: a slim post with cross arms and a tip. */
function mast(m, x, y, z0, z1, tip = '#c9cdd1') {
  const was = m.tag('steel');
  m.box(x - 0.4, x + 0.4, y - 0.4, y + 0.4, z0, z1, '#4b5157');
  for (let z = z0 + (z1 - z0) * 0.45; z < z1 - 1; z += (z1 - z0) * 0.22) {
    m.box(x - 2.2, x + 2.2, y - 0.2, y + 0.2, z, z + 0.4, '#5b6268');
    m.box(x - 0.2, x + 0.2, y - 1.6, y + 1.6, z + 0.9, z + 1.3, '#5b6268');
  }
  m.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, z1, z1 + 1, tip);
  m.tag(was);
}

/** Floodlight pole. The lamp is pale, not glowing: light is reserved for windows and machinery. */
function floodlight(m, x, y, h) {
  const was = m.tag('steel');
  m.box(x - 0.45, x + 0.45, y - 0.45, y + 0.45, 0, h, '#454b51');
  m.box(x - 1.9, x + 1.9, y - 0.8, y + 0.8, h, h + 1.5, GUN, { top: '#30353a' });
  m.onY(m.box(x - 1.7, x + 1.7, y + 0.8, y + 1, h + 0.2, h + 1.3, '#d9dde0'), x - 1.7, x + 1.7, h + 0.2, h + 1.3, y + 1, '#e6e2cf');
  m.tag(was);
}

/** Emplaced gun: ring mount, shielded cradle, twin barrels along +x. */
function gunPit(m, x, y, z, M, tc) {
  const was = m.tag('panel');
  m.cyl(x, y, 3.6, z, z + 1.4, M.dark, { n: 8 });
  const g = m.box(x - 2.2, x + 2.4, y - 2.2, y + 2.2, z + 1.4, z + 4.2, M.hull, { top: M.lite });
  m.onTop(g, x - 1.6, x + 0.2, y - 1.4, y + 1.4, z + 4.2, tc.main);
  m.tag('steel');
  for (const dy of [-0.9, 0.9]) m.box(x + 2.4, x + 8.5, y + dy - 0.35, y + dy + 0.35, z + 2.6, z + 3.3, M.metal);
  m.tag(was);
}

/** A covered load: tarpaulin over a stack. */
function tarp(m, x0, x1, y0, y1, h, c = '#4c5646') {
  const was = m.tag('cloth');
  m.ridge(x0, x1, y0, y1, 0, h, c, { gable: c });
  m.tag(was);
}

/** A small utility truck parked in the yard, nose toward +x. */
function truck(m, x, y, c, tc) {
  let was = m.tag('dark');
  for (const dx of [1.2, 7.8]) for (const dy of [-0.3, 4.3]) m.box(x + dx, x + dx + 2, y + dy, y + dy + 0.9, 0, 2, '#17191b');
  m.tag('panel');
  const bed = m.box(x, x + 6.4, y, y + 4.9, 1.2, 4.6, c, { top: '#3d4239' });
  m.onY(bed, x + 0.5, x + 5.9, 2, 3.6, y + 4.9, tc.dark);
  const cab = m.box(x + 6.6, x + 10.6, y + 0.2, y + 4.7, 1.2, 5.4, c, { top: '#565c52' });
  m.onX(cab, y + 0.7, y + 4.2, 3.4, 5, x + 10.6, '#1c2228');
  m.onY(cab, x + 7.2, x + 9.6, 3.4, 5, y + 4.7, '#1c2228');
  m.tag(was);
}

// ------------------------------------------------------------ compounds
// Every base stands in a walled yard instead of on a round pad. The yard is a
// square turned 45 degrees (so its walls run along the paving), with a gate
// wherever one of the city's roads crosses the wall, corner works that grow
// with the base level, yard furniture, and the owner's colour on the wall
// coping, the gate banners and the corner flags.

const WALLS = {
  neutral:  { wall: '#74766f', cap: '#5b5d57', post: '#63655f', tag: 'concrete' },
  iron:     { wall: '#77746a', cap: '#4a4843', post: '#5d5a53', tag: 'concrete' },
  meridian: { wall: '#a9b3bb', cap: '#6f7a83', post: '#8a959e', tag: 'plating' },
  veil:     { wall: '#3b3446', cap: '#2a2531', post: '#544a66', tag: 'panel' },
};

/**
 * @param f      faction ('neutral' for unowned cities)
 * @param level  1..3
 * @param tc     team colour
 * @param gates  directions of the city's roads, as angles in the compound's own frame; null for
 *               the generic compound of the sprite renderer (corner works only, no walls to
 *               stand across a road)
 * @param ruin   the compound of a destroyed base: the same yard with its wall breached and
 *               burnt, no owner's colour, rubble where the yard furniture stood
 */
export function buildCompound(f, level, tc, gates, ruin = false) {
  const m = new Model();
  const W = ruin ? { wall: '#57534d', cap: '#2b2927', post: '#4a4641', tag: 'concrete' } : WALLS[f] || WALLS.neutral, M = f === 'neutral' ? null : FACTIONS[f].mat;
  const rnd = scatter(level * 7 + (gates ? gates.length * 3 : 0) + 1);
  const H = YARD, th = f === 'meridian' ? 1.1 : 1.7;
  const wh = f === 'neutral' ? 3.2 : [0, 3.4, 5.4, 7][level];
  const owned = f !== 'neutral' && !ruin;

  // Foundation the building stands on: two steps of poured concrete.
  m.tag('concrete');
  const fh = 30;
  m.box(-fh, fh, -fh, fh, 0, 0.8, '#6c6e6b', { top: ruin ? '#5a5955' : '#7d7f7b' });
  const slab = m.box(-fh + 2, fh - 2, -fh + 2, fh - 2, 0.8, BASE_LIFT, '#787a76', { top: ruin ? '#4b4945' : '#8a8c87' });
  if (ruin) { m.onTop(slab, -19, 16, -15, 18, BASE_LIFT, '#2b2927'); m.onTop(slab, 8, 24, -24, -10, BASE_LIFT, '#35322f'); }   // scorch
  if (owned) for (const [a, b] of [[-fh + 2, -fh + 5], [fh - 5, fh - 2]]) {     // painted corner chevrons in the owner's colour
    m.onTop(slab, a, b, -fh + 2, -fh + 12, BASE_LIFT, tc.main); m.onTop(slab, a, b, fh - 12, fh - 2, BASE_LIFT, tc.main);
  }

  // Where each road crosses the wall: side (0 +x, 1 +y, 2 -x, 3 -y), position along it, half-width of the opening.
  const openings = [[], [], [], []];
  for (const a of gates || []) {
    const cs = Math.cos(a), sn = Math.sin(a);
    const side = Math.abs(cs) >= Math.abs(sn) ? (cs > 0 ? 0 : 2) : (sn > 0 ? 1 : 3);
    const along = side % 2 === 0 ? H * sn / Math.abs(cs) : H * cs / Math.abs(sn);
    const slant = 1 / Math.max(0.5, side % 2 === 0 ? Math.abs(cs) : Math.abs(sn));
    openings[side].push({ at: Math.max(-H + 4, Math.min(H - 4, along)), half: Math.min(26, 15.5 * slant) });
  }

  // A stretch of wall along one side between u0 and u1.
  const place = (side, u, w) => (side === 0 ? [H + w, u] : side === 1 ? [u, H + w] : side === 2 ? [-H - w, u] : [u, -H - w]);
  const run = (side, u0, u1) => {
    if (u1 - u0 < 1.2) return;
    const [ax, ay] = place(side, u0, -th), [bx, by] = place(side, u1, th);
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    if (ruin) {                                                       // what the blast left: lengths of wall at any height, and breaches
      m.tag('concrete');
      const L = u1 - u0, n = Math.max(1, Math.round(L / 5));
      for (let i = 0; i < n; i++) {
        const k = rnd();
        if (k < 0.24) continue;
        const [cx0, cy0] = place(side, u0 + (i * L) / n, -th), [cx1, cy1] = place(side, u0 + ((i + 1) * L) / n, th);
        m.box(Math.min(cx0, cx1), Math.max(cx0, cx1), Math.min(cy0, cy1), Math.max(cy0, cy1), 0, 0.8 + wh * k * 0.95, W.wall, { top: W.cap });
      }
      return;
    }
    if (f === 'iron' && level === 1 || f === 'neutral' && level === 1) {            // sandbags
      m.tag('sandbag');
      m.box(x0 - 0.5, x1 + 0.5, y0 - 0.5, y1 + 0.5, 0, 2.2, KHAKI);
      m.box(x0, x1, y0, y1, 2.2, wh, '#8f8763');
      return;
    }
    m.tag(W.tag);
    const w = m.box(x0, x1, y0, y1, 0, wh, W.wall);
    m.tag('panel');
    m.box(x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, wh, wh + 0.7, owned ? tc.main : W.cap, { top: owned ? tc.dark : W.cap });   // coping in the owner's colour
    m.tag(W.tag);
    // Piers along the wall; veil walls get ribbed pylons instead.
    const horiz = side % 2 === 1;
    for (let u = u0 + 3; u < u1 - 2; u += f === 'veil' ? 7 : 9) {
      const [px, py] = place(side, u, 0);
      if (f === 'veil') m.cyl(px, py, 1.5, 0, wh + 2.2, W.post, { n: 6, r1: 0.7, top: owned ? tc.main : W.cap });
      else m.box(px - (horiz ? 0.8 : th + 0.5), px + (horiz ? 0.8 : th + 0.5), py - (horiz ? th + 0.5 : 0.8), py + (horiz ? th + 0.5 : 0.8), 0, wh + 0.2, W.post);
    }
    void w;
  };

  const sides = gates ? [0, 1, 2, 3] : [];
  for (const side of sides) {
    const ops = openings[side].sort((p, q) => p.at - q.at);
    let u = -H;
    for (const op of ops) {
      run(side, u, op.at - op.half);
      // Gate posts with a banner each, facing out.
      for (const g of [op.at - op.half, op.at + op.half]) {
        if (Math.abs(g) > H - 1) continue;
        const [px, py] = place(side, g, 0);
        m.tag(W.tag);
        if (ruin) { m.box(px - 1.9, px + 1.9, py - 1.9, py + 1.9, 0, 1.4 + rnd() * (wh + 2), W.post, { top: W.cap }); continue; }
        const post = m.box(px - 1.9, px + 1.9, py - 1.9, py + 1.9, 0, wh + 4, W.post, { top: W.cap });
        if (owned) {
          m.tag('cloth');
          if (side === 0) m.onX(post, py - 1.3, py + 1.3, wh - 1, wh + 3.4, px + 1.9, tc.main);
          else if (side === 1) m.onY(post, px - 1.3, px + 1.3, wh - 1, wh + 3.4, py + 1.9, tc.main);
          else if (side === 2) m.onX(post, py - 1.3, py + 1.3, wh - 1, wh + 3.4, px - 1.9, tc.main, false, -1);
          else m.onY(post, px - 1.3, px + 1.3, wh - 1, wh + 3.4, py - 1.9, tc.main, false, -1);
        }
        m.tag('steel');
        m.box(px - 0.5, px + 0.5, py - 0.5, py + 0.5, wh + 4, wh + 5.6, '#d8d3bd');     // gate lamp housing
      }
      u = op.at + op.half;
    }
    run(side, u, H);
  }

  // Corner works: stubs of wall at level 1, posts at 2, towers with a gun at 3.
  const corner = (sx, sy) => {
    const cx = sx * H, cy = sy * H;
    const blocked = (gates || []).length && [0, 1, 2, 3].some(side => openings[side].some(op => {
      const [px, py] = place(side, op.at, 0);
      return Math.hypot(px - cx, py - cy) < op.half + 7;
    }));
    if (blocked) return;
    if (!gates) {                                                     // sprite renderer: wall stubs so the yard still reads as enclosed
      m.tag(W.tag);
      m.box(Math.min(cx, cx - sx * 13), Math.max(cx, cx - sx * 13), cy - th, cy + th, 0, wh, W.wall, { top: owned ? tc.main : W.cap });
      m.box(cx - th, cx + th, Math.min(cy, cy - sy * 13), Math.max(cy, cy - sy * 13), 0, wh, W.wall, { top: owned ? tc.main : W.cap });
    }
    m.tag(W.tag);
    if (ruin) { m.box(cx - 2.6, cx + 2.6, cy - 2.6, cy + 2.6, 0, 1 + rnd() * (wh + 3), W.post, { top: W.cap }); return; }
    if (level === 1 || f === 'neutral') {
      m.box(cx - 2.4, cx + 2.4, cy - 2.4, cy + 2.4, 0, wh + 1.2, W.post, { top: W.cap });
    } else if (f === 'veil') {
      m.cyl(cx, cy, 3.6, 0, wh + 2, W.post, { n: 8, r1: 2.6 });
      m.cyl(cx, cy, 2.6, wh + 2, wh + (level === 3 ? 9 : 5), M.hull, { n: 8, r1: 0.9, top: tc.main });
    } else {
      const th2 = level === 3 ? 5 : 3.6, top = wh + (level === 3 ? 6 : 2.4);
      const t = m.box(cx - th2, cx + th2, cy - th2, cy + th2, 0, top, W.post);
      m.onY(t, cx - th2 + 1, cx + th2 - 1, top - 2.6, top - 1.4, cy + th2, BLACK);
      m.onX(t, cy - th2 + 1, cy + th2 - 1, top - 2.6, top - 1.4, cx + th2, BLACK);
      m.tag('roof');
      m.box(cx - th2 - 0.8, cx + th2 + 0.8, cy - th2 - 0.8, cy + th2 + 0.8, top, top + 1, f === 'meridian' ? M.hull : M.dark, { top: tc.main });
      if (level === 3) {
        m.tag('steel');
        m.cyl(cx, cy, 1.6, top + 1, top + 2.6, M.metal, { n: 8 });
        m.box(cx + (sx > 0 ? 0 : -6), cx + (sx > 0 ? 6 : 0), cy - 0.4, cy + 0.4, top + 1.6, top + 2.3, M.metal);
      }
    }
    if (owned && (level > 1 || sx + sy === 2)) {                      // flag staff
      m.tag('steel');
      m.box(cx - 0.3, cx + 0.3, cy - 0.3, cy + 0.3, 0, wh + 13, '#c9cdd1');
      m.tag('cloth');
      m.box(cx + 0.3, cx + 5.6, cy - 0.15, cy + 0.15, wh + 9.4, wh + 13, tc.main);
      m.box(cx + 0.3, cx + 5.6, cy - 0.2, cy + 0.2, wh + 10.6, wh + 11.6, tc.light);
    }
  };
  // back to front for the sprite renderer
  corner(-1, -1); corner(1, -1); corner(-1, 1); corner(1, 1);

  // Yard furniture, in the two rear quarters and beside the front, clear of the slab.
  const free = (x, y) => !(gates || []).some(a => { const d = Math.abs(x * Math.sin(a) - y * Math.cos(a)); return d < 17 && x * Math.cos(a) + y * Math.sin(a) > 0; });
  const Y0 = -H + 4.5, X0 = -H + 4.5;
  if (ruin) {
    m.tag('concrete');
    for (let i = 0; i < 12; i++) {                                    // rubble thrown across the yard
      const x = -H + 4 + rnd() * (2 * H - 8), y = -H + 4 + rnd() * (2 * H - 8), sz = 1.2 + rnd() * 2.4;
      if (Math.max(Math.abs(x), Math.abs(y)) < fh + 1 || !free(x, y)) continue;
      m.cyl(x, y, sz, 0, sz * (0.5 + rnd() * 0.5), i % 3 ? '#6f6a61' : '#5b463c', { n: 5, r1: sz * 0.4, rot: rnd() * 6 });
    }
  } else if (f === 'iron') {
    if (free(-20, Y0)) { crates(m, -22, Y0, OLIVE, 4); drums(m, -12, Y0 + 0.5, 4); }
    if (free(14, Y0)) tarp(m, 10, 22, Y0, Y0 + 6, 4.4);
    if (free(X0, 16) && level > 1) truck(m, X0, 12, '#5b5e4c', tc);
    if (free(X0, -14)) floodlight(m, X0 - 1, -14, 15);
    if (level === 3 && free(20, 34)) { for (const [x, y] of [[14, 35], [22, 36], [30, 34]]) { m.tag('steel'); obox(m, x, y, 2.8, 0.5, 0.8, 0, 3.2, GUN); obox(m, x, y, 2.8, 0.5, -0.8, 0, 3.2, '#3a3f44'); } }
  } else if (f === 'meridian') {
    if (free(-20, Y0)) { m.tag('plating'); for (let i = 0; i < 3; i++) { const b = m.box(-24 + i * 6, -19.5 + i * 6, Y0, Y0 + 4, 0, 3.6, '#c9d1d7', { top: '#e3e9ed' }); m.onY(b, -23.4 + i * 6, -20.1 + i * 6, 1.4, 2.2, Y0 + 4, tc.main); } }
    if (free(16, Y0)) tank(m, 16, Y0, Y0 + 9, 2.4, '#dfe6ea', tc.main);
    if (free(X0, 14)) truck(m, X0, 10, '#a9b3bb', tc);
    if (free(X0, -14)) mast(m, X0, -14, 0, level * 7 + 10, '#7fd0ff');
    if (level > 1 && free(30, 30)) floodlight(m, 33, 30, 14);
  } else if (f === 'veil') {
    for (const [x, y, r] of [[-22, Y0 + 2, 2.6], [-15, Y0 + 1.4, 1.9], [18, Y0 + 2, 2.2]]) if (free(x, y)) {
      m.tag('panel'); m.cyl(x, y, r, 0, r * 1.7, M.dark, { n: 8, r1: r * 0.7 });
      m.tag('glass'); m.cyl(x, y, r * 0.7, r * 1.7, r * 1.7 + 0.5, M.lite, { n: 8 });
    }
    if (free(X0, 14)) { m.tag('panel'); for (let i = 0; i < 3; i++) m.cyl(X0 + 1, 8 + i * 6, 1.3, 0, 6 + i * 2.5, M.hull, { n: 5, r1: 0.4, top: tc.main }); }
    if (free(X0, -16)) { m.tag('steel'); m.box(X0 - 0.3, X0 + 0.3, -16.3, -15.7, 0, 16, M.metal); m.box(X0 - 1, X0 + 1, -17, -15, 16, 17.2, M.lite); }
  } else {
    if (free(-20, Y0)) { m.tag('concrete'); m.box(-24, -15, Y0, Y0 + 3, 0, 1.6, '#62645f'); m.box(-12, -8, Y0 + 1, Y0 + 4, 0, 2.6, '#6d6f69'); }
    if (free(X0, 14)) drums(m, X0, 12, 3, '#5f5a50');
    if (free(18, Y0)) crates(m, 16, Y0, '#6a6c60', 2);
  }
  m.tag(null);
  // (Surfaces used to be folded together here to save draw calls; with every surface in one
  // material a compound is a single draw call whatever it is made of, so each keeps its own.)
  return m;
}

// ------------------------------------------------------------ neutral (derelict)

const NEUTRAL_SET = {
  1(m, tc) {
    gableHall(m, { wall: WALL, roof: tc.main, stripe: tc.light, rib: tc.dark, door: tc.main, glass: GLASS_OFF });
    m.box(-11, -8, -5, -2, 13, 18.4, STEEL_D);
    m.box(16, 22, -8, -2, 0, 5, OLIVE);
    sandbags(m);
    return 24;
  },
  2(m, tc) {
    works(m, { wall: PANEL, roof: tc.main, band: tc.dark, glass: GLASS_OFF, tower: '#5b636b', stacks: [[12.5, -12]], tank: tc.dark, tankTop: tc.main });
    return 34;
  },
  3(m, tc) {
    crystalLab(m, { plinth: '#5f656b', plate: tc.main, core: STEEL, band: tc.main, dome: tc.main, cap: tc.light, tip: '#6a7076' });
    return 37;
  },
};

// ------------------------------------------------------------ Iron Pact

const IRON_SET = {
  // Conscript bunker: poured concrete, slab roof, watch post.
  1(m, tc, M, A, sub, L) {
    const wall = '#7c7970';
    const h = m.box(-16, 13, -13, 8, 0, 9, wall);
    m.onY(h, -16, 13, 0, 1.6, 8, '#55534c');
    m.onX(h, -13, 8, 0, 1.6, 13, '#55534c');
    m.onY(h, -3, 4, 0, 7, 8, M.metal);
    m.onY(h, -3.8, 4.8, 7, 8.3, 8, tc.main);
    m.onY(h, -13, -7, 5, 6.3, 8, BLACK);
    m.onY(h, 7, 11, 5, 6.3, 8, BLACK);
    m.onX(h, -10, -4, 5, 6.3, 13, BLACK);
    m.onX(h, 0, 5, 5, 6.3, 13, BLACK);
    const r = m.box(-18, 15, -15, 10, 9, 11.8, M.dark, { top: M.hull });
    m.onTop(r, -15, -5, -12, 7, 11.8, tc.main);                         // team roof marking
    m.onTop(r, -15, -5, -3.6, -1.4, 11.8, tc.light);
    m.cyl(-12, -9, 1.5, 11.8, 18, M.metal, { n: 6, top: BLACK });       // stove pipe
    const t = m.box(4, 13, -13, -5, 11.8, 19.5, wall);                  // watch post
    m.onY(t, 5.4, 11.6, 15.6, 17.8, -5, GLASS_ON, true);
    m.onX(t, -11.6, -6.4, 15.6, 17.8, 13, GLASS_ON, true);
    m.box(3, 14, -14, -4, 19.5, 20.8, M.dark);
    sandbags(m);
    flagPole(m, L);
    L.push({ k: 'smoke', at: [-12, -9, 18.5], size: 0.7 });
    return 25;
  },
  // Tank works: the heaviest industrial silhouette, twin stacks.
  2(m, tc, M, A, sub, L) {
    works(m, { wall: '#7a776d', roof: M.hull, band: tc.main, glass: GLASS_ON, lit: true, tower: '#615e56', stacks: [[10, -15], [15.5, -9.5]], tank: M.dark, tankTop: tc.main });
    // Heavy turret on the hall roof: the level-2 city ability, visible as hardware.
    m.cyl(-6, 5, 4.6, 16.5, 18.2, M.dark, { n: 8 });
    const tur = m.box(-10, -2, 1.5, 8.5, 18.2, 21.6, M.hull, { top: M.lite });
    m.onTop(tur, -8.6, -4.6, 3, 7, 21.6, tc.main);
    m.box(-2, 11, 4, 6, 19, 20.8, M.metal);
    m.box(9.5, 12.5, 3.4, 6.6, 18.5, 21.3, '#34383c');
    L.push({ k: 'smoke', at: [10, -15, 35], size: 1.1, dark: true }, { k: 'smoke', at: [15.5, -9.5, 35], size: 1.1, dark: true }, { k: 'beacon', at: [20, -4, 24] });
    return 35;
  },
  // Siege arsenal: furnace block with a roof-mounted heavy weapon.
  3(m, tc, M, A, sub, L) {
    m.cyl(0, 0, 25, 0, 5, '#5c5a55', { n: 8, rot: Math.PI / 8, top: '#75736c' });
    const b = m.box(-15, 9, -13, 11, 5, 17, M.hull);
    m.onY(b, -11, 3, 5, 12.6, 11, BLACK);
    m.onY(b, -9.4, 1.4, 5.6, 10, 11, '#ff8a2a', true);                  // furnace mouth
    m.onY(b, -15, 9, 14.6, 17, 11, tc.main);
    m.onX(b, -13, 11, 14.6, 17, 9, tc.main);
    m.onX(b, -9, -3, 7, 11, 9, GLASS_ON, true);
    m.onX(b, 2, 8, 7, 11, 9, GLASS_ON, true);
    const r = m.box(-16, 10, -14, 12, 17, 18.6, M.dark, { top: M.hull });
    m.onTop(r, -14, -6, 2, 10, 18.6, tc.main);
    for (const y of [-9.5, -2]) {
      m.cyl(-10.5, y, 3, 18.6, 31, M.metal, { n: 8 });
      m.cyl(-10.5, y, 3.7, 31, 32.6, '#1c1d1f', { n: 8, top: BLACK });
      L.push({ k: 'smoke', at: [-10.5, y, 33], size: 1.2, dark: true });
    }
    if (sub === 'volt') {                                               // storm coil
      m.cyl(2, 3, 4.8, 18.6, 21, M.metal, { n: 8 });
      m.cyl(2, 3, 1.3, 21, 35, M.metal, { n: 6 });
      for (let i = 0; i < 4; i++) m.cyl(2, 3, 4.2 - i * 0.6, 22 + i * 3, 23.6 + i * 3, COPPER, { n: 8 });
      m.cyl(2, 3, 2.8, 35, 38.2, '#bfeaff', { n: 6, glow: true, top: WHITE_HOT });
      L.push({ k: 'glow', at: [2, 3, 36.6], r: 9, col: '#7fd8ff' }, { k: 'arcs', at: [2, 3, 36.6], to: [[-10.5, -9.5, 32.6], [-10.5, -2, 32.6], [9, 11, 17]], col: '#bfeaff' });
      return 40;
    }
    m.box(-3, 6, -1, 7, 18.6, 22.4, M.dark, { top: M.hull });            // gun mount
    m.box(4, 21, 1.4, 4.6, 19.4, 22.4, M.metal);                        // siege barrel
    m.box(19, 23, 0.6, 5.4, 18.6, 23.2, '#34383c');
    L.push({ k: 'glow', at: [-4, 11.5, 8], r: 7, col: '#ff8a2a' });
    return 34;
  },
};

// ------------------------------------------------------------ Meridian Alliance

const MERIDIAN_SET = {
  // Field barracks: clean prefab hall with a dish.
  1(m, tc, M, A, sub, L) {
    gableHall(m, { wall: M.lite, roof: M.hull, stripe: tc.main, rib: M.dark, door: tc.main, glass: '#bfe9ff', lit: true });
    m.box(8, 8.6, -3, -2.4, 16, 28, GUN);                               // whip aerial
    m.cyl(-9, -4, 0.9, 14, 19, GUN, { n: 4 });                          // dish post
    m.cyl(-9, -4, 4.6, 19, 20.2, M.lite, { n: 8, r1: 3, top: '#e8eef2' });
    m.box(16, 22, -8, -2, 0, 4.4, M.lite, { top: '#e8eef2' });          // sealed cases
    m.box(17, 21, -7, -3, 4.4, 7.4, tc.main);
    m.box(-14, -6, 10, 12, 0, 2.4, M.dark);                             // kerbs, not sandbags
    m.box(6, 14, 10, 12, 0, 2.4, M.dark);
    flagPole(m, L);
    L.push({ k: 'beacon', at: [8.3, -2.7, 28], col: '#7fd0ff' });
    return 26;
  },
  // Motor pool: glazed hangar, gantry and a radar tower.
  2(m, tc, M, A, sub, L) {
    const h = m.box(-19, 6, -15, 13, 0, 12, M.lite);
    m.onY(h, -19, 6, 0, 1.4, 13, M.dark);
    m.onY(h, -15, 2, 0, 9, 13, '#1a2026');
    m.onY(h, -15, 2, 9, 11, 13, '#bfe9ff', true);                       // clerestory glass
    for (const x of [-10.8, -6.5, -2.2]) m.onY(h, x, x + 0.5, 0, 9, 13, M.dark);
    m.onY(h, -17.4, -15.4, 0, 12, 13, tc.main);
    m.onY(h, 2.4, 4.4, 0, 12, 13, tc.main);
    m.onX(h, -4, 12, 5, 9, 6, '#bfe9ff', true);
    const r = m.box(-20, 7, -16, 14, 12, 13.4, M.hull, { top: '#aab4bb' });
    m.onTop(r, -18, 5, -2, 2, 13.4, tc.main);                           // team roof stripe
    m.onTop(r, -18, -14, -14, 12, 13.4, tc.main);
    m.box(-12, -6, -10, -5, 13.4, 15.6, M.dark, { top: M.metal });      // chillers
    m.box(-2, 3, 4, 9, 13.4, 15.2, M.dark, { top: M.metal });
    const t = m.box(9, 17, -17, -9, 0, 24, M.hull);                     // slim tower
    m.onY(t, 9, 17, 19, 22.4, -9, '#bfe9ff', true);
    m.onX(t, -17, -9, 19, 22.4, 17, '#bfe9ff', true);
    m.onY(t, 9, 17, 15.4, 17, -9, tc.main);
    m.onX(t, -17, -9, 15.4, 17, 17, tc.main);
    m.box(8, 18, -18, -8, 24, 25.2, M.dark);
    m.cyl(13, -13, 1, 25.2, 29, GUN, { n: 4 });
    m.cyl(12.5, 6, 4.6, 0, 7, '#e8eef2', { n: 10, top: M.lite });       // white fuel cells
    m.cyl(12.5, 6, 4.9, 3, 4.2, tc.main, { n: 10 });
    m.box(-19.6, -18.4, 14, 15.2, 0, 13, M.dark);                       // gantry legs + beam
    m.box(5.4, 6.6, 14, 15.2, 0, 13, M.dark);
    m.box(-19.6, 6.6, 14, 15.2, 13, 14.6, HAZ);
    L.push({ k: 'radar', at: [13, -13, 29.6] }, { k: 'beacon', at: [-6.5, 14.6, 15.2], col: '#7fd0ff' });
    return 31;
  },
  // Beam lab: crystal on three pylons.
  3(m, tc, M, A, sub, L) {
    crystalLab(m, { plinth: '#8b949b', plate: tc.main, core: M.hull, band: tc.main, dome: M.lite, cap: tc.light, tip: M.glow, lit: true });
    L.push({ k: 'crystal', at: [0, 0, 38], tips: PYLONS.map(p => [p[0], p[1], 28]) });
    return 44;
  },
};

// ------------------------------------------------------------ Veil Collective

function dome(m, x, y, r, z0, h, M, o = {}) {
  const sy = o.sy || 1, n = o.n || 12;
  if (o.girdle) {                                                       // team band low on the shell
    m.cyl(x, y, r, z0, z0 + h * 0.18, M.dark, { n, sy });
    m.cyl(x, y, r * 1.02, z0 + h * 0.18, z0 + h * 0.3, o.girdle, { n, sy });
    m.cyl(x, y, r, z0 + h * 0.3, z0 + h * 0.42, M.hull, { n, sy, r1: r * 0.93 });
  } else {
    m.cyl(x, y, r, z0, z0 + h * 0.42, M.hull, { n, sy, r1: r * 0.93 });
  }
  m.cyl(x, y, r * 0.93, z0 + h * 0.42, z0 + h * 0.78, M.lite, { n, sy, r1: r * 0.66, top: M.hull });
  m.cyl(x, y, r * 0.66, z0 + h * 0.78, z0 + h, M.hull, { n, sy, r1: r * 0.26, top: o.cap || M.lite });
}

function antenna(m, L, x, y, z0, z1, col) {
  m.box(x - 0.35, x + 0.35, y - 0.35, y + 0.35, z0, z1, '#17141b');
  m.box(x - 0.9, x + 0.9, y - 0.9, y + 0.9, z1, z1 + 1.6, col, { top: WHITE_HOT });
  L.push({ k: 'glow', at: [x, y, z1 + 0.8], r: 3.2, col });
}

const VEIL_SET = {
  // Thrall den: ribbed dome with an antenna crown.
  1(m, tc, M, A, sub, L) {
    dome(m, -11, -9, 6.5, 0, 9, M);                                     // rear pod
    dome(m, 0, 0, 16, 0, 15, M, { cap: tc.main, girdle: tc.main });
    const d = m.box(-3.4, 3.4, 13.4, 16.4, 0, 8.4, M.dark, { top: M.hull });   // porch
    m.onY(d, -2.4, 2.4, 0, 7, 16.4, '#1a0f24');
    m.onY(d, -1.6, 1.6, 0.6, 6.2, 16.4, M.glow, true);
    antenna(m, L, -5, -4, 13, 24, A);
    antenna(m, L, 4, -5, 13, 21, A);
    antenna(m, L, 1, 4, 14, 26, M.glow);
    m.cyl(15, 9, 3, 0, 5, M.dark, { n: 8, r1: 2 });                     // spore vats
    m.cyl(15, 9, 2, 5, 6, M.glow, { n: 8, glow: true });
    L.push({ k: 'glow', at: [0, 16.4, 4], r: 6, col: M.glow });
    return 28;
  },
  // Graft works: oval shell, round gate, twin coil towers.
  2(m, tc, M, A, sub, L) {
    for (const [x, y] of [[-13, -12], [12, -13]]) {                     // coil towers behind
      m.cyl(x, y, 3.4, 0, 6, M.dark, { n: 8 });
      m.cyl(x, y, 1.2, 6, 26, M.metal, { n: 6 });
      for (let i = 0; i < 4; i++) m.cyl(x, y, 3.2 - i * 0.4, 8 + i * 4.2, 9.6 + i * 4.2, i % 2 ? M.lite : tc.main, { n: 8 });
      m.cyl(x, y, 2, 26, 28.4, M.glow, { n: 6, glow: true });
      L.push({ k: 'glow', at: [x, y, 27.2], r: 5, col: M.glow });
    }
    m.cyl(0, 0, 19, 0, 2.6, M.dark, { n: 14, sy: 0.74 });
    m.cyl(0, 0, 19.4, 2.6, 4.6, tc.main, { n: 14, sy: 0.74 });          // team girdle
    m.cyl(0, 0, 19, 4.6, 7, M.hull, { n: 14, sy: 0.74, r1: 18 });
    m.cyl(0, 0, 18, 7, 12, M.lite, { n: 14, sy: 0.74, r1: 13.5, top: M.hull });
    m.cyl(0, 0, 13.5, 12, 15, M.hull, { n: 14, sy: 0.74, r1: 6, top: tc.main });
    const g = m.box(-6, 6, 12, 15.4, 0, 11, M.dark, { top: M.hull });   // gatehouse
    m.onY(g, -4.6, 4.6, 0, 9.4, 15.4, '#1a0f24');
    m.onY(g, -3.4, 3.4, 0.8, 8.2, 15.4, M.glow, true);
    m.onY(g, -6, 6, 9.4, 11, 15.4, tc.main);
    m.cyl(-17, 6, 2.6, 0, 9, '#6b5540', { n: 8, top: '#8c7256' });      // reagent tanks
    m.cyl(16, 7, 3.2, 0, 7, '#6b5540', { n: 8, top: '#8c7256' });
    L.push({ k: 'glow', at: [0, 15.4, 5], r: 8, col: M.glow }, { k: 'arcs', at: [-13, -12, 27.2], to: [[12, -13, 27.2]], col: M.glow });
    return 33;
  },
  // Mind spire: twisted tower with a floating focus.
  3(m, tc, M, A, sub, L) {
    m.cyl(0, 0, 24, 0, 4.4, M.dark, { n: 10, top: M.hull });
    m.cyl(0, 0, 20, 4.4, 5.4, tc.main, { n: 10 });
    for (const [x, y] of [[-13, -11], [15, -6], [-6, 15]]) antenna(m, L, x, y, 5.4, 17, A);
    let r = 12;
    for (let i = 0; i < 6; i++) {                                       // each tier turned a little
      const z = 5.4 + i * 4.6, r1 = r * 0.82;
      m.cyl(0, 0, r, z, z + 4.6, i % 2 ? M.lite : M.hull, { n: 6, rot: i * 0.42, r1 });
      if (i === 1 || i === 3) m.cyl(0, 0, r1 + 0.5, z + 3.4, z + 4.8, tc.main, { n: 6, rot: i * 0.42 });
      r = r1;
    }
    m.cyl(0, 0, 1.2, 33, 37, '#17141b', { n: 6 });
    L.push({ k: 'orb', at: [0, 0, 43], r: 5.4, col: M.glow, core: A });
    return 50;
  },
};

// ------------------------------------------------------------ subfaction add-ons
// One distinctive emplacement beside every structure of that subfaction.

const ADDON = {
  bastion(m, tc, M, A) {                                                // armour wall + hedgehogs
    const w = m.box(17, 24, -1, 1, 0, 6.4, M.dark, { top: M.hull });
    m.onX(w, -1, 1, 2, 4.6, 24, tc.main);
    m.onY(w, 18, 23, 2, 4.6, 1, tc.main);
    for (const [x, y] of [[20, 7], [24, 12]]) {
      m.box(x - 2.6, x + 2.6, y - 0.5, y + 0.5, 0, 1.2, GUN);
      m.box(x - 0.5, x + 0.5, y - 2.6, y + 2.6, 0, 1.2, GUN);
      m.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, 0, 4.4, '#5a5f66');
    }
  },
  volt(m, tc, M, A, L) {                                                // field coil
    m.cyl(21, 5, 2.8, 0, 3, M.dark, { n: 8 });
    m.cyl(21, 5, 0.9, 3, 13, M.metal, { n: 6 });
    for (let i = 0; i < 3; i++) m.cyl(21, 5, 2.4 - i * 0.4, 4 + i * 2.8, 5.4 + i * 2.8, COPPER, { n: 8 });
    m.cyl(21, 5, 1.8, 13, 15.2, '#bfeaff', { n: 6, glow: true });
    L.push({ k: 'glow', at: [21, 5, 14], r: 5, col: A }, { k: 'spark', at: [21, 5, 14], col: '#bfeaff' });
  },
  shade(m, tc, M, A, L) {                                               // sensor mast under netting
    m.box(18, 25, -1, 6, 0, 3.4, '#3b443b', { top: '#4f5a4c' });
    m.box(21.2, 21.8, 2.2, 2.8, 3.4, 17, GUN);
    m.cyl(21.5, 2.5, 2.6, 17, 18, M.dark, { n: 8, r1: 1.6, top: A });
    L.push({ k: 'beacon', at: [21.5, 2.5, 18.6], col: A });
  },
  aegis(m, tc, M, A, L) {                                               // shield projector
    m.cyl(21, 4, 3.6, 0, 3.4, M.dark, { n: 8 });
    m.cyl(21, 4, 2.8, 3.4, 6.4, '#dff3ff', { n: 8, r1: 1.2, glow: true });
    L.push({ k: 'shield', col: '#dff3ff' });
  },
  dominion(m, tc, M, A, L) {                                            // psychic obelisk
    m.cyl(21, 4, 2.8, 0, 14, M.hull, { n: 4, rot: Math.PI / 4, r1: 1.3, top: M.lite });
    m.cyl(21, 4, 1.6, 14, 16, A, { n: 4, rot: Math.PI / 4, glow: true });
    L.push({ k: 'waves', at: [21, 4, 16], col: A });
  },
  forge(m, tc, M, A, L) {                                               // rotary crane
    m.cyl(21, 4, 2.6, 0, 9, '#6b5540', { n: 8, top: '#8c7256' });
    m.box(15, 21.6, 3.4, 4.6, 9, 10.6, M.metal);
    m.box(15, 16.2, 3.4, 4.6, 4.6, 9, M.metal);
    L.push({ k: 'gear', at: [21, 4, 10.6], r: 4.2, col: A });
  },
};


// ------------------------------------------------------------ fittings
// What turns a massing model into a facility: entrances, roof plant, pipe runs,
// aerials, emplacements. One pass per faction and level, added after the main
// structure (on its roofs and its camera-facing sides, so the sprite renderer's
// back-to-front order still holds).

/** Entrance on a wall facing +y: steps, a framed door and a canopy. */
function entrance(m, x0, x1, y, h, c, lintel) {
  let was = m.tag('concrete');
  m.box(x0 - 1.4, x1 + 1.4, y, y + 3.2, 0, 0.7, '#6f716c', { top: '#84867f' });
  m.box(x0 - 0.7, x1 + 0.7, y, y + 1.8, 0.7, 1.3, '#787a74', { top: '#8a8c85' });
  m.tag('panel');
  m.box(x0 - 0.9, x1 + 0.9, y, y + 2.6, h, h + 0.7, lintel);
  m.tag('steel');
  for (const x of [x0 - 0.6, x1 + 0.6]) m.box(x - 0.25, x + 0.25, y + 2.1, y + 2.6, 1.3, h, c);
  m.tag(was);
}

const DETAIL = {
  neutral: {
    1(m) {
      entrance(m, -4, 4, 7, 8.2, '#4f5459', '#5c5e58');
      m.tag('concrete'); m.box(8, 13, 9, 12, 0, 1.4, '#66665f'); m.box(9.5, 12, 9.6, 11.4, 1.4, 2.4, '#72726a');     // rubble
      vent(m, 2, -6, 14.6, 0.8);
    },
    2(m) {
      vent(m, -2, -6, 16.5); vent(m, -12, 6, 16.5, 0.9);
      pipe(m, 6.6, 5, 8, 5, 6.4, 0.6, '#6a5a4a');
      m.tag('corrugated'); m.box(-16, 3, 13, 16.4, 10.8, 11.5, '#5a5f63', { top: '#6b7075' });
      m.tag('steel'); for (const x of [-15.4, 2.4]) m.box(x - 0.3, x + 0.3, 15.8, 16.4, 0, 10.8, '#3f4449');
    },
    3(m) {
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; m.tag('concrete'); obox(m, Math.cos(a) * 22.6, Math.sin(a) * 22.6, 2.6, 0.9, a, 0, 6.4, '#585d62'); }
      m.tag('steel'); m.box(-1.2, 1.2, 10.5, 14, 5.8, 6.6, '#4a4f54');
    },
  },
  iron: {
    1(m, tc, M) {
      entrance(m, -3, 4, 8, 8.4, M.metal, M.dark);
      m.tag('concrete');
      for (const y of [-11, -3, 5]) m.box(13, 14.6, y, y + 1.8, 0, 7.4, '#6a675f');             // buttresses
      vent(m, -7, 2, 11.8, 0.9);
      m.tag('sandbag'); m.box(-17, -11, 4, 9.6, 11.8, 13.4, KHAKI);                             // roof post
      m.tag('steel'); m.cyl(8.5, -9, 1.5, 20.8, 22.6, '#2f3338', { n: 8, top: '#d8d3bd' });     // searchlight
      mast(m, -15.5, -12.5, 11.8, 23);
      pipe(m, -15, 8.7, -6, 8.7, 2.4, 0.6);
      m.tag('plating');                                                                         // generator
      const gen = m.box(6.5, 12.5, 8.6, 12.4, 0, 4.4, '#4f5a44', { top: '#5f6a52' });
      for (let k = 0; k < 3; k++) m.onY(gen, 7.2, 11.8, 1 + k * 1, 1.5 + k * 1, 12.4, BLACK);
      m.tag('steel'); m.cyl(11.2, 9.6, 0.6, 4.4, 7.4, '#2b2e31', { n: 6 });
    },
    2(m, tc, M) {
      m.tag('glass');
      for (const y of [-11.5, 0.5]) { const sk = m.box(-16, 3, y, y + 2.4, 16.5, 17.5, '#2c3742', { top: '#3b4a59' }); m.onY(sk, -16, 3, 16.6, 17.4, y + 2.4, '#55697c'); }   // roof lights
      vent(m, -9, 8, 16.5, 0.9); vent(m, 1, -3, 16.5, 0.8);
      mast(m, 7.5, -17.5, 23.2, 35);
      m.tag('corrugated'); m.box(-16.6, 3.6, 13, 17, 12.4, 13.1, M.dark, { top: '#56524c' });   // loading canopy
      m.tag('steel');
      for (const x of [-16, 3]) m.box(x - 0.35, x + 0.35, 16.2, 16.9, 0, 12.4, M.metal);
      pipe(m, 6.6, 3.6, 8.4, 3.6, 7.2, 0.7, '#7d4130');                                         // feed line to the tank
      m.box(8, 8.8, 3.2, 4, 0, 7.2, M.metal);
      for (const [x, y] of [[10, -15], [15.5, -9.5]]) { m.cyl(x, y, 3.25, 26, 26.8, tc.main, { n: 8 }); m.cyl(x, y, 3.25, 28.4, 29.2, '#d8d8d2', { n: 8 }); }   // stack bands
      m.tag('panel'); crates(m, -18, 14.2, OLIVE, 3);
    },
    3(m, tc, M, A, sub) {
      m.tag('plating');
      for (let k = 0; k < 5; k++) m.box(9, 13.4, -11 + k * 4.4, -9.4 + k * 4.4, 5, 14, '#55524c');   // cooling fins
      pipe(m, 9.6, 10.6, 9.6, 12.4, 13, 0.8, '#7d4130');
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; m.tag('concrete'); obox(m, Math.cos(a) * 23, Math.sin(a) * 23, 2.4, 1, a, 0, 6.6, '#504e49'); }   // plinth buttresses
      vent(m, 4, -9, 18.6, 0.9);
      m.tag('steel'); m.box(-15.6, -14.9, 11, 11.5, 5, 18.6, M.metal);                             // ladder rails
      m.box(-13, -12.3, 11, 11.5, 5, 18.6, M.metal);
      for (let z = 6; z < 18; z += 1.6) m.box(-15.6, -12.3, 11.1, 11.4, z, z + 0.3, '#4b5056');
      if (sub === 'bastion') gunPit(m, 17, -15, 5, M, tc);
      mast(m, -14, -12, 18.6, 30);
    },
  },
  meridian: {
    1(m, tc, M) {
      entrance(m, -4, 4, 7, 8.2, M.metal, M.dark);
      acUnit(m, 10.5, 9.6, 0); acUnit(m, -11, 9.6, 0);
      m.tag('glass');
      for (const x of [-13, -6.5]) slopePanel(m, x, x + 5);                                         // roof arrays
      m.tag('steel'); m.box(-17.9, -17.3, -2.6, -2, 0, 20, '#58626a');                             // rear mast
      m.box(-19.4, -15.8, -2.5, -2.1, 17, 17.4, '#58626a');
    },
    2(m, tc, M) {
      vent(m, -15, 6, 13.4, 0.8, M.dark); acUnit(m, -6, 10, 13.4); acUnit(m, 1, -9, 13.4);
      m.tag('steel');
      for (const [x, y] of [[10.4, -15.6], [15.6, -10.4]]) m.box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, 25.2, 31, '#3a4047');   // whip aerials
      pipe(m, 6.6, 6, 8, 6, 3.4, 0.6, '#aeb7bd');
      m.tag('plating');                                                                             // external stair on the tower
      for (let k = 0; k < 6; k++) m.box(17, 19.4, -16.5 + k * 1.3, -15.2 + k * 1.3, k * 1.6, k * 1.6 + 0.5, '#7b858d');
      const kiosk = m.box(-19, -14.5, 15.4, 19, 0, 5, M.lite, { top: M.hull });                      // gate office
      m.onY(kiosk, -18.2, -15.3, 2.2, 4.2, 19, '#bfe9ff', true);
    },
    3(m, tc, M) {
      m.tag('plating');
      for (let i = 0; i < 3; i++) {                                                                 // conduit between pylons
        const a = PYLONS[i], b = PYLONS[(i + 1) % 3], cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
        obox(m, cx * 1.18, cy * 1.18, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 - 3, 0.7, Math.atan2(b[1] - a[1], b[0] - a[0]), 5.8, 7.2, M.dark);
      }
      const ann = m.box(8, 18, 8, 18, 5, 11.4, M.lite, { top: M.hull });                             // control annex
      m.onY(ann, 9, 17, 7.6, 10, 18, '#bfe9ff', true);
      m.onX(ann, 9, 17, 7.6, 10, 18, '#9fd2ee');
      m.onY(ann, 8, 18, 5, 6, 18, tc.main);
      acUnit(m, 13, 12, 11.4);
      m.tag('concrete'); m.box(-3.4, 3.4, 22, 27, 0, 2.4, '#7d848a', { top: '#959ca2' }); m.box(-3.4, 3.4, 24.6, 29, 0, 1.2, '#7d848a', { top: '#959ca2' });   // steps up the plinth
    },
  },
  veil: {
    1(m, tc, M, A) {
      m.tag('panel');
      for (let i = 0; i < 9; i++) { const a = -0.5 + i * 0.52; obox(m, Math.cos(a) * 15.2, Math.sin(a) * 15.2, 2.4, 0.6, a, 0, 7.5 - (i % 2) * 1.5, M.dark); }   // ribs gripping the shell
      obox(m, 9.6, 5.4, 6, 0.8, 0.57, 0, 1.6, M.lite);                                               // conduit to the vats
      m.tag('steel'); m.box(-12.3, -11.7, 6.7, 7.3, 0, 15, M.metal); m.box(-13, -11, 6, 8, 15, 16.2, A);
    },
    2(m, tc, M, A) {
      m.tag('panel');
      for (let i = 0; i < 10; i++) { const a = -0.3 + i * 0.48; obox(m, Math.cos(a) * 18.6, Math.sin(a) * 18.6 * 0.74, 2.6, 0.6, a, 0, 6.2, M.dark); }
      for (const [x0, y0, x1, y1] of [[-17, 6, -11, 10], [16, 7, 9, 10]]) obox(m, (x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2, 0.7, Math.atan2(y1 - y0, x1 - x0), 0, 1.6, M.lite);
      m.tag('glass'); m.cyl(0, 0, 4.2, 15, 16.4, '#3a2d52', { n: 10, sy: 0.74, r1: 2, top: A });       // crown lens
    },
    3(m, tc, M, A) {
      m.tag('panel');
      for (let i = 0; i < 10; i++) { const a = (i + 0.5) / 10 * TAU; obox(m, Math.cos(a) * 21.8, Math.sin(a) * 21.8, 2.6, 0.9, a, 0, 6 + (i % 2) * 2.4, M.hull); }
      for (let i = 0; i < 3; i++) { const a = 0.6 + i * 2.09; obox(m, Math.cos(a) * 15, Math.sin(a) * 15, 5, 0.8, a, 5.4, 7, M.lite); }
      m.tag('steel'); for (const [x, y] of [[9, 12], [-13, 4]]) { m.box(x - 0.3, x + 0.3, y - 0.3, y + 0.3, 5.4, 22, M.metal); m.box(x - 0.9, x + 0.9, y - 0.9, y + 0.9, 22, 23.2, A); }
    },
  },
};

/** A dark glazed panel lying on the front slope of the gabled hall's roof. */
function slopePanel(m, x0, x1) {
  const ye = 8.5, ym = -2.5, z0 = 10, z1 = 16.5, u0 = 0.16, u1 = 0.56;
  const Y = u => ye + (ym - ye) * u, Z = u => z0 + (z1 - z0) * u + 0.12, l = Math.hypot(ym - ye, z1 - z0);
  const s = m.solids[m.solids.length - 1];
  m.decal(s, [[x0, Y(u0), Z(u0)], [x1, Y(u0), Z(u0)], [x1, Y(u1), Z(u1)], [x0, Y(u1), Z(u1)]], '#22303d', [0, (z1 - z0) / l, (ye - ym) / l]);
}

const SETS = { iron: IRON_SET, meridian: MERIDIAN_SET, veil: VEIL_SET };
const memo = new Map();

/** { model, live, top } for a base. f === 'neutral' gives the derelict set. */
export function buildBase(f, sub, level, tc) {
  const key = `${f}|${sub}|${level}|${tc.id}`;
  let b = memo.get(key);
  if (b) return b;
  const m = new Model(), live = [];
  let top;
  if (f === 'neutral') { top = NEUTRAL_SET[level](m, tc); DETAIL.neutral[level](m, tc); }
  else {
    const fac = FACTIONS[f], A = fac.subs[sub].accent2;
    top = SETS[f][level](m, tc, fac.mat, A, sub, live);
    ADDON[sub](m, tc, fac.mat, A, live);
    DETAIL[f][level](m, tc, fac.mat, A, sub, live);
  }
  m.tag(null);
  b = { model: m, live, top: top * BS };
  memo.set(key, b);
  return b;
}

// ------------------------------------------------------------ live details

function jag(seed) {
  const r = Math.sin(seed * 12.9898) * 43758.5453;
  return r - Math.floor(r) - 0.5;
}

/** Animated parts of an occupied base, drawn over the sprite every frame. */
export function drawBaseLive(ctx, base, tc, x, y, t, seed) {
  for (const e of base.live) {
    const p = e.at ? bp(e.at[0], e.at[1], e.at[2]) : null;
    const px = p ? x + p[0] : x, py = p ? y + p[1] : y;
    switch (e.k) {
      case 'flag': {
        const w1 = Math.sin(t * 5 + seed) * 1.5, w2 = Math.sin(t * 5 + seed + 1.2) * 1.8;
        ctx.fillStyle = tc.main;
        ctx.beginPath();
        ctx.moveTo(px, py); ctx.lineTo(px + 5.5, py + 0.6 + w1); ctx.lineTo(px + 11, py + 1 + w2);
        ctx.lineTo(px + 11, py + 7 + w2); ctx.lineTo(px + 5.5, py + 6.6 + w1); ctx.lineTo(px, py + 6);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = tc.light;
        ctx.beginPath();
        ctx.moveTo(px, py + 2.2); ctx.lineTo(px + 5.5, py + 2.8 + w1); ctx.lineTo(px + 11, py + 3.2 + w2);
        ctx.lineTo(px + 11, py + 4.8 + w2); ctx.lineTo(px + 5.5, py + 4.4 + w1); ctx.lineTo(px, py + 3.8);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'smoke':
        for (let j = 0; j < 4; j++) {
          const ph = (((t * 0.4 + j / 4 + seed * 0.37 + e.at[1] * 0.1) % 1) + 1) % 1;   // keep the phase in 0..1 even for negative offsets
          ctx.globalAlpha = (1 - ph) * (e.dark ? 0.6 : 0.45);
          ctx.fillStyle = e.dark ? '#3b3835' : '#c9cdd2';
          ctx.beginPath(); ctx.arc(px + ph * 9 * e.size, py - ph * 17 * e.size, (2.2 + ph * 5.5) * e.size, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      case 'beacon':
        if ((t * 1.4 + seed) % 1 < 0.5) {
          ctx.fillStyle = e.col || '#ff5a4d';
          ctx.beginPath(); ctx.arc(px, py, 1.6, 0, TAU); ctx.fill();
        }
        break;
      case 'glow':
        ctx.globalAlpha = 0.09 + 0.06 * Math.sin(t * 3.2 + seed + e.at[0]);     // a hint of spill light, not a halo
        ctx.fillStyle = e.col;
        ctx.beginPath(); ctx.arc(px, py, e.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      case 'radar': {
        const a = t * 1.6 + seed, c = Math.cos(a) * 6;
        ctx.strokeStyle = '#e8eef2'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(px - c, py - Math.sin(a) * 2.2); ctx.lineTo(px + c, py + Math.sin(a) * 2.2); ctx.stroke();
        ctx.strokeStyle = '#5b656d'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 4); ctx.stroke();
        break;
      }
      case 'arcs': {
        const tick = Math.floor(t * 14);
        ctx.strokeStyle = e.col; ctx.lineWidth = 1.1;
        e.to.forEach((q, i) => {
          if ((tick + i * 3 + Math.floor(seed)) % 4 === 0) return;      // arcs flicker out
          const b = bp(q[0], q[1], q[2]);
          const j = jag(tick + i * 17 + seed) * 7;
          ctx.globalAlpha = 0.75;
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.lineTo((px + x + b[0]) / 2 + j, (py + y + b[1]) / 2 - j * 0.6);
          ctx.lineTo(x + b[0], y + b[1]); ctx.stroke();
        });
        ctx.globalAlpha = 1;
        break;
      }
      case 'spark': {
        const tick = Math.floor(t * 9 + seed);
        if (tick % 3 === 0) {
          ctx.strokeStyle = e.col; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.lineTo(px + jag(tick) * 12, py + jag(tick + 5) * 8 - 3); ctx.stroke();
        }
        break;
      }
      case 'crystal': {
        const bob = Math.sin(t * 2.2 + seed) * 1.4, cy = py + bob;
        const pulse = 0.6 + 0.4 * Math.sin(t * 3.4 + seed);
        const tick = Math.floor(t * 14);
        ctx.strokeStyle = '#c9f1ff'; ctx.lineWidth = 1.1;
        e.tips.forEach((q, i) => {
          const b = bp(q[0], q[1], q[2]);
          const j = jag(tick + i * 17 + seed) * 5;
          ctx.globalAlpha = 0.35 + 0.4 * pulse;
          ctx.beginPath(); ctx.moveTo(x + b[0], y + b[1]);
          ctx.lineTo((x + b[0] + px) / 2 + j, (y + b[1] + cy) / 2 - j * 0.6);
          ctx.lineTo(px, cy + 2); ctx.stroke();
        });
        ctx.globalAlpha = 0.22 + 0.2 * pulse;
        ctx.fillStyle = '#c9f1ff';
        ctx.beginPath(); ctx.arc(px, cy, 13, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#f4fcff';
        ctx.beginPath(); ctx.moveTo(px, cy - 7.5); ctx.lineTo(px + 4.4, cy); ctx.lineTo(px, cy + 6); ctx.lineTo(px - 4.4, cy); ctx.closePath(); ctx.fill();
        ctx.fillStyle = tc.light;
        ctx.beginPath(); ctx.moveTo(px, cy - 7.5); ctx.lineTo(px + 4.4, cy); ctx.lineTo(px, cy + 6); ctx.closePath(); ctx.fill();
        break;
      }
      case 'orb': {
        const cy = py + Math.sin(t * 1.8 + seed) * 1.8;
        const pulse = 0.55 + 0.45 * Math.sin(t * 2.6 + seed);
        ctx.globalAlpha = 0.18 + 0.2 * pulse;
        ctx.fillStyle = e.col;
        ctx.beginPath(); ctx.arc(px, cy, e.r * 2.6, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = e.col;
        ctx.beginPath(); ctx.arc(px, cy, e.r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(px - e.r * 0.3, cy - e.r * 0.3, e.r * 0.42, 0, TAU); ctx.fill();
        ctx.strokeStyle = e.core; ctx.lineWidth = 1.3;
        for (let i = 0; i < 2; i++) {                                   // counter-rotating halos
          ctx.globalAlpha = 0.8;
          ctx.beginPath(); ctx.ellipse(px, cy, e.r * 1.9, e.r * 0.55, (i ? -1 : 1) * (t * 0.9 + seed) + i * 1.3, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'shield': {
        const pulse = 0.5 + 0.5 * Math.sin(t * 2 + seed);
        ctx.strokeStyle = e.col; ctx.lineWidth = 1.4;
        ctx.globalAlpha = 0.16 + 0.18 * pulse;
        ctx.beginPath(); ctx.ellipse(x, y - 4, 40, 34, 0, Math.PI, TAU); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(x, y - 4, 40, 22, 0, 0, Math.PI); ctx.stroke();
        ctx.globalAlpha = 0.05 + 0.04 * pulse;
        ctx.fillStyle = e.col;
        ctx.beginPath(); ctx.ellipse(x, y - 4, 40, 34, 0, Math.PI, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'waves':
        ctx.strokeStyle = e.col; ctx.lineWidth = 1.2;
        for (let j = 0; j < 3; j++) {
          const ph = (t * 0.6 + j / 3 + seed * 0.2) % 1;
          ctx.globalAlpha = (1 - ph) * 0.8;
          ctx.beginPath(); ctx.ellipse(px, py - ph * 9, 2 + ph * 9, (2 + ph * 9) * 0.45, 0, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      case 'gear': {
        const a0 = t * 1.2 + seed;
        ctx.strokeStyle = e.col; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(px, py, e.r, e.r * 0.55, 0, 0, TAU); ctx.stroke();
        for (let j = 0; j < 6; j++) {
          const a = a0 + j * TAU / 6;
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(a) * (e.r + 1.6), py + Math.sin(a) * (e.r + 1.6) * 0.55); ctx.stroke();
        }
        break;
      }
    }
  }
}

// ------------------------------------------------------------ insignia

/**
 * Original emblems. Faction mark in the centre, subfaction mark as a second
 * element, team colour as the outer ring. Drawn at the origin, radius r.
 */
export function drawInsignia(g, f, sub, r, tc) {
  const fac = FACTIONS[f];
  g.save();
  g.lineJoin = 'miter';
  g.fillStyle = tc ? tc.main : '#2a2e31';
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.fillStyle = '#16181a';
  g.beginPath(); g.arc(0, 0, r * 0.82, 0, TAU); g.fill();
  g.fillStyle = fac.accent;
  g.strokeStyle = fac.accent;
  const A = fac.subs[sub] ? fac.subs[sub].accent2 : '#ffffff';
  const u = r * 0.62;
  if (f === 'iron') {                                                   // toothed wheel, chevron inside
    for (let i = 0; i < 8; i++) {
      g.save(); g.rotate(i * TAU / 8); g.fillRect(-u * 0.16, -u * 1.12, u * 0.32, u * 0.36); g.restore();
    }
    g.lineWidth = u * 0.26;
    g.beginPath(); g.arc(0, 0, u * 0.74, 0, TAU); g.stroke();
    g.strokeStyle = A; g.lineWidth = u * 0.22;
    if (sub === 'volt') {
      g.beginPath(); g.moveTo(u * 0.14, -u * 0.5); g.lineTo(-u * 0.2, u * 0.04); g.lineTo(u * 0.16, u * 0.04); g.lineTo(-u * 0.14, u * 0.52); g.stroke();
    } else {
      g.beginPath(); g.moveTo(-u * 0.36, u * 0.12); g.lineTo(0, -u * 0.3); g.lineTo(u * 0.36, u * 0.12); g.stroke();
      g.beginPath(); g.moveTo(-u * 0.36, u * 0.42); g.lineTo(u * 0.36, u * 0.42); g.stroke();
    }
  } else if (f === 'meridian') {                                        // four-point compass
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8 - Math.PI / 2, rr = i % 2 ? u * 0.3 : u * 1.12;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
    g.strokeStyle = A; g.lineWidth = u * 0.16;
    if (sub === 'shade') {
      g.beginPath(); g.arc(u * 0.1, 0, u * 0.86, Math.PI * 0.62, Math.PI * 1.38); g.stroke();
    } else {
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6; g.lineTo(Math.cos(a) * u * 0.92, Math.sin(a) * u * 0.92); }
      g.closePath(); g.stroke();
    }
  } else {                                                              // lidded eye
    g.lineWidth = u * 0.22;
    g.beginPath(); g.moveTo(-u * 1.06, 0); g.quadraticCurveTo(0, -u * 1.0, u * 1.06, 0); g.quadraticCurveTo(0, u * 1.0, -u * 1.06, 0); g.stroke();
    g.beginPath(); g.arc(0, 0, u * 0.3, 0, TAU); g.fill();
    g.strokeStyle = A; g.lineWidth = u * 0.14;
    if (sub === 'dominion') {
      for (const k of [0.62, 0.9]) { g.beginPath(); g.arc(0, u * 0.1, u * k * 1.2, Math.PI * 1.25, Math.PI * 1.75); g.stroke(); }
    } else {
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * 0.15 + i * Math.PI * 0.175;
        g.beginPath(); g.moveTo(Math.cos(a) * u * 0.7, Math.sin(a) * u * 0.7 + u * 0.1); g.lineTo(Math.cos(a) * u * 1.05, Math.sin(a) * u * 1.05 + u * 0.1); g.stroke();
      }
    }
  }
  g.restore();
}

const iconMemo = new Map();

/** Insignia as a data URL, for <img> badges in the lobby and HUD. */
export function insigniaURL(f, sub, tc) {
  const key = `${f}|${sub}|${tc ? tc.id : ''}`;
  let url = iconMemo.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.translate(32, 32);
    drawInsignia(g, f, sub, 30, tc);
    url = c.toDataURL();
    iconMemo.set(key, url);
  }
  return url;
}

// ============================================================ battlefield objects
// Things that stand on the map besides bases: gun and field emplacements, road obstacles,
// wormhole ends, the wreck of a destroyed base, the scaffold of one being built, and the
// shield over one. All are Models like everything else, authored at compound scale (draw
// them at scale 1). Faces tagged 'field' are light, not matter: the 3D renderer draws them
// translucent and additive, and builders can leave them out for the sprite renderer.

/** Marks a solid as a light source. */
function lit(s) { for (const f of s.faces) f.glow = true; return s; }

const propMemo = new Map();
/** Builds a model once per key. kx, ky, kz enlarge it afterwards (the parts are authored small and sized here). */
function prop(key, build, kx = 1, ky = kx, kz = kx) {
  let m = propMemo.get(key);
  if (!m) {
    m = new Model(); build(m); m.tag(null);
    if (kx !== 1 || ky !== 1 || kz !== 1) for (const sd of m.solids) {
      sd.c = [sd.c[0] * kx, sd.c[1] * ky, sd.c[2] * kz];
      const seen = new Set();
      for (const f of sd.faces) {
        for (const p of f.p) if (!seen.has(p)) { seen.add(p); p[0] *= kx; p[1] *= ky; p[2] *= kz; }
        const n = [f.n[0] / kx, f.n[1] / ky, f.n[2] / kz], l = Math.hypot(n[0], n[1], n[2]) || 1;
        f.n = [n[0] / l, n[1] / l, n[2] / l];
      }
    }
    propMemo.set(key, m);
  }
  return m;
}
const EMPLACEMENT_SIZE = 1.7, PORTAL_SIZE = 1.45, BARRICADE_SIZE = 1.55;

/** A flat ring of `n` quads lying at height z (a painted or lit band on the ground). */
function band(m, r0, r1, z, c, n = 16, rot = 0) {
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU, b = rot + ((i + 1) / n) * TAU;
    flat(m, [[Math.cos(a) * r0, Math.sin(a) * r0, z], [Math.cos(b) * r0, Math.sin(b) * r0, z], [Math.cos(b) * r1, Math.sin(b) * r1, z], [Math.cos(a) * r1, Math.sin(a) * r1, z]], c, [0, 0, 1]);
  }
}
// A one-face solid has no centre to orient against: keep the normal it was given.
const flat = (m, pts, c, n) => { const s = { faces: [{ p: pts, c, n, m: m.cur || undefined }], c: pts[0], bias: 0 }; m.solids.push(s); return s; };

/** Octagonal concrete pad with a hazard edge: the footing every emplacement shares. */
function pad(m, r, tc) {
  m.tag('concrete');
  m.cyl(0, 0, r + 1.2, 0, 0.8, '#6c6e6b', { n: 8, rot: TAU / 16, top: '#7d7f7b' });
  const p = m.cyl(0, 0, r, 0.8, 1.6, '#787a76', { n: 8, rot: TAU / 16, top: '#8a8c87' });
  m.tag('panel');
  for (const a of [0, TAU / 4, TAU / 2, (3 * TAU) / 4]) {            // team chevrons toward the four sides
    const cs = Math.cos(a), sn = Math.sin(a), q = (l, w) => [cs * l - sn * w, sn * l + cs * w, 1.6];
    m.decal(p, [q(r - 3.2, -2), q(r - 1, -2), q(r - 1, 2), q(r - 3.2, 2)], tc.main, [0, 0, 1]);
  }
}

/**
 * Emplacement on its pad.
 * @param kind 'turret' (twin gun in an armoured cupola), 'slow' (field projector that bogs
 *             columns down) or 'psi' (psychic beacon)
 * @param tc   team colour
 * @param part 'base' (pad and everything fixed), 'head' (the part that turns to face its
 *             target; place it at the same point) or 'all' (both, head facing +x)
 */
export function emplacementModel(kind, tc, part = 'all') {
  return prop(`emp|${kind}|${tc.id}|${part}`, m => {
    const base = part !== 'head', head = part !== 'base';
    if (kind === 'slow') {
      if (base) {
        pad(m, 9, tc);
        m.tag('plating');
        const g = m.box(-5, 5, -4, 4, 1.6, 5.6, '#8a959e', { top: '#a9b3bb' });   // generator
        m.onY(g, -4, 4, 2.6, 4.6, 4, '#3a3f44'); m.onX(g, -3, 3, 2.6, 4.6, 5, '#3a3f44');
        m.onTop(g, -4, -1, -3, 3, 5.6, tc.main);
        m.tag('steel');
        for (const [x, y] of [[-7.4, -5.6], [7.4, -5.6], [0, 8]]) {      // three earthed stakes with a lit collar
          m.box(x - 0.5, x + 0.5, y - 0.5, y + 0.5, 1.6, 9, '#4b5157');
          lit(m.box(x - 1, x + 1, y - 1, y + 1, 7, 8, '#8fd8ff'));
        }
        m.tag('dark');
        m.box(-7.4, -5, -5.9, -5.3, 1.6, 2, BLACK); m.box(5, 7.4, -5.9, -5.3, 1.6, 2, BLACK); m.box(-0.3, 0.3, 4, 8, 1.6, 2, BLACK);   // cables
      }
      if (head) {
        m.tag('plating');
        m.cyl(0, 0, 2.2, 5.6, 9.4, '#6f7a83', { n: 8, r1: 1.6 });       // mast
        m.cyl(0, 0, 6.2, 9.4, 10.2, '#a9b3bb', { n: 12, top: '#c9d1d7' });   // projector dish, face up
        m.cyl(0, 0, 4.6, 10.2, 10.5, '#8fd8ff', { n: 12, glow: true });
        m.cyl(0, 0, 1, 10.5, 14.5, '#dff3ff', { n: 6, r1: 0.3, glow: true });
        m.box(5.4, 7.6, -0.6, 0.6, 9.5, 10.1, tc.main);                  // pointer vane (shows which way it has turned)
        m.tag('field');
        band(m, 7, 15, 1.9, '#3f8fb8', 16);                              // the slowing field on the ground around it
      }
    } else if (kind === 'psi') {
      if (base) {
        pad(m, 9, tc);
        m.tag('panel');
        m.cyl(0, 0, 5.4, 1.6, 3.4, '#3b3446', { n: 10, r1: 4.2, top: '#544a66' });   // plinth
        for (let i = 0; i < 3; i++) {                                    // three horns leaning in over the plinth
          const a = (i / 3) * TAU + 0.5, cs = Math.cos(a), sn = Math.sin(a);
          m.cyl(cs * 6.4, sn * 6.4, 1.5, 1.6, 8, '#4b4358', { n: 6, r1: 1 });
          m.cyl(cs * 5.2, sn * 5.2, 1, 8, 13.4, '#72678a', { n: 6, r1: 0.5 });
          m.cyl(cs * 4, sn * 4, 0.5, 13.4, 16.4, tc.main, { n: 5, r1: 0.15 });
        }
        m.tag('steel');
        m.box(7, 7.6, -5.4, -4.8, 1.6, 15, '#1b181f'); lit(m.box(6.6, 8, -5.8, -4.4, 15, 16.2, '#ff9be4'));   // aerial
      }
      if (head) {
        m.cyl(0, 0, 1.6, 6.8, 8.4, '#f0c4ff', { n: 8, r1: 3.2, glow: true });   // the eye: a lit orb held between the horns
        m.cyl(0, 0, 3.2, 8.4, 10.8, '#f0c4ff', { n: 8, glow: true });
        m.cyl(0, 0, 3.2, 10.8, 12.4, WHITE_HOT, { n: 8, r1: 1.4, glow: true });
        m.tag('panel');
        m.box(3, 5.2, -0.5, 0.5, 9.2, 10, '#1b181f');                    // its pupil: a dark lens toward the target
        m.tag('field');
        band(m, 4.2, 5.4, 9.6, '#c66ad8', 12);                           // halo
      }
    } else {
      if (base) {
        pad(m, 9, tc);
        m.tag('sandbag');
        for (let i = 0; i < 8; i++) {                                    // sandbag ring, open at the back
          if (i === 4) continue;
          const a = (i / 8) * TAU;
          obox(m, Math.cos(a) * 7.6, Math.sin(a) * 7.6, 1.3, 2.9, a, 1.6, 3.6, i % 2 ? KHAKI : '#8f8763');
        }
        m.tag('panel');
        const b = m.box(-7.2, -4.4, 3.4, 6.4, 1.6, 4.2, OLIVE);         // ready ammunition
        m.onY(b, -6.8, -4.8, 2.6, 3.2, 6.4, '#3d4034');
        m.cyl(0, 0, 4.4, 1.6, 3, GUN, { n: 10 });                        // ring mount
      }
      if (head) {
        m.tag('panel');
        const t = m.prism([[-4.4, -3.6], [1.4, -3.6], [4.2, -1.8], [4.2, 1.8], [1.4, 3.6], [-4.4, 3.6]], 3, 7, '#5f6a57', { top: '#7b8670' });   // armoured cupola
        m.onTop(t, -3.4, -0.6, -2.4, 2.4, 7, tc.main);
        m.box(-6, -4.4, -2.4, 2.4, 3.6, 6.2, '#4a5343');                 // counterweight
        m.tag('steel');
        for (const y of [-1.3, 1.3]) { m.tubeX(4.2, 13.4, y, 5.3, 0.55, GUN, { n: 6, cap: BLACK }); m.tubeX(11.6, 13.8, y, 5.3, 0.85, '#3a3f44', { n: 6, cap: BLACK }); }
        m.box(3.6, 5, -2.4, 2.4, 4.2, 6.4, GUN);                         // mantlet
        m.box(-1, 0.4, 1.6, 2.6, 7, 8.2, '#3a3f44');                     // sight
      }
    }
  }, EMPLACEMENT_SIZE);
}

/**
 * Obstacle laid on a road. Built along x: turn it to the road's direction.
 * @param kind  'block' (a barricade; `len` is the width of road it closes, and it is laid
 *              ACROSS the road, so turn it a quarter turn from the road's direction) or
 *              'mire' (a disruption field ALONG the road; `len` is how much road it covers)
 * @param len   length in view units (rounded to 4 so models are shared)
 * @param field include the translucent field faces (mire only; false for the sprite renderer)
 */
export function obstacleModel(kind, len = kind === 'mire' ? 60 : 28, field = true) {
  len = Math.max(12, Math.round(len / 4) * 4);
  return prop(`obs|${kind}|${len}|${field ? 1 : 0}`, m => {
    const h = len / 2;
    if (kind === 'mire') {
      const n = Math.max(2, Math.round(len / 20) + 1);
      for (let i = 0; i < n; i++) {                                      // pairs of emitter posts down both kerbs
        const x = -h + (i * len) / (n - 1);
        for (const s of [-1, 1]) {
          m.tag('concrete'); m.box(x - 1.6, x + 1.6, s * 12 - 1.6, s * 12 + 1.6, 0, 0.9, '#62645f');
          m.tag('panel'); m.cyl(x, s * 12, 1.1, 0.9, 5.4, '#3d3a44', { n: 6, r1: 0.7 });
          m.cyl(x, s * 12, 1.2, 5.4, 6.6, '#c8ff5a', { n: 6, glow: true });
          m.tag('steel'); m.box(x - 0.2, x + 0.2, s * 12 - 0.2, s * 12 + 0.2, 6.6, 9, '#1b181f');
        }
        m.tag('dark'); m.box(x - 0.3, x + 0.3, -12, 12, 0, 0.35, BLACK);   // cable across the road
      }
      m.tag('dark');
      for (const s of [-1, 1]) m.box(-h, h, s * 12 - 0.3, s * 12 + 0.3, 0, 0.35, BLACK);   // and along both kerbs
      if (field) {
        m.tag('field');
        flat(m, [[-h, -10.5, 0.5], [h, -10.5, 0.5], [h, 10.5, 0.5], [-h, 10.5, 0.5]], '#5b8a1e', [0, 0, 1]);   // the mire itself, on the road
        for (let x = -h + 5; x < h - 3; x += 9) {                        // slow ripples standing in it
          const w = 3 + ((x * 7) % 3 + 3) % 3;
          flat(m, [[x, -9, 0.7], [x + w, -9, 0.7], [x + w + 2, 9, 0.7], [x + 2, 9, 0.7]], '#8fc23a', [0, 0, 1]);
        }
        for (const s of [-1, 1]) flat(m, [[-h, s * 11.6, 0.4], [h, s * 11.6, 0.4], [h, s * 11.6, 5.6], [-h, s * 11.6, 5.6]], '#33520f', [0, s, 0]);   // faint curtain between the posts
      }
    } else {
      const n = Math.max(2, Math.round(len / 9));
      const w = len / n;
      for (let i = 0; i < n; i++) {                                      // concrete barriers, each a little out of line
        const x = -h + (i + 0.5) * w, j = ((i * 7) % 3 - 1) * 0.7;
        m.tag('concrete');
        const b = m.profile([[j - 2, 0], [j + 2, 0], [j + 0.9, 4.6], [j - 0.9, 4.6]], x - w / 2 + 0.3, x + w / 2 - 0.3, '#8a8c87');
        void b;
        m.tag('panel');
        m.box(j - 0.95, j + 0.95, x - w / 2 + 0.3, x + w / 2 - 0.3, 4.6, 5, i % 2 ? HAZ : BLACK);   // hazard coping
      }
      // The profile runs along y; a barricade is described along x, so swap the axes of what was just built.
      for (const s of m.solids) for (const f of s.faces) { for (const p of f.p) { const t = p[0]; p[0] = p[1]; p[1] = t; } const t = f.n[0]; f.n[0] = f.n[1]; f.n[1] = t; }
      for (const s of m.solids) { const t = s.c[0]; s.c[0] = s.c[1]; s.c[1] = t; }
      m.tag('steel');
      for (const x of [-h + 3, 0, h - 3]) {                              // steel hedgehogs in front
        obox(m, x, 5.4, 3, 0.45, 0.7, 0, 3.4, GUN); obox(m, x, 5.4, 3, 0.45, -0.7, 0, 3.4, '#3a3f44');
        m.box(x - 0.45, x + 0.45, 5, 5.8, 0, 4.6, '#4b5157');
      }
      for (const x of [-h + 1.2, h - 1.2]) {                             // warning lamps at both ends
        m.box(x - 0.35, x + 0.35, -0.35, 0.35, 5, 7.4, '#4b5157');
        lit(m.box(x - 0.8, x + 0.8, -0.8, 0.8, 7.4, 8.6, '#ffb23c'));
      }
      m.tag('sandbag');
      m.box(-h + 1, -h + 7, -5.4, -3, 0, 2, KHAKI); m.box(-h + 2, -h + 6, -5.1, -3.3, 2, 3.4, '#8f8763');
    }
  }, 1, kind === 'mire' ? 1 : BARRICADE_SIZE, kind === 'mire' ? 1.25 : BARRICADE_SIZE);
}

/**
 * One end of a wormhole: a ring of four claws on a plinth, with the throat hanging between them.
 * @param part 'gate' (the structure), 'swirl' (the throat: translucent, made to be turned
 *             about the vertical every frame) or 'all'
 */
export function portalModel(tc, part = 'all') {
  return prop(`portal|${tc.id}|${part}`, m => {
    if (part !== 'swirl') {
      m.tag('concrete');
      m.cyl(0, 0, 16, 0, 0.9, '#55525c', { n: 12, top: '#66626e' });
      const p = m.cyl(0, 0, 13.6, 0.9, 1.8, '#3b3446', { n: 12, top: '#4b4358' });
      m.tag('panel');
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + TAU / 8, cs = Math.cos(a), sn = Math.sin(a);
        const q = (l, w) => [cs * l - sn * w, sn * l + cs * w, 1.8];
        m.decal(p, [q(6, -1.6), q(12.4, -1.6), q(12.4, 1.6), q(6, 1.6)], tc.main, [0, 0, 1]);          // team spokes
        m.cyl(cs * 12.6, sn * 12.6, 2.4, 1.8, 9, '#4b4358', { n: 6, r1: 1.7 });                        // claw: three joints leaning in
        m.cyl(cs * 11, sn * 11, 1.7, 9, 16, '#72678a', { n: 6, r1: 1.1 });
        m.cyl(cs * 8.6, sn * 8.6, 1.1, 16, 21, '#4b4358', { n: 6, r1: 0.5 });
        m.cyl(cs * 8.6, sn * 8.6, 0.9, 21, 22.6, '#9fe8ff', { n: 6, glow: true });
        m.cyl(cs * 12.6, sn * 12.6, 2.7, 4.6, 5.6, tc.main, { n: 6 });                                 // team collar
      }
      m.cyl(0, 0, 5, 1.8, 2.3, '#9fe8ff', { n: 12, glow: true });                                       // lit floor of the well
    }
    if (part !== 'gate') {
      m.tag('field');
      band(m, 2.4, 6, 7, '#5aa6e0', 12);                                                                // the throat: three rings at three heights
      band(m, 5, 8.4, 10.5, '#3f7fc8', 12, 0.3);
      band(m, 7, 10.4, 14, '#2c5fa8', 12, 0.6);
      for (let i = 0; i < 6; i++) {                                                                     // arms sweeping between them
        const a = (i / 6) * TAU, b = a + 0.9;
        flat(m, [[Math.cos(a) * 2.6, Math.sin(a) * 2.6, 7], [Math.cos(a + 0.35) * 2.6, Math.sin(a + 0.35) * 2.6, 7], [Math.cos(b + 0.25) * 10, Math.sin(b + 0.25) * 10, 14], [Math.cos(b) * 10, Math.sin(b) * 10, 14]], '#3f86c8', [0, 0, 1]);
      }
      m.cyl(0, 0, 2.2, 2.3, 20, '#1f4f8a', { n: 8, r1: 0.6 });                                          // the column of light down the middle
    }
  }, PORTAL_SIZE);
}

/** Deterministic scatter for wrecks: the same wreck every time, different per seed. */
function scatter(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

/**
 * What is left of a destroyed base: stumps of wall, a fallen roof slab, girders, rubble,
 * scorch and a few embers. No owner's colour anywhere. Draw it where the base stood
 * (same lift, turn and scale as a base).
 */
export function ruinModel(seed = 0) {
  return prop(`ruin|${seed & 3}`, m => {
    const r = scatter((seed & 3) + 11);
    const SOOT = '#2b2927', CHAR = '#3a3632', ASH = '#57534d', DUST = '#6f6a61';
    m.tag('concrete');
    const sc = m.box(-21, 21, -19, 19, 0, 0.25, CHAR, { top: '#221f1d' });   // scorched floor
    m.onTop(sc, -12, 9, -9, 11, 0.25, '#151312');
    // stumps of the outer walls, broken at different heights
    for (const [x0, x1, y0, y1, hmax] of [[-18, -6, -16, -14, 13], [-4, 6, -16, -14, 6], [9, 18, -16, -14, 10], [-18, -16, -14, 2, 9], [16, 18, -14, -3, 15], [-18, -16, 7, 15, 5], [-14, -3, 13, 15, 7]]) {
      const alongX = x1 - x0 > y1 - y0, L = alongX ? x1 - x0 : y1 - y0, n = Math.max(2, Math.round(L / 3));
      for (let i = 0; i < n; i++) {
        const a = (alongX ? x0 : y0) + (i * L) / n, b = a + L / n, hgt = 1.2 + r() * hmax * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.9 + hmax)));
        m.tag(i % 3 ? 'concrete' : 'brick');
        const w = alongX ? m.box(a, b, y0, y1, 0.25, hgt, i % 3 ? ASH : '#5b463c', { top: SOOT }) : m.box(x0, x1, a, b, 0.25, hgt, i % 3 ? ASH : '#5b463c', { top: SOOT });
        if (hgt > 6) { if (alongX) m.onY(w, a + 0.5, b - 0.5, 3.4, 5.6, y1, '#0e0d0c'); else m.onX(w, a + 0.5, b - 0.5, 3.4, 5.6, x1, '#0e0d0c'); }   // an empty window
      }
    }
    // the roof slab, one edge on the ground and one still up on a stump
    m.tag('roof');
    m.solid([
      { p: [[-12, -10, 7.6], [4, -10, 7.6], [6, 6, 1.2], [-10, 6, 1.2]], c: '#4a4641' },
      { p: [[-12, -10, 6.6], [4, -10, 6.6], [6, 6, 0.3], [-10, 6, 0.3]], c: SOOT },
      { p: [[-12, -10, 6.6], [4, -10, 6.6], [4, -10, 7.6], [-12, -10, 7.6]], c: CHAR },
      { p: [[-10, 6, 0.3], [6, 6, 0.3], [6, 6, 1.2], [-10, 6, 1.2]], c: CHAR },
      { p: [[-12, -10, 6.6], [-10, 6, 0.3], [-10, 6, 1.2], [-12, -10, 7.6]], c: CHAR },
      { p: [[4, -10, 6.6], [6, 6, 0.3], [6, 6, 1.2], [4, -10, 7.6]], c: CHAR },
    ]);
    m.tag('steel');
    for (const [x, y, ang, len, z] of [[8, 4, 0.5, 9, 2.2], [11, -6, -0.9, 7, 4.4], [-6, 10, 1.3, 8, 1.2], [1, -4, 2.2, 6, 8.2]]) obox(m, x, y, len, 0.45, ang, z, z + 0.9, '#3d3530');   // girders
    m.box(12.6, 13.4, 3.6, 4.4, 0.25, 14, '#3d3530'); m.box(9, 13.4, 3.7, 4.3, 12.6, 13.4, '#3d3530');   // one frame still standing
    m.tag('concrete');
    for (let i = 0; i < 14; i++) {                                       // rubble
      const x = -19 + r() * 38, y = -17 + r() * 34, s = 1 + r() * 2.6;
      m.cyl(x, y, s, 0.25, 0.25 + s * (0.5 + r() * 0.6), i % 4 ? DUST : '#5b463c', { n: 5, r1: s * 0.45, rot: r() * 6 });
    }
    for (const [x, y] of [[-3, 2], [7, -3], [-9, -5], [3, 9]]) lit(m.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, 0.25, 0.7, '#ff7a2a'));   // embers
  });
}

/**
 * Scaffolding round a base that is being upgraded or rebuilt. It goes up in four stages
 * as the work advances, so the caller can pass progress straight in.
 * @param progress 0..1  @param level the level being built (1..3): taller work, taller scaffold
 */
export function scaffoldModel(progress = 0, level = 3) {
  const stage = Math.max(0, Math.min(3, Math.floor(progress * 4)));
  return prop(`scaffold|${stage}|${level}`, m => {
    const R0 = 22, lifts = 1 + stage + (level > 1 ? 1 : 0), top = lifts * 6.5;
    const POLE = '#8d949a', TUBE = '#70777d', PLANK = '#8a6f4a', NET = '#c96a28';
    m.tag('steel');
    const posts = [];
    for (const u of [-R0, -R0 / 3, R0 / 3, R0]) for (const [x, y] of [[u, -R0], [u, R0], [-R0, u], [R0, u]]) {
      if (posts.some(p => p[0] === x && p[1] === y)) continue;
      posts.push([x, y]);
      m.box(x - 0.4, x + 0.4, y - 0.4, y + 0.4, 0, top + 2.4, POLE);       // standards
      m.box(x - 1, x + 1, y - 1, y + 1, 0, 0.4, '#4b5157');                // base plates
    }
    for (let l = 1; l <= lifts; l++) {
      const z = l * 6.5;
      for (const s of [-1, 1]) {
        m.tag('steel');
        m.box(-R0, R0, s * R0 - 0.3, s * R0 + 0.3, z - 0.3, z + 0.3, TUBE);   // ledgers
        m.box(s * R0 - 0.3, s * R0 + 0.3, -R0, R0, z - 0.3, z + 0.3, TUBE);
        m.box(-R0, R0, s * R0 - 0.2, s * R0 + 0.2, z + 3, z + 3.4, TUBE);     // guard rails
        m.box(s * R0 - 0.2, s * R0 + 0.2, -R0, R0, z + 3, z + 3.4, TUBE);
        m.tag('panel');
        m.box(-R0, R0, Math.min(s * R0, s * (R0 - 3.2)), Math.max(s * R0, s * (R0 - 3.2)), z + 0.3, z + 0.7, PLANK, { top: '#a3875c' });   // decks
        m.box(Math.min(s * R0, s * (R0 - 3.2)), Math.max(s * R0, s * (R0 - 3.2)), -R0, R0, z + 0.3, z + 0.7, PLANK, { top: '#a3875c' });
      }
      // one diagonal brace per face per lift, alternating direction
      m.tag('steel');
      const d = l % 2 ? 1 : -1, x0 = d * -R0 / 3, x1 = d * R0 / 3;
      for (const s of [-1, 1]) {
        m.profile([[x0, z - 6.2], [x0 + 0.7, z - 6.2], [x1 + 0.7, z - 0.3], [x1, z - 0.3]], s * R0 - 0.25, s * R0 + 0.25, TUBE);
      }
    }
    if (stage >= 1) {                                                     // debris netting on the two faces toward the camera
      m.tag('cloth');
      m.box(-R0, R0 / 3, R0 + 0.35, R0 + 0.5, 6.5, top + 2, NET);
      m.box(R0 + 0.35, R0 + 0.5, -R0 / 3, R0, 6.5, Math.max(8, top - 4), NET);
    }
    if (stage >= 2) {                                                     // tower crane on the back corner
      m.tag('steel');
      const cx = -R0 - 3, cy = -R0 - 3, ch = top + 14;
      m.box(cx - 0.9, cx + 0.9, cy - 0.9, cy + 0.9, 0, ch, '#d6a11e');
      for (let z = 4; z < ch - 2; z += 5) m.box(cx - 1.2, cx + 1.2, cy - 1.2, cy + 1.2, z, z + 0.5, '#a67c14');
      m.box(cx - 8, cx + 26, cy - 0.6, cy + 0.6, ch, ch + 1.4, '#d6a11e');   // jib
      m.box(cx - 8, cx - 4, cy - 1.4, cy + 1.4, ch - 2.4, ch, '#4b5157');     // counterweight
      m.box(cx + 17.8, cx + 18.2, cy - 0.2, cy + 0.2, ch - 12, ch, BLACK);    // hoist rope
      m.tag('panel');
      m.box(cx + 15.6, cx + 20.4, cy - 2, cy + 2, ch - 15, ch - 12, '#8a8c87', { top: '#a2a4a0' });   // the load
      m.box(cx - 1.6, cx + 1.6, cy - 1.6, cy + 1.6, ch - 3.4, ch, '#3a3f44');
    }
    m.tag('panel');                                                       // materials on the ground
    for (const [x, y] of [[R0 + 4, -8], [R0 + 4, -2]]) m.box(x, x + 6, y, y + 4, 0, 1.6 + (y < -4 ? 1.4 : 0), PLANK, { top: '#a3875c' });
    m.tag('concrete');
    m.cyl(-R0 + 2, R0 + 5, 2.4, 0, 2.2, '#8a8c87', { n: 8, r1: 0.6 });   // a heap of sand
  });
}

/**
 * The Base Shield: a dome of light over the whole compound, and the six projectors that raise it.
 * @param part 'dome' (translucent), 'projectors' (solid, around the wall) or 'all'
 */
export function shieldDomeModel(tc, part = 'all') {
  return prop(`dome|${tc.id}|${part}`, m => {
    const R0 = YARD * 1.28, N = 18, RINGS = 5;
    if (part !== 'dome') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.2, x = Math.cos(a) * R0, y = Math.sin(a) * R0;
        m.tag('plating');
        m.cyl(x, y, 2.2, 0, 3.4, '#6f7a83', { n: 6, r1: 1.5, top: tc.main });
        m.cyl(x, y, 1.1, 3.4, 5, '#c9f1ff', { n: 6, r1: 0.4, glow: true });
      }
    }
    if (part !== 'projectors') {
      m.tag('field');
      const at = (i, j) => { const a = (i / N) * TAU, e = (j / RINGS) * (Math.PI / 2) * 0.96; return [Math.cos(a) * Math.cos(e) * R0, Math.sin(a) * Math.cos(e) * R0, Math.sin(e) * R0 * 0.82]; };
      for (let j = 0; j < RINGS; j++) for (let i = 0; i < N; i++) {
        const p = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const a = ((i + 0.5) / N) * TAU, e = ((j + 0.5) / RINGS) * (Math.PI / 2);
        flat(m, p, (i + j) % 2 ? '#2f7fa8' : '#3f9fc8', [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)]);   // panels in two tones, like a honeycomb seen from far off
      }
      band(m, R0 - 1.2, R0 + 1.2, 0.5, '#7fd8ff', N);                    // where it meets the ground
    }
  });
}

// ------------------------------------------------------------ animation of structures
// Poses as functions of a time or progress value (see the note on animation in units.js):
// the caller supplies simulation time, so these stop on pause and follow the game speed.

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = p => { p = clamp01(p); return p * p * (3 - 2 * p); };

/**
 * The throat of a wormhole end.
 * @returns { yaw, scale, lift }  for the 'swirl' part of portalModel
 */
export function portalPose(t, seed = 0) {
  return { yaw: t * 1.7 + seed, scale: 1 + Math.sin(t * 2.3 + seed) * 0.05, lift: Math.sin(t * 1.3 + seed * 2) * 0.6 };
}

/** The shield dome breathes. @returns { scale, sy } */
export function domePose(t, seed = 0) {
  const b = Math.sin(t * 2.4 + seed);
  return { scale: 1 + b * 0.008, sy: 1 + b * 0.02 };
}

/**
 * A base being built, upgraded or rebuilt, from its progress 0..1.
 * @returns {
 *   scaffold   vertical scale of the scaffold: it goes up in the first tenth, stands
 *              through the work and comes down in the last tenth (0 = do not draw)
 *   rise       vertical scale of the new structure: it grows from its footing between
 *              a tenth and nine tenths of the way
 *   old        vertical scale of what stood there before (the lower level, or the ruin):
 *              it sinks away as the new one comes up (0 = do not draw)
 *   progress   the value to hand to scaffoldModel()
 * }
 */
export function buildPose(p) {
  p = clamp01(p);
  const up = clamp01(p / 0.1), down = clamp01((1 - p) / 0.1);
  const rise = ease((p - 0.1) / 0.8);
  return { scaffold: p >= 1 ? 0 : ease(Math.min(up, down)), rise: Math.max(0.02, rise), old: p < 0.55 ? 1 - ease(p / 0.55) * 0.999 : 0, progress: p };
}

/** Progress 0..1 of a job that started at `t0` and lasts `dur`, at time `t` (same clock for all three). */
export const progressAt = (t, t0, dur) => clamp01(dur > 0 ? (t - t0) / dur : 1);
