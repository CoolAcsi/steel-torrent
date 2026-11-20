// Weapon families. Each subfaction fires a different family (see factions.js),
// so a faction is recognisable by its fire as well as its silhouette.
//
// Effects are stateless: a firing unit has a phase 0..1 inside its weapon's
// period, and the whole shot (flash, projectile, impact) is drawn from that.

const TAU = Math.PI * 2;

export const WEAPON = {
  bullet: { period: 0.36, recoil: 0 },     // Iron rifles: fat yellow tracers
  shell:  { period: 0.95, recoil: 3.2 },   // Iron cannon: flash, smoke, arcing shell
  siege:  { period: 1.4,  recoil: 4.8 },   // Iron howitzer: lobbed round, shockwave
  arc:    { period: 0.85, recoil: 0 },     // Iron storm coils: forked lightning
  tracer: { period: 0.3,  recoil: 0.6 },   // Meridian suppressed fire: thin, fast
  lance:  { period: 1.1,  recoil: 0 },     // Meridian sniper beam: one clean line
  pulse:  { period: 0.42, recoil: 0 },     // Meridian pulse lasers: paired dashes
  beam:   { period: 1,    recoil: 0 },     // Meridian prism beam: continuous
  wave:   { period: 0.95, recoil: 0 },     // Veil psychic waves: travelling crescents
  plasma: { period: 0.55, recoil: 1.1 },   // Veil plasma: glowing bolts, splash
};

/** How far the weapon kicks back at this point of the cycle. */
export function recoilAt(fam, ph) {
  const r = WEAPON[fam].recoil;
  return r && ph < 0.2 ? r * (1 - ph / 0.2) : 0;
}

function rnd(n) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

function dot(ctx, x, y, r, col, a = 1) {
  ctx.globalAlpha = a;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}

function seg(ctx, x0, y0, x1, y1, col, w, a = 1) {
  ctx.globalAlpha = a;
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Fireball with a smoke ring; p runs 0..1. */
export function boom(ctx, x, y, p, size) {
  dot(ctx, x + p * 2, y - p * size * 0.9, size * (0.7 + p * 0.9), '#2a2622', 0.5 * (1 - p));
  dot(ctx, x, y, size * (0.45 + p * 0.8), '#f08a24', 1 - p);
  if (p < 0.45) dot(ctx, x, y, size * (0.3 + p * 0.5), '#fff3c4', 1 - p / 0.45);
}

/**
 * @param s { fam, lvl, x, y (muzzle), tx, ty (target), ph, seed, lt, A (subfaction accent), G (faction glow) }
 */
export function drawShot(ctx, s) {
  const { fam, x, y, tx, ty, ph } = s;
  const k = [0, 0.62, 1, 1.4][s.lvl];
  const at = p => { p = Math.max(0, Math.min(1, p)); return [x + (tx - x) * p, y + (ty - y) * p]; };
  const jx = (rnd(s.seed) - 0.5) * 14 * k, jy = (rnd(s.seed + 7) - 0.5) * 8 * k;

  switch (fam) {
    case 'bullet': {
      if (ph < 0.2) dot(ctx, x, y, 2.2 * k + 1, '#ffd98a');
      if (ph < 0.34) {
        const p = ph / 0.34, a = at(p - 0.28), b = at(p);
        seg(ctx, a[0], a[1], b[0], b[1], '#ffe9a6', 1.4);
      } else if (ph < 0.5) dot(ctx, tx + jx, ty + jy, 1.6, '#fff3c4', 1 - (ph - 0.34) / 0.16);
      break;
    }
    case 'shell':
    case 'siege': {
      const big = fam === 'siege';
      const m = big ? 1.5 : 1;
      if (ph < 0.14) {                                       // muzzle blast
        const r = (3 + (ph / 0.14) * 6) * k * m;
        dot(ctx, x, y, r, '#ff9a3c', 1 - ph * 4);
        dot(ctx, x, y, r * 0.5, '#fff6d0');
      }
      if (ph < 0.6) dot(ctx, x + ph * 4, y - ph * 14 * m, (3 + ph * 9) * k * m, '#4a4540', (1 - ph / 0.6) * 0.5);   // gun smoke
      const fly = big ? 0.42 : 0.3;
      if (ph < fly) {                                        // the round, on an arc
        const p = ph / fly, a = at(p), b = at(p - 0.14);
        const lift = Math.sin(p * Math.PI) * (big ? 24 : 7) * k, lift2 = Math.sin(Math.max(0, p - 0.14) * Math.PI) * (big ? 24 : 7) * k;
        seg(ctx, b[0], b[1] - lift2, a[0], a[1] - lift, 'rgba(255,214,150,.7)', 1.6 * k);
        dot(ctx, a[0], a[1] - lift, 1.8 * k * m, '#1a1a1a');
      } else if (ph < fly + 0.5) {                           // impact
        const p = (ph - fly) / 0.5;
        boom(ctx, tx + jx, ty + jy, p, (big ? 11 : 6.5) * k);
        if (big) {
          ctx.globalAlpha = (1 - p) * 0.7;
          ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(tx + jx, ty + jy + 6, 8 + p * 26, (8 + p * 26) * 0.5, 0, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        for (let i = 0; i < 4; i++) {                        // shrapnel
          const a = rnd(s.seed + i * 13) * TAU, d = (8 + rnd(s.seed + i) * 14) * p * k;
          dot(ctx, tx + jx + Math.cos(a) * d, ty + jy + Math.sin(a) * d * 0.5 - Math.sin(p * Math.PI) * 9, 1.2, '#2b2824', 1 - p);
        }
      }
      break;
    }
    case 'arc': {
      if (ph > 0.72) dot(ctx, x, y, (2 + (ph - 0.72) * 14) * k, s.A, 0.55);    // charging
      if (ph < 0.5) {
        const tick = Math.floor(s.lt * 26) + s.seed;
        const dx = tx - x, dy = ty - y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        const pts = [[x, y]];
        for (let i = 1; i < 6; i++) {
          const o = (rnd(tick + i * 31) - 0.5) * 12 * k;
          pts.push([x + dx * i / 6 + nx * o, y + dy * i / 6 + ny * o]);
        }
        pts.push([tx + jx * 0.4, ty + jy * 0.4]);
        const path = () => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); };
        ctx.lineJoin = 'miter';
        ctx.globalAlpha = 0.5; ctx.strokeStyle = s.A; ctx.lineWidth = 3.6 * k; path();
        ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.1 * k + 0.3; path();
        const b = pts[3];                                    // a stray fork
        seg(ctx, b[0], b[1], b[0] + (rnd(tick + 5) - 0.5) * 22 * k, b[1] + (rnd(tick + 9) - 0.7) * 16 * k, '#dff6ff', 0.9, 0.8);
        ctx.lineJoin = 'round';
        dot(ctx, tx + jx * 0.4, ty + jy * 0.4, 4.5 * k, s.A, 0.6);
        dot(ctx, tx + jx * 0.4, ty + jy * 0.4, 2 * k, '#ffffff');
      }
      break;
    }
    case 'tracer': {
      if (ph < 0.22) {
        const p = ph / 0.22, a = at(p - 0.34), b = at(p);
        seg(ctx, a[0], a[1], b[0], b[1], s.A, 2, 0.5);
        seg(ctx, a[0], a[1], b[0], b[1], '#f2fffd', 0.8);
      } else if (ph < 0.36) {
        const a = 1 - (ph - 0.22) / 0.14, cx = tx + jx * 0.5, cy = ty + jy * 0.5;
        seg(ctx, cx - 3, cy, cx + 3, cy, '#f2fffd', 0.9, a);
        seg(ctx, cx, cy - 3, cx, cy + 3, '#f2fffd', 0.9, a);
      }
      break;
    }
    case 'lance': {
      if (ph < 0.55) {
        const a = ph < 0.4 ? 1 : 1 - (ph - 0.4) / 0.15;
        seg(ctx, x, y, tx, ty, s.A, 2.8 * k, 0.45 * a);
        seg(ctx, x, y, tx, ty, '#ffffff', 0.9, a);
        for (const [ux, uy] of [[1, 0], [0, 1]]) seg(ctx, x - ux * 5, y - uy * 5, x + ux * 5, y + uy * 5, '#ffffff', 0.9, a);   // lens flare
        dot(ctx, tx, ty, 3.2 * k, s.A, 0.6 * a);
        dot(ctx, tx, ty, 1.4 * k, '#ffffff', a);
      }
      break;
    }
    case 'pulse': {
      for (let j = 0; j < 2; j++) {
        const p = (ph * 1.6 + j * 0.5) % 1.15;
        if (p > 1) { dot(ctx, tx + jx * 0.4, ty + jy * 0.4, 2.4 * k, s.A, 0.8); continue; }
        const a = at(p - 0.13), b = at(p);
        seg(ctx, a[0], a[1], b[0], b[1], '#7fd0ff', 2.6 * k, 0.5);
        seg(ctx, a[0], a[1], b[0], b[1], '#ffffff', 1.1 * k);
      }
      break;
    }
    case 'beam': {
      const a = 0.5 + rnd(Math.floor(s.lt * 14) + s.seed) * 0.5;
      seg(ctx, x, y, tx, ty, s.G, 4 * k, a * 0.55);
      seg(ctx, x, y, tx, ty, '#ffffff', 1.3 * k, a);
      dot(ctx, tx, ty, 6 * k, s.G, a * 0.5);
      dot(ctx, tx, ty, 2.4 * k, '#ffffff');
      break;
    }
    case 'wave': {
      const ang = Math.atan2(ty - y, tx - x);
      ctx.strokeStyle = s.G;
      for (let j = 0; j < 3; j++) {                          // crescents widening as they travel
        const p = (ph + j / 3) % 1, c = at(p), r = (3 + p * 10) * k;
        ctx.globalAlpha = 0.85 - p * 0.5;
        ctx.lineWidth = (2.2 - p) * k;
        ctx.beginPath(); ctx.arc(c[0] - Math.cos(ang) * r * 0.7, c[1] - Math.sin(ang) * r * 0.7, r, ang - 0.95, ang + 0.95); ctx.stroke();
      }
      ctx.strokeStyle = s.A;                                 // the target's mind, spinning
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.ellipse(tx, ty - 6, 9 * k, 4 * k, s.lt * 5 + s.seed, 0, TAU * 0.7); ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'plasma': {
      if (ph < 0.14) dot(ctx, x, y, 3.5 * k, s.A, 0.8);
      if (ph < 0.6) {
        const p = ph / 0.6;
        for (let i = 3; i >= 0; i--) {
          const c = at(p - i * 0.06);
          dot(ctx, c[0], c[1], (2.6 - i * 0.5) * k, i ? s.G : '#ffffff', i ? 0.5 - i * 0.1 : 1);
        }
        const c = at(p);
        dot(ctx, c[0], c[1], 5 * k, s.A, 0.3);
      } else {
        const p = (ph - 0.6) / 0.4, cx = tx + jx * 0.5, cy = ty + jy * 0.5;
        dot(ctx, cx, cy, (3 + p * 4) * k, s.G, (1 - p) * 0.8);
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = s.A; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(cx, cy + 3, (4 + p * 12) * k, (4 + p * 12) * k * 0.5, 0, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      break;
    }
  }
}
