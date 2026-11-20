// Minimal isometric toolkit: low-poly models made of convex solids, drawn with
// flat shading and back-face culling, then cached as sprites.
//
// Coordinates: x/y lie on the ground (y points toward the camera), z is up.
// Screen position of a point is (x, y * F - z).

export const F = 0.55;                       // ground foreshortening
const VLEN = Math.hypot(1, F);
const VY = 1 / VLEN, VZ = F / VLEN;          // unit vector toward the camera

const shadeMemo = new Map();

/** `hex` colour scaled by brightness `f` (quantised so results can be memoised). */
export function shade(hex, f) {
  const q = Math.round(f * 40);
  const key = hex + q;
  let v = shadeMemo.get(key);
  if (!v) {
    const n = parseInt(hex.slice(1), 16), m = q / 40;
    const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * m)));
    v = `rgb(${ch(16)},${ch(8)},${ch(0)})`;
    shadeMemo.set(key, v);
  }
  return v;
}

export class Model {
  constructor() { this.solids = []; this.cur = null; }

  /**
   * Surface type for everything built from here on ('concrete', 'panel', 'steel',
   * 'corrugated', 'brick', 'sandbag', 'tread', 'roof', 'glass', 'canvas', ...), or
   * null to let the colour decide. The 3D renderer gives each type its own textured
   * material; the sprite renderer ignores it. Returns the previous type.
   */
  tag(name) { const was = this.cur; this.cur = name; return was; }

  /** Register a convex solid; face normals are oriented away from its centre. */
  solid(faces, bias = 0) {
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const f of faces) for (const p of f.p) { cx += p[0]; cy += p[1]; cz += p[2]; n++; }
    cx /= n; cy /= n; cz /= n;
    for (const f of faces) {
      const [a, b, c] = f.p;
      let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      let fx = 0, fy = 0, fz = 0;
      for (const p of f.p) { fx += p[0]; fy += p[1]; fz += p[2]; }
      const m = f.p.length;
      if (nx * (fx / m - cx) + ny * (fy / m - cy) + nz * (fz / m - cz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      f.n = [nx, ny, nz];
      if (this.cur && !f.m) f.m = this.cur;
    }
    const s = { faces, c: [cx, cy, cz], bias };
    this.solids.push(s);
    return s;
  }

  box(x0, x1, y0, y1, z0, z1, c, o = {}) {
    return this.solid([
      { p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c: o.top || c },
      { p: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], c },
      { p: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], c },
      { p: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], c },
      { p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c },
    ], o.bias);
  }

  /** Vertical extrusion of a convex ground polygon. */
  prism(poly, z0, z1, c, o = {}) {
    const faces = [{ p: poly.map(p => [p[0], p[1], z1]), c: o.top || c, glow: o.glow }];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      faces.push({ p: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], c, glow: o.glow });
    }
    return this.solid(faces, o.bias);
  }

  /** n-gon column; r1 lets it taper toward the top. */
  cyl(cx, cy, r, z0, z1, c, o = {}) {
    const n = o.n || 8, r1 = o.r1 == null ? r : o.r1, rot = o.rot || 0, sy = o.sy || 1;
    const ring = rr => Array.from({ length: n }, (_, i) => {
      const a = rot + (i / n) * Math.PI * 2;
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * sy];   // sy < 1 gives an oval
    });
    const lo = ring(r), hi = ring(r1);
    const faces = [{ p: hi.map(p => [p[0], p[1], z1]), c: o.top || c, glow: o.glow }];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push({ p: [[lo[i][0], lo[i][1], z0], [lo[j][0], lo[j][1], z0], [hi[j][0], hi[j][1], z1], [hi[i][0], hi[i][1], z1]], c, glow: o.glow });
    }
    return this.solid(faces, o.bias);
  }

  /**
   * Side profile (convex polygon of [x, z] points) extruded across y0..y1.
   * Used for sloped hulls and glacis plates. `o.top` recolours upward faces.
   */
  profile(pts, y0, y1, c, o = {}) {
    const faces = [
      { p: pts.map(p => [p[0], y1, p[1]]), c },
      { p: pts.map(p => [p[0], y0, p[1]]), c },
    ];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      faces.push({ p: [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], c });
    }
    const s = this.solid(faces, o.bias);
    if (o.top) for (const f of s.faces) if (f.n[2] > 0.6) f.c = o.top;
    return s;
  }

  /** Gable roof with the ridge running along x. */
  ridge(x0, x1, y0, y1, z0, z1, c, o = {}) {
    const ym = (y0 + y1) / 2, g = o.gable || c;
    return this.solid([
      { p: [[x0, y1, z0], [x1, y1, z0], [x1, ym, z1], [x0, ym, z1]], c },
      { p: [[x0, y0, z0], [x1, y0, z0], [x1, ym, z1], [x0, ym, z1]], c },
      { p: [[x1, y0, z0], [x1, y1, z0], [x1, ym, z1]], c: g },
      { p: [[x0, y0, z0], [x0, y1, z0], [x0, ym, z1]], c: g },
    ], o.bias);
  }

  /** Round bar lying along x (gun barrels, pipes): an n-gon tube from x0 to x1 centred on (cy, cz). r1 tapers it. */
  tubeX(x0, x1, cy, cz, r, c, o = {}) {
    return this.tube((x, u, v) => [x, cy + u, cz + v], x0, x1, r, c, o);
  }

  /** Round bar lying along y (road wheels, axles, drums on their side), centred on (cx, cz). */
  tubeY(y0, y1, cx, cz, r, c, o = {}) {
    return this.tube((y, u, v) => [cx + u, y, cz + v], y0, y1, r, c, o);
  }

  tube(at, a0, a1, r, c, o) {
    const n = o.n || 6, r1 = o.r1 == null ? r : o.r1;
    const ring = (a, rr) => Array.from({ length: n }, (_, i) => { const t = ((i + 0.5) / n) * Math.PI * 2; return at(a, Math.cos(t) * rr, Math.sin(t) * rr); });
    const A = ring(a0, r), B = ring(a1, r1);
    const faces = [{ p: B, c: o.cap || c, glow: o.glow }, { p: A, c: o.cap || c, glow: o.glow }];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push({ p: [A[i], A[j], B[j], B[i]], c, glow: o.glow }); }
    return this.solid(faces, o.bias);
  }

  /** Flat detail painted onto a solid (door, window, stripe). `n` is its normal. */
  decal(s, pts, c, n, glow) {
    s.faces.push({ p: pts, c, n, glow, decal: true, m: this.cur || undefined });   // `decal` lets the 3D renderer layer it above its wall
  }
  onY(s, x0, x1, z0, z1, y, c, glow, dir = 1) {
    this.decal(s, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], c, [0, dir, 0], glow);
  }
  onX(s, y0, y1, z0, z1, x, c, glow, dir = 1) {
    this.decal(s, [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], c, [dir, 0, 0], glow);
  }
  onTop(s, x0, x1, y0, y1, z, c, glow) {
    this.decal(s, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], c, [0, 0, 1], glow);
  }
}

/**
 * Draw `model` rotated by `yaw` about the vertical axis. With `sort`, solids
 * are ordered back to front by their centres (good for vehicles); without it
 * the authored order is kept (buildings, which never rotate).
 */
export function renderModel(ctx, model, yaw = 0, sort = true) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  let list = model.solids;
  if (sort) {
    list = list
      .map(s => ({ s, k: (s.c[0] * sn + s.c[1] * cs) * VY + s.c[2] * VZ + (s.bias || 0) }))
      .sort((a, b) => a.k - b.k)
      .map(o => o.s);
  }
  ctx.lineWidth = 0.4;
  for (const s of list) {
    for (const f of s.faces) {
      const n = f.n;
      const nx = n[0] * cs - n[1] * sn, ny = n[0] * sn + n[1] * cs, nz = n[2];
      if (ny * VY + nz * VZ <= 0.02) continue;            // faces away from the camera
      // Sun from the upper left: tops brightest, left walls lit, right walls in shade.
      const b = f.glow ? 1 : 0.6 + 0.4 * nz - 0.22 * nx + 0.03 * ny;
      ctx.beginPath();
      for (let i = 0; i < f.p.length; i++) {
        const p = f.p[i];
        const X = p[0] * cs - p[1] * sn, Y = (p[0] * sn + p[1] * cs) * F - p[2];
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      }
      ctx.closePath();
      const col = shade(f.c, b);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = col;                               // hairline hides seams between faces
      ctx.stroke();
    }
  }
}

function seeded(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sprites are rendered once at the current on-screen resolution and reused,
 * so a battle costs one drawImage per unit instead of dozens of path fills.
 * Changing the scale (resize) drops the cache; detail then follows zoom.
 */
export class SpriteCache {
  constructor() {
    this.map = new Map();
    this.k = 1;
  }

  setScale(k) {
    k = Math.round(k * 100) / 100;
    if (k !== this.k) { this.k = k; this.map.clear(); }
  }

  /**
   * @param box  [width, height, anchorX, anchorY] in world units
   * @param spec { draw(g, k), shadow?(g), outline?: bool, grime?: seed }
   */
  get(key, box, spec) {
    let s = this.map.get(key);
    if (s) return s;
    const k = this.k;
    const [w, h, ax, ay] = box;
    const W = Math.max(1, Math.ceil(w * k)), H = Math.max(1, Math.ceil(h * k));
    const make = () => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.setTransform(k, 0, 0, k, ax * k, ay * k);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      return [c, g];
    };

    const [body, bg] = make();
    spec.draw(bg, k);
    if (spec.grime != null) {
      // Weathering: specks and streaks, clipped to the painted pixels.
      const rnd = seeded(spec.grime * 7919 + 13);
      bg.globalCompositeOperation = 'source-atop';
      const count = Math.round((w * h) / 26);
      for (let i = 0; i < count; i++) {
        const x = -ax + rnd() * w, y = -ay + rnd() * h;
        bg.fillStyle = rnd() < 0.62 ? 'rgba(0,0,0,.13)' : 'rgba(255,255,255,.08)';
        if (rnd() < 0.3) bg.fillRect(x, y, 0.7, 1.5 + rnd() * 3.5);
        else bg.fillRect(x, y, 0.8 + rnd() * 1.4, 0.8 + rnd() * 1.2);
      }
      bg.globalCompositeOperation = 'source-over';
    }
    if (spec.light !== false) {
      // One key light for the whole game (upper left, warm) with a cool falloff
      // toward the lower right, laid over the flat-shaded faces so large
      // surfaces read as lit metal or concrete instead of a single flat tone.
      const lg = bg.createLinearGradient(-ax, -ay, w - ax, h - ay);
      lg.addColorStop(0, 'rgba(255,240,205,.20)');
      lg.addColorStop(0.45, 'rgba(255,240,205,0)');
      lg.addColorStop(0.6, 'rgba(0,10,26,0)');
      lg.addColorStop(1, 'rgba(0,10,26,.30)');
      bg.globalCompositeOperation = 'source-atop';
      bg.fillStyle = lg;
      bg.fillRect(-ax, -ay, w, h);
      bg.globalCompositeOperation = 'source-over';
    }

    const [out, og] = make();
    if (spec.shadow) spec.shadow(og);
    og.setTransform(1, 0, 0, 1, 0, 0);
    if (spec.outline) {
      // Dark silhouette pass keeps units readable against busy terrain.
      const [sil, sg] = make();
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.drawImage(body, 0, 0);
      sg.globalCompositeOperation = 'source-in';
      sg.fillStyle = '#0b0d0e';
      sg.fillRect(0, 0, W, H);
      const px = Math.max(1, Math.round(k * 0.8));
      og.globalAlpha = 0.85;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        og.drawImage(sil, dx * px, dy * px);
      }
      og.globalAlpha = 1;
    }
    og.drawImage(body, 0, 0);

    s = { img: out, w: W / k, h: H / k, ax, ay };
    this.map.set(key, s);
    return s;
  }
}

export function drawSprite(ctx, s, x, y) {
  ctx.drawImage(s.img, x - s.ax, y - s.ay, s.w, s.h);
}
