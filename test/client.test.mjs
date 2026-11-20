// Things the browser does on its own that must agree with, or stay out of, the simulation:
// the route preview (same answer as the server, with wormholes and obstacles in play) and
// the representative figures a large army is drawn with (a drawing choice, nothing more).
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ME, FOE, PTS, ROADS, scene, own, board } from './scene.mjs';
import { planRoute } from '../public/js/route.js';
import { figuresFor, FIGURES } from '../public/js/art.js';

const require = createRequire(import.meta.url);
const { BALANCE: B } = require('../game/config');
const { Game, makeGroup } = require('../game/sim');
const here = path.dirname(fileURLToPath(import.meta.url));

/** The client's route for player `pi`, planned only from what the server tells clients: owners and the feature list. */
function preview(g, pi, from, to, n = 0) {
  const feat = g.features();
  const obst = feat.filter(f => f.k === 'block' || f.k === 'mire'), worms = feat.filter(f => f.k === 'worm' && f.p === pi && f.left >= Math.max(1, n));
  const pen = (u, v) => obst.filter(o => o.p !== pi && o.a === Math.min(u, v) && o.b === Math.max(u, v)).reduce((s, o) => s + o.cost, 0);
  return planRoute(g.nodes.length, u => [...g.adj[u]], (u, v) => Math.hypot(g.nodes[u].x - g.nodes[v].x, g.nodes[u].y - g.nodes[v].y) + pen(u, v),
    u => g.nodes[u].owner === pi, from, to, worms.length ? u => worms.filter(w => w.a === u || w.b === u).map(w => [w.a === u ? w.b : w.a, w.cost]) : null);
}

// ---- route preview = server route, with a wormhole and both kinds of obstacle on the map
{
  const g = board([]);
  Object.assign(g.players[ME], { faction: 'meridian', sub: 'shade' });
  Object.assign(g.players[FOE], { faction: 'veil', sub: 'forge' });
  for (const id of [0, 1, 2, 3, 4]) own(g, id, ME, 20, 1, 3);
  for (const id of [5, 6, 7]) own(g, id, FOE, 20);
  g.players[ME].charge = g.players[ME].need;
  g.players[FOE].cd = [0, 0];
  assert(g.skill(ME, 2, { node: 0, to: 4 }).ok, 'wormhole');
  assert(g.skill(FOE, 1, { a: 6, b: 2, f: 0.5 }).ok, 'disruption barrier on a road into my base');
  Object.assign(g.players[FOE], { faction: 'iron', sub: 'bastion' });
  g.obst[0].owner = FOE;
  g.players[FOE].cd = [0, 0];
  g.obst.push({ ...g.obst[0], id: 999, kind: 'block', lo: 1, hi: 5, def: g.skillDef(g.players[FOE], 1), hp: 100, max: 100 });
  g.topoRev++;
  let pairs = 0, warped = 0, differ = 0;
  for (const pi of [ME, FOE]) for (const n of [0, 5, B.skills.meridian[2].capacity + 1]) {
    for (let a = 0; a < g.nodes.length; a++) for (let b = 0; b < g.nodes.length; b++) {
      if (a === b || g.nodes[a].owner !== pi) continue;
      const s = g.route(pi, a, b, n), c = preview(g, pi, a, b, n);
      assert.deepStrictEqual(c && c.path, s && s.path, `player ${pi}, ${a} -> ${b} with ${n} soldiers`);
      if (s) { assert(Math.abs(s.cost - c.cost) < 1e-6); pairs++; if (s.path.some((u, i) => i && !g.adj[s.path[i - 1]].has(u))) warped++; }
    }
  }
  // The obstacles and the wormhole really change routes here, so the agreement above means something.
  const plain = board([]);
  for (const id of [0, 1, 2, 3, 4]) own(plain, id, ME, 20, 1, 3);
  for (const id of [5, 6, 7]) own(plain, id, FOE, 20);
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) { const x = a !== b && g.route(ME, a, b), y = a !== b && plain.route(ME, a, b); if (x && y && String(x.path) !== String(y.path)) differ++; }
  assert(pairs > 60 && warped > 5 && differ > 3, `too little covered: ${pairs} routes, ${warped} through the wormhole, ${differ} changed`);
  console.log(`route preview ok (${pairs} routes agree with the server; ${warped} use the wormhole)`);
}

// ---- representative figures: bounded, faithful to the mix, and a pure function of the counts
{
  let cases = 0;
  for (const n of [1, 2, 5, 12, 13, 40, 99, 250, 1000, 5000]) {
    for (const mix of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0.7, 0.2, 0.1], [0.98, 0.01, 0.01]]) {
      const t1 = Math.round(n * mix[0]), t2 = Math.round(n * mix[1]), t3 = Math.max(0, n - t1 - t2);
      const tiers = [t1, t2, t3], total = t1 + t2 + t3, before = JSON.stringify(tiers);
      const f = figuresFor(total, tiers);
      assert(f.total <= FIGURES.cap, `${total} soldiers drawn as ${f.total} figures`);
      assert.strictEqual(f.total, f.each[0] + f.each[1] + f.each[2]);
      [t1, t2, t3].forEach((k, i) => { assert(f.each[i] <= k, 'more figures than soldiers'); if (k > 0) assert(f.each[i] >= 1, 'a troop type present in the army is not shown'); });
      if (total <= FIGURES.exact) assert.strictEqual(f.total, total, 'a small army is drawn one for one');
      assert.strictEqual(JSON.stringify(tiers), before, 'the counts were modified');
      assert.deepStrictEqual(figuresFor(total, tiers), f, 'not deterministic');
      cases++;
    }
  }
  // Different ratios change only the drawing.
  const few = figuresFor(600, [400, 150, 50], { exact: 4, group: 20, cap: 6 }), many = figuresFor(600, [400, 150, 50], { exact: 30, group: 2, cap: 60 });
  assert(few.total < many.total && few.total <= 6 && many.total <= 60);
  console.log(`representative figures ok (${cases} armies; at most ${FIGURES.cap} figures each)`);
}

// ---- combat does not know how armies are drawn
{
  // The simulation, its messages and its configuration never mention figures or presets...
  const dir = path.join(here, '../game');
  for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    assert(!/public\/|figuresFor|FIGURES|quality|preset|lod\b/i.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `game/${f} refers to rendering`);
  }
  // ...and a match plays out identically whatever the clients would draw meanwhile.
  const play = draw => {
    const g = new Game([{ ai: 'hard', faction: 'iron', sub: 'volt' }, { ai: 'hard', faction: 'veil', sub: 'forge' }, { ai: 'normal', faction: 'meridian', sub: 'aegis' }], 31, { crates: true });
    for (let i = 0; i < 20 * 240 && g.winner === null; i++) {
      g.tick(0.05);
      if (draw) for (const a of g.armies) { const tiers = [0, 0, 0]; for (const x of a.groups) tiers[x.t - 1] += x.n; figuresFor(a.n, tiers, draw); }
    }
    return JSON.stringify({ t: g.t, report: g.report(), nodes: g.nodes.map(c => [c.owner, c.level, c.groups]), armies: g.armies.map(a => [a.owner, a.s, a.groups]) });
  };
  const base = play(null);
  assert.strictEqual(play({ exact: 1, group: 50, cap: 3 }), base, 'a coarse drawing ratio changed the match');
  assert.strictEqual(play({ exact: 40, group: 1, cap: 200 }), base, 'a fine drawing ratio changed the match');
  // Health is tracked per troop type, never as one pool for the army: wounding one type leaves the others whole.
  const groups = [makeGroup('iron', 'bastion', 1, 30), makeGroup('iron', 'bastion', 3, 10)];
  const full3 = groups[1].hp;
  groups[0].hp -= 500;
  assert.strictEqual(groups[1].hp, full3);
  console.log('combat is independent of rendering ok');
}
console.log('client tests passed');
