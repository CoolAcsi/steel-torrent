'use strict';
const { NODE_R, START_UNITS } = require('./config');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Random map sized to the player count. Returns { w, h, nodes, edges } where
 * each node is { id, x, y, owner, level, units }, owner is a player index or
 * -1, and edges are the roads as [nodeA, nodeB] pairs.
 */
function generateMap(numPlayers, rng) {
  const count = 5 + numPlayers * 5;
  const margin = NODE_R + 30;
  let minD = 152;

  // Size the field so `count` bases fit comfortably at `minD` spacing.
  const usable = count * minD * minD * 1.8;
  const iw = Math.sqrt(usable * 1.6);
  const ih = iw / 1.6;
  const w = Math.round(iw + margin * 2);
  const h = Math.round(ih + margin * 2);

  let pts = [];
  for (let attempt = 0; attempt < 60 && pts.length < count; attempt++) {
    pts = [];
    for (let tries = 0; tries < 4000 && pts.length < count; tries++) {
      const p = { x: margin + rng() * iw, y: margin + rng() * ih };
      if (pts.every(q => dist(p, q) >= minD)) pts.push(p);
    }
    if (pts.length < count) minD *= 0.97;
  }

  // Starting bases: spread the players as far apart as the layout allows
  // (greedy farthest-point from every possible first pick, keep the best).
  let best = null, bestScore = -1;
  for (let f = 0; f < pts.length; f++) {
    const sel = [f];
    while (sel.length < numPlayers) {
      let bi = -1, bd = -1;
      for (let i = 0; i < pts.length; i++) {
        if (sel.includes(i)) continue;
        let d = Infinity;
        for (const s of sel) d = Math.min(d, dist(pts[i], pts[s]));
        if (d > bd) { bd = d; bi = i; }
      }
      sel.push(bi);
    }
    let score = Infinity;
    for (let a = 0; a < sel.length; a++)
      for (let b = a + 1; b < sel.length; b++)
        score = Math.min(score, dist(pts[sel[a]], pts[sel[b]]));
    if (score > bestScore) { bestScore = score; best = sel; }
  }
  // Shuffle so seat order doesn't map to a predictable corner.
  for (let i = best.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [best[i], best[j]] = [best[j], best[i]];
  }

  const nodes = pts.map((p, id) => {
    const r = rng();
    const level = r < 0.68 ? 1 : r < 0.92 ? 2 : 3;
    const units = level === 1 ? 5 + Math.floor(rng() * 9)
                : level === 2 ? 14 + Math.floor(rng() * 11)
                : 28 + Math.floor(rng() * 13);
    return { id, x: Math.round(p.x), y: Math.round(p.y), owner: -1, level, units };
  });

  best.forEach((id, player) => {
    Object.assign(nodes[id], { owner: player, level: 1, units: START_UNITS });
  });

  const edges = buildRoads(nodes);

  // Every player gets two cheap linked neighbours so nobody is boxed in at the start.
  for (const id of best) {
    const s = nodes[id];
    edges.filter(e => e[0] === id || e[1] === id)
      .map(e => nodes[e[0] === id ? e[1] : e[0]])
      .filter(n => n.owner < 0)
      .sort((a, b) => dist(a, s) - dist(b, s))
      .slice(0, 2)
      .forEach(n => { n.level = 1; n.units = 5 + Math.floor(rng() * 4); });
  }

  return { w, h, nodes, edges };
}

/**
 * Road network: troops may only travel between linked bases.
 *
 * Two bases are linked when no third base lies inside the circle that has
 * them as its diameter (a Gabriel graph). That gives every base a few natural
 * neighbours, never runs a road through another base, never crosses roads,
 * and always leaves the whole map connected.
 */
function buildRoads(nodes) {
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const r2 = ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) / 4;
      let clear = true;
      for (let k = 0; k < nodes.length && clear; k++) {
        if (k === i || k === j) continue;
        if ((nodes[k].x - mx) ** 2 + (nodes[k].y - my) ** 2 < r2 - 1e-6) clear = false;
      }
      if (clear) edges.push([i, j]);
    }
  }

  // Safety net for degenerate layouts: join any stranded group by its shortest gap.
  for (;;) {
    const group = new Array(nodes.length).fill(-1);
    let groups = 0;
    for (let s = 0; s < nodes.length; s++) {
      if (group[s] >= 0) continue;
      const stack = [s];
      group[s] = groups;
      while (stack.length) {
        const v = stack.pop();
        for (const [x, y] of edges) {
          const o = x === v ? y : y === v ? x : -1;
          if (o >= 0 && group[o] < 0) { group[o] = groups; stack.push(o); }
        }
      }
      groups++;
    }
    if (groups <= 1) break;
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (group[i] === group[j]) continue;
        const d = dist(nodes[i], nodes[j]);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    edges.push([bi, bj]);
  }
  return edges;
}

module.exports = { generateMap, buildRoads, mulberry32 };
