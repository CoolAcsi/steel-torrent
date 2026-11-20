// Turns the game's low-poly Models into plain triangle buffers an engine can use.
//
// A Model is a list of flat-coloured faces. Every face has a surface type:
// the one its builder tagged it with (Model.tag), or else one read off its
// colour, since the models use a small palette. Faces are grouped by surface
// type and each group becomes one mesh with per-vertex colour and texture
// coordinates laid out at a fixed world scale, so a seam or a rivet is the
// same size on a bunker as on a tank. Output is in ground coordinates
// (X right, Y up, Z toward the camera), triangles wound counter-clockwise
// seen from outside.

/**
 * Surface types: how metallic and how rough, which texture set (see textures.js),
 * how many model units one texture repeat covers, and how strong its relief is.
 */
export const SURFACES = {
  concrete:   { metal: 0.0,  rough: 0.9,  tex: 'concrete',   size: 30, bump: 0.9 },
  panel:      { metal: 0.35, rough: 0.52, tex: 'panel',      size: 20, bump: 0.8 },   // painted armour, cladding, team markings
  plating:    { metal: 0.55, rough: 0.44, tex: 'panel',      size: 20, bump: 0.9 },   // cool engineered plate
  steel:      { metal: 0.72, rough: 0.46, tex: 'steel',      size: 14, bump: 0.5 },   // barrels, machinery
  copper:     { metal: 0.95, rough: 0.34, tex: 'steel',      size: 10, bump: 0.4 },
  dark:       { metal: 0.15, rough: 0.92, tex: 'dark',       size: 12, bump: 0.3 },   // rubber, soot, openings
  corrugated: { metal: 0.6,  rough: 0.58, tex: 'corrugated', size: 14, bump: 1.0 },
  brick:      { metal: 0.0,  rough: 0.92, tex: 'brick',      size: 16, bump: 1.0 },
  sandbag:    { metal: 0.0,  rough: 0.96, tex: 'sandbag',    size: 9,  bump: 1.2 },
  tread:      { metal: 0.55, rough: 0.72, tex: 'tread',      size: 7,  bump: 1.0 },
  roof:       { metal: 0.05, rough: 0.94, tex: 'roof',       size: 24, bump: 0.7 },
  cloth:      { metal: 0.0,  rough: 0.96, tex: 'cloth',      size: 12, bump: 0.8 },
  glass:      { metal: 0.2,  rough: 0.14, tex: null,         size: 10, bump: 0 },
  foliage:    { metal: 0.0,  rough: 0.95, tex: null,         size: 10, bump: 0 },
};

/** Surface type from a face colour, for faces their builder did not tag. */
export function surfaceOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx ? (mx - mn) / mx : 0, lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (sat < 0.17) {
    if (lum < 0.1) return 'dark';
    if (lum < 0.2) return 'steel';                    // near-black neutrals are bare metal: barrels, tracks, machinery
    if (b > r + 0.02) return 'plating';
    return 'concrete';
  }
  if (r > 0.6 && g > 0.3 && b < 0.3 && r - b > 0.35 && sat > 0.55 && lum < 0.5) return 'copper';
  return 'panel';
}

const lin = c => Math.pow(c, 2.2);
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}

/**
 * @returns [{ surface, glow: [r, g, b] | null, field, position, normal, color (linear RGB), uv }] (typed arrays)
 */
export function modelBuckets(model, scale = 1) {
  const buckets = new Map();
  for (const s of model.solids) {
    let layer = 0;
    for (const f of s.faces) {
      const col = rgb(f.c);
      // 'glow' faces are light sources, 'field' faces are light hanging in the air (a shield, a wormhole throat)
      const surface = f.glow ? 'glow' : f.m === 'field' ? 'field' : (f.m && SURFACES[f.m] ? f.m : surfaceOf(f.c));
      let b = buckets.get(surface);
      if (!b) buckets.set(surface, (b = { surface, glow: f.glow ? col : null, p: [], n: [], c: [], t: [] }));
      const lift = f.decal ? 0.08 * ++layer : 0;        // decals sit a hair above their wall
      const size = (SURFACES[surface] || SURFACES.panel).size;
      // Texture coordinates: project along the axis the face looks down (model axes: x, y on the ground, z up).
      const ax = Math.abs(f.n[0]), ay = Math.abs(f.n[1]), az = Math.abs(f.n[2]);
      const uv = az >= ax && az >= ay ? v => [v[0] / size, v[1] / size] : ax >= ay ? v => [v[1] / size, v[2] / size] : v => [v[0] / size, v[2] / size];
      // game (x, y, z up) -> ground (x, z, y)
      const N = [f.n[0], f.n[2], f.n[1]];
      const P = f.p.map(v => ({ p: [(v[0] + f.n[0] * lift) * scale, (v[2] + f.n[2] * lift) * scale, (v[1] + f.n[1] * lift) * scale], t: uv(v) }));
      for (let i = 1; i + 1 < P.length; i++) {
        let tri = [P[0], P[i], P[i + 1]];
        const a = tri[0].p, q = tri[1].p, r = tri[2].p;
        const cx = (q[1] - a[1]) * (r[2] - a[2]) - (q[2] - a[2]) * (r[1] - a[1]);
        const cy = (q[2] - a[2]) * (r[0] - a[0]) - (q[0] - a[0]) * (r[2] - a[2]);
        const cz = (q[0] - a[0]) * (r[1] - a[1]) - (q[1] - a[1]) * (r[0] - a[0]);
        if (cx * N[0] + cy * N[1] + cz * N[2] < 0) tri = [tri[0], tri[2], tri[1]];
        for (const v of tri) { b.p.push(v.p[0], v.p[1], v.p[2]); b.n.push(N[0], N[1], N[2]); b.c.push(col[0], col[1], col[2]); b.t.push(v.t[0], v.t[1]); }
      }
    }
  }
  return [...buckets.values()].map(b => ({
    surface: b.surface, glow: b.glow, field: b.surface === 'field',
    position: new Float32Array(b.p), normal: new Float32Array(b.n), color: new Float32Array(b.c), uv: new Float32Array(b.t),
  }));
}

/** Group placements by model key: [{ key, model, items: [{ x, y, z, yaw, scale }] }] */
export function groupInstances(list) {
  const by = new Map();
  for (const it of list) {
    let g = by.get(it.key);
    if (!g) by.set(it.key, (g = { key: it.key, model: it.model, items: [] }));
    g.items.push(it);
  }
  return [...by.values()];
}
