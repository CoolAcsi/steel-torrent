// Model set A, "Hero silhouettes": the bases a.js does not model itself, and the compound wall.
//
// a.js builds the Iron Pact at all three levels and the level-3 base of the other two factions,
// for each faction's first subfaction. Here are:
//   - Meridian and Veil at levels 1 and 2: earlier stages of those level-3 bases, so a base's
//     level shows in its silhouette (the landmark is a stub at 1, begun at 2, complete at 3);
//   - the second subfaction of every faction at every level, the same base with one large
//     feature of its own: Storm Works (volt) tesla coils, Aegis shield projectors, Graft Forge
//     reagent tanks and a caged reactor;
//   - neutral bases: derelict, grey, unlit, no colours, stepping up in size with level;
//   - the compound: a thicker, plainer wall with chunky posts capped in the owner's colour.
//
// Both functions return null for anything not modelled here, and the caller falls back.
// Solids are authored back to front (far corner first), which the sprite renderer relies on.
import { Model } from '../iso.js';
import { FACTIONS } from '../factions.js';
import { YARD } from '../scenery.js';

const TAU = Math.PI * 2, R2 = Math.SQRT2;
const BORE = '#101214', GUNMETAL = '#34383c', BLACK = '#16181a';
const LIT = '#ffd98a', FURNACE = '#ff8a2a', SKYGLASS = '#bfe9ff', COPPER = '#b56a3a';
const BASE_LIFT = 1.6;                    // height of the foundation slab (as in buildings.js)

/** A Model whose boxes can be light sources ({ glow: true }), like its columns and tubes. */
class Mini extends Model {
  box(x0, x1, y0, y1, z0, z1, c, o = {}) {
    const s = super.box(x0, x1, y0, y1, z0, z1, c, o);
    if (o.glow) for (const f of s.faces) f.glow = true;
    return s;
  }
}

/** A square block, optionally battered: half-side h0 at z0 tapering to h1 at z1. */
const block = (m, cx, cy, h0, h1, z0, z1, c, o = {}) => m.cyl(cx, cy, h0 * R2, z0, z1, c, { n: 4, rot: Math.PI / 4, r1: h1 * R2, ...o });

/** One segment of a flat ring round (cx, cy). */
function ringSeg(m, cx, cy, r0, r1, a0, a1, z0, z1, c, o) {
  const p = (r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  return m.prism([p(r0, a0), p(r1, a0), p(r1, a1), p(r0, a1)], z0, z1, c, o);
}

// ============================================================ IRON PACT / Storm Works (volt)

/** A foundry stack: a pale tapering column banded with dark collars, the top one in team colour, and a glowing mouth. */
function stack(m, x, y, r, z0, z1, M, tc, collars) {
  m.tag('concrete');
  m.cyl(x, y, r, z0, z1, '#8d887c', { n: 8, r1: r * 0.8 });
  m.tag('steel');
  const at = k => r - (r * 0.2 * k);
  collars.forEach((k, i) => {
    const last = i === collars.length - 1, zc = z0 + (z1 - z0) * k;
    m.cyl(x, y, at(k) + 1.1, zc, zc + (last ? r * 0.9 : 2.6), last ? tc.main : '#26282b', { n: 8 });
  });
  m.cyl(x, y, r * 0.8 + 1.1, z1, z1 + 2.4, '#1c1d1f', { n: 8 });
  m.cyl(x, y, r * 0.64, z1 + 2.4, z1 + 3, FURNACE, { n: 8, glow: true });
  m.tag(null);
}

/**
 * A tesla coil: a copper column wound with three fat rings on a dark drum, under a glowing ball.
 * Returns the height of the ball's centre, for the arcs drawn between coils.
 */
function coil(m, x, y, z0, h, r, A) {
  m.tag('steel');
  m.cyl(x, y, r * 1.5, z0, z0 + h * 0.14, '#26282b', { n: 8, top: '#3a3f45' });
  m.cyl(x, y, r * 0.62, z0 + h * 0.14, z0 + h * 0.86, COPPER, { n: 6 });
  for (const k of [0.3, 0.52, 0.74]) m.cyl(x, y, r * (1.5 - k * 0.5), z0 + h * k, z0 + h * k + h * 0.075, '#d7dde2', { n: 8, top: '#f1f5f7' });
  const zb = z0 + h * 0.86, rb = r * 1.25;
  m.cyl(x, y, r * 0.5, zb, zb + rb * 0.7, '#f3fbff', { n: 8, r1: rb, glow: true });
  m.cyl(x, y, rb, zb + rb * 0.7, zb + rb * 1.5, A, { n: 8, r1: rb * 0.45, glow: true, top: '#ffffff' });
  m.tag(null);
  return zb + rb * 0.8;
}

/**
 * Storm Works: the Iron keep, gun and foundry stack of a.js, with tesla coils on the roof:
 * one at level 1, a pair from level 2, taller at level 3. Arcs jump between them.
 */
function ironVolt(level, tc, M, A) {
  const m = new Mini(), live = [];
  const WALL = '#b9b4a6', FOOT = '#6f6d66';
  const half = [0, 16, 19.5, 23][level], h1 = [0, 12, 15, 17][level];
  m.tag('concrete');
  block(m, 0, 0, half + 3, half + 0.6, 0, 3, FOOT, { top: '#7d7b73' });
  m.tag('panel');
  const k = m.box(-half, half, -half, half, 3, h1, WALL);
  m.tag('concrete');
  const mouth = [0, 4, 5.5, 7][level], mh = [0, 6, 8, 9.5][level];
  for (const on of [(a, b, z0, z1, c, g) => m.onX(k, a, b, z0, z1, half, c, g), (a, b, z0, z1, c, g) => m.onY(k, a, b, z0, z1, half, c, g)]) {
    on(-mouth - 1.4, mouth + 1.4, 3, 3 + mh + 1.4, BLACK);
    on(-mouth, mouth, 3, 3 + mh * 0.62, FURNACE, true);
    on(-mouth * 0.6, mouth * 0.6, 3 + mh * 0.62, 3 + mh, FURNACE, true);
  }
  m.tag('panel');
  for (const s of [-1, 1]) {
    m.onX(k, -half, half, h1 - 3.6, h1, s * half, tc.main, false, s);
    m.onY(k, -half, half, h1 - 3.6, h1, s * half, tc.main, false, s);
  }
  const roof = m.box(-half - 1.2, half + 1.2, -half - 1.2, half + 1.2, h1, h1 + 1.6, M.dark, { top: M.hull });
  const z0 = h1 + 1.6;
  let top, deck = z0;
  // The landmark stands at the back of the roof, so it is built before what is in front of it.
  if (level === 1) { stack(m, -9, -9, 3.6, z0, 27, M, tc, [0.5]); top = 30; live.push({ k: 'smoke', at: [-9, -9, 30], size: 0.8, dark: true }); }
  else if (level === 2) { stack(m, -11.5, -11.5, 5.6, z0, 49, M, tc, [0.3, 0.68]); top = 52; live.push({ k: 'smoke', at: [-11.5, -11.5, 52], size: 1.2, dark: true }); }
  else {
    const zt = 80;
    stack(m, -13, -13, 8.4, z0, zt, M, tc, [0.2, 0.44, 0.7]);
    m.tag('steel');
    m.box(-9, 20.5, -19.5, -15.5, 57, 61, M.dark, { top: M.metal });
    m.box(-9, 20.5, -15.5, -15, 58, 60, '#e3a51f');
    m.box(4.6, 5.4, -17.9, -17.1, 45, 57, '#15171a');
    m.box(2.6, 7.4, -19.5, -15.5, 41, 45, '#e3a51f', { top: '#84590a' });
    m.box(15.5, 19.5, -19.5, -15.5, z0, 61, M.dark);
    m.tag(null);
    top = zt + 3;
    live.push({ k: 'smoke', at: [-13, -13, 83], size: 1.7, dark: true });
  }
  m.tag('panel');
  const c2 = level === 2 ? 3.5 : 4;
  if (level >= 2) {
    const t2 = level === 2 ? 12 : 15, z2 = z0 + (level === 2 ? 7 : 10);
    const u = m.box(c2 - t2, c2 + t2, c2 - t2, c2 + t2, z0, z2, WALL);
    for (const s of [-1, 1]) {
      m.onX(u, c2 - t2, c2 + t2, z2 - 3, z2, c2 + s * t2, tc.main, false, s);
      m.onY(u, c2 - t2, c2 + t2, z2 - 3, z2, c2 + s * t2, tc.main, false, s);
    }
    for (const w of [-6.5, 0, 6.5]) {
      m.onX(u, c2 + w - 2, c2 + w + 2, z0 + 1.6, z2 - 4.4, c2 + t2, LIT, true);
      m.onY(u, c2 + w - 2, c2 + w + 2, z0 + 1.6, z2 - 4.4, c2 + t2, LIT, true);
    }
    const r2 = m.box(c2 - t2 - 1, c2 + t2 + 1, c2 - t2 - 1, c2 + t2 + 1, z2, z2 + 1.4, M.dark, { top: M.hull });
    m.onTop(r2, c2 - t2 + 1.5, c2 + t2 - 1.5, c2 - t2 + 1.5, c2 - 1, z2 + 1.4, tc.main);
    deck = z2 + 1.4;
  } else {
    m.onTop(roof, -half + 2, half - 2, 1, half - 2, z0, tc.main);
  }
  // The coils: Storm Works' mark, in the two rear quarters of the deck so the gun stays clear.
  const spots = level === 1 ? [[9, -9]] : level === 2 ? [[11.5, -5], [-5, 11.5]] : [[14, -6], [-6, 14]];
  const ch = [0, 12, 19, 27][level], cr = [0, 1.9, 2.3, 2.9][level];
  const tips = spots.map(([x, y]) => [x, y, coil(m, x, y, deck, ch, cr, A)]);
  for (const t of tips) live.push({ k: 'glow', at: t, r: 7 + level * 1.5, col: A });
  live.push({ k: 'arcs', at: tips[0], to: tips.length > 1 ? [tips[1], [tips[0][0] - 5, tips[0][1] - 6, tips[0][2] - ch * 0.5]] : [[-9, -9, 24], [3, 4, deck + 4]], col: '#bfeaff' });
  if (tips.length > 1) live.push({ k: 'spark', at: tips[1], col: '#eaf9ff' });
  // The roof gun.
  const g = [0, 4.6, 5.8, 7.2][level], gx = level === 1 ? 4 : c2 + 1, gy = level === 1 ? 6 : c2 + 3;
  m.tag('panel');
  m.cyl(gx, gy, g, deck, deck + g * 0.55, M.dark, { n: 8, top: M.hull });
  const gb = m.box(gx - g * 0.9, gx + g * 0.7, gy - g * 0.75, gy + g * 0.75, deck + g * 0.55, deck + g * 1.3, M.hull, { top: M.lite });
  m.onTop(gb, gx - g * 0.7, gx + g * 0.2, gy - g * 0.55, gy + g * 0.55, deck + g * 1.3, tc.main);
  m.tag('steel');
  m.tubeX(gx + g * 0.7, gx + g * 2.7, gy, deck + g * 0.92, g * 0.36, M.metal, { n: 8, cap: BORE });
  m.tubeX(gx + g * 2.2, gx + g * 2.9, gy, deck + g * 0.92, g * 0.52, GUNMETAL, { n: 8, cap: BORE });
  m.tag(null);
  live.push({ k: 'glow', at: [half, 0, 3 + mh * 0.5], r: 7, col: FURNACE });
  return { model: m, top, live };
}

// ============================================================ MERIDIAN ALLIANCE

/**
 * A shield projector (Aegis): a pylon carrying a broad dish that opens upward round a glowing
 * emitter. Returns the emitter's position.
 */
function projector(m, x, y, z0, h, s, M, A) {
  m.tag('plating');
  m.cyl(x, y, 2.6 * s, z0, z0 + 1.6, M.dark, { n: 6 });
  m.cyl(x, y, 1.5 * s, z0 + 1.6, z0 + h, M.lite, { n: 5, r1: 1.1 * s });
  m.cyl(x, y, 1.6 * s, z0 + h, z0 + h + 2.6 * s, '#dfe6ea', { n: 8, r1: 6 * s, top: '#8fa2b0' });
  m.cyl(x, y, 6.2 * s, z0 + h + 2.6 * s, z0 + h + 3.3 * s, M.hull, { n: 8, top: '#8fa2b0' });
  m.cyl(x, y, 2.3 * s, z0 + h + 2.2 * s, z0 + h + 4.4 * s, A, { n: 6, r1: 1 * s, glow: true, top: '#ffffff' });
  m.tag(null);
  return [x, y, z0 + h + 4.4 * s];
}

/**
 * Meridian Alliance: a clean hangar on an octagonal pad beside a control tower.
 * Level 1 is a small hangar and the tower's stump with a beacon mast; level 2 a larger hangar
 * and a short tower with a lit cab; level 3 the full tower, cab and dish (as a.js builds it).
 * `aegis` adds shield projectors round the pad.
 */
function meridian(level, tc, M, aegis, A) {
  const m = new Mini(), live = [];
  const P = [null,
    { pad: 17, hx0: -2, hx1: 13, hy: 9, hz: 8.6, rz: 13.4, tx: -9, ty: -8 },
    { pad: 21, hx0: -3, hx1: 17, hy: 13, hz: 10.4, rz: 16.8, tx: -12, ty: -10 },
    { pad: 24, hx0: -3, hx1: 20, hy: 16, hz: 12, rz: 19.5, tx: -13, ty: -11 }][level];
  const { tx, ty } = P;
  m.tag('concrete');
  m.cyl(0, 0, P.pad, 0, 1.2, '#8d949a', { n: 8, rot: Math.PI / 8, top: '#a3aab0' });
  // The landmark first: it stands behind the hangar.
  m.tag('plating');
  let top;
  if (level === 1) {
    m.cyl(tx, ty, 5.4, 1.2, 3.6, M.dark, { n: 8 });
    m.cyl(tx, ty, 4.2, 3.6, 11, M.lite, { n: 8, r1: 3.8 });
    m.cyl(tx, ty, 4.8, 11, 13, tc.main, { n: 8, top: tc.light });               // capped off where the tower will rise
    m.tag('steel');
    m.cyl(tx, ty, 0.7, 13, 20, M.metal, { n: 5 });
    m.box(tx - 1, tx + 1, ty - 1, ty + 1, 20, 22, '#ff5a4d', { glow: true });
    top = 22;
    live.push({ k: 'beacon', at: [tx, ty, 21.4] }, { k: 'radar', at: [tx, ty, 14.5] });
  } else if (level === 2) {
    m.cyl(tx, ty, 6.6, 1.2, 4.2, M.dark, { n: 8 });
    m.cyl(tx, ty, 5, 4.2, 30, M.lite, { n: 8, r1: 4.4 });
    m.cyl(tx, ty, 5.8, 14, 17.6, tc.main, { n: 8 });
    m.cyl(tx, ty, 4.6, 30, 32.6, M.dark, { n: 8, r1: 8.4 });
    m.cyl(tx, ty, 8.4, 32.6, 38, SKYGLASS, { n: 8, glow: true });
    m.cyl(tx, ty, 9.4, 38, 39.6, M.lite, { n: 8, top: tc.main });
    m.tag('steel');
    m.cyl(tx, ty, 0.8, 39.6, 47, M.metal, { n: 5 });
    m.box(tx - 1, tx + 1, ty - 1, ty + 1, 47, 49, '#ff5a4d', { glow: true });
    top = 49;
    live.push({ k: 'beacon', at: [tx, ty, 48.4] }, { k: 'radar', at: [tx, ty, 41.5] }, { k: 'glow', at: [tx, ty, 35], r: 10, col: SKYGLASS });
  } else {
    m.cyl(tx, ty, 7.4, 1.2, 4.4, M.dark, { n: 8 });
    m.cyl(tx, ty, 5.6, 4.4, 52, M.lite, { n: 8, r1: 4.8 });
    for (const z of [17, 36]) m.cyl(tx, ty, 6.4, z, z + 4, tc.main, { n: 8 });
    m.cyl(tx, ty, 5, 52, 55, M.dark, { n: 8, r1: 10.2 });
    m.cyl(tx, ty, 10.2, 55, 61.5, SKYGLASS, { n: 8, glow: true });
    m.cyl(tx, ty, 11.4, 61.5, 63.4, M.lite, { n: 8, top: tc.main });
    m.tag('steel');
    m.cyl(tx, ty, 1.3, 63.4, 68, M.metal, { n: 6 });
    m.cyl(tx, ty, 2.2, 68, 74.5, M.lite, { n: 10, r1: 13.5, top: '#dfe6ea' });
    m.cyl(tx, ty, 0.8, 74.5, 81, M.metal, { n: 5 });
    m.box(tx - 1.1, tx + 1.1, ty - 1.1, ty + 1.1, 81, 83.2, '#ff5a4d', { glow: true });
    top = 83;
    live.push({ k: 'beacon', at: [tx, ty, 82.4] }, { k: 'radar', at: [tx, ty, 77] }, { k: 'glow', at: [tx, ty, 58], r: 12, col: SKYGLASS });
  }
  // Fuel tanks behind the hangar's flank (levels 2 and 3).
  m.tag('plating');
  const tanks = level === 3 ? [[-14, 8.5], [-14, 17]] : level === 2 ? [[-13, 9]] : [];
  for (const [x, y] of tanks) m.cyl(x, y, level === 3 ? 4 : 3.6, 1.2, level === 3 ? 9.6 : 8.4, M.hull, { n: 8, top: tc.main });
  // Aegis: shield projectors. Built before the hangar where they stand behind it, after it in front.
  const ph = [0, 8, 12.5, 16][level], ps = [0, 0.8, 0.92, 1.05][level];
  const spots = !aegis ? [] : level === 1 ? [[-10.5, 10]] : level === 2 ? [[-4.5, -18], [5, 17.5]] : [[-2, -21.5], [-22, -2], [9, 20.5]];
  const emit = [];
  for (const [x, y] of spots.filter(q => q[0] + q[1] < 0)) emit.push(projector(m, x, y, 1.2, ph, ps, M, A));
  // The hangar.
  m.tag('plating');
  const { hx0, hx1, hy, hz, rz } = P, door = hy * 0.75;
  const h = m.box(hx0, hx1, -hy, hy, 1.2, hz, M.lite);
  m.onX(h, -door, door, 1.2, hz - 1.8, hx1, '#27313a');
  m.onX(h, -door, door, hz * 0.58, hz * 0.58 + 1.6, hx1, tc.main);
  m.onX(h, -door, door, 2.6, 3.8, hx1, tc.main);
  m.onY(h, hx0 + 3, hx1 - 3, hz * 0.45, hz * 0.72, hy, SKYGLASS, true);
  m.onY(h, hx0, hx1, hz - 1.8, hz, hy, tc.main);
  const r = m.ridge(hx0 - 1, hx1 + 1, -hy - 1, hy + 1, hz, rz, M.hull, { gable: M.lite });
  const sx0 = hx0 + (hx1 - hx0) * 0.3, sx1 = hx0 + (hx1 - hx0) * 0.7;
  for (const f of r.faces.slice(0, 2)) {
    const y1 = f.p[0][1];
    m.decal(r, [[sx0, y1, hz], [sx1, y1, hz], [sx1, 0, rz], [sx0, 0, rz]], tc.main, f.n);
  }
  for (const [x, y] of spots.filter(q => q[0] + q[1] >= 0)) emit.push(projector(m, x, y, 1.2, ph, ps, M, A));
  for (const e of emit) live.push({ k: 'waves', at: e, col: A }, { k: 'glow', at: e, r: 6, col: A });
  // Pad lights.
  for (const a of level === 1 ? [0.4, 3.5] : [0.4, 2, 3.5, 5.1]) {
    const x = Math.cos(a) * (P.pad - 2), y = Math.sin(a) * (P.pad - 2);
    m.box(x - 0.9, x + 0.9, y - 0.9, y + 0.9, 1.2, 2.4, M.glow, { glow: true });
  }
  m.tag(null);
  return { model: m, top, live };
}

// ============================================================ VEIL COLLECTIVE

/** A reagent tank (Graft Forge): a tall glowing cylinder in dark bands under a domed cap. */
function reagent(m, x, y, z0, r, h, A) {
  m.tag('steel');
  m.cyl(x, y, r, z0, z0 + h, A, { n: 6, glow: true });
  m.cyl(x, y, r + 0.6, z0, z0 + 1.8, '#221d2a', { n: 6 });
  m.cyl(x, y, r + 0.5, z0 + h * 0.52, z0 + h * 0.52 + 1.5, '#221d2a', { n: 6 });
  m.cyl(x, y, r + 0.8, z0 + h, z0 + h + 1.4, '#2a2531', { n: 6 });
  m.cyl(x, y, r + 0.4, z0 + h + 1.4, z0 + h + 3.2, '#3d3549', { n: 6, r1: r * 0.4, top: A });
  m.tag(null);
}

/** A caged reactor round the foot of the spire (Graft Forge): a glowing core behind dark bars, under a collar. */
function reactor(m, z0, z1, r, A) {
  m.tag('steel');
  m.cyl(0, 0, r, z0, z1, A, { n: 6, glow: true });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4, x = Math.cos(a) * (r + 1.2), y = Math.sin(a) * (r + 1.2);
    m.box(x - 0.8, x + 0.8, y - 0.8, y + 0.8, z0, z1, '#1e1a25');
  }
  m.cyl(0, 0, r + 2.2, z1, z1 + 1.8, '#2a2531', { n: 6, top: '#3d3549' });
  m.tag(null);
}

/**
 * Veil Collective: a pale stepped dome, and from its crown a spire that ends in an orb.
 * Level 1 is a small dome with a stump of spire and a bead of light; level 2 a larger dome with
 * two pylons, a real spire and an orb; level 3 has four pylons, the crown ring and the great
 * orb (as a.js builds it). `forge` adds reagent tanks and cages a reactor round the spire's foot.
 */
function veil(level, tc, M, forge, A) {
  const m = new Mini(), live = [];
  const SHELL = '#8f84a8', PALE = '#aaa0c2';
  // Radii of the disc and of the dome's three steps, and the heights where it steps in.
  const D = [null,
    { disc: 17, r: [15, 13, 8.5, 4.6], z: [2.2, 7.4, 12.4, 16], eyes: 3, pyl: 0 },
    { disc: 21, r: [19, 16.5, 11, 6.2], z: [2.4, 8.5, 14.4, 19], eyes: 4, pyl: 13.5 },
    { disc: 24, r: [22, 19, 12.5, 7], z: [2.4, 9.5, 16, 21], eyes: 5, pyl: 16 }][level];
  const [r0, r1, r2, r3] = D.r, [z0, z1, z2, z3] = D.z;
  m.tag('concrete');
  m.cyl(0, 0, D.disc, 0, z0, '#4b4358', { n: 10, top: '#5f5673' });
  const pylon = (x, y, zt) => {
    m.tag('panel');
    block(m, x, y, level === 3 ? 3.2 : 2.7, 1.2, z0, zt, tc.main, { top: tc.light });
    m.box(x - 1.1, x + 1.1, y - 1.1, y + 1.1, zt, zt + 3, M.glow, { glow: true });
    live.push({ k: 'glow', at: [x, y, zt + 1.5], r: 4.5, col: M.glow });
  };
  const pz = level === 3 ? 30 : 22, q = D.pyl;
  // Rear pylons, then the dome, then the front ones.
  if (level === 3) { pylon(-q, -q, pz); pylon(q, -q, pz); pylon(-q, q, pz); } else if (level === 2) pylon(-q, -q, pz);
  m.tag('panel');
  m.cyl(0, 0, r0, z0, z1, M.lite, { n: 10, r1 });
  m.cyl(0, 0, r1, z1, z2, SHELL, { n: 10, r1: r2, top: PALE });
  m.cyl(0, 0, r2, z2, z3, PALE, { n: 10, r1: r3, top: tc.main });
  m.cyl(0, 0, r1 + 0.6, z1 - 0.3, z1 + 1.1, tc.main, { n: 10 });
  for (let i = 0; i < D.eyes; i++) {
    const a = (i / D.eyes) * TAU + 0.5, er = (r0 + r1) / 2 - 0.3, x = Math.cos(a) * er, y = Math.sin(a) * er;
    m.box(x - 1.5, x + 1.5, y - 1.5, y + 1.5, z0 + 1.6, z1 - 2, M.glow, { glow: true });
  }
  // The landmark.
  let top;
  if (level === 1) {
    m.cyl(0, 0, 3.2, z3, 23, M.lite, { n: 6, r1: 1.4 });
    m.cyl(0, 0, 3.8, z3, z3 + 1.6, tc.main, { n: 6 });
    m.cyl(0, 0, 1, 23, 24.6, M.glow, { n: 8, r1: 3, glow: true });
    m.cyl(0, 0, 3, 24.6, 27, M.glow, { n: 8, r1: 0.8, glow: true, top: '#ffffff' });
    top = 27;
    live.push({ k: 'glow', at: [0, 0, 25], r: 6, col: M.glow });
  } else if (level === 2) {
    if (forge) reactor(m, z3, 27, 5.2, A);
    m.cyl(0, 0, forge ? 4.2 : 6, z3, 27, M.lite, { n: 6, r1: 4 });
    m.cyl(0, 0, 4, 27, 45, M.lite, { n: 6, r1: 1.9 });
    m.cyl(0, 0, 4.8, 27, 29.2, tc.main, { n: 6 });
    m.cyl(0, 0, 1.5, 45, 48.4, M.glow, { n: 8, r1: 5.4, glow: true });
    m.cyl(0, 0, 5.4, 48.4, 51, M.glow, { n: 8, glow: true });
    m.cyl(0, 0, 5.4, 51, 55, M.glow, { n: 8, r1: 1.2, glow: true, top: '#ffffff' });
    top = 56;
    live.push({ k: 'glow', at: [0, 0, 50], r: 10, col: M.glow });
  } else {
    if (forge) reactor(m, z3, 32, 6.4, A);
    m.cyl(0, 0, forge ? 5.2 : 7.4, 21, 33, M.lite, { n: 6, r1: 4.8 });
    m.cyl(0, 0, 4.8, 33, 65, M.lite, { n: 6, r1: 2.2 });
    m.cyl(0, 0, 5.6, 33, 35.4, tc.main, { n: 6 });
    m.box(-11.4, 11.4, -0.7, 0.7, 56.4, 57.6, M.metal);
    m.box(-0.7, 0.7, -11.4, 11.4, 56.4, 57.6, M.metal);
    // The ring, far half first.
    for (const i of [4, 5, 3, 6, 2, 7, 1, 0]) {
      const a0 = (i / 8) * TAU + 0.06, a1 = ((i + 1) / 8) * TAU - 0.06;
      ringSeg(m, 0, 0, 11, 15.6, a0, a1, 55, 59, i % 2 ? PALE : tc.main, { top: i % 2 ? '#c8c0dc' : tc.light });
    }
    m.cyl(0, 0, 1.8, 65, 70, M.glow, { n: 8, r1: 7.4, glow: true });
    m.cyl(0, 0, 7.4, 70, 73.5, M.glow, { n: 8, glow: true });
    m.cyl(0, 0, 7.4, 73.5, 79, M.glow, { n: 8, r1: 1.6, glow: true, top: '#ffffff' });
    top = 80;
    live.push({ k: 'glow', at: [0, 0, 72], r: 14, col: M.glow });
  }
  if (forge && level > 1) live.push({ k: 'glow', at: [0, 0, z3 + 5], r: 9, col: A }, { k: 'spark', at: [0, 0, z3 + 6], col: '#eaffef' });
  // Front pylons, and Graft Forge's reagent tanks standing against the front of the dome.
  if (level >= 2) pylon(q, q, pz);
  if (forge) {
    const tr = [0, 2.8, 3.2, 3.8][level], th = [0, 10, 13.5, 17][level], d = r0 - 1.5;
    const at = level === 1 ? [[d, 0]] : [[d, 0], [0, d]];
    for (const [x, y] of at) { reagent(m, x, y, z0, tr, th, A); live.push({ k: 'glow', at: [x, y, z0 + th * 0.55], r: 6, col: A }); }
  }
  m.tag(null);
  return { model: m, top, live };
}

// ============================================================ NEUTRAL

/**
 * Nobody's: a derelict works in bare concrete and rust. No colours, no lights, dark windows.
 * Level 1 is a blockhouse with a lean-to; level 2 a two-storey depot beside a silo; level 3 a
 * stepped works under a dead chimney. Each is plainly smaller than a faction's base of its level.
 */
function neutral(level) {
  const m = new Mini();
  const CONC = '#8a8a82', DIM = '#6b6b64', FOOT = '#5e5e58', RUST = '#7a5544', RUSTD = '#5e4034', ROOF = '#55524c', DARK = '#22262a', WOOD = '#6f5a43';
  const half = [0, 14, 19, 23][level];
  m.tag('concrete');
  block(m, 0, 0, half + 2, half, 0, 2, FOOT, { top: '#6f6f68' });
  const windows = (s, onFace, a0, a1, z0, z1, n) => {                   // a row of dark, unlit windows
    for (let i = 0; i < n; i++) { const u = a0 + ((i + 0.5) / n) * (a1 - a0); onFace(u - 1.5, u + 1.5, z0, z1); }
  };
  if (level === 1) {
    m.tag('steel');
    m.cyl(-6, -5, 2.2, 2, 17, DIM, { n: 6, r1: 1.8, top: DARK });                 // a cold flue
    m.tag('concrete');
    const b = m.box(-10, 10, -9, 9, 2, 10.5, CONC);
    m.onX(b, -3, 3, 2, 8, 10, DARK);                                              // doorway
    m.onX(b, -3, 3, 5, 6.2, 10, WOOD); m.onX(b, -3, 3, 2.8, 4, 10, WOOD);         // boarded across
    windows(b, (u0, u1, a, c) => m.onY(b, u0, u1, a, c, 9, DARK), -8, 8, 5, 8, 2);
    m.box(-11, 11, -10, 10, 10.5, 11.8, ROOF, { top: '#63605a' });
    m.tag('corrugated');
    m.box(3, 13, -13, -9, 2, 6.4, RUSTD, { top: RUST });                          // lean-to behind
    m.tag('wood');
    m.box(8, 12.5, 10, 13.5, 2, 5.4, WOOD, { top: '#84705a' }); m.box(3.5, 7, 10.5, 13.5, 2, 4.2, '#5d4a37', { top: WOOD });
    m.tag(null);
    return { model: m, top: 18, live: [] };
  }
  if (level === 2) {
    m.tag('concrete');
    m.cyl(12.5, -12, 5.6, 2, 22, CONC, { n: 8 });                                 // silo
    m.cyl(12.5, -12, 6, 12, 14, RUSTD, { n: 8 });
    m.cyl(12.5, -12, 6, 22, 25.5, RUST, { n: 8, r1: 1.6 });
    const b = m.box(-15, 11, -12, 13, 2, 13, CONC);
    m.onX(b, -4, 5, 2, 9.4, 11, DARK);
    m.onX(b, -4, 5, 5.4, 6.8, 11, WOOD);
    windows(b, (u0, u1, a, c) => m.onY(b, u0, u1, a, c, 13, DARK), -13, 9, 6, 10, 4);
    m.onY(b, -6, -2, 2, 6, 13, RUSTD);                                            // a rust stain running down
    m.box(-16, 12, -13, 14, 13, 14.4, ROOF, { top: '#63605a' });
    const u = m.box(-11, 4, -8, 8, 14.4, 21, DIM);
    windows(u, (u0, u1, a, c) => m.onY(u, u0, u1, a, c, 8, DARK), -9, 2, 16.4, 19, 3);
    windows(u, (u0, u1, a, c) => m.onX(u, u0, u1, a, c, 4, DARK), -6, 6, 16.4, 19, 3);
    m.tag('corrugated');
    m.box(-12, 5, -9, 9, 21, 22.2, RUSTD, { top: RUST });
    m.tag('wood');
    m.box(13.5, 18, 6, 11, 2, 6, WOOD, { top: '#84705a' });
    m.tag(null);
    return { model: m, top: 26, live: [] };
  }
  m.tag('concrete');
  m.cyl(-15, -14, 5.2, 2, 40, CONC, { n: 8, r1: 4.2 });                           // a dead chimney: no smoke, no glow
  m.cyl(-15, -14, 5.6, 22, 24.4, RUSTD, { n: 8 });
  m.cyl(-15, -14, 4.6, 40, 42, DARK, { n: 8, r1: 3.4 });
  m.cyl(15, -14, 5, 2, 24, DIM, { n: 8 });                                        // silo
  m.cyl(15, -14, 5.4, 24, 27.4, RUST, { n: 8, r1: 1.5 });
  const b = m.box(-19, 17, -9, 17, 2, 15, CONC);
  m.onX(b, -2, 9, 2, 11, 17, DARK);
  m.onX(b, -2, 9, 6, 7.6, 17, WOOD); m.onX(b, -2, 9, 3, 4.4, 17, WOOD);
  windows(b, (u0, u1, a, c) => m.onY(b, u0, u1, a, c, 17, DARK), -17, 15, 7, 12, 6);
  m.onY(b, 4, 9, 2, 7, 17, RUSTD);
  m.box(-20, 18, -10, 18, 15, 16.6, ROOF, { top: '#63605a' });
  const u = m.box(-13, 11, -5, 13, 16.6, 26, DIM);
  windows(u, (u0, u1, a, c) => m.onY(u, u0, u1, a, c, 13, DARK), -11, 9, 19, 23.4, 4);
  windows(u, (u0, u1, a, c) => m.onX(u, u0, u1, a, c, 11, DARK), -3, 11, 19, 23.4, 3);
  m.tag('corrugated');
  m.box(-14, 12, -6, 14, 26, 27.4, RUSTD, { top: RUST });
  m.tag('concrete');
  const p = m.box(-7, 5, 0, 9, 27.4, 33, CONC);
  windows(p, (u0, u1, a, c) => m.onY(p, u0, u1, a, c, 9, DARK), -5, 3, 29, 31.6, 2);
  m.box(-8, 6, -1, 10, 33, 34.2, ROOF, { top: '#63605a' });
  m.tag('steel');
  m.box(-1.6, -0.4, 4, 5.2, 34.2, 41, '#4a4e53');                                 // a bare mast, its light long gone
  m.tag('wood');
  m.box(13, 19, 19, 23, 2, 6.4, WOOD, { top: '#84705a' });
  m.tag(null);
  return { model: m, top: 42, live: [] };
}

// ============================================================ the bases this file answers for

const memo = new Map();
const once = (key, build) => { let v = memo.get(key); if (v === undefined) { v = build(); memo.set(key, v); } return v; };

export function moreBase(f, sub, level, tc) {
  if (level !== 1 && level !== 2 && level !== 3) return null;
  if (f === 'neutral') return once(`n|${level}`, () => neutral(level));
  const fac = FACTIONS[f], S = fac && fac.subs[sub];
  if (!S) return null;
  const key = `${f}|${sub}|${level}|${tc.id}`, M = fac.mat, A = S.accent2;
  if (f === 'iron') return sub === 'volt' ? once(key, () => ironVolt(level, tc, M, A)) : null;          // bastion: a.js
  if (f === 'meridian') return sub === 'aegis' || level < 3 ? once(key, () => meridian(level, tc, M, sub === 'aegis', A)) : null;   // shade level 3: a.js
  if (f === 'veil') return sub === 'forge' || level < 3 ? once(key, () => veil(level, tc, M, sub === 'forge', A)) : null;           // dominion level 3: a.js
  return null;
}

// ============================================================ compound

const WALLS = {
  neutral:  { wall: '#777872', cap: '#5b5d57', post: '#666862', tag: 'concrete' },
  iron:     { wall: '#8a867a', cap: '#3f3d39', post: '#6a675f', tag: 'concrete' },
  meridian: { wall: '#b4bdc5', cap: '#6f7a83', post: '#98a3ac', tag: 'plating' },
  veil:     { wall: '#4a4158', cap: '#2a2531', post: '#5f5474', tag: 'panel' },
};

function scatter(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

/**
 * The yard round a base, in the set's manner: the same foundation, the same square of wall and
 * the same gate openings as buildCompound (so roads, siege lines and emplacements are where the
 * game expects them), but a thicker, plainer wall, a broad band of the owner's colour along its
 * top and round the foundation, and one chunky work at each gate post and corner instead of yard
 * furniture: battered blocks for the Iron Pact, octagonal light posts for the Meridian Alliance,
 * tapering pylons for the Veil Collective. A ruin's yard is the same wall broken and colourless.
 * The outer face of the wall is where the shipped one is; the extra thickness is inside.
 */
export function compound(f, level, tc, gates, ruin = false) {
  if (!Array.isArray(gates) || !(level >= 1 && level <= 3)) return null;      // the sprite renderer's generic compound stays as shipped
  const m = new Mini();
  const W = ruin ? { wall: '#57534d', cap: '#2b2927', post: '#4a4641', tag: 'concrete' } : WALLS[f] || WALLS.neutral;
  const M = FACTIONS[f] ? FACTIONS[f].mat : null;
  const owned = !!M && !ruin;
  const rnd = scatter(level * 7 + gates.length * 3 + 1);
  const H = YARD, out = 1.7, inn = 3.1;                                       // wall from H - inn to H + out
  const wh = !M ? 3.4 : [0, 3.8, 5.8, 7.6][level];
  const lamp = f === 'iron' ? FURNACE : M ? M.glow : null;

  // Foundation: the same two steps the base stands on, with the owner's colour round the upper one.
  m.tag('concrete');
  const fh = 30;
  m.box(-fh, fh, -fh, fh, 0, 0.8, '#6c6e6b', { top: ruin ? '#5a5955' : '#7d7f7b' });
  const slab = m.box(-fh + 2, fh - 2, -fh + 2, fh - 2, 0.8, BASE_LIFT, '#787a76', { top: ruin ? '#4b4945' : '#8a8c87' });
  if (ruin) { m.onTop(slab, -19, 16, -15, 18, BASE_LIFT, '#2b2927'); m.onTop(slab, 8, 24, -24, -10, BASE_LIFT, '#35322f'); }
  if (owned) {
    const a = fh - 2, b = fh - 5.5;
    m.onTop(slab, -a, a, b, a, BASE_LIFT, tc.main); m.onTop(slab, -a, a, -a, -b, BASE_LIFT, tc.main);
    m.onTop(slab, b, a, -b, b, BASE_LIFT, tc.main); m.onTop(slab, -a, -b, -b, b, BASE_LIFT, tc.main);
  }

  // Where each road crosses the wall (exactly as buildCompound works it out).
  const openings = [[], [], [], []];
  for (const a of gates) {
    const cs = Math.cos(a), sn = Math.sin(a);
    const side = Math.abs(cs) >= Math.abs(sn) ? (cs > 0 ? 0 : 2) : (sn > 0 ? 1 : 3);
    const along = side % 2 === 0 ? H * sn / Math.abs(cs) : H * cs / Math.abs(sn);
    const slant = 1 / Math.max(0.5, side % 2 === 0 ? Math.abs(cs) : Math.abs(sn));
    openings[side].push({ at: Math.max(-H + 4, Math.min(H - 4, along)), half: Math.min(26, 15.5 * slant) });
  }
  // A point on a side: u along it, w outward from the wall line.
  const place = (side, u, w) => (side === 0 ? [H + w, u] : side === 1 ? [u, H + w] : side === 2 ? [-H - w, u] : [u, -H - w]);
  const rect = (side, u0, u1, w0, w1) => {
    const [ax, ay] = place(side, u0, w0), [bx, by] = place(side, u1, w1);
    return [Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by)];
  };

  const run = (side, u0, u1) => {
    if (u1 - u0 < 1.2) return;
    if (ruin) {                                                               // lengths of wall at any height, and breaches
      m.tag('concrete');
      const L = u1 - u0, n = Math.max(1, Math.round(L / 6));
      for (let i = 0; i < n; i++) {
        const k = rnd();
        if (k < 0.26) continue;
        const [x0, x1, y0, y1] = rect(side, u0 + (i * L) / n, u0 + ((i + 1) * L) / n, -inn, out);
        m.box(x0, x1, y0, y1, 0, 0.8 + wh * k * 0.95, W.wall, { top: W.cap });
      }
      return;
    }
    const [x0, x1, y0, y1] = rect(side, u0, u1, -inn, out);
    m.tag(W.tag);
    m.box(x0, x1, y0, y1, 0, wh, W.wall);
    m.tag('panel');
    const [cx0, cx1, cy0, cy1] = rect(side, u0, u1, -inn - 0.4, out + 0.4);   // a broad coping in the owner's colour
    m.box(cx0, cx1, cy0, cy1, wh, wh + 1.3, owned ? tc.main : W.cap, { top: owned ? tc.light : W.cap });
  };

  // A chunky work on the wall line: gate posts and corners. s scales it; a gate post carries a lamp.
  const post = (x, y, s, h, gate) => {
    if (ruin) { m.tag('concrete'); block(m, x, y, 2.4 * s, 2 * s, 0, 1.2 + rnd() * (h * 0.6), W.post, { top: W.cap }); return; }
    m.tag(W.tag);
    if (f === 'meridian') {
      m.cyl(x, y, 2.9 * s, 0, h, W.post, { n: 8, rot: Math.PI / 8 });
      m.tag('panel');
      m.cyl(x, y, 3.4 * s, h, h + 1.6, tc.main, { n: 8, rot: Math.PI / 8, top: tc.light });
    } else if (f === 'veil') {
      m.cyl(x, y, 3.2 * s, 0, h + 1.6, W.post, { n: 6, r1: 1.7 * s });
      m.tag('panel');
      m.cyl(x, y, 2.3 * s, h * 0.55, h * 0.55 + 1.6, tc.main, { n: 6 });
    } else {
      block(m, x, y, 2.9 * s, 2.3 * s, 0, h, W.post);
      m.tag('panel');
      block(m, x, y, 2.9 * s, 2.9 * s, h, h + 1.7, owned ? tc.main : W.cap, { top: owned ? tc.light : W.cap });
    }
    if (owned && lamp && (gate || level === 3)) {
      const z = h + 1.6;
      m.box(x - 0.9 * s, x + 0.9 * s, y - 0.9 * s, y + 0.9 * s, z, z + 1.8 * s, lamp, { glow: true });
    }
  };

  for (const side of [0, 1, 2, 3]) {
    const ops = openings[side].sort((p, q) => p.at - q.at);
    let u = -H;
    for (const op of ops) {
      run(side, u, op.at - op.half);
      // Gate posts stand just outside the opening, so the road keeps the width the shipped gate gives it.
      for (const g of [op.at - op.half - 0.8, op.at + op.half + 0.8]) {
        if (Math.abs(g) > H - 1) continue;
        const [px, py] = place(side, g, -0.7);
        post(px, py, 0.92, wh + 4.2, true);
      }
      u = op.at + op.half;
    }
    run(side, u, H);
  }

  // Corners: a block at level 1, a tower at 2, a taller tower at 3. None where a gate comes too close.
  const corner = (sx, sy) => {
    const cx = sx * (H - 0.7), cy = sy * (H - 0.7);
    const blocked = gates.length && [0, 1, 2, 3].some(side => openings[side].some(op => {
      const [px, py] = place(side, op.at, 0);
      return Math.hypot(px - sx * H, py - sy * H) < op.half + 7;
    }));
    if (blocked) return;
    post(cx, cy, !M ? 1 : [0, 1, 1.25, 1.5][level], wh + (!M ? 1.6 : [0, 1.8, 5, 9][level]), false);
  };
  corner(-1, -1); corner(1, -1); corner(-1, 1); corner(1, 1);

  // Rubble across a ruined yard, clear of the roads.
  if (ruin) {
    const free = (x, y) => !gates.some(a => { const d = Math.abs(x * Math.sin(a) - y * Math.cos(a)); return d < 17 && x * Math.cos(a) + y * Math.sin(a) > 0; });
    m.tag('concrete');
    for (let i = 0; i < 12; i++) {
      const x = -H + 5 + rnd() * (2 * H - 10), y = -H + 5 + rnd() * (2 * H - 10), sz = 1.4 + rnd() * 2.6;
      if (Math.max(Math.abs(x), Math.abs(y)) < fh + 1 || !free(x, y)) continue;
      m.cyl(x, y, sz, 0, sz * (0.5 + rnd() * 0.5), i % 3 ? '#6f6a61' : '#5b463c', { n: 5, r1: sz * 0.4, rot: rnd() * 6 });
    }
  }
  m.tag(null);
  return m;
}
