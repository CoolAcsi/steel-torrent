// Superweapon presentation: the three faction events, drawn on the 2D layer.
//
// Each effect is tied to an authoritative event (the warning to the cast, the
// detonation to the strike, tethers to actual conversions, the two ends of a
// chrono dispatch to the one transfer event) and runs on the simulation clock,
// so it slows, speeds up and pauses with the match. Nothing here decides or
// implies an outcome: damage numbers and conversion marks come from what the
// server reported, and decorative smoke and dust are drawn soft and unlined so
// they cannot be mistaken for the outlined area that actually hurts.
//
// Effects are plain objects { type, x, y, r, t0, dur, ... } in view
// coordinates; `p` is progress 0..1, `time` the clock the effect runs on.
import { F } from './iso.js';

const TAU = Math.PI * 2;
const ease = x => 1 - (1 - x) * (1 - x);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

function rnd(n) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

// Soft round sprites, made once: far cheaper than a gradient per puff.
const sprites = new Map();
function sprite(rgb) {
  let c = sprites.get(rgb);
  if (!c) {
    c = document.createElement('canvas');
    c.light = Math.max(...rgb.split(',').map(Number)) >= 200;      // fire and energy add light; smoke and dust cover
    c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.55, `rgba(${rgb},.55)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    sprites.set(rgb, c);
  }
  return c;
}
function puff(ctx, rgb, x, y, r, a, sy = 1) {
  if (a <= 0.003 || r <= 0.5) return;
  const img = sprite(rgb);
  ctx.globalAlpha = Math.min(1, a);
  if (img.light) ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(img, x - r, y - r * sy, r * 2, r * 2 * sy);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
function ring(ctx, x, y, r, col, w, a, dash) {
  if (r <= 0 || a <= 0) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.ellipse(x, y, r, r * F, 0, 0, TAU); ctx.stroke();
  if (dash) ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}
function label(ctx, x, y, text, col, size = 15) {
  ctx.font = `800 ${size}px ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(8,10,11,.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = col;
  ctx.fillText(text, x, y);
}

/** Everything this module draws. It sets its own blending: light adds, smoke covers. */
export const SUPER_TYPES = new Set(['nukeWarn', 'nuke', 'scorch', 'domWarn', 'dominion', 'tether', 'halo', 'psiHit', 'chrono']);
/** Effects that lie on the ground and belong under the troops. */
export const GROUND_TYPES = new Set(['nukeWarn', 'domWarn', 'scorch', 'hazard']);

/**
 * @param o { fx: full effects?, flash: bright flashes allowed? }
 */
export function drawSuper(ctx, f, p, time, o) {
  switch (f.type) {
    // ------------------------------------------------------------ Iron Pact: nuclear strike
    // Warning: the real impact area, a countdown, and the warhead coming down on it.
    case 'nukeWarn': {
      const left = f.dur * (1 - p), beat = 0.5 + 0.5 * Math.sin(time * (6 + p * 16));
      ctx.fillStyle = '#ff5a2a';
      ctx.globalAlpha = 0.07 + 0.09 * p;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r, f.r * F, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ring(ctx, f.x, f.y, f.r, '#ffb347', 2.4, 0.55 + 0.4 * beat);                 // this line is the blast radius
      ring(ctx, f.x, f.y, f.r * (1 - p), '#ffd34a', 1.6, 0.9);
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 2;
      for (let j = 0; j < 4; j++) {                                               // four ticks closing in
        const a = j * TAU / 4 + time * 0.6, r0 = f.r * (1.06 + 0.1 * (1 - p)), r1 = r0 + 12;
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0 * F); ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1 * F); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      label(ctx, f.x, f.y, String(Math.max(1, Math.ceil(left))), '#ffe9a6', 20);
      // The warhead: falls the whole warning long and arrives as it ends.
      const q = Math.pow(p, 1.25), sx = f.x - 170, sy = f.y - 540;
      const hx = sx + (f.x - sx) * q, hy = sy + (f.y - sy) * q;
      const tail = Math.max(0, q - 0.34), tx = sx + (f.x - sx) * tail, ty = sy + (f.y - sy) * tail;
      const tr = ctx.createLinearGradient(tx, ty, hx, hy);
      tr.addColorStop(0, 'rgba(255,220,170,0)'); tr.addColorStop(1, 'rgba(255,236,200,.85)');
      ctx.strokeStyle = tr; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      puff(ctx, '255,214,140', hx, hy, 7 + 4 * beat, 0.9);
      ctx.fillStyle = '#fff6da'; ctx.beginPath(); ctx.arc(hx, hy, 2, 0, TAU); ctx.fill();
      break;
    }

    // Detonation. Phases by elapsed seconds: flash, fireball, shock and dust on the ground,
    // then the stem and the rolling cap, which thin out and drift at the end.
    case 'nuke': {
      const s = p * f.dur, R = f.r, fade = clamp((f.dur - s) / 2.4);
      const full = o.fx;
      // heat on the ground: light, not damage (it reaches past the blast line)
      if (s < 2.2) puff(ctx, '255,150,60', f.x, f.y, R * (1.2 + s * 0.5), 0.5 * (1 - s / 2.2) * (o.flash ? 1 : 0.5), F + 0.1);
      if (s < 0.16 && o.flash) puff(ctx, '255,250,225', f.x, f.y - 12, R * (0.5 + s * 5), 1 - s / 0.16);
      // shock front, then the dust it lifts: a soft ring of puffs racing outward, no outline
      if (s < 1.1) ring(ctx, f.x, f.y, R * (0.2 + ease(s / 1.1) * 1.7), '#ffe9c4', 5 * (1 - s / 1.1) + 0.6, 1 - s / 1.1);
      if (s < 3.4) {
        const q = s / 3.4, rr = R * (0.35 + ease(q) * 1.25), n = full ? 22 : 10;
        for (let j = 0; j < n; j++) {
          const a = j / n * TAU + rnd(f.seed + j) * 0.5, wob = 1 + (rnd(f.seed + j * 5) - 0.5) * 0.18;
          puff(ctx, '150,138,120', f.x + Math.cos(a) * rr * wob, f.y + Math.sin(a) * rr * wob * F - q * 10, 16 + q * 26, 0.34 * (1 - q), 0.7);
        }
      }
      // debris thrown up and out, gone within a second and a half
      if (s < 1.5 && full) {
        ctx.fillStyle = '#2a2420';
        for (let j = 0; j < 16; j++) {
          const a = rnd(f.seed + j * 3) * TAU, v = 60 + rnd(f.seed + j * 11) * 130, up = 150 + rnd(f.seed + j * 17) * 160;
          const dx = Math.cos(a) * v * s, dy = Math.sin(a) * v * s * F - up * s + 190 * s * s;
          if (dy > 4) continue;
          ctx.globalAlpha = 1 - s / 1.5;
          ctx.fillRect(f.x + dx, f.y + dy, 2.2, 2.2);
        }
        ctx.globalAlpha = 1;
      }
      // the column and the cap
      const H = 215 * (1 - Math.exp(-s / 1.3)), drift = s * 3;
      const stem = full ? 11 : 6;
      for (let j = 0; j < stem; j++) {
        const k = j / (stem - 1), y = f.y - H * k, sway = Math.sin(time * 1.3 + j * 0.9 + f.seed) * (3 + k * 5);
        const w = R * (0.27 - k * 0.09) + 9;
        if (s < 2.6) puff(ctx, '255,120,40', f.x + sway + drift * k, y, w * 0.8, 0.5 * (1 - s / 2.6) * (1 - k * 0.6));
        puff(ctx, '74,64,56', f.x + sway + drift * k, y, w, 0.5 * fade);
      }
      const capR = R * (0.3 + 0.52 * ease(clamp(s / 3.2))), lobes = full ? 15 : 8;
      for (let j = 0; j < lobes; j++) {
        const a = j / lobes * TAU + time * 0.25, roll = Math.sin(time * 0.9 + j * 1.7) * 3;
        const cx = f.x + Math.cos(a) * capR * 0.62 + drift, cy = f.y - H - 6 + Math.sin(a) * capR * 0.26 + roll;
        if (s < 3) puff(ctx, '255,132,48', cx, cy + 7, capR * 0.5, 0.42 * (1 - s / 3));          // lit from below while it is hot
        puff(ctx, '88,76,66', cx, cy, capR * 0.58, 0.52 * fade);
      }
      puff(ctx, '104,92,80', f.x + drift, f.y - H - 12, capR * 0.75, 0.5 * fade);
      // the fireball itself: white, yellow, orange, then it is inside the cap
      if (s < 1.8) {
        const q = s / 1.8, fr = R * (0.16 + ease(clamp(s / 0.5)) * 0.34) * (1 - q * 0.35), fy = f.y - 10 - H * 0.5 * q;
        puff(ctx, '255,96,30', f.x, fy, fr * 1.25, 0.8 * (1 - q));
        puff(ctx, '255,196,90', f.x, fy, fr * 0.9, 0.9 * (1 - q));
        if (o.flash) puff(ctx, '255,248,220', f.x, fy, fr * 0.55, 1 - q * 1.4);
      }
      // the blast line, shown crisply for a moment: this is where damage was done
      if (s < 1.6) ring(ctx, f.x, f.y, R, '#ffd34a', 1.8, 0.8 * (1 - s / 1.6));
      break;
    }

    // What the strike leaves on the ground: a bounded scorch, embers, thin smoke.
    case 'scorch': {
      const s = p * f.dur, fade = clamp((f.dur - s) / 6);
      for (let j = 0; j < 7; j++) {
        const a = rnd(f.seed + j) * TAU, d = rnd(f.seed + j * 7) * f.r * 0.34;
        puff(ctx, '14,12,11', f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * F, f.r * (0.3 + rnd(f.seed + j * 13) * 0.22), 0.34 * fade, F + 0.12);
      }
      if (s < 14 && o.fx) {
        for (let j = 0; j < 12; j++) {                       // embers, fewer as it cools
          if (rnd(f.seed + j * 29) > 1 - s / 14) continue;
          const a = rnd(f.seed + j * 31) * TAU, d = Math.sqrt(rnd(f.seed + j * 37)) * f.r * 0.6;
          const fl = 0.5 + 0.5 * Math.sin(time * (5 + j) + j);
          puff(ctx, '255,150,50', f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * F, 3.2, 0.7 * fl * (1 - s / 14));
        }
        for (let j = 0; j < 4; j++) {                        // wisps
          const ph = (time * 0.16 + j / 4) % 1, a = rnd(f.seed + j * 41) * TAU, d = rnd(f.seed + j * 43) * f.r * 0.4;
          puff(ctx, '70,66,62', f.x + Math.cos(a) * d + ph * 14, f.y + Math.sin(a) * d * F - ph * 70, 9 + ph * 16, 0.22 * (1 - ph) * (1 - s / 14));
        }
      }
      break;
    }

    // ------------------------------------------------------------ Veil Collective: psychic dominator
    // Warning: a segmented ring that turns, waves drawn inward, three marks, a countdown.
    case 'domWarn': {
      const left = f.dur * (1 - p);
      ctx.fillStyle = '#8a4dff';
      ctx.globalAlpha = 0.06 + 0.07 * p;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r, f.r * F, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineDashOffset = -time * 22;
      ring(ctx, f.x, f.y, f.r, '#c79bff', 2.4, 0.9, [f.r * 0.32, f.r * 0.2]);      // the area that will be affected
      ctx.lineDashOffset = 0;
      for (let j = 0; j < 3; j++) {
        const q = (1 - ((time * 0.45 + j / 3) % 1));
        ring(ctx, f.x, f.y, f.r * q, '#b77dff', 1.3, 0.5 * (1 - q) + 0.1);
      }
      ctx.fillStyle = '#e2c4ff';
      for (let j = 0; j < 3; j++) {                                               // three marks pointing in
        const a = j * TAU / 3 - time * 0.9, r0 = f.r * (0.86 - 0.3 * p);
        const cx = f.x + Math.cos(a) * r0, cy = f.y + Math.sin(a) * r0 * F;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * 9, cy - Math.sin(a) * 9 * F);
        ctx.lineTo(cx + Math.cos(a + 1.9) * 6, cy + Math.sin(a + 1.9) * 6 * F);
        ctx.lineTo(cx + Math.cos(a - 1.9) * 6, cy + Math.sin(a - 1.9) * 6 * F);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      label(ctx, f.x, f.y, String(Math.max(1, Math.ceil(left))), '#ecd9ff', 20);
      break;
    }

    // The field: layered violet rings at different heights turning against each other,
    // two focused pulses, a faint standing column. Restrained: it colours no unit.
    case 'dominion': {
      const s = p * f.dur, hold = clamp((f.dur - s) / 1.2);
      puff(ctx, '140,80,255', f.x, f.y, f.r * 1.05, 0.22 * hold, F + 0.1);
      for (let j = 0; j < 2; j++) {                                               // focused pulses
        const q = clamp((s - j * 0.35) / 0.9);
        if (q > 0 && q < 1) ring(ctx, f.x, f.y, f.r * ease(q), '#f0d6ff', 4 * (1 - q) + 0.6, 1 - q);
      }
      ctx.lineWidth = 1.7;
      for (let j = 0; j < 4; j++) {                                               // rotating waves, stacked upward
        const h = 10 + j * 15, rr = f.r * (0.78 - j * 0.14) * (1 + 0.035 * Math.sin(time * 5 + j * 2)), turn = time * (j % 2 ? -1.6 : 1.3) + j;
        ctx.strokeStyle = j % 2 ? '#ff8fe0' : '#b77dff';
        ctx.globalAlpha = 0.75 * hold;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath(); ctx.ellipse(f.x, f.y - h, rr, rr * F, 0, turn + k * TAU / 3, turn + k * TAU / 3 + TAU * 0.2); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      puff(ctx, '214,170,255', f.x, f.y - 34, 22 + 6 * Math.sin(time * 6), 0.55 * hold);
      ring(ctx, f.x, f.y, f.r, '#c79bff', 1.6, 0.7 * hold, [f.r * 0.32, f.r * 0.2]);
      break;
    }

    // A tether from the field to a contingent that really was converted.
    case 'tether': {
      const k = clamp(p / 0.45), out = clamp((1 - p) / 0.4);
      const mx = (f.x0 + f.x) / 2, my = Math.min(f.y0, f.y) - 46;
      ctx.strokeStyle = '#d7a8ff'; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.85 * out;
      ctx.beginPath(); ctx.moveTo(f.x0, f.y0);
      for (let i = 1; i <= 12; i++) {
        const u = (i / 12) * k, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
        ctx.lineTo(a * f.x0 + b * mx + c * f.x, a * f.y0 + b * my + c * (f.y - 8));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      const a = (1 - k) * (1 - k), b = 2 * k * (1 - k), c = k * k;
      puff(ctx, '240,200,255', a * f.x0 + b * mx + c * f.x, a * f.y0 + b * my + c * (f.y - 8), 6, out);
      break;
    }

    // A converted contingent, marked apart from the army it left: a turning violet
    // halo and a ring in its new owner's colour.
    case 'halo': {
      const out = clamp((1 - p) / 0.3);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#ff8fe0'; ctx.globalAlpha = 0.9 * out;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(f.x, f.y - 16, 13, 5, 0, time * 4 + k * TAU / 3, time * 4 + k * TAU / 3 + 1.3); ctx.stroke(); }
      ctx.globalAlpha = 1;
      ring(ctx, f.x, f.y, 15 + 4 * Math.sin(time * 5), f.col, 2, 0.85 * out);
      break;
    }

    // A garrison shaken by the dominator: the city is hurt, not taken.
    case 'psiHit': {
      ring(ctx, f.x, f.y, 30 + p * 26, '#c79bff', 2.4 * (1 - p) + 0.5, 1 - p);
      ctx.strokeStyle = '#f0d6ff'; ctx.lineWidth = 1.4; ctx.globalAlpha = 1 - p;
      for (let j = 0; j < 5; j++) {                                               // cracks
        const a = rnd(f.seed + j) * TAU;
        ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * 10, f.y - 10 + Math.sin(a) * 6);
        ctx.lineTo(f.x + Math.cos(a + 0.3) * 22, f.y - 10 + Math.sin(a + 0.3) * 13);
        ctx.lineTo(f.x + Math.cos(a - 0.1) * 32, f.y - 10 + Math.sin(a - 0.1) * 19); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }

    // ------------------------------------------------------------ Meridian Alliance: chrono dispatch
    // Both ends fire on the one transfer event. Source: the field contracts and the troops
    // break into slices. Destination: a pulse opens and they assemble. No path between.
    case 'chrono': {
      const arrive = f.arrive, y0 = f.y - 14, sq = Math.sin(p * Math.PI);
      const k = arrive ? ease(p) : 1 - ease(p);                                   // field size: opening or closing
      for (let j = 0; j < 3; j++) ring(ctx, f.x, f.y, 12 + k * (84 - j * 18), j ? '#9fe8ff' : '#ffffff', 2.8 - j * 0.6, (arrive ? 1 - p : 0.4 + 0.6 * (1 - p)) * 0.95);
      puff(ctx, '150,215,255', f.x, f.y, 30 + k * 70, 0.35 * sq, F + 0.1);                 // the field itself, on the ground
      ctx.strokeStyle = '#c9f1ff'; ctx.lineWidth = 1.4;
      for (let j = 0; j < 4; j++) {                                               // corner brackets turning with the field
        const a = j * TAU / 4 + (arrive ? 1 : -1) * p * 2.2, rr = 20 + k * 70;
        const cx = f.x + Math.cos(a) * rr, cy = f.y + Math.sin(a) * rr * F;
        ctx.globalAlpha = 0.9 * (1 - p * 0.6);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a + 1.57) * 12, cy + Math.sin(a + 1.57) * 12 * F); ctx.lineTo(cx, cy); ctx.lineTo(cx + Math.cos(a - 1.57) * 12, cy + Math.sin(a - 1.57) * 12 * F);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // troop silhouettes, cut into slices that slide apart (leaving) or together (arriving)
      const n = Math.min(14, 5 + Math.ceil((f.n || 8) / 3));
      for (let j = 0; j < n; j++) {
        const a = rnd(f.seed + j) * TAU, d = 12 + rnd(f.seed + j * 7) * 34;
        const bx = f.x + Math.cos(a) * d, by = y0 + 8 + Math.sin(a) * d * F;
        const apart = arrive ? 1 - ease(clamp(p / 0.7)) : ease(clamp(p / 0.8));    // 0 whole, 1 scattered
        const vis = arrive ? clamp(p / 0.25) * clamp((1 - p) / 0.25) : 1 - clamp((p - 0.35) / 0.55);
        for (let sl = 0; sl < 5; sl++) {
          const off = (rnd(f.seed + j * 13 + sl) - 0.5) * 40 * apart;
          ctx.fillStyle = sl % 2 ? '#ffffff' : '#9fe8ff';
          ctx.globalAlpha = 0.9 * vis;
          ctx.fillRect(bx - (sl === 0 ? 1.8 : 2.6) + off, by - 14 + sl * 3.2 - apart * 14 * (arrive ? 1 : -0.4), sl === 0 ? 3.6 : 5.2, 2.6);
        }
      }
      ctx.globalAlpha = 1;
      puff(ctx, '235,250,255', f.x, y0, 40 * sq, 0.6 * sq * (o.flash ? 1 : 0.5));
      // a moment's glint on the wet ground under the field
      puff(ctx, '170,225,255', f.x, f.y + 30, 44 + k * 26, 0.34 * sq, 0.42);
      if (o.fx) for (let j = 0; j < 3; j++) puff(ctx, '220,245,255', f.x + (j - 1) * 16, f.y + 24 + j * 5, 5, 0.5 * sq * rnd(f.seed + j + Math.floor(time * 12)), 2.2);
      break;
    }
  }
}

/** Targeting preview for chrono dispatch: both cities bracketed, linked by markers in the air (not a road). */
export function drawChronoLink(ctx, a, b, time, locked) {
  const mark = (q, on) => {
    ctx.strokeStyle = on ? '#ffffff' : '#9fe8ff';
    ctx.lineWidth = 1.8;
    for (let j = 0; j < 4; j++) {
      const an = j * TAU / 4 + time * 1.4, rr = 42;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, rr, rr * F, 0, an, an + 0.9); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  mark(a, true);
  if (locked) mark(b, false);
  const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 70 - Math.hypot(b.x - a.x, b.y - a.y) * 0.12;
  const n = Math.max(10, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 26));
  for (let i = 1; i < n; i++) {
    const u = i / n, w = (1 - u) * (1 - u), v = 2 * u * (1 - u), z = u * u;
    const x = w * a.x + v * mx + z * b.x, y = w * (a.y - 14) + v * my + z * (b.y - (locked ? 14 : 0));
    const lit = 0.4 + 0.6 * Math.max(0, Math.sin(time * 5 - u * 9));
    ctx.fillStyle = 'rgba(8,12,16,.6)';
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 5.5, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 5.5, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c9f1ff';
    ctx.globalAlpha = lit;
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 3.8, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 3.8, y); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
