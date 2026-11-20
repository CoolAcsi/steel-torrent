// Model set C, "Faction sci-fi": three design languages, each lit from within.
//
//   Iron Pact         dieselpunk brutalism: riveted slabs, boilers and pistons in the open,
//                     chimneys with furnace-orange mouths, overbuilt guns
//   Meridian Alliance sleek high technology: white faceted hulls, thin cyan light strips,
//                     emitters, sensor fins, craft that ride on a cushion of light
//   Veil Collective   alien and organic: curved carapaces, uneven horns, violet crystals and
//                     parts that float clear of the hull or the base
//
// A sample set (see ../modelset.js): it models three rosters and five bases and leaves the
// rest to the shipped models. Original designs; team colour is kept to deliberate marking
// areas, and the glow colours belong to the faction, not the team.
import { Model } from '../iso.js';

const TAU = Math.PI * 2;

/** A Model whose boxes can be light sources ({ glow: true }), like its columns and tubes. */
class Lit extends Model {
  box(x0, x1, y0, y1, z0, z1, c, o = {}) {
    const s = super.box(x0, x1, y0, y1, z0, z1, c, o);
    if (o.glow) for (const f of s.faces) f.glow = true;
    return s;
  }
}

// Palettes.
const I = { iron: '#7a7262', lite: '#9a917d', dark: '#48443c', soot: '#1f1e1c', rust: '#96552f', copper: '#b56a3a', brick: '#8c5a43', gun: '#2a2c30', bore: '#0f1012', steel: '#9a9ea2', furnace: '#ff6a10', hot: '#ffb347' };
const A = { white: '#e4eaee', lite: '#f4f8fa', steel: '#aab6bf', dark: '#3d4852', tyre: '#20262b', glass: '#12202b', cyan: '#2a9dff', pale: '#86c6ff' };   // (the look warms every light: these are bluer than they appear)
const V = { cara: '#4a3a63', dark: '#2a2138', lite: '#6d5a8f', mid: '#5a4878', bone: '#d6cdbb', vio: '#7a3cff', hot: '#a274ff', vein: '#6a2cff' };
const SKIN_BOOT = '#1f1e1b';
const SW = [0, 1, 0, -1];                       // leg swing by walk frame

// ------------------------------------------------------------ shared shapes

/** Two legs in step, with boots. */
function legs(m, sw, col, boot, w) {
  m.box(sw * 2.2 - 1.1, sw * 2.2 + 1.1, -2.1 * w, -0.3, 0, 5.6, col);
  m.box(-sw * 2.2 - 1.1, -sw * 2.2 + 1.1, 0.3, 2.1 * w, 0, 5.6, col);
  m.box(sw * 2.2 - 1.3, sw * 2.2 + 1.8, -2.2 * w, -0.2, 0, 1.3, boot);
  m.box(-sw * 2.2 - 1.3, -sw * 2.2 + 1.8, 0.2, 2.2 * w, 0, 1.3, boot);
}

/** A crystal: two pyramids base to base, centred on (x, y), from z0 to z1, widest at `mid` of the way up. */
function crystal(m, x, y, r, z0, z1, c, n = 4, mid = 0.38, rot = 0) {
  const zm = z0 + (z1 - z0) * mid;
  m.cyl(x, y, 0.12 * r, z0, zm, c, { n, r1: r, glow: true, rot });
  m.cyl(x, y, r, zm, z1, c, { n, r1: 0.08 * r, glow: true, rot });
}

/** Wide tracks: a run with sloped ends on each side, wheel discs on its outer face, a fender over the top. */
function tracks(m, len, y0, y1, h, fender) {
  for (const s of [-1, 1]) {
    const a = Math.min(s * y0, s * y1), b = Math.max(s * y0, s * y1), out = s > 0 ? b : a;
    m.tag('tread');
    const t = m.profile([[-len, h * 0.45], [-len + 1.6, 0.2], [len - 2.4, 0.2], [len, h * 0.5], [len - 0.8, h], [-len + 0.6, h]], a, b, I.gun, { top: '#3a3f45' });
    m.tag('steel');
    const n = Math.max(4, Math.round(len / 3.2));
    for (let i = 0; i < n; i++) {
      const x = -len + 2.9 + i * ((2 * len - 6.4) / (n - 1));
      m.decal(t, Array.from({ length: 6 }, (_, k) => { const q = ((k + 0.5) / 6) * TAU; return [x + Math.cos(q) * h * 0.36, out, h * 0.44 + Math.sin(q) * h * 0.36]; }), '#5a5d60', [0, s, 0]);
    }
    m.tag('plating');
    m.box(-len - 0.5, len + 0.5, a - 0.3, b + 0.3, h, h + 0.9, fender);
  }
  m.tag(null);
}

/** A flat mark on side `i` of a column made with cyl(): u runs round the side (0..1), v up it (0..1). Follows a taper exactly. */
function mark(m, s, i, u0, u1, v0, v1, c, glow) {
  const f = s.faces[1 + i], [a, b, b1, a1] = f.p;
  const at = (u, v) => [0, 1, 2].map(k => (a[k] + (b[k] - a[k]) * u) * (1 - v) + (a1[k] + (b1[k] - a1[k]) * u) * v);
  m.decal(s, [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], c, f.n, glow);
}

/** A tapering limb from p0 to p1 ([x, y, z]); its rings stay level, so it can lean. Ribs, buttresses, pipes. */
function limb(m, p0, r0, p1, r1, c, n = 5, rot = 0, glow) {
  const ring = (p, r) => Array.from({ length: n }, (_, i) => { const a = rot + (i / n) * TAU; return [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r, p[2]]; });
  const lo = ring(p0, r0), hi = ring(p1, r1);
  const faces = [{ p: hi, c, glow }];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push({ p: [lo[i], lo[j], hi[j], hi[i]], c, glow }); }
  return m.solid(faces);
}

/** A chimney with a lit mouth. */
function chimney(m, x, y, r, z0, z1, body, n = 6) {
  m.cyl(x, y, r, z0, z1, body, { n, r1: r * 0.82 });
  m.cyl(x, y, r * 0.98, z1, z1 + 1.1, I.soot, { n });
  m.cyl(x, y, r * 0.62, z1 + 1.1, z1 + 1.5, I.furnace, { n: 5, glow: true });
}

/** A thin upright fin in the vertical plane at angle `a` from (cx, cy): out to r0 at the ground, up the mast from zb to zt at r1. */
function fin(m, cx, cy, a, r0, r1, z0, zb, zt, c) {
  const cs = Math.cos(a), sn = Math.sin(a), tx = -sn * 0.35, ty = cs * 0.35;
  const P = (r, z, s) => [cx + cs * r + tx * s, cy + sn * r + ty * s, z];
  const A0 = P(r0, z0, 1), B0 = P(r1, zb, 1), C0 = P(r1, zt, 1), A1 = P(r0, z0, -1), B1 = P(r1, zb, -1), C1 = P(r1, zt, -1);
  return m.solid([
    { p: [A0, B0, C0], c }, { p: [A1, B1, C1], c },
    { p: [A0, C0, C1, A1], c }, { p: [A0, B0, B1, A1], c }, { p: [B0, C0, C1, B1], c },
  ]);
}

/** A bar floating level at height z: centred on (x, y), `len` long across the direction `a`, as part of a ring. */
function arc(m, cx, cy, r, a, len, w, z0, z1, c, glow) {
  const cs = Math.cos(a), sn = Math.sin(a), x = cx + cs * r, y = cy + sn * r, hx = -sn * len / 2, hy = cs * len / 2, wx = cs * w / 2, wy = sn * w / 2;
  m.prism([[x - hx - wx, y - hy - wy], [x + hx - wx, y + hy - wy], [x + hx + wx, y + hy + wy], [x - hx + wx, y - hy + wy]], z0, z1, c, { glow });
}

// ============================================================ IRON PACT / bastion

// Conscript: a stoker in plate. Respirator, riveted pauldrons, a boiler pack with its own little chimney.
function conscript(m, tc, sw) {
  legs(m, sw, '#2b2925', SKIN_BOOT, 1.2);
  m.tag('plating');
  m.box(-2.2, 2.2, -3.2, 3.2, 5.6, 12.2, I.iron);
  m.box(-2.6, 2.6, -4.7, -2.8, 10.2, 13, tc.main);                    // pauldrons
  m.box(-2.6, 2.6, 2.8, 4.7, 10.2, 13, tc.main);
  m.tag(null);
  m.box(-2.3, 2.3, -3.3, 3.3, 7, 8, I.soot);                           // belt
  m.box(-1.4, 1.4, -1.4, 1.4, 12.2, 14.4, '#2a2826');                  // respirator
  m.cyl(0, 0, 2.7, 13.7, 16.2, I.dark, { n: 6, r1: 1.8, top: tc.main });
  m.box(1.2, 1.75, -1.2, 1.2, 13, 13.8, I.furnace, { glow: true });    // visor slit
  m.box(-4.8, -2.2, -2.5, 2.5, 6.2, 13, I.copper);                     // boiler pack
  m.cyl(-3.6, 1.3, 0.85, 13, 17.6, I.soot, { n: 5 });
  m.cyl(-3.6, 1.3, 0.6, 17.6, 18.1, I.furnace, { n: 5, glow: true });
  m.box(-5.1, -4.8, -1.5, 1.5, 7.6, 10.4, I.furnace, { glow: true });  // firebox grate
  m.tag('steel');
  m.box(1, 10.5, 1.9, 3.2, 8.7, 10.7, I.gun);                          // a heavy short rifle
  m.tag(null);
}

// Rhino: a boiler on tracks. Ram prow with teeth, firebox astern, a drum turret round one fat howitzer.
function rhinoHull(m, tc) {
  tracks(m, 13.5, 6.2, 11.6, 5.6, I.dark);
  m.tag('panel');
  const h = m.profile([[-13, 2.6], [12.8, 2.6], [15, 5.4], [9.5, 9.2], [-13, 9.2], [-14, 6]], -6.8, 6.8, I.iron, { top: I.lite });
  m.onTop(h, -3, 4.5, -6.5, -3.6, 9.2, tc.main);                       // team deck plates
  m.onTop(h, -3, 4.5, 3.6, 6.5, 9.2, tc.main);
  for (const x of [-12, -8, 6]) m.onTop(h, x, x + 0.5, -6.6, 6.6, 9.2, I.dark);   // riveted seams
  m.profile([[14.6, 0.8], [18.4, 0.8], [15.6, 7.6], [14.6, 7.6]], -9.2, 9.2, I.dark);   // ram prow
  m.tag('steel');
  for (const y of [-6.5, 0, 6.5]) m.box(17.4, 19.8, y - 1.2, y + 1.2, 0.8, 2.8, I.steel);   // teeth
  for (const s of [-1, 1]) {                                           // pistons along the fenders
    m.tubeX(-9, 6.5, s * 9, 7.7, 0.8, I.steel, { n: 5 });
    const blk = m.box(-11.5, -5.5, Math.min(s * 7.6, s * 10.6), Math.max(s * 7.6, s * 10.6), 6.5, 9.4, I.rust);
    m.onY(blk, -10.6, -6.4, 7.1, 8.8, s * 10.6, I.furnace, true, s);                   // firebox grille on each flank
  }
  m.tag('copper');
  m.tubeY(-6.2, 6.2, -11, 11.4, 3.2, I.copper, { n: 8, cap: I.rust });   // the boiler, across the stern
  m.tag(null);
  for (const y of [-4.4, 4.4]) chimney(m, -8.4, y, 1.5, 9.2, 18.4, I.soot);
  m.box(-14.7, -14.1, -3.2, 3.2, 3.4, 7.4, I.furnace, { glow: true });   // firebox door
  for (const y of [-4.6, 4.6]) m.box(13.7, 14.4, y - 0.9, y + 0.9, 6.1, 7.6, I.hot, { glow: true });   // lamps
}
function rhinoTurret(m, tc) {
  m.tag('panel');
  const d = m.cyl(0, 0, 7, 9.2, 14.6, I.iron, { n: 10, top: I.lite });
  for (const i of [1, 3, 6, 8]) mark(m, d, i, 0.25, 0.75, 0.1, 0.42, I.furnace, true);   // vents under the band
  m.cyl(0, 0, 7.25, 12, 13.6, tc.main, { n: 10 });                     // team band round the drum
  m.box(5.4, 9, -3.3, 3.3, 9.8, 14.2, I.dark);                         // mantlet
  m.cyl(-2, 2.6, 2.2, 14.6, 16.4, I.dark, { n: 6, top: I.steel });     // cupola
  m.tag('steel');
  m.tubeX(9, 18, 0, 12, 1.9, I.gun, { n: 8, cap: I.bore });            // the howitzer
  m.tubeX(16.6, 20.6, 0, 12, 2.7, I.dark, { n: 8, cap: I.bore });      // muzzle collar
  for (const y of [-2, 2]) m.tubeX(7.5, 13.5, y, 14.3, 0.6, I.steel, { n: 5 });   // recoil cylinders
  m.tag('copper');
  m.tubeY(-3.2, 3.2, -8, 11.6, 2.1, I.copper, { n: 6, cap: I.rust });  // bustle tank
  m.tag(null);
  m.box(-7.6, -7.1, -2.2, 2.2, 13.2, 14.3, I.furnace, { glow: true });   // vent over the tank
}

// Apocalypse: a furnace with two guns. Three chimneys over a glowing grate, a slab turret, a rocket rack for aircraft.
function apocalypseHull(m, tc) {
  tracks(m, 16.5, 7.6, 13.8, 6.6, I.dark);
  m.tag('panel');
  m.profile([[-16, 3], [15.5, 3], [18, 6], [12, 10.6], [-15.5, 10.6], [-17, 7]], -8.2, 8.2, I.iron, { top: I.lite });
  const c = m.prism([[-11, -7.2], [6, -7.2], [9, -4], [9, 4], [6, 7.2], [-11, 7.2]], 10.6, 13.4, I.dark, { top: I.iron });
  for (const x of [-9, -3, 3]) m.onTop(c, x, x + 0.5, -7, 7, 13.4, I.soot);
  for (const s of [-1, 1]) m.box(-5, 6, Math.min(s * 8.4, s * 13.9), Math.max(s * 8.4, s * 13.9), 7.5, 8.4, tc.main);   // team plates on the fenders
  m.profile([[17.6, 1], [21.2, 1], [18.6, 8.6], [17.6, 8.6]], -10.6, 10.6, I.dark);   // ram prow
  m.tag('steel');
  for (const y of [-8, -2.7, 2.7, 8]) m.box(20.2, 22.4, y - 1.1, y + 1.1, 1, 3, I.steel);
  m.tag('copper');
  for (const s of [-1, 1]) m.tubeX(-11, 9, s * 10.6, 9.6, 0.95, I.copper, { n: 5 });   // steam lines
  m.tag('plating');
  m.box(-18, -11.4, -6.6, 6.6, 10.6, 17.2, I.rust, { top: I.dark });   // the furnace
  m.tag(null);
  m.box(-18.5, -18, -4.6, 4.6, 11.6, 15.6, I.furnace, { glow: true });   // grate, astern
  for (const s of [-1, 1]) m.box(-17.2, -12.2, Math.min(s * 6.6, s * 7.1), Math.max(s * 6.6, s * 7.1), 11.6, 16, I.furnace, { glow: true });   // side vents
  for (const s of [-1, 1]) m.box(-9.5, 4, Math.min(s * 7.2, s * 7.5), Math.max(s * 7.2, s * 7.5), 11.3, 12.5, I.hot, { glow: true });       // a line of fire along the casemate
  chimney(m, -14.6, -4.4, 1.5, 17.2, 24, I.soot);
  chimney(m, -14.6, 0, 1.7, 17.2, 26.5, I.soot);
  chimney(m, -14.6, 4.4, 1.5, 17.2, 24, I.soot);
  for (const y of [-5.6, 5.6]) m.box(16.6, 17.3, y - 1, y + 1, 7, 8.7, I.hot, { glow: true });
}
function apocalypseTurret(m, tc) {
  m.tag('panel');
  const t = m.prism([[-8, -7.5], [4, -7.5], [8.5, -4], [8.5, 4], [4, 7.5], [-8, 7.5]], 13.4, 19.6, I.iron, { top: I.lite });
  m.onTop(t, -6.6, -1, -5.6, 5.6, 19.6, tc.main);                      // team roof plate
  for (const s of [-1, 1]) m.box(0.8, 7.6, Math.min(s * 7.5, s * 9.3), Math.max(s * 7.5, s * 9.3), 14, 19, I.dark);   // cheek slabs
  m.box(8, 11.2, -6.4, 6.4, 14, 19, I.dark);                           // mantlet
  m.cyl(1.6, 3.2, 2, 19.6, 21.4, I.dark, { n: 6, top: I.steel });
  m.box(-4.4, 1.8, -9.9, -7.5, 19, 22.4, I.dark);                      // rocket rack
  m.tag('steel');
  for (const y of [-3.4, 3.4]) {                                       // the twin guns
    m.tubeX(11.2, 21, y, 16.4, 1.75, I.gun, { n: 8, cap: I.bore });
    m.tubeX(19.4, 23.4, y, 16.4, 2.5, I.dark, { n: 8, cap: I.bore });
  }
  m.tag('copper');
  m.tubeY(-5.6, 5.6, -9.6, 16.6, 2.6, I.copper, { n: 8, cap: I.rust });   // bustle boiler
  m.tag(null);
  m.box(11.2, 11.7, -1.1, 1.1, 14.8, 18.2, I.furnace, { glow: true });   // breech glow between the guns
  for (const s of [-1, 1]) m.box(-6.5, -1, Math.min(s * 7.5, s * 7.8), Math.max(s * 7.5, s * 7.8), 15, 17.6, I.furnace, { glow: true });   // turret vents
  for (const z of [19.6, 21]) m.box(1.8, 2.3, -9.6, -7.8, z, z + 1.1, I.hot, { glow: true });   // rocket tips
  chimney(m, -6, 5.2, 1.1, 19.6, 24.4, I.soot, 5);
}

// Iron bases: a boiler house, a foundry, and a furnace tower that out-tops the street.
function ironBase(level, tc) {
  const m = new Lit();
  if (level === 1) {
    m.box(-17, 15, -15, 13, 0, 1.6, '#4f4c46');
    m.tag('plating');
    const h = m.box(-14, 12, -12, 10, 1.6, 11, I.iron);
    m.onY(h, -3, 3, 1.6, 7.6, 10, I.soot);                             // door
    m.onY(h, 5, 10, 4.2, 7.2, 10, I.furnace, true);                    // firelit windows
    m.onX(h, -8, -3, 4.2, 7.2, 12, I.furnace, true);
    m.onX(h, 2, 7, 3, 9.2, 12, tc.main);                               // banner
    m.onY(h, -11.5, -6.5, 3, 9.2, 10, tc.main);
    m.onY(h, -14, 12, 9.9, 10.4, 10, I.lite);                          // riveted eaves band
    m.onX(h, -12, 10, 9.9, 10.4, 12, I.lite);
    for (const [x, y] of [[-15.2, 8], [10.4, 8], [10.4, -13.2]]) m.box(x, x + 2.8, y, y + 3.2, 1.6, 8, I.dark);   // buttresses
    const r = m.box(-15, 13, -13, 11, 11, 12.6, I.dark, { top: I.iron });
    m.onTop(r, -13, -2, -11, -2, 12.6, tc.main);                       // team roof plate
    m.tag('copper');
    m.tubeX(-3, 10, 5, 15.3, 2.7, I.copper, { n: 8, cap: I.rust });    // boiler on the roof
    m.tag('brick');
    m.cyl(-9, 5, 3.1, 12.6, 25, I.brick, { n: 8, r1: 2.4 });           // the chimney
    m.tag(null);
    m.cyl(-9, 5, 2.9, 25, 26.2, I.soot, { n: 8 });
    m.cyl(-9, 5, 1.9, 26.2, 26.7, I.furnace, { n: 6, glow: true });
    m.box(8, 14, -15, -11, 1.6, 4.2, I.soot);                          // coal heap
    m.box(4.2, 5, 10, 10.8, 1.6, 8.6, I.dark);                         // lamp by the door
    m.box(3.8, 5.4, 9.8, 11.4, 8.6, 9.8, I.hot, { glow: true });
    return { model: m, top: 28 };
  }
  if (level === 2) {
    m.box(-22, 20, -20, 18, 0, 1.6, '#4f4c46');
    m.tag('plating');
    const h = m.box(-18, 8, -15, 10, 1.6, 14, I.iron);
    m.onY(h, -13, -3, 1.6, 9.4, 10, I.soot);                           // furnace mouth
    m.onY(h, -12, -4, 2.2, 8, 10, I.furnace, true);
    m.onX(h, -11, -6, 7.6, 10.6, 8, I.hot, true);
    m.onX(h, 0, 5, 7.6, 10.6, 8, I.hot, true);
    m.onY(h, -18, 8, 11.4, 13.2, 10, tc.main);                         // team band under the eaves
    m.onX(h, -15, 10, 11.4, 13.2, 8, tc.main);
    m.onY(h, 0.5, 6, 2.5, 9, 10, I.dark);                              // side door
    m.tag('corrugated');
    for (const [y0, y1] of [[-15, -6.7], [-6.7, 1.7], [1.7, 10]]) m.ridge(-18, 8, y0, y1, 14, 17.6, I.dark, { gable: I.iron });   // saw-tooth roof
    m.tag('copper');
    for (const y of [-11, -2]) m.cyl(14.5, y, 4, 1.6, 15.5, I.copper, { n: 8, top: I.rust });   // boiler tanks
    m.tubeY(-11, -2, 14.5, 16.4, 0.9, I.copper, { n: 5 });
    m.tag('brick');
    for (const y of [-11, -3]) m.cyl(-13, y, 3.3, 16, 36, I.brick, { n: 8, r1: 2.5 });   // twin chimneys
    m.tag(null);
    for (const y of [-11, -3]) { m.cyl(-13, y, 3, 36, 37.3, I.soot, { n: 8 }); m.cyl(-13, y, 2, 37.3, 37.8, I.furnace, { n: 6, glow: true }); }
    m.tag('steel');
    m.tubeX(8, 9.4, 1, 8, 4.8, I.dark, { n: 10, cap: I.steel });       // flywheel on the gable end
    m.box(9.4, 10, -6, 7, 11, 12, I.steel);                            // its beam
    // The furnace tower, begun: a riveted stump with the fire already showing.
    m.tag('plating');
    const t = m.cyl(11, 10, 7, 1.6, 21, I.iron, { n: 8, r1: 6, rot: Math.PI / 8, top: I.dark });
    for (const i of [7, 0, 1]) mark(m, t, i, 0.36, 0.64, 0.2, 0.86, I.furnace, true);
    m.cyl(11, 10, 6.6, 21, 22.4, I.dark, { n: 8, rot: Math.PI / 8 });
    m.tag(null);
    m.cyl(11, 10, 4.6, 22.4, 23, I.furnace, { n: 8, glow: true });
    return { model: m, top: 39 };
  }
  // Level 3: the furnace tower. Brick banded with iron, fire showing through it, a crown of chimneys.
  const R8 = Math.PI / 8;
  m.cyl(0, 0, 28, 0, 2.4, '#55524b', { n: 8, rot: R8, top: '#66635b' });
  m.tag('panel');
  const b = m.box(-21, 0, -20, 2, 2.4, 17, I.iron);
  m.onY(b, -17, -6, 2.4, 11, 2, I.soot);
  m.onY(b, -16, -7, 3, 9.6, 2, I.furnace, true);                       // foundry mouth
  m.onY(b, -21, 0, 14, 16.2, 2, tc.main);
  m.onX(b, -20, 2, 14, 16.2, 0, tc.main);
  m.onX(b, -16, -11, 6.5, 10.5, 0, I.hot, true);
  m.onX(b, -8, -3, 6.5, 10.5, 0, I.hot, true);
  const r = m.box(-22, 1, -21, 3, 17, 18.6, I.dark, { top: I.iron });
  m.onTop(r, -20, -12, -9, 1, 18.6, tc.main);
  m.tag('brick');
  for (const x of [-17, -8.5]) m.cyl(x, -15.5, 3.4, 18.6, 42, I.brick, { n: 8, r1: 2.5 });   // works chimneys
  m.tag(null);
  for (const x of [-17, -8.5]) { m.cyl(x, -15.5, 3, 42, 43.4, I.soot, { n: 8 }); m.cyl(x, -15.5, 2, 43.4, 43.9, I.furnace, { n: 6, glow: true }); }
  // The gun on the works roof: overbuilt, like everything else here.
  m.tag('panel');
  m.cyl(-11, -5, 5, 18.6, 20.4, I.dark, { n: 8 });
  const g = m.box(-15.5, -6.5, -9.5, -1, 20.4, 24.6, I.iron, { top: I.lite });
  m.onTop(g, -14, -8, -8, -2.5, 24.6, tc.main);
  m.tag('steel');
  m.tubeY(-1, 12, -11, 22.5, 1.7, I.gun, { n: 6, cap: I.bore });
  m.tubeY(9.6, 13.6, -11, 22.5, 2.4, I.dark, { n: 6, cap: I.bore });
  m.tag('copper');
  m.tubeX(-21, -6, 12, 7, 4.2, I.copper, { n: 8, cap: I.rust });       // boiler by the gate
  // The tower.
  const cx = 10.5, cy = 9.5;
  limb(m, [-6, 12, 7], 1.4, [cx - 8, cy + 1, 27], 1.2, I.copper, 5);   // steam main from the boiler up into the shaft
  limb(m, [1, -8, 18.6], 1.3, [cx - 5, cy - 6, 33], 1.1, I.copper, 5);
  m.tag('panel');
  const base = m.cyl(cx, cy, 13, 2.4, 15, I.iron, { n: 8, r1: 11, rot: R8, top: I.dark });
  for (const i of [7, 0, 1]) { mark(m, base, i, 0.26, 0.74, 0.12, 0.84, I.soot); mark(m, base, i, 0.32, 0.68, 0.16, 0.76, I.furnace, true); }   // tap holes
  m.cyl(cx, cy, 11.6, 15, 16.8, I.dark, { n: 8, rot: R8 });
  m.tag('brick');
  const sh = m.cyl(cx, cy, 10.2, 16.8, 57, I.brick, { n: 8, r1: 7.4, rot: R8 });
  for (const i of [7, 0, 1]) {                                         // the fire shows between the hoops, hotter toward the top
    mark(m, sh, i, 0.36, 0.64, 0.05, 0.3, I.furnace, true);
    mark(m, sh, i, 0.36, 0.64, 0.4, 0.64, I.furnace, true);
    mark(m, sh, i, 0.38, 0.62, 0.74, 0.95, I.hot, true);
  }
  mark(m, sh, 7, 0.06, 0.28, 0.4, 0.95, tc.main);                      // banners down two faces
  mark(m, sh, 1, 0.72, 0.94, 0.4, 0.95, tc.main);
  m.tag('panel');
  m.cyl(cx, cy, 9.6, 29.4, 31.4, I.dark, { n: 8, rot: R8, r1: 9.4 });  // iron hoops
  m.cyl(cx, cy, 8.6, 42.6, 44.6, I.dark, { n: 8, rot: R8, r1: 8.5 });
  m.cyl(cx, cy, 7.6, 57, 61, I.dark, { n: 8, rot: R8, r1: 10.6 });     // the crown flares out
  for (const a of [0.3, 2.2, 4.4]) limb(m, [cx + Math.cos(a) * 16, cy + Math.sin(a) * 16, 2.4], 1.9, [cx + Math.cos(a) * 9.4, cy + Math.sin(a) * 9.4, 27], 1.3, I.iron, 4, a);   // buttresses
  m.tag(null);
  m.cyl(cx, cy, 8.6, 61, 61.9, I.furnace, { n: 8, rot: R8, glow: true });   // crucible
  m.cyl(cx, cy, 3.6, 61.9, 71, I.hot, { n: 5, r1: 0.3, glow: true });       // the flame standing in it
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + 0.4;
    chimney(m, cx + Math.cos(a) * 8.8, cy + Math.sin(a) * 8.8, 1.7, 61, i % 2 ? 70 : 75, I.soot, 5);
  }
  return { model: m, top: 77 };
}

// ============================================================ MERIDIAN ALLIANCE / aegis

// Guardian: a sealed white suit, a visor of light, a launcher on the shoulder.
function guardian(m, tc, sw) {
  legs(m, sw, A.white, A.dark, 1);
  m.tag('panel');
  m.box(-1.7, 1.7, -2.6, 2.6, 5.6, 11.8, A.white);
  m.box(-1.9, 1.9, -3.5, -2.2, 10.2, 12.3, tc.main);                   // shoulder pads
  m.box(-1.9, 1.9, 2.2, 3.5, 10.2, 12.3, tc.main);
  m.cyl(0, 0, 1.95, 11.8, 14.7, A.lite, { n: 6, r1: 1.5, top: tc.main });
  m.tag(null);
  m.box(1.1, 1.8, -1.3, 1.3, 12.7, 13.5, A.cyan, { glow: true });      // visor
  m.box(1.7, 1.95, -0.45, 0.45, 7.4, 10.4, A.cyan, { glow: true });    // chest strip
  m.box(-3.1, -1.7, -1.8, 1.8, 7, 11.6, A.dark);                       // pack
  m.box(-2.9, -2.5, -0.2, 0.2, 11.6, 16.2, A.white);                   // aerial fin
  m.box(-3.05, -2.35, -0.35, 0.35, 16.2, 16.9, A.cyan, { glow: true });
  m.tag('plating');
  m.tubeX(-3.6, 6.6, 3.5, 13.3, 1.15, A.steel, { n: 6, cap: '#12161a' });   // launcher
  m.tag(null);
  m.tubeX(4.6, 5.3, 3.5, 13.3, 1.38, A.cyan, { n: 6, glow: true });
}

// Multifunction vehicle: a white wedge on six wheels, a line of light down each flank, a tool pod on top.
function ifvHull(m, tc) {
  for (const s of [-1, 1]) for (const x of [-8.6, 0, 8.6]) m.tubeY(Math.min(s * 6.6, s * 9.1), Math.max(s * 6.6, s * 9.1), x, 3, 3, A.tyre, { n: 8, cap: A.steel });
  m.tag('panel');
  const h = m.profile([[-12.5, 3], [11, 3], [14.6, 5.2], [9, 8.4], [2, 10.4], [-11, 10.4], [-13, 7]], -6.6, 6.6, A.white, { top: A.lite });
  m.onTop(h, -10, -3, -6.4, -3.6, 10.4, tc.main);                      // team panels
  m.onTop(h, -10, -3, 3.6, 6.4, 10.4, tc.main);
  for (const s of [-1, 1]) m.onY(h, -5, 3, 7.4, 9.4, s * 6.6, tc.main, false, s);
  for (const s of [-1, 1]) m.box(-12.8, 12.6, Math.min(s * 6.6, s * 9.4), Math.max(s * 6.6, s * 9.4), 5.7, 6.5, A.steel);   // wheel arches
  m.tag('glass');
  m.profile([[2.2, 10.4], [8.9, 8.5], [8.9, 9], [2.7, 11]], -4.7, 4.7, A.glass);   // windscreen
  m.tag('panel');
  m.profile([[-12.5, 10.4], [-7, 10.4], [-10.6, 15.6], [-12.5, 15.6]], -0.3, 0.3, A.white);   // sensor fin
  m.tag(null);
  for (const s of [-1, 1]) m.box(-11, 9.5, Math.min(s * 9.4, s * 9.65), Math.max(s * 9.4, s * 9.65), 5.85, 6.35, A.cyan, { glow: true });   // light strips
  m.box(-12.6, -11.4, -0.5, 0.5, 15.6, 16.4, A.cyan, { glow: true });
  m.box(-13.4, -13, -4, 4, 5, 6.6, A.cyan, { glow: true });            // drive glow astern
  for (const y of [-4.4, 4.4]) m.box(13.6, 14.2, y - 1, y + 1, 5.4, 6.3, A.pale, { glow: true });
}
function ifvTurret(m, tc) {
  m.tag('panel');
  m.prism([[-4.6, -3.7], [2.5, -3.7], [5, -1.7], [5, 1.7], [2.5, 3.7], [-4.6, 3.7]], 10.4, 13.2, A.white, { top: tc.main });   // pod, team roof
  m.tag('plating');
  for (const y of [-1.8, 1.8]) m.box(2, 13, y - 0.5, y + 0.5, 11.4, 12.6, A.steel);   // rails
  m.box(-4.2, -0.8, -5.4, -3.7, 10.8, 12.1, A.steel);                  // repair arm, folded
  m.cyl(-2, 0, 1.6, 13.2, 15, A.dark, { n: 6, r1: 1 });                // sensor
  m.tag(null);
  for (const y of [-1.8, 1.8]) m.box(13, 13.7, y - 0.55, y + 0.55, 11.5, 12.5, A.cyan, { glow: true });
  m.cyl(-2, 0, 0.75, 15, 15.6, A.cyan, { n: 5, glow: true });
  m.box(-0.8, -0.3, -5.2, -3.9, 11.1, 11.8, A.pale, { glow: true });   // torch tip
}

// Prism: a hull that floats on a pad of light and carries a crystal as tall as itself.
function prismHull(m, tc) {
  m.tag('panel');
  const h = m.profile([[-13, 2.2], [10, 2.2], [15, 4.6], [10, 7.6], [-12, 7.6], [-14.5, 5]], -7.4, 7.4, A.white, { top: A.lite });
  m.onTop(h, 3, 9.4, -5, 5, 7.6, tc.main);                             // team nose panel
  m.tag('plating');
  for (const s of [-1, 1]) {
    const p = m.profile([[-10, 3], [6, 3], [9.4, 4.6], [6, 6.2], [-10, 6.2]], Math.min(s * 7.4, s * 10.4), Math.max(s * 7.4, s * 10.4), A.steel, { top: tc.main });   // lift pods, team tops
    m.onY(p, -9, 5, 4.3, 4.9, s * 10.4, A.cyan, true, s);
    m.profile([[-14, 5], [-9, 7.6], [-12, 13.4], [-14.6, 13.4]], Math.min(s * 5, s * 5.5), Math.max(s * 5, s * 5.5), A.white);   // tail fins
  }
  m.cyl(0.5, 0, 5.6, 7.6, 9, A.dark, { n: 10 });                       // turret ring
  m.tag(null);
  m.box(-11.5, 11.5, -6.4, 6.4, 1.3, 2.2, A.cyan, { glow: true });     // the pad of light it rides on
  for (const y of [-5, 5]) m.box(-14.9, -14.3, y - 1.6, y + 1.6, 4, 6, A.cyan, { glow: true });
  m.box(14.4, 15.1, -2.4, 2.4, 4.2, 5, A.pale, { glow: true });
}
function prismTurret(m, tc) {
  m.tag('plating');
  for (let i = 0; i < 3; i++) {                                        // three claws hold the crystal
    const a = i * TAU / 3 + Math.PI, x = Math.cos(a) * 3.9, y = Math.sin(a) * 3.9;
    m.box(x - 0.7, x + 0.7, y - 0.7, y + 0.7, 9, 15.4, A.steel);
  }
  m.cyl(0, 0, 4.6, 15.2, 16.1, A.white, { n: 8, top: tc.main });       // focusing ring
  m.tubeX(2.4, 6.2, 0, 18, 1.2, A.steel, { n: 6, cap: A.dark });       // lens barrel
  m.tag(null);
  m.cyl(0, 0, 3.2, 10.4, 20, '#8fc8ff', { n: 6, r1: 2.5, glow: true });   // the prism
  m.cyl(0, 0, 2.5, 20, 24.4, '#c4e2ff', { n: 6, r1: 0.2, glow: true });
  m.box(6.2, 6.8, -0.8, 0.8, 17.2, 18.8, A.pale, { glow: true });
}

// Meridian level 3: a white platform ringed with light, and a beam spire wearing two floating halos.
function meridianBase(tc) {
  const m = new Lit();
  m.tag('plating');
  m.cyl(0, 0, 27.5, 0, 2, '#b9c2c9', { n: 12, top: '#d5dce1' });
  m.tag(null);
  m.cyl(0, 0, 24, 2, 2.3, A.cyan, { n: 12, glow: true });              // a ring of light let into the deck
  m.tag('plating');
  m.cyl(0, 0, 22.4, 2, 2.5, '#cfd6dc', { n: 12 });
  m.tag('panel');
  m.profile([[-21, 2.4], [-3, 2.4], [-3, 10], [-9, 15], [-21, 15]], -19, -3, A.white, { top: A.lite });   // hangar
  m.box(-19, -10, -17, -5, 15, 15.4, tc.main);                         // team roof panel
  m.box(-3.05, -2.85, -16.5, -5.5, 3.6, 9.2, A.dark);                  // hangar door
  const w = m.box(-20, -5, 3, 15, 2.4, 9, A.white, { top: A.lite });   // control wing
  m.onY(w, -18.5, -6.5, 5.6, 6.8, 15, A.cyan, true);
  m.onY(w, -20, -5, 7.6, 9, 15, tc.main);
  m.onX(w, 4.5, 13.5, 5.6, 6.8, -5, A.cyan, true);
  m.onTop(w, -18, -11, 5, 13, 9, tc.main);
  m.tag(null);
  m.box(-2.85, -2.5, -16.5, -5.5, 2.6, 3.4, A.cyan, { glow: true });   // threshold light
  // The spire.
  const cx = 8.5, cy = 7.5;
  m.tag('plating');
  m.cyl(cx, cy, 11.4, 2.4, 8, A.steel, { n: 6, r1: 7.8, top: A.lite });
  m.cyl(cx, cy, 8, 8, 9.6, A.dark, { n: 6 });
  m.tag('panel');
  const sh = m.cyl(cx, cy, 6.2, 9.6, 59, A.white, { n: 6, r1: 2.5 });
  for (const i of [5, 0, 1]) mark(m, sh, i, 0.38, 0.62, 0.03, 0.98, A.cyan, true);   // light strips up the faces toward the street
  mark(m, sh, 0, 0.04, 0.32, 0.05, 0.3, tc.main);
  mark(m, sh, 1, 0.68, 0.96, 0.05, 0.3, tc.main);
  for (const a of [0.5, 2.6, 4.2, 5.5]) fin(m, cx, cy, a, 15.5, 4.4, 2.4, 10, 38, A.white);   // buttress fins
  m.tag(null);
  for (let i = 0; i < 8; i++) arc(m, cx, cy, 12.6, i * TAU / 8 + 0.2, 8.2, 2.2, 38.6, 40.4, i % 2 ? A.cyan : A.lite, i % 2 === 1);   // lower halo
  for (let i = 0; i < 4; i++) arc(m, cx, cy, 7.6, i * TAU / 4 + 0.8, 8.4, 1.7, 50, 51.4, A.cyan, true);                             // upper halo
  crystal(m, cx, cy, 4.4, 61, 76, A.pale, 6, 0.4);                     // the emitter, clear of the tip
  // Pad lights and a sensor mast.
  for (const a of [0.9, 2.2, 3.6, 5.3]) { const x = Math.cos(a) * 25.6, y = Math.sin(a) * 25.6; m.box(x - 0.9, x + 0.9, y - 0.9, y + 0.9, 2, 3.4, A.pale, { glow: true }); }
  m.tag('plating');
  m.cyl(-12, 20, 0.9, 2.4, 14, A.steel, { n: 5 });
  m.cyl(-12, 20, 4.6, 14, 15.3, A.lite, { n: 8, r1: 5.8 });
  m.tag(null);
  return { model: m, top: 77 };
}

// ============================================================ VEIL COLLECTIVE / dominion

// Initiate: robed to the ground, masked, one horn longer than the other, a shard turning between its hands.
function initiate(m, tc, sw) {
  m.tag('cloth');
  m.cyl(sw * 0.7, 0, 3.7, 0, 9, V.cara, { n: 6, r1: 2.3 });            // the robe sways instead of legs striding
  m.cyl(0, 0, 2.4, 9, 15, V.mid, { n: 6, r1: 2.9 });
  m.tag(null);
  m.cyl(0, 0, 2.8, 10.5, 11.8, tc.main, { n: 6 });                     // team sash
  m.cyl(-2, 0, 2.6, 11, 17.6, V.dark, { n: 5, r1: 1.2 });              // carapace hump
  m.cyl(0.4, 0, 1.5, 15, 18.6, V.bone, { n: 5, r1: 1.1 });             // mask
  m.cyl(-0.6, -1.2, 0.9, 17.6, 23.6, V.dark, { n: 4, r1: 0.15 });      // the long horn
  m.cyl(-0.4, 1.3, 0.65, 17.6, 20.4, V.dark, { n: 4, r1: 0.1 });
  m.box(1.5, 1.95, -0.9, 0.9, 16.7, 17.3, V.vio, { glow: true });      // eyes
  m.box(0.8, 4.3, -2.7, -1.8, 12, 13.1, V.mid);                        // arms held forward
  m.box(0.8, 4.3, 1.8, 2.7, 12, 13.1, V.mid);
  crystal(m, 5.7, 0, 1.4, 11.4 + sw * 0.5, 16.2 + sw * 0.5, V.hot, 4, 0.4);
}

// Shenfeng: a beetle that rides on violet light. One lance horn, one short; shards trail above its back.
function shenfengHull(m, tc) {
  m.tag('plating');
  m.cyl(-2, 0, 11, 3, 6.2, V.dark, { n: 10, sy: 0.72, r1: 12.6 });
  m.cyl(-2, 0, 12.6, 6.2, 8.6, V.cara, { n: 10, sy: 0.72, r1: 9.2, top: tc.main });   // the team plate shows as a ring round the dome
  m.cyl(-3, 0, 8.4, 8.6, 11.8, V.lite, { n: 10, sy: 0.7, r1: 3.6, top: V.mid });
  m.tag(null);
  m.tubeX(8, 22.5, -3.2, 6.4, 1.6, V.bone, { n: 5, r1: 0.2 });         // lance horn
  m.tubeX(8, 15, 3.6, 6.2, 1.1, V.bone, { n: 5, r1: 0.15 });
  for (const s of [-1, 1]) m.tubeX(-20, -11.5, s * 2.6, 6, 0.15, V.cara, { n: 4, r1: 1 });   // tail spines
  m.cyl(-2, 0, 7, 1.7, 3, V.vio, { n: 8, sy: 0.7, glow: true });       // lift glow
  for (const y of [-1.5, 0.5]) m.box(8.7, 9.5, y, y + 1.1, 7.3, 8.3, V.vio, { glow: true });   // eyes, off centre
  crystal(m, -6, -2.2, 1.5, 14, 20, V.hot);
  crystal(m, -10, 2.6, 1.2, 13, 17.4, V.vio);
  crystal(m, -13.5, -0.6, 0.9, 12, 15.2, V.hot);
}
function shenfengTurret(m) {
  m.tag('plating');
  m.cyl(0, 0, 2.7, 8.6, 10.4, V.cara, { n: 6, r1: 2 });
  m.tag(null);
  for (const y of [-2.2, 2.2]) m.box(0.5, 6.2, y - 0.4, y + 0.4, 9.2, 10.3, V.bone);   // mandibles
  m.tubeX(1, 9.6, 0, 10.5, 1.5, V.hot, { n: 4, r1: 0.2, glow: true });                // crystal spike
}

// Flying disc: a horned crown in the air, a crystal hanging under it and shards circling it.
function discHull(m, tc) {
  m.tag('plating');
  m.cyl(0, 0, 5, 3, 6, V.dark, { n: 10, r1: 11.2 });
  m.cyl(0, 0, 11.8, 6, 7.4, tc.main, { n: 10 });                       // team rim
  m.cyl(0, 0, 11.2, 7.4, 10.6, V.cara, { n: 10, r1: 6.6, top: V.lite });
  m.cyl(0.6, 0, 6.6, 10.6, 13.6, V.mid, { n: 8, r1: 2.6 });
  m.tag(null);
  const horns = [[0.3, 6.5], [1.5, 3.4], [2.9, 8], [4.1, 4.4], [5.3, 5.6]];   // angle, length: no two alike
  for (const [a, len] of horns) {
    const cs = Math.cos(a), sn = Math.sin(a);
    m.cyl(cs * 10, sn * 10, 1.6, 7.4, 12, V.bone, { n: 4, r1: 1.05 });
    m.cyl(cs * 10.9, sn * 10.9, 1.05, 12, 12 + len, V.bone, { n: 4, r1: 0.1 });
  }
  m.cyl(0, 0, 0.3, -7.4, -1, V.hot, { n: 5, r1: 3.3, glow: true });    // the hanging crystal
  m.cyl(0, 0, 3.3, -1, 3, V.hot, { n: 5, r1: 2.7, glow: true });
  for (const a of [-0.5, 0.15, 0.8]) m.box(Math.cos(a) * 11.7 - 0.7, Math.cos(a) * 11.7 + 0.7, Math.sin(a) * 11.7 - 0.7, Math.sin(a) * 11.7 + 0.7, 6.2, 7.2, V.vio, { glow: true });   // eyes
}
function discTurret(m) {
  m.tag('plating');
  m.cyl(0, 0, 4.2, 0.4, 1.9, V.dark, { n: 8, r1: 5.3 });
  m.tag(null);
  const shards = [[0.2, 17, 2, 2.1], [1.9, 18.6, 5.5, 1.5], [3.4, 16.4, 0.5, 1.8], [4.9, 19, 4, 1.3]];   // angle, radius, height, size
  for (const [a, r, z, s] of shards) crystal(m, Math.cos(a) * r, Math.sin(a) * r, s, z, z + s * 3.6, a > 3 ? V.vio : V.hot);
}

// Veil level 3: a living mound, five ribs of bone curling in over it, and a crown of crystal that touches none of it.
function veilBase(tc) {
  const m = new Lit();
  m.cyl(0, 0, 27, 0, 1.6, V.dark, { n: 10, top: V.cara });
  m.tag('plating');
  const m1 = m.cyl(-1, -1, 20.5, 1.6, 9, V.cara, { n: 10, r1: 15, top: V.lite });
  for (const i of [0, 1, 2, 9]) mark(m, m1, i, 0.4, 0.6, 0.06, 0.94, V.vein, true);   // veins of light
  m.cyl(-0.5, -0.5, 14.4, 9, 16.4, V.cara, { n: 9, r1: 9.6, top: tc.main });          // the team membrane shows as a ring
  const m3 = m.cyl(0, 0, 9.2, 16.4, 24, V.mid, { n: 8, r1: 5.6, top: V.lite });
  for (const i of [0, 1, 7]) mark(m, m3, i, 0.36, 0.64, 0.08, 0.92, V.vein, true);
  m.tag(null);
  m.cyl(0, 0, 4.6, 24, 24.7, V.vio, { n: 8, glow: true });             // the maw
  for (const [x, y] of [[18.5, 6], [5, 20], [-18, 10]]) {              // egg sacs
    m.cyl(x, y, 4.4, 1.6, 7, V.dark, { n: 6, r1: 2.8 });
    m.cyl(x, y, 2.1, 7, 7.7, V.vio, { n: 6, glow: true });
  }
  // Ribs: each leans out, then curls in over the mound. No two the same height.
  const ribs = [[0.45, 50], [1.75, 64], [3.05, 44], [4.3, 58], [5.45, 38]];
  for (const [a, h] of ribs) {
    const cs = Math.cos(a), sn = Math.sin(a);
    const at = (r, z) => [cs * r, sn * r, z];
    const pts = [[22.5, 1.6, 3.4], [24.5, h * 0.3, 2.9], [22.5, h * 0.56, 2.3], [17.5, h * 0.78, 1.6], [11.5, h * 0.93, 0.9], [6.5, h, 0.12]];   // radius from the centre, height, thickness
    for (let k = 0; k + 1 < pts.length; k++) limb(m, at(pts[k][0], pts[k][1]), pts[k][2], at(pts[k + 1][0], pts[k + 1][1]), pts[k + 1][2], k === 1 ? tc.main : k >= 4 ? V.cara : V.bone, 5, a);   // the second joint carries the team colour
  }
  crystal(m, 0, 0, 7.6, 34, 76, V.hot, 6, 0.36);                       // the crown crystal, floating
  const shards = [[0.9, 13.5, 30, 2.4], [2.7, 15, 46, 1.9], [4.3, 12.5, 34, 2.2], [5.6, 14.5, 52, 1.7]];
  for (const [a, r, z, s] of shards) crystal(m, Math.cos(a) * r, Math.sin(a) * r, s, z, z + s * 4.2, V.vio, 4, 0.4, a);
  return { model: m, top: 77 };
}

// ============================================================ the set

const UNITS = {
  'iron|bastion|2': { hull: rhinoHull, turret: rhinoTurret, spec: { pivot: -1, muzzle: 20.6, mz: 12 } },
  'iron|bastion|3': { hull: apocalypseHull, turret: apocalypseTurret, spec: { pivot: -1.5, muzzle: 23.4, mz: 16.4, barrels: [-3.4, 3.4], foot: [18.5, 14] } },
  'meridian|aegis|2': { hull: ifvHull, turret: ifvTurret, spec: { pivot: 1, muzzle: 13.7, mz: 12 } },
  'meridian|aegis|3': { hull: prismHull, turret: prismTurret, spec: { kind: 'hover', hover: 2.4, bob: 0.7, pivot: 0.5, muzzle: 3, mz: 21, glow: [0, 20, 5.5], foot: [14.5, 10.4] } },
  'veil|dominion|2': { hull: shenfengHull, turret: shenfengTurret, spec: { pivot: 4, muzzle: 9.6, mz: 10.5, hover: 2.6, bob: 0.9, glow: [8.8, 10.5, 2.6] } },
  'veil|dominion|3': { hull: discHull, turret: discTurret, spec: { pivot: 0, muzzle: 0, mz: -5, hover: 36, bob: 1.3, drift: 1.6, spin: 1.4, glow: [0, -3, 6], foot: [19, 19] } },
};
const SOLDIERS = { 'iron|bastion': conscript, 'meridian|aegis': guardian, 'veil|dominion': initiate };

const cache = new Map();
/** Models are built once per key and shared: callers must not modify them. */
function once(key, build) {
  let m = cache.get(key);
  if (m === undefined) { m = build(); cache.set(key, m); }
  return m;
}
function unitPart(part, f, sub, tier, tc) {
  const u = UNITS[`${f}|${sub}|${tier}`];
  if (!u) return null;
  return once(`${part}|${f}|${sub}|${tier}|${tc.id}`, () => { const m = new Lit(); u[part](m, tc); m.tag(null); return m; });
}

export default {
  id: 'c',
  label: 'Faction sci-fi',
  unitScale: 1.4,

  soldier(f, sub, tc, frame) {
    const fig = SOLDIERS[`${f}|${sub}`];
    if (!fig) return null;
    return once(`s|${f}|${sub}|${tc.id}|${frame & 3}`, () => { const m = new Lit(); fig(m, tc, SW[frame & 3]); m.tag(null); return m; });
  },
  hull(f, sub, tier, tc) { return unitPart('hull', f, sub, tier, tc); },
  turret(f, sub, tier, tc) { return unitPart('turret', f, sub, tier, tc); },
  spec(f, sub, tier) {
    const u = UNITS[`${f}|${sub}|${tier}`];
    return u ? u.spec : null;
  },
  base(f, sub, level, tc) {
    if (f === 'iron') return once(`b|iron|${level}|${tc.id}`, () => ironBase(level, tc));
    if (f === 'meridian' && level === 3) return once(`b|meridian|${tc.id}`, () => meridianBase(tc));
    if (f === 'veil' && level === 3) return once(`b|veil|${tc.id}`, () => veilBase(tc));
    return null;
  },
};
