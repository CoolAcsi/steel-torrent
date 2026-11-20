# Steel Tide

A faction-based city-conquest strategy game for the browser. Cities produce
soldiers; you send them along roads to reinforce or attack; hostile armies that
meet on a road fight there; an emptied city changes hands. Up to 8 players per
room, human or AI, over LAN or the internet.

```bash
npm install
npm start          # http://localhost:3000  (development)
npm test           # rules, routing, localization and network tests
```

In development, `MATCH_SEED=<number> npm start` gives every match the same map,
which is how the before/after screenshots in `docs/screenshots/` were taken.
The variable is ignored when `NODE_ENV=production`.

## Where things are

| Path | What |
| --- | --- |
| `game/config.js` | **Every balance number**: rosters, thresholds and capacity, ruins, abilities, skills and superweapons, crates, speeds. |
| `game/sim.js` | Authoritative simulation: production, dispatch and route planning, road interception, battles, abilities, skills, crates, statistics. |
| `game/ai.js` | Computer players. |
| `game/proto.js`, `public/js/netstate.js` | Wire format and checksum (server and client halves). |
| `server.js` | HTTP + WebSocket server, rooms, state sync, limits. |
| `public/js/game.js` | Match view and input. `units.js`, `buildings.js`, `weapons.js`, `fx.js`, `terrain.js`, `scenery.js` hold the art; `battlefield.js` draws emplacements, obstacles, wormholes, shields and ruins. |
| `public/js/3d/` | The 3D renderer (Three.js), loaded on demand. `public/vendor/three` is the vendored engine. |
| `public/js/route.js` | The route planner used for order previews (the server plans the real routes). |
| `public/js/locales/` | All player-facing text (`en.js`, `zh-CN.js`). |
| `test/` | `sim.test.js` (rules), `rules.test.mjs` (capacity, rosters, skills, superweapons, cancelling orders), `client.test.mjs` (route preview parity, figures, combat independent of drawing), `route.test.mjs` (multi-city orders and routing), `auto.test.mjs` (persistent orders), `clock.test.mjs` (pause and speed), `vendor.test.mjs` (the vendored engine loads under the CSP rules), `balance.js` (matchup harness), `net.test.mjs` (network), `i18n.test.mjs` (translations). |
| `docs/ROUTING.md` | How orders are routed: rules, command flow, edge cases, tests. |
| `docs/CONTROLS.md` | Auto dispatch, cancelling orders, camera, skills, pause, game speed, their settings and configuration. |
| `game/clock.js` | Game speed: real time to fixed simulation steps. |
| `game/tutorial.js`, `public/js/tutorial.js` | The playable tutorial: eleven scripted lessons checked by the server from real match state, and the overlay that shows them. `test/tutorial.test.mjs` plays every lesson through the real protocol. |
| `docs/BALANCE.md` | Balance model, measured matchups, how to tune. |
| `docs/DEPLOYMENT.md` | Environment variables, Linux / Windows / container deployment, proxy settings, recovery. |

## Rules in one screen

- **Bases** have a level (1–3) and two separate limits. A base produces
  soldiers of its level's tier until its garrison reaches the **production
  threshold** (20 / 40 / 70). It accepts reinforcements up to its **maximum
  capacity**, three times the threshold. Capacity never stops a base sending
  troops out, never turns away an attacker and never deletes anyone: troops
  that do not fit stay home, or wait at the gate as an army.
- **Orders** move a share of a garrison (25/50/75/100%) to any base that can be
  reached by road. Troops find their own way, marching through your bases in
  between; they never pass through a neutral or hostile base. One drag can
  order many bases at once: each sends its own share by its own route to the
  same destination, and any that cannot take part are named and keep their
  troops. See `docs/ROUTING.md`.
- **Armies** keep their exact composition (roster, tier, health). Hostile
  armies that meet on a road stop and fight there; survivors march on. Large
  armies are drawn with a bounded number of figures in their real mix; the
  plate shows the true count and power.
- **Six rosters**: each subfaction fields its own unit at each tier, with its
  own strengths and counters. See `docs/BALANCE.md`.
- **Skills** act on bases and roads: a temporary turret, suppression tower or
  psychic tower beside a base, a Base Shield over it, a barricade or a
  disruption barrier on a road next to it.
- **Superweapons** charge only while you hold three level-3 bases. The nuclear
  strike destroys one enemy base, leaving a neutral ruin that can be captured
  and rebuilt; the chrono wormhole links any two bases for a while (your troops cross from an end you hold, to reinforce or to attack); base
  mind control takes an enemy base with its garrison. A Base Shield stops a
  strike, and nobody's last base can be targeted.
- **Auto dispatch** turns an order into a persistent one. Hover a route (or
  select its base or column) and click × to cancel: a persistent route stops
  sending; a marching column halts where it is and can be sent somewhere else.
- **Pause and speed** (0.5×, 0.75×, 1×, 1.5×, 2×) belong to the room and are
  the host's to change. They control one simulation clock: every cooldown,
  duration, warning, rebuild and interval is in simulation seconds. See
  `docs/CONTROLS.md`.
- **Rooms**: join by code, rename yourself in the lobby, and everyone presses
  Ready before the host can start. A loading screen holds the match until every
  player has loaded (or a timeout passes).
- **Tutorial**: eleven short playable lessons from the main menu (and offered on first run). Each runs as a private single-player match on a small scripted map; a step completes only when the server sees the taught action in the match. Retry, skip, lesson list, restart and return are always available; progress is kept per browser.
- **Crates** are an optional room setting.

## Adding a language

1. Copy `public/js/locales/en.js` to `public/js/locales/<code>.js` and
   translate the values. Set `$name` to the language's own name. Plural entries
   are objects keyed by `Intl.PluralRules` category (`one`, `other`, ...).
2. In `public/js/i18n.js`, import the file and add it to `LOCALES`.
3. Run `npm test`: it fails if the new file is missing keys or changes
   `{placeholders}`.

The selector, system-language detection, number formatting and the English
fallback need no further changes.

## Graphics

The look is a city in the rain: pale wet paving on the isometric grid, asphalt
streets with kerbs and lane markings (the roads troops march on), brick plazas
around the bases, kerbed lawns with trees, office towers and a skyline, street lamps, soft
overcast light, haze toward the far side and warm lamp light against cool
stone. `terrain.js` paints the ground, `scenery.js` places the blocks and lamps
(only where they cannot cover a road, a city or a label).

The 3D renderer's treatment of that scene is a named **look** (`LOOKS` in
`public/js/3d/renderer.js`). The default, `field`, is crisp seams, saturated
paint and team colour with light weathering, a darker mirror-like wet street
and warm lamps and windows. `?look=current|a|b|c` in the address shows the plain
treatment and the three samples it was chosen from; `DEFAULT_LOOK` changes the
default. The canvas renderer is not affected.

**Models** come in sets (`public/js/modelset.js`). The game loads set A, "Hero
silhouettes" (`public/js/sets/a.js` and `a-bases.js`): chunky proportions,
units drawn 1.35x larger, and each base a fortress under one tall landmark that
grows with its level. `?models=current` in the address shows the earlier models
from `units.js` and `buildings.js`, `?models=b` and `?models=c` the two other
samples the set was chosen from (they cover one roster per faction only). A set
may replace units, bases, the compound wall, infantry muzzle positions and the
marching formation; anything it leaves out falls back to the earlier models.
On a development server (`DEV_TOOLS=1`), `?showcase=1` and `?showcase=2` open a
frozen scene of bases and columns for comparing sets.

Two renderers share the same models:

- **3D** (default; `public/js/3d/renderer.js`, on [Three.js](https://threejs.org)):
  cities, units, towers, trees and lamps are real meshes with physically based
  materials under an overcast sky, a soft shadow-casting key light, depth fog,
  bloom on lamps and lit windows, filmic tone mapping and 4x MSAA. The wet
  ground mirrors the scene: it is drawn a second time reflected in the ground
  plane, then blurred and weighted by a wetness map painted with the terrain.
  The High preset adds ambient occlusion. The game's fixed strategy view is
  given to the engine as an explicit projection matrix, so the 2D layer above
  it (plates, rings, routes, rain, input) lines up exactly as before.
- **Canvas 2D** (fallback, and the Low preset): the same models baked into
  cached sprites on the same painted ground, without reflections.

The engine is loaded on demand, when a match first needs it, so the first page
load does not pay for it. It is vendored under `public/vendor/three` as plain
ES modules with relative imports (`npm run vendor`, see
`scripts/vendor-three.mjs`): no bundler at deploy time, no import map, and the
strict Content-Security-Policy is unchanged. `three` is a devDependency used
only by that script.

Settings (gear icon in a match) offer three quality presets, a switch for the
3D renderer, reduced effects (turns off rain, bloom and ambient occlusion) and
reduced camera shake.

| Preset | Renderer | Resolution cap | Shadows | Ambient occlusion |
| --- | --- | --- | --- | --- |
| High | 3D | 2x | 4096 | yes, half resolution |
| Medium | 3D | 1.5x | 2048 | no |
| Low | Canvas 2D | 1x | painted | no |

`poc/` holds the two engine proofs of concept (Three.js and Babylon.js) that
this choice was made from; it is not part of the game.
