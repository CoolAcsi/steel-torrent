'use strict';
const { BALANCE: B } = require('./config');

// think     seconds between decisions [min, max]
// maxSrc    how many linked cities may join one attack
// attacks   how many attacks may be launched per decision
// margin    how much stronger than the defenders an attack must be [min, max]
// defend    reinforces linked cities that are about to fall
// upChance  appetite for upgrading
// noise     randomness in target choice
// spare     share of a garrison the AI is willing to commit
// forwardAt how full a rear city gets before it ships troops toward the front
// forwards  how many rear cities may do that per decision
// skills    chance per decision to consider casting a ready skill
const CFG = {
  easy:   { think: [3.0, 4.5], maxSrc: 1, attacks: 1, margin: [0.9, 1.5],  defend: false, upChance: 0.3,  noise: 0.8, spare: 0.7, forwardAt: 0.95, forwards: 1, skills: 0.15 },
  normal: { think: [1.6, 2.4], maxSrc: 2, attacks: 2, margin: [1.15, 1.4], defend: true,  upChance: 0.55, noise: 0.3, spare: 0.8, forwardAt: 0.75, forwards: 2, skills: 0.5 },
  hard:   { think: [0.8, 1.2], maxSrc: 4, attacks: 3, margin: [1.1, 1.3],  defend: true,  upChance: 0.8,  noise: 0.1, spare: 0.9, forwardAt: 0.55, forwards: 4, skills: 0.9 },
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

class AIPlayer {
  constructor(pi, level, rng) {
    this.pi = pi;
    this.level = CFG[level] ? level : 'normal';
    this.cfg = CFG[this.level];
    this.rng = rng;
    this.next = 1 + rng() * 1.5;
    this.tries = new Map();     // city -> assaults sent at it that have not taken it yet
  }

  update(g) {
    if (g.t < this.next) return;
    const [a, b] = this.cfg.think;
    this.next = g.t + a + this.rng() * (b - a);
    this.think(g);
  }

  think(g) {
    const { pi, cfg, rng } = this;
    const mine = g.nodes.filter(n => n.owner === pi);
    if (!mine.length) return;
    const adj = g.adj, N = g.nodes.length;

    // Strength is judged by combat power (composition, tier, health), never by head count.
    // A garrison is worth more behind its walls.
    const wall = c => 1 / Math.sqrt(1 - B.combat.cityDefense[c.level]);
    const holds = c => g.power(c.groups) * wall(c);
    const myPow = new Float64Array(N), enPow = new Float64Array(N);
    for (const a of g.armies) {
      // Judged by where an army is finally going, not by the waypoint it is walking to.
      if (a.owner === pi) myPow[a.dest] += g.power(a.groups);
      else if (g.nodes[a.dest].owner === pi) enPow[a.dest] += g.power(a.groups);
    }
    const danger = n => enPow[n.id] - (holds(n) + myPow[n.id]);
    const threatened = new Set(mine.filter(n => danger(n) > 0).map(n => n.id));
    const spare = n => (threatened.has(n.id) ? 0 : cfg.spare);
    const linkedMine = t => mine.filter(n => adj[t.id].has(n.id));
    const march = (from, to, pct) => {
      pct = Math.max(0.1, Math.min(1, pct));
      const made = g.send(pi, [from.id], to.id, pct);
      for (const a of made) myPow[to.id] += g.power(a.groups);
      return made.length > 0;
    };

    // 1. Reinforce cities that are about to fall, from cities linked to them.
    if (cfg.defend) {
      for (const t of mine) {
        if (!threatened.has(t.id)) continue;
        let need = danger(t) * 1.15 + 1;
        for (const h of linkedMine(t).sort((a, b) => b.units - a.units)) {
          const have = g.power(h.groups) * spare(h);
          if (have <= 0.5) continue;
          march(h, t, Math.min(spare(h), need / g.power(h.groups)));
          need -= Math.min(have, need);
          if (need <= 0) break;
        }
      }
    }

    const tryUpgrade = () => {
      let pick = null;
      for (const n of mine) {
        if (n.level >= B.maxLevel || threatened.has(n.id) || n.siege.length) continue;
        if (n.units < B.levels[n.level].upCost + 3) continue;
        if (!pick || n.units > pick.units) pick = n;
      }
      return pick ? g.upgrade(pi, pick.id) : false;
    };

    // 2. Sometimes invest before expanding.
    const invested = rng() < cfg.upChance * 0.35 && tryUpgrade();

    // 3. Best affordable attacks along roads.
    const margin = cfg.margin[0] + rng() * (cfg.margin[1] - cfg.margin[0]);
    const frontier = new Set();
    for (const n of mine) for (const id of adj[n.id]) if (g.nodes[id].owner !== pi) frontier.add(id);

    // Power ratings do not see everything (walls of aircraft, turrets, bad match-ups). A city that has
    // already shrugged off an assault gets a bigger one next time, from more of its neighbours.
    for (const id of [...this.tries.keys()]) if (g.nodes[id].owner === pi) this.tries.delete(id);
    const pickAttack = () => {
      let best = null, bestScore = 0;
      for (const id of frontier) {
        const t = g.nodes[id];
        const L = B.levels[t.level];
        const failed = this.tries.get(id) || 0;
        const srcs = linkedMine(t).filter(n => spare(n) > 0 && n.units >= 2)
          .sort((a, b) => dist(a, t) - dist(b, t)).slice(0, cfg.maxSrc + failed);
        let acc = 0, far = 0, need = Infinity;
        const plan = [];
        for (const s of srcs) {
          far = Math.max(far, dist(s, t) / B.march.speed);
          // Soldiers the target will raise while we march, up to its production threshold.
          const growth = t.owner >= 0 ? Math.max(0, Math.min(L.threshold - t.units, L.prod * far)) * t.level * 0.9 : 0;
          need = (holds(t) + growth * wall(t)) * margin * (1 + 0.6 * Math.min(8, failed)) + 1 - myPow[t.id];
          plan.push(s);
          acc += g.power(s.groups) * spare(s);
          if (acc >= need) break;
        }
        if (!plan.length || need <= 0 || acc < need) continue;
        const value = L.prod * (t.owner >= 0 ? 1.6 : 1) * (t.level === 3 ? 1.2 : 1);
        const score = (value / (need + 6 + far * 2)) * (1 + (rng() - 0.5) * cfg.noise);
        if (score > bestScore) { bestScore = score; best = { t, plan, need }; }
      }
      return best;
    };

    let attacked = false;
    for (let i = 0; i < cfg.attacks && !invested; i++) {
      const best = pickAttack();
      if (!best) break;
      let need = best.need * (best.t.owner >= 0 ? 1.2 : 1);      // bring extra to hold a player's city
      for (const s of best.plan) {
        const have = g.power(s.groups);
        if (have <= 0) continue;
        const pct = Math.min(spare(s), need / have);
        if (march(s, best.t, pct)) need -= have * Math.max(0.1, pct);
        if (need <= 0) break;
      }
      this.tries.set(best.t.id, (this.tries.get(best.t.id) || 0) + 1);
      attacked = true;
    }

    // 4. Nothing affordable: upgrade.
    if (!invested && !attacked && rng() < cfg.upChance) tryUpgrade();

    // 5. Rear cities feed the front one road at a time.
    const hop = new Array(N).fill(Infinity);
    const queue = [];
    for (const n of g.nodes) if (n.owner !== pi) { hop[n.id] = 0; queue.push(n.id); }
    for (let q = 0; q < queue.length; q++) {
      for (const id of adj[queue[q]]) if (hop[id] > hop[queue[q]] + 1) { hop[id] = hop[queue[q]] + 1; queue.push(id); }
    }
    let moved = 0;
    for (const n of mine.slice().sort((a, b) => hop[b.id] - hop[a.id])) {
      if (moved >= cfg.forwards) break;
      if (hop[n.id] < 2 || threatened.has(n.id)) continue;
      const at = n.level < B.maxLevel ? 0.95 : cfg.forwardAt;     // save up for an upgrade first
      if (n.units < B.levels[n.level].threshold * at) continue;
      let to = null;
      for (const id of adj[n.id]) {
        const m = g.nodes[id];
        if (m.owner !== pi || hop[id] >= hop[n.id]) continue;
        if (!to || hop[id] < hop[to.id] || (hop[id] === hop[to.id] && m.units < to.units)) to = m;
      }
      if (to && march(n, to, 0.7)) moved++;
    }

    if (rng() < cfg.skills) this.useSkills(g, mine, threatened, danger, holds);
  }

  /** Cast whatever is ready and has a sensible target. The simulation re-validates everything. */
  useSkills(g, mine, threatened, danger, holds) {
    const pi = this.pi, p = g.players[pi];
    const bases = mine.filter(c => !c.ruin);
    const worst = bases.filter(c => threatened.has(c.id)).sort((a, b) => danger(b) - danger(a) || a.id - b.id)[0];
    // Hostile armies marching on one of my bases, strongest first.
    const inbound = g.armies
      .filter(a => a.owner !== pi && a.groups.length && a.state === 'march' && g.nodes[a.to].owner === pi)
      .sort((a, b) => g.power(b.groups) - g.power(a.groups) || a.id - b.id);
    // Enemy bases a superweapon may be aimed at: the best developed, then the best defended.
    const prizes = g.nodes
      .filter(c => c.owner >= 0 && c.owner !== pi && !c.ruin && g.alive[c.owner] && g.basesOf(c.owner) > 1)
      .sort((a, b) => b.level - a.level || holds(b) - holds(a) || a.id - b.id);

    for (let slot = 0; slot < 3; slot++) {
      const def = g.skillDef(p, slot);
      if (def.super ? !g.superReady(pi) : p.cd[slot] > 0) continue;
      let args = null, then = null;
      if (def.target === 'ownCity') {
        // A turret, tower or shield for the base that needs it most.
        if (worst && !(def.emp && g.emps.some(e => e.node === worst.id && e.kind === def.emp))) args = { node: worst.id };
      } else if (def.target === 'edge') {
        // Across the road of the strongest column coming at me, a little ahead of it.
        const a = inbound[0];
        if (a && g.power(a.groups) >= 6) {
          const f = Math.min(B.skills.edgeSpan[1], Math.max(B.skills.edgeSpan[0], (a.s + Math.max(60, a.v * 2.5)) / a.L));
          if (f * a.L > a.s + B.skills.obstacleClear + 4) args = { a: a.from, b: a.to, f };
        }
      } else if (def.target === 'enemyCity') {
        const c = prizes[0];
        if (c && (c.level >= 2 || holds(c) >= 20)) args = { node: c.id };
      } else if (def.target === 'ownCityPair') {
        // Link my fullest safe base to the one in trouble, and send help through at once.
        const src = bases.filter(c => !threatened.has(c.id) && c.units >= 20).sort((a, b) => b.units - a.units || a.id - b.id)[0];
        if (src && worst && worst !== src && !g.adj[src.id].has(worst.id)) {
          args = { node: src.id, to: worst.id };
          then = () => g.send(pi, [src.id], worst.id, 0.8);
        }
      }
      if (args && g.skill(pi, slot, args).ok && then) then();
    }
  }
}

module.exports = { AIPlayer };
