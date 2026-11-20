// Model set B: hard-surface realism.
//
// Scale-model military hardware. Vehicles have believable proportions (long, low hulls, proper
// running gear, engine decks, hatches, stowage, mantlets, muzzle brakes); infantry carry webbing,
// packs and their weapons; bases are working installations of several distinct buildings that
// grow with level. Paint is muted and factional (Iron Pact dark olive, Meridian Alliance pale
// grey, Veil Collective violet-black) and the team colour is carried by stripes, turret bands,
// flags, pennants and roof markings rather than by whole panels.
//
// A sample set: three rosters and five bases (see `default` at the bottom); everything else
// falls back to the shipped models. Original designs. Loaded with ?models=b (see modelset.js).
import { Model } from '../iso.js';

const TAU = Math.PI * 2;
const BORE = '#0e0f11', RUBBER = '#1b1c1e', TREAD = '#2a2c2e', GUNMETAL = '#33373b', BOOT = '#1f211c', SKIN = '#cfa583';
const GLASS = '#1d2630', LIT = '#ffe2a0', WOOD = '#6d573c', CANVAS = '#6f6a4e', HAZ = '#d8a521', WHITE = '#e6e8e6';

const PAL = {
  // Dark olive over steel: heavy industry.
  iron: { hull: '#5c634b', dark: '#41473a', lite: '#778063', metal: '#26282a', steel: '#596067', wall: '#77766a', wallD: '#5b5a50', roof: '#474c3c' },
  // Pale grey: precision engineering.
  meridian: { hull: '#a9b1b7', dark: '#737d85', lite: '#cbd2d7', metal: '#343a40', steel: '#69727a', wall: '#c3c8cb', wallD: '#8e969c', roof: '#7e878e', glow: '#c9f1ff' },
  // Violet-black machinery.
  veil: { hull: '#4c4361', dark: '#2e2839', lite: '#6f6289', metal: '#1c1922', steel: '#7f7b8b', wall: '#4d4460', wallD: '#352e42', roof: '#27212f', glow: '#e3b4ff' },
};

/** A Model whose boxes can be light sources ({ glow: true }), like its columns and tubes. */
class U extends Model {
  box(x0, x1, y0, y1, z0, z1, c, o = {}) {
    const s = super.box(x0, x1, y0, y1, z0, z1, c, o);
    if (o.glow) for (const f of s.faces) f.glow = true;
    return s;
  }
}

// ------------------------------------------------------------ shared details

/** A flat marking on any upward face (deck, glacis, roof slope): `pts` are its corners, in order. */
function mark(m, s, pts, c, glow) {
  const [a, b, d] = pts;
  let nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]);
  let ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
  let nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const l = Math.hypot(nx, ny, nz) || 1;
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  nx /= l; ny /= l; nz /= l;
  m.decal(s, pts.map(p => [p[0] + nx * 0.03, p[1] + ny * 0.03, p[2] + nz * 0.03]), c, [nx, ny, nz], glow);
}

/** A rectangle on a deck that slopes along x from (xa, za) to (xb, zb): x0..x1 across y0..y1. */
function onSlope(m, s, [xa, za], [xb, zb], x0, x1, y0, y1, c, glow) {
  const z = x => za + ((x - xa) / (xb - xa)) * (zb - za);
  mark(m, s, [[x0, y0, z(x0)], [x1, y0, z(x1)], [x1, y1, z(x1)], [x0, y1, z(x0)]], c, glow);
}

/** A round marking on a flat top: a fan grille, a hatch, a helipad. */
function disc(m, s, x, y, z, r, c, n = 8, glow) {
  m.decal(s, Array.from({ length: n }, (_, i) => { const a = ((i + 0.5) / n) * TAU; return [x + Math.cos(a) * r, y + Math.sin(a) * r, z + 0.03]; }), c, [0, 0, 1], glow);
}

/** A wheel painted on the outer face (y = `out`, facing side `s`) of a track or hull side. */
function wheel(m, solid, x, out, z, r, c, s, n = 8) {
  m.decal(solid, Array.from({ length: n }, (_, i) => { const a = ((i + 0.5) / n) * TAU; return [x + Math.cos(a) * r, out, z + Math.sin(a) * r]; }), c, [0, s, 0]);
}

/**
 * Running gear: on each side a track with sloped front and rear runs, road wheels with hubs,
 * a drive sprocket at the back and an idler at the front, and a fender with a drooping mudguard.
 */
function gear(m, len, yIn, yOut, h, P, n = 6) {
  for (const s of [-1, 1]) {
    const a = Math.min(s * yIn, s * yOut), b = Math.max(s * yIn, s * yOut), out = s > 0 ? b : a;
    m.tag('tread');
    const t = m.profile([[-len, h * 0.52], [-len + 1.9, 0.2], [len - 2.8, 0.2], [len, h * 0.58], [len - 1.1, h], [-len + 0.9, h]], a, b, TREAD, { top: '#3a3e42' });
    m.tag('steel');
    const at = i => -len + 3.1 + i * ((2 * len - 7) / (n - 1));
    for (let i = 0; i < n; i++) { wheel(m, t, at(i), out, h * 0.4, h * 0.37, P.steel, s); wheel(m, t, at(i), out + s * 0.02, h * 0.4, h * 0.13, P.metal, s, 6); }
    wheel(m, t, len - 1.5, out, h * 0.63, h * 0.26, '#3d4349', s);          // idler
    wheel(m, t, -len + 1.6, out, h * 0.6, h * 0.3, '#3d4349', s);           // drive sprocket
    m.tag(null);
    const f = m.box(-len - 0.3, len - 1.6, a - 0.3, b + 0.3, h, h + 0.7, P.dark, { top: P.hull });   // fender
    m.profile([[len - 1.6, h], [len - 1.6, h + 0.7], [len + 0.5, h * 0.72], [len + 0.5, h * 0.6]], a - 0.3, b + 0.3, P.dark);   // front mudguard
    f.side = s;
  }
}

/** A gun along x: barrel, and optionally a thermal sleeve, a fume extractor and a muzzle brake. */
function gun(m, x0, x1, y, z, r, c, o = {}) {
  const was = m.tag('steel'), L = x1 - x0;
  m.tubeX(x0, x1, y, z, r, c, { n: 6, cap: BORE });
  if (o.sleeve) m.tubeX(x0 + L * 0.1, x0 + L * 0.42, y, z, r * 1.3, GUNMETAL, { n: 6 });
  if (o.evac) m.tubeX(x0 + L * 0.5, x0 + L * 0.66, y, z, r * 1.6, GUNMETAL, { n: 6 });
  if (o.brake) m.tubeX(x1 - o.brake, x1 + 0.8, y, z, r * 1.6, GUNMETAL, { n: 6, cap: BORE });
  m.tag(was);
}

/** A whip aerial, with a pennant in the team colour if `tc` is given. */
function whip(m, x, y, z0, z1, tc) {
  m.box(x - 0.16, x + 0.16, y - 0.16, y + 0.16, z0, z1, '#141618');
  if (tc) m.box(x - 2.6, x - 0.16, y - 0.1, y + 0.1, z1 - 2.2, z1 - 0.4, tc.main);
}

// ============================================================ IRON PACT / bastion

// Rhino: the line tank. A long low hull with a sharp glacis, skirts over six road wheels,
// drums across the stern, and a wedge turret carrying one long gun with a fume extractor.
function rhinoHull(tc) {
  const m = new U(), P = PAL.iron;
  gear(m, 14, 5.4, 8.8, 4.6, P, 6);
  const h = m.profile([[-13.8, 2], [12.6, 2], [14.8, 4.4], [8.6, 7.4], [-12.6, 7.4], [-14.2, 5.2]], -5.4, 5.4, P.hull, { top: P.lite });
  const G0 = [14.8, 4.4], G1 = [8.6, 7.4];                               // the glacis
  onSlope(m, h, G0, G1, 9.4, 13.8, -4.8, -2.6, tc.main);                 // team bars either side of the driver
  onSlope(m, h, G0, G1, 9.4, 13.8, 2.6, 4.8, tc.main);
  onSlope(m, h, G0, G1, 9.8, 12.2, -1.3, 1.3, P.dark);                   // driver's hatch
  onSlope(m, h, G0, G1, 12.9, 14.3, -4.6, 4.6, TREAD);                   // spare track links across the nose
  m.onTop(h, -12.2, -9, -4.6, -0.5, 7.4, '#232524');                     // engine grilles
  m.onTop(h, -12.2, -9, 0.5, 4.6, 7.4, '#232524');
  for (const x of [-11.4, -10.2]) { m.onTop(h, x, x + 0.5, -4.4, -0.7, 7.4, P.steel); m.onTop(h, x, x + 0.5, 0.7, 4.4, 7.4, P.steel); }
  for (const s of [-1, 1]) {
    const y0 = Math.min(s * 8.8, s * 9.5), y1 = Math.max(s * 8.8, s * 9.5);
    const sk = m.box(-13, 11.6, y0, y1, 2.2, 5, P.dark);                // side skirt, in three bolted plates
    for (const x of [-4.9, 3.3]) m.onY(sk, x, x + 0.35, 2.2, 5, s * 9.5, P.metal, false, s);
    m.onY(sk, -4.2, 3, 3.1, 4.3, s * 9.5, tc.main, false, s);           // team flash
    m.box(12.6, 13.6, s * 3.4 - 0.9, s * 3.4 + 0.9, 5, 6.3, '#d8d5c3');   // headlamp
  }
  const bin = m.box(-6.5, 3, 6.3, 9, 5.3, 6.9, P.dark, { top: P.hull });   // stowage bin on the right fender
  m.onTop(bin, -1.9, -1.5, 6.3, 9, 6.9, P.metal);
  m.tag('steel');
  m.tubeX(-8, 4.5, -7.7, 6, 0.75, WOOD, { n: 5 });                        // unditching log on the left
  m.box(-13.6, -9.8, 6.2, 8.8, 5.3, 6.7, GUNMETAL);                      // exhaust muffler
  for (const [y0, y1] of [[-5.2, -0.4], [0.4, 5.2]]) m.tubeY(y0, y1, -15.3, 6.1, 1.5, '#4a4f3e', { n: 6, cap: '#33372b' });   // fuel drums
  m.tag(null);
  m.box(6.4, 7.6, -1.1, 1.1, 7.4, 8.1, P.metal);                         // driver's periscope
  for (const y of [-3.6, 3.6]) disc(m, h, -8, y, 7.4, 0.8, P.metal, 6);  // fuel fillers
  m.tag('tread');
  const links = m.box(-3, 2.6, -9, -6.4, 5.3, 6, TREAD);                 // spare track links on the left fender
  m.tag(null);
  for (const x of [-1.9, -0.6, 0.7]) m.onTop(links, x, x + 0.3, -9, -6.4, 6, P.steel);
  return m;
}

function rhinoTurret(tc) {
  const m = new U(), P = PAL.iron;
  const t = m.profile([[-7.6, 7.6], [5.6, 7.6], [8.2, 9.2], [5, 11.6], [-6.8, 11.6], [-8.2, 10]], -5.2, 5.2, P.hull, { top: P.lite });
  m.onTop(t, -6.4, -4.9, -5.2, 5.2, 11.6, tc.main);                      // team band over the roof
  m.onTop(t, -2.8, 0.6, -4.2, -1.2, 11.6, P.dark);                       // loader's hatch
  for (const s of [-1, 1]) {
    const y0 = Math.min(s * 5.2, s * 6.5), y1 = Math.max(s * 5.2, s * 6.5);
    const c = m.box(-6, 3.4, y0, y1, 8.2, 10.8, P.dark, { top: P.hull });   // side armour and stowage
    m.onY(c, -5.6, -3.8, 8.2, 10.8, s * 6.5, tc.main, false, s);           // turret band
    m.onY(c, -3.5, -3.1, 8.2, 10.8, s * 6.5, WHITE, false, s);
    m.box(3.8, 5.6, y0, y1 - s * 0.2, 9.4, 10.6, GUNMETAL);                // smoke dischargers
  }
  m.box(-11.2, -8.2, -4.6, 4.6, 8.6, 10.9, '#3a3d33');                   // bustle rack
  m.tag('cloth');
  m.tubeY(-4.2, 4.2, -9.7, 11.5, 0.95, CANVAS, { n: 5 });                // rolled tarpaulin
  m.tag(null);
  m.box(7.4, 9.6, -2.3, 2.3, 8.5, 11, P.dark);                           // mantlet
  gun(m, 9.6, 22.4, 0, 9.9, 0.95, P.metal, { evac: true, brake: 2 });
  m.cyl(-1.4, 2.5, 2, 11.6, 12.7, P.dark, { n: 6, top: P.metal });       // commander's cupola
  m.tag('steel');
  m.box(-0.8, 4.4, 2.2, 2.75, 12.9, 13.45, GUNMETAL);                    // cupola machine gun
  m.tag(null);
  m.box(3, 4.5, -3.5, -2, 11.6, 13, P.metal);                            // gunner's sight
  m.cyl(-4, 0.4, 1, 11.6, 12.3, P.metal, { n: 6 });                      // ventilator
  for (const y of [-4.6, 2.2]) m.onTop(t, 1.6, 4.6, y, y + 2.4, 11.6, '#484e3a');   // roof armour tiles
  whip(m, -7, -3.8, 11.6, 21.5, tc);
  return m;
}

// Apocalypse: the breakthrough tank. Longer, wider and lower-slung than the Rhino, hung with
// armour tiles, two stacks at the stern and two guns side by side in a slab turret; a small
// anti-aircraft mount rides on the turret roof.
function apocalypseHull(tc) {
  const m = new U(), P = PAL.iron;
  gear(m, 16.5, 6.4, 10.6, 5.4, P, 7);
  const h = m.profile([[-16, 2.4], [14.8, 2.4], [17.4, 5], [10.6, 8.8], [-14.8, 8.8], [-16.6, 6.2]], -6.4, 6.4, P.hull, { top: P.lite });
  const G0 = [17.4, 5], G1 = [10.6, 8.8];
  for (const y of [-5.6, -2.6, 0.4, 3.4]) onSlope(m, h, G0, G1, 12, 16.4, y, y + 2.2, '#484e3a');   // glacis armour tiles
  onSlope(m, h, G0, G1, 10.9, 11.7, -6.4, 6.4, tc.main);                 // team band at the top of the glacis
  for (const y of [-3.1, 3.1]) { disc(m, h, -12.4, y, 8.8, 2.3, '#1f2120'); disc(m, h, -12.4, y, 8.8, 0.8, P.steel, 6); }   // radiator fans
  m.onTop(h, -9.6, -8.9, -5.6, 5.6, 8.8, P.dark);                        // engine deck seam
  for (const s of [-1, 1]) {
    const y0 = Math.min(s * 10.6, s * 11.6), y1 = Math.max(s * 10.6, s * 11.6);
    const sk = m.box(-15.4, 14.2, y0, y1, 1.8, 6, P.dark);              // heavy skirt hung with armour tiles
    for (let i = 0; i < 6; i++) m.onY(sk, -14.6 + i * 4.8, -10.6 + i * 4.8, 2.4, 5.4, s * 11.6, i === 2 || i === 3 ? tc.main : '#484e3a', false, s);
    m.cyl(-15.4, s * 5, 1.5, 6.2, 12, P.metal, { n: 6, top: BORE });    // exhaust stack
    m.box(-16.4, -14.4, s * 5 - 1.9, s * 5 + 1.9, 6.8, 9.4, GUNMETAL);  // heat shield
    const bin = m.box(-8, 6, Math.min(s * 7.4, s * 10.8), Math.max(s * 7.4, s * 10.8), 6.1, 7.6, P.dark, { top: P.hull });   // fender stowage
    for (const x of [-3.4, 1.2]) m.onTop(bin, x, x + 0.4, Math.min(s * 7.4, s * 10.8), Math.max(s * 7.4, s * 10.8), 7.6, P.metal);
    m.box(15, 16.2, s * 4.2 - 1, s * 4.2 + 1, 5.6, 7, '#d8d5c3');       // headlamp
  }
  m.profile([[17.2, 1.2], [19.2, 1.2], [18.4, 4.6], [17.2, 5]], -8.6, 8.6, P.dark);   // lower nose plate
  m.tag('steel');
  m.tubeX(-7, 7, 0, 9.1, 0.5, '#2b2e30', { n: 5 });                      // tow cable down the deck
  m.tag(null);
  return m;
}

function apocalypseTurret(tc) {
  const m = new U(), P = PAL.iron;
  const t = m.profile([[-9.4, 9], [6.6, 9], [9.6, 10.8], [6, 13.6], [-8.6, 13.6], [-10, 11.8]], -7, 7, P.hull, { top: P.lite });
  m.onTop(t, 2.6, 4.4, -7, 7, 13.6, tc.main);                            // team band ahead of the hatches
  m.onTop(t, -1.6, 1.6, 1.6, 5, 13.6, P.dark);                           // hatches
  for (const s of [-1, 1]) {
    const y0 = Math.min(s * 7, s * 8.5), y1 = Math.max(s * 7, s * 8.5);
    const c = m.box(-7.8, 4.2, y0, y1, 9.6, 12.8, P.dark, { top: P.hull });   // side armour modules
    for (let i = 0; i < 3; i++) m.onY(c, -7.2 + i * 3.9, -4 + i * 3.9, 10, 12.4, s * 8.5, i === 0 ? tc.main : '#484e3a', false, s);
    gun(m, 11.2, 24.4, s * 2.6, 11.3, 1.05, P.metal, { sleeve: true, brake: 2.2 });   // one of the pair
  }
  m.box(-13.4, -10, -5.8, 5.8, 9.8, 13, '#3a3d33');                      // bustle
  m.box(9, 11.4, -5, 5, 9.7, 13, P.dark);                                // wide mantlet for both guns
  m.cyl(-2.6, -3.4, 2.1, 13.6, 14.8, P.dark, { n: 6, top: P.metal });    // cupola
  // Anti-aircraft mount on the rear roof: a pedestal, a twin launcher box and a tracking dish.
  m.box(-8.2, -5.4, 0.6, 4.4, 13.6, 14.6, P.metal);
  const aa = m.box(-8.6, -4.2, 1, 4, 14.6, 16.6, P.dark, { top: P.hull });
  m.onX(aa, 1.3, 2.3, 15, 16.2, -4.2, BORE); m.onX(aa, 2.7, 3.7, 15, 16.2, -4.2, BORE);
  m.cyl(-7.4, -1.6, 1.5, 14.8, 15.6, P.steel, { n: 6, r1: 2.3 });
  m.box(3.6, 5.2, -5, -3.4, 13.6, 15, P.metal);                          // gunner's sight
  whip(m, -9, -5.4, 13.6, 24, tc);
  whip(m, -9, 5.4, 13.6, 21);
  return m;
}

// ============================================================ MERIDIAN ALLIANCE / aegis

// Multifunction vehicle: an eight-wheeled armoured carrier with a wedge nose, hatches down the
// roof, a folded recovery jib on the rear deck and an unmanned gun-and-missile station.
function ifvHull(tc) {
  const m = new U(), P = PAL.meridian;
  const h = m.profile([[-13.6, 2.8], [11.4, 2.8], [14.8, 5], [7.4, 8.6], [-13.2, 8.6], [-13.9, 6]], -6.2, 6.2, P.hull, { top: P.lite });
  const G0 = [14.8, 5], G1 = [7.4, 8.6];
  onSlope(m, h, G0, G1, 8.4, 13.6, -5.4, 5.4, P.dark);                   // trim vane folded on the nose
  onSlope(m, h, G0, G1, 9.2, 10.4, -5.4, 5.4, tc.main);                  // team stripe across it
  m.onTop(h, 3.6, 6.6, -4.6, -1.8, 8.6, P.dark);                         // driver's and commander's hatches
  m.onTop(h, 3.6, 6.6, 1.2, 5, 8.6, '#2a2f34');                          // engine grille
  for (const x of [4.2, 5.2, 6.2]) m.onTop(h, x, x + 0.4, 1.4, 4.8, 8.6, P.steel);
  m.onTop(h, -12.4, -5.6, -4.8, -0.6, 8.6, P.hull);                      // rear roof hatches
  m.onTop(h, -12.4, -5.6, 0.6, 4.8, 8.6, P.hull);
  m.onTop(h, -5.2, -4.2, -6.2, 6.2, 8.6, tc.main);                       // team band across the roof
  m.onTop(h, -3.9, -3.5, -6.2, 6.2, 8.6, WHITE);
  for (const s of [-1, 1]) {
    const y0 = Math.min(s * 6.2, s * 8.2), y1 = Math.max(s * 6.2, s * 8.2);
    m.tag('dark');
    const out = s > 0 ? y1 : y0;
    for (const x of [-9.8, -4.2, 2.6, 8.2]) {                             // four axles
      const w = m.tubeY(y0, y1, x, 2.7, 2.7, RUBBER, { n: 8, cap: '#26282b' });
      wheel(m, w, x, out + s * 0.03, 2.7, 1.5, P.lite, s, 6);
    }
    m.tag(null);
    const f = m.box(-12.6, 11.4, y0, y1 + s * 0.2, 5.3, 6, P.dark, { top: P.hull });   // wheel-arch shelf
    m.onY(f, -12.6, 11.4, 5.3, 6, s > 0 ? y1 + 0.2 : y0, P.dark, false, s);
    m.box(13, 14, s * 4.2 - 0.9, s * 4.2 + 0.9, 5.4, 6.6, '#e3e6e1');   // headlamp
  }
  for (const s of [-1, 1]) {
    m.onY(h, -11.6, -3.2, 6.3, 8.2, s * 6.2, P.dark, false, s);           // bolt-on side armour
    m.onY(h, -7.6, -7.2, 6.3, 8.2, s * 6.2, P.hull, false, s);
    m.onY(h, -1.8, 1.4, 6.6, 7.8, s * 6.2, tc.main, false, s);            // team panel on the side
  }
  for (const x of [0.2, 1.6, 3]) m.onTop(h, x, x + 0.9, -5.8, -5, 8.6, GLASS);   // periscopes along the roof edge
  // Recovery gear on the rear deck: pedestal, folded jib, winch and a crate of spares.
  m.box(-11.6, -9.6, 2.6, 4.8, 8.6, 10.2, P.dark);
  const jib = m.box(-10.6, -1.4, 3.2, 4.2, 10.2, 11.1, HAZ);
  for (const x of [-8.6, -6, -3.4]) m.onTop(jib, x, x + 0.7, 3.2, 4.2, 11.1, '#1c1d1f');
  m.box(-11.4, -7.6, -4.8, -1.6, 8.6, 10.4, '#7d8f6d', { top: '#8c9e7b' });
  m.tag('steel');
  m.tubeY(-2.4, 2.4, 14.3, 4.2, 0.9, GUNMETAL, { n: 5 });                // winch across the nose
  m.box(-13.2, -11, -6.2, -5.4, 6.4, 8.2, GUNMETAL);                     // exhaust
  m.tag(null);
  whip(m, -12.2, 5.2, 8.6, 18.5, tc);
  return m;
}

function ifvTurret(tc) {
  const m = new U(), P = PAL.meridian;
  const t = m.prism([[-4.6, -3.8], [2.6, -3.8], [4.6, -2], [4.6, 2], [2.6, 3.8], [-4.6, 3.8]], 8.6, 11.2, P.hull, { top: P.lite });
  m.onTop(t, -4.2, -2.8, -3.8, 3.8, 11.2, tc.main);                      // team band
  m.tag('steel');
  m.tubeX(4.6, 13.2, 0, 10.1, 0.6, P.metal, { n: 5, cap: BORE });        // autocannon
  m.tubeX(11.4, 13.6, 0, 10.1, 0.95, GUNMETAL, { n: 5, cap: BORE });
  m.tag(null);
  m.box(0.6, 4.2, -5, -3.8, 9.2, 10.8, P.dark);                          // ammunition feed
  for (const s of [-1, 1]) {                                             // anti-aircraft missile pods
    const y0 = Math.min(s * 3.8, s * 5.8), y1 = Math.max(s * 3.8, s * 5.8);
    const pod = m.box(-3.4, 1.6, y0 + (s < 0 ? -1.2 : 0), y1 + (s > 0 ? 1.2 : 0), 10, 12.2, P.dark, { top: P.hull });
    const a = s > 0 ? y0 : y0 - 1.2;
    m.onX(pod, a + 0.4, a + 1.4, 10.4, 11.8, 1.6, BORE); m.onX(pod, a + 1.8, a + 2.8, 10.4, 11.8, 1.6, BORE);
  }
  m.cyl(-0.6, 0, 1, 11.2, 12.8, P.metal, { n: 6 });                      // panoramic sight
  const head = m.box(-1.5, 0.5, -1.1, 1.1, 12.8, 14.2, P.dark);
  m.onX(head, -0.8, 0.8, 13.1, 13.9, 0.5, '#5fb4ea', true);
  m.box(-5.6, -4.6, -2.6, 2.6, 10.6, 13.6, P.steel);                     // radar panel
  return m;
}

// Prism tank: a tracked carrier for one directed-energy projector. Armoured cab forward,
// generator and coolant tanks aft, and between them a faceted emitter slung in a yoke.
function prismHull(tc) {
  const m = new U(), P = PAL.meridian;
  gear(m, 13.5, 5, 8.2, 4.2, P, 5);
  const h = m.profile([[-13.2, 2], [12.4, 2], [14.2, 4], [9.6, 6.6], [-12.6, 6.6], [-13.6, 4.8]], -5, 5, P.hull, { top: P.lite });
  onSlope(m, h, [14.2, 4], [9.6, 6.6], 10.4, 13.4, -4.4, 4.4, P.dark);
  onSlope(m, h, [14.2, 4], [9.6, 6.6], 11.4, 12.4, -4.4, 4.4, tc.main);   // team stripe on the nose
  const cab = m.box(5.2, 9.6, -4.4, 4.4, 6.6, 9.2, P.hull, { top: P.lite });   // armoured cab
  m.tag('glass');
  m.onX(cab, -3.8, -0.6, 7.6, 8.7, 9.6, GLASS); m.onX(cab, 0.6, 3.8, 7.6, 8.7, 9.6, GLASS);
  m.onY(cab, 6, 8.8, 7.6, 8.7, 4.4, GLASS); m.onY(cab, 6, 8.8, 7.6, 8.7, -4.4, GLASS, false, -1);
  m.tag(null);
  m.onTop(cab, 6, 8.4, -3.2, -0.8, 9.2, P.dark);                         // roof hatch
  const gen = m.box(-12.6, -5.6, -4.6, 4.6, 6.6, 9.8, P.dark, { top: P.hull });   // generator housing
  for (const y of [-2.4, 2.4]) { disc(m, gen, -9.1, y, 9.8, 1.9, '#22272c'); disc(m, gen, -9.1, y, 9.8, 0.6, P.lite, 6); }
  m.onTop(gen, -6.6, -5.8, -4.6, 4.6, 9.8, tc.main);                     // team band
  m.onY(gen, -12, -6.2, 7.2, 9.2, 4.6, '#2a2f34');                       // louvres
  m.onY(gen, -12, -6.2, 7.2, 9.2, -4.6, '#2a2f34', false, -1);
  for (const s of [-1, 1]) {
    m.tag('steel');
    m.tubeX(-11.6, -3.4, s * 6.7, 6.1, 1.25, '#8fa3ad', { n: 6, cap: P.steel });   // coolant tank on the fender
    m.tag(null);
    m.box(-2.4, 3.4, Math.min(s * 5.6, s * 8), Math.max(s * 5.6, s * 8), 4.9, 6.2, P.dark, { top: P.hull });   // capacitor locker
    m.box(12.2, 13.2, s * 3 - 0.8, s * 3 + 0.8, 4.4, 5.6, '#e3e6e1');   // headlamp
  }
  m.box(-5.6, -3.6, -0.6, 0.6, 6.6, 7.6, '#22272c');                     // power conduit to the mount
  whip(m, 5.8, 3.8, 9.2, 17.5, tc);
  return m;
}

function prismTurret(tc) {
  const m = new U(), P = PAL.meridian;
  m.cyl(0, 0, 4.4, 6.6, 7.7, P.dark, { n: 8, top: P.steel });            // turntable
  for (const s of [-1, 1]) {
    const y0 = Math.min(s * 3.7, s * 4.7), y1 = Math.max(s * 3.7, s * 4.7);
    const arm = m.box(-1.8, 1.8, y0, y1, 7.7, 14.4, P.hull, { top: P.lite });   // yoke arm
    m.onY(arm, -1.1, 1.1, 11.4, 13.6, s * 4.7, P.metal, false, s);              // trunnion cover
    m.onY(arm, -1.8, 1.8, 8.4, 9.4, s * 4.7, tc.main, false, s);                // team band
  }
  m.tag('steel');
  m.tubeX(-5.6, 4.6, 0, 12.5, 3.3, P.lite, { n: 8, cap: P.metal });      // emitter housing
  m.tubeX(-7.6, -5.6, 0, 12.5, 2.3, P.steel, { n: 6, cap: P.metal });    // cooling pack
  m.tag(null);
  m.tubeX(4.6, 5.8, 0, 12.5, 2.8, '#dff7ff', { n: 8, glow: true });      // lens
  m.box(-3.4, 2.6, -1.2, 1.2, 15.6, 16.6, P.dark, { top: tc.main });     // sunshade, team colour on top
  m.box(0.2, 2.2, 3.6, 4.6, 14.4, 15.8, P.metal);                        // sight
  return m;
}

// ============================================================ VEIL COLLECTIVE / dominion

// Shenfeng: a fast assault craft riding on four ducted lift fans. A narrow armoured wedge between
// two sponsons, a steel ram at the prow, twin thrusters and tail fins aft, and a low twin-gun turret.
function shenfengHull(tc) {
  const m = new U(), P = PAL.veil;
  m.tag('dark');
  m.prism([[15.2, 0], [11, -6.6], [-11, -8.4], [-13, -5], [-13, 5], [-11, 8.4], [11, 6.6]], 0.4, 2.7, '#1a181f');   // skirt
  m.tag(null);
  const h = m.profile([[-12, 2.6], [12.5, 2.6], [16.5, 3.8], [6.5, 7], [-9.5, 7.4], [-12.4, 5.6]], -4.4, 4.4, P.hull, { top: P.lite });
  const G0 = [16.5, 3.8], G1 = [6.5, 7];
  onSlope(m, h, G0, G1, 9, 10.2, -4.4, 4.4, tc.main);                    // team stripes across the glacis
  onSlope(m, h, G0, G1, 11.2, 11.8, -4.4, 4.4, tc.main);
  onSlope(m, h, G0, G1, 6.9, 8.4, -1.4, 1.4, P.dark);                    // pilot's hatch
  for (const s of [-1, 1]) {
    const y0 = Math.min(s * 4.4, s * 8.2), y1 = Math.max(s * 4.4, s * 8.2);
    const sp = m.box(-10.6, 9, y0, y1, 2.6, 5.2, P.dark, { top: P.hull });   // sponson
    m.onY(sp, -3, 2.4, 3.3, 4.5, s * 8.2, tc.main, false, s);
    for (const x of [5, -6.2]) {                                         // ducted lift fans
      const d = m.cyl(x, s * 6.3, 2.7, 5.2, 6.2, P.metal, { n: 8, top: '#0c0a0f' });
      m.onTop(d, x - 0.7, x + 0.7, s * 6.3 - 0.7, s * 6.3 + 0.7, 6.2, P.glow, true);
    }
    m.tag('steel');
    m.tubeX(-14.8, -11.6, s * 2.4, 4.7, 1.7, P.metal, { n: 6, cap: '#ff9be4' });   // thruster
    m.tag(null);
    const fin = m.box(-13.2, -8.6, Math.min(s * 7.5, s * 8), Math.max(s * 7.5, s * 8), 5.2, 9.6, P.dark);   // tail fin
    m.onY(fin, -12.6, -9.2, 7.6, 9, s * 8, tc.main, false, s);
  }
  m.box(-15.2, -14.8, -3.8, 3.8, 3.4, 6, '#ff9be4', { glow: true });     // exhaust glare
  m.tag('steel');
  m.profile([[16.2, 2.8], [19.6, 3.3], [16.2, 5.2]], -2.4, 2.4, '#8d8a96');   // ram
  m.tag(null);
  const sp = m.box(-9.4, -2.4, -1.6, 1.6, 7.3, 8.5, P.dark, { top: P.hull });   // engine spine
  for (const x of [-8.4, -6.6, -4.8]) m.onTop(sp, x, x + 0.9, -1.2, 1.2, 8.5, '#0c0a0f');
  m.box(-10.4, -9.8, -3.6, -3, 7.4, 12.6, P.metal);                      // sensor mast, off centre
  m.box(-10.6, -9.6, -3.8, -2.8, 12.6, 13.6, P.glow, { glow: true });
  return m;
}

function shenfengTurret(tc) {
  const m = new U(), P = PAL.veil;
  const t = m.prism([[-3.4, -2.8], [1.8, -2.8], [3.6, -1.4], [3.6, 1.4], [1.8, 2.8], [-3.4, 2.8]], 7.1, 9, P.hull, { top: P.lite });
  m.onTop(t, -3, -1.8, -2.8, 2.8, 9, tc.main);                           // team band
  m.tag('steel');
  for (const y of [-1.1, 1.1]) m.tubeX(3.6, 10.6, y, 8.1, 0.55, P.metal, { n: 5, cap: BORE });   // twin guns
  m.tag(null);
  m.box(10.2, 11, -1.9, 1.9, 7.4, 8.8, '#f0c4ff', { glow: true });       // muzzle emitters
  m.box(-0.6, 0.8, -2.4, -1.2, 9, 10, P.metal);                          // sight
  return m;
}

/** A spar lying on a dish that slopes from height za at radius ra to zb at radius rb, along direction `a`. */
function spar(m, a, ra, rb, za, zb, w, hgt, c) {
  const cs = Math.cos(a), sn = Math.sin(a), P = (r, o, z) => [cs * r - sn * o, sn * r + cs * o, z];
  return m.solid([
    { p: [P(ra, -w, za + hgt), P(rb, -w, zb + hgt), P(rb, w, zb + hgt), P(ra, w, za + hgt)], c },
    { p: [P(ra, -w, za - 0.4), P(rb, -w, zb - 0.4), P(rb, -w, zb + hgt), P(ra, -w, za + hgt)], c },
    { p: [P(ra, w, za - 0.4), P(rb, w, zb - 0.4), P(rb, w, zb + hgt), P(ra, w, za + hgt)], c },
    { p: [P(rb, -w, zb - 0.4), P(rb, w, zb - 0.4), P(rb, w, zb + hgt), P(rb, -w, zb + hgt)], c },
    { p: [P(ra, -w, za - 0.4), P(ra, w, za - 0.4), P(ra, w, za + hgt), P(ra, -w, za + hgt)], c },
  ]);
}

// Flying disc: a circular lifting body built like an aircraft. Ribbed upper skin, a fuselage
// pod with a glazed nose and twin exhausts running fore and aft across it, intake fans either
// side, engine nacelles under the rim and a scanning emitter slung beneath.
function discHull(tc) {
  const m = new U(), P = PAL.veil;
  m.cyl(0, 0, 7, 1.6, 4.6, P.metal, { n: 12, r1: 14.6 });                // lower dish
  m.cyl(0, 0, 15.3, 4.6, 5.8, P.dark, { n: 12 });                        // rim
  const up = m.cyl(0, 0, 14.6, 5.8, 8.2, P.hull, { n: 12, r1: 8.4, top: P.lite });   // upper dish
  disc(m, up, 0, 0, 8.2, 8, P.dark, 12); disc(m, up, 0, 0, 8.21, 7.3, P.lite, 12);   // panel ring round the crown
  for (const y of [-5.6, 5.6]) { disc(m, up, -0.6, y, 8.22, 2.2, '#0c0a0f'); disc(m, up, -0.6, y, 8.23, 0.7, P.glow, 6, true); }   // intake fans
  for (let i = 0; i < 6; i++) {                                          // ribs; the two across the beam carry the team colour
    const a = (i / 6) * TAU + TAU / 4, team = i % 3 === 0;
    spar(m, a, 8.6, 14.9, 8.2, 5.8, team ? 1.5 : 0.45, team ? 0.35 : 0.5, team ? tc.main : P.dark);
  }
  const pod = m.profile([[-9.4, 8.2], [7, 8.2], [10.8, 9.1], [5.2, 11.4], [-6, 11.6], [-9.8, 10]], -3, 3, P.hull, { top: P.lite });   // fuselage pod
  m.tag('glass');
  onSlope(m, pod, [10.8, 9.1], [5.2, 11.4], 6, 10, -2.4, 2.4, '#27203a');   // glazed nose
  m.tag(null);
  m.onTop(pod, -5.4, -4.2, -3, 3, 11.55, tc.main);                       // team band over the pod
  m.tag('steel');
  for (const y of [-1.6, 1.6]) m.tubeX(-11.6, -8.8, y, 9.7, 1.2, P.metal, { n: 5, cap: '#ff9be4' });   // exhausts
  m.tag(null);
  for (const a of [0.8, 2.6, 4.2, 5.6]) {                                // engine nacelles under the rim, with running lights
    const x = Math.cos(a) * 11.2, y = Math.sin(a) * 11.2;
    m.cyl(x, y, 2.2, 0.4, 4.4, P.dark, { n: 6, r1: 2.7 });
    m.box(Math.cos(a) * 15.2 - 0.6, Math.cos(a) * 15.2 + 0.6, Math.sin(a) * 15.2 - 0.6, Math.sin(a) * 15.2 + 0.6, 4.8, 5.6, '#ff9be4', { glow: true });
  }
  m.box(-7.4, -6.9, 3.4, 3.9, 8, 14.6, P.metal);                         // aerial
  return m;
}

function discTurret() {
  const m = new U(), P = PAL.veil;
  m.cyl(0, 0, 3.8, 0.4, 1.6, P.dark, { n: 8, r1: 5 });                   // gimbal ring under the dish
  m.cyl(0, 0, 2.6, -1.2, 0.4, '#f0c4ff', { n: 6, r1: 3.4, glow: true }); // emitter
  for (let i = 0; i < 3; i++) {                                          // focusing vanes
    const a = (i / 3) * TAU + 0.5, x = Math.cos(a) * 4.4, y = Math.sin(a) * 4.4;
    m.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, -2.4, 0.8, P.lite);
  }
  m.tag('steel');
  m.tubeX(1.4, 6.4, 0, -0.3, 0.55, P.metal, { n: 5, cap: BORE });        // ranging probe
  m.tag(null);
  return m;
}

// ============================================================ infantry

/** Legs and boots in step (`sw` = -1, 0 or 1), as on every figure. */
function legs(m, sw, c, boot = BOOT) {
  m.box(sw * 2 - 0.9, sw * 2 + 0.9, -2, -0.4, 0, 6, c);
  m.box(-sw * 2 - 0.9, -sw * 2 + 0.9, 0.4, 2, 0, 6, c);
  m.box(sw * 2 - 1.1, sw * 2 + 1.5, -2.1, -0.3, 0, 1.4, boot);
  m.box(-sw * 2 - 1.1, -sw * 2 + 1.5, 0.3, 2.1, 0, 1.4, boot);
}

const SOLDIER = {
  // Conscript: field jacket and steel helmet, webbing with pouches, pack and bedroll, a long rifle.
  conscript(m, tc, sw) {
    const P = PAL.iron;
    legs(m, sw, '#3f4334');
    m.box(-1.6, 1.6, -2.5, 2.5, 5.2, 7.2, P.hull);                       // jacket skirt
    const t = m.box(-1.6, 1.7, -2.6, 2.6, 7.2, 11.6, P.hull);
    m.onX(t, -2.6, 2.6, 7.3, 8, 1.7, '#2a2a22');                         // belt
    m.box(1.7, 2.5, -1.9, 1.9, 8.3, 9.9, '#4a4a36');                     // ammunition pouches
    m.tag('cloth');
    const pack = m.box(-3.5, -1.6, -2, 2, 7.4, 11.4, CANVAS);
    m.onTop(pack, -3.3, -1.8, -1.2, 1.2, 11.4, tc.main);                 // team flash on the pack
    m.tubeY(-2.3, 2.3, -2.6, 12.3, 0.9, '#57533c', { n: 5 });            // bedroll
    m.tag(null);
    m.box(-1.1, 1.1, -1.1, 1.1, 11.6, 13.5, SKIN);
    m.cyl(0, 0, 2.7, 12.9, 13.35, P.dark, { n: 6 });                     // helmet brim
    m.cyl(0, 0, 2.25, 13.3, 13.8, tc.main, { n: 6 });                    // team band round the helmet
    m.cyl(0, 0, 2.1, 13.8, 15, P.dark, { n: 6, r1: 1.3 });
    for (const y of [-3.3, 2.6]) m.box(-1.3, 1.3, y, y + 0.7, 10.3, 11.3, tc.main);   // shoulder tabs
    m.box(-sw * 1.2 - 0.6, -sw * 1.2 + 0.6, -3.4, -2.6, 7, 11.2, P.hull);   // left arm swinging
    m.box(-0.2, 3.4, 2.5, 3.3, 9, 10.2, P.hull);                         // right arm on the rifle
    m.tag('steel');
    m.box(0.4, 8.8, 2, 2.65, 9.35, 10.05, '#15171a');                    // rifle
    m.box(3, 4, 2.05, 2.6, 8.2, 9.35, '#15171a');                        // magazine
    m.tag(null);
    m.box(-1.8, 0.4, 2, 2.65, 8.7, 9.9, WOOD);                           // stock
  },
  // Guardian GI: plate carrier and goggles, a spare round on the pack, the launcher on the shoulder.
  guardian(m, tc, sw) {
    const P = PAL.meridian;
    legs(m, sw, '#78828a', '#2a2f34');
    const t = m.box(-1.6, 1.6, -2.5, 2.5, 5.6, 11.6, P.hull);
    m.onX(t, -2.5, 2.5, 6.6, 7.3, 1.6, '#3b4249');                       // belt
    m.box(1.6, 2.3, -2, 2, 7.6, 11, P.dark);                             // plate carrier
    m.box(-3.4, -1.6, -1.9, 1.9, 6.8, 11.2, P.dark);                     // pack
    m.cyl(-2.5, -1, 0.75, 11.2, 15.2, '#59626a', { n: 5, top: HAZ });    // spare round
    m.box(-1.1, 1.1, -1.1, 1.1, 11.6, 13.4, SKIN);
    m.cyl(0, 0, 2.1, 13, 14.9, P.lite, { n: 6, r1: 1.4, top: tc.main }); // helmet, team colour on the crown
    m.box(1.1, 1.7, -1.2, 1.2, 12.5, 13.2, '#5fb4ea', { glow: true });   // goggles
    for (const y of [-3.3, 2.5]) m.box(-1.4, 1.4, y, y + 0.8, 10.1, 11.6, tc.main);   // shoulder pads
    m.box(-sw * 1.2 - 0.6, -sw * 1.2 + 0.6, -3.3, -2.5, 6.8, 11, P.hull);   // left arm
    m.box(-0.2, 2.8, 2.4, 3.2, 10.2, 11.5, P.hull);                      // right arm up to the launcher
    m.tag('steel');
    m.tubeX(-3.4, 6.6, 2.7, 12.4, 0.95, '#59626a', { n: 6, cap: BORE }); // launcher
    m.tubeX(-4.8, -3.4, 2.7, 12.4, 1.4, '#3b4249', { n: 6, cap: BORE, r1: 0.95 });   // blast cone
    m.tag(null);
    m.box(1, 2.6, 2.2, 3.2, 13.3, 14.1, P.metal);                        // sight
  },
  // Initiate: hooded long coat and respirator, a generator on the back feeding a resonator pole.
  initiate(m, tc, sw) {
    const P = PAL.veil;
    m.cyl(sw * 0.4, 0, 3.4, 0.3, 7.6, P.hull, { n: 6, r1: 2.3 });        // coat to the ankle, swaying with the step
    const t = m.box(-1.6, 1.6, -2.4, 2.4, 7.4, 11.8, P.dark);
    m.onX(t, -0.8, 0.8, 7.4, 11.6, 1.6, tc.main);                        // team sash
    m.cyl(0, 0, 3, 10.7, 11.9, P.lite, { n: 6, r1: 2.1 });               // mantle
    m.cyl(0, 0, 2.1, 11.9, 14.7, P.dark, { n: 6, r1: 1.1, top: tc.main });   // hood
    m.box(1.2, 2, -1, 1, 12.5, 13.5, P.glow, { glow: true });            // respirator lenses
    const g = m.box(-3.6, -1.6, -1.8, 1.8, 7.6, 12.2, P.metal);          // generator pack
    m.onTop(g, -3.3, -1.9, -1.1, 1.1, 12.2, tc.main);
    m.box(0.4, 3, 2.3, 3.2, 9.6, 10.8, P.dark);                          // arm on the pole
    m.box(2.3, 2.8, 2.7, 3.2, 0, 18.8, '#15171a');                       // resonator pole
    m.cyl(2.55, 2.95, 1.5, 18.8, 21.6, '#f0c4ff', { n: 5, r1: 0.5, glow: true });   // emitter head
  },
};

function soldier(id, tc, frame) {
  const m = new U();
  SOLDIER[id](m, tc, [0, 1, 0, -1][frame & 3]);
  return m;
}

// ============================================================ bases
// Authored like the shipped ones: x and y in the compound's own frame (it is drawn turned 45
// degrees, so the +x and +y walls face the camera and tall things belong at -x, -y), z up from
// the foundation slab, which reaches about 20 either way. Things standing out in the yard start
// below the slab (GROUND) so they reach the ground.
const GROUND = -1.2;

function windows(m, s, face, a0, a1, z0, z1, at, n, c = LIT, glow = true, dir = 1) {
  const w = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    if (face === 'y') m.onY(s, a0 + i * w + w * 0.18, a0 + (i + 1) * w - w * 0.18, z0, z1, at, c, glow, dir);
    else m.onX(s, a0 + i * w + w * 0.18, a0 + (i + 1) * w - w * 0.18, z0, z1, at, c, glow, dir);
  }
}

/** A flagpole flying the team colour. */
function flag(m, x, y, z0, z1, tc) {
  m.box(x - 0.25, x + 0.25, y - 0.25, y + 0.25, z0, z1, '#c9cdd1');
  m.box(x + 0.25, x + 5.2, y - 0.12, y + 0.12, z1 - 3.4, z1 - 0.4, tc.main);
}

/** A floodlight mast with a lit lamp head. */
function floodlight(m, x, y, h, c = '#fff3c4') {
  m.box(x - 0.3, x + 0.3, y - 0.3, y + 0.3, GROUND, h, '#3b3f44');
  m.box(x - 1.3, x + 1.3, y - 0.8, y + 0.8, h, h + 1.3, c, { glow: true });
}

/** An upright storage tank with a banded top and, optionally, a band in the team colour. */
function tank(m, x, y, r, h, c, top, band) {
  m.tag('steel');
  m.cyl(x, y, r, 0, h, c, { n: 10, top });
  if (band) m.cyl(x, y, r + 0.12, h * 0.62, h * 0.62 + 1.3, band, { n: 10 });
  m.tag(null);
}

/** A lattice mast: a slim column with cross-trees, dishes and a beacon. */
function mast(m, x, y, z0, z1, c, beacon = '#ff5a4d') {
  m.tag('steel');
  m.box(x - 0.55, x + 0.55, y - 0.55, y + 0.55, z0, z1, c);
  const H = z1 - z0;
  for (const k of [0.45, 0.72]) m.box(x - 2.4, x + 2.4, y - 0.25, y + 0.25, z0 + H * k, z0 + H * k + 0.5, c);
  m.cyl(x + 1.5, y + 1.2, 1.5, z0 + H * 0.82, z0 + H * 0.82 + 1.1, '#d9dde0', { n: 6 });   // dish
  m.tag(null);
  m.box(x - 0.5, x + 0.5, y - 0.5, y + 0.5, z1, z1 + 1, beacon, { glow: true });
}

const BASES = {
  // ---------------------------------------------------------- Iron Pact
  // Level 1, a depot: guard block, vehicle shed, two fuel tanks on cradles, a gun pit and a radio mast.
  iron1(m, tc) {
    const P = PAL.iron;
    m.tag('concrete');
    const hq = m.box(-17, -3, -16, -5, 0, 8, P.wall);                    // guard block
    m.onY(hq, -17, -3, 0, 1.2, -5, P.wallD); m.onX(hq, -16, -5, 0, 1.2, -3, P.wallD);
    m.onY(hq, -11.4, -8.6, 0, 5.6, -5, '#22241f');                       // door
    m.onY(hq, -11.8, -8.2, 5.6, 6.6, -5, tc.main);
    windows(m, hq, 'y', -16.4, -12, 3.6, 5.8, -5, 2); windows(m, hq, 'y', -8, -3.6, 3.6, 5.8, -5, 2);
    windows(m, hq, 'x', -15, -6, 3.6, 5.8, -3, 3);
    m.tag('roof');
    const r = m.box(-17.6, -2.4, -16.6, -4.4, 8, 9, P.roof, { top: '#3a3e31' });
    m.tag(null);
    m.onTop(r, -16.4, -11.4, -15.4, -5.6, 9, tc.main);                   // roof marking
    m.onTop(r, -10.8, -10, -15.4, -5.6, 9, WHITE);
    m.cyl(-5.4, -13.6, 0.9, 9, 13.4, P.metal, { n: 6, top: BORE });      // stove pipe
    m.tag('corrugated');
    const shed = m.box(2, 17, -17, -5, 0, 6.6, '#5c624d');               // vehicle shed, two bays
    m.ridge(1.2, 17.8, -17.8, -4.2, 6.6, 9.8, P.roof, { gable: '#5c624d' });
    m.tag(null);
    for (const x of [3, 10.2]) { m.onY(shed, x, x + 5.8, 0, 5.4, -5, '#1d1f1b'); for (const z of [1.2, 2.6, 4]) m.onY(shed, x, x + 5.8, z, z + 0.25, -5, '#33372c'); }
    m.onY(shed, 2, 17, 5.6, 6.5, -5, tc.main);                           // team lintel over the bays
    for (const y of [4.6, 11]) {                                         // fuel tanks on cradles
      m.tag('steel');
      m.tubeX(-17, -6.6, y, 3.2, 2.5, '#5f6652', { n: 8, cap: '#454b3a' });
      m.tag(null);
      for (const x of [-15, -8.6]) m.box(x - 0.6, x + 0.6, y - 2.2, y + 2.2, 0, 1.6, P.wallD);
    }
    m.box(-12.6, -11, 1.6, 14, 5.9, 6.3, tc.main);                       // team band painted across both tanks
    m.tag('sandbag');
    m.cyl(11, 10, 5, 0, 2.4, '#8f8763', { n: 8, top: '#6d6a52' });       // gun pit
    m.tag('steel');
    m.cyl(11, 10, 1.1, 0.4, 3.4, P.metal, { n: 6 });
    m.tubeX(11, 17.4, 10, 3.9, 0.45, GUNMETAL, { n: 5, cap: BORE });
    m.tag(null);
    m.box(9.8, 12.2, 9, 11, 3.2, 4.5, P.dark);
    m.tag('cloth');
    m.box(1, 5, 2, 5.6, 0, 3, CANVAS, { top: '#7d7859' }); m.box(1.6, 4.4, 6.2, 9.2, 0, 2, '#5c5b45');   // covered stores
    m.tag(null);
    for (const [x, y] of [[-2.4, 14.6], [0, 15.4], [-1.2, 12.6]]) m.cyl(x, y, 1.1, 0, 2.6, '#4a4f3e', { n: 6, top: '#3a3e31' });   // drums
    mast(m, -15.6, -14.4, 9, 27, P.steel);
    for (const [x, y] of [[-18.6, 14.6], [-14.6, 14.6], [-18.6, 18.6], [-14.6, 18.6]]) m.box(x - 0.3, x + 0.3, y - 0.3, y + 0.3, 0, 12, WOOD);   // watchtower
    const wt = m.box(-19.4, -13.8, 13.8, 19.4, 12, 15.4, '#5c624d');
    m.onY(wt, -18.6, -14.6, 13.4, 14.8, 19.4, LIT, true); m.onX(wt, 14.6, 18.6, 13.4, 14.8, -13.8, LIT, true);
    m.box(-20, -13.2, 13.2, 20, 15.4, 16.2, P.roof, { top: tc.main });
    floodlight(m, 18.6, 18.6, 12);
    flag(m, 17.6, -1.6, 0, 16, tc);
    return 24;
  },
  // Level 2, a works: saw-tooth factory hall, office block, brick stack, tank farm and a gantry crane.
  iron2(m, tc) {
    const P = PAL.iron;
    m.tag('concrete');
    const hall = m.box(-19, 3, -18, -2, 0, 12, P.wall);                  // factory hall
    m.onY(hall, -19, 3, 0, 1.4, -2, P.wallD);
    for (const x of [-17, -9.4]) { m.onY(hall, x, x + 6.4, 0, 8.6, -2, '#1d1f1b'); for (const z of [1.5, 3.2, 4.9, 6.6]) m.onY(hall, x, x + 6.4, z, z + 0.3, -2, '#33372c'); }
    m.onY(hall, -17.6, -2.4, 8.8, 10, -2, tc.main);                      // team lintel
    windows(m, hall, 'x', -17, -3, 5.4, 9.4, 3, 5);
    m.onX(hall, -18, -2, 0, 1.4, 3, P.wallD);
    m.tag('corrugated');
    for (let i = 0; i < 4; i++) {                                        // saw-tooth roof, north lights glowing
      const x0 = -19 + i * 5.5, s = m.profile([[x0, 12], [x0 + 5.5, 12], [x0 + 5.5, 15.6]], -18, -2, P.roof);
      m.onX(s, -17, -3, 12.5, 15.1, x0 + 5.5, LIT, true);
    }
    m.tag('concrete');
    const off = m.box(6, 18, -18, -8, 0, 15, '#8a887a');                 // office block
    windows(m, off, 'y', 6.6, 17.4, 3.4, 6, -8, 4); windows(m, off, 'y', 6.6, 17.4, 8.6, 11.2, -8, 4);
    windows(m, off, 'x', -17.4, -8.6, 8.6, 11.2, 18, 3);
    m.onY(off, 6, 18, 12.6, 13.8, -8, tc.main);                          // team band under the parapet
    m.tag('roof');
    const or = m.box(5.4, 18.6, -18.6, -7.4, 15, 16, P.roof, { top: '#3a3e31' });
    m.tag(null);
    m.onTop(or, 7, 12, -17, -9, 16, tc.main);                            // roof marking
    m.onTop(or, 12.6, 13.4, -17, -9, 16, WHITE);
    m.box(14.4, 17.4, -12, -9, 16, 18, P.steel);                         // plant
    mast(m, 15.8, -16, 16, 37, P.steel);
    m.tag('brick');
    m.cyl(-14.5, 6, 2.6, 0, 40, '#7a5f4e', { n: 8, r1: 1.9 });           // brick stack
    m.tag(null);
    m.cyl(-14.5, 6, 2.2, 36, 37.4, tc.main, { n: 8 });                   // team band near the top
    m.cyl(-14.5, 6, 2.3, 40, 41.2, '#2a2623', { n: 8, top: BORE });
    m.tag('concrete');
    m.box(-18.4, -10.6, 2.4, 9.6, 0, 5, P.wallD, { top: '#4f4e45' });    // boiler house at its foot
    m.tag(null);
    tank(m, -3.5, 7, 4.2, 9, '#666c58', '#7a8068', tc.main);             // tank farm
    tank(m, -5, 15.6, 3.4, 7, '#666c58', '#7a8068');
    m.tag('steel');
    m.tubeY(7, 13, -4, 6.2, 0.5, P.steel, { n: 5 });                     // pipe run
    for (const x of [5, 17]) m.box(x - 0.6, x + 0.6, 4, 5.2, 0, 13, HAZ);   // gantry crane
    m.box(4.4, 17.6, 3.8, 5.4, 13, 14.6, HAZ);
    m.box(9.4, 12.2, 3.4, 5.8, 11.6, 13, P.metal);
    m.tag(null);
    m.box(8, 14, 8, 13, 0, 2.4, '#4a503c', { top: '#565c46' });          // a hull on the hardstanding, under the crane
    m.box(9.4, 12.4, 9.2, 11.8, 2.4, 4, '#565c46');
    for (const [x, y] of [[16.5, 14], [18.4, 15.4], [17.2, 17]]) m.cyl(x, y, 1.1, 0, 2.6, '#4a4f3e', { n: 6, top: '#3a3e31' });
    floodlight(m, 19, 19, 14); floodlight(m, -19, 19, 14);
    flag(m, 4.8, -0.4, 0, 19, tc);
    return 36;
  },
  // Level 3, the full complex: assembly hall, power block with twin stacks, command block under
  // a tall mast, a tank farm and a heavy gun on a concrete pedestal.
  iron3(m, tc) {
    const P = PAL.iron;
    m.tag('concrete');
    const hall = m.box(-20, 2, -19, -4, 0, 14, P.wall);                  // assembly hall
    m.onY(hall, -20, 2, 0, 1.4, -4, P.wallD);
    for (const x of [-18.6, -11.4, -4.2]) m.onY(hall, x, x + 5.6, 0, 10, -4, '#1d1f1b');
    for (const z of [2, 4.2, 6.4, 8.6]) m.onY(hall, -18.6, 1.4, z, z + 0.3, -4, '#33372c');
    m.onY(hall, -19.4, 1.4, 10.4, 11.8, -4, tc.main);                    // team lintel
    windows(m, hall, 'x', -18, -5, 6, 11, 2, 4);
    m.tag('corrugated');
    const roof = m.ridge(-20.8, 2.8, -19.8, -3.2, 14, 19.4, P.roof, { gable: P.wall });
    m.tag(null);
    m.box(-18, 0, -12.4, -10.6, 19, 20.6, P.dark, { top: P.metal });     // ridge ventilator
    mark(m, roof, [[-17, -4.6, 15.1], [-10, -4.6, 15.1], [-10, -9.4, 17.9], [-17, -9.4, 17.9]], tc.main);   // roof marking
    mark(m, roof, [[-8.6, -4.6, 15.1], [-7.4, -4.6, 15.1], [-7.4, -9.4, 17.9], [-8.6, -9.4, 17.9]], WHITE);
    for (const x of [-5, -1]) mark(m, roof, [[x, -4.6, 15.1], [x + 2.6, -4.6, 15.1], [x + 2.6, -8, 17.1], [x, -8, 17.1]], LIT, true);   // skylights
    m.tag('concrete');
    const pw = m.box(5, 19, -19, -8, 0, 20, '#6a695e');                  // power block
    windows(m, pw, 'y', 6, 18, 12.6, 16.6, -8, 3, '#ff9a3c');
    m.onY(pw, 5, 19, 17.6, 19, -8, tc.main);
    m.onY(pw, 8.4, 15.6, 0, 8, -8, '#1d1f1b');
    m.box(7, 17, -17.4, -10, 20, 26, P.wallD, { top: '#4f4e45' });
    m.tag('steel');
    for (const [x, h] of [[9.6, 60], [14.6, 52]]) {                      // twin stacks, banded in the team colour
      m.cyl(x, -13.6, 2.2, 26, h, P.metal, { n: 8, r1: 1.7 });
      m.cyl(x, -13.6, 2.05, h - 6, h - 4.4, tc.main, { n: 8 });
      m.cyl(x, -13.6, 2.1, h, h + 1.2, '#161719', { n: 8, top: BORE });
    }
    m.tag('concrete');
    const hq = m.box(6, 18, -5, 5, 0, 11, '#8a887a');                    // command block
    windows(m, hq, 'y', 6.6, 17.4, 2.8, 5, 5, 4); windows(m, hq, 'y', 6.6, 17.4, 6.6, 8.8, 5, 4);
    windows(m, hq, 'x', -4.4, 4.4, 6.6, 8.8, 18, 3);
    m.tag('roof');
    const hr = m.box(5.4, 18.6, -5.6, 5.6, 11, 12, P.roof, { top: '#3a3e31' });
    m.tag(null);
    m.onTop(hr, 6.6, 11.4, -4.4, 4.4, 12, tc.main);
    mast(m, 15.2, 0, 12, 46, P.steel);
    tank(m, -15, 3.4, 3.8, 9.4, '#666c58', '#7a8068', tc.main);          // tank farm
    tank(m, -15.6, 12, 3.2, 7.4, '#666c58', '#7a8068');
    tank(m, -8, 4.6, 2.8, 6.6, '#666c58', '#7a8068');
    m.tag('steel');
    m.tubeX(-12, -3, 8.6, 5, 0.5, P.steel, { n: 5 });
    m.tag('concrete');
    m.cyl(6, 14, 5.6, 0, 4.6, '#6a695e', { n: 8, top: '#7b7a6e' });      // gun pedestal
    m.tag(null);
    const gt = m.box(2.2, 9.6, 10.4, 17.6, 4.6, 8.6, P.hull, { top: P.lite });
    m.onTop(gt, 2.8, 4.6, 10.4, 17.6, 8.6, tc.main);
    gun(m, 9.6, 23, 14, 6.8, 1.1, P.metal, { evac: true, brake: 2.2 });
    for (const [x, y] of [[-3.4, 15.6], [-1.2, 16.6], [-2.6, 13.4]]) m.cyl(x, y, 1.1, 0, 2.6, '#4a4f3e', { n: 6, top: '#3a3e31' });
    floodlight(m, 19.4, 19.4, 15); floodlight(m, -19.4, 19.4, 15);
    flag(m, 3.6, -1.4, 0, 21, tc);
    return 46;
  },

  // ---------------------------------------------------------- Meridian Alliance
  // Level 3, an air and signals station: arched hangar, control tower with a lit cab, a radome on
  // the operations block, a helipad on the headquarters roof, coolant tanks and a panel array.
  meridian3(m, tc) {
    const P = PAL.meridian;
    m.tag('plating');
    const hg = m.profile([[-20, 0], [-20, 7.4], [-15.4, 12], [-6.6, 12], [-2, 7.4], [-2, 0]], -19, -3, P.wall, { top: P.lite });   // hangar
    m.tag(null);
    m.onY(hg, -17.6, -4.4, 0, 8.4, -3, '#20262c');                       // open doors
    m.onY(hg, -16.4, -5.6, 0.6, 3.2, -3, LIT, true);                     // light inside
    m.onY(hg, -18.4, -3.6, 8.8, 10, -3, tc.main);                        // team band over the doors
    mark(m, hg, [[-14.6, -17, 12], [-7.4, -17, 12], [-7.4, -11, 12], [-14.6, -11, 12]], tc.main);   // roof marking
    mark(m, hg, [[-14.6, -9.6, 12], [-7.4, -9.6, 12], [-7.4, -8.6, 12], [-14.6, -8.6, 12]], WHITE);
    m.tag('concrete');
    const tw = m.box(9, 14, -18, -13, 0, 30, P.wall);                    // control tower
    for (const z of [6, 13, 20]) m.onY(tw, 10, 13, z, z + 2.2, -13, GLASS);
    m.onY(tw, 9, 14, 26.4, 27.8, -13, tc.main); m.onX(tw, -18, -13, 26.4, 27.8, 14, tc.main);
    m.tag(null);
    m.cyl(11.5, -15.5, 4.2, 30, 31, P.dark, { n: 8, r1: 5 });
    m.tag('glass');
    m.cyl(11.5, -15.5, 5, 31, 34.6, '#bfeaff', { n: 8, r1: 5.6, glow: true });   // cab
    m.tag(null);
    m.cyl(11.5, -15.5, 6, 34.6, 35.6, P.roof, { n: 8, top: P.dark });
    mast(m, 11.5, -15.5, 35.6, 52, P.steel);
    m.tag('concrete');
    const ops = m.box(4, 18, -8, 4, 0, 7, P.wall);                       // operations block
    windows(m, ops, 'y', 4.8, 17.2, 2.6, 5, 4, 5); windows(m, ops, 'x', -7, 3, 2.6, 5, 18, 3);
    m.tag('plating');
    m.cyl(11, -2, 4.6, 7, 9.2, WHITE, { n: 10, r1: 5.8 });               // radome
    m.cyl(11, -2, 5.8, 9.2, 12.6, WHITE, { n: 10, r1: 4.8 });
    m.cyl(11, -2, 4.8, 12.6, 15, WHITE, { n: 10, r1: 1.8, top: '#f4f6f5' });
    m.tag('concrete');
    const hq = m.box(-19, -5, 3, 16, 0, 10, P.wall);                     // headquarters
    windows(m, hq, 'y', -18.2, -5.8, 2.6, 4.6, 16, 5); windows(m, hq, 'y', -18.2, -5.8, 6.2, 8.2, 16, 5);
    windows(m, hq, 'x', 4, 15, 6.2, 8.2, -5, 4);
    m.tag('roof');
    const pad = m.box(-19.6, -4.4, 2.4, 16.6, 10, 11, P.roof, { top: '#5d666d' });
    m.tag(null);
    disc(m, pad, -12, 9.5, 11, 5.4, WHITE, 12); disc(m, pad, -12, 9.5, 11.01, 4.6, '#5d666d', 12);   // helipad ring
    for (const x of [-13.8, -10.9]) m.onTop(pad, x, x + 0.7, 7, 12, 11.04, tc.main);                 // and the H, in the team colour
    m.onTop(pad, -13.8, -10.2, 9.1, 9.9, 11.04, tc.main);
    for (const y of [8.6, 13.2]) {                                       // coolant tanks
      m.tag('steel');
      m.tubeX(0.4, 8.4, y, 2.6, 1.9, '#8fa3ad', { n: 8, cap: P.steel });
      m.tag(null);
      for (const x of [2, 6.8]) m.box(x - 0.5, x + 0.5, y - 1.7, y + 1.7, 0, 1.2, P.wallD);
    }
    for (const x of [11, 14.6, 18.2]) {                                  // panel array, tilted to the sky
      const p = m.profile([[x - 1.5, 0.6], [x + 1.5, 0.6], [x + 1.5, 3.4]], 8, 17, '#22364e');
      for (const y of [10.9, 13.9]) mark(m, p, [[x - 1.5, y, 0.6], [x + 1.5, y, 3.4], [x + 1.5, y + 0.3, 3.4], [x - 1.5, y + 0.3, 0.6]], '#8fb6dc');
    }
    floodlight(m, 19.4, 19.4, 13, '#eaf7ff'); floodlight(m, -19.4, -19.6, 13, '#eaf7ff');
    flag(m, 1.2, -1.4, 0, 19, tc);
    return 42;
  },

  // ---------------------------------------------------------- Veil Collective
  // Level 3, a transmitter station: a stepped pylon ringed with emitters, a reactor hall with
  // finned roof, two cooling towers, an insulator bank and a slit-windowed control bunker.
  veil3(m, tc) {
    const P = PAL.veil, V = '#b77dff';
    m.tag('concrete');
    m.cyl(-9, -9, 7.2, 0, 3, P.wallD, { n: 8, top: P.wall });            // pylon footing
    m.tag('plating');
    m.cyl(-9, -9, 5, 3, 18, P.steel, { n: 6, r1: 3.4 });                 // the pylon, in three stages
    m.cyl(-9, -9, 3.2, 18, 38, P.lite, { n: 6, r1: 2 });
    m.cyl(-9, -9, 1.9, 38, 56, P.wall, { n: 6, r1: 0.8 });
    m.tag(null);
    m.cyl(-9, -9, 5.4, 18, 19, P.dark, { n: 8, top: P.hull });           // stage platforms
    m.cyl(-9, -9, 3.6, 38, 39, P.dark, { n: 8, top: P.hull });
    for (const [z, r] of [[24, 3.6], [31, 3], [44, 2.2], [50, 1.7]]) m.cyl(-9, -9, r, z, z + 0.9, V, { n: 8, glow: true });   // emitter rings
    m.cyl(-9, -9, 1.6, 56, 62, '#f0c4ff', { n: 6, r1: 0.2, glow: true });   // tip
    m.box(-8.8, -3.2, -9.15, -8.85, 26, 35, tc.main);                    // team banner hung from the second stage
    m.tag('concrete');
    const hall = m.box(1, 19, -19, -6, 0, 9, P.wall);                    // reactor hall
    m.onY(hall, 1, 19, 0, 1.2, -6, P.wallD);
    m.onY(hall, 7, 13, 0, 6.4, -6, '#0f0d13');
    m.onY(hall, 6.4, 13.6, 6.6, 7.6, -6, tc.main);                       // team lintel
    for (const x of [2.4, 14.6]) m.onY(hall, x, x + 3, 2.6, 5.6, -6, V, true);
    windows(m, hall, 'x', -18, -7, 3, 6, 19, 4, V);
    m.tag('roof');
    const hr = m.box(0.4, 19.6, -19.6, -5.4, 9, 10, P.roof, { top: '#2a2433' });
    m.tag(null);
    m.onTop(hr, 2, 7, -18, -7, 10, tc.main);                             // roof marking
    m.onTop(hr, 7.6, 8.4, -18, -7, 10, WHITE);
    for (const y of [-17, -13.6, -10.2]) m.box(10, 18.4, y, y + 1.6, 10, 12.4, P.steel, { top: P.dark });   // cooling fins
    m.tag('concrete');
    for (const [x, y] of [[-14.5, 6], [-14.5, 15]]) {                    // cooling towers
      m.cyl(x, y, 4.6, 0, 9, P.wall, { n: 8, r1: 3.2 });
      const mouth = m.cyl(x, y, 3.2, 9, 12.4, P.wall, { n: 8, r1: 3.9, top: '#0f0d13' });
      disc(m, mouth, x, y, 12.4, 2.2, V, 8, true);
    }
    m.tag('steel');
    for (const x of [-6.6, -3.2, 0.2, 3.6]) {                            // insulator bank
      m.cyl(x, 10, 1.1, 0, 8.4, '#6a6077', { n: 6, r1: 0.7 });
      m.cyl(x, 10, 1, 8.4, 9.6, '#f0c4ff', { n: 6, glow: true });
    }
    m.box(-7.4, 4.4, 9.6, 10.4, 3.6, 4.4, P.metal);                      // busbar
    m.tubeY(-6, 10, -9, 1.6, 0.6, P.steel, { n: 5 });                    // feeder to the pylon
    m.tag('concrete');
    const bk = m.box(7, 18, 6, 16, 0, 6.6, P.wallD, { top: P.wall });    // control bunker
    m.tag(null);
    m.onY(bk, 8, 17, 3.8, 4.8, 16, V, true); m.onX(bk, 7, 15, 3.8, 4.8, 18, V, true);
    m.onTop(bk, 8.4, 12.4, 7.4, 14.6, 6.6, tc.main);
    floodlight(m, 19.4, 19.4, 13, '#e3b4ff'); floodlight(m, -19.4, -19.4, 13, '#e3b4ff');
    flag(m, 5.4, 2.4, 0, 18, tc);
    return 48;
  },
};

// Higher levels stand taller as well as fuller, so a level-3 base holds its own against the
// office blocks around it: the finished model is stretched upward by this much.
const RISE = [1, 1, 1.08, 1.16];

function stretch(m, k) {
  if (k === 1) return;
  const seen = new Set();
  for (const s of m.solids) {
    s.c[2] *= k;
    for (const f of s.faces) {
      for (const p of f.p) if (!seen.has(p)) { seen.add(p); p[2] *= k; }
      const n = f.n, l = Math.hypot(n[0], n[1], n[2] / k) || 1;
      f.n = [n[0] / l, n[1] / l, n[2] / k / l];
    }
  }
}

const baseMemo = new Map();
function base(f, sub, level, tc) {
  const fn = BASES[`${f}${level}`];
  if (!fn) return null;
  const key = `${f}|${level}|${tc.id}`;
  let b = baseMemo.get(key);
  if (!b) {
    const m = new U();
    const top = fn(m, tc);
    m.tag(null);
    stretch(m, RISE[level]);
    baseMemo.set(key, (b = { model: m, top: Math.round(top * RISE[level]) }));
  }
  return b;
}

// ============================================================ the set

const UNITS = {
  'iron|bastion|2': { hull: rhinoHull, turret: rhinoTurret, spec: { pivot: -1, muzzle: 23.2, mz: 9.9, foot: [14.5, 9.6] } },
  'iron|bastion|3': { hull: apocalypseHull, turret: apocalypseTurret, spec: { pivot: -1.5, muzzle: 25.2, mz: 11.3, barrels: [-2.6, 2.6], foot: [17, 11.6] } },
  'meridian|aegis|2': { hull: ifvHull, turret: ifvTurret, spec: { pivot: 1, muzzle: 13.6, mz: 10.1, foot: [14, 8.4] } },
  'meridian|aegis|3': { hull: prismHull, turret: prismTurret, spec: { pivot: 1.5, muzzle: 5.8, mz: 12.5, glow: [5.8, 12.5, 4.2], foot: [13.5, 8.4] } },
  'veil|dominion|2': { hull: shenfengHull, turret: shenfengTurret, spec: { pivot: 3, muzzle: 11, mz: 8.1, glow: [10.6, 8.1, 2.4], foot: [15, 8.4] } },
  'veil|dominion|3': { hull: discHull, turret: discTurret },
};
const FOOT = { 'iron|bastion': 'conscript', 'meridian|aegis': 'guardian', 'veil|dominion': 'initiate' };

export default {
  id: 'b',
  label: 'Hard-surface realism',
  unitScale: 1.18,
  soldier(f, sub, tc, frame) { const id = FOOT[`${f}|${sub}`]; return id ? soldier(id, tc, frame) : null; },
  hull(f, sub, tier, tc) { const u = UNITS[`${f}|${sub}|${tier}`]; return u ? u.hull(tc) : null; },
  turret(f, sub, tier, tc) { const u = UNITS[`${f}|${sub}|${tier}`]; return u ? u.turret(tc) : null; },
  spec(f, sub, tier) { const u = UNITS[`${f}|${sub}|${tier}`]; return (u && u.spec) || null; },
  base,
};
