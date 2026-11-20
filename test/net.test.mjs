// End-to-end network check against a real server process, through a TCP proxy
// that injects latency, jitter, stalls (what packet loss looks like on TCP)
// and hard disconnects. Verifies that:
//   - origin rules, health check, compression and caching headers work
//   - every state update applies cleanly (sequence + checksum) under bad links
//   - a dropped player resumes the same match
//   - many rooms can run at once
// and prints measured latency and bandwidth.
import assert from 'node:assert';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeState, applyFull, applyUpdate } from '../public/js/netstate.js';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 3900 + Math.floor(Math.random() * 500);
const PROXY = PORT + 1;
const ORIGIN = `http://127.0.0.1:${PROXY}`;

// ---------------------------------------------------------------- server

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), HOST: '127.0.0.1', ALLOWED_ORIGINS: `${ORIGIN},http://127.0.0.1:${PORT}`, MAX_CONN_PER_IP: '200', RECONNECT_GRACE_MS: '20000', LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', stop);

function get(pathname, headers = {}, port = PORT) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

for (let i = 0; i < 50; i++) {
  try { if ((await get('/healthz')).status === 200) break; } catch { await sleep(100); }
}

// ---------------------------------------------------------------- lossy proxy

const link = { latency: 0, jitter: 0, stallEvery: 0, stallMs: 0 };
const pipes = new Set();
const proxy = net.createServer(a => {
  const b = net.connect(PORT, '127.0.0.1');
  const pair = { a, b };
  pipes.add(pair);
  const relay = (from, to) => {
    // One FIFO per direction: delayed chunks leave in arrival order, as on a real TCP link.
    const queue = [];
    let timer = null;
    const drain = () => {
      timer = null;
      while (queue.length && queue[0].at <= Date.now()) {
        const { chunk } = queue.shift();
        if (!to.destroyed) to.write(chunk);
      }
      if (queue.length) timer = setTimeout(drain, Math.max(0, queue[0].at - Date.now()));
    };
    from.on('data', chunk => {
      let d = link.latency + Math.random() * link.jitter;
      if (link.stallEvery && Math.random() < 1 / link.stallEvery) d += link.stallMs;   // a retransmit
      const prev = queue.length ? queue[queue.length - 1].at : 0;
      queue.push({ at: Math.max(Date.now() + d, prev), chunk });
      if (!timer) timer = setTimeout(drain, Math.max(0, queue[0].at - Date.now()));
    });
    from.on('close', () => { to.destroy(); pipes.delete(pair); });
    from.on('error', () => {});
  };
  relay(a, b);
  relay(b, a);
});
await new Promise(r => proxy.listen(PROXY, '127.0.0.1', r));

// ---------------------------------------------------------------- client

class Client {
  constructor(name, port = PROXY) {
    this.name = name;
    this.port = port;
    this.bytes = 0;
    this.msgs = 0;
    this.updates = 0;
    this.resyncs = 0;
    this.gaps = 0;
    this.bad = 0;
    this.rtts = [];
    this.waiters = [];
    this.token = null;
  }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`, { headers: { Origin: ORIGIN } });
      this.ws = ws;
      ws.on('open', () => { this.send({ t: 'hello', name: this.name, token: this.token }); resolve(); });
      ws.on('error', reject);
      ws.on('message', raw => this.onMessage(raw));
    });
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  onMessage(raw) {
    this.bytes += raw.length;
    this.msgs++;
    const m = JSON.parse(raw.toString());
    if (m.t === 'welcome') this.token = m.token;
    else if (m.t === 'room') this.room = m;
    else if (m.t === 'start') {
      this.st = makeState(m.map.nodes.length);
      applyFull(this.st, m.c, m.a, m.time);
      this.st.seq = m.q;
      this.you = m.you;
      this.adj = m.map.nodes.map(() => []);
      for (const [a, b] of m.map.edges) { this.adj[a].push(b); this.adj[b].push(a); }
      this.started = (this.started || 0) + 1;
      this.time = m.time; this.ctl = m.ctl; this.autoList = m.auto;
    } else if (m.t === 'ctl') { this.ctl = m; this.ctls = (this.ctls || 0) + 1; }
    else if (m.t === 'auto') this.autoList = m.list;
    else if (m.t === 'd' || m.t === 'k') {
      this.time = m.time;
      const r = applyUpdate(this.st, m);
      this.updates++;
      if (r !== 'ok') {
        if (r === 'gap') this.gaps++; else this.bad++;
        this.resyncs++;
        this.send({ t: 'resync' });
      }
    } else if (m.t === 'pong') { this.rtts.push(performance.now() - m.c); this.simTime = m.st; }
    else if (m.t === 'report') this.report = m.rows;
    else if (m.t === 'no') this.refused = m.why;
    else if (m.t === 'ev' && m.k === 'over') this.over = true;
    for (const w of this.waiters.slice()) if (w.test(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); }
  }
  wait(test, ms = 8000) {
    return new Promise((resolve, reject) => {
      const w = { test, resolve };
      this.waiters.push(w);
      setTimeout(() => reject(new Error(`${this.name}: timed out waiting`)), ms).unref();
    });
  }
  ping() { this.send({ t: 'ping', c: performance.now() }); }
  /** Play like a person: every so often send half of one base down one of its roads. */
  act() {
    if (!this.st) return;
    const mine = [...this.st.owner].map((o, i) => (o === this.you ? i : -1)).filter(i => i >= 0 && this.st.units[i] > 3);
    if (!mine.length) return;
    const from = mine[Math.floor(Math.random() * mine.length)];
    const to = this.adj[from][Math.floor(Math.random() * this.adj[from].length)];
    if (to !== undefined) this.send({ t: 'send', from: [from], to, pct: 0.5, id: ++this.cmd || (this.cmd = 1) });
  }
}

const median = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] || 0;
const p95 = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.95)] || 0;

async function makeMatch(names, bots = ['normal']) {
  const cs = names.map(n => new Client(n));
  await cs[0].open();
  await cs[0].wait(m => m.t === 'welcome');
  cs[0].send({ t: 'create', faction: 'iron', sub: 'volt' });
  const room = await cs[0].wait(m => m.t === 'room');
  for (const c of cs.slice(1)) {
    await c.open();
    await c.wait(m => m.t === 'welcome');
    c.send({ t: 'join', code: room.code, faction: 'veil', sub: 'forge' });
    await c.wait(m => m.t === 'room');
  }
  for (const level of bots) cs[0].send({ t: 'addAI', level });
  await sleep(100 + link.latency * 2);
  cs[0].send({ t: 'start' });
  await Promise.all(cs.map(c => c.wait(m => m.t === 'start')));
  return cs;
}

async function runLink(label, cfg, seconds) {
  Object.assign(link, { latency: 0, jitter: 0, stallEvery: 0, stallMs: 0 }, cfg);
  const cs = await makeMatch([`${label}-a`, `${label}-b`]);
  cs.forEach(c => { c.bytes = 0; c.msgs = 0; });
  const t0 = Date.now();
  const timer = setInterval(() => cs.forEach(c => { c.ping(); c.act(); }), 500);
  await sleep(seconds * 1000);
  clearInterval(timer);
  await sleep(link.latency * 2 + link.jitter + link.stallMs + 200);
  const secs = (Date.now() - t0) / 1000;
  const rtts = cs.flatMap(c => c.rtts);
  const row = {
    link: label,
    'rtt median ms': Math.round(median(rtts)),
    'rtt p95 ms': Math.round(p95(rtts)),
    'updates/s': +(cs[0].updates / secs).toFixed(1),
    'down bytes/s': Math.round(cs[0].bytes / secs),
    gaps: cs.reduce((a, c) => a + c.gaps, 0),
    'checksum errors': cs.reduce((a, c) => a + c.bad, 0),
  };
  assert.strictEqual(row['checksum errors'], 0, `${label}: state diverged`);
  assert.strictEqual(row.gaps, 0, `${label}: updates were lost in order`);
  assert(cs[0].over || cs[0].updates >= seconds * 0.8, `${label}: too few updates (${cs.map(c => `${c.updates} upd, over=${!!c.over}, room=${c.room && c.room.state}`).join(' | ')})`);   // quiet matches still tick once a second
  cs.forEach(c => c.ws.close());
  await sleep(150);
  return row;
}

try {
  // ---- HTTP surface
  const health = await get('/healthz');
  assert.strictEqual(JSON.parse(health.body).status, 'ok');
  const html = await get('/', { 'accept-encoding': 'br' });
  assert.strictEqual(html.headers['content-encoding'], 'br');
  assert.strictEqual(html.headers['cache-control'], 'no-cache');
  assert(html.headers['content-security-policy'].includes("default-src 'self'"));
  const page = (await get('/')).body.toString();
  const build = /name="build" content="(\w+)"/.exec(page)[1];
  const asset = await get(`/v/${build}/js/main.js`, { 'accept-encoding': 'gzip' });
  assert.strictEqual(asset.status, 200);
  assert.strictEqual(asset.headers['content-encoding'], 'gzip');
  assert(asset.headers['cache-control'].includes('immutable'));
  assert.strictEqual((await get('/', { 'if-none-match': html.headers.etag })).status, 304);
  assert.strictEqual((await get('/../server.js')).status, 404);
  assert.strictEqual((await get('/package.json')).status, 404);

  let raw = 0, br = 0, files = 0;
  for (const m of page.matchAll(/(?:href|src)="(v\/[^"]+)"/g)) {
    const plain = await get(`/${m[1]}`), packed = await get(`/${m[1]}`, { 'accept-encoding': 'br' });
    raw += plain.body.length; br += packed.body.length; files++;
  }
  raw += page.length; br += html.body.length; files++;
  console.log(`first load: ${files} files, ${(raw / 1024).toFixed(0)} KB raw, ${(br / 1024).toFixed(0)} KB over the wire (brotli)`);

  // ---- WebSocket admission
  const refuse = headers => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (_, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
  assert.strictEqual(await refuse({ Origin: 'https://evil.example' }), 403, 'foreign origin must be refused');
  assert.strictEqual(await refuse({}), 403, 'missing origin must be refused in production');
  assert.strictEqual(await refuse({ Origin: ORIGIN }), 'open');
  console.log('http, caching, compression and origin checks ok');

  // ---- gameplay under different links
  const rows = [];
  rows.push(await runLink('lan', {}, 6));
  rows.push(await runLink('broadband 40ms', { latency: 20, jitter: 8 }, 8));
  rows.push(await runLink('mobile 150ms jitter', { latency: 75, jitter: 60 }, 8));
  rows.push(await runLink('lossy 150ms + stalls', { latency: 75, jitter: 40, stallEvery: 25, stallMs: 400 }, 10));
  console.table(rows);

  // ---- idempotent commands: a repeated order or cast is executed once
  Object.assign(link, { latency: 40, jitter: 30, stallEvery: 0, stallMs: 0 });
  {
    const [c] = await makeMatch(['dup']);
    await sleep(600);
    const from = [...c.st.owner].findIndex(o => o === c.you), to = c.adj[from][0];
    const order = { t: 'send', from: [from, from, 9999, to], to, pct: 0.5, id: 777 };   // duplicate, bogus and self sources
    const acks = [];
    const answered = c.wait(m => m.t === 'ack' && m.id === 777 && acks.push(m) === 4, 6000);
    for (let i = 0; i < 4; i++) c.send(order);
    await answered;
    await sleep(300);
    const mine = [...c.st.armies.values()].filter(a => a.o === c.you);
    assert.strictEqual(mine.length, 1, `repeated order created ${mine.length} armies`);
    // Every copy of the message gets the same per-city answer: one city marched, the bogus one is refused,
    // the destination itself is not a source.
    const sent = mine[0].n;
    for (const a of acks) assert.deepStrictEqual(a.res, [[from, sent, 1], [9999, -1], [to, -4]], 'per-city answer');
    assert.deepStrictEqual([mine[0].to, mine[0].dest, mine[0].path], [to, to, []]);

    // A destination with no route (this player holds a single city, so nothing two roads away is reachable):
    // refused by name, nothing spent, and no other destination is substituted.
    const far = c.adj.findIndex((_, i) => i !== from && !c.adj[from].includes(i));
    const before = c.st.units[from];
    const refusal = c.wait(m => m.t === 'ack' && m.id === 779, 6000);
    c.send({ t: 'send', from: [from], to: far, pct: 1, id: 779 });
    assert.deepStrictEqual((await refusal).res, [[from, -3]], 'an unreachable destination must be refused per city');
    await sleep(300);
    assert.strictEqual([...c.st.armies.values()].filter(a => a.o === c.you).length, 1, 'a refused order created an army');
    assert(c.st.units[from] >= before, 'a refused order spent troops');
    c.send({ t: 'skill', slot: 2, id: 778, args: { x: 100, y: 100, node: from, to } });   // superweapon without three level-3 cities
    await sleep(400);
    assert(['needL3', 'charging'].includes(c.refused), `superweapon was not refused (${c.refused})`);
    console.log('idempotent orders ok (4 identical messages -> 1 army and 4 identical per-city answers; unreachable destination refused without cost; early superweapon refused)');
    c.ws.close();
  }

  // ---- room options are shown to everyone and reach the match
  {
    const a = new Client('opt-a'), b = new Client('opt-b');
    await a.open(); await a.wait(m => m.t === 'welcome');
    a.send({ t: 'create' });
    const room = await a.wait(m => m.t === 'room');
    assert.strictEqual(room.opts.crates, false, 'crates must be off by default');
    await b.open(); await b.wait(m => m.t === 'welcome');
    b.send({ t: 'join', code: room.code });
    await b.wait(m => m.t === 'room');
    b.send({ t: 'opt', crates: true });                    // not the host: ignored
    a.send({ t: 'opt', crates: true });
    await b.wait(m => m.t === 'room' && m.opts.crates === true);
    a.send({ t: 'start' });
    const st = await b.wait(m => m.t === 'start');
    assert.strictEqual(st.opts.crates, true);
    console.log('room options ok');
    a.ws.close(); b.ws.close();
  }

  // ---- forced gap: a client that skips an update must notice and recover
  Object.assign(link, { latency: 20, jitter: 5, stallEvery: 0, stallMs: 0 });
  {
    const [c] = await makeMatch(['gap']);
    await sleep(800);
    c.st.seq -= 1;                              // pretend one update never arrived
    c.st.units[0] += 7;                         // ...and that local state is wrong
    await c.wait(m => m.t === 'k', 4000);
    await sleep(500);
    const before = c.resyncs;
    await sleep(1500);
    assert(before >= 1, 'gap was not detected');
    assert.strictEqual(c.resyncs, before, 'state did not settle after the keyframe');
    console.log(`desync recovery ok (${before} resync request(s), then clean)`);
    c.ws.close();
  }

  // ---- pause and speed belong to the room: host only, same for everyone, kept across a reconnect
  Object.assign(link, { latency: 20, jitter: 10, stallEvery: 0, stallMs: 0 });
  {
    const [host, guest] = await makeMatch(['ctl-host', 'ctl-guest']);
    await sleep(600);
    assert.deepStrictEqual([host.ctl.paused, host.ctl.speed, guest.ctl.speed], [false, 1, 1], 'a match starts unpaused at 1x');
    // The simulation clock is read from the server directly (it rides on the ping reply), at both ends of the window.
    const clock = async c => { const got = c.wait(m => m.t === 'pong', 3000); c.ping(); await got; return { sim: c.simTime, real: Date.now() }; };
    const rate = async (c, ms = 2000) => { const a = await clock(c); await sleep(ms); const b = await clock(c); return (b.sim - a.sim) / ((b.real - a.real) / 1000); };

    guest.refused = null;
    guest.send({ t: 'pause', on: true });
    guest.send({ t: 'speed', v: 2 });
    await sleep(400);
    assert.strictEqual(guest.refused, 'host', 'a guest must be told only the host may do that');
    assert.deepStrictEqual([host.ctl.paused, host.ctl.speed], [false, 1], 'a guest changed the room\'s pause or speed');

    const rates = {}, kbps = {};
    for (const v of [2, 0.5, 1.5, 0.75, 1]) {
      host.send({ t: 'speed', v });
      await sleep(350);
      assert.deepStrictEqual([host.ctl.speed, guest.ctl.speed], [v, v], 'both clients must be told the new speed');
      const b0 = guest.bytes, w0 = Date.now();
      rates[v] = await rate(guest, 1600);
      kbps[v] = (guest.bytes - b0) / 1024 / ((Date.now() - w0) / 1000);
      assert(Math.abs(rates[v] - v) < 0.08 * v + 0.05, `at ${v}x the match ran at ${rates[v].toFixed(2)} simulation seconds per second`);
    }
    host.send({ t: 'speed', v: 3 });                         // not one of the five
    await sleep(300);
    assert.strictEqual(host.ctl.speed, 1);

    host.send({ t: 'pause', on: true });
    host.send({ t: 'pause', on: true });                     // repeated: still one pause
    await sleep(400);
    assert(host.ctl.paused && guest.ctl.paused && guest.ctl.by === 'ctl-host', 'everyone must see who paused');
    const frozenAt = guest.time, hash0 = JSON.stringify([...guest.st.units]);
    const from = [...host.st.owner].findIndex(o => o === host.you);
    const acked = host.wait(m => m.t === 'ack' && m.id === 4001, 4000);
    host.send({ t: 'send', from: [from], to: host.adj[from][0], pct: 1, id: 4001 });
    host.send({ t: 'speed', v: 2 });                         // choosing a speed while paused is allowed...
    const ack = await acked;
    assert(ack.paused && ack.res.length === 0, 'an order sent during a pause must be refused');
    await sleep(1500);
    assert.strictEqual(guest.time, frozenAt, '...but must not advance the simulation');
    assert.strictEqual(JSON.stringify([...guest.st.units]), hash0, 'state changed while paused');
    assert.strictEqual(guest.ctl.speed, 2);

    // A player who reconnects during the pause gets the paused state and the selected speed.
    for (const p of pipes) if (p.a.remotePort === guest.ws._socket.localPort) { p.a.destroy(); p.b.destroy(); }
    await new Promise(r => guest.ws.once('close', r));
    await guest.open();
    await guest.wait(m => m.t === 'start', 5000);
    assert.deepStrictEqual([guest.ctl.paused, guest.ctl.by, guest.ctl.speed], [true, 'ctl-host', 2], 'reconnect lost the pause or the speed');
    assert.strictEqual(guest.time, frozenAt, 'the match moved while a player reconnected into a pause');

    // The host drops while the match is paused: the host role moves on, and the new host can resume.
    for (const p of pipes) if (p.a.remotePort === host.ws._socket.localPort) { p.a.destroy(); p.b.destroy(); }
    await new Promise(r => host.ws.once('close', r));
    await guest.wait(m => m.t === 'room' && m.hostId !== host.room.hostId, 5000);
    guest.send({ t: 'pause', on: false });
    await sleep(400);
    assert.strictEqual(guest.ctl.paused, false, 'the new host could not resume: the match would be stuck');
    const after = await rate(guest, 1500);
    assert(Math.abs(after - 2) < 0.5, `after resuming the match should run at the selected 2x, ran at ${after.toFixed(2)}`);
    assert.strictEqual(guest.bad + guest.gaps, 0, 'state diverged around pause, speed changes or reconnects');
    console.log(`pause and speed ok (host only; measured ${Object.entries(rates).map(([v, r]) => `${v}x=${r.toFixed(2)}`).join(' ')}; frozen across a reconnect; resumed by the new host at 2x; traffic per player ${Object.entries(kbps).map(([v, k]) => `${v}x=${k.toFixed(1)}`).join(' ')} KB/s)`);
    guest.ws.close();
  }

  // ---- persistent orders live on the server: set once, they keep sending, and survive a reconnect
  {
    const [c] = await makeMatch(['auto']);
    await sleep(500);
    const from = [...c.st.owner].findIndex(o => o === c.you), to = c.adj[from][0];
    const acked = c.wait(m => m.t === 'ack' && m.id === 5001, 4000);
    for (let i = 0; i < 3; i++) c.send({ t: 'auto', from: [from, 9999], to, pct: 0.3, id: 5001 });
    const ack = await acked;
    assert.deepStrictEqual([ack.auto, ack.res], ['on', [[from, 1], [9999, -1]]]);
    await sleep(300);
    assert.deepStrictEqual(c.autoList.map(o => o.slice(0, 3)), [[from, to, 30]], 'the server did not report the order back');
    c.send({ t: 'speed', v: 2 });
    const sentBefore = c.msgs;
    const seen = new Set();
    const t0 = c.time;
    while (c.time - t0 < 20) { for (const a of c.st.armies.values()) if (a.o === c.you) seen.add(a.id); await sleep(50); }
    assert(seen.size >= 3, `expected repeated departures without any further message, saw ${seen.size}`);
    for (const p of pipes) if (p.a.remotePort === c.ws._socket.localPort) { p.a.destroy(); p.b.destroy(); }
    await new Promise(r => c.ws.once('close', r));
    await c.open();
    await c.wait(m => m.t === 'start', 5000);
    assert.deepStrictEqual(c.autoList.map(o => o.slice(0, 3)), c.st.owner[from] === c.you ? [[from, to, 30]] : [], 'a reconnect lost the persistent order');
    c.send({ t: 'auto', from: [from], off: true, id: 5002 });
    await c.wait(m => m.t === 'ack' && m.id === 5002, 4000);
    await sleep(300);
    assert.deepStrictEqual(c.autoList, []);
    console.log(`persistent orders ok (set once with 3 identical messages; ${seen.size} departures in 20 simulation seconds with no further commands; kept across a reconnect; stopped)`);
    c.ws.close();
  }

  // ---- hard disconnect mid-match, then session recovery
  {
    const cs = await makeMatch(['drop-a', 'drop-b']);
    await sleep(1500);
    const victim = cs[1], seat = victim.you;
    const t0 = Date.now();
    for (const p of pipes) if (p.a.remotePort === victim.ws._socket.localPort) { p.a.destroy(); p.b.destroy(); }
    await new Promise(r => victim.ws.once('close', r));
    await sleep(1200);                          // the match goes on without them
    await victim.open();
    await victim.wait(m => m.t === 'start', 5000);
    const ms = Date.now() - t0;
    assert.strictEqual(victim.you, seat, 'resumed in a different seat');
    const u0 = victim.updates;
    await sleep(1500);
    assert(victim.updates > u0, 'no updates after resuming');
    assert.strictEqual(victim.bad, 0, 'state diverged after resuming');
    console.log(`session recovery ok (back in the same seat ${ms} ms after the drop, including a 1.2 s outage)`);
    cs.forEach(c => c.ws.close());
  }

  // ---- concurrency: many rooms at once
  {
    Object.assign(link, { latency: 30, jitter: 20, stallEvery: 0, stallMs: 0 });
    const ROOMS = 12;
    const matches = await Promise.all(Array.from({ length: ROOMS }, (_, i) => makeMatch([`c${i}a`, `c${i}b`, `c${i}c`], ['hard', 'normal'])));
    const all = matches.flat();
    const timer = setInterval(() => all.forEach(c => { c.ping(); c.act(); }), 500);
    await sleep(8000);
    clearInterval(timer);
    const h = JSON.parse((await get('/healthz')).body);
    assert.strictEqual(all.reduce((a, c) => a + c.bad + c.gaps, 0), 0, 'state diverged under load');
    assert(h.matches >= ROOMS - 1, `expected ${ROOMS} matches, health reports ${h.matches}`);
    console.log(`concurrency ok: ${all.length} players in ${ROOMS} matches (${ROOMS * 5} seats), median rtt ${Math.round(median(all.flatMap(c => c.rtts)))} ms, 0 sync errors`);
    all.forEach(c => c.ws.close());
  }

  // ---- flood protection
  {
    Object.assign(link, { latency: 0, jitter: 0 });
    const c = new Client('flood', PORT);
    await c.open();
    await c.wait(m => m.t === 'welcome');
    const closed = new Promise(r => c.ws.once('close', code => r(code)));
    for (let i = 0; i < 400; i++) c.send({ t: 'ping', c: i });
    const code = await Promise.race([closed, sleep(3000).then(() => 'still open')]);
    assert.strictEqual(code, 1008, 'flooding client was not disconnected');
    const big = new Client('big', PORT);
    await big.open();
    const closed2 = new Promise(r => big.ws.once('close', c2 => r(c2)));
    big.ws.send(JSON.stringify({ t: 'name', name: 'x'.repeat(5000) }));
    assert.strictEqual(await Promise.race([closed2, sleep(3000).then(() => 'still open')]), 1009, 'oversized message was not refused');
    console.log('rate limit and payload limit ok');
  }

  console.log('network tests passed');
} finally {
  proxy.close();
  for (const p of pipes) { p.a.destroy(); p.b.destroy(); }
  stop();
}
process.exit(0);
