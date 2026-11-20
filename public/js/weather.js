// Weather: the sky a match is played under. Drawing only: nothing here changes the rules.
//
// One name drives three things:
//   - the falling layer drawn over the field on the 2D overlay canvas (drawWeather, below);
//   - the painted ground (buildTerrain in terrain.js takes the name as `weather`);
//   - light, fog, wetness and grade in the 3D renderer (Renderer3D.setWeather in 3d/renderer.js).
import { F } from './iso.js';

const TAU = Math.PI * 2;

export const WEATHERS = ['rain', 'snow', 'sun', 'night'];
export const DEFAULT_WEATHER = 'rain';

/** A known weather name, or the default for anything else. */
export const weatherOf = name => (WEATHERS.includes(name) ? name : DEFAULT_WEATHER);

/**
 * What each weather changes.
 *   falling   what drawWeather() draws over the field
 *   puddles   standing water painted on the ground
 *   mirror    the wet ground reflects the scene (3D)
 *   snow      snow lies on the ground, on roofs and on tree crowns
 *   lamps     how much street lamps and lit windows count: 'on', 'dim' (daylight) or 'strong' (they carry the scene)
 *   sky       the light: 'overcast', 'white overcast', 'clear' or 'moon'
 */
export const WEATHER_INFO = {
  rain:  { falling: 'rain',    puddles: true,  mirror: true,  snow: false, lamps: 'on',     sky: 'overcast' },
  snow:  { falling: 'snow',    puddles: false, mirror: false, snow: true,  lamps: 'on',     sky: 'white overcast' },
  sun:   { falling: 'clouds',  puddles: false, mirror: false, snow: false, lamps: 'dim',    sky: 'clear' },
  night: { falling: 'drizzle', puddles: true,  mirror: true,  snow: false, lamps: 'strong', sky: 'moon' },
};

function hash(n) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return (n ^ (n >>> 15)) >>> 0;
}

// While paused the layer holds still, and picks up where it stopped.
let heldAt = null, skew = 0;

/**
 * The falling or drifting layer of a weather, drawn in view coordinates (the context is
 * already scaled and translated to the field). Under the labels, over the field.
 *
 * @param ctx   2D context of the overlay canvas
 * @param name  one of WEATHERS (anything else draws the default)
 * @param lt    local time in seconds: the animation clock
 * @param box   { x0, y0, W, H }: the visible area in view units
 * @param opts  { effects = true, quality = 'high' | 'medium' | 'low', paused = false }
 *              Nothing is drawn with effects off or on the low preset; medium draws fewer.
 */
export function drawWeather(ctx, name, lt, box, opts = {}) {
  if (opts.effects === false || opts.quality === 'low') return;
  if (opts.paused) { if (heldAt === null) heldAt = lt; lt = heldAt; }
  else if (heldAt !== null) { skew += lt - heldAt; heldAt = null; }
  lt -= skew;
  const high = opts.quality !== 'medium';
  const kind = WEATHER_INFO[weatherOf(name)].falling;
  if (kind === 'rain') rain(ctx, lt, box, high);
  else if (kind === 'snow') snow(ctx, lt, box, high);
  else if (kind === 'clouds') clouds(ctx, lt, box, high);
  else drizzle(ctx, lt, box, high);
}

/** Slanted streaks across the field and rings where drops land on the wet ground. */
function rain(ctx, lt, { x0, y0, W, H }, high) {
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 28; i++) {
    const beat = lt / (0.9 + (i % 5) * 0.13) + i * 0.37;
    const ph = beat % 1, h = hash(i * 7919 + Math.floor(beat) * 104729);
    const x = x0 + ((h % 1000) / 1000) * W, y = y0 + (((h >>> 10) % 1000) / 1000) * H;
    ctx.strokeStyle = `rgba(214,228,242,${(0.36 * (1 - ph)).toFixed(3)})`;
    ctx.beginPath(); ctx.ellipse(x, y, 1.5 + ph * 7, (1.5 + ph * 7) * F, 0, 0, TAU); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(216,228,242,.2)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let i = high ? 130 : 80; i > 0; i--) {
    const h = hash(Math.imul(i, 0x9e3779b1));
    const fall = (lt * (620 + (h % 300)) + ((h >>> 8) % 4096)) % (H + 80);
    const x = x0 + (((h >>> 4) % 2000) / 2000) * (W + 160) - fall * 0.22;
    const y = y0 - 40 + fall, len = 14 + (h % 12);
    ctx.moveTo(x, y); ctx.lineTo(x - len * 0.22, y + len);
  }
  ctx.stroke();
}

// Snow: three sizes of flake, the small ones far and slow, the large ones near and quicker.
// Each sways on its own rhythm and all lean on a light wind; one fill per size.
const FLAKES = [
  { share: 0.56, r: 0.75, speed: 30, sway: 5,  fill: 'rgba(240,246,252,.62)', under: null },
  { share: 0.31, r: 1.2,  speed: 44, sway: 8,  fill: 'rgba(246,250,255,.8)',  under: 'rgba(70,92,122,.2)' },
  { share: 0.13, r: 1.9,  speed: 62, sway: 12, fill: 'rgba(255,255,255,.7)',  under: 'rgba(70,92,122,.16)' },
];
function snow(ctx, lt, { x0, y0, W, H }, high) {
  const total = high ? 170 : 100, span = H + 40, wide = W + 140;
  let i = 0;
  for (const c of FLAKES) {
    const n = Math.round(total * c.share), pts = [];
    for (let e = i + n; i < e; i++) {
      const h = hash(Math.imul(i + 1, 0x9e3779b1));
      const fall = (lt * c.speed * (0.75 + (h % 64) / 128) + ((h >>> 6) % 4096)) % span;
      const ph = (h >>> 18) / 2607;                                    // 0..2pi and a little more
      const x = x0 - 40 + (((h >>> 4) % 4000) / 4000) * wide - fall * 0.16
        + Math.sin(lt * (0.5 + (h % 7) * 0.09) + ph) * c.sway + Math.sin(lt * 1.9 + ph * 3.1) * c.sway * 0.22;
      pts.push(x, y0 - 20 + fall);
    }
    // On snow-covered ground a white flake would vanish: a faint blue shadow under the
    // nearer ones keeps them readable without darkening the picture.
    if (c.under) {
      ctx.fillStyle = c.under;
      ctx.beginPath();
      for (let k = 0; k < pts.length; k += 2) { ctx.moveTo(pts[k] + c.r * 1.3, pts[k + 1] + c.r * 0.9); ctx.arc(pts[k] + c.r * 0.3, pts[k + 1] + c.r * 0.9, c.r, 0, TAU); }
      ctx.fill();
    }
    ctx.fillStyle = c.fill;
    ctx.beginPath();
    for (let k = 0; k < pts.length; k += 2) { ctx.moveTo(pts[k] + c.r, pts[k + 1]); ctx.arc(pts[k], pts[k + 1], c.r, 0, TAU); }
    ctx.fill();
  }
}

/** A clear day: nothing falls. A few cloud shadows cross the field, slowly and faintly. */
function clouds(ctx, lt, { x0, y0, W, H }, high) {
  const span = W + 900;
  for (let i = high ? 3 : 2; i > 0; i--) {
    const h = hash(i * 7919);
    const rx = 260 + (h % 140), ry = rx * (0.34 + ((h >>> 8) % 20) / 100);
    const x = x0 - 450 + (lt * (7 + (h >>> 4) % 5) + ((h >>> 12) % 4096) / 4096 * span) % span;
    const y = y0 + (0.12 + ((h >>> 16) % 76) / 100) * H;
    ctx.save();
    ctx.translate(x, y); ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
    g.addColorStop(0, 'rgba(18,30,52,.085)');
    g.addColorStop(0.6, 'rgba(18,30,52,.05)');
    g.addColorStop(1, 'rgba(18,30,52,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/** Night: a fine, sparse drizzle, only just visible where it crosses the light. */
function drizzle(ctx, lt, { x0, y0, W, H }, high) {
  ctx.strokeStyle = 'rgba(190,208,236,.13)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = high ? 46 : 28; i > 0; i--) {
    const h = hash(Math.imul(i, 0x9e3779b1));
    const fall = (lt * (430 + (h % 220)) + ((h >>> 8) % 4096)) % (H + 60);
    const x = x0 + (((h >>> 4) % 2000) / 2000) * (W + 120) - fall * 0.16;
    const y = y0 - 30 + fall, len = 7 + (h % 6);
    ctx.moveTo(x, y); ctx.lineTo(x - len * 0.16, y + len);
  }
  ctx.stroke();
}
