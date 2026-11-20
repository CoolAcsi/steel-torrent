// The lounge and the start countdown, against a real server process:
//  - rooms waiting for players are listed for everyone who is not in a room
//  - the host names the room; the name is cleaned like a player name
//  - a private room needs its key: never listed, told to the host only, guessing is limited
//  - a match counts down in real time before the simulation starts, and takes no orders meanwhile
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { makeState, applyFull } from '../public/js/netstate.js';
import { WEATHERS } from '../public/js/weather.js';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 4500 + Math.floor(Math.random() * 400);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const COUNTDOWN = 2;            // seconds, real time
const KEY_TRIES = 3, KEY_WINDOW = 2;

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env, NODE_ENV: 'production', PORT: String(PORT), HOST: '127.0.0.1', ALLOWED_ORIGINS: ORIGIN, LOG_LEVEL: 'error',
    MAX_CONN_PER_IP: '100', JOIN_ATTEMPTS: '100', START_COUNTDOWN_SECONDS: String(COUNTDOWN),
    KEY_ATTEMPTS: String(KEY_TRIES), KEY_WINDOW_SECONDS: String(KEY_WINDOW), DEV_TOOLS: '',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', stop);

const get = pathname => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: pathname }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});
for (let i = 0; i < 50; i++) { try { if ((await get('/healthz')) === 200) break; } catch { await sleep(100); } }

class Client {
  constructor(name) { this.name = name; this.waiters = []; this.all = []; }
  open() {
    return new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Origin: ORIGIN } });
      ws.on('open', () => { this.send({ t: 'hello', name: this.name }); });
      ws.on('error', reject);
      ws.on('message', raw => {
        const m = JSON.parse(raw.toString());
        this.all.push(raw.toString());
        if (m.t === 'welcome') resolve(this);
        if (m.t === 'room') this.room = m;
        if (m.t === 'rooms') this.rooms = m;
        if (m.t === 'start') { this.start = m; this.send({ t: 'loaded' }); }
        for (const w of this.waiters.slice()) if (w.test(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); }
      });
    });
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  wait(test, ms = 5000) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ test, resolve });
      setTimeout(() => reject(new Error(`${this.name}: timed out waiting`)), ms).unref();
    });
  }
  /** Send something and return the next message of type `t`. */
  ask(msg, t = 'err', ms = 4000) { const got = this.wait(m => m.t === t, ms); this.send(msg); return got; }
  async clock() { return (await this.ask({ t: 'ping', c: 1 }, 'pong')).st; }
  close() { this.ws.close(); }
}
const open = name => new Client(name).open();
const listed = (c, code) => (c.rooms ? c.rooms.rooms.find(r => r.code === code) : null);
const listWhen = (c, test) => (test(c.rooms) ? Promise.resolve(c.rooms) : c.wait(m => m.t === 'rooms' && test(m)));

try {
  // ---- the lounge lists rooms that are waiting, by name
  const host = await open('Rhea'), guest = await open('Otto'), watcher = await open('Ivy');
  const room = await host.ask({ t: 'create', faction: 'iron', sub: 'volt' }, 'room');
  const code = room.code;
  assert.strictEqual(room.name, '', 'a new room has no title of its own');
  assert.strictEqual(room.private, false);
  await listWhen(watcher, m => m.rooms.some(r => r.code === code));
  let row = listed(watcher, code);
  assert.deepStrictEqual({ name: row.name, host: row.host, n: row.n, max: row.max, private: row.private }, { name: '', host: 'Rhea', n: 1, max: 8, private: undefined });
  assert(!host.rooms || !listed(host, code) || host.all.filter(s => s.includes('"t":"rooms"')).length <= 1, 'someone in a room is still sent the lounge');

  // The host names it. The name is cleaned like any other text players type.
  host.send({ t: 'roomName', name: '  Friday\u0007 <b>Night</b>   War  ' });
  await listWhen(watcher, m => m.rooms.some(r => r.code === code && r.name));
  assert.strictEqual(listed(watcher, code).name, 'Friday bNight/b War');
  assert.strictEqual(host.room.name, 'Friday bNight/b War');
  host.send({ t: 'roomName', name: 'x'.repeat(200) });
  await host.wait(m => m.t === 'room' && m.name.startsWith('xxx'));
  assert.strictEqual(host.room.name.length, 24, 'room names are capped');
  host.send({ t: 'roomName', name: 'Friday Night War' });
  await host.wait(m => m.t === 'room' && m.name === 'Friday Night War');

  // Only the host renames; a guest's attempt changes nothing.
  await guest.ask({ t: 'join', code, faction: 'veil', sub: 'forge' }, 'room');
  guest.send({ t: 'roomName', name: 'Mine now' });
  guest.send({ t: 'roomKey', key: 'letmein' });
  await sleep(250);
  assert.strictEqual(host.room.name, 'Friday Night War');
  assert.strictEqual(host.room.private, false, 'a guest made the room private');
  // An emptied name goes back to "<host>'s room" (the client words that).
  host.send({ t: 'roomName', name: '   ' });
  await host.wait(m => m.t === 'room' && m.name === '');
  host.send({ t: 'roomName', name: 'Friday Night War' });
  await host.wait(m => m.t === 'room' && m.name === 'Friday Night War');
  console.log('lounge list and room names ok');

  // ---- private rooms
  const KEY = 'tiger42';
  host.send({ t: 'roomKey', key: ` ${KEY} ` });
  await host.wait(m => m.t === 'room' && m.private);
  await guest.wait(m => m.t === 'room' && m.private).catch(() => {});
  assert.strictEqual(host.room.key, KEY, 'the host is not told the key');
  assert.strictEqual(guest.room.private, true);
  assert(!('key' in guest.room), 'a guest was sent the key');
  await listWhen(watcher, m => m.rooms.some(r => r.code === code && r.private));
  assert(watcher.all.every(s => !s.includes(KEY)) && guest.all.every(s => !s.includes(KEY)), 'the key left the server to someone other than the host');
  assert.strictEqual(guest.room.players.length, 2, 'whoever was in before the key was set stays in');

  // No key: asked for one. Wrong key: refused. Right key: in.
  const a = await open('Ana');
  let e = await a.ask({ t: 'join', code });
  assert.deepStrictEqual([e.code, e.room, e.name], ['key_required', code, 'Friday Night War']);
  e = await a.ask({ t: 'join', code, key: 'nope' });
  assert.strictEqual(e.code, 'key_wrong');
  e = await a.ask({ t: 'join', code, key: { $ne: null } });
  assert.strictEqual(e.code, 'key_wrong', 'a key that is not text was accepted');
  const joined = await a.ask({ t: 'join', code, key: KEY, faction: 'meridian', sub: 'aegis' }, 'room');
  assert.strictEqual(joined.players.length, 3);
  assert(!('key' in joined));
  a.send({ t: 'leave' });
  await a.wait(m => m.t === 'left');

  // Guessing is limited for the room as a whole: new connections do not buy more tries.
  let slow = null;
  for (let i = 0; i < KEY_TRIES + 2 && !slow; i++) {
    const g = await open(`guess${i}`);
    const r = await g.ask({ t: 'join', code, key: `wrong${i}` });
    if (r.code === 'slow') slow = r; else assert.strictEqual(r.code, 'key_wrong');
    g.close();
  }
  assert(slow && slow.retry >= 1, 'wrong keys were never throttled');
  const b = await open('Ben');
  assert.strictEqual((await b.ask({ t: 'join', code, key: KEY })).code, 'slow', 'the right key got in while guesses were being held off');
  await sleep(KEY_WINDOW * 1000 + 300);
  assert.strictEqual((await b.ask({ t: 'join', code, key: KEY }, 'room')).players.length, 3, 'the right key no longer works after the hold');
  b.send({ t: 'leave' });
  await b.wait(m => m.t === 'left');

  // Public again: no key needed, and the lock is gone from the list.
  host.send({ t: 'roomKey', key: '' });
  await host.wait(m => m.t === 'room' && !m.private);
  assert(!('key' in host.room));
  await listWhen(watcher, m => m.rooms.some(r => r.code === code && !r.private));
  assert.strictEqual((await b.ask({ t: 'join', code }, 'room')).players.length, 3);
  b.send({ t: 'leave' });
  await b.wait(m => m.t === 'left');
  // A room can be made private as it is created.
  const p2 = await open('Pia');
  const made = await p2.ask({ t: 'create', roomName: 'Closed door', key: 'k9' }, 'room');
  assert.deepStrictEqual([made.name, made.private, made.key], ['Closed door', true, 'k9']);
  p2.close();
  console.log('private rooms ok (key to the host only, wrong keys limited per room)');

  // ---- the sky: a room option that is looks only. The host picks; the lounge shows a fixed choice.
  assert.strictEqual(host.room.opts.weather, 'random', 'a new room starts on random weather');
  for (const w of WEATHERS) {
    host.send({ t: 'opt', weather: w });
    await host.wait(m => m.t === 'room' && m.opts.weather === w);
  }
  await listWhen(watcher, m => m.rooms.some(r => r.code === code && r.weather === WEATHERS[WEATHERS.length - 1]));
  host.send({ t: 'opt', weather: 'meteor shower' });
  guest.send({ t: 'opt', weather: WEATHERS[0] });
  await sleep(250);
  assert.strictEqual(host.room.opts.weather, WEATHERS[WEATHERS.length - 1], 'an unknown weather, or a guest, changed the sky');
  host.send({ t: 'opt', weather: 'snow' });
  await host.wait(m => m.t === 'room' && m.opts.weather === 'snow');
  console.log(`weather option ok (${WEATHERS.join(', ')}, random)`);

  // ---- the start countdown
  guest.send({ t: 'leave' });
  await guest.wait(m => m.t === 'left');
  host.send({ t: 'addAI', level: 'easy' });
  await host.wait(m => m.t === 'room' && m.players.length === 2);
  host.send({ t: 'ready', on: true });
  await host.wait(m => m.t === 'room' && m.players.every(p => p.ready));
  const t0 = Date.now();
  const go = await host.ask({ t: 'start' }, 'go', 8000);
  assert(go.countdown > (COUNTDOWN - 1) * 1000 && go.countdown <= COUNTDOWN * 1000, `countdown of ${go.countdown} ms`);
  assert.strictEqual(host.start.weather, 'snow', 'the match does not start under the sky the host chose');
  await listWhen(watcher, m => !m.rooms.some(r => r.code === code));        // a room in a match is not waiting for players
  // Nothing moves and no order is taken while it runs.
  const st = makeState(host.start.map.nodes.length);
  applyFull(st, host.start.c, host.start.a, host.start.time);
  const mine = [...st.owner].indexOf(host.start.you);
  assert(mine >= 0, 'no base of my own in the start message');
  const road = host.start.map.edges.find(([x, y]) => x === mine || y === mine);
  const to = road[0] === mine ? road[1] : road[0];
  host.send({ t: 'send', from: [mine], to, pct: 0.5, id: 1 });
  await sleep(500);
  assert.strictEqual(await host.clock(), 0, 'the simulation ran during the countdown');
  assert(!host.all.some(s => s.includes('"t":"ack"')), 'an order was taken during the countdown');
  // Then it starts from zero, with nothing owed.
  await sleep(Math.max(0, COUNTDOWN * 1000 - (Date.now() - t0)) + 400);
  const clock = await host.clock();
  assert(clock > 0 && clock < 1.5, `simulation time ${clock} s shortly after the countdown`);
  const ack = host.wait(m => m.t === 'ack', 3000);
  host.send({ t: 'send', from: [mine], to, pct: 0.5, id: 2 });
  assert.strictEqual((await ack).id, 2);
  console.log(`start countdown ok (${COUNTDOWN} s of real time, no simulation time, no orders)`);

  console.log('lounge tests passed');
} finally {
  stop();
}
process.exit(0);
