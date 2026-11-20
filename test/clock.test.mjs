// Pause and game speed.
//
// Pause is a property of the simulation: a paused match does not advance and
// takes no orders. Speed is how many fixed simulation steps the server runs
// per second of real time (game/clock.js); the steps themselves never change
// size. These tests check both against real, busy matches.
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { DT, ME, board, own } from './scene.mjs';

const require = createRequire(import.meta.url);
const { BALANCE: B } = require('../game/config');
const { Game, makeGroup } = require('../game/sim');
const { Pace } = require('../game/clock');

let sections = 0;
function section(name, fn) { fn(); sections++; console.log(`ok  ${name}`); }

/** Everything that makes up the state of a match, as one comparable string. */
function snap(g) {
  return JSON.stringify({
    t: +g.t.toFixed(6), alive: g.alive, winner: g.winner, nextCrate: g.nextCrate, nextId: g.nextId,
    nodes: g.nodes.map(c => ({ o: c.owner, l: c.level, g: c.groups, acc: c.acc, cd: c.cd, sh: c.shield, ae: c.aegis, ruin: c.ruin, rb: c.rebuild, siege: c.siege.map(a => a.id), guards: c.guards.map(a => a.id) })),
    armies: g.armies.map(a => ({ ...a, n: a.n })),
    players: g.players.map(p => ({ ...p, seen: [...p.seen], results: [...p.results] })),
    strikes: g.strikes, hazards: g.hazards, crates: g.crates, autos: [...g.autos], stats: g.stats,
    emps: g.emps, obst: g.obst, worms: g.worms, revs: [g.topoRev, g.featRev, g.ownerRev],
  });
}

/**
 * A real three-way AI match with crates, advanced until armies are marching and fighting, and
 * then given one of everything that runs on a timer, each by the real command: emplacements, a
 * route barricade, a disruption barrier, a Base Shield, a wormhole, both strikes on their way,
 * and a ruin being rebuilt.
 */
function busy(seed = 21) {
  const g = new Game([{ ai: 'hard', faction: 'iron', sub: 'volt' }, { ai: 'hard', faction: 'meridian', sub: 'shade' }, { ai: 'hard', faction: 'veil', sub: 'dominion' }], seed, { crates: true });
  let ticks = 0;
  const moving = () => g.armies.filter(a => a.state === 'march').length >= 2 && g.armies.some(a => a.state !== 'march');
  const ready = () => g.t > 40 && moving() && g.alive.every(Boolean) && g.players.every((p, pi) => g.basesOf(pi) >= 2);
  while (!ready() && ticks < 20 * 300 && g.winner === null) { g.tick(DT); g.drain(); ticks++; }
  assert(ready(), 'could not reach a moment with every player alive, marching and fighting');

  const needL3 = B.skills.superNeedsL3;
  B.skills.superNeedsL3 = 0;                                       // the cast itself is what is under test here, not its unlock
  try {
    const cast = [];
    g.players.forEach((p, pi) => {
      p.cd = [0, 0];
      p.charge = p.need;
      const mine = g.nodes.filter(c => c.owner === pi && !c.ruin);
      const prey = g.nodes.find(c => c.owner >= 0 && c.owner !== pi && !c.ruin && g.basesOf(c.owner) > 1 && !g.strikes.some(z => z.node === c.id));
      for (let slot = 0; slot < 3; slot++) {
        const def = g.skillDef(p, slot);
        let ok = false;
        // The AI may have one standing already; that serves just as well.
        if (def.target === 'ownCity') ok = mine.some(c => g.skill(pi, slot, { node: c.id }).ok) || g.emps.some(e => e.owner === pi && e.kind === def.emp);
        else if (def.target === 'enemyCity') ok = g.skill(pi, slot, { node: prey.id }).ok;
        else if (def.target === 'cityPair') ok = g.skill(pi, slot, { node: mine[0].id, to: mine[1].id }).ok;
        else {
          for (const c of mine) for (const v of g.adj[c.id]) for (const f of [0.5, 0.3, 0.7]) ok = ok || g.skill(pi, slot, { a: c.id, b: v, f }).ok;
          ok = ok || g.obst.some(o => o.owner === pi);
        }
        cast.push(ok);
      }
    });
    assert(cast.every(Boolean), `every skill should have been cast: ${cast}`);
  } finally { B.skills.superNeedsL3 = needL3; }
  const ruin = g.nodes.find(c => c.owner < 0);                     // a ruin in player 0's hands, being rebuilt
  ruin.ruin = true; ruin.owner = 0; ruin.groups = [makeGroup('iron', 'volt', 1, B.ruin.cost + 5)]; g.ownerRev++;
  assert(g.rebuild(0, ruin.id));
  g.drain();

  assert(g.strikes.length === 2 && g.emps.length >= 3 && g.obst.length === 2 && g.worms.length === 1, 'not everything is in play');
  assert(g.nodes.some(c => c.aegis) && g.nodes.some(c => c.rebuild) && g.players.some(p => p.cd[0] > 0 && p.cd[1] > 0));
  const mine = g.nodes.find(c => c.owner === 0 && !c.ruin), other = g.nodes.find(c => c.owner === 0 && c !== mine && !c.ruin) || g.nodes.find(c => c !== mine);
  g.setAuto(0, [mine.id], other.id, 0.25);
  return { g, ticks };
}

section('pause freezes movement, combat, production, cooldowns, buffs, strikes, emplacements, obstacles, wormholes, rebuilding, crates and the clock', () => {
  const { g } = busy();
  assert(g.crates.length > 0 || g.nextCrate > g.t, 'crate timer should be live');
  const before = snap(g);
  g.paused = true;
  for (let i = 0; i < 20 * 120; i++) g.tick(DT);                     // two minutes of real time pass
  assert.strictEqual(snap(g), before, 'something moved while the match was paused');
  assert.strictEqual(g.drain().events.length, 0, 'a paused match emits no events');
});

section('a paused match takes no orders, and refusing them changes nothing', () => {
  const { g } = busy();
  g.paused = true;
  const before = snap(g);
  const mine = g.nodes.filter(c => c.owner === 0), any = g.nodes.find(c => c.owner !== 0);
  const made = g.send(0, mine.map(c => c.id), any.id, 1, 9001);
  assert(made.paused && made.length === 0 && made.results.length === 0);
  assert.strictEqual(g.upgrade(0, mine[0].id), false);
  for (let slot = 0; slot < 3; slot++) assert.deepStrictEqual(g.skill(0, slot, { x: mine[0].x, y: mine[0].y, node: mine[0].id, to: any.id, pct: 1 }, 9002 + slot), { ok: false, why: 'paused' });
  assert(g.setAuto(0, [mine[0].id], any.id, 0.5, 9010).paused);
  assert(g.clearAuto(0, [mine[0].id], 9011).paused);
  assert.strictEqual(snap(g), before);
  // The refused command ids were not consumed: the same orders work after resuming.
  g.paused = false;
  assert(g.send(0, [mine[0].id], [...g.adj[mine[0].id]][0], 0.5, 9001).results.length === 1);
});

section('resuming continues exactly where it stopped: no catch-up, nothing duplicated, nothing expired', () => {
  const a = busy(33), b = busy(33);
  assert.strictEqual(snap(a.g), snap(b.g), 'two matches from one seed should be identical');
  a.g.paused = true;
  for (let i = 0; i < 20 * 300; i++) a.g.tick(DT);                   // five minutes paused
  a.g.paused = false;
  let produced = 0;
  for (let i = 0; i < 20 * 40; i++) {
    a.g.tick(DT); b.g.tick(DT);
    if (i === 0) {
      // The first step after a long pause is an ordinary step: no burst of production, dispatches or damage.
      produced = a.g.stats.reduce((s, x) => s + x.produced, 0) - b.g.stats.reduce((s, x) => s + x.produced, 0);
      assert.strictEqual(produced, 0);
      assert.strictEqual(snap(a.g), snap(b.g), 'the first step after resuming differs from an unpaused match');
    }
  }
  assert.strictEqual(snap(a.g), snap(b.g), 'a paused-and-resumed match must be indistinguishable from one that never paused');
});

section('pausing and resuming many times in a row leaves no trace either', () => {
  const a = busy(41), b = busy(41);
  for (let i = 0; i < 400; i++) {
    a.g.paused = i % 3 === 1;                                        // flicker
    a.g.tick(DT);
    if (!a.g.paused) b.g.tick(DT);
  }
  a.g.paused = false;
  assert.strictEqual(snap(a.g), snap(b.g));
});

// ------------------------------------------------------------ speed

const SPEEDS = B.speeds;
section('five speeds, 1x by default', () => {
  assert.deepStrictEqual(SPEEDS, [0.5, 0.75, 1, 1.5, 2]);
  assert.strictEqual(B.defaultSpeed, 1);
  assert.strictEqual(new Pace(DT).speed, 1);
});

section('each speed runs exactly that many simulation seconds per real second, in fixed steps', () => {
  for (const speed of SPEEDS) {
    for (const slice of [0.05, 0.016, 0.033, 0.1]) {                 // the server's timer, and less regular ones
      const pace = new Pace(DT, speed);
      let steps = 0, most = 0;
      for (let real = 0; real < 60 - 1e-9; real += slice) { const n = pace.advance(slice); steps += n; most = Math.max(most, n); }
      const sim = steps * DT;
      assert(Math.abs(sim - 60 * speed) <= DT * 2 + slice * speed, `${speed}x with ${slice}s slices ran ${sim.toFixed(2)} simulation seconds in 60 real ones`);
      assert(most <= Math.ceil((slice * speed) / DT) + 1, 'steps must be spread evenly, never bunched');
    }
  }
});

section('changing speed again and again keeps every remaining duration; pausing accrues nothing', () => {
  const pace = new Pace(DT, 1);
  let steps = 0, expected = 0;
  const plan = [[1, 7.3], [2, 3.1], [0.5, 10], [1.5, 4.45], [0.75, 8.2], [2, 0.07], [0.5, 0.07], [1, 5]];
  for (const [speed, seconds] of plan) {
    pace.setSpeed(speed);
    for (let real = 0; real < seconds - 1e-9; real += 0.05) steps += pace.advance(Math.min(0.05, seconds - real));
    expected += speed * seconds;
  }
  assert(Math.abs(steps * DT - expected) <= DT, `expected ${expected.toFixed(2)} simulation seconds, ran ${(steps * DT).toFixed(2)}`);

  // Paused: no steps, however long it lasts, at any selected speed; and no burst afterwards.
  for (const speed of SPEEDS) {
    pace.setSpeed(speed);
    for (let i = 0; i < 2400; i++) assert.strictEqual(pace.advance(0.05, true), 0);
  }
  pace.setSpeed(2);
  assert(pace.advance(0.05) <= 3, 'the first slice after a pause must be an ordinary slice');
  assert(pace.advance(3600) <= Math.ceil((0.25 * 2) / DT) + 1, 'a stalled process is capped, not replayed');
});

/** Run a match in real-time slices at a given speed; returns { real, ticks } when `until` holds. */
function play(g, pace, until, maxReal = 600) {
  let real = 0, ticks = 0;
  while (real < maxReal) {
    real += 0.05;
    for (let n = pace.advance(0.05, g.paused); n > 0; n--) {
      g.tick(DT); g.drain(); ticks++;
      if (until(g)) return { real, ticks };
    }
  }
  throw new Error('condition never reached');
}

section('a 60-second cooldown takes 30 real seconds at 2x and 120 at 0.5x, and the same number of steps at every speed', () => {
  const counts = [];
  for (const speed of SPEEDS) {
    const g = board([0, 1]);
    g.players[ME].cd[0] = 60;
    const { real, ticks } = play(g, new Pace(DT, speed), x => x.players[ME].cd[0] <= 0);
    assert(Math.abs(real - 60 / speed) <= 0.2, `${speed}x: took ${real.toFixed(2)} real seconds, expected ${(60 / speed).toFixed(1)}`);
    counts.push(ticks);
  }
  assert(counts.every(n => n === counts[0]), `every speed should take the same number of steps, got ${counts}`);
});

section('automatic dispatch keeps its simulation-time interval at every speed', () => {
  for (const speed of SPEEDS) {
    const g = board([0, 1]);
    own(g, 0, ME, 500);
    g.setAuto(ME, [0], 1, 0.02, 1);
    const pace = new Pace(DT, speed), seen = new Set(), at = [];
    let real = 0;
    while (at.length < 5) {
      for (let n = pace.advance(0.05); n > 0; n--) {
        g.tick(DT);
        for (const a of g.armies) if (!seen.has(a.id)) { seen.add(a.id); at.push({ real, sim: g.t }); }
      }
      real += 0.05;
    }
    for (let i = 1; i < at.length; i++) {
      assert(Math.abs(at[i].sim - at[i - 1].sim - B.auto.interval) <= DT + 1e-9, `${speed}x: departures ${at[i].sim - at[i - 1].sim} simulation seconds apart`);
      assert(Math.abs(at[i].real - at[i - 1].real - B.auto.interval / speed) <= 0.11, `${speed}x: departures ${(at[i].real - at[i - 1].real).toFixed(2)} real seconds apart`);
    }
  }
});

section('the same orders at the same steps give the same match, whatever the speed, jitter or pauses', () => {
  const script = new Map([[40, g => g.send(0, [g.nodes.find(c => c.owner === 0).id], [...g.adj[g.nodes.find(c => c.owner === 0).id]][0], 0.5, 1)],
    [300, g => g.upgrade(0, g.nodes.find(c => c.owner === 0).id)],
    [700, g => g.setAuto(0, [g.nodes.find(c => c.owner === 0).id], g.nodes.find(c => c.owner !== 0).id, 0.5, 2)]]);
  const TOTAL = 20 * 150;
  const runs = [[1], [2], [0.5], [0.5, 2, 1.5, 0.75, 1]].map((speeds, r) => {
    const g = new Game([{ ai: null, faction: 'iron', sub: 'bastion' }, { ai: 'hard', faction: 'veil', sub: 'forge' }, { ai: 'normal', faction: 'meridian', sub: 'aegis' }], 77, { crates: true });
    const pace = new Pace(DT, speeds[0]);
    let ticks = 0, slice = 0;
    while (ticks < TOTAL) {
      slice++;
      if (slice % 97 === 0) pace.setSpeed(speeds[(slice / 97) % speeds.length | 0]);
      if (r === 3 && slice % 211 < 40) { g.paused = true; assert.strictEqual(pace.advance(0.05, true), 0); g.tick(DT); continue; }   // paused stretches
      g.paused = false;
      const real = r === 3 ? 0.02 + ((slice * 37) % 60) / 1000 : 0.05;     // an irregular timer
      for (let n = pace.advance(real); n > 0 && ticks < TOTAL; n--) {
        if (script.has(ticks)) script.get(ticks)(g);
        g.tick(DT);
        ticks++;
      }
    }
    return snap(g);
  });
  for (let i = 1; i < runs.length; i++) assert.strictEqual(runs[i], runs[0], `run ${i} diverged from the 1x run`);
});

console.log(`pause and speed tests passed (${sections} sections)`);
