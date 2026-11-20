// Alternative model sets for bases and units.
//
// units.js and buildings.js hold the original models. A set under ./sets/<name>.js can replace
// any of them. The game loads DEFAULT_SET; ?models=<name> in the address picks another, and
// ?models=current the original models. A set is a default export:
//
//   {
//     id, label,
//     unitScale?: number                          // how much larger units are drawn than the shipped ones (1 = the same)
//     soldier?(f, sub, tc, frame, lod) -> Model   // infantry, walk frame 0..3
//     hull?(f, sub, tier, tc, lod) -> Model       // a vehicle's or aircraft's body
//     turret?(f, sub, tier, tc, lod) -> Model     // the part that turns to aim (may be an empty Model)
//     spec?(f, sub, tier) -> { ... }              // sockets, see unitSpec in units.js; merged over the shipped ones
//     base?(f, sub, level, tc) -> { model, top, live? }   // a base; top = its height in model units; live = animated
//                                                 // details drawn over it (see drawBaseLive in buildings.js)
//     compound?(f, level, tc, gates, ruin) -> Model   // the wall and yard round a base (same footprint as buildCompound)
//     muzzle?(f, sub, dx, dy) -> [x, y]           // where an infantry weapon fires from (see soldierMuzzle in units.js)
//     formation?: { row, gap, lane }              // marching formation, each [unused, tier 1, tier 2, tier 3] (see game.js)
//   }
//
// Anything a set leaves out, or returns null for, falls back to the shipped model. Purely
// presentation: nothing here reaches the simulation.
export const DEFAULT_SET = 'a';
let SET = null;

export const modelSet = () => SET;

/** The set's replacement for one model, or null to use the shipped one. */
export function pick(kind, ...args) {
  if (!SET || typeof SET[kind] !== 'function') return null;
  return SET[kind](...args) || null;
}

/** Load the set named in the address (?models=x), if any. Called once, before the first match. */
export async function loadModelSet() {
  let name = '';
  try {
    // The app tidies the address bar, so also look at the address the page was opened with.
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    name = new URLSearchParams(location.search).get('models') || (nav && new URL(nav.name).searchParams.get('models')) || '';
  } catch { /* not in a browser */ }
  // The game's models are set A, "Hero silhouettes". ?models=current shows the earlier models,
  // ?models=b or c the other two samples it was chosen from.
  if (!name) name = DEFAULT_SET;
  if (!/^[a-z0-9-]{1,24}$/.test(name) || name === 'current') return null;
  try { SET = (await import(`./sets/${name}.js`)).default || null; } catch (err) { console.warn(`model set "${name}" not loaded:`, err.message); }
  return SET;
}
