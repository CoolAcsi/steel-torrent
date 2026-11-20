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

/** Effective stats of one soldier. `rating` is its combat power relative to a neutral tier-1 soldier. */
function unitStats(f, sub, t) {
  const key = `${f}|${sub}|${t}`;
  let s = statMemo.get(key);
  if (s) return s;
  const base = B.factions[f], tier = B.tiers[t], mod = (base.subs && base.subs[sub]) || {};
  const hp = base.hp * tier.hp * (mod.hp || 1);
  const atk = base.atk * tier.atk * (mod.atk || 1);
  const armor = base.armor + tier.armor + (mod.armor || 0);
  const dps = atk / base.interval;
  s = {
    hp, atk, armor, dps, interval: base.interval,
    move: base.move * (mod.move || 1) * B.march.tierSpeed[t],
    rating: Math.sqrt((dps * hp) / (1 - mitigation(armor))) / BASE_RATING,
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
 * One step of battle between `units` ({ owner, groups, atkMult, takeMult, shield }).
 * Units with different owners are hostile. All damage is computed from the
 * state at the start of the step and then applied, so the result does not
 * depend on the order of `units`.
 *
 * Targeting: a group's damage is split across every hostile group in the
 * battle in proportion to head count. Casualties: a group's soldier count is
 * its remaining health divided by per-soldier health, rounded up.
 */
function fight(units, dt, stats) {
  const inc = units.map(u => u.groups.map(() => 0));
  const by = units.map(u => u.groups.map(() => null));
  for (let a = 0; a < units.length; a++) {
    const U = units[a];
    let T = 0, dread = false;
    for (const V of units) {
      if (V.owner === U.owner) continue;
      for (const g of V.groups) { T += g.n; if (g.f === 'veil' && g.t === 3 && g.n > 0) dread = true; }
    }
    if (T <= 0) continue;
    const sideMult = (U.atkMult || 1) * (dread ? B.traits.veilDread.enemyAtk : 1) * C.speed * dt;
    for (const ag of U.groups) {
      if (ag.n <= 0) continue;
      const st = unitStats(ag.f, ag.sub, ag.t);
      let out = ag.n * st.dps * sideMult;
      if (ag.f === 'iron' && ag.t === 3 && T >= B.traits.ironSplash.minTargets) out *= B.traits.ironSplash.bonus;
      const pierce = ag.f === 'meridian' && ag.t === 3 ? B.traits.meridianPierce.armor : 1;
      for (let v = 0; v < units.length; v++) {
        const V = units[v];
        if (V.owner === U.owner) continue;
        for (let k = 0; k < V.groups.length; k++) {
          const g = V.groups[k];
          if (g.n <= 0) continue;
          const armor = unitStats(g.f, g.sub, g.t).armor * pierce;
          const d = out * (g.n / T) * (1 - mitigation(armor)) * (V.takeMult == null ? 1 : V.takeMult);
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

// ------------------------------------------------------------ game

function newStats() {
  return {
    produced: 0, granted: 0, converted: 0, lostToConversion: 0, kills: 0, losses: 0,
    dealt: 0, taken: 0, captured: 0, lost: 0, peak: 1, level3: 0, encWon: 0, encLost: 0,
    basic: 0, supers: 0, crates: 0, rewards: {},
  };
}

/** Why a source city was left out of a dispatch order. */
const REJECT = { notYours: 1, noTroops: 2, noRoute: 3, isTarget: 4, paused: 5 };

/** What a persistent order is doing. */
const AUTO = { active: 0, troops: 1, blocked: 2, siege: 3 };

class Game {
  /**
   * @param players [{ ai, faction, sub }]
   * @param seed
   * @param opts    { crates: bool }
   */
  constructor(players, seed, opts = {}) {
    this.rng = mulberry32(seed >>> 0);
    this.np = players.length;
    this.opts = { crates: !!opts.crates };
    const m = generateMap(this.np, this.rng);
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
        mobilizeUntil: 0, rapidUntil: 0, surgeUntil: 0,
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

  // -------------------------------------------------- commands

  newArmy(owner, from, to, groups, s = 0) {
    const a = {
      id: this.nextId++, owner, from, to, s, L: this.dist(from, to), groups,
      state: 'march', v: 0, slow: 1, weak: 1,
      buff: { speed: 0, armor: 0, atk: 0 }, shockUntil: 0, shockSlow: 1, shockWeak: 1,
      // Orders. `to` is only the next waypoint; `dest` is where the army was sent and never changes
      // unless its route is lost. `path` lists the cities still to come after `to`, ending in `dest`.
      dest: to, path: [], src: from, cmd: null, order: 0,
    };
    Object.defineProperty(a, 'n', { get() { return countOf(this.groups); } });
    this.armies.push(a);
    return a;
  }

  /**
   * Shortest road route for player `pi` from city `from` to city `to`, or null.
   *
   * Traversal rule: an army may march THROUGH only cities its owner holds.
   * The last city may belong to anyone: friendly is reinforced, anything else
   * is attacked. Hostile and neutral cities are never passed through, so a
   * route can never skip a fight. Ties are broken by city number, which makes
   * the result independent of the order roads were generated in.
   */
  route(pi, from, to) {
    const N = this.nodes.length;
    if (from === to || !this.nodes[from] || !this.nodes[to]) return null;
    const cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    cost[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
      if (u < 0) return null;
      if (u === to) break;
      done[u] = 1;
      if (u !== from && this.nodes[u].owner !== pi) continue;
      for (const v of this.adj[u]) {
        if (done[v]) continue;
        const c = cost[u] + this.dist(u, v);
        if (c < cost[v] - 1e-9 || (Math.abs(c - cost[v]) <= 1e-9 && u < prev[v])) { cost[v] = c; prev[v] = u; }
      }
    }
    const path = [];
    for (let u = to; u >= 0; u = prev[u]) path.push(u);
    return { path: path.reverse(), cost: cost[to] };
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
      const r = this.route(pi, src.id, dst.id);
      if (!r) { made.results.push([id, -REJECT.noRoute]); continue; }
      const n = this.dispatchCount(src.units, pct);
      if (n < 1) { made.results.push([id, -REJECT.noTroops]); continue; }
      const a = this.newArmy(pi, src.id, r.path[1], takeSoldiers(src.groups, n));
      a.dest = dst.id;
      a.path = r.path.slice(2);
      a.cmd = cmdId == null ? null : cmdId;
      a.order = order;
      made.push(a);
      made.results.push([id, n, r.path.length - 1]);
    }
    if (cmdId != null) {
      p.results.set(cmdId, made.results);
      if (p.results.size > 32) p.results.delete(p.results.keys().next().value);
    }
    return made;
  }

  /**
   * Keep routed armies on a valid route. An army is replanned only when a
   * city it still has to pass through is no longer its owner's, so a valid
   * route is never second-guessed and there is nothing to oscillate between.
   *
   * It replans from where it stands: onward through the city ahead, or by
   * turning round on its road, whichever is shorter, always to the same
   * destination. If there is no route it WAITS where it stands (it can still
   * be attacked there) and looks again each time a city changes hands. Only
   * when it has waited `route.waitMax` seconds does the order end:
   *   hold  the city ahead is still friendly: garrison it
   *   back  only the city behind is friendly: return to it
   *   cut   neither is: attack the city ahead (the normal rule for arriving at a hostile city)
   * The owner is told at every step.
   */
  reroute() {
    const t = this.t;
    for (const a of this.armies) {
      if (a.groups.length === 0 || a.state === 'siege' || a.state === 'guard') continue;
      if (a.waiting) {
        if (a.waiting.rev !== this.ownerRev) {               // something changed hands: is there a way now?
          a.waiting.rev = this.ownerRev;
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
      let valid = own(a.to);
      for (let i = 0; valid && i < a.path.length - 1; i++) valid = own(a.path[i]);
      if (valid) continue;
      if (this.replan(a)) { this.outEvents.push({ k: 'route', p: a.owner, why: 're', node: a.to, dest: a.dest }); continue; }
      a.waiting = { until: t + B.route.waitMax, rev: this.ownerRev };
      a.path = [];                                           // the destination is kept, the stale route is not
      this.outEvents.push({ k: 'route', p: a.owner, why: 'wait', node: a.to, dest: a.dest });
    }
  }

  /** Plan army `a` a route to its destination from where it stands. Returns false if there is none. */
  replan(a) {
    const own = id => this.nodes[id].owner === a.owner;
    const fwd = own(a.to) ? this.route(a.owner, a.to, a.dest) : null;
    const back = own(a.from) ? this.route(a.owner, a.from, a.dest) : null;
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
        const r = this.route(o.owner, id, o.dest);
        if (!r) { o.state = AUTO.blocked; o.next = t + A.retry; continue; }
        ready.push({ o, r });
      }
      if (!ready.length) continue;

      if (ready.length === 1) {
        const { o, r } = ready[0];
        const n = this.dispatchCount(src.units, o.pct);
        if (n < A.minDispatch) { o.state = AUTO.troops; o.next = t + A.retry; continue; }
        const a = this.newArmy(o.owner, id, r.path[1], takeSoldiers(src.groups, n));
        a.dest = o.dest; a.path = r.path.slice(2); a.order = this.nextOrder++; a.auto = true;
        o.state = AUTO.active;
        o.next = t + A.interval;
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
          const { o, r } = ordered[i];
          if (i >= can) { o.state = AUTO.troops; o.next = t + A.retry; continue; }
          const share = Math.min(base + (i < rem ? 1 : 0), src.units - B.dispatch.minGarrison);
          if (share < 1) { o.state = AUTO.troops; o.next = t + A.retry; continue; }
          const a = this.newArmy(o.owner, id, r.path[1], takeSoldiers(src.groups, share));
          a.dest = o.dest; a.path = r.path.slice(2); a.order = orderId; a.auto = true;
          o.state = AUTO.active;
          o.next = t + A.interval;
        }
      }
    }
  }

  upgrade(pi, id) {
    if (this.winner !== null || this.paused || !this.alive[pi]) return false;
    const n = this.nodes[id];
    if (!n || n.owner !== pi || n.level >= B.maxLevel) return false;
    const cost = B.levels[n.level].upCost;
    if (n.units < cost) return false;
    takeSoldiers(n.groups, cost);          // existing soldiers keep their tier; only new ones are better
    n.level++;
    n.cd = 0;
    n.shield = null;
    if (n.level === 3) this.stats[pi].level3++;
    this.outEvents.push({ k: 'up', node: n.id });
    return true;
  }

  /**
   * Cast a global skill. slot 0/1 = basic, 2 = superweapon.
   * args: { x, y } | { node } | { army } | { node, to, pct }
   * Returns { ok } or { ok: false, why }. A refused cast costs nothing.
   */
  skill(pi, slot, args = {}, cmdId) {
    if (this.winner !== null || !this.alive[pi]) return { ok: false, why: 'dead' };
    if (this.paused) return { ok: false, why: 'paused' };
    const p = this.players[pi];
    const def = B.skills[p.faction][slot];
    if (!def) return { ok: false, why: 'slot' };
    if (cmdId != null && p.seen.has(cmdId)) return { ok: false, why: 'duplicate' };   // a repeated message never casts twice
    if (def.super) {
      if (this.level3Count(pi) < B.skills.superNeedsL3) return { ok: false, why: 'needL3' };   // re-checked at cast time
      if (p.charge < p.need) return { ok: false, why: 'charging' };
    } else if (p.cd[slot] > 0) return { ok: false, why: 'cooldown' };

    const point = () => {
      const x = Number(args.x), y = Number(args.y);
      return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= this.w && y <= this.h ? { x, y } : null;
    };
    let ev = null;
    switch (def.id) {
      case 'mobilize': p.mobilizeUntil = this.t + def.dur; ev = {}; break;
      case 'rapid': p.rapidUntil = this.t + def.dur; ev = {}; break;
      case 'barrage': case 'nuke': case 'dominion': {
        const at = point();
        if (!at) return { ok: false, why: 'target' };
        this.strikes.push({ id: this.nextId++, kind: def.id, owner: pi, x: at.x, y: at.y, r: def.radius, at: this.t + def.delay, def });
        ev = { x: at.x, y: at.y, r: def.radius, delay: def.delay };
        break;
      }
      case 'shock': {
        const at = point();
        if (!at) return { ok: false, why: 'target' };
        for (const a of this.armies) {
          if (a.owner === pi) continue;
          const q = this.pos(a);
          if (Math.hypot(q.x - at.x, q.y - at.y) > def.radius) continue;
          a.shockUntil = this.t + def.dur; a.shockSlow = def.slow; a.shockWeak = def.weaken;
        }
        ev = { x: at.x, y: at.y, r: def.radius };
        break;
      }
      case 'reinforce': {
        const c = this.nodes[args.node];
        if (!c || c.owner !== pi) return { ok: false, why: 'target' };
        mergeInto(c.groups, [makeGroup(p.faction, p.sub, 1, def.amount)]);   // may exceed the production threshold
        this.stats[pi].granted += def.amount;
        ev = { node: c.id, n: def.amount };
        break;
      }
      case 'leech': {
        const a = this.armies.find(x => x.id === args.army);
        if (!a || a.owner === pi || a.state === 'siege' || a.state === 'guard') return { ok: false, why: 'target' };
        const k = this.convertible(a, def.pct, def.cap + (B.factions[p.faction].subs[p.sub].convert || 0), def.minSurvivors);
        if (k < 1) return { ok: false, why: 'tooFew' };
        const q = this.pos(a);
        this.convert(a, k, pi, this.nodes[a.to].owner === pi ? a.to : a.from);
        ev = { x: q.x, y: q.y, n: k };
        break;
      }
      case 'phase': {
        const src = this.nodes[args.node], dst = this.nodes[args.to];
        if (!src || !dst || src === dst || src.owner !== pi) return { ok: false, why: 'target' };
        const n = Math.min(def.limit, this.dispatchCount(src.units, args.pct));
        if (n < 1) return { ok: false, why: 'tooFew' };
        const groups = takeSoldiers(src.groups, n);        // departure and arrival in one step
        if (dst.owner === pi) mergeInto(dst.groups, groups);
        else {
          // A normal city battle starts at once: walls, shields and abilities all apply.
          const a = this.newArmy(pi, src.id, dst.id, groups);
          a.s = Math.max(0, a.L - B.march.arriveAt);
          a.state = 'siege';
          a.phased = true;
          dst.siege.push(a);
        }
        ev = { node: src.id, to: dst.id, n };
        break;
      }
      default: return { ok: false, why: 'slot' };
    }
    this.fresh(pi, cmdId);                                 // ids are consumed only by accepted casts
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

  /** Flat health damage spread over an army or garrison. Credits the attacker with what actually landed. */
  strike(groups, dmg, attacker, victim, shield) {
    if (shield && shield.hp > 0) { const soak = Math.min(shield.hp, dmg); shield.hp -= soak; dmg -= soak; }
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
    const t = this.t;

    // 1. skill timers. Superweapons charge only while the player holds enough level-3 cities.
    for (let pi = 0; pi < this.np; pi++) {
      if (!this.alive[pi]) continue;
      const p = this.players[pi];
      p.cd[0] = Math.max(0, p.cd[0] - dt);
      p.cd[1] = Math.max(0, p.cd[1] - dt);
      if (this.level3Count(pi) >= B.skills.superNeedsL3) p.charge = Math.min(p.need, p.charge + dt);
    }

    this.runStrikes(dt);
    if (this.opts.crates) this.runCrates();
    this.produce(dt);
    this.runFields(dt);
    this.move(dt);
    this.fieldBattles(dt);
    this.cityBattles(dt);

    this.armies = this.armies.filter(a => a.groups.length > 0);
    this.checkEliminations();
    if (this.winner !== null) { this.autos.clear(); return; }
    this.runAuto();
    for (const ai of this.ais) if (ai && this.alive[ai.pi]) ai.update(this);
  }

  produce(dt) {
    const t = this.t;
    for (const c of this.nodes) {
      if (c.owner < 0) continue;
      const L = B.levels[c.level], p = this.players[c.owner];
      // Production is paused, not capped: a city above its threshold keeps every soldier it has.
      if (c.units >= L.threshold) continue;
      let rate = L.prod * B.factions[p.faction].prod;
      let bonus = 1;
      if (p.mobilizeUntil > t) bonus *= B.skills.iron[0].prodMult;
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

  /** Delayed area skills and lingering zones. No friendly fire: the caster's own troops are never hit. */
  runStrikes(dt) {
    const t = this.t;
    const inside = (z, x, y) => Math.hypot(x - z.x, y - z.y) <= z.r;
    for (const z of this.strikes.filter(s => s.at <= t)) {
      const d = z.def, hit = h => Math.min(d.cap, h * d.pct + d.flat);
      if (z.kind === 'dominion') {
        let left = d.cap + (B.factions[this.players[z.owner].faction].subs[this.players[z.owner].sub].convert || 0) * 2;
        for (const a of this.armies.slice()) {
          if (a.owner === z.owner || a.state === 'siege' || a.state === 'guard' || left <= 0) continue;
          const q = this.pos(a);
          if (!inside(z, q.x, q.y)) continue;
          const k = this.convertible(a, d.pct, left, d.minSurvivors);
          if (k > 0) left -= this.convert(a, k, z.owner, this.nodes[a.to].owner === z.owner ? a.to : a.from);
        }
        for (const c of this.nodes) {
          if (c.owner === z.owner || !inside(z, c.x, c.y) || c.units < 1) continue;
          // Damages the garrison but always leaves a defender: it cannot empty a city on its own.
          const keep = unitStats(c.groups[0].f, c.groups[0].sub, c.groups[0].t).hp * 0.5;
          this.strike(c.groups, Math.max(0, Math.min(d.garrisonCap, hpOf(c.groups) * d.garrisonPct, hpOf(c.groups) - keep)), z.owner, c.owner, this.shieldOf(c));
        }
      } else {
        for (const a of this.armies) {
          if (a.owner === z.owner) continue;
          const q = this.pos(a);
          if (inside(z, q.x, q.y)) this.strike(a.groups, hit(hpOf(a.groups)), z.owner, a.owner);
        }
        for (const c of this.nodes) {
          if (c.owner === z.owner || !inside(z, c.x, c.y)) continue;
          this.strike(c.groups, hit(hpOf(c.groups)), z.owner, c.owner, this.shieldOf(c));
        }
        if (d.hazardDur) this.hazards.push({ x: z.x, y: z.y, r: z.r, until: t + d.hazardDur, owner: z.owner, dps: d.hazardDps });
      }
      this.outEvents.push({ k: 'strike', skill: z.kind, p: z.owner, x: z.x, y: z.y, r: z.r });
    }
    this.strikes = this.strikes.filter(s => s.at > t);

    for (const z of this.hazards) {
      for (const a of this.armies) {
        if (a.owner === z.owner) continue;
        const q = this.pos(a);
        if (inside(z, q.x, q.y)) this.strike(a.groups, z.dps * dt, z.owner, a.owner);
      }
      for (const c of this.nodes) {
        if (c.owner !== z.owner && inside(z, c.x, c.y)) this.strike(c.groups, z.dps * dt, z.owner, c.owner, this.shieldOf(c));
      }
    }
    this.hazards = this.hazards.filter(z => z.until > t);
  }

  shieldOf(c) {
    return c.shield && c.shield.until > this.t && c.shield.hp > 0 ? c.shield : null;
  }

  /**
   * City abilities. Level 2 unlocks, level 3 upgrades; which one a city has
   * depends on its current owner's faction, so it changes hands with the city.
   * Overlapping fields never stack: an army takes only the strongest slow and
   * the strongest weakening.
   */
  runFields(dt) {
    const t = this.t, A = B.abilities;
    for (const a of this.armies) {
      const shocked = a.shockUntil > t;
      a.slow = shocked ? a.shockSlow : 1;
      a.weak = shocked ? a.shockWeak : 1;
    }
    for (const c of this.nodes) {
      if (c.owner < 0 || c.level < 2) continue;
      const fac = this.players[c.owner].faction;
      const near = [];
      for (const a of this.armies) {
        if (a.owner === c.owner || a.groups.length === 0) continue;
        const q = this.pos(a);
        const d = Math.hypot(q.x - c.x, q.y - c.y);
        if (d <= A.range) near.push({ a, d });
      }
      if (fac === 'meridian') for (const { a } of near) a.slow = Math.min(a.slow, A.meridian.slow);
      if (fac === 'veil') for (const { a } of near) a.weak = Math.min(a.weak, A.veil.weaken);

      c.cd = Math.max(0, c.cd - dt);
      if (c.cd > 0 || !near.length) continue;
      // Threats to this city first (closest), then whatever else is in range.
      near.sort((p, q) => (q.a.to === c.id) - (p.a.to === c.id) || p.d - q.d || p.a.id - q.a.id);

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
        hits.forEach((a, i) => {
          const dmg = (coil ? A.iron.coilDmg : A.iron.turretDmg) * (i ? A.iron.chainFalloff : 1);
          this.strike(a.groups, dmg, c.owner, a.owner);
        });
        this.outEvents.push({ k: 'shot', node: c.id, coil, to: hits.map(a => { const q = this.pos(a); return [Math.round(q.x), Math.round(q.y)]; }) });
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
  }

  /**
   * Movement with continuous interception. Armies only travel on roads, so
   * hostile armies can meet only on the same road: head-on, or a faster one
   * catching a slower one. Instead of testing positions after the step, each
   * army is allowed to advance only until first contact, so nothing tunnels
   * through however long the step or however fast the armies.
   */
  move(dt) {
    const t = this.t, R = C.engageRadius;
    this.reroute();
    const roads = new Map();
    for (const a of this.armies) {
      if (a.state === 'siege' || a.state === 'guard' || a.groups.length === 0) continue;
      const pl = this.players[a.owner];
      let up = 1;
      if (pl.rapidUntil > t) up *= B.skills.meridian[1].speedMult;
      if (a.buff.speed > t) up *= B.crates.rewards.rapid.speedMult;
      a.v = a.waiting ? 0 : this.baseSpeed(a) * Math.min(B.march.maxSpeedBonus, up) * Math.max(B.march.minSlow, a.slow);
      const key = a.from < a.to ? a.from * 1000 + a.to : a.to * 1000 + a.from;
      (roads.get(key) || roads.set(key, []).get(key)).push(a);
    }

    const picks = new Map();     // crate id -> { army, when }
    for (const list of roads.values()) {
      list.sort((p, q) => p.id - q.id);
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
        if (touching[i]) { a.v = 0; continue; }
        let go = dt;
        for (let j = 0; j < list.length; j++) {
          if (list[j].owner === a.owner) continue;         // friendly armies never block each other
          const side = Math.sign(x[j] - x[i]) || 1;
          const closing = (vel[i] - (touching[j] ? 0 : vel[j])) * side;
          if (closing <= 0) continue;
          go = Math.min(go, Math.max(0, (Math.abs(x[j] - x[i]) - R) / closing));
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
      if (a.state === 'siege' || a.state === 'guard' || a.touch || a.waiting || a.groups.length === 0) continue;
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
        // A friendly waypoint is marched through, centre to centre, and the army stays an army:
        // it is not absorbed, it does not jump, and the next road is swept for enemies like any other.
        a.from = a.to;
        a.to = a.path.shift();
        a.L = this.dist(a.from, a.to);
        a.s = 0;
        continue;
      }
      if (c.owner === a.owner) {
        mergeInto(c.groups, a.groups);                     // reinforcements always fit, threshold or not
        a.groups = [];
      } else {
        // Stop on the siege line. Only an army already inside the city when its route was cut is
        // further in than one step; it stays where it stands rather than jumping back.
        if (a.s - (a.L - B.march.arriveAt) <= a.v * dt + EPS) a.s = a.L - B.march.arriveAt;
        a.dest = a.to;
        a.path = [];
        a.state = 'siege';
        a.v = 0;
        c.siege.push(a);
      }
    }
  }

  /** Hostile armies in contact fight where they stand until one side is gone. */
  fieldBattles(dt) {
    const t = this.t, R = C.engageRadius;
    const roads = new Map();
    for (const a of this.armies) {
      if (a.state === 'siege' || a.state === 'guard' || a.groups.length === 0) continue;
      const key = a.from < a.to ? a.from * 1000 + a.to : a.to * 1000 + a.from;
      (roads.get(key) || roads.set(key, []).get(key)).push(a);
    }
    for (const list of roads.values()) {
      if (list.length < 2) { if (list[0].state === 'engaged') list[0].state = 'march'; continue; }
      list.sort((p, q) => p.id - q.id);
      const x = list.map(a => this.roadX(a));
      const root = list.map((_, i) => i);
      const find = i => (root[i] === i ? i : (root[i] = find(root[i])));
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].owner !== list[j].owner && Math.abs(x[i] - x[j]) <= R + 1e-3) root[find(i)] = find(j);
        }
      }
      const clusters = new Map();
      list.forEach((a, i) => (clusters.get(find(i)) || clusters.set(find(i), []).get(find(i))).push(a));
      for (const group of clusters.values()) {
        if (group.length < 2) { if (group[0].state === 'engaged') group[0].state = 'march'; continue; }
        let fresh = false;
        for (const a of group) {
          if (a.state !== 'engaged') { a.state = 'engaged'; fresh = true; }
          a.v = 0;
        }
        if (fresh) {                                       // one notice per new encounter, at the contact point
          const p0 = this.pos(group[0]), p1 = this.pos(group[1]);
          this.outEvents.push({ k: 'clash', x: Math.round((p0.x + p1.x) / 2), y: Math.round((p0.y + p1.y) / 2) });
        }
        const owners = new Set(group.map(a => a.owner));
        fight(group.map(a => ({
          owner: a.owner, groups: a.groups,
          atkMult: a.weak * (a.buff.atk > t ? B.crates.rewards.weapons.atk : 1),
          takeMult: a.buff.armor > t ? B.crates.rewards.armor.taken : 1,
        })), dt, this.stats);
        for (const a of group) {
          if (a.groups.length) continue;
          this.stats[a.owner].encLost++;
          for (const o of owners) if (o !== a.owner) this.stats[o].encWon++;
        }
      }
    }
  }

  /** Sieges: the same fight, with the city's wall bonus and shield on the garrison's side. */
  cityBattles(dt) {
    const t = this.t;
    for (const c of this.nodes) {
      if (c.guards.length) c.guards = c.guards.filter(a => a.groups.length > 0);
      if (c.siege.length) c.siege = c.siege.filter(a => a.groups.length > 0 && a.owner !== c.owner);
      if (!c.siege.length) {
        // Siege broken: routed armies that stood with the garrison take up their route again.
        for (const a of c.guards) { a.state = 'march'; this.outEvents.push({ k: 'route', p: a.owner, why: 'resume', node: c.id, dest: a.dest }); }
        if (c.guards.length) c.guards = [];
        continue;
      }
      c.siege.sort((p, q) => p.id - q.id);
      const units = c.siege.map(a => ({
        owner: a.owner, groups: a.groups,
        atkMult: a.weak * (a.buff.atk > t ? B.crates.rewards.weapons.atk : 1),
        takeMult: a.buff.armor > t ? B.crates.rewards.armor.taken : 1,
      }));
      if (c.units > 0) units.push({ owner: c.owner, groups: c.groups, atkMult: 1, takeMult: 1 - C.cityDefense[c.level], shield: this.shieldOf(c) });
      for (const a of c.guards) {                         // inside the walls with the garrison, but not under its shield
        units.push({
          owner: a.owner, groups: a.groups,
          atkMult: a.weak * (a.buff.atk > t ? B.crates.rewards.weapons.atk : 1),
          takeMult: (1 - C.cityDefense[c.level]) * (a.buff.armor > t ? B.crates.rewards.armor.taken : 1),
        });
      }
      fight(units, dt, this.stats);
      c.siege = c.siege.filter(a => a.groups.length > 0);
      if (c.guards.length) c.guards = c.guards.filter(a => a.groups.length > 0);

      // Capture: the garrison and anyone standing with it are gone, and exactly one attacker is left.
      if (c.units > 0 || c.guards.length || !c.siege.length) continue;
      const owners = new Set(c.siege.map(a => a.owner));
      if (owners.size !== 1) continue;
      const by = c.siege[0].owner, from = c.owner;
      for (const a of c.siege) { mergeInto(c.groups, a.groups); a.groups = []; }
      c.siege = [];
      c.owner = by;
      this.ownerRev++;
      c.acc = 0;
      c.cd = 0;
      c.shield = null;
      this.stats[by].captured++;
      if (c.level === 3) this.stats[by].level3++;
      if (this.stats[from]) this.stats[from].lost++;
      this.outEvents.push({ k: 'cap', node: c.id, by, from });
    }
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
        for (const c of this.nodes) c.siege = c.siege.filter(a => a.owner !== p);
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
