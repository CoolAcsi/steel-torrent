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

## Cancelling orders

- **Hover a route** of yours and a × appears on it, with the kind of order next to it; the route is lit from end to end and its source and destination are ringed. Routes that overlap each get their own ×, side by side. Clicking a × never reaches the map underneath.
- **Persistent route** (`{t:'auto', off:true}`): the base stops sending. Columns already marching keep their orders.
- **Marching column** (`{t:'halt', army, id}`): it stops where it stands and holds (white dashed plate, HOLD tag). Its place at the destination is released at once. It is still in the world: it fights anything that reaches it. Nobody is deleted or moved.
- **New orders** (`{t:'redirect', army, to, id}`): click a column of yours (held, waiting outside a full base, or marching), then a base. It plans from where it stands.
- **Touch, or without hovering**: select the base to get the × for its persistent route (or use the Auto button / Del); tap a column to select it and get its ×.
- All three commands carry an id and are processed once; a paused match refuses them without consuming the id.

## Camera

Mouse wheel or pinch zooms (up to 2.6×) about the pointer; drag open ground (or the middle button) to move; `+` `−` `0` zoom from the keyboard and return to the whole map. The camera is the client's alone and has no effect on the match.

## Skills

Z, X, C or the skill bar. What to click depends on the skill: one of your bases; a road that touches one of your bases (the preview shows where it would stand); an enemy base (superweapons; a base that cannot be targeted is not highlighted); or two of your bases, one after the other (wormhole). Right-click or Esc cancels. The server checks everything again at the moment of the cast and a refused cast costs nothing.

On a base you hold that is a ruin, the upgrade button reads **Rebuild**.

