# Renderer proofs of concept

Two pages that render the same battlefield with two engines, to decide whether
(and to which) the game's view should move. **Nothing here is loaded by the
game or shipped with it**; the folder is excluded from the Docker image.

```bash
cd poc
npm install      # three and babylonjs, into poc/node_modules only
npm start        # http://localhost:3200/poc/
```

**Outcome:** Three.js was chosen and the game's 3D renderer now runs on it
(`public/js/3d/renderer.js`). These pages are kept for reference and can be
deleted.

Each page has switches (and keys) for reflections `R`, ambient occlusion `O`,
bloom `B`, shadows `S`, rain `W` and number plates `P`. Mouse wheel zooms,
dragging pans. Add `?lite=1` for the tuned profile (ambient occlusion and bloom
at half resolution, 2048 shadow map). `window.__poc.bench()` in the console
measures milliseconds per frame with the GPU forced to finish each one.

## What is shared, what differs

`shared/` describes the scene once, engine-neutral:

| File | What |
| --- | --- |
| `map.js` | A real mid-game snapshot from the simulation (seed 4242, three hard AIs). |
| `scene.js` | Layout, cities, armies, towers, trees, lamps, camera fit. Uses the game's own base, unit, pad and lamp models from `public/js`. |
| `meshdata.js` | Converts the game's `Model`s to triangle buffers grouped by material. |
| `ground.js` | Ground painting and wetness map, generated from `public/js/terrain.js` with the parts a 3D engine does itself removed. |
| `facade.js` | Procedural tower facades (colour, lit rooms, roughness) and tower massing. |
| `overlay.js` | The 2D layer that stays 2D in the game too: number plates projected through the engine camera, rain, the switch panel. |

`three/main.js` and `babylon/main.js` are the only engine-specific code
(about 370 and 390 lines).

## Regenerating the shared inputs

`shared/map.js`: a `Game` from `game/sim.js` (seed 4242, three hard AIs) run
for 121 seconds, then its cities, roads, armies and players serialised.
`shared/ground.js`: copy `public/js/terrain.js`, rename `buildTerrain` to
`paintGround`, delete the sections "the ground darkens toward every city",
tree drawing, scenery, lamp light and atmosphere, and `return { trees }`.
