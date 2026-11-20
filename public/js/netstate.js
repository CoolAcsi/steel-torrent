// Match state as the client knows it, shared by the browser and the network
// tests. The server sends a full state once, then only the cities and armies
// that changed; every update carries a sequence number and a checksum of the
// whole state, so a missed update or any drift is detected immediately.
//
// Record layouts are documented in game/proto.js and must match it.

const CITY = 5;   // values per city in a full state
const mix = (h, v) => Math.imul(h ^ (v & 0xffff), 16777619);

export function makeState(n) {
  return {
    n,
    owner: new Int8Array(n), level: new Int8Array(n), units: new Int32Array(n),
    power: new Int32Array(n), shield: new Int8Array(n),
    armies: new Map(),      // id -> army
    players: [],            // player records, see game/proto.js
    seq: -1,
  };
}

/** FNV-1a over cities and armies (armies in id order). Must match hashGame() on the server. */
export function hashState(st) {
  let h = 2166136261;
  for (let i = 0; i < st.n; i++) {
    h = mix(h, st.owner[i]);
    h = mix(h, st.level[i]);
    h = mix(h, st.units[i]);
  }
  for (const id of [...st.armies.keys()].sort((a, b) => a - b)) {
    h = mix(h, id);
    const a = st.armies.get(id);
    h = mix(h, a.n);
    h = mix(h, a.to);
    h = mix(h, a.dest);
  }
  return h >>> 0;
}

function setCity(st, i, o, l, n, pow, sh) {
  st.owner[i] = o; st.level[i] = l; st.units[i] = n; st.power[i] = pow; st.shield[i] = sh;
}

function setArmy(st, r, time) {
  let a = st.armies.get(r[0]);
  if (!a) st.armies.set(r[0], (a = { id: r[0] }));
  a.o = r[1]; a.from = r[2]; a.to = r[3];
  a.s = r[4]; a.v = r[5]; a.t = time;     // position at server time `time`, moving at v
  a.n = r[6]; a.pow = r[7]; a.st = r[8];
  a.n1 = r[9]; a.n2 = r[10]; a.n3 = r[11]; a.fl = r[12];
  a.dest = r.length > 13 ? r[13] : r[3];   // final destination; `to` is only the next waypoint
  a.path = r.length > 14 ? r.slice(14) : [];
  return a;
}

export function applyFull(st, cities, armies, time) {
  for (let i = 0, j = 0; i < st.n; i++, j += CITY) setCity(st, i, cities[j], cities[j + 1], cities[j + 2], cities[j + 3], cities[j + 4]);
  const keep = new Set();
  for (const r of armies) { setArmy(st, r, time); keep.add(r[0]); }
  for (const id of [...st.armies.keys()]) if (!keep.has(id)) st.armies.delete(id);
}

/**
 * Apply one server update ('d' delta or 'k' keyframe). Returns 'ok', or why a
 * resync is needed: 'gap' (an update was missed) or 'hash' (state diverged).
 */
export function applyUpdate(st, m) {
  if (m.t === 'k') {
    applyFull(st, m.c, m.a, m.time);
  } else {
    if (m.q !== st.seq + 1) return 'gap';
    const c = m.c;
    for (let j = 0; j < c.length; j += CITY + 1) {
      const i = c[j];
      if (i < 0 || i >= st.n) return 'hash';
      setCity(st, i, c[j + 1], c[j + 2], c[j + 3], c[j + 4], c[j + 5]);
    }
    for (const r of m.a) setArmy(st, r, m.time);
    for (const id of m.r) st.armies.delete(id);
  }
  st.seq = m.q;
  if (m.p) st.players = m.p;
  return hashState(st) === m.h ? 'ok' : 'hash';
}
