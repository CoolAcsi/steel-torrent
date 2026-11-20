// Civilian buildings for the 3D renderer: a small modular kit.
//
// A building is a massing (one of several archetypes, chosen by its seed)
// dressed in one of six facade looks, with roof plant and a ground floor of
// its own. The planner only decides where a building stands, how big its plot
// is and how many storeys fit; everything else varies here, so no two towers
// in a scene need be the same. Original artwork, drawn procedurally.

/** Facade looks: wall style and palette. */
const LOOKS = [
  { style: 'ribbon',  wall: '#5d5851', pier: '#7b766d', band: '#9a968d', glass: '#141a22', glassHi: '#2b3848' },   // brown stone, ribbon windows
  { style: 'ribbon',  wall: '#50565d', pier: '#727981', band: '#a0a7ae', glass: '#10161d', glassHi: '#283646' },   // blue-grey concrete
  { style: 'punched', wall: '#6b4a3f', pier: '#7d5a4d', band: '#9b8f84', glass: '#161b20', glassHi: '#2c3742' },   // red brick, punched windows
  { style: 'curtain', wall: '#2b3540', pier: '#3d4a57', band: '#55636f', glass: '#1a2733', glassHi: '#3b566b' },   // glass curtain wall
  { style: 'punched', wall: '#8a8478', pier: '#9b958a', band: '#b3ad9f', glass: '#171b20', glassHi: '#2f3944' },   // pale precast panels
  { style: 'ribbon',  wall: '#454a44', pier: '#5a6058', band: '#7f857c', glass: '#12171a', glassHi: '#27343a' },   // dark green-grey, heavy bands
];
export const LOOK_COUNT = LOOKS.length;
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
  r.fillStyle = 'rgb(0,224,0)'; r.fillRect(0, 0, S, S);              // wall: rough (green channel carries roughness)

  if (L.style === 'punched') {                                       // courses, so a plain wall is not a plain colour
    for (let y = 0; y < S; y += 4) { a.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.06})`; a.fillRect(0, y, S, 0.8); }
    for (let i = 0; i < 260; i++) { a.fillStyle = `rgba(${rnd() < 0.5 ? '255,240,225' : '0,0,0'},${0.03 + rnd() * 0.07})`; a.fillRect(Math.floor(rnd() * 32) * 8, Math.floor(rnd() * 64) * 4, 8, 3.2); }
  }

  /** One window: glass with a sky gradient, optional blind, sometimes lit. */
  const pane = (wx, wy, ww, wh, litChance) => {
    const g = a.createLinearGradient(0, wy, 0, wy + wh);
    g.addColorStop(0, L.glassHi); g.addColorStop(0.55, L.glass); g.addColorStop(1, L.glass);
    a.fillStyle = g; a.fillRect(wx, wy, ww, wh);
    r.fillStyle = 'rgb(0,30,0)'; r.fillRect(wx, wy, ww, wh);         // glass: smooth
    if (rnd() < 0.3) { a.fillStyle = 'rgba(190,196,200,.3)'; a.fillRect(wx, wy, ww, wh * (0.25 + rnd() * 0.4)); }
    if (rnd() < litChance) {                                         // a lit room: warm, brighter toward the ceiling lamp
      const lg = e.createLinearGradient(0, wy, 0, wy + wh);
      lg.addColorStop(0, '#f6cd92'); lg.addColorStop(1, '#a8672a');
      e.fillStyle = lg; e.fillRect(wx, wy, ww, wh);
      a.fillStyle = '#b98852'; a.fillRect(wx, wy, ww, wh);
    }
  };

  for (let f = 0; f < TILE.floors; f++) {
    const y = f * fh;
    if (L.style === 'ribbon') {
      a.fillStyle = L.band; a.fillRect(0, y + fh * 0.78, S, fh * 0.22);
      a.fillStyle = 'rgba(0,0,0,.28)'; a.fillRect(0, y + fh * 0.98, S, 2);
      a.fillStyle = 'rgba(255,255,255,.10)'; a.fillRect(0, y + fh * 0.78, S, 1.5);
      for (let b = 0; b < TILE.bays; b++) {
        const wx = b * bw + bw * 0.14, ww = bw * 0.72, wy = y + fh * 0.1, wh = fh * 0.62;
        pane(wx, wy, ww, wh, 0.07);
        a.fillStyle = L.pier; a.fillRect(wx + ww / 2 - 1, wy, 2, wh); a.fillRect(wx - 2, wy - 2, ww + 4, 2); a.fillRect(wx - 2, wy + wh, ww + 4, 2.5);
        e.fillStyle = '#000'; e.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      }
      for (let b = 0; b <= TILE.bays; b++) { a.fillStyle = L.pier; a.fillRect(b * bw - 3, y, 6, fh * 0.78); a.fillStyle = 'rgba(0,0,0,.22)'; a.fillRect(b * bw + 3, y, 1.5, fh * 0.78); }
    } else if (L.style === 'punched') {
      for (let b = 0; b < TILE.bays * 2; b++) {                      // two narrow windows per bay, sills and lintels
        const wx = b * bw / 2 + bw * 0.12, ww = bw * 0.26, wy = y + fh * 0.2, wh = fh * 0.5;
        pane(wx, wy, ww, wh, 0.08);
        a.fillStyle = L.band; a.fillRect(wx - 2, wy + wh, ww + 4, 3); a.fillRect(wx - 1.5, wy - 3, ww + 3, 3);
        a.fillStyle = 'rgba(0,0,0,.3)'; a.fillRect(wx - 2, wy + wh + 3, ww + 4, 1.4);
      }
      a.fillStyle = 'rgba(0,0,0,.18)'; a.fillRect(0, y + fh - 1.5, S, 1.5);
    } else {                                                         // curtain wall: glass almost everywhere, a thin grid
      for (let b = 0; b < TILE.bays * 2; b++) pane(b * bw / 2 + 1.5, y + 2, bw / 2 - 3, fh - 12, 0.05);
      a.fillStyle = L.band; a.fillRect(0, y + fh - 10, S, 10);
      r.fillStyle = 'rgb(0,120,0)'; r.fillRect(0, y + fh - 10, S, 10);
      for (let b = 0; b <= TILE.bays * 2; b++) { a.fillStyle = L.pier; a.fillRect(b * bw / 2 - 1.5, y, 3, fh); }
    }
  }
  // rain streaks and grime, so large walls are not flat
  for (let i = 0; i < 110; i++) {
    a.fillStyle = `rgba(${rnd() < 0.65 ? '10,14,18' : '210,216,222'},${(0.03 + rnd() * 0.05).toFixed(3)})`;
    a.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 20 + rnd() * 90);
  }
  return { albedo, light, rough };
}

const FLOOR = 8;

/**
 * Massing of one building. Sizes in ground units on the building's own axes (it is then
 * turned 45 degrees to the paving); y is height.
 *   facade   takes the window texture (uv repeat = bays/4, floors/4, measured per side)
 *   base     ground storey: darker, with shopfronts
 *   plinth, cornice, plant, mast, tank (a cylinder), awning, sign: plain parts
 * @param t { a, floors, look, seed }
 */
export function towerParts(t) {
  const rnd = seeded(t.seed);
  const parts = [], H = t.a / 2;
  const type = [0, 0, 1, 1, 2, 2, 3, 4][Math.floor(rnd() * 8)];        // stepped, slab, podium + tower, warehouse, twin
  const bays = w => Math.max(2, Math.round((w * 2) / 9));
  let top = 0;

  /** A block of storeys with a cornice; returns the height of its roof. */
  const block = (hw, hd, y0, n, ox = 0, oz = 0, ground = false) => {
    let y = y0;
    if (ground) {
      parts.push({ kind: 'base', hw: hw + 0.4, hd: hd + 0.4, y0: y, y1: y + 7, ox, oz });
      const side = rnd() < 0.5;
      parts.push({ kind: 'awning', hw: side ? 0.9 : hw * 0.7, hd: side ? hd * 0.7 : 0.9, y0: y + 5.2, y1: y + 5.8, ox: ox + (side ? hw + 1.2 : 0), oz: oz + (side ? 0 : hd + 1.2), tint: Math.floor(rnd() * 4) });
      y += 7; n -= 1;
    }
    if (n > 0) parts.push({ kind: 'facade', hw, hd, y0: y, y1: y + n * FLOOR, ox, oz, bays: bays(hw), baysD: bays(hd), floors: n });
    y += Math.max(0, n) * FLOOR;
    parts.push({ kind: 'cornice', hw: hw + 0.9, hd: hd + 0.9, y0: y, y1: y + 1.5, ox, oz });
    return y + 1.5;
  };
  /** Roof furniture on a roof of half-extents (hw, hd) at height y. */
  const roof = (hw, hd, y, ox = 0, oz = 0) => {
    const pick = Math.floor(rnd() * 4);
    parts.push({ kind: 'plant', hw: hw * 0.34, hd: hd * 0.3, y0: y, y1: y + 4.5 + rnd() * 3, ox: ox - hw * 0.3, oz: oz - hd * 0.25 });
    if (pick === 0 || pick === 3) parts.push({ kind: 'tank', hw: Math.min(hw, hd) * 0.2, hd: 0, y0: y + 2.4, y1: y + 7.5, ox: ox + hw * 0.4, oz: oz + hd * 0.3 }, { kind: 'plant', hw: Math.min(hw, hd) * 0.16, hd: Math.min(hw, hd) * 0.16, y0: y, y1: y + 2.4, ox: ox + hw * 0.4, oz: oz + hd * 0.3 });
    if (pick === 1) for (let i = 0; i < 3; i++) parts.push({ kind: 'plant', hw: 1.9, hd: 1.3, y0: y, y1: y + 1.9, ox: ox + hw * 0.15 + i * 4.6 - 2, oz: oz + hd * 0.45 });
    if (pick === 2) parts.push({ kind: 'sign', hw: hw * 0.62, hd: 0.35, y0: y + 2.2, y1: y + 7, ox, oz: oz + hd * 0.78 }, { kind: 'mast', hw: 0.3, hd: 0.3, y0: y, y1: y + 2.2, ox: ox - hw * 0.5, oz: oz + hd * 0.78 }, { kind: 'mast', hw: 0.3, hd: 0.3, y0: y, y1: y + 2.2, ox: ox + hw * 0.5, oz: oz + hd * 0.78 });
    if (rnd() < 0.45) parts.push({ kind: 'mast', hw: 0.6, hd: 0.6, y0: y, y1: y + 12 + rnd() * 14, ox: ox + hw * 0.25, oz: oz - hd * 0.35 });
    return y;
  };

  parts.push({ kind: 'plinth', hw: H + 3, hd: H + 3, y0: 0, y1: 2.2 });
  if (type === 0) {                                                    // stepped tower
    const steps = t.floors >= 14 ? 3 : t.floors >= 8 ? 2 : 1;
    let left = t.floors, half = H, y = 2.2;
    for (let s = 0; s < steps; s++) {
      const n = s === steps - 1 ? left : Math.max(2, Math.round(left * (0.5 + rnd() * 0.2)));
      y = block(half, half, y, n, 0, 0, s === 0);
      left -= n;
      if (left <= 0) { top = roof(half, half, y); break; }
      half *= 0.74 + rnd() * 0.1;
    }
    if (!top) top = y;
  } else if (type === 1) {                                             // slab: long and thin
    const flip = rnd() < 0.5, hw = flip ? H : H * 0.56, hd = flip ? H * 0.56 : H;
    top = roof(hw, hd, block(hw, hd, 2.2, t.floors, 0, 0, true));
  } else if (type === 2) {                                             // podium with a slim tower set back on it
    const pod = Math.min(3, Math.max(2, Math.round(t.floors * 0.25)));
    const yp = block(H, H, 2.2, pod, 0, 0, true);
    const hw = H * (0.5 + rnd() * 0.12), ox = (rnd() < 0.5 ? -1 : 1) * (H - hw - 1.5), oz = (rnd() < 0.5 ? -1 : 1) * (H - hw - 1.5);
    roof(H * 0.5, H * 0.5, yp, -ox * 0.7, -oz * 0.7);
    top = roof(hw, hw, block(hw, hw, yp, Math.max(2, t.floors - pod), ox, oz));
  } else if (type === 3) {                                             // low works building: two storeys, sawtooth roof lights
    const n = Math.min(t.floors, 2 + (rnd() < 0.4 ? 1 : 0));
    const y = block(H, H * 0.86, 2.2, n, 0, 0, true);
    for (let i = -2; i <= 2; i++) parts.push({ kind: 'sawtooth', hw: H * 0.14, hd: H * 0.74, y0: y, y1: y + 3.6, ox: i * H * 0.36, oz: 0 });
    parts.push({ kind: 'tank', hw: 2.2, hd: 0, y0: 2.2, y1: 9 + rnd() * 5, ox: H * 0.8, oz: H * 0.95 });
    top = y + 3.6;
  } else {                                                             // twin: two unequal slabs sharing a core
    const hw = H * 0.42, gap = H * 0.56;
    const n2 = Math.max(3, Math.round(t.floors * (0.55 + rnd() * 0.25)));
    const a = block(hw, H, 2.2, t.floors, -gap, 0, true), b = block(hw, H * 0.82, 2.2, n2, gap, 0, true);
    parts.push({ kind: 'facade', hw: gap - hw, hd: H * 0.3, y0: 2.2, y1: 2.2 + Math.min(t.floors, n2) * FLOOR * 0.8, ox: 0, oz: 0, bays: 2, baysD: 2, floors: Math.max(1, Math.round(Math.min(t.floors, n2) * 0.8)) });
    roof(hw, H, a, -gap, 0); roof(hw, H * 0.82, b, gap, 0);
    top = Math.max(a, b);
  }
  return { parts, height: top };
}
