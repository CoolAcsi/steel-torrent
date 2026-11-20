// Sprite facade. Models live in units.js / buildings.js; this file bakes them
// into cached sprites: 32 facings for vehicle hulls and turrets, 8 facings x 4
// walk frames for infantry, one sprite per base (faction, subfaction, level,
// team colour).
import { Model, renderModel, F } from './iso.js';
import { buildHull, buildTurret, drawSoldier, unitSpec } from './units.js';
import { buildBase, buildCompound, BS, BASE_LIFT } from './buildings.js';
import { ruinModel, emplacementModel, obstacleModel, portalModel, scaffoldModel, shieldDomeModel } from './buildings.js';
export { ruinModel, emplacementModel, obstacleModel, portalModel, scaffoldModel, shieldDomeModel };
export { unitModel, unitId, rosterList, LOD, clamp01, ease, walkFrame, hullPose, angleDiff, turnToward, idleTurret, recoil } from './units.js';
export { portalPose, domePose, buildPose, progressAt } from './buildings.js';

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
 * With `ruin` it is the breached, burnt yard of a destroyed base (draw ruinModel() in it).
 */
export function compoundModel(f, level, tc, gates, ruin = false) {
  return buildCompound(f, level, tc, gates, ruin);
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

/** A destroyed base in its breached yard, for the canvas renderer. */
export function ruinSprite(cache, f, level) {
  return cache.get(`ruin|${f}|${level}`, BBOX, {
    shadow(g) {
      g.fillStyle = 'rgba(0,0,0,.3)';
      g.beginPath(); g.ellipse(9, 6, 44, 24, 0, 0, TAU); g.fill();
    },
    draw(g) {
      renderModel(g, memo(`CR|${f}|${level}`, () => buildCompound(f, level, NEUTRAL, null, true)), YAW_B, false);
      g.translate(0, -BASE_LIFT);
      g.scale(BS, BS);
      renderModel(g, ruinModel(0), YAW_B, true);
    },
    outline: true,
    grime: 1900 + level,
  });
}

/** Scaffolding round a base under construction, for the canvas renderer (four stages). */
export function scaffoldSprite(cache, progress, level) {
  const stage = Math.max(0, Math.min(3, Math.floor(progress * 4)));
  return cache.get(`scf|${stage}|${level}`, BBOX, {
    draw(g) {
      g.translate(0, -BASE_LIFT);
      g.scale(BS, BS);
      renderModel(g, scaffoldModel(progress, level), YAW_B, true);
    },
  });
}

// ------------------------------------------------------------ representative rendering
// how many figures stand for an army on screen.
//
// This is a drawing choice and nothing else. It reads soldier counts and returns figure
// counts; it holds no state, changes nothing it is given, and has no access to the
// simulation or the wire format. An army of 60 is still 60 soldiers in every rule; it is
// drawn as, say, 18 figures in its real mix of tiers, and its plate carries the exact number.

/**
 * exact: armies up to this size draw one figure per soldier
 * group: beyond that, one more figure per this many further soldiers
 * cap:   never more figures than this for one army
 */
export const FIGURES = Object.freeze({ exact: 12, group: 5, cap: 18 });

/**
 * @param n      soldiers in the army (used when `tiers` is missing or sums to nothing)
 * @param tiers  [tier 1, tier 2, tier 3] soldier counts
 * @param opts   { exact, group, cap } - defaults to FIGURES; missing fields fall back to it
 * @returns { total, each: [f1, f2, f3], perFigure }  figures in all, per tier, and soldiers per figure
 */
export function figuresFor(n, tiers, opts) {
  const o = opts || FIGURES;
  const exact = Math.max(1, Math.floor(o.exact ?? FIGURES.exact));
  const group = Math.max(1, o.group ?? FIGURES.group);
  const cap = Math.max(1, Math.floor(o.cap ?? FIGURES.cap));
  const c = [0, 1, 2].map(i => Math.max(0, Math.floor((tiers && tiers[i]) || 0)));
  let N = c[0] + c[1] + c[2];
  if (!N) { N = Math.max(0, Math.floor(n || 0)); c[0] = N; }       // no breakdown given: all infantry
  if (!N) return { total: 0, each: [0, 0, 0], perFigure: 0 };

  const total = Math.min(cap, N, N <= exact ? N : exact + Math.ceil((N - exact) / group));

  // Share the figures out in proportion (largest remainder), so a mixed army stays mixed:
  // every tier present keeps at least one figure while there are figures to go round.
  const present = c.filter(x => x > 0).length;
  const each = [0, 0, 0], rem = [0, 0, 0];
  let given = 0;
  for (let i = 0; i < 3; i++) {
    const q = (c[i] * total) / N;
    each[i] = Math.floor(q);
    if (c[i] > 0 && each[i] === 0 && total >= present) each[i] = 1;
    rem[i] = q - Math.floor(q);
    given += each[i];
  }
  // Hand out what is left by remainder (heavier tier first on a tie: it is the rarer sight)...
  while (given < total) {
    let best = -1;
    for (let i = 2; i >= 0; i--) if (each[i] < c[i] && (best < 0 || rem[i] > rem[best])) best = i;
    if (best < 0) break;
    each[best]++; rem[best] = -1; given++;
  }
  // ...or take back what the "at least one" rule over-gave, from whoever has most.
  while (given > total) {
    let most = 0;
    for (let i = 1; i < 3; i++) if (each[i] > each[most]) most = i;
    each[most]--; given--;
  }
  return { total: given, each, perFigure: N / given };
}
