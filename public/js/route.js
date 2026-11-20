// Road routing for the order preview.
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
