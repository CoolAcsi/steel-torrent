// Things that stand on the battlefield for a while: emplacements beside a base, obstacles on
// a road, wormhole ends, a Base Shield, a ruined base and its rebuilding.
//
// These are overlay drawings in view coordinates. Everything they show (where, whose, how
// long, how much health) comes from the server's feature list; `time` is simulation time, so
// they stand still in a pause and keep pace with the game speed.
import { F } from './iso.js';

const TAU = Math.PI * 2;

export const FEAT_COLOR = {
  turret: '#ff9a3c', slow: '#7fd0ff', psi: '#b77dff', block: '#ffb347', mire: '#b77dff',
  worm: '#c9f1ff', aegis: '#ffe9a8', rebuild: '#ffd166',
};

/** Where the emplacement in slot `s` stands beside a base at (x, y): the four corners of its compound. */
export function empSpot(x, y, s) {
  const a = [-0.62, 0.62, 2.52, 3.76][s & 3];
  return { x: x + Math.cos(a) * 60, y: y + Math.sin(a) * 60 * F + 4 };
}

/** A thin arc showing how much of something is left (1 = all of it). */
function timer(ctx, x, y, r, left, col) {
  ctx.strokeStyle = 'rgba(8,10,12,.75)';
  ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * F, 0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * F, 0, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, Math.min(1, left))); ctx.stroke();
}

/**
 * An emplacement: a gun turret, a suppression mast or a psychic spire, on a small pad in the
 * owner's colour, with its remaining time around the pad.
 */
export function drawEmplacement(ctx, kind, x, y, team, time, left, seed = 0, body = true) {
  const col = FEAT_COLOR[kind];
  if (!body) return timer(ctx, x, y, 15, left, col);        // the 3D renderer draws the thing itself
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + 2, 13, 13 * F, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2a2d31';
  ctx.beginPath(); ctx.ellipse(x, y, 12, 12 * F, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = team;
  ctx.beginPath(); ctx.ellipse(x, y, 9, 9 * F, 0, 0, TAU); ctx.fill();
  timer(ctx, x, y, 15, left, col);
  ctx.lineCap = 'round';
  if (kind === 'turret') {
    const a = time * 0.9 + seed;
    ctx.fillStyle = '#4a4e53';
    ctx.fillRect(x - 5, y - 11, 10, 9);
    ctx.fillStyle = '#6d7379';
    ctx.fillRect(x - 6, y - 15, 12, 5);
    ctx.strokeStyle = '#1c1e21';
    ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(x, y - 12.5); ctx.lineTo(x + Math.cos(a) * 13, y - 12.5 + Math.sin(a) * 13 * F); ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillRect(x - 6, y - 10.5, 12, 1.6);
  } else if (kind === 'slow') {
    ctx.strokeStyle = '#59616a';
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x, y - 20); ctx.stroke();
    ctx.strokeStyle = '#aab4bd';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - 21, 6, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    for (let j = 0; j < 2; j++) {
      const ph = (time * 0.8 + j * 0.5) % 1;
      ctx.strokeStyle = col;
      ctx.globalAlpha = (1 - ph) * 0.8;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y - 22, 4 + ph * 12, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#3a3147';
    ctx.beginPath(); ctx.moveTo(x - 5, y - 1); ctx.lineTo(x, y - 20); ctx.lineTo(x + 5, y - 1); ctx.closePath(); ctx.fill();
    const pulse = 0.6 + 0.4 * Math.sin(time * 4 + seed);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.35 * pulse;
    ctx.beginPath(); ctx.arc(x, y - 23, 8, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f1dcff';
    ctx.beginPath(); ctx.arc(x, y - 23, 3.2, 0, TAU); ctx.fill();
  }
}

/**
 * A barricade across a road at (x, y); (ux, uy) is the road's direction on screen. Its health
 * (0..1) is the bar above it, its remaining time the arc below.
 */
export function drawBarricade(ctx, x, y, ux, uy, team, hp, left, body = true) {
  const px = -uy, py = ux;                                 // across the road
  if (body) {
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(x + 2, y + 3, 17, 7, Math.atan2(py, px), 0, TAU); ctx.fill();
  }
  for (let j = -1; body && j <= 1; j++) {
    const bx = x + px * j * 10, by = y + py * j * 10 * 0.9;
    ctx.fillStyle = '#5c6066';
    ctx.fillRect(bx - 5, by - 9, 10, 9);
    ctx.fillStyle = '#8a9097';
    ctx.fillRect(bx - 5, by - 11, 10, 3);
    ctx.fillStyle = j ? '#f2b23a' : team;                  // hazard blocks either side, the owner's colour in the middle
    ctx.fillRect(bx - 5, by - 6, 10, 2.4);
    ctx.fillStyle = '#16181b';
    for (let s = -4; s < 5; s += 4) if (j) ctx.fillRect(bx + s, by - 6, 1.6, 2.4);
  }
  ctx.fillStyle = 'rgba(8,10,12,.85)';
  ctx.fillRect(x - 14, y - 21, 28, 5);
  ctx.fillStyle = hp > 0.5 ? '#9be36c' : hp > 0.25 ? '#ffd166' : '#ff6b5a';
  ctx.fillRect(x - 13, y - 20, 26 * Math.max(0, Math.min(1, hp)), 3);
  timer(ctx, x, y + 2, 20, left, FEAT_COLOR.block);
}

/** A disruption barrier: a stretch of road from (x0, y0) to (x1, y1) that shimmers, with slow ripples along it. */
export function drawMire(ctx, x0, y0, x1, y1, time, left) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  ctx.lineCap = 'round';
  ctx.strokeStyle = FEAT_COLOR.mire;
  ctx.globalAlpha = 0.2 + 0.08 * Math.sin(time * 3);
  ctx.lineWidth = 22;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1.6;
  for (let j = 0; j < 4; j++) {
    const u = ((time * 0.25 + j / 4) % 1) * len;
    const cx = x0 + ux * u, cy = y0 + uy * u;
    ctx.beginPath(); ctx.moveTo(cx - uy * 11, cy + ux * 11 * 0.8); ctx.lineTo(cx + uy * 11, cy - ux * 11 * 0.8); ctx.stroke();
  }
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1.4;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(x0 - uy * 12 * s, y0 + ux * 10 * s); ctx.lineTo(x1 - uy * 12 * s, y1 + ux * 10 * s); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  timer(ctx, (x0 + x1) / 2, (y0 + y1) / 2, 9, left, FEAT_COLOR.mire);
}

/** One end of a wormhole, standing above a base: a turning ring of light. */
export function drawPortal(ctx, x, y, time, left, seed = 0, body = true) {
  const col = FEAT_COLOR.worm;
  if (!body) return timer(ctx, x, y - 6, 13, left, col);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(x, y - 34, 15, 22, 0, 0, TAU); ctx.fill();
  ctx.lineCap = 'round';
  for (let j = 0; j < 3; j++) {
    const a = time * (1.6 + j * 0.5) + seed + j * 2.1;
    ctx.globalAlpha = 0.9 - j * 0.22;
    ctx.strokeStyle = j ? col : '#ffffff';
    ctx.lineWidth = 2.6 - j * 0.6;
    ctx.beginPath(); ctx.ellipse(x, y - 34, 15 - j * 3.5, 22 - j * 5, 0, a, a + 2.4); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  timer(ctx, x, y - 6, 13, left, col);
}

/** A Base Shield: a wide golden dome over the whole compound; it thins as its health goes. */
export function drawAegis(ctx, x, y, time, hp, left, body = true) {
  const col = FEAT_COLOR.aegis, pulse = 0.5 + 0.5 * Math.sin(time * 3);
  if (!body) return timer(ctx, x, y + 2, 66, left, col);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.globalAlpha = 0.05 + 0.06 * hp;
  ctx.beginPath(); ctx.ellipse(x, y - 2, 62, 56, 0, Math.PI, TAU); ctx.fill();
  ctx.lineWidth = 1 + 1.6 * hp;
  ctx.globalAlpha = 0.45 + 0.3 * pulse;
  ctx.beginPath(); ctx.ellipse(x, y - 2, 62, 56, 0, Math.PI, TAU); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x, y - 2, 62, 62 * F, 0, 0, Math.PI); ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 1;
  for (const r of [0.45, 0.78]) { ctx.beginPath(); ctx.ellipse(x, y - 2, 62, 56 * r, 0, Math.PI, TAU); ctx.stroke(); }
  for (const r of [0.4, 0.8]) { ctx.beginPath(); ctx.ellipse(x, y - 2, 62 * r, 56, 0, Math.PI, TAU); ctx.stroke(); }
  ctx.globalAlpha = 1;
  timer(ctx, x, y + 2, 66, left, col);
}

/** What a nuclear strike leaves of a base: a scorched pad, broken walls and rubble, a thread of smoke. */
export function drawRuin(ctx, x, y, time, seed, fx = true) {
  ctx.fillStyle = 'rgba(14,12,11,.72)';
  ctx.beginPath(); ctx.ellipse(x, y, 46, 46 * F, 0, 0, TAU); ctx.fill();
  let h = (seed * 2654435761) >>> 0;
  const rnd = () => ((h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0) % 1000) / 1000;
  for (let j = 0; j < 14; j++) {                           // rubble
    const a = rnd() * TAU, r = 6 + rnd() * 30, s = 3 + rnd() * 6;
    const bx = x + Math.cos(a) * r, by = y + Math.sin(a) * r * F;
    ctx.fillStyle = ['#3b3835', '#55514b', '#2a2826', '#6a655d'][j & 3];
    ctx.beginPath(); ctx.moveTo(bx - s, by); ctx.lineTo(bx - s * 0.3, by - s * (0.7 + rnd() * 0.6)); ctx.lineTo(bx + s * 0.8, by - s * 0.4); ctx.lineTo(bx + s, by); ctx.closePath(); ctx.fill();
  }
  for (let j = 0; j < 3; j++) {                            // what is left of the walls
    const bx = x - 22 + j * 20 + rnd() * 6, hgt = 12 + rnd() * 14, w = 9 + rnd() * 5;
    ctx.fillStyle = '#46423d';
    ctx.beginPath(); ctx.moveTo(bx, y + 4); ctx.lineTo(bx, y + 4 - hgt); ctx.lineTo(bx + w * 0.4, y + 4 - hgt * 0.7); ctx.lineTo(bx + w * 0.7, y + 4 - hgt * 0.9); ctx.lineTo(bx + w, y + 4 - hgt * 0.35); ctx.lineTo(bx + w, y + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#211f1d';
    ctx.fillRect(bx + 2, y + 4 - hgt * 0.5, 2.6, 3.4);
  }
  if (fx) {
    for (let j = 0; j < 3; j++) {
      const ph = (time * 0.22 + j / 3) % 1;
      ctx.globalAlpha = (1 - ph) * 0.4;
      ctx.fillStyle = '#2b2927';
      ctx.beginPath(); ctx.arc(x + 6 + ph * 9, y - 12 - ph * 40, 4 + ph * 9, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 6 + seed);
    ctx.fillStyle = '#ff8a3c';
    ctx.beginPath(); ctx.arc(x + 5, y - 6, 2.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** Rebuilding: scaffolding going up over the ruin, a crane arm, and the progress bar. */
export function drawScaffold(ctx, x, y, time, p) {
  const top = 10 + 34 * p;
  ctx.strokeStyle = '#d9b45a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const dx of [-24, -8, 8, 24]) { ctx.moveTo(x + dx, y + 4); ctx.lineTo(x + dx, y + 4 - top); }
  for (let hgt = 10; hgt <= top; hgt += 10) { ctx.moveTo(x - 24, y + 4 - hgt); ctx.lineTo(x + 24, y + 4 - hgt); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(217,180,90,.5)';
  ctx.beginPath();
  for (let hgt = 0; hgt + 10 <= top; hgt += 10) { ctx.moveTo(x - 24, y + 4 - hgt); ctx.lineTo(x - 8, y - 6 - hgt); ctx.moveTo(x + 8, y + 4 - hgt); ctx.lineTo(x + 24, y - 6 - hgt); }
  ctx.stroke();
  const sway = Math.sin(time * 1.3) * 6;                   // crane
  ctx.strokeStyle = '#8f959b';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 30, y + 4); ctx.lineTo(x + 30, y - 52); ctx.lineTo(x - 6 + sway, y - 52); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 2 + sway, y - 52); ctx.lineTo(x - 2 + sway, y - 52 + 14 + 10 * (1 - p)); ctx.stroke();
  if (Math.sin(time * 9) > 0.6) {                          // a welder's spark now and then
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(x - 8 + ((time * 37) % 16), y + 2 - top, 1.8, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(8,10,12,.85)';
  ctx.fillRect(x - 22, y - 66, 44, 6);
  ctx.fillStyle = FEAT_COLOR.rebuild;
  ctx.fillRect(x - 21, y - 65, 42 * Math.max(0, Math.min(1, p)), 4);
}

/**
 * A round cancel control: a cross on a dark disc, ringed in `col`. Returns its radius, so the
 * caller can hit-test it.
 */
export function drawCancel(ctx, x, y, col, hot) {
  const r = hot ? 11 : 9.5;
  ctx.fillStyle = hot ? '#b3261e' : 'rgba(12,14,16,.94)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = hot ? '#ffffff' : col;
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 3.6, y - 3.6); ctx.lineTo(x + 3.6, y + 3.6); ctx.moveTo(x + 3.6, y - 3.6); ctx.lineTo(x - 3.6, y + 3.6); ctx.stroke();
  return r;
}
