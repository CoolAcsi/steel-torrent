// The tutorial, end to end at the protocol level: a scripted client plays all eleven lessons
// against a real server process with the same messages the game client sends, and checks that
// every step advances when, and only when, the taught action has really been performed.
import assert from 'node:assert';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeState, applyFull, applyUpdate } from '../public/js/netstate.js';
import en from '../public/js/locales/en.js';
import zh from '../public/js/locales/zh-CN.js';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const T = require('../game/tutorial');
const { BALANCE: B } = require('../game/config');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 4500 + Math.floor(Math.random() * 400);
const ORIGIN = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- lesson scripts, without a server

{
  const lookup = (dict, key) => key.split('.').reduce((v, k) => (v == null ? v : v[k]), dict);
  const keys = T.allKeys();
  for (const k of keys) for (const [name, dict] of [['en', en], ['zh-CN', zh]]) assert(typeof lookup(dict, k) === 'string' && lookup(dict, k).trim(), `${name} has no text for ${k}`);
  assert.strictEqual(T.TOTAL, 11);
  assert.strictEqual(Object.keys(en.tutorial).length, Object.keys(zh.tutorial).length);

  // Every lesson starts in its scripted state and nothing advances by itself.
  for (let n = 1; n <= T.TOTAL; n++) {
    const s = T.session({ caps: { camera: true } });
    T.LESSONS[n].parts.forEach((P, part) => {
      T.begin(s, n, part);
      const first = T.message(s);
      assert(first.key.startsWith(`tutorial.l${n}.`) && first.n === n && first.of === 11 && !first.done);
      for (let i = 0; i < 20 * 30; i++) {
        s.game.tick(0.05);
        T.observe(s, s.game.drain().events);
        assert.strictEqual(T.advance(s, { paused: false, speed: 1 }), null, `lesson ${n} part ${part + 1} advanced with nothing done`);
      }
      assert.strictEqual(s.game.winner, null, 'a lesson never ends as a match');
    });
  }
  // Losing every base restarts the lesson rather than ending anything.
  const s = T.session();
  T.begin(s, 3);
  s.game.nodes[0].owner = 1;
  assert.strictEqual(T.advance(s, { paused: false, speed: 1 }), 'fail');
  assert.strictEqual(T.message(s).failed, true);
  // Saved progress decides where an unnamed start goes; skipped lessons come after untouched ones.
  assert.strictEqual(T.firstOpen(T.session({ prog: { done: [1, 2], skipped: [3] } })), 4);
  assert.strictEqual(T.firstOpen(T.session({ prog: { done: [1, 2, 4, 5, 6, 7, 8, 9, 10, 11], skipped: [3] } })), 3);
  assert.strictEqual(T.firstOpen(T.session({ prog: { done: ['x', 99, -1, 1.5], skipped: 'no' } })), 1, 'untrusted progress is ignored');
  console.log(`lesson scripts ok (${keys.length} text keys in both languages; nothing advances unprompted in 30 simulated seconds)`);
}

// ---------------------------------------------------------------- server

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), HOST: '127.0.0.1', ALLOWED_ORIGINS: ORIGIN, MAX_CONN_PER_IP: '200', RECONNECT_GRACE_MS: '1500', LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', stop);

function health() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/healthz' }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}
for (let i = 0; i < 50; i++) { try { await health(); break; } catch { await sleep(100); } }

class Client {
  constructor(name) { this.name = name; this.waiters = []; this.token = null; this.cmd = 0; this.starts = 0; this.acks = new Map(); this.lessons = []; }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Origin: ORIGIN } });
      this.ws = ws;
      ws.on('open', () => { this.send({ t: 'hello', name: this.name, token: this.token }); resolve(); });
      ws.on('error', reject);
      ws.on('message', raw => this.onMessage(JSON.parse(raw.toString())));
    });
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  onMessage(m) {
    if (m.t === 'welcome') this.token = m.token;
    else if (m.t === 'room') this.room = m;
    else if (m.t === 'rooms') this.rooms = m.rooms;
    else if (m.t === 'err') this.err = m;
    else if (m.t === 'left') { this.room = null; this.left = m; }
    else if (m.t === 'start') {
      this.st = makeState(m.map.nodes.length);
      applyFull(this.st, m.c, m.a, m.time);
      this.st.seq = m.q;
      this.startMsg = m;
      this.starts++;
      this.send({ t: 'loaded' });
    } else if (m.t === 'd' || m.t === 'k') { if (applyUpdate(this.st, m) !== 'ok') this.send({ t: 'resync' }); }
    else if (m.t === 'ctl') this.ctl = m;
    else if (m.t === 'ack') this.acks.set(m.id, m);
    else if (m.t === 'no') this.refused = m.why;
    else if (m.t === 'go') this.goes = (this.goes || 0) + 1;
    else if (m.t === 'lesson') { this.lesson = m; this.lessons.push(m.key); }
    for (const w of this.waiters.slice()) if (w.test(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); }
  }
  wait(test, ms = 20000, what = 'a message') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: timed out waiting for ${what} (at ${this.lesson && this.lesson.key})`)), ms);
      this.waiters.push({ test, resolve: m => { clearTimeout(timer); resolve(m); } });
    });
  }
  async hello() { await this.open(); await this.wait(m => m.t === 'welcome'); }
  /** Enter the tutorial (or move within it) and wait until the lesson is running. */
  async tutorial(o = {}) {
    const n = this.starts;
    this.send({ t: 'tutorial', ...o });
    await this.wait(m => m.t === 'go' && this.starts > n, 8000, 'the lesson to start');
    if (o.fast !== false) this.send({ t: 'speed', v: 2 });
    return this.lesson;
  }
  /** After a new part has been announced: wait until its match is actually running. */
  async running() {
    await this.until(() => (this.goes || 0) >= this.starts, 8000, 'the next part to start');
    this.send({ t: 'speed', v: 2 });
  }
  /** Wait until the lesson shows the step `key` (or, with 'done', is complete). */
  async at(key, ms = 40000) {
    const want = m => m && (key === 'done' ? m.done === true : m.key.endsWith(`.${key}`));
    if (!want(this.lesson)) await this.wait(m => m.t === 'lesson' && want(m), ms, `step ${key}`);
    return this.lesson;
  }
  /** Nothing the player has done so far may have advanced the lesson. */
  async stays(key, ms = 350) {
    await sleep(ms);
    assert(this.lesson.key.endsWith(`.${key}`) && !this.lesson.done, `${this.name}: advanced to ${this.lesson.key}, expected to stay at ${key}`);
  }
  async order(from, to, pct = 0.5) {
    const id = ++this.cmd;
    this.send({ t: 'send', from, to, pct, id });
    return (await this.wait(m => m.t === 'ack' && m.id === id, 5000, 'an acknowledgement')).res;
  }
  did(did, node) { this.send({ t: 'tut', did, node }); }
  skill(slot, args) { this.send({ t: 'skill', slot, args, id: ++this.cmd }); }
  myArmy() { return [...this.st.armies.values()].find(a => a.o === 0 && a.st === 0); }
  async until(test, ms = 30000, what = 'a state') {
    for (const end = Date.now() + ms; Date.now() < end;) { if (test()) return; await sleep(50); }
    throw new Error(`${this.name}: timed out waiting for ${what} (at ${this.lesson && this.lesson.key})`);
  }
}

const play = {
  // 1: camera and inspection. The client reports what only it can see; order and target are checked.
  async 1(c) {
    await c.at('zoom');
    c.did('inspect', 0); c.did('pan');
    await c.stays('zoom');
    c.did('zoom');
    await c.at('pan');
    c.did('zoom');
    await c.stays('pan');
    c.did('pan');
    await c.at('own');
    c.did('inspect', 1); c.did('inspect', 99); c.did('inspect', 'A'); c.did('locked');
    await c.stays('own');
    c.did('inspect', 0);
    await c.at('neutral');
    c.did('inspect', 1);
    await c.at('enemy');
    c.did('inspect', 2);
  },
  // 2: production threshold, capacity, a full base still sends troops out.
  async 2(c) {
    const th = B.levels[1].threshold, cap = th * B.capacity.mult;
    await c.at('threshold');
    await c.until(() => c.st.units[0] >= th, 20000, 'A to reach its threshold');
    await c.stays('threshold');                              // reaching it is not enough: the player has to look
    assert.strictEqual(c.st.units[0], th, 'production stops at the threshold');
    c.did('inspect', 0);
    await c.at('reinforce');
    await c.order([2], 0, 0.5);
    await c.at('full');
    assert(c.st.units[0] > th, 'reinforced past the threshold');
    const res = await c.order([2], 1, 1);
    assert.deepStrictEqual(res, [[2, cap - 55, 1]], 'only the five that fit are sent');
    await c.at('out');
    assert.strictEqual(c.st.units[1], cap);
    await c.order([2], 3, 0.5);                              // from C, not from the full base
    await c.stays('out');
    assert((await c.order([1], 3, 0.5))[0][1] > 0, 'a full base dispatches outward');
  },
  // 3: one base, one order; then the share.
  async 3(c) {
    await c.at('send');
    assert.deepStrictEqual(await c.order([0], 2, 0.5), [[0, -3]], 'no route past a neutral base');
    await c.stays('send');
    await c.order([0], 1, 0.5);
    await c.at('capture');
    await c.at('all');
    assert.strictEqual(c.st.owner[1], 0);
    await c.order([0], 1, 0.5);
    await c.stays('all');
    await c.order([0], 1, 1);
  },
  // 4: several bases in one order, one of them not next to the target.
  async 4(c) {
    await c.at('order');
    await c.order([0], 3, 0.25);                             // one base alone is not a multi-base order
    await c.stays('order');
    const res = await c.order([0, 1, 2], 3, 0.5);
    assert.deepStrictEqual(res.map(r => r[2]), [2, 2, 1], 'each base takes its own route');
    await c.at('capture');
    for (let i = 0; i < 6 && !c.lesson.done; i++) { await sleep(4000); if (!c.lesson.done && c.st.owner[3] !== 0) await c.order([0, 1, 2], 3, 1); }
  },
  // 5: meet a column on the road, win, march on.
  async 5(c) {
    await c.at('march');
    await c.stays('march', 1200);
    await c.order([0], 1, 0.5);
    await c.at('win');
    await c.at('siege');
    for (let i = 0; i < 8 && !c.lesson.done; i++) { await sleep(3000); if (!c.lesson.done) await c.order([0], 1, 1); }
  },
  // 6: upgrade twice, see the better troops, send a mixed column.
  async 6(c) {
    await c.at('up2');
    c.send({ t: 'up', node: 1 });
    await c.stays('up2');
    c.send({ t: 'up', node: 0 });
    await c.at('tier2');
    await c.stays('tier2', 1500);                            // the new troops exist by now; the player has not looked
    c.did('inspect', 0);
    await c.at('up3');
    c.send({ t: 'up', node: 0 });
    await c.at('mixed');
    assert.strictEqual(c.st.level[0], 3);
    await c.order([0], 1, 0.5);
  },
  // 7: a persistent route, cancelling it, halting a marching column, sending it on.
  async 7(c) {
    await c.at('on');
    await c.order([0], 1, 0.25);                             // an ordinary order is not a persistent one
    await c.stays('on');
    c.send({ t: 'auto', from: [0], to: 1, pct: 0.5, id: ++c.cmd });
    await c.at('off');
    c.send({ t: 'auto', from: [1], off: true, id: ++c.cmd });   // not the base that has the route
    await c.stays('off');
    c.send({ t: 'auto', from: [0], off: true, id: ++c.cmd });
    await c.at('halt');
    await c.order([0], 1, 0.5);
    await c.until(() => c.myArmy(), 5000, 'a marching column');
    c.send({ t: 'halt', army: 987654, id: ++c.cmd });
    await c.stays('halt');
    const a = c.myArmy();
    c.send({ t: 'halt', army: a.id, id: ++c.cmd });
    await c.at('redirect');
    await c.until(() => c.st.armies.get(a.id) && (c.st.armies.get(a.id).fl & 128), 3000, 'the column to hold');
    c.send({ t: 'redirect', army: a.id, to: 0, id: ++c.cmd });
  },
  // 8: pause, resume, all five speeds.
  async 8(c) {
    await c.at('pause');
    c.send({ t: 'speed', v: 1.5 });
    await c.stays('pause');
    c.send({ t: 'pause', on: true });
    await c.at('resume');
    assert.strictEqual(c.ctl.paused, true);
    c.send({ t: 'pause', on: false });
    await c.at('fast');
    c.send({ t: 'speed', v: 1 }); c.send({ t: 'speed', v: 2 });
    await c.at('slow');
    c.send({ t: 'speed', v: 0.5 });
    await c.at('all');
    c.send({ t: 'speed', v: 1 });
    await c.stays('all');                                    // 0.75x has not been tried yet
    c.send({ t: 'speed', v: 0.75 });
    await c.stays('all');
    c.send({ t: 'speed', v: 1 });
  },
  // 9: one shield, towers, obstacles, across three rosters.
  async 9(c) {
    await c.at('p1_shield');
    assert.deepStrictEqual([c.lesson.faction, c.lesson.part, c.lesson.parts], ['meridian', 1, 3]);
    c.skill(0, { node: 2 });                                 // the enemy base: refused
    await c.stays('p1_shield');
    c.skill(0, { node: 0 });
    await c.at('p1_absorb');
    await c.at('p1_tower');
    c.skill(1, { node: 1 });
    await c.at('p2_turret');
    assert.strictEqual(c.startMsg.players[0].faction, 'iron', 'the second part is played as Iron');
    await c.running();
    c.skill(1, { a: 1, b: 2, f: 0.5 });                      // a road that touches none of my bases
    await c.stays('p2_turret');
    c.skill(0, { node: 0 });
    await c.at('p2_block');
    c.skill(1, { a: 1, b: 2, f: 0.5 });
    await c.stays('p2_block');
    c.skill(1, { a: 0, b: 1, f: 0.5 });
    await c.at('p2_held');
    await c.at('p3_psi');
    assert.strictEqual(c.startMsg.players[0].faction, 'veil');
    await c.running();
    c.skill(0, { node: 0 });
    await c.at('p3_mire');
    c.skill(1, { a: 0, b: 1, f: 0.5 });
  },
  // 11: watch the strike, capture the ruin, rebuild it.
  async 11(c) {
    await c.at('strike');
    c.did('inspect', 1);
    await c.stays('strike', 600);                            // looked, but the strike has not landed yet
    await c.at('capture');
    assert.strictEqual(c.st.flags[1] & 1, 1, 'R is a ruin');
    assert.strictEqual(c.st.owner[1], -1);
    await c.order([0], 1, 0.5);
    await c.at('rebuild');
    c.send({ t: 'up', node: 0 });                            // upgrading another base is not rebuilding
    await c.stays('rebuild');
    c.send({ t: 'up', node: 1 });
    await c.at('rebuilt');
    assert.strictEqual(c.st.flags[1] & 1, 1, 'still a ruin while the work goes on');
  },
};

/** Lesson 10, once per faction; `viaServer` presses the locked button by sending the cast the server refuses. */
async function superweapon(c, faction, viaServer) {
  await c.at('locked');
  c.did('inspect', 0);
  c.send({ t: 'up', node: 2 });                              // C cannot afford it yet
  await c.stays('locked', 1500);
  assert.strictEqual(c.st.level[2], 2);
  if (viaServer) { c.skill(2, { node: 4, to: 3 }); await c.wait(m => m.t === 'no' && m.why === 'needL3', 3000, 'the refusal'); } else c.did('locked');
  await c.at('third');
  await c.order([0], 2, 1);
  await c.until(() => c.st.units[2] >= B.levels[2].upCost, 15000, 'C to afford its upgrade');
  c.send({ t: 'up', node: 2 });
  await c.at(`cast_${faction}`);
  const args = faction === 'meridian' ? { node: 0, to: 3 } : { node: 4 };
  c.skill(2, args);                                          // still charging: refused, costs nothing
  await c.stays(`cast_${faction}`);
  for (let i = 0; i < 20 && c.lesson.key.endsWith(`cast_${faction}`); i++) { await sleep(700); c.skill(2, args); }
  await c.at(`result_${faction}`);
  if (faction === 'meridian') { await c.stays('result_meridian'); await c.order([1], 2, 1); await c.stays('result_meridian', 600); await c.order([0], 3, 1); }
}

async function run(n, o = {}) {
  const c = new Client(`L${n}${o.faction || ''}`);
  await c.hello();
  const first = await c.tutorial({ lesson: n, caps: { camera: true }, ...o });
  assert(first.n === n && first.of === 11 && first.step === 1, `lesson ${n} did not start at its first step`);
  if (n === 10) await superweapon(c, o.faction, o.viaServer); else await play[n](c);
  const done = await c.at('done', 60000);
  assert.strictEqual(done.key, `tutorial.l${n}.done`);
  assert(done.prog.done.includes(n) && !done.prog.skipped.includes(n));
  assert.strictEqual(done.step, done.total);
  c.ws.close();
  return { n, steps: done.total, seen: new Set(c.lessons).size };
}

// All eleven lessons (lesson 10 once per faction), each in its own room, at the same time.
const t0 = Date.now();
const results = await Promise.all([
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 11].map(n => run(n)),
  run(10, { faction: 'iron', sub: 'volt' }), run(10, { faction: 'meridian', sub: 'shade', viaServer: true }), run(10, { faction: 'veil', sub: 'forge' }),
]);
for (const r of results) assert(r.seen >= r.steps + 1, `lesson ${r.n}: saw ${r.seen} distinct steps, expected ${r.steps} and the completion`);
console.log(`all 11 lessons completed step by step (${results.map(r => `${r.n}:${r.steps}`).join(' ')} steps; ${((Date.now() - t0) / 1000).toFixed(0)} s)`);

// ---------------------------------------------------------------- moving within the tutorial

{
  const c = new Client('mover');
  await c.hello();
  // No lesson named: the first one this browser has not finished. No camera: lesson 1 has no camera steps.
  let l = await c.tutorial({ prog: { done: [2, 3], skipped: [] } });
  assert.deepStrictEqual([l.n, l.key, l.total], [1, 'tutorial.l1.own', 3]);
  l = await c.tutorial({ lesson: 3 });
  assert.strictEqual(l.key, 'tutorial.l3.send');

  // Retry: the scenario is put back exactly as scripted.
  await c.order([0], 1, 1);
  await c.at('capture');
  assert.strictEqual(c.st.units[0], 0);
  l = await c.tutorial({ lesson: 3 });
  assert.strictEqual(l.key, 'tutorial.l3.send', 'retry starts the lesson again');
  assert.deepStrictEqual([c.st.units[0], c.st.owner[1], c.st.armies.size], [20, -1, 0]);

  // Skip: recorded as skipped, never as completed, and the next lesson starts.
  await c.tutorial({ lesson: 4 });
  l = await c.tutorial({ skip: true });
  assert.strictEqual(l.n, 5);
  assert(l.prog.skipped.includes(4) && !l.prog.done.includes(4), 'a skipped lesson is not a completed one');
  assert(l.prog.done.includes(2) && l.prog.done.includes(3));
  // A lesson already completed cannot be turned into a skipped one.
  await c.tutorial({ lesson: 3 });
  l = await c.tutorial({ skip: true });
  assert(l.n === 4 && !l.prog.skipped.includes(3) && l.prog.done.includes(3));
  // Skipping the last lesson ends the tutorial instead of starting anything.
  await c.tutorial({ lesson: 11 });
  const starts = c.starts;
  c.send({ t: 'tutorial', skip: true });
  const end = await c.wait(m => m.t === 'lesson' && m.end === true);
  assert(end.prog.skipped.includes(11) && c.starts === starts);
  // Restart: all progress is forgotten.
  l = await c.tutorial({ lesson: 1, reset: true });
  assert.deepStrictEqual([l.n, l.prog.done, l.prog.skipped], [1, [], []]);
  // The roster for ordinary lessons is the player's own; a bad one is ignored.
  l = await c.tutorial({ lesson: 6, faction: 'meridian', sub: 'shade' });
  assert.deepStrictEqual([l.faction, l.sub, c.startMsg.players[0].faction], ['meridian', 'shade', 'meridian']);
  l = await c.tutorial({ lesson: 6, faction: 'neutral', sub: '' });
  assert.strictEqual(l.faction, 'meridian');

  // ---- a lesson room is private
  const other = new Client('visitor');
  await other.hello();
  await sleep(200);
  assert(c.room.tutorial === true && /^[A-Z]{4}$/.test(c.room.code));
  assert(!(other.rooms || []).some(r => r.code === c.room.code), 'a lesson room is never listed');
  other.send({ t: 'join', code: c.room.code });
  assert.strictEqual((await other.wait(m => m.t === 'err')).code, 'room_not_found', 'nor joinable by its code');
  other.send({ t: 'tut', did: 'pan' }); other.send({ t: 'tutorial', skip: true, lesson: 99 });   // harmless from outside or with junk
  await other.wait(m => m.t === 'lesson');
  other.send({ t: 'leave' });
  await other.wait(m => m.t === 'left');

  // ---- a dropped player comes back to the lesson, started again; then leaves, and the room is gone
  await c.tutorial({ lesson: 3 });
  await c.order([0], 1, 1);
  await c.at('capture');
  const code = c.room.code, before = (await health()).rooms;
  c.ws.terminate();
  await sleep(300);
  assert.strictEqual((await health()).rooms, before, 'kept for the reconnect window');
  await c.open();
  await c.wait(m => m.t === 'go', 8000, 'the lesson to start again');
  assert.deepStrictEqual([c.lesson.n, c.lesson.key, c.st.units[0]], [3, 'tutorial.l3.send', 20]);
  c.send({ t: 'lobby' });                                    // "back to room" has nowhere to go: it leaves
  await c.wait(m => m.t === 'left');
  assert.strictEqual((await health()).rooms, before - 1, 'leaving closes the lesson room at once');
  other.send({ t: 'join', code });
  assert.strictEqual((await other.wait(m => m.t === 'err')).code, 'room_closed');

  // ---- a player who never comes back: the room is cleaned up after the reconnect window
  await c.tutorial({ lesson: 5 });
  const abandoned = c.room.code;
  assert((await health()).rooms >= 1);
  c.ws.terminate();
  // (the rooms of the thirteen lesson runs above were dropped the same way: all of them must go)
  let left = -1;
  for (let i = 0; i < 48 && left !== 0; i++) { await sleep(250); left = (await health()).rooms; }
  assert.strictEqual(left, 0, 'abandoned lesson rooms were not cleaned up');
  other.send({ t: 'join', code: abandoned });
  assert.strictEqual((await other.wait(m => m.t === 'err')).code, 'room_closed');
  other.ws.close();
  console.log('navigation ok (first unfinished, retry, skip, skip at the end, restart, roster; private room; reconnect restarts the lesson; closed on leave and after an unanswered drop)');
}

stop();
console.log('tutorial tests passed');
process.exit(0);
