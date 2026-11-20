// Turns the game's low-poly Models into plain triangle buffers an engine can use.
//
// A Model is a list of flat-coloured faces. Each face's colour says what it is
// made of (the same rule the game's own WebGL renderer uses), so faces are
// grouped into a handful of material buckets and each bucket becomes one mesh
// with per-vertex colour. Output is in ground coordinates (X right, Y up,
// Z toward the camera) with triangles wound counter-clockwise seen from outside.

/** [metalness, roughness, emission] from a face colour. Same table as public/js/gl.js. */
export function materialOf(hex, glow) {
  if (glow) return [0, 0.6, 1];
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx ? (mx - mn) / mx : 0, lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (sat < 0.17) {
    if (lum < 0.1) return [0.2, 0.9, 0];              // rubber, openings, soot
    if (lum < 0.3) return [0.9, 0.4, 0];              // gunmetal
    if (b > r + 0.02) return [0.5, 0.42, 0];          // cool grey plating
    return [0.3, 0.8, 0];                             // concrete, weathered iron
  }
  if (r > 0.6 && g > 0.3 && b < 0.3 && r - b > 0.35 && sat > 0.55 && lum < 0.5) return [0.95, 0.32, 0];   // copper
  return [0.35, 0.46, 0];                             // painted armour and team markings
}

const lin = c => Math.pow(c, 2.2);
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}

/**
 * @returns [{ metal, rough, emissive, glow: [r, g, b] | null, position: Float32Array, normal: Float32Array, color: Float32Array (linear RGB) }]
 */
export function modelBuckets(model, scale = 1) {
  const buckets = new Map();
  for (const s of model.solids) {
    let layer = 0;
    for (const f of s.faces) {
      const [metal, rough, emissive] = materialOf(f.c, f.glow);
      const col = rgb(f.c);
      // Glowing faces are bucketed by colour, so an engine can give each its own emissive material.
      const key = emissive ? `glow|${f.c}` : `${metal}|${rough}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { metal, rough, emissive, glow: emissive ? col : null, p: [], n: [], c: [] }));
      const lift = f.decal ? 0.08 * ++layer : 0;        // decals sit a hair above their wall
      // game (x, y, z up) -> ground (x, z, y)
      const N = [f.n[0], f.n[2], f.n[1]];
      const P = f.p.map(v => [(v[0] + f.n[0] * lift) * scale, (v[2] + f.n[2] * lift) * scale, (v[1] + f.n[1] * lift) * scale]);
      for (let i = 1; i + 1 < P.length; i++) {
        let tri = [P[0], P[i], P[i + 1]];
        const [a, q, r] = tri;
        const cx = (q[1] - a[1]) * (r[2] - a[2]) - (q[2] - a[2]) * (r[1] - a[1]);
        const cy = (q[2] - a[2]) * (r[0] - a[0]) - (q[0] - a[0]) * (r[2] - a[2]);
        const cz = (q[0] - a[0]) * (r[1] - a[1]) - (q[1] - a[1]) * (r[0] - a[0]);
        if (cx * N[0] + cy * N[1] + cz * N[2] < 0) tri = [a, r, q];
        for (const v of tri) { b.p.push(v[0], v[1], v[2]); b.n.push(N[0], N[1], N[2]); b.c.push(col[0], col[1], col[2]); }
      }
    }
  }
  return [...buckets.values()].map(b => ({
    metal: b.metal, rough: b.rough, emissive: b.emissive, glow: b.glow,
    position: new Float32Array(b.p), normal: new Float32Array(b.n), color: new Float32Array(b.c),
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
