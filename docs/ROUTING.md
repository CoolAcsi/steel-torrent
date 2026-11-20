# Orders and routing

## What was wrong

"Troops may only travel by road" had been implemented as "the source must be
next to the destination", in two places:

- the server dropped every source that was not adjacent to the target
  (`Game.send`, `!this.adj[src.id].has(dst.id)` → `continue`);
- the client filtered the selection the same way before sending, and drew the
  preview from that filtered list.

So a drag from several cities kept only the ones touching the target, and
said nothing about the rest.

## The rule

An army may march **through** only cities its owner holds. The **last** city
of a route may belong to anyone: a friendly one is reinforced, any other is
attacked. Neutral and hostile cities are never passed through, so routing can
never skip a fight. Among valid routes the shortest by road length wins; ties
go to the lower city number, which makes the answer independent of the order
roads are stored in.

This is the old adjacency rule generalised, not a new permission: a one-road
order behaves exactly as before, and AI-only matches replay bit-for-bit
identically (checked with `test/balance.js` before and after).

## Four separate things

| | Where |
| --- | --- |
| Selected source cities | the `from` list of the command |
| Final destination | `army.dest`. Set once from the command, never overwritten by a waypoint |
| Route of each source | `army.path`: the cities still to come after the next one, ending in `dest` |
| Next waypoint | `army.to` (with `army.from`, the road it is on now) |

Each army also keeps `src` (the city it left), `cmd` (the client's command id)
and `order` (shared by every army created by the same command).

## Command flow

1. **Client** sends `{ t: 'send', from: [all selected cities of mine], to, pct, id }`.
   The preview only decides what to draw and which garrisons to predict; it
   does not filter what is sent.
2. **Server** (`Game.send`) handles the command in one call against one state.
   A command id it has already seen creates nothing and gets the original
   answer again. Otherwise, for every source independently: ownership → route
   to `to` → dispatch count (percentage and minimum-garrison rules). An accepted
   source has its troops removed and its army created in the same step.
3. **Answer**: `{ t: 'ack', id, to, res }` where `res` lists every source as
   `[city, soldiers, roads]` or `[city, -reason]` (1 not yours, 2 no troops,
   3 no route, 4 is the destination).
4. **State sync**: army records carry `dest` and the remaining path; a change
   of road, destination or path marks the record as changed, and the checksum
   covers each army's next waypoint and destination. A reconnecting client
   gets them in the keyframe.

## On the march

- **Friendly waypoint**: the army walks to the city centre and out along the
  next road. It is not absorbed, does not jump, and its composition, health and
  buffs are untouched.
- **Interception** is unchanged and applies on every road of the route: hostile
  armies on the same road stop at contact and fight; survivors keep their
  destination and remaining path.
- **Waypoint under siege**: walking out past the besiegers would skip a fight,
  so the army stands with the garrison instead (inside the walls, as its own
  army; the city cannot fall while it stands) and marches on when the siege is
  broken. The owner is told both times.
- **Route broken** (a city still to be passed through changes hands): the army
  replans from where it stands — onward through the city ahead, or by turning
  round on its road, whichever is shorter — to the same destination. A route
  that is still valid is never reconsidered, so there is nothing to oscillate
  between.
- **No route at all**: the army **waits** where it stands (`route.waitMax`,
  20 simulation seconds by default). It keeps its destination, can still be
  attacked, and looks for a route again only when some city changes hands, so
  it never replans in a loop. If a route returns it marches on. If the time
  runs out the order ends at the nearest sensible place: hold the city ahead
  if it is still friendly, else return to the city behind, else attack the
  city ahead (the normal rule for arriving at a hostile city). The owner is
  told at every step, and a waiting army's plate has a dashed amber frame.

Ambiguities in the old rules that had to be settled, and how: passing through
neutral cities (not allowed, same as hostile); a waypoint under siege (stand
and resume, above); a route lost in mid-march (wait, then hold / turn back /
attack, above).

## What the player sees

- While dragging onto a destination: the whole route of every selected city,
  road by road; shared roads drawn once and thicker; cities passed through
  ringed; cities that cannot take part crossed out; a badge with the number of
  cities marching and soldiers leaving, and a second one counting those left out.
- After release: a faint line along the roads still ahead of each routed army
  and a marker over the final destination.
- If the server leaves anyone out: the cities are crossed out for a moment and
  one message says how many went and why the others did not.

## Capacity, obstacles and wormholes

Routing and capacity are separate questions, answered in this order for every source of an order (`Game.send`): is there a route; are there troops; if the destination is the player's own, how many still fit (`room` = capacity − garrison − soldiers already marching there); then the route again for that many soldiers.

- **Partial acceptance.** If only part of the share fits, that part is sent and the rest never leaves. If nothing fits the source is answered with `full` (code 6) and keeps everything.
- **Reservations** are not stored: `incoming()` counts the armies whose destination is that base. Halting, redirecting, dying or losing soldiers therefore releases places immediately, and nothing can leak.
- **Transit is not garrison.** A column passing through a friendly base on its way elsewhere stays an army and takes no place, however full the base is.
- **Safe waiting.** A column that reaches a full base (or a base captured with more victors than it holds) waits at the gate: flag 256, orange dashed plate, FULL tag, `route.full` notice once. It enters as places appear, can be attacked, and can be sent elsewhere.
- **Obstacles.** A hostile obstacle adds its `detour` to the cost of its road for that player; a barricade also physically stops hostile columns until it is broken. Routes are looked at again whenever an obstacle or wormhole appears or goes (`topoRev`).
- **Wormholes.** The owner's open wormhole is one more link between its two bases (cost `wormhole.cost`), usable only while it can still carry the column. A column that arrives at one end with the other as its next stop crosses at once and keeps its orders. If the wormhole closes first, the column plans again from where it is.
- **Ruins** are neutral bases: marched on, never through, until someone holds them.
- **Superweapons.** A base destroyed or taken by one drops the persistent orders that involved it.

The client's preview (`public/js/route.js`, `GameView.plan`) applies the same rules from the feature list the server sends; `test/client.test.mjs` checks that the two agree with a wormhole and both kinds of obstacle on the map.

## Tests

`test/route.test.mjs` runs real orders on hand-made maps and follows the armies
until they arrive: the three-city regression, adjacent and non-adjacent
sources, mixed reachability, different routes to one destination, shared
waypoints, identity through a waypoint, interception on an intermediate road,
replanning, turning back, lost routes, flip-flopping ownership, a besieged
waypoint, retries and rapid repeats, client sync and reconnect, preview/server
agreement on 7,615 city pairs, and a 43-city selection. `test/net.test.mjs`
checks the per-city answers over a real connection.
- `test/rules.test.mjs`: capacity and reservations, safe waiting, capture overflow, transit, obstacles, wormholes, ruins, halting and redirecting.
- `test/client.test.mjs`: preview and server agree with features on the map.
