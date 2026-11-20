// In-match view: renders the battlefield and turns pointer input into commands.
//
// Rendering is decoupled from the network. The server sends compact state
// updates about ten times a second; armies arrive as "position + speed at
// server time T" and are extrapolated every frame on a smoothed estimate of
// server time, so movement is smooth at any latency without being simulated
// in the browser.
import {
  COLORS, NEUTRAL, DIRS, STEP,
  soldierSprite, hullSprite, turretSprite, baseSprite, baseInfo, unitSpec, compoundModel,
} from './art.js';
import { drawBaseLive, insigniaURL, BS, BASE_LIFT } from './buildings.js';
import { soldierMuzzle, buildHull, buildTurret, buildSoldier } from './units.js';
import { FACTIONS, normalize, weaponOf } from './factions.js';
import { WEAPON, drawShot, recoilAt, boom } from './weapons.js';
import { drawEffect, drawCrate, SKILL_COLOR, GLOWS } from './fx.js';
import { drawSuper, drawChronoLink, SUPER_TYPES, GROUND_TYPES } from './superfx.js';
import { SpriteCache, drawSprite, F } from './iso.js';
import { buildTerrain } from './terrain.js';
import { planScenery, lampModel } from './scenery.js';
import { makeState, applyFull, applyUpdate } from './netstate.js';
import { planRoute, planBalancedDispatch } from './route.js';
import { sfx } from './sfx.js';
import { t, fmt, getLang } from './i18n.js';

const TAU = Math.PI * 2;
const US = 0.64;                  // units are drawn at this scale, so a tank is small beside a building and fits its lane
const FOOT = 0.8;                 // infantry are drawn smaller again, so a soldier is not as tall as a tank
const ROW = [0, 5, 2, 2];         // figures per marching row, by tier
const GAP = [0, 9.5, 17, 20];     // distance between rows
const LANE = [0, 5.4, 12, 13.5];  // sideways spacing inside a row
const PREDICT_TTL = 1.5;          // seconds a predicted order may wait for the server
const REJECT_WHY = [null, 'notYours', 'noTroops', 'noRoute', null];   // server codes, see REJECT in game/sim.js (4 = the destination itself: not worth a message)
const REJECT_SHOW = 2.6;          // seconds a left-out city stays marked
const WARN_TYPE = { nuke: 'nukeWarn', dominion: 'domWarn' };          // superweapon warnings have their own look
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

/** Graphics presets: resolution cap, sprites drawn per army, effect budget, additive glow. */
export const QUALITY = {
  high:   { dpr: 2,   sprites: 18, fx: 220, glow: true },
  medium: { dpr: 1.5, sprites: 12, fx: 140, glow: true },
  low:    { dpr: 1,   sprites: 7,  fx: 70,  glow: false },
};

function hash(n) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return (n ^ (n >>> 15)) >>> 0;
}

function webglSupported() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

const dirIndex = a => ((Math.round(a / STEP) % DIRS) + DIRS) % DIRS;

export class GameView {
  /**
   * @param canvas
   * @param els   { hud, upgrade, info }
   * @param hooks { send, upgrade, skill, resync, notify, onElim, onOver, onDesync, onCast }
   */
  constructor(canvas, els, hooks) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.els = els;
    this.hooks = hooks;
    this.active = false;
    this.pct = 0.5;
    this.map = null;
    this.fx = [];
    this.raf = 0;
    this.sprites = new SpriteCache();
    this.pool = [];
    this.items = [];
    this.shots = [];
    this.glows = [];
    this.settings = { quality: 'high', effects: true, shake: true, webgl: true };
    this.q = QUALITY.high;
    this.r3d = null;              // WebGL renderer, created on demand
    this.use3d = false;
    this.autoMode = true;         // persistent auto dispatch is on by default
    this.hoverCancel = null;      // key (`src|dest`) of the auto route whose cancel "×" is hovered
    this.rallyMode = false;       // pick 1+ targets for optimal/even rally or attack scheduling
    this.rallyTargets = new Set();
    this.shiftRally = false;      // auto-confirm rally/attack targets when Shift is released
    this.activeTargets = new Set();
    this.hoverCity = -1;
    this.hoverMenu = false;
    this.hoverKeepUntil = 0;
    this.cityActTarget = -1;
    this.cityActSig = '';
    this._frame = this._frame.bind(this);

    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => { if (this.drag && this.drag.pid === e.pointerId) this.drag = null; });
    canvas.addEventListener('pointerleave', () => { this.hover = -1; this.hoverCancel = null; this.ptr = null; });
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.cancel(); });
    window.addEventListener('resize', () => this.resize());
    els.upgrade.addEventListener('click', () => { if (this.sel >= 0) this.hooks.upgrade(this.sel); });
    if (els.cityActions) {
      els.cityActions.addEventListener('mouseenter', () => { this.hoverMenu = true; });
      els.cityActions.addEventListener('mouseleave', () => { this.hoverMenu = false; this.hoverKeepUntil = performance.now() + 140; });
      const onlyBtn = els.cityActions.querySelector('#ca-only');
      const addBtn = els.cityActions.querySelector('#ca-add');
      if (onlyBtn) onlyBtn.addEventListener('click', () => {
        const i = this.cityActTarget;
        if (i >= 0) this.dispatchToTargets([i]);
      });
      if (addBtn) addBtn.addEventListener('click', () => {
        const i = this.cityActTarget;
        if (i < 0) return;
        const next = new Set(this.activeTargets);
        if (next.has(i) && next.size > 1) {
          next.delete(i);
        } else {
          if (next.size === 0 && this.autos.size > 0) {
            for (const o of this.autos.values()) next.add(o.dest);
          }
          next.add(i);
        }
        this.dispatchToTargets([...next]);
      });
    }
  }

  // ------------------------------------------------------------ lifecycle

  start(m) {
    this.cfg = m.cfg;
    this.levels = m.cfg.levels;
    this.R = m.cfg.nodeR;
    this.map = m.map;
    this.players = m.players;
    this.me = m.you;
    this.N = m.map.nodes.length;
    this.edges = m.map.edges || [];
    this.adj = Array.from({ length: this.N }, () => []);
    for (const [a, b] of this.edges) { this.adj[a].push(b); this.adj[b].push(a); }

    // Per-seat look: faction materials + team colour.
    this.sides = m.players.map(p => {
      const [f, sub] = normalize(p.faction, p.sub);
      return { f, sub, tc: COLORS[p.color], A: FACTIONS[f].subs[sub].accent2, G: FACTIONS[f].mat.glow };
    });
    this.neutral = { f: 'neutral', sub: '', tc: NEUTRAL };

    this.st = makeState(this.N);
    applyFull(this.st, m.c, m.a, m.time);
    this.st.seq = m.q;
    this.st.players = m.p || [];
    this.pAt = m.time;
    this.owner = this.st.owner;
    this.level = this.st.level;
    this.units = this.st.units;
    this.badSync = 0;
    this.resyncAt = 0;
    this.pending = new Map();
    this.rejects = new Map();       // city -> { why, t0 }: left out of the last order
    this.nextCmd = (Date.now() % 1000000) * 100;   // unique across reconnects within a match
    this.heat = new Float32Array(this.N);
    this.lastUnits = Int32Array.from(this.units);

    this.alive = m.alive.slice();
    this.winner = m.winner;
    this.frozenT = null;
    this.offs = [];
    this.rate = 1;                  // simulation seconds per real second: the room's speed, 0 while paused
    this.paused = false;
    this.pausedBy = null;
    this.speed = 1;
    this.off = m.time - performance.now() / 1000;
    this.autos = new Map();         // my persistent orders: `${src}|${dest}` -> { src, dest, pct, state }
    this.autoMode = true;           // orders default to persistent auto dispatch until toggled off
    this.autoRev = 0;
    this.ownerRev = 0;
    this.autoPaths = null;
    this.fx = [];
    this.sel = -1;
    this.picked = new Set();        // cities chosen for a multi-city order
    this.hover = -1;
    this.hoverCancel = null;
    this.hoverCity = -1;
    this.hoverMenu = false;
    this.hoverKeepUntil = 0;
    this.cityActTarget = -1;
    this.cityActSig = '';
    this.rallyMode = false;
    this.rallyTargets = new Set();
    this.shiftRally = false;
    this.activeTargets = new Set();
    this.ptr = null;
    this.drag = null;
    this.targeting = null;
    this.lastTap = { id: -1, t: 0 };
    this.hudAt = 0;
    this.lastLt = 0;
    this.infoSig = '';
    this.upLabel = '';
    this.shakeAmp = 0;
    this.screenFlash = null;
    this.convLog = [];              // recent conversions, to tie dominator tethers to real ones
    this.beforeUnits = null;
    this.resize();

    this.crates = new Map();
    for (const [id, x, y] of m.crates || []) this.crates.set(id, { wx: x, wy: y, ...this.tv(x, y) });
    const now = performance.now() / 1000;
    for (const z of m.zones || []) {
      const p = this.tv(z.x, z.y);
      // (timed by the simulation clock: they slow, speed up and pause with the match)
      if (z.skill === 'hazard') this.fx.push({ type: 'hazard', x: p.x, y: p.y, r: z.r, sim: true, t0: m.time, dur: Math.max(0.1, z.until - m.time), seed: z.x | 0 });
      else {
        // A strike already on its way when this client (re)joined: show its warning at the progress it has
        // really reached, never as a fresh one.
        const def = [...this.cfg.skills.iron, ...this.cfg.skills.veil].find(d => d.id === z.skill);
        const dur = (def && def.delay) || Math.max(0.1, z.at - m.time);
        this.fx.push({ type: WARN_TYPE[z.skill] || 'warn', skill: z.skill, x: p.x, y: p.y, r: z.r, sim: true, t0: z.at - dur, dur });
      }
    }
    if (m.ctl) this.onCtl(m.ctl);
    this.setAutos(m.auto || []);
    this.buildHud();
    this.active = true;
    if (!this.raf) this.raf = requestAnimationFrame(this._frame);
    for (let i = 0; i < this.N; i++) {
      if (this.owner[i] === this.me) this.fx.push({ type: 'ring', node: i, t0: now + 0.3, col: '#ffffff', dur: 1.4, reach: 70 });
    }
  }

  stop() {
    this.active = false;
    this.targeting = null;
    this.shiftRally = false;
    this.hoverMenu = false;
    this.hoverCity = -1;
    this.cityActTarget = -1;
    this.els.upgrade.classList.add('hidden');
    if (this.els.cityActions) this.els.cityActions.classList.add('hidden');
    this.els.info.classList.add('hidden');
  }

  applySettings(s) {
    Object.assign(this.settings, s);
    this.q = QUALITY[this.settings.quality] || QUALITY.high;
    // Terrain, cities and units go through the 3D renderer when it is available and wanted;
    // the canvas renderer stays as the fallback and as the low preset.
    const want = this.settings.webgl !== false && this.q !== QUALITY.low && !!this.els.gl && !this.r3dFailed && webglSupported();
    if (want && !this.r3d && !this.r3dLoading) {
      // The renderer and the engine behind it load on demand; the canvas renderer draws until they arrive.
      this.r3dLoading = import('./3d/renderer.js')
        .then(m => { this.r3d = new m.Renderer3D(this.els.gl, this.preset3d()); })
        .catch(err => { console.warn('3D renderer unavailable, using canvas:', err.message); this.r3dFailed = true; })
        .finally(() => { this.r3dLoading = null; this.applySettings({}); });
    }
    if (this.r3d) this.r3d.configure(this.preset3d());
    this.use3d = !!(want && this.r3d);
    if (this.els.gl) this.els.gl.classList.toggle('hidden', !this.use3d);
    if (this.map) this.resize();
  }

  /** What the 3D renderer may spend at the current preset. */
  preset3d() {
    const high = this.q === QUALITY.high, fx = this.settings.effects !== false;
    return { shadowSize: high ? 4096 : 2048, ao: high && fx, bloom: fx, reflections: true };
  }

  side(p) { return p >= 0 ? this.sides[p] : this.neutral; }
  color(p) { return this.side(p).tc; }

  /** Display name of a seat; AI callsigns are translated. */
  pname(p) {
    const pl = this.players[p];
    if (!pl) return '';
    return pl.bot >= 0 ? t(`bots.${pl.bot}`) : pl.name;
  }

  relabel() {
    if (!this.map) return;
    this.buildHud();
    this.infoSig = '';
    this.upLabel = '';
  }

  /**
   * Simulation time right now, as best this client knows. The simulation runs
   * `rate` seconds per real second (the room's game speed, 0 while paused), so
   * armies and timers are extrapolated at that rate and stand still in a pause.
   */
  serverNow() { return this.rate * (performance.now() / 1000) + this.off; }

  /** Pause and speed are the room's, decided by the server: { paused, by, speed, time }. */
  onCtl(c) {
    const rate = c.paused ? 0 : c.speed;
    const was = { paused: this.paused, speed: this.speed };
    this.paused = !!c.paused;
    this.pausedBy = c.by || null;
    this.speed = c.speed;
    if (rate !== this.rate) {                            // re-anchor the clock at the moment the server changed it
      const at = c.time != null ? c.time : this.serverNow();
      this.rate = rate;
      this.off = at - rate * (performance.now() / 1000);
      this.offs = [this.off];
    }
    if (this.paused) { this.drag = null; this.targeting = null; }
    if (this.hooks.onCtl) this.hooks.onCtl(c, was);
  }

  autoKey(src, dest) { return `${src}|${dest}`; }
  hasAutoFrom(src) { for (const o of this.autos.values()) if (o.src === src) return true; return false; }
  autosFrom(src) { const out = []; for (const o of this.autos.values()) if (o.src === src) out.push(o); return out; }

  /** My persistent orders, as the server holds them: [[source, destination, percent, state]]. */
  setAutos(list) {
    this.autos = new Map(list.map(([src, dest, pct, state]) => [this.autoKey(src, dest), { src, dest, pct: pct / 100, state }]));
    if (!list.length) this.activeTargets.clear();
    this.autoRev++;
    if (this.hooks.onAutos) this.hooks.onAutos();
  }

  // ------------------------------------------------------------ server messages

  /** Estimate server time from the least-delayed recent sample, then ease toward it. */
  syncTime(serverTime) {
    const sample = serverTime - this.rate * (performance.now() / 1000);
    this.offs.push(sample);
    if (this.offs.length > 30) this.offs.shift();
    let best = -Infinity;
    for (const o of this.offs) if (o > best) best = o;
    if (Math.abs(best - this.off) > 0.4) this.off = best;
    else this.off += (best - this.off) * 0.1;
  }

  /** Delta ('d') or keyframe ('k'). Any gap or checksum mismatch asks for a keyframe. */
  onUpdate(m) {
    if (!this.map) return;
    this.syncTime(m.time);
    if (m.p) this.pAt = m.time;
    this.beforeUnits = Int32Array.from(this.units);    // what cities held before this update: the difference is what an event did
    const r = applyUpdate(this.st, m);
    if (m.t === 'k' || (m.c && m.c.length)) this.ownerRev++;
    for (let i = 0; i < this.N; i++) {                 // garrisons losing soldiers are under fire
      if (this.units[i] < this.lastUnits[i] && !this.pendingFrom(i)) this.heat[i] = Math.min(1, this.heat[i] + 0.12);
      this.lastUnits[i] = this.units[i];
    }
    if (r === 'ok') { if (m.t === 'k') this.badSync = 0; return; }
    const now = performance.now();
    if (r === 'hash') this.badSync++;
    if (this.badSync >= 3) { this.badSync = 0; this.hooks.onDesync(); }
    else if (now - this.resyncAt > 400) { this.resyncAt = now; this.hooks.resync(); }
  }

  /**
   * The server's answer to an order: what each selected city actually did.
   * Anything left out is marked on the map and summed up in one message.
   */
  onAck(id, m) {
    this.pending.delete(id);
    if (m && m.paused) return this.hooks.notify('paused');
    if (!m || !Array.isArray(m.res)) return;
    if (m.auto) {                                        // a persistent order was set or stopped
      const ok = m.res.filter(r => r[1] > 0).length;
      return this.hooks.notify(ok ? (m.auto === 'on' ? 'auto.set' : 'auto.off') : 'auto.none', { count: ok });
    }
    let sent = 0, troops = 0;
    const out = [];
    for (const r of m.res) {
      if (r[1] > 0) { sent++; troops += r[1]; }
      else if (REJECT_WHY[-r[1]]) out.push({ from: r[0], why: REJECT_WHY[-r[1]] });
    }
    if (out.length) this.reportOrder(sent, troops, out);
  }

  /** Mark the cities that could not take part and say why, once, in the player's language. */
  reportOrder(sent, troops, out) {
    const now = performance.now() / 1000;
    for (const o of out) this.rejects.set(o.from, { why: o.why, t0: now });
    const count = why => out.filter(o => o.why === why).length;
    if (!sent) return this.hooks.notify(count('noRoute') ? 'noRoute' : count('noTroops') ? 'noTroops' : 'noRoad');
    const why = ['noRoute', 'noTroops', 'notYours'].filter(count).map(w => t(`game.out.${w}`, { count: count(w) })).join(t('game.listSep'));
    this.hooks.notify('partial', { sent, total: sent + out.length, troops, why });
  }

  pendingFrom(i) {
    for (const p of this.pending.values()) if (p.out[i]) return true;
    return false;
  }

  /** Garrison as shown to the player: server state minus soldiers already ordered out. */
  shown(i) {
    let u = this.units[i];
    if (this.pending.size) for (const p of this.pending.values()) if (p.out[i]) u -= p.out[i];
    return u < 0 ? 0 : u;
  }

  /** Skill timers for seat p, counted down locally between updates. */
  skillState(p = this.me) {
    const r = this.st.players[p];
    if (!r) return null;
    const dt = Math.max(0, (this.frozenT !== null ? this.frozenT : this.serverNow()) - this.pAt);
    const need = this.cfg.skills.superNeedsL3;
    const charging = r[4] >= need;
    return {
      cd: [Math.max(0, r[0] / 10 - dt), Math.max(0, r[1] / 10 - dt)],
      charge: Math.min(r[3] / 10, r[2] / 10 + (charging ? dt : 0)), need: r[3] / 10,
      l3: r[4], l3Need: need,
      mobilize: Math.max(0, r[5] / 10 - dt), rapid: Math.max(0, r[6] / 10 - dt), surge: Math.max(0, r[7] / 10 - dt),
    };
  }

  push(f) { if (this.fx.length < this.q.fx) this.fx.push(f); }

  onEvent(e) {
    if (!this.map) return;
    const now = performance.now() / 1000;
    const at = (x, y) => this.tv(x, y);
    switch (e.k) {
      case 'cap':
        this.fx.push({ type: 'cap', node: e.node, t0: now, col: this.color(e.by).light, dur: 0.9, seed: hash(e.node * 31 + (now * 10 | 0)) });
        this.heat[e.node] = 0;
        this.shake(e.by === this.me || e.from === this.me ? 3 : 1.2);
        if (e.by === this.me) sfx.capture(); else if (e.from === this.me) sfx.lost();
        if (this.sel === e.node && e.from === this.me) this.sel = -1;
        this.picked.delete(e.node);
        break;
      case 'up':
        this.fx.push({ type: 'up', node: e.node, t0: now, dur: 1 });
        if (this.owner[e.node] === this.me) sfx.upgrade();
        break;
      case 'elim':
        this.alive[e.p] = false;
        if (e.p === this.me) this.cancel();
        this.hooks.onElim(e.p);
        break;
      case 'over':
        this.winner = e.winner;
        this.frozenT = this.serverNow();
        this.cancel();
        this.hooks.onOver(e.winner);
        break;
      case 'route':                                      // one of my armies had to change its plan
        if (e.p === this.me) this.hooks.notify(`route.${e.why}`);
        break;
      case 'auto':                                       // one of my persistent orders ended by itself
        if (e.p === this.me) this.hooks.notify(`auto.${e.why}`);
        break;
      case 'clash': { const p = at(e.x, e.y); this.push({ type: 'clash', x: p.x, y: p.y, t0: now, dur: 0.45, seed: e.x * 7 + e.y }); break; }
      case 'shot': {
        const n = this.vn[e.node], top = this.topOf(e.node);
        this.push({ type: 'shot', x: n.x, y: n.y - top * 0.8, coil: e.coil, to: e.to.map(q => { const p = at(q[0], q[1]); return [p.x, p.y]; }), t0: now, dur: e.coil ? 0.4 : 0.7, seed: e.node });
        break;
      }
      case 'shield': { const n = this.vn[e.node]; this.push({ type: 'shield', x: n.x, y: n.y, t0: now, dur: 0.8 }); break; }
      case 'conv': {
        const p = at(e.x, e.y);
        this.convLog.push({ wx: e.x, wy: e.y, x: p.x, y: p.y, by: e.by, n: e.n, at: now });
        if (this.convLog.length > 40) this.convLog.shift();
        this.push({ type: 'conv', x: p.x, y: p.y, t0: now, dur: 0.9 });
        this.push({ type: 'text', x: p.x, y: p.y, text: `+${fmt(e.n)}`, col: this.color(e.by).light, t0: now, dur: 1.4 });
        break;
      }
      case 'cast': this.onCast(e, now); break;
      case 'strike': this.onStrike(e, now); break;
      case 'crate': this.crates.set(e.id, { wx: e.x, wy: e.y, ...at(e.x, e.y) }); break;
      case 'crateGone': this.crates.delete(e.id); break;
      case 'pick': {
        const p = this.crates.get(e.id) || at(e.x, e.y);
        this.crates.delete(e.id);
        this.push({ type: 'pick', x: p.x, y: p.y, col: this.color(e.by).light, t0: now, dur: 0.7, seed: e.id });
        this.push({ type: 'text', x: p.x, y: p.y, text: t(`crates.${e.reward}.name`), col: '#ffd34a', t0: now, dur: 1.8, size: 12 });
        this.hooks.onCrate(e);
        break;
      }
    }
  }

  onCast(e, now) {
    const col = SKILL_COLOR[e.skill];
    if (e.delay) {                                     // a visible warning until the strike lands
      const p = this.tv(e.x, e.y);
      this.fx.push({ type: WARN_TYPE[e.skill] || 'warn', skill: e.skill, x: p.x, y: p.y, r: e.r, sim: true, t0: this.serverNow(), dur: e.delay });
    } else if (e.skill === 'shock') {
      const p = this.tv(e.x, e.y);
      this.push({ type: 'pulse', x: p.x, y: p.y, r: e.r, col, t0: now, dur: 0.9 });
    } else if (e.skill === 'leech') {
      // the conversion itself is announced by its own event
    } else if (e.skill === 'reinforce') {
      const n = this.vn[e.node];
      this.push({ type: 'phase', x: n.x, y: n.y, arrive: true, t0: now, dur: 0.8, seed: e.node });
      this.push({ type: 'text', x: n.x, y: n.y, text: `+${fmt(e.n)}`, col, t0: now, dur: 1.4 });
    } else if (e.skill === 'phase') {
      // Chrono dispatch. The transfer already happened, in one step: both ends play at once,
      // the source closing as the destination opens, and nothing travels between them.
      const a = this.vn[e.node], b = this.vn[e.to], st = this.serverNow();
      this.fx.push({ type: 'chrono', x: a.x, y: a.y, arrive: false, n: e.n, sim: true, t0: st, dur: 1.3, seed: e.node * 31 + 7 });
      this.fx.push({ type: 'chrono', x: b.x, y: b.y, arrive: true, n: e.n, sim: true, t0: st, dur: 1.3, seed: e.to * 31 + 11 });
      this.push({ type: 'text', x: b.x, y: b.y, text: `+${fmt(e.n)}`, col, t0: now + 0.5, dur: 1.4 });
      this.flashScreen('190,235,255', 0.16, 0.35);
      this.light3d(a, '#bfeaff', 1.2, 0.9); this.light3d(b, '#bfeaff', 1.6, 0.9);
      this.shake(2);
    } else {
      // army-wide buffs: a pulse from each of the caster's cities
      for (let i = 0; i < this.N; i++) {
        if (this.owner[i] === e.p) this.push({ type: 'pulse', x: this.vn[i].x, y: this.vn[i].y, r: 60, col, t0: now, dur: 0.8 });
      }
    }
    this.hooks.onCast(e);
  }

  /**
   * A superweapon lands. Everything shown comes from what the server reported: the area is
   * the strike's own radius, damage numbers are what garrisons actually lost in this update,
   * and tethers go only to contingents that really changed sides.
   */
  onStrike(e, now) {
    const p = this.tv(e.x, e.y), st = this.serverNow(), seed = (e.x * 13 + e.y) | 0;
    const nodes = this.map.nodes;
    const losses = [];                                    // cities inside the area that lost soldiers just now
    if (this.beforeUnits) {
      for (let i = 0; i < this.N; i++) {
        const lost = this.beforeUnits[i] - this.units[i];
        if (lost > 0 && this.owner[i] !== e.p && Math.hypot(nodes[i][0] - e.x, nodes[i][1] - e.y) <= e.r) losses.push([i, lost]);
      }
    }
    if (e.skill === 'nuke') {
      const d = this.cfg.skills.iron[2];
      this.fx.push({ type: 'nuke', x: p.x, y: p.y, r: e.r, sim: true, t0: st, dur: 7, seed });
      this.fx.push({ type: 'scorch', x: p.x, y: p.y, r: e.r, sim: true, t0: st, dur: 40, seed });
      this.fx.push({ type: 'hazard', x: p.x, y: p.y, r: e.r, sim: true, t0: st, dur: d.hazardDur, seed: e.x | 0 });
      for (const [i, lost] of losses) this.fx.push({ type: 'text', x: this.vn[i].x, y: this.vn[i].y, text: `−${fmt(lost)}`, col: '#ffd9a0', size: 16, t0: now + 0.25, dur: 1.8 });
      this.flashScreen('255,244,214', 0.55, 0.5);
      this.light3d(p, '#ffb060', 6, 2.4);
      this.shake(9);
    } else if (e.skill === 'dominion') {
      this.fx.push({ type: 'dominion', x: p.x, y: p.y, r: e.r, sim: true, t0: st, dur: 2.6, seed });
      // Tethers and halos only where a conversion really happened in this strike.
      for (const c of this.convLog) {
        if (c.by !== e.p || now - c.at > 0.4 || Math.hypot(c.wx - e.x, c.wy - e.y) > e.r + 30) continue;
        this.fx.push({ type: 'tether', x0: p.x, y0: p.y - 34, x: c.x, y: c.y, sim: true, t0: st, dur: 1.4 });
        this.fx.push({ type: 'halo', x: c.x, y: c.y, col: this.color(c.by).light, sim: true, t0: st + 0.3, dur: 2.6 });
      }
      // A garrison is hurt, never taken, by the dominator: a crack and the number, not a capture.
      for (const [i, lost] of losses) {
        this.fx.push({ type: 'psiHit', x: this.vn[i].x, y: this.vn[i].y, sim: true, t0: st, dur: 1.1, seed: i * 17 });
        this.fx.push({ type: 'text', x: this.vn[i].x, y: this.vn[i].y, text: `−${fmt(lost)}`, col: '#e2c4ff', size: 16, t0: now + 0.25, dur: 1.8 });
      }
      this.flashScreen('200,150,255', 0.18, 0.4);
      this.light3d(p, '#b98cff', 3, 1.6);
      this.shake(2.5);
    } else {
      this.fx.push({ type: 'strike', skill: e.skill, x: p.x, y: p.y, r: e.r, t0: now, dur: 1.1, seed });
      this.shake(4);
    }
  }

  /** A brief wash over the whole view. Off with reduced flashes; never pure white for long. */
  flashScreen(rgb, peak, dur) {
    if (this.settings.flash === false) return;
    this.screenFlash = { rgb, peak, dur, t0: performance.now() / 1000 };
  }

  /** Let the 3D scene catch the light of an effect, where the renderer supports it. */
  light3d(p, color, strength, dur) {
    if (this.use3d && this.r3d && this.r3d.pulse && this.settings.flash !== false) this.r3d.pulse(p.x, p.y, color, strength, dur);
  }

  shake(amount) {
    if (this.settings.shake) this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  // ------------------------------------------------------------ layout

  /** World -> view coordinates. Portrait screens get the map transposed. */
  tv(x, y) {
    return this.flip ? { x: y - this.minX, y: x - this.minY } : { x: x - this.minX, y: y - this.minY };
  }

  /** View -> world, for sending target points to the server. */
  toWorld(p) {
    return this.flip ? { x: p.y + this.minY, y: p.x + this.minX } : { x: p.x + this.minX, y: p.y + this.minY };
  }

  resize() {
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    this.dpr = dpr;
    this.cv.width = Math.round(W * dpr);
    this.cv.height = Math.round(H * dpr);
    if (!this.map) return;

    const padT = 54, padB = 74, padX = 6;
    const aw = W - padX * 2, ah = H - padT - padB;
    this.flip = ah > aw;
    // The 3D view keeps a wider border, most of it on the far side, for the skyline around the field.
    const [mL, mR, mT, mB] = this.use3d
      ? [this.R + 34, this.R + 40, this.R + 104, this.R + 28]
      : [this.R + 16, this.R + 26, this.R + 40, this.R + 22];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [wx, wy] of this.map.nodes) {
      const x = this.flip ? wy : wx, y = this.flip ? wx : wy;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    this.minX = x0 - mL;
    this.minY = y0 - mT;
    this.vw = x1 - x0 + mL + mR;
    this.vh = y1 - y0 + mT + mB;
    this.s = Math.min(aw / this.vw, ah / this.vh);
    this.ox = padX + (aw - this.vw * this.s) / 2;
    this.oy = padT + (ah - this.vh * this.s) / 2;
    const old = this.vn;
    this.vn = this.map.nodes.map(([x, y]) => this.tv(x, y));
    this.depth = this.vn.map((_, i) => i).sort((a, b) => this.vn[a].y - this.vn[b].y);
    this.hitR = Math.max(this.R + 10, 24 / this.s);
    if (old && this.crates) {
      this.fx = this.fx.filter(f => f.node != null);       // positioned effects do not survive a re-layout
      for (const cr of this.crates.values()) Object.assign(cr, this.tv(cr.wx, cr.wy));
    }

    const k = dpr * this.s;
    this.sprites.setScale(k);
    const c = this.bg || (this.bg = document.createElement('canvas'));
    c.width = this.cv.width;
    c.height = this.cv.height;
    const seed = this.map.nodes.reduce((a, n) => (a * 31 + n[0] * 7 + n[1]) | 0, 17);
    // Office blocks and street lamps, placed where they cannot cover a road, a city or a label.
    this.scenery = planScenery({
      nodes: this.vn, roads: this.edges, R: this.R, seed, skyline: this.use3d,
      x0: -this.ox / this.s, y0: -this.oy / this.s, x1: (W - this.ox) / this.s, y1: (H - this.oy) / this.s,
    });
    // In 3D the scenery is real geometry (towers, trees and lamps cast shadows and are mirrored in the
    // wet ground) and the terrain comes with a wetness map; the canvas renderer gets it all painted in.
    const wet = this.use3d ? this.wet || (this.wet = document.createElement('canvas')) : null;
    const painted = buildTerrain(c, {
      k, ox: dpr * this.ox, oy: dpr * this.oy, nodes: this.vn, roads: this.edges, R: this.R, seed,
      scenery: this.use3d ? { blocks: this.scenery.towers, lamps: this.scenery.lamps } : this.scenery,
      bake: !this.use3d, props3d: this.use3d,
    }, wet);
    if (this.use3d) {
      this.r3d.resize(this.cv.width, this.cv.height);
      this.r3d.setGround(c, wet);
      this.r3d.setScenery({ towers: this.scenery.towers, trees: painted.trees });
    }
  }

  // ------------------------------------------------------------ input

  toView(e) {
    const r = this.cv.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.ox) / this.s, y: (e.clientY - r.top - this.oy) / this.s };
  }

  nodeAt(p) {
    let best = -1, bd = this.hitR;
    for (let i = 0; i < this.N; i++) {
      const d = Math.hypot(this.vn[i].x - p.x, this.vn[i].y - 8 - p.y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Nearest hostile army on the road (not besieging) to a point, for single-target skills. */
  armyAt(p) {
    let best = null, bd = Math.max(34, 30 / this.s);
    for (const a of this.st.armies.values()) {
      if (a.o === this.me || a.st === 2 || a.hx == null) continue;
      const d = Math.hypot(a.hx - p.x, a.hy - p.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  canPlay() {
    return this.active && this.winner === null && this.me >= 0 && this.alive[this.me];
  }

  linked(a, b) { return this.adj[a].includes(b); }

  /** Road route for my troops from city a to city b, by the server's rule (preview only). */
  routeTo(a, b) {
    const nodes = this.map.nodes;                        // [x, y] in world units, the same the server measures roads in
    return planRoute(this.N, u => this.adj[u], (u, v) => Math.hypot(nodes[u][0] - nodes[v][0], nodes[u][1] - nodes[v][1]),
      u => this.owner[u] === this.me, a, b);
  }

  /**
   * What one order from `from` to `to` would do. Every city of mine plans its
   * own route to the same destination; the ones that cannot take part are
   * listed with the reason instead of being dropped. This is only a preview:
   * the server works it out again and its answer is what happens.
   */
  plan(from, to) {
    const routes = [], out = [];
    let total = 0;
    for (const s of from) {
      if (s === to || this.owner[s] !== this.me) continue;
      const r = this.routeTo(s, to);
      if (!r) { out.push({ from: s, why: 'noRoute' }); continue; }
      const n = this.dispatchCount(s);
      if (n < 1) { out.push({ from: s, why: 'noTroops' }); continue; }
      routes.push({ from: s, path: r.path, n });
      total += n;
    }
    return { routes, out, total };
  }

  /** Soldiers one order would take from city i (same rule as the server). */
  dispatchCount(i, pct = this.pct) {
    const have = this.shown(i);
    let n = Math.floor(have * pct);
    if (n < 1 && have >= 1) n = 1;
    return Math.max(0, Math.min(n, have - this.cfg.dispatch.minGarrison));
  }

  onDown(e) {
    sfx.unlock();
    if (!this.map || this.drag) return;                  // a second finger never starts a second order
    const p = this.toView(e);
    this.ptr = p;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.targeting) return this.targetClick(p);
    const cancelHit = this.autoCancelAt(p);
    if (cancelHit) {
      this.stopAutoSegment(cancelHit.u, cancelHit.v);
      this.hoverCancel = null;
      return;
    }
    const id = this.nodeAt(p);
    if (!this.canPlay()) { this.sel = id; return; }      // spectators can still inspect cities
    if (this.rallyMode) {
      if (id >= 0) {
        if (this.rallyTargets.has(id)) this.rallyTargets.delete(id); else this.rallyTargets.add(id);
        if (e.shiftKey) this.shiftRally = true;
        if (this.hooks.onAutos) this.hooks.onAutos();
      }
      return;
    }
    if (id >= 0 && e.shiftKey && this.owner[id] !== this.me) {
      // Shift+clicking enemy/neutral cities quickly builds a multi-target attack/rally set.
      if (this.sel >= 0 && this.sel !== id && !this.rallyTargets.size) this.rallyTargets.add(this.sel);
      this.rallyMode = true;
      this.shiftRally = true;
      if (this.rallyTargets.has(id)) this.rallyTargets.delete(id); else this.rallyTargets.add(id);
      this.sel = -1;
      this.picked.clear();
      if (this.hooks.onAutos) this.hooks.onAutos();
      return;
    }
    if (id >= 0 && this.owner[id] === this.me) {
      if (e.shiftKey) {                                  // build up a multi-city selection
        if (this.picked.has(id)) this.picked.delete(id); else this.picked.add(id);
        this.sel = id;
        if (this.hooks.onAutos) this.hooks.onAutos();
        return;
      }
      // Dragging from a Shift-picked multi-selection uses fan-in mode; dragging from one city builds a continuous chain a->b->c.
      const fan = this.picked.size > 1 && this.picked.has(id);
      const sources = fan ? new Set(this.picked) : new Set([id]);
      this.drag = {
        mode: fan ? 'fan' : 'chain',
        chain: [id],
        sources, start: id, x: p.x, y: p.y, target: -1, ok: false, pid: e.pointerId, moved: false,
      };
      try { this.cv.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    } else {
      this.sel = this.sel === id ? -1 : id;
      if (id < 0) this.picked.clear();
      if (this.hooks.onAutos) this.hooks.onAutos();
    }
  }

  onMove(e) {
    if (!this.map) return;
    const p = this.toView(e);
    this.ptr = p;
    const cancelH = !this.drag && !this.targeting && e.pointerType === 'mouse' ? this.autoCancelAt(p) : null;
    this.hoverCancel = cancelH ? cancelH.key : null;
    const h = cancelH ? -1 : this.nodeAt(p);
    this.hover = e.pointerType === 'mouse' || this.targeting || this.rallyMode ? h : -1;
    if (e.pointerType === 'mouse' && h >= 0 && !this.drag && !this.targeting) {
      this.hoverCity = h;
      this.hoverKeepUntil = performance.now() + 260;
    }
    const d = this.drag;
    if (!d) {
      this.cv.style.cursor = this.targeting || this.rallyMode ? 'crosshair' : (cancelH || h >= 0) ? 'pointer' : 'default';
      return;
    }
    if (d.pid !== e.pointerId) return;
    if (Math.hypot(p.x - d.x, p.y - d.y) > 6) d.moved = true;
    d.px = p.x; d.py = p.y;
    if (d.mode === 'chain') {
      if (h >= 0) {
        const last = d.chain[d.chain.length - 1];
        if (h !== last) {
          if (d.chain.length >= 2 && h === d.chain[d.chain.length - 2]) {
            d.chain.pop();
          } else {
            // Only my own cities may act as intermediate hops; replace a non-owned tail if pointer moves on.
            if (this.owner[last] !== this.me) d.chain.pop();
            if (!d.chain.includes(h)) d.chain.push(h);
          }
        }
      } else if (d.chain.length > 1 && this.owner[d.chain[d.chain.length - 1]] !== this.me) {
        d.chain.pop();
      }
      d.target = d.chain.length > 1 ? d.chain[d.chain.length - 1] : -1;
      d.ok = d.chain.length > 1;
      return;
    }
    // Fan-in mode (from Shift-selected multi-city group): sweeping over more own cities adds them.
    if (h >= 0 && this.owner[h] === this.me && h !== d.start) d.sources.add(h);
    d.target = h >= 0 && (h !== d.start || d.sources.size > 1) ? h : -1;
    d.plan = d.target >= 0 ? this.plan([...d.sources], d.target) : null;
    d.ok = !!d.plan && d.plan.routes.length > 0;
  }

  onUp(e) {
    const d = this.drag;
    if (!d || d.pid !== e.pointerId) return;
    this.drag = null;                                    // the gesture ends here whatever happens next
    if (!this.canPlay()) return;
    const h = this.nodeAt(this.toView(e));
    if (!d.moved && h === d.start) {
      const now = performance.now();
      if (this.lastTap.id === h && now - this.lastTap.t < 350) {
        this.hooks.upgrade(h);
        this.lastTap = { id: -1, t: 0 };
      } else {
        this.sel = this.sel === h && !this.picked.size ? -1 : h;
        this.picked.clear();
        this.lastTap = { id: h, t: now };
        if (this.hooks.onAutos) this.hooks.onAutos();
      }
      return;
    }
    if (d.mode === 'chain') {
      if (h < 0 && d.chain.length < 2) return;           // released on open ground with no chain built
      if (h >= 0) {
        const last = d.chain[d.chain.length - 1];
        if (h !== last) {
          if (this.owner[last] !== this.me) d.chain.pop();
          if (!d.chain.includes(h)) d.chain.push(h);
        }
      }
      if (d.chain.length < 2) return;
      const pairs = [];
      for (let i = 0; i + 1 < d.chain.length; i++) {
        const u = d.chain[i], v = d.chain[i + 1];
        if (u !== v && this.owner[u] === this.me) pairs.push([u, v]);
      }
      if (pairs.length) this.orderPairs(pairs);
      return;
    }
    if (h < 0) return;                                   // released on open ground: cancelled, nothing spent
    if (h === d.start && d.sources.size === 1) return;
    this.order([...d.sources], h);
  }

  /**
   * Issue multiple [src, dest] dispatch routes at once (chain drag a->b->c or rally/attack).
   * When `replace` is true, all previous auto-dispatch routes of this player are overwritten.
   */
  orderPairs(pairs, replace = false) {
    if (!this.canPlay() || !pairs.length) return false;
    if (this.paused) { this.hooks.notify('paused'); return false; }
    const valid = pairs.filter(([u, v]) => u !== v && this.owner[u] === this.me);
    if (!valid.length) return false;
    if (this.autoMode) {
      sfx.send();
      this.hooks.autoPairs(valid, this.pct, this.nextCmd++, replace);
      return true;
    }
    // Single-dispatch mode: group pairs by destination and send.
    const byDest = new Map();
    for (const [u, v] of valid) {
      let list = byDest.get(v);
      if (!list) byDest.set(v, list = []);
      list.push(u);
    }
    let any = false;
    for (const [to, from] of byDest) if (this.order(from, to)) any = true;
    return any;
  }

  /**
   * One coordinated order from every selected city to `to`. Each city plans
   * its own route there, however many roads away it is. All of my selected
   * cities go into the command and the server answers for each one; the
   * preview only decides what to predict on screen (garrisons drop at once
   * and the server's reply replaces the guess). The command id makes the
   * order safe to retry.
   */
  order(from, to) {
    if (!this.canPlay() || to < 0) return false;
    if (this.paused) { this.hooks.notify('paused'); return false; }
    const mine = from.filter(s => s !== to && this.owner[s] === this.me);
    if (!mine.length) return false;
    if (this.autoMode) {
      // Auto dispatch (default): the server keeps the order and sends from these cities again and again.
      sfx.send();
      this.hooks.auto(mine, to, this.pct, this.nextCmd++);
      return true;
    }
    const plan = this.plan(mine, to);
    if (!plan.routes.length) {                           // nobody can march: nothing is sent, nothing is spent
      this.reportOrder(0, 0, plan.out);
      return false;
    }
    const out = {};
    for (const r of plan.routes) out[r.from] = r.n;
    const id = this.nextCmd++;
    this.pending.set(id, { out, to, at: performance.now() / 1000 });
    sfx.send();
    this.hooks.send(mine, to, this.pct, id);
    return true;
  }

  setAutoMode(on) {
    this.autoMode = on === undefined ? !this.autoMode : !!on;
    if (this.autoMode) this.targeting = null;
    if (this.hooks.onAutos) this.hooks.onAutos();
  }

  setRallyMode(on) {
    this.rallyMode = on === undefined ? !this.rallyMode : !!on;
    this.shiftRally = false;
    if (this.rallyMode) {
      this.targeting = null;
      this.drag = null;
      if (this.sel >= 0 && !this.rallyTargets.size) { this.rallyTargets.add(this.sel); this.sel = -1; }
    } else {
      this.rallyTargets.clear();
    }
    if (this.hooks.onAutos) this.hooks.onAutos();
  }

  /** Auto-execute Shift-selected rally/attack targets as soon as Shift is released. */
  onShiftUp() {
    if (!this.shiftRally) return;
    this.shiftRally = false;
    if (this.rallyMode && this.rallyTargets.size > 0) this.confirmRally();
  }

  /** Compute optimal & evenly-distributed dispatch plan for the given target city ids. */
  rallyPlan(targets) {
    const nodes = this.map.nodes;
    const mine = [];
    for (let i = 0; i < this.N; i++) if (this.owner[i] === this.me) mine.push(i);
    return planBalancedDispatch(
      this.N,
      u => this.adj[u],
      (u, v) => Math.hypot(nodes[u][0] - nodes[v][0], nodes[u][1] - nodes[v][1]),
      u => this.owner[u] === this.me,
      u => Math.max(1, this.shown(u)) + (this.levels[this.level[u]] ? this.levels[this.level[u]].prod * 10 : 0),
      mine,
      targets,
    );
  }

  /** Execute optimal rally/attack dispatch to one or more target cities, overwriting old routes. */
  dispatchToTargets(targets) {
    if (!this.canPlay() || !targets || !targets.length) return false;
    if (this.paused) { this.hooks.notify('paused'); return false; }
    const plan = this.rallyPlan(targets);
    if (!plan.pairs.length) {
      this.hooks.notify('rallyNoRoute');
      return false;
    }
    const ok = this.orderPairs(plan.pairs, true);
    if (ok) {
      this.activeTargets = new Set(plan.reachableTargets);
      if (plan.unreachableTargets.length) {
        this.hooks.notify('rallyPartial', { ok: plan.reachableTargets.length, out: plan.unreachableTargets.length });
      }
    }
    this.rallyMode = false;
    this.shiftRally = false;
    this.rallyTargets.clear();
    if (this.hooks.onAutos) this.hooks.onAutos();
    return ok;
  }

  /** Confirm the active rally/attack targets (or the currently selected city). */
  confirmRally() {
    const targets = this.rallyTargets.size ? [...this.rallyTargets] : this.sel >= 0 ? [this.sel] : [];
    if (!targets.length) return false;
    return this.dispatchToTargets(targets);
  }

  /** The cities an auto-dispatch control acts on: the multi-selection, else the selected city. */
  chosen() {
    return this.picked.size ? [...this.picked] : this.sel >= 0 ? [this.sel] : [];
  }

  /** Stop all persistent orders of the given (or chosen) cities. */
  stopAuto(ids) {
    const list = (ids || this.chosen()).filter(s => this.hasAutoFrom(s));
    if (!list.length || !this.canPlay()) return false;
    if (this.paused) { this.hooks.notify('paused'); return false; }
    this.hooks.auto(list, -1, 0, this.nextCmd++, true);
    return true;
  }

  /** Stop dispatch along one specific road segment (u -> v). */
  stopAutoSegment(u, v) {
    if (!this.canPlay() || !this.autos.size) return false;
    if (this.paused) { this.hooks.notify('paused'); return false; }
    this.hooks.autoSegOff(u, v, this.nextCmd++);
    return true;
  }

  /** Clickable "×" cancel button coordinates for every road segment with active auto dispatch. */
  autoCancelPoints() {
    if (this.me < 0 || !this.autos.size || !this.vn) return [];
    const routes = this.autoRoutes();
    const legs = new Map();
    const addLeg = (u, v, state) => {
      const key = `${u}|${v}`;
      const prev = legs.get(key);
      if (!prev) legs.set(key, { key, u, v, state });
      else if (state === 0) prev.state = 0;
    };
    for (const r of routes) {
      if (r.path && r.path.length >= 2) {
        for (let i = 0; i + 1 < r.path.length; i++) addLeg(r.path[i], r.path[i + 1], r.state);
      } else {
        addLeg(r.src, r.dest, r.state);
      }
    }
    const pts = [];
    for (const leg of legs.values()) {
      const A = this.vn[leg.u], B = this.vn[leg.v];
      if (!A || !B) continue;
      pts.push({ key: leg.key, u: leg.u, v: leg.v, state: leg.state, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
    }
    return pts;
  }

  /** Auto-dispatch route whose "×" cancel button is under `p`, or null. */
  autoCancelAt(p) {
    if (!this.canPlay() || this.targeting || !this.autos.size) return null;
    let best = null, bd = Math.max(13, 15 / this.s);
    for (const pt of this.autoCancelPoints()) {
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < bd) { bd = d; best = pt; }
    }
    return best;
  }

  /**
   * Routes of my persistent orders, for drawing. Planned again only when an order or a
   * city's owner changed, never per frame.
   */
  autoRoutes() {
    const key = `${this.autoRev}|${this.ownerRev}`;
    if (!this.autoPaths || this.autoPaths.key !== key) {
      const list = [];
      for (const [k, o] of this.autos) {
        if (this.owner[o.src] !== this.me) continue;
        const r = this.routeTo(o.src, o.dest);
        list.push({ key: k, src: o.src, dest: o.dest, state: o.state, path: r ? r.path : null });
      }
      this.autoPaths = { key, list };
    }
    return this.autoPaths.list;
  }

  // ------------------------------------------------------------ skills

  /** Start casting skill `slot`: untargeted skills fire at once, the rest enter targeting. */
  beginTarget(slot) {
    if (!this.canPlay()) return;
    if (this.paused) return this.hooks.notify('paused');
    const def = this.cfg.skills[this.sides[this.me].f][slot];
    this.drag = null;
    if (def.target === 'none') return this.cast(slot, {});
    this.targeting = this.targeting && this.targeting.slot === slot ? null : { slot, def, src: -1 };
  }

  cast(slot, args) {
    this.targeting = null;
    if (this.paused) return this.hooks.notify('paused');
    this.hooks.skill(slot, args, this.nextCmd++);
  }

  targetClick(p) {
    const T = this.targeting, def = T.def;
    const node = this.nodeAt(p);
    if (def.target === 'point') {
      const w = this.toWorld(p);
      return this.cast(T.slot, { x: Math.round(w.x), y: Math.round(w.y) });
    }
    if (def.target === 'ownCity') {
      if (node >= 0 && this.owner[node] === this.me) this.cast(T.slot, { node });
      else this.hooks.notify('needOwnCity');
      return;
    }
    if (def.target === 'army') {
      const a = this.armyAt(p);
      if (a) this.cast(T.slot, { army: a.id }); else this.hooks.notify('needArmy');
      return;
    }
    // city pair: source first, then destination
    if (T.src < 0) {
      if (node >= 0 && this.owner[node] === this.me && this.phaseCount(node) > 0) T.src = node;
      else this.hooks.notify('needOwnCity');
    } else if (node >= 0 && node !== T.src) {
      this.cast(T.slot, { node: T.src, to: node, pct: this.pct });
    }
  }

  /** Soldiers a phase dispatch would move from city i. */
  phaseCount(i) {
    return Math.min(this.cfg.skills.meridian[2].limit, this.dispatchCount(i));
  }

  // ------------------------------------------------------------ keyboard

  neighborToward(i, dx, dy) {
    let best = -1, bc = 0.3;
    for (const j of this.adj[i]) {
      const vx = this.vn[j].x - this.vn[i].x, vy = this.vn[j].y - this.vn[i].y;
      const c = (vx * dx + vy * dy) / (Math.hypot(vx, vy) || 1);
      if (c > bc) { bc = c; best = j; }
    }
    return best;
  }

  moveSel(dx, dy) {
    if (!this.map) return;
    if (this.sel < 0) return this.cycleOwn(1);
    const j = this.neighborToward(this.sel, dx, dy);
    if (j >= 0) this.sel = j;
  }

  sendDir(dx, dy) {
    if (this.sel < 0 || this.owner[this.sel] !== this.me) return;
    const j = this.neighborToward(this.sel, dx, dy);
    if (j < 0) return this.hooks.notify('noRoad');
    this.order(this.picked.size ? [...this.picked] : [this.sel], j);
  }

  sendToHover() {
    if (this.hover < 0) return;
    const from = this.picked.size ? [...this.picked] : this.sel >= 0 ? [this.sel] : [];
    if (from.length && !(from.length === 1 && from[0] === this.hover)) this.order(from, this.hover);
  }

  cycleOwn(step) {
    if (!this.map) return;
    const mine = [];
    for (let i = 0; i < this.N; i++) if (this.owner[i] === this.me) mine.push(i);
    if (!mine.length) return;
    mine.sort((a, b) => this.vn[a].x - this.vn[b].x || this.vn[a].y - this.vn[b].y);
    const at = mine.indexOf(this.sel);
    this.sel = mine[at < 0 ? 0 : (at + step + mine.length) % mine.length];
  }

  /** Select every city I own for one coordinated order. */
  pickAll() {
    this.picked.clear();
    for (let i = 0; i < this.N; i++) if (this.owner[i] === this.me) this.picked.add(i);
    if (this.sel < 0 || !this.picked.has(this.sel)) this.sel = this.picked.values().next().value ?? -1;
  }

  cancel() {
    this.drag = null;
    this.targeting = null;
    this.rallyMode = false;
    this.shiftRally = false;
    if (this.rallyTargets) this.rallyTargets.clear();
    this.sel = -1;
    if (this.picked) this.picked.clear();
    if (this.hooks.onAutos) this.hooks.onAutos();
  }

  // ------------------------------------------------------------ rendering

  _frame(now) {
    if (!this.active) { this.raf = 0; return; }
    this.raf = requestAnimationFrame(this._frame);
    if (!this.bg) return;
    const ctx = this.ctx, k = this.dpr * this.s;
    const lt = now / 1000;
    const dt = Math.min(0.1, lt - (this.lastLt || lt));
    this.lastLt = lt;
    const t = this.frozenT !== null ? this.frozenT : this.serverNow();

    for (const [id, p] of this.pending) if (lt - p.at > PREDICT_TTL) this.pending.delete(id);

    let sx = 0, sy = 0;
    if (this.shakeAmp > 0.2) {
      sx = (Math.random() - 0.5) * this.shakeAmp * this.dpr;
      sy = (Math.random() - 0.5) * this.shakeAmp * this.dpr;
      this.shakeAmp *= Math.pow(0.02, dt);
    } else this.shakeAmp = 0;

    // With WebGL the world is drawn on the canvas underneath and this one becomes a
    // transparent overlay for plates, markers and effects.
    const g3 = this.use3d && !this.r3d.lost ? this.r3d : null;
    this.g3 = g3;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (g3) {
      ctx.clearRect(0, 0, this.cv.width, this.cv.height);
      g3.begin();
      for (const p of this.scenery.lamps) g3.add('lamp', lampModel, p.x, p.y, 0, 0, 1);
    } else ctx.drawImage(this.bg, sx, sy);
    ctx.setTransform(k, 0, 0, k, this.dpr * this.ox + sx, this.dpr * this.oy + sy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    this.shots.length = 0;
    this.glows.length = 0;
    this.layoutArmies(t);
    this.drawFields(ctx, lt);
    for (const [id, p] of this.crates) drawCrate(ctx, p.x, p.y, lt, id);
    this.drawFx(ctx, lt, true);
    this.drawRings(ctx, lt);
    this.drawAutoRoutes(ctx, lt);
    this.drawMarchRoutes(ctx, lt);

    // Cities and units share one depth order so troops pass behind structures.
    const items = this.items, depth = this.depth;
    let ui = 0;
    for (let n = 0; n < depth.length; n++) {
      const i = depth[n];
      const ny = this.vn[i].y;
      while (ui < items.length && items[ui].y < ny) this.drawUnit(ctx, items[ui++], t, lt);
      this.heat[i] = Math.max(0, this.heat[i] - dt * 0.5);
      this.drawNode(ctx, i, lt);
    }
    while (ui < items.length) this.drawUnit(ctx, items[ui++], t, lt);
    this.drawRain(ctx, lt);

    for (let i = 0; i < this.N; i++) this.drawPlate(ctx, i, lt);
    this.drawArmyPlates(ctx);
    this.drawAutoBadges(ctx, lt);
    this.drawAutoCancels(ctx);
    this.drawRejects(ctx, lt);
    this.drawShots(ctx, lt);
    this.drawFx(ctx, lt);
    this.drawRallyPreview(ctx, lt);
    this.drawDrag(ctx, lt);
    this.drawTargeting(ctx, lt);
    if (g3) g3.render({ k, ox: this.dpr * this.ox + sx, oy: this.dpr * this.oy + sy, ox0: this.dpr * this.ox, oy0: this.dpr * this.oy });

    const fl = this.screenFlash;
    if (fl) {
      const q = (lt - fl.t0) / fl.dur;
      if (q >= 1) this.screenFlash = null;
      else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(${fl.rgb},${(fl.peak * (1 - q) * (1 - q)).toFixed(3)})`;
        ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      }
    }
    if (lt - this.hudAt > 0.25) { this.hudAt = lt; this.updateHud(); }
    this.placeUpgrade();
    this.placeCityActions();
    this.updateInfo();
  }

  /**
   * Rain: slanted streaks across the field and rings where drops land on the
   * wet ground. Drawn under the labels so numbers stay crisp; off with reduced
   * effects and on the low preset.
   */
  drawRain(ctx, lt) {
    if (!this.settings.effects || this.q === QUALITY.low) return;
    const W = this.cv.width / (this.dpr * this.s), H = this.cv.height / (this.dpr * this.s);
    const x0 = -this.ox / this.s, y0 = -this.oy / this.s;
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
    for (let i = this.q === QUALITY.high ? 130 : 80; i > 0; i--) {
      const h = hash(Math.imul(i, 0x9e3779b1));
      const fall = (lt * (620 + (h % 300)) + ((h >>> 8) % 4096)) % (H + 80);
      const x = x0 + (((h >>> 4) % 2000) / 2000) * (W + 160) - fall * 0.22;
      const y = y0 - 40 + fall, len = 14 + (h % 12);
      ctx.moveTo(x, y); ctx.lineTo(x - len * 0.22, y + len);
    }
    ctx.stroke();
  }

  /**
   * Where every army is right now, and which sprites represent it. An army
   * of 60 is drawn as a column of at most `q.sprites` figures in its real
   * tier mix; its plate carries the exact numbers.
   */
  layoutArmies(t) {
    const items = this.items, pool = this.pool, cap = this.q.sprites;
    const arrive = this.cfg.march.arriveAt;
    items.length = 0;
    let n = 0;
    for (const a of this.st.armies.values()) {
      const A = this.vn[a.from], Z = this.vn[a.to];
      const L = Math.hypot(Z.x - A.x, Z.y - A.y) || 1;
      a.ux = (Z.x - A.x) / L; a.uy = (Z.y - A.y) / L;
      const s = a.st === 0 ? a.s + a.v * (t - a.t) : a.s;
      // An army with more road ahead walks through the city to its centre; one on its last road stops at the edge.
      a.sn = Math.max(0, Math.min(a.path && a.path.length ? L : L - arrive, s));
      a.hx = A.x + a.ux * a.sn; a.hy = A.y + a.uy * a.sn;
    }
    for (const a of this.st.armies.values()) {
      const A = this.vn[a.from], Z = this.vn[a.to];
      const side = this.sides[a.o];
      // What it is shooting at: the city it besieges, or the enemy it has met on the road.
      let fire = false, tx = 0, ty = 0;
      if (a.st === 2) { fire = true; tx = Z.x; ty = Z.y - 12; }
      else if (a.st === 1) {
        let best = null, bd = Infinity;
        for (const b of this.st.armies.values()) {
          if (b.o === a.o || b.st === 2) continue;
          if (!((b.from === a.from && b.to === a.to) || (b.from === a.to && b.to === a.from))) continue;
          const d = Math.hypot(b.hx - a.hx, b.hy - a.hy);
          if (d < bd) { bd = d; best = b; }
        }
        if (best) { fire = true; tx = best.hx; ty = best.hy - 6; }
      }
      const counts = [0, a.n1, a.n2, a.n3];
      const scale = a.n > cap ? cap / a.n : 1;
      const base = Math.atan2(A.y - Z.y, A.x - Z.x);
      let back = 0, k = 0;
      for (let tier = 3; tier >= 1; tier--) {
        if (!counts[tier]) continue;
        const c = Math.max(1, Math.round(counts[tier] * scale));
        const row = ROW[tier];
        for (let j = 0; j < c; j++, k++) {
          let x, y;
          if (a.st === 2) {                               // drawn up around the city it is attacking
            const ringNo = Math.floor(k / 6), idx = k % 6;
            const ang = base + (idx - 2.5) * 0.2 + ringNo * 0.1, rad = 68 + ringNo * 12;      // outside the compound wall
            x = Z.x + Math.cos(ang) * rad;
            y = Z.y + Math.sin(ang) * rad * 0.78 + 4;
          } else {
            const r = Math.floor(j / row), inRow = Math.min(row, c - r * row);
            const d = a.sn - back - r * GAP[tier];
            if (d < 46) continue;                         // still inside the compound
            const off = ((j % row) - (inRow - 1) / 2) * LANE[tier];
            x = A.x + a.ux * d - a.uy * off;
            y = A.y + a.uy * d + a.ux * off * 0.8;
          }
          let dx = a.ux, dy = a.uy;
          if (fire) { const l = Math.hypot(tx - x, ty - y) || 1; dx = (tx - x) / l; dy = (ty - y) / l; }
          const it = pool[n] || (pool[n] = {});
          n++;
          it.x = x; it.y = y; it.dx = dx; it.dy = dy; it.k = k; it.a = a; it.tier = tier; it.side = side;
          it.fire = fire; it.tx = tx; it.ty = ty;
          items.push(it);
        }
        back += Math.ceil(c / row) * GAP[tier] + 5;
      }
    }
    items.sort((p, q) => p.y - q.y);
  }

  /** Queue a weapon effect. Each figure keeps its own phase within the weapon's cycle. */
  fire(it, fam, x, y, t, lt) {
    const cyc = t / WEAPON[fam].period + (hash(it.a.id * 57 + it.k) & 1023) / 1024;
    const ph = cyc % 1;
    if (this.settings.effects || (it.k & 1) === 0) {
      const seed = hash(it.a.id * 911 + it.k * 13 + Math.floor(cyc));
      this.shots.push({
        fam, lvl: it.tier, x, y, ph, seed, lt, A: it.side.A, G: it.side.G,
        tx: it.tx + ((seed & 15) - 7.5) * 0.9, ty: it.ty + (((seed >> 4) & 7) - 3.5),
      });
    }
    return ph;
  }

  /** A unit sprite at unit scale (the sprite cache holds them at model size). */
  sprite(ctx, spr, x, y, k = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(US * k, US * k);
    drawSprite(ctx, spr, 0, 0);
    ctx.restore();
  }

  /** A vehicle's sockets (pivot, muzzle, hover height, footprint, glow) at unit scale. */
  specOf(f, sub, tier) {
    const key = `${f}|${sub}|${tier}`;
    let sp = (this.specs || (this.specs = new Map())).get(key);
    if (!sp) {
      const u = unitSpec(f, sub, tier);
      sp = { ...u, pivot: u.pivot * US, muzzle: u.muzzle * US, mz: u.mz * US, hover: u.hover * US, foot: [u.foot[0] * US, u.foot[1] * US], glow: u.glow && [u.glow[0] * US, u.glow[1] * US, u.glow[2] * US * 0.7] };
      this.specs.set(key, sp);
    }
    return sp;
  }

  drawUnit(ctx, it, t, lt) {
    const s = it.side, a = it.a, tier = it.tier;
    const fam = weaponOf(s.f, s.sub, tier);
    const moving = a.st === 0 && a.v > 1;

    if (tier === 1) {
      const dir8 = ((Math.round(Math.atan2(it.dy, it.dx) / (Math.PI / 4)) % 8) + 8) % 8;
      const frame = moving ? Math.floor(lt * 9 + it.k * 1.3) & 3 : 0;
      if (this.g3) this.g3.add(`s|${s.f}|${s.sub}|${s.tc.id}|${frame}`, () => buildSoldier(s.f, s.sub, s.tc, frame), it.x, it.y, 0, Math.atan2(it.dy / F, it.dx), US * FOOT);
      else this.sprite(ctx, soldierSprite(this.sprites, s.f, s.sub, s.tc, dir8, frame), it.x, it.y, FOOT);
      if (it.fire) {
        const m = soldierMuzzle(s.f, s.sub, it.dx, it.dy);
        this.fire(it, fam, it.x + m[0] * US * FOOT, it.y + m[1] * US * FOOT, t, lt);
      }
      return;
    }

    const spec = this.specOf(s.f, s.sub, tier);
    const g3 = this.g3;
    const hd = dirIndex(Math.atan2(a.uy / F, a.ux));     // the hull stays on the road; only the turret turns
    const ha = g3 ? Math.atan2(a.uy / F, a.ux) : hd * STEP;   // 3D turns freely; sprites have 32 facings
    let y = it.y;
    if (spec.hover) {
      const lift = spec.hover + Math.sin(lt * 3 + it.k * 1.7) * 1.1;
      if (!g3) {                                         // the 3D renderer casts a real shadow
        ctx.fillStyle = 'rgba(0,0,0,.34)';
        ctx.beginPath(); ctx.ellipse(it.x + 3, it.y + 3, spec.foot[0] * 0.92, spec.foot[0] * 0.92 * F, 0, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 0.28 + 0.12 * Math.sin(lt * 5 + it.k);
      ctx.fillStyle = s.G;
      ctx.beginPath(); ctx.ellipse(it.x, it.y, spec.foot[0] * 0.7, spec.foot[0] * 0.7 * F, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      y -= lift;
    } else if (moving && this.settings.effects) {
      for (let j = 0; j < 2; j++) {                       // dust
        const ph = (lt * 1.5 + j * 0.5 + it.k * 0.37) % 1;
        ctx.globalAlpha = (1 - ph) * 0.26;
        ctx.fillStyle = '#b9a783';
        ctx.beginPath(); ctx.arc(it.x - a.ux * (spec.foot[0] + ph * 6), it.y - a.uy * (spec.foot[0] + ph * 6) * 0.8 + 1.4 - ph * 2, 1.1 + ph * 2.4, 0, TAU); ctx.fill();
      }
      if (s.f === 'iron') {                               // exhaust
        const ph = (lt * 1.1 + it.k * 0.61) % 1;
        ctx.globalAlpha = (1 - ph) * 0.42;
        ctx.fillStyle = '#2b2927';
        ctx.beginPath(); ctx.arc(it.x - a.ux * 8.5 + ph * 2, it.y - a.uy * 6 - 8.5 - ph * 8, 1.1 + ph * 2.3, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const lift = it.y - y;
    if (g3) g3.add(`h|${s.f}|${s.sub}|${tier}|${s.tc.id}`, () => buildHull(s.f, s.sub, tier, s.tc), it.x, it.y, lift, ha, US);
    else this.sprite(ctx, hullSprite(this.sprites, s.f, s.sub, tier, s.tc, hd), it.x, y);

    const px = it.x + Math.cos(ha) * spec.pivot, py = y + Math.sin(ha) * spec.pivot * F;
    const aim = it.fire ? Math.atan2((it.ty - py) / F, it.tx - px) : ha;
    const td = it.fire ? dirIndex(aim) : hd;
    const ta = g3 ? aim : td * STEP, tx = Math.cos(ta), ty = Math.sin(ta) * F;
    const mx = px + tx * spec.muzzle, my = py + ty * spec.muzzle - spec.mz;
    const rc = it.fire ? recoilAt(fam, this.fire(it, fam, mx, my, t, lt)) * US : 0;
    if (g3) g3.add(`t|${s.f}|${s.sub}|${tier}|${s.tc.id}`, () => buildTurret(s.f, s.sub, tier, s.tc), px - tx * rc, py + lift - ty * rc, lift, ta, US);
    else this.sprite(ctx, turretSprite(this.sprites, s.f, s.sub, tier, s.tc, td), px - tx * rc, py - ty * rc);
    if (spec.glow) this.glows.push(px + tx * (spec.glow[0] - rc), py + ty * (spec.glow[0] - rc) - spec.glow[1], spec.glow[2], s.f === 'meridian' ? s.G : s.A, it.k);
  }

  drawShots(ctx, lt) {
    if (this.q.glow) ctx.globalCompositeOperation = 'lighter';   // emitters and beams add light
    const g = this.glows;
    for (let i = 0; i < g.length; i += 5) {
      ctx.globalAlpha = 0.3 + 0.18 * Math.sin(lt * 6 + g[i + 4]);
      ctx.fillStyle = g[i + 3];
      ctx.beginPath(); ctx.arc(g[i], g[i + 1], g[i + 2], 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const s of this.shots) {
      const glow = this.q.glow && (s.fam === 'arc' || s.fam === 'beam' || s.fam === 'lance' || s.fam === 'pulse' || s.fam === 'wave' || s.fam === 'plasma');
      if (glow) ctx.globalCompositeOperation = 'lighter';
      drawShot(ctx, s);
      if (glow) ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** City ability ranges: a slowing field, a weakening field, a turret's reach. */
  drawFields(ctx, lt) {
    const R = this.cfg.abilities.range;
    for (let i = 0; i < this.N; i++) {
      const o = this.owner[i];
      if (o < 0 || this.level[i] < 2) continue;
      const f = this.sides[o].f, n = this.vn[i];
      const focus = this.sel === i || this.hover === i;
      if (f === 'iron' && !focus) continue;              // a turret's reach is shown on demand only
      const col = f === 'meridian' ? '#7fd0ff' : f === 'veil' ? '#b77dff' : '#ff9a3c';
      const pulse = f === 'veil' ? 0.5 + 0.5 * Math.sin(lt * 2 + i) : 0.6;
      // Strong when inspected or when a hostile army is inside; a faint trace otherwise,
      // so a large empire does not bury the map under rings.
      let busy = focus;
      if (!busy) for (const a of this.st.armies.values()) {
        if (a.o !== o && a.hx != null && Math.hypot(a.hx - n.x, a.hy - n.y) <= R) { busy = true; break; }
      }
      if (busy) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.05;
        ctx.beginPath(); ctx.arc(n.x, n.y, R, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = busy ? 1.6 : 1;
      ctx.globalAlpha = (busy ? 0.6 : 0.1) * (0.6 + 0.4 * pulse);
      ctx.setLineDash(f === 'meridian' ? [10, 8] : f === 'veil' ? [3, 7] : [16, 6]);
      ctx.lineDashOffset = f === 'veil' ? -lt * 10 : 0;
      ctx.beginPath(); ctx.arc(n.x, n.y, R, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  /** Ground markers: selection, multi-city picks, drag sources/target, reachable cities. */
  drawRings(ctx, lt) {
    const d = this.drag, T = this.targeting;
    const from = d ? d.start : (this.sel >= 0 && this.owner[this.sel] === this.me ? this.sel : -1);
    for (let i = 0; i < this.N; i++) {
      let ring = null;
      if (T) {
        if (T.def.target === 'ownCity' && this.owner[i] === this.me) ring = SKILL_COLOR[T.def.id];
        else if (T.def.target === 'cityPair') {
          if (T.src === i) ring = '#ffffff';
          else if (T.src < 0 ? this.owner[i] === this.me : true) ring = this.hover === i ? '#ffffff' : SKILL_COLOR[T.def.id];
        }
      } else if (d && d.target === i) ring = d.ok ? '#ffffff' : '#ff5a4d';
      else if (d && d.plan && d.plan.out.some(o => o.from === i)) ring = '#ff5a4d';
      else if (d && d.sources.has(i)) ring = this.color(this.owner[i]).light;
      else if (d && d.via && d.via.has(i)) ring = 'rgba(255,255,255,.6)';
      else if (this.picked.has(i)) ring = this.color(this.owner[i]).light;
      else if (this.sel === i) ring = '#ffffff';
      else if (from >= 0 && this.canPlay() && this.linked(from, i)) ring = 'rgba(255,255,255,.38)';
      else if (this.hover === i && !d) ring = 'rgba(255,255,255,.5)';
      if (!ring) continue;
      const { x, y } = this.vn[i];
      const rx = this.R + 11;
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(x, y + 1, rx, rx * F + 2, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = ring;
      ctx.lineWidth = 2.6;
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -lt * 28;
      ctx.beginPath(); ctx.ellipse(x, y + 1, rx, rx * F + 2, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  topOf(i) {
    const s = this.side(this.owner[i]);
    return baseInfo(s.f, s.sub, this.level[i], s.tc).top;
  }

  /** Directions of city i's roads in its compound's own frame (the compound is turned 45 degrees). */
  gatesOf(i) {
    const n = this.vn[i];
    return this.adj[i].map(j => Math.atan2((this.vn[j].y - n.y) / F, this.vn[j].x - n.x) - Math.PI / 4);
  }

  drawNode(ctx, i, lt) {
    const k = this.dpr * this.s;
    const x = Math.round(this.vn[i].x * k) / k, y = Math.round(this.vn[i].y * k) / k;
    const o = this.owner[i], lv = this.level[i];
    const s = this.side(o);
    const info = baseInfo(s.f, s.sub, lv, s.tc);
    if (this.g3) {
      // The compound is built per city: its wall has a gate wherever one of this city's roads crosses it.
      this.g3.add(`cmp|${i}${this.flip ? 'f' : ''}|${s.f}|${lv}|${s.tc.id}`, () => compoundModel(s.f, lv, s.tc, this.gatesOf(i)), x, y, 0, Math.PI / 4, 1);
      this.g3.add(`b|${s.f}|${s.sub}|${lv}|${s.tc.id}`, () => info.model, x, y, BASE_LIFT, Math.PI / 4, BS);
    } else drawSprite(ctx, baseSprite(this.sprites, s.f, s.sub, lv, s.tc), x, y);
    if (o >= 0) drawBaseLive(ctx, info, s.tc, x, y, lt, i * 1.9);

    if (this.st.shield[i]) {                            // defense network shield: a hex-banded dome
      const pulse = 0.5 + 0.5 * Math.sin(lt * 4 + i);
      if (this.q.glow) ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#c9f1ff';
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.5 + 0.3 * pulse;
      ctx.beginPath(); ctx.ellipse(x, y - 4, 44, 40, 0, Math.PI, TAU); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y - 4, 44, 24, 0, 0, Math.PI); ctx.stroke();
      ctx.globalAlpha = 0.25;
      for (const r of [0.4, 0.75]) { ctx.beginPath(); ctx.ellipse(x, y - 4, 44, 40 * r, 0, Math.PI, TAU); ctx.stroke(); }
      ctx.fillStyle = '#9fe8ff';
      ctx.globalAlpha = 0.07 + 0.05 * pulse;
      ctx.beginPath(); ctx.ellipse(x, y - 4, 44, 40, 0, Math.PI, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    const heat = this.heat[i];                          // under fire: smoke and flames
    if (heat > 0.04) {
      for (let j = 0; j < 4; j++) {
        const ph = (lt * 0.7 + j * 0.25 + i * 0.13) % 1;
        const bx = x + ((j * 37 + i * 11) % 23) - 11, by = y - info.top * (0.3 + (j % 3) * 0.2);
        ctx.globalAlpha = heat * (1 - ph) * 0.7;
        ctx.fillStyle = '#23201d';
        ctx.beginPath(); ctx.arc(bx + ph * 7, by - ph * 22, 3 + ph * 7, 0, TAU); ctx.fill();
        if (j < 2) {
          ctx.globalAlpha = heat * (0.6 + 0.4 * Math.sin(lt * 23 + j * 2));
          ctx.fillStyle = j ? '#ffd27a' : '#f0792a';
          ctx.beginPath(); ctx.arc(bx, by + 2, 2.6 + heat * 2.4, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * City plate. Top line: soldiers present / production threshold (the
   * threshold only pauses production; a garrison may be larger). Bottom line:
   * combat power, marked with a diamond so it is never read as a head count.
   */
  drawPlate(ctx, i, lt) {
    const { x, y } = this.vn[i];
    const o = this.owner[i], lv = this.level[i], u = this.shown(i);
    const col = this.color(o);
    const L = this.levels[lv];
    const full = o >= 0 && u >= L.threshold;

    const a = fmt(u), b = `/${fmt(L.threshold)}`, pw = fmt(this.st.power[i]);
    ctx.textBaseline = 'middle';
    ctx.font = `700 14px ${FONT}`;
    const wa = ctx.measureText(a).width;
    ctx.font = `600 10px ${FONT}`;
    const wb = o >= 0 ? ctx.measureText(b).width : 0, wp = ctx.measureText(pw).width + 9;
    const tw = Math.max(34, wa + wb + 14, wp + 14);
    const py = y + this.R * F + 18;
    ctx.fillStyle = 'rgba(10,12,13,.92)';
    ctx.beginPath(); ctx.roundRect(x - tw / 2, py - 15, tw, 30, 3); ctx.fill();
    ctx.strokeStyle = col.main;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = col.main;
    ctx.fillRect(x - tw / 2, py - 15, 3.5, 30);

    const left = x + 1.5 - (wa + wb) / 2;
    ctx.textAlign = 'left';
    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = full ? '#ffd166' : '#ffffff';
    ctx.fillText(a, left, py - 6.5);
    if (o >= 0) {
      ctx.font = `600 10px ${FONT}`;
      ctx.fillStyle = '#8d9892';
      ctx.fillText(b, left + wa, py - 5.5);
    }
    // power: diamond + number
    const pl = x + 1.5 - wp / 2;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath(); ctx.moveTo(pl + 3, py + 3.5); ctx.lineTo(pl + 6, py + 7); ctx.lineTo(pl + 3, py + 10.5); ctx.lineTo(pl, py + 7); ctx.closePath(); ctx.fill();
    ctx.font = `600 10px ${FONT}`;
    ctx.fillText(pw, pl + 9, py + 7.5);

    ctx.strokeStyle = '#ffd166';                        // rank chevrons = city level
    ctx.lineWidth = 1.8;
    for (let j = 0; j < lv; j++) {
      const cx = x + tw / 2 + 7, cy = py + 10 - j * 5;
      ctx.beginPath(); ctx.moveTo(cx - 4, cy); ctx.lineTo(cx, cy - 3.4); ctx.lineTo(cx + 4, cy); ctx.stroke();
    }

    if (o === this.me && lv < 3 && u >= L.upCost && this.winner === null) {
      const bx = x - 34, by = y - this.topOf(i) + 4 + Math.sin(lt * 5 + i) * 2;
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = '#14171a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by - 8); ctx.lineTo(bx + 8, by); ctx.lineTo(bx + 3.5, by); ctx.lineTo(bx + 3.5, by + 7);
      ctx.lineTo(bx - 3.5, by + 7); ctx.lineTo(bx - 3.5, by); ctx.lineTo(bx - 8, by);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  /** Army plates: soldiers, power, and a pip for each active effect. */
  drawArmyPlates(ctx) {
    const PIPS = [[1, '#9fe8ff'], [2, '#cfd6da'], [4, '#ff9a3c'], [8, '#5aa0ff'], [16, '#b77dff']];
    for (const a of this.st.armies.values()) {
      if (a.hx == null || (a.st !== 2 && a.sn < 14)) continue;
      const col = this.color(a.o);
      const A = this.vn[a.from], Z = this.vn[a.to];
      const x = a.st === 2 ? Z.x + Math.cos(Math.atan2(A.y - Z.y, A.x - Z.x)) * 74 : a.hx;
      const y = (a.st === 2 ? Z.y + Math.sin(Math.atan2(A.y - Z.y, A.x - Z.x)) * 58 : a.hy) - 30;
      const n = fmt(a.n), pw = fmt(a.pow);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `700 12px ${FONT}`;
      const wn = ctx.measureText(n).width;
      ctx.font = `600 10px ${FONT}`;
      const wp = ctx.measureText(pw).width;
      const w = wn + wp + 24;
      ctx.fillStyle = 'rgba(10,12,13,.88)';
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - 8, w, 16, 3); ctx.fill();
      ctx.fillStyle = col.main;
      ctx.fillRect(x - w / 2, y - 8, 3, 16);
      if (a.st === 1) { ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 8, w, 16, 3); ctx.stroke(); }
      else if (a.fl & 64) {                             // halted, waiting for a route: dashed amber frame
        ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.roundRect(x - w / 2, y - 8, w, 16, 3); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.font = `700 12px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(n, x - w / 2 + 7, y + 0.5);
      const pl = x - w / 2 + 11 + wn;
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.moveTo(pl + 3, y - 3.5); ctx.lineTo(pl + 6, y); ctx.lineTo(pl + 3, y + 3.5); ctx.lineTo(pl, y); ctx.closePath(); ctx.fill();
      ctx.font = `600 10px ${FONT}`;
      ctx.fillText(pw, pl + 8, y + 0.5);
      let px = x - w / 2 + 3;
      for (const [bit, c] of PIPS) {
        if (!(a.fl & bit)) continue;
        ctx.fillStyle = c;
        if (bit >= 8) ctx.fillRect(px, y + 10, 5, 3); else { ctx.beginPath(); ctx.moveTo(px, y + 13); ctx.lineTo(px + 2.5, y + 9.5); ctx.lineTo(px + 5, y + 13); ctx.closePath(); ctx.fill(); }
        px += 7;
      }
    }
  }

  /**
   * Effects, in two layers: what lies on the ground (warnings, scorch, hazard zones)
   * goes under the troops, everything else over them.
   */
  drawFx(ctx, lt, ground = false) {
    const R = this.R;
    const st = this.frozenT !== null ? this.frozenT : this.serverNow();
    const age = f => (f.sim ? st : lt) - f.t0;                // gameplay effects run on simulation time
    if (ground) this.fx = this.fx.filter(f => age(f) < f.dur);
    const opts = { fx: this.settings.effects !== false, flash: this.settings.flash !== false };
    for (const f of this.fx) {
      if (GROUND_TYPES.has(f.type) !== ground) continue;
      const p = age(f) / f.dur;
      if (p < 0 || p >= 1) continue;
      if (SUPER_TYPES.has(f.type)) { drawSuper(ctx, f, p, f.sim ? st : lt, opts); continue; }
      if (f.node == null) {
        const glow = this.q.glow && GLOWS.has(f.type);
        if (glow) ctx.globalCompositeOperation = 'lighter';
        drawEffect(ctx, f, p, lt);
        if (glow) ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      const n = this.vn[f.node];
      if (f.type === 'ring') {
        const r = R + 6 + p * f.reach;
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = f.col;
        ctx.lineWidth = 1 + 4 * (1 - p);
        ctx.beginPath(); ctx.ellipse(n.x, n.y, r, r * F, 0, 0, TAU); ctx.stroke();
      } else if (f.type === 'cap') {
        const r = R + 4 + p * 52;
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.strokeStyle = f.col;
        ctx.lineWidth = 1.5 + 5 * (1 - p);
        ctx.beginPath(); ctx.ellipse(n.x, n.y, r, r * F, 0, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (p < 0.6) boom(ctx, n.x, n.y - 14, p / 0.6, 17);
        for (let j = 0; j < 9; j++) {
          const h = hash(f.seed + j * 97);
          const a = (h & 255) / 255 * TAU, sp = 26 + ((h >> 8) & 31);
          const dx = Math.cos(a) * sp * p, dy = Math.sin(a) * sp * p * F - Math.sin(p * Math.PI) * (20 + ((h >> 13) & 15));
          ctx.globalAlpha = 1 - p;
          ctx.fillStyle = j % 3 ? '#2b2824' : '#f0a23a';
          ctx.fillRect(n.x + dx - 1.5, n.y - 10 + dy - 1.5, 3, 3);
        }
      } else if (f.type === 'up') {
        const r = R + 4 + p * 30;
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(n.x, n.y, r, r * F, 0, 0, TAU); ctx.stroke();
        for (let j = 0; j < 3; j++) {
          const cy = n.y - 30 - p * 36 - j * 9;
          ctx.beginPath(); ctx.moveTo(n.x - 9, cy + 5); ctx.lineTo(n.x, cy - 3); ctx.lineTo(n.x + 9, cy + 5); ctx.stroke();
        }
        const tick = Math.floor(lt * 18);
        for (let j = 0; j < 3; j++) {
          const h = hash(tick * 31 + j * 7 + f.node);
          ctx.fillStyle = '#fff6d0';
          ctx.beginPath(); ctx.arc(n.x + ((h & 31) - 15), n.y - 6 - ((h >> 5) & 31), 1.6, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  /** One animated arrow, dark underlay first so it reads on any ground. */
  arrow(ctx, x0, y0, x1, y1, w, color, lt, head = 1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 6) return;
    const ux = dx / len, uy = dy / len;
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = w + 4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -lt * 60;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.setLineDash([]);
    const a = 10 * head, b = 8 * head, c = 9 * head;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1 + ux * a, y1 + uy * a);
    ctx.lineTo(x1 - ux * b - uy * c, y1 - uy * b + ux * c);
    ctx.lineTo(x1 - ux * b + uy * c, y1 - uy * b - ux * c);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  /** A red cross: this city is not taking part. */
  cross(ctx, x, y, r = 7) {
    ctx.fillStyle = 'rgba(10,12,13,.9)';
    ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ff5a4d';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - r * 0.6, y - r * 0.6); ctx.lineTo(x + r * 0.6, y + r * 0.6); ctx.moveTo(x + r * 0.6, y - r * 0.6); ctx.lineTo(x - r * 0.6, y + r * 0.6); ctx.stroke();
  }

  /**
   * Order preview. With a destination under the pointer every selected city
   * shows the whole route it would march, road by road through the cities in
   * between; roads shared by several routes are drawn once, thicker. Cities
   * that cannot take part are crossed out. The badge gives how many cities
   * march and how many soldiers leave.
   */
  drawDrag(ctx, lt) {
    const d = this.drag;
    if (!d || !d.moved) return;
    const col = this.color(this.me);
    d.via = null;

    if (d.mode === 'chain') {
      // Continuous chain preview: a -> b -> c -> ...
      const chain = d.chain;
      d.via = new Set(chain);
      for (let i = 0; i + 1 < chain.length; i++) {
        const u = chain[i], v = chain[i + 1];
        const r = this.routeTo(u, v);
        if (r && r.path.length >= 2) {
          for (let j = 0; j + 1 < r.path.length; j++) {
            const A = this.vn[r.path[j]], Z = this.vn[r.path[j + 1]];
            const len = Math.hypot(Z.x - A.x, Z.y - A.y) || 1;
            const ux = (Z.x - A.x) / len, uy = (Z.y - A.y) / len;
            const isEnd = i + 2 === chain.length && j + 2 === r.path.length;
            this.arrow(ctx, A.x + ux * (this.R + 6), A.y + uy * (this.R + 6), Z.x - ux * (this.R + 12), Z.y - uy * (this.R + 12),
              5, isEnd ? '#ffffff' : col.light, lt, isEnd ? 1.2 : 0.95);
          }
        } else {
          const A = this.vn[u], Z = this.vn[v];
          ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 2.6; ctx.setLineDash([5, 7]);
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(Z.x, Z.y); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      if (chain.length >= 2) {
        for (let i = 0; i < chain.length; i++) {
          const n = this.vn[chain[i]];
          ctx.fillStyle = 'rgba(10,12,13,.92)';
          ctx.beginPath(); ctx.arc(n.x - 24, n.y - this.topOf(chain[i]) - 6, 9, 0, TAU); ctx.fill();
          ctx.strokeStyle = i === chain.length - 1 ? '#ffffff' : col.light;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.font = `700 11px ${FONT}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
          ctx.fillText(String(i + 1), n.x - 24, n.y - this.topOf(chain[i]) - 5.5);
        }
      }
      const tail = chain[chain.length - 1];
      const tailNode = this.vn[tail];
      if (this.owner[tail] === this.me && this.nodeAt({ x: d.px, y: d.py }) !== tail) {
        const len = Math.hypot(d.px - tailNode.x, d.py - tailNode.y);
        if (len >= this.R + 10) {
          const ux = (d.px - tailNode.x) / len, uy = (d.py - tailNode.y) / len;
          this.arrow(ctx, tailNode.x + ux * (this.R + 6), tailNode.y + uy * (this.R + 6), d.px, d.py, 4, col.light, lt);
        }
      }
      if (chain.length >= 2) {
        const by = tailNode.y - this.topOf(tail) - 18;
        if (chain.length > 2) {
          this.badge(ctx, tailNode.x, by, t('game.chainBadge', { count: chain.length, hops: chain.length - 1 }), '#1f6f8f');
        } else if (this.autoMode) {
          this.badge(ctx, tailNode.x, by, t('game.auto.badge', { count: 1 }), '#1f6f8f');
        } else {
          this.badge(ctx, tailNode.x, by, t('game.orderBadge', { count: 1, troops: this.dispatchCount(chain[0]) }), col.main);
        }
      }
      return;
    }

    if (d.target < 0) {                                  // no destination yet: plain arrows to the pointer
      let total = 0;
      for (const s of d.sources) {
        if (this.owner[s] !== this.me) continue;
        const n = this.vn[s];
        const len = Math.hypot(d.px - n.x, d.py - n.y);
        if (len < this.R + 10) continue;
        const ux = (d.px - n.x) / len, uy = (d.py - n.y) / len;
        this.arrow(ctx, n.x + ux * (this.R + 6), n.y + uy * (this.R + 6), d.px, d.py, 4, col.light, lt);
        total += this.dispatchCount(s);
      }
      if (total > 0) this.badge(ctx, d.px, d.py - 32, fmt(total), col.main);
      return;
    }

    // Ownership can change while the pointer rests: plan again every frame.
    const plan = d.plan = this.plan([...d.sources], d.target);
    d.ok = plan.routes.length > 0;
    const tgt = this.vn[d.target];
    if (!d.ok) {
      const n = this.vn[d.start];
      ctx.strokeStyle = '#ff5a4d';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 9]);
      ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
      ctx.setLineDash([]);
      this.cross(ctx, (n.x + tgt.x) / 2, (n.y + tgt.y) / 2, 9);
    }

    // Every road used, with how many routes share it.
    const legs = new Map();
    d.via = new Set();
    for (const r of plan.routes) {
      for (let i = 0; i + 1 < r.path.length; i++) {
        const key = r.path[i] * 1000 + r.path[i + 1];
        legs.set(key, (legs.get(key) || 0) + 1);
        if (i > 0) d.via.add(r.path[i]);
      }
    }
    for (const [key, n] of legs) {
      const u = Math.floor(key / 1000), v = key % 1000;
      const A = this.vn[u], Z = this.vn[v];
      const len = Math.hypot(Z.x - A.x, Z.y - A.y) || 1;
      const ux = (Z.x - A.x) / len, uy = (Z.y - A.y) / len;
      const last = v === d.target;
      this.arrow(ctx, A.x + ux * (this.R + 6), A.y + uy * (this.R + 6), Z.x - ux * (this.R + 12), Z.y - uy * (this.R + 12),
        Math.min(8, 3.5 + n * 1.5), last ? '#ffffff' : col.light, lt, last ? 1.25 : 0.85);
    }
    for (const o of plan.out) {
      const n = this.vn[o.from];
      this.cross(ctx, n.x, n.y - this.topOf(o.from) - 14);
    }

    const by = tgt.y - this.topOf(d.target) - 16;
    if (this.autoMode) this.badge(ctx, tgt.x, by, t('game.auto.badge', { count: plan.routes.length + plan.out.length }), '#1f6f8f');
    else if (d.ok) this.badge(ctx, tgt.x, by, t('game.orderBadge', { count: plan.routes.length, troops: plan.total }), col.main);
    if (plan.out.length && !this.autoMode) this.badge(ctx, tgt.x, by - (d.ok ? 26 : 0), t('game.orderOut', { count: plan.out.length }), '#b3261e');
  }

  /** Live preview of optimal evenly-distributed rally/attack routes when picking targets. */
  drawRallyPreview(ctx, lt) {
    if (!this.rallyMode || !this.rallyTargets.size || !this.canPlay()) return;
    const targets = [...this.rallyTargets];
    const plan = this.rallyPlan(targets);
    const col = this.color(this.me);
    const legs = new Map();
    for (const r of plan.routes) {
      for (let i = 0; i + 1 < r.path.length; i++) {
        const key = r.path[i] * 1000 + r.path[i + 1];
        legs.set(key, (legs.get(key) || 0) + 1);
      }
    }
    for (const [key, n] of legs) {
      const u = Math.floor(key / 1000), v = key % 1000;
      const A = this.vn[u], Z = this.vn[v];
      const len = Math.hypot(Z.x - A.x, Z.y - A.y) || 1;
      const ux = (Z.x - A.x) / len, uy = (Z.y - A.y) / len;
      const isTgt = this.rallyTargets.has(v);
      const arrowCol = isTgt ? (this.owner[v] === this.me ? '#7fd0ff' : '#ff8a65') : col.light;
      this.arrow(ctx, A.x + ux * (this.R + 6), A.y + uy * (this.R + 6), Z.x - ux * (this.R + 12), Z.y - uy * (this.R + 12),
        Math.min(7.5, 3 + n * 1.2), arrowCol, lt, isTgt ? 1.2 : 0.85);
    }
    for (const id of targets) {
      const n = this.vn[id];
      const reach = plan.reachableTargets.includes(id);
      const isRally = this.owner[id] === this.me;
      const ringCol = !reach ? '#ff5a4d' : isRally ? '#6fd0f2' : '#ff6b4a';
      ctx.strokeStyle = ringCol;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(n.x, n.y + 1, this.R + 13, (this.R + 13) * F + 2, 0, 0, TAU); ctx.stroke();
      if (!reach) this.cross(ctx, n.x, n.y - this.topOf(id) - 14);
    }
    if (plan.routes.length) {
      const anchor = this.vn[plan.reachableTargets[0]];
      this.badge(ctx, anchor.x, anchor.y - this.topOf(plan.reachableTargets[0]) - 22,
        t('game.rallyBadge', { routes: plan.routes.length, targets: plan.reachableTargets.length }), '#1f6f8f');
    }
  }

  /**
   * Where my routed armies are going: a faint line along the roads still
   * ahead of each and a marker over the final destination, so a column
   * walking through three cities is never mistaken for one heading to the next.
   */
  drawMarchRoutes(ctx, lt) {
    if (this.me < 0) return;
    const col = this.color(this.me);
    const dests = new Set();
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 9]);
    ctx.lineDashOffset = -lt * 24;
    ctx.strokeStyle = col.light;
    ctx.globalAlpha = 0.55;
    for (const a of this.st.armies.values()) {
      if (a.o !== this.me || !a.path || !a.path.length || a.hx == null) continue;
      ctx.beginPath();
      ctx.moveTo(a.hx, a.hy);
      ctx.lineTo(this.vn[a.to].x, this.vn[a.to].y);
      for (const id of a.path) ctx.lineTo(this.vn[id].x, this.vn[id].y);
      ctx.stroke();
      dests.add(a.dest);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (const id of dests) {                            // a chevron pointing down at the destination
      const n = this.vn[id];
      const y = n.y - this.topOf(id) - 30 + Math.sin(lt * 4) * 2.5;
      ctx.fillStyle = col.light;
      ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(n.x - 8, y - 8); ctx.lineTo(n.x + 8, y - 8); ctx.lineTo(n.x, y + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  /**
   * My persistent orders on the ground: high-contrast directional lanes with dark
   * underlays, flowing chevrons, destination arrowheads and opposing-lane separation.
   */
  drawAutoRoutes(ctx, lt) {
    if (this.me < 0 || !this.autos.size) return;
    const col = this.color(this.me);
    const routes = this.autoRoutes();
    const move = this.paused ? 0 : lt * 34;

    // Track directed legs so opposite routes on the same road split into two side-by-side lanes.
    const directedLegs = new Set();
    for (const r of routes) {
      if (r.path && r.path.length >= 2) {
        for (let i = 0; i + 1 < r.path.length; i++) directedLegs.add(`${r.path[i]}|${r.path[i + 1]}`);
      } else {
        directedLegs.add(`${r.src}|${r.dest}`);
      }
    }

    const drawChevron = (x, y, ux, uy, size, color, alpha) => {
      const bx = x - ux * size, by = y - uy * size;
      const wx = -uy * size * 0.72, wy = ux * size * 0.72;
      ctx.globalAlpha = Math.min(1, alpha * 0.9);
      ctx.strokeStyle = 'rgba(8,10,12,.78)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(bx + wx, by + wy); ctx.lineTo(x, y); ctx.lineTo(bx - wx, by - wy);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(bx + wx, by + wy); ctx.lineTo(x, y); ctx.lineTo(bx - wx, by - wy);
      ctx.stroke();
    };

    const drawHead = (x, y, ux, uy, size, color, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(8,10,12,.82)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + ux * size * 0.55, y + uy * size * 0.55);
      ctx.lineTo(x - ux * size * 0.75 - uy * size * 0.65, y - uy * size * 0.75 + ux * size * 0.65);
      ctx.lineTo(x - ux * size * 0.75 + uy * size * 0.65, y - uy * size * 0.75 - ux * size * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    const drawLeg = (u, v, color, alpha, hot, isFinal) => {
      const A = this.vn[u], B = this.vn[v];
      if (!A || !B) return;
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
      if (len < 12) return;
      const ux = dx / len, uy = dy / len;
      const opp = directedLegs.has(`${v}|${u}`);
      const off = opp ? 4.5 : 0;
      const ox = -uy * off, oy = ux * off;
      const start = Math.min(len * 0.25, this.R + 8);
      const end = Math.max(start + 8, len - (isFinal ? this.R + 13 : this.R + 8));
      const x0 = A.x + ux * start + ox, y0 = A.y + uy * start + oy;
      const x1 = A.x + ux * end + ox, y1 = A.y + uy * end + oy;

      // Dark casing so the route reads cleanly on any terrain or road surface.
      ctx.setLineDash([]);
      ctx.globalAlpha = alpha * 0.68;
      ctx.strokeStyle = 'rgba(8,10,12,.85)';
      ctx.lineWidth = hot ? 5.8 : 4.4;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();

      // Animated dashed core.
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = hot ? 3.2 : 2.3;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -move;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.setLineDash([]);

      // Flowing directional chevrons along the leg.
      const step = 52;
      const phase = ((move % step) + step) % step;
      for (let d = start + phase; d < end - 14; d += step) {
        if (d < start + 10) continue;
        drawChevron(A.x + ux * d + ox, A.y + uy * d + oy, ux, uy, hot ? 6.5 : 5.5, hot ? '#ffffff' : color, Math.min(1, alpha + 0.12));
      }

      // Solid arrowhead at the end of the final leg pointing directly into the destination.
      if (isFinal) {
        drawHead(x1, y1, ux, uy, hot ? 10.5 : 9, hot ? '#ffffff' : color, Math.min(1, alpha + 0.12));
      }
    };

    const dests = new Set();
    const legs = new Map();
    const addLeg = (u, v, blocked, state, isFinal) => {
      const key = `${u}|${v}`;
      const prev = legs.get(key);
      if (!prev) legs.set(key, { key, u, v, blocked, state, isFinal });
      else {
        if (!blocked) prev.blocked = false;
        if (state === 0) prev.state = 0;
        if (isFinal) prev.isFinal = true;
      }
    };
    for (const r of routes) {
      if (!r.path || r.path.length < 2) {
        addLeg(r.src, r.dest, true, r.state, true);
      } else {
        for (let i = 0; i + 1 < r.path.length; i++) {
          addLeg(r.path[i], r.path[i + 1], false, r.state, i + 2 === r.path.length);
        }
      }
      dests.add(r.dest);
    }
    for (const leg of legs.values()) {
      const hot = this.hoverCancel === leg.key;
      const color = hot ? '#ff5a4d' : leg.blocked ? '#ffb347' : col.light;
      const alpha = hot ? 0.98 : leg.blocked ? 0.55 : (leg.state === 0 ? 0.86 : 0.48);
      drawLeg(leg.u, leg.v, color, alpha, hot, leg.isFinal);
    }

    ctx.setLineDash([]);
    for (const id of dests) {
      const n = this.vn[id];
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(8,10,12,.85)';
      ctx.lineWidth = 4.2;
      ctx.beginPath(); ctx.ellipse(n.x, n.y, this.R + 6, (this.R + 6) * F, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.88;
      ctx.strokeStyle = col.light;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(n.x, n.y, this.R + 6, (this.R + 6) * F, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A badge on every city of mine with one or more persistent orders.
   *   0 active   1 waiting for troops   2 no route   3 under attack   (paused: the whole match)
   */
  drawAutoBadges(ctx, lt) {
    if (this.me < 0 || !this.autos.size) return;
    const col = this.color(this.me);
    const bySrc = new Map();
    for (const o of this.autos.values()) {
      if (this.owner[o.src] !== this.me) continue;
      let g = bySrc.get(o.src);
      if (!g) bySrc.set(o.src, g = { count: 0, state: o.state });
      g.count++;
      if (o.state === 0 || g.state > o.state) g.state = Math.min(g.state, o.state);
    }
    for (const [src, info] of bySrc) {
      const n = this.vn[src];
      const x = n.x + 30, y = n.y - this.topOf(src) - 4;
      const state = this.paused ? 4 : info.state;
      const ring = ['#ffffff', '#9aa3ab', '#ffb347', '#ff5a4d', '#ffffff'][state];
      ctx.fillStyle = 'rgba(10,12,13,.9)';
      ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = state === 0 ? col.light : ring;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.stroke();
      ctx.strokeStyle = ctx.fillStyle = ring;
      ctx.lineWidth = 1.8;
      if (state === 4) {                                 // paused
        ctx.fillRect(x - 3.5, y - 4, 2.4, 8); ctx.fillRect(x + 1.1, y - 4, 2.4, 8);
      } else if (state === 2) {                          // no route: a broken line
        ctx.beginPath(); ctx.moveTo(x - 5, y + 2); ctx.lineTo(x - 1.5, y + 2); ctx.moveTo(x + 1.5, y - 2); ctx.lineTo(x + 5, y - 2); ctx.stroke();
      } else if (state === 3) {                          // under attack
        ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 1.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y + 4.4, 1.1, 0, TAU); ctx.fill();
      } else {                                           // a turning arrow; still when it has nobody to send
        const a0 = state === 0 ? lt * 2.2 : 0.6;
        ctx.beginPath(); ctx.arc(x, y, 4.6, a0, a0 + TAU * 0.72); ctx.stroke();
        const a1 = a0 + TAU * 0.72, hx = x + Math.cos(a1) * 4.6, hy = y + Math.sin(a1) * 4.6;
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(a1 + 1.9) * 3.4, hy + Math.sin(a1 + 1.9) * 3.4);
        ctx.lineTo(hx + Math.cos(a1 + 0.2) * 3.6, hy + Math.sin(a1 + 0.2) * 3.6);
        ctx.lineTo(hx + Math.cos(a1 - 1.3) * 3.4, hy + Math.sin(a1 - 1.3) * 3.4);
        ctx.closePath(); ctx.fill();
      }
      if (info.count > 1) {
        ctx.fillStyle = '#1f6f8f';
        ctx.beginPath(); ctx.arc(x + 8, y - 7, 6, 0, TAU); ctx.fill();
        ctx.font = `700 9px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
        ctx.fillText(String(info.count), x + 8, y - 6.5);
      }
    }
  }

  /** A clickable "×" button on every active auto-dispatch route to cancel it. */
  drawAutoCancels(ctx) {
    if (!this.canPlay() || !this.autos.size) return;
    for (const pt of this.autoCancelPoints()) {
      const hot = this.hoverCancel === pt.key;
      const r = hot ? 10 : 8.5;
      ctx.fillStyle = hot ? 'rgba(195,42,34,.95)' : 'rgba(10,12,13,.9)';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = hot ? '#ffffff' : '#ff5a4d';
      ctx.lineWidth = hot ? 2 : 1.6;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, TAU); ctx.stroke();
      const s = r * 0.42;
      ctx.strokeStyle = hot ? '#ffffff' : '#ff8a80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pt.x - s, pt.y - s); ctx.lineTo(pt.x + s, pt.y + s);
      ctx.moveTo(pt.x + s, pt.y - s); ctx.lineTo(pt.x - s, pt.y + s);
      ctx.stroke();
    }
  }

  /** Cities the server left out of my last order, crossed out for a moment. */
  drawRejects(ctx, lt) {
    if (!this.rejects.size) return;
    for (const [i, r] of this.rejects) {
      const age = lt - r.t0;
      if (age > REJECT_SHOW) { this.rejects.delete(i); continue; }
      const n = this.vn[i];
      ctx.globalAlpha = Math.min(1, (REJECT_SHOW - age) * 2);
      this.cross(ctx, n.x, n.y - this.topOf(i) - 14);
    }
    ctx.globalAlpha = 1;
  }

  badge(ctx, x, y, txt, fill) {
    ctx.font = `800 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(txt).width + 16;
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 11, w, 22, 3); ctx.fill();
    ctx.strokeStyle = '#0d0f11';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(txt, x, y + 0.5);
  }

  /** Skill targeting preview: area, eligible targets, or the phase-dispatch route with its exact count. */
  drawTargeting(ctx, lt) {
    const T = this.targeting, p = this.ptr;
    if (!T || !p) return;
    const col = SKILL_COLOR[T.def.id];
    if (T.def.target === 'point') {
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.12;
      ctx.beginPath(); ctx.arc(p.x, p.y, T.def.radius, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -lt * 30;
      ctx.beginPath(); ctx.arc(p.x, p.y, T.def.radius, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y); ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y + 8); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (T.def.target === 'army') {
      const pick = this.armyAt(p);
      for (const a of this.st.armies.values()) {
        if (a.o === this.me || a.st === 2 || a.hx == null) continue;
        ctx.strokeStyle = a === pick ? '#ffffff' : col;
        ctx.lineWidth = a === pick ? 2.6 : 1.4;
        ctx.globalAlpha = a === pick ? 1 : 0.7;
        ctx.beginPath(); ctx.ellipse(a.hx, a.hy, 18, 10, 0, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (T.def.target === 'cityPair' && T.src >= 0) {
      const a = this.vn[T.src], h = this.hover;
      const b = h >= 0 && h !== T.src ? this.vn[h] : p;
      drawChronoLink(ctx, a, b, lt, b !== p);              // both cities marked, linked through the air: not a road
      if (h >= 0 && h !== T.src) {
        const attack = this.owner[h] !== this.me;
        this.badge(ctx, b.x, b.y - this.topOf(h) - 16, `${fmt(this.phaseCount(T.src))} · ${t(attack ? 'skills.attack' : 'skills.reinforceLabel')}`, attack ? '#c8322f' : '#2f7fe8');
      }
    }
  }

  // ------------------------------------------------------------ DOM overlays

  buildingName(o, lv) {
    return o >= 0 ? t(`factions.${this.sides[o].f}.buildings.${lv}`) : t(`levels.${lv}.name`);
  }

  placeUpgrade() {
    const b = this.els.upgrade;
    const i = this.sel;
    if (i < 0 || this.owner[i] !== this.me || !this.canPlay() || this.drag || this.targeting) {
      b.classList.add('hidden');
      return;
    }
    const lv = this.level[i];
    const n = this.vn[i];
    let label, off;
    if (lv >= 3) {
      label = t('game.maxLevel', { name: this.buildingName(this.me, lv) });
      off = true;
    } else {
      const cost = this.levels[lv].upCost;
      label = t('game.upgradeTo', { name: this.buildingName(this.me, lv + 1), cost });
      off = this.shown(i) < cost;
    }
    if (this.upLabel !== label) { this.upLabel = label; b.lastElementChild.textContent = label; }
    b.disabled = off;
    b.classList.toggle('max', lv >= 3);
    b.classList.remove('hidden');
    const half = b.offsetWidth / 2 + 6;
    const sx = this.ox + n.x * this.s;
    const sy = this.oy + (n.y - this.topOf(i) - 18) * this.s;
    b.style.left = `${Math.max(half, Math.min(this.cv.clientWidth - half, sx))}px`;
    b.style.top = `${Math.max(88, sy)}px`;
  }

  /** Floating rally/attack quick buttons shown when hovering over any building. */
  placeCityActions() {
    const box = this.els.cityActions;
    if (!box) return;
    if (!this.canPlay() || this.drag || this.targeting || this.hoverCancel || this.rallyMode) {
      box.classList.add('hidden');
      this.cityActTarget = -1;
      this.cityActSig = '';
      return;
    }
    const now = performance.now();
    let i = this.hover;
    if (i < 0 && (this.hoverMenu || now < this.hoverKeepUntil) && this.hoverCity >= 0 && this.hoverCity < this.N) {
      i = this.hoverCity;
    }
    if (i < 0) {
      box.classList.add('hidden');
      this.cityActTarget = -1;
      this.cityActSig = '';
      return;
    }
    this.cityActTarget = i;
    const friendly = this.owner[i] === this.me;
    const canRemove = this.activeTargets.has(i) && this.activeTargets.size > 1;
    const sig = `${i}|${friendly ? 1 : 0}|${canRemove ? 1 : 0}|${getLang()}`;
    if (sig !== this.cityActSig) {
      this.cityActSig = sig;
      const onlyBtn = box.querySelector('#ca-only');
      const addBtn = box.querySelector('#ca-add');
      if (onlyBtn) {
        onlyBtn.textContent = t(friendly ? 'hud.rallyOnly' : 'hud.attackOnly');
        onlyBtn.className = `btn tiny ${friendly ? 'rally' : 'attack'}`;
      }
      if (addBtn) {
        addBtn.textContent = t(canRemove ? 'hud.targetRemove' : (friendly ? 'hud.rallyAdd' : 'hud.attackAdd'));
        addBtn.className = `btn tiny ${canRemove ? 'remove' : (friendly ? 'extra' : 'extra attack')}`;
      }
    }
    box.classList.remove('hidden');
    const n = this.vn[i];
    const half = box.offsetWidth / 2 + 6;
    const sx = this.ox + n.x * this.s;
    const upShown = !this.els.upgrade.classList.contains('hidden') && this.sel === i;
    const sy = this.oy + (n.y - this.topOf(i) - 18) * this.s - (upShown ? 38 : 0);
    box.style.left = `${Math.max(half, Math.min(this.cv.clientWidth - half, sx))}px`;
    box.style.top = `${Math.max(88, sy)}px`;
  }

  /** Details card for the selected (or hovered) city. */
  updateInfo() {
    const el = this.els.info;
    const i = this.sel >= 0 ? this.sel : this.hover;
    if (i < 0 || this.drag || this.targeting) {
      if (this.infoSig) { el.classList.add('hidden'); this.infoSig = ''; }
      return;
    }
    const o = this.owner[i], lv = this.level[i];
    const aus = o === this.me ? this.autosFrom(i) : [];
    const auSig = aus.map(a => `${a.dest},${a.pct},${this.paused ? 4 : a.state}`).join(';');
    const sig = `${i}|${o}|${lv}|${this.units[i]}|${this.st.power[i]}|${getLang()}|${auSig}`;
    if (sig === this.infoSig) return;
    this.infoSig = sig;
    const L = this.levels[lv];
    const mk = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    el.textContent = '';
    el.style.setProperty('--c', this.color(o).main);
    el.classList.toggle('right', this.ox + this.vn[i].x * this.s < this.cv.clientWidth / 2);
    const head = mk('div', 'info-head');
    head.append(mk('strong', '', this.buildingName(o, lv)), mk('span', 'info-lv', t('info.level', { n: lv })));
    const stats = mk('div', 'info-stats');
    const add = (text, cls) => stats.append(mk('span', cls || '', text));
    add(t('info.garrison', { n: this.units[i], threshold: L.threshold }));
    add(t('info.power', { n: this.st.power[i] }), 'pwr');
    el.append(head, mk('div', 'info-owner', o >= 0 ? this.pname(o) : t('info.neutral')));
    if (o >= 0) {
      const s = this.sides[o], F0 = this.cfg.factions[s.f], T = this.cfg.tiers[lv];
      const fac = mk('div', 'info-fac');
      const img = mk('img');
      img.src = insigniaURL(s.f, s.sub, s.tc);
      img.alt = '';
      fac.append(img, mk('span', '', t('info.faction', { faction: t(`factions.${s.f}.name`), sub: t(`factions.${s.f}.subs.${s.sub}.name`) })));
      el.append(fac, mk('div', 'info-unit', t('info.trains', { unit: t(`factions.${s.f}.units.${lv}.name`), weapon: t(`weapons.${weaponOf(s.f, s.sub, lv)}`) })));
      add(t('info.production', { rate: +(L.prod * F0.prod).toFixed(2) }));
      add(t('info.unitStats', { hp: Math.round(F0.hp * T.hp), atk: +(F0.atk * T.atk).toFixed(1), armor: F0.armor + T.armor }));
      if (lv >= 2) el.append(mk('p', 'info-desc', t(`abilities.${s.f}.${lv}`)));
      el.append(mk('p', 'info-note', t(this.units[i] >= L.threshold ? 'info.paused' : 'info.producing')));
    } else {
      el.append(mk('p', 'info-desc', t(`levels.${lv}.desc`)), mk('p', 'info-note', t('info.idle')));
    }
    for (const au of aus) el.append(mk('p', 'info-auto', t('game.auto.info', { pct: Math.round(au.pct * 100), state: t(`game.auto.state.${this.paused ? 4 : au.state}`) })));
    el.append(stats);
    el.classList.remove('hidden');
  }

  buildHud() {
    const hud = this.els.hud;
    hud.textContent = '';
    this.chips = this.players.map((p, i) => {
      const s = this.sides[i];
      const c = document.createElement('div');
      c.className = 'chip' + (i === this.me ? ' me' : '');
      c.style.setProperty('--c', s.tc.main);
      const ico = document.createElement('img');
      ico.className = 'chip-ico';
      ico.src = insigniaURL(s.f, s.sub, s.tc);
      ico.alt = '';
      ico.title = `${t(`factions.${s.f}.name`)} · ${t(`factions.${s.f}.subs.${s.sub}.name`)}`;
      const text = document.createElement('div');
      text.className = 'chip-text';
      const name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent = i === this.me ? t('hud.you', { name: this.pname(i) }) : this.pname(i);
      const stat = document.createElement('span');
      stat.className = 'chip-stat';
      text.append(name, stat);
      c.append(ico, text);
      hud.append(c);
      return { c, stat, text: '' };
    });
    this.updateHud();
  }

  updateHud() {
    const n = this.players.length;
    const bases = new Array(n).fill(0), army = new Array(n).fill(0), power = new Array(n).fill(0);
    for (let i = 0; i < this.N; i++) {
      const o = this.owner[i];
      if (o >= 0) { bases[o]++; army[o] += this.units[i]; power[o] += this.st.power[i]; }
    }
    for (const a of this.st.armies.values()) { army[a.o] += a.n; power[a.o] += a.pow; }
    this.chips.forEach((ch, p) => {
      const dead = !this.alive[p];
      const text = dead ? t('hud.out') : `${t('hud.bases', { count: bases[p] })} · ${t('hud.army', { n: army[p] })} · ${t('hud.power', { n: power[p] })}`;
      if (text !== ch.text) { ch.text = text; ch.stat.textContent = text; }
      ch.c.classList.toggle('dead', dead);
    });
  }
}
