'use strict';
// Gameplay rules of the authoritative simulation.
//
// Most sections build a tiny scripted scene (a blank map with a few cities and
// hand-placed armies) so each rule is checked in isolation; the last sections
// run full AI matches for accounting, determinism and termination.
const assert = require('assert');
const { BALANCE: B } = require('../game/config');
const { Game, unitStats, powerOf, countOf, hpOf, makeGroup, takeSoldiers, fight } = require('../game/sim');

const DT = 0.05;
const R = B.combat.engageRadius;
const ARRIVE = B.march.arriveAt;

function section(name, fn) {
  fn();
  console.log(`ok  ${name}`);
}

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
function eq(a, b, msg, eps) {
  assert(close(a, b, eps), `${msg || 'values differ'}: ${a} vs ${b}`);
}

// ------------------------------------------------------------ scene helpers

/** A match with every city neutral (5 soldiers, level 1) and all basic skills ready. */
function setup(facs, opts = {}) {
  const players = facs.map(s => { const [faction, sub] = s.split('/'); return { ai: null, faction, sub }; });
  const g = new Game(players, opts.seed || 11, { crates: !!opts.crates });
  for (const n of g.nodes) {
    n.owner = -1; n.level = 1; n.groups = [makeGroup('neutral', '', 1, 5)];
    n.acc = 0; n.cd = 0; n.shield = null; n.siege = [];
  }
  for (const p of g.players) p.cd = [0, 0];
  return g;
}

function own(g, id, pi, level = 1, n = 10, tier = 1) {
  const c = g.nodes[id], p = g.players[pi];
  c.owner = pi; c.level = level; c.acc = 0; c.cd = 0; c.shield = null;
  c.groups = n > 0 ? [makeGroup(p.faction, p.sub, tier, n)] : [];
  return c;
}

/** Every player with no city gets one out of the way, so nobody is eliminated mid-test. */
function homes(g, taken = []) {
  const used = new Set(taken);
  for (let pi = 0; pi < g.np; pi++) {
    if (g.nodes.some(c => c.owner === pi)) continue;
    const c = [...g.nodes].reverse().find(n => n.owner < 0 && !used.has(n.id));
    assert(c, 'no room for a home city');
    own(g, c.id, pi, 1, 10);
    used.add(c.id);
  }
}

function army(g, pi, from, to, n, o = {}) {
  const p = g.players[pi];
  return g.newArmy(pi, from, to, [makeGroup(p.faction, p.sub, o.tier || 1, n)], o.s || 0);
}

const longEdge = g => g.edges.map(([a, b]) => ({ a, b, L: g.dist(a, b) })).sort((p, q) => q.L - p.L || p.a - q.a)[0];
const hubOf = g => [...g.nodes].sort((a, b) => g.adj[b.id].size - g.adj[a.id].size || a.id - b.id)[0];

function total(g, pi) {
  let n = 0, hp = 0;
  for (const c of g.nodes) if (c.owner === pi) { n += countOf(c.groups); hp += hpOf(c.groups); }
  for (const a of g.armies) if (a.owner === pi) { n += countOf(a.groups); hp += hpOf(a.groups); }
  return { n, hp };
}

function run(g, seconds, each) {
  for (let i = 0, k = Math.round(seconds / DT); i < k; i++) {
    g.tick(DT);
    if (each && each() === false) return;
  }
}

function noProd(fn) {
  const saved = B.levels.slice(1).map(l => l.prod);
  B.levels.slice(1).forEach(l => { l.prod = 0; });
  try { return fn(); } finally { B.levels.slice(1).forEach((l, i) => { l.prod = saved[i]; }); }
}

/** Give a player a ready superweapon: enough level-3 cities and a full charge. */
function armSuper(g, pi, cities) {
  for (const id of cities) own(g, id, pi, 3, 10, 3);
  g.players[pi].charge = g.players[pi].need;
}

// ============================================================ 1. dispatch

section('multi-city dispatch: one order, independent sources, invalid ones skipped', () => noProd(() => {
  const g = setup(['iron/bastion', 'meridian/shade']);
  const hub = hubOf(g), nb = [...g.adj[hub.id]];
  assert(nb.length >= 4, 'test map needs a hub with four roads');
  const far = g.nodes.find(n => n.id !== hub.id && !g.adj[hub.id].has(n.id));
  const A = own(g, nb[0], 0, 1, 20);
  const M = own(g, nb[1], 0, 2, 0);
  M.groups = [makeGroup('iron', 'bastion', 1, 10), makeGroup('iron', 'bastion', 2, 21)];     // mixed tiers
  const E = own(g, nb[2], 1, 1, 20);                                                           // enemy city
  const Z = own(g, nb[3], 0, 1, 0);                                                            // empty
  const F = own(g, far.id, 0, 1, 20);                                                          // no road to the target
  const before = total(g, 0);

  const made = g.send(0, [A.id, M.id, E.id, Z.id, F.id, hub.id, 999, A.id], hub.id, 0.5, 1);
  assert.strictEqual(made.length, 2, 'only the two eligible cities send');
  assert.deepStrictEqual(made.map(a => a.from).sort((x, y) => x - y), [A.id, M.id].sort((x, y) => x - y));
  const fromA = made.find(a => a.from === A.id), fromM = made.find(a => a.from === M.id);
  assert.strictEqual(fromA.n, 10);
  assert.strictEqual(fromM.n, 15, 'half of 31, rounded down');
  assert.strictEqual(A.units, 10);
  assert.strictEqual(M.units, 16);
  assert.strictEqual(E.units, 20, 'enemy city untouched');
  assert.strictEqual(F.units, 20, 'unlinked city untouched');
  // Mixed garrison: the requested total is respected and split in proportion (largest remainder).
  const t1 = fromM.groups.find(x => x.t === 1).n, t2 = fromM.groups.find(x => x.t === 2).n;
  assert.deepStrictEqual([t1, t2], [5, 10]);
  // Atomic: what left the cities is exactly what is on the road.
  const after = total(g, 0);
  assert.strictEqual(after.n, before.n);
  eq(after.hp, before.hp, 'health is conserved by dispatch');
  assert(made.every(a => g.armies.includes(a) && a.to === hub.id && a.state === 'march'));

  // A repeated command id is ignored (retries, duplicate pointer events, replayed messages).
  assert.strictEqual(g.send(0, [A.id, M.id], hub.id, 0.5, 1).length, 0);
  assert.strictEqual(A.units, 10);
  assert.strictEqual(g.armies.length, 2);
  // A different id is a new order; rapid orders each take their share of what is left.
  assert.strictEqual(g.send(0, [A.id], hub.id, 0.5, 2)[0].n, 5);
  assert.strictEqual(g.send(0, [A.id], hub.id, 0.5, 3)[0].n, 2);
  assert.strictEqual(A.units, 3);

  // Not the owner; unknown target; no sources at all.
  assert.strictEqual(g.send(1, [A.id], hub.id, 1, 4).length, 0);
  assert.strictEqual(g.send(0, [A.id], 999, 1, 5).length, 0);
  assert.strictEqual(g.send(0, [], hub.id, 1, 6).length, 0);
  assert.strictEqual(A.units, 3);

  // A lone soldier still marches at 25%; the minimum-garrison rule holds troops back.
  const one = own(g, nb[3], 0, 1, 1);
  assert.strictEqual(g.send(0, [one.id], hub.id, 0.25, 7)[0].n, 1);
  const keep = B.dispatch.minGarrison;
  B.dispatch.minGarrison = 8;
  try {
    own(g, nb[0], 0, 1, 10);
    own(g, nb[3], 0, 1, 8);
    const got = g.send(0, [nb[0], nb[3]], hub.id, 1, 8);
    assert.strictEqual(got.length, 1, 'a city at its minimum garrison is skipped, the other still sends');
    assert.strictEqual(got[0].n, 2);
    assert.strictEqual(g.nodes[nb[0]].units, 8);
    assert.strictEqual(g.nodes[nb[3]].units, 8);
  } finally { B.dispatch.minGarrison = keep; }
}));

// ============================================================ 2. conservation

section('troop conservation: dispatch, reinforcement, conversion', () => noProd(() => {
  // takeSoldiers on a wounded, mixed-tier garrison
  const s1 = unitStats('iron', 'bastion', 1), s2 = unitStats('iron', 'bastion', 2);
  const groups = [
    { f: 'iron', sub: 'bastion', t: 1, n: 10, hp: 10 * s1.hp * 0.55, cv: false },
    { f: 'iron', sub: 'bastion', t: 2, n: 6, hp: 6 * s2.hp, cv: false },
  ];
  const n0 = countOf(groups), h0 = hpOf(groups), avg1 = groups[0].hp / groups[0].n;
  const taken = takeSoldiers(groups, 7);
  assert.strictEqual(countOf(taken), 7);
  assert.strictEqual(countOf(taken) + countOf(groups), n0);
  eq(hpOf(taken) + hpOf(groups), h0, 'splitting a garrison neither heals nor hurts');
  const tk1 = taken.find(x => x.t === 1);
  eq(tk1.hp / tk1.n, avg1, 'wounded soldiers stay wounded');
  eq(groups.find(x => x.t === 1).hp / groups.find(x => x.t === 1).n, avg1);
  assert(taken.every(x => x.t === 1 || x.t === 2) && taken.find(x => x.t === 2).n + groups.find(x => x.t === 2).n === 6, 'tiers are preserved');

  // march to a friendly city
  {
    const g = setup(['iron/bastion', 'meridian/shade']);
    const e = longEdge(g);
    own(g, e.a, 0, 1, 30);
    own(g, e.b, 0, 1, 25);
    homes(g, [e.a, e.b]);
    const before = total(g, 0);
    g.send(0, [e.a], e.b, 0.6, 1);
    run(g, 30, () => g.armies.length > 0);
    assert.strictEqual(g.armies.length, 0, 'the army arrived');
    assert.strictEqual(g.nodes[e.b].units, 25 + 18, 'reinforcements may exceed the production threshold');
    const after = total(g, 0);
    assert.strictEqual(after.n, before.n);
    eq(after.hp, before.hp);
  }

  // conversion
  {
    const g = setup(['veil/forge', 'iron/bastion']);
    const e = longEdge(g);
    homes(g, [e.a, e.b]);
    const a = g.newArmy(1, e.a, e.b, [
      { f: 'iron', sub: 'bastion', t: 1, n: 10, hp: 10 * s1.hp * 0.7, cv: false },
      makeGroup('iron', 'bastion', 2, 5),
    ], 60);
    const n1 = a.n, h1 = hpOf(a.groups);
    const moved = g.convert(a, 4, 0, e.a);
    assert.strictEqual(moved, 4);
    const mine = g.armies.find(x => x.owner === 0);
    assert(mine, 'converted soldiers form a new army');
    assert.strictEqual(mine.n + a.n, n1, 'no duplication');
    eq(hpOf(mine.groups) + hpOf(a.groups), h1, 'no free healing');
    assert(mine.groups.every(x => x.cv && x.f === 'iron'), 'converted troops keep their faction and are flagged');
    const tier2 = x => x.groups.filter(q => q.t === 2).reduce((s, q) => s + q.n, 0);
    assert.strictEqual(tier2(mine) + tier2(a), 5, 'no tier change');
    assert.strictEqual(g.convertible(mine, 1, 99, 0), 0, 'converted troops can never be converted again');
    assert.strictEqual(g.stats[0].converted, 4);
    assert.strictEqual(g.stats[1].lostToConversion, 4);
    assert.strictEqual(g.stats[1].losses, 0, 'conversion is not a casualty');
    eq(mine.s / mine.L + (mine.to === a.to ? 0 : a.s / a.L), mine.to === a.to ? a.s / a.L : 1, 'the new army starts where it was converted');
    assert.strictEqual(mine.to, e.a);
  }
}));

// ============================================================ 3. thresholds

section('production threshold pauses production but never limits the garrison', () => {
  const g = setup(['iron/bastion', 'meridian/shade']);
  const e = longEdge(g);
  const C = own(g, e.a, 0, 1, 18);
  const D = own(g, e.b, 0, 1, 0);
  homes(g, [e.a, e.b]);
  const thr = B.levels[1].threshold;
  run(g, 40, () => assert(C.units <= thr, 'production overshot the threshold'));
  assert.strictEqual(C.units, thr);
  // one very long tick still produces only what is missing
  takeSoldiers(C.groups, 7);
  g.produce(500);
  assert.strictEqual(C.units, thr);
  // production resumes as soon as the garrison is below the threshold
  takeSoldiers(C.groups, 5);
  const made = g.stats[0].produced;
  run(g, 40, () => assert(C.units <= thr));
  assert.strictEqual(C.units, thr);
  assert(g.stats[0].produced > made);

  // The required example: 100/100 + 40 reinforcements = 140/100, production paused until below 100.
  const saved = B.levels[1].threshold;
  B.levels[1].threshold = 100;
  try {
    C.groups = [makeGroup('iron', 'bastion', 1, 100)];
    D.groups = [];
    army(g, 0, D.id, C.id, 40, { s: g.dist(D.id, C.id) - ARRIVE - 1 });
    run(g, 1);
    assert.strictEqual(C.units, 140, 'all 40 reinforcements are accepted');
    const acc = C.acc;
    run(g, 30, () => assert.strictEqual(C.units, 140, 'nothing is produced, deleted or clamped above the threshold'));
    assert.strictEqual(C.acc, acc, 'production progress is frozen, not banked');
    takeSoldiers(C.groups, 45);
    assert.strictEqual(C.units, 95);
    run(g, 60, () => assert(C.units <= 100));
    assert.strictEqual(C.units, 100, 'production resumed and stopped again at the threshold');
  } finally { B.levels[1].threshold = saved; }
});

// ============================================================ 4. interception

section('marching interception: continuous, no tunnelling, friendly pass-through', () => noProd(() => {
  const facing = (g, e) => (e.a < e.b ? 1 : -1);

  // head-on
  {
    const g = setup(['iron/bastion', 'iron/bastion']);
    const e = longEdge(g);
    own(g, e.a, 0, 1, 5);
    own(g, e.b, 1, 1, 5);
    const A = army(g, 0, e.a, e.b, 12), Z = army(g, 1, e.b, e.a, 10);
    const sign = facing(g, e);
    let engaged = false, minGap = Infinity, clash = 0;
    run(g, 60, () => {
      for (const ev of g.drain().events) if (ev.k === 'clash') clash++;
      if (!A.groups.length || !Z.groups.length) return false;
      const gap = (g.roadX(Z) - g.roadX(A)) * sign;
      minGap = Math.min(minGap, gap);
      if (A.state === 'engaged') { engaged = true; assert.strictEqual(Z.state, 'engaged'); assert.strictEqual(A.v, 0); }
    });
    assert(engaged, 'the armies never engaged');
    assert(minGap >= R - 1e-3, `armies overlapped or passed through each other (gap ${minGap})`);
    assert.strictEqual(clash, 1, 'one clash notice per encounter');
    assert(A.groups.length > 0 && Z.groups.length === 0, 'the larger army wins the field');
    assert.strictEqual(g.stats[0].encWon, 1);
    assert.strictEqual(g.stats[1].encLost, 1);
    // the survivor carries on to its original destination
    const sAtWin = A.s;
    run(g, 1);
    assert.strictEqual(A.to, e.b);
    assert(A.state === 'march' || A.state === 'siege');
    assert(A.s > sAtWin || A.state === 'siege');
    run(g, 60, () => A.groups.length > 0 && g.nodes[e.b].owner !== 0 && A.state !== 'siege');
    assert(A.state === 'siege' || g.nodes[e.b].owner === 0 || !A.groups.length, 'the survivor reached the city');
  }

  // one enormous step must not let armies jump over each other
  {
    const g = setup(['iron/bastion', 'iron/bastion']);
    const e = longEdge(g);
    own(g, e.a, 0, 1, 5);
    own(g, e.b, 1, 1, 5);
    const A = army(g, 0, e.a, e.b, 12), Z = army(g, 1, e.b, e.a, 10);
    const vA = g.baseSpeed(A), vZ = g.baseSpeed(Z);
    assert((vA + vZ) * 5 > e.L, 'the step is long enough to tunnel if unchecked');
    const tHit = (e.L - R) / (vA + vZ);
    g.move(5);
    eq(A.s, vA * tHit, 'A stops at first contact', 1e-9);
    eq(Z.s, vZ * tHit, 'Z stops at first contact', 1e-9);
    eq(Math.abs(g.roadX(Z) - g.roadX(A)), R, 'they stand at engagement range', 1e-9);
    g.tick(5);
    for (const x of [A, Z]) if (x.groups.length) assert(x.s <= (x === A ? vA : vZ) * tHit + 1e-6, 'a survivor never skipped past the contact point in the same step');
  }

  // a faster army catches a slower hostile one
  {
    const g = setup(['iron/bastion', 'meridian/shade']);
    const e = longEdge(g);
    own(g, e.a, 0, 1, 5);
    homes(g, [e.a, e.b]);
    const slow = army(g, 0, e.a, e.b, 10, { s: 40 }), fast = army(g, 1, e.a, e.b, 10);
    assert(g.baseSpeed(fast) > g.baseSpeed(slow));
    let caught = false;
    run(g, 20, () => {
      if (slow.state === 'engaged' && fast.state === 'engaged') {
        caught = true;
        assert(fast.s <= slow.s - R + 1e-3, 'the pursuer stops behind its quarry');
        assert(slow.s < slow.L - ARRIVE, 'caught on the road, before arriving');
        return false;
      }
    });
    assert(caught, 'the faster army never caught the slower one');
  }

  // friendly armies neither fight nor block each other
  {
    const g = setup(['iron/bastion', 'meridian/shade']);
    const e = longEdge(g);
    own(g, e.a, 0, 1, 5);
    own(g, e.b, 0, 1, 5);
    homes(g, [e.a, e.b]);
    const p = army(g, 0, e.a, e.b, 7), q = army(g, 0, e.b, e.a, 9), r = army(g, 0, e.a, e.b, 3, { tier: 3, s: 0 });
    run(g, 40, () => {
      for (const x of [p, q, r]) assert.notStrictEqual(x.state, 'engaged');
      return g.armies.length > 0;
    });
    assert.strictEqual(g.nodes[e.b].units, 5 + 7 + 3);
    assert.strictEqual(g.nodes[e.a].units, 5 + 9);
    assert.strictEqual(g.stats[0].losses, 0);
  }

  // an engaged army cannot arrive at a city
  {
    const g = setup(['iron/bastion', 'iron/bastion']);
    const e = longEdge(g);
    own(g, e.a, 0, 1, 5);
    const city = own(g, e.b, 1, 1, 5);
    const A = army(g, 0, e.a, e.b, 30, { s: e.L - ARRIVE });        // on the doorstep
    const Z = army(g, 1, e.b, e.a, 30, { s: ARRIVE - (R - 1) });      // a sortie already in contact
    g.tick(DT);
    assert.strictEqual(A.state, 'engaged');
    assert.strictEqual(city.siege.length, 0, 'an army locked in combat does not enter the siege');
    assert(Z.groups.length > 0);
  }

  // simultaneous encounters do not depend on the order armies were created in
  {
    const build = order => {
      const g = setup(['iron/bastion', 'meridian/shade', 'veil/forge'], { seed: 23 });
      const edges = g.edges.map(([a, b]) => ({ a, b, L: g.dist(a, b) })).sort((p, q) => q.L - p.L || p.a - q.a);
      const e = edges[0], f = edges.find(x => ![e.a, e.b].includes(x.a) && ![e.a, e.b].includes(x.b));
      homes(g, [e.a, e.b, f.a, f.b]);
      const specs = [
        () => army(g, 0, e.a, e.b, 14, { s: 60 }),
        () => army(g, 1, e.b, e.a, 12, { s: e.L - 74 }),
        () => army(g, 2, e.a, e.b, 16, { s: 88 }),
        () => army(g, 0, f.a, f.b, 9, { tier: 2 }),
        () => army(g, 1, f.b, f.a, 11),
      ];
      for (const i of order) specs[i]();
      for (let i = 0; i < 80; i++) g.tick(DT);
      return [0, 1, 2].map(pi => total(g, pi)).concat(g.stats.map(s => ({ n: s.losses, hp: s.taken })));
    };
    const x = build([0, 1, 2, 3, 4]), y = build([4, 2, 3, 1, 0]);
    x.forEach((v, i) => { assert.strictEqual(v.n, y[i].n, 'soldier counts differ with creation order'); eq(v.hp, y[i].hp, 'health differs with creation order'); });
  }
}));

// ============================================================ 6. city abilities

section('city abilities: turret and coil, suppression and shield, disruption and conversion', () => noProd(() => {
  const A = B.abilities;
  const scene = (facs, level, owner = 0) => {
    const g = setup(facs);
    const e = longEdge(g);
    const c = own(g, e.b, owner, level, 10);
    homes(g, [e.a, e.b]);
    return { g, e, c, at: (pi, d, n = 20, o = {}) => army(g, pi, e.a, e.b, n, { ...o, s: e.L - d }) };
  };

  // Iron level 2: heavy turret
  {
    const { g, c, at } = scene(['iron/bastion', 'meridian/shade'], 2);
    const near = at(1, 100), friendly = at(0, 90), h0 = hpOf(near.groups), f0 = hpOf(friendly.groups);
    g.runFields(DT);
    eq(h0 - hpOf(near.groups), A.iron.turretDmg, 'turret damage');
    eq(hpOf(friendly.groups), f0, 'never fires on its own side');
    eq(c.cd, A.iron.turretCd);
    const shot = g.drain().events.find(x => x.k === 'shot');
    assert(shot && shot.node === c.id && shot.coil === false && shot.to.length === 1);
    g.runFields(DT);
    eq(h0 - hpOf(near.groups), A.iron.turretDmg, 'no second shot during the cooldown');
    eq(g.stats[0].dealt, A.iron.turretDmg);
  }
  {
    const { g, at } = scene(['iron/bastion', 'meridian/shade'], 2);
    const out = at(1, A.range + 20), h0 = hpOf(out.groups);
    g.runFields(DT);
    eq(hpOf(out.groups), h0, 'out of range');
  }
  // Iron level 3: coil with a capped chain
  {
    const { g, at } = scene(['iron/bastion', 'meridian/shade'], 3);
    const targets = [100, 105, 110, 115].map(d => at(1, d));
    const h0 = targets.map(a => hpOf(a.groups));
    g.runFields(DT);
    const lost = targets.map((a, i) => h0[i] - hpOf(a.groups));
    eq(lost[0], A.iron.coilDmg, 'primary target');
    eq(lost[1], A.iron.coilDmg * A.iron.chainFalloff, 'first chain');
    eq(lost[2], A.iron.coilDmg * A.iron.chainFalloff, 'second chain');
    assert.strictEqual(lost[3], 0, `the chain is capped at ${A.iron.chainTargets} extra targets`);
    assert.strictEqual(g.drain().events.find(x => x.k === 'shot').to.length, 1 + A.iron.chainTargets);
  }

  // Meridian level 2: suppression field
  {
    const { g, c, at } = scene(['meridian/aegis', 'iron/bastion'], 2);
    const foe = at(1, 100), friend = at(0, 100), far = at(1, A.range + 30);
    g.runFields(DT);
    eq(foe.slow, A.meridian.slow);
    eq(friend.slow, 1);
    eq(far.slow, 1);
    const base = g.baseSpeed(foe);
    foe.s = 10; far.s = 10;                       // keep them clear of the hostile sortie test
    g.armies = [foe];
    g.move(DT);
    eq(foe.v, base * A.meridian.slow, 'slowed inside the field');
    // slows never stack: only the strongest applies, and never below the floor
    g.players[0].cd = [0, 0];
    assert(g.skill(0, 1, { node: c.id }).ok, 'a suppression emplacement beside the same city');
    foe.s = g.dist(foe.from, foe.to) - 100;
    g.runFields(DT);
    eq(foe.slow, Math.min(B.skills.meridian[1].slow, A.meridian.slow));
    assert(foe.slow >= B.march.minSlow);
  }
  {
    const { g, at } = scene(['meridian/aegis', 'iron/bastion'], 1);
    const foe = at(1, 100);
    g.runFields(DT);
    eq(foe.slow, 1, 'level-1 cities have no ability');
  }
  // Meridian level 3: defence network (field + periodic shield)
  {
    const { g, c, at } = scene(['meridian/aegis', 'iron/bastion'], 3);
    g.runFields(DT);
    assert.strictEqual(c.shield, null, 'held ready until a threat is in range');
    const foe = at(1, 100);
    g.runFields(DT);
    eq(foe.slow, A.meridian.slow, 'still suppresses');
    assert(c.shield && close(c.shield.hp, A.meridian.shieldHp) && close(c.shield.until, g.t + A.meridian.shieldDur));
    eq(c.cd, A.meridian.shieldCd);
    c.shield.hp = 5; c.cd = 0;
    g.runFields(DT);
    eq(c.shield.hp, A.meridian.shieldHp, 'refreshed, not stacked');
  }

  // Veil level 2: disruption
  {
    const { g, c, at } = scene(['veil/forge', 'iron/bastion'], 2);
    const foe = at(1, 100), friend = at(0, 100);
    g.runFields(DT);
    eq(foe.weak, A.veil.weaken);
    eq(friend.weak, 1);
    g.players[0].cd = [0, 0];
    assert(g.skill(0, 0, { node: c.id }).ok, 'a psychic guard beside the same city');
    g.runFields(DT);
    eq(foe.weak, Math.min(B.skills.veil[0].weaken, A.veil.weaken), 'weakening does not stack');
    // weakened armies really do less damage
    const dmg = weak => {
      const a = makeGroup('iron', 'bastion', 1, 10), b = makeGroup('veil', 'forge', 1, 10);
      fight([{ owner: 0, groups: [a], atkMult: weak }, { owner: 1, groups: [b] }], DT);
      return 10 * unitStats('veil', 'forge', 1).hp - b.hp;
    };
    eq(dmg(A.veil.weaken) / dmg(1), A.veil.weaken);
  }
  // Veil level 3: conversion, capped and with survivors
  {
    for (const [sub, n, want] of [['forge', 20, Math.min(A.veil.convertCap, Math.floor(20 * A.veil.convertPct))], ['forge', 80, A.veil.convertCap], ['dominion', 80, A.veil.convertCap + 1]]) {
      const { g, c, at } = scene([`veil/${sub}`, 'iron/bastion'], 3);
      const foe = at(1, 100, n);
      g.runFields(DT);
      const mine = g.armies.find(a => a.owner === 0);
      assert(mine, 'a converted contingent appears');
      assert.strictEqual(mine.n, want, `${sub}: converts ${want} of ${n}`);
      assert.strictEqual(foe.n, n - want);
      assert.strictEqual(mine.to, c.id, 'it marches for the city that turned it');
      eq(mine.L - mine.s, 100, 'from where it stood', 1e-9);
      eq(foe.weak, A.veil.weaken, 'disruption is retained');
      eq(c.cd, A.veil.convertCd);
      assert(g.drain().events.some(x => x.k === 'conv' && x.by === 0 && x.from === 1 && x.n === want));
      c.cd = 0;
      g.armies = [mine];                         // only already-converted troops in range
      g.runFields(DT);
      assert.strictEqual(g.armies.length, 1, 'no conversion chain reaction');
    }
    const { g, c, at } = scene(['veil/forge', 'iron/bastion'], 3);
    const tiny = at(1, 100, 3);
    g.runFields(DT);
    assert.strictEqual(tiny.n, 3, 'too small to convert from');
    assert.strictEqual(c.cd, 0, 'the ability stays ready');
    assert.strictEqual(g.convertible(at(1, 90, 10), 0.9, 99, 2), 8, 'minimum survivors are always left');
    assert.strictEqual(g.convertible(at(1, 80, 10), 0.9, 3, 2), 3, 'cap');
  }

  // Abilities follow the owner: a captured level-3 city uses the captor's faction
  {
    const { g, e, c, at } = scene(['iron/bastion', 'meridian/aegis'], 3);
    c.groups = [];
    const taker = army(g, 1, e.a, e.b, 12, { s: e.L - ARRIVE });
    taker.state = 'siege';
    c.siege.push(taker);
    g.cityBattles(DT);
    assert.strictEqual(c.owner, 1, 'captured');
    assert.strictEqual(c.units, 12);
    assert.strictEqual(c.level, 3);
    assert.strictEqual(g.stats[1].captured, 1);
    assert.strictEqual(g.stats[0].lost, 1);
    assert.strictEqual(g.stats[1].level3, 1);
    g.drain();
    const foe = at(0, 100);
    g.runFields(DT);
    const ev = g.drain().events;
    assert(!ev.some(x => x.k === 'shot'), 'the Iron coil no longer fires');
    eq(foe.slow, A.meridian.slow, 'it is a Meridian suppression field now');
    assert(c.shield && ev.some(x => x.k === 'shield'));
  }
}));

// ============================================================ 9. crates

section('crates: optional, on roads, collected exactly once, rewards as configured', () => noProd(() => {
  const K = B.crates;
  // disabled rooms never see one
  {
    const g = new Game([{ ai: 'hard', faction: 'iron' }, { ai: 'hard', faction: 'veil' }], 9, { crates: false });
    let seen = 0;
    for (let i = 0; i < 4000 && g.winner === null; i++) {
      g.tick(DT);
      seen += g.drain().events.filter(x => x.k === 'crate' || x.k === 'pick').length + g.crates.length;
    }
    assert.strictEqual(seen, 0);
    assert(g.stats.every(s => s.crates === 0));
  }
  // enabled: they spawn on roads, away from city interiors
  {
    const g = setup(['iron/bastion', 'meridian/shade'], { crates: true });
    homes(g);
    let spawned = 0;
    run(g, 120, () => { spawned += g.drain().events.filter(x => x.k === 'crate').length; assert(g.crates.length <= K.maxActive); });
    assert(spawned >= 2, 'crates spawn over time');
    for (const cr of g.crates) {
      assert(g.adj[cr.lo].has(cr.hi), 'on a road');
      const L = g.dist(cr.lo, cr.hi);
      assert(cr.x > B.nodeR + 10 && cr.x < L - B.nodeR - 10, 'not inside a city');
      const A = g.nodes[cr.lo], Z = g.nodes[cr.hi];
      eq(cr.px, Math.round(A.x + (Z.x - A.x) * cr.x / L), 'drawn where it is', 1e-2);
      assert(K.rewards[cr.reward]);
    }
  }

  const place = (g, e, reward, frac = 0.5) => {
    const lo = Math.min(e.a, e.b), hi = Math.max(e.a, e.b);
    const cr = { id: g.nextId++, lo, hi, x: e.L * frac, px: 0, py: 0, reward, until: 1e9 };
    g.crates.push(cr);
    return cr;
  };

  // contested in the same tick: exactly one winner, chosen deterministically
  for (const firstOwner of [0, 1]) {
    const g = setup(['iron/bastion', 'iron/bastion']);
    const e = longEdge(g);
    homes(g, [e.a, e.b]);
    const cr = place(g, e, 'cache');
    const d = K.pickupRadius + 1;
    const mk = pi => (pi === 0 ? army(g, 0, e.a, e.b, 10, { s: e.L / 2 - d }) : army(g, 1, e.b, e.a, 10, { s: e.L / 2 - d }));
    const first = mk(firstOwner), second = mk(1 - firstOwner);
    g.tick(DT);
    const picks = g.drain().events.filter(x => x.k === 'pick');
    assert.strictEqual(picks.length, 1, 'collected exactly once');
    assert.strictEqual(picks[0].by, firstOwner, 'equal arrival: the lower army id wins');
    assert.strictEqual(first.n, 10 + K.rewards.cache.soldiers);
    assert.strictEqual(second.n, 10);
    assert.strictEqual(g.crates.length, 0);
    assert.strictEqual(g.stats[0].crates + g.stats[1].crates, 1);
    g.collect(cr.id, second);
    assert.strictEqual(second.n, 10, 'a collected crate cannot be collected again');
  }
  // the army that gets there first wins regardless of ids
  {
    const g = setup(['iron/bastion', 'iron/bastion']);
    const e = longEdge(g);
    homes(g, [e.a, e.b]);
    place(g, e, 'weapons');
    const lateButLowId = army(g, 0, e.a, e.b, 10, { s: e.L / 2 - K.pickupRadius - 2.5 });
    const closer = army(g, 1, e.b, e.a, 10, { s: e.L / 2 - K.pickupRadius - 0.5 });
    g.tick(DT);
    assert(closer.buff.atk > g.t && lateButLowId.buff.atk === 0);
  }

  // each reward
  {
    const g = setup(['iron/bastion', 'meridian/shade']);
    const e = longEdge(g);
    const city = own(g, e.a, 0, 1, 0);
    homes(g, [e.a, e.b]);
    const a = army(g, 0, e.a, e.b, 10, { s: 60 });
    const p = g.players[0];
    const give = reward => { g.collect(place(g, e, reward).id, a); return g.drain().events.find(x => x.k === 'pick'); };

    assert.strictEqual(give('cache').reward, 'cache');
    assert.strictEqual(a.n, 10 + K.rewards.cache.soldiers);
    assert(a.groups.every(x => x.t === 1 && x.f === 'iron'), 'level-1 troops of the collector');
    assert.strictEqual(g.stats[0].granted, K.rewards.cache.soldiers);

    give('rapid');
    eq(a.buff.speed, g.t + K.rewards.rapid.dur);
    const base = g.baseSpeed(a);
    g.armies = [a];
    g.move(DT);
    eq(a.v, base * K.rewards.rapid.speedMult);
    g.t += 5;
    give('rapid');
    eq(a.buff.speed, g.t + K.rewards.rapid.dur, 'a second pickup refreshes the timer, it does not stack');
    g.move(DT);
    eq(a.v, base * K.rewards.rapid.speedMult);

    give('armor');
    eq(a.buff.armor, g.t + K.rewards.armor.dur);
    give('weapons');
    eq(a.buff.atk, g.t + K.rewards.weapons.dur);
    // the buffs are real: check them through a field battle step
    const foe = army(g, 1, e.b, e.a, 10, { s: a.L - a.s - R + 1 });
    g.armies = [a, foe];
    const hA = hpOf(a.groups), hF = hpOf(foe.groups);
    g.fieldBattles(DT);
    const plain = (() => {
      const x = [makeGroup('iron', 'bastion', 1, a.n)], y = [makeGroup('meridian', 'shade', 1, 10)];
      fight([{ owner: 0, groups: x }, { owner: 1, groups: y }], DT);
      return { toFoe: 10 * unitStats('meridian', 'shade', 1).hp - hpOf(y), toA: a.n * unitStats('iron', 'bastion', 1).hp - hpOf(x) };
    })();
    eq(hF - hpOf(foe.groups), plain.toFoe * K.rewards.weapons.atk, 'overcharged weapons');
    eq(hA - hpOf(a.groups), plain.toA * K.rewards.armor.taken, 'reactive armor');
    g.armies = [a];

    // field repairs heal the wounded, capped, and never raise the head count
    const s = unitStats('iron', 'bastion', 1);
    a.groups = [{ f: 'iron', sub: 'bastion', t: 1, n: 10, hp: 10 * s.hp - 200, cv: false }];
    give('repairs');
    eq(hpOf(a.groups), 10 * s.hp - 200 + Math.min(K.rewards.repairs.cap, 200 * K.rewards.repairs.pct));
    assert.strictEqual(a.n, 10, 'no resurrection');
    a.groups = [makeGroup('iron', 'bastion', 1, 10)];
    give('repairs');
    eq(hpOf(a.groups), 10 * s.hp, 'nothing to heal at full health');
    a.groups = [{ f: 'iron', sub: 'bastion', t: 1, n: 50, hp: 50 * s.hp * 0.2, cv: false }];
    give('repairs');
    eq(hpOf(a.groups), 50 * s.hp * 0.2 + K.rewards.repairs.cap, 'healing is capped');

    give('surge');
    eq(p.surgeUntil, g.t + K.rewards.surge.dur);
    const made = g.stats[0].produced;
    B.levels[1].prod = 1;
    g.produce(10);
    B.levels[1].prod = 0;
    assert.strictEqual(g.stats[0].produced - made, Math.floor(10 * B.factions.iron.prod * K.rewards.surge.prodMult + 1e-9), 'production surge');
    assert(city.units <= B.levels[1].threshold);

    p.cd = [30, 4];
    p.charge = 17;
    give('recharge');
    assert.deepStrictEqual(p.cd, [30 - K.rewards.recharge.seconds, 0], 'basic cooldowns only, never below zero');
    assert.strictEqual(p.charge, 17, 'the superweapon is never affected');

    assert.strictEqual(g.stats[0].crates, 10);
    assert.strictEqual(g.stats[0].rewards.repairs, 3);
    assert.strictEqual(Object.values(g.stats[0].rewards).reduce((x, y) => x + y, 0), 10);
  }
}));

// ============================================================ 10. statistics

section('statistics: recorded from events, effective damage only, exact troop accounting', () => {
  // a scripted field battle between two players
  noProd(() => {
    const g = setup(['iron/bastion', 'meridian/shade']);
    const e = longEdge(g);
    homes(g, [e.a, e.b]);
    const A = army(g, 0, e.a, e.b, 14, { s: 40 }), Z = army(g, 1, e.b, e.a, 9, { s: 40 });
    const hpA = hpOf(A.groups), hpZ = hpOf(Z.groups);
    run(g, 60, () => A.groups.length > 0 && Z.groups.length > 0);
    const [s0, s1] = g.stats;
    assert(A.groups.length > 0 && Z.groups.length === 0);
    eq(s0.dealt, s1.taken);
    eq(s1.dealt, s0.taken);
    eq(s1.taken, hpZ, 'damage to a wiped-out army equals its health: overkill is not counted');
    eq(s0.taken, hpA - hpOf(A.groups));
    assert.strictEqual(s1.losses, 9);
    assert.strictEqual(s0.losses, 14 - A.n);
    eq(s0.kills, 9);
    eq(s1.kills, s0.losses);
    assert.deepStrictEqual([s0.encWon, s0.encLost, s1.encWon, s1.encLost], [1, 0, 0, 1]);
    assert.deepStrictEqual([s0.produced, s0.granted, s0.converted, s0.captured], [0, 0, 0, 0]);
    const rep = g.report();
    assert.strictEqual(rep[0].kills, 9);
    assert(rep[0].faction === 'iron' && rep[0].sub === 'bastion' && rep[1].faction === 'meridian');
  });

  // full AI matches: every soldier is accounted for, every capture is counted once
  for (const [facs, seed, crates] of [[['iron', 'meridian', 'veil'], 5, true], [['veil', 'iron', 'meridian', 'iron'], 8, false]]) {
    const g = new Game(facs.map(faction => ({ ai: 'hard', faction })), seed, { crates });
    const spent = facs.map(() => 0), caps = facs.map(() => 0), losts = facs.map(() => 0), picks = facs.map(() => 0);
    let l3 = 0, ticks = 0;
    const neutral0 = g.nodes.filter(c => c.owner < 0).reduce((s, c) => s + c.units, 0);
    while (g.winner === null && g.t < 3000) {
      g.tick(DT);
      ticks++;
      for (const ev of g.drain().events) {
        if (ev.k === 'up') {
          const c = g.nodes[ev.node];
          spent[c.owner] += B.levels[c.level - 1].upCost;
          if (c.level === 3) l3++;
        } else if (ev.k === 'cap') {
          if (!ev.mind) caps[ev.by]++;            // a mind-controlled base is counted as converted, not captured
          if (ev.from >= 0) losts[ev.from]++;
          if (g.nodes[ev.node].level === 3) l3++;
        } else if (ev.k === 'pick') picks[ev.by]++;
        else if (ev.k === 'rebuild') spent[ev.p] += B.ruin.cost;
        else if (ev.k === 'ruin') { if (ev.from >= 0) losts[ev.from]++; }
      }
      if (ticks % 7) continue;
      for (let p = 0; p < g.np; p++) {
        if (!g.alive[p]) continue;
        const s = g.stats[p];
        const want = B.startUnits + s.produced + s.granted + s.converted - s.lostToConversion - s.losses - spent[p];
        assert.strictEqual(total(g, p).n, want, `player ${p} soldier accounting at t=${g.t.toFixed(2)}`);
      }
      for (const c of g.nodes) for (const x of c.groups) assert(x.n > 0 && x.hp > 0 && x.hp <= x.n * unitStats(x.f, x.sub, x.t).hp + 1e-6, 'bad garrison group');
      for (const a of g.armies) for (const x of a.groups) assert(x.n > 0 && x.hp > 0 && x.hp <= x.n * unitStats(x.f, x.sub, x.t).hp + 1e-6, 'bad army group');
    }
    assert.notStrictEqual(g.winner, null, 'the match finished');
    const rep = g.report();
    rep.forEach((r, p) => {
      assert.strictEqual(r.captured, caps[p], 'captures match capture events');
      assert.strictEqual(r.lost, losts[p], 'losses of cities match capture events');
      assert.strictEqual(r.crates, picks[p], 'crates match pickup events');
      assert.strictEqual(Object.values(r.rewards).reduce((x, y) => x + y, 0), r.crates);
      assert(r.peak >= 1 && r.dealt >= 0 && r.taken >= 0 && Number.isFinite(r.dealt));
      assert.strictEqual(r.duration, Math.round(g.t));
      assert.strictEqual(r.winner, p === g.winner);
    });
    assert.strictEqual(rep.reduce((s, r) => s + r.level3, 0), l3, 'level-3 cities achieved');
    const kills = g.stats.reduce((s, x) => s + x.kills, 0), losses = g.stats.reduce((s, x) => s + x.losses, 0);
    assert(kills <= losses + neutral0 + 1e-6, 'kills cannot exceed soldiers that actually died');
    assert(kills >= 0 && losses > 0);
    if (!crates) assert(rep.every(r => r.crates === 0));
  }
});

// ============================================================ 11. determinism and termination

section('determinism and termination across factions, player counts and crate settings', () => {
  const play = (facs, seed, crates, level = 'hard') => {
    const g = new Game(facs.map((f, i) => { const [faction, sub] = f.split('/'); return { ai: Array.isArray(level) ? level[i] : level, faction, sub }; }), seed, { crates });
    while (g.winner === null && g.t < 3600) g.tick(DT);
    return g;
  };
  const a = play(['iron/volt', 'meridian/aegis', 'veil/dominion'], 77, true), b = play(['iron/volt', 'meridian/aegis', 'veil/dominion'], 77, true);
  assert.strictEqual(JSON.stringify(a.report()), JSON.stringify(b.report()), 'same seed, same match');
  assert.strictEqual(a.t, b.t);
  const c = play(['iron/volt', 'meridian/aegis', 'veil/dominion'], 78, true);
  assert.notStrictEqual(JSON.stringify(a.report()), JSON.stringify(c.report()), 'different seed, different match');

  const setups = [
    [['iron', 'meridian'], false], [['meridian', 'veil'], true], [['veil', 'iron'], false], [['iron', 'iron'], true],
    [['iron', 'meridian', 'veil'], false], [['veil/forge', 'meridian/shade', 'iron/bastion'], true],
    [['iron', 'meridian', 'veil', 'iron'], true], [['meridian', 'veil', 'iron', 'veil', 'meridian'], false],
    [['iron', 'meridian', 'veil', 'iron/volt', 'meridian/aegis', 'veil/forge'], true],
  ];
  let unfinished = 0, n = 0;
  setups.forEach(([facs, crates], i) => {
    for (let s = 0; s < 2; s++) {
      const g = play(facs, 300 + i * 17 + s, crates, s ? 'normal' : 'hard');
      n++;
      if (g.winner === null) unfinished++;
    }
  });
  if (unfinished) console.log(`    note: ${unfinished} of ${n} AI-only matches reached the 60-minute limit without a winner`);
  // Evenly matched bots can trade cities indefinitely; tolerate the odd stalemate, fail if it is common.
  assert(unfinished <= 2, `${unfinished} of ${n} matches did not finish`);
});

console.log('simulation tests passed');
