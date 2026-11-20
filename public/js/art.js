// Sprite facade. Models live in units.js / buildings.js; this file bakes them
// into cached sprites: 32 facings for vehicle hulls and turrets, 8 facings x 4
// walk frames for infantry, one sprite per base (faction, subfaction, level,
// team colour).
import { Model, renderModel, F } from './iso.js';
import { buildHull, buildTurret, drawSoldier, unitSpec } from './units.js';
import { buildBase, buildCompound, BS, BASE_LIFT } from './buildings.js';

/** Team colours. Only ever applied to marking areas, never to whole models. */
export const COLORS = [
  { id: 'red',    main: '#d5383d', dark: '#7a1e22', light: '#ff8d88' },
  { id: 'blue',   main: '#2f7fe8', dark: '#174585', light: '#9cc6ff' },
  { id: 'green',  main: '#3aa85c', dark: '#1c5f33', light: '#9be6b2' },
  { id: 'gold',   main: '#e3a51f', dark: '#84590a', light: '#ffe08a' },
  { id: 'violet', main: '#8d5fe6', dark: '#4c2c8a', light: '#cdb8ff' },
  { id: 'cyan',   main: '#1fa9bf', dark: '#0d5f6d', light: '#98e7f1' },
  { id: 'orange', main: '#ec7424', dark: '#893f0b', light: '#ffc59b' },
  { id: 'pink',   main: '#e0548f', dark: '#832653', light: '#ffb3d5' },
];
export const NEUTRAL = { id: 'neutral', main: '#878c90', dark: '#4a4f54', light: '#c2c7cb' };

const TAU = Math.PI * 2;
export const DIRS = 32;
export const STEP = TAU / DIRS;
const YAW_B = Math.PI / 4;                 // buildings sit corner-on to the camera

const VBOX = [70, 62, 35, 41];             // vehicle sprite box [w, h, anchorX, anchorY]
const SBOX = [32, 36, 16, 27];             // infantry
const BBOX = [150, 138, 75, 98];           // base, with its compound

const models = new Map();
function memo(key, build) {
  let m = models.get(key);
  if (!m) models.set(key, (m = build()));
  return m;
}

export { unitSpec };

export function hullSprite(cache, f, sub, level, tc, d) {
  const spec = unitSpec(f, sub, level);
  return cache.get(`h|${f}|${sub}|${level}|${tc.id}|${d}`, VBOX, {
    // Hovering craft cast their shadow from the ground, so it is drawn live.
    shadow: spec.hover ? null : g => {
      const [l, w] = spec.foot;
      const cs = Math.cos(d * STEP), sn = Math.sin(d * STEP);
      g.fillStyle = 'rgba(0,0,0,.38)';
      g.beginPath();
      for (const [x, y] of [[-l, -w], [l, -w], [l, w], [-l, w]]) g.lineTo(x * cs - y * sn + 4, (x * sn + y * cs) * F + 3.2);
      g.closePath();
      g.fill();
    },
    draw(g) { renderModel(g, memo(`H|${f}|${sub}|${level}|${tc.id}`, () => buildHull(f, sub, level, tc)), d * STEP); },
    outline: true,
    grime: level * 100 + d,
  });
}

export function turretSprite(cache, f, sub, level, tc, d) {
  return cache.get(`t|${f}|${sub}|${level}|${tc.id}|${d}`, VBOX, {
    draw(g) { renderModel(g, memo(`T|${f}|${sub}|${level}|${tc.id}`, () => buildTurret(f, sub, level, tc)), d * STEP); },
    outline: true,
    grime: level * 200 + d,
  });
}

export function soldierSprite(cache, f, sub, tc, dir8, frame) {
  return cache.get(`s|${f}|${sub}|${tc.id}|${dir8}|${frame}`, SBOX, {
    shadow(g) {
      g.fillStyle = 'rgba(0,0,0,.38)';
      g.beginPath(); g.ellipse(2.2, 1, 5.4, 2.6, 0, 0, TAU); g.fill();
    },
    draw(g) { drawSoldier(g, f, sub, tc, dir8, frame); },
    outline: true,
  });
}

/**
 * Compound for a city in the 3D renderer: foundation, perimeter wall with a gate for each
 * road, corner works and yard furniture. `gates` are the road directions in the compound's frame.
 */
export function compoundModel(f, level, tc, gates) {
  return buildCompound(f, level, tc, gates);
}

/** Model, live details and height of a base. f = 'neutral' for unowned bases. */
export function baseInfo(f, sub, level, tc) {
  return buildBase(f, sub, level, tc);
}

export function baseSprite(cache, f, sub, level, tc) {
  return cache.get(`b|${f}|${sub}|${level}|${tc.id}`, BBOX, {
    shadow(g) {
      g.fillStyle = 'rgba(0,0,0,.34)';
      g.beginPath(); g.ellipse(9, 6, 46, 26, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(30, -2, 34, 15, -0.35, 0, TAU); g.fill();
    },
    draw(g) {
      // The sprite renderer has one compound per base type, not per city, so it draws the
      // foundation and corner works only: no wall that could stand across a road.
      renderModel(g, memo(`C|${f}|${level}|${tc.id}`, () => buildCompound(f, level, tc, null)), YAW_B, false);
      g.translate(0, -BASE_LIFT);
      g.scale(BS, BS);
      renderModel(g, buildBase(f, sub, level, tc).model, YAW_B, false);
    },
    outline: true,
    grime: 1000 + level,
  });
}
