# Materials

How surfaces in the 3D renderer get their look. Everything here is drawing only: the
simulation never reads it. The canvas fallback renderer (Low quality, or no WebGL) still
draws flat-shaded sprites; this document is about the 3D renderer.

## What changed, in one paragraph

Surfaces used to be a face colour multiplied by a faint grey detail tile whose features
(rivets, seams) were about a third of a pixel at gameplay zoom, so everything read as a flat
colour. Now every surface type is an authored material with its own structure at sizes the
game's zoom can show, paint is a layer that chips to what is underneath, and the renderer
knows where the real edges of every model are, so wear and dirt sit where they would.

## The material library (`public/js/3d/textures.js`)

Each material is painted once in the browser (nothing is downloaded) as what it is built
from, and every feature is written to all maps at once so they agree:

| Map | Content |
|---|---|
| albedo (rgb) | Base colour. Where painted: a tone that multiplies the model's face colour (faction paint, team marking). Where not: the colour of what shows instead (steel, rust, mortar, mud, rubber). |
| paint (albedo alpha) | How much of the face colour applies. 0 = bare. |
| ao | Occlusion in joints, round bolt feet, between track links. |
| roughness | Bare metal and scratches low; dirt, rust, rubber high. |
| metalness | Per pixel: paint, rust, rubber, dirt are not metal; what shows through a chip is. |
| normal | From a painted height map: seams recessed, bolts and weld beads raised, ribs, courses. |
| wear (orm alpha) | The material's own chip pattern, used along real model edges. |

No light is painted into albedo (no highlights beside seams, no shaded bolt sides).

| Surface | What is in it |
|---|---|
| `panel` | Painted plate in running bond; bolted joints with dirt in them; paint chipped to steel on joint lips and plate corners; access hatch, louvres, a welded doubler; scratches to primer and to metal; rain dirt and rust run down from joints. |
| `plating` | The same construction with a cool finish: finer joints, flush rivets, an inspection port, fewer chips, light alloy underneath. |
| `steel` | Blackened steel: drawn grain, handled bright bands, weld beads with heat tint, pits, dried oil, rust freckles, bright scores. |
| `copper` | Tarnish patches, riveted bands, verdigris that gathers under the bands and runs. |
| `dark` | Rubber: mould lines, pale scuffs, dust. |
| `tread` | Track links across the direction of travel: steel shoe, rubber pad with moulded grooves, bright end connectors and pins, guide horn, mud packed in the gaps. |
| `concrete` | Poured in lifts between formwork panels: cold joints, panel fins, tie holes (some weeping rust), bugholes, honeycombing, hairline cracks, lime, run-off. |
| `brick` | Stretcher bond with header courses, per-brick firing, recessed mortar in its own colour, chipped arrises, soot. |
| `corrugated` | Ribs, side and end laps, fixings with rust halos and runs, paint lifted to zinc at cut edges, dents. |
| `roof` | Mineral felt strips with tarred laps, granules, granule loss, repairs, ponding rings, blisters. |
| `sandbag`, `cloth`, `wood`, `glass` | Hessian bags with sewn ends; canvas with stitched seams, eyelets and a patch; sawn planks with grain, knots and nails; panes in a dark frame, clean in the middle and dull where dirt collects. |
| `g_asphalt`, `g_stone`, `g_brick`, `g_grass` | The ground: chippings in bitumen with reinstated trenches and sealed cracks; open-textured flags; basket-weave pavers; mown grass with bare patches. |

Tiles are 256 px (512 in the dev showcase, which can be inspected far closer than a match
allows). A tile never covers more than about 120 screen pixels in a match, so 256 is already
more than is shown; the atlas of all 15 model surfaces is three 1088 x 1088 textures with
mipmaps (about 19 MB of GPU memory in all).

## On the models (`public/js/3d/meshdata.js`)

- **Texture coordinates** are laid out on each face's own plane (u along the wall, v up
  it) at a fixed number of model units per tile, so nothing stretches over a slope and a
  bolt is the same size on a bunker as on a tank. On plated surfaces the layout starts at
  the face's corner and is fitted so a whole number of plates spans the face; each face
  draws a different plate of the set.
- **Edges.** Every vertex carries its distance to each edge of its face and what kind of
  edge it is: an outside corner (sharpness from the angle between the two faces; the facets
  of a barrel do not count), or a crease where the part is buried in another part or meets
  the ground (found by testing a point just outside the edge against every other part).

## In the shader (`surfaceMaterial()` in `public/js/3d/renderer.js`)

One material and one draw call per model, whatever it is made of. Per pixel:

1. Base colour = the material's own colour where `paint` is 0, face colour x tone where it is 1.
2. Along outside corners the paint is broken by the material's chip pattern down to the
   surface's substrate (steel under armour paint, zinc under corrugated paint, paler stone on
   a concrete arris), with that substrate's metalness and roughness. How far in depends on
   the surface and varies along the edge.
3. In creases, dirt: darker, rougher, not metallic, occluded.
4. Roughness, metalness and occlusion come from the same texel as the colour.
5. The same chip pattern is read at a much larger scale to vary tone, so repeats of a tile
   do not weather alike.

Faction and team colours are face colours: they are the paint layer, and chip, scratch and
weather like the rest of it.

## The ground

The terrain is still a painting (it says where roads, flags, brick and lawns are, and has
the joints, markings, repairs and puddles). `buildTerrain` now also writes a material mask
(`wet.mat`), and the ground shader lays the matching ground material over the painting in
world space: tone, roughness and relief per material, with the paving materials turned to
the 45-degree paving grid.

## Looking at it

- `?look=inspect` gives a neutral white key light, grey ambient, no haze, grading,
  weathering overlay or bloom. With `DEV_TOOLS=1`, `?showcase=1&look=inspect&weather=sun`
  is a frozen real match under that light, and the showcase camera can zoom far past the
  match limit.
- Before and after, same scene, same camera, true device pixels: `docs/screenshots/tex-before-*.jpg`
  and `tex-after-*.jpg`.

## Limits

- Textures are generated at load, so they cannot use GPU compressed formats; memory is
  kept down by the 256 px tile and the shared atlas instead.
- The canvas fallback renderer does not use any of this.
- Trees are still flat-shaded low-poly solids.
