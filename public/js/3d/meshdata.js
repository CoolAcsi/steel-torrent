// Turns the game's low-poly Models into plain triangle buffers an engine can use.
//
// A Model is a list of flat-coloured faces. Every face has a surface type: the one its builder
// tagged it with (Model.tag), or else one read off its colour, since the models use a small
// palette. All faces of a model go into one mesh; each vertex carries
//
//   uv      where the face sits in its material. Laid out on the face's own plane (u along
//           the wall, v up it), at a fixed number of model units per tile, so a bolt is the
//           same size on a bunker as on a tank and nothing is stretched across a slope. The
//           layout starts at the face's corner, and on plated materials it is fitted so a
//           whole number of plates spans the face: joints fall on the edges of the thing,
//           as they would if it had been built from plates.
//   edge    the distance to each edge of the face, and edgeK what kind of edge each one is:
//           an outside corner (paint wears off it: the sharper, the more), or a crease where
//           this part meets another or the ground (dirt collects there). A tile cannot know
//           where the edges of an object are; these two attributes are how the renderer does.
//
// Output is in ground coordinates (X right, Y up, Z toward the camera), triangles wound
// counter-clockwise seen from outside.

/**
 * Surface types.
 *   tex     the authored material (see textures.js)
 *   size    model units one tile covers
 *   fit     module of the material (a plate, a pane) in model units: faces are fitted to a
 *           whole number of them. 0 = lay it out at its natural scale
 *   scatter start each face somewhere else in the tile (surfaces with no joints to line up)
 *   wear    what an outside edge wears to: [width in model units, r, g, b, metalness, roughness, lighten]
 *           With `lighten` > 0 the edge is the surface's own colour times that (chipped
 *           concrete, frayed canvas) and r, g, b are not used; otherwise it is r, g, b
 *           (the steel under the paint). Width 0 = edges do not wear.
 */
export const SURFACES = {
  concrete:   { tex: 'concrete',   size: 24, fit: 0, wear: [0.42, 0, 0, 0, 0, 0.95, 1.13] },
  panel:      { tex: 'panel',      size: 24, fit: 12, wear: [0.5, 0.54, 0.55, 0.58, 1, 0.3, 0] },      // painted armour, cladding, team markings
  plating:    { tex: 'plating',    size: 24, fit: 12, wear: [0.32, 0.7, 0.71, 0.74, 1, 0.26, 0] },       // cool engineered plate
  steel:      { tex: 'steel',      size: 12, fit: 0, scatter: true, wear: [0.4, 0.62, 0.63, 0.66, 1, 0.24, 0] },   // barrels, machinery
  copper:     { tex: 'copper',     size: 10, fit: 0, scatter: true, wear: [0.5, 0.86, 0.58, 0.4, 1, 0.24, 0] },
  dark:       { tex: 'dark',       size: 10, fit: 0, scatter: true, wear: [0.3, 0, 0, 0, 0, 0.8, 1.5] },          // rubber, soot, openings
  corrugated: { tex: 'corrugated', size: 12, fit: 0, wear: [0.5, 0.62, 0.64, 0.67, 0.9, 0.36, 0] },
  brick:      { tex: 'brick',      size: 12, fit: 0, wear: [0.5, 0, 0, 0, 0, 0.95, 1.25] },
  sandbag:    { tex: 'sandbag',    size: 9,  fit: 0, wear: [0, 0, 0, 0, 0, 1, 0] },
  tread:      { tex: 'tread',      size: 8,  fit: 0, wear: [0.3, 0.62, 0.63, 0.66, 1, 0.24, 0] },
  roof:       { tex: 'roof',       size: 20, fit: 0, scatter: true, wear: [0.6, 0, 0, 0, 0, 0.9, 1.2] },
  cloth:      { tex: 'cloth',      size: 12, fit: 0, scatter: true, wear: [0.45, 0, 0, 0, 0, 0.98, 1.22] },
  glass:      { tex: 'glass',      size: 10, fit: 2.5, wear: [0, 0, 0, 0, 0, 1, 0] },
  foliage:    { tex: null,         size: 10, fit: 0, wear: [0, 0, 0, 0, 0, 1, 0] },
  wood:       { tex: 'wood',       size: 8,  fit: 0, wear: [0.5, 0, 0, 0, 0, 0.95, 1.3] },
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

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const FAR = 1e3;

function ihash(a, b, c) {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

/** The planes of every solid, for "is this point inside that part?" (solids are convex). */
function hulls(model) {
  return model.solids.map(s => {
    const planes = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const f of s.faces) {
      if (f.decal || f.glow) continue;
      planes.push([f.n, dot(f.n, f.p[0])]);
      for (const p of f.p) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
    return { planes, lo, hi };
  });
}
function inside(H, p, eps = 0.03) {
  if (!H.planes.length || p[0] < H.lo[0] - eps || p[1] < H.lo[1] - eps || p[2] < H.lo[2] - eps || p[0] > H.hi[0] + eps || p[1] > H.hi[1] + eps || p[2] > H.hi[2] + eps) return false;
  for (const [n, d] of H.planes) if (dot(n, p) - d > eps) return false;
  return true;
}

/**
 * What kind of edge each edge of each face is: > 0 an outside corner (1 = a right angle or
 * sharper, less for the shallow angle between two facets of a barrel), < 0 a crease against
 * another part or the ground, 0 neither (a joint between facets too shallow to wear, the
 * outline of a marking painted on a wall).
 */
function edgeKinds(model) {
  const H = hulls(model), kinds = new Map();
  const key = (a, b) => { const q = p => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)},${Math.round(p[2] * 50)}`; const A = q(a), B = q(b); return A < B ? `${A}|${B}` : `${B}|${A}`; };
  model.solids.forEach((s, si) => {
    const shared = new Map();
    for (const f of s.faces) {
      if (f.decal) continue;
      for (let i = 0; i < f.p.length; i++) { const k = key(f.p[i], f.p[(i + 1) % f.p.length]); (shared.get(k) || shared.set(k, []).get(k)).push(f); }
    }
    for (const f of s.faces) {
      const m = f.p.length, c = [0, 0, 0];
      for (const p of f.p) { c[0] += p[0] / m; c[1] += p[1] / m; c[2] += p[2] / m; }
      const out = [];
      for (let i = 0; i < m; i++) {
        const a = f.p[i], b = f.p[(i + 1) % m], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        let e = norm(cross(sub(b, a), f.n));                                 // in the face's plane, across the edge
        if (dot(e, sub(mid, c)) < 0) e = [-e[0], -e[1], -e[2]];              // ...pointing away from the face
        let k;
        if (f.decal) {
          // A marking: its outline is only an edge where it reaches the edge of the wall it is painted on.
          const inner = [mid[0] + e[0] * 0.3 - f.n[0] * 0.3, mid[1] + e[1] * 0.3 - f.n[1] * 0.3, mid[2] + e[2] * 0.3 - f.n[2] * 0.3];
          k = inside(H[si], inner) ? 0 : 0.9;
        } else {
          const other = (shared.get(key(a, b)) || []).find(g => g !== f);
          const bend = other ? 1 - dot(f.n, other.n) : 1;                    // 0 flat ... 1 a right angle ... 2 a knife edge
          k = Math.max(0, Math.min(1, (bend - 0.32) / 0.5));              // the facets of a barrel (45 degrees) do not count as corners
        }
        if (k > 0) {
          // Just outside the corner: inside another part means the corner is buried in it.
          const probe = [mid[0] + (e[0] + f.n[0]) * 0.28, mid[1] + (e[1] + f.n[1]) * 0.28, mid[2] + (e[2] + f.n[2]) * 0.28];
          if (probe[2] < 0.12 && e[2] < -0.3) k = -0.8;                      // the foot of something standing on the ground
          else for (let j = 0; j < H.length; j++) if (j !== si && inside(H[j], probe)) { k = -1; break; }
        }
        out.push(k);
      }
      kinds.set(f, out);
    }
  });
  return kinds;
}

/**
 * @returns [{ surface, glow: [r, g, b] | null, field, position, normal, color (linear RGB), uv, edge, edgeK }] (typed arrays)
 */
export function modelBuckets(model, scale = 1) {
  const buckets = new Map(), kinds = edgeKinds(model);
  let faceNo = 0;
  for (const s of model.solids) {
    let layer = 0;
    for (const f of s.faces) {
      faceNo++;
      const col = rgb(f.c);
      // 'glow' faces are light sources, 'field' faces are light hanging in the air (a shield, a wormhole throat)
      const surface = f.glow ? 'glow' : f.m === 'field' ? 'field' : (f.m && SURFACES[f.m] ? f.m : surfaceOf(f.c));
      let b = buckets.get(surface);
      if (!b) buckets.set(surface, (b = { surface, glow: f.glow ? col : null, p: [], n: [], c: [], t: [], e: [], k: [] }));
      const lift = f.decal ? 0.08 * ++layer : 0;        // decals sit a hair above their wall
      const S = SURFACES[surface] || SURFACES.panel, m = f.p.length;

      // Texture coordinates on the face's own plane: u along the wall, v up it (model axes: x, y on the ground, z up).
      const flat = Math.abs(f.n[2]) > 0.95, hl = Math.hypot(f.n[0], f.n[1]) || 1;
      const U = flat ? [1, 0, 0] : [-f.n[1] / hl, f.n[0] / hl, 0], V = flat ? [0, 1, 0] : cross(f.n, U);
      const pu = f.p.map(v => dot(v, U)), pv = f.p.map(v => dot(v, V));
      const u0 = Math.min(...pu), v0 = Math.min(...pv), w = Math.max(...pu) - u0, h = Math.max(...pv) - v0;
      let k = 1, ou = 0, ov = 0;
      const r1 = ihash(faceNo, Math.round(u0 * 7), Math.round(v0 * 7)), r2 = ihash(Math.round(w * 9), faceNo, 5);
      if (S.fit) {
        const L = Math.max(w, h);
        if (L >= S.fit * 0.75) { k = Math.max(0.8, Math.min(1.25, Math.max(1, Math.round(L / S.fit)) * S.fit / L)); }
        else ou = ov = S.fit * 0.14;                     // smaller than a plate: it is cut from the middle of one
        ou += Math.floor(r1 * 4) * S.fit; ov += Math.floor(r2 * 4) * S.fit;   // a different plate of the set on every face
      } else if (S.scatter) { ou = r1 * S.size; ov = r2 * S.size; }
      const uv = (a, c) => [((a - u0) * k + ou) / S.size, ((c - v0) * k + ov) / S.size];

      // game (x, y, z up) -> ground (x, z, y)
      const N = [f.n[0], f.n[2], f.n[1]];
      const at = v => [(v[0] + f.n[0] * lift) * scale, (v[2] + f.n[2] * lift) * scale, (v[1] + f.n[1] * lift) * scale];
      const K = kinds.get(f) || [];
      /** Distance from p to the line through edge i of the face. */
      const toEdge = (p, i) => { const a = f.p[i], d = norm(sub(f.p[(i + 1) % m], a)), q = sub(p, a), t = dot(q, d); return Math.hypot(q[0] - d[0] * t, q[1] - d[1] * t, q[2] - d[2] * t) * scale; };
      const tris = [];
      if (m <= 4) {
        // Each corner knows how far it is from every edge; across the face that is exact.
        const P = f.p.map((v, i) => ({ p: at(v), t: uv(pu[i], pv[i]), e: [0, 1, 2, 3].map(j => (j < m ? toEdge(v, j) : FAR)), k: [0, 1, 2, 3].map(j => (j < m ? K[j] || 0 : 0)) }));
        for (let i = 1; i + 1 < m; i++) tris.push([P[0], P[i], P[i + 1]]);
      } else {
        // Many-sided faces (the top of a drum) are cut into wedges from the middle; each wedge has one edge of its own.
        const c = [0, 0, 0];
        for (const v of f.p) { c[0] += v[0] / m; c[1] += v[1] / m; c[2] += v[2] / m; }
        const tc = uv(dot(c, U), dot(c, V));
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m, kk = [K[i] || 0, 0, 0, 0];
          tris.push([{ p: at(c), t: tc, e: [toEdge(c, i), FAR, FAR, FAR], k: kk }, { p: at(f.p[i]), t: uv(pu[i], pv[i]), e: [0, FAR, FAR, FAR], k: kk }, { p: at(f.p[j]), t: uv(pu[j], pv[j]), e: [0, FAR, FAR, FAR], k: kk }]);
        }
      }
      for (let tri of tris) {
        const a = tri[0].p, q = tri[1].p, r = tri[2].p;
        const cx = (q[1] - a[1]) * (r[2] - a[2]) - (q[2] - a[2]) * (r[1] - a[1]);
        const cy = (q[2] - a[2]) * (r[0] - a[0]) - (q[0] - a[0]) * (r[2] - a[2]);
        const cz = (q[0] - a[0]) * (r[1] - a[1]) - (q[1] - a[1]) * (r[0] - a[0]);
        if (cx * N[0] + cy * N[1] + cz * N[2] < 0) tri = [tri[0], tri[2], tri[1]];
        for (const v of tri) {
          b.p.push(v.p[0], v.p[1], v.p[2]); b.n.push(N[0], N[1], N[2]); b.c.push(col[0], col[1], col[2]); b.t.push(v.t[0], v.t[1]);
          b.e.push(v.e[0], v.e[1], v.e[2], v.e[3]); b.k.push(v.k[0], v.k[1], v.k[2], v.k[3]);
        }
      }
    }
  }
  return [...buckets.values()].map(b => ({
    surface: b.surface, glow: b.glow, field: b.surface === 'field',
    position: new Float32Array(b.p), normal: new Float32Array(b.n), color: new Float32Array(b.c), uv: new Float32Array(b.t),
    edge: new Float32Array(b.e), edgeK: new Float32Array(b.k),
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
