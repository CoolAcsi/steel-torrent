'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game } = require('./game/sim');
const { Pace } = require('./game/clock');
const { BALANCE, MAX_PLAYERS, FACTIONS } = require('./game/config');
const { cityRec, armyRec, armySig, playerRecs, hashGame, zones } = require('./game/proto');
const tutorial = require('./game/tutorial');

// ---------------------------------------------------------------- configuration
// Everything deployment-specific comes from the environment (see .env.example).
// Nothing here is a secret and nothing secret is ever sent to the browser.

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const list = v => String(v || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

const cfg = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),
  trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || ''),
  maxClients: int(process.env.MAX_CLIENTS, 1000),
  maxRooms: int(process.env.MAX_ROOMS, 200),
  maxConnPerIp: int(process.env.MAX_CONN_PER_IP, 20),
  reconnectGraceMs: int(process.env.RECONNECT_GRACE_MS, 60000),
  logLevel: process.env.LOG_LEVEL || 'info',
  // Lobby. All of these are real time: they never follow game speed or pause.
  nameMax: Math.max(3, int(process.env.NAME_MAX, 16)),                       // display name length, in characters
  joinAttempts: Math.max(1, int(process.env.JOIN_ATTEMPTS, 8)),              // room-code tries per connection...
  joinWindowMs: Math.max(1, int(process.env.JOIN_WINDOW_SECONDS, 30)) * 1000,   // ...within this long
  readyWarnMs: Math.max(1, int(process.env.READY_WARN_SECONDS, 45)) * 1000,     // not ready this long while others wait: flagged idle
  loadTimeoutMs: Math.max(1, int(process.env.LOAD_TIMEOUT_SECONDS, 20)) * 1000, // a match starts at the latest this long after Start
};
const PROD = cfg.env === 'production';
if (cfg.publicUrl) cfg.allowedOrigins.push(new URL(cfg.publicUrl).origin);

const PUB = path.join(__dirname, 'public');
const DT = 0.05;              // simulation step (seconds)
const SNAP_MS = 100;           // state update at most this often, in real time (10 per second at any game speed)
const IDLE_EVERY = 10;        // ...but at least this often when nothing changed
const KEY_EVERY = 50;         // every Nth update is a full keyframe
const HEARTBEAT_MS = 15000;   // ping interval; a socket that misses one is dropped
const MAX_MSG_BYTES = 2048;   // largest client message accepted
const RATE_BURST = 40;        // token bucket: burst size...
const RATE_PER_SEC = 20;      // ...and refill rate, per connection

const AI_NAMES = ['Viper', 'Anvil', 'Ghost', 'Rook', 'Hammer', 'Onyx', 'Sable', 'Talon'];
const AI_LEVELS = ['easy', 'normal', 'hard'];

// ---------------------------------------------------------------- logging
// One line per event. Never logs names, addresses, tokens or message bodies.

const LOG_RANK = { debug: 10, info: 20, warn: 30, error: 40 };
function log(level, event, fields = {}) {
  if (LOG_RANK[level] < (LOG_RANK[cfg.logLevel] || 20)) return;
  if (PROD) console.log(JSON.stringify({ t: new Date().toISOString(), level, event, ...fields }));
  else console.log(`[${level}] ${event}`, Object.keys(fields).length ? fields : '');
}

// ---------------------------------------------------------------- static files
// Assets are served under /v/<build>/..., where <build> is a hash of every
// file. HTML points at that prefix, so assets can be cached forever and a new
// deploy can never mix old and new modules. HTML itself is always revalidated.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${base}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.name !== 'package.json' && !e.name.startsWith('.')) out.push(rel);
  }
  return out.sort();
}

let build = 'dev';
let assets = new Map();       // url path -> { type, raw, br, gz, etag }

function loadAssets() {
  const files = walk(PUB);
  const h = crypto.createHash('sha256');
  const raw = new Map();
  for (const f of files) {
    const buf = fs.readFileSync(path.join(PUB, f));
    raw.set(f, buf);
    h.update(f).update(buf);
  }
  build = h.digest('hex').slice(0, 12);

  // Preload every module the game imports so the browser fetches them in
  // parallel instead of discovering them one import at a time.
  const preload = files
    // (not /js/3d/: the 3D renderer and the engine behind it load on demand, only when a match uses them)
    .filter(f => f.startsWith('/js/') && !f.startsWith('/js/3d/') && f.endsWith('.js') && f !== '/js/armory.js')
    .map(f => `<link rel="modulepreload" href="v/${build}${f}">`)
    .join('\n');

  const next = new Map();
  for (const [f, buf0] of raw) {
    const ext = path.extname(f);
    let buf = buf0;
    if (ext === '.html') {
      let html = buf.toString('utf8')
        .replace(/(href|src)="(style\.css|js\/[\w./-]+)"/g, `$1="v/${build}/$2"`)
        .replace('</title>', `</title>\n<meta name="build" content="${build}">`);
      if (f === '/index.html') html = html.replace('<link rel="stylesheet"', `${preload}\n<link rel="stylesheet"`);
      buf = Buffer.from(html);
    }
    const a = { type: MIME[ext] || 'application/octet-stream', raw: buf, etag: `"${crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16)}"` };
    if (COMPRESSIBLE.has(ext) && buf.length > 256) {
      a.br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: PROD ? 11 : 4 } });
      a.gz = zlib.gzipSync(buf, { level: PROD ? 9 : 4 });
    }
    next.set(f, a);
  }
  assets = next;
}
loadAssets();

/** Development only: rebuild the asset table when a file under public/ was added, removed or saved. */
let stamp = '';
function reloadIfChanged() {
  const now = walk(PUB).map(f => { const st = fs.statSync(path.join(PUB, f)); return `${f}:${st.mtimeMs}:${st.size}`; }).join('|');
  if (now === stamp) return;
  stamp = now;
  loadAssets();
}

function securityHeaders(req, isHtml) {
  const h = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (isHtml) {
    const host = hostOf(req);
    h['Content-Security-Policy'] = [
      "default-src 'self'", "img-src 'self' data:", "style-src 'self'", "script-src 'self'",
      `connect-src 'self' ws://${host} wss://${host}`, "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'",
    ].join('; ');
    h['X-Frame-Options'] = 'DENY';
    if (cfg.publicUrl.startsWith('https://')) h['Strict-Transport-Security'] = 'max-age=31536000';
  }
  return h;
}

function serveStatic(req, res) {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  let immutable = false;
  const m = /^\/v\/([\w-]+)(\/.*)$/.exec(p);
  if (m) { immutable = m[1] === build; p = m[2]; }
  if (p === '/') p = '/index.html';

  if (!PROD) reloadIfChanged();                  // development: always serve what is on disk
  const a = assets.get(p);                       // lookup in a fixed table: no path traversal possible
  if (!a) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }

  const isHtml = a.type.startsWith('text/html');
  const headers = {
    'Content-Type': a.type,
    ETag: a.etag,
    Vary: 'Accept-Encoding',
    'Cache-Control': !PROD ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...securityHeaders(req, isHtml),
  };
  if (PROD && req.headers['if-none-match'] === a.etag) { res.writeHead(304, headers); return res.end(); }
  const enc = String(req.headers['accept-encoding'] || '');
  let body = a.raw;
  if (a.br && /\bbr\b/.test(enc)) { body = a.br; headers['Content-Encoding'] = 'br'; }
  else if (a.gz && /\bgzip\b/.test(enc)) { body = a.gz; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const started = Date.now();
let matchesPlayed = 0;

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  if (req.url === '/healthz') {                  // liveness for load balancers and monitors
    const body = JSON.stringify({
      status: 'ok', build, uptime: Math.round((Date.now() - started) / 1000),
      clients: clients.size, rooms: rooms.size,
      matches: [...rooms.values()].filter(r => r.state === 'playing').length, matchesPlayed,
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  serveStatic(req, res);
});
server.keepAliveTimeout = 65000;                 // outlive typical proxy idle timeouts

function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ---------------------------------------------------------------- request metadata

function hostOf(req) {
  return String((cfg.trustProxy && req.headers['x-forwarded-host']) || req.headers.host || '').split(',')[0].trim();
}

function ipOf(req) {
  const ip = cfg.trustProxy && req.headers['x-forwarded-for']
    ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
    : req.socket.remoteAddress || '';
  // Some proxies (IIS ARR by default) append the client's port; without
  // stripping it every connection would look like a different address.
  const m = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip) || /^\[([0-9a-f:.]+)\]:\d+$/i.exec(ip);
  return m ? m[1] : ip;
}

/**
 * Browsers always send Origin on WebSocket handshakes. Accept only our own
 * site: an explicit allow-list when configured, otherwise the same host the
 * page was served from. Requests with no Origin (scripts) are refused in
 * production.
 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return !PROD;
  let o;
  try { o = new URL(origin); } catch { return false; }
  if (cfg.allowedOrigins.length) {
    if (cfg.allowedOrigins.includes(o.origin)) return true;
    if (PROD) return false;
  }
  return o.host === hostOf(req);
}

// ---------------------------------------------------------------- state

const clients = new Set();   // { id, name, token, ws, room, ip, tokens, strikes }
const rooms = new Map();     // code -> room
const perIp = new Map();     // ip -> open connections
let nextClientId = 1;

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function humans(room) {
  return room.players.filter(p => !p.bot);
}

function broadcast(room, obj) {
  const s = JSON.stringify(obj);
  for (const p of room.players) {
    if (p.client && p.connected && p.client.ws.readyState === 1) p.client.ws.send(s);
  }
}

function roomMsg(room) {
  return {
    t: 'room',
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    max: MAX_PLAYERS,
    opts: room.opts,
    players: room.players.map(p => ({
      id: p.id, name: p.name, color: p.color, ai: p.bot ? p.ai : null, connected: p.connected,
      bot: p.bot ? p.botIdx : -1, faction: p.faction, sub: p.sub,
      ready: p.bot || !!p.ready,                 // bots are always ready
      idle: isIdle(p) || undefined,              // kept the others waiting past the warning time
    })),
    // In a match: who sits in which seat, so a renamed player is renamed in the HUD too.
    seats: room.order ? room.order.map(p => p.id) : undefined,
    tutorial: room.tutorial ? true : undefined,  // a private lesson room: never listed, never joinable
  };
}

// ---------------------------------------------------------------- ready check
// Every human says when they are ready; the host can start only when all of them
// are, the host included. Anything that changes what the match will be clears the
// readiness it affects, so nobody is committed to a match they did not agree to.

/** Clear readiness: everyone's, or just one player's. */
function unready(room, only) {
  const now = Date.now();
  for (const p of room.players) {
    if (p.bot || (only && p !== only) || !p.ready) continue;
    p.ready = false;
    p.waitSince = 0;
  }
  refreshIdle(room, now);
}

/**
 * A player is idle when they have been not ready for READY_WARN_SECONDS of real
 * time while at least one other human was ready and waiting. They are warned and
 * the host is offered a kick; nobody is ever removed automatically.
 */
function refreshIdle(room, now = Date.now()) {
  if (room.state !== 'lobby') return;
  const present = humans(room).filter(p => p.connected);
  for (const p of present) {
    const kept = !p.ready && present.some(q => q !== p && q.ready);
    if (!kept) p.waitSince = 0;
    else if (!p.waitSince) p.waitSince = now;
  }
}
function isIdle(p) {
  return !p.bot && !p.ready && !!p.waitSince && Date.now() - p.waitSince >= cfg.readyWarnMs;
}
function allReady(room) {
  return humans(room).filter(p => p.connected).every(p => p.ready);
}

function broadcastRoom(room) {
  broadcast(room, roomMsg(room));
  broadcastLobby();
}

function lobbyMsg() {
  const out = [];
  for (const r of rooms.values()) {
    if (r.state !== 'lobby') continue;
    const host = r.players.find(p => p.id === r.hostId);
    out.push({ code: r.code, host: host ? host.name : '?', n: r.players.length, max: MAX_PLAYERS });
    if (out.length >= 30) break;
  }
  return { t: 'rooms', rooms: out };
}

function broadcastLobby() {
  const s = JSON.stringify(lobbyMsg());
  for (const c of clients) if (!c.room && c.ws.readyState === 1) c.ws.send(s);
}

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c) && !closedCodes.has(c)) return c;
  }
}

function freeColor(room) {
  for (let c = 0; c < MAX_PLAYERS; c++) {
    if (!room.players.some(p => p.color === c)) return c;
  }
  return 0;
}

/**
 * A display name from untrusted input: any script (Chinese included), no control or
 * invisible format characters, inner whitespace collapsed, at most NAME_MAX characters
 * (counted as characters, not UTF-16 units). Names are only ever shown as text, and
 * identity is the client id, never the name.
 */
function cleanName(s, fallback) {
  s = String(s == null ? '' : s).normalize('NFC')
    .replace(/\s+/gu, ' ').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}<>]/gu, '').trim();
  s = [...s].slice(0, cfg.nameMax).join('').trim();
  return s || fallback;
}

// ---------------------------------------------------------------- rooms

function uniqueName(room, name, self) {
  const used = new Set(room.players.filter(p => p !== self).map(p => p.name));
  if (!used.has(name)) return name;
  const stem = [...name].slice(0, cfg.nameMax - 3).join('').trim();
  for (let i = 2; ; i++) {
    const n = `${stem} ${i}`;
    if (!used.has(n)) return n;
  }
}

/** Valid [faction, sub] from untrusted input; falls back to the least-used faction. */
function pickFaction(room, f, sub) {
  if (typeof f !== 'string' || !Object.hasOwn(FACTIONS, f)) {
    const ids = Object.keys(FACTIONS);
    const used = id => room.players.filter(p => p.faction === id).length;
    f = ids.slice().sort((a, b) => used(a) - used(b))[0];
    sub = null;
  }
  if (!FACTIONS[f].includes(sub)) sub = FACTIONS[f][crypto.randomInt(FACTIONS[f].length)];
  return [f, sub];
}

function createRoom(client, pref) {
  const room = {
    code: newCode(), hostId: client.id, state: 'lobby', players: [],
    game: null, order: null, timer: null, emptySince: 0, botSeq: 0,
    opts: { crates: false },          // room settings chosen by the host
  };
  rooms.set(room.code, room);
  addHuman(room, client, pref);
  log('info', 'room_create', { room: room.code, rooms: rooms.size });
  return room;
}

function addHuman(room, client, pref = {}) {
  const [faction, sub] = pickFaction(room, pref.faction, pref.sub);
  room.players.push({
    id: client.id, name: uniqueName(room, client.name), color: freeColor(room),
    bot: false, ai: null, client, connected: true, faction, sub,
    ready: false, waitSince: 0, loaded: false,
  });
  client.room = room;
  room.emptySince = 0;
  unready(room);                                 // someone new: everybody confirms again
}

// Codes of rooms that closed recently, so a late join can be told "that room has closed"
// rather than "no such room", and so a fresh room does not reuse the code at once.
const closedCodes = new Map();   // code -> when
const CLOSED_KEEP_MS = 10 * 60 * 1000;

function destroyRoom(room) {
  stopLoading(room);
  closedCodes.set(room.code, Date.now());
  if (closedCodes.size > 500) closedCodes.delete(closedCodes.keys().next().value);
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  for (const p of room.players) if (p.client && p.client.room === room) p.client.room = null;
  rooms.delete(room.code);
  log('info', 'room_destroy', { room: room.code, rooms: rooms.size });
}

function pickHost(room) {
  const cur = room.players.find(p => p.id === room.hostId);
  if (cur && !cur.bot && cur.connected) return;
  const next = humans(room).find(p => p.connected);
  if (next) room.hostId = next.id;
}

/** A player leaves for good (button) or drops (socket closed). */
function removeFromRoom(client, dropped) {
  const room = client.room;
  if (!room) return;
  client.room = null;
  const p = room.players.find(q => q.client === client);
  if (!p) return;

  if (room.tutorial) {
    // A lesson belongs to one player. Leaving closes it; a dropped connection stops it and keeps
    // it for the usual reconnect window, and the lesson starts again when its player is back.
    stopLoading(room);
    if (room.timer) clearInterval(room.timer);
    room.timer = null;
    p.connected = false;
    if (dropped) room.emptySince = Date.now(); else destroyRoom(room);
    return;
  }

  if (room.state === 'lobby') {
    room.players.splice(room.players.indexOf(p), 1);
    unready(room);                               // the line-up changed: everybody confirms again
  } else {
    // Mid-game: the seat stays and a bot plays it. A dropped player may come back.
    p.connected = false;
    if (!dropped) p.client = null;
    const idx = room.order.indexOf(p);
    if (idx >= 0 && room.game) room.game.setAI(idx, 'normal');
  }

  if (!humans(room).some(h => h.connected)) {
    const canReturn = dropped && room.state !== 'lobby';
    if (canReturn) room.emptySince = Date.now();
    else { destroyRoom(room); broadcastLobby(); return; }
  }
  pickHost(room);
  broadcastRoom(room);
  if (room.state === 'loading') checkLoaded(room);   // whoever left no longer holds the others up
}

// ---------------------------------------------------------------- game loop
// The simulation is authoritative and runs at a fixed step. Clients receive:
//   start  map, rules and full state, once
//   d      only the cities and armies that changed since the previous update
//   k      a full keyframe (periodically, and whenever a client asks to resync)
//   ev     discrete events to animate (captures, shots, casts, crates...)
// Armies are sent with position and speed and extrapolated by the client, so a
// marching army costs nothing on the wire until something about it changes.
// Every d/k carries a sequence number and a checksum of the whole state.

const ARMY_REFRESH = 2;       // seconds between position corrections for an unchanged army
const PLAYERS_EVERY = 5;      // send skill timers with every Nth update

function fullState(room) {
  const g = room.game;
  return {
    c: g.nodes.flatMap(n => cityRec(g, n)),
    a: g.armies.map(a => armyRec(g, a)),
    p: playerRecs(g),
  };
}

function startMsg(room, idx) {
  const g = room.game;
  return {
    t: 'start', you: idx, cfg: BALANCE, opts: room.opts,
    map: { w: g.w, h: g.h, nodes: g.nodes.map(n => [n.x, n.y]), edges: g.edges },
    players: room.order.map(p => ({ name: p.name, color: p.color, ai: p.bot, bot: p.bot ? p.botIdx : -1, faction: p.faction, sub: p.sub })),
    time: +g.t.toFixed(3), q: room.q, ...fullState(room),
    crates: g.crates.map(cr => [cr.id, cr.px, cr.py]), zones: zones(g),
    alive: g.alive, winner: g.winner, report: g.winner !== null ? g.report() : null,
    ctl: ctlState(room), auto: g.autoList(idx), feat: g.features(),
  };
}

/** Pause and speed, as every client must see them (also sent to anyone joining or reconnecting). */
function ctlState(room) {
  return { paused: room.paused, by: room.pausedBy, speed: room.pace.speed, time: +room.game.t.toFixed(3) };
}

/** Each player is told their own persistent orders whenever they change; nobody is told anyone else's. */
function syncAuto(room, only) {
  const g = room.game;
  room.order.forEach((p, i) => {
    if (!p.client || !p.connected || (only && p !== only)) return;
    const list = g.autoList(i), sig = JSON.stringify(list);
    if (sig === p.autoSig) return;
    p.autoSig = sig;
    send(p.client.ws, { t: 'auto', list });
  });
}

/** Random per match. Outside production MATCH_SEED pins the map, so two builds can be compared on the same battlefield. */
function matchSeed() {
  const fixed = PROD ? NaN : parseInt(process.env.MATCH_SEED, 10);
  return Number.isInteger(fixed) && fixed >= 0 ? fixed : crypto.randomInt(2 ** 31);
}

// Starting a match has two steps. Start (accepted only when everyone is ready) creates the
// match and sends it to every client, but the simulation stands still: the room is 'loading'.
// Each client loads what it needs and reports `loaded`. When every connected human has, or
// LOAD_TIMEOUT_SECONDS of real time have passed, the match goes: state 'playing', `go` to all.
// Loaded is a different thing from lobby-ready, and is tracked per player.
function startGame(room, prepared) {
  room.state = 'loading';
  room.order = room.players.slice();
  room.game = prepared || new Game(
    room.order.map(p => ({ ai: p.bot ? p.ai : null, faction: p.faction, sub: p.sub })),
    matchSeed(), room.opts,
  );
  room.q = 0;
  room.lastCities = room.game.nodes.map(n => cityRec(room.game, n));
  room.sent = new Map();        // army id -> { sig, at } as last told to clients
  room.sinceSend = 0;
  room.forceKey = false;
  room.startedAt = Date.now();
  room.pace = new Pace(DT, BALANCE.defaultSpeed);
  room.paused = false;
  room.pausedBy = null;
  room.loadUntil = Date.now() + cfg.loadTimeoutMs;
  room.order.forEach((p, i) => {
    p.autoSig = '[]';
    p.loaded = false;
    if (p.client) send(p.client.ws, { ...startMsg(room, i), loading: true });
  });
  room.loadTimer = setInterval(() => {
    if (Date.now() >= room.loadUntil) return go(room, 'timeout');
    broadcastLoading(room);
  }, 1000);
  log('info', 'match_loading', { room: room.code, players: room.order.length, humans: humans(room).length, crates: room.opts.crates });
  broadcastRoom(room);
  broadcastLoading(room);
}

/** Connected humans who have not finished loading. */
function stillLoading(room) {
  return room.order.filter(p => !p.bot && p.connected && !p.loaded);
}

function broadcastLoading(room) {
  broadcast(room, {
    t: 'loading', waiting: stillLoading(room).map(p => p.name),
    left: Math.max(0, Math.ceil((room.loadUntil - Date.now()) / 1000)),
  });
}

function checkLoaded(room) {
  if (room.state !== 'loading') return;
  if (stillLoading(room).length) broadcastLoading(room); else go(room, 'loaded');
}

function stopLoading(room) {
  if (room.loadTimer) clearInterval(room.loadTimer);
  room.loadTimer = null;
}

/** The barrier lifts: the simulation starts from zero now, with no time owed. */
function go(room, why) {
  if (room.state !== 'loading') return;
  stopLoading(room);
  room.state = 'playing';
  room.startedAt = Date.now();
  room.lastTick = room.lastSnap = Date.now();
  room.timer = setInterval(() => tickRoom(room), DT * 1000);
  log('info', 'match_start', { room: room.code, players: room.order.length, humans: humans(room).length, crates: room.opts.crates, why, late: stillLoading(room).length });
  broadcast(room, { t: 'go', time: +room.game.t.toFixed(3) });
  broadcastRoom(room);
}

function broadcastState(room, force) {
  const g = room.game;
  const c = [];
  g.nodes.forEach((n, i) => {
    const rec = cityRec(g, n), prev = room.lastCities[i];
    if (rec.some((v, k) => v !== prev[k])) { c.push(i, ...rec); room.lastCities[i] = rec; }
  });
  const a = [], r = [], live = new Set();
  for (const army of g.armies) {
    live.add(army.id);
    const rec = armyRec(g, army), sig = armySig(rec), prev = room.sent.get(army.id);
    if (!prev || prev.sig !== sig || g.t - prev.at > ARMY_REFRESH) { a.push(rec); room.sent.set(army.id, { sig, at: g.t }); }
  }
  for (const id of [...room.sent.keys()]) if (!live.has(id)) { r.push(id); room.sent.delete(id); }

  room.sinceSend++;
  if (!force && !room.forceKey && !c.length && !a.length && !r.length && room.sinceSend < IDLE_EVERY) return;
  room.sinceSend = 0;
  room.q++;
  const time = +g.t.toFixed(3), h = hashGame(g);
  if (room.forceKey || room.q % KEY_EVERY === 0) {
    room.forceKey = false;
    for (const army of g.armies) room.sent.set(army.id, { sig: armySig(armyRec(g, army)), at: g.t });
    broadcast(room, { t: 'k', q: room.q, time, ...fullState(room), h });
  } else {
    const msg = { t: 'd', q: room.q, time, c, a, r, h };
    if (force || room.q % PLAYERS_EVERY === 0) msg.p = playerRecs(g);
    broadcast(room, msg);
  }
}

/** Push everything that happened since the last call out to the room. */
function pump(room, stateDue, force) {
  const g = room.game;
  const out = g.drain();
  if (room.tutorial) tutorial.observe(room.tutorial, out.events);
  if (stateDue || out.events.length) broadcastState(room, force || out.events.length > 0);
  for (const e of out.events) broadcast(room, { t: 'ev', ...e });
  syncAuto(room);
  // Things standing on the map (emplacements, obstacles, wormholes, shields, rebuilds): everyone
  // is told whenever the set changes, and gets it whole on joining.
  if (room.featRev !== g.featRev) {
    room.featRev = g.featRev;
    broadcast(room, { t: 'feat', list: g.features(), time: +g.t.toFixed(3) });
  }

  if (g.winner !== null && room.state === 'playing') {
    clearInterval(room.timer);
    room.timer = null;
    room.state = 'ended';
    matchesPlayed++;
    // Results come from events recorded during play, for every seat, connected or not.
    broadcast(room, { t: 'report', rows: g.report(), sim: Math.round(g.t), real: Math.round((Date.now() - room.startedAt) / 1000) });
    log('info', 'match_end', { room: room.code, seconds: Math.round((Date.now() - room.startedAt) / 1000) });
    broadcastRoom(room);
  }
  if (room.tutorial) tutStep(room);
}

// ---------------------------------------------------------------- tutorial
// A lesson is a private room with one player, running a real match on a small scripted map
// (game/tutorial.js). It goes through the same start, loading, update and order handling as
// any match; the only additions are the lesson's completion checks, run after every
// simulation update and after every message from its player.

function createTutorialRoom(client, m) {
  const room = {
    code: newCode(), hostId: client.id, state: 'tutorial', players: [],
    game: null, order: null, timer: null, emptySince: 0, botSeq: 1,
    opts: { crates: false }, tutorial: tutorial.session(m),
  };
  rooms.set(room.code, room);
  room.players.push({
    id: client.id, name: client.name, color: 0, bot: false, ai: null, client, connected: true,
    faction: 'iron', sub: 'bastion', ready: true, waitSince: 0, loaded: false,
  });
  room.players.push({ id: 'bot1', name: AI_NAMES[0], color: 1, faction: 'veil', sub: 'forge', bot: true, botIdx: 0, ai: 'easy', client: null, connected: true });
  client.room = room;
  log('info', 'tutorial_open', { room: room.code, rooms: rooms.size });
  return room;
}

/** Start (or start again) lesson `n` at `part`: a fresh match, sent to the player like any other. */
function tutStart(room, n, part = 0) {
  stopLoading(room);
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  const rosters = tutorial.begin(room.tutorial, n, part);
  room.players.forEach((p, i) => { [p.faction, p.sub] = rosters[i]; });
  startGame(room, room.tutorial.game);
  broadcast(room, tutorial.message(room.tutorial));
}

function tutStep(room) {
  const sess = room.tutorial;
  if (room.state !== 'playing' || !sess.game || sess.game !== room.game) return;
  const what = tutorial.advance(sess, { paused: room.paused, speed: room.pace.speed });
  if (what === 'part') tutStart(room, sess.n, sess.part + 1);
  else if (what === 'fail') tutStart(room, sess.n, sess.part);
  else if (what) {
    if (what === 'done') log('info', 'tutorial_lesson_done', { room: room.code, lesson: sess.n });
    broadcastState(room, true);                  // the state that satisfied the step reaches the player before the news of it
    broadcast(room, tutorial.message(sess));
  }
}

// Game speed decides how many fixed steps fit into the real time that has passed; a paused
// match takes none. State goes out on a real-time cadence, so a fast game does not cost more
// messages, only bigger steps between them.
function tickRoom(room) {
  const g = room.game;
  const now = Date.now();
  const steps = room.pace.advance((now - room.lastTick) / 1000, room.paused);
  room.lastTick = now;
  for (let i = 0; i < steps; i++) g.tick(DT);
  if (!steps) return;
  const due = now - room.lastSnap >= SNAP_MS;
  if (due) room.lastSnap = now;
  pump(room, due);
}

/** May this client pause, resume or change the speed? */
function controls(c) {
  const room = c.room;
  if (!room || room.state !== 'playing' || !room.game || !seat(c)) return null;
  if (BALANCE.control.hostOnly && room.hostId !== c.id) { send(c.ws, { t: 'no', why: 'host' }); return null; }
  return room;
}

function backToLobby(room) {
  stopLoading(room);
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  room.game = null;
  room.order = null;
  room.state = 'lobby';
  room.players = room.players.filter(p => p.bot || p.connected);
  for (const p of room.players) { p.ready = false; p.waitSince = 0; p.loaded = false; }   // a new match needs a new ready check
  pickHost(room);
  broadcastRoom(room);
}

// Idle warnings: once a second, in real time, see whether anyone has kept the others waiting
// long enough to be flagged. The room is re-sent only when a flag actually changes.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.state !== 'lobby') continue;
    refreshIdle(room, now);
    const sig = room.players.map(p => (isIdle(p) ? 1 : 0)).join('');
    if (sig !== (room.idleSig || sig.replace(/1/g, '0'))) broadcast(room, roomMsg(room));
    room.idleSig = sig;
  }
  for (const [code, at] of closedCodes) if (now - at > CLOSED_KEEP_MS) closedCodes.delete(code);
}, 1000).unref();

// Rooms whose humans all dropped are kept for a while so they can reconnect.
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (room.emptySince && now - room.emptySince > cfg.reconnectGraceMs) {
      destroyRoom(room);
      broadcastLobby();
    }
  }
}, 5000).unref();

// ---------------------------------------------------------------- protocol
// Every handler validates its own input; anything malformed is ignored.
// Text shown to players is localized in the browser, so only codes are sent.

const handlers = {
  hello(c, m) {
    if (c.name) return;
    c.name = cleanName(m.name, c.fallback);
    // Session recovery: rejoin the seat left by a dropped connection.
    if (typeof m.token === 'string' && m.token.length === 32) {
      for (const room of rooms.values()) {
        const p = room.players.find(q => !q.bot && !q.connected && q.client && q.client.token === m.token);
        if (!p) continue;
        c.token = m.token;
        c.id = p.id;
        p.client = c;
        p.connected = true;
        c.room = room;
        room.emptySince = 0;
        const idx = room.order ? room.order.indexOf(p) : -1;
        if (idx >= 0 && room.game) room.game.setAI(idx, null);
        send(c.ws, welcomeMsg(c));
        pickHost(room);
        if (room.tutorial) {                     // back in a lesson: it starts again from its scripted state
          tutStart(room, room.tutorial.n || 1, room.tutorial.part);
          log('info', 'session_resume', { room: room.code });
          return;
        }
        broadcastRoom(room);
        if (room.game) {
          // The new connection has to load the match again, whichever phase it is in. During the
          // loading phase that puts it back behind the barrier (until the timeout at the latest).
          p.autoSig = JSON.stringify(room.game.autoList(idx));
          p.loaded = false;
          send(c.ws, { ...startMsg(room, idx), loading: room.state === 'loading' });
          room.forceKey = true;
          if (room.state === 'loading') broadcastLoading(room);
        }
        log('info', 'session_resume', { room: room.code });
        return;
      }
    }
    send(c.ws, welcomeMsg(c));
    send(c.ws, lobbyMsg());
  },

  ping(c, m) {
    // Echoed for latency; inside a match the reply also carries the simulation clock.
    const g = c.room && c.room.game;
    send(c.ws, { t: 'pong', c: m.c, st: g ? +g.t.toFixed(3) : undefined });
  },

  // A display name can be changed at any time: before joining, in the lobby, during a match.
  // It never changes who the player is (id, seat, host role, readiness all stay).
  name(c, m) {
    c.name = cleanName(m.name, c.fallback);
    const room = c.room;
    if (!room) return;
    const p = room.players.find(q => q.client === c);
    if (!p) return;
    const name = uniqueName(room, c.name, p);
    if (name === p.name) return;
    p.name = name;
    broadcastRoom(room);
  },

  ready(c, m) {
    const room = c.room;
    if (!room || room.state !== 'lobby') return;
    const p = room.players.find(q => q.client === c);
    if (!p) return;
    const on = typeof m.on === 'boolean' ? m.on : !p.ready;
    if (on === p.ready) return;
    p.ready = on;
    p.waitSince = 0;
    refreshIdle(room);
    broadcastRoom(room);
  },

  // This client has loaded the match (see startGame). Separate from lobby readiness.
  loaded(c) {
    const room = c.room;
    if (!room || !room.order || (room.state !== 'loading' && room.state !== 'playing')) return;
    const p = room.order.find(q => q.client === c);
    if (!p || p.loaded) return;
    p.loaded = true;
    if (room.state === 'loading') checkLoaded(room);
    else send(c.ws, { t: 'go', time: +room.game.t.toFixed(3) });   // joined a match already under way
  },

  create(c, m) {
    if (c.room) return;
    if (rooms.size >= cfg.maxRooms) return send(c.ws, { t: 'err', code: 'server_full' });
    broadcastRoom(createRoom(c, m));
  },

  join(c, m) {
    if (c.room) return;
    // Room codes are short, so guessing is rate-limited per connection (real time).
    const now = Date.now();
    c.joins = (c.joins || []).filter(at => now - at < cfg.joinWindowMs);
    if (c.joins.length >= cfg.joinAttempts) {
      return send(c.ws, { t: 'err', code: 'slow', retry: Math.ceil((cfg.joinWindowMs - (now - c.joins[0])) / 1000) });
    }
    c.joins.push(now);
    const code = String(m.code || '').toUpperCase().trim();
    const room = /^[A-Z]{4}$/.test(code) ? rooms.get(code) : null;
    if (!room || room.tutorial) return send(c.ws, { t: 'err', code: !room && closedCodes.has(code) ? 'room_closed' : 'room_not_found' });
    if (room.state !== 'lobby') return send(c.ws, { t: 'err', code: 'match_started' });
    if (room.players.length >= MAX_PLAYERS) return send(c.ws, { t: 'err', code: 'room_full' });
    addHuman(room, c, m);
    broadcastRoom(room);
  },

  // Cosmetic: change your own faction, or (host) an AI player's.
  faction(c, m) {
    const room = c.room;
    if (!room || room.state !== 'lobby') return;
    const p = m.id != null && room.hostId === c.id
      ? room.players.find(q => q.bot && q.id === m.id)
      : room.players.find(q => q.client === c);
    if (!p || typeof m.faction !== 'string' || !Object.hasOwn(FACTIONS, m.faction) || !FACTIONS[m.faction].includes(m.sub)) return;
    if (p.faction === m.faction && p.sub === m.sub) return;
    p.faction = m.faction;
    p.sub = m.sub;
    unready(room, p.bot ? null : p);             // my own faction: my readiness; a bot's: everybody's
    broadcastRoom(room);
  },

  leave(c) {
    removeFromRoom(c, false);
    send(c.ws, { t: 'left' });
    send(c.ws, lobbyMsg());
  },

  addAI(c, m) {
    const room = hostRoom(c, 'lobby');
    if (!room || room.players.length >= MAX_PLAYERS) return;
    const level = AI_LEVELS.includes(m.level) ? m.level : 'normal';
    const used = new Set(room.players.map(p => p.name));
    const name = AI_NAMES.find(n => !used.has(n)) || `Bot ${room.botSeq + 1}`;
    const [faction, sub] = pickFaction(room);
    room.players.push({
      id: `bot${++room.botSeq}`, name, color: freeColor(room), faction, sub,
      // botIdx lets clients show the callsign in their own language.
      bot: true, botIdx: AI_NAMES.indexOf(name), ai: level, client: null, connected: true,
    });
    unready(room);
    broadcastRoom(room);
  },

  setAI(c, m) {
    const room = hostRoom(c, 'lobby');
    if (!room || !AI_LEVELS.includes(m.level)) return;
    const p = room.players.find(q => q.bot && q.id === m.id);
    if (p && p.ai !== m.level) { p.ai = m.level; unready(room); broadcastRoom(room); }
  },

  kick(c, m) {
    const room = hostRoom(c, 'lobby');
    if (!room) return;
    const p = room.players.find(q => q.id === m.id);
    if (!p || p.id === room.hostId) return;
    if (p.bot) {
      room.players.splice(room.players.indexOf(p), 1);
      unready(room);
      broadcastRoom(room);
    } else if (p.client) {
      const kicked = p.client;
      removeFromRoom(kicked, false);
      send(kicked.ws, { t: 'left', code: 'kicked' });
      send(kicked.ws, lobbyMsg());
    }
  },

  color(c) {
    const room = c.room;
    if (!room || room.state !== 'lobby') return;
    const p = room.players.find(q => q.client === c);
    if (!p) return;
    for (let i = 1; i <= MAX_PLAYERS; i++) {
      const col = (p.color + i) % MAX_PLAYERS;
      if (!room.players.some(q => q.color === col)) { p.color = col; break; }
    }
    broadcastRoom(room);
  },

  start(c) {
    const room = hostRoom(c, 'lobby');
    if (!room) return;
    if (room.players.length < 2) return send(c.ws, { t: 'err', code: 'need_opponent' });
    // Everyone present must have said so, the host too. Checked here, on the server, in the same
    // turn as the start itself, so a join or a change that arrived first has already cleared it.
    if (!allReady(room)) {
      return send(c.ws, { t: 'err', code: 'notReady', who: humans(room).filter(p => p.connected && !p.ready).map(p => p.name) });
    }
    startGame(room);
  },

  lobby(c) {
    const room = hostRoom(c);
    if (room && room.tutorial) return handlers.leave(c);   // a lesson has no lobby to go back to
    if (room && room.state !== 'lobby') backToLobby(room);
  },

  // Open the tutorial, or move within it: { lesson } starts that lesson (again), no lesson means
  // the first one not yet done, { skip } gives up on the current one, { reset } forgets all progress.
  tutorial(c, m) {
    let room = c.room;
    if (room && !room.tutorial) return;
    if (!room) {
      if (rooms.size >= cfg.maxRooms) return send(c.ws, { t: 'err', code: 'server_full' });
      room = createTutorialRoom(c, m);
    }
    const sess = room.tutorial;
    if (m.reset === true) tutorial.reset(sess);
    if (m.skip === true) {
      tutorial.skip(sess);
      // Skipping the last lesson ends the tutorial: nothing new starts, the player is shown where they stand.
      if (sess.n >= tutorial.TOTAL && !tutorial.lessonNo(m.lesson)) return send(c.ws, { ...tutorial.message(sess), end: true });
    }
    if (tutorial.validRoster(m.faction, m.sub)) sess.pref = [m.faction, m.sub];
    const n = tutorial.lessonNo(m.lesson) || (m.skip === true && sess.n < tutorial.TOTAL ? sess.n + 1 : tutorial.firstOpen(sess));
    tutStart(room, n);
  },

  // Something the player did that only their own screen can know (looked at a base, moved the
  // camera, pressed a locked button). It counts only for the lesson step that asks for it.
  tut(c, m) {
    if (!c.room || !c.room.tutorial || typeof m.did !== 'string' || m.did.length > 12) return;
  },

  // Room settings (host only, lobby only).
  opt(c, m) {
    const room = hostRoom(c, 'lobby');
    if (!room) return;
    if (typeof m.crates !== 'boolean' || room.opts.crates === m.crates) return;
    room.opts.crates = m.crates;
    unready(room);                               // the rules changed: everybody confirms again
    broadcastRoom(room);
  },

  // Orders are validated by the simulation (ownership, roads, counts). One
  // message may name many source cities; troops leave and armies appear in the
  // same step. The command id makes the order idempotent: a retried or
  // duplicated message is acknowledged but never executed twice.
  send(c, m) {
    const s = seat(c);
    if (!s) return;
    if (!Array.isArray(m.from) || m.from.length > 64 || !m.from.every(Number.isInteger)) return;
    const id = Number.isInteger(m.id) ? m.id : null;
    // The simulation decides, per source city, who marches and by which route; the client's
    // preview is never trusted. The answer goes back with the acknowledgement.
    const made = s.game.send(s.idx, m.from, m.to | 0, m.pct, id);
    pump(c.room, true, true);
    if (id !== null) send(c.ws, { t: 'ack', id, to: m.to | 0, res: made.results, paused: made.paused || undefined });
  },

  // Persistent orders: these cities keep sending to one destination until told to stop.
  // The orders live in the simulation and are executed there; the client never repeats anything.
  auto(c, m) {
    const s = seat(c);
    if (!s) return;
    if (!Array.isArray(m.from) || m.from.length > 64 || !m.from.every(Number.isInteger)) return;
    const id = Number.isInteger(m.id) ? m.id : null;
    const res = m.off ? s.game.clearAuto(s.idx, m.from, id) : s.game.setAuto(s.idx, m.from, m.to | 0, m.pct, id);
    pump(c.room, false, false);
    if (id !== null) send(c.ws, { t: 'ack', id, auto: m.off ? 'off' : 'on', to: m.to | 0, res: [...res], paused: res.paused || undefined });
  },

  // Cancel one marching army's order (it holds where it stands), or give it a new destination.
  halt(c, m) {
    const s = seat(c);
    if (!s || !Number.isInteger(m.army)) return;
    const res = s.game.halt(s.idx, m.army, Number.isInteger(m.id) ? m.id : null);
    if (res.ok) pump(c.room, true, true);
    else if (res.why !== 'duplicate') send(c.ws, { t: 'no', why: res.why });
  },

  redirect(c, m) {
    const s = seat(c);
    if (!s || !Number.isInteger(m.army)) return;
    const res = s.game.redirect(s.idx, m.army, m.to | 0, Number.isInteger(m.id) ? m.id : null);
    if (res.ok) pump(c.room, true, true);
    else if (res.why !== 'duplicate') send(c.ws, { t: 'no', why: res.why });
  },

  // Pause and speed are room-wide and belong to the simulation, not to any client.
  pause(c, m) {
    const room = controls(c);
    const on = !!m.on;
    if (!room || room.paused === on) return;
    pump(room, true, true);                              // everyone has the exact frozen state
    room.paused = room.game.paused = on;
    const p = room.players.find(q => q.client === c);
    room.pausedBy = on ? (p ? p.name : c.name) : null;
    room.lastTick = Date.now();
    broadcast(room, { t: 'ctl', ...ctlState(room) });
    log('info', on ? 'match_pause' : 'match_resume', { room: room.code });
  },

  speed(c, m) {
    const room = controls(c);
    const v = Number(m.v);
    if (!room || !BALANCE.speeds.includes(v) || room.pace.speed === v) return;
    room.pace.setSpeed(v);                               // takes effect from the next step; nothing already owed is rescaled
    broadcast(room, { t: 'ctl', ...ctlState(room), changed: 'speed' });
    log('info', 'match_speed', { room: room.code, speed: v });
  },

  up(c, m) {
    const s = seat(c);
    if (!s) return;
    s.game.upgrade(s.idx, m.node | 0);
    pump(c.room, true, true);
  },

  // Global skills. Eligibility, cooldown, charge and target are all checked
  // here, at the moment of the cast; a refusal costs the player nothing.
  skill(c, m) {
    const s = seat(c);
    if (!s || !Number.isInteger(m.slot) || m.slot < 0 || m.slot > 2) return;
    const a = m.args && typeof m.args === 'object' ? m.args : {};
    const args = { node: a.node | 0, to: a.to | 0, a: a.a | 0, b: a.b | 0, f: Number(a.f) };
    const id = Number.isInteger(m.id) ? m.id : null;
    const res = s.game.skill(s.idx, m.slot, args, id);
    if (res.ok) pump(c.room, true, true);
    else if (res.why !== 'duplicate') send(c.ws, { t: 'no', slot: m.slot, why: res.why });
  },

  // Development aid for demonstrations and screenshots. Refused in production, and anywhere
  // DEV_TOOLS=1 is not set: it hands the sender three level-3 cities and a charged superweapon.
  dev(c, m) {
    if (PROD || process.env.DEV_TOOLS !== '1') return;
    const s = seat(c);
    if (!s || m.op !== 'super') return;
    const g = s.game, p = g.players[s.idx];
    const mine = g.nodes.filter(n => n.owner === s.idx);
    for (const n of g.nodes) {
      if (mine.length >= 3) break;
      if (n.owner < 0 && mine.some(q => g.adj[q.id].has(n.id))) { n.owner = s.idx; g.ownerRev++; mine.push(n); }
    }
    for (const n of mine.slice(0, 3)) n.level = 3;
    p.charge = p.need;
    p.cd = [0, 0];
    pump(c.room, true, true);
  },

  // The client missed an update or its checksum did not match: the next update is a keyframe.
  resync(c) {
    const room = c.room;
    if (!room || !room.game) return;
    if (room.timer) room.forceKey = true;
    else send(c.ws, { t: 'k', q: room.q, time: +room.game.t.toFixed(3), ...fullState(room), h: hashGame(room.game) });   // match over: answer directly
  },
};

function welcomeMsg(c) {
  return {
    t: 'welcome', id: c.id, token: c.token, name: c.name, build,
    publicUrl: cfg.publicUrl, port: cfg.port,
    lan: PROD ? [] : lanAddresses(),             // never advertise internal addresses in production
  };
}

function hostRoom(c, state) {
  const room = c.room;
  if (!room || room.hostId !== c.id) return null;
  if (state && room.state !== state) return null;
  return room;
}

function seat(c) {
  const room = c.room;
  if (!room || room.state !== 'playing' || !room.game) return null;
  const idx = room.order.findIndex(p => p.client === c);
  return idx < 0 ? null : { game: room.game, idx };
}

// ---------------------------------------------------------------- websocket

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_MSG_BYTES,
  // Only the large one-off messages (match start) are worth compressing.
  perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true },
});

function reject(socket, code, reason, why) {
  log('warn', 'ws_reject', { why });
  socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

server.on('upgrade', (req, socket, head) => {
  if (req.url.split('?')[0] !== '/ws') return reject(socket, 404, 'Not Found', 'path');
  if (!originAllowed(req)) return reject(socket, 403, 'Forbidden', 'origin');
  if (clients.size >= cfg.maxClients) return reject(socket, 503, 'Service Unavailable', 'capacity');
  const ip = ipOf(req);
  if ((perIp.get(ip) || 0) >= cfg.maxConnPerIp) return reject(socket, 429, 'Too Many Requests', 'per_ip');
  wss.handleUpgrade(req, socket, head, ws => onConnection(ws, ip));
});

function onConnection(ws, ip) {
  const num = nextClientId++;
  const client = {
    id: `p${num}`, fallback: `Commander ${num}`, name: '', ws, room: null, ip,
    token: crypto.randomBytes(16).toString('hex'),
    tokens: RATE_BURST, refill: Date.now(), strikes: 0,
  };
  clients.add(client);
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw, isBinary) => {
    // Token-bucket rate limit; a client that keeps flooding is disconnected.
    const now = Date.now();
    client.tokens = Math.min(RATE_BURST, client.tokens + ((now - client.refill) / 1000) * RATE_PER_SEC);
    client.refill = now;
    if (client.kicked) return;
    if (client.tokens < 1) {
      if (++client.strikes > 20) {
        client.kicked = true;
        log('warn', 'rate_limit_kick');
        ws.close(1008, 'rate limit');
      }
      return;
    }
    client.tokens -= 1;

    if (isBinary) return;
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string' || !Object.hasOwn(handlers, m.t)) return;
    if (!client.name && m.t !== 'hello') return;
    try {
      handlers[m.t](client, m);
      // In a lesson, every message from its player may be what the current step was waiting for.
      const room = client.room;
      if (room && room.tutorial && room.state === 'playing' && m.t !== 'tutorial' && m.t !== 'ping') {
        tutorial.note(room.tutorial, m);
        tutStep(room);
      }
    } catch (err) { log('error', 'handler_failed', { type: m.t, message: err.message }); }
  });

  ws.on('close', () => {
    clients.delete(client);
    const n = (perIp.get(ip) || 1) - 1;
    if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
    removeFromRoom(client, true);
  });
  ws.on('error', () => {});
}

// Transport heartbeat: drop sockets that stopped answering (half-open TCP).
setInterval(() => {
  for (const c of clients) {
    if (!c.ws.isAlive) { c.ws.terminate(); continue; }
    c.ws.isAlive = false;
    try { c.ws.ping(); } catch { /* closing */ }
  }
}, HEARTBEAT_MS).unref();

// ---------------------------------------------------------------- lifecycle

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${cfg.port} is already in use. Try: PORT=${cfg.port + 1} npm start`);
    process.exit(1);
  }
  throw err;
});

function shutdown(signal) {
  log('info', 'shutdown', { signal, clients: clients.size });
  server.close();
  for (const c of clients) c.ws.close(1001, 'server restarting');
  setTimeout(() => process.exit(0), 800).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(cfg.port, cfg.host, () => {
  log('info', 'listening', { env: cfg.env, host: cfg.host, port: cfg.port, build, publicUrl: cfg.publicUrl || undefined, trustProxy: cfg.trustProxy });
  if (PROD && !cfg.allowedOrigins.length) {
    log('warn', 'no_allowed_origins', { note: 'set PUBLIC_URL or ALLOWED_ORIGINS; falling back to same-host check' });
  }
  if (!PROD) {
    console.log('Steel Tide server running.');
    console.log(`  This computer:  http://localhost:${cfg.port}`);
    for (const ip of lanAddresses()) console.log(`  Local network:  http://${ip}:${cfg.port}`);
  }
});
