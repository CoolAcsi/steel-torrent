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
import { figuresFor, FIGURES, TIER_SCALE } from '../public/js/art.js';

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

// ---- representative figures: one per batch of a kind, bounded, and a pure function of the counts
{
  let cases = 0;
  for (const n of [1, 2, 5, 10, 11, 40, 99, 250, 1000, 5000]) {
    for (const mix of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0.7, 0.2, 0.1], [0.98, 0.01, 0.01]]) {
      const t1 = Math.round(n * mix[0]), t2 = Math.round(n * mix[1]), t3 = Math.max(0, n - t1 - t2);
      const tiers = [t1, t2, t3], total = t1 + t2 + t3, before = JSON.stringify(tiers);
      const f = figuresFor(total, tiers);
      assert(f.total <= FIGURES.cap, `${total} soldiers drawn as ${f.total} figures`);
      assert.strictEqual(f.total, f.each[0] + f.each[1] + f.each[2]);
      assert(f.batch >= FIGURES.batch && Number.isInteger(Math.log2(f.batch / FIGURES.batch)), `batch of ${f.batch}`);
      [t1, t2, t3].forEach((k, i) => {
        assert.strictEqual(f.each[i], Math.ceil(k / f.batch), 'one figure per started batch of each kind');
        if (k > 0) assert(f.each[i] >= 1, 'a troop type present in the army is not shown');
      });
      if (total <= FIGURES.batch && total === Math.max(t1, t2, t3)) assert.strictEqual(f.total, 1, 'a single small batch is one figure');
      assert.strictEqual(JSON.stringify(tiers), before, 'the counts were modified');
      assert.deepStrictEqual(figuresFor(total, tiers), f, 'not deterministic');
      cases++;
    }
  }
  assert.deepStrictEqual(figuresFor(46, [34, 12, 0]).each, [4, 2, 0]);
  assert.strictEqual(figuresFor(46, [34, 12, 0]).batch, 10);
  assert.deepStrictEqual(figuresFor(0, [0, 0, 0]).each, [0, 0, 0]);
  // Different batches and caps change only the drawing.
  const few = figuresFor(600, [400, 150, 50], { batch: 20, cap: 6 }), many = figuresFor(600, [400, 150, 50], { batch: 5, cap: 200 });
  assert(few.total < many.total && few.total <= 6 && many.total === 120);
  assert(TIER_SCALE[1] < TIER_SCALE[2] && TIER_SCALE[2] < TIER_SCALE[3], 'heavier tiers are drawn larger');
  console.log(`representative figures ok (${cases} armies; one figure per ${FIGURES.batch}, at most ${FIGURES.cap} each)`);
}

// ---- city scenery: a mix of plots, the same for the same seed, never over a base or a road
{
  const { planScenery } = await import('../public/js/scenery.js');
  const { PROP_KINDS, propModel } = await import('../public/js/props.js');
  const nodes = [[170, 150], [450, 150], [730, 150], [960, 360], [450, 540], [170, 430], [740, 540]].map(([x, y]) => ({ x, y }));
  const roads = [[0, 1], [1, 2], [2, 3], [1, 4], [0, 5], [5, 4], [4, 6], [6, 3]], R = 22;
  const plan = seed => planScenery({ nodes, roads, R, x0: -200, y0: -150, x1: 1300, y1: 800, seed, skyline: true });
  const a = plan(4242), strip = p => JSON.stringify(p, (k, v) => (typeof v === 'function' ? undefined : v));
  assert.strictEqual(strip(plan(4242)), strip(a), 'the same seed planned a different city');
  assert.notStrictEqual(strip(plan(7)), strip(a), 'every seed plans the same city');
  const towers = a.towers.filter(t => !t.prop).length, kinds = new Set(a.props.map(p => p.kind));
  assert(a.props.length >= 20 && kinds.size >= 7, `only ${a.props.length} plots of ${kinds.size} kinds besides towers`);
  assert(towers >= 8 && towers < a.towers.length * 0.6, `${towers} towers of ${a.towers.length} plots`);
  assert(new Set(a.props.map(p => p.key)).size <= 32, 'too many different models to instance');
  for (const p of a.props) {
    assert(PROP_KINDS[p.kind] && typeof p.build === 'function' && p.scale > 0 && Number.isFinite(p.x + p.y + p.yaw));
    // The plot's footprint (a square turned 45 degrees: a diamond on screen) holds no base and no road.
    for (const n of nodes) assert(Math.abs(n.x - p.x) / p.r + Math.abs(n.y - p.y) / (p.r * 0.55) > 1, `${p.kind} stands on a base`);
    for (const [i, j] of roads) for (let s = 0; s <= 20; s++) {
      const x = nodes[i].x + (nodes[j].x - nodes[i].x) * s / 20, y = nodes[i].y + (nodes[j].y - nodes[i].y) * s / 20;
      assert(Math.abs(x - p.x) / p.r + Math.abs(y - p.y) / (p.r * 0.55) > 1, `${p.kind} stands on a road`);
    }
  }
  let faces = 0, most = 0;
  for (const kind of Object.keys(PROP_KINDS)) for (let v = 0; v < PROP_KINDS[kind].variants; v++) {
    const m = propModel(kind, v);
    let n = 0, top = 0, out = 0;
    for (const s of m.solids) for (const f of s.faces) { n++; for (const q of f.p) { top = Math.max(top, q[2]); out = Math.max(out, Math.abs(q[0]), Math.abs(q[1])); } }
    assert(n > 10 && n <= 400, `${kind} ${v} has ${n} faces`);
    assert(out <= PROP_KINDS[kind].a / 2 + 0.01, `${kind} ${v} reaches ${out} from the middle of a plot ${PROP_KINDS[kind].a} wide`);
    assert(top <= (PROP_KINDS[kind].hv ? PROP_KINDS[kind].hv[v] : PROP_KINDS[kind].h) + 0.01, `${kind} ${v} is ${top} tall, taller than the plan allows for`);
    assert.strictEqual(propModel(kind, v), m, 'a plot model is built once');
    faces += n; most = Math.max(most, n);
  }
  console.log(`city scenery ok (${a.props.length} plots of ${kinds.size} kinds and ${towers} towers; ${Object.keys(PROP_KINDS).length} kinds, ${faces} faces in all, ${most} at most)`);
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
  assert.strictEqual(play({ batch: 50, cap: 3 }), base, 'a coarse drawing ratio changed the match');
  assert.strictEqual(play({ batch: 1, cap: 200 }), base, 'a fine drawing ratio changed the match');
  // Health is tracked per troop type, never as one pool for the army: wounding one type leaves the others whole.
  const groups = [makeGroup('iron', 'bastion', 1, 30), makeGroup('iron', 'bastion', 3, 10)];
  const full3 = groups[1].hp;
  groups[0].hp -= 500;
  assert.strictEqual(groups[1].hp, full3);
  console.log('combat is independent of rendering ok');
}
console.log('client tests passed');
