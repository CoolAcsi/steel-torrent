// Unit models: six rosters (faction / subfaction), three tiers each.
//
//   iron / bastion      conscript      rhino        apocalypse (twin-barrel heavy)
//   iron / volt         teslaTrooper   teslaTank    kirov      (airship)
//   meridian / shade    gi             grizzly      mirage     (low, mirror-skirted)
//   meridian / aegis    guardian       ifv          prism      (faceted emitter)
//   veil / dominion     initiate       shenfeng     disc       (flying disc)
//   veil / forge        sniper         gatling      brain      (domed control vehicle)
//
// The ids name a battlefield role; every shape here is this game's own design.
//
// Tier 1 is infantry (one model per walk frame). Tiers 2 and 3 are vehicles in two
// parts, hull and turret, so the turret can track on its own. Local axes: x forward,
// y sideways, z up. `tc` is the team colour and is used only on marking panels;
// everything else comes from the faction materials.
//
// Every builder takes a detail level: 0 close (modelled wheels, fittings, small
// parts), 1 playing distance (the default), 2 far (the main masses only, a quarter
// of the triangles). The silhouette and the marking panels are the same at all three.
import { Model, F } from './iso.js';
import { FACTIONS } from './factions.js';

const TAU = Math.PI * 2;
const COPPER = '#b56a3a', WHITE_HOT = '#f3fbff', GUNMETAL = '#34383c', BORE = '#101214', RUBBER = '#1d1f21';

export const LOD = { close: 0, play: 1, far: 2 };

/** A Model whose boxes can be light sources ({ glow: true }), like its columns and tubes. */
class Unit extends Model {
  box(x0, x1, y0, y1, z0, z1, c, o = {}) {
    const s = super.box(x0, x1, y0, y1, z0, z1, c, o);
    if (o.glow) for (const f of s.faces) f.glow = true;
    return s;
  }
}
const sides = (lod, big) => (big ? [14, 10, 6] : [10, 8, 5])[lod];   // sides of a round part

/**
 * Running gear for one vehicle: on each side a track with a sloped front and rear run,
 * road wheels and a drive sprocket standing proud of it, and a fender over the top.
 */
function tracks(m, len, y0, y1, h, M, fender, lod = 1) {
  for (const s of [-1, 1]) {
    const a = Math.min(s * y0, s * y1), b = Math.max(s * y0, s * y1);
    const was = m.tag('tread');
    const t = m.profile([[-len, h * 0.45], [-len + 1.6, 0.2], [len - 2.4, 0.2], [len, h * 0.5], [len - 0.8, h], [-len + 0.6, h]], a, b, M.metal, { top: '#3a3f45' });
    if (lod < 2) {
      m.tag('steel');
      const out = s > 0 ? b : a, n = Math.max(4, Math.round(len / 2.7));
      const at = i => -len + 2.7 + i * ((2 * len - 6) / (n - 1));
      if (lod === 0) {
        // Modelled: road wheels and the drive sprocket stand out of the track, return rollers ride above them.
        const w0 = Math.min(out, out + s * 0.7), w1 = Math.max(out, out + s * 0.7);
        for (let i = 0; i < n; i++) m.tubeY(w0, w1, at(i), h * 0.42, h * 0.34, '#59616a', { n: 8, cap: '#3c4248' });
        for (let i = 0; i < n - 1; i += 2) m.tubeY(w0, w1, (at(i) + at(i + 1)) / 2, h * 0.86, h * 0.12, '#454c53', { n: 6 });
        m.tubeY(w0, w1, len - 1.6, h * 0.66, h * 0.27, '#454c53', { n: 8, cap: '#2a2e33' });
        m.tubeY(w0, w1, -len + 1.7, h * 0.6, h * 0.22, '#454c53', { n: 8, cap: '#2a2e33' });
      } else {
        // At playing distance they are a few pixels across: discs painted on the track's outer face.
        const disc = (x, z, r, c) => m.decal(t, Array.from({ length: 8 }, (_, i) => { const q = ((i + 0.5) / 8) * TAU; return [x + Math.cos(q) * r, out, z + Math.sin(q) * r]; }), c, [0, s, 0]);
        for (let i = 0; i < n; i++) { disc(at(i), h * 0.42, h * 0.34, '#59616a'); disc(at(i), h * 0.42, h * 0.13, '#23272b'); }
        disc(len - 1.6, h * 0.66, h * 0.27, '#454c53');
      }
    }
    m.tag('panel');
    if (fender) m.box(-len - 0.5, len + 0.5, a - 0.3, b + 0.3, h, h + 0.9, fender);
    m.tag(was);
  }
}

/** What every tracked hull carries: headlamps, a tow bar, tools lashed to the deck. */
function fittings(m, len, half, deck, lod) {
  if (lod === 2) return;
  const was = m.tag('steel');
  for (const y of [-half + 1.2, half - 1.2]) m.box(len - 0.4, len + 0.5, y - 0.8, y + 0.8, deck - 2.6, deck - 1.2, '#d9d6c4');   // headlamps (unlit)
  m.box(-len - 1.3, -len - 0.5, -3, 3, 2.6, 3.4, '#2b2e31');                                                              // tow bar
  m.tubeX(-len * 0.3, len * 0.35, half - 0.9, deck + 0.35, 0.3, '#6b5a40', { n: 5 });                                      // pry bar
  m.box(-len * 0.75, -len * 0.45, -half + 0.6, -half + 2.6, deck, deck + 1.1, '#4f5a44');                                  // tool box
  if (lod === 0) {
    m.tubeX(-len * 0.2, len * 0.3, -half + 0.8, deck + 0.3, 0.22, '#3a3d40', { n: 5 });                                    // tow cable
    for (const y of [-half + 1.2, half - 1.2]) m.box(len - 0.5, len + 0.8, y - 1.1, y + 1.1, deck - 1.2, deck - 0.9, '#2b2e31');   // lamp guards
    m.box(-len * 0.1, len * 0.05, -1.4, 1.4, deck, deck + 0.35, '#3a3d40');                                                // driver's hatch
  }
  m.tag(was);
}

/** A gun barrel along x, with the collars that tell one gun from another. */
function gun(m, x0, x1, y, z, r, M, lod, o = {}) {
  const n = sides(lod), was = m.tag('steel'), L = x1 - x0;
  m.tubeX(x0, x1, y, z, r, M.metal, { n, cap: BORE });
  if (lod < 2 && o.sleeve) m.tubeX(x0 + L * 0.14, x0 + L * 0.46, y, z, r * 1.28, GUNMETAL, { n });   // thermal sleeve
  if (lod < 2 && o.evac) m.tubeX(x0 + L * 0.52, x0 + L * 0.68, y, z, r * 1.55, M.dark, { n });      // fume extractor
  if (o.brake) m.tubeX(x1 - o.brake, x1 + 1, y, z, r * 1.55, GUNMETAL, { n, cap: BORE });           // muzzle brake
  m.tag(was);
}

/** A plate leaning out from a hull side: upright along yIn, its lower edge out at yOut. */
function leanPlate(m, x0, x1, yIn, yOut, z0, z1, c) {
  return m.solid([
    { p: [[x0, yIn, z1], [x1, yIn, z1], [x1, yOut, z0], [x0, yOut, z0]], c },
    { p: [[x0, yIn, z0], [x1, yIn, z0], [x1, yIn, z1], [x0, yIn, z1]], c },
    { p: [[x0, yIn, z0], [x1, yIn, z0], [x1, yOut, z0], [x0, yOut, z0]], c },
    { p: [[x0, yIn, z0], [x0, yOut, z0], [x0, yIn, z1]], c },
    { p: [[x1, yIn, z0], [x1, yOut, z0], [x1, yIn, z1]], c },
  ]);
}

/** A whip aerial. */
function whip(m, x, y, z0, z1, tip) {
  m.box(x - 0.18, x + 0.18, y - 0.18, y + 0.18, z0, z1, '#15171a');
  if (tip) m.box(x - 0.45, x + 0.45, y - 0.45, y + 0.45, z1, z1 + 0.9, tip, { glow: true });
}

// ============================================================ IRON PACT / bastion

// Rhino: the line tank. Slab sides under bolt-on skirts, a plough prow, one heavy gun.
function rhinoHull(m, tc, M, lod) {
  tracks(m, 13.5, 6, 11, 5.4, M, M.dark, lod);
  const h = m.profile([[-13, 2.6], [12.5, 2.6], [14.6, 5.2], [10, 9.4], [-12.5, 9.4], [-14, 6.4]], -6.6, 6.6, M.hull, { top: M.lite });
  m.onTop(h, -5, 2.5, -6.4, -3.6, 9.4, tc.main);                       // team deck panels
  m.onTop(h, -5, 2.5, 3.6, 6.4, 9.4, tc.main);
  for (const s of [-1, 1]) {                                           // bolt-on side skirts
    const y0 = Math.min(s * 11, s * 12.4), y1 = Math.max(s * 11, s * 12.4);
    if (lod === 2) { const sk = m.box(-12.5, 12.5, y0, y1, 1.6, 7.6, M.dark); m.onY(sk, -4, 4, 3.4, 6, s * 12.4, tc.main, false, s); continue; }
    for (const [x0, x1] of [[-12.6, -4.5], [-4.1, 4.1], [4.5, 12.6]]) {   // three plates, the front one cut short
      const sk = m.box(x0, x1, y0, y1, x0 > 4 ? 2.6 : 1.4, 7.6, M.dark);
      if (x0 < 0 && x1 > 0) m.onY(sk, -3.2, 3.2, 3.4, 6, s * 12.4, tc.main, false, s);
      else if (lod === 0) for (const x of [x0 + 1, x1 - 1]) m.onY(sk, x - 0.3, x + 0.3, 6.4, 7, s * 12.4, '#8f8b81', false, s);   // bolt heads
    }
  }
  m.profile([[14.3, 1], [16.8, 1], [15.3, 7.2], [14.3, 7.2]], -8.6, 8.6, M.dark);   // plough prow
  if (lod === 2) return;
  fittings(m, 13.5, 6.6, 9.4, lod);
  m.onTop(h, -11.5, -6, -4.4, 4.4, 9.4, M.metal);                      // engine grille
  for (const y of [-4.4, 4.4]) m.cyl(-13, y, 1.4, 5.5, 13, M.metal, { n: 6, top: '#0e0f10' });   // exhausts
  m.tag('steel');
  for (const [y0, y1] of [[-6, -0.5], [0.5, 6]]) m.tubeY(y0, y1, -15.9, 7.3, 1.7, '#4a4d3f', { n: sides(lod), cap: '#33362c' });   // fuel drums across the stern
  m.tag(null);
  if (lod === 0) {
    m.tag('tread');
    for (const y of [-2.6, 0, 2.6]) m.box(6.2, 9, y - 1.1, y + 1.1, 9.4, 10, '#2b2e31');   // spare track links
    m.tag(null);
    for (const y of [-6, 6]) m.box(-16.4, -15.4, y - 0.3, y + 0.3, 5.4, 9, '#2b2e31');     // drum straps
  }
}

function rhinoTurret(m, tc, M, lod) {
  m.box(-10.5, -7, -4.2, 4.2, 10, 14, M.dark);                         // stowage bustle
  const t = m.prism([[-7, -5.8], [3, -5.8], [7.4, -2.8], [7.4, 2.8], [3, 5.8], [-7, 5.8]], 9.4, 14.8, M.hull, { top: M.lite });
  m.onTop(t, -5.8, -1.2, -4.2, 4.2, 14.8, tc.main);                    // team roof panel
  for (const s of [-1, 1]) m.box(0.5, 6.5, Math.min(s * 5.8, s * 7.2), Math.max(s * 5.8, s * 7.2), 9.8, 14, M.dark);   // cheek armour
  m.box(5.8, 8.6, -2.6, 2.6, 10.2, 14, M.dark);                        // mantlet
  gun(m, 8.6, 20, 0, 12.1, 1.35, M, lod, { sleeve: true, brake: 3 });
  if (lod === 2) return;
  m.cyl(1.6, 2.6, 2.1, 14.8, 16.1, M.dark, { n: 6, top: M.metal });    // cupola
  m.tag('steel');
  m.box(1.2, 5.6, 2.3, 2.9, 16.1, 16.8, GUNMETAL);                     // cupola machine gun
  m.tubeX(8.6, 11.6, 1.9, 11.2, 0.4, GUNMETAL, { n: 5 });              // coaxial gun
  m.tag(null);
  if (lod === 0) {
    for (const s of [-1, 1]) for (const x of [-5.4, -3.8, -2.2]) m.box(x, x + 1, Math.min(s * 5.8, s * 6.9), Math.max(s * 5.8, s * 6.9), 12.6, 14.2, GUNMETAL);   // smoke dischargers
    whip(m, -6, -4.6, 14.8, 24);
    m.onTop(t, -0.6, 3.2, -4.6, -1.4, 14.8, M.dark);                   // loader's hatch
  }
}

// Apocalypse: the breakthrough tank. Wider and taller than anything else on a road,
// a stepped casemate turret and two guns in one armoured sleeve.
function apocalypseHull(m, tc, M, lod) {
  tracks(m, 16, 6.6, 12.2, 6.4, M, M.dark, lod);
  const h = m.profile([[-15.6, 3], [15, 3], [17.2, 6.4], [12, 11], [-15, 11], [-16.6, 7.4]], -7.2, 7.2, M.hull, { top: M.lite });
  m.onTop(h, 6.4, 11, -6.6, 6.6, 11, tc.main);                             // team glacis band
  for (const s of [-1, 1]) {                                           // stand-off armour over the tracks
    const y0 = Math.min(s * 12.2, s * 13.6), y1 = Math.max(s * 12.2, s * 13.6);
    const sk = m.box(-15, 15, y0, y1, 1.8, 9, M.dark);
    m.onY(sk, -9.5, 9.5, 4.4, 7.4, s * 13.6, tc.main, false, s);
    if (lod < 2) for (const x of [-12, -6, 0, 6, 12]) m.box(x - 1.6, x + 1.6, Math.min(s * 13.6, s * 14.4), Math.max(s * 13.6, s * 14.4), 2.6, 4.2 + (x === 0 ? 4.2 : 0), M.metal);   // armour blocks
  }
  m.profile([[16.8, 1.2], [18.6, 1.2], [18, 8.4], [16.8, 8.4]], -9, 9, M.dark);   // nose plate
  for (const y of [-5.4, 5.4]) m.cyl(-14.6, y, 2, 7, 17, M.metal, { n: sides(lod) > 6 ? 6 : 5, top: '#0e0f10' });   // twin stacks
  if (lod === 2) return;
  fittings(m, 16, 7.2, 11, lod);
  m.onTop(h, -14, -8.6, -5.4, 5.4, 11, M.metal);                       // engine deck
  m.box(-13.4, -9.4, -6.8, -3.4, 11, 13.2, M.dark);                    // deck stowage
  m.box(-13.4, -9.4, 3.4, 6.8, 11, 13.2, M.dark);
  if (lod === 0) {
    for (const x of [-13, -11.6, -10.2]) m.onTop(h, x, x + 0.7, -3, 3, 11, '#0e0f10');   // louvres
    m.tag('tread');
    for (const y of [-4.6, -2.3, 0, 2.3, 4.6]) m.box(12.4, 14.6, y - 1, y + 1, 8.4, 9.2, '#2b2e31');   // track links on the glacis
    m.tag(null);
    for (const y of [-5.4, 5.4]) m.cyl(-14.6, y, 2.5, 12.4, 13.2, M.dark, { n: 6 });     // stack collars
  }
}

function apocalypseTurret(m, tc, M, lod) {
  m.box(-12.4, -8.4, -5.8, 5.8, 11.4, 16.6, M.dark);                   // bustle
  const t = m.prism([[-8.6, -7.6], [4, -7.6], [8.8, -4.4], [8.8, 4.4], [4, 7.6], [-8.6, 7.6]], 11, 17.2, M.hull, { top: M.lite });
  m.onTop(t, 2.4, 5.4, -6, 6, 17.2, tc.main);                          // team band ahead of the casemate
  const c = m.box(-7, 1.6, -5, 5, 17.2, 19.6, M.hull, { top: M.lite });   // upper casemate
  m.onTop(c, -6, -2.4, -3.8, 3.8, 19.6, tc.main);
  m.box(7, 10.4, -5.6, 5.6, 11.4, 16.8, M.dark);                       // one mantlet for both guns
  for (const y of [-2.8, 2.8]) gun(m, 10.4, 21.6, y, 14, 1.4, M, lod, { sleeve: true, brake: 3.2 });
  if (lod === 2) return;
  m.cyl(-1.6, 2.6, 2.2, 19.6, 21, M.dark, { n: 6, top: M.metal });     // cupola
  const lamp = m.box(2.6, 4.8, -6.6, -4.2, 17.2, 19.8, M.dark);        // searchlight
  m.onX(lamp, -6.3, -4.5, 17.6, 19.5, 4.8, '#fff3cf', true);
  for (const s of [-1, 1]) m.box(-7.6, -1, Math.min(s * 7.6, s * 9), Math.max(s * 7.6, s * 9), 12, 15.2, M.dark);   // side bins
  m.tag('steel');
  m.box(-1.2, 4, 2.3, 2.9, 21, 21.7, GUNMETAL);                        // cupola machine gun
  m.tag(null);
  if (lod === 0) {
    for (const s of [-1, 1]) for (const x of [3.4, 5, 6.6]) m.box(x, x + 1, Math.min(s * 5.6, s * 6.8), Math.max(s * 5.6, s * 6.8), 15.4, 17, GUNMETAL);   // smoke dischargers
    whip(m, -7.6, -4.8, 17.2, 28); whip(m, -7.6, 4.8, 17.2, 25);
    for (const y of [-2.8, 2.8]) m.box(9.6, 10.8, y - 1.9, y + 1.9, 12.2, 15.8, GUNMETAL);   // gun collars
  }
}

// ============================================================ IRON PACT / volt

/** A discharge coil: mast, copper windings, a live cap. */
function coil(m, x, y, z0, z1, lod, r = 2.6) {
  m.cyl(x, y, 0.9, z0, z1, '#25272a', { n: 6 });
  const n = lod === 2 ? 1 : 3, span = z1 - z0 - 2.6;
  const was = m.tag('copper');
  for (let i = 0; i < n; i++) {
    const a = z0 + 0.8 + (i * span) / n, k = r - i * 0.45;
    m.cyl(x, y, lod === 2 ? k * 0.9 : k, a, a + (lod === 2 ? span : span / n - 0.8), COPPER, { n: sides(lod) });
  }
  m.tag(was);
  m.cyl(x, y, 1.7, z1 - 1.6, z1 + 0.6, '#bfeaff', { n: 6, glow: true, top: WHITE_HOT });
}

// Tesla tank: a capacitor bank on tracks. No gun: two coils on a turntable and a fork to aim the arc.
function teslaTankHull(m, tc, M, lod) {
  tracks(m, 13, 6, 10.6, 5.2, M, M.dark, lod);
  const h = m.profile([[-12.6, 2.6], [12, 2.6], [14, 5.2], [9.5, 9], [-12, 9], [-13.6, 6.2]], -6.4, 6.4, M.hull, { top: M.lite });
  m.onTop(h, 3, 8.6, -5.6, 5.6, 9, tc.main);                           // team bow band
  for (const s of [-1, 1]) {                                           // insulating skirts with a bus bar along each
    const was = m.tag('dark');
    m.box(-12, 12, Math.min(s * 10.6, s * 11.6), Math.max(s * 10.6, s * 11.6), 2, 6.8, RUBBER);
    m.tag('copper');
    m.box(-11, 11, Math.min(s * 11.6, s * 12.1), Math.max(s * 11.6, s * 12.1), 5, 5.9, COPPER);
    m.tag(was);
  }
  const c = m.box(-12.2, -6.4, -4.8, 4.8, 9, 13.4, M.metal, { top: M.dark });   // capacitor bank
  m.onY(c, -11.4, -7.2, 10.6, 12.2, 4.8, '#7fd8ff', true);
  m.onY(c, -11.4, -7.2, 10.6, 12.2, -4.8, '#7fd8ff', true, -1);
  if (lod === 2) return;
  fittings(m, 13, 6.4, 9, lod);
  m.tag('copper');
  for (const x of [-11, -9.3, -7.6]) for (const y of [-2.6, 2.6]) m.cyl(x, y, 0.8, 13.4, 15, COPPER, { n: 6, top: '#2b2e31' });   // capacitor cans
  m.tag(null);
  if (lod === 0) {
    m.tag('dark');
    for (const y of [-2.2, 2.2]) m.tubeX(-6.4, -3.6, y, 10.2, 0.5, RUBBER, { n: 5 });   // feed cables to the turntable
    m.tag(null);
    m.onX(c, -4, 4, 9.6, 10.6, -12.2, '#e8b72c', false, -1);            // hazard stripe across the stern
    for (const s of [-1, 1]) for (const x of [-8, 0, 8]) m.box(x - 0.5, x + 0.5, Math.min(s * 12.1, s * 12.6), Math.max(s * 12.1, s * 12.6), 4.6, 6.3, '#d9d6c4');   // insulators
  }
}

function teslaTankTurret(m, tc, M, lod) {
  const b = m.cyl(0, 0, 5.8, 9, 11.4, M.hull, { n: sides(lod), top: M.lite });   // turntable
  m.onTop(b, -4.6, -1.8, -2.6, 2.6, 11.4, tc.main);
  for (const y of [-3.3, 3.3]) coil(m, 0.6, y, 11.4, 20.5, lod);
  for (const y of [-1.7, 1.7]) m.box(3, 11.6, y - 0.55, y + 0.55, 11.8, 13.2, M.metal);   // discharge fork
  m.box(10.8, 13, -2.5, 2.5, 11.2, 13.8, '#bfeaff', { top: WHITE_HOT, glow: true });
  if (lod === 2) return;
  m.box(-5.2, -2.6, -1.6, 1.6, 11.4, 14, M.dark);                      // regulator housing
  if (lod === 0) {
    m.tag('copper');
    for (const x of [5, 7.4, 9.6]) m.box(x, x + 0.8, -2.9, 2.9, 11.5, 13.5, COPPER);   // windings on the fork
    m.tag(null);
    m.box(-0.6, 1.8, -3.3, 3.3, 18.4, 19, '#25272a');                  // tie bar between the coils
  }
}

// Kirov: a rigid airship. A long gas hull over a keel gondola, engines on outriggers, a
// cross of tail fins. It flies above the road and throws its shadow on it.
function kirovHull(m, tc, M, lod) {
  const n = sides(lod, true);
  const st = lod === 2 ? [[-24, 1], [-13, 7.4], [7, 8.8], [14, 7.4], [19, 5], [24, 0.6]]
    : [[-24, 0.8], [-20, 4.4], [-13, 7.5], [-3, 8.8], [7, 8.8], [14, 7.4], [19, 5], [22.4, 2.6], [24, 0.6]];
  const at = (x, u, v) => [x, u, 15.6 + v * 0.86];                     // a little wider than tall
  const was = m.tag('panel');
  for (let i = 0; i + 1 < st.length; i++) {
    const nose = i >= st.length - (lod === 2 ? 2 : 3), band = i === (lod === 2 ? 2 : 4);          // team nose cone and one team band
    m.tube(at, st[i][0], st[i + 1][0], st[i][1], nose ? tc.main : band ? tc.main : i % 2 ? M.lite : M.hull, { n, r1: st[i + 1][1], cap: M.dark });
  }
  // tail: a cross of fins
  m.box(-25, -15, -0.5, 0.5, 15.6, 27, M.dark);
  m.box(-25, -15, -0.5, 0.5, 4.4, 15.6, M.dark);
  m.box(-25, -15, -11, 11, 15.2, 16, M.dark);
  m.box(-25.2, -22.4, -0.7, 0.7, 22.4, 27.2, tc.main);                 // team fin tip
  // keel and gondola
  m.box(-9, 11, -1.2, 1.2, 6.4, 8.6, M.metal);
  const g = m.box(-7, 8, -2.8, 2.8, 2.2, 6.4, M.dark, { top: M.metal });
  m.onX(g, -2.2, 2.2, 3.8, 5.6, 8, '#ffe9a6', true);                   // bridge windows
  // engines on outriggers
  for (const s of [-1, 1]) {
    m.box(-3.4, -1.8, Math.min(s * 2, s * 10.4), Math.max(s * 2, s * 10.4), 8.2, 9, M.metal);
    m.tag('steel');
    m.tubeX(-6, 0.4, s * 10.6, 8.6, 1.9, M.dark, { n: sides(lod), cap: '#0e0f10' });
    m.tag('panel');
    m.box(-6.9, -6.3, s * 10.6 - 3.6, s * 10.6 + 3.6, 8.3, 8.9, '#15171a');   // propeller, edge on
    m.box(-6.9, -6.3, s * 10.6 - 0.3, s * 10.6 + 0.3, 5, 12.2, '#15171a');
  }
  if (lod < 2) {
    m.onY(g, -5.6, 5.6, 4, 5.4, 2.8, '#ffe9a6', true);                 // cabin lights
    m.onY(g, -5.6, 5.6, 4, 5.4, -2.8, '#ffe9a6', true, -1);
    m.tag('copper');
    m.cyl(13.5, 0, 1.6, 5.6, 7.4, COPPER, { n: 6 });                   // arc emitter slung under the bow
    m.tag('panel');
    m.cyl(13.5, 0, 1.2, 4.2, 5.6, '#bfeaff', { n: 6, glow: true });
    for (const x of [-4, 0, 4]) m.box(x - 1, x + 1, -1.6, 1.6, 1.2, 2.2, GUNMETAL);   // bomb racks
  }
  if (lod === 0) {
    for (const [x, r] of [[-13, 7.5], [-3, 8.8], [7, 8.8], [14, 7.4]]) m.tube(at, x - 0.25, x + 0.25, r + 0.28, M.dark, { n, r1: r + 0.28 });   // girder rings showing through the skin
    for (const s of [-1, 1]) { m.box(-0.4, 0.4, s * 1.2, s * 1.2 + s * 6, 8.6, 8.9, '#15171a'); m.box(-12, -11.4, s * 0.6 - 0.2, s * 0.6 + 0.2, 8.6, 14, '#15171a'); }   // bracing wires
    whip(m, 6, 0, 24.2, 30, '#ff5a4d');
  }
  m.tag(was);
}

function kirovTurret(m, tc, M, lod) {
  m.cyl(0, 0, 2.3, 0.4, 2.2, M.metal, { n: sides(lod), r1: 2.8 });      // ventral gun tub
  m.tag('steel');
  for (const y of [-0.9, 0.9]) m.tubeX(1, 6.4, y, 1.2, 0.42, GUNMETAL, { n: 5, cap: BORE });
  m.tag(null);
  if (lod === 0) m.box(-1.6, 0.4, -1.2, 1.2, 0, 0.4, tc.main);
}

// ============================================================ MERIDIAN ALLIANCE / shade

// Grizzly: the medium tank. Clean plates, a cast-looking turret, a gun with a bore evacuator.
function grizzlyHull(m, tc, M, lod) {
  tracks(m, 12.5, 5.2, 9, 4.6, M, M.dark, lod);
  const h = m.profile([[-12, 2.4], [11, 2.4], [14.2, 4.4], [8, 8.2], [-11, 8.2], [-12.6, 5.6]], -5.8, 5.8, M.dark, { top: M.hull });
  m.onTop(h, -10, 6, -1.2, 1.2, 8.2, tc.main);                         // team spine stripe
  m.onTop(h, 4.4, 6.4, -5.2, 5.2, 8.2, tc.main);
  if (lod === 2) return;
  fittings(m, 12.5, 5.8, 8.2, lod);
  m.onTop(h, -10.4, -6.6, -4.6, -1.8, 8.2, M.metal);                   // intake
  for (const s of [-1, 1]) m.box(-6.5, 2.5, Math.min(s * 5.9, s * 8.9), Math.max(s * 5.9, s * 8.9), 5.5, 7, M.hull, { top: M.lite });   // fender stowage
  m.box(-11.5, -10.9, 3.4, 4, 8.2, 17, M.metal);                       // sensor mast
  m.box(-12, -10.4, 2.9, 4.5, 16, 17.6, '#3ad1c4', { top: WHITE_HOT, glow: true });
  if (lod === 0) {
    for (const x of [-9.6, -8.4, -7.2]) m.onTop(h, x, x + 0.5, -4.4, -2, 8.2, '#0e0f10');
    for (const s of [-1, 1]) m.box(3.4, 9, Math.min(s * 5.9, s * 8.9), Math.max(s * 5.9, s * 8.9), 5.5, 6, M.dark);   // mud flaps
    m.box(-12.9, -12.3, -4.4, 4.4, 5.2, 7.2, M.metal);                 // rear plate rack
  }
}

function grizzlyTurret(m, tc, M, lod) {
  const t = m.cyl(-0.6, 0, 5.7, 8.2, 11.5, M.dark, { n: sides(lod), r1: 4.4, top: M.hull, sy: 0.92 });
  m.onTop(t, -3.4, -0.4, -2.4, 2.4, 11.5, tc.main);                    // team hatch panel
  m.box(3.6, 6.2, -2.2, 2.2, 8.8, 11, M.metal);                        // mantlet
  gun(m, 6.2, 17.6, 0, 9.9, 0.95, M, lod, { evac: true, brake: 2 });
  if (lod === 2) return;
  m.cyl(-1.8, 2.2, 1.7, 11.5, 12.5, M.metal, { n: 6, top: tc.main });  // commander's ring
  m.box(-4.8, -2.6, -3.6, -1.8, 11.5, 13.4, M.metal);                  // optics box
  m.box(-2.6, -2.3, -3.4, -2, 11.9, 13.1, '#3ad1c4', { glow: true });   // its lens
  m.box(-8, -5.2, -3, 3, 8.8, 10.6, M.dark);                           // rear basket
  if (lod === 0) {
    m.tag('steel');
    m.box(-1.4, 3, 2, 2.5, 12.5, 13.1, GUNMETAL);                      // pintle gun
    m.tag(null);
    whip(m, -5.6, 2.6, 10.6, 20);
    for (const y of [-4.6, 4.6]) m.box(0.5, 3.5, y - 0.5, y + 0.5, 9.4, 10.8, GUNMETAL);   // smoke pots
  }
}

// Mirage: low and wide, its tracks hidden under leaning mirror plates, a net over the
// engine deck and two projector masts. The gun is a thin lance.
function mirageHull(m, tc, M, lod) {
  tracks(m, 12.8, 5.4, 9, 3.8, M, null, lod === 0 ? 1 : lod);
  const h = m.profile([[-13, 2], [11, 2], [15.4, 3.2], [9, 7.2], [-10.5, 7.2], [-13.4, 5]], -6.2, 6.2, M.dark, { top: M.hull });
  m.onTop(h, 4, 6.4, -5.4, 5.4, 7.2, tc.main);                         // team chevron band
  m.onTop(h, -4, 3, -0.9, 0.9, 7.2, tc.main);
  const was = m.tag('plating');                                        // polished plate: it mirrors the sky without glaring
  const segs = lod === 2 ? [[-12.6, 12.4]] : [[-12.6, -4.4], [-4.1, 4.1], [4.4, 12.4]];
  for (const s of [-1, 1]) segs.forEach(([x0, x1], i) => leanPlate(m, x0, x1, s * 6.2, s * 10.6, 1.6, 7.2, i % 2 ? '#6f909e' : '#86a8b6'));   // mirror skirts
  m.tag(was);
  if (lod === 2) return;
  fittings(m, 12.8, 6.2, 7.2, lod);
  m.tag('cloth');
  const net = m.box(-12.8, -5.4, -5.8, 5.8, 7.2, 8.4, '#48533f');     // scrim net over the engine deck
  for (const [x, y] of [[-11.5, -4], [-9, 1.5], [-7, -2.5], [-10.5, 3.5]]) m.onTop(net, x, x + 1.8, y, y + 1.6, 8.4, '#5d6a4f');
  m.tag(was);
  if (lod === 0) {
    for (const s of [-1, 1]) for (const x of [-4.25, 4.25]) m.box(x - 0.2, x + 0.2, Math.min(s * 6.2, s * 9), Math.max(s * 6.2, s * 9), 4.6, 7.3, M.metal);   // skirt hinges
    m.box(-13.8, -13, -4.6, 4.6, 3, 5, M.metal);
    m.tag('cloth');
    m.box(-5.4, -3.8, -5.6, -2.4, 7.2, 7.9, '#48533f');                // a corner of the net pulled forward
    m.tag(was);
  }
}

function mirageTurret(m, tc, M, lod) {
  const t = m.prism([[-6.5, -4], [2, -5], [7, -2], [7, 2], [2, 5], [-6.5, 4]], 7.2, 9.9, M.dark, { top: M.hull });
  m.onTop(t, -5, -1.8, -2.8, 2.8, 9.9, tc.main);
  m.tag('steel');
  m.tubeX(6.4, 17, 0, 8.7, 0.8, M.metal, { n: sides(lod) });           // lance
  m.tag(null);
  m.prism([[16.6, 0], [18.6, -1.3], [20.6, 0], [18.6, 1.3]], 7.4, 10, '#d6fff9', { glow: true });   // its crystal
  for (const s of [-1, 1]) {                                           // projector masts
    m.box(-5.4, -4.6, s * 3.4 - 0.4, s * 3.4 + 0.4, 9.9, 15, M.metal);
    m.box(-5.9, -4.1, s * 3.4 - 0.9, s * 3.4 + 0.9, 15, 16.4, '#3ad1c4', { top: WHITE_HOT, glow: true });
  }
  if (lod === 2) return;
  m.box(-1.5, 2.5, -1.6, 1.6, 9.9, 11.2, M.metal);                     // sight housing
  for (const x of [9, 12, 15]) m.box(x, x + 0.8, -1.5, 1.5, 7.5, 9.9, M.dark);   // lance collars
  if (lod === 0) {
    m.tag('plating');
    m.box(2.5, 2.8, -1.2, 1.2, 10.1, 11, '#3ad1c4');
    for (const s of [-1, 1]) leanPlate(m, -5.5, 1, s * 4.2, s * 6, 7.4, 9.6, '#86a8b6');   // turret mirror cheeks
    m.tag(null);
  }
}

// ============================================================ MERIDIAN ALLIANCE / aegis

// IFV: six wheels, a boat-shaped hull, a small turret that carries whatever the day needs.
function ifvHull(m, tc, M, lod) {
  const n = sides(lod);
  for (const s of [-1, 1]) {
    const a = Math.min(s * 5.4, s * 8.1), b = Math.max(s * 5.4, s * 8.1);
    const was = m.tag('dark');
    for (const x of [-8.6, -0.2, 8.4]) {
      m.tubeY(a, b, x, 2.8, 2.8, RUBBER, { n, cap: '#23262a' });
      if (lod < 2) { m.tag('steel'); m.tubeY(s > 0 ? b : a - 0.3, s > 0 ? b + 0.3 : a, x, 2.8, 1.3, '#aeb7bd', { n: 6, cap: '#8d969c' }); m.tag('dark'); }   // hubs
    }
    m.tag(was);
    m.box(-12.4, 12.4, a - 0.2, b + 0.3, 5.7, 6.4, M.dark);            // wheel-arch shelf
  }
  const h = m.profile([[-12.6, 3], [10.6, 3], [14.8, 5.2], [10, 9.4], [-12.6, 9.4]], -5.4, 5.4, M.hull, { top: M.lite });
  m.onTop(h, -10, 6, -1.2, 1.2, 9.4, tc.main);                         // team spine stripe
  m.onY(h, -9, -2, 6.8, 8.8, 5.4, tc.main);                            // team side bands
  m.onY(h, -9, -2, 6.8, 8.8, -5.4, tc.main, false, -1);
  m.cyl(-8.8, 0, 3.1, 9.4, 10.5, M.dark, { n });                       // shield projector
  m.cyl(-8.8, 0, 2.5, 10.5, 12.4, '#dff3ff', { n, r1: 1, glow: true });
  if (lod === 2) return;
  m.onX(h, -3.4, 3.4, 4, 8.8, -12.6, M.dark, false, -1);               // rear ramp
  for (const y of [-4.4, 4.4]) m.box(14, 14.7, y - 0.8, y + 0.8, 5.6, 7, '#d9d6c4');   // headlamps
  for (const s of [-1, 1]) {                                           // slat armour
    const p = m.box(-9.5, 9.5, Math.min(s * 8.4, s * 9), Math.max(s * 8.4, s * 9), 6.4, 9, M.lite);
    for (const x of [-7, -3, 1, 5]) m.onY(p, x, x + 0.7, 6.4, 9, s * 9, M.dark, false, s);
  }
  if (lod === 0) {
    m.onTop(h, 1.5, 4.5, -4.4, -2, 9.4, M.dark); m.onTop(h, 1.5, 4.5, 2, 4.4, 9.4, M.dark);   // hatches
    for (const y of [-3, 0, 3]) m.box(8.2, 9, y - 0.6, y + 0.6, 9.4, 10, '#3ad1c4');           // periscopes
    for (const y of [-4.2, 4.2]) m.box(-13.8, -12.6, y - 0.9, y + 0.9, 5, 8, '#4f5a44');       // jerrycans
    m.tubeX(-6, 4, 5, 9.7, 0.25, '#6b5a40', { n: 5 });
  }
}

function ifvTurret(m, tc, M, lod) {
  const t = m.cyl(0, 0, 3.7, 9.4, 11.8, M.hull, { n: sides(lod), r1: 3.2, top: M.lite });
  m.onTop(t, -2.2, 0.4, -1.6, 1.6, 11.8, tc.main);
  for (const s of [-1, 1]) {                                           // launcher boxes either side
    const p = m.box(-2.6, 3.6, Math.min(s * 3.3, s * 5.6), Math.max(s * 3.3, s * 5.6), 9.8, 12.6, M.dark);
    if (lod < 2) for (const z of [10.2, 11.5]) m.onX(p, s * 3.6, s * 4.3, z, z + 0.8, 3.6, BORE), m.onX(p, s * 4.6, s * 5.3, z, z + 0.8, 3.6, BORE);
  }
  gun(m, 3, 13, 0, 10.6, 0.6, M, lod, { brake: 1.2 });
  if (lod === 2) return;
  m.box(-2.4, -1.6, -0.3, 0.3, 11.8, 14.2, M.metal);                   // radar mast
  m.cyl(-2, 0, 2.3, 14.2, 14.7, M.lite, { n: sides(lod), top: tc.main });
  if (lod === 0) {
    m.box(0.6, 2.2, -0.9, 0.9, 11.8, 12.7, M.metal);                   // sight
    whip(m, -3, 2, 11.8, 19);
  }
}

// Prism tank: a reactor on tracks, and on its yoke a faceted crystal that gathers the beam.
function prismHull(m, tc, M, lod) {
  tracks(m, 12.5, 5.2, 8.8, 4.4, M, M.dark, lod);
  const h = m.profile([[-12, 2.2], [10.5, 2.2], [14, 4.2], [8, 7.8], [-11, 7.8], [-12.6, 5.4]], -6, 6, M.hull, { top: M.lite });
  m.onTop(h, 4.6, 6.4, -5.4, 5.4, 7.8, tc.main);                       // team chevron band
  const g = m.box(-11.6, -4.8, -5.2, 5.2, 7.8, 12.2, M.dark, { top: M.metal });   // reactor
  m.onY(g, -10.8, -5.6, 9.2, 10.8, 5.2, tc.main);
  m.onY(g, -10.8, -5.6, 9.2, 10.8, -5.2, tc.main, false, -1);
  m.cyl(-8.2, 0, 3, 12.2, 14.4, '#dff3ff', { n: sides(lod), r1: 1.2, glow: true });   // its vent
  if (lod === 2) return;
  fittings(m, 12.5, 6, 7.8, lod);
  for (let x = -10.8; x < -5.6; x += 1.8) m.onTop(g, x, x + 0.8, -4.4, 4.4, 12.2, M.lite);   // cooling fins
  if (lod === 0) {
    for (const s of [-1, 1]) for (const x of [-10.4, -8.2, -6]) m.box(x, x + 0.5, Math.min(s * 5.2, s * 6.4), Math.max(s * 5.2, s * 6.4), 8.4, 11.6, M.lite);   // radiator vanes
    m.tag('steel');
    for (const y of [-2, 2]) m.tubeX(-4.8, -2.4, y, 8.8, 0.5, M.metal, { n: 5 });   // coolant lines
    m.tag(null);
  }
}

function prismTurret(m, tc, M, lod) {
  const n = lod === 2 ? 4 : 6;
  const b = m.cyl(0, 0, 4.7, 7.8, 9.8, M.hull, { n: sides(lod), top: M.lite });
  m.onTop(b, -3.6, -1.2, -2.4, 2.4, 9.8, tc.main);
  for (const s of [-1, 1]) {                                           // yoke
    m.box(2, 4.4, Math.min(s * 3.6, s * 4.9), Math.max(s * 3.6, s * 4.9), 9.8, 17, M.lite);
    m.box(2.4, 4, Math.min(s * 3.3, s * 5.2), Math.max(s * 3.3, s * 5.2), 14.6, 16.6, tc.main);
  }
  // the crystal: two cones base to base, the forward half lit
  const was = m.tag('plating');
  m.cyl(3.2, 0, 0.5, 11.2, 15.6, '#8fb9ca', { n, r1: 3.4, rot: 0.26 });
  m.tag(was);
  m.cyl(3.2, 0, 3.4, 15.6, 20.2, '#eafcff', { n, r1: 0.4, rot: 0.26, glow: true });
  if (lod === 2) return;
  m.box(-5.5, -3, -2.4, 2.4, 9.8, 13, M.dark);                         // regulator
  m.tag('plating');
  for (const s of [-1, 1]) leanPlate(m, -3.4, 1.4, s * 5, s * 8.4, 10.4, 14.4, '#86a8b6');   // collector mirrors
  m.tag(was);
  if (lod === 0) {
    m.box(1.6, 4.8, -3.6, 3.6, 16.6, 17.2, M.metal);                   // tie bar
    whip(m, -4.6, 0, 13, 19, '#dff3ff');
  }
}

// ============================================================ VEIL COLLECTIVE / dominion

/** The oval hover shell the Veil builds everything on. */
function shell(m, tc, M, lod, r, sy) {
  const n = sides(lod, true);
  m.cyl(0, 0, r - 0.9, 2.4, 4.4, M.metal, { n, sy });                  // hover skirt
  m.cyl(0, 0, r, 4.4, 6, tc.main, { n, sy });                          // team band around the shell
  m.cyl(0, 0, r - 0.2, 6, 7.6, M.hull, { n, sy, r1: r - 1.4 });
}

// Shenfeng: a light charging tank. A sharp arrowhead on a hover skirt, a ram blade for a
// nose, two thrusters; built to arrive before it is seen.
function shenfengHull(m, tc, M, lod) {
  const arrow = k => [[17 * k, 0], [6 * k, -5.2 * k], [-10 * k, -7.6 * k], [-12 * k, -3.2 * k], [-12 * k, 3.2 * k], [-10 * k, 7.6 * k], [6 * k, 5.2 * k]];
  m.prism(arrow(0.94), 2.2, 4, M.metal);                               // hover skirt
  m.prism(arrow(1), 4, 5.4, tc.main);                                  // team band
  m.prism(arrow(0.97), 5.4, 7, M.hull, { top: M.lite });
  const sp = m.profile([[-11, 7], [12.5, 7], [3, 9.6], [-9, 10.4]], -2.3, 2.3, M.lite, { top: M.hull });   // dorsal spine
  m.tag('steel');
  m.prism([[20.5, 0], [15.4, -1.7], [15.4, 1.7]], 3.4, 6.2, '#c9cdd1');   // ram blade
  m.tag(null);
  for (const s of [-1, 1]) {
    m.prism([[-5, s * 7.2], [-13.6, s * 12], [-14, s * 7]], 5, 6.2, M.dark);   // swept fins
    m.tag('steel');
    m.tubeX(-14.4, -11, s * 3.6, 5.6, 1.9, M.metal, { n: sides(lod), cap: '#ff9be4' });   // thrusters
    m.tag(null);
    m.box(-14.9, -14.4, s * 3.6 - 1.2, s * 3.6 + 1.2, 4.6, 6.6, '#ff9be4', { glow: true });
  }
  if (lod === 2) return;
  m.onY(sp, -6, 0, 7.6, 9.2, 2.3, tc.main); m.onY(sp, -6, 0, 7.6, 9.2, -2.3, tc.main, false, -1);
  m.box(-8.8, -6.4, -5.8, -4.4, 7, 9.6, M.dark);                       // offset sensor pod (nothing here is symmetrical)
  m.box(-8.2, -7, -5.4, -4.8, 9.6, 14, M.metal);
  m.box(-8.5, -6.7, -5.7, -4.5, 14, 15.2, '#ff9be4', { top: WHITE_HOT, glow: true });
  if (lod === 0) {
    for (const s of [-1, 1]) { m.box(2, 9, s * 3.4 - 0.25, s * 3.4 + 0.25, 7, 7.5, M.metal); m.box(-13.4, -6, s * 9.6 - 0.2, s * 9.6 + 0.2, 6.2, 7.6, tc.main); }   // strakes, fin tips
    m.box(15, 17.4, -0.3, 0.3, 6.2, 7, '#c9cdd1');
  }
}

function shenfengTurret(m, tc, M, lod) {
  m.cyl(0, 0, 2.9, 9.6, 11.2, M.hull, { n: sides(lod), r1: 2.1, top: M.lite, sy: 0.8 });   // blister
  for (const y of [-1.4, 1.4]) m.box(1.6, 8.4, y - 0.5, y + 0.5, 9.9, 10.9, M.lite);       // twin projectors
  m.box(7.8, 9.8, -2.2, 2.2, 9.6, 11.2, '#f0c4ff', { glow: true });
  if (lod === 0) m.box(-2.6, -1.8, -0.2, 0.2, 11.2, 14.6, M.metal);
}

// Disc: a flying saucer. A lens of hull plate with a lit rim, a dark canopy, an emitter turning underneath.
function discHull(m, tc, M, lod) {
  const n = lod === 2 ? 8 : lod === 1 ? 14 : 18;
  m.cyl(0, 0, 6.5, 2, 5, M.metal, { n, r1: 15 });                      // lower dish
  m.cyl(0, 0, 15.6, 5, 6.4, tc.main, { n });                           // team rim
  m.cyl(0, 0, 15, 6.4, 9.2, M.hull, { n, r1: 8, top: M.lite });        // upper dish
  const was = m.tag('glass');
  m.cyl(0.8, 0, 6.6, 9.2, 11, '#3a2f4d', { n, r1: 5.4 });              // canopy
  m.cyl(0.8, 0, 5.4, 11, 12.8, '#4b3d63', { n, r1: 2.2 });
  m.tag(was);
  m.cyl(0.8, 0, 2.2, 12.8, 13.6, '#f0c4ff', { n: 6, glow: true });     // crown light
  if (lod === 2) return;
  for (let i = 0; i < 8; i++) {                                        // running lights round the rim
    const a = (i / 8) * TAU + 0.2, x = Math.cos(a) * 15.5, y = Math.sin(a) * 15.5;
    m.box(x - 0.7, x + 0.7, y - 0.7, y + 0.7, 5.2, 6.2, '#ff9be4', { glow: true });
  }
  for (const a of [0.9, 3.1, 5.0]) {                                   // three lift pods, unevenly spaced
    const x = Math.cos(a) * 11, y = Math.sin(a) * 11;
    m.cyl(x, y, 2.2, 0.8, 4.6, M.dark, { n: 6, r1: 2.8 });
    if (lod === 0) m.cyl(x, y, 1.5, 0.3, 0.8, '#f0c4ff', { n: 6, glow: true });
  }
  m.box(-9.6, -9, 3.4, 4, 8, 15, M.metal);                             // one aerial, off centre
  if (lod === 0) {
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; m.box(Math.cos(a) * 10.5 - 0.3, Math.cos(a) * 10.5 + 0.3, Math.sin(a) * 10.5 - 0.3, Math.sin(a) * 10.5 + 0.3, 7.4, 8.3, M.dark); }   // hull studs
    m.box(-9.9, -8.7, 3.1, 4.3, 15, 16, '#ff9be4', { glow: true });
  }
}

function discTurret(m, tc, M, lod) {
  m.cyl(0, 0, 4.4, 0.6, 2, M.dark, { n: sides(lod), r1: 5.6 });         // emitter ring under the dish
  m.cyl(0, 0, 3, -0.8, 0.6, '#f0c4ff', { n: 6, r1: 4, glow: true });
  if (lod === 2) return;
  for (let i = 0; i < 3; i++) {                                        // focusing claws
    const a = (i / 3) * TAU + 0.5, x = Math.cos(a) * 4.6, y = Math.sin(a) * 4.6;
    m.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, -2.2, 1, M.lite);
  }
}

// ============================================================ VEIL COLLECTIVE / forge

// Gatling: a hover shell carrying a rotary cannon with its feed drum hung on one side.
function gatlingHull(m, tc, M, lod) {
  shell(m, tc, M, lod, 13.4, 0.62);
  m.cyl(-1, 0, 11, 7.6, 10.4, M.lite, { n: sides(lod, true), sy: 0.6, r1: 6.8, top: M.hull });   // carapace
  m.cyl(-3.6, 0, 5.2, 10.4, 11.2, tc.main, { n: sides(lod), sy: 0.72 });                         // team dorsal plate
  m.box(8.5, 15.5, -4.4, -2.6, 3.6, 6.4, M.dark);                      // uneven mandibles
  m.box(8.5, 13, 2.6, 4.4, 3.6, 6.4, M.dark);
  m.cyl(-8, -5.4, 2.4, 5, 12, '#6b5540', { n: sides(lod), top: '#8c7256' });   // reagent tank
  if (lod === 2) return;
  m.cyl(-2, 8.6, 3.3, 3.4, 9.4, M.dark, { n: 8 });                     // offset sensor pod
  m.cyl(-2, 8.6, 2.6, 9.4, 10.6, '#7dffb0', { n: 8, glow: true });     // coolant cap
  m.box(-10, -4, -8, -7, 6, 7.2, M.metal);
  if (lod === 0) {
    m.tag('steel');
    m.tubeX(-7, -2, -3.4, 10.8, 0.5, '#8c7256', { n: 5 });             // feed line from the tank
    m.tag(null);
    for (const a of [1.2, 2.6, 4.4]) m.box(Math.cos(a) * 12.2 - 0.6, Math.cos(a) * 12.2 + 0.6, Math.sin(a) * 7.4 - 0.6, Math.sin(a) * 7.4 + 0.6, 6, 8.4, M.dark);   // skirt lugs
  }
}

function gatlingTurret(m, tc, M, lod) {
  m.cyl(0, 0, 4.2, 10.4, 13, M.metal, { n: sides(lod), top: M.dark });
  m.cyl(-1, -4.8, 2.9, 9.6, 14, '#6b5540', { n: sides(lod), top: '#8c7256' });   // feed drum, one side only
  const nb = lod === 2 ? 3 : 6, was = m.tag('steel');
  for (let i = 0; i < nb; i++) {                                       // the barrel cluster
    const a = (i / nb) * TAU + 0.3;
    m.tubeX(3, 15.6, Math.cos(a) * 1.5, 11.9 + Math.sin(a) * 1.5, 0.55, M.metal, { n: lod === 0 ? 6 : 4, cap: BORE });
  }
  m.tubeX(2.4, 5, 0, 11.9, 2.5, GUNMETAL, { n: sides(lod) });          // breech housing
  if (lod < 2) { m.tubeX(9, 10, 0, 11.9, 2.3, GUNMETAL, { n: sides(lod) }); m.tubeX(14.4, 15.2, 0, 11.9, 2.3, GUNMETAL, { n: sides(lod) }); }   // barrel clamps
  m.tag(was);
  m.cyl(-0.5, 0, 2.6, 13, 13.8, '#7dffb0', { n: 8, glow: true });
  if (lod === 0) {
    m.box(-4, -2.4, -1, 1, 13, 15, M.dark);
    m.tag('steel');
    m.tubeY(-4.6, -1.6, 1.2, 12.6, 0.6, '#8c7256', { n: 5 });          // feed chute
    m.tag(was);
  }
}

// Brain: the control vehicle. A wide hover shell under a ribbed dome with something lit
// inside it, ringed by aerials of four different heights.
function brainHull(m, tc, M, lod) {
  const n = sides(lod, true);
  shell(m, tc, M, lod, 15.2, 0.7);
  m.cyl(0, 0, 13.4, 7.6, 9.6, M.lite, { n, sy: 0.7, r1: 9.4, top: M.hull });
  m.cyl(0, 0, 9.4, 9.6, 10.3, tc.main, { n: sides(lod), sy: 0.74 });   // team ring plate
  m.cyl(9, 7.5, 2.4, 4, 10, M.dark, { n: 6 });                         // lopsided outriggers
  m.cyl(-10.5, -6, 2, 4, 8.4, M.dark, { n: 6 });
  if (lod === 2) return;
  m.cyl(-10.5, -6, 2.6, 8.4, 9.4, '#7dffb0', { n: 6, glow: true });
  for (const [x, y, z] of [[10.4, -5, 19], [-6, 8.2, 22.5], [-11.5, 2, 16.5], [4, -8.6, 14.5]]) {   // aerials
    m.box(x - 0.3, x + 0.3, y - 0.3, y + 0.3, 8, z, M.metal);
    m.box(x - 0.7, x + 0.7, y - 0.7, y + 0.7, z, z + 1.2, '#7dffb0', { top: WHITE_HOT, glow: true });
  }
  if (lod === 0) {
    m.tag('steel');
    for (const a of [0.4, 2.2, 3.9, 5.4]) m.tubeX(Math.cos(a) * 6, Math.cos(a) * 6 + 3.6, Math.sin(a) * 6.4, 9.9, 0.5, '#6b5540', { n: 5 });   // conduits
    m.tag(null);
    m.cyl(9, 7.5, 2.9, 10, 10.8, M.metal, { n: 6 });
  }
}

function brainTurret(m, tc, M, lod) {
  const n = lod === 2 ? 6 : 8;
  m.cyl(0, 0, 7, 10.3, 11.6, M.dark, { n, top: M.metal });             // dome seat
  m.cyl(0, 0, 5.6, 11.6, 16.6, '#b8ffd6', { n, r1: 4.6, glow: true }); // what the dome holds
  const was = m.tag('glass');
  m.cyl(0, 0, 6.2, 16.6, 19.6, '#2f4a40', { n, r1: 2.6 });             // dome cap
  m.tag(was);
  m.cyl(0, 0, 2.6, 19.6, 20.4, M.dark, { n: 6, top: '#6b5540' });
  if (lod === 2) return;
  for (let i = 0; i < (lod === 0 ? 8 : 4); i++) {                      // ribs
    const a = (i / (lod === 0 ? 8 : 4)) * TAU + 0.39, x = Math.cos(a) * 6.3, y = Math.sin(a) * 6.3;
    m.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, 11.6, 17.4, M.metal);
  }
  m.box(-0.3, 0.3, -0.3, 0.3, 20.4, 25, M.metal);
  if (lod === 0) {
    m.cyl(0, 0, 6.6, 13.6, 14.3, M.metal, { n });                      // girdle
    m.box(-0.7, 0.7, -0.7, 0.7, 25, 26.2, '#7dffb0', { glow: true });
  }
}

// ============================================================ infantry sprites (canvas renderer)

function ironSoldier(g, tc, M, sub, P) {
  const { fx, fy, bob, away, line } = P;
  P.legs('#2a2b28', 2.4);
  const gun = () => {
    g.strokeStyle = '#131415'; g.lineWidth = 2;
    line(fx * 1 - fy * 1.6, -9 + bob, fx * 8.5 - fy * 1.6, -9.6 + fy * 3.4 + bob);
    if (sub === 'volt') {
      g.fillStyle = '#bfeaff';
      g.beginPath(); g.arc(fx * 9 - fy * 1.6, -9.7 + fy * 3.6 + bob, 1.5, 0, TAU); g.fill();
    }
  };
  if (away) gun();
  // greatcoat: wide at the hem
  g.fillStyle = M.hull;
  g.beginPath(); g.moveTo(-3.4, -12.6 + bob); g.lineTo(3.4, -12.6 + bob); g.lineTo(4.2, -4.4 + bob); g.lineTo(-4.2, -4.4 + bob); g.closePath(); g.fill();
  g.fillStyle = M.dark;
  g.beginPath(); g.moveTo(0.8, -12.6 + bob); g.lineTo(3.4, -12.6 + bob); g.lineTo(4.2, -4.4 + bob); g.lineTo(1, -4.4 + bob); g.closePath(); g.fill();
  g.fillStyle = tc.main;                                              // shoulder boards
  g.fillRect(-3.8, -12.9 + bob, 7.6, 2.5);
  g.fillStyle = '#1b1c1a';
  g.fillRect(-3.8, -8.6 + bob, 7.9, 1.3);                             // belt
  if (away || sub === 'volt') {                                       // bedroll, or coil pack
    g.fillStyle = sub === 'volt' ? COPPER : '#4b4a40';
    g.beginPath(); g.roundRect(-2.6, -12 + bob, 5.2, 4.6, 1); g.fill();
    if (sub === 'volt') { g.fillStyle = '#bfeaff'; g.fillRect(-0.7, -15.4 + bob, 1.4, 3.6); }
  }
  if (sub === 'bastion' && !away) {                                   // breastplate
    g.fillStyle = M.lite;
    g.beginPath(); g.roundRect(-2.6, -11.4 + bob, 4.4, 3.6, 0.8); g.fill();
  }
  if (!away) gun();
  g.fillStyle = '#d3a985';
  g.beginPath(); g.arc(fx * 0.7, -13.9 + bob, 1.9, 0, TAU); g.fill();
  g.fillStyle = M.dark;                                               // broad steel helmet
  g.beginPath(); g.arc(fx * 0.4, -14.3 + bob, 3.2, Math.PI, 0); g.closePath(); g.fill();
  g.fillRect(fx * 0.4 - 3.7, -14.7 + bob, 7.4, 1.2);
  g.fillStyle = tc.main;
  g.fillRect(fx * 0.4 - 2.6, -16.4 + bob, 5.2, 1.3);                  // team helmet band
}

function merSoldier(g, tc, M, sub, P) {
  const { fx, fy, bob, away, line } = P;
  P.legs('#3a4148', 1.9);
  const long = sub === 'shade';
  const gun = () => {
    g.strokeStyle = '#15181b'; g.lineWidth = 1.4;
    line(fx * 1 - fy * 1.3, -9.2 + bob, fx * (long ? 10.5 : 7.8) - fy * 1.3, -9.8 + fy * (long ? 4.4 : 3.3) + bob);
  };
  if (away) gun();
  g.fillStyle = sub === 'shade' ? M.dark : M.hull;                    // fitted fatigues
  g.beginPath(); g.roundRect(-2.7, -12.4 + bob, 5.4, 7.4, 1.6); g.fill();
  g.fillStyle = sub === 'shade' ? '#3d464d' : M.dark;
  g.beginPath(); g.roundRect(0.7, -12.2 + bob, 2, 7, [0, 1.5, 1.5, 0]); g.fill();
  g.fillStyle = tc.main;                                              // shoulder pads
  g.beginPath(); g.roundRect(-3.9, -12.8 + bob, 2.6, 2.8, 1); g.fill();
  g.beginPath(); g.roundRect(1.3, -12.8 + bob, 2.6, 2.8, 1); g.fill();
  if (away) {
    g.fillStyle = M.dark;
    g.beginPath(); g.roundRect(-1.9, -11.4 + bob, 3.8, 4.4, 0.8); g.fill();
    g.strokeStyle = '#15181b'; g.lineWidth = 0.8;
    line(1.4, -11.4 + bob, 2.6, -19 + bob);                           // radio whip
  } else {
    g.fillStyle = '#2b3138';
    g.fillRect(-2.7, -8.4 + bob, 5.4, 1);
    gun();
  }
  if (sub === 'aegis') {                                              // projected arm shield
    g.strokeStyle = '#dff3ff'; g.lineWidth = 1.6; g.globalAlpha = 0.85;
    const a = Math.atan2(fy * F, fx);
    g.beginPath(); g.ellipse(fx * 4, -8.5 + fy * 2 + bob, 4.6, 6, 0, a - 0.9, a + 0.9); g.stroke();
    g.globalAlpha = 1;
  }
  g.fillStyle = '#d6ad88';
  g.beginPath(); g.arc(fx * 0.7, -13.7 + bob, 1.8, 0, TAU); g.fill();
  g.fillStyle = sub === 'shade' ? M.dark : M.lite;                    // close helmet
  g.beginPath(); g.arc(fx * 0.4, -14.1 + bob, 2.6, Math.PI, 0); g.closePath(); g.fill();
  g.fillStyle = tc.main;
  g.fillRect(fx * 0.4 - 2.6, -14.6 + bob, 5.2, 1.1);
  if (!away) { g.fillStyle = sub === 'shade' ? '#3ad1c4' : '#1d2226'; g.fillRect(fx * 1 - 1.6, -13.6 + bob, 3.2, 0.9); }   // visor
}

function veilSoldier(g, tc, M, sub, P) {
  const { fx, fy, bob, away, line, sw } = P;
  const sway = sw * 0.8;
  const staff = () => {
    if (sub === 'dominion') {
      g.strokeStyle = '#17141b'; g.lineWidth = 1.3;
      line(fx * 3 - fy * 2.4, -1 + bob, fx * 3 - fy * 2.4, -19 + bob);
      g.fillStyle = '#f0c4ff';
      g.beginPath(); g.arc(fx * 3 - fy * 2.4, -19.6 + bob, 2, 0, TAU); g.fill();
    } else {
      g.strokeStyle = '#8c7256'; g.lineWidth = 2.2;                    // grafted arm cannon
      line(fx * 1 - fy * 1.6, -9.5 + bob, fx * 7.5 - fy * 1.6, -9.5 + fy * 3 + bob);
      g.fillStyle = '#7dffb0';
      g.beginPath(); g.arc(fx * 8 - fy * 1.6, -9.5 + fy * 3.2 + bob, 1.6, 0, TAU); g.fill();
    }
  };
  if (away) staff();
  g.fillStyle = M.hull;                                               // robe to the ground
  g.beginPath(); g.moveTo(-2.6, -12.6 + bob); g.lineTo(2.6, -12.6 + bob); g.lineTo(4.6 + sway, 0.6); g.lineTo(-4.6 + sway, 0.6); g.closePath(); g.fill();
  g.fillStyle = M.dark;
  g.beginPath(); g.moveTo(0.8, -12.6 + bob); g.lineTo(2.6, -12.6 + bob); g.lineTo(4.6 + sway, 0.6); g.lineTo(1.6 + sway, 0.6); g.closePath(); g.fill();
  g.fillStyle = tc.main;                                              // team sash, shoulder to hem
  g.beginPath(); g.moveTo(-2.4, -12.4 + bob); g.lineTo(-0.2, -12.4 + bob); g.lineTo(1.4 + sway, 0.4); g.lineTo(-1.6 + sway, 0.4); g.closePath(); g.fill();
  if (sub === 'forge' && away) {
    g.fillStyle = '#6b5540';
    g.beginPath(); g.roundRect(-2.2, -12 + bob, 4.4, 6, 1.4); g.fill();
  }
  if (!away) staff();
  g.fillStyle = M.dark;                                               // pointed cowl
  g.beginPath(); g.moveTo(-3.1, -12.2 + bob); g.lineTo(fx * 0.5, -18.6 + bob); g.lineTo(3.1, -12.2 + bob); g.closePath(); g.fill();
  g.fillStyle = tc.main;
  g.fillRect(-3.1, -12.9 + bob, 6.2, 1.2);                            // cowl trim
  if (!away) { g.fillStyle = M.glow; g.fillRect(fx * 1.2 - 1.2, -14.6 + bob, 2.4, 0.9); }   // eyes
  if (sub === 'dominion') {
    g.strokeStyle = '#ff9be4'; g.lineWidth = 1; g.globalAlpha = 0.9;
    g.beginPath(); g.arc(fx * 0.4, -16 + bob, 4.6, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    g.globalAlpha = 1;
  }
}

// ============================================================ registry

const R = (id, kind, hull, turret, foot, spec) => ({ id, kind, hull, turret, foot, spec });
const FOOT_SPEC = { pivot: 0, muzzle: 0, mz: 0 };

/** Roster: faction -> subfaction -> tier -> unit. */
const ROSTER = {
  iron: {
    bastion: {
      1: R('conscript', 'foot'),
      2: R('rhino', 'ground', rhinoHull, rhinoTurret, [14.5, 12.5], { pivot: -1, muzzle: 21, mz: 12.1 }),
      3: R('apocalypse', 'ground', apocalypseHull, apocalypseTurret, [17, 14], { pivot: -1.5, muzzle: 22.6, mz: 14, barrels: [-2.8, 2.8] }),
    },
    volt: {
      1: R('teslaTrooper', 'foot'),
      2: R('teslaTank', 'ground', teslaTankHull, teslaTankTurret, [14, 12], { pivot: 0, muzzle: 13, mz: 12.5, glow: [12, 12.5, 3.6] }),
      3: R('kirov', 'air', kirovHull, kirovTurret, [24, 10], { pivot: 4, muzzle: 6.4, mz: 1.2, hover: 44, bob: 1.6, drift: 2.4 }),
    },
  },
  meridian: {
    shade: {
      1: R('gi', 'foot'),
      2: R('grizzly', 'ground', grizzlyHull, grizzlyTurret, [13.5, 9.5], { pivot: -1, muzzle: 18.6, mz: 9.9 }),
      3: R('mirage', 'ground', mirageHull, mirageTurret, [14, 10.6], { pivot: 1.5, muzzle: 20.6, mz: 8.7, glow: [18.6, 8.7, 3.4] }),
    },
    aegis: {
      1: R('guardian', 'foot'),
      2: R('ifv', 'ground', ifvHull, ifvTurret, [13.5, 9], { pivot: 1, muzzle: 14, mz: 10.6 }),
      3: R('prism', 'ground', prismHull, prismTurret, [13.5, 9.5], { pivot: 1.5, muzzle: 3.2, mz: 18, glow: [3.2, 17.6, 5] }),
    },
  },
  veil: {
    dominion: {
      1: R('initiate', 'foot'),
      2: R('shenfeng', 'hover', shenfengHull, shenfengTurret, [15, 9], { pivot: 4, muzzle: 9.8, mz: 10.4, hover: 2.6, bob: 0.9, glow: [8.8, 10.4, 2.8] }),
      3: R('disc', 'air', discHull, discTurret, [15.5, 15.5], { pivot: 0, muzzle: 0, mz: -0.8, hover: 36, bob: 1.3, drift: 1.6, spin: 1.4, glow: [0, -0.4, 6] }),
    },
    forge: {
      1: R('sniper', 'foot'),
      2: R('gatling', 'hover', gatlingHull, gatlingTurret, [13, 8.5], { pivot: 1, muzzle: 15.6, mz: 11.9, hover: 3.2, bob: 1.1 }),
      3: R('brain', 'hover', brainHull, brainTurret, [15, 10.5], { pivot: 0, muzzle: 0, mz: 16, hover: 4, bob: 1.1, glow: [0, 14.2, 6.5] }),
    },
  },
};

const rosterOf = (f, sub, tier) => {
  const F0 = ROSTER[f] || ROSTER.iron;
  return (F0[sub] || F0[Object.keys(F0)[0]])[tier] || null;
};

/** Role id of a roster slot ('rhino', 'kirov', ...). */
export function unitId(f, sub, tier) {
  const u = rosterOf(f, sub, tier);
  return u ? u.id : null;
}

/** Every roster slot: [{ faction, sub, tier, id, kind }]. */
export function rosterList() {
  const out = [];
  for (const f of Object.keys(ROSTER)) for (const sub of Object.keys(ROSTER[f])) for (const tier of [1, 2, 3]) out.push({ faction: f, sub, tier, id: ROSTER[f][sub][tier].id, kind: ROSTER[f][sub][tier].kind });
  return out;
}

/**
 * Sockets and movement of a unit, in model units:
 * { id, kind: 'foot' | 'ground' | 'hover' | 'air', air, hover (height it rides at), bob, drift,
 *   foot: [half length, half width], pivot, muzzle, mz, glow?, spin?, barrels? }
 */
export function unitSpec(f, sub, tier) {
  const u = rosterOf(f, sub, tier);
  if (!u || u.kind === 'foot') return { id: u ? u.id : null, kind: 'foot', air: false, hover: 0, bob: 0, drift: 0, foot: [3, 3], ...FOOT_SPEC };
  return { id: u.id, kind: u.kind, air: u.kind === 'air', hover: 0, bob: 0, drift: 0, foot: u.foot, ...u.spec };
}

const PLAIN = { id: 'neutral', main: '#878c90', dark: '#4a4f54', light: '#c2c7cb' };
const clampLod = lod => (lod === 0 || lod === 2 ? lod : 1);

export function buildHull(f, sub, tier, tc = PLAIN, lod = 1) {
  const m = new Unit(), u = rosterOf(f, sub, tier);
  u.hull(m, tc, FACTIONS[f].mat, clampLod(lod));
  return m;
}

export function buildTurret(f, sub, tier, tc = PLAIN, lod = 1) {
  const m = new Unit(), u = rosterOf(f, sub, tier);
  u.turret(m, tc, FACTIONS[f].mat, clampLod(lod));
  return m;
}

const lookup = new Map();
/**
 * One lookup for every unit model.
 * @param lod   0 close, 1 playing distance, 2 far
 * @param tc    team colour ({ id, main, dark, light }); neutral grey when omitted
 * @param frame walk frame 0..3 (infantry only)
 * @returns { id, kind, lod, spec, hull: Model, turret: Model | null } - infantry are a hull with no turret.
 *          Models are built once per (unit, lod, team colour, frame) and shared; do not modify them.
 */
export function unitModel(faction, sub, tier, lod = 1, tc = PLAIN, frame = 0) {
  lod = clampLod(lod);
  const u = rosterOf(faction, sub, tier);
  if (!u) return null;
  const foot = u.kind === 'foot';
  const key = `${faction}|${sub}|${tier}|${lod}|${tc.id}|${foot ? frame & 3 : 0}`;
  let v = lookup.get(key);
  if (!v) {
    v = foot
      ? { id: u.id, kind: u.kind, lod, spec: unitSpec(faction, sub, tier), hull: buildSoldier(faction, sub, tc, frame & 3, lod), turret: null }
      : { id: u.id, kind: u.kind, lod, spec: unitSpec(faction, sub, tier), hull: buildHull(faction, sub, tier, tc, lod), turret: buildTurret(faction, sub, tier, tc, lod) };
    lookup.set(key, v);
  }
  return v;
}

const SOLDIERS = { iron: ironSoldier, meridian: merSoldier, veil: veilSoldier };

/** Infantry, one walk frame. dir8: 0 = east, clockwise. frame: 0..3. */
export function drawSoldier(g, f, sub, tc, dir8, frame) {
  const a = dir8 * Math.PI / 4, fx = Math.cos(a), fy = Math.sin(a);
  const sw = [0, 1, 0, -1][frame];
  const glide = f === 'veil';
  const bob = glide ? (frame % 2 ? -0.4 : 0) - 0.6 : (frame % 2 ? -0.7 : 0);
  const line = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  const legs = (col, w) => {
    const hx = -fy * 1.4, hy = fx * 1.4 * F, stx = fx * 2.8 * sw, sty = fy * 1.6 * sw;
    g.strokeStyle = col; g.lineWidth = w;
    line(hx, -5.4 + hy + bob, hx + stx, hy + sty - (sw > 0 ? 0.7 : 0));
    line(-hx, -5.4 - hy + bob, -hx - stx, -hy - sty - (sw < 0 ? 0.7 : 0));
  };
  SOLDIERS[f](g, tc, FACTIONS[f].mat, sub, { fx, fy, sw, bob, away: fy < -0.2, line, legs });
}

// ------------------------------------------------------------ infantry as 3D models
// Used by the WebGL renderer: the same silhouettes as the sprites, built from boxes and
// tapered columns so they are lit and cast shadows like everything else. Four frames give
// the walk cycle (legs swing fore and aft, arms against them at close range).

const SKIN = '#d6ad88', BOOT = '#23261f', RIFLE = '#15171a';

function legs3d(m, sw, col, w, lod) {
  m.box(sw * 2.2 - 1, sw * 2.2 + 1, -2.1 * w, -0.3, 0, 5.6, col);
  m.box(-sw * 2.2 - 1, -sw * 2.2 + 1, 0.3, 2.1 * w, 0, 5.6, col);
  if (lod === 2) return;
  m.box(sw * 2.2 - 1.2, sw * 2.2 + 1.6, -2.2 * w, -0.2, 0, 1.3, BOOT);
  m.box(-sw * 2.2 - 1.2, -sw * 2.2 + 1.6, 0.2, 2.2 * w, 0, 1.3, BOOT);
}

/** Arms, for the close model: one forward to the weapon, one swinging against the legs. */
function arms3d(m, sw, col, y, z) {
  m.box(0.4, 3.6, y - 0.1, y + 1, z - 2.6, z - 1.4, col);
  m.box(-sw * 1.4 - 0.6, -sw * 1.4 + 0.6, -y - 1, -y + 0.1, z - 5, z - 0.6, col);
}

const SOLDIER3D = {
  // Conscript: greatcoat, broad steel helmet, a long rifle.
  conscript(m, tc, M, sw, lod) {
    legs3d(m, sw, '#2a2b28', 1.15, lod);
    if (lod < 2) m.cyl(0, 0, 3.6, 4.2, 6.2, M.hull, { n: 6, r1: 3 });  // greatcoat hem
    m.box(-1.9, 1.9, -3, 3, 6, 12, M.hull);
    m.box(-2.1, 2.1, -3.4, 3.4, 10.6, 12.2, tc.main);                  // shoulder boards
    m.box(-1.3, 1.3, -1.3, 1.3, 12.2, 14.2, SKIN);
    m.cyl(0, 0, 3, 13.8, 14.5, M.dark, { n: lod === 2 ? 5 : 8 });      // helmet brim
    m.cyl(0, 0, 2.3, 14.5, 15.9, M.dark, { n: lod === 2 ? 5 : 8, r1: 1.3, top: tc.main });
    m.box(1, 9, 1.9, 2.9, 9.2, 10.4, RIFLE);
    if (lod === 2) return;
    m.box(-2, 2, -3.1, 3.1, 7.2, 8.2, BOOT);                           // belt
    m.box(1.9, 2.5, -2.2, 2.2, 8.4, 11.4, M.lite);                     // breastplate
    m.box(-3.2, -1.9, -2.2, 2.2, 8, 11.6, '#4b4a40');                  // bedroll
    if (lod === 0) { arms3d(m, sw, M.hull, 2.4, 11.8); m.box(9, 11.4, 2.2, 2.6, 9.7, 10, '#c9cdd1'); m.box(-0.9, 0.9, -3.3, -2.7, 6.4, 8.4, '#4b4a40'); }   // bayonet, pouch
  },
  // Tesla trooper: an insulated suit, a coil pack, live gauntlets instead of a rifle.
  teslaTrooper(m, tc, M, sw, lod) {
    legs3d(m, sw, RUBBER, 1.3, lod);
    m.box(-2.3, 2.3, -3.6, 3.6, 5.6, 12.4, M.dark);                    // suit
    m.box(-2.5, 2.5, -4.1, 4.1, 10.8, 12.6, tc.main);                  // shoulder boards
    m.cyl(0, 0, 2.2, 12.4, 15.4, M.metal, { n: lod === 2 ? 5 : 8, r1: 1.6, top: tc.main });   // dome helmet
    m.box(-4, -2.3, -2.4, 2.4, 6.8, 12.6, COPPER);                     // coil pack
    m.cyl(-3.1, 0, 0.8, 12.6, 16.4, '#bfeaff', { n: 5, glow: true });
    for (const y of [-3.9, 3.9]) m.box(2.8, 4.2, y - 0.7, y + 0.7, 8, 9.3, '#5fb4ea', { glow: true });   // gauntlets
    if (lod === 2) return;
    m.box(1.5, 2.3, -1.3, 1.3, 13, 14.2, '#7fd8ff', { glow: true });   // visor
    m.box(-2.4, 2.4, -3.7, 3.7, 7.4, 8.4, BOOT);
    for (const y of [-3.9, 3.9]) m.box(-0.8, 2.6, y - 0.9, y + 0.9, 8, 11.4, M.dark);   // forearms
    if (lod === 0) { m.box(-4.3, -3.7, -2.8, -2.2, 12.6, 14.6, COPPER); m.box(-4.3, -3.7, 2.2, 2.8, 12.6, 14.6, COPPER); m.box(2.3, 2.8, -2.6, 2.6, 9, 11.6, M.metal); }
  },
  // GI: fitted fatigues, a close helmet, rifle and radio.
  gi(m, tc, M, sw, lod) {
    legs3d(m, sw, '#3a4148', 0.95, lod);
    m.box(-1.5, 1.5, -2.4, 2.4, 5.4, 11.6, M.dark);
    m.box(-1.7, 1.7, -3, -1.7, 10.2, 12, tc.main);                     // shoulder pads
    m.box(-1.7, 1.7, 1.7, 3, 10.2, 12, tc.main);
    m.box(-1.2, 1.2, -1.2, 1.2, 11.8, 13.7, SKIN);
    m.cyl(0, 0, 2.1, 13.2, 15, M.dark, { n: lod === 2 ? 5 : 8, r1: 1.4, top: tc.main });
    m.box(1, 11, 1.7, 2.4, 9.3, 10.2, RIFLE);
    if (lod === 2) return;
    m.box(-3, -1.5, -1.7, 1.7, 6.8, 11.2, M.dark);                     // radio pack
    m.box(-2.7, -2.3, 1, 1.4, 11.2, 19.5, RIFLE);                      // whip aerial
    m.box(1.4, 1.9, -1.1, 1.1, 13.2, 14, '#3ad1c4', { glow: true });   // visor
    if (lod === 0) { arms3d(m, sw, M.dark, 2, 11.4); m.box(-1.6, 1.6, -2.5, 2.5, 7, 7.8, '#2b3138'); m.box(4, 6, 1.6, 2.5, 8.2, 9.3, RIFLE); }   // belt, magazine
  },
  // Guardian: plate over the fatigues, a launcher on the shoulder, a projected arm shield.
  guardian(m, tc, M, sw, lod) {
    legs3d(m, sw, '#3a4148', 1.05, lod);
    m.box(-1.7, 1.7, -2.7, 2.7, 5.4, 11.8, M.hull);
    m.box(-1.9, 1.9, -3.4, -1.9, 10, 12.2, tc.main);                   // shoulder pads
    m.box(-1.9, 1.9, 1.9, 3.4, 10, 12.2, tc.main);
    m.box(-1.2, 1.2, -1.2, 1.2, 11.8, 13.7, SKIN);
    m.cyl(0, 0, 2.2, 13.2, 15.2, M.lite, { n: lod === 2 ? 5 : 8, r1: 1.5, top: tc.main });
    m.box(-3.4, 6.4, 1.6, 3.4, 11.4, 13.2, M.dark);                    // shoulder launcher
    m.box(3.2, 3.5, -3.4, 0.6, 5.6, 11.4, '#4f9fd8', { glow: true });  // projected arm shield
    if (lod === 2) return;
    m.box(1.7, 2.3, -2, 2, 7.6, 11.2, M.lite);                         // chest plate
    m.box(6.4, 7, 1.9, 3.1, 11.7, 12.9, BORE);
    m.box(-3.2, -1.7, -1.9, 1.9, 6.6, 10.6, M.dark);
    if (lod === 0) { arms3d(m, sw, M.hull, 2.2, 11.4); m.box(-4.4, -3.4, 1.9, 3.1, 11.6, 13, '#aeb7bd'); m.box(-1.8, 1.8, -2.8, 2.8, 7, 7.8, '#2b3138'); }
  },
  // Initiate: robed to the ground, a staff with a lit head.
  initiate(m, tc, M, sw, lod) {
    m.cyl(sw * 0.5, 0, 4, 0.3, 11.8, M.hull, { n: lod === 2 ? 5 : 8, r1: 1.9 });   // robe to the ground, swaying
    m.box(1.2, 2.6, -1.1, 1.1, 1, 11.4, tc.main);                      // sash down the front
    m.cyl(0, 0, 2.3, 12.6, 17, M.dark, { n: lod === 2 ? 4 : 6, r1: 0.3 });         // pointed cowl
    m.box(2.2, 2.9, 2.6, 3.3, 0, 19.5, RIFLE);                         // staff
    m.cyl(2.55, 2.95, 1.7, 19.5, 22.4, '#f0c4ff', { n: 6, glow: true });
    if (lod === 2) { m.cyl(0, 0, 2.5, 11.4, 12.6, tc.main, { n: 5 }); return; }
    m.cyl(0, 0, 2.5, 11.4, 12.6, tc.main, { n: 6 });                   // cowl trim
    m.box(1.7, 2.2, -1, 1, 13.2, 14, M.glow, { glow: true });          // eyes
    if (lod === 0) { m.box(0.6, 3, 1.8, 3, 9.4, 10.6, M.hull); m.cyl(2.55, 2.95, 2.4, 18.6, 19.5, M.metal, { n: 6 }); m.box(-2.6, -1.4, -1.6, 1.6, 6, 11.2, M.dark); }
  },
  // Sniper: hooded, a reagent pack, a rifle longer than he is tall.
  sniper(m, tc, M, sw, lod) {
    m.cyl(sw * 0.4, 0, 3.4, 0.3, 11.6, M.hull, { n: lod === 2 ? 5 : 8, r1: 1.9 });
    m.box(1.2, 2.5, -1.1, 1.1, 3, 11.2, tc.main);                      // sash
    m.cyl(0, 0, 2.4, 12.4, 15.8, M.dark, { n: lod === 2 ? 4 : 6, r1: 0.8 });       // hood
    m.box(0.6, 14.6, 1.7, 2.5, 9.6, 10.4, RIFLE);                      // the rifle
    m.box(-3.4, -1.6, -1.9, 1.9, 5.5, 11, '#6b5540');                  // reagent pack
    if (lod === 2) { m.cyl(0, 0, 2.5, 11.2, 12.4, tc.main, { n: 5 }); return; }
    m.cyl(0, 0, 2.5, 11.2, 12.4, tc.main, { n: 6 });
    m.box(1.7, 2.3, -1.1, 1.1, 13, 13.9, '#7dffb0', { glow: true });   // goggles
    m.box(4.4, 6.4, 1.5, 2.7, 10.4, 11.3, '#8c7256');                  // scope
    m.box(7.6, 9.4, 1.4, 2.8, 8.4, 9.6, '#7dffb0', { glow: true });    // reagent vial under the barrel
    if (lod === 0) { m.box(12.4, 12.8, 1.2, 1.5, 6.4, 9.6, RIFLE); m.box(12.4, 12.8, 2.7, 3, 6.4, 9.6, RIFLE); m.box(-3.7, -3.1, -0.5, 0.5, 11, 13.4, '#8c7256'); }   // bipod, pack valve
  },
};

/** One walk frame of an infantry figure as a 3D model. frame: 0..3. */
export function buildSoldier(f, sub, tc = PLAIN, frame = 0, lod = 1) {
  const m = new Unit(), u = rosterOf(f, sub, 1);
  SOLDIER3D[u.id](m, tc, FACTIONS[f].mat, [0, 1, 0, -1][frame & 3], clampLod(lod));
  return m;
}

/** Where an infantry weapon fires from, relative to the sprite anchor. */
export function soldierMuzzle(f, sub, dx, dy) {
  if (f === 'veil' && sub === 'dominion') return [dx * 3 - dy * 2.4, -19.6];
  if (f === 'iron' && sub === 'volt') return [dx * 4.6, -8.8 + dy * 2];
  if (f === 'meridian' && sub === 'aegis') return [dx * 7, -12.4 + dy * 2.8];
  const reach = f === 'veil' ? 14.6 : f === 'meridian' ? 10.5 : 8.5;
  return [dx * reach, -9.6 + dy * 3.4];
}

// ------------------------------------------------------------ animation
// Animation as functions of a time value.
//
// Every function here takes the time it should show (`t`, in seconds) and returns a pose.
// The game passes simulation time, so everything freezes when the match is paused and runs
// at the match's speed, and nothing here multiplies by a speed of its own: time is applied
// once, by whoever supplies `t`. `seed` (any number) puts figures out of step with each other.
//
// No state, except the small objects callers keep for turrets (turnToward).


export const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Slow start, slow stop. */
export const ease = p => { p = clamp01(p); return p * p * (3 - 2 * p); };

/** Walk frame 0..3 for a marching figure. */
export const walkFrame = (t, seed = 0, rate = 9) => Math.floor(t * rate + seed * 1.3) & 3;

/**
 * How a hull rides, in the units of `spec` (see unitSpec: kind, hover, bob, drift).
 * @returns { lift, sway, yaw }  height above the road, sideways drift across its heading,
 *          and a small turn away from it
 *   ground  rattles a little on its tracks while moving
 *   hover   bobs on its cushion whether moving or not
 *   air     holds its height, breathing slowly, and drifts and yaws in the wind
 */
export function hullPose(spec, t, seed = 0, moving = false) {
  if (spec.kind === 'air') {
    return {
      lift: spec.hover + Math.sin(t * 0.9 + seed * 1.7) * (spec.bob || 0),
      sway: Math.sin(t * 0.45 + seed * 2.3) * (spec.drift || 0),
      yaw: Math.sin(t * 0.3 + seed) * 0.05,
    };
  }
  if (spec.hover) return { lift: spec.hover + Math.sin(t * 3 + seed * 1.7) * (spec.bob || 1), sway: 0, yaw: 0 };
  return { lift: moving ? Math.abs(Math.sin(t * 11 + seed * 2.1)) * 0.28 : 0, sway: 0, yaw: 0 };
}

/** Shortest signed turn from angle a to angle b. */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Turret traverse: turn `state.yaw` toward `target` at no more than `rate` radians per
 * second of `t`. `state` is any object the caller keeps for this turret ({} to start);
 * it remembers the angle and the time it was last asked. Time standing still (a pause)
 * moves nothing; time jumping (a figure that was off screen) snaps to the target.
 * @returns the angle to draw
 */
export function turnToward(state, target, t, rate = 2.6) {
  if (state.yaw === undefined || state.t === undefined) { state.yaw = target; state.t = t; return target; }
  const dt = t - state.t;
  state.t = t;
  if (dt < 0 || dt > 1.5) { state.yaw = target; return target; }
  const d = angleDiff(state.yaw, target), step = rate * dt;
  state.yaw = Math.abs(d) <= step ? target : state.yaw + Math.sign(d) * step;
  return state.yaw;
}

/**
 * Where an idle turret points: along the hull, scanning a little; units with `spec.spin`
 * (the disc's emitter) turn steadily instead.
 */
export function idleTurret(spec, hullYaw, t, seed = 0) {
  if (spec.spin) return hullYaw + t * spec.spin + seed;
  return hullYaw + Math.sin(t * 0.55 + seed * 3.1) * 0.14;
}

/**
 * Gun recoil as a fraction of full travel, from the phase of the firing cycle (0 at the
 * shot, 1 just before the next): thrown back at once, run out slowly.
 */
export function recoil(phase) {
  const p = phase - Math.floor(phase);
  return p < 0.06 ? p / 0.06 : (1 - (p - 0.06) / 0.94) ** 2.2;
}

