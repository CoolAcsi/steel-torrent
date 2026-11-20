// Office-tower surfaces for the proofs of concept, drawn procedurally.
//
// One tile is 4 bays by 4 floors, so lit rooms and blinds do not repeat too
// obviously. Three maps per look: colour, light (lit rooms) and roughness
// (glass is smooth and reflects the sky, stone is rough). Original artwork:
// banded stone piers and spandrels with ribbon windows.

const LOOKS = [
  { wall: '#5d5851', pier: '#7b766d', band: '#9a968d', glass: '#141a22', glassHi: '#2b3848' },   // brown stone
  { wall: '#50565d', pier: '#727981', band: '#a0a7ae', glass: '#10161d', glassHi: '#283646' },   // blue-grey concrete
  { wall: '#686155', pier: '#8a8272', band: '#b0a998', glass: '#171b20', glassHi: '#2f3944' },   // sandstone
];
export const ROOF = ['#64625e', '#5c6167', '#6d6962'];
export const TILE = { bays: 4, floors: 4 };

function seeded(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @returns { albedo, light, rough }: three 256x256 canvases that tile in both directions */
export function facadeTextures(look) {
  const L = LOOKS[look], S = 256, bw = S / TILE.bays, fh = S / TILE.floors;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const albedo = mk(), light = mk(), rough = mk();
  const a = albedo.getContext('2d'), e = light.getContext('2d'), r = rough.getContext('2d');
  const rnd = seeded(look * 7919 + 13);

  a.fillStyle = L.wall; a.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  r.fillStyle = 'rgb(0,220,0)'; r.fillRect(0, 0, S, S);              // stone: rough (green channel carries roughness)

  for (let f = 0; f < TILE.floors; f++) {
    const y = f * fh;
    // spandrel band under each window row, with a drip shadow beneath it
    a.fillStyle = L.band; a.fillRect(0, y + fh * 0.78, S, fh * 0.22);
    a.fillStyle = 'rgba(0,0,0,.28)'; a.fillRect(0, y + fh * 0.98, S, 2);
    a.fillStyle = 'rgba(255,255,255,.10)'; a.fillRect(0, y + fh * 0.78, S, 1.5);
    for (let b = 0; b < TILE.bays; b++) {
      const x = b * bw, wx = x + bw * 0.14, ww = bw * 0.72, wy = y + fh * 0.1, wh = fh * 0.62;
      // window: dark glass with a paler sky band at the top, mullions, sometimes a blind
      const g = a.createLinearGradient(0, wy, 0, wy + wh);
      g.addColorStop(0, L.glassHi); g.addColorStop(0.55, L.glass); g.addColorStop(1, L.glass);
      a.fillStyle = g; a.fillRect(wx, wy, ww, wh);
      r.fillStyle = 'rgb(0,26,0)'; r.fillRect(wx, wy, ww, wh);       // glass: smooth
      if (rnd() < 0.3) { a.fillStyle = 'rgba(190,196,200,.34)'; a.fillRect(wx, wy, ww, wh * (0.25 + rnd() * 0.4)); }
      a.fillStyle = L.pier;
      a.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      a.fillRect(wx - 2, wy - 2, ww + 4, 2); a.fillRect(wx - 2, wy + wh, ww + 4, 2.5);
      // a lit room: warm, brighter toward the ceiling lamp
      if (rnd() < 0.08) {
        const half = rnd() < 0.5;
        const lx = half ? wx + (rnd() < 0.5 ? 0 : ww / 2 + 1) : wx, lw = half ? ww / 2 - 1 : ww;
        const lg = e.createLinearGradient(0, wy, 0, wy + wh);
        lg.addColorStop(0, '#ffd9a0'); lg.addColorStop(1, '#c97a2c');
        e.fillStyle = lg; e.fillRect(lx, wy, lw, wh);
        a.fillStyle = '#c8935a'; a.fillRect(lx, wy, lw, wh);
        e.fillStyle = '#000'; e.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      }
    }
    // piers between bays
    for (let b = 0; b <= TILE.bays; b++) {
      a.fillStyle = L.pier; a.fillRect(b * bw - 3, y, 6, fh * 0.78);
      a.fillStyle = 'rgba(0,0,0,.22)'; a.fillRect(b * bw + 3, y, 1.5, fh * 0.78);
    }
  }
  // rain streaks and grime, so large walls are not flat
  for (let i = 0; i < 90; i++) {
    a.fillStyle = `rgba(${rnd() < 0.6 ? '10,14,18' : '210,216,222'},${(0.03 + rnd() * 0.05).toFixed(3)})`;
    a.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 20 + rnd() * 90);
  }
  return { albedo, light, rough };
}

/**
 * Massing of one tower: stacked boxes, each narrower than the one below.
 * Sizes in ground units; y is height. `facade` boxes take the window texture
 * (uv repeat = bays/4, floors/4), the others are plain roof plant.
 * @param t { a, floors, look, seed }
 */
export function towerParts(t) {
  const rnd = seeded(t.seed);
  const FLOOR = 8, parts = [];
  let y = 2.2, half = t.a / 2, floors = t.floors;
  parts.push({ kind: 'plinth', hw: half + 3, hd: half + 3, y0: 0, y1: 2.2 });
  const steps = t.floors >= 14 ? 3 : t.floors >= 8 ? 2 : 1;
  for (let s = 0; s < steps; s++) {
    const n = s === steps - 1 ? floors : Math.max(2, Math.round(floors * (0.5 + rnd() * 0.2)));
    const h = n * FLOOR;
    parts.push({ kind: 'facade', hw: half, hd: half, y0: y, y1: y + h, bays: Math.max(2, Math.round(half * 2 / 9)), floors: n });
    parts.push({ kind: 'cornice', hw: half + 1, hd: half + 1, y0: y + h, y1: y + h + 1.6 });
    y += h + 1.6;
    floors -= n;
    half *= 0.74 + rnd() * 0.1;
    if (floors <= 0) break;
  }
  // roof plant: lift housing, vents, sometimes a mast
  const top = y, ph = half / 0.8;
  parts.push({ kind: 'plant', hw: ph * 0.32, hd: ph * 0.28, y0: top, y1: top + 5 + rnd() * 3, ox: -ph * 0.25, oz: -ph * 0.2 });
  parts.push({ kind: 'plant', hw: ph * 0.2, hd: ph * 0.2, y0: top, y1: top + 3, ox: ph * 0.3, oz: ph * 0.25 });
  if (rnd() < 0.5) parts.push({ kind: 'mast', hw: 0.7, hd: 0.7, y0: top, y1: top + 14 + rnd() * 14, ox: ph * 0.25, oz: -ph * 0.3 });
  return { parts, height: top };
}
