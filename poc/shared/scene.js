// Engine-neutral description of the PoC battlefield.
//
// Both proofs of concept render exactly this: the same snapshot of a real
// match, the game's own base and unit models, the same ground painting, the
// same towers, trees and lamps. Only the renderer differs, so the pictures
// can be compared like for like.
//
// Coordinates handed to the engines are "ground" coordinates:
//   X right, Z toward the camera, Y up (the usual right-handed, Y-up frame).
// The game's view coordinates (x, y) map to X = x, Z = y / F: the game stores
// y already foreshortened for the screen, a 3D camera does that itself.
import { MAP } from './map.js';
import { paintGround } from './ground.js';
import { F } from '/public/js/iso.js';
import { COLORS, NEUTRAL, padModel3d } from '/public/js/art.js';
import { buildBase, BS } from '/public/js/buildings.js';
import { buildHull, buildTurret, buildSoldier } from '/public/js/units.js';
import { planScenery, lampModel } from '/public/js/scenery.js';

export { F };
export const PITCH = Math.asin(F);            // camera elevation that gives the game's foreshortening
export const SUN = [-0.52, 0.76, -0.4];       // toward the light, in ground coordinates (same sun as the game)
export const FOG = [0.66, 0.714, 0.77];       // haze colour (sRGB 168,182,196)
const R = 36;                                 // city radius

function seeded(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything the engines need, built once. */
export function buildScene() {
  const rnd = seeded(4242);
  const M = MAP;

  // --- layout: view coordinates with a margin, like the game
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of M.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
  const pad = { l: 80, r: 80, t: 150, b: 70 };                  // a little more sky side than the game, to show the skyline
  const nodes = M.nodes.map(n => ({ x: n.x - x0 + pad.l, y: n.y - y0 + pad.t }));
  const frame = { x0: 0, y0: 0, x1: x1 - x0 + pad.l + pad.r, y1: y1 - y0 + pad.t + pad.b };   // what the camera shows
  const world = { x0: -520, y0: -330, x1: frame.x1 + 520, y1: frame.y1 + 60 };                // what exists (ground and skyline)

  const sides = M.players.map((p, i) => ({ f: p.f, sub: p.sub, tc: COLORS[i] }));
  const neutral = { f: 'neutral', sub: '', tc: NEUTRAL };
  const owners = M.nodes.map((n, i) => ([4, 9, 19].includes(i) ? -1 : n.o));    // leave a few cities neutral for variety
  const sideOf = o => (o >= 0 ? sides[o] : neutral);

  // --- scenery inside the field: the game's own planner (blocks never cover a road or a city)
  const inner = planScenery({ nodes, roads: M.edges, R, seed: 4242, x0: frame.x0, y0: frame.y0, x1: frame.x1, y1: frame.y1 });

  // --- towers. Inside the field, the planner's plots; around it, a skyline that
  //     grows taller toward the far side and is left out along the near edge.
  const towers = [];
  for (const b of inner.blocks) {
    const floors = Math.max(3, Math.round((b.h - 7) / 7.2) + Math.floor(rnd() * 3));
    towers.push({ x: b.x, z: b.y / F, a: b.a, floors, look: Math.floor(rnd() * 3), seed: Math.floor(rnd() * 1e6) });
  }
  const STEP = 96;
  for (let gx = world.x0 + 40; gx < world.x1 - 30; gx += STEP) {
    for (let gy = world.y0 + 30; gy < frame.y1 - 60; gy += STEP * F) {
      const x = gx + (rnd() - 0.5) * 26, y = gy + (rnd() - 0.5) * 12;
      const outside = Math.max(frame.x0 + 40 - x, x - (frame.x1 - 40), frame.y0 + 96 - y, 0);
      if (outside <= 0 || rnd() < 0.2) continue;                // only around the field, with a few gaps
      const far = Math.max(0, frame.y0 + 96 - y);               // how far behind the field
      const a = 46 + Math.floor(rnd() * 3) * 8;
      const floors = Math.round(7 + rnd() * 8 + far * 0.085 + (outside > 150 ? 6 : 0));
      towers.push({ x, z: y / F, a, floors, look: Math.floor(rnd() * 3), seed: Math.floor(rnd() * 1e6) });
    }
  }

  // --- ground painting (albedo + wetness) over everything that exists
  const k = 4096 / (world.x1 - world.x0);
  const albedo = document.createElement('canvas'), wet = document.createElement('canvas');
  albedo.width = 4096;
  albedo.height = Math.round((world.y1 - world.y0) * k);
  const painted = paintGround(albedo, {
    k, ox: -world.x0 * k, oy: -world.y0 * k, nodes, roads: M.edges, R, seed: 4242,
    scenery: { blocks: towers.map(t => ({ x: t.x, y: t.z * F, a: t.a })), lamps: [] },
  }, wet);

  // --- trees where the painter put lawns
  const trees = painted.trees.map(t => ({ x: t.x, z: t.y / F, s: t.s * 1.25, kind: t.r < 0.5 ? 0 : 1 }));

  // --- cities
  const cities = nodes.map((p, i) => {
    const s = sideOf(owners[i]), level = M.nodes[i].l;
    const base = buildBase(s.f, s.sub, level, s.tc);
    return { i, x: p.x, z: p.y / F, owner: owners[i], level, n: M.nodes[i].n, tc: s.tc, top: base.top,
      baseKey: `b|${s.f}|${s.sub}|${level}|${s.tc.id}`, base: () => base.model, baseScale: BS,
      padKey: `pad|${s.tc.id}`, pad: () => padModel3d(s.tc) };
  });

  // --- armies: a column on a third of the roads, in the owner's units, heading away from its city
  const units = [];
  const plates = [];
  M.edges.forEach(([a, b], e) => {
    if (e % 3 !== 0) return;
    const [from, to] = e % 2 ? [a, b] : [b, a];
    if (owners[from] < 0) return;
    const s = sides[owners[from]];
    const A = nodes[from], B = nodes[to];
    const dx = B.x - A.x, dz = (B.y - A.y) / F, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, yaw = Math.atan2(dz, dx);
    const at = len * (0.3 + rnd() * 0.4);
    const mix = [[3, 2, 2], [3, 1, 2, 1], [3, 3, 1, 1], [2, 2, 1]][e % 4];          // rows from the front: tier per row
    let back = 0, count = 0;
    mix.forEach(tier => {
      const per = tier === 1 ? 4 : tier === 2 ? 3 : 2, lane = tier === 1 ? 11 : tier === 2 ? 19 : 23;
      for (let c = 0; c < per; c++) {
        const side = (c - (per - 1) / 2) * lane;
        const x = A.x + ux * (at - back) - uz * side, z = A.y / F + uz * (at - back) + ux * side;
        if (tier === 1) units.push({ key: `s|${s.f}|${s.sub}|${s.tc.id}|${c % 4}`, model: () => buildSoldier(s.f, s.sub, s.tc, c % 4), x, z, y: 0, yaw });
        else {
          units.push({ key: `h|${s.f}|${s.sub}|${tier}|${s.tc.id}`, model: () => buildHull(s.f, s.sub, tier, s.tc), x, z, y: 0, yaw });
          units.push({ key: `t|${s.f}|${s.sub}|${tier}|${s.tc.id}`, model: () => buildTurret(s.f, s.sub, tier, s.tc), x, z, y: 0, yaw });
        }
        count++;
      }
      back += tier === 1 ? 15 : tier === 2 ? 23 : 27;
    });
    plates.push({ x: A.x + ux * at, z: A.y / F + uz * at, h: 26, text: String(count * 3), tc: s.tc });
  });
  for (const c of cities) plates.push({ x: c.x, z: c.z + 40, h: 0, text: String(c.n), tc: c.tc, city: true });

  const lamps = inner.lamps.map(p => ({ x: p.x, z: p.y / F }));

  return {
    frame, world, R,
    ground: { albedo, wet, x0: world.x0, x1: world.x1, z0: world.y0 / F, z1: world.y1 / F },
    cities, units, towers, trees, lamps, plates,
    lamp: lampModel,
    counts: { cities: cities.length, units: units.length, towers: towers.length, trees: trees.length, lamps: lamps.length },
  };
}

/** Zoom and pan of the PoC view. Starts from ?z=<zoom>&fx=<0..1>&fy=<0..1>; the mouse wheel and dragging change it. */
export function makeView() {
  const q = new URLSearchParams(location.search);
  return { zoom: Number(q.get('z')) || 1, fx: q.has('fx') ? Number(q.get('fx')) : 0.5, fy: q.has('fy') ? Number(q.get('fy')) : 0.5 };
}

/** Wheel to zoom, drag to pan. `scaleOf()` gives CSS pixels per view unit at the current zoom. */
export function attachControls(el, frame, view, scaleOf, onChange) {
  const fw = frame.x1 - frame.x0, fh = frame.y1 - frame.y0;
  el.addEventListener('wheel', e => {
    e.preventDefault();
    view.zoom = Math.max(1, Math.min(6, view.zoom * Math.exp(-e.deltaY * 0.0015)));
    onChange();
  }, { passive: false });
  let drag = null;
  el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    const s = scaleOf();
    view.fx = Math.max(0, Math.min(1, view.fx - (e.clientX - drag.x) / s / fw));
    view.fy = Math.max(0, Math.min(1, view.fy - (e.clientY - drag.y) / s / fh));
    drag = { x: e.clientX, y: e.clientY };
    onChange();
  });
  el.addEventListener('pointerup', () => { drag = null; });
}

/**
 * Orthographic camera that reproduces the game's view of `frame` in a canvas of
 * w x h CSS pixels: ground depth is foreshortened by F, the frame is fitted and centred
 * (then zoomed and panned by `view`).
 * Returns the half-extents and the ground point at the centre of the screen.
 */
export function fitCamera(frame, w, h, view = { zoom: 1, fx: 0.5, fy: 0.5 }) {
  const fw = frame.x1 - frame.x0, fh = frame.y1 - frame.y0;
  const scale = Math.min(w / fw, h / fh) * view.zoom;
  return {
    scale, halfW: w / scale / 2, halfH: h / scale / 2,
    target: [frame.x0 + fw * view.fx, 0, (frame.y0 + fh * view.fy) / F],
    dir: [0, Math.sin(PITCH), Math.cos(PITCH)],            // from the target toward the camera
  };
}
