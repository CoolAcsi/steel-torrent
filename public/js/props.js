// City scenery that is not a tower: shops, houses, sheds, yards.
//
// Each prop is one plot of the city, built as a Model from the same primitives as the bases
// and tagged with the same surface types, so the 3D renderer gives it the same authored
// materials (brick, corrugated sheet, timber, glass, concrete, steel...) and the canvas
// renderer can draw it as it draws everything else. Colours are low in saturation on purpose:
// the city is the backdrop, the factions and team colours are the subject.
//
// A plot is a square of side `a` turned 45 degrees to the paving, like a tower's. Seen from
// the camera the +x and +y faces are the ones in view, so fronts (shop windows, doors, roller
// shutters) are on those. All designs are original; signs and boards are blank.
import { Model } from './iso.js';

function seeded(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GLASS = '#1b2530', LIT = '#ffcf8a', IRON = '#2e3338', TYRE = '#1c1d1f';
const SLAB = '#7a8187', SLAB_TOP = '#8a9197';
const AWNING = ['#6f3a34', '#2f5648', '#7d7038', '#39496f'];
const CAR = ['#8d9296', '#5b6770', '#7a403a', '#b5b2a6', '#3f4c42', '#6c5f4a'];
const BOXES = ['#7b4c3d', '#3f5d6e', '#5c6b4a', '#8a7a4a', '#6a6f74', '#6b3f3a'];

/**
 * The kinds of plot.
 *   a, h      side of the plot and height of its tallest part, in ground units (what it may cover on screen);
 *             `hv` gives the height of each variant where they differ much
 *   variants  how many different models of the kind there are
 *   share     the most of the city's plots this kind may take (small plots fit anywhere; this keeps them from taking over)
 *   ground    what the plot stands on: 'asphalt', 'yard' (concrete), 'lawn' or 'paving' (left as it is)
 */
export const PROP_KINDS = {
  shops:        { a: 34, h: 21, hv: [14, 21, 11], variants: 3, ground: 'paving', share: 0.2 },
  houses:       { a: 34, h: 16, variants: 3, ground: 'lawn', share: 0.22 },
  warehouse:    { a: 40, h: 26, hv: [16, 26, 8], variants: 3, ground: 'yard', share: 0.2 },
  fuel:         { a: 36, h: 12, variants: 2, ground: 'asphalt', share: 0.07 },
  tanks:        { a: 38, h: 24, hv: [17, 24, 11], variants: 3, ground: 'yard', share: 0.12 },
  watertower:   { a: 24, h: 33, variants: 2, ground: 'paving', share: 0.04 },
  containers:   { a: 38, h: 19, variants: 3, ground: 'yard', share: 0.12 },
  parking:      { a: 38, h: 9,  variants: 3, ground: 'asphalt', share: 0.12 },
  substation:   { a: 32, h: 15, variants: 2, ground: 'yard', share: 0.06 },
  construction: { a: 38, h: 37, hv: [37, 20], variants: 2, ground: 'yard', share: 0.06 },
  plaza:        { a: 28, h: 13, variants: 3, ground: 'paving', share: 0.08 },
};

// ---------------------------------------------------------------- shapes the Model has no word for

/** A slab sloping across y from (y0, z0) to (y1, z1), `t` thick: an awning, a lean-to roof. */
function slopeY(m, x0, x1, y0, z0, y1, z1, t, c) {
  return m.solid([
    { p: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]], c },
    { p: [[x0, y0, z0 - t], [x1, y0, z0 - t], [x1, y1, z1 - t], [x0, y1, z1 - t]], c },
    { p: [[x0, y1, z1 - t], [x1, y1, z1 - t], [x1, y1, z1], [x0, y1, z1]], c },
    { p: [[x0, y0, z0 - t], [x1, y0, z0 - t], [x1, y0, z0], [x0, y0, z0]], c },
    { p: [[x0, y0, z0 - t], [x0, y1, z1 - t], [x0, y1, z1], [x0, y0, z0]], c },
    { p: [[x1, y0, z0 - t], [x1, y1, z1 - t], [x1, y1, z1], [x1, y0, z0]], c },
  ]);
}
/** The same, sloping across x. */
function slopeX(m, y0, y1, x0, z0, x1, z1, t, c) {
  return m.solid([
    { p: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [x1, y0, z1]], c },
    { p: [[x0, y0, z0 - t], [x0, y1, z0 - t], [x1, y1, z1 - t], [x1, y0, z1 - t]], c },
    { p: [[x1, y0, z1 - t], [x1, y1, z1 - t], [x1, y1, z1], [x1, y0, z1]], c },
    { p: [[x0, y0, z0 - t], [x0, y1, z0 - t], [x0, y1, z0], [x0, y0, z0]], c },
    { p: [[x0, y0, z0 - t], [x1, y0, z1 - t], [x1, y0, z1], [x0, y0, z0]], c },
    { p: [[x0, y1, z0 - t], [x1, y1, z1 - t], [x1, y1, z1], [x0, y1, z0]], c },
  ]);
}
/** Gable roof with the ridge running along y (Model.ridge runs along x). */
function ridgeY(m, x0, x1, y0, y1, z0, z1, c, gable) {
  const xm = (x0 + x1) / 2, g = gable || c;
  return m.solid([
    { p: [[x1, y0, z0], [x1, y1, z0], [xm, y1, z1], [xm, y0, z1]], c },
    { p: [[x0, y0, z0], [x0, y1, z0], [xm, y1, z1], [xm, y0, z1]], c },
    { p: [[x0, y1, z0], [x1, y1, z0], [xm, y1, z1]], c: g },
    { p: [[x0, y0, z0], [x1, y0, z0], [xm, y0, z1]], c: g },
  ]);
}

/** A parked vehicle, nose toward +x (or +y with `alongY`): 'car', 'van' or 'truck'. */
function vehicle(m, cx, cy, alongY, col, type = 'car') {
  const L = type === 'truck' ? 8.2 : type === 'van' ? 5.6 : 4.8, W = type === 'truck' ? 2.7 : 2.2;
  const bx = (l0, l1, w0, w1, z0, z1, c, o) => (alongY ? m.box(cx + w0, cx + w1, cy + l0, cy + l1, z0, z1, c, o) : m.box(cx + l0, cx + l1, cy + w0, cy + w1, z0, z1, c, o));
  m.tag('dark');
  bx(-L * 0.74, -L * 0.42, -W - 0.2, W + 0.2, 0, 1.6, TYRE);
  bx(L * 0.42, L * 0.74, -W - 0.2, W + 0.2, 0, 1.6, TYRE);
  if (type === 'truck') {
    m.tag('corrugated'); bx(-L, L * 0.38, -W, W, 1.3, 6.6, '#9a9b94', { top: '#84857f' });       // the box body
    m.tag('panel'); bx(L * 0.44, L, -W, W, 1.1, 4.9, col);
    m.tag('glass'); bx(L * 0.78, L + 0.06, -W + 0.3, W - 0.3, 3, 4.5, GLASS);
  } else {
    const van = type === 'van';
    m.tag('panel'); bx(-L, L, -W, W, 0.9, 2.8, col);
    m.tag('glass'); bx(van ? -L + 0.2 : -L * 0.56, L * 0.42, -W + 0.2, W - 0.2, 2.8, van ? 4.7 : 4.0, GLASS, { top: col });   // the roof is the body's colour
  }
  m.tag(null);
}

/** A shipping container, long side along x (or y). */
function container(m, x, y, z, alongY, col, len = 13) {
  const hl = len / 2, hw = 2.7, h = 5.6;
  m.tag('corrugated');
  const b = alongY ? m.box(x - hw, x + hw, y - hl, y + hl, z, z + h, col) : m.box(x - hl, x + hl, y - hw, y + hw, z, z + h, col);
  m.tag('steel');
  if (alongY) { m.onY(b, x - hw + 0.3, x + hw - 0.3, z + 0.3, z + h - 0.3, y + hl, '#3b3f43'); m.onY(b, x - 0.2, x + 0.2, z + 0.3, z + h - 0.3, y + hl, '#22252a'); }
  else { m.onX(b, y - hw + 0.3, y + hw - 0.3, z + 0.3, z + h - 0.3, x + hl, '#3b3f43'); m.onX(b, y - 0.2, y + 0.2, z + 0.3, z + h - 0.3, x + hl, '#22252a'); }
  m.tag(null);
}

/** A slim post with a lantern that is not lit: scenery lamps would compete with the street's. */
function post(m, x, y, h) { m.tag('steel'); m.cyl(x, y, 0.45, 0, h, IRON, { n: 5 }); m.box(x - 1.6, x + 1.6, y - 0.5, y + 0.5, h, h + 0.6, IRON); m.tag(null); }

/** Chain-link compound fence: posts and a rail on the two near sides and the two far ones. */
function fence(m, a, h, col = '#5c6468') {
  m.tag('steel');
  for (const s of [-1, 1]) {
    m.box(-a, a, s * a - 0.2, s * a + 0.2, h - 0.5, h, col);
    m.box(s * a - 0.2, s * a + 0.2, -a, a, h - 0.5, h, col);
    for (let k = -a; k <= a + 0.01; k += a) { m.box(k - 0.3, k + 0.3, s * a - 0.3, s * a + 0.3, 0, h, col); m.box(s * a - 0.3, s * a + 0.3, k - 0.3, k + 0.3, 0, h, col); }
  }
  m.tag(null);
}

// ---------------------------------------------------------------- the kinds

const BUILD = {
  // A row of shops under one roof; a two-storey corner shop; a covered market of stalls.
  shops(m, v, rnd) {
    if (v === 2) {
      m.tag('concrete'); m.box(-15, 15, -13, 13, 0, 0.7, SLAB, { top: SLAB_TOP });
      for (let i = 0; i < 4; i++) {
        const x = -9 + (i % 2) * 17, y = -7 + Math.floor(i / 2) * 13, c = AWNING[(i + 1) % 4];
        m.tag('wood'); m.box(x - 5, x + 5, y - 3, y + 3, 0.7, 3.6, '#6d573f', { top: '#7c6850' });
        m.tag('steel'); for (const [dx, dy] of [[-5.5, -3.5], [5.5, -3.5], [-5.5, 3.5], [5.5, 3.5]]) m.cyl(x + dx, y + dy, 0.3, 0.7, 8, IRON, { n: 4 });
        m.tag('cloth'); m.ridge(x - 6.4, x + 6.4, y - 4.4, y + 4.4, 8, 10.6, c, { gable: c });
        m.tag('wood'); m.box(x - 3.5, x - 0.5, y + 3.3, y + 5.6, 0.7, 2.4, '#7a6248'); m.box(x + 1, x + 4, y + 3.3, y + 5.2, 0.7, 1.9, '#5f4d3a');   // crates out front
      }
      m.tag(null);
      return;
    }
    const two = v === 1, BR = two ? '#8b7460' : '#7b5a4c', x0 = -15, x1 = 15, y0 = -10, y1 = 5, h = two ? 15.5 : 8.6;
    m.tag('concrete'); m.box(x0 - 1.5, x1 + 1.5, y0 - 1.5, y1 + 5.5, 0, 0.7, SLAB, { top: SLAB_TOP });
    m.tag('brick');
    const b = m.box(x0, x1, y0, y1, 0.7, h, BR);
    m.tag('roof'); m.box(x0 - 0.6, x1 + 0.6, y0 - 0.6, y1 + 0.6, h, h + 1.1, '#5d5a54', { top: '#474849' });
    for (let i = 0; i < 3; i++) {
      const a = x0 + 0.9 + i * 9.7, w = 8.8;
      m.tag('wood'); m.onY(b, a, a + w, 5.5, 7, y1, ['#5d4a38', '#3f4a44', '#4b4038'][(i + v) % 3]);     // fascia board
      m.onY(b, a + w - 2.3, a + w - 0.5, 0.7, 5.1, y1, '#4a3a2c');                                         // door
      m.tag('glass'); m.onY(b, a + 0.6, a + w - 2.8, 1.5, 5.1, y1, GLASS);                                 // shop window
      if ((i + v) % 3 !== 2) { m.tag('cloth'); slopeY(m, a, a + w, y1, 6.9, y1 + 3.6, 5.3, 0.3, AWNING[Math.floor(rnd() * 4)]); }
    }
    m.tag('wood'); m.onX(b, y0 + 3, y0 + 5.4, 0.7, 5.2, x1, '#4a3a2c');                                    // the side door
    m.tag('glass'); m.onX(b, y0 + 7.5, y1 - 2, 1.8, 5, x1, GLASS);
    if (two) {
      m.tag('glass');
      for (let i = 0; i < 5; i++) { const lit = rnd() < 0.2; m.onY(b, x0 + 2 + i * 5.7, x0 + 5.2 + i * 5.7, 9.6, 13.4, y1, lit ? LIT : GLASS, lit); }
      for (let i = 0; i < 2; i++) m.onX(b, y0 + 2.5 + i * 6.5, y0 + 6 + i * 6.5, 9.6, 13.4, x1, GLASS);
      m.tag('concrete'); m.onY(b, x0, x1, 7.4, 8.2, y1, '#b3ac9c'); m.onX(b, y0, y1, 7.4, 8.2, x1, '#b3ac9c');   // a stone band between the storeys
      m.tag('steel'); m.box(-4, 2, -6, -1, h + 1.1, h + 3.4, '#565b60', { top: '#44484c' }); m.cyl(8, -4, 1.6, h + 1.1, h + 4.6, '#73797e', { n: 8 });
    } else {
      m.tag('panel'); m.box(x0 + 3, x0 + 15, y1 - 1.1, y1 - 0.6, h + 1.1, h + 5, '#4c575d');                // a blank roof board on two posts
      m.tag('steel'); m.box(-7, -2, -7, -3, h + 1.1, h + 2.8, '#565b60', { top: '#44484c' });
    }
    m.tag(null);
  },

  // Pitched-roof houses: two detached, a terrace of three, or one larger with a garage and a car.
  houses(m, v, rnd) {
    const WALL = ['#b4ad9e', '#8b7460', '#a9a39a', '#9a8f80'], ROOFS = ['#5e4a42', '#4a4d52', '#59534a'];
    const house = (x0, x1, y0, y1, h, alongX, wall, roofC, rise = 4.6) => {
      m.tag(wall === '#8b7460' ? 'brick' : 'concrete');
      const b = m.box(x0, x1, y0, y1, 0, h, wall);
      m.tag('corrugated');
      if (alongX) m.ridge(x0 - 0.8, x1 + 0.8, y0 - 0.9, y1 + 0.9, h, h + rise, roofC, { gable: wall });
      else ridgeY(m, x0 - 0.9, x1 + 0.9, y0 - 0.8, y1 + 0.8, h, h + rise, roofC, wall);
      m.tag('wood'); m.onY(b, x0 + 1.2, x0 + 3.2, 0, 4.4, y1, '#4c3b2d');
      m.tag('glass');
      const lit = rnd() < 0.25;
      m.onY(b, x1 - 4.6, x1 - 1.4, 1.6, 4.6, y1, lit ? LIT : GLASS, lit);
      m.onX(b, y0 + 1.5, y0 + 4.5, 1.6, 4.6, x1, GLASS);
      if (y1 - y0 > 9) m.onX(b, y1 - 4.5, y1 - 1.5, 1.6, 4.6, x1, GLASS);
      m.tag('brick'); m.box(x0 + 2, x0 + 3.6, y0 + 1.5, y0 + 3.1, h, h + rise + 1.6, '#6f5347');            // chimney
      m.tag(null);
    };
    const hedge = (x0, x1, y0, y1) => { m.tag('foliage'); m.box(x0, x1, y0, y1, 0, 2.2, '#3a5a38', { top: '#44683f' }); m.tag(null); };
    if (v === 0) {
      house(-14, -2, -12, -2, 6.6, true, WALL[0], ROOFS[0]);
      house(2, 13, 0, 12, 6.6, false, WALL[1], ROOFS[1]);
      hedge(-15, -1, 5, 6.4); hedge(1, 14.5, -13, -11.6);
      m.tag('wood'); m.box(-12, -7, 8, 12, 0, 3.6, '#6d573f', { top: '#5a4937' });                          // a shed
      vehicle(m, 7, -6, false, CAR[2]);
    } else if (v === 1) {
      for (let i = 0; i < 3; i++) house(-15 + i * 10.2, -5.6 + i * 10.2, -9, 1, 9 + (i % 2) * 0.8, true, WALL[i % 2 ? 2 : 3], ROOFS[2], 4);
      m.tag('wood'); for (let i = 0; i < 3; i++) m.box(-15 + i * 10.2, -14.6 + i * 10.2, 1, 9, 0, 2.4, '#6b5a47');   // garden fences
      m.box(-15, 15.6, 8.8, 9.2, 0, 2.4, '#6b5a47');
      hedge(-13, -7, 4, 6.5); hedge(8, 14, 4, 6.5);
      m.tag(null);
    } else {
      house(-13, 3, -11, 1, 7.4, true, WALL[2], ROOFS[1], 5.2);
      m.tag('concrete'); const g = m.box(5, 13, -9, 0, 0, 5, WALL[2]);
      m.tag('roof'); m.box(4.6, 13.4, -9.4, 0.4, 5, 5.6, '#56544f');
      m.tag('steel'); m.onY(g, 6, 12, 0, 4.2, 0, '#6e7376');                                                // garage door
      vehicle(m, 9, 6, true, CAR[4]);
      hedge(-15, -3, 10, 11.6); hedge(-15, -13.6, 3, 10);
      m.tag('wood'); m.box(-9, -5, 4, 7, 0, 1.2, '#7a6248'); m.box(-7.6, -6.4, 4.6, 6.4, 1.2, 1.5, '#8a7256');   // garden table
      m.tag(null);
    }
  },

  // Sheds: a ridged warehouse with a loading dock and a lorry; a brick-footed works with north lights; a long low depot.
  warehouse(m, v, rnd) {
    const SHEET = ['#7d858a', '#8a8576', '#5f7078'][v], DOOR = '#4b5055';
    if (v === 0) {
      m.tag('corrugated');
      const b = m.box(-18, 16, -15, 7, 0, 10.5, SHEET);
      m.ridge(-18.6, 16.6, -15.6, 7.6, 10.5, 14.6, '#6a7074', { gable: SHEET });
      m.tag('steel');
      for (let i = 0; i < 3; i++) { m.onY(b, -15 + i * 10.4, -8 + i * 10.4, 2.2, 8.4, 7, DOOR); }                 // roller shutters above the dock
      m.onX(b, -9, -3, 0, 7, 16, DOOR);
      m.tag('concrete'); m.box(-18, 16, 7, 12, 0, 2.2, '#8b8f90', { top: '#9a9e9f' });                           // the dock
      m.tag('wood'); m.box(-14, -10, 8, 11, 2.2, 5, '#7a6248'); m.box(-9, -6, 8.4, 10.8, 2.2, 4.2, '#6d573f'); m.box(2, 5.4, 8, 11, 2.2, 3.6, '#7a6248');
      m.tag('steel'); for (const x of [-10, 2, 12]) m.cyl(x, -4, 1.3, 12.4, 15.6, '#70777d', { n: 6 });           // roof vents
      vehicle(m, 9, 16.5, false, CAR[0], 'truck');
    } else if (v === 1) {
      m.tag('brick'); const b = m.box(-17, 15, -14, 8, 0, 4.2, '#6f5347');
      m.tag('corrugated'); const u = m.box(-17, 15, -14, 8, 4.2, 9.6, SHEET);
      for (let i = 0; i < 4; i++) {                                    // north-light roof: four teeth, glazed on the steep side
        const x = -17 + i * 8;
        m.tag('corrugated'); slopeX(m, -14, 8, x, 9.6, x + 8, 13.4, 0.4, '#666b6e');
        m.tag('glass'); m.box(x + 7.6, x + 8, -14, 8, 9.6, 13.4, '#2a3640');
      }
      m.tag('steel'); m.onY(b, -13, -6, 0, 4, 8, DOOR); m.onY(u, -13, -6, 4.2, 6.8, 8, DOOR); m.onY(b, 4, 11, 0, 4, 8, DOOR); m.onY(u, 4, 11, 4.2, 6.8, 8, DOOR);
      m.tag('glass'); for (let i = 0; i < 4; i++) { const lit = i === 1 && rnd() < 0.5; m.onX(u, -12 + i * 5.2, -8.6 + i * 5.2, 5.4, 8.4, 15, lit ? LIT : GLASS, lit); }
      m.tag('brick'); m.cyl(-13, -10, 2, 0, 24, '#7b5a4c', { n: 8, r1: 1.5 });                                    // the works chimney
      m.tag('steel'); m.cyl(-13, -10, 1.8, 24, 25.2, '#2c2f33', { n: 8 });
      m.tag('wood'); m.box(-2, 2, 10, 14, 0, 2.6, '#7a6248'); m.box(-1.4, 1.4, 10.6, 13.4, 2.6, 4.8, '#6d573f');
    } else {
      m.tag('corrugated');
      const b = m.box(-19, 17, -8, 4, 0, 7.4, SHEET, { top: '#5b6266' });
      slopeY(m, -19, 17, 4, 7.4, 12, 6.2, 0.4, '#666b6e');                                                        // a canopy along the whole front
      m.tag('steel'); for (let x = -18; x <= 16; x += 8.5) m.cyl(x, 11.4, 0.4, 0, 6, IRON, { n: 4 });
      for (let i = 0; i < 4; i++) m.onY(b, -17 + i * 8.6, -11.4 + i * 8.6, 0, 5.6, 4, DOOR);
      vehicle(m, -8, 8, false, CAR[1], 'van'); vehicle(m, 6, 8, false, CAR[3], 'van');
      m.tag('wood'); m.box(12, 16, 13, 17, 0, 2.6, '#7a6248'); m.box(-17, -13, 13, 16.5, 0, 3.4, '#6d573f');
    }
    m.tag(null);
  },

  // Filling station: a flat canopy on steel columns over the pumps, a glazed kiosk, a blank price board.
  fuel(m, v, rnd) {
    const islands = v ? [-5, 6] : [0], C = '#b7b9b5';
    m.tag('panel');
    const cx0 = -13, cx1 = 9, cy0 = islands[0] - 6, cy1 = islands[islands.length - 1] + 6;
    const can = m.box(cx0, cx1, cy0, cy1, 8.6, 10.2, C, { top: '#8f928f' });
    m.onY(can, cx0, cx1, 9, 9.7, cy1, '#5f7078'); m.onX(can, cy0, cy1, 9, 9.7, cx1, '#5f7078');                 // one muted band round the fascia
    for (const y of islands) {
      m.tag('concrete'); m.box(-11, 7, y - 1.3, y + 1.3, 0, 0.8, '#8b8f90', { top: '#9a9e9f' });
      m.tag('steel'); m.cyl(-10, y, 0.5, 0.8, 8.6, '#70777d', { n: 6 }); m.cyl(6, y, 0.5, 0.8, 8.6, '#70777d', { n: 6 });
      m.tag('panel'); for (const x of [-5, 1]) { const p = m.box(x - 0.9, x + 0.9, y - 0.7, y + 0.7, 0.8, 4.4, '#9aa0a2', { top: '#7c8284' }); m.tag('glass'); m.onY(p, x - 0.6, x + 0.6, 3, 4, y + 0.7, GLASS); m.tag('panel'); }
    }
    m.tag('concrete'); const k = m.box(11, 17, -6, 4, 0, 6.2, '#a9a39a');
    m.tag('roof'); m.box(10.4, 17.6, -6.6, 4.6, 6.2, 6.9, '#56544f');
    { const lit = rnd() < 0.5; m.tag('glass'); m.onY(k, 11.8, 16.2, 1.6, 5, 4, lit ? LIT : GLASS, lit); m.onX(k, -5, 1, 1.6, 5, 17, GLASS); }
    m.tag('steel'); m.cyl(-15, cy1 + 4, 0.5, 0, 11, IRON, { n: 5 });
    m.tag('panel'); m.box(-17, -13, cy1 + 3.7, cy1 + 4.3, 6, 11.4, '#4c575d');                                    // price board, blank
    vehicle(m, -3, islands[0] + 4, false, CAR[v ? 5 : 1]);
    if (v) vehicle(m, 2, islands[1] - 4.2, false, CAR[0], 'truck');
    m.tag(null);
  },

  // Tank farm: upright storage tanks inside a bund with pipework; a row of silos with a conveyor; pressure vessels on saddles.
  tanks(m, v, rnd) {
    if (v === 0) {
      for (const [x, y, r, h] of [[-8, -6, 8, 15], [8, 4, 6.5, 12], [-9, 10, 4.5, 9]]) {
        m.tag('plating'); m.cyl(x, y, r, 0, h, '#aeb2ae', { n: 10 });
        m.cyl(x, y, r, h, h + 1.6, '#9da19d', { n: 10, r1: r * 0.25 });
        m.tag('steel'); m.cyl(x, y, r + 0.25, h * 0.48, h * 0.48 + 0.7, '#6c7275', { n: 10 });                    // a stiffening ring
        m.box(x + r - 0.2, x + r + 0.9, y - 0.5, y + 0.5, 0, h + 0.6, '#4c5155');                                 // the ladder
      }
      m.tag('steel'); m.tubeX(-2, 8, 2, 1.6, 0.7, '#70777d', { n: 6 }); m.tubeY(-6, 10, -15, 1.6, 0.7, '#70777d', { n: 6 }); m.tubeY(4, 16, 13, 1.6, 0.7, '#70777d', { n: 6 });
      m.tag('concrete'); for (const s of [-1, 1]) { m.box(-17, 17, s * 17 - 0.5, s * 17 + 0.5, 0, 2, '#8b8f90'); m.box(s * 17 - 0.5, s * 17 + 0.5, -17, 17, 0, 2, '#8b8f90'); }
    } else if (v === 1) {
      for (let i = 0; i < 4; i++) {
        const x = -12 + i * 7.6;
        m.tag('corrugated'); m.cyl(x, -5, 3.5, 5, 19, '#a7aaa3', { n: 10 });
        m.tag('plating'); m.cyl(x, -5, 3.5, 19, 21.6, '#969a94', { n: 10, r1: 0.6 }); m.cyl(x, -5, 1, 1.6, 5, '#969a94', { n: 8, r1: 3.5 });   // roof and hopper
        m.tag('steel'); for (const [dx, dy] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) m.cyl(x + dx, -5 + dy, 0.35, 0, 6, IRON, { n: 4 });
      }
      m.tag('steel'); m.box(-14, 13, -5.6, -4.4, 21.6, 22.6, '#565b60');                                          // catwalk over the tops
      slopeX(m, 4, 6.4, -16, 3, 14, 23, 1.2, '#6c7275');                                                           // conveyor up from the intake
      m.tag('corrugated'); m.box(-17, -11, 2, 9, 0, 4.4, '#8a8576', { top: '#6a665a' });
      vehicle(m, 6, 11, false, CAR[3], 'truck');
    } else {
      for (let i = 0; i < 3; i++) {
        const y = -10 + i * 9.5;
        m.tag('plating'); m.tubeX(-11, 9, y, 5.4, 3.4, '#b1b5b1', { n: 10, cap: '#a0a4a0' });
        m.tag('concrete'); m.box(-8.4, -6.6, y - 3, y + 3, 0, 3.2, '#8b8f90'); m.box(4.6, 6.4, y - 3, y + 3, 0, 3.2, '#8b8f90');
        m.tag('steel'); m.cyl(-1, y, 0.8, 8.4, 10.4, '#70777d', { n: 6 });
      }
      m.tag('steel'); m.tubeY(-10, 9, -1, 10, 0.6, '#70777d', { n: 6 }); m.tubeY(-12, 12, 12, 1.4, 0.7, '#70777d', { n: 6 });
      m.tag('brick'); const h = m.box(11, 17, 8, 15, 0, 5.6, '#7b5a4c'); m.tag('roof'); m.box(10.6, 17.4, 7.6, 15.4, 5.6, 6.2, '#56544f');
      m.tag('wood'); m.onY(h, 12, 14, 0, 4.2, 15, '#4a3a2c');
      void rnd;
    }
    m.tag(null);
  },

  // Water tower: a timber-staved tank on a steel trestle; or a steel bulb on a single column.
  watertower(m, v) {
    if (v === 0) {
      m.tag('concrete'); m.box(-8, 8, -8, 8, 0, 0.8, SLAB, { top: SLAB_TOP });
      m.tag('steel');
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.cyl(sx * 5.4, sy * 5.4, 0.55, 0.8, 18.4, '#4c5155', { n: 4 });
      for (const z of [7, 13]) { m.box(-5.6, 5.6, -5.8, -5.2, z, z + 0.5, '#4c5155'); m.box(-5.6, 5.6, 5.2, 5.8, z, z + 0.5, '#4c5155'); m.box(-5.8, -5.2, -5.6, 5.6, z, z + 0.5, '#4c5155'); m.box(5.2, 5.8, -5.6, 5.6, z, z + 0.5, '#4c5155'); }
      m.cyl(0, 0, 0.8, 0.8, 18.4, '#70777d', { n: 6 });                                                           // riser pipe
      m.box(-7.4, 7.4, -7.4, 7.4, 18.4, 19.2, '#565b60');
      m.tag('wood'); m.cyl(0, 0, 7, 19.2, 27.6, '#7d6a52', { n: 10 });
      m.tag('steel'); for (const z of [21, 24.4]) m.cyl(0, 0, 7.15, z, z + 0.45, '#3a3e42', { n: 10 });           // hoops
      m.tag('corrugated'); m.cyl(0, 0, 7.6, 27.6, 31.4, '#5d5f5e', { n: 10, r1: 0.5 });
    } else {
      m.tag('concrete'); m.cyl(0, 0, 5, 0, 1.2, SLAB, { n: 8, top: SLAB_TOP });
      m.tag('plating');
      m.cyl(0, 0, 2, 1.2, 17, '#a9adaa', { n: 10, r1: 1.7 });
      m.cyl(0, 0, 1.7, 17, 21, '#a9adaa', { n: 10, r1: 8 });
      m.cyl(0, 0, 8, 21, 26, '#b3b7b3', { n: 10 });
      m.cyl(0, 0, 8, 26, 29.4, '#a3a7a4', { n: 10, r1: 2.4 });
      m.tag('steel'); m.cyl(0, 0, 8.2, 23, 23.6, '#6c7275', { n: 10 }); m.cyl(0, 0, 0.4, 29.4, 32.4, IRON, { n: 4 });
      m.box(1.8, 2.8, -0.5, 0.5, 1.2, 21, '#4c5155');                                                              // ladder
    }
    m.tag(null);
  },

  // Container yard: stacks one to three high, in the colours boxes fade to; one variant with a lorry being loaded.
  containers(m, v, rnd) {
    const col = () => BOXES[Math.floor(rnd() * BOXES.length)];
    if (v === 0) {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) { const n = 1 + Math.floor(rnd() * 3); for (let k = 0; k < n; k++) container(m, -7.5 + c * 14, -11 + r * 6.2, k * 5.6, false, col()); }
      container(m, 12, 12, 0, true, col(), 9);
    } else if (v === 1) {
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { const n = 1 + Math.floor(rnd() * 2.6); for (let k = 0; k < n; k++) container(m, -11 + c * 6.2, -8 + r * 14, k * 5.6, true, col()); }
      vehicle(m, 11, -4, true, CAR[1], 'truck');
      m.tag('wood'); m.box(8, 12, 9, 13, 0, 2.4, '#7a6248');
    } else {
      for (let c = 0; c < 2; c++) for (let k = 0; k < 3 - c; k++) container(m, -6, -10 + c * 6.2, k * 5.6, false, col());
      for (let k = 0; k < 2; k++) container(m, 4, 6, k * 5.6, false, col());
      container(m, -12, 9, 0, true, col(), 9);
      // a gantry over the stack: two legs and a beam
      m.tag('steel'); m.box(-15, -13.6, -15, -13.6, 0, 17.6, '#8a7a4a'); m.box(3, 4.4, -15, -13.6, 0, 17.6, '#8a7a4a'); m.box(-15.6, 5, -15.4, -13.2, 17.6, 19, '#8a7a4a', { top: '#6f6238' });
    }
    m.tag(null);
  },

  // Car park: two rows of parked vehicles, a kerb, an attendant's hut and unlit posts.
  parking(m, v, rnd) {
    m.tag('concrete');
    for (const s of [-1, 1]) m.box(-17, 17, s * 17 - 0.5, s * 17 + 0.5, 0, 0.8, '#8f959a');
    m.box(-17.5, -16.5, -17, 17, 0, 0.8, '#8f959a');
    const fill = [0.85, 0.55, 0.7][v];
    for (let i = 0; i < 6; i++) {
      for (const row of [-9.5, 9.5]) {
        if (rnd() > fill) continue;
        const k = rnd(), type = k > 0.86 ? 'van' : 'car';
        vehicle(m, -13.5 + i * 5.3, row + (row < 0 ? 1 : -1) * (type === 'van' ? 0.6 : 0), true, CAR[Math.floor(rnd() * CAR.length)], type);
      }
    }
    if (v === 2) vehicle(m, 3, 0, false, CAR[0], 'truck');
    m.tag('wood'); const h = m.box(13.4, 17, -2.4, 2.4, 0, 5.2, '#6d6a60', { top: '#4f4d47' });
    m.tag('glass'); m.onX(h, -1.6, 1.6, 2, 4.4, 17, GLASS); m.onY(h, 14, 16.4, 2, 4.4, 2.4, GLASS);
    m.tag('steel'); m.box(9, 13.4, -0.25, 0.25, 2.2, 2.7, '#b9b08a');                                              // barrier arm
    post(m, -16, -16, 8.4); post(m, -16, 16, 8.4);
    m.tag(null);
  },

  // Substation: transformers with finned coolers and bushings behind a fence, a busbar gantry, a brick switch house.
  substation(m, v, rnd) {
    const T = '#69736c';
    for (let i = 0; i < (v ? 3 : 2); i++) {
      const x = v ? -9 + i * 8.5 : -7 + i * 11, y = v ? -5 : -3;
      m.tag('concrete'); m.box(x - 3.6, x + 3.6, y - 3, y + 3, 0, 0.9, '#8b8f90');
      m.tag('panel'); m.box(x - 2.6, x + 2.6, y - 2.2, y + 2.2, 0.9, 6.4, T, { top: '#59625c' });
      m.tag('corrugated'); m.box(x - 3.4, x - 2.6, y - 1.8, y + 1.8, 1.4, 5.6, '#59625c'); m.box(x + 2.6, x + 3.4, y - 1.8, y + 1.8, 1.4, 5.6, '#59625c');   // cooling fins
      m.tag('copper'); for (const dy of [-1.3, 0, 1.3]) m.cyl(x, y + dy, 0.4, 6.4, 9, '#b7b2a4', { n: 6, r1: 0.25 });
    }
    m.tag('steel');
    m.cyl(-12, 7, 0.5, 0, 12.6, '#5c6468', { n: 5 }); m.cyl(10, 7, 0.5, 0, 12.6, '#5c6468', { n: 5 });
    m.box(-13, 11, 6.6, 7.4, 12.6, 13.4, '#5c6468');
    m.tag('copper'); for (const x of [-7, -1, 5]) m.cyl(x, 7, 0.45, 10.6, 12.6, '#b7b2a4', { n: 6 });              // insulators hanging from the beam
    m.tag('brick'); const h = m.box(v ? 6 : 8, 14, -13, -6, 0, 6, '#7b5a4c');
    m.tag('roof'); m.box(v ? 5.6 : 7.6, 14.4, -13.4, -5.6, 6, 6.7, '#56544f');
    m.tag('steel'); m.onY(h, 9.4, 11.6, 0, 4.4, -6, '#4b5055');
    fence(m, 15, 5.2);
    void rnd;
  },

  // Building site: a concrete frame going up with scaffold on one face, a tower crane, a hut and piles of material.
  construction(m, v, rnd) {
    const floors = v ? 2 : 3, FH = 7;
    m.tag('concrete');
    for (let f = 0; f <= floors; f++) { if (f) m.box(-13, 5, -13, 5, f * FH - 0.9, f * FH, '#9a9c98', { top: '#a8aaa6' }); }
    for (const x of [-12, -4, 4]) for (const y of [-12, -4, 4]) m.cyl(x, y, 0.75, 0, floors * FH - 0.9, '#8d8f8b', { n: 4, rot: Math.PI / 4 });
    m.cyl(-4, -4, 2.4, 0, floors * FH + 4, '#8a8c88', { n: 4, rot: Math.PI / 4 });                                // the core, a storey ahead of the slabs
    m.tag('steel');                                                                                                 // scaffold on the +y face
    for (let x = -13; x <= 5; x += 4.5) m.cyl(x, 6.6, 0.22, 0, floors * FH + 1, '#7f868b', { n: 4 });
    m.tag('wood'); for (let f = 1; f <= floors; f++) m.box(-13, 5, 5.6, 7.4, f * FH - 2.6, f * FH - 2.3, '#8a7256');
    m.tag('cloth'); m.box(-13, -4, 7.3, 7.5, FH, floors * FH - 0.4, '#5d7068');                                    // debris netting on part of it
    if (!v) {                                                        // tower crane: mast, jib, counter-jib and ballast
      m.tag('steel');
      m.cyl(11, -10, 1, 0, 33, '#9c8a46', { n: 4, rot: Math.PI / 4 });
      m.box(-12, 12.4, -10.6, -9.4, 33, 34.2, '#9c8a46');
      m.box(12.4, 19, -10.6, -9.4, 33, 34.2, '#9c8a46');
      m.cyl(11, -10, 0.5, 34.2, 37, '#9c8a46', { n: 4 });
      m.box(10.2, 11.8, -11.6, -10.6, 30.4, 33, '#565b60');                                                        // cab
      m.box(-4.2, -3.8, -10.2, -9.8, 22, 33, '#1c1d1f');                                                           // hoist rope
      m.tag('concrete'); m.box(15.4, 18.6, -11.2, -8.8, 30.6, 33, '#8b8f90');
    } else {
      m.tag('steel'); m.box(8.4, 9.6, -8.6, -7.4, 0, floors * FH + 5, '#9c8a46'); m.box(5, 9.6, -8.4, -7.6, floors * FH + 4, floors * FH + 5, '#9c8a46');   // a goods hoist
    }
    m.tag('corrugated'); const hut = m.box(8, 17, 8, 13, 0, 5, '#7f8a84', { top: '#5f6965' });
    m.tag('glass'); m.onY(hut, 9, 12, 2, 4.2, 13, GLASS);
    m.tag('brick'); m.box(9, 13, 0, 3.4, 0, 2.6, '#7b5a4c'); m.box(14, 17, 0.4, 3, 0, 1.9, '#84604f');             // pallets of brick
    m.tag('concrete'); m.cyl(13, -1.5 - 3, 3.6, 0, 3.2, '#b3a686', { n: 8, r1: 0.3 });                             // a heap of sand
    m.tag('steel'); m.tubeX(-12, 0, 11.5, 0.8, 0.8, '#70777d', { n: 6 }); m.tubeX(-12, 0, 13.3, 0.8, 0.8, '#70777d', { n: 6 }); m.tubeX(-11, 1, 12.4, 2.2, 0.8, '#70777d', { n: 6 });   // pipe stack
    void rnd;
    m.tag(null);
  },

  // A small square: a kiosk and benches; a blank hoarding and a bus shelter; a fountain with planters.
  plaza(m, v, rnd) {
    const bench = (x, y, alongY) => { m.tag('wood'); if (alongY) { m.box(x - 0.9, x + 0.9, y - 2.4, y + 2.4, 1, 1.4, '#7a6248'); m.box(x - 1, x - 0.7, y - 2.4, y + 2.4, 1.4, 2.6, '#7a6248'); } else { m.box(x - 2.4, x + 2.4, y - 0.9, y + 0.9, 1, 1.4, '#7a6248'); m.box(x - 2.4, x + 2.4, y - 1, y - 0.7, 1.4, 2.6, '#7a6248'); } m.tag(null); };
    const planter = (x, y) => { m.tag('concrete'); m.box(x - 2, x + 2, y - 2, y + 2, 0, 1.6, '#9a9e9f'); m.tag('foliage'); m.box(x - 1.6, x + 1.6, y - 1.6, y + 1.6, 1.6, 3.4, '#3a5a38', { top: '#44683f' }); m.tag(null); };
    if (v === 0) {
      m.tag('wood'); const k = m.cyl(0, -2, 4.4, 0, 6, '#6d6a60', { n: 8, rot: Math.PI / 8 });
      m.tag('cloth'); m.cyl(0, -2, 6, 6, 9.6, AWNING[Math.floor(rnd() * 4)], { n: 8, r1: 0.6 });
      m.tag('glass'); m.onY(k, -1.5, 1.5, 2.4, 4.8, 2.08, GLASS);
      bench(-8, 6, false); bench(7, 7, false); bench(9, -4, true);
      planter(-9, -8); planter(9, -11);
      post(m, -11, 10, 8.4);
    } else if (v === 1) {
      m.tag('steel'); m.cyl(-9, -6, 0.5, 0, 6, IRON, { n: 5 }); m.cyl(1, -6, 0.5, 0, 6, IRON, { n: 5 });
      m.tag('panel'); const b = m.box(-11, 3, -6.4, -5.6, 5.2, 12.6, '#3f474c');
      m.onY(b, -10.3, 2.3, 5.9, 11.9, -5.6, '#7d8588');                                                           // the hoarding: a pale blank sheet in a dark frame
      m.tag('steel');                                                                                              // bus shelter: frame, glass back, flat roof, a bench
      for (const x of [4, 12]) for (const y of [4.6, 8]) m.cyl(x, y, 0.25, 0, 5.4, IRON, { n: 4 });
      m.tag('glass'); m.box(4, 12, 4.4, 4.7, 1, 5.2, '#2a3640');
      m.tag('panel'); m.box(3.4, 12.6, 4, 8.6, 5.4, 5.9, '#5a6064');
      bench(8, 6.2, false);
      planter(-8, 7);
      post(m, 0, 10, 8.4);
    } else {
      m.tag('concrete'); m.cyl(0, 0, 8, 0, 1.8, '#9a9e9f', { n: 10 });
      m.tag('glass'); m.cyl(0, 0, 7, 1.2, 1.5, '#3d5661', { n: 10 });                                              // water
      m.tag('concrete'); m.cyl(0, 0, 1.6, 1.2, 5, '#a4a8a8', { n: 8, r1: 1 }); m.cyl(0, 0, 3, 5, 5.7, '#a4a8a8', { n: 8 });
      bench(-11, 0, true); bench(0, 11.5, false); bench(11, 0, true);
      planter(-10, -10); planter(10, -10); planter(-10, 10); planter(10, 10);
    }
  },
};

const cache = new Map();

/** The Model of one plot. Models are built once and shared, so identical plots instance. */
export function propModel(kind, variant = 0) {
  const K = PROP_KINDS[kind];
  if (!K) throw new Error(`no such scenery kind: ${kind}`);
  const v = ((variant % K.variants) + K.variants) % K.variants, key = `${kind}|${v}`;
  let m = cache.get(key);
  if (!m) {
    m = new Model();
    BUILD[kind](m, v, seeded(kind.length * 977 + kind.charCodeAt(0) * 131 + v * 17 + 3));
    cache.set(key, m);
  }
  return m;
}
