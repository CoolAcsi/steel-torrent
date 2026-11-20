// Routed dispatch: one order, many source cities, one destination.
//
// Every section builds a small hand-made road map so the expected routes are
// known in advance, issues real orders through Game.send, and then RUNS the
// simulation: nothing here is judged by a planned route alone. An order only
// counts as working when the armies exist, walk every road of their route,
// meet enemies on the way and end up at the destination they were sent to.
//
//         0 ---- 1 ---- 2 ---- 3 ---- 4 ---- 9
//                |      |      |             |
//                5 ---- 6 ---- 7             8
//
// The upper road 1-2-3 is 400 long, the lower road 1-5-6-7-3 about 674.
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { planRoute } from '../public/js/route.js';
import { makeState, applyFull, applyUpdate, hashState } from '../public/js/netstate.js';
import { DT, STEP, ME, FOE, scene, own, board, run, events, soldiers, mineOnly } from './scene.mjs';

const require = createRequire(import.meta.url);
const { BALANCE: B } = require('../game/config');
const { Game, REJECT, makeGroup, countOf } = require('../game/sim');
const { cityRec, armyRec, armySig, hashGame } = require('../game/proto');


const R = B.combat.engageRadius;
const ARRIVE = B.march.arriveAt;
const WAIT = B.route.waitMax;

let sections = 0;
function section(name, fn) {
  fn();
  sections++;
  console.log(`ok  ${name}`);
}

// ------------------------------------------------------------ 1. the bug itself

section('required regression: three cities, only one next to the destination, all three arrive', () => {
  const g = board([0, 1, 2, 3]);
  const before = { 1: g.nodes[1].units, 2: g.nodes[2].units, 3: g.nodes[3].units };
  const made = g.send(ME, [0, 1, 2], 3, 0.5, 1);

  // Army creation: one per source, troops deducted exactly once, everyone bound for city 3.
  assert.strictEqual(made.length, 3, 'every selected city must dispatch, not only the adjacent one');
  assert.deepStrictEqual(made.results, [[0, 10, 3], [1, 10, 2], [2, 10, 1]]);
  assert.deepStrictEqual(made.map(a => [a.src, a.to, a.dest, a.path]), [[0, 1, 3, [2, 3]], [1, 2, 3, [3]], [2, 3, 3, []]]);
  assert.deepStrictEqual([0, 1, 2].map(i => g.nodes[i].units), [10, 10, 10]);
  assert(made.every(a => a.cmd === 1 && a.order === made[0].order), 'one command, one identity');
  const total = soldiers(g);

  // Waypoint traversal: garrisons along the way never change while columns walk through them.
  let absorbed = false;
  const done = run(g, 60, () => {
    if (g.nodes[1].units !== 10 || g.nodes[2].units !== 10) absorbed = true;
    return g.armies.length === 0;
  });
  assert(done, 'armies never arrived');
  assert(!absorbed, 'a waypoint garrison changed: an army was absorbed on the way');

  // Arrival at the ORIGINAL destination, by the planned roads, with every soldier accounted for.
  assert.deepStrictEqual(made.map(a => g.walk.get(a.id)), [[1, 2, 3], [2, 3], [3]]);
  assert.strictEqual(g.nodes[3].units, before[3] + 30);
  assert.strictEqual(soldiers(g), total);
  assert.strictEqual(events(g, 'route').length, 0, 'nothing should have been replanned');
});

section('the same order against a hostile destination: all three columns besiege it and take it', () => {
  const g = board([0, 1, 2]);
  own(g, 3, FOE, 6);
  for (const i of [0, 1, 2]) own(g, i, ME, 40);
  const made = g.send(ME, [0, 1, 2], 3, 1, 1);
  assert.strictEqual(made.length, 3);
  const sieged = new Set();
  const done = run(g, 90, () => {
    for (const a of g.armies) if (a.owner === ME && a.state === 'siege') { assert.strictEqual(a.to, 3, 'besieged the wrong city'); sieged.add(a.id); }
    return g.nodes[3].owner === ME && g.armies.every(a => a.owner !== ME);
  });
  assert(done, 'city 3 was not taken');
  assert(sieged.has(made[2].id), 'the adjacent column never fought at the destination');
  assert(g.nodes[1].units === 0 && g.nodes[2].units === 0, 'waypoints must not gain troops');
  assert.strictEqual(events(g, 'cap').filter(e => e.node === 3 && e.by === ME).length, 1);
});

// ------------------------------------------------------------ 2. acceptance cases

section('several adjacent sources dispatch to one destination', () => {
  const g = board([1, 2, 3, 6]);
  const made = g.send(ME, [1, 3, 6], 2, 0.5, 1);
  assert.deepStrictEqual(made.map(a => [a.src, a.to, a.dest, a.path.length]), [[1, 2, 2, 0], [3, 2, 2, 0], [6, 2, 2, 0]]);
  assert(run(g, 30, () => g.armies.length === 0));
  assert.strictEqual(g.nodes[2].units, 20 + 30);
});

section('several non-adjacent sources march through multiple waypoints', () => {
  const g = board([0, 1, 2, 3, 4, 5]);
  const made = g.send(ME, [0, 5], 4, 0.5, 1);
  assert.deepStrictEqual(made.map(a => [a.src, ...[a.to, ...a.path]]), [[0, 1, 2, 3, 4], [5, 1, 2, 3, 4]]);
  assert(run(g, 90, () => g.armies.length === 0));
  assert.deepStrictEqual(made.map(a => g.walk.get(a.id)), [[1, 2, 3, 4], [1, 2, 3, 4]]);
  assert.strictEqual(g.nodes[4].units, 20 + 20);
  assert.deepStrictEqual([1, 2, 3].map(i => g.nodes[i].units), [20, 20, 20]);
});

section('a mixed selection: reachable sources march, unreachable ones are named and keep their troops', () => {
  const g = board([0, 1, 4]);                      // 4 is cut off from 2 by the neutral city 3
  own(g, 7, ME, 0);                                // mine, but empty
  const made = g.send(ME, [0, 4, 7, 9, 2, 1, 1], 2, 0.5, 1);
  assert.deepStrictEqual(made.results, [
    [0, 10, 2],
    [4, -REJECT.noRoute],
    [7, -REJECT.noRoute],                          // its only ways to 2 lead through neutral 6 or 3
    [9, -REJECT.notYours],
    [2, -REJECT.isTarget],
    [1, 10, 1],                                    // listed twice, sent once
  ]);
  assert.deepStrictEqual(made.map(a => a.src), [0, 1]);
  assert.strictEqual(g.nodes[4].units, 20, 'an excluded city must keep every soldier');
  assert(made.every(a => a.dest === 2), 'the destination is never replaced');

  own(g, 6, ME, 0);
  own(g, 5, ME, 0);
  const again = g.send(ME, [5, 6], 2, 0.5, 2);     // routes exist now, but nobody to send
  assert.deepStrictEqual(again.results, [[5, -REJECT.noTroops], [6, -REJECT.noTroops]]);
  assert.strictEqual(again.length, 0);
});

section('no selected source can reach the destination: rejected whole, nothing spent, no other target chosen', () => {
  const g = board([0, 1]);
  const total = soldiers(g);
  const made = g.send(ME, [0, 1], 4, 1, 1);        // 4 lies beyond the neutral cities 2 and 3
  assert.strictEqual(made.length, 0);
  assert.deepStrictEqual(made.results, [[0, -REJECT.noRoute], [1, -REJECT.noRoute]]);
  assert.strictEqual(g.armies.length, 0);
  assert.strictEqual(soldiers(g), total);
  assert.deepStrictEqual([0, 1].map(i => g.nodes[i].units), [20, 20]);
});

section('a route never passes through a neutral or hostile city, however short the cut', () => {
  const g = board([0, 1, 5, 6, 7]);
  own(g, 2, FOE, 10);                              // the direct road to 3 is blocked by an enemy city
  assert.deepStrictEqual(g.route(ME, 1, 3).path, [1, 5, 6, 7, 3]);
  assert.deepStrictEqual(g.route(ME, 1, 2).path, [1, 2], 'a hostile city may be the destination');
  g.nodes[6].owner = -1;                           // and now the detour is neutral too
  assert.strictEqual(g.route(ME, 1, 3), null);
  assert.strictEqual(g.route(ME, 1, 1), null);
});

section('different sources take different routes to the same destination', () => {
  const g = board([0, 1, 2, 3, 5, 6, 7]);
  const made = g.send(ME, [0, 5], 3, 0.5, 1);
  assert.deepStrictEqual([made[0].to, ...made[0].path], [1, 2, 3], 'city 0 goes by the upper road');
  assert.deepStrictEqual([made[1].to, ...made[1].path], [6, 7, 3], 'city 5 goes by the lower road');
  assert(run(g, 60, () => g.armies.length === 0));
  assert.deepStrictEqual(made.map(a => g.walk.get(a.id)), [[1, 2, 3], [6, 7, 3]]);
  assert.strictEqual(g.nodes[3].units, 20 + 20);
});

section('several routes share one friendly waypoint and none of them is absorbed there', () => {
  const g = board([0, 1, 2, 5]);
  const made = g.send(ME, [0, 5], 2, 0.5, 1);
  assert.deepStrictEqual(made.map(a => [a.to, ...a.path]), [[1, 2], [1, 2]]);
  let changed = false;
  assert(run(g, 40, () => { if (g.nodes[1].units !== 20) changed = true; return g.armies.length === 0; }));
  assert(!changed, 'the shared waypoint took in troops');
  assert.strictEqual(g.nodes[2].units, 20 + 20);
});

section('an army keeps its identity, composition and health through a waypoint', () => {
  const g = board([0, 1, 2]);
  g.nodes[0].groups = [makeGroup('iron', 'bastion', 2, 8), makeGroup('iron', 'bastion', 3, 4)];
  g.nodes[0].groups[0].hp -= 55;                   // a wounded tank
  const [a] = g.send(ME, [0], 2, 1, 1);
  const sent = JSON.stringify(a.groups);
  const id = a.id;
  let passed = false;
  run(g, 40, () => {
    const live = g.armies.find(x => x.id === id);
    if (live && live.from === 1) { passed = true; assert.strictEqual(JSON.stringify(live.groups), sent, 'troops changed at the waypoint'); }
    return g.armies.length === 0;
  });
  assert(passed, 'the army never left the waypoint as itself');
  assert.strictEqual(g.nodes[1].units, 20);
  const at2 = g.nodes[2].groups;
  assert.strictEqual(at2.filter(x => x.t === 2).reduce((s, x) => s + x.n, 0), 8);
  assert.strictEqual(at2.filter(x => x.t === 3).reduce((s, x) => s + x.n, 0), 4);
});

section('enemy armies intercept on an intermediate road; survivors march on to the destination', () => {
  // 0 -- 1 ---------------- 2 -- 3 -- 4      a long middle road, so the columns meet on it
  const g = scene([[0, 0], [100, 0], [700, 0], [800, 0], [1000, 0]], [[0, 1], [1, 2], [2, 3], [3, 4]]);
  for (const i of [1, 2, 3]) own(g, i, ME);
  own(g, 0, ME, 60);
  own(g, 4, FOE, 10);
  const p = g.players[FOE];
  const foe = g.newArmy(FOE, 2, 1, [makeGroup(p.faction, p.sub, 1, 30)], 100);   // already on the second road of the route
  const [a] = g.send(ME, [0], 3, 1, 1);
  let met = false, side = 0;
  const done = run(g, 120, () => {
    const mine = g.armies.find(x => x.id === a.id), them = g.armies.find(x => x.id === foe.id);
    if (mine && them && mine.from + mine.to === 3 && Math.min(mine.from, mine.to) === 1) {      // both on road 1-2
      const gap = g.roadX(them) - g.roadX(mine);
      if (!side) side = Math.sign(gap);
      assert.strictEqual(Math.sign(gap), side, 'the armies passed through each other');
      assert(Math.abs(gap) >= R - 1e-6, `closer than contact range: ${gap}`);
      if (mine.state === 'engaged') { met = true; assert.strictEqual(mine.dest, 3); assert.deepStrictEqual(mine.path, [3]); }
    }
    return g.armies.length === 0;
  });
  assert(done && met, 'the armies never fought on the road');
  assert.strictEqual(events(g, 'clash').length, 1, 'one encounter, one fight');
  assert.deepStrictEqual(g.walk.get(a.id), [1, 2, 3]);
  const lost = 60 - (g.nodes[3].units - 20);
  assert(lost > 0 && lost < 60, `expected casualties and survivors, lost ${lost}`);
  assert.strictEqual(g.nodes[1].units + g.nodes[2].units, 40, 'survivors must not settle on the way');
  assert.strictEqual(g.stats[ME].encWon, 1);
});

section('friendly columns on the same road never block or fight each other', () => {
  const g = board([0, 1, 2, 3]);
  g.send(ME, [0, 1], 3, 0.5, 1);
  g.send(ME, [3], 0, 0.5, 2);                      // the other way down the same roads
  const total = soldiers(g);
  assert(run(g, 60, () => g.armies.length === 0));
  assert.strictEqual(events(g, 'clash').length, 0);
  assert.strictEqual(soldiers(g), total);
});

section('route eligibility changes on the march: replanned from where the army stands, same destination', () => {
  const g = board([0, 1, 2, 3, 5, 6, 7]);
  const [a] = g.send(ME, [0], 3, 0.5, 1);
  run(g, 1.5);                                     // on the first road
  own(g, 2, FOE, 10);                              // the upper road is lost
  run(g, 0.1);
  assert.deepStrictEqual([a.to, ...a.path], [1, 5, 6, 7, 3]);
  assert.strictEqual(a.dest, 3);
  assert(run(g, 60, () => g.armies.length === 0));
  assert.deepStrictEqual(g.walk.get(a.id), [1, 5, 6, 7, 3]);
  assert.strictEqual(g.nodes[3].units, 30);
  assert.deepStrictEqual(events(g, 'route').map(e => e.why), ['re']);
});

section('the city ahead falls: the army turns round on its road and takes the other way', () => {
  const g = board([0, 1, 2, 3, 5, 6, 7]);
  const [a] = g.send(ME, [1], 3, 0.5, 1);
  run(g, 1.5);
  const here = g.pos(a);
  own(g, 2, FOE, 10);
  run(g, DT);
  assert.deepStrictEqual([a.from, a.to, ...a.path], [2, 1, 5, 6, 7, 3], 'should be walking back to city 1');
  assert(Math.hypot(g.pos(a).x - here.x, g.pos(a).y - here.y) <= STEP, 'turning round must not move the army');
  assert(run(g, 60, () => g.armies.length === 0));
  assert.strictEqual(g.nodes[3].units, 30);
  assert.strictEqual(g.nodes[1].units, 10, 'passing back through its own source must not absorb it either');
});

section('a blocked army waits where it stands, and marches on to the same destination when the route returns', () => {
  const g = board([0, 1, 2, 3]);
  const [a] = g.send(ME, [0], 3, 0.5, 1);
  run(g, 1);
  own(g, 2, FOE, 10);                              // the only way to city 3 is gone
  run(g, 0.2);
  assert(a.waiting, 'the army should be waiting');
  assert.deepStrictEqual([a.dest, a.path], [3, []], 'the destination is kept while it waits');
  const here = g.pos(a), n = a.n;
  run(g, WAIT * 0.6);
  assert(Math.hypot(g.pos(a).x - here.x, g.pos(a).y - here.y) < 1e-9 && a.n === n, 'a waiting army neither moves nor loses anyone');
  own(g, 2, ME, 10);                               // retaken
  run(g, 0.1);
  assert(!a.waiting && a.dest === 3);
  assert.deepStrictEqual([a.to, ...a.path], [1, 2, 3]);
  assert(run(g, 60, () => g.armies.length === 0));
  assert.strictEqual(g.nodes[3].units, 30);
  assert.deepStrictEqual(events(g, 'route').map(e => e.why), ['wait', 'go']);
});

section('a waiting army can still be attacked, and is not replanned unless a city changes hands', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 80);
  const [a] = g.send(ME, [0], 3, 0.5, 1);
  run(g, 1);
  own(g, 2, FOE, 10);
  run(g, 0.2);
  let plans = 0;
  const route = g.route.bind(g);
  g.route = (...args) => { plans++; return route(...args); };
  run(g, 5);
  assert.strictEqual(plans, 0, 'nothing changed hands, so there was nothing to plan');
  const p = g.players[FOE];
  g.newArmy(FOE, 1, 0, [makeGroup(p.faction, p.sub, 1, 6)], 0);     // comes down the same road
  assert(run(g, 30, () => events(g, 'clash').length > 0), 'the waiting army was never engaged');
  assert(a.state === 'engaged' || a.groups.length === 0 || events(g, 'clash').length === 1);
});

section('no route within the waiting time: hold the city ahead, turn back, or attack, and the owner is told', () => {
  // hold: the city ahead is still mine
  let g = board([0, 1, 2, 3]);
  let [a] = g.send(ME, [0], 3, 0.5, 1);
  run(g, 1);
  own(g, 2, FOE, 10);
  let total = mineOnly(g);
  run(g, WAIT - 1);
  assert(a.waiting && g.armies.length === 1, 'it should wait the whole time before giving up');
  assert(run(g, 30, () => g.armies.length === 0));
  assert.strictEqual(g.nodes[1].units, 30);
  assert.strictEqual(mineOnly(g), total, 'troops were lost when the route was cut');
  assert.deepStrictEqual(events(g, 'route').map(e => [e.why, e.node]), [['wait', 1], ['hold', 1]]);

  // back: only the city behind is mine
  g = board([0, 1, 2, 3]);
  [a] = g.send(ME, [1], 3, 0.5, 1);
  run(g, 1);
  own(g, 2, FOE, 10);
  assert(run(g, WAIT + 30, () => g.armies.length === 0));
  assert.strictEqual(g.nodes[1].units, 20, 'the army should be back where it started, complete');
  assert.deepStrictEqual(events(g, 'route').map(e => [e.why, e.node]), [['wait', 2], ['back', 1]]);

  // cut: neither is mine any more, so in the end it attacks what is in front of it, exactly as any army reaching a hostile city
  g = board([0, 1, 2, 3]);
  [a] = g.send(ME, [1], 3, 0.5, 1);
  run(g, 1);
  own(g, 1, FOE, 10);
  own(g, 2, FOE, 3);
  run(g, 0.1);
  assert(a.waiting && a.dest === 3);
  assert(run(g, WAIT + 30, () => a.state === 'siege' || a.groups.length === 0));
  assert.deepStrictEqual([a.to, a.dest], [2, 2]);
  assert.deepStrictEqual(events(g, 'route').map(e => [e.why, e.node]), [['wait', 2], ['cut', 2]]);
});

section('a city flipping back and forth cannot make an army oscillate or replan in a loop', () => {
  const g = board([0, 1, 2, 3, 5, 6, 7]);
  const [a] = g.send(ME, [0], 3, 0.5, 1);
  let flips = 0;
  for (let i = 0; i < 80 && g.armies.length; i++) {       // city 2 changes hands four times a second
    own(g, 2, i % 2 ? ME : FOE, 10);
    flips++;
    run(g, 0.25);
  }
  own(g, 2, ME, 10);
  assert(run(g, 60, () => g.armies.length === 0), 'the army never settled');
  const re = events(g, 'route').length;
  assert(re <= 1, `replanned ${re} times; a valid route must never be second-guessed`);
  assert.strictEqual(g.nodes[3].units, 30);
  assert.strictEqual(a.dest, 3);
});

section('a waypoint under attack: the column stands with the garrison, then marches on with its orders', () => {
  const g = board([0, 1, 2]);
  own(g, 0, ME, 60);
  own(g, 1, ME, 25);
  const p = g.players[FOE];
  const siege = g.newArmy(FOE, 5, 1, [makeGroup(p.faction, p.sub, 1, 30)], g.dist(5, 1) - ARRIVE - 1);
  const [a] = g.send(ME, [0], 2, 1, 1);
  let stood = false;
  const done = run(g, 120, () => {
    if (a.state === 'guard') {
      stood = true;
      assert.strictEqual(g.nodes[1].owner, ME, 'a city cannot fall while a column stands in it');
      assert.strictEqual(a.dest, 2);
    }
    return g.armies.length === 0;
  });
  assert(done && stood, 'the column never stood at the besieged waypoint');
  assert.strictEqual(siege.groups.length, 0, 'the besiegers should have been beaten');
  assert.deepStrictEqual(events(g, 'route').map(e => e.why), ['join', 'resume']);
  assert.deepStrictEqual(g.walk.get(a.id), [1, 2]);
  assert(g.nodes[1].units <= 25, 'the waypoint garrison must not have absorbed the column');
  assert(g.nodes[2].units > 20, 'survivors should have reached the destination');
});

section('repeated input and network retries never duplicate troops', () => {
  const g = board([0, 1, 2, 3]);
  const total = soldiers(g);
  const first = g.send(ME, [0, 1, 2], 3, 0.5, 42);
  for (let i = 0; i < 5; i++) {                           // the same message delivered again and again
    const again = g.send(ME, [0, 1, 2], 3, 0.5, 42);
    assert.strictEqual(again.length, 0);
    assert(again.dup, 'a retry must be recognised');
    assert.deepStrictEqual(again.results, first.results, 'a retry gets the original answer');
  }
  assert.strictEqual(g.armies.length, 3);
  assert.deepStrictEqual([0, 1, 2].map(i => g.nodes[i].units), [10, 10, 10]);

  // Rapid repeated drags are separate orders: each takes its own share, and no soldier is created or lost.
  for (let id = 100; id < 110; id++) g.send(ME, [0, 1, 2], 3, 0.5, id);
  assert.strictEqual(soldiers(g), total);
  assert(g.armies.every(x => x.dest === 3));
  assert(run(g, 90, () => g.armies.length === 0));
  assert.strictEqual(soldiers(g), total);
  assert.strictEqual(g.nodes[3].units, 80 - [0, 1, 2].reduce((s, i) => s + g.nodes[i].units, 0), 'every soldier sent must be at the destination');
});

section('clients stay in step with routes, and a reconnecting client recovers them', () => {
  const g = board([0, 1, 2, 3, 5, 6, 7]);
  g.send(ME, [0, 5], 3, 0.5, 1);
  const wire = x => JSON.parse(JSON.stringify(x));
  const key = () => wire({ t: 'k', q: 0, time: g.t, c: g.nodes.flatMap(c => cityRec(g, c)), a: g.armies.map(a => armyRec(g, a)), h: hashGame(g) });

  const st = makeState(g.nodes.length);
  assert.strictEqual(applyUpdate(st, key()), 'ok');
  const sent = new Map(g.armies.map(a => [a.id, armySig(armyRec(g, a))]));
  const cities = () => JSON.stringify(g.nodes.map(c => cityRec(g, c)));
  let q = 0, last = cities(), hops = 0;

  for (let i = 0; i < 400 && g.armies.length; i++) {
    g.tick(DT); g.drain();
    if (i === 20) own(g, 2, FOE, 10);                     // force a replan mid-march
    // The server's delta: only armies whose record changed in something other than distance walked.
    const a = [], r = [];
    for (const army of g.armies) {
      const rec = armyRec(g, army), sig = armySig(rec);
      if (sent.get(army.id) !== sig) { a.push(rec); sent.set(army.id, sig); if (rec[2] !== 0 && rec[2] !== 5) hops++; }
    }
    for (const id of [...sent.keys()]) if (!g.armies.some(x => x.id === id)) { r.push(id); sent.delete(id); }
    const now = cities();
    const c = now === last ? [] : g.nodes.flatMap((n, j) => [j, ...cityRec(g, n)]);
    last = now;
    assert.strictEqual(applyUpdate(st, wire({ t: 'd', q: ++q, time: g.t, c, a, r, h: hashGame(g) })), 'ok', `update ${q} did not apply cleanly`);
    for (const army of g.armies) {
      const seen = st.armies.get(army.id);
      assert.deepStrictEqual([seen.from, seen.to, seen.dest, seen.path], [army.from, army.to, army.dest, army.path], 'the client lost track of a route');
    }

    if (i === 60) {                                       // a client joining or reconnecting right now
      const fresh = makeState(g.nodes.length);
      assert.strictEqual(applyUpdate(fresh, key()), 'ok');
      assert.strictEqual(hashState(fresh), hashState(st));
      assert(g.armies.length > 0 && g.armies.some(x => x.path.length > 0), 'expected routed armies in flight');
      for (const army of g.armies) {
        const seen = fresh.armies.get(army.id);
        assert.deepStrictEqual([seen.from, seen.to, seen.dest, seen.path], [army.from, army.to, army.dest, army.path], 'a reconnecting client got the wrong route');
      }
    }
  }
  assert(hops >= 3, 'waypoint changes should have been sent');
  assert.strictEqual(g.armies.length, 0);
  assert.strictEqual(st.armies.size, 0);
  assert.strictEqual(g.nodes[3].units, 20 + 20);
});

section('the preview plans exactly the route the server plans', () => {
  let pairs = 0, routed = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const np = 2 + (seed % 4) * 2;
    const g = new Game(Array.from({ length: np }, () => ({ ai: null, faction: 'meridian', sub: 'shade' })), seed, {});
    let x = seed * 7919;
    for (const c of g.nodes) { x = (x * 1103515245 + 12345) >>> 0; c.owner = x % 5 < 3 ? 0 : x % 5 === 3 ? 1 : -1; }
    const adj = g.nodes.map(() => []);
    for (const [a, b] of [...g.edges].reverse()) { adj[a].unshift(b); adj[b].push(a); }      // a different listing order on purpose
    for (let a = 0; a < g.nodes.length; a++) {
      for (let b = 0; b < g.nodes.length; b++) {
        if (g.nodes[a].owner !== 0) continue;
        const server = g.route(0, a, b);
        const client = planRoute(g.nodes.length, u => adj[u], (u, v) => g.dist(u, v), u => g.nodes[u].owner === 0, a, b);
        assert.deepStrictEqual(client && client.path, server && server.path, `seed ${seed}: ${a} -> ${b}`);
        pairs++;
        if (server && server.path.length > 2) routed++;
      }
    }
  }
  assert(routed > 500, 'too few multi-road routes compared');
  console.log(`    ${pairs} city pairs compared, ${routed} of them more than one road long`);
});

section('large selections stay responsive and every column arrives', () => {
  const g = new Game(Array.from({ length: 8 }, () => ({ ai: null, faction: 'iron', sub: 'volt' })), 9, { crates: false });
  g.produce = () => {};
  for (const c of g.nodes) { c.owner = ME; c.level = 1; c.groups = [makeGroup('iron', 'volt', 1, 20)]; c.siege = []; }
  for (let pi = 2; pi < 8; pi++) g.alive[pi] = false;
  g.nodes[0].owner = FOE;                                  // one opponent left, so the match is still running
  const dest = g.nodes.length - 1;
  const all = g.nodes.map(c => c.id);
  const total = soldiers(g);
  const reachable = all.filter(i => i !== 0 && i !== dest && g.route(ME, i, dest)).length;
  assert(reachable >= 40, `only ${reachable} cities can reach the destination`);

  const t0 = process.hrtime.bigint();
  const made = g.send(ME, all, dest, 0.5, 1);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(made.length, reachable, 'every city with a route must dispatch');
  assert(made.some(a => a.path.length >= 3), 'expected some long routes on a 45-city map');
  assert(ms < 50, `one order from ${made.length} cities took ${ms.toFixed(1)} ms`);

  const t1 = process.hrtime.bigint();
  let ticks = 0;
  g.walk = new Map();
  while (g.armies.length && ticks < 20 * 240) { g.tick(DT); g.drain(); ticks++; }
  const perTick = Number(process.hrtime.bigint() - t1) / 1e6 / ticks;
  assert.strictEqual(g.armies.length, 0, 'some columns never arrived');
  assert.strictEqual(g.nodes[dest].units, 20 + 10 * made.length);
  assert.strictEqual(soldiers(g), total);
  assert(perTick < 2, `simulation step took ${perTick.toFixed(2)} ms with ${made.length} routed armies`);
  console.log(`    ${made.length} cities in one order: planned in ${ms.toFixed(2)} ms, ${perTick.toFixed(3)} ms per simulation step while marching`);
});

console.log(`routing tests passed (${sections} sections)`);
