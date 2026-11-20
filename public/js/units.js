// Unit models: faction -> level -> (subfaction variant).
//
// Vehicles are two models (hull + turret) so the turret can track on its own.
// Local axes: x forward, y sideways, z up. `tc` is the team colour and is used
// only on marking panels; everything else comes from the faction materials.
import { Model, F } from './iso.js';
import { FACTIONS } from './factions.js';

const TAU = Math.PI * 2;
const COPPER = '#b56a3a';
const WHITE_HOT = '#f3fbff';

/**
 * Running gear for one vehicle: on each side a track with a sloped front and rear run,
 * road wheels and a drive sprocket standing proud of it, and a fender over the top.
 */
function tracks(m, len, y0, y1, h, M, fender) {
  for (const s of [-1, 1]) {
    const a = Math.min(s * y0, s * y1), b = Math.max(s * y0, s * y1);
    const was = m.tag('tread');
    const t = m.profile([[-len, h * 0.45], [-len + 1.6, 0.2], [len - 2.4, 0.2], [len, h * 0.5], [len - 0.8, h], [-len + 0.6, h]], a, b, M.metal, { top: '#3a3f45' });
    // Road wheels and the drive sprocket: discs on the track's outer face (they are a few pixels
    // across at playing zoom, so they are drawn flat rather than modelled).
    m.tag('steel');
    const out = s > 0 ? b : a, n = Math.max(4, Math.round(len / 2.7));
    const disc = (x, z, r, c) => m.decal(t, Array.from({ length: 8 }, (_, i) => { const q = ((i + 0.5) / 8) * TAU; return [x + Math.cos(q) * r, out, z + Math.sin(q) * r]; }), c, [0, s, 0]);
    for (let i = 0; i < n; i++) { const x = -len + 2.7 + i * ((2 * len - 6) / (n - 1)); disc(x, h * 0.42, h * 0.34, '#59616a'); disc(x, h * 0.42, h * 0.13, '#23272b'); }
    disc(len - 1.6, h * 0.66, h * 0.27, '#454c53');
    m.tag('panel');
    if (fender) m.box(-len - 0.5, len + 0.5, a - 0.3, b + 0.3, h, h + 0.9, fender);
    m.tag(was);
  }
}

/** What every tracked hull carries: headlamps, a tow bar, tools lashed to the deck, a hatch. */
function fittings(m, len, half, deck, M) {
  const was = m.tag('steel');
  for (const y of [-half + 1.2, half - 1.2]) m.box(len - 0.4, len + 0.5, y - 0.8, y + 0.8, deck - 2.6, deck - 1.2, '#d9d6c4');   // headlamps (unlit)
  m.box(-len - 1.3, -len - 0.5, -3, 3, 2.6, 3.4, '#2b2e31');                                                              // tow bar
  m.tubeX(-len * 0.3, len * 0.35, half - 0.9, deck + 0.35, 0.3, '#6b5a40', { n: 5 });                                      // pry bar
  m.box(-len * 0.75, -len * 0.45, -half + 0.6, -half + 2.6, deck, deck + 1.1, '#4f5a44');                                  // tool box
  m.tag(was);
}

// ============================================================ IRON PACT

function ironTankHull(m, tc, M, sub) {
  tracks(m, 13.5, 6, 11, 5.4, M, M.dark);
  fittings(m, 13.5, 6.6, 9.4, M);
  for (const y of [-4.4, 4.4]) m.cyl(-13, y, 1.4, 5.5, 13, M.metal, { n: 6, top: '#0e0f10' });   // exhausts
  const h = m.profile([[-13, 2.6], [12.5, 2.6], [14.5, 5.4], [10, 9.4], [-12.5, 9.4], [-14, 6.4]], -6.6, 6.6, M.hull, { top: M.lite });
  m.onTop(h, -11.5, -6, -4.4, 4.4, 9.4, M.metal);                      // engine grille
  m.onTop(h, -5, 2.5, -6.4, -3.6, 9.4, tc.main);                       // team deck panels
  m.onTop(h, -5, 2.5, 3.6, 6.4, 9.4, tc.main);
  if (sub === 'bastion') {
    for (const s of [-1, 1]) {                                         // bolt-on side skirts
      const sk = m.box(-12.5, 12.5, Math.min(s * 11, s * 12.4), Math.max(s * 11, s * 12.4), 1.4, 7.6, M.dark);
      m.onY(sk, -7, 7, 3.4, 6, s * 12.4, tc.main, false, s);
    }
    m.box(14.4, 16, -8.5, 8.5, 1.2, 7.4, M.dark);                      // dozer plate
  } else {
    const c = m.box(-11.4, -6.2, -3.4, 3.4, 9.4, 13.2, M.metal, { top: M.dark });   // capacitor bank
    m.onY(c, -10.6, -7, 10.6, 12, 3.4, '#7fd8ff', true);
    m.onY(c, -10.6, -7, 10.6, 12, -3.4, '#7fd8ff', true, -1);
  }
}

function ironTankTurret(m, tc, M, sub) {
  m.box(-10.5, -7, -4.2, 4.2, 10, 14, M.dark);                         // stowage bustle
  const t = m.prism([[-7, -5.8], [3, -5.8], [7.4, -2.8], [7.4, 2.8], [3, 5.8], [-7, 5.8]], 9.4, 14.8, M.hull, { top: M.lite });
  m.onTop(t, -5.8, -1.2, -4.2, 4.2, 14.8, tc.main);                    // team roof panel
  m.cyl(1.6, 2.6, 2.1, 14.8, 16.1, M.dark, { n: 6, top: M.metal });    // cupola
  if (sub === 'bastion') {
    for (const s of [-1, 1]) m.box(0.5, 6.5, Math.min(s * 5.8, s * 7.2), Math.max(s * 5.8, s * 7.2), 9.8, 14, M.dark);   // cheek armour
    m.box(5.8, 8.6, -2.6, 2.6, 10.2, 14, M.dark);                      // mantlet
    m.tag('steel');
    m.tubeX(8.6, 19, 0, 12.1, 1.35, M.metal, { n: 8 });                // heavy gun
    m.tubeX(17.4, 21, 0, 12.1, 2.1, '#34383c', { n: 8, cap: '#101214' });   // muzzle brake
    m.tag(null);
  } else {
    m.box(6.8, 17, -1.2, 1.2, 10.9, 13.3, M.metal);                    // coil spine
    for (const x of [8.6, 11.6, 14.6]) m.box(x, x + 1.5, -2.8, 2.8, 9.5, 14.7, COPPER);
    m.box(16.6, 19.4, -1.7, 1.7, 10.4, 13.8, '#bfeaff', { top: WHITE_HOT });
  }
}

function ironSiegeHull(m, tc, M, sub) {
  tracks(m, 15.5, 6.6, 12.4, 6, M, M.dark);
  fittings(m, 15.5, 7.2, 10.6, M);
  for (const y of [-5, 5]) m.cyl(-14.5, y, 1.9, 6.5, 16, M.metal, { n: 6, top: '#0e0f10' });
  const h = m.profile([[-15, 3], [14.5, 3], [16.5, 6.2], [11.5, 10.6], [-14.5, 10.6], [-16, 7]], -7.2, 7.2, M.hull, { top: M.lite });
  m.onTop(h, -13.5, -8, -5, 5, 10.6, M.metal);
  m.onTop(h, 6, 10.5, -6.6, 6.6, 10.6, tc.main);                       // team glacis band
  if (sub === 'bastion') {
    for (const s of [-1, 1]) {
      const sk = m.box(-14.5, 14.5, Math.min(s * 12.4, s * 13.8), Math.max(s * 12.4, s * 13.8), 1.6, 8.4, M.dark);
      m.onY(sk, -9, 9, 4, 6.8, s * 13.8, tc.main, false, s);
    }
    m.box(-13, -9, -6.8, -3.4, 10.6, 13, M.dark);                      // spare track links
  }
}

function ironSiegeTurret(m, tc, M, sub) {
  if (sub === 'bastion') {
    m.box(-11, -8, -5, 5, 11, 15.5, M.dark);
    const t = m.prism([[-8, -6.6], [4, -6.6], [8, -3.2], [8, 3.2], [4, 6.6], [-8, 6.6]], 10.6, 17.2, M.hull, { top: M.lite });
    m.onTop(t, -6.6, -1.4, -5, 5, 17.2, tc.main);
    m.box(-3, 1, 3, 5.4, 17.2, 19.4, M.metal);                         // roof gun
    m.box(6.6, 9, -3.2, 3.2, 11, 16.8, M.dark);                        // mantlet
    m.tag('steel');
    m.tubeX(9, 15.6, 0, 13.9, 2.2, M.metal, { n: 8 });                 // howitzer
    m.tubeX(14, 17.6, 0, 13.9, 3.1, '#34383c', { n: 8, cap: '#101214' });
    m.tag(null);
  } else {
    const b = m.cyl(0, 0, 6.2, 10.6, 13.4, M.hull, { n: 8, top: M.lite });   // coil tower base
    m.onTop(b, -4.4, -1.4, -3.2, 3.2, 13.4, tc.main);
    m.cyl(0, 0, 1.4, 13.4, 22, M.metal, { n: 6 });
    for (let i = 0; i < 3; i++) m.cyl(0, 0, 4.4 - i * 0.8, 14.2 + i * 2.6, 15.8 + i * 2.6, COPPER, { n: 8 });
    m.cyl(0, 0, 2.7, 21.4, 24.4, '#bfeaff', { n: 6, glow: true, top: WHITE_HOT });
    for (const y of [-3.4, 3.4]) m.box(3, 10, y - 0.8, y + 0.8, 11.6, 13.6, M.dark);   // discharge prongs
  }
}

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

// ============================================================ MERIDIAN ALLIANCE

function merTankHull(m, tc, M, sub) {
  const body = sub === 'shade' ? M.dark : M.hull;
  for (const s of [-1, 1]) {                                           // three axles
    const a = Math.min(s * 5, s * 7.8), b = Math.max(s * 5, s * 7.8);
    const w = m.box(-11.8, 11.8, a, b, 0, 4.4, M.metal, { top: '#454c53' });
    for (const x of [-8, 0, 8]) {
      m.onY(w, x - 2.2, x + 2.2, 0.3, 4.3, s * 7.8, '#1b1e21', false, s);
      m.onY(w, x - 0.9, x + 0.9, 1.4, 3.2, s * 7.8, '#aeb7bd', false, s);
    }
  }
  const h = m.profile([[-12, 2.4], [11, 2.4], [14.8, 4.4], [7, 8.2], [-10.5, 8.2], [-12.6, 5.6]], -5.6, 5.6, body, { top: sub === 'shade' ? M.hull : M.lite });
  m.onTop(h, -10, 6, -1.2, 1.2, 8.2, tc.main);                         // team spine stripe
  m.onY(h, -8.5, -2.5, 4.4, 6.8, 5.6, tc.main);
  m.onY(h, -8.5, -2.5, 4.4, 6.8, -5.6, tc.main, false, -1);
  m.onTop(h, -10, -7, -4.4, -2.2, 8.2, M.metal);                       // intake
  if (sub === 'aegis') {
    for (const s of [-1, 1]) {                                         // slat armour
      const p = m.box(-9.5, 9.5, Math.min(s * 7.8, s * 8.8), Math.max(s * 7.8, s * 8.8), 2.4, 7.2, M.lite);
      for (const x of [-7, -3, 1, 5]) m.onY(p, x, x + 0.7, 2.4, 7.2, s * 8.8, M.dark, false, s);
    }
    m.cyl(-8.6, 0, 3.2, 8.2, 9.4, M.dark, { n: 8 });                   // shield projector
    m.cyl(-8.6, 0, 2.6, 9.4, 11.4, '#dff3ff', { n: 8, r1: 1, glow: true });
  } else {
    m.box(-11.5, -10.9, 2.6, 3.2, 8.2, 18, M.metal);                   // sensor mast
    m.box(-12, -10.4, 2.1, 3.7, 17, 18.4, '#3ad1c4', { top: WHITE_HOT });
  }
}

function merTankTurret(m, tc, M, sub) {
  if (sub === 'shade') {
    const t = m.prism([[-6, -3.6], [1, -4.6], [6.5, -1.6], [6.5, 1.6], [1, 4.6], [-6, 3.6]], 8.2, 10.8, M.dark, { top: M.hull });
    m.onTop(t, -4.6, -1.6, -2.6, 2.6, 10.8, tc.main);
    m.tag('steel');
    m.tubeX(5.6, 15, 0, 9.65, 0.7, M.metal, { n: 8 });                 // long rifled gun
    m.tubeX(14, 20.5, 0, 9.65, 1.2, '#22262a', { n: 8, cap: '#0c0d0f' });   // suppressor
    m.tag(null);
  } else {
    const t = m.cyl(-1, 0, 4.9, 8.2, 11.6, M.hull, { n: 8, r1: 3.8, top: M.lite });
    m.onY(t, -3, 1, 9, 10.6, 4.3, tc.main);
    m.cyl(-1.6, 0, 2.4, 11.6, 12.3, tc.main, { n: 8 });                // team hatch ring
    m.box(-4.6, -2.4, 2.4, 4, 11.6, 13.6, M.dark);                     // optics box
    m.tag('steel');
    m.tubeX(3, 18, 0, 10.1, 0.9, M.metal, { n: 8 });
    m.tubeX(17, 19.5, 0, 10.1, 1.35, M.dark, { n: 8, cap: '#0c0d0f' });
    m.tag(null);
  }
}

function merBeamHull(m, tc, M, sub) {
  tracks(m, 12.5, 5.2, 8.8, 4.4, M, M.dark);
  fittings(m, 12.5, 6, 7.8, M);
  const h = m.profile([[-12, 2.2], [10.5, 2.2], [14, 4.2], [8, 7.8], [-11, 7.8], [-12.6, 5.4]], -6, 6, sub === 'shade' ? M.dark : M.hull, { top: sub === 'shade' ? M.hull : M.lite });
  m.onTop(h, 4.6, 6.4, -5.4, 5.4, 7.8, tc.main);                       // team chevron band
  const g = m.box(-11.4, -4.6, -5.2, 5.2, 7.8, 12.2, M.dark, { top: M.metal });   // reactor
  for (let x = -10.6; x < -5.4; x += 1.8) m.onTop(g, x, x + 0.8, -4.4, 4.4, 12.2, M.lite);
  m.onY(g, -10.6, -5.4, 9.2, 10.8, 5.2, tc.main);
  m.onY(g, -10.6, -5.4, 9.2, 10.8, -5.2, tc.main, false, -1);
  if (sub === 'aegis') {
    m.cyl(-8, 0, 3, 12.2, 14.6, '#dff3ff', { n: 8, r1: 1.2, glow: true });
  }
}

function merBeamTurret(m, tc, M, sub) {
  m.cyl(0, 0, 4.7, 7.8, 10.4, M.hull, { n: 8, top: M.lite });
  if (sub === 'shade') {
    m.box(-5.5, -2.5, -1.8, 1.8, 10.4, 12.8, M.dark);                  // scope housing
    m.tubeX(2, 17, 0, 10.4, 1, M.metal, { n: 8 });                     // lance barrel
    for (const x of [6, 10, 14]) m.box(x, x + 0.9, -1.8, 1.8, 8.8, 12, M.dark);
    m.prism([[16.6, 0], [18.6, -1.3], [20.6, 0], [18.6, 1.3]], 9, 11.8, '#d6fff9', { glow: true });
  } else {
    m.box(-5.5, -3, -2.4, 2.4, 10.4, 13.2, M.dark);
    for (const s of [-1, 1]) {                                         // emitter fork
      m.box(1, 12.5, Math.min(s * 2.4, s * 4), Math.max(s * 2.4, s * 4), 8.8, 11.7, M.lite);
      m.box(11.2, 13.6, Math.min(s * 2.1, s * 4.3), Math.max(s * 2.1, s * 4.3), 8.5, 12, tc.main);
    }
    m.prism([[6.6, 0], [9.3, -1.7], [12, 0], [9.3, 1.7]], 9, 12.6, '#eafcff', { glow: true });
  }
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

// ============================================================ VEIL COLLECTIVE

function veilTankHull(m, tc, M, sub) {
  m.cyl(0, 0, 12.5, 2.4, 4.4, M.metal, { n: 12, sy: 0.62 });           // hover skirt
  m.cyl(0, 0, 13.4, 4.4, 6, tc.main, { n: 12, sy: 0.62 });             // team band around the shell
  m.cyl(0, 0, 13.2, 6, 7.6, M.hull, { n: 12, sy: 0.62, r1: 12 });
  m.cyl(-1, 0, 11, 7.6, 10.4, M.lite, { n: 12, sy: 0.6, r1: 6.8, top: M.hull });   // carapace
  m.cyl(-3.6, 0, 5.2, 10.4, 11.2, tc.main, { n: 10, sy: 0.72 });       // team dorsal plate
  m.box(8.5, 15.5, -4.4, -2.6, 3.6, 6.4, M.dark);                      // uneven mandibles
  m.box(8.5, 13, 2.6, 4.4, 3.6, 6.4, M.dark);
  m.cyl(-2, 8.6, 3.3, 3.4, 9.4, M.dark, { n: 8 });                     // offset sensor pod
  if (sub === 'dominion') {
    for (const [x, h] of [[-3.6, 18], [-2, 20.5], [-0.4, 17]]) {
      m.box(x - 0.3, x + 0.3, 8.3, 8.9, 9.4, h, M.metal);
      m.box(x - 0.7, x + 0.7, 7.9, 9.3, h, h + 1.3, '#ff9be4', { top: WHITE_HOT });
    }
  } else {
    m.cyl(-2, 8.6, 2.6, 9.4, 10.6, '#7dffb0', { n: 8, glow: true });   // coolant cap
    m.cyl(-8, -5.4, 2.4, 5, 12, '#6b5540', { n: 8, top: '#8c7256' });  // reagent tank
    m.box(-10, -4, -8, -7, 6, 7.2, M.metal);
  }
}

function veilTankTurret(m, tc, M, sub) {
  if (sub === 'dominion') {
    m.cyl(0, 0, 3.8, 10.4, 13.6, M.hull, { n: 8, r1: 2.6, top: M.lite });
    m.box(2, 12.5, -2.8, -1.6, 11, 12.8, M.lite);                      // resonator fork
    m.box(2, 12.5, 1.6, 2.8, 11, 12.8, M.lite);
    m.cyl(12.6, 0, 2.1, 10.4, 13.6, '#f0c4ff', { n: 6, glow: true });
    m.box(-4.4, -3.8, -0.3, 0.3, 13.6, 19, M.metal);
  } else {
    m.cyl(0, 0, 4, 10.4, 13, M.metal, { n: 8, top: M.dark });
    m.cyl(-1, -4.6, 2.7, 9.6, 13.6, '#6b5540', { n: 8, top: '#8c7256' });   // feed drum, one side only
    for (const y of [-1.7, 0, 1.7]) m.tubeX(3, 14, y, 11.65, 0.62, M.metal, { n: 6 });   // tri-barrel
    m.box(12.6, 14.6, -2.6, 2.6, 10.5, 12.8, M.dark);
    m.cyl(-0.5, 0, 2.6, 13, 13.8, '#7dffb0', { n: 8, glow: true });
  }
}

function veilOrbHull(m, tc, M, sub) {
  m.cyl(0, 0, 14.5, 2.6, 4.6, M.metal, { n: 14, sy: 0.7 });
  m.cyl(0, 0, 15.2, 4.6, 6.2, tc.main, { n: 14, sy: 0.7 });            // team band around the rim
  m.cyl(0, 0, 15, 6.2, 7.4, M.hull, { n: 14, sy: 0.7, r1: 13.4 });
  m.cyl(0, 0, 13.4, 7.4, 9.6, M.lite, { n: 14, sy: 0.7, r1: 9, top: M.hull });
  m.cyl(0, 0, 9.4, 9.6, 10.3, tc.main, { n: 12, sy: 0.72 });           // team ring plate
  m.cyl(0, 0, 6, 10.3, 10.9, M.dark, { n: 10, sy: 0.72 });
  m.cyl(9, 7.5, 2.4, 4, 10, M.dark, { n: 6 });                         // lopsided outriggers
  m.cyl(-10.5, -6, 2, 4, 8.4, M.dark, { n: 6 });
  if (sub === 'forge') m.cyl(-10.5, -6, 2.6, 8.4, 9.4, '#7dffb0', { n: 6, glow: true });
}

function veilOrbTurret(m, tc, M, sub) {
  const core = sub === 'dominion' ? '#f0c4ff' : '#b8ffd6';
  for (let i = 0; i < 3; i++) {                                        // claw cradle
    const a = (i / 3) * TAU + 0.5;
    const x = Math.cos(a) * 5.4, y = Math.sin(a) * 5.4;
    m.box(x - 0.9, x + 0.9, y - 0.9, y + 0.9, 10.3, 15.5, M.lite);
  }
  if (sub === 'dominion') {                                            // the mind orb
    m.cyl(0, 0, 3.4, 13, 14.6, core, { n: 8, r1: 5.2, glow: true });
    m.cyl(0, 0, 5.2, 14.6, 18.2, core, { n: 8, glow: true });
    m.cyl(0, 0, 5.2, 18.2, 19.8, WHITE_HOT, { n: 8, r1: 3, glow: true });
    m.box(-0.3, 0.3, -0.3, 0.3, 19.8, 25, M.metal);
  } else {                                                             // caged reactor
    m.cyl(0, 0, 3.4, 12.6, 19, core, { n: 6, glow: true });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.3;
      const x = Math.cos(a) * 4.6, y = Math.sin(a) * 4.6;
      m.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, 12, 20, M.metal);
    }
    m.cyl(0, 0, 5.6, 20, 21.2, M.dark, { n: 8, top: '#6b5540' });
  }
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

const VEHICLES = {
  iron: {
    2: { hull: ironTankHull, turret: ironTankTurret, foot: [14.5, 12.5], spec: s => (s === 'bastion' ? { pivot: -1, muzzle: 21, mz: 12.2 } : { pivot: -1, muzzle: 19, mz: 12.2, glow: [18, 12.2, 3.4] }) },
    3: { hull: ironSiegeHull, turret: ironSiegeTurret, foot: [16.5, 14], spec: s => (s === 'bastion' ? { pivot: -1.5, muzzle: 17, mz: 14 } : { pivot: -1.5, muzzle: 0, mz: 23, glow: [0, 23, 5.5] }) },
  },
  meridian: {
    2: { hull: merTankHull, turret: merTankTurret, foot: [13, 9], spec: s => (s === 'shade' ? { pivot: -1, muzzle: 20.5, mz: 9.7 } : { pivot: -1, muzzle: 19.5, mz: 10.1 }) },
    3: { hull: merBeamHull, turret: merBeamTurret, foot: [13.5, 9.5], spec: s => (s === 'shade' ? { pivot: 1.5, muzzle: 19.5, mz: 10.4, glow: [18.6, 10.4, 3.4] } : { pivot: 1.5, muzzle: 11, mz: 10.9, glow: [9.3, 10.9, 4.4] }) },
  },
  veil: {
    2: { hull: veilTankHull, turret: veilTankTurret, foot: [13, 8.5], hover: 3.2, spec: s => (s === 'dominion' ? { pivot: 1, muzzle: 13, mz: 12, glow: [12.6, 12, 3.6] } : { pivot: 1, muzzle: 14.5, mz: 11.7 }) },
    3: { hull: veilOrbHull, turret: veilOrbTurret, foot: [15, 10.5], hover: 4, spec: s => ({ pivot: 0, muzzle: 0, mz: 16.5, glow: [0, 16.5, s === 'dominion' ? 7.5 : 5.5] }) },
  },
};

const SOLDIERS = { iron: ironSoldier, meridian: merSoldier, veil: veilSoldier };

/** { pivot, muzzle, mz, glow?, hover?, foot } — sockets used by the renderer. */
export function unitSpec(f, sub, level) {
  const v = VEHICLES[f][level];
  return { hover: v.hover || 0, foot: v.foot, ...v.spec(sub) };
}

export function buildHull(f, sub, level, tc) {
  const m = new Model();
  VEHICLES[f][level].hull(m, tc, FACTIONS[f].mat, sub);
  return m;
}

export function buildTurret(f, sub, level, tc) {
  const m = new Model();
  VEHICLES[f][level].turret(m, tc, FACTIONS[f].mat, sub);
  return m;
}

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
// Used by the WebGL renderer: the same three silhouettes as the sprites, built
// from boxes and tapered columns so they are lit and cast shadows like
// everything else. Four frames give the walk cycle (legs swing fore and aft).

const SKIN = '#d6ad88', BOOT = '#23261f', RIFLE = '#15171a';

function legs3d(m, sw, col, w = 1) {
  m.box(sw * 2.2 - 1, sw * 2.2 + 1, -2.1 * w, -0.3, 0, 5.6, col);
  m.box(-sw * 2.2 - 1, -sw * 2.2 + 1, 0.3, 2.1 * w, 0, 5.6, col);
  m.box(sw * 2.2 - 1.2, sw * 2.2 + 1.6, -2.2 * w, -0.2, 0, 1.3, BOOT);
  m.box(-sw * 2.2 - 1.2, -sw * 2.2 + 1.6, 0.2, 2.2 * w, 0, 1.3, BOOT);
}

const SOLDIER3D = {
  iron(m, tc, M, sub, sw) {
    legs3d(m, sw, '#2a2b28', 1.15);
    m.cyl(0, 0, 3.6, 4.2, 6.2, M.hull, { n: 6, r1: 3 });                 // greatcoat hem
    m.box(-1.9, 1.9, -3, 3, 6, 12, M.hull);
    m.box(-2.1, 2.1, -3.4, 3.4, 10.6, 12.2, tc.main);                    // shoulder boards
    m.box(-2, 2, -3.1, 3.1, 7.2, 8.2, BOOT);                             // belt
    if (sub === 'bastion') m.box(1.9, 2.5, -2.2, 2.2, 8.4, 11.4, M.lite);                 // breastplate
    else { m.box(-3.4, -1.9, -2, 2, 7.6, 12, COPPER); m.cyl(-2.7, 0, 0.7, 12, 15.4, '#bfeaff', { n: 5, glow: true }); }
    m.box(-1.3, 1.3, -1.3, 1.3, 12.2, 14.2, SKIN);
    m.cyl(0, 0, 3, 13.8, 14.5, M.dark, { n: 8 });                         // broad steel helmet
    m.cyl(0, 0, 2.3, 14.5, 15.9, M.dark, { n: 8, r1: 1.3, top: tc.main });
    m.box(1, 9, 1.9, 2.9, 9.2, 10.4, RIFLE);
    if (sub === 'volt') m.box(8.4, 10, 1.6, 3.2, 8.9, 10.7, '#bfeaff', { glow: true });
  },
  meridian(m, tc, M, sub, sw) {
    const cloth = sub === 'shade' ? M.dark : M.hull;
    legs3d(m, sw, '#3a4148', 0.95);
    m.box(-1.5, 1.5, -2.4, 2.4, 5.4, 11.6, cloth);
    m.box(-1.7, 1.7, -3, -1.7, 10.2, 12, tc.main);                       // shoulder pads
    m.box(-1.7, 1.7, 1.7, 3, 10.2, 12, tc.main);
    m.box(-3, -1.5, -1.7, 1.7, 6.8, 11.2, M.dark);                       // radio pack
    m.box(-2.7, -2.3, 1, 1.4, 11.2, 19.5, RIFLE);
    m.box(-1.2, 1.2, -1.2, 1.2, 11.8, 13.7, SKIN);
    m.cyl(0, 0, 2.1, 13.2, 15, sub === 'shade' ? M.dark : M.lite, { n: 8, r1: 1.4, top: tc.main });
    m.box(1, sub === 'shade' ? 11 : 8, 1.7, 2.4, 9.3, 10.2, RIFLE);
    if (sub === 'aegis') m.box(3.2, 3.7, -3.2, 3.2, 4.5, 12.5, '#dff3ff', { glow: true });   // projected arm shield
  },
  veil(m, tc, M, sub, sw) {
    m.cyl(sw * 0.5, 0, 4, 0.3, 11.8, M.hull, { n: 8, r1: 1.9 });           // robe to the ground, swaying
    m.box(1.2, 2.6, -1.1, 1.1, 1, 11.4, tc.main);                         // sash down the front
    m.cyl(0, 0, 2.5, 11.4, 12.6, tc.main, { n: 6 });                      // cowl trim
    m.cyl(0, 0, 2.3, 12.6, 17, M.dark, { n: 6, r1: 0.3 });                // pointed cowl
    m.box(1.7, 2.2, -1, 1, 13.2, 14, M.glow, { glow: true });             // eyes
    if (sub === 'dominion') {
      m.box(2.2, 2.9, 2.6, 3.3, 0, 19.5, RIFLE);                          // staff
      m.cyl(2.55, 2.95, 1.7, 19.5, 22.4, '#f0c4ff', { n: 6, glow: true });
    } else {
      m.box(-3.4, -1.6, -1.9, 1.9, 5.5, 11, '#6b5540');                   // reagent pack
      m.box(1, 8, 1.6, 3, 8.8, 10.6, '#8c7256');                          // grafted arm cannon
      m.box(7.6, 9, 1.4, 3.2, 8.6, 10.8, '#7dffb0', { glow: true });
    }
  },
};

/** One walk frame of an infantry figure as a 3D model. frame: 0..3. */
export function buildSoldier(f, sub, tc, frame) {
  const m = new Model();
  SOLDIER3D[f](m, tc, FACTIONS[f].mat, sub, [0, 1, 0, -1][frame]);
  return m;
}

/** Where an infantry weapon fires from, relative to the sprite anchor. */
export function soldierMuzzle(f, sub, dx, dy) {
  if (f === 'veil' && sub === 'dominion') return [dx * 3 - dy * 2.4, -19.6];
  const reach = f === 'meridian' && sub === 'shade' ? 10.5 : 8.5;
  return [dx * reach, -9.6 + dy * 3.4];
}
