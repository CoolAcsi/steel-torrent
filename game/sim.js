'use strict';
// Authoritative match simulation.
//
// Core loop: cities produce soldiers -> soldiers are dispatched along roads as
// armies -> hostile armies that meet on a road fight there -> survivors reach
// a city and reinforce it or besiege it -> an emptied city is captured.
//
// Troops are tracked as groups { f, sub, t, n, hp, cv } (faction, subfaction,
// tier, soldier count, total remaining health, converted flag) rather than one
// object per soldier. Field battles and city battles run through the same
// `fight` routine; a city only adds explicit modifiers (wall bonus, shield).
//
// Everything is deterministic for a given seed and command sequence: all
// iteration is in id order and all randomness comes from the seeded generator.
const { BALANCE: B } = require('./config');
const { generateMap, mulberry32 } = require('./mapgen');
const { AIPlayer } = require('./ai');

const C = B.combat;
const FACTION_IDS = Object.keys(B.factions).filter(f => f !== 'neutral');
const EPS = 1e-6;

// ------------------------------------------------------------ unit stats

const mitigation = armor => armor / (armor + C.armorK);
const statMemo = new Map();
let BASE_RATING = 1;

/**
 * Stats of one unit of roster (faction, subfaction, tier), straight from the configuration,
 * plus `dps` and `rating`: its combat power relative to a neutral tier-1 soldier.
 */
function unitStats(f, sub, t) {
  const key = `${f}|${sub}|${t}`;
  let s = statMemo.get(key);
  if (s) return s;
  const fac = B.factions[f];
  const u = (fac.subs[sub] || fac.subs[Object.keys(fac.subs)[0]]).units[t];
  const dps = u.atk / u.interval;
  s = {
    ...u, dps, vs: u.vs || {}, prefer: u.prefer || {},
    rating: Math.sqrt((dps * u.hp) / (1 - mitigation(u.armor))) / BASE_RATING,
  };
  statMemo.set(key, s);
  return s;
}
BASE_RATING = unitStats('neutral', '', 1).rating;
statMemo.clear();

// ------------------------------------------------------------ troop groups

const sameKind = (a, b) => a.f === b.f && a.sub === b.sub && a.t === b.t && !!a.cv === !!b.cv;
const countOf = groups => { let n = 0; for (const g of groups) n += g.n; return n; };
const hpOf = groups => { let h = 0; for (const g of groups) h += g.hp; return h; };

/** Combat power from actual composition and remaining health (not head count). */
function powerOf(groups) {
  let p = 0;
  for (const g of groups) {
    const s = unitStats(g.f, g.sub, g.t);
    p += (g.hp / s.hp) * s.rating;
  }
  return p;
}

function makeGroup(f, sub, t, n) {
  return { f, sub, t, n, hp: n * unitStats(f, sub, t).hp, cv: false };
}

function mergeInto(groups, add) {
  for (const a of add) {
    if (a.n <= 0) continue;
    const g = groups.find(x => sameKind(x, a));
    if (g) { g.n += a.n; g.hp += a.hp; } else groups.push({ ...a });
  }
}

function prune(groups) {
  for (let i = groups.length - 1; i >= 0; i--) if (groups[i].n <= 0) groups.splice(i, 1);
}

/**
 * Remove `n` soldiers, spread across groups in proportion to their size
 * (largest remainder, ties to the earlier group). Each soldier leaves with the
 * group's average health, so nothing is healed or lost. Returns the removed groups.
 */
function takeSoldiers(groups, n) {
  const total = countOf(groups);
  n = Math.min(Math.floor(n), total);
  if (n <= 0) return [];
  const want = groups.map(g => (g.n * n) / total);
  const take = want.map(Math.floor);
  let rest = n - take.reduce((a, b) => a + b, 0);
  const order = groups.map((_, i) => i).sort((a, b) => (want[b] - take[b]) - (want[a] - take[a]) || a - b);
  for (const i of order) {
    if (!rest) break;
    if (take[i] < groups[i].n) { take[i]++; rest--; }
  }
  const out = [];
  groups.forEach((g, i) => {
    const k = take[i];
    if (!k) return;
    const hp = (g.hp * k) / g.n;
    g.n -= k;
    g.hp -= hp;
    out.push({ f: g.f, sub: g.sub, t: g.t, cv: g.cv, n: k, hp });
  });
  prune(groups);
  return out;
}

/** Apply health loss to one group. Returns { eff, lost }: damage that landed and soldiers killed. */
function wound(g, dmg) {
  const eff = Math.min(g.hp, dmg);
  const before = g.n;
  g.hp -= eff;
  if (g.hp <= EPS) { g.hp = 0; g.n = 0; } else g.n = Math.ceil(g.hp / unitStats(g.f, g.sub, g.t).hp - 1e-9);
  return { eff, lost: before - g.n };
}

// ------------------------------------------------------------ combat

/**
 * One step of battle between `units`:
 *   { owner, groups, atkMult, takeMult, shield, inCity, since, shooters }
 * Units with different owners are hostile. All damage is computed from the
 * state at the start of the step and then applied, so the result does not
 * depend on the order of `units`.
 *
 * Everything is worked out per troop group from its own roster stats: nothing
 * is averaged across unlike troops, and nothing depends on how an army is drawn.
 *
 * Targeting: a group's damage is shared across every hostile group in
 * proportion to head count times the attacker's preference for that class.
 * Against each target it is scaled by the attacker's `vs` profile (and by
 * `vs.city` for troops standing in a city, by `combat.noAA` against aircraft
 * it cannot aim at), then by the target's armour.
 * `shooters` limits who fires (ranged exchanges before armies lock); everyone
 * in `groups` can still be hit. `since` is how long this unit has been in the
 * fight, for opening and spin-up traits.
 * Casualties: a group's soldier count is its remaining health divided by
 * per-soldier health, rounded up.
 */
function fight(units, dt, stats) {
  const inc = units.map(u => u.groups.map(() => 0));
  const by = units.map(u => u.groups.map(() => null));
  for (let a = 0; a < units.length; a++) {
    const U = units[a];
    let T = 0;
    for (const V of units) if (V.owner !== U.owner) for (const g of V.groups) T += g.n;
    if (T <= 0) continue;
    const sideMult = (U.atkMult || 1) * C.speed * dt;
    const since = U.since || 0;
    for (const ag of U.shooters || U.groups) {
      if (ag.n <= 0) continue;
      const st = unitStats(ag.f, ag.sub, ag.t);
      let out = ag.n * st.dps * sideMult;
      if (st.arc && T >= st.arc.min) out *= st.arc.bonus;
      if (st.opening && since < st.opening.dur) out *= st.opening.bonus;
      if (st.spinup) out *= 1 + (st.spinup.max - 1) * Math.min(1, since / st.spinup.dur);
      // Share of fire: head count x preference for the target's class.
      let W = 0;
      for (const V of units) {
        if (V.owner === U.owner) continue;
        for (const g of V.groups) if (g.n > 0) W += g.n * (st.prefer[unitStats(g.f, g.sub, g.t).cls] || 1);
      }
      if (W <= 0) continue;
      for (let v = 0; v < units.length; v++) {
        const V = units[v];
        if (V.owner === U.owner) continue;
        for (let k = 0; k < V.groups.length; k++) {
          const g = V.groups[k];
          if (g.n <= 0) continue;
          const ts = unitStats(g.f, g.sub, g.t);
          let m = st.vs[ts.cls] == null ? 1 : st.vs[ts.cls];
          if (ts.cls === 'air' && !st.aa) m *= C.noAA;
          if (V.inCity && st.vs.city != null) m *= st.vs.city;
          if (m <= 0) continue;
          const armor = (ts.armor + (V.inCity && ts.cityArmor ? ts.cityArmor : 0)) * (st.pierce || 1);
          const d = out * ((g.n * (st.prefer[ts.cls] || 1)) / W) * m * (1 - mitigation(armor)) * (V.takeMult == null ? 1 : V.takeMult);
          inc[v][k] += d;
          (by[v][k] || (by[v][k] = new Map())).set(U.owner, (by[v][k].get(U.owner) || 0) + d);
        }
      }
    }
  }
  for (let v = 0; v < units.length; v++) {
    const V = units[v];
    for (let k = 0; k < V.groups.length; k++) {
      let d = inc[v][k];
      if (d <= 0) continue;
      const total = d;
      if (V.shield && V.shield.hp > 0) {                 // shields soak damage before troops do
        const soak = Math.min(V.shield.hp, d);
        V.shield.hp -= soak;
        d -= soak;
        if (stats && V.shield.by != null && stats[V.shield.by]) stats[V.shield.by].absorbed += soak;
      }
      if (d <= 0) continue;
      const r = wound(V.groups[k], d);
      if (stats) {
        if (stats[V.owner]) { stats[V.owner].taken += r.eff; stats[V.owner].losses += r.lost; }
        for (const [o, c] of by[v][k]) {
          if (!stats[o]) continue;
          stats[o].dealt += (r.eff * c) / total;         // effective damage only: no overkill, no shield soak
          stats[o].kills += (r.lost * c) / total;
        }
      }
    }
    prune(V.groups);
  }
}

/** The longest reach in a set of groups, and the groups that can fire across `gap`. */
const reachOf = groups => { let r = 0; for (const g of groups) if (g.n > 0) r = Math.max(r, unitStats(g.f, g.sub, g.t).range); return r; };
const inRange = (groups, gap) => groups.filter(g => g.n > 0 && unitStats(g.f, g.sub, g.t).range >= gap);

/**
 * Out-of-battle upkeep on one body of troops: self-repair (`regen`, only at rest) and field
 * repair of wounded vehicles (`repair`, any time). Restores health only: a group can never
 * exceed full health for its head count, so nobody comes back from the dead.
 */
function mend(groups, dt, resting) {
  let pool = 0;
  for (const g of groups) {
    const st = unitStats(g.f, g.sub, g.t);
    if (st.repair) pool += g.n * st.repair * dt;
    if (st.regen && resting) g.hp = Math.min(g.n * st.hp, g.hp + g.n * st.regen * dt);
  }
  if (pool <= 0) return;
  for (const g of groups) {
    if (pool <= 0) break;
    const st = unitStats(g.f, g.sub, g.t);
    if (st.cls !== 'veh') continue;
    const heal = Math.min(pool, g.n * st.hp - g.hp);
    if (heal > 0) { g.hp += heal; pool -= heal; }
  }
}

// ------------------------------------------------------------ game

function newStats() {
  return {
    produced: 0, granted: 0, converted: 0, lostToConversion: 0, kills: 0, losses: 0,
    dealt: 0, taken: 0, captured: 0, lost: 0, peak: 1, level3: 0, encWon: 0, encLost: 0,
    basic: 0, supers: 0, crates: 0, rewards: {},
    // bases destroyed by my nuclear strikes / taken by my mind control, ruins I captured and rebuilt,
    // soldiers I sent through wormholes, emplacements and obstacles I placed, damage my Base Shields soaked
    destroyed: 0, basesConverted: 0, ruinsCaptured: 0, rebuilt: 0, warped: 0, deployed: 0, absorbed: 0,
  };
}

/** Why a source city was left out of a dispatch order. */
const REJECT = { notYours: 1, noTroops: 2, noRoute: 3, isTarget: 4, paused: 5, full: 6 };

/** What a persistent order is doing. */
const AUTO = { active: 0, troops: 1, blocked: 2, siege: 3, full: 4 };

class Game {
  /**
   * @param players [{ ai, faction, sub }]
   * @param seed
   * @param opts    { crates: bool, map }   `map` replaces the generated battlefield with a hand-made one
   *                (tutorial lessons): { w, h, nodes: [[x, y, owner, level, soldiers], ...], edges: [[a, b], ...] }
   */
  constructor(players, seed, opts = {}) {
    this.rng = mulberry32(seed >>> 0);
    this.np = players.length;
    this.opts = { crates: !!opts.crates };
    const m = opts.map ? {
      w: opts.map.w, h: opts.map.h, edges: opts.map.edges.map(e => [e[0], e[1]]),
      nodes: opts.map.nodes.map((n, id) => ({ id, x: n[0], y: n[1], owner: n[2] == null ? -1 : n[2], level: n[3] || 1, units: n[4] || 0 })),
    } : generateMap(this.np, this.rng);
    this.w = m.w;
    this.h = m.h;
    this.edges = m.edges;
    this.nodes = m.nodes;
    this.adj = this.nodes.map(() => new Set());
    for (const [a, b] of m.edges) { this.adj[a].add(b); this.adj[b].add(a); }

    this.players = players.map((p, i) => {
      const faction = B.factions[p.faction] && p.faction !== 'neutral' ? p.faction : FACTION_IDS[i % FACTION_IDS.length];
      const subs = Object.keys(B.factions[faction].subs);
      return {
        faction, sub: subs.includes(p.sub) ? p.sub : subs[0],
        cd: [B.skills.basicInitialCd, B.skills.basicInitialCd],
        charge: 0, need: B.skills.superInitialCharge,
        surgeUntil: 0,
        seen: new Set(), seenOrder: [],
        results: new Map(),   // command id -> per-source answer, so a retried order gets the same reply
      };
    });

    for (const n of this.nodes) {
      const count = n.units;
      delete n.units;
      const pl = n.owner >= 0 ? this.players[n.owner] : null;
      n.groups = count > 0 ? [pl ? makeGroup(pl.faction, pl.sub, 1, count) : makeGroup('neutral', '', n.level, count)] : [];
      n.acc = 0;            // production progress toward the next soldier
      n.cd = 0;             // city ability cooldown
      n.shield = null;      // { hp, until }
      n.siege = [];         // armies fighting at this city
      n.guards = [];        // the owner's routed armies standing with the garrison while it is besieged
      n.ruin = false;       // destroyed by a nuclear strike: neutral, produces nothing, no abilities, roads intact
      n.rebuild = null;     // { t0, until, by } while a ruin is being rebuilt
      n.aegis = null;       // a cast Base Shield { hp, max, until, by }
      n.siegeSince = 0;
      Object.defineProperty(n, 'units', { get() { return countOf(this.groups); } });
    }

    this.t = 0;
    this.armies = [];
    this.nextId = 1;
    this.nextOrder = 1;     // one per accepted dispatch command, shared by every army it created
    this.paused = false;    // a paused match does not advance and accepts no orders
    this.ownerRev = 0;      // counts city captures: routes are only planned again when this moves
    this.autos = new Map(); // autoKey(src, dest) -> persistent order { src, owner, dest, pct, next, state }
    this.autoRR = new Map();// source city -> round-robin offset when parallel routes share limited troops
    this.emps = [];         // temporary emplacements beside bases (turret, slow, psi)
    this.obst = [];         // obstacles on roads (block, mire)
    this.worms = [];        // open wormholes
    this.topoRev = 0;       // counts changes to how cities are connected (obstacles, wormholes): routes are looked at again
    this.featRev = 0;       // counts changes to anything in features(): clients are told
    this.strikes = [];      // delayed area effects
    this.hazards = [];      // lingering zones
    this.crates = [];
    this.nextCrate = B.crates.firstAt;
    this.alive = players.map(() => true);
    this.winner = null;
    this.stats = players.map(() => newStats());
    this.ais = players.map((p, i) => (p.ai ? new AIPlayer(i, p.ai, this.rng) : null));
    this.outEvents = [];
  }

  // -------------------------------------------------- queries

  setAI(pi, level) { this.ais[pi] = level ? new AIPlayer(pi, level, this.rng) : null; }
  drain() { const events = this.outEvents; this.outEvents = []; return { events }; }
  stat(g) { return unitStats(g.f, g.sub, g.t); }
  power(groups) { return powerOf(groups); }
  dist(a, b) { return Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].y - this.nodes[b].y); }
  level3Count(pi) { let n = 0; for (const c of this.nodes) if (c.owner === pi && c.level === 3) n++; return n; }
  superReady(pi) { const p = this.players[pi]; return this.level3Count(pi) >= B.skills.superNeedsL3 && p.charge >= p.need; }

  /** World position of an army. */
  pos(a) {
    const A = this.nodes[a.from], Z = this.nodes[a.to], f = a.L > 0 ? a.s / a.L : 0;
    return { x: A.x + (Z.x - A.x) * f, y: A.y + (Z.y - A.y) * f };
  }

  /** Distance from the lower-numbered end of the road: a shared coordinate for armies on the same road. */
  roadX(a) { return a.from < a.to ? a.s : a.L - a.s; }

  baseSpeed(a) {
    let m = Infinity;
    for (const g of a.groups) m = Math.min(m, unitStats(g.f, g.sub, g.t).move);
    return B.march.speed * (m === Infinity ? 1 : m);
  }

  /** How many soldiers one order sends from a garrison of `total`. */
  dispatchCount(total, pct) {
    pct = Math.max(0.05, Math.min(1, Number(pct) || 0.5));
    let n = Math.floor(total * pct);
    if (n < 1 && total >= 1) n = 1;
    return Math.max(0, Math.min(n, total - B.dispatch.minGarrison));
  }

  /** True the first time a command id is seen for this player: retried or duplicated messages are ignored. */
  fresh(pi, cmdId) {
    if (cmdId == null) return true;
    const p = this.players[pi];
    if (p.seen.has(cmdId)) return false;
    p.seen.add(cmdId);
    p.seenOrder.push(cmdId);
    if (p.seenOrder.length > 512) p.seen.delete(p.seenOrder.shift());
    return true;
  }

  // -------------------------------------------------- cities

  /** Most soldiers this city's garrison may hold. It limits friendly reinforcement only: a full city still sends troops out, and an attacker is never turned away. */
  capOf(c) {
    if (c.ruin) return B.ruin.capacity;
    const L = B.levels[c.level];
    return L.cap || L.threshold * B.capacity.mult;
  }

  /**
   * Soldiers of player `pi` already on their way to join this city's garrison. Their places
   * are reserved simply by their being counted here, so a reservation can never leak: it is
   * gone the moment the army is redirected, held, loses troops or dies.
   */
  incoming(c, pi, except) {
    let n = 0;
    for (const a of this.armies) if (a !== except && a.owner === pi && a.dest === c.id && !a.hold && a.groups.length) n += a.n;
    return n;
  }

  /** Places still free for player `pi`'s reinforcements, after the garrison and everything already coming. */
  room(c, pi, except) {
    return Math.max(0, this.capOf(c) - c.units - this.incoming(c, pi, except));
  }

  /** An army joins a friendly garrison as far as the capacity allows. True if all of it went in. */
  enter(a, c) {
    const room = this.capOf(c) - c.units;
    if (room >= a.n) { mergeInto(c.groups, a.groups); a.groups = []; return true; }
    if (room >= 1) mergeInto(c.groups, takeSoldiers(a.groups, Math.floor(room)));
    return a.groups.length === 0;
  }

  /**
   * Everything that goes with a city changing hands, however it happens (capture, mind
   * control, destruction): ability state resets, the old owner's Base Shield and temporary
   * emplacements end, a rebuild in progress is abandoned, and routes are looked at again.
   */
  handOver(c, by) {
    c.owner = by;
    c.acc = 0;
    c.cd = 0;
    c.shield = null;
    c.aegis = null;
    c.rebuild = null;
    c.siegeSince = 0;
    const gone = this.emps.filter(e => e.node === c.id);
    if (gone.length) this.emps = this.emps.filter(e => e.node !== c.id);
    this.ownerRev++;
  }

  /**
   * A superweapon took this base from `prev`: every persistent order that involved it ends,
   * the ones that sent troops from it and `prev`'s own orders that sent troops to it.
   */
  dropAutos(c, prev) {
    for (const [key, o] of [...this.autos]) {
      if (o.src !== c.id && !(o.dest === c.id && o.owner === prev)) continue;
      this.autos.delete(key);
      this.outEvents.push({ k: 'auto', p: o.owner, src: o.src, why: o.src === c.id ? 'lost' : 'dest' });
    }
  }

  // -------------------------------------------------- commands

  newArmy(owner, from, to, groups, s = 0) {
    const a = {
      id: this.nextId++, owner, from, to, s, L: this.dist(from, to), groups,
      state: 'march', v: 0, slow: 1, weak: 1,
      buff: { speed: 0, armor: 0, atk: 0 },
      // Orders. `to` is only the next waypoint; `dest` is where the army was sent and never changes
      // unless its route is lost. `path` lists the cities still to come after `to`, ending in `dest`.
      dest: to, path: [], src: from, cmd: null, order: 0, topo: this.topoRev,
    };
    Object.defineProperty(a, 'n', { get() { return countOf(this.groups); } });
    this.armies.push(a);
    return a;
  }

  /** The active wormhole of player `pi` linking cities u and v that can still carry `n` soldiers, if any. */
  wormOn(pi, u, v, n = 0) {
    for (const w of this.worms) {
      if (w.owner === pi && ((w.a === u && w.b === v) || (w.a === v && w.b === u)) && w.left >= Math.max(1, n)) return w;
    }
    return null;
  }

  /** Extra planning cost of road u-v for player `pi`: hostile obstacles standing on it. */
  edgePenalty(pi, u, v) {
    let p = 0;
    const lo = Math.min(u, v), hi = Math.max(u, v);
    for (const o of this.obst) if (o.owner !== pi && o.lo === lo && o.hi === hi) p += o.def.detour;
    return p;
  }

  /**
   * Shortest route for player `pi` from city `from` to city `to`, or null.
   *
   * Traversal rule: an army may march THROUGH only cities its owner holds.
   * The last city may belong to anyone: friendly is reinforced, anything else
   * is attacked. Hostile and neutral cities (ruins included) are never passed
   * through, so a route can never skip a fight.
   *
   * Besides roads, the player's own active wormhole is an edge (if it can
   * still carry `n` soldiers), and a hostile obstacle on a road makes that
   * road cost more, so a route goes round it when a comparable way exists.
   * Ties are broken by city number, which makes the result independent of the
   * order roads were generated in.
   */
  route(pi, from, to, n = 0) {
    const N = this.nodes.length;
    if (from === to || !this.nodes[from] || !this.nodes[to]) return null;
    const cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    cost[from] = 0;
    const relax = (u, v, c) => {
      if (done[v]) return;
      if (c < cost[v] - 1e-9 || (Math.abs(c - cost[v]) <= 1e-9 && u < prev[v])) { cost[v] = c; prev[v] = u; }
    };
    for (;;) {
      let u = -1;
      for (let i = 0; i < N; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
      if (u < 0) return null;
      if (u === to) break;
      done[u] = 1;
      if (u !== from && this.nodes[u].owner !== pi) continue;
      for (const v of this.adj[u]) relax(u, v, cost[u] + this.dist(u, v) + (this.obst.length ? this.edgePenalty(pi, u, v) : 0));
      for (const w of this.worms) {
        if (w.owner !== pi || w.left < Math.max(1, n)) continue;
        if (w.a === u) relax(u, w.b, cost[u] + w.def.cost); else if (w.b === u) relax(u, w.a, cost[u] + w.def.cost);
      }
    }
    const path = [];
    for (let u = to; u >= 0; u = prev[u]) path.push(u);
    return { path: path.reverse(), cost: cost[to] };
  }

  /** Can an army of `n` belonging to `pi` get from city u to the next city v on its path: a road, or its own open wormhole? */
  hopOk(pi, u, v, n) {
    return this.adj[u].has(v) || !!this.wormOn(pi, u, v, n);
  }

  /**
   * One order from any number of the player's cities to one destination.
   *
   * Every source is judged on its own and plans its own route to the SAME
   * destination; the destination is never replaced and a source that is not
   * next to it is not dropped. For each accepted source the troops leave the
   * garrison and the army appears in the same call, so nothing is ever
   * deducted without an army to show for it. Rejected sources lose nothing.
   *
   * A friendly destination accepts reinforcements only up to its capacity,
   * counting everything already on its way there. If only part of a source's
   * share fits, only that part is sent and the rest stays at home.
   *
   * Returns the armies created. `.results` lists every source:
   *   [city, soldiers, hops]   accepted
   *   [city, -reason]          rejected, see REJECT
   * A repeated command id creates nothing and returns the first answer (`.dup`).
   */
  send(pi, fromIds, toId, pct, cmdId) {
    const made = [];
    made.results = [];
    if (this.winner !== null || !this.alive[pi] || !Array.isArray(fromIds)) return made;
    if (this.paused) { made.paused = true; return made; }
    const dst = this.nodes[toId];
    if (!dst) return made;
    const p = this.players[pi];
    if (!this.fresh(pi, cmdId)) {
      made.dup = true;
      made.results = (cmdId != null && p.results.get(cmdId)) || [];
      return made;
    }
    const order = this.nextOrder++;
    for (const id of new Set(fromIds.slice(0, this.nodes.length))) {
      const src = this.nodes[id];
      if (src === dst) { made.results.push([id, -REJECT.isTarget]); continue; }
      if (!src || src.owner !== pi) { made.results.push([id, -REJECT.notYours]); continue; }
      if (!this.route(pi, src.id, dst.id)) { made.results.push([id, -REJECT.noRoute]); continue; }
      let n = this.dispatchCount(src.units, pct);
      if (n < 1) { made.results.push([id, -REJECT.noTroops]); continue; }
      if (dst.owner === pi) {                               // reinforcing: only what the destination can still take
        n = Math.min(n, Math.floor(this.room(dst, pi)));
        if (n < 1) { made.results.push([id, -REJECT.full]); continue; }
      }
      const r = this.route(pi, src.id, dst.id, n);
      if (!r) { made.results.push([id, -REJECT.noRoute]); continue; }
      const a = this.launch(pi, src.id, r.path, takeSoldiers(src.groups, n));
      a.cmd = cmdId == null ? null : cmdId;
      a.order = order;
      made.push(a);
      made.results.push([id, n, r.path.length - 1]);
    }
    this.remember(p, cmdId, made.results);
    return made;
  }

  /** Put `groups` on the road from `src` along `path` ([src, ..., dest]). A first hop through a wormhole happens at once. */
  launch(pi, src, path, groups) {
    const a = this.newArmy(pi, src, path[1], groups);
    a.dest = path[path.length - 1];
    a.path = path.slice(2);
    const w = this.wormOn(pi, src, path[1], a.n);
    if (w) this.warp(a, w);
    return a;
  }

  /**
   * Carry army `a`, standing at one end of wormhole `w` and bound for the other, across in a
   * single step. It keeps its composition, health, buffs and orders. If it is travelling on,
   * it leaves the far city by its next road as a transit army; if the far city is where it was
   * going, it arrives at that city's gate and joins the garrison by the usual rules.
   */
  warp(a, w) {
    const out = a.to, n = a.n;
    w.left -= n;
    this.featRev++;                                         // clients show what the wormhole can still carry
    a.warped = w.id;
    this.stats[a.owner].warped += n;
    this.outEvents.push({ k: 'warp', p: a.owner, from: a.from, to: out, n });
    if (a.path.length) {
      a.from = out;
      a.to = a.path.shift();
      a.L = this.dist(a.from, a.to);
      a.s = 0;
    } else {
      a.from = Math.min(...this.adj[out]);                  // it appears at the gate facing the city's first road
      a.to = out;
      a.L = this.dist(a.from, a.to);
      a.s = a.L - B.march.arriveAt;
    }
  }

  /**
   * Keep routed armies on a valid route. An army is replanned only when a
   * city it still has to pass through is no longer its owner's, a hop of its
   * route no longer exists (a wormhole closed), or the map's connections
   * changed (an obstacle or wormhole appeared or went). A valid route is never
   * otherwise second-guessed, so there is nothing to oscillate between.
   *
   * It replans from where it stands: onward through the city ahead, or by
   * turning round on its road, whichever is shorter, always to the same
   * destination. If there is no route it WAITS where it stands (it can still
   * be attacked there) and looks again each time something changes. Only when
   * it has waited `route.waitMax` seconds does the order end:
   *   hold  the city ahead is still friendly: garrison it
   *   back  only the city behind is friendly: return to it
   *   cut   neither is: attack the city ahead (the normal rule for arriving at a hostile city)
   * The owner is told at every step.
   */
  reroute() {
    const t = this.t, rev = this.ownerRev + this.topoRev;
    for (const a of this.armies) {
      if (a.groups.length === 0 || a.state === 'siege' || a.state === 'guard' || a.hold) continue;
      if (a.waiting) {
        if (a.waiting.rev !== rev) {                         // something changed: is there a way now?
          a.waiting.rev = rev;
          if (this.replan(a)) {
            a.waiting = null;
            this.outEvents.push({ k: 'route', p: a.owner, why: 'go', node: a.to, dest: a.dest });
            continue;
          }
        }
        if (t >= a.waiting.until) { a.waiting = null; this.endOrder(a); }
        continue;
      }
      if (!a.path.length) continue;
      const own = id => this.nodes[id].owner === a.owner;
      let valid = own(a.to) && this.hopOk(a.owner, a.to, a.path[0], a.n);
      for (let i = 0; valid && i < a.path.length - 1; i++) valid = own(a.path[i]) && this.hopOk(a.owner, a.path[i], a.path[i + 1], a.n);
      if (valid && a.topo === this.topoRev) continue;
      a.topo = this.topoRev;
      const before = `${a.from},${a.to},${a.path}`;
      if (this.replan(a)) {
        if (`${a.from},${a.to},${a.path}` !== before) this.outEvents.push({ k: 'route', p: a.owner, why: 're', node: a.to, dest: a.dest });
        continue;
      }
      a.waiting = { until: t + B.route.waitMax, rev };
      a.path = [];                                           // the destination is kept, the stale route is not
      this.outEvents.push({ k: 'route', p: a.owner, why: 'wait', node: a.to, dest: a.dest });
    }
  }

  /** Plan army `a` a route to its destination from where it stands. Returns false if there is none. */
  replan(a) {
    const own = id => this.nodes[id].owner === a.owner;
    const leg = id => (id === a.dest ? { path: [id], cost: 0 } : own(id) ? this.route(a.owner, id, a.dest, a.n) : null);
    const fwd = leg(a.to), back = leg(a.from);
    const cf = fwd ? a.L - a.s + fwd.cost : Infinity, cb = back ? a.s + back.cost : Infinity;
    if (cf === Infinity && cb === Infinity) return false;
    if (cf <= cb) a.path = fwd.path.slice(1);
    else { this.turn(a); a.path = back.path.slice(1); }
    return true;
  }

  /** About-face on the same road: the army does not move, only its heading changes. */
  turn(a) { const t = a.from; a.from = a.to; a.to = t; a.s = a.L - a.s; }

  /** A route never came back: finish the order at the nearest sensible place. */
  endOrder(a) {
    const own = id => this.nodes[id].owner === a.owner;
    let why = 'cut';
    if (own(a.to)) why = 'hold';
    else if (own(a.from)) { this.turn(a); why = 'back'; }
    a.dest = a.to;
    a.path = [];
    this.outEvents.push({ k: 'route', p: a.owner, why, node: a.to, dest: a.dest });
  }

  /**
   * Cancel a marching army's order. It stops where it stands and holds: its place at its
   * destination is released, it can still be attacked, and it waits for a new order.
   * Nobody is deleted or moved.
   */
  halt(pi, armyId, cmdId) {
    if (this.winner !== null || this.paused) return { ok: false, why: this.paused ? 'paused' : 'dead' };
    const p = this.players[pi];
    if (cmdId != null && p.seen.has(cmdId)) return { ok: false, why: 'duplicate' };
    const a = this.armies.find(x => x.id === armyId);
    if (!a || a.owner !== pi || a.state === 'siege' || a.state === 'guard' || a.hold || !a.groups.length) return { ok: false, why: 'target' };
    this.fresh(pi, cmdId);
    a.hold = true;
    a.waiting = null;
    a.queue = false;
    a.path = [];
    a.dest = a.to;
    this.outEvents.push({ k: 'route', p: pi, why: 'held', node: a.to, dest: a.dest });
    return { ok: true };
  }

  /**
   * Give one of your armies on the road a new destination (a held army, one waiting outside
   * a full city, or any army that is not locked in a siege). It plans from where it stands.
   */
  redirect(pi, armyId, toId, cmdId) {
    if (this.winner !== null || this.paused) return { ok: false, why: this.paused ? 'paused' : 'dead' };
    const p = this.players[pi];
    if (cmdId != null && p.seen.has(cmdId)) return { ok: false, why: 'duplicate' };
    const a = this.armies.find(x => x.id === armyId);
    if (!a || a.owner !== pi || a.state === 'siege' || a.state === 'guard' || !a.groups.length || !this.nodes[toId]) return { ok: false, why: 'target' };
    const keep = { dest: a.dest, path: a.path };
    a.dest = toId;
    if (!this.replan(a)) { a.dest = keep.dest; a.path = keep.path; return { ok: false, why: 'noRoute' }; }
    this.fresh(pi, cmdId);
    a.hold = false;
    a.queue = false;
    a.waiting = null;
    a.topo = this.topoRev;
    this.outEvents.push({ k: 'route', p: pi, why: 'new', node: a.to, dest: a.dest });
    return { ok: true };
  }

  // -------------------------------------------------- persistent orders

  autoKey(src, dest) { return src * 10000 + dest; }

  /** Directed road segments `[u, v]` traversed by player `pi`'s route from `src` to `dest`. */
  autoLegs(pi, src, dest) {
    const r = this.route(pi, src, dest);
    const legs = [];
    if (r && r.path.length >= 2) {
      for (let i = 0; i + 1 < r.path.length; i++) legs.push([r.path[i], r.path[i + 1]]);
    } else if (this.adj[src] && this.adj[src].has(dest)) {
      legs.push([src, dest]);
    }
    return legs;
  }

  /**
   * Enforce one-way-per-road-segment for player `pi`: any existing persistent order
   * traversing a road segment in the opposite direction of `src -> dest` is overwritten.
   */
  clearOppositeAutos(pi, src, dest) {
    const legs = this.autoLegs(pi, src, dest);
    if (!legs.length) return;
    const opp = new Set(legs.map(([u, v]) => `${v}|${u}`));
    const selfKey = this.autoKey(src, dest);
    for (const [key, o] of [...this.autos]) {
      if (o.owner !== pi || key === selfKey) continue;
      if (this.autoLegs(pi, o.src, o.dest).some(([u, v]) => opp.has(`${u}|${v}`))) {
        this.autos.delete(key);
      }
    }
  }

  /**
   * Tell cities to keep sending `pct` of their garrison to `toId` until told to stop.
   * Multiple routes from the same source city can run in parallel (keyed by src + dest),
   * while each road segment only carries one dispatch direction (newer orders overwrite opposite ones).
   * A destination that cannot be reached right now is accepted and waits, blocked, for a route.
   * Returns per-source results like send(): [city, 1] accepted, [city, -reason] rejected.
   */
  setAuto(pi, fromIds, toId, pct, cmdId) {
    const out = [];
    if (this.winner !== null || !this.alive[pi] || !Array.isArray(fromIds) || !this.nodes[toId]) return out;
    if (this.paused) { out.paused = true; return out; }
    const p = this.players[pi];
    if (!this.fresh(pi, cmdId)) { out.dup = true; return (cmdId != null && p.results.get(cmdId)) || out; }
    pct = Math.max(0.05, Math.min(1, Number(pct) || 0.5));
    for (const id of new Set(fromIds.slice(0, this.nodes.length))) {
      const src = this.nodes[id];
      if (id === toId) { out.push([id, -REJECT.isTarget]); continue; }
      if (!src || src.owner !== pi) { out.push([id, -REJECT.notYours]); continue; }
      this.clearOppositeAutos(pi, id, toId);
      this.autos.set(this.autoKey(id, toId), { src: id, owner: pi, dest: toId, pct, next: this.t, state: AUTO.active });
      out.push([id, 1]);
    }
    this.remember(p, cmdId, out);
    return out;
  }

  /**
   * Atomically set multiple [src, dest] persistent routes (used for chain drag a->b->c
   * and multi-target rally/attack scheduling). When `replace` is true, all previous
   * persistent routes of player `pi` are cleared first before installing the new ones.
   * Each road segment only carries one dispatch direction; newer routes overwrite opposite ones.
   * Returns [[src, 1 | -reason], ...].
   */
  setAutoPairs(pi, pairs, pct, cmdId, replace = false) {
    const out = [];
    if (this.winner !== null || !this.alive[pi] || !Array.isArray(pairs)) return out;
    if (this.paused) { out.paused = true; return out; }
    const p = this.players[pi];
    if (!this.fresh(pi, cmdId)) { out.dup = true; return (cmdId != null && p.results.get(cmdId)) || out; }
    if (replace) {
      for (const [key, o] of [...this.autos]) {
        if (o.owner === pi) {
          this.autos.delete(key);
          this.autoRR.delete(o.src);
        }
      }
    }
    pct = Math.max(0.05, Math.min(1, Number(pct) || 0.5));
    const seen = new Set();
    for (const pair of pairs.slice(0, 128)) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const id = pair[0] | 0, toId = pair[1] | 0;
      const key = this.autoKey(id, toId);
      if (seen.has(key)) continue;
      seen.add(key);
      const src = this.nodes[id], dst = this.nodes[toId];
      if (!dst) continue;
      if (id === toId) { out.push([id, -REJECT.isTarget]); continue; }
      if (!src || src.owner !== pi) { out.push([id, -REJECT.notYours]); continue; }
      this.clearOppositeAutos(pi, id, toId);
      this.autos.set(key, { src: id, owner: pi, dest: toId, pct, next: this.t, state: AUTO.active });
      out.push([id, 1]);
    }
    this.remember(p, cmdId, out);
    return out;
  }

  /**
   * Stop persistent orders of these cities. If `toId >= 0`, stops only the specific route
   * (src -> toId); otherwise stops all persistent routes starting at each city in `fromIds`.
   * Armies already marching keep their own orders.
   */
  clearAuto(pi, fromIds, cmdId, toId = -1) {
    const out = [];
    if (this.winner !== null || !Array.isArray(fromIds)) return out;
    if (this.paused) { out.paused = true; return out; }
    const p = this.players[pi];
    if (!this.fresh(pi, cmdId)) { out.dup = true; return (cmdId != null && p.results.get(cmdId)) || out; }
    const specific = Number.isInteger(toId) && toId >= 0;
    for (const id of new Set(fromIds.slice(0, this.nodes.length))) {
      if (specific) {
        const key = this.autoKey(id, toId);
        const o = this.autos.get(key);
        if (o && o.owner === pi) { this.autos.delete(key); out.push([id, 1]); }
        else out.push([id, -REJECT.notYours]);
      } else {
        let removed = 0;
        for (const [key, o] of [...this.autos]) {
          if (o.src === id && o.owner === pi) { this.autos.delete(key); removed++; }
        }
        if (removed) out.push([id, 1]); else out.push([id, -REJECT.notYours]);
      }
    }
    this.remember(p, cmdId, out);
    return out;
  }

  /**
   * Cancel dispatch along a specific directed road segment `u -> v` for player `pi`.
   * Orders starting at `u` along `u -> v` are removed; multi-hop orders passing through
   * `u -> v` are truncated to stop at `u` so upstream segments remain intact.
   */
  clearAutoSegment(pi, u, v, cmdId) {
    const out = [];
    if (this.winner !== null || !this.alive[pi]) return out;
    if (this.paused) { out.paused = true; return out; }
    const p = this.players[pi];
    if (!this.fresh(pi, cmdId)) { out.dup = true; return (cmdId != null && p.results.get(cmdId)) || out; }
    const removed = [];
    for (const [key, o] of [...this.autos]) {
      if (o.owner !== pi) continue;
      const legs = this.autoLegs(pi, o.src, o.dest);
      const hit = legs.some(([a, b]) => a === u && b === v) || (!legs.length && o.src === u && o.dest === v);
      if (!hit) continue;
      this.autos.delete(key);
      removed.push(o);
      out.push([o.src, 1]);
    }
    for (const o of removed) {
      if (o.src !== u && this.nodes[u] && this.nodes[u].owner === pi) {
        const keepKey = this.autoKey(o.src, u);
        if (!this.autos.has(keepKey)) {
          this.autos.set(keepKey, { src: o.src, owner: pi, dest: u, pct: o.pct, next: o.next, state: o.state });
        }
      }
    }
    if (!out.length) out.push([u, -REJECT.notYours]);
    this.remember(p, cmdId, out);
    return out;
  }

  /** Update the dispatch percentage on all active persistent orders of player `pi`. */
  setAutoPct(pi, pct) {
    if (this.winner !== null || !this.alive[pi]) return 0;
    pct = Math.max(0.05, Math.min(1, Number(pct) || 0.5));
    let n = 0;
    for (const o of this.autos.values()) {
      if (o.owner !== pi) continue;
      o.pct = pct;
      n++;
    }
    return n;
  }

  remember(p, cmdId, results) {
    if (cmdId == null) return;
    p.results.set(cmdId, results);
    if (p.results.size > 32) p.results.delete(p.results.keys().next().value);
  }

  /** A player's persistent orders as [source, destination, percent, state], sorted by source then destination. */
  autoList(pi) {
    const out = [];
    for (const o of this.autos.values()) if (o.owner === pi) out.push([o.src, o.dest, Math.round(o.pct * 100), o.state]);
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  /**
   * One step of every persistent order, grouped by source city in id order.
   * When a city has multiple parallel routes ready at once, its dispatch pool is split
   * evenly across them (rotating round-robin when troops are limited so no route starves).
   */
  runAuto() {
    if (!this.autos.size) return;
    const t = this.t, A = B.auto;
    const bySrc = new Map();
    for (const [key, o] of this.autos) {
      let list = bySrc.get(o.src);
      if (!list) bySrc.set(o.src, list = []);
      list.push([key, o]);
    }
    for (const id of [...bySrc.keys()].sort((a, b) => a - b)) {
      const entries = bySrc.get(id).sort((p, q) => p[1].dest - q[1].dest);
      const src = this.nodes[id];
      const lostOwners = new Set();
      const activeEntries = [];
      for (const [key, o] of entries) {
        if (src.owner !== o.owner || !this.alive[o.owner]) {
          this.autos.delete(key);
          lostOwners.add(o.owner);
        } else activeEntries.push(o);
      }
      for (const owner of lostOwners) this.outEvents.push({ k: 'auto', p: owner, src: id, why: 'lost' });
      if (!activeEntries.length) continue;

      const due = activeEntries.filter(o => t >= o.next);
      if (!due.length) continue;
      if (src.siege.some(a => a.groups.length > 0)) {
        for (const o of due) { o.state = AUTO.siege; o.next = t + A.retry; }
        continue;
      }
      const ready = [];
      for (const o of due) {
        if (!this.route(o.owner, id, o.dest)) { o.state = AUTO.blocked; o.next = t + A.retry; continue; }
        // A friendly destination takes reinforcements only up to its capacity: with no room, this route waits.
        const dst = this.nodes[o.dest];
        const room = dst.owner === o.owner ? Math.floor(this.room(dst, o.owner)) : Infinity;
        if (room < A.minDispatch) { o.state = AUTO.full; o.next = t + A.retry; continue; }
        ready.push({ o, room });
      }
      if (!ready.length) continue;

      // Send `n` soldiers for order `o`, by the route that can carry that many (a wormhole has a limit).
      const go = (o, n, orderId) => {
        const r = this.route(o.owner, id, o.dest, n);
        if (!r) { o.state = AUTO.blocked; o.next = t + A.retry; return; }
        const a = this.launch(o.owner, id, r.path, takeSoldiers(src.groups, n));
        a.order = orderId;
        a.auto = true;
        o.state = AUTO.active;
        o.next = t + A.interval;
      };

      if (ready.length === 1) {
        const { o, room } = ready[0];
        const n = Math.min(this.dispatchCount(src.units, o.pct), room);
        if (n < A.minDispatch) { o.state = AUTO.troops; o.next = t + A.retry; continue; }
        go(o, n, this.nextOrder++);
      } else {
        const maxPct = Math.max(...ready.map(x => x.o.pct));
        const pool = this.dispatchCount(src.units, maxPct);
        if (pool < A.minDispatch) {
          for (const { o } of ready) { o.state = AUTO.troops; o.next = t + A.retry; }
          continue;
        }
        const k = ready.length;
        const can = Math.min(k, Math.floor(pool / A.minDispatch));
        const rr = (this.autoRR.get(id) || 0) % k;
        const ordered = [];
        for (let i = 0; i < k; i++) ordered.push(ready[(rr + i) % k]);
        this.autoRR.set(id, (rr + can) % k);
        const base = Math.floor(pool / can), rem = pool % can;
        const orderId = this.nextOrder++;
        for (let i = 0; i < k; i++) {
          const { o, room } = ordered[i];
          if (i >= can) { o.state = AUTO.troops; o.next = t + A.retry; continue; }
          const share = Math.min(base + (i < rem ? 1 : 0), src.units - B.dispatch.minGarrison, room);
          if (share < 1) { o.state = AUTO.troops; o.next = t + A.retry; continue; }
          go(o, share, orderId);
        }
      }
    }
  }

  // -------------------------------------------------- upgrades and rebuilding

  upgrade(pi, id) {
    if (this.winner !== null || this.paused || !this.alive[pi]) return false;
    const n = this.nodes[id];
    if (!n || n.owner !== pi) return false;
    if (n.ruin) return this.rebuild(pi, id);
    if (n.level >= B.maxLevel) return false;
    const cost = B.levels[n.level].upCost;
    if (n.units < cost) return false;
    takeSoldiers(n.groups, cost);          // existing soldiers keep their tier; only new ones are better
    n.level++;
    n.cd = 0;
    n.shield = null;
    if (n.level === 3) this.stats[pi].level3++;
    this.outEvents.push({ k: 'up', node: n.id, level: n.level });
    return true;
  }

  /**
   * Start rebuilding a ruin you hold. It costs soldiers, like an upgrade, and takes
   * `ruin.time` simulation seconds; until it is done the ruin still produces nothing.
   * It comes back as a level-1 base: earlier upgrades are not restored. Losing the
   * ruin while it is being rebuilt abandons the work.
   */
  rebuild(pi, id) {
    if (this.winner !== null || this.paused || !this.alive[pi]) return false;
    const c = this.nodes[id];
    if (!c || c.owner !== pi || !c.ruin || c.rebuild || c.units < B.ruin.cost) return false;
    takeSoldiers(c.groups, B.ruin.cost);
    c.rebuild = { t0: this.t, until: this.t + B.ruin.time, by: pi };
    this.featRev++;
    this.outEvents.push({ k: 'rebuild', node: c.id, p: pi, dur: B.ruin.time });
    return true;
  }

  // -------------------------------------------------- skills

  /** A skill definition as it applies to this player: the faction's, with the subfaction's modest adjustments. */
  skillDef(p, slot) {
    const def = B.skills[p.faction][slot];
    const v = def && B.skills.variants && B.skills.variants[p.sub] && B.skills.variants[p.sub][def.id];
    if (!v) return def;
    const out = { ...def };
    for (const [k, m] of Object.entries(v)) out[k] = def[k] * m;
    return out;
  }

  /** How many bases a player holds (ruins do not count). */
  basesOf(pi) { let n = 0; for (const c of this.nodes) if (c.owner === pi && !c.ruin) n++; return n; }

  /**
   * Cast a skill. slot 0/1 = basic, 2 = superweapon.
   * args by target type:
   *   ownCity       { node }
   *   edge          { a, b, f }      a point on road a-b, f = fraction of the way from a to b
   *   enemyCity     { node }
   *   cityPair      { node, to }     any two different bases, whoever holds them
   * Returns { ok } or { ok: false, why }. A refused cast costs nothing.
   */
  skill(pi, slot, args = {}, cmdId) {
    if (this.winner !== null || !this.alive[pi]) return { ok: false, why: 'dead' };
    if (this.paused) return { ok: false, why: 'paused' };
    const p = this.players[pi], S = B.skills;
    const def = this.skillDef(p, slot);
    if (!def) return { ok: false, why: 'slot' };
    if (cmdId != null && p.seen.has(cmdId)) return { ok: false, why: 'duplicate' };   // a repeated message never casts twice
    if (def.super) {
      if (this.level3Count(pi) < S.superNeedsL3) return { ok: false, why: 'needL3' };   // re-checked at cast time
      if (p.charge < p.need) return { ok: false, why: 'charging' };
    } else if (p.cd[slot] > 0) return { ok: false, why: 'cooldown' };

    const t = this.t;
    let ev = null;
    if (def.target === 'ownCity') {
      const c = this.nodes[args.node];
      if (!c || c.owner !== pi || c.ruin) return { ok: false, why: 'target' };
      if (def.emp) {
        const here = this.emps.filter(e => e.node === c.id);
        if (here.some(e => e.kind === def.emp) || here.length >= S.perCity) return { ok: false, why: 'limit' };
        if (this.emps.filter(e => e.owner === pi).length >= S.perPlayer) return { ok: false, why: 'limit' };
        const slotAt = [0, 1, 2, 3].find(i => !here.some(e => e.slot === i));
        this.emps.push({ id: this.nextId++, kind: def.emp, owner: pi, node: c.id, slot: slotAt, t0: t, until: t + def.dur, cd: 0, def });
        this.stats[pi].deployed++;
      } else {                                              // Base Shield: refreshed, never stacked
        c.aegis = { hp: def.hp, max: def.hp, until: t + def.dur, t0: t, by: pi };
        this.stats[pi].deployed++;
      }
      ev = { node: c.id, dur: def.dur };
    } else if (def.target === 'edge') {
      const a = args.a | 0, b = args.b | 0, f = Number(args.f);
      if (!this.nodes[a] || !this.nodes[b] || !this.adj[a].has(b) || !(f >= S.edgeSpan[0] && f <= S.edgeSpan[1])) return { ok: false, why: 'target' };
      if (this.nodes[a].owner !== pi && this.nodes[b].owner !== pi) return { ok: false, why: 'target' };   // a road that touches one of your bases
      if (this.obst.filter(o => o.owner === pi).length >= S.obstaclesPerPlayer) return { ok: false, why: 'limit' };
      const lo = Math.min(a, b), hi = Math.max(a, b), L = this.dist(a, b), x = L * (a < b ? f : 1 - f);
      if (this.obst.some(o => o.lo === lo && o.hi === hi && Math.abs(o.x - x) < S.obstacleClear)) return { ok: false, why: 'blocked' };
      for (const m of this.armies) {                        // never dropped on top of a marching army
        if (Math.min(m.from, m.to) === lo && Math.max(m.from, m.to) === hi && m.groups.length && Math.abs(this.roadX(m) - x) < S.obstacleClear) return { ok: false, why: 'blocked' };
      }
      const A = this.nodes[lo], Z = this.nodes[hi], q = x / L;
      this.obst.push({
        id: this.nextId++, kind: def.obst, owner: pi, lo, hi, x, hp: def.hp || 0, max: def.hp || 0,
        t0: t, until: t + def.dur, def, px: Math.round(A.x + (Z.x - A.x) * q), py: Math.round(A.y + (Z.y - A.y) * q),
      });
      this.topoRev++;
      this.stats[pi].deployed++;
      ev = { a: lo, b: hi, x: Math.round(x), dur: def.dur };
    } else if (def.target === 'enemyCity') {
      const c = this.nodes[args.node];
      if (!c || c.owner < 0 || c.owner === pi || c.ruin || !this.alive[c.owner]) return { ok: false, why: 'target' };
      if (S.lastBaseImmune && this.basesOf(c.owner) <= 1) return { ok: false, why: 'lastBase' };
      this.strikes.push({ id: this.nextId++, kind: def.id, owner: pi, node: c.id, x: c.x, y: c.y, r: def.radius || 0, at: t + def.delay, def });
      ev = { node: c.id, x: c.x, y: c.y, r: def.radius || 0, delay: def.delay };
    } else if (def.target === 'cityPair') {
      // A wormhole may join any two bases, whoever holds them (ruins included). Only its owner's
      // troops use it, and only from an end they hold: the far end may be anybody's, so it can
      // carry a reinforcement or an assault.
      const a = this.nodes[args.node], b = this.nodes[args.to];
      if (!a || !b || a === b) return { ok: false, why: 'target' };
      this.worms = this.worms.filter(w => w.owner !== pi);  // one wormhole per player: a new one replaces the old
      this.worms.push({ id: this.nextId++, owner: pi, a: a.id, b: b.id, t0: t, until: t + def.dur, left: def.capacity, def });
      this.topoRev++;
      ev = { node: a.id, to: b.id, dur: def.dur };
    } else return { ok: false, why: 'slot' };

    this.fresh(pi, cmdId);                                 // ids are consumed only by accepted casts
    this.featRev++;
    if (def.super) { p.charge = 0; p.need = def.cd; this.stats[pi].supers++; } else { p.cd[slot] = def.cd; this.stats[pi].basic++; }
    this.outEvents.push({ k: 'cast', p: pi, skill: def.id, ...ev });
    return { ok: true };
  }

  // -------------------------------------------------- conversion

  /** How many soldiers of `a` may be converted right now (already-converted troops are immune). */
  convertible(a, pct, cap, minSurvivors) {
    let fresh = 0;
    for (const g of a.groups) if (!g.cv) fresh += g.n;
    return Math.max(0, Math.min(Math.floor(a.n * pct), cap, fresh, a.n - minSurvivors));
  }

  /**
   * Move `k` soldiers of army `a` to `newOwner`. They keep faction, tier and
   * health, are flagged so they can never be converted again, and form a new
   * army at the same spot heading for city `dest` (or join its garrison if
   * `a` is besieging a city of the new owner).
   */
  convert(a, k, newOwner, dest) {
    const pool = a.groups.filter(g => !g.cv);
    const taken = takeSoldiers(pool, k);
    prune(a.groups);
    const moved = countOf(taken);
    if (!moved) return 0;
    for (const g of taken) g.cv = true;
    if (this.stats[newOwner]) this.stats[newOwner].converted += moved;
    if (this.stats[a.owner]) this.stats[a.owner].lostToConversion += moved;
    const q = this.pos(a);
    if (a.state === 'siege' && this.nodes[a.to].owner === newOwner) mergeInto(this.nodes[a.to].groups, taken);
    else {
      const to = dest === a.to || dest === a.from ? dest : a.from;
      const from = to === a.to ? a.from : a.to;
      this.newArmy(newOwner, from, to, taken, to === a.to ? a.s : a.L - a.s);
    }
    this.outEvents.push({ k: 'conv', x: Math.round(q.x), y: Math.round(q.y), by: newOwner, from: a.owner, n: moved });
    return moved;
  }

  /**
   * Mind-control units at work in one battle. `units` are the fight's sides with `ref`
   * (the army or city each stands for, which carries the timer). Every `cd` seconds a
   * side with control units takes a few soldiers from the largest hostile body in the
   * fight; they change sides with their health and tier, join that side at once, and
   * can never be converted again.
   */
  control(units, dt, x, y) {
    for (const U of units) {
      let ctl = null, n = 0;
      for (const g of U.groups) { const st = unitStats(g.f, g.sub, g.t); if (st.control && g.n > 0) { ctl = st.control; n += g.n; } }
      if (!ctl) { if (U.ref) U.ref.ctl = 0; continue; }
      U.ref.ctl = (U.ref.ctl || 0) + dt;
      if (U.ref.ctl < ctl.cd) continue;
      U.ref.ctl = 0;
      let best = null, most = 0;
      for (const V of units) {
        if (V.owner === U.owner) continue;
        let fresh = 0;
        for (const g of V.groups) if (!g.cv) fresh += g.n;
        if (fresh > most) { most = fresh; best = V; }
      }
      if (!best) continue;
      const k = Math.min(ctl.cap, ctl.per * Math.ceil(n / ctl.group), most, countOf(best.groups) - ctl.minSurvivors);
      if (k < 1) continue;
      const taken = takeSoldiers(best.groups.filter(g => !g.cv), k);
      prune(best.groups);
      const moved = countOf(taken);
      if (!moved) continue;
      for (const g of taken) g.cv = true;
      mergeInto(U.groups, taken);
      if (this.stats[U.owner]) this.stats[U.owner].converted += moved;
      if (this.stats[best.owner]) this.stats[best.owner].lostToConversion += moved;
      this.outEvents.push({ k: 'conv', x: Math.round(x), y: Math.round(y), by: U.owner, from: best.owner, n: moved });
    }
  }

  /** Flat health damage spread over an army or garrison. Credits the attacker with what actually landed. */
  strike(groups, dmg, attacker, victim, shield) {
    if (shield && shield.hp > 0) {
      const soak = Math.min(shield.hp, dmg);
      shield.hp -= soak; dmg -= soak;
      if (shield.by != null && this.stats[shield.by]) this.stats[shield.by].absorbed += soak;
    }
    const T = countOf(groups);
    if (T <= 0 || dmg <= 0) return;
    for (const g of groups.slice()) {
      const r = wound(g, (dmg * g.n) / T);
      if (this.stats[attacker]) { this.stats[attacker].dealt += r.eff; this.stats[attacker].kills += r.lost; }
      if (this.stats[victim]) { this.stats[victim].taken += r.eff; this.stats[victim].losses += r.lost; }
    }
    prune(groups);
  }

  // -------------------------------------------------- tick

  tick(dt) {
    if (this.winner !== null || this.paused) return;
    this.t += dt;

    // 1. skill timers. Superweapons charge only while the player holds enough level-3 cities.
    for (let pi = 0; pi < this.np; pi++) {
      if (!this.alive[pi]) continue;
      const p = this.players[pi];
      p.cd[0] = Math.max(0, p.cd[0] - dt);
      p.cd[1] = Math.max(0, p.cd[1] - dt);
      if (this.level3Count(pi) >= B.skills.superNeedsL3) p.charge = Math.min(p.need, p.charge + dt);
    }

    this.runTimed();
    this.runStrikes(dt);
    if (this.opts.crates) this.runCrates();
    this.produce(dt);
    this.runFields(dt);
    this.move(dt);
    this.runObstacles(dt);
    this.fieldBattles(dt);
    this.cityBattles(dt);
    this.upkeep(dt);

    this.armies = this.armies.filter(a => a.groups.length > 0);
    this.checkEliminations();
    if (this.winner !== null) { this.autos.clear(); return; }
    this.runAuto();
    for (const ai of this.ais) if (ai && this.alive[ai.pi]) ai.update(this);
  }

  /** Things that last a while and then end: emplacements, obstacles, shields, wormholes, rebuilds. */
  runTimed() {
    const t = this.t;
    const before = this.emps.length + this.obst.length + this.worms.length;
    this.emps = this.emps.filter(e => e.until > t && this.nodes[e.node].owner === e.owner && this.alive[e.owner]);
    const obst = this.obst.filter(o => o.until > t && this.alive[o.owner]);
    // A wormhole lasts until its time is up or it has carried all it can, whoever holds its ends.
    const worms = this.worms.filter(w => w.until > t && w.left >= 1 && this.alive[w.owner]);
    if (obst.length !== this.obst.length || worms.length !== this.worms.length) this.topoRev++;   // routes may be shorter or longer now
    this.obst = obst;
    this.worms = worms;
    for (const o of this.obst) {                            // clients show health in tenths: tell them when it changes
      const d = o.max ? Math.ceil((o.hp / o.max) * 10) : 0;
      if (o.shown !== d) { if (o.shown !== undefined) this.featRev++; o.shown = d; }
    }
    for (const c of this.nodes) {
      if (c.aegis && (c.aegis.until <= t || c.aegis.hp <= 0)) { c.aegis = null; this.featRev++; }
      if (c.aegis) {
        const d = Math.ceil((c.aegis.hp / c.aegis.max) * 10);
        if (c.aegis.shown !== d) { if (c.aegis.shown !== undefined) this.featRev++; c.aegis.shown = d; }
      }
      if (c.rebuild && t >= c.rebuild.until) {              // the ruin is a base again: level 1, nothing else restored
        const by = c.rebuild.by;
        c.rebuild = null;
        c.ruin = false;
        c.level = 1;
        c.acc = 0;
        this.featRev++;
        if (this.stats[by]) this.stats[by].rebuilt++;
        this.outEvents.push({ k: 'rebuilt', node: c.id, p: by });
      }
    }
    if (before !== this.emps.length + this.obst.length + this.worms.length) this.featRev++;
  }

  produce(dt) {
    const t = this.t;
    for (const c of this.nodes) {
      if (c.owner < 0 || c.ruin) continue;                  // a ruin produces nothing until it is rebuilt
      const L = B.levels[c.level], p = this.players[c.owner];
      // Production is paused, not capped: a city above its threshold keeps every soldier it has.
      if (c.units >= L.threshold) continue;
      // A city besieged by siphoning craft produces nothing while they are there.
      if (c.siege.length && c.siege.some(a => a.groups.some(g => g.n > 0 && unitStats(g.f, g.sub, g.t).siphon))) continue;
      let rate = L.prod * B.factions[p.faction].prod;
      let bonus = 1;
      if (p.surgeUntil > t) bonus *= B.crates.rewards.surge.prodMult;
      rate *= Math.min(B.prodBonusCap, bonus);
      c.acc += rate * dt;
      while (c.acc >= 1 && c.units < L.threshold) {
        c.acc -= 1;
        mergeInto(c.groups, [makeGroup(p.faction, p.sub, c.level, 1)]);
        this.stats[c.owner].produced++;
      }
      if (c.units >= L.threshold) c.acc = Math.min(c.acc, 0.999);   // never bank more than the next soldier
    }
  }

  /**
   * Superweapons landing, and the ground a nuclear strike leaves dangerous.
   *
   * Both superweapons aim at ONE base. A strike resolves against that base as it is at
   * that moment and can come to nothing ('void'):
   *   own     the caster holds the base by now
   *   shield  a Base Shield stood over it: the shield is spent and the base is untouched
   *   last    it has become its owner's only base
   *   gone    it is no longer an enemy base at all (neutral, ruined)
   */
  runStrikes(dt) {
    const t = this.t;
    const inside = (z, x, y) => Math.hypot(x - z.x, y - z.y) <= z.r;
    for (const z of this.strikes.filter(s => s.at <= t)) {
      const c = this.nodes[z.node], d = z.def, prev = c.owner;
      let void_ = null;
      if (prev === z.owner) void_ = 'own';
      else if (prev < 0 || c.ruin) void_ = 'gone';
      else if (c.aegis && c.aegis.until > t && c.aegis.hp > 0) { void_ = 'shield'; c.aegis = null; this.featRev++; }
      else if (B.skills.lastBaseImmune && this.basesOf(prev) <= 1) void_ = 'last';

      if (!void_ && z.kind === 'nuke') {
        // The base is destroyed: everyone inside dies, it becomes a neutral ruin, its roads remain.
        const dead = [c.groups, ...c.guards.map(a => a.groups)];
        for (const groups of dead) {
          for (const g of groups) {
            this.stats[z.owner].kills += g.n; this.stats[z.owner].dealt += g.hp;
            if (this.stats[prev]) { this.stats[prev].losses += g.n; this.stats[prev].taken += g.hp; }
          }
        }
        for (const a of c.guards) a.groups = [];
        c.guards = [];
        c.groups = [];
        this.handOver(c, -1);
        this.dropAutos(c, prev);
        c.ruin = true;
        c.level = 1;
        this.stats[z.owner].destroyed++;
        if (this.stats[prev]) this.stats[prev].lost++;
        this.featRev++;
        this.outEvents.push({ k: 'ruin', node: c.id, by: z.owner, from: prev });
      }
      if (z.kind === 'nuke' && void_ !== 'shield') {
        // The blast also hurts hostile armies caught in it, and leaves the ground dangerous to them.
        const hit = h => Math.min(d.cap, h * d.pct + d.flat);
        for (const a of this.armies) {
          if (a.owner === z.owner || !a.groups.length) continue;
          const q = this.pos(a);
          if (inside(z, q.x, q.y)) this.strike(a.groups, hit(hpOf(a.groups)), z.owner, a.owner);
        }
        if (d.hazardDur) this.hazards.push({ x: z.x, y: z.y, r: z.r, until: t + d.hazardDur, owner: z.owner, dps: d.hazardDps });
      }
      if (!void_ && z.kind === 'dominate') {
        // The base changes sides as it stands: level, garrison (tiers and health untouched) and its
        // permanent abilities. Marching armies are not affected.
        for (const g of c.groups) g.cv = true;
        const turned = countOf(c.groups);
        this.stats[z.owner].converted += turned;
        if (this.stats[prev]) this.stats[prev].lostToConversion += turned;
        for (const a of c.guards) {                         // the old owner's columns inside are now outside, attacking
          a.state = 'siege'; a.dest = c.id; a.path = []; a.fightSince = t;
          c.siege.push(a);
        }
        c.guards = [];
        for (const a of c.siege) if (a.owner === z.owner) { a.state = 'march'; a.fightSince = 0; }   // the caster's besiegers may walk in
        c.siege = c.siege.filter(a => a.owner !== z.owner);
        this.handOver(c, z.owner);
        this.dropAutos(c, prev);
        this.stats[z.owner].basesConverted++;
        if (c.level === 3) this.stats[z.owner].level3++;
        if (this.stats[prev]) this.stats[prev].lost++;
        this.featRev++;
        this.outEvents.push({ k: 'cap', node: c.id, by: z.owner, from: prev, mind: true });
      }
      this.outEvents.push({ k: 'strike', skill: z.kind, p: z.owner, node: c.id, x: z.x, y: z.y, r: z.r, void: void_ || undefined });
    }
    this.strikes = this.strikes.filter(s => s.at > t);

    for (const z of this.hazards) {
      for (const a of this.armies) {
        if (a.owner === z.owner || !a.groups.length) continue;
        const q = this.pos(a);
        if (inside(z, q.x, q.y)) this.strike(a.groups, z.dps * dt, z.owner, a.owner);
      }
    }
    this.hazards = this.hazards.filter(z => z.until > t);
  }

  /** The shield over a city right now: a cast Base Shield first, else the city's own ability shield. */
  shieldOf(c) {
    if (c.aegis && c.aegis.until > this.t && c.aegis.hp > 0) return c.aegis;
    return c.shield && c.shield.until > this.t && c.shield.hp > 0 ? c.shield : null;
  }

  /**
   * City abilities, temporary emplacements and route hazards.
   *
   * Level 2 unlocks a city's ability, level 3 upgrades it; which one it has depends on its
   * current owner's faction, so it changes hands with the city. A ruin has none.
   * Overlapping fields never stack: an army takes only the strongest slow and
   * the strongest weakening, whatever their sources.
   */
  runFields(dt) {
    const t = this.t, A = B.abilities;
    for (const a of this.armies) { a.slow = 1; a.weak = 1; }
    const nearCity = (c, owner, range) => {
      const near = [];
      for (const a of this.armies) {
        if (a.owner === owner || a.groups.length === 0) continue;
        const q = this.pos(a);
        const d = Math.hypot(q.x - c.x, q.y - c.y);
        if (d <= range) near.push({ a, d });
      }
      // Threats to this city first (closest), then whatever else is in range.
      return near.sort((p, q) => (q.a.to === c.id) - (p.a.to === c.id) || p.d - q.d || p.a.id - q.a.id);
    };

    for (const c of this.nodes) {
      if (c.owner < 0 || c.level < 2 || c.ruin) continue;
      const fac = this.players[c.owner].faction;
      const near = nearCity(c, c.owner, A.range);
      if (fac === 'meridian') for (const { a } of near) a.slow = Math.min(a.slow, A.meridian.slow);
      if (fac === 'veil') for (const { a } of near) a.weak = Math.min(a.weak, A.veil.weaken);

      c.cd = Math.max(0, c.cd - dt);
      if (c.cd > 0 || !near.length) continue;

      if (fac === 'iron') {
        const first = near[0].a, coil = c.level === 3;
        const hits = [first];
        if (coil) {
          const from = this.pos(first);
          for (const { a } of near.slice(1)) {
            if (hits.length > A.iron.chainTargets) break;
            const q = this.pos(a);
            if (Math.hypot(q.x - from.x, q.y - from.y) <= A.iron.chainRange) hits.push(a);
          }
        }
        const to = hits.map(a => { const q = this.pos(a); return [Math.round(q.x), Math.round(q.y)]; });
        hits.forEach((a, i) => {
          const dmg = (coil ? A.iron.coilDmg : A.iron.turretDmg) * (i ? A.iron.chainFalloff : 1);
          this.strike(a.groups, dmg, c.owner, a.owner);
        });
        this.outEvents.push({ k: 'shot', node: c.id, coil, to });
        c.cd = A.iron.turretCd;
      } else if (fac === 'meridian' && c.level === 3 && c.units > 0) {
        c.shield = { hp: A.meridian.shieldHp, until: t + A.meridian.shieldDur };   // refreshed, never stacked
        this.outEvents.push({ k: 'shield', node: c.id, dur: A.meridian.shieldDur });
        c.cd = A.meridian.shieldCd;
      } else if (fac === 'veil' && c.level === 3) {
        const pl = this.players[c.owner];
        const cap = A.veil.convertCap + (B.factions.veil.subs[pl.sub].convert || 0);
        for (const { a } of near) {
          // Only armies it can reach by road: besieging this city, or on a road that ends here.
          if (a.to !== c.id && a.from !== c.id) continue;
          const k = this.convertible(a, A.veil.convertPct, cap, A.veil.minSurvivors);
          if (k < 1) continue;
          this.convert(a, k, c.owner, c.id);
          c.cd = A.veil.convertCd;
          break;
        }
      }
    }

    // Emplacements beside a base: a gun turret, a suppression tower, a psychic tower.
    for (const e of this.emps) {
      const c = this.nodes[e.node], d = e.def;
      const near = nearCity(c, e.owner, d.range);
      if (e.kind === 'slow') for (const { a } of near) a.slow = Math.min(a.slow, d.slow);
      else if (e.kind === 'psi') for (const { a } of near) a.weak = Math.min(a.weak, d.weaken);
      else {
        e.cd = Math.max(0, e.cd - dt);
        if (e.cd > 0 || !near.length) continue;
        const a = near[0].a, q = this.pos(a);
        this.strike(a.groups, d.dmg, e.owner, a.owner);
        this.outEvents.push({ k: 'shot', node: c.id, emp: e.slot, to: [[Math.round(q.x), Math.round(q.y)]] });
        e.cd = d.shotCd;
      }
    }

    // Disruption barriers: a stretch of road that slows and weakens hostile armies inside it.
    for (const o of this.obst) {
      if (o.kind !== 'mire') continue;
      for (const a of this.armies) {
        if (a.owner === o.owner || !a.groups.length || Math.min(a.from, a.to) !== o.lo || Math.max(a.from, a.to) !== o.hi) continue;
        if (Math.abs(this.roadX(a) - o.x) > o.def.span / 2) continue;
        a.slow = Math.min(a.slow, o.def.slow);
        a.weak = Math.min(a.weak, o.def.weaken);
      }
    }
  }

  /**
   * Movement with continuous interception. Armies only travel on roads, so
   * hostile armies can meet only on the same road: head-on, or a faster one
   * catching a slower one. Instead of testing positions after the step, each
   * army is allowed to advance only until first contact, so nothing tunnels
   * through however long the step or however fast the armies. A hostile
   * barricade is swept the same way: an army stops in front of it.
   */
  move(dt) {
    const t = this.t, R = C.engageRadius;
    this.reroute();
    const roads = new Map();
    for (const a of this.armies) {
      a.atBlock = null;
      if (a.state === 'siege' || a.state === 'guard' || a.groups.length === 0) continue;
      const up = a.buff.speed > t ? B.crates.rewards.rapid.speedMult : 1;
      a.v = a.waiting || a.hold || a.queue ? 0 : this.baseSpeed(a) * Math.min(B.march.maxSpeedBonus, up) * Math.max(B.march.minSlow, a.slow);
      const key = a.from < a.to ? a.from * 1000 + a.to : a.to * 1000 + a.from;
      (roads.get(key) || roads.set(key, []).get(key)).push(a);
    }

    const picks = new Map();     // crate id -> { army, when }
    for (const [key, list] of roads) {
      list.sort((p, q) => p.id - q.id);
      const lo = Math.floor(key / 1000), hi = key % 1000;
      const blocks = this.obst.length ? this.obst.filter(o => o.kind === 'block' && o.lo === lo && o.hi === hi) : [];
      const x = list.map(a => this.roadX(a));
      const vel = list.map(a => (a.from < a.to ? a.v : -a.v));
      const touching = list.map(() => false);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].owner !== list[j].owner && Math.abs(x[i] - x[j]) <= R + EPS) touching[i] = touching[j] = true;
        }
      }
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        a.touch = touching[i];
        for (const o of blocks) {                          // standing at a hostile barricade: it must be broken first
          if (o.owner !== a.owner && Math.abs(o.x - x[i]) <= R + 1e-3 && (o.x - x[i]) * (vel[i] || (a.from < a.to ? 1 : -1)) >= 0) a.atBlock = o;
        }
        if (touching[i]) { a.v = 0; continue; }
        let go = dt;
        for (let j = 0; j < list.length; j++) {
          if (list[j].owner === a.owner) continue;         // friendly armies never block each other
          const side = Math.sign(x[j] - x[i]) || 1;
          const closing = (vel[i] - (touching[j] ? 0 : vel[j])) * side;
          if (closing <= 0) continue;
          go = Math.min(go, Math.max(0, (Math.abs(x[j] - x[i]) - R) / closing));
        }
        for (const o of blocks) {
          if (o.owner === a.owner) continue;
          const closing = vel[i] * (Math.sign(o.x - x[i]) || 1);
          if (closing <= 0) continue;
          go = Math.min(go, Math.max(0, (Math.abs(o.x - x[i]) - R) / closing));
        }
        const x0 = x[i];
        a.s = Math.min(a.L, a.s + a.v * go);
        const x1 = this.roadX(a);
        for (const cr of this.crates) {                    // crates lie on roads: sweep the same segment
          if (cr.lo !== Math.min(a.from, a.to) || cr.hi !== Math.max(a.from, a.to)) continue;
          const r = B.crates.pickupRadius;
          if (cr.x < Math.min(x0, x1) - r || cr.x > Math.max(x0, x1) + r) continue;
          const when = a.v > 0 ? Math.max(0, (Math.abs(cr.x - x0) - r) / a.v) : 0;
          const best = picks.get(cr.id);
          if (!best || when < best.when - EPS || (Math.abs(when - best.when) <= EPS && a.id < best.army.id)) picks.set(cr.id, { army: a, when });
        }
      }
    }
    for (const [id, pick] of [...picks].sort((p, q) => p[0] - q[0])) this.collect(id, pick.army);

    // Arrivals. An army in contact with an enemy cannot arrive: it is stopped where it stands.
    for (const a of this.armies) {
      if (a.state === 'siege' || a.state === 'guard' || a.touch || a.waiting || a.hold || a.groups.length === 0) continue;
      const c = this.nodes[a.to];
      const through = a.path.length > 0 && c.owner === a.owner;
      if (a.s < (through ? a.L : a.L - B.march.arriveAt) - EPS) {
        // A waypoint under attack is not walked through, because leaving it past the besiegers
        // would skip a fight. The army stands with the garrison instead, as its own army with its
        // orders intact, and marches on when the siege is broken (see cityBattles).
        if (through && a.s >= a.L - B.march.arriveAt - EPS && c.siege.some(x => x.groups.length > 0)) {
          a.state = 'guard';
          a.v = 0;
          c.guards.push(a);
          this.outEvents.push({ k: 'route', p: a.owner, why: 'join', node: c.id, dest: a.dest });
        }
        continue;
      }
      if (through) {
        // A friendly waypoint is passed through as transit: the army stays an army, takes up no
        // garrison capacity, and leaves by its next hop, which is a road or its owner's wormhole.
        const next = a.path[0], w = this.wormOn(a.owner, a.to, next, a.n);
        if (w && a.warped !== w.id) {
          a.from = a.to; a.to = a.path.shift();
          this.warp(a, w);
        } else if (this.adj[a.to].has(next)) {
          a.from = a.to;
          a.to = a.path.shift();
          a.L = this.dist(a.from, a.to);
          a.s = 0;
        }                                                 // otherwise the hop is gone: reroute() deals with it next step
        continue;
      }
      if (c.owner === a.owner) {
        // Joining the garrison, as far as its capacity allows. Whoever does not fit waits at the
        // gate as an army, in the simulation and open to attack, and goes in as room appears.
        if (!this.enter(a, c) && !a.queue) {
          a.queue = true;
          a.s = a.L - B.march.arriveAt;
          this.outEvents.push({ k: 'route', p: a.owner, why: 'full', node: c.id, dest: a.dest });
        }
      } else {
        // Stop on the siege line. Only an army already inside the city when its route was cut is
        // further in than one step; it stays where it stands rather than jumping back.
        if (a.s - (a.L - B.march.arriveAt) <= a.v * dt + EPS) a.s = a.L - B.march.arriveAt;
        a.dest = a.to;
        a.path = [];
        a.queue = false;
        a.state = 'siege';
        a.fightSince = t;
        a.v = 0;
        c.siege.push(a);
      }
    }
  }

  /** Armies stopped at a hostile barricade tear it down; when it breaks, the road is open again. */
  runObstacles(dt) {
    if (!this.obst.length) return;
    // Only so many soldiers can get at a barricade at once (`frontage`): a bigger column does
    // not break it proportionally faster, so it holds up a large army about as long as a small one.
    const work = new Map();                                 // obstacle -> { dps, n }
    for (const a of this.armies) {
      const o = a.atBlock;
      if (!o || !a.groups.length || a.touch) continue;
      const w = work.get(o) || work.set(o, { dps: 0, n: 0 }).get(o);
      for (const g of a.groups) { w.dps += g.n * unitStats(g.f, g.sub, g.t).dps * a.weak; w.n += g.n; }
    }
    for (const [o, w] of work) {
      const front = o.def.frontage ? Math.min(1, o.def.frontage / w.n) : 1;
      o.hp -= w.dps * front * C.speed * dt;
    }
    const left = this.obst.filter(o => o.kind !== 'block' || o.hp > 0);
    if (left.length !== this.obst.length) {
      for (const o of this.obst) if (!left.includes(o)) this.outEvents.push({ k: 'broke', x: o.px, y: o.py, p: o.owner });
      this.obst = left;
      this.topoRev++;
      this.featRev++;
    }
  }

  /** One side of a battle, as fight() wants it. */
  side(a, t, inCity) {
    return {
      owner: a.owner, groups: a.groups, ref: a, since: a.fightSince ? t - a.fightSince : 0,
      atkMult: a.weak * (a.buff.atk > t ? B.crates.rewards.weapons.atk : 1),
      takeMult: (a.buff.armor > t ? B.crates.rewards.armor.taken : 1) * (inCity == null ? 1 : 1 - C.cityDefense[inCity]),
      inCity: inCity != null,
    };
  }

  /**
   * Field battles. Hostile armies in contact fight where they stand until one side is gone.
   * Before they lock, troops whose weapons reach across the gap already fire; only troops
   * with the range to answer fire back.
   */
  fieldBattles(dt) {
    const t = this.t, R = C.engageRadius;
    const roads = new Map();
    for (const a of this.armies) {
      if (a.state === 'siege' || a.state === 'guard' || a.groups.length === 0) continue;
      const key = a.from < a.to ? a.from * 1000 + a.to : a.to * 1000 + a.from;
      (roads.get(key) || roads.set(key, []).get(key)).push(a);
    }
    for (const list of roads.values()) {
      if (list.length < 2) { if (list[0].state === 'engaged') { list[0].state = 'march'; list[0].fightSince = 0; } continue; }
      list.sort((p, q) => p.id - q.id);
      const x = list.map(a => this.roadX(a));
      const root = list.map((_, i) => i);
      const find = i => (root[i] === i ? i : (root[i] = find(root[i])));
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].owner !== list[j].owner && Math.abs(x[i] - x[j]) <= R + 1e-3) root[find(i)] = find(j);
        }
      }
      // Ranged exchange between hostile armies that are not yet in contact.
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].owner === list[j].owner || find(i) === find(j)) continue;
          const gap = Math.abs(x[i] - x[j]);
          if (gap > Math.max(reachOf(list[i].groups), reachOf(list[j].groups))) continue;
          const U = this.side(list[i], t), V = this.side(list[j], t);
          U.shooters = inRange(list[i].groups, gap); V.shooters = inRange(list[j].groups, gap);
          if (U.shooters.length || V.shooters.length) fight([U, V], dt, this.stats);
        }
      }
      const clusters = new Map();
      list.forEach((a, i) => (clusters.get(find(i)) || clusters.set(find(i), []).get(find(i))).push(a));
      for (const group of clusters.values()) {
        if (group.length < 2) { if (group[0].state === 'engaged') { group[0].state = 'march'; group[0].fightSince = 0; } continue; }
        let fresh = false;
        for (const a of group) {
          if (a.state !== 'engaged') { a.state = 'engaged'; a.fightSince = t; fresh = true; }
          a.v = 0;
        }
        const p0 = this.pos(group[0]), p1 = this.pos(group[1]);
        const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
        if (fresh) this.outEvents.push({ k: 'clash', x: Math.round(mx), y: Math.round(my) });   // one notice per new encounter
        const alive = group.filter(a => a.groups.length);
        const owners = new Set(alive.map(a => a.owner));
        const units = alive.map(a => this.side(a, t));
        fight(units, dt, this.stats);
        this.control(units.filter(u => u.groups.length), dt, mx, my);
        for (const a of alive) {
          if (a.groups.length) continue;
          this.stats[a.owner].encLost++;
          for (const o of owners) if (o !== a.owner) this.stats[o].encWon++;
        }
      }
    }
  }

  /**
   * Sieges: the same fight, with the city's wall bonus and shield on the garrison's side.
   * Long-range troops marching on a hostile city open fire as soon as they are in range,
   * and the garrison's own long-range troops answer.
   */
  cityBattles(dt) {
    const t = this.t;
    // Bombardment on the approach.
    for (const a of this.armies) {
      if (a.state !== 'march' || a.touch || !a.groups.length || a.hold || a.waiting) continue;
      const c = this.nodes[a.to];
      if (c.owner === a.owner || c.units <= 0) continue;
      const gap = a.L - a.s;
      if (gap <= B.march.arriveAt + EPS || gap > Math.max(reachOf(a.groups), reachOf(c.groups))) continue;
      const U = this.side(a, t), V = { owner: c.owner, groups: c.groups, ref: c, since: 0, atkMult: 1, takeMult: 1 - C.cityDefense[c.level], shield: this.shieldOf(c), inCity: true };
      U.shooters = inRange(a.groups, gap); V.shooters = inRange(c.groups, gap);
      if (U.shooters.length || V.shooters.length) fight([U, V], dt, this.stats);
    }

    for (const c of this.nodes) {
      if (c.guards.length) c.guards = c.guards.filter(a => a.groups.length > 0);
      if (c.siege.length) c.siege = c.siege.filter(a => a.groups.length > 0 && a.owner !== c.owner);
      if (!c.siege.length) {
        // Siege broken: routed armies that stood with the garrison take up their route again.
        for (const a of c.guards) { a.state = 'march'; a.fightSince = 0; this.outEvents.push({ k: 'route', p: a.owner, why: 'resume', node: c.id, dest: a.dest }); }
        if (c.guards.length) c.guards = [];
        c.siegeSince = 0;
        continue;
      }
      if (!c.siegeSince) c.siegeSince = t;
      c.siege.sort((p, q) => p.id - q.id);
      const units = c.siege.map(a => this.side(a, t));
      if (c.units > 0) units.push({ owner: c.owner, groups: c.groups, ref: c, since: t - c.siegeSince, atkMult: 1, takeMult: 1 - C.cityDefense[c.level], shield: this.shieldOf(c), inCity: true });
      for (const a of c.guards) units.push(this.side(a, t, c.level));   // inside the walls with the garrison, but not under its shield
      fight(units, dt, this.stats);
      this.control(units.filter(u => u.groups.length), dt, c.x, c.y);
      c.siege = c.siege.filter(a => a.groups.length > 0);
      if (c.guards.length) c.guards = c.guards.filter(a => a.groups.length > 0);

      // Capture: the garrison and anyone standing with it are gone, and exactly one attacker is left.
      if (c.units > 0 || c.guards.length || !c.siege.length) continue;
      const owners = new Set(c.siege.map(a => a.owner));
      if (owners.size !== 1) continue;
      const by = c.siege[0].owner, from = c.owner, wasRuin = c.ruin;
      const victors = c.siege;
      c.siege = [];
      this.handOver(c, by);
      // The victors move in, as many as the city can hold. Nobody is lost to its capacity:
      // whoever does not fit stays outside as an army, waiting at the gate.
      for (const a of victors) {
        a.state = 'march';
        a.fightSince = 0;
        if (!this.enter(a, c)) { a.queue = true; a.dest = c.id; a.path = []; }
      }
      this.stats[by].captured++;
      if (wasRuin) this.stats[by].ruinsCaptured++;
      if (c.level === 3 && !c.ruin) this.stats[by].level3++;
      if (this.stats[from]) this.stats[from].lost++;
      this.outEvents.push({ k: 'cap', node: c.id, by, from });
    }
  }

  /** Self-repair and field repair (see mend): armies at rest and on the march, garrisons not under attack. */
  upkeep(dt) {
    for (const a of this.armies) if (a.groups.length) mend(a.groups, dt, a.state === 'march' && !a.touch);
    for (const c of this.nodes) if (c.groups.length) mend(c.groups, dt, !c.siege.length);
  }

  /**
   * Things standing on the map that clients draw and plan with, as plain records:
   *   { k: 'turret' | 'slow' | 'psi', id, p, n: city, s: slot, t0, u: ends }
   *   { k: 'block' | 'mire', id, p, a, b, x, t0, u, hp: 0..10, span }
   *   { k: 'worm', id, p, a, b, t0, u, left }
   *   { k: 'aegis', p, n, t0, u, hp: 0..10 }
   *   { k: 'rebuild', p, n, t0, u }
   * Times are simulation seconds.
   */
  features() {
    const r = x => +x.toFixed(2), out = [];
    for (const e of this.emps) out.push({ k: e.kind, id: e.id, p: e.owner, n: e.node, s: e.slot, t0: r(e.t0), u: r(e.until) });
    for (const o of this.obst) out.push({ k: o.kind, id: o.id, p: o.owner, a: o.lo, b: o.hi, x: Math.round(o.x), t0: r(o.t0), u: r(o.until), hp: o.max ? Math.ceil((o.hp / o.max) * 10) : 0, span: o.def.span || 0, cost: o.def.detour });
    for (const w of this.worms) out.push({ k: 'worm', id: w.id, p: w.owner, a: w.a, b: w.b, t0: r(w.t0), u: r(w.until), left: Math.floor(w.left), cost: w.def.cost });
    for (const c of this.nodes) {
      if (c.aegis) out.push({ k: 'aegis', p: c.aegis.by, n: c.id, t0: r(c.aegis.t0), u: r(c.aegis.until), hp: Math.ceil((c.aegis.hp / c.aegis.max) * 10) });
      if (c.rebuild) out.push({ k: 'rebuild', p: c.rebuild.by, n: c.id, t0: r(c.rebuild.t0), u: r(c.rebuild.until) });
    }
    return out;
  }

  // -------------------------------------------------- crates

  runCrates() {
    const t = this.t, K = B.crates;
    for (const cr of this.crates) if (cr.until <= t) this.outEvents.push({ k: 'crateGone', id: cr.id });
    this.crates = this.crates.filter(cr => cr.until > t);
    if (t < this.nextCrate) return;
    this.nextCrate = t + K.interval[0] + this.rng() * (K.interval[1] - K.interval[0]);
    if (this.crates.length >= K.maxActive) return;

    // Try a few roads and keep the spot that is most evenly far from two different players,
    // so crates land on contested ground rather than in someone's back yard.
    let best = null;
    for (let i = 0; i < 6; i++) {
      const [a, b] = this.edges[Math.floor(this.rng() * this.edges.length)];
      const f = 0.35 + this.rng() * 0.3;
      const A = this.nodes[a], Z = this.nodes[b];
      const x = A.x + (Z.x - A.x) * f, y = A.y + (Z.y - A.y) * f;
      if (this.crates.some(cr => Math.hypot(cr.px - x, cr.py - y) < 120)) continue;
      const near = new Map();
      for (const c of this.nodes) {
        if (c.owner < 0) continue;
        const d = Math.hypot(c.x - x, c.y - y);
        if (!near.has(c.owner) || d < near.get(c.owner)) near.set(c.owner, d);
      }
      const ds = [...near.values()].sort((p, q) => p - q);
      const score = ds.length >= 2 ? -(ds[1] - ds[0]) : 0;
      if (!best || score > best.score) best = { a, b, f, x, y, score };
    }
    if (!best) return;
    let roll = this.rng() * Object.values(K.rewards).reduce((s, r) => s + r.weight, 0), reward = 'cache';
    for (const [id, r] of Object.entries(K.rewards)) { roll -= r.weight; if (roll <= 0) { reward = id; break; } }
    const cr = {
      id: this.nextId++, lo: Math.min(best.a, best.b), hi: Math.max(best.a, best.b),
      x: this.dist(best.a, best.b) * (best.a < best.b ? best.f : 1 - best.f),
      px: Math.round(best.x), py: Math.round(best.y), reward, until: t + K.lifetime,
    };
    this.crates.push(cr);
    this.outEvents.push({ k: 'crate', id: cr.id, x: cr.px, y: cr.py });
  }

  /** Give crate `id` to army `a`. Each crate can be collected exactly once. */
  collect(id, a) {
    const i = this.crates.findIndex(cr => cr.id === id);
    if (i < 0 || a.groups.length === 0) return;
    const cr = this.crates.splice(i, 1)[0];
    const R = B.crates.rewards[cr.reward], p = this.players[a.owner], t = this.t, st = this.stats[a.owner];
    switch (cr.reward) {
      case 'cache': mergeInto(a.groups, [makeGroup(p.faction, p.sub, 1, R.soldiers)]); st.granted += R.soldiers; break;
      case 'rapid': a.buff.speed = t + R.dur; break;           // timed buffs refresh, they do not stack
      case 'armor': a.buff.armor = t + R.dur; break;
      case 'weapons': a.buff.atk = t + R.dur; break;
      case 'repairs': {
        // Heals the wounded only: head count never rises, so nobody comes back from the dead.
        let budget = R.cap;
        for (const g of a.groups) {
          const heal = Math.min(budget, (g.n * unitStats(g.f, g.sub, g.t).hp - g.hp) * R.pct);
          g.hp += heal;
          budget -= heal;
        }
        break;
      }
      case 'surge': p.surgeUntil = t + R.dur; break;
      case 'recharge': p.cd[0] = Math.max(0, p.cd[0] - R.seconds); p.cd[1] = Math.max(0, p.cd[1] - R.seconds); break;   // basics only
    }
    st.crates++;
    st.rewards[cr.reward] = (st.rewards[cr.reward] || 0) + 1;
    this.outEvents.push({ k: 'pick', id: cr.id, by: a.owner, reward: cr.reward, x: cr.px, y: cr.py });
  }

  // -------------------------------------------------- end of match

  checkEliminations() {
    const owned = new Array(this.np).fill(0);
    for (const n of this.nodes) if (n.owner >= 0) owned[n.owner]++;
    for (let p = 0; p < this.np; p++) {
      if (!this.alive[p]) continue;
      this.stats[p].peak = Math.max(this.stats[p].peak, owned[p]);
      if (owned[p] === 0) {
        this.alive[p] = false;
        for (const a of this.armies) if (a.owner === p) a.groups = [];
        this.armies = this.armies.filter(a => a.owner !== p);
        for (const c of this.nodes) { c.siege = c.siege.filter(a => a.owner !== p); c.guards = c.guards.filter(a => a.owner !== p); }
        this.outEvents.push({ k: 'elim', p });
      }
    }
    const left = [];
    for (let p = 0; p < this.np; p++) if (this.alive[p]) left.push(p);
    if (left.length <= 1 && this.winner === null) {
      this.winner = left.length ? left[0] : -1;
      this.outEvents.push({ k: 'over', winner: this.winner });
    }
  }

  /** Post-match report: one row per seat, from events recorded during play (not from the final map). */
  report() {
    return this.stats.map((s, p) => ({
      ...s,
      kills: Math.round(s.kills), dealt: Math.round(s.dealt), taken: Math.round(s.taken),
      rewards: { ...s.rewards },
      faction: this.players[p].faction, sub: this.players[p].sub,
      alive: this.alive[p], winner: this.winner === p, duration: Math.round(this.t),
    }));
  }
}

module.exports = { REJECT, AUTO, Game, unitStats, powerOf, countOf, hpOf, makeGroup, mergeInto, takeSoldiers, fight };
