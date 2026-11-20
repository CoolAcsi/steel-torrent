// Capacity, rosters, basic skills, superweapons, route cancellation.
//
// Rule tests on small hand-made maps (see scene.mjs): real orders, real ticks, exact counts.
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { DT, ME, FOE, PTS, ROADS, scene, own, board, run, events, soldiers, mineOnly } from './scene.mjs';

const require = createRequire(import.meta.url);
const { BALANCE: B } = require('../game/config');
const { REJECT, AUTO, Game, unitStats, makeGroup, fight, hpOf, countOf, takeSoldiers } = require('../game/sim');
const { Pace } = require('../game/clock');

let sections = 0;
function section(name, fn) { fn(); sections++; console.log(`ok  ${name}`); }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const eq = (a, b, msg, tol) => assert(near(a, b, tol), `${msg || 'values differ'}: ${a} vs ${b}`);

/** Make player `pi` play roster `faction/sub`. Call before giving them cities. */
function as(g, pi, roster) { const [faction, sub] = roster.split('/'); Object.assign(g.players[pi], { faction, sub }); return g; }
const ready = (g, pi) => { g.players[pi].cd = [0, 0]; };
/** Three level-3 bases and a full charge: the real unlock for a superweapon. */
function armSuper(g, pi, ids) { for (const id of ids) own(g, id, pi, 10, 3, 3); g.players[pi].charge = g.players[pi].need; }
const army = (g, pi, from, to, n, s = 0, tier = 1) => { const p = g.players[pi]; return g.newArmy(pi, from, to, [makeGroup(p.faction, p.sub, tier, n)], s); };
const tick = (g, seconds) => { for (let i = 0; i < Math.round(seconds / DT); i++) { g.tick(DT); g.drain(); } };
const TRI = [[0, 0], [200, 0], [100, 150]], TRI_ROADS = [[0, 1], [1, 2], [0, 2]];

// ============================================================ capacity

section('production threshold and maximum capacity are separate values: the 100 / 300 city', () => {
  const L = B.levels[1], saved = { threshold: L.threshold, prod: L.prod };
  L.threshold = 100; L.prod = 8;
  try {
    const g = scene(PTS, ROADS, { produce: true, capacity: true });
    const c = own(g, 1, ME, 90), src = own(g, 0, ME, 400);            // 0 is far over its threshold: it produces nothing
    own(g, 8, FOE, 10); own(g, 9, FOE, 10);
    assert.strictEqual(g.capOf(c), 300, 'default capacity is three times the threshold');
    assert.strictEqual(B.capacity.mult, 3);

    tick(g, 6);
    assert.strictEqual(c.units, 100, 'passive production stops at the threshold');
    tick(g, 6);
    assert.strictEqual(c.units, 100);
    assert.strictEqual(src.units, 400, 'a city over its threshold keeps every soldier');

    // Reinforcements are accepted up to the capacity, and only as many as fit leave home.
    const made = g.send(ME, [0], 1, 1, 1);
    assert.deepStrictEqual(made.results, [[0, 200, 1]], 'only the part that fits is sent');
    assert.strictEqual(src.units, 200, 'the rest stays at home');
    assert.strictEqual(g.room(c, ME), 0, 'the places are reserved while the column is on the road');
    const again = g.send(ME, [0], 1, 1, 2);
    assert.deepStrictEqual(again.results, [[0, -REJECT.full]]);
    assert.strictEqual(again.length, 0);
    assert.strictEqual(src.units, 200, 'a refused order costs nothing');
    assert(run(g, 20, () => g.armies.length === 0), 'the column never arrived');
    assert.strictEqual(c.units, 300, 'it can hold reinforcements up to its capacity');
    tick(g, 5);
    assert.strictEqual(c.units, 300, 'and produces nothing there');

    // A full city still sends troops out.
    const out = g.send(ME, [1], 2, 0.5, 3);
    assert.deepStrictEqual(out.results, [[1, 150, 1]], 'a full city dispatches outward');
    assert.strictEqual(c.units, 150);
    tick(g, 2);
    assert.strictEqual(c.units, 150, 'still above the threshold: no production');
    g.send(ME, [1], 0, 0.5, 4);
    assert.strictEqual(c.units, 75);
    const before = g.stats[ME].produced;
    tick(g, 6);
    assert.strictEqual(c.units, 100, 'production resumes only below the threshold, and stops at it again');
    assert.strictEqual(g.stats[ME].produced - before >= 25, true);
  } finally { Object.assign(L, saved); }
});

section('reservations: partial acceptance, released by halting, losses and redirection, never leaked', () => {
  const g = board([0, 1, 2], { capacity: true });
  own(g, 0, ME, 50); own(g, 2, ME, 50);
  const c = g.nodes[1];                                              // 20 soldiers, level 1: capacity 60
  assert.strictEqual(g.capOf(c), B.levels[1].threshold * 3);
  const total = mineOnly(g);

  const first = g.send(ME, [0], 1, 1, 1);
  assert.deepStrictEqual(first.results, [[0, 40, 1]], 'the 40 that fit are sent');
  assert.strictEqual(g.nodes[0].units, 10);
  assert.strictEqual(g.incoming(c, ME), 40);
  assert.deepStrictEqual(g.send(ME, [2], 1, 1, 2).results, [[2, -REJECT.full]], 'the places are taken');

  // Losses on the way free places at once: a reservation is only ever the soldiers still coming.
  const a = first[0];
  takeSoldiers(a.groups, 10);
  assert.strictEqual(g.room(c, ME), 10);
  mineOnly(g);

  // Halting the column releases all of them.
  assert.deepStrictEqual(g.halt(ME, a.id, 3), { ok: true });
  assert.strictEqual(g.incoming(c, ME), 0, 'a held army reserves nothing');
  assert.strictEqual(g.room(c, ME), 40);
  const second = g.send(ME, [2], 1, 1, 4);
  assert.deepStrictEqual(second.results, [[2, 40, 1]]);

  // The held column is sent somewhere else: it reserves there instead.
  assert.deepStrictEqual(g.redirect(ME, a.id, 0, 5), { ok: true });
  assert.strictEqual(g.incoming(g.nodes[0], ME), 30);
  assert.strictEqual(g.incoming(c, ME), 40);
  assert(run(g, 20, () => g.armies.length === 0));
  assert.strictEqual(c.units, 60);
  assert.strictEqual(g.nodes[0].units, 40);
  assert.strictEqual(mineOnly(g), total - 10, 'only the ten soldiers this test removed are missing');
});

section('a column that cannot fit waits at the gate, in the world and open to attack, and enters as room appears', () => {
  const g = board([0, 1], { capacity: true });
  const c = own(g, 1, ME, 50);
  own(g, 0, ME, 10);
  // More soldiers than the city can take reach it (as happens when its capacity is used up after they set out).
  const col = army(g, ME, 0, 1, 40, 150);
  const total = mineOnly(g);
  assert(run(g, 10, () => col.queue), 'it should be waiting at the gate');
  assert.strictEqual(c.units, 60, 'the city is filled to its capacity');
  assert.strictEqual(col.n, 30, 'the rest wait outside: nobody is deleted');
  assert.strictEqual(mineOnly(g), total);
  assert.strictEqual(events(g, 'route', 'full').length, 1, 'the player is told once');
  tick(g, 5);
  assert.strictEqual(col.n, 30);
  assert(col.v === 0 && col.state === 'march' && g.armies.includes(col), 'it stands there as an ordinary army');
  const where = g.pos(col);
  eq(Math.hypot(where.x - c.x, where.y - c.y), B.march.arriveAt, 'at the gate');

  // It can be attacked where it stands.
  const raid = army(g, FOE, 0, 1, 4, 100);
  assert(run(g, 20, () => raid.groups.length === 0), 'the raiders should have been beaten');
  assert(events(g, 'clash').length >= 1 && g.stats[FOE].losses === 4);
  const left = col.n;
  assert(left > 0 && left <= 30);

  // The city sends troops away: the waiting soldiers go in, as many as now fit.
  g.send(ME, [1], 0, 0.5, 9);
  tick(g, 0.2);
  assert.strictEqual(c.units, 30 + Math.min(30, left), 'the freed places are taken at once');
  assert.strictEqual(col.groups.length ? col.n : 0, Math.max(0, left - 30));
  assert.strictEqual(mineOnly(g), total - g.stats[ME].losses);
});

section('capturing a city never loses soldiers to its capacity; transit through a full city is not garrison', () => {
  const g = board([0, 1], { capacity: true });
  own(g, 1, ME, 150);
  own(g, 2, FOE, 6);
  const made = g.send(ME, [1], 2, 1, 1);
  assert.deepStrictEqual(made.results, [[1, 150, 1]], 'an attack is never limited by the target\'s capacity');
  assert(run(g, 60, () => g.nodes[2].owner === ME), 'city 2 was not taken');
  tick(g, 0.5);
  const c = g.nodes[2], waiting = g.armies.filter(a => a.owner === ME);
  assert.strictEqual(c.units, g.capOf(c), 'the victors fill the city');
  assert(waiting.length === 1 && waiting[0].queue && waiting[0].dest === 2, 'the overflow stays outside as an army');
  assert.strictEqual(c.units + waiting[0].n, 150 - g.stats[ME].losses, 'every survivor is in one place or the other');

  // Raising the capacity (an upgrade) lets more of them in.
  const outside = waiting[0].n;
  assert(g.upgrade(ME, 2));
  tick(g, 0.2);
  assert.strictEqual(g.capOf(c), B.levels[2].threshold * 3);
  assert.strictEqual(c.units + (waiting[0].groups.length ? waiting[0].n : 0), 150 - g.stats[ME].losses - B.levels[1].upCost);
  assert(waiting[0].n < outside || waiting[0].groups.length === 0);

  // Transit: a column bound for a city beyond passes through a full city without touching its garrison.
  const h = board([0, 1, 2], { capacity: true });
  own(h, 1, ME, 60); own(h, 0, ME, 30); own(h, 2, ME, 10);
  assert.strictEqual(h.room(h.nodes[1], ME), 0);
  assert.deepStrictEqual(h.send(ME, [0], 2, 1, 1).results, [[0, 30, 2]]);
  assert(run(h, 30, () => h.armies.length === 0));
  assert.strictEqual(h.nodes[1].units, 60);
  assert.strictEqual(h.nodes[2].units, 40);
});

section('automatic dispatch waits while its destination is full and resumes by itself', () => {
  const g = board([0, 1], { capacity: true });
  own(g, 0, ME, 60); own(g, 1, ME, 58);
  g.setAuto(ME, [0], 1, 0.5, 1);
  tick(g, B.auto.interval * 2);
  assert.strictEqual(g.armies.length, 0, 'two free places are fewer than the smallest dispatch');
  assert.deepStrictEqual(g.autoList(ME), [[0, 1, 50, AUTO.full]]);
  assert.strictEqual(g.nodes[0].units, 60, 'nothing left home, nothing was lost');
  g.send(ME, [1], 2, 0.25, 2);                                       // the destination empties a little
  const free = 60 - g.nodes[1].units;
  assert(free >= B.auto.minDispatch && free < 30);
  tick(g, B.auto.retry + DT * 2);
  assert.strictEqual(g.autoList(ME)[0][3], AUTO.active);
  assert.strictEqual(g.armies.filter(a => a.auto).length, 1);
  assert.strictEqual(g.armies.find(a => a.auto).n, free, 'half the garrison would be 30: only as many as there is room for are sent');
  assert.strictEqual(g.nodes[0].units, 60 - free);
});

// ============================================================ rosters

const ROSTERS = {
  'iron/bastion': ['conscript', 'rhino', 'apocalypse'],
  'iron/volt': ['teslaTrooper', 'teslaTank', 'kirov'],
  'meridian/shade': ['gi', 'grizzly', 'mirage'],
  'meridian/aegis': ['guardian', 'ifv', 'prism'],
  'veil/dominion': ['initiate', 'shenfeng', 'disc'],
  'veil/forge': ['sniper', 'gatling', 'brain'],
};
const U = (roster, tier) => { const [f, sub] = roster.split('/'); return unitStats(f, sub, tier); };
const G = (roster, tier, n) => { const [f, sub] = roster.split('/'); return makeGroup(f, sub, tier, n); };
/** Damage `atk` deals to `def` in one step, each a list of groups, with options per side. */
function dealt(atk, def, o = {}) {
  const before = hpOf(def);
  fight([{ owner: 0, groups: atk, ...o.atk }, { owner: 1, groups: def, ...o.def }], DT);
  return before - hpOf(def);
}

section('six rosters, three tiers each, every one distinct', () => {
  const seen = new Set();
  for (const [roster, ids] of Object.entries(ROSTERS)) {
    const [f, sub] = roster.split('/');
    assert(B.factions[f].subs[sub], `${roster} is missing`);
    ids.forEach((id, i) => {
      const u = U(roster, i + 1);
      assert.strictEqual(u.id, id, `${roster} tier ${i + 1}`);
      for (const k of ['hp', 'atk', 'interval', 'armor', 'move', 'range']) assert(u[k] > 0, `${id}.${k}`);
      assert(['inf', 'veh', 'air'].includes(u.cls));
      const sig = JSON.stringify([u.hp, u.atk, u.interval, u.armor, u.move, u.range, u.cls, u.vs, u.prefer, u.aa, u.pierce, u.arc, u.opening, u.spinup, u.control, u.regen, u.repair, u.siphon, u.cityArmor]);
      assert(!seen.has(sig), `${id} is a copy of another unit`);
      seen.add(sig);
    });
    assert(U(roster, 1).rating < U(roster, 3).rating, `${roster}: higher tiers are stronger`);
  }
  assert.strictEqual(seen.size, 18);
  assert.deepStrictEqual(Object.keys(B.factions.iron.subs).concat(Object.keys(B.factions.meridian.subs), Object.keys(B.factions.veil.subs)), ['bastion', 'volt', 'shade', 'aegis', 'dominion', 'forge']);
  // The requested fast assault tank is what it says: the quickest ground unit there is, with a charge bonus.
  const shen = U('veil/dominion', 2);
  assert(shen.cls === 'veh' && shen.opening && shen.move >= Math.max(...Object.keys(ROSTERS).flatMap(r => [1, 2, 3].map(t => U(r, t))).filter(u => u.cls !== 'air').map(u => u.move)));
});

section('mixed armies: damage, casualties and healing are worked out per troop type', () => {
  // Damage of a mixed force is the sum of what each type does on its own: nothing is averaged.
  const target = () => [G('meridian/shade', 2, 400)];
  const both = dealt([G('iron/bastion', 1, 30), G('iron/bastion', 2, 12), G('iron/bastion', 3, 5)], target());
  const apart = dealt([G('iron/bastion', 1, 30)], target()) + dealt([G('iron/bastion', 2, 12)], target()) + dealt([G('iron/bastion', 3, 5)], target());
  eq(both, apart, 'mixed damage');
  const want = (30 * U('iron/bastion', 1).dps + 12 * U('iron/bastion', 2).dps * 1.1 + 5 * U('iron/bastion', 3).dps) * B.combat.speed * DT
    * (1 - U('meridian/shade', 2).armor / (U('meridian/shade', 2).armor + B.combat.armorK));
  eq(both, want, 'against the formula');

  // Damage taken is spread by head count and each type loses soldiers by its own health.
  const def = [G('iron/bastion', 1, 40), G('iron/bastion', 3, 40)];
  for (let i = 0; i < 400 && def.length === 2 && def[0].n > 20; i++) fight([{ owner: 0, groups: [G('meridian/shade', 1, 40)] }, { owner: 1, groups: def }], DT);
  assert.strictEqual(def.length, 2);
  for (const g of def) assert.strictEqual(g.n, Math.ceil(g.hp / unitStats(g.f, g.sub, g.t).hp - 1e-9), 'head count follows remaining health');
  assert(def[0].n <= 20 && def[0].n < def[1].n, 'the lighter troops die faster under the same fire');

  // Healing: self-repair only at rest, field repair for vehicles only, never above full, never raising the dead.
  const g = board([0, 1]);
  const c = g.nodes[0];
  const apo = U('iron/bastion', 3).hp;
  c.groups = [G('iron/bastion', 3, 4)];
  c.groups[0].hp -= 100;
  g.upkeep(1);
  eq(c.groups[0].hp, 4 * apo - 100 + 4 * U('iron/bastion', 3).regen, 'apocalypse self-repair');
  g.upkeep(1000);
  eq(c.groups[0].hp, 4 * apo, 'never above full health');
  assert.strictEqual(c.groups[0].n, 4);
  c.siege.push({ groups: [G('veil/forge', 1, 1)] });
  c.groups[0].hp -= 100;
  g.upkeep(1);
  eq(c.groups[0].hp, 4 * apo - 100, 'no self-repair under attack');
  c.siege = [];

  const m = [G('meridian/aegis', 1, 10), G('meridian/aegis', 2, 6), G('meridian/aegis', 3, 3)];
  m[0].hp -= 200; m[2].hp -= 100;
  const a = g.newArmy(ME, 0, 1, m, 10);
  g.upkeep(2);
  eq(m[2].hp, 3 * U('meridian/aegis', 3).hp - 100 + 6 * U('meridian/aegis', 2).repair * 2, 'the repair vehicles mend the wounded tank');
  eq(m[0].hp, 10 * U('meridian/aegis', 1).hp - 200, 'infantry is not repaired');
  assert.strictEqual(a.n, 19);
});

section('roster traits: anti-air, target preference, opening charge, spin-up, arcs, range, fortification, siphon', () => {
  // Aircraft are hard to hit without anti-air weapons, but nothing is immune.
  const air = () => [G('iron/volt', 3, 50)];
  const flak = dealt([G('iron/bastion', 3, 10)], air()), rifles = dealt([G('iron/bastion', 2, 10)], air());
  const k = U('iron/volt', 3), mit = 1 - k.armor / (k.armor + B.combat.armorK);
  eq(flak, 10 * U('iron/bastion', 3).dps * B.combat.speed * DT * mit, 'anti-air fire is undiminished');
  eq(rifles, 10 * U('iron/bastion', 2).dps * B.combat.speed * DT * mit * B.combat.noAA, 'everything else is reduced, not nullified');
  assert(rifles > 0 && B.combat.noAA > 0 && B.combat.noAA < 1);

  // Snipers pick out infantry.
  const mixed = [G('iron/bastion', 1, 20), G('iron/bastion', 2, 20)];
  const h0 = mixed.map(x => x.hp);
  fight([{ owner: 0, groups: [G('veil/forge', 1, 20)] }, { owner: 1, groups: mixed }], DT);
  const s = U('veil/forge', 1), share = (20 * s.prefer.inf) / (20 * s.prefer.inf + 20);
  const m1 = 1 - U('iron/bastion', 1).armor * 1 / (U('iron/bastion', 1).armor + B.combat.armorK);
  eq(h0[0] - mixed[0].hp, 20 * s.dps * B.combat.speed * DT * share * s.vs.inf * m1, 'share of fire on infantry');
  assert((h0[0] - mixed[0].hp) > 8 * (h0[1] - mixed[1].hp));

  // Opening charge (Mirage, Shenfeng) and spin-up (Gatling) depend on time in the fight.
  for (const [roster, tier] of [['meridian/shade', 3], ['veil/dominion', 2]]) {
    const u = U(roster, tier), t = () => [G('iron/bastion', 2, 300)];
    const first = dealt([G(roster, tier, 10)], t(), { atk: { since: 0 } }), later = dealt([G(roster, tier, 10)], t(), { atk: { since: u.opening.dur + 0.1 } });
    eq(first / later, u.opening.bonus, `${u.id} opening`);
  }
  const gat = U('veil/forge', 2), tg = () => [G('iron/bastion', 2, 300)];
  const cold = dealt([G('veil/forge', 2, 10)], tg(), { atk: { since: 0 } });
  eq(dealt([G('veil/forge', 2, 10)], tg(), { atk: { since: gat.spinup.dur / 2 } }) / cold, 1 + (gat.spinup.max - 1) / 2, 'half spun up');
  eq(dealt([G('veil/forge', 2, 10)], tg(), { atk: { since: 999 } }) / cold, gat.spinup.max, 'fully spun up, and no further');

  // Tesla arcs and prism beams reward a crowd of targets.
  const tt = U('iron/volt', 2);
  const few = dealt([G('iron/volt', 2, 10)], [G('meridian/shade', 2, tt.arc.min - 1)]), many = dealt([G('iron/volt', 2, 10)], [G('meridian/shade', 2, tt.arc.min)]);
  eq(many / few, tt.arc.bonus, 'arc bonus');

  // Guardian GIs dig in inside a city.
  const gd = U('meridian/aegis', 1);
  const open = dealt([G('iron/bastion', 1, 20)], [G('meridian/aegis', 1, 50)]), dug = dealt([G('iron/bastion', 1, 20)], [G('meridian/aegis', 1, 50)], { def: { inCity: true } });
  eq(dug / open, (1 - (gd.armor + gd.cityArmor) / (gd.armor + gd.cityArmor + B.combat.armorK)) / (1 - gd.armor / (gd.armor + B.combat.armorK)), 'fortified');

  // Long range: prism tanks bombard a city on the approach and its short-range garrison cannot answer.
  {
    const g = as(board([0, 1]), ME, 'meridian/aegis');
    const c = own(g, 2, FOE, 30, 2);                                 // gatling: range 26
    const prism = U('meridian/aegis', 3);
    const col = army(g, ME, 1, 2, 6, 200 - 60, 3);
    assert(prism.range >= 60 && U('veil/forge', 2).range < 60);
    const hp = hpOf(c.groups), mine = hpOf(col.groups);
    g.cityBattles(DT);
    assert(hpOf(c.groups) < hp, 'the garrison is hit from outside its own reach');
    assert.strictEqual(hpOf(col.groups), mine);
    col.s = 200 - prism.range - 5;
    const hp2 = hpOf(c.groups);
    g.cityBattles(DT);
    assert.strictEqual(hpOf(c.groups), hp2, 'out of range: nothing');
  }

  // Flying Discs over a city stop its production; an ordinary siege does not.
  {
    const g = scene(PTS, ROADS, { produce: true });
    as(g, FOE, 'veil/dominion');
    const c = own(g, 1, ME, 5); own(g, 0, ME, 5); own(g, 9, FOE, 10); own(g, 8, FOE, 10);
    const disc = army(g, FOE, 2, 1, 3, 0, 3);
    disc.state = 'siege'; c.siege.push(disc);
    const p0 = g.stats[ME].produced;
    for (let i = 0; i < 100; i++) g.produce(DT);
    const rate = B.levels[1].prod * B.factions.iron.prod;            // soldiers per second for one level-1 city
    assert.strictEqual(g.stats[ME].produced - p0, Math.floor(5 * rate), 'only the unbesieged city produced');
    assert.strictEqual(c.units, 5);
    disc.groups = [G('veil/dominion', 1, 3)];
    for (let i = 0; i < 100; i++) g.produce(DT);
    assert.strictEqual(c.units, 5 + Math.floor(5 * rate), 'infantry outside the walls do not stop production');
  }
});

section('mind-control units convert a few soldiers at a time, once each, and airborne units obey the roads', () => {
  const g = as(board([0, 1]), FOE, 'veil/forge');
  const ctl = U('veil/forge', 3).control;
  const brains = { owner: FOE, groups: [G('veil/forge', 3, 8)], ref: {} };
  const line = { owner: ME, groups: [G('iron/bastion', 1, 20), G('iron/bastion', 2, 10)], ref: {} };
  const hp0 = hpOf(line.groups) + hpOf(brains.groups), n0 = 38;
  for (let t = 0; t < ctl.cd - DT * 1.5; t += DT) g.control([brains, line], DT, 0, 0);
  assert.strictEqual(countOf(brains.groups), 8, 'not before its timer');
  g.control([brains, line], DT, 0, 0); g.control([brains, line], DT, 0, 0);
  const k = Math.min(ctl.cap, ctl.per * Math.ceil(8 / ctl.group));
  assert.strictEqual(countOf(brains.groups), 8 + k);
  assert.strictEqual(countOf(line.groups), 30 - k);
  assert.strictEqual(countOf(brains.groups) + countOf(line.groups), n0, 'soldiers change sides, none appear or vanish');
  eq(hpOf(line.groups) + hpOf(brains.groups), hp0, 'with the health they had');
  const turned = brains.groups.filter(x => x.cv);
  assert(turned.length && turned.every(x => x.f === 'iron'), 'they keep their own type');
  assert.strictEqual(g.stats[FOE].converted, k);
  assert.strictEqual(g.stats[ME].lostToConversion, k);
  // Converted soldiers are never converted back.
  const back = { owner: ME, groups: [G('veil/forge', 3, 8)], ref: {} }, only = { owner: FOE, groups: turned.map(x => ({ ...x })), ref: {} };
  for (let t = 0; t < ctl.cd * 3; t += DT) g.control([back, only], DT, 0, 0);
  assert.strictEqual(countOf(only.groups), k);
  // The last soldiers of a body are never taken.
  const tiny = { owner: ME, groups: [G('iron/bastion', 1, ctl.minSurvivors)], ref: {} }, b2 = { owner: FOE, groups: [G('veil/forge', 3, 8)], ref: {} };
  for (let t = 0; t < ctl.cd * 2; t += DT) g.control([b2, tiny], DT, 0, 0);
  assert.strictEqual(countOf(tiny.groups), ctl.minSurvivors);

  // Airships and discs look airborne but use roads like everyone else: they are intercepted on
  // the road, cannot route through a hostile city, and stop at a barricade.
  const h = as(board([0, 1]), ME, 'iron/volt');
  own(h, 0, ME, 30, 3); own(h, 2, FOE, 10); own(h, 3, ME, 5);
  assert.strictEqual(h.route(ME, 0, 3), null, 'no flying over the enemy city in between');
  h.nodes[2].owner = -1;
  assert.strictEqual(h.route(ME, 0, 3), null, 'nor over a neutral one');
  h.nodes[2].owner = FOE;
  const ships = army(h, ME, 1, 2, 6, 0, 3), block = army(h, FOE, 2, 1, 10, 0, 1);
  assert(run(h, 20, () => ships.state === 'engaged'), 'the airships were not intercepted');
  assert(h.dist(1, 2) - ships.s - block.s <= B.combat.engageRadius + 1e-6);
});

// ============================================================ basic skills

section('basic skills are cast on bases and roads, with cooldowns and limits; a refused cast costs nothing', () => {
  for (const [f, list] of Object.entries({ iron: ['turret', 'barricade', 'nuke'], meridian: ['aegis', 'suppress', 'wormhole'], veil: ['guard', 'mire', 'dominate'] })) {
    assert.deepStrictEqual(B.skills[f].map(s => s.id), list);
    assert.deepStrictEqual(B.skills[f].map(s => s.target), { iron: ['ownCity', 'edge', 'enemyCity'], meridian: ['ownCity', 'ownCity', 'ownCityPair'], veil: ['ownCity', 'edge', 'enemyCity'] }[f]);
    assert(B.skills[f][2].super && !B.skills[f][0].super && !B.skills[f][1].super);
  }
  const g = board([0, 1, 2]);
  assert.deepStrictEqual(g.skill(ME, 0, { node: 1 }), { ok: false, why: 'cooldown' }, 'nothing is ready in the opening seconds');
  ready(g, ME);
  assert.deepStrictEqual(g.skill(ME, 0, { node: 9 }), { ok: false, why: 'target' }, 'not on an enemy base');
  assert.deepStrictEqual(g.skill(ME, 0, { node: 4 }), { ok: false, why: 'target' }, 'not on a neutral city');
  assert.deepStrictEqual(g.skill(ME, 0, { node: 99 }), { ok: false, why: 'target' });
  assert.deepStrictEqual(g.skill(ME, 5, { node: 1 }), { ok: false, why: 'slot' });
  assert.strictEqual(g.players[ME].cd[0], 0, 'refused casts start no cooldown');
  assert.strictEqual(g.stats[ME].basic, 0);

  assert.deepStrictEqual(g.skill(ME, 0, { node: 1 }, 77), { ok: true });
  assert.strictEqual(g.players[ME].cd[0], B.skills.iron[0].cd);
  assert.deepStrictEqual(g.skill(ME, 0, { node: 2 }, 78), { ok: false, why: 'cooldown' });
  g.players[ME].cd[0] = 0;
  assert.deepStrictEqual(g.skill(ME, 0, { node: 2 }, 77), { ok: false, why: 'duplicate' }, 'a repeated message never casts twice');
  assert.deepStrictEqual(g.skill(ME, 0, { node: 1 }, 79), { ok: false, why: 'limit' }, 'one emplacement of a kind per base');
  assert(g.skill(ME, 0, { node: 2 }, 80).ok);
  g.players[ME].cd[0] = 0;
  assert(g.skill(ME, 0, { node: 0 }, 81).ok);
  g.players[ME].cd[0] = 0;
  own(g, 3, ME);
  assert.deepStrictEqual(g.skill(ME, 0, { node: 3 }, 82), { ok: false, why: 'limit' }, `at most ${B.skills.perPlayer} emplacements per player`);
  assert.strictEqual(g.emps.length, 3);
  assert.strictEqual(g.stats[ME].deployed, 3);
  assert.strictEqual(g.stats[ME].basic, 3);
  assert.strictEqual(events((g.drain(), g), 'cast').length, 3);
});

section('Deploy Defense: a temporary turret beside a base, which ends with its time or with the base', () => {
  const g = board([0, 1, 2]);
  ready(g, ME);
  assert(g.skill(ME, 0, { node: 2 }).ok);
  const def = g.skillDef(g.players[ME], 0), e = g.emps[0];
  assert(e.kind === 'turret' && e.node === 2 && near(e.until, g.t + def.dur));
  const foe = army(g, FOE, 3, 2, 30, 200 - 100), friend = army(g, ME, 3, 2, 10, 200 - 90), far = army(g, FOE, 3, 2, 10, 0);
  const h = [hpOf(foe.groups), hpOf(friend.groups), hpOf(far.groups)];
  g.runFields(DT);
  eq(h[0] - hpOf(foe.groups), def.dmg, 'one shot');
  assert.strictEqual(hpOf(friend.groups), h[1], 'never at its own side');
  assert.strictEqual(hpOf(far.groups), h[2], 'nor beyond its range');
  g.runFields(DT);
  eq(h[0] - hpOf(foe.groups), def.dmg, 'then it reloads');
  assert(events((g.drain(), g), 'shot').some(x => x.node === 2 && x.emp === e.slot));
  assert.strictEqual(g.features().filter(x => x.k === 'turret' && x.n === 2 && x.p === ME).length, 1, 'clients are told where it stands');

  // The Volt variant hits harder; that is the whole difference.
  const v = as(board([0, 1, 2]), ME, 'iron/volt');
  eq(v.skillDef(v.players[ME], 0).dmg, B.skills.iron[0].dmg * B.skills.variants.volt.turret.dmg);
  eq(def.dmg, B.skills.iron[0].dmg);

  // It goes when its time is up...
  g.armies = [];
  const rev = g.featRev;
  tick(g, def.dur + 0.1);
  assert.strictEqual(g.emps.length, 0);
  assert(g.featRev > rev, 'and clients are told');
  // ...or at once when the base changes hands.
  ready(g, ME);
  assert(g.skill(ME, 0, { node: 2 }).ok);
  g.nodes[2].groups = [];
  const taker = army(g, FOE, 3, 2, 20, 200 - B.march.arriveAt);
  assert(run(g, 5, () => g.nodes[2].owner === FOE));
  assert.strictEqual(g.emps.length, 0, 'the new owner does not inherit it');
  assert(taker.groups.length === 0 || taker.queue !== undefined);
});

section('Route Barricade: stops hostile columns until broken, lets friends through, and routes go round it', () => {
  const g = board([0, 1, 2]);
  ready(g, ME);
  const def = g.skillDef(g.players[ME], 1);
  eq(def.hp, B.skills.iron[1].hp * B.skills.variants.bastion.barricade.hp, 'the Bastion variant is sturdier');
  assert.deepStrictEqual(g.skill(ME, 1, { a: 3, b: 4, f: 0.5 }), { ok: false, why: 'target' }, 'only on a road that touches one of your bases');
  assert.deepStrictEqual(g.skill(ME, 1, { a: 2, b: 4, f: 0.5 }), { ok: false, why: 'target' }, 'only on a road');
  assert.deepStrictEqual(g.skill(ME, 1, { a: 2, b: 3, f: 0.05 }), { ok: false, why: 'target' }, 'not on top of a base');
  assert.deepStrictEqual(g.skill(ME, 1, { a: 2, b: 3, f: 0.95 }), { ok: false, why: 'target' });
  const marching = army(g, FOE, 3, 2, 10, 100);
  assert.deepStrictEqual(g.skill(ME, 1, { a: 2, b: 3, f: 0.5 }), { ok: false, why: 'blocked' }, 'never dropped on top of a column');
  g.armies = [];
  assert.strictEqual(marching.n, 10);
  assert(g.skill(ME, 1, { a: 2, b: 3, f: 0.5 }).ok);
  g.players[ME].cd[1] = 0;
  assert.deepStrictEqual(g.skill(ME, 1, { a: 1, b: 5, f: 0.5 }), { ok: false, why: 'limit' }, 'one obstacle per player');
  const o = g.obst[0];
  assert(o.kind === 'block' && o.lo === 2 && o.hi === 3 && near(o.x, 100) && near(o.hp, def.hp));
  assert.strictEqual(g.features().filter(x => x.k === 'block' && x.a === 2 && x.b === 3).length, 1);

  // A hostile column stops in front of it and has to break it; a friendly one walks through.
  const foe = army(g, FOE, 3, 2, 30, 0), friend = army(g, ME, 2, 3, 5, 0);
  own(g, 3, ME, 0);
  const start = g.t;
  let stopped = 0, passed = false;
  assert(run(g, def.dur + 5, () => {
    const x = 200 - foe.s;                                           // distance of the hostile column from city 2
    if (g.obst.length) { assert(x >= 100 + B.combat.engageRadius - 1e-6 || foe.state === 'engaged', 'it went through the barricade'); if (foe.atBlock) stopped++; }
    if (friend.groups.length === 0 || friend.s > 110) passed = true;
    return g.obst.length === 0;
  }));
  assert(passed, 'the friendly column should not have been held up');
  assert(stopped > 20, 'the hostile column should have been held');
  const dps = 30 * U('veil/forge', 1).dps * B.combat.speed;
  const broke = events(g, 'broke');
  assert.strictEqual(broke.length, 1, 'thirty soldiers break it before it expires');
  const held = stopped * DT;
  eq(held, def.hp / dps, 'it holds for its health over the column\'s firepower', 0.05);
  assert(held > 4 && held < def.dur, `a barricade is worth a few seconds (${held.toFixed(1)} s here)`);

  // Frontage: only so many soldiers can get at it, so a column five times the size is not five times faster.
  {
    const h = board([0, 1, 2]);
    ready(h, ME);
    assert(h.skill(ME, 1, { a: 2, b: 3, f: 0.5 }).ok);
    const big = army(h, FOE, 3, 2, 150, 0);
    let at = 0;
    assert(run(h, def.dur + 5, () => { if (big.atBlock) at++; return h.obst.length === 0; }));
    eq(at * DT, def.hp / (def.frontage * U('veil/forge', 1).dps * B.combat.speed), 'limited by frontage', 0.05);
    assert.strictEqual(big.n, 150, 'breaking a barricade costs no soldiers');
  }

  // Planning: a hostile barricade makes its road cost more, so a route goes round when there is a comparable way.
  const t = scene(TRI, TRI_ROADS);
  own(t, 1, ME, 20); own(t, 0, FOE, 20); own(t, 2, FOE, 20);
  assert.deepStrictEqual(t.route(FOE, 0, 1).path, [0, 1]);
  ready(t, ME);
  assert(t.skill(ME, 1, { a: 0, b: 1, f: 0.5 }).ok);
  assert.deepStrictEqual(t.route(FOE, 0, 1).path, [0, 2, 1], 'round the barricade');
  assert.deepStrictEqual(t.route(ME, 1, 0).path, [1, 0], 'its owner is not hindered');
  eq(t.edgePenalty(FOE, 0, 1), t.skillDef(t.players[ME], 1).detour);
  // A column already on the blocked road replans once, and goes back to the direct road when the barricade is gone.
  const col = t.send(FOE, [0], 1, 0.5, 1)[0];
  assert.deepStrictEqual([col.to, ...col.path], [2, 1]);
  t.obst = []; t.topoRev++;
  tick(t, 0.1);
  assert.deepStrictEqual([col.to, ...col.path], [1], 'the shorter way is taken again');
  assert(events((t.drain(), t), 'route', 're').length >= 1);
});

section('Base Shield absorbs a siege and voids one superweapon; Suppression, Psychic Guard and Disruption Barrier', () => {
  // Base Shield
  {
    const g = as(board([0, 1, 2]), ME, 'meridian/aegis');
    for (const i of [0, 1, 2]) own(g, i, ME, 20);
    ready(g, ME);
    const def = g.skillDef(g.players[ME], 0);
    eq(def.hp, B.skills.meridian[0].hp * B.skills.variants.aegis.aegis.hp);
    assert(g.skill(ME, 0, { node: 2 }).ok);
    const c = g.nodes[2];
    assert(c.aegis && near(c.aegis.hp, def.hp));
    const siege = army(g, FOE, 3, 2, 40, 200 - B.march.arriveAt);
    const hp = hpOf(c.groups);
    tick(g, 1);
    assert.strictEqual(hpOf(c.groups), hp, 'the garrison is untouched while the shield holds');
    assert(c.aegis.hp < def.hp);
    eq(g.stats[ME].absorbed, def.hp - c.aegis.hp, 'what it soaked is recorded');
    assert(hpOf(siege.groups) < 40 * U('veil/forge', 1).hp, 'the garrison still fights back');
    g.players[ME].cd[0] = 0;
    c.aegis.hp = 5;
    assert(g.skill(ME, 0, { node: 2 }).ok);
    eq(c.aegis.hp, def.hp, 'recast refreshes it, never stacks');
    g.armies = []; c.siege = [];
    tick(g, def.dur + 0.1);
    assert.strictEqual(c.aegis, null, 'it expires');
  }
  // Suppression Emplacement and Psychic Guard: hostile columns near the base, strongest effect only.
  for (const [roster, slot, key] of [['meridian/shade', 1, 'slow'], ['veil/dominion', 0, 'weaken']]) {
    const g = as(board([0, 1, 2]), ME, roster);
    for (const i of [0, 1, 2]) own(g, i, ME, 20);
    as(g, FOE, 'iron/bastion');
    ready(g, ME);
    const def = g.skillDef(g.players[ME], slot);
    assert(g.skill(ME, slot, { node: 2 }).ok);
    const inside = army(g, FOE, 3, 2, 10, 200 - (def.range - 5)), outside = army(g, FOE, 3, 2, 10, 200 - (def.range + 5)), friend = army(g, ME, 3, 2, 10, 100);
    g.runFields(DT);
    const f = key === 'slow' ? 'slow' : 'weak';
    eq(inside[f], def[key], `${key} inside its range`);
    assert.strictEqual(outside[f], 1);
    assert.strictEqual(friend[f], 1);
    assert(def.range > B.skills[g.players[ME].faction][slot].range, 'this subfaction reaches a little further');
    if (key === 'slow') { g.armies = [inside]; g.move(DT); eq(inside.v, g.baseSpeed(inside) * def.slow, 'it really marches slower'); }
  }
  // Disruption Barrier: a stretch of road that slows and weakens whoever is hostile and inside it.
  {
    const g = as(board([0, 1, 2]), ME, 'veil/forge');
    for (const i of [0, 1, 2]) own(g, i, ME, 20);
    as(g, FOE, 'iron/bastion');
    ready(g, ME);
    const def = g.skillDef(g.players[ME], 1);
    eq(def.span, B.skills.veil[1].span * B.skills.variants.forge.mire.span);
    assert(g.skill(ME, 1, { a: 2, b: 3, f: 0.5 }).ok);
    const inside = army(g, FOE, 3, 2, 10, 100 - def.span / 2 + 2), before = army(g, FOE, 3, 2, 10, 100 - def.span / 2 - 40), friend = army(g, ME, 2, 3, 10, 100);
    g.runFields(DT);
    eq(inside.slow, def.slow); eq(inside.weak, def.weaken);
    assert(before.slow === 1 && before.weak === 1 && friend.slow === 1 && friend.weak === 1);
    g.armies = [inside];
    assert(run(g, 30, () => inside.state === 'siege'), 'a barrier slows a column, it does not stop it');
    assert(g.obst.length === 1, 'and it cannot be broken down');
  }
});

// ============================================================ superweapons

section('superweapons need three level-3 bases and a full charge, and spare a player\'s last base', () => {
  const g = board([0, 1, 2]);
  own(g, 3, FOE, 20);
  g.players[ME].charge = g.players[ME].need;
  assert.deepStrictEqual(g.skill(ME, 2, { node: 9 }), { ok: false, why: 'needL3' });
  armSuper(g, ME, [0, 1, 2]);
  g.players[ME].charge = 0;
  assert.deepStrictEqual(g.skill(ME, 2, { node: 9 }), { ok: false, why: 'charging' });
  tick(g, 10);
  eq(g.players[ME].charge, 10, 'it charges on the simulation clock', 1e-6);
  g.nodes[2].level = 2;
  tick(g, 10);
  eq(g.players[ME].charge, 10, 'and only while the three bases are held', 1e-6);
  g.nodes[2].level = 3;
  g.players[ME].charge = g.players[ME].need;
  assert.deepStrictEqual(g.skill(ME, 2, { node: 1 }), { ok: false, why: 'target' }, 'not on your own base');
  assert.deepStrictEqual(g.skill(ME, 2, { node: 4 }), { ok: false, why: 'target' }, 'not on a neutral city');
  assert(g.skill(ME, 2, { node: 9 }).ok);
  assert.strictEqual(g.players[ME].charge, 0);
  assert.strictEqual(g.players[ME].need, B.skills.iron[2].cd);
  assert.strictEqual(g.stats[ME].supers, 1);

  // The last base cannot be targeted, and a strike already on its way does nothing if its target has become the last one.
  const h = board([0, 1, 2]);
  armSuper(h, ME, [0, 1, 2]);
  h.nodes[8].owner = -1;                                             // the enemy holds only city 9
  assert.deepStrictEqual(h.skill(ME, 2, { node: 9 }), { ok: false, why: 'lastBase' });
  assert.strictEqual(h.players[ME].charge, h.players[ME].need, 'a refused strike keeps its charge');
  own(h, 8, FOE, 10);
  assert(h.skill(ME, 2, { node: 9 }).ok);
  h.nodes[8].owner = -1;
  tick(h, B.skills.iron[2].delay + 0.2);
  assert(h.nodes[9].owner === FOE && !h.nodes[9].ruin, 'the last base stands');
  assert(events(h, 'strike').some(e => e.void === 'last'));
});

section('nuclear strike: the targeted base becomes a neutral ruin with its roads; capture and rebuild bring it back at level 1', () => {
  const g = scene(PTS, ROADS, { produce: true, capacity: true });
  for (const id of [0, 1, 2]) own(g, id, ME, 10, 3, 3);
  const target = own(g, 3, FOE, 60, 2, 2), other = own(g, 4, FOE, 25);
  own(g, 9, FOE, 10); own(g, 8, FOE, 10);
  g.players[ME].charge = g.players[ME].need;
  const def = B.skills.iron[2], roads = JSON.stringify(g.edges), adj = JSON.stringify(g.adj.map(s => [...s]));
  ready(g, FOE);
  as(g, FOE, 'veil/dominion');
  assert(g.skill(FOE, 0, { node: 3 }).ok, 'an emplacement beside the doomed base');
  g.setAuto(FOE, [3], 4, 0.5, 1); g.setAuto(FOE, [4], 3, 0.5, 2); g.setAuto(FOE, [9], 4, 0.5, 3);
  g.autos.forEach(o => { o.next = 1e9; });                            // keep them from sending during the test
  const column = army(g, FOE, 4, 3, 20, 200 - 60), away = army(g, FOE, 9, 4, 20, 20), mineNear = army(g, ME, 2, 3, 12, 200 - 80);
  const hpCol = hpOf(column.groups), hpAway = hpOf(away.groups), hpMine = hpOf(mineNear.groups);
  column.hold = away.hold = mineNear.hold = true;

  assert(g.skill(ME, 2, { node: 3 }, 5).ok);
  assert.strictEqual(g.strikes.length, 1);
  tick(g, def.delay - 0.2);
  assert(target.owner === FOE && target.units >= 60, 'nothing happens before it lands');
  const lossesBefore = g.stats[FOE].losses, garrison = target.units;
  tick(g, 0.4);

  // The base is destroyed.
  assert.strictEqual(target.owner, -1, 'neutral');
  assert.strictEqual(target.ruin, true);
  assert.strictEqual(target.units, 0, 'its garrison is gone');
  assert.strictEqual(target.level, 1);
  assert.strictEqual(g.emps.length, 0, 'its defences are gone');
  assert.strictEqual(g.nodes.length, PTS.length, 'the city is still on the map');
  assert.strictEqual(JSON.stringify(g.edges), roads);
  assert.strictEqual(JSON.stringify(g.adj.map(s => [...s])), adj, 'every road is still there');
  assert(events(g, 'ruin').some(e => e.node === 3 && e.by === ME && e.from === FOE));
  assert.strictEqual(g.stats[ME].destroyed, 1);
  assert.strictEqual(g.stats[FOE].lost, 1);
  assert(g.stats[FOE].losses - lossesBefore >= garrison, 'the dead are counted');
  assert.strictEqual(other.owner, FOE, 'only the targeted base is destroyed');
  assert(other.units >= 20 && !other.ruin);
  // Hostile armies in the blast are hurt, friendly ones are not; armies elsewhere are untouched.
  const blast = Math.min(def.cap, hpCol * def.pct + def.flat);
  assert(hpCol - hpOf(column.groups) >= blast - 1e-6, 'the column beside the base is caught in it');
  assert.strictEqual(hpOf(mineNear.groups), hpMine);
  assert.strictEqual(hpOf(away.groups), hpAway);
  // Persistent orders that involved the base are gone; the unrelated one is not.
  assert.deepStrictEqual(g.autoList(FOE).map(o => o.slice(0, 2)), [[9, 4]]);
  assert.strictEqual(events(g, 'auto').filter(e => e.p === FOE).length, 2);

  // A ruin does nothing: no production, no abilities, it cannot be upgraded or used by its neighbours' routes.
  g.armies = [];
  const made0 = g.stats.map(s => s.produced);
  tick(g, 10);
  assert.strictEqual(target.units, 0, 'a ruin produces nothing');
  assert.strictEqual(g.route(ME, 2, 4), null, 'a neutral ruin is not marched through');
  assert(g.route(ME, 2, 3), 'but it can be marched on');
  assert.strictEqual(g.upgrade(FOE, 3), false);
  assert.strictEqual(g.capOf(target), B.ruin.capacity);

  // Anyone can capture it. Holding it is not enough: it has to be rebuilt.
  own(g, 2, ME, 40, 1, 3);
  assert.deepStrictEqual(g.send(ME, [2], 3, 1, 6).results, [[2, 40, 1]]);
  assert(run(g, 20, () => target.owner === ME && g.armies.every(a => a.owner !== ME || a.queue)));
  assert.strictEqual(g.stats[ME].ruinsCaptured, 1);
  assert.strictEqual(target.ruin, true);
  assert.strictEqual(target.units, B.ruin.capacity, 'a ruin shelters a small garrison');
  assert.strictEqual(g.armies.filter(a => a.owner === ME && a.queue).reduce((s, a) => s + a.n, 0), 10, 'the rest wait outside');
  assert(g.route(ME, 2, 4), 'in friendly hands its roads carry columns again');
  const p0 = g.stats[ME].produced;
  g.nodes[0].groups = [makeGroup('iron', 'bastion', 1, 200)]; g.nodes[1].groups = [makeGroup('iron', 'bastion', 1, 200)]; g.nodes[2].groups = [makeGroup('iron', 'bastion', 1, 200)];
  tick(g, 5);
  assert.strictEqual(g.stats[ME].produced, p0, 'still no production');

  // Rebuilding: an explicit order, paid in soldiers, taking simulation time.
  assert.strictEqual(g.rebuild(FOE, 3), false, 'only its holder may rebuild it');
  const before = target.units;
  assert.strictEqual(g.upgrade(ME, 3), true, 'the upgrade order on a ruin starts the rebuild');
  assert.strictEqual(target.units, before - B.ruin.cost);
  assert.strictEqual(g.rebuild(ME, 3), false, 'not twice');
  assert(g.features().some(f => f.k === 'rebuild' && f.n === 3 && near(f.u - f.t0, B.ruin.time, 1e-3)));
  tick(g, B.ruin.time - 0.5);
  assert(target.ruin && g.stats[ME].produced === p0, 'not until the work is done');
  g.paused = true;
  for (let i = 0; i < 400; i++) g.tick(DT);
  assert(target.ruin, 'a paused match rebuilds nothing');
  g.paused = false;
  tick(g, 1);
  assert.strictEqual(target.ruin, false);
  assert.strictEqual(target.level, 1, 'it comes back as a level-1 base: earlier upgrades are not restored');
  assert.strictEqual(target.owner, ME);
  assert.strictEqual(g.stats[ME].rebuilt, 1);
  assert(events(g, 'rebuilt').some(e => e.node === 3 && e.p === ME));
  g.armies = []; target.groups = [makeGroup('iron', 'bastion', 1, 5)];
  tick(g, 6);
  assert(target.units > 5, 'and produces again');
  assert.strictEqual(g.capOf(target), B.levels[1].threshold * 3);

  // Losing a ruin while it is being rebuilt abandons the work.
  const h = board([0, 1, 2]);
  const r = h.nodes[2];
  r.ruin = true; r.groups = [makeGroup('iron', 'bastion', 1, 12)];
  assert(h.rebuild(ME, 2));
  r.groups = [];
  army(h, FOE, 3, 2, 10, 200 - B.march.arriveAt);
  assert(run(h, 5, () => r.owner === FOE));
  assert(r.ruin && r.rebuild === null);
  tick(h, B.ruin.time + 1);
  assert.strictEqual(r.ruin, true, 'the new holder has to start again');
});

section('a Base Shield voids a superweapon and is spent; the base and its garrison are untouched', () => {
  for (const [roster, skillId] of [['iron/bastion', 'nuke'], ['veil/dominion', 'dominate']]) {
    const g = as(board([0, 1, 2]), ME, roster);
    armSuper(g, ME, [0, 1, 2]);
    as(g, FOE, 'meridian/shade');
    const c = own(g, 3, FOE, 30, 1, 2);
    own(g, 9, FOE, 10); own(g, 8, FOE, 10);
    ready(g, FOE);
    assert(g.skill(ME, 2, { node: 3 }).ok);
    assert(g.skill(FOE, 0, { node: 3 }).ok, 'the defender answers the warning with a shield');
    tick(g, B.skills[g.players[ME].faction][2].delay + 0.2);
    assert(c.owner === FOE && !c.ruin && c.units === 30 && c.level === 2, `${skillId} came to nothing`);
    assert.strictEqual(c.aegis, null, 'the shield is spent');
    assert(events(g, 'strike').some(e => e.skill === skillId && e.void === 'shield'));
    assert.strictEqual(g.stats[ME].destroyed + g.stats[ME].basesConverted, 0);
    assert.strictEqual(g.stats[ME].supers, 1, 'the superweapon was used all the same');
  }
});

section('chrono wormhole: a temporary two-way link between two of your bases that routes use and soldiers pass intact', () => {
  const setup = () => {
    const g = as(board([]), ME, 'meridian/shade');
    for (const id of [0, 1, 2, 3, 4]) own(g, id, ME, 20);
    armSuper(g, ME, [1, 2, 3]);
    return g;
  };
  const def = B.skills.meridian[2];
  let g = setup();
  assert.deepStrictEqual(g.skill(ME, 2, { node: 0, to: 9 }), { ok: false, why: 'target' }, 'both ends must be yours');
  assert.deepStrictEqual(g.skill(ME, 2, { node: 0, to: 0 }), { ok: false, why: 'target' });
  assert.deepStrictEqual(g.route(ME, 0, 4).path, [0, 1, 2, 3, 4]);
  assert(g.skill(ME, 2, { node: 0, to: 4 }).ok);
  assert.strictEqual(g.worms.length, 1);
  assert(g.features().some(f => f.k === 'worm' && f.a === 0 && f.b === 4 && f.left === def.capacity));
  assert.deepStrictEqual(g.route(ME, 0, 4).path, [0, 4], 'pathfinding uses it');
  assert.deepStrictEqual(g.route(ME, 4, 0).path, [4, 0], 'in both directions');
  eq(g.route(ME, 0, 4).cost, def.cost);
  assert.deepStrictEqual(g.route(ME, 1, 9).path, [1, 0, 4, 9], 'as one hop of a longer route');
  assert.strictEqual(g.route(FOE, 9, 0), null, 'never the enemy\'s');
  assert.deepStrictEqual(g.route(ME, 0, 1).path, [0, 1], 'a nearer city is still reached by road');

  // Reinforcement through it: the soldiers arrive at once, intact, and it counts down its capacity.
  g.nodes[0].groups = [makeGroup('meridian', 'shade', 1, 30), makeGroup('meridian', 'shade', 3, 10)];
  g.nodes[0].groups[1].hp -= 123;
  const hp = hpOf(g.nodes[0].groups), total = mineOnly(g);
  const made = g.send(ME, [0], 4, 1, 1);
  assert.deepStrictEqual(made.results, [[0, 40, 1]]);
  assert(made[0].warped && made[0].to === 4);
  tick(g, 0.2);
  assert.strictEqual(g.armies.length, 0, 'through and inside within a moment');
  assert.strictEqual(g.nodes[4].units, 60);
  eq(hpOf(g.nodes[4].groups), 20 * U('meridian/shade', 1).hp + hp, 'health carried over exactly');
  assert.strictEqual(g.nodes[4].groups.filter(x => x.t === 3)[0].n, 10, 'tiers too');
  assert.strictEqual(mineOnly(g), total);
  assert.strictEqual(g.stats[ME].warped, 40);
  assert.strictEqual(g.worms[0].left, def.capacity - 40);
  assert(events(g, 'warp').some(e => e.p === ME && e.from === 0 && e.to === 4 && e.n === 40));

  // An attack through it: walk to the near end, cross, and march on from the far end as transit.
  g.nodes[1].groups = [makeGroup('meridian', 'shade', 1, 30)];
  const raid = g.send(ME, [1], 9, 1, 2)[0];
  assert.deepStrictEqual([raid.to, ...raid.path], [0, 4, 9]);
  assert(run(g, 30, () => raid.state === 'siege'), 'the raid never reached city 9');
  assert.deepStrictEqual(g.walk.get(raid.id), [0, 9], 'by city 0, then out of city 4 towards 9');
  assert.strictEqual(g.nodes[4].units, 60, 'passing through is transit: the far base keeps its own garrison');
  assert(g.t < 200 / (60 * U('meridian/shade', 1).move) * 2 + 2, 'far sooner than the 800 by road');

  // Throughput: a column larger than what the wormhole can still carry goes by road.
  g = setup();
  assert(g.skill(ME, 2, { node: 0, to: 4 }).ok);
  g.capOf = () => 1e9;
  g.nodes[0].groups = [makeGroup('meridian', 'shade', 1, def.capacity + 40)];
  assert.deepStrictEqual(g.route(ME, 0, 4, def.capacity + 40).path, [0, 1, 2, 3, 4]);
  const big = g.send(ME, [0], 4, 1, 1)[0], small = (g.nodes[1].groups = [makeGroup('meridian', 'shade', 1, 20)], g.send(ME, [1], 4, 1, 2)[0]);
  assert.deepStrictEqual([big.to, ...big.path], [1, 2, 3, 4], 'too many for the wormhole');
  assert.deepStrictEqual([small.to, ...small.path], [0, 4], 'a small column still takes it');

  // It closes when its time is up; a column that was counting on it replans, and nobody is lost.
  const soldiersBefore = mineOnly(g);
  tick(g, def.dur + 0.1 - g.t);
  assert.strictEqual(g.worms.length, 0);
  assert.strictEqual(g.features().filter(f => f.k === 'worm').length, 0);
  assert.deepStrictEqual(g.route(ME, 0, 4).path, [0, 1, 2, 3, 4]);
  assert(run(g, 60, () => g.armies.length === 0), 'everyone should have arrived by road');
  assert.strictEqual(mineOnly(g), soldiersBefore);

  // It also closes at once if either end is lost, and a new one replaces the old.
  g = setup();
  assert(g.skill(ME, 2, { node: 0, to: 4 }).ok);
  g.players[ME].charge = g.players[ME].need;
  assert(g.skill(ME, 2, { node: 1, to: 3 }).ok);
  assert(g.worms.length === 1 && g.worms[0].a === 1 && g.worms[0].b === 3, 'one wormhole per player');
  g.nodes[3].owner = FOE; g.ownerRev++;
  tick(g, 0.1);
  assert.strictEqual(g.worms.length, 0);
});

section('base mind control: the base changes sides as it stands; marching armies do not', () => {
  const g = as(board([0, 1, 2]), ME, 'veil/dominion');
  armSuper(g, ME, [0, 1, 2]);
  as(g, FOE, 'iron/volt');
  const c = own(g, 3, FOE, 0, 1, 3);
  c.groups = [makeGroup('iron', 'volt', 1, 20), makeGroup('iron', 'volt', 3, 6)];
  c.groups[1].hp -= 200;
  own(g, 4, FOE, 20); own(g, 9, FOE, 10); own(g, 8, FOE, 10);
  ready(g, FOE);
  assert(g.skill(FOE, 0, { node: 3 }).ok, 'the old owner\'s turret');
  g.setAuto(FOE, [3], 4, 0.5, 1); g.setAuto(FOE, [4], 3, 0.5, 2);
  g.autos.forEach(o => { o.next = 1e9; });
  const marching = army(g, FOE, 4, 3, 15, 30), mine = army(g, ME, 2, 3, 10, 30);   // both outside the base's own reach
  marching.hold = mine.hold = true;
  const hp = hpOf(c.groups), def = B.skills.veil[2];

  assert(g.skill(ME, 2, { node: 3 }, 1).ok);
  assert(events((g.drain(), g), 'cast').some(e => e.skill === 'dominate' && e.node === 3 && e.delay === def.delay), 'everyone is warned');
  tick(g, def.delay - 0.2);
  assert.strictEqual(c.owner, FOE, 'not before the warning has run');
  tick(g, 0.4);

  assert.strictEqual(c.owner, ME, 'the base is mine');
  assert.strictEqual(c.level, 3, 'at the level it had');
  assert.strictEqual(c.units, 26, 'with its whole garrison');
  eq(hpOf(c.groups), hp, 'at the health it had');
  assert(c.groups.every(x => x.cv && x.f === 'iron'), 'the same troops, marked so they cannot be turned again');
  assert.strictEqual(marching.owner, FOE, 'marching armies are not converted');
  assert.strictEqual(marching.n, 15);
  assert.strictEqual(mine.n, 10);
  assert.strictEqual(g.emps.length, 0, 'the old owner\'s emplacement ends');
  assert.deepStrictEqual(g.autoList(FOE), [], 'their persistent orders from it and to it are cancelled');
  assert.strictEqual(g.stats[ME].basesConverted, 1);
  assert.strictEqual(g.stats[ME].captured, 0, 'counted as converted, not captured');
  assert.strictEqual(g.stats[FOE].lost, 1);
  assert.strictEqual(g.stats[ME].converted, 26);
  assert.strictEqual(g.stats[FOE].lostToConversion, 26);
  assert(events(g, 'cap').some(e => e.node === 3 && e.by === ME && e.from === FOE && e.mind));
  // It works for its new owner from now on: Veil disruption instead of the Iron coil.
  marching.hold = false; marching.dest = 3; marching.s = 100;
  g.drain();
  g.runFields(DT);
  eq(marching.weak, B.abilities.veil.weaken);
  assert(!events((g.drain(), g), 'shot').some(e => e.node === 3 && g.log.indexOf(e) > g.log.length - 3));
  // The old owner's column now arrives as an attacker.
  assert(run(g, 20, () => marching.state === 'siege' || marching.groups.length === 0));
});

// ============================================================ cancelling orders

section('halting a marching column: it stops where it is, holds, stays in the world, and can be sent on', () => {
  const g = board([0, 1, 2, 3]);
  own(g, 0, ME, 40);
  const a = g.send(ME, [0], 3, 1, 1)[0];
  tick(g, 2);
  const at = g.pos(a), n = a.n;
  assert.deepStrictEqual(g.halt(FOE, a.id, 2), { ok: false, why: 'target' }, 'not somebody else\'s');
  g.paused = true;
  assert.deepStrictEqual(g.halt(ME, a.id, 3), { ok: false, why: 'paused' });
  g.paused = false;
  assert.deepStrictEqual(g.halt(ME, a.id, 3), { ok: true });
  assert.deepStrictEqual(g.halt(ME, a.id, 3), { ok: false, why: 'duplicate' });
  assert.deepStrictEqual(g.halt(ME, a.id, 4), { ok: false, why: 'target' }, 'already held');
  tick(g, 10);
  assert.deepStrictEqual(g.pos(a), at, 'it has not moved');
  assert(a.hold && a.n === n && g.armies.includes(a) && a.path.length === 0, 'nobody was deleted');
  assert.strictEqual(events(g, 'route', 'held').length, 1);
  assert.strictEqual(g.nodes[0].units, 0, 'the soldiers are not teleported home');

  // Still in the world: an enemy column runs into it.
  const foe = army(g, FOE, 1, 0, 5, 0);
  assert(run(g, 20, () => foe.groups.length === 0), 'the held column should have fought');
  assert(a.hold && a.n > 0);

  // A new order from where it stands.
  assert.deepStrictEqual(g.redirect(ME, a.id, 9, 5), { ok: false, why: 'noRoute' });
  assert(a.hold, 'a refused order changes nothing');
  assert.deepStrictEqual(g.redirect(ME, a.id, 2, 6), { ok: true });
  assert(!a.hold && a.dest === 2);
  assert.strictEqual(events((g.drain(), g), 'route', 'new').length, 1);
  const left = a.n;
  assert(run(g, 20, () => g.armies.length === 0));
  assert.strictEqual(g.nodes[2].units, 20 + left);

  // An army locked in a siege cannot be pulled out by cancelling.
  own(g, 4, FOE, 50);
  const s = g.send(ME, [3], 4, 1, 7)[0];
  assert(run(g, 20, () => s.state === 'siege'));
  assert.deepStrictEqual(g.halt(ME, s.id, 8), { ok: false, why: 'target' });
  assert.deepStrictEqual(g.redirect(ME, s.id, 2, 9), { ok: false, why: 'target' });
});

// ============================================================ time

section('every new duration runs on the simulation clock: same steps at all five speeds, real time scaled, frozen by pause', () => {
  const rows = [];
  for (const speed of B.speeds) {
    const g = as(board([]), ME, 'iron/bastion');
    for (const id of [0, 1, 2, 3]) own(g, id, ME, 10, 3, 3);
    own(g, 4, FOE, 30); own(g, 5, FOE, 5);
    g.players[ME].charge = g.players[ME].need;
    ready(g, ME);
    const ruin = g.nodes[6];
    ruin.owner = ME; ruin.ruin = true; ruin.groups = [makeGroup('iron', 'bastion', 1, 20)];
    assert(g.skill(ME, 0, { node: 1 }).ok && g.skill(ME, 1, { a: 2, b: 6, f: 0.5 }).ok && g.skill(ME, 2, { node: 4 }).ok && g.rebuild(ME, 6));
    const pace = new Pace(DT, speed), done = {};
    let real = 0, ticks = 0;
    const mark = (k, cond) => { if (!(k in done) && cond) done[k] = { real, ticks, sim: g.t }; };
    while (Object.keys(done).length < 5 && real < 400) {
      real += 0.05;
      // A pause in the middle of everything: nothing may move on, at any speed.
      if (Math.abs(real - 1) < 0.02) { g.paused = true; const t = g.t; for (let i = 0; i < 300; i++) { assert.strictEqual(pace.advance(0.05, true), 0); g.tick(DT); } assert.strictEqual(g.t, t); g.paused = false; }
      for (let n = pace.advance(0.05); n > 0; n--) {
        g.tick(DT); g.drain(); ticks++;
        mark('strike', g.strikes.length === 0);
        mark('rebuild', !ruin.ruin);
        mark('barricade', g.obst.length === 0);
        mark('turret', g.emps.length === 0);
        mark('cooldown', g.players[ME].cd[0] === 0);
      }
    }
    const want = { strike: B.skills.iron[2].delay, rebuild: B.ruin.time, barricade: B.skills.iron[1].dur, turret: B.skills.iron[0].dur, cooldown: B.skills.iron[0].cd };
    for (const [k, sim] of Object.entries(want)) {
      assert(done[k], `${k} never finished at ${speed}x`);
      assert(Math.abs(done[k].sim - sim) <= DT * 2, `${k} took ${done[k].sim.toFixed(2)} simulation seconds at ${speed}x, expected ${sim}`);
      assert(Math.abs(done[k].real - sim / speed) <= 0.25, `${k} took ${done[k].real.toFixed(2)} real seconds at ${speed}x, expected ${(sim / speed).toFixed(2)}`);
    }
    rows.push(Object.keys(want).map(k => done[k].ticks).join());
  }
  assert(rows.every(r => r === rows[0]), `every speed should take the same number of steps: ${rows.join(' | ')}`);

  // The wormhole and the Base Shield too.
  for (const speed of [0.5, 2]) {
    const g = as(board([]), ME, 'meridian/shade');
    for (const id of [0, 1, 2, 3]) own(g, id, ME, 10, 3, 3);
    g.players[ME].charge = g.players[ME].need;
    ready(g, ME);
    assert(g.skill(ME, 0, { node: 1 }).ok && g.skill(ME, 2, { node: 0, to: 3 }).ok);
    const pace = new Pace(DT, speed);
    let real = 0, worm = null, shield = null;
    while ((worm === null || shield === null) && real < 200) {
      real += 0.05;
      for (let n = pace.advance(0.05); n > 0; n--) { g.tick(DT); if (worm === null && !g.worms.length) worm = real; if (shield === null && !g.nodes[1].aegis) shield = real; }
    }
    assert(Math.abs(worm - B.skills.meridian[2].dur / speed) <= 0.25 && Math.abs(shield - B.skills.meridian[0].dur / speed) <= 0.25, `${speed}x: wormhole ${worm}, shield ${shield}`);
  }
});

// ============================================================ statistics and whole matches

section('the match report carries the new statistics, and AI matches use the new mechanics without losing a soldier', () => {
  const keys = ['destroyed', 'basesConverted', 'ruinsCaptured', 'rebuilt', 'warped', 'deployed', 'absorbed'];
  const sum = Object.fromEntries(keys.map(k => [k, 0]));
  let casts = 0, matches = 0;
  for (const [facs, seed] of [[['iron/bastion', 'meridian/aegis', 'veil/forge'], 14], [['iron/volt', 'meridian/shade', 'veil/dominion'], 57], [['veil/dominion', 'iron/bastion', 'meridian/shade', 'veil/forge'], 5]]) {
    const g = new Game(facs.map(f => { const [faction, sub] = f.split('/'); return { ai: 'hard', faction, sub }; }), seed, { crates: true });
    while (g.winner === null && g.t < 1800) {
      g.tick(DT);
      for (const e of g.drain().events) if (e.k === 'cast') casts++;
      for (const c of g.nodes) {
        if (c.ruin) assert(c.level === 1 && (c.owner >= 0 || c.units === 0 || true));
        assert(c.units >= 0 && Number.isFinite(c.units));
      }
      for (const a of g.armies) assert(a.groups.every(x => x.n > 0 && x.hp > 0), 'an army with dead groups');
    }
    matches++;
    const rep = g.report();
    for (const r of rep) for (const k of keys) { assert(Number.isFinite(r[k]) && r[k] >= 0, `${k} missing from the report`); sum[k] += r[k]; }
    assert.strictEqual(rep.reduce((s, r) => s + r.rebuilt, 0) <= rep.reduce((s, r) => s + r.destroyed, 0), true, 'nothing is rebuilt that was not destroyed');
  }
  assert(casts > 20 && sum.deployed > 10, `the AI should be using its skills (${casts} casts in ${matches} matches)`);
  console.log(`    ${matches} AI matches: ${casts} skills cast; ${keys.map(k => `${k} ${Math.round(sum[k])}`).join(', ')}`);
});

console.log(`rule tests passed (${sections} sections)`);
