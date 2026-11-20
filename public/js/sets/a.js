// Model set A: "Hero silhouettes".
//
// Chunky tabletop miniatures: exaggerated proportions and a few big shapes that read at
// gameplay zoom. Oversized turrets and barrels, wide tracks, thick-limbed infantry under big
// helmets, and large panels of team colour. Every base is a compact fortress under ONE
// landmark that makes it the tallest thing nearby: a foundry stack and gantry for the Iron
// Pact, a control tower and dish for the Meridian Alliance, a spire with a crown ring and orb
// for the Veil Collective. A base's level shows in its silhouette.
//
// All eighteen units (six rosters) and the Iron bases at every level plus the level-3 bases of
// the other two factions are here; the remaining bases and the compound wall are in
// a-bases.js. See ../modelset.js for the contract.
import { Model } from '../iso.js';
import { FACTIONS } from '../factions.js';
import { moreBase, compound } from './a-bases.js';

const TAU = Math.PI * 2, R2 = Math.SQRT2;
const BORE = '#101214', GUNMETAL = '#34383c', RUBBER = '#1d1f21', BOOT = '#1b1c1d', SKIN = '#c9a27e';
const BLACK = '#16181a', LIT = '#ffd98a', FURNACE = '#ff8a2a', SKYGLASS = '#bfe9ff';
const COPPER = '#b56a3a', WHITE_HOT = '#f3fbff';

/** A Model whose boxes can be light sources ({ glow: true }), like its columns and tubes. */
class Mini extends Model {
  box(x0, x1, y0, y1, z0, z1, c, o = {}) {
    const s = super.box(x0, x1, y0, y1, z0, z1, c, o);
    if (o.glow) for (const f of s.faces) f.glow = true;
    return s;
  }
}

/** A disc painted on a face that looks along y (road wheels on the outside of a track). */
function disc(m, solid, x, y, z, r, c, s) {
  m.decal(solid, Array.from({ length: 8 }, (_, i) => { const q = ((i + 0.5) / 8) * TAU; return [x + Math.cos(q) * r, y, z + Math.sin(q) * r]; }), c, [0, s, 0]);
}

/** One segment of a flat ring round (cx, cy): the crown of a spire, a collar. */
function ringSeg(m, cx, cy, r0, r1, a0, a1, z0, z1, c, o) {
  const p = (r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  return m.prism([p(r0, a0), p(r1, a0), p(r1, a1), p(r0, a1)], z0, z1, c, o);
}

// ============================================================ units
//
// Proportions throughout: short, tall and wide-shouldered. Every builder takes `far`: at
// lod 2 it leaves out everything that is only a few pixels across (wheels, fenders, collars,
// lamps) and uses fewer sides on round parts, for about a third of the triangles.
// `A` is the subfaction's accent colour: what its weapons and emitters glow with.

const sidesOf = (far, n) => (far ? Math.max(4, Math.round(n * 0.6)) : n);

/** Track pods: one deep, wide track each side with a few big road wheels and a slab fender. */
function pods(m, len, yIn, yOut, h, M, fender, wheels = 3, far = false) {
  for (const s of [-1, 1]) {
    const a = Math.min(s * yIn, s * yOut), b = Math.max(s * yIn, s * yOut), out = s > 0 ? b : a;
    m.tag('tread');
    if (far) { m.box(-len, len, a, b, 0.2, h, M.metal, { top: '#3a3f45' }); continue; }
    const t = m.profile([[-len, h * 0.5], [-len + 2.2, 0.2], [len - 3, 0.2], [len, h * 0.55], [len - 1.4, h], [-len + 1.2, h]], a, b, M.metal, { top: '#3a3f45' });
    m.tag('steel');
    for (let i = 0; i < wheels; i++) {
      const x = -len + 3.6 + i * ((2 * len - 7.8) / (wheels - 1));
      disc(m, t, x, out, h * 0.45, h * 0.37, '#5d656e', s);
      disc(m, t, x, out, h * 0.45, h * 0.15, '#22262a', s);
    }
    m.tag('panel');
    if (fender) m.box(-len - 0.6, len + 0.6, a - 0.5, b + 0.5, h, h + 1.3, fender);
  }
  m.tag(null);
}

/** Side skirts carrying a big team block. */
function skirts(m, x0, x1, yIn, yOut, z0, z1, col, tc, bx0, bx1, bz0, bz1) {
  for (const s of [-1, 1]) {
    const sk = m.box(x0, x1, Math.min(s * yIn, s * yOut), Math.max(s * yIn, s * yOut), z0, z1, col);
    m.onY(sk, bx0, bx1, bz0, bz1, s * yOut, tc.main, false, s);
  }
}

// ------------------------------------------------------------ IRON PACT / bastion

// Rhino: a squat slab of a tank behind a plough, under a turret too big for it, with one
// very fat gun.
function rhinoHull(m, tc, M, far) {
  pods(m, 12, 5, 9.6, 6.8, M, M.dark, 3, far);
  m.tag('panel');
  const h = m.profile([[-11.5, 3], [10.5, 3], [13, 6.4], [9, 11.4], [-10.5, 11.4], [-12.5, 7.4]], -5.4, 5.4, M.hull, { top: M.lite });
  m.onTop(h, -10, -1.5, -4.8, 4.8, 11.4, tc.main);                     // the whole engine deck is team colour
  m.profile([[11.5, 1.2], [15.6, 1.2], [13.6, 7.6], [11.5, 7.6]], -10.2, 10.2, M.dark, { top: M.metal });   // plough
  skirts(m, -9, 7.5, 10.1, 10.7, 3.2, 9.6, M.dark, tc, -7.5, 4, 4.2, 8.8);
  if (far) return m.tag(null);
  m.tag('steel');
  for (const y of [-3.2, 3.2]) m.cyl(-11, y, 1.6, 11.4, 15.6, M.metal, { n: 6, top: BORE });   // twin exhausts
  m.tag(null);
}
function rhinoTurret(m, tc, M, far) {
  m.tag('panel');
  if (!far) m.cyl(0, 0, 6.4, 11.4, 12.6, M.dark, { n: 8 });
  const t = m.prism([[-7.5, -6.6], [3, -6.6], [7.2, -3.6], [7.2, 3.6], [3, 6.6], [-7.5, 6.6]], far ? 11.4 : 12.6, 19.4, M.hull, { top: M.lite });
  m.onTop(t, -6.6, 2.2, -5.6, 5.6, 19.4, tc.main);                     // team roof
  m.tag('steel');
  m.tubeX(far ? 7.2 : 9.6, far ? 20.2 : 17.6, 0, 16, 2.5, M.metal, { n: sidesOf(far, 8), cap: BORE });   // the gun
  if (far) return m.tag(null);
  m.tubeX(16, 20.2, 0, 16, 3.6, GUNMETAL, { n: 8, cap: BORE });        // muzzle brake
  m.tag('panel');
  m.box(-10.6, -7.5, -4.8, 4.8, 13.2, 18.4, M.dark);                   // bustle
  m.box(6.8, 9.6, -3.6, 3.6, 13.2, 18.8, M.dark);                      // mantlet
  m.cyl(-2.2, -3.2, 2.6, 19.4, 21.6, M.dark, { n: 6, top: M.metal });  // cupola
  m.tag(null);
}

// Apocalypse: twice the tank. A stepped hull on very wide tracks, a broad turret with two
// fat guns, and a rocket box in team colour on each shoulder.
function apocalypseHull(m, tc, M, far) {
  pods(m, 15, 6, 11.4, 8, M, M.dark, 4, far);
  m.tag('panel');
  const h = m.profile([[-14.5, 3.5], [13.5, 3.5], [16.2, 7.5], [11.5, 12.8], [-13.5, 12.8], [-15.5, 8.5]], -6.4, 6.4, M.hull, { top: M.lite });
  m.onTop(h, 2, 10, -5.6, 5.6, 12.8, tc.main);                         // team block ahead of the turret
  skirts(m, -12, 10.5, 11.9, 12.5, 3.6, 10.8, M.dark, tc, -10.5, 9, 6.4, 10);
  m.box(-15.5, -9.5, -5, 5, 12.8, 15.8, M.dark, { top: M.metal });     // engine block
  if (far) return m.tag(null);
  for (const y of [-4.6, 0, 4.6]) m.box(15.8, 17.8, y - 1.4, y + 1.4, 2, 6.8, M.dark);   // ram teeth
  m.tag('steel');
  for (const y of [-3.2, 3.2]) m.cyl(-12.5, y, 1.9, 15.8, 21.4, M.metal, { n: 6, top: BORE });
  m.tag(null);
}
function apocalypseTurret(m, tc, M, far) {
  m.tag('panel');
  if (!far) m.cyl(0, 0, 7.4, 12.8, 14.2, M.dark, { n: 8 });
  const t = m.prism([[-8.5, -7.6], [4.5, -7.6], [8.4, -4.2], [8.4, 4.2], [4.5, 7.6], [-8.5, 7.6]], far ? 12.8 : 14.2, 21.8, M.hull, { top: M.lite });
  m.onTop(t, -7.5, 3.5, -3.8, 3.8, 21.8, tc.main);
  for (const s of [-1, 1]) {                                           // shoulder rocket boxes
    const y0 = Math.min(s * 7.6, s * 10.8), y1 = Math.max(s * 7.6, s * 10.8);
    const p = m.box(-6.5, 4.2, y0, y1, 15.6, 22.6, tc.main, { top: tc.light });
    if (!far) m.onX(p, y0 + 0.6, y1 - 0.6, 16.3, 21.9, 4.2, BORE);     // launch cells
  }
  m.tag('steel');
  for (const y of [-2.9, 2.9]) {
    m.tubeX(far ? 8.4 : 11.4, far ? 22 : 19.6, y, 17.8, 2.1, M.metal, { n: sidesOf(far, 8), cap: BORE });
    if (!far) m.tubeX(18.2, 22, y, 17.8, 3, GUNMETAL, { n: 8, cap: BORE });
  }
  if (far) return m.tag(null);
  m.tag('panel');
  m.box(8, 11.4, -5.6, 5.6, 14.8, 21, M.dark);                         // mantlet
  m.box(-12.2, -8.5, -5.6, 5.6, 15, 20.2, M.dark);                     // bustle
  m.cyl(-3, 0, 2.6, 21.8, 24.2, M.dark, { n: 6, top: M.metal });       // cupola
  m.tag(null);
}

// ------------------------------------------------------------ IRON PACT / volt
//
// The same slab-sided iron, but copper wound on everything and a cyan-white glow where the
// bastion has gun barrels.

// Tesla tank: no gun at all. A coil stack as tall as the hull is long, and a two-pronged
// emitter fork out in front.
function teslaTankHull(m, tc, M, far) {
  pods(m, 12, 5, 9.6, 6.4, M, M.dark, 3, far);
  m.tag('panel');
  const h = m.profile([[-11.5, 3], [10.5, 3], [13, 6], [9.5, 10.2], [-11, 10.2], [-12.5, 7]], -5.4, 5.4, M.hull, { top: M.lite });
  m.onTop(h, 3, 9, -4.8, 4.8, 10.2, tc.main);                          // team block on the bow
  skirts(m, -9, 7.5, 10.1, 10.7, 3.2, 9.2, M.dark, tc, -7.5, 4, 4.2, 8.4);
  m.tag('copper');
  for (const s of [-1, 1]) m.box(-10.5, -4, Math.min(s * 1.6, s * 5.2), Math.max(s * 1.6, s * 5.2), 10.2, 13.6, COPPER, { top: '#d08a52' });   // capacitor banks
  if (far) return m.tag(null);
  m.tag('panel');
  m.box(12.6, 14.2, -8, 8, 2.4, 5.4, M.dark);                          // bumper bar
  m.tag(null);
}
function teslaTankTurret(m, tc, M, far, A) {
  m.tag('panel');
  m.cyl(0, 0, 5.6, 10.2, 12.6, M.dark, { n: sidesOf(far, 8), top: tc.main });
  m.tag('steel');
  m.cyl(0, 0, 2, 12.6, 22, M.metal, { n: sidesOf(far, 6) });           // mast
  m.tag('copper');
  [[5.2, 14], [4.5, 17], [3.8, 20]].forEach(([r, z], i) => { if (!far || i === 1) m.cyl(0, 0, r, far ? 13.4 : z, z + (far ? 4 : 1.5), COPPER, { n: sidesOf(far, 8) }); });   // windings
  m.tag(null);
  m.cyl(0, 0, 1.4, 22, 24, A, { n: sidesOf(far, 8), r1: 3.8, glow: true });   // the ball on top
  m.cyl(0, 0, 3.8, 24, 26.6, WHITE_HOT, { n: sidesOf(far, 8), r1: 1.2, glow: true });
  m.tag('steel');
  if (far) { m.box(1.5, 11.8, -4.1, 4.1, 14.4, 16, M.metal); return m.tag(null); }   // the fork as one bar
  for (const y of [-3.3, 3.3]) {                                       // emitter fork
    m.box(1.5, 10, y - 0.8, y + 0.8, 14.4, 16, M.metal);
    m.box(10, 11.8, y - 1.2, y + 1.2, 14, 16.4, WHITE_HOT, { glow: true });
  }
  m.tag(null);
}

// Kirov airship: a fat envelope with a team band round its waist, a gondola slung under it
// and a tail of four fins.
function kirovHull(m, tc, M, far, A) {
  const n = sidesOf(far, 8), z = 11, SKIN_C = '#9a968b', NOSE = '#7d796f';
  m.tag('panel');
  m.tubeX(-20, -12, 0, z, 4.4, NOSE, { n, r1: 9.2 });                  // envelope, tail to nose
  m.tubeX(-12, 8, 0, z, 9.2, SKIN_C, { n });
  m.tubeX(8, 17.5, 0, z, 9.2, NOSE, { n, r1: 4.6 });
  if (!far) m.tubeX(17.5, 20.5, 0, z, 4.6, NOSE, { n, r1: 1.6 });
  m.tubeX(-4.5, 3.5, 0, z, 9.7, tc.main, { n });                       // team band
  m.profile([[-21, z], [-12.5, z], [-15, z + 11.5], [-21, z + 11.5]], -0.9, 0.9, tc.main, { top: tc.light });   // fins: up,
  m.box(-21, -13.5, -12.5, 12.5, z - 0.8, z + 0.8, tc.main, { top: tc.light });                                // across,
  if (!far) m.profile([[-21, z], [-12.5, z], [-15, z - 10], [-21, z - 10]], -0.9, 0.9, tc.main);              // and down
  const g = m.box(-7, 6, -3.3, 3.3, -2.6, 2.8, M.dark, { top: M.metal });   // gondola
  if (far) return m.tag(null);
  for (const s of [-1, 1]) m.onY(g, -5.6, 4.6, -0.6, 1.4, s * 3.3, LIT, true, s);   // lit cabin
  m.onX(g, -2.4, 2.4, -0.6, 1.6, 6, LIT, true);
  m.tag('copper');
  m.tubeX(11.5, 13.5, 0, z, 8.2, COPPER, { n });                       // copper rings round the nose
  m.tubeX(14.8, 16.4, 0, z, 6.3, COPPER, { n });
  m.tag('steel');
  for (const s of [-1, 1]) {                                           // engine pods
    m.tubeX(-7, 0, s * 10.8, 5.2, 2, M.dark, { n: 6, cap: BORE });
    m.box(-4.6, -2.6, Math.min(s * 6.4, s * 10.8), Math.max(s * 6.4, s * 10.8), 5, 6.2, M.metal);
  }
  m.tag(null);
  m.box(20.5, 21.7, -1, 1, z - 1, z + 1, A, { glow: true });           // nose light
}
function kirovTurret(m, tc, M, far) {
  m.tag('steel');
  m.cyl(0, 0, 2.6, -4.8, -2.6, M.metal, { n: sidesOf(far, 6), top: M.dark });   // bomb rack under the gondola
  if (!far) for (const x of [-1.2, 1.2]) m.box(x - 0.7, x + 0.7, -0.7, 0.7, -6.6, -4.8, '#c8322f');
  m.tag(null);
}

// ------------------------------------------------------------ MERIDIAN ALLIANCE / aegis

// Multifunction vehicle: a clean wedge on six big wheels under a launcher box as wide as the hull.
function ifvHull(m, tc, M, far) {
  m.tag('panel');
  const h = m.profile([[-12, 4], [10, 4], [13, 6.6], [7, 12.6], [-12, 12.6]], -6.2, 6.2, M.hull, { top: M.lite });
  m.onTop(h, -11, -3.5, -5.4, 5.4, 12.6, tc.main);                     // rear deck
  if (!far) m.onTop(h, 2.8, 6.4, -4.6, 4.6, 12.6, '#22303c');          // windscreen band
  for (const s of [-1, 1]) {
    m.onY(h, -11, 4.5, 8.6, 11.6, s * 6.2, tc.main, false, s);         // side band
    const y0 = Math.min(s * 6.2, s * 9.6), y1 = Math.max(s * 6.2, s * 9.6);
    m.tag('dark');
    if (far) { m.box(-11.6, 11.6, y0, y1, 0.2, 7.6, RUBBER); m.tag('panel'); continue; }   // the wheels as one dark run
    for (const x of [-8, 0, 8]) m.tubeY(y0 + 0.3, y1, x, 3.9, 3.9, RUBBER, { n: 8, cap: '#69727b' });   // big wheels
    m.tag('panel');
    m.box(-12, 11, y0, y1, 8, 9.2, M.dark);                            // mudguard
    m.box(12.4, 13.3, s * 3.8 - 1.2, s * 3.8 + 1.2, 6.4, 8, '#f4f8ff', { glow: true });   // headlamp
  }
  m.tag(null);
}
function ifvTurret(m, tc, M, far) {
  m.tag('plating');
  if (!far) m.cyl(0, 0, 4.6, 12.6, 13.8, M.dark, { n: 8 });
  const b = m.box(-5, 4, -5.4, 5.4, far ? 12.6 : 13.8, 19.6, M.lite, { top: '#e4eaee' });
  m.onTop(b, -4.2, 3.2, -4.6, 4.6, 19.6, tc.main);
  m.tag('steel');
  for (const y of [-2.7, 2.7]) {                                       // two fat launch tubes
    m.tubeX(4, far ? 10.8 : 10, y, 16.6, 2, M.metal, { n: sidesOf(far, 8), cap: BORE });
    if (!far) m.tubeX(9.2, 10.8, y, 16.6, 2.5, tc.main, { n: 8, cap: BORE });
  }
  if (far) return m.tag(null);
  m.cyl(-2.4, 0, 0.8, 19.6, 21.8, M.metal, { n: 5 });                  // sensor dish on the roof
  m.cyl(-2.4, 0, 1, 21.8, 24, M.lite, { n: 8, r1: 4.2, top: '#dfe6ea' });
  m.tag(null);
}

// Prism tank: a low tracked reactor carrying one huge faceted crystal in three claws.
function prismHull(m, tc, M, far) {
  pods(m, 12, 5, 9.2, 5.8, M, M.dark, 3, far);
  m.tag('plating');
  const h = m.profile([[-11.5, 3], [10.5, 3], [13, 5.5], [8, 9.8], [-11, 9.8], [-12.5, 6]], -5.4, 5.4, M.hull, { top: M.lite });
  m.onTop(h, 3, 7.6, -4.6, 4.6, 9.8, tc.main);
  const r = m.box(-11.5, -5.5, -4.8, 4.8, 9.8, 13.6, M.dark, { top: M.metal });   // reactor block
  if (!far) for (const s of [-1, 1]) m.onY(r, -10.6, -6.4, 10.8, 12.6, s * 4.8, M.glow, true, s);   // glowing vents
  m.tag(null);
}
function prismTurret(m, tc, M, far) {
  m.tag('plating');
  if (!far) m.cyl(0, 0, 4.4, 9.8, 11.4, M.dark, { n: 8 });
  m.cyl(0, 0, 2.2, far ? 9.8 : 11.4, 17.5, M.metal, { n: sidesOf(far, 6) });   // mast
  for (let i = 0; i < 3; i++) {                                        // three claws in team colour
    const a = (i / 3) * TAU + Math.PI, x = Math.cos(a) * 4.8, y = Math.sin(a) * 4.8;
    m.box(x - 1.2, x + 1.2, y - 1.2, y + 1.2, 13, 23, tc.main, { top: tc.light });
  }
  m.tag(null);
  m.cyl(0, 0, 1, 17.5, 23.5, M.glow, { n: sidesOf(far, 6), r1: 5.8, glow: true });   // the crystal: two cones base to base
  m.cyl(0, 0, 5.8, 23.5, 31, M.glow, { n: sidesOf(far, 6), r1: 0.8, glow: true, top: '#ffffff' });
}

// ------------------------------------------------------------ MERIDIAN ALLIANCE / shade
//
// Where the aegis is white and tall, the shade is dark slate and low to the road, with a thin
// racing stripe of team colour and teal light where it has any light at all.
const SLATE = '#5a666e', SLATE_LO = '#3c464d', SLATE_HI = '#7d8a93';

// Grizzly: a low, quick tank. Flat wedge turret, one long slim gun, a team stripe nose to tail.
function grizzlyHull(m, tc, M, far) {
  pods(m, 12, 4.8, 9, 5.6, { metal: '#2a3036' }, SLATE_LO, 4, far);
  m.tag('plating');
  const h = m.profile([[-11.5, 2.8], [10.5, 2.8], [13.5, 5], [8, 8.8], [-11, 8.8], [-12.5, 6]], -5.2, 5.2, SLATE, { top: SLATE_HI });
  m.onTop(h, -11, 8, -1.7, 1.7, 8.8, tc.main);                         // racing stripe
  for (const s of [-1, 1]) m.onY(h, -9.5, 2, 6, 8, s * 5.2, tc.main, false, s);
  if (far) return m.tag(null);
  m.box(-12.6, -11, -4.4, 4.4, 6.4, 9.6, SLATE_LO);                    // engine louvre
  m.tag(null);
}
function grizzlyTurret(m, tc, M, far, A) {
  m.tag('plating');
  const t = m.prism([[-7, -5.4], [2, -5.4], [7.5, -2.4], [7.5, 2.4], [2, 5.4], [-7, 5.4]], 8.8, 13.6, SLATE, { top: SLATE_HI });
  m.onTop(t, -6, 1.5, -1.7, 1.7, 13.6, tc.main);
  m.tag('steel');
  m.tubeX(7.5, 19.6, 0, 11.4, 1.5, '#2a3036', { n: sidesOf(far, 6), cap: BORE });   // the long gun
  if (far) return m.tag(null);
  m.tubeX(17.8, 20.2, 0, 11.4, 2.2, GUNMETAL, { n: 6, cap: BORE });
  m.box(-9.5, -7, -3.6, 3.6, 9.6, 12.8, SLATE_LO);                     // bustle
  m.box(-4.6, -4, 3.2, 3.8, 13.6, 19, '#15171a');                      // sensor mast
  m.tag(null);
  m.box(-5, -3.6, 2.8, 4.2, 19, 20.4, A, { glow: true });
}

// Mirage: a flat faceted shell that hides its tracks, and on it a rail lance: two rails, a line
// of teal light between them, a counterweight in team colour.
function mirageHull(m, tc, M, far, A) {
  pods(m, 12, 4.6, 8.4, 4.2, { metal: '#2a3036' }, null, 4, far);
  m.tag('plating');
  m.prism([[15.5, 0], [9, -10], [-12.8, -10], [-12.8, 10], [9, 10]], 4.2, 6.4, SLATE_LO, { top: SLATE });   // skirt plate
  const h = m.profile([[-12, 6.4], [10.5, 6.4], [5, 10.2], [-9, 10.2]], -6.6, 6.6, SLATE, { top: SLATE_HI });
  m.onTop(h, -8.4, -3, -5.4, 5.4, 10.2, tc.main);                      // team block on the tail deck
  if (far) return m.tag(null);
  for (const s of [-1, 1]) m.onY(h, -8, 3, 7.6, 8.6, s * 6.6, A, true, s);   // a slit of light down each flank
  m.tag(null);
}
function mirageTurret(m, tc, M, far, A) {
  m.tag('plating');
  m.cyl(0, 0, 4.2, 10.2, 11.6, SLATE_LO, { n: sidesOf(far, 8) });
  m.box(-6.5, -0.5, -3.4, 3.4, 11.6, 14.4, tc.main, { top: tc.light });   // counterweight
  m.tag('steel');
  for (const y of [-1.7, 1.7]) m.box(-0.5, 17, y - 0.6, y + 0.6, 11.4, 13.4, '#2a3036');   // rails
  m.tag(null);
  m.box(1, 16.6, -1.1, 1.1, 12, 12.9, A, { glow: true });             // the light between them
  if (!far) m.tubeX(16.6, 18.8, 0, 12.4, 2.3, A, { n: 6, glow: true });
}

// ------------------------------------------------------------ VEIL COLLECTIVE / dominion

// Shenfeng: an arrowhead that rides on air, all prow, with two tall tail fins in team colour.
function shenfengHull(m, tc, M, far) {
  m.tag('panel');
  if (!far) m.prism([[11, 0], [2.5, -6], [-9, -6.6], [-9, 6.6], [2.5, 6]], 0, 2, M.metal);           // lift skirt
  const h = m.prism([[14.5, 0], [4, -8], [-10.5, -8.6], [-10.5, 8.6], [4, 8]], far ? 0.6 : 2, 7.8, M.lite, { top: '#8f84a8' });
  m.onTop(h, -9, 1, -3.2, 3.2, 7.8, tc.main);                                                        // spine
  if (!far) m.cyl(-2, 0, 6.6, 7.8, 11.4, M.hull, { n: 8, r1: 4, sy: 0.72, top: M.lite });            // carapace
  if (!far) m.profile([[10, 2.2], [17.5, 3.4], [10, 6.4]], -1.4, 1.4, '#cfc6e6');                    // ram blade
  for (const s of [-1, 1]) {                                                                         // tail fins
    const y0 = Math.min(s * 6, s * 7.8), y1 = Math.max(s * 6, s * 7.8);
    m.profile([[-12.5, 5], [-4, 5], [-8.5, 17.5], [-12.5, 17.5]], y0, y1, tc.main, { top: tc.light });
  }
  if (!far) m.box(-11.6, -10.5, -5.2, 5.2, 3, 6.8, M.glow, { glow: true });                          // thruster glow
  m.tag(null);
}
function shenfengTurret(m, tc, M, far) {
  m.tag('panel');
  m.cyl(0, 0, 3.6, far ? 7.8 : 11.4, 14.2, M.dark, { n: sidesOf(far, 8), r1: 2.6, top: tc.main });
  m.tag('steel');
  m.tubeX(1.8, far ? 9.8 : 8.6, 0, 12.8, 1.7, M.metal, { n: sidesOf(far, 6), cap: BORE });
  m.tag(null);
  if (!far) m.tubeX(7.8, 9.8, 0, 12.8, 2.4, M.glow, { n: 6, glow: true });   // emitter
}

// Flying disc: a thick saucer under a crown in team colour, one great eye beneath it.
function discHull(m, tc, M, far) {
  const n = sidesOf(far, 12);
  m.tag('panel');
  m.cyl(0, 0, 6.5, -3.6, 0, M.hull, { n, r1: 13 });                    // belly flare
  if (!far) m.cyl(0, 0, 13, 0, 2.8, M.lite, { n });                    // rim
  m.cyl(0, 0, 13, far ? 0 : 2.8, 7, '#8f84a8', { n, r1: 7.4, top: tc.main });   // upper dish, team crown
  if (far) return m.tag(null);
  m.cyl(0, 0, 5, 7, 10.6, M.hull, { n: 8, r1: 2.6, top: M.glow });     // cupola
  for (let i = 0; i < 6; i++) {                                        // rim lights
    const a = (i / 6) * TAU + 0.26, x = Math.cos(a) * 12.3, y = Math.sin(a) * 12.3;
    m.box(x - 1.1, x + 1.1, y - 1.1, y + 1.1, 0.6, 2.2, M.glow, { glow: true });
  }
  m.tag(null);
}
function discTurret(m, tc, M, far) {
  m.cyl(0, 0, 4.8, -6, -3.6, M.glow, { n: sidesOf(far, 8), r1: 6, glow: true });   // the eye
  if (!far) m.cyl(0, 0, 2, -7.4, -6, '#ffffff', { n: 6, r1: 4, glow: true });
}

// ------------------------------------------------------------ VEIL COLLECTIVE / forge
//
// The dominion is psychic and smooth; the forge is machinery. Square sleds, tanks of reagent,
// brass, and green light instead of violet.
const BRASS = '#b08a3a';

// Gatling: a square hover sled carrying a rotary cannon as long as itself, fed from two glowing tanks.
function gatlingHull(m, tc, M, far, A) {
  m.tag('panel');
  if (!far) m.prism([[10, -6], [10, 6], [-10.5, 6.8], [-10.5, -6.8]], 0, 2, M.metal);                // lift skirt
  const b = m.box(-11, 10, -7.6, 7.6, far ? 0.6 : 2, 7.4, M.lite, { top: '#8f84a8' });
  m.onTop(b, -3, 9, -6.4, 6.4, 7.4, tc.main);                                                        // team foredeck
  for (const s of [-1, 1]) m.onY(b, -9.5, 6, 3.4, 6.4, s * 7.6, tc.main, false, s);
  m.profile([[10, far ? 0.6 : 2], [13.6, 2], [10, 7.4]], -7.6, 7.6, M.hull);                         // bow plate
  m.tag(null);
  for (const y of [-4, 4]) {                                                                         // reagent tanks
    m.cyl(-7.4, y, 2.7, 7.4, 13, A, { n: sidesOf(far, 6), glow: true });
    if (!far) m.cyl(-7.4, y, 3, 13, 14, M.metal, { n: 6 });
  }
}
function gatlingTurret(m, tc, M, far) {
  m.tag('panel');
  if (!far) m.cyl(0, 0, 4.6, 7.4, 9.4, M.dark, { n: 8 });
  const h = m.box(-4.5, 3, -3.6, 3.6, far ? 7.4 : 9.4, 15.2, M.hull, { top: tc.main });               // housing, team roof
  void h;
  m.tag('steel');
  if (far) { m.tubeX(3, 15, 0, 12.4, 2.6, M.metal, { n: 5, cap: BORE }); return m.tag(null); }       // the barrel cluster as one bar
  for (const [y, z] of [[-1.35, 11.2], [1.35, 11.2], [-1.35, 13.7], [1.35, 13.7]]) m.tubeX(3, 14.4, y, z, 0.95, M.metal, { n: 5, cap: BORE });
  m.tubeX(8, 9.4, 0, 12.45, 3, M.dark, { n: 8 });                                                    // barrel clamps
  m.tubeX(13.2, 14.8, 0, 12.45, 3, M.dark, { n: 8, cap: BORE });
  m.tag('copper');
  m.box(-4.5, -0.8, 3.6, 6.6, 9.6, 13.6, BRASS, { top: '#d0aa52' });                                 // ammunition drum
  m.tag(null);
}

// Brain vehicle: a six-sided platform, three team-colour horns, and between them a great dome of green light.
function brainHull(m, tc, M, far, A) {
  m.tag('panel');
  if (!far) m.cyl(0, 0, 10.6, 0, 2, M.metal, { n: 6 });                                              // lift skirt
  m.cyl(0, 0, 12.4, far ? 0.6 : 2, 6, M.lite, { n: 6, top: '#8f84a8' });
  for (let i = 0; i < 3; i++) {                                                                      // horns
    const a = (i / 3) * TAU + Math.PI / 3, x = Math.cos(a) * 9.4, y = Math.sin(a) * 9.4;
    block(m, x, y, 2.1, 0.8, 6, 16.5, tc.main, { top: tc.light });
  }
  if (far) return m.tag(null);
  for (let i = 0; i < 6; i++) {                                                                      // lights on the corners
    const a = (i / 6) * TAU, x = Math.cos(a) * 11.2, y = Math.sin(a) * 11.2;
    m.box(x - 0.9, x + 0.9, y - 0.9, y + 0.9, 6, 7.2, A, { glow: true });
  }
  m.tag(null);
}
function brainTurret(m, tc, M, far, A) {
  m.tag('panel');
  m.cyl(0, 0, 7.4, 6, 8.6, M.dark, { n: sidesOf(far, 8) });                                          // collar
  m.tag(null);
  m.cyl(0, 0, 6.8, 8.6, 14, A, { n: sidesOf(far, 8), r1: 5.8, glow: true });                         // the dome
  m.cyl(0, 0, 5.8, 14, 18, A, { n: sidesOf(far, 8), r1: 2.2, glow: true, top: '#f1fff6' });
  if (far) return;
  m.tag('steel');
  m.cyl(0, 0, 0.6, 18, 23, M.metal, { n: 5 });                                                       // aerial
  m.tag(null);
  m.box(-0.9, 0.9, -0.9, 0.9, 23, 24.6, '#f1fff6', { glow: true });
}

// ============================================================ infantry
//
// Big heads, big shoulders, big weapons, and deep enough front to back that a column seen
// from the side is still a row of people rather than a row of posts.

/** Thick legs in mid-stride and heavy boots. sw: -1, 0 or 1. */
function legs(m, sw, col, far) {
  m.box(sw * 2.6 - 1.9, sw * 2.6 + 1.9, -3.9, -0.5, 0, 6.6, col);
  m.box(-sw * 2.6 - 1.9, -sw * 2.6 + 1.9, 0.5, 3.9, 0, 6.6, col);
  if (far) return;
  m.box(sw * 2.6 - 2.1, sw * 2.6 + 2.9, -4.1, -0.3, 0, 1.9, BOOT);
  m.box(-sw * 2.6 - 2.1, -sw * 2.6 + 2.9, 0.3, 4.1, 0, 1.9, BOOT);
}

const SOLDIERS = {
  // Conscript: a pale greatcoat, slab pauldrons in team colour, a very wide helmet, a long fat rifle.
  'iron|bastion'(m, tc, M, sw, far) {
    const COAT = '#b5ae9a';
    legs(m, sw, '#34352f', far);
    m.tag('cloth');
    if (!far) m.cyl(0, 0, 5.6, 5.2, 8.6, COAT, { n: 6, r1: 4.4 });      // coat hem
    m.box(-3.3, 3.3, -4.3, 4.3, far ? 6.6 : 7.8, 14.6, COAT);
    m.tag('panel');
    m.box(-3.7, 3.7, -5.5, -3.9, 11.6, 15.4, tc.main, { top: tc.light });   // pauldrons
    m.box(-3.7, 3.7, 3.9, 5.5, 11.6, 15.4, tc.main, { top: tc.light });
    m.cyl(0, 0, 5.2, 15.8, 17, M.dark, { n: sidesOf(far, 8) });         // helmet brim
    m.cyl(0, 0, 4.2, 17, 20.2, tc.main, { n: sidesOf(far, 8), r1: 2.8, top: tc.light });
    m.tag('steel');
    m.box(1, 13, 3, 4.8, 10.2, 12.2, '#2b2e31');                        // rifle
    if (far) return m.tag(null);
    m.box(13, 15.6, 3.6, 4.2, 10.9, 11.5, '#c9cdd1');                   // bayonet
    m.tag('cloth');
    m.box(-5.4, -3.3, -3, 3, 8.4, 14, '#5a5848');                       // pack
    m.box(-1.8, 1.8, -1.8, 1.8, 14.6, 16.2, SKIN);
    m.box(0.6, 4.6, 2.8, 5, 9.8 + sw * 0.4, 11.8 + sw * 0.4, COAT);     // forearm on the rifle
    m.tag(null);
  },
  // Tesla trooper: a dark insulated suit, a copper coil pack with two live rods standing out
  // of it, a steel dome with a lit visor, and gauntlets instead of a gun.
  'iron|volt'(m, tc, M, sw, far, A) {
    const SUIT = '#7d776c';
    legs(m, sw, '#3a3c3e', far);
    m.tag('panel');
    m.box(-3.4, 3.4, -4.4, 4.4, 6.6, 14.4, SUIT);
    m.box(-3.8, 3.8, -5.6, -4, 11.4, 15.2, tc.main, { top: tc.light });   // pauldrons
    m.box(-3.8, 3.8, 4, 5.6, 11.4, 15.2, tc.main, { top: tc.light });
    m.tag('steel');
    m.cyl(0, 0, 3.7, 14.4, 18.8, M.metal, { n: sidesOf(far, 8), r1: 2.6, top: '#4a4e53' });   // dome
    m.tag('copper');
    m.box(-6.4, -3.4, -3.3, 3.3, 8, 15.8, COPPER, { top: '#d08a52' });  // coil pack
    m.tag(null);
    if (far) { m.box(-5.9, -3.9, -2.9, 2.9, 15.8, 21, A, { glow: true }); m.box(2.4, 6.9, -5.6, 5.6, 9.4, 12.2, COPPER); return; }
    for (const y of [-1.9, 1.9]) m.cyl(-4.9, y, 1, 15.8, 21, A, { n: 5, glow: true });   // live rods
    for (const s of [-1, 1]) {                                          // gauntlets, lit at the knuckles
      const y0 = Math.min(s * 3.2, s * 5.6), y1 = Math.max(s * 3.2, s * 5.6), z = 9.4 + s * sw * 0.5;
      m.box(2.4, 6, y0, y1, z, z + 2.8, COPPER);
      m.box(6, 6.9, y0, y1, z, z + 2.8, WHITE_HOT, { glow: true });
    }
    if (!far) m.box(2.6, 3.9, -2.2, 2.2, 15.6, 17, A, { glow: true });  // visor
  },
  // Guardian: white plate over a dark suit, a lit visor, an aerial, a launcher tube on the shoulder.
  'meridian|aegis'(m, tc, M, sw, far) {
    legs(m, sw, M.hull, far);
    m.tag('plating');
    m.box(-3.2, 3.2, -4.2, 4.2, 6.6, 14.2, M.lite);
    if (!far) m.box(-3.5, 3.5, -4.5, 4.5, 9, 10.8, tc.main);            // waist band
    for (const y of [-4.7, 4.7]) m.cyl(0, y, 2.5, 11.8, 15.2, tc.main, { n: sidesOf(far, 6), r1: 1.9, top: tc.light });   // round pauldrons
    m.cyl(0, 0, 3.3, 14.2, 18.6, M.lite, { n: sidesOf(far, 8), r1: 2.7, top: tc.main });
    m.tag('steel');
    m.tubeX(-6, 10.6, -3.6, 16.6 + sw * 0.3, 2.1, M.metal, { n: sidesOf(far, 6), cap: BORE });   // launcher
    if (far) return m.tag(null);
    m.tubeX(7.4, 11, -3.6, 16.6 + sw * 0.3, 2.7, tc.main, { n: 6, cap: BORE });
    m.tag('plating');
    m.box(2.2, 3.4, -2.3, 2.3, 15.4, 17, M.glow, { glow: true });       // visor
    m.box(-5.4, -3.2, -3, 3, 8, 14.6, M.dark);                          // pack
    m.box(-4.9, -4.2, 1.6, 2.3, 14.6, 23.6, '#15171a');                 // aerial
    m.box(-5.3, -3.8, 1.2, 2.7, 23.6, 25, M.glow, { glow: true });
    m.tag(null);
  },
  // GI: dark slate fatigues, a low helmet with a team band, a team plate on the chest and a
  // short carbine. No pack frame, no aerial: the plain soldier of the two.
  'meridian|shade'(m, tc, M, sw, far, A) {
    legs(m, sw, '#3d4a4f', far);
    m.tag('cloth');
    m.box(-3, 3, -4, 4, 6.6, 13.8, SLATE);
    m.tag('plating');
    m.box(-3.4, 3.4, -3, 3, 9.6, 13, tc.main, { top: tc.light });       // chest and back plate
    m.cyl(0, 0, 3.9, 13.8, 15, tc.main, { n: sidesOf(far, 8) });        // helmet band
    m.cyl(0, 0, 3.9, 15, 18, SLATE_LO, { n: sidesOf(far, 8), r1: 2.6, top: SLATE });
    m.tag('steel');
    m.box(1, 10.6, 2.6, 4.2, 9.8 + sw * 0.3, 11.6 + sw * 0.3, '#22272c');   // carbine
    if (far) return m.tag(null);
    m.tag('cloth');
    for (const y of [-4.6, 4.6]) m.box(-1.6, 1.6, y - 0.9, y + 0.9, 8.4, 13.4, SLATE_LO);   // arms
    m.box(-4.6, -3, -2.4, 2.4, 8, 12, SLATE_LO);                        // small pack
    m.tag(null);
    m.box(2.8, 3.9, -1.8, 1.8, 15.4, 16.4, A, { glow: true });          // visor
  },
  // Initiate: no legs to see, only a robe that sways as it glides, a tall cowl with a lit
  // face, a mantle in team colour and a halo.
  'veil|dominion'(m, tc, M, sw, far) {
    m.tag('cloth');
    m.cyl(sw * 0.8, 0, 5.6, 0, 8.4, M.lite, { n: 6, r1: 4 });
    m.cyl(0, 0, 4, 8.4, 14.2, M.lite, { n: 6, r1: 3.4 });
    m.tag('panel');
    m.cyl(0, 0, 5.6, 12.4, 14.8, tc.main, { n: 6, r1: 3.6, top: tc.light });   // mantle
    m.cyl(0, 0, 3.3, 14.8, 20.6, M.hull, { n: 6, r1: 1.5 });            // cowl
    m.tag(null);
    m.cyl(0, 0, 4.4, 22.4, 23.2, M.glow, { n: 6, glow: true });         // halo
    if (far) return;
    m.box(1.9, 3.3, -1.3, 1.3, 15.8, 17.8, M.glow, { glow: true });     // face
    m.box(3.4, 5.6, -4.2, -2, 10 + sw * 0.8, 12.2 + sw * 0.8, M.glow, { glow: true });   // lit hands
    m.box(3.4, 5.6, 2, 4.2, 10 - sw * 0.8, 12.2 - sw * 0.8, M.glow, { glow: true });
    m.box(0.4, 3.6, -4.5, -2.3, 10.4, 12.8, M.lite);                     // sleeves
    m.box(0.4, 3.6, 2.3, 4.5, 10.4, 12.8, M.lite);
  },
  // Virus sniper: a hooded figure on two thin legs behind a rifle twice its own length, a
  // cape in team colour, and a tank of something green on its back.
  'veil|forge'(m, tc, M, sw, far, A) {
    legs(m, sw, M.dark, far);
    m.tag('cloth');
    m.box(-3, 3, -3.8, 3.8, 6.6, 13.6, M.lite);
    m.tag('panel');
    m.box(-3.6, 1.4, -4.8, 4.8, 10.6, 14.4, tc.main, { top: tc.light });   // cape over the shoulders
    m.cyl(0, 0, 3.3, 13.6, 18.4, M.hull, { n: sidesOf(far, 6), r1: 2 });   // hood
    m.tag('steel');
    m.box(1.5, 21, 2.6, 3.9, 10.8, 12.2, '#22202a');                    // the long rifle
    m.tag(null);
    m.cyl(-4.8, 0, 2.3, 7.6, 14.6, A, { n: sidesOf(far, 6), glow: true });   // reagent tank
    if (far) return;
    m.box(21, 23, 2.9, 3.6, 11.1, 11.9, '#8f84a8');                     // suppressor
    m.box(7, 10.4, 2.5, 4, 12.2, 13.8, A, { glow: true });              // scope
    m.box(1.8, 3.1, -1.5, 1.5, 15, 16.2, A, { glow: true });            // mask lenses
    m.box(14.6, 15.4, 3, 3.5, 6.6, 10.8, '#22202a');                    // bipod
    m.cyl(-4.8, 0, 2.6, 14.6, 15.6, M.metal, { n: 6 });
  },
};

/** Where each infantry weapon ends, in model units: [how far forward, how high]. */
const MUZZLES = {
  'iron|bastion': [15, 11.2], 'iron|volt': [7, 10.8],
  'meridian|aegis': [11, 16.6], 'meridian|shade': [10.6, 10.7],
  'veil|dominion': [3, 22.8], 'veil|forge': [22.5, 11.5],
};

// ============================================================ bases

/** A square block, optionally battered: half-side h0 at z0 tapering to h1 at z1. */
const block = (m, cx, cy, h0, h1, z0, z1, c, o = {}) => m.cyl(cx, cy, h0 * R2, z0, z1, c, { n: 4, rot: Math.PI / 4, r1: h1 * R2, ...o });

/** A foundry stack: a pale tapering column banded with dark collars, the top one in team colour, and a glowing mouth. */
function stack(m, x, y, r, z0, z1, M, tc, collars) {
  m.tag('concrete');
  m.cyl(x, y, r, z0, z1, '#8d887c', { n: 8, r1: r * 0.8 });
  m.tag('steel');
  const at = k => r - (r * 0.2 * k);                                    // radius at fraction k of the way up
  collars.forEach((k, i) => {
    const last = i === collars.length - 1, zc = z0 + (z1 - z0) * k;
    m.cyl(x, y, at(k) + 1.1, zc, zc + (last ? r * 0.9 : 2.6), last ? tc.main : '#26282b', { n: 8 });
  });
  m.cyl(x, y, r * 0.8 + 1.1, z1, z1 + 2.4, '#1c1d1f', { n: 8 });
  m.cyl(x, y, r * 0.64, z1 + 2.4, z1 + 3, FURNACE, { n: 8, glow: true });
  m.tag(null);
}

/**
 * Iron Pact: a slab-sided keep with a furnace mouth in two faces and a gun on the roof.
 * Level 1 is the keep and a stub of a stack; level 2 adds an upper tier and a real stack;
 * level 3 is a two-tier keep under a giant foundry stack with a gantry crane.
 */
function ironBase(level, tc, M) {
  const m = new Mini();
  const WALL = '#b9b4a6', FOOT = '#6f6d66';   // pale slab walls: camera-facing walls are in shade, so they are painted light
  const half = [0, 16, 19.5, 23][level], h1 = [0, 12, 15, 17][level];
  m.tag('concrete');
  block(m, 0, 0, half + 3, half + 0.6, 0, 3, FOOT, { top: '#7d7b73' });           // battered footing
  m.tag('panel');
  const k = m.box(-half, half, -half, half, 3, h1, WALL);
  m.tag('concrete');
  const mouth = [0, 4, 5.5, 7][level], mh = [0, 6, 8, 9.5][level];
  for (const on of [(a, b, z0, z1, c, g) => m.onX(k, a, b, z0, z1, half, c, g), (a, b, z0, z1, c, g) => m.onY(k, a, b, z0, z1, half, c, g)]) {
    on(-mouth - 1.4, mouth + 1.4, 3, 3 + mh + 1.4, BLACK);                        // furnace mouth: a dark surround,
    on(-mouth, mouth, 3, 3 + mh * 0.62, FURNACE, true);                           // a wide hearth
    on(-mouth * 0.6, mouth * 0.6, 3 + mh * 0.62, 3 + mh, FURNACE, true);          // and a narrower crown
  }
  m.tag('panel');
  for (const s of [-1, 1]) {                                                      // a broad team band round the top of the keep
    m.onX(k, -half, half, h1 - 3.6, h1, s * half, tc.main, false, s);
    m.onY(k, -half, half, h1 - 3.6, h1, s * half, tc.main, false, s);
  }
  const roof = m.box(-half - 1.2, half + 1.2, -half - 1.2, half + 1.2, h1, h1 + 1.6, M.dark, { top: M.hull });
  let top = h1 + 1.6, deck = top;
  const c2 = level === 2 ? 3.5 : 4;                                               // the upper tier stands toward the gate
  if (level >= 2) {
    const t2 = level === 2 ? 12 : 15, z2 = top + (level === 2 ? 7 : 10);
    const u = m.box(c2 - t2, c2 + t2, c2 - t2, c2 + t2, top, z2, WALL);
    for (const s of [-1, 1]) {
      m.onX(u, c2 - t2, c2 + t2, z2 - 3, z2, c2 + s * t2, tc.main, false, s);
      m.onY(u, c2 - t2, c2 + t2, z2 - 3, z2, c2 + s * t2, tc.main, false, s);
    }
    for (const w of [-6.5, 0, 6.5]) {                                             // lit slit windows
      m.onX(u, c2 + w - 2, c2 + w + 2, top + 1.6, z2 - 4.4, c2 + t2, LIT, true);
      m.onY(u, c2 + w - 2, c2 + w + 2, top + 1.6, z2 - 4.4, c2 + t2, LIT, true);
    }
    const r2 = m.box(c2 - t2 - 1, c2 + t2 + 1, c2 - t2 - 1, c2 + t2 + 1, z2, z2 + 1.4, M.dark, { top: M.hull });
    m.onTop(r2, c2 - t2 + 1.5, c2 + t2 - 1.5, c2 - t2 + 1.5, c2 - 1, z2 + 1.4, tc.main);
    deck = z2 + 1.4;
  } else {
    m.onTop(roof, -half + 2, half - 2, 1, half - 2, top, tc.main);
  }
  // The roof gun: bigger with every level, pointing out over the gate.
  const g = [0, 4.6, 5.8, 7.2][level], gx = level === 1 ? 4 : c2 + 1, gy = level === 1 ? 6 : c2 + 3;
  m.cyl(gx, gy, g, deck, deck + g * 0.55, M.dark, { n: 8, top: M.hull });
  const gb = m.box(gx - g * 0.9, gx + g * 0.7, gy - g * 0.75, gy + g * 0.75, deck + g * 0.55, deck + g * 1.3, M.hull, { top: M.lite });
  m.onTop(gb, gx - g * 0.7, gx + g * 0.2, gy - g * 0.55, gy + g * 0.55, deck + g * 1.3, tc.main);
  m.tag('steel');
  m.tubeX(gx + g * 0.7, gx + g * 2.7, gy, deck + g * 0.92, g * 0.36, M.metal, { n: 8, cap: BORE });
  m.tubeX(gx + g * 2.2, gx + g * 2.9, gy, deck + g * 0.92, g * 0.52, GUNMETAL, { n: 8, cap: BORE });
  m.tag(null);
  // The landmark, and what moves on it: smoke off the stack, the glow of the furnace mouth.
  const live = [{ k: 'glow', at: [half + 1, 0, 3 + mh * 0.5], r: mouth + 3, col: FURNACE }];
  if (level === 1) {
    stack(m, -9, -9, 3.6, h1 + 1.6, 27, M, tc, [0.5]);
    live.push({ k: 'smoke', at: [-9, -9, 30.5], size: 0.8, dark: true });
    top = 30;
  } else if (level === 2) {
    stack(m, -11.5, -11.5, 5.6, h1 + 1.6, 49, M, tc, [0.3, 0.68]);
    live.push({ k: 'smoke', at: [-11.5, -11.5, 52.5], size: 1.15, dark: true });
    top = 52;
  } else {
    const z0 = h1 + 1.6, zt = 80;
    stack(m, -13, -13, 8.4, z0, zt, M, tc, [0.2, 0.44, 0.7]);
    m.tag('steel');
    m.box(15.5, 19.5, -19.5, -15.5, z0, 61, M.dark);                             // gantry leg
    m.box(-9, 20.5, -19.5, -15.5, 57, 61, M.dark, { top: M.metal });             // gantry beam, from the stack
    m.box(-9, 20.5, -15.5, -15, 58, 60, '#e3a51f');                              // hazard face on the beam
    m.box(4.6, 5.4, -17.9, -17.1, 45, 57, '#15171a');                            // cable
    m.box(2.6, 7.4, -19.5, -15.5, 41, 45, '#e3a51f', { top: '#84590a' });        // hook block
    m.tag(null);
    live.push({ k: 'smoke', at: [-13, -13, zt + 3.5], size: 1.6, dark: true }, { k: 'beacon', at: [20, -17.5, 61.6] });
    top = zt + 3;
  }
  return { model: m, top, live };
}

/**
 * Meridian Alliance, level 3: a clean hangar on a pad, and beside it a tall control tower
 * with a lit cab and a big dish.
 */
function meridianBase(tc, M) {
  const m = new Mini();
  m.tag('concrete');
  m.cyl(0, 0, 24, 0, 1.2, '#8d949a', { n: 8, rot: Math.PI / 8, top: '#a3aab0' });   // pad
  m.tag('plating');
  const h = m.box(-3, 20, -16, 16, 1.2, 12, M.lite);                               // hangar
  m.onX(h, -12, 12, 1.2, 10.2, 20, '#27313a');                                     // door
  m.onX(h, -12, 12, 7, 8.6, 20, tc.main);
  m.onX(h, -12, 12, 2.6, 3.8, 20, tc.main);
  m.onY(h, 0, 17, 5.4, 8.6, 16, SKYGLASS, true);                                   // lit clerestory
  m.onY(h, -3, 20, 10.2, 12, 16, tc.main);
  const r = m.ridge(-4, 21, -17, 17, 12, 19.5, M.hull, { gable: M.lite });         // roof, ridge along x
  for (const f of r.faces.slice(0, 2)) {                                           // a broad team stripe over the ridge
    const y1 = f.p[0][1];
    m.decal(r, [[4, y1, 12], [13, y1, 12], [13, 0, 19.5], [4, 0, 19.5]], tc.main, f.n);
  }
  // The landmark: control tower.
  const tx = -13, ty = -11;
  m.cyl(tx, ty, 7.4, 1.2, 4.4, M.dark, { n: 8 });
  m.cyl(tx, ty, 5.6, 4.4, 52, M.lite, { n: 8, r1: 4.8 });
  for (const z of [17, 36]) m.cyl(tx, ty, 6.4, z, z + 4, tc.main, { n: 8 });        // team bands
  m.cyl(tx, ty, 5, 52, 55, M.dark, { n: 8, r1: 10.2 });                            // flare under the cab
  m.cyl(tx, ty, 10.2, 55, 61.5, SKYGLASS, { n: 8, glow: true });                   // the cab, lit all round
  m.cyl(tx, ty, 11.4, 61.5, 63.4, M.lite, { n: 8, top: tc.main });
  m.tag('steel');
  m.cyl(tx, ty, 1.3, 63.4, 68, M.metal, { n: 6 });
  m.cyl(tx, ty, 2.2, 68, 74.5, M.lite, { n: 10, r1: 13.5, top: '#dfe6ea' });       // dish
  m.cyl(tx, ty, 0.8, 74.5, 81, M.metal, { n: 5 });
  m.box(tx - 1.1, tx + 1.1, ty - 1.1, ty + 1.1, 81, 83.2, '#ff5a4d', { glow: true });   // beacon
  m.tag('plating');
  for (const [x, y] of [[-14, 8.5], [-14, 17]]) m.cyl(x, y, 4, 1.2, 9.6, M.hull, { n: 8, top: tc.main });   // fuel tanks
  for (const a of [0.4, 2, 3.5, 5.1]) {                                            // pad lights
    const x = Math.cos(a) * 22, y = Math.sin(a) * 22;
    m.box(x - 0.9, x + 0.9, y - 0.9, y + 0.9, 1.2, 2.4, M.glow, { glow: true });
  }
  m.tag(null);
  const live = [{ k: 'radar', at: [tx, ty, 75.5] }, { k: 'beacon', at: [tx, ty, 83.6] }, { k: 'glow', at: [tx, ty, 58], r: 12, col: SKYGLASS }];
  return { model: m, top: 83, live };
}

/**
 * Veil Collective, level 3: a pale domed shell ringed by four pylons in team colour, and from
 * its crown a tall spire carrying a floating ring and an orb.
 */
function veilBase(tc, M) {
  const m = new Mini();
  const SHELL = '#8f84a8', PALE = '#aaa0c2';
  m.tag('concrete');
  m.cyl(0, 0, 24, 0, 2.4, '#4b4358', { n: 10, top: '#5f5673' });
  m.tag('panel');
  m.cyl(0, 0, 22, 2.4, 9.5, M.lite, { n: 10, r1: 19 });                            // shell
  m.cyl(0, 0, 19, 9.5, 16, SHELL, { n: 10, r1: 12.5, top: PALE });
  m.cyl(0, 0, 12.5, 16, 21, PALE, { n: 10, r1: 7, top: tc.main });
  m.cyl(0, 0, 19.6, 9.2, 10.6, tc.main, { n: 10 });                                // a team band where the shell steps in
  for (let i = 0; i < 5; i++) {                                                    // lit eyes round the shell
    const a = (i / 5) * TAU + 0.5, x = Math.cos(a) * 20.2, y = Math.sin(a) * 20.2;
    m.box(x - 1.5, x + 1.5, y - 1.5, y + 1.5, 4.2, 7.4, M.glow, { glow: true });
  }
  for (const [x, y] of [[16, 16], [-16, 16], [16, -16], [-16, -16]]) {             // pylons
    block(m, x, y, 3.2, 1.2, 2.4, 30, tc.main, { top: tc.light });
    m.box(x - 1.1, x + 1.1, y - 1.1, y + 1.1, 30, 33, M.glow, { glow: true });
  }
  // The landmark: spire, crown ring, orb.
  m.cyl(0, 0, 7.4, 21, 33, M.lite, { n: 6, r1: 4.8 });
  m.cyl(0, 0, 4.8, 33, 65, M.lite, { n: 6, r1: 2.2 });
  m.cyl(0, 0, 5.6, 33, 35.4, tc.main, { n: 6 });                                    // a team collar where the spire narrows
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * TAU + 0.06, a1 = ((i + 1) / 8) * TAU - 0.06;
    ringSeg(m, 0, 0, 11, 15.6, a0, a1, 55, 59, i % 2 ? PALE : tc.main, { top: i % 2 ? '#c8c0dc' : tc.light });
  }
  m.box(-11.4, 11.4, -0.7, 0.7, 56.4, 57.6, M.metal);                              // spokes holding the ring
  m.box(-0.7, 0.7, -11.4, 11.4, 56.4, 57.6, M.metal);
  m.cyl(0, 0, 1.8, 65, 70, M.glow, { n: 8, r1: 7.4, glow: true });                 // orb
  m.cyl(0, 0, 7.4, 70, 73.5, M.glow, { n: 8, glow: true });
  m.cyl(0, 0, 7.4, 73.5, 79, M.glow, { n: 8, r1: 1.6, glow: true, top: '#ffffff' });
  m.tag(null);
  // The orb breathes, and now and then throws a thread of light down to a pylon.
  const live = [
    { k: 'glow', at: [0, 0, 72], r: 16, col: M.glow },
    { k: 'arcs', at: [0, 0, 70], to: [[16, 16, 32], [-16, 16, 32], [16, -16, 32], [-16, -16, 32]], col: M.glow },
  ];
  return { model: m, top: 80, live };
}

// ============================================================ the set

// spec: where the turret turns (pivot, along the hull), where it fires from (muzzle, from the
// pivot; mz, height), the footprint its shadow uses, how high it rides, and what glows.
const UNITS = {
  'iron|bastion|2': { hull: rhinoHull, turret: rhinoTurret, spec: { foot: [13, 10.8], pivot: -1, muzzle: 20.6, mz: 16 } },
  'iron|bastion|3': { hull: apocalypseHull, turret: apocalypseTurret, spec: { foot: [16, 12.5], pivot: -1.5, muzzle: 22.4, mz: 17.8, barrels: [-2.9, 2.9] } },
  'iron|volt|2': { hull: teslaTankHull, turret: teslaTankTurret, spec: { foot: [13, 10.8], pivot: 0, muzzle: 11.4, mz: 15.2, glow: [11, 15.2, 3.6] } },
  'iron|volt|3': { hull: kirovHull, turret: kirovTurret, spec: { foot: [21, 11], pivot: 2, muzzle: 0, mz: -5, hover: 44, bob: 1.6, drift: 2.4 } },
  'meridian|aegis|2': { hull: ifvHull, turret: ifvTurret, spec: { foot: [12.5, 9.6], pivot: 1, muzzle: 11.2, mz: 16.6 } },
  'meridian|aegis|3': { hull: prismHull, turret: prismTurret, spec: { foot: [12.5, 9.7], pivot: 1.5, muzzle: 2, mz: 24, glow: [0, 24, 7] } },
  'meridian|shade|2': { hull: grizzlyHull, turret: grizzlyTurret, spec: { foot: [13, 9.2], pivot: -1, muzzle: 20.2, mz: 11.4 } },
  'meridian|shade|3': { hull: mirageHull, turret: mirageTurret, spec: { foot: [14, 10], pivot: 1, muzzle: 18.8, mz: 12.4, glow: [17.6, 12.4, 3.2] } },
  'veil|dominion|2': { hull: shenfengHull, turret: shenfengTurret, spec: { foot: [13, 8.6], pivot: 3, muzzle: 10, mz: 12.8, hover: 3.4, glow: [8.8, 12.8, 2.8] } },
  'veil|dominion|3': { hull: discHull, turret: discTurret, spec: { foot: [13, 13], pivot: 0, muzzle: 0, mz: -5.6, glow: [0, -5.2, 6.4] } },
  'veil|forge|2': { hull: gatlingHull, turret: gatlingTurret, spec: { foot: [12.5, 7.8], pivot: 0.5, muzzle: 15, mz: 12.4, hover: 3.2, bob: 1.1 } },
  'veil|forge|3': { hull: brainHull, turret: brainTurret, spec: { foot: [12.5, 12.5], pivot: 0, muzzle: 0, mz: 18, hover: 4, bob: 1.1, glow: [0, 13.5, 7.5] } },
};

const memo = new Map();
function once(key, build) {
  let v = memo.get(key);
  if (v === undefined) { v = build(); memo.set(key, v); }
  return v;
}
const accentOf = (f, sub) => (FACTIONS[f].subs[sub] && FACTIONS[f].subs[sub].accent2) || FACTIONS[f].mat.glow;
/** One part of a vehicle. lod 0 and 1 share the full model; lod 2 is the far one. */
function part(which, f, sub, tier, tc, lod) {
  const u = UNITS[`${f}|${sub}|${tier}`];
  if (!u || !FACTIONS[f]) return null;
  const far = lod === 2;
  return once(`${which}|${f}|${sub}|${tier}|${tc.id}|${far ? 2 : 1}`, () => { const m = new Mini(); u[which](m, tc, FACTIONS[f].mat, far, accentOf(f, sub)); return m; });
}

export default {
  id: 'a',
  label: 'Hero silhouettes',
  unitScale: 1.35,
  // Bigger figures need their own drill: infantry four abreast, tanks in pairs, and the
  // heaviest units (and aircraft) in single file down the middle of the road.
  formation: { row: [0, 4, 2, 1], gap: [0, 10, 19, 23], lane: [0, 5.8, 13.4, 15] },

  soldier(f, sub, tc, frame, lod) {
    const build = SOLDIERS[`${f}|${sub}`];
    if (!build) return null;
    const fr = frame & 3, far = lod === 2;
    return once(`s|${f}|${sub}|${tc.id}|${fr}|${far ? 2 : 1}`, () => { const m = new Mini(); build(m, tc, FACTIONS[f].mat, [0, 1, 0, -1][fr], far, accentOf(f, sub)); return m; });
  },
  hull(f, sub, tier, tc, lod) { return part('hull', f, sub, tier, tc, lod); },
  turret(f, sub, tier, tc, lod) { return part('turret', f, sub, tier, tc, lod); },
  spec(f, sub, tier) { const u = UNITS[`${f}|${sub}|${tier}`]; return u ? u.spec : null; },
  /** The tip of an infantry weapon: forward along the aim, and up. */
  muzzle(f, sub, dx, dy) {
    const q = MUZZLES[`${f}|${sub}`];
    return q ? [dx * q[0], -q[1] + dy * q[0] * 0.4] : null;
  },

  // The rest of the set's bases and the compound wall live in a-bases.js.
  compound,
  base(f, sub, level, tc) {
    const more = moreBase(f, sub, level, tc);
    if (more) return more;
    if (f === 'iron') return once(`b|iron|${level}|${tc.id}`, () => ironBase(level, tc, FACTIONS.iron.mat));
    if (f === 'meridian' && level === 3) return once(`b|meridian|${tc.id}`, () => meridianBase(tc, FACTIONS.meridian.mat));
    if (f === 'veil' && level === 3) return once(`b|veil|${tc.id}`, () => veilBase(tc, FACTIONS.veil.mat));
    return null;
  },
};
