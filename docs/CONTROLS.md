# Match controls: auto dispatch, pause, speed, superweapons

Everything here is decided by the server's simulation. Buttons and keys only
ask; the answer comes back to every client.

## Auto dispatch (persistent routes)

Ordinary orders are one-time. Auto dispatch makes cities keep sending.

| Do | How |
| --- | --- |
| Set | Select one or more of your cities, press **Auto** (`R`), then give the order as usual (drag, `S`, shift-arrows). The mode is for one order and switches itself off. |
| Replace / retarget | Set another order from the same city: one persistent destination per city. |
| Stop | Select the cities and press **Stop auto (n)** or `Del`. Armies already marching keep their own orders. |

Rules (see `game/sim.js`, `runAuto`, and `test/auto.test.mjs`):

- Every `auto.interval` simulation seconds (6) a city sends the chosen share
  of the garrison it has **at that moment**, along a route planned then. The
  percentage is the one selected when the order was set.
- A departure smaller than `auto.minDispatch` (3) waits for more troops. A
  city with no route is **blocked**; a city under attack holds its garrison.
  Each looks again every `auto.retry` second. Nothing is owed for cycles that
  could not send: when a city can send again it sends once.
- Losing the city cancels its order for good; the captor inherits nothing.
  A destination that falls to you simply receives later departures as
  reinforcements. The end of the match stops everything.
- Manual orders never delete a persistent one, and reinforcement may still
  push a city above its production threshold.

On the map: a quiet dotted line along each planned route, a ring on the
destination, and a badge on each source — a turning arrow (sending), a still
arrow (waiting for troops), a broken line (no route), an exclamation mark
(under attack), pause bars (match paused). The city panel says the same in words.

Orders are private: each player is sent only their own, and gets them again
on reconnect.

## Pause and resume

`P`, or the pause button next to the speed selector. Only the room's host may
pause or resume (`control.hostOnly`); everyone sees who paused. If the host
disconnects the host role moves to another connected player as usual, who can
then resume.

A paused match does not advance at all: movement, combat, production, city
abilities, cooldowns and superweapon charge, buffs, lingering damage, pending
strikes, crates, auto dispatch and the match clock all stand still, and no
order is accepted (the client says "The match is paused"). You can still look
around and change settings, and the host can pick a speed for after the
pause. Resuming continues from exactly the same state: `test/clock.test.mjs`
checks a paused-and-resumed match is identical, step for step, to one that
never paused.

## Game speed

| | Multiplier |
| --- | --- |
| Very slow | 0.5× |
| Slow | 0.75× |
| Normal (default) | 1× |
| Fast | 1.5× |
| Very fast | 2× |

`[` and `]`, or the selector beside the pause button; host only, room-wide.
Speed changes how many fixed 50 ms simulation steps the server runs per
second of real time (`game/clock.js`), never the size of a step, so
interception, combat and timers are identical at every speed. All gameplay
times are simulation seconds: a 60-second cooldown takes 30 real seconds at
2× and 120 at 0.5×. State updates still go out ten times a real second.
Results show match length in simulation time, and real time as well when the
two differ.

## Superweapon presentation

Effects are driven by the server's events and run on the simulation clock, so
they pause and change speed with the match. They never decide anything:

- **Nuclear strike**: the warning shows the real blast radius, a countdown and
  the warhead coming in for exactly the warning time. On impact: flash,
  fireball, shock and dust on the ground, a rising column and cap, then a
  bounded scorch, embers and the hazard zone with a timer arc. Dust and smoke
  are soft and unlined; the outlined ring is where damage was done. Numbers
  over cities are what those garrisons actually lost.
- **Chrono dispatch**: while targeting, both cities are bracketed and linked by
  markers in the air, with the exact troop count. On the transfer, both ends
  play at once (the source closing, the destination opening); nothing travels
  between them, because nothing does in the simulation.
- **Psychic dominator**: a violet warning with its own shape and countdown, a
  layered field, tethers and halos only on contingents that really changed
  sides, and a crack with the loss on garrisons that were hurt (the dominator
  never captures a city).

Settings: *Reduced flashes* removes the full-screen flash and the scene light
pulse; *Reduced effects* thins particles and turns off bloom; *Reduced camera
shake* as before. A client that reconnects is sent pending strikes and
hazards, and shows a warning at the progress it has really reached; finished
effects are never replayed.

## Configuration (`game/config.js`)

| Key | Default | Meaning |
| --- | --- | --- |
| `route.waitMax` | 20 | seconds a blocked army waits for a route |
| `auto.interval` | 6 | seconds between departures from one city |
| `auto.retry` | 1 | seconds before a city that could not send looks again |
| `auto.minDispatch` | 3 | smallest automatic departure |
| `speeds` | 0.5, 0.75, 1, 1.5, 2 | selectable game speeds |
| `defaultSpeed` | 1 | speed a match starts at |
| `control.hostOnly` | true | only the host may pause, resume or change speed |

## Development aid

`DEV_TOOLS=1` (ignored when `NODE_ENV=production`) makes the server accept a
`{ t: 'dev', op: 'super' }` message that gives the sender three level-3 cities
and a charged superweapon. It exists to demonstrate and screenshot
superweapons and is how the shots in `docs/screenshots/super-*` were taken.

## Dispatch modes (merged from the v8 line)

These supersede the single-route description above wherever they differ.

- **Auto dispatch is on by default** in a match: a drag sets a persistent route. The Auto button (R) switches to single dispatch, where a drag sends once. Tutorial lessons start in single dispatch.
- **Several routes per base.** A base may feed any number of destinations at once (`autos` is keyed by source and destination). When several are due together the dispatch pool is split evenly, rotating when troops are short so no route starves. Each still obeys the destination's capacity and waits, `full`, when there is no room.
- **One direction per road.** A new route overwrites any of the player's routes that use the same road the other way.
- **Chain drag.** Dragging from one base across others builds a relay a→b→c (`{t:'auto', pairs}`). In single dispatch the same gesture sends once along each leg.
- **Fan-in.** Shift-click several bases (or press A for all), then drag from one of them: every selected base plans its own route to the one destination.
- **Rally / Attack (G).** Pick one or more targets; the client plans evenly balanced routes from all bases (`planBalancedDispatch` in `public/js/route.js`) and replaces the current routes. Hovering a base offers the same as buttons.
- **Changing the send percentage** updates every active route (`{t:'auto', setPct}`).

## Cancelling orders

- **Hover the route of a marching column** and a × appears on it, labelled with the column's size; the route is lit from end to end and its destination is ringed. Columns whose routes overlap each get their own ×, side by side. Clicking a × never reaches the map underneath.
- **Persistent route**: every road segment of an active route carries its own ×. Clicking it stops dispatch along that segment (`{t:'auto', off:true, segFrom, segTo}`); a longer route is cut back to end where the segment began. Del, or the Stop button, stops every route from the selected bases. Columns already marching keep their orders.
- **Marching column** (`{t:'halt', army, id}`): it stops where it stands and holds (white dashed plate, HOLD tag). Its place at the destination is released at once. It is still in the world: it fights anything that reaches it. Nobody is deleted or moved.
- **New orders** (`{t:'redirect', army, to, id}`): click a column of yours (held, waiting outside a full base, or marching), then a base. It plans from where it stands.
- **Touch, or without hovering**: the × on persistent routes is always shown; tap a column to select it and get its ×.
- All three commands carry an id and are processed once; a paused match refuses them without consuming the id.

## Camera

Mouse wheel or pinch zooms (up to 2.6×) about the pointer; drag open ground (or the middle button) to move; `+` `−` `0` zoom from the keyboard and return to the whole map. The camera is the client's alone and has no effect on the match.

## Skills

Z, X, C or the skill bar. What to click depends on the skill: one of your bases; a road that touches one of your bases (the preview shows where it would stand); an enemy base (superweapons; a base that cannot be targeted is not highlighted); or two of your bases, one after the other (wormhole). Right-click or Esc cancels. The server checks everything again at the moment of the cast and a refused cast costs nothing.

On a base you hold that is a ruin, the upgrade button reads **Rebuild**.


## Lounge, room names and private rooms

The home screen lists every room that is waiting for players: its title, its
host, how many seats are taken, and a lock if it is private. Click a row to
join. A room in a match, a lesson or the art showcase is never listed.

- **Room title.** The host types it at the top of the room panel (up to 24
  characters; cleaned like a player name). An empty title shows as
  "<host>'s room". The four-letter invite code is still there for links and
  for joining by code.
- **Private room.** The host ticks *Private room* and sets a key. The room
  stays in the lounge with a lock; joining it (from the list, by code or by
  invite link) asks for the key. The key is sent to the host only, never to
  other players or to the lounge, is not put in the address bar and is not
  logged. Wrong keys are counted for the room as a whole
  (`KEY_ATTEMPTS` per `KEY_WINDOW_SECONDS`), so opening more connections does
  not buy more guesses. Whoever is already in the room stays in when a key is
  set; clearing the tick makes the room public again.

## Start countdown

When every player has loaded, the match counts down `START_COUNTDOWN_SECONDS`
(5) of real time. During it the camera closes in on your own base, which is
marked in your colour; the simulation stands still and no order is accepted.
Then the view returns to the whole map and play begins at simulation time 0.
Lessons do not count down.

## Weather

A room option, chosen by the host: *Random* (the default; picked from the match
seed), *Rain*, *Snow*, *Sunshine* or *Night*. It changes the light, the ground
and what falls over the field, and nothing else: the simulation never reads it.
`?weather=snow` (or `rain`, `sun`, `night`) in the address previews a sky on
your own screen only. Lessons are always played in the rain.

## How armies are drawn

One figure stands for a batch of ten soldiers of the same kind, so 34 riflemen
and 12 tanks march as four soldiers and two tanks; a kind that is present always
has at least one figure, and an army too large for the quality preset is drawn
in batches of 20, 40, ... Tier-2 and tier-3 figures are drawn larger
(`TIER_SCALE` in `public/js/art.js`). The plate above a column always carries
the true numbers; combat never looks at figures.

## Phones

The match is laid out for screens from 320 px wide: the top bar keeps compact,
scrollable player chips, the send bar uses icons for Auto and Rally, the skill
bar sits above it, and the map is fitted clear of all of them (and of the
tutorial panel). Orders are a one-finger drag from a base, a tap selects, two
fingers pinch to zoom and one finger on open ground pans. A marching column is
halted by tapping it and then its ×.
