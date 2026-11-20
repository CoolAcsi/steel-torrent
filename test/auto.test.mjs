// Persistent orders ("auto dispatch"): a city keeps sending to one destination
// until told to stop. Everything here runs in the authoritative simulation --
// orders are set once and the simulation does the rest, tick by tick.
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { DT, ME, FOE, scene, own, board, run, events, soldiers, mineOnly, PTS, ROADS } from './scene.mjs';

const require = createRequire(import.meta.url);
const { BALANCE: B } = require('../game/config');
const { REJECT, AUTO, makeGroup } = require('../game/sim');

const EVERY = B.auto.interval, MIN = B.auto.minDispatch;
let sections = 0;
function section(name, fn) { fn(); sections++; console.log(`ok  ${name}`); }

/** Run, recording when each new army of mine appears: [{ t, src, n, dest, auto }]. */
function watch(g, seconds, until) {
  const seen = new Set(g.armies.map(a => a.id)), out = [];
  run(g, seconds, () => {
    for (const a of g.armies) {
      if (seen.has(a.id) || a.owner !== ME) continue;
      seen.add(a.id);
      out.push({ t: +g.t.toFixed(2), src: a.src, n: a.n, dest: a.dest, auto: !!a.auto });
      assert(a.n >= 1, 'an empty army was created');
    }
    for (const c of g.nodes) assert(c.units >= 0, 'negative garrison');
    return until && until(g);
  });
  return out;
}
const stateOf = (g, src, dest) => {
  if (dest != null) return (g.autos.get(g.autoKey(src, dest)) || {}).state;
  for (const o of g.autos.values()) if (o.src === src) return o.state;
  return undefined;
};

section('one order, several cities: every source keeps sending on its own route, cycle after cycle', () => {
  const g = board([0, 1, 2, 3]);
  for (const i of [0, 1, 2]) own(g, i, ME, 200);
  const total = soldiers(g);
  const res = g.setAuto(ME, [0, 1, 2], 3, 0.1, 1);
  assert.deepStrictEqual([...res], [[0, 1], [1, 1], [2, 1]]);
  assert.deepStrictEqual(g.autoList(ME), [[0, 3, 10, AUTO.active], [1, 3, 10, AUTO.active], [2, 3, 10, AUTO.active]]);

  const out = watch(g, EVERY * 4 + 1);
  for (const src of [0, 1, 2]) {
    const mine = out.filter(o => o.src === src);
    assert.strictEqual(mine.length, 5, `city ${src} should have sent five times`);
    assert(mine.every(o => o.dest === 3 && o.auto), 'every departure goes to the order\'s destination');
    for (let i = 1; i < mine.length; i++) assert(Math.abs(mine[i].t - mine[i - 1].t - EVERY) <= DT + 1e-9, 'departures are one interval apart');
    assert.deepStrictEqual(mine.map(o => o.n), [20, 18, 16, 14, 13], 'each cycle takes its share of what is there now');
  }
  assert.strictEqual(soldiers(g), total, 'soldiers were created or lost');
  assert(g.nodes[1].units === 200 - 81 && g.nodes[2].units === 200 - 81, 'waypoints must not absorb the columns passing through');
});

section('too few troops: the city waits, sends nothing empty, and goes when it has enough', () => {
  const g = scene(PTS, ROADS, { produce: true });
  own(g, 0, ME, 4); own(g, 1, ME, 20); own(g, 8, FOE, 10);
  g.setAuto(ME, [0], 1, 0.5, 1);
  let out = watch(g, 1);
  assert.strictEqual(out.length, 0, 'half of four is below the minimum departure');
  assert.strictEqual(stateOf(g, 0), AUTO.troops);
  out = watch(g, 12, () => out.length > 0 || g.armies.some(a => a.owner === ME));
  const first = g.armies.find(a => a.owner === ME);
  assert(first && first.n >= MIN, 'the first departure should meet the minimum');
  assert.strictEqual(stateOf(g, 0), AUTO.active);
});

section('no backlog: a city that could not send for a long time sends once, not once per missed cycle', () => {
  const g = board([0, 1]);
  own(g, 0, ME, 0);
  g.setAuto(ME, [0], 1, 0.5, 1);
  assert.strictEqual(watch(g, EVERY * 5).length, 0);
  own(g, 0, ME, 100);                                      // reinforcements arrive after five idle cycles
  const out = watch(g, EVERY - 0.5);
  assert.deepStrictEqual(out.map(o => o.n), [50], 'exactly one departure, of half the garrison');
  assert.strictEqual(watch(g, 1).length, 1, 'and the next one a full interval later');
});

section('manual orders and automatic ones share a city without losing the order or the count', () => {
  const g = board([0, 1, 2]);
  own(g, 0, ME, 40);
  g.setAuto(ME, [0], 1, 0.5, 1);
  watch(g, 1);                                             // the automatic departure: 20 leave
  assert.strictEqual(g.nodes[0].units, 20);
  const made = g.send(ME, [0], 2, 1, 2);                   // then everything else, by hand, somewhere else
  assert.deepStrictEqual(made.results, [[0, 20, 2]]);
  assert.strictEqual(g.nodes[0].units, 0);
  assert.deepStrictEqual(g.autoList(ME).map(o => o.slice(0, 2)), [[0, 1]], 'a manual order must not delete the persistent one');
  const out = watch(g, EVERY + 1);
  assert.strictEqual(out.length, 0, 'nothing left to send');
  assert.strictEqual(stateOf(g, 0), AUTO.troops);
  assert.strictEqual(mineOnly(g), 20 * 2 + 40);
});

section('blocked route: the order is suspended, then resumes when the route returns, without catching up', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 200);
  g.setAuto(ME, [0], 3, 0.1, 1);
  watch(g, 1);
  own(g, 2, FOE, 10);                                      // the road to 3 is cut
  const idle = watch(g, EVERY * 3);
  assert.strictEqual(idle.length, 0, 'nothing may leave while there is no route');
  assert.strictEqual(stateOf(g, 0), AUTO.blocked);
  const kept = g.nodes[0].units;
  own(g, 2, ME, 10);
  const back = watch(g, B.auto.retry + 0.5);
  assert.strictEqual(back.length, 1, 'one departure when the route returns, not three');
  assert.strictEqual(back[0].n, Math.floor(kept * 0.1));
  assert.strictEqual(stateOf(g, 0), AUTO.active);
});

section('an order may be set toward a place that cannot be reached yet', () => {
  const g = board([0, 1]);
  const res = g.setAuto(ME, [0], 4, 0.5, 1);               // 4 lies beyond two neutral cities
  assert.deepStrictEqual([...res], [[0, 1]]);
  watch(g, 2);
  assert.strictEqual(stateOf(g, 0), AUTO.blocked);
  assert.strictEqual(g.armies.length, 0);
  assert.strictEqual(g.nodes[0].units, 20);
});

section('losing the source cancels its order for good; the new owner inherits nothing', () => {
  const g = board([0, 1, 2]);
  own(g, 0, ME, 100);
  g.setAuto(ME, [0], 2, 0.2, 1);
  watch(g, 1);
  own(g, 0, FOE, 50);
  run(g, 0.2);
  assert.strictEqual(g.autos.size, 0);
  assert.deepStrictEqual(events(g, 'auto').map(e => [e.p, e.src, e.why]), [[ME, 0, 'lost']]);
  const before = g.armies.length;
  run(g, EVERY * 2);
  assert(g.armies.every(a => a.owner === ME) && g.armies.length <= before, 'the captor must not be sending on the old order');
  own(g, 0, ME, 50);                                       // even after retaking it
  assert.strictEqual(watch(g, EVERY * 2).length, 0, 'a cancelled order does not come back');
});

section('a hostile destination: departures attack it; once it falls, later ones reinforce it', () => {
  const g = board([0, 1]);
  own(g, 0, ME, 300);
  own(g, 1, FOE, 12);
  g.setAuto(ME, [0], 1, 0.2, 1);
  assert(run(g, 60, () => g.nodes[1].owner === ME), 'the destination never fell');
  assert.strictEqual(events(g, 'cap').filter(e => e.node === 1).length, 1);
  assert.strictEqual(g.autos.size, 1, 'the order outlives the capture');
  const at = g.nodes[1].units;
  run(g, EVERY * 2 + 6);
  assert(g.nodes[1].units > at, 'later departures should arrive as reinforcements');
  assert(!g.nodes[1].siege.length);
});

section('production thresholds: a departure frees capacity, a reinforcement may exceed it', () => {
  const g = scene(PTS, ROADS, { produce: true });
  own(g, 0, ME, 20); own(g, 1, ME, 20); own(g, 8, FOE, 10);
  const cap = B.levels[1].threshold;
  run(g, 3);
  assert.strictEqual(g.nodes[0].units, cap, 'a full city does not produce');
  g.setAuto(ME, [0], 1, 0.5, 1);
  run(g, 0.1);
  assert.strictEqual(g.nodes[0].units, cap - 10);
  run(g, 3);
  assert(g.nodes[0].units > cap - 10, 'production should restart once troops have left');
  run(g, EVERY * 3);
  assert(g.nodes[1].units > cap, `reinforced city should be above its threshold, has ${g.nodes[1].units}`);
  assert(g.nodes[0].units <= cap);
});

section('stopping an order stops departures, not the armies already marching', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 100); own(g, 1, ME, 100);
  g.setAuto(ME, [0, 1], 3, 0.1, 1);
  watch(g, 1);
  const marching = g.armies.map(a => a.id);
  assert.strictEqual(marching.length, 2);
  assert.deepStrictEqual([...g.clearAuto(ME, [0], 2)], [[0, 1]]);        // only city 0
  assert.deepStrictEqual(g.autoList(ME).map(o => o[0]), [1]);
  const later = watch(g, EVERY * 2 + 1);
  assert(later.length === 2 && later.every(o => o.src === 1), 'only the city still under orders keeps sending');
  assert(run(g, 60, () => !g.armies.some(a => marching.includes(a.id))));
  assert(g.nodes[3].units >= 20 + 10 + 10, 'the armies that had already left still arrived');
  assert.deepStrictEqual([...g.clearAuto(ME, [0, 9], 3)], [[0, -REJECT.notYours], [9, -REJECT.notYours]], 'nothing to stop there');
});

section('setup is idempotent, multiple parallel routes coexist, and bad sources are refused by name', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 40);
  const first = g.setAuto(ME, [0, 9, 3, 0], 3, 0.5, 7);
  assert.deepStrictEqual([...first], [[0, 1], [9, -REJECT.notYours], [3, -REJECT.isTarget]]);
  for (let i = 0; i < 4; i++) assert.deepStrictEqual([...g.setAuto(ME, [0, 9, 3, 0], 3, 0.5, 7)], [...first], 'a retried message gets the first answer');
  assert.strictEqual(g.autos.size, 1);
  g.setAuto(ME, [0], 2, 0.5, 8);                           // add a second parallel route from city 0
  assert.deepStrictEqual(g.autoList(ME), [[0, 2, 50, AUTO.active], [0, 3, 50, AUTO.active]]);
  const out = watch(g, 1);
  assert.deepStrictEqual(out.map(o => [o.src, o.dest, o.n]).sort((a, b) => a[1] - b[1]), [[0, 2, 10], [0, 3, 10]]);
  assert.deepStrictEqual([...g.clearAuto(ME, [0], 9, 3)], [[0, 1]], 'cancelling one parallel route keeps the other');
  assert.deepStrictEqual(g.autoList(ME), [[0, 2, 50, AUTO.active]]);
  assert.deepStrictEqual(g.autoList(FOE), [], 'orders are private to their owner');
});

section('parallel routes split troops evenly, and chain pairs a->b->c run simultaneously', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 100); own(g, 1, ME, 60);
  const total = soldiers(g);
  const res = g.setAutoPairs(ME, [[0, 1], [1, 2]], 0.5, 10);
  assert.deepStrictEqual([...res], [[0, 1], [1, 1]]);
  assert.deepStrictEqual(g.autoList(ME), [[0, 1, 50, AUTO.active], [1, 2, 50, AUTO.active]]);
  const out = watch(g, 1);
  assert.deepStrictEqual(out.map(o => [o.src, o.dest, o.n]).sort((a, b) => a[0] - b[0]), [[0, 1, 50], [1, 2, 30]]);
  assert.strictEqual(soldiers(g), total, 'soldiers conserved across chain dispatch');
});

section('setAutoPairs with replace=true overwrites all previous routes of the player without touching foes', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 100); own(g, 1, ME, 100); own(g, 8, FOE, 100);
  g.setAutoPairs(ME, [[0, 1], [1, 2]], 0.5, 11, false);
  g.setAuto(FOE, [8], 7, 0.5, 12);
  assert.deepStrictEqual(g.autoList(ME).map(o => o.slice(0, 2)), [[0, 1], [1, 2]]);
  const res = g.setAutoPairs(ME, [[0, 3]], 0.5, 13, true);
  assert.deepStrictEqual([...res], [[0, 1]]);
  assert.deepStrictEqual(g.autoList(ME).map(o => o.slice(0, 2)), [[0, 3]], 'old routes should be replaced by the new plan');
  assert.deepStrictEqual(g.autoList(FOE).map(o => o.slice(0, 2)), [[8, 7]], 'opponent routes must remain untouched');
});

section('each road segment allows only one dispatch direction; newer dispatches overwrite opposing ones', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 100); own(g, 1, ME, 100); own(g, 2, ME, 100); own(g, 3, ME, 100);
  // 0 -> 2 uses roads 0->1 and 1->2
  g.setAuto(ME, [0], 2, 0.5, 20);
  assert.deepStrictEqual(g.autoList(ME).map(o => o.slice(0, 2)), [[0, 2]]);
  // Setting 2 -> 1 uses road 2->1 (opposite of 1->2), so 0 -> 2 must be overwritten
  g.setAuto(ME, [2], 1, 0.5, 21);
  assert.deepStrictEqual(g.autoList(ME).map(o => o.slice(0, 2)), [[2, 1]], 'opposing route on shared road segment must be overwritten');
  // Setting 1 -> 2 reverses 2 -> 1
  g.setAutoPairs(ME, [[1, 2], [2, 3]], 0.5, 22, false);
  assert.deepStrictEqual(g.autoList(ME).map(o => o.slice(0, 2)), [[1, 2], [2, 3]], 'new chain overwrites old opposite road direction');
});

section('clearAutoSegment cancels dispatch on that specific road segment while keeping upstream segments', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 100); own(g, 1, ME, 100); own(g, 2, ME, 100);
  // Multi-hop 0 -> 2 (uses 0->1 and 1->2) plus 1 -> 2 (uses 1->2)
  g.setAutoPairs(ME, [[0, 2], [1, 2]], 0.5, 30, true);
  // Cancel road segment 1 -> 2: removes 1->2 and truncates 0->2 to 0->1
  const res = g.clearAutoSegment(ME, 1, 2, 31);
  assert(res.length >= 1 && res.every(r => r[1] === 1));
  assert.deepStrictEqual(g.autoList(ME).map(o => o.slice(0, 2)), [[0, 1]], 'cancelling 1->2 keeps 0->1 intact');
  // Cancel road segment 0 -> 1: removes 0->1
  g.clearAutoSegment(ME, 0, 1, 32);
  assert.deepStrictEqual(g.autoList(ME), [], 'cancelling 0->1 clears remaining segment');
});

section('setAutoPct updates dispatch ratio globally for all active routes of the player', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 100); own(g, 1, ME, 100); own(g, 8, FOE, 100);
  g.setAutoPairs(ME, [[0, 1], [1, 2]], 0.25, 40, true);
  g.setAuto(FOE, [8], 7, 0.5, 41);
  assert.strictEqual(g.setAutoPct(ME, 0.75), 2);
  assert.deepStrictEqual(g.autoList(ME).map(o => [o[0], o[1], o[2]]), [[0, 1, 75], [1, 2, 75]]);
  assert.deepStrictEqual(g.autoList(FOE).map(o => [o[0], o[1], o[2]]), [[8, 7, 50]], 'opponent ratio must not change');
});

section('a city under attack keeps its garrison: the order holds until the siege is over', () => {
  const g = board([0, 1]);
  own(g, 0, ME, 60);
  const p = g.players[FOE];
  g.newArmy(FOE, 1, 0, [makeGroup(p.faction, p.sub, 1, 25)], g.dist(1, 0) - B.march.arriveAt - 1);
  g.setAuto(ME, [0], 1, 0.5, 1);
  const out = watch(g, 0.5);
  assert.strictEqual(out.length, 0);
  assert.strictEqual(stateOf(g, 0), AUTO.siege);
  assert(run(g, 40, () => !g.nodes[0].siege.length && g.armies.some(a => a.owner === ME)), 'the order never resumed after the siege');
});

section('a paused match accepts no orders; the end of the match stops everything', () => {
  let g = board([0, 1]);
  g.paused = true;
  const res = g.setAuto(ME, [0], 1, 0.5, 1);
  assert(res.paused && res.length === 0 && g.autos.size === 0);
  g.paused = false;
  g.setAuto(ME, [0], 1, 0.5, 2);
  g.paused = true;
  assert(g.clearAuto(ME, [0], 3).paused && g.autos.size === 1);

  g = board([0, 1]);
  own(g, 0, ME, 100);
  g.setAuto(ME, [0], 1, 0.1, 1);
  watch(g, 1);
  for (const c of g.nodes) if (c.owner === FOE) own(g, c.id, ME, 5);     // the opponent has nothing left
  run(g, 0.2);
  assert.strictEqual(g.winner, ME);
  assert.strictEqual(g.autos.size, 0);
  const n = g.armies.length;
  for (let i = 0; i < 400; i++) g.tick(DT);
  assert.strictEqual(g.armies.length, n, 'nothing is dispatched after the match is over');
});

console.log(`auto-dispatch tests passed (${sections} sections)`);
