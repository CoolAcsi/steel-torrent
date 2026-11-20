// Road routing for the order preview and automatic rally/attack scheduling.
//
// The server plans every real route (Game.route in game/sim.js) and is the
// only authority on who marches where. This is the same algorithm, so the
// preview shows what the server will do; test/route.test.mjs checks that the
// two agree on every pair of cities.
//
// Rule: a route may pass THROUGH only cities the player holds. Its last city
// may belong to anyone. Shortest by road length; ties go to the lower city
// number, so the answer does not depend on the order roads are listed in.

/**
 * @param n          number of cities
 * @param neighbors  u => iterable of cities linked to u by a road
 * @param dist       (u, v) => road length
 * @param passable   u => may the route continue through u
 * @param extra      optional: u => [[v, cost], ...] links that are not roads (the player's open wormhole)
 * @returns { path: [from, ..., to], cost } or null
 */
export function planRoute(n, neighbors, dist, passable, from, to, extra) {
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return null;
  const cost = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  cost[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0) return null;
    if (u === to) break;
    done[u] = 1;
    if (u !== from && !passable(u)) continue;
    const relax = (v, c) => {
      if (done[v]) return;
      if (c < cost[v] - 1e-9 || (Math.abs(c - cost[v]) <= 1e-9 && u < prev[v])) { cost[v] = c; prev[v] = u; }
    };
    for (const v of neighbors(u)) relax(v, cost[u] + dist(u, v));
    if (extra) for (const [v, c] of extra(u)) relax(v, cost[u] + c);
  }
  const path = [];
  for (let u = to; u >= 0; u = prev[u]) path.push(u);
  return { path: path.reverse(), cost: cost[to] };
}

/**
 * Plan optimal, evenly-distributed dispatch routes from `sources` to one or more `targets`.
 *
 * - Single target: every reachable source dispatches along its shortest valid road path.
 * - Multiple targets: assigns sources to minimize road distance while balancing total
 *   troop weight evenly across all reachable targets. When fewer sources than targets
 *   exist (or a target is under-supplied), adds parallel routes from the nearest reachable
 *   source so every reachable target receives an even share of troops.
 *
 * @param n          number of cities
 * @param neighbors  u => iterable of neighbor city ids
 * @param dist       (u, v) => road length
 * @param passable   u => true if city u is owned by the player
 * @param weightOf   u => positive supply weight of source city u
 * @param sources    iterable of player-owned source city ids
 * @param targets    iterable of target city ids (friendly = rally, enemy/neutral = attack)
 * @returns {{ pairs: number[][], routes: { from: number, to: number, path: number[], cost: number }[], reachableTargets: number[], unreachableTargets: number[] }}
 */
export function planBalancedDispatch(n, neighbors, dist, passable, weightOf, sources, targets) {
  const srcList = [...new Set(sources)].filter(s => s >= 0 && s < n && passable(s));
  const tgtList = [...new Set(targets)].filter(t => t >= 0 && t < n);
  const routeMap = new Map(); // `${s}|${t}` -> { path, cost }
  const reachByTgt = new Map();
  const reachBySrc = new Map();

  for (const t of tgtList) reachByTgt.set(t, []);
  for (const s of srcList) reachBySrc.set(s, []);

  for (const s of srcList) {
    for (const t of tgtList) {
      if (s === t) continue;
      const r = planRoute(n, neighbors, dist, passable, s, t);
      if (!r) continue;
      routeMap.set(`${s}|${t}`, r);
      reachByTgt.get(t).push({ s, cost: r.cost });
      reachBySrc.get(s).push({ t, cost: r.cost });
    }
  }

  const reachableTargets = [];
  const unreachableTargets = [];
  for (const t of tgtList) {
    const list = reachByTgt.get(t);
    list.sort((a, b) => a.cost - b.cost || a.s - b.s);
    if (list.length) reachableTargets.push(t);
    else unreachableTargets.push(t);
  }

  if (!reachableTargets.length) {
    return { pairs: [], routes: [], reachableTargets, unreachableTargets };
  }

  const assigned = new Map(); // s -> Set(t)
  const usedLegs = new Set(); // "u|v" directed road segments already committed
  const conflicts = (s, t) => {
    const r = routeMap.get(`${s}|${t}`);
    if (!r) return true;
    for (let i = 0; i + 1 < r.path.length; i++) {
      if (usedLegs.has(`${r.path[i + 1]}|${r.path[i]}`)) return true;
    }
    return false;
  };
  const addEdge = (s, t) => {
    if (conflicts(s, t)) return false;
    let set = assigned.get(s);
    if (!set) assigned.set(s, set = new Set());
    if (set.has(t)) return false;
    set.add(t);
    const r = routeMap.get(`${s}|${t}`);
    for (let i = 0; i + 1 < r.path.length; i++) usedLegs.add(`${r.path[i]}|${r.path[i + 1]}`);
    return true;
  };

  if (reachableTargets.length === 1) {
    const t = reachableTargets[0];
    for (const { s } of reachByTgt.get(t)) addEdge(s, t);
  } else {
    const activeSources = srcList.filter(s => reachBySrc.get(s).length > 0);
    const weights = new Map(activeSources.map(s => [s, Math.max(1, Number(weightOf(s)) || 1)]));
    const totalWeight = activeSources.reduce((acc, s) => acc + weights.get(s), 0);
    const avgLoad = totalWeight / reachableTargets.length;

    const computeLoads = () => {
      const load = new Map(reachableTargets.map(t => [t, 0]));
      for (const [s, set] of assigned) {
        if (!set.size) continue;
        const share = weights.get(s) / set.size;
        for (const t of set) load.set(t, load.get(t) + share);
      }
      return load;
    };

    const usedSrc = new Set();
    // 1. Seed each reachable target with its nearest unassigned, non-conflicting source (most constrained targets first).
    const seedOrder = reachableTargets.slice().sort((a, b) => reachByTgt.get(a).length - reachByTgt.get(b).length || a - b);
    for (const t of seedOrder) {
      const pick = reachByTgt.get(t).find(c => !usedSrc.has(c.s) && !conflicts(c.s, t));
      if (pick && addEdge(pick.s, t)) {
        usedSrc.add(pick.s);
      }
    }

    // 2. Assign remaining sources to minimize distance while balancing load across targets without road direction conflicts.
    const rest = activeSources.filter(s => !usedSrc.has(s)).sort((a, b) => weights.get(b) - weights.get(a) || a - b);
    for (const s of rest) {
      const load = computeLoads();
      let bestT = -1, bestScore = Infinity;
      for (const { t, cost } of reachBySrc.get(s)) {
        if (conflicts(s, t)) continue;
        const score = cost * (1 + (load.get(t) / avgLoad) * 1.35);
        if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && t < bestT)) {
          bestScore = score;
          bestT = t;
        }
      }
      if (bestT >= 0 && addEdge(s, bestT)) {
        usedSrc.add(s);
      }
    }

    // 3. Ensure every reachable target has supply (parallel routes when |sources| < |targets| or severely under-supplied).
    for (let pass = 0; pass < reachableTargets.length; pass++) {
      const load = computeLoads();
      const needy = reachableTargets
        .filter(t => load.get(t) < 1e-9 || load.get(t) < avgLoad * 0.5)
        .sort((a, b) => load.get(a) - load.get(b) || a - b);
      if (!needy.length) break;
      let added = false;
      for (const t of needy) {
        // Pick the closest reachable source not already sending to t and not conflicting on any road segment.
        let bestS = -1, bestScore = Infinity;
        for (const { s, cost } of reachByTgt.get(t)) {
          const cur = assigned.get(s);
          if ((cur && cur.has(t)) || conflicts(s, t)) continue;
          const deg = cur ? cur.size : 0;
          const score = cost * (1 + deg * 0.45) / Math.sqrt(weights.get(s));
          if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && s < bestS)) {
            bestScore = score;
            bestS = s;
          }
        }
        if (bestS >= 0 && addEdge(bestS, t)) added = true;
      }
      if (!added) break;
    }
  }

  const pairs = [];
  const routes = [];
  for (const s of [...assigned.keys()].sort((a, b) => a - b)) {
    for (const t of [...assigned.get(s)].sort((a, b) => a - b)) {
      const r = routeMap.get(`${s}|${t}`);
      if (!r) continue;
      pairs.push([s, t]);
      routes.push({ from: s, to: t, path: r.path, cost: r.cost });
    }
  }
  return { pairs, routes, reachableTargets, unreachableTargets };
}
