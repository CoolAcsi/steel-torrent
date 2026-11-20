'use strict';
// Wire format for match state. The browser's counterpart is
// public/js/netstate.js; record layouts and the hash must stay identical.
//
//   city record   [owner, level, soldiers, power, shield, flags]
//                 shield: 1 the city's own ability shield, 2 a cast Base Shield (3 both)
//                 flags: 1 ruin (neutral or held, produces nothing until rebuilt)
//   army record   [id, owner, from, to, s, v, soldiers, power, state, tier1, tier2, tier3, flags, dest, ...path]
//                 s = distance marched from `from`, v = current speed (so the client can extrapolate)
//                 `to` is the next waypoint, `dest` the final destination; `path` lists the cities
//                 still to come after `to` (ending in dest) and is empty on the last road
//                 state: 0 marching, 1 fighting on the road, 2 besieging `to`
//                 flags: 1 fast, 2 armoured, 4 overcharged, 8 slowed, 16 weakened, 64 waiting for a route,
//                        128 held (order cancelled, awaiting a new one), 256 waiting outside a full city, 512 came through a wormhole
//   player record [cd0, cd1, charge, need, level-3 cities, surge]   (times in tenths of a second)

const STATE = { march: 0, engaged: 1, siege: 2, guard: 1 };   // an army standing with a besieged garrison is shown as fighting

function cityRec(g, c) {
  const sh = (c.shield && c.shield.until > g.t && c.shield.hp > 0 ? 1 : 0) | (c.aegis && c.aegis.until > g.t && c.aegis.hp > 0 ? 2 : 0);
  return [c.owner, c.level, c.units, Math.round(g.power(c.groups)), sh, c.ruin ? 1 : 0];
}

function armyRec(g, a) {
  const tiers = [0, 0, 0, 0];
  for (const gr of a.groups) tiers[gr.t] += gr.n;
  const t = g.t;
  const flags = (a.buff.speed > t ? 1 : 0) | (a.buff.armor > t ? 2 : 0) | (a.buff.atk > t ? 4 : 0)
    | (a.slow < 1 ? 8 : 0) | (a.weak < 1 ? 16 : 0) | (a.waiting ? 64 : 0) | (a.hold ? 128 : 0) | (a.queue ? 256 : 0) | (a.warped ? 512 : 0);
  return [a.id, a.owner, a.from, a.to, +a.s.toFixed(1), +a.v.toFixed(1), a.n, Math.round(g.power(a.groups)), STATE[a.state], tiers[1], tiers[2], tiers[3], flags, a.dest, ...a.path];
}

/** Everything about an army except how far it has walked: when this changes, the client must be told. */
function armySig(rec) {
  return `${rec[2]}|${rec[3]}|${rec.slice(5).join('|')}`;
}

function playerRecs(g) {
  const tenths = x => Math.max(0, Math.round(x * 10));
  return g.players.map((p, i) => [
    tenths(p.cd[0]), tenths(p.cd[1]), tenths(p.charge), tenths(p.need), g.level3Count(i),
    tenths(p.surgeUntil - g.t),
  ]);
}

/** FNV-1a over city ownership/level/soldiers/ruin and every army's id, soldiers, next waypoint and destination (armies in id order). */
function hashGame(g) {
  let h = 2166136261;
  const mix = v => { h = Math.imul(h ^ (v & 0xffff), 16777619); };
  for (const c of g.nodes) { mix(c.owner); mix(c.level); mix(c.units); mix(c.ruin ? 1 : 0); }
  for (const a of g.armies.slice().sort((p, q) => p.id - q.id)) { mix(a.id); mix(a.n); mix(a.to); mix(a.dest); }
  return h >>> 0;
}

/** Pending strikes and lingering zones, for players who join or reconnect mid-effect. */
function zones(g) {
  return [
    ...g.strikes.map(z => ({ skill: z.kind, p: z.owner, node: z.node, x: z.x, y: z.y, r: z.r, at: +z.at.toFixed(2) })),
    ...g.hazards.map(z => ({ skill: 'hazard', p: z.owner, x: z.x, y: z.y, r: z.r, until: +z.until.toFixed(2) })),
  ];
}

module.exports = { cityRec, armyRec, armySig, playerRecs, hashGame, zones };
