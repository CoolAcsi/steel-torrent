// Hand-made road maps for rule tests: a small known graph, real orders, real ticks.
//
//         0 ---- 1 ---- 2 ---- 3 ---- 4 ---- 9
//                |      |      |             |
//                5 ---- 6 ---- 7             8
//
// The upper road 1-2-3 is 400 long, the lower road 1-5-6-7-3 about 674.
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BALANCE: B } = require('../game/config');
const { Game, makeGroup } = require('../game/sim');

export const DT = 0.05;
export const STEP = B.march.speed * 2 * B.march.maxSpeedBonus * DT;   // generous bound on one tick of marching
export const PTS = [[0, 0], [200, 0], [400, 0], [600, 0], [800, 0], [250, 180], [400, 180], [550, 180], [1000, 180], [1000, 0]];
export const ROADS = [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [7, 3], [2, 6], [4, 9], [9, 8]];
export const ME = 0, FOE = 1;

/** A match on a hand-made map. Every city starts neutral; production is off unless asked for, so soldiers can be counted exactly. */
export function scene(pts = PTS, roads = ROADS, o = {}) {
  const g = new Game([{ ai: null, faction: 'iron', sub: 'bastion' }, { ai: null, faction: 'veil', sub: 'forge' }], 5, { crates: false });
  assert(g.nodes.length >= pts.length, 'scene too large for a two-player map');
  g.nodes.length = pts.length;
  pts.forEach(([x, y], i) => {
    const n = g.nodes[i];
    n.x = x; n.y = y; n.owner = -1; n.level = 1; n.groups = [makeGroup('neutral', '', 1, 5)];
    n.acc = 0; n.cd = 0; n.shield = null; n.siege = []; n.guards = [];
  });
  g.edges = roads.map(r => r.slice());
  g.adj = pts.map(() => new Set());
  for (const [a, b] of roads) { g.adj[a].add(b); g.adj[b].add(a); }
  if (!o.produce) g.produce = () => {};
  // Routing and dispatch tests move far more soldiers than a small city may hold. Unless a
  // test asks for the real capacity rules (`capacity: true`), cities here take everyone.
  if (!o.capacity) g.capOf = () => 1e9;
  g.log = [];                                    // every event the match emitted
  const drain = g.drain.bind(g);
  g.drain = () => { const out = drain(); g.log.push(...out.events); return out; };
  return g;
}

export function own(g, id, pi, n = 20, tier = 1, level = 1) {
  const c = g.nodes[id], p = g.players[pi];
  if (c.owner !== pi) g.ownerRev++;                 // what a capture does: routes may need planning again
  c.owner = pi; c.level = level;
  c.groups = n > 0 ? [makeGroup(p.faction, p.sub, tier, n)] : [];
  return c;
}

/** The standard board: I hold the cities listed, the enemy sits out of the way on 8 and 9. */
export function board(mine, o) {
  const g = scene(PTS, ROADS, o);
  for (const id of mine) own(g, id, ME);
  own(g, 8, FOE, 10);
  own(g, 9, FOE, 10);
  return g;
}

export const soldiers = g => g.nodes.reduce((s, c) => s + c.units, 0) + g.armies.reduce((s, a) => s + a.n, 0);
export const mineOnly = g => g.nodes.filter(c => c.owner === ME).reduce((s, c) => s + c.units, 0) + g.armies.filter(a => a.owner === ME).reduce((s, a) => s + a.n, 0);

/**
 * Run the match, checking every tick that no army jumps. Each army's walk
 * (the cities it actually headed for, in order) is recorded in `g.walk`.
 */
export function run(g, seconds, until) {
  g.walk = g.walk || new Map();
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const before = new Map(g.armies.map(a => [a.id, { ...g.pos(a), w: a.warped }]));
    g.tick(DT);
    g.drain();
    for (const a of g.armies) {
      const w = g.walk.get(a.id) || g.walk.set(a.id, []).get(a.id);
      if (w[w.length - 1] !== a.to) w.push(a.to);
      const p0 = before.get(a.id);
      if (!p0 || p0.w !== a.warped) continue;       // new this tick, or it has just gone through a wormhole
      const p1 = g.pos(a);
      const jump = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      assert(jump <= STEP + 1e-6, `army ${a.id} jumped ${jump.toFixed(1)} in one tick`);
    }
    if (until && until(g)) return true;
  }
  return !until;
}

export const events = (g, k, why) => g.log.filter(e => e.k === k && (why === undefined || e.why === why));
export const result = (made, city) => made.results.find(r => r[0] === city);
