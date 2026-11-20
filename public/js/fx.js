// Battlefield effects for city abilities, global skills, crates and encounters.
// Each effect is a plain object { type, t0, dur, ... } in view coordinates;
// drawEffect renders it at progress p (0..1). Energy effects are drawn with
// additive blending by the caller, which gives a bloom-like glow for free.
import { F } from './iso.js';
import { boom } from './weapons.js';

const TAU = Math.PI * 2;

function rnd(n) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

function ring(ctx, x, y, r, col, w, a) {
  if (r <= 0) return;
  ctx.globalAlpha = Math.max(0, a);
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * F, 0, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 1;
}

function disc(ctx, x, y, r, col, a) {
  ctx.globalAlpha = Math.max(0, a);
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}

/** Jagged electrical arc between two points, re-seeded every few frames. */
export function bolt(ctx, x0, y0, x1, y1, col, seed, w = 1.2) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  const path = () => {
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let i = 1; i < 6; i++) {
      const o = (rnd(seed + i * 31) - 0.5) * Math.min(18, len * 0.16);
      ctx.lineTo(x0 + dx * i / 6 + nx * o, y0 + dy * i / 6 + ny * o);
    }
    ctx.lineTo(x1, y1); ctx.stroke();
  };
  ctx.lineJoin = 'miter';
  ctx.globalAlpha = 0.5; ctx.strokeStyle = col; ctx.lineWidth = w * 3.2; path();
  ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = w; path();
  ctx.lineJoin = 'round';
}

/** Colour language per skill family, shared by warnings, impacts and the skill bar. */
export const SKILL_COLOR = {
  mobilize: '#ff9a3c', barrage: '#ff7a3c', nuke: '#ffd34a',
  reinforce: '#7fd0ff', rapid: '#9fe8ff', phase: '#c9f1ff',
  shock: '#d9a4ff', leech: '#ff7ad9', dominion: '#b77dff',
};

/** Which effects glow (drawn additively). */
export const GLOWS = new Set(['shot', 'shield', 'conv', 'phase', 'strike', 'pick', 'pulse', 'clash']);

export function drawEffect(ctx, f, p, lt) {
  switch (f.type) {
    // Target warning: a filling ring that closes as the strike approaches.
    case 'warn': {
      const col = SKILL_COLOR[f.skill];
      const blink = 0.55 + 0.45 * Math.sin(lt * (8 + p * 18));
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.07 + 0.08 * p;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r, f.r * F, 0, 0, TAU); ctx.fill();
      ring(ctx, f.x, f.y, f.r, col, 2.4, 0.5 + 0.4 * blink);
      ring(ctx, f.x, f.y, f.r * (1 - p), col, 1.6, 0.9);
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.9;     // crosshair
      for (const [ux, uy] of [[1, 0], [0, 1]]) {
        ctx.beginPath(); ctx.moveTo(f.x - ux * 9, f.y - uy * 9 * F); ctx.lineTo(f.x + ux * 9, f.y + uy * 9 * F); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    // Lingering hazard after a nuclear strike.
    case 'hazard': {
      const fade = p > 0.8 ? (1 - p) / 0.2 : 1;
      // how long the ground stays dangerous: an arc that runs out
      ctx.strokeStyle = '#e8ff9a'; ctx.lineWidth = 3; ctx.globalAlpha = 0.8 * fade;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r + 5, (f.r + 5) * F, 0, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p)); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#c8ff4a';
      ctx.globalAlpha = (0.1 + 0.05 * Math.sin(lt * 4)) * fade;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r, f.r * F, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash([6, 8]);
      ring(ctx, f.x, f.y, f.r, '#c8ff4a', 1.6, 0.55 * fade);
      ctx.setLineDash([]);
      for (let j = 0; j < 6; j++) {                       // drifting embers
        const ph = (lt * 0.5 + j / 6) % 1, a = rnd(f.seed + j) * TAU, d = rnd(f.seed + j * 7) * f.r * 0.8;
        disc(ctx, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * F - ph * 26, 1.6, '#e8ff9a', (1 - ph) * 0.8 * fade);
      }
      break;
    }
    case 'strike': {
      if (f.skill === 'barrage') {                        // a ripple of shell bursts
        for (let j = 0; j < 7; j++) {
          const q = (p * 1.6 - j * 0.09);
          if (q <= 0 || q >= 1) continue;
          const a = rnd(f.seed + j) * TAU, d = Math.sqrt(rnd(f.seed + j * 13)) * f.r * 0.85;
          boom(ctx, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * F - 4, q, 13);
        }
        ring(ctx, f.x, f.y, f.r * (0.3 + p * 0.8), '#ffb347', 2.5 * (1 - p), 1 - p);
      } else if (f.skill === 'nuke') {
        // flash -> fireball -> shockwave -> rising column and cap
        if (p < 0.12) disc(ctx, f.x, f.y - 10, f.r * (0.4 + p * 6), '#fffbe0', 1 - p / 0.12);
        ring(ctx, f.x, f.y, f.r * Math.min(1.5, p * 2.4), '#ffe9a6', 5 * (1 - p) + 1, 1 - p);
        ring(ctx, f.x, f.y, f.r * Math.min(1.5, p * 1.7), '#ff9a3c', 3 * (1 - p) + 1, (1 - p) * 0.8);
        const rise = Math.min(1, p * 2.2), h = 96 * rise, fade = 1 - Math.max(0, (p - 0.55) / 0.45);
        disc(ctx, f.x, f.y - 6, f.r * 0.42 * (1 - p * 0.5), '#ff7a2a', 0.85 * fade);
        ctx.globalAlpha = 0.8 * fade;                     // stem
        ctx.fillStyle = '#5a4a3c';
        ctx.beginPath(); ctx.ellipse(f.x, f.y - h / 2, 11 + rise * 5, h / 2 + 4, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        disc(ctx, f.x, f.y - h, 26 + rise * 22, '#4d4036', 0.85 * fade);            // cap
        disc(ctx, f.x - 6, f.y - h - 5, 16 + rise * 15, '#ff9a3c', 0.7 * fade * (1 - p));
        disc(ctx, f.x - 9, f.y - h - 8, 8 + rise * 8, '#fff3c4', 0.8 * fade * (1 - p));
      } else {                                            // dominion: collapsing and expanding violet rings
        for (let j = 0; j < 4; j++) {
          const q = (p + j / 4) % 1;
          ring(ctx, f.x, f.y, f.r * q, '#b77dff', 3 * (1 - q) + 0.6, (1 - q) * (1 - p * 0.6));
        }
        ctx.strokeStyle = '#ff7ad9'; ctx.lineWidth = 1.6; ctx.globalAlpha = (1 - p) * 0.9;
        for (let j = 0; j < 3; j++) {
          ctx.beginPath(); ctx.ellipse(f.x, f.y - 18, 40 + p * 30, 14 + p * 10, lt * (2 + j) + j * 2, 0, TAU * 0.75); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        disc(ctx, f.x, f.y - 18, 12 * (1 - p), '#f0c4ff', 1 - p);
      }
      break;
    }
    // Instant area pulse (psychic shock) and friendly buffs.
    case 'pulse': {
      const col = f.col;
      for (let j = 0; j < 3; j++) {
        const q = Math.min(1, p * 1.4 + j * 0.16);
        ring(ctx, f.x, f.y, f.r * q, col, 2.4 * (1 - q) + 0.5, (1 - q) * 0.9);
      }
      break;
    }
    // City turret / coil fire.
    case 'shot': {
      if (p > 0.7 && !f.coil) break;
      let x = f.x, y = f.y;
      f.to.forEach((q, i) => {
        if (f.coil) bolt(ctx, x, y, q[0], q[1] - 8, '#7fd8ff', Math.floor(lt * 30) + i * 7 + f.seed, i ? 0.9 : 1.4);
        else {
          const k = Math.min(1, p / 0.45), hx = x + (q[0] - x) * k, hy = y + (q[1] - 8 - y) * k;
          ctx.strokeStyle = '#ffe9a6'; ctx.lineWidth = 2.4; ctx.globalAlpha = 1 - p;
          ctx.beginPath(); ctx.moveTo(x + (hx - x) * 0.6, y + (hy - y) * 0.6); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.globalAlpha = 1;
          if (p < 0.2) disc(ctx, x, y, 7 * (1 - p / 0.2) + 2, '#ffd98a', 1);          // muzzle flash at the turret
          if (k >= 1) boom(ctx, q[0], q[1] - 8, (p - 0.45) / 0.25, 9);
        }
        if (f.coil) { disc(ctx, q[0], q[1] - 8, 6 * (1 - p), '#bfeaff', 0.9); x = q[0]; y = q[1] - 8; }
      });
      break;
    }
    // Shield going up over a city.
    case 'shield': {
      const r = 46;
      ctx.strokeStyle = '#c9f1ff'; ctx.lineWidth = 2.2; ctx.globalAlpha = (1 - p) * 0.9;
      ctx.beginPath(); ctx.ellipse(f.x, f.y - 6, r, r * 0.9 * Math.min(1, p * 3), 0, Math.PI, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      ring(ctx, f.x, f.y, r + p * 24, '#c9f1ff', 2 * (1 - p), 1 - p);
      break;
    }
    // Conversion: a violet spiral and the number that changed sides.
    case 'conv': {
      ctx.strokeStyle = '#ff7ad9'; ctx.lineWidth = 1.8; ctx.globalAlpha = 1 - p;
      for (let j = 0; j < 3; j++) {
        ctx.beginPath(); ctx.ellipse(f.x, f.y - 8, 6 + p * 16, 3 + p * 8, lt * 7 + j * 2.1, 0, TAU * 0.7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      disc(ctx, f.x, f.y - 8, 5 * (1 - p), '#f0c4ff', 1 - p);
      break;
    }
    // Phase dispatch: matching blue-white distortion at both ends.
    case 'phase': {
      const squeeze = Math.sin(p * Math.PI);
      for (let j = 0; j < 3; j++) {
        ctx.strokeStyle = j ? '#9fe8ff' : '#ffffff'; ctx.lineWidth = 2.2 - j * 0.5; ctx.globalAlpha = (1 - p) * 0.95;
        ctx.beginPath(); ctx.ellipse(f.x, f.y - 14, 30 * (1 - squeeze * 0.7) + j * 6, 44 * squeeze + 4 + j * 5, 0, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ring(ctx, f.x, f.y, 36 + p * 40, '#c9f1ff', 2.5 * (1 - p), 1 - p);
      disc(ctx, f.x, f.y - 14, 18 * squeeze, '#ffffff', 0.5 * (1 - p));
      for (let j = 0; j < 8; j++) {                       // motes drawn inward (leaving) or outward (arriving)
        const a = rnd(f.seed + j) * TAU, d = (f.arrive ? p : 1 - p) * 46;
        disc(ctx, f.x + Math.cos(a) * d, f.y - 14 + Math.sin(a) * d * 0.7, 1.6, '#e8fbff', 1 - p);
      }
      break;
    }
    case 'clash': {
      for (let j = 0; j < 6; j++) {
        const a = rnd(f.seed + j) * TAU, d = 6 + p * 20;
        ctx.strokeStyle = '#ffe9a6'; ctx.lineWidth = 1.4; ctx.globalAlpha = 1 - p;
        ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * d * 0.4, f.y - 8 + Math.sin(a) * d * 0.3); ctx.lineTo(f.x + Math.cos(a) * d, f.y - 8 + Math.sin(a) * d * 0.7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ring(ctx, f.x, f.y, 10 + p * 26, '#ffffff', 2 * (1 - p), 1 - p);
      break;
    }
    case 'pick': {
      ring(ctx, f.x, f.y, 8 + p * 30, f.col, 2.4 * (1 - p), 1 - p);
      for (let j = 0; j < 8; j++) {
        const a = j * TAU / 8 + f.seed;
        disc(ctx, f.x + Math.cos(a) * p * 26, f.y - 8 + Math.sin(a) * p * 16 - p * 14, 2 * (1 - p) + 0.6, f.col, 1 - p);
      }
      break;
    }
    // Floating text (numbers only, or a short localized label).
    case 'text': {
      ctx.font = `800 ${f.size || 14}px ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = p < 0.8 ? 1 : (1 - p) / 0.2;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,11,.85)';
      ctx.strokeText(f.text, f.x, f.y - 22 - p * 22);
      ctx.fillStyle = f.col;
      ctx.fillText(f.text, f.x, f.y - 22 - p * 22);
      ctx.globalAlpha = 1;
      break;
    }
  }
}

/** A supply crate on a road: strapped case with a beacon, drawn every frame. */
export function drawCrate(ctx, x, y, lt, seed) {
  const bob = Math.sin(lt * 2.4 + seed) * 1.2;
  ctx.fillStyle = 'rgba(0,0,0,.36)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + 2, 11, 5, 0, 0, TAU); ctx.fill();
  const top = y - 12 + bob;
  ctx.fillStyle = '#5b4a2e';                              // right face
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 9, y - 4.5); ctx.lineTo(x + 9, top + 3.5); ctx.lineTo(x, top + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#8a7244';                              // left face
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9, y - 4.5); ctx.lineTo(x - 9, top + 3.5); ctx.lineTo(x, top + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b39858';                              // lid
  ctx.beginPath(); ctx.moveTo(x, top + 8); ctx.lineTo(x + 9, top + 3.5); ctx.lineTo(x, top - 1); ctx.lineTo(x - 9, top + 3.5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#2a241a'; ctx.lineWidth = 1.2;       // straps
  ctx.beginPath(); ctx.moveTo(x - 4.5, y - 2.2); ctx.lineTo(x - 4.5, top + 5.8); ctx.lineTo(x + 4.5, top + 1.2); ctx.moveTo(x + 4.5, y - 2.2); ctx.lineTo(x + 4.5, top + 5.8); ctx.lineTo(x - 4.5, top + 1.2); ctx.stroke();
  const pulse = 0.5 + 0.5 * Math.sin(lt * 5 + seed);
  ctx.globalCompositeOperation = 'lighter';
  disc(ctx, x, top - 4, 3 + pulse * 5, '#ffd34a', 0.35);
  disc(ctx, x, top - 4, 2, '#fff6d0', 1);
  ring(ctx, x, y, 14 + pulse * 5, '#ffd34a', 1.4, 0.5 - pulse * 0.3);
  ctx.globalCompositeOperation = 'source-over';
}
