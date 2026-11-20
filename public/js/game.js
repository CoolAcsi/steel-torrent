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
  ruinSprite, scaffoldSprite, ruinModel, scaffoldModel, shieldDomeModel, emplacementModel, obstacleModel, portalModel, portalPose,
  figuresFor, FIGURES, hullPose, turnToward, idleTurret, walkFrame, buildPose, domePose, progressAt, clamp01,
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
import { planRoute } from './route.js';
import { FEAT_COLOR, empSpot, drawEmplacement, drawBarricade, drawMire, drawPortal, drawAegis, drawCancel } from './battlefield.js';
import { sfx } from './sfx.js';
import { t, fmt, getLang } from './i18n.js';

const TAU = Math.PI * 2;
const US = 0.64;                  // units are drawn at this scale, so a tank is small beside a building and fits its lane
const FOOT = 0.8;                 // infantry are drawn smaller again, so a soldier is not as tall as a tank
const ROW = [0, 5, 2, 2];         // figures per marching row, by tier
const GAP = [0, 9.5, 18, 22];     // distance between rows
const LANE = [0, 5.4, 12.5, 15];  // sideways spacing inside a row
const LOD_CLOSE = 2.6, LOD_FAR = 0.9;   // device pixels per model unit: above the first the close models are drawn, below the second the far ones
const LOD_CROWD = 260;            // more figures than this on screen and everything drops one detail level
const PREDICT_TTL = 1.5;          // seconds a predicted order may wait for the server
const REJECT_WHY = [null, 'notYours', 'noTroops', 'noRoute', null, null, 'full'];   // server codes, see REJECT in game/sim.js (4 = the destination itself: not worth a message)
const REJECT_SHOW = 2.6;          // seconds a left-out city stays marked
const WARN_TYPE = { nuke: 'nukeWarn', dominate: 'domWarn' };          // superweapon warnings have their own look
const HELD = 128, QUEUED = 256;   // army flags, see armyRec in game/proto.js: order cancelled and holding; waiting outside a full city
const ZOOM_MAX = 2.6;
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
    this._frame = this._frame.bind(this);

    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => { this.touches.delete(e.pointerId); this.pinch = null; this.pan = null; if (this.drag && this.drag.pid === e.pointerId) this.drag = null; });
    canvas.addEventListener('pointerleave', () => { this.hover = -1; this.ptr = null; this.routeHover = null; });
    canvas.addEventListener('wheel', e => { if (!this.map) return; e.preventDefault(); this.zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY); }, { passive: false });
    this.hasCamera = true;          // the view can zoom and pan (the tutorial's first lesson asks for both)
    this.touches = new Map();       // pointers currently down, for pinch zoom
    this.pinch = null;
    this.pan = null;
    this.cam = { z: 1, x: 0, y: 0 };
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.cancel(); });
    window.addEventListener('resize', () => this.resize());
    els.upgrade.addEventListener('click', () => { if (this.sel >= 0) this.hooks.upgrade(this.sel); });
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
    this.autos = new Map();         // my persistent orders: source city -> { dest, pct, state }
    this.autoMode = false;          // the next order sets a persistent route instead of sending once
    this.autoRev = 0;
    this.ownerRev = 0;
    this.autoPaths = null;
    this.featRev = 0;
    this.build = {};                // work shown on bases: upgrades going up, ruins being rebuilt
    this.selArmy = -1;              // one of my columns on the road, picked to halt or to send somewhere else
    this.routeHover = null;         // the cancel controls under the pointer
    this.guide = null;              // what the tutorial is pointing at
    this.cam = { z: 1, x: 0, y: 0 };
    this.setFeat(m.feat || []);
    this.fx = [];
    this.sel = -1;
    this.picked = new Set();        // cities chosen for a multi-city order
    this.hover = -1;
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
    this.els.upgrade.classList.add('hidden');
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

  /**
   * What stands on the map for a while, as the server lists it (Game.features in game/sim.js):
   * emplacements, obstacles, wormholes, Base Shields and rebuilds. Indexed here for drawing
   * and for planning routes the way the server does.
   */
  setFeat(list) {
    this.feat = list || [];
    this.featRev++;
    const B = this.featBy = { emp: new Map(), aegis: new Map(), rebuild: new Map(), worms: [], obst: [] };
    for (const f of this.feat) {
      if (f.k === 'turret' || f.k === 'slow' || f.k === 'psi') (B.emp.get(f.n) || B.emp.set(f.n, []).get(f.n)).push(f);
      else if (f.k === 'aegis') B.aegis.set(f.n, f);
      else if (f.k === 'rebuild') B.rebuild.set(f.n, f);
      else if (f.k === 'worm') B.worms.push(f);
      else B.obst.push(f);
    }
    if (this.map) this.syncBuild();
  }

  isRuin(i) { return (this.st.flags[i] & 1) === 1; }

  /**
   * Work shown on bases: a ruin being rebuilt follows the server's own timer exactly; an
   * upgrade, which takes effect at once, gets a short assembly sequence after the fact.
   * Neither ever delays or repeats anything in the match itself.
   */
  syncBuild() {
    const b = this.build || (this.build = {});
    const st = this.serverNow();
    for (const i in b) {
      const j = b[i];
      if (j.kind === 'rebuild' ? !this.featBy.rebuild.has(+i) && st >= j.t0 + j.dur : st >= j.t0 + j.dur) delete b[i];
    }
    for (const [i, f] of this.featBy.rebuild) b[i] = { kind: 'rebuild', t0: f.t0, dur: Math.max(0.1, f.u - f.t0) };
  }

  /** Most soldiers city i's garrison may hold (same rule as the server's capOf). */
  capOf(i) {
    if (this.isRuin(i)) return this.cfg.ruin.capacity;
    const L = this.levels[this.level[i]];
    return L.cap || L.threshold * this.cfg.capacity.mult;
  }

  /** My soldiers already marching to join city i: their places are reserved. */
  incoming(i) {
    let n = 0;
    for (const a of this.st.armies.values()) if (a.o === this.me && a.dest === i && !(a.fl & HELD)) n += a.n;
    for (const p of this.pending.values()) if (p.to === i) for (const k in p.out) n += p.out[k];
    return n;
  }

  /** Places still free in city i for my reinforcements. */
  roomAt(i) { return Math.max(0, this.capOf(i) - this.units[i] - this.incoming(i)); }

  /** How many bases seat p holds (ruins do not count). */
  basesOf(p) { let n = 0; for (let i = 0; i < this.N; i++) if (this.owner[i] === p && !this.isRuin(i)) n++; return n; }

  /** A skill as it applies to me: the faction's definition with my subfaction's adjustments. */
  skillDef(slot) {
    const s = this.sides[this.me], def = this.cfg.skills[s.f][slot];
    const v = def && this.cfg.skills.variants && this.cfg.skills.variants[s.sub] && this.cfg.skills.variants[s.sub][def.id];
    if (!v) return def;
    const out = { ...def };
    for (const k in v) out[k] = def[k] * v[k];
    return out;
  }

  /** My persistent orders, as the server holds them: [[source, destination, percent, state]]. */
  setAutos(list) {
    this.autos = new Map(list.map(([src, dest, pct, state]) => [src, { dest, pct: pct / 100, state }]));
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
    if (!sent) return this.hooks.notify(count('noRoute') ? 'noRoute' : count('full') ? 'full' : count('noTroops') ? 'noTroops' : 'noRoad');
    const why = ['noRoute', 'noTroops', 'full', 'notYours'].filter(count).map(w => t(`game.out.${w}`, { count: count(w) })).join(t('game.listSep'));
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
      surge: Math.max(0, r[5] / 10 - dt),
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
        if (e.mind) {                                    // taken by mind control: no assault, the garrison simply changes sides
          const n = this.vn[e.node], st = this.serverNow();
          this.fx.push({ type: 'dominion', x: n.x, y: n.y, r: 70, sim: true, t0: st, dur: 2.6, seed: e.node * 13 });
          this.fx.push({ type: 'halo', x: n.x, y: n.y - 20, col: this.color(e.by).light, sim: true, t0: st + 0.2, dur: 2.8 });
          this.flashScreen('200,150,255', 0.18, 0.4);
          this.light3d(n, '#b98cff', 3, 1.6);
          if (e.from === this.me || e.by === this.me) this.hooks.notify(e.by === this.me ? 'mind.won' : 'mind.lost');
        }
        break;
      case 'ruin':                                       // a base destroyed by a nuclear strike
        this.heat[e.node] = 0;
        if (this.sel === e.node) this.sel = -1;
        this.picked.delete(e.node);
        if (e.from === this.me) { sfx.lost(); this.hooks.notify('ruin.lost'); } else if (e.by === this.me) this.hooks.notify('ruin.made');
        break;
      case 'rebuild':
        if (e.p === this.me) sfx.upgrade();
        break;
      case 'rebuilt': {
        const n = this.vn[e.node];
        this.fx.push({ type: 'up', node: e.node, t0: now, dur: 1 });
        this.push({ type: 'text', x: n.x, y: n.y - 30, text: t('game.rebuilt'), col: '#ffd166', t0: now, dur: 1.8, size: 12 });
        if (e.p === this.me) sfx.upgrade();
        break;
      }
      case 'warp': {                                     // soldiers through a wormhole: out of one end, into the other, at once
        const a = this.vn[e.from], b = this.vn[e.to], st = this.serverNow();
        this.fx.push({ type: 'chrono', x: a.x - 66, y: a.y + 4, arrive: false, n: e.n, sim: true, t0: st, dur: 1.1, seed: e.from * 31 + 7 });
        this.fx.push({ type: 'chrono', x: b.x - 66, y: b.y + 4, arrive: true, n: e.n, sim: true, t0: st, dur: 1.1, seed: e.to * 31 + 11 });
        this.push({ type: 'text', x: b.x - 66, y: b.y - 30, text: fmt(e.n), col: '#c9f1ff', t0: now + 0.3, dur: 1.4 });
        break;
      }
      case 'broke': {
        const p = at(e.x, e.y);
        this.push({ type: 'clash', x: p.x, y: p.y, t0: now, dur: 0.6, seed: e.x * 3 + e.y });
        this.push({ type: 'text', x: p.x, y: p.y - 14, text: t('game.broke'), col: '#ffb347', t0: now, dur: 1.4, size: 12 });
        break;
      }
      case 'up':
        this.fx.push({ type: 'up', node: e.node, t0: now, dur: 1 });
        // The upgrade has already happened; the new works go up over the next couple of seconds of match time.
        (this.build || (this.build = {}))[e.node] = { kind: 'up', t0: this.serverNow(), dur: 2.2, from: e.level - 1, to: e.level };
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
        // From the base's own turret or coil, or from an emplacement standing at one of its corners.
        const n = e.emp != null ? empSpot(this.vn[e.node].x, this.vn[e.node].y, e.emp) : this.vn[e.node], top = e.emp != null ? 18 : this.topOf(e.node);
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
    if (e.delay) {                                     // a strike on its way: a visible warning over the base until it lands
      const p = this.tv(e.x, e.y);
      this.fx.push({ type: WARN_TYPE[e.skill] || 'warn', skill: e.skill, x: p.x, y: p.y, r: e.r || 70, sim: true, t0: this.serverNow(), dur: e.delay });
      if (this.owner[e.node] === this.me) this.hooks.notify(`incoming.${e.skill}`);
    } else if (e.skill === 'wormhole') {
      const a = this.vn[e.node], b = this.vn[e.to], st = this.serverNow();
      this.fx.push({ type: 'chrono', x: a.x - 66, y: a.y + 4, arrive: true, sim: true, t0: st, dur: 1.3, seed: e.node * 31 + 7 });
      this.fx.push({ type: 'chrono', x: b.x - 66, y: b.y + 4, arrive: true, sim: true, t0: st, dur: 1.3, seed: e.to * 31 + 11 });
      this.flashScreen('190,235,255', 0.14, 0.35);
      this.light3d(a, '#bfeaff', 1.4, 0.9); this.light3d(b, '#bfeaff', 1.4, 0.9);
    } else if (e.node != null) {                       // something set up at a base
      const n = this.vn[e.node];
      this.push({ type: 'pulse', x: n.x, y: n.y, r: 60, col, t0: now, dur: 0.8 });
    } else if (e.a != null) {                          // something placed on a road
      const A = this.map.nodes[e.a], Z = this.map.nodes[e.b], L = Math.hypot(Z[0] - A[0], Z[1] - A[1]) || 1;
      const p = this.tv(A[0] + (Z[0] - A[0]) * (e.x / L), A[1] + (Z[1] - A[1]) * (e.x / L));
      this.push({ type: 'pulse', x: p.x, y: p.y, r: 40, col, t0: now, dur: 0.8 });
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
    if (e.void) {
      // It came to nothing: the base was shielded, had become its owner's last, or was no longer a target.
      const col = e.void === 'shield' ? '#ffe9a8' : '#cfd6da';
      this.push({ type: 'pulse', x: p.x, y: p.y, r: 70, col, t0: now, dur: 0.9 });
      this.push({ type: 'text', x: p.x, y: p.y - 40, text: t(`game.void.${e.void}`), col, size: 13, t0: now, dur: 2.2 });
      if (e.skill !== 'nuke' || e.void === 'shield') return;
    }
    if (e.skill === 'nuke') {
      const d = this.cfg.skills.iron[2];
      // The blast is drawn at the strike's own radius: columns inside it are hurt; only the base at its centre is destroyed.
      this.fx.push({ type: 'nuke', x: p.x, y: p.y, r: e.r, sim: true, t0: st, dur: 7, seed });
      this.fx.push({ type: 'scorch', x: p.x, y: p.y, r: e.r * 0.6, sim: true, t0: st, dur: 40, seed });
      this.fx.push({ type: 'hazard', x: p.x, y: p.y, r: e.r, sim: true, t0: st, dur: d.hazardDur, seed: e.x | 0 });
      const lost = this.beforeUnits ? this.beforeUnits[e.node] - this.units[e.node] : 0;
      if (!e.void && lost > 0) this.fx.push({ type: 'text', x: p.x, y: p.y, text: `−${fmt(lost)}`, col: '#ffd9a0', size: 16, t0: now + 0.25, dur: 1.8 });
      this.flashScreen('255,244,214', 0.55, 0.5);
      this.light3d(p, '#ffb060', 6, 2.4);
      this.shake(9);
    }
    // Base mind control shows itself with the capture it causes (see 'cap' with `mind`).
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
    // The whole map fitted to the screen, then the camera: zoom about the middle of the play area and pan,
    // never so far that the map leaves the screen.
    const fs = Math.min(aw / this.vw, ah / this.vh);
    const fit = this.fit = { s: fs, ox: padX + (aw - this.vw * fs) / 2, oy: padT + (ah - this.vh * fs) / 2, padX, padT, aw, ah };
    const z = this.cam.z = Math.max(1, Math.min(ZOOM_MAX, this.cam.z));
    this.s = fs * z;
    const place = (pad, room, size, at) => (size <= room ? pad + (room - size) / 2 : Math.max(pad + room - size, Math.min(pad, at)));
    const cx = padX + aw / 2, cy = padT + ah / 2;
    this.ox = place(padX, aw, this.vw * this.s, cx + (fit.ox - cx) * z + this.cam.x);
    this.oy = place(padT, ah, this.vh * this.s, cy + (fit.oy - cy) * z + this.cam.y);
    this.cam.x = this.ox - (cx + (fit.ox - cx) * z);
    this.cam.y = this.oy - (cy + (fit.oy - cy) * z);
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
      x0: -fit.ox / fit.s, y0: -fit.oy / fit.s, x1: (W - fit.ox) / fit.s, y1: (H - fit.oy) / fit.s,   // planned for the whole map, so zooming never moves a building
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

  /** One of my columns on the road at a point (its figures or its plate). A column locked in a siege cannot be picked. */
  myArmyAt(p) {
    let best = null, bd = Math.max(20, 22 / this.s);
    for (const a of this.st.armies.values()) {
      if (a.o !== this.me || a.st === 2 || a.st === 3 || a.hx == null) continue;
      const d = Math.min(Math.hypot(a.hx - p.x, a.hy - p.y), Math.hypot(a.hx - p.x, a.hy - 30 - p.y));
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /**
   * The road nearest a point, among those a route skill may be placed on (one that touches a
   * base of mine), with how far along it the point is: { a, b, f, x, y } or null.
   */
  edgeAt(p) {
    const span = this.cfg.skills.edgeSpan;
    let best = null, bd = Math.max(18, 20 / this.s);
    for (const [a, b] of this.edges) {
      if (this.owner[a] !== this.me && this.owner[b] !== this.me) continue;
      const A = this.vn[a], Z = this.vn[b];
      const dx = Z.x - A.x, dy = Z.y - A.y, L2 = dx * dx + dy * dy || 1;
      const f = Math.max(span[0], Math.min(span[1], ((p.x - A.x) * dx + (p.y - A.y) * dy) / L2));
      const x = A.x + dx * f, y = A.y + dy * f, d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = { a, b, f: +f.toFixed(3), x, y }; }
    }
    return best;
  }

  // ------------------------------------------------------------ camera

  /** Zoom by `factor`, keeping the map point under the screen point (clientX, clientY) where it is. */
  zoomAt(factor, clientX, clientY) {
    const r = this.cv.getBoundingClientRect(), c = this.camLive || { s: this.s, ox: this.ox, oy: this.oy };
    const z0 = c.s / this.fit.s, z1 = Math.max(1, Math.min(ZOOM_MAX, z0 * factor));
    if (Math.abs(z1 - z0) < 1e-4) return;
    const px = clientX - r.left, py = clientY - r.top;
    const vx = (px - c.ox) / c.s, vy = (py - c.oy) / c.s, s1 = this.fit.s * z1;
    this.previewCam({ s: s1, ox: px - vx * s1, oy: py - vy * s1 }, 'zoom');
  }

  /**
   * Show a camera move at once by stretching the picture already drawn, then draw it properly
   * a moment later: the ground is repainted for the new view only once the gesture settles.
   */
  previewCam(c, kind, hold) {
    this.camLive = c;
    this.camKind = kind;
    const r = c.s / this.s;
    const tf = `translate(${(c.ox - this.ox * r).toFixed(2)}px, ${(c.oy - this.oy * r).toFixed(2)}px) scale(${r.toFixed(5)})`;
    for (const el of [this.cv, this.els.gl]) if (el) { el.style.transformOrigin = '0 0'; el.style.transform = tf; }
    clearTimeout(this.camTimer);
    if (!hold) this.camTimer = setTimeout(() => this.commitCam(), 140);
  }

  commitCam() {
    const c = this.camLive;
    if (!c) return;
    clearTimeout(this.camTimer);
    this.camLive = null;
    const f = this.fit, z = c.s / f.s, cx = f.padX + f.aw / 2, cy = f.padT + f.ah / 2;
    this.cam = { z, x: c.ox - (cx + (f.ox - cx) * z), y: c.oy - (cy + (f.oy - cy) * z) };
    for (const el of [this.cv, this.els.gl]) if (el) el.style.transform = '';
    this.resize();
    if (this.hooks.onCamera) this.hooks.onCamera(this.camKind);
  }

  /** Back to the whole map. */
  resetCam() {
    if (!this.map || (this.cam.z === 1 && !this.camLive)) return;
    this.previewCam({ s: this.fit.s, ox: this.fit.ox, oy: this.fit.oy }, 'zoom');
  }

  /** Zoom from the keyboard or a button: about the middle of the screen. */
  zoomBy(factor) {
    if (!this.map) return;
    const r = this.cv.getBoundingClientRect();
    this.zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  canPlay() {
    return this.active && this.winner === null && this.me >= 0 && this.alive[this.me];
  }

  linked(a, b) { return this.adj[a].includes(b); }

  /** Road route for my troops from city a to city b, by the server's rule (preview only). */
  routeTo(a, b, n = 0) {
    const nodes = this.map.nodes;                        // [x, y] in world units, the same the server measures roads in
    const B = this.featBy;
    // A hostile obstacle makes its road cost more; my own open wormhole is one more link, if it can still carry n.
    const pen = (u, v) => {
      let p = 0;
      const lo = Math.min(u, v), hi = Math.max(u, v);
      for (const o of B.obst) if (o.p !== this.me && o.a === lo && o.b === hi) p += o.cost;
      return p;
    };
    const worms = B.worms.filter(w => w.p === this.me && w.left >= Math.max(1, n));
    return planRoute(this.N, u => this.adj[u],
      (u, v) => Math.hypot(nodes[u][0] - nodes[v][0], nodes[u][1] - nodes[v][1]) + (B.obst.length ? pen(u, v) : 0),
      u => this.owner[u] === this.me, a, b,
      worms.length ? u => worms.filter(w => w.a === u || w.b === u).map(w => [w.a === u ? w.b : w.a, w.cost]) : null);
  }

  /** Is the hop u -> v of a route a wormhole rather than a road? */
  isWarp(u, v) { return !this.adj[u].includes(v); }

  /**
   * What one order from `from` to `to` would do. Every city of mine plans its
   * own route to the same destination; the ones that cannot take part are
   * listed with the reason instead of being dropped. This is only a preview:
   * the server works it out again and its answer is what happens.
   */
  plan(from, to) {
    const routes = [], out = [];
    let total = 0, asked = 0;
    // A city of mine takes reinforcements only up to its capacity, counting what is already coming.
    let room = this.owner[to] === this.me ? Math.floor(this.roomAt(to)) : Infinity;
    for (const s of from) {
      if (s === to || this.owner[s] !== this.me) continue;
      if (!this.routeTo(s, to)) { out.push({ from: s, why: 'noRoute' }); continue; }
      const want = this.dispatchCount(s);
      if (want < 1) { out.push({ from: s, why: 'noTroops' }); continue; }
      const n = Math.min(want, room);
      if (n < 1) { out.push({ from: s, why: 'full' }); continue; }
      const r = this.routeTo(s, to, n);
      if (!r) { out.push({ from: s, why: 'noRoute' }); continue; }
      routes.push({ from: s, path: r.path, n, want });
      room -= n;
      total += n;
      asked += want;
    }
    return { routes, out, total, asked };
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
    if (!this.map) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {                        // a second finger: pinch to zoom, and no order is started
      this.drag = null; this.pan = null;
      const [a, b] = [...this.touches.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      return;
    }
    if (this.drag || this.pan || this.pinch) return;
    const p = this.toView(e);
    this.ptr = p;
    const startPan = () => { this.pan = { pid: e.pointerId, x: e.clientX, y: e.clientY, moved: false }; try { this.cv.setPointerCapture(e.pointerId); } catch { /* not capturable */ } };
    if (e.pointerType === 'mouse' && e.button !== 0) { if (e.button === 1) { e.preventDefault(); startPan(); } return; }
    if (this.targeting) return this.targetClick(p);
    // A cancel control is on top of everything: clicking it never reaches the map underneath.
    const chip = this.chipAt(p);
    if (chip) return this.cancelRoute(chip);
    const id = this.nodeAt(p);
    if (!this.canPlay()) { this.sel = id; if (id >= 0 && this.hooks.onInspect) this.hooks.onInspect(id); if (id < 0) startPan(); return; }      // spectators can still inspect cities
    if (this.selArmy >= 0) {                              // a column of mine is picked: a city is its new destination
      if (id >= 0) return this.redirectTo(id);
      const again = this.myArmyAt(p);
      this.selArmy = again ? again.id : -1;
      if (!again) startPan();
      return;
    }
    if (id < 0) {
      const a = this.myArmyAt(p);
      if (a) { this.selArmy = a.id; this.sel = -1; this.picked.clear(); return; }
    }
    if (id >= 0 && this.owner[id] === this.me) {
      if (e.shiftKey) {                                  // build up a multi-city selection
        if (this.picked.has(id)) this.picked.delete(id); else this.picked.add(id);
        this.sel = id;
        return;
      }
      // Dragging from a picked city orders the whole selection; otherwise just this city.
      const sources = this.picked.has(id) ? new Set(this.picked) : new Set([id]);
      this.drag = { sources, start: id, x: p.x, y: p.y, target: -1, ok: false, pid: e.pointerId, moved: false };
      try { this.cv.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    } else {
      this.sel = this.sel === id ? -1 : id;
      if (id >= 0 && this.sel === id && this.hooks.onInspect) this.hooks.onInspect(id);
      if (id < 0) { this.picked.clear(); startPan(); }   // open ground: drag to move the camera
    }
  }

  onMove(e) {
    if (!this.map) return;
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.zoomAt(d / this.pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinch.d = d;
      return;
    }
    if (this.pan && this.pan.pid === e.pointerId) {
      const dx = e.clientX - this.pan.x, dy = e.clientY - this.pan.y;
      if (Math.hypot(dx, dy) > 4) this.pan.moved = true;
      if (this.pan.moved && this.cam.z > 1.001) this.previewCam({ s: this.s, ox: this.ox + dx, oy: this.oy + dy }, 'pan', true);
      return;
    }
    const p = this.toView(e);
    this.ptr = p;
    const h = this.nodeAt(p);
    this.hover = e.pointerType === 'mouse' || this.targeting ? h : -1;
    const d = this.drag;
    if (!d) {
      this.routeHover = e.pointerType === 'mouse' && !this.targeting && h < 0 ? this.routesNear(p) : null;
      const chip = this.chipAt(p);
      this.cv.style.cursor = this.targeting ? 'crosshair' : chip || h >= 0 || this.myArmyAt(p) ? 'pointer' : 'default';
      return;
    }
    if (d.pid !== e.pointerId) return;
    if (Math.hypot(p.x - d.x, p.y - d.y) > 6) d.moved = true;
    d.px = p.x; d.py = p.y;
    // Sweeping over more of your own cities adds them to the order.
    if (h >= 0 && this.owner[h] === this.me && h !== d.start) d.sources.add(h);
    d.target = h >= 0 && (h !== d.start || d.sources.size > 1) ? h : -1;
    d.plan = d.target >= 0 ? this.plan([...d.sources], d.target) : null;
    d.ok = !!d.plan && d.plan.routes.length > 0;
  }

  onUp(e) {
    this.touches.delete(e.pointerId);
    if (this.pinch) { if (this.touches.size < 2) this.pinch = null; return; }
    if (this.pan && this.pan.pid === e.pointerId) {
      const moved = this.pan.moved;
      this.pan = null;
      if (moved && this.camLive) this.commitCam();
      return;
    }
    const d = this.drag;
    if (!d || d.pid !== e.pointerId) return;
    this.drag = null;                                    // the gesture ends here whatever happens next
    if (!this.canPlay()) return;
    const h = this.nodeAt(this.toView(e));
    if (h < 0) return;                                   // released on open ground: cancelled, nothing spent
    if (h === d.start && !d.moved) {
      const now = performance.now();
      if (this.lastTap.id === h && now - this.lastTap.t < 350) {
        this.hooks.upgrade(h);
        this.lastTap = { id: -1, t: 0 };
      } else {
        this.sel = this.sel === h && !this.picked.size ? -1 : h;
        if (this.sel === h && this.hooks.onInspect) this.hooks.onInspect(h);
        this.picked.clear();
        this.lastTap = { id: h, t: now };
      }
      return;
    }
    if (h === d.start && d.sources.size === 1) return;
    this.order([...d.sources], h);
  }

  // ------------------------------------------------------------ cancelling orders

  /** My routes on the map: persistent orders and columns on the march, each as a line through view points. */
  myRoutes() {
    const out = [];
    for (const r of this.autoRoutes()) if (r.path) out.push({ kind: 'auto', key: `a${r.src}`, src: r.src, dest: r.dest, pts: r.path.map(id => this.vn[id]) });
    for (const a of this.st.armies.values()) {
      if (a.o !== this.me || a.hx == null || a.st === 2 || a.st === 3 || (a.fl & HELD)) continue;
      out.push({ kind: 'march', key: `m${a.id}`, id: a.id, src: -1, dest: a.dest, n: a.n, pts: [{ x: a.hx, y: a.hy }, this.vn[a.to], ...a.path.map(id => this.vn[id])] });
    }
    return out;
  }

  /**
   * The routes of mine that pass under a point, nearest first, each with the place its cancel
   * control goes. A control stays where it first appeared while the pointer is on its route or
   * on the control itself, so it can be reached and clicked; routes that overlap get one
   * control each, side by side.
   */
  routesNear(p) {
    const reach = Math.max(11, 12 / this.s), old = this.routeHover || [];
    const hits = [];
    for (const r of this.myRoutes()) {
      let bd = Infinity, bx = 0, by = 0;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const A = r.pts[i], Z = r.pts[i + 1], dx = Z.x - A.x, dy = Z.y - A.y, L2 = dx * dx + dy * dy || 1;
        const f = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / L2));
        const x = A.x + dx * f, y = A.y + dy * f, d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; bx = x; by = y; }
      }
      const was = old.find(o => o.key === r.key);
      const onChip = was && Math.hypot(p.x - was.x, p.y - was.y) < 16;
      if (bd > reach && !onChip) continue;
      hits.push({ ...r, d: onChip ? -1 : bd, x: was ? was.x : bx, y: was ? was.y : by - 16, fresh: !was });
    }
    hits.sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1));
    const list = hits.slice(0, 4);
    list.filter(h => h.fresh).forEach((h, i) => { h.x += (i - (list.filter(q => q.fresh).length - 1) / 2) * 26; });
    return list.length ? list : null;
  }

  /** Every cancel control on screen: those under the pointer, the selected city's persistent route, the picked column. */
  cancelChips() {
    const list = (this.routeHover || []).slice();
    const has = key => list.some(c => c.key === key);
    if (this.sel >= 0 && this.autos.has(this.sel) && this.owner[this.sel] === this.me && !has(`a${this.sel}`)) {
      const r = this.autoRoutes().find(q => q.src === this.sel);
      if (r && r.path && r.path.length > 1) {
        const A = this.vn[r.path[0]], Z = this.vn[r.path[1]];
        list.push({ kind: 'auto', key: `a${r.src}`, src: r.src, dest: r.dest, pts: r.path.map(id => this.vn[id]), x: (A.x + Z.x) / 2, y: (A.y + Z.y) / 2 - 16 });
      }
    }
    const a = this.selArmy >= 0 ? this.st.armies.get(this.selArmy) : null;
    if (a && a.hx != null && !(a.fl & HELD) && a.st !== 2 && a.st !== 3 && !has(`m${a.id}`)) {
      list.push({ kind: 'march', key: `m${a.id}`, id: a.id, dest: a.dest, n: a.n, pts: [{ x: a.hx, y: a.hy }, this.vn[a.to], ...a.path.map(id => this.vn[id])], x: a.hx + 26, y: a.hy - 30 });
    }
    return list;
  }

  chipAt(p) {
    if (!this.canPlay()) return null;
    for (const c of this.cancelChips()) if (Math.hypot(p.x - c.x, p.y - c.y) <= 12) return c;
    return null;
  }

  /**
   * Cancel one order. A persistent route stops sending (columns already out keep their own
   * orders); a marching column stops where it is and holds until it is sent on.
   */
  cancelRoute(c) {
    if (this.paused) return this.hooks.notify('paused');
    this.routeHover = null;
    if (c.kind === 'auto') this.hooks.auto([c.src], -1, 0, this.nextCmd++, true);
    else { this.hooks.halt(c.id, this.nextCmd++); this.selArmy = c.id; }
  }

  /** Send the picked column to city `id` from where it stands. */
  redirectTo(id) {
    if (this.paused) return this.hooks.notify('paused');
    const a = this.st.armies.get(this.selArmy);
    this.selArmy = -1;
    if (!a) return;
    sfx.send();
    this.hooks.redirect(a.id, id, this.nextCmd++);
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
      // Auto dispatch: the server keeps the order and sends from these cities again and again.
      // The mode is for one order: it switches itself off once the destination is chosen.
      sfx.send();
      this.hooks.auto(mine, to, this.pct, this.nextCmd++);
      this.setAutoMode(false);
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

  /** The cities an auto-dispatch control acts on: the multi-selection, else the selected city. */
  chosen() {
    return this.picked.size ? [...this.picked] : this.sel >= 0 ? [this.sel] : [];
  }

  /** Stop the persistent orders of the chosen cities. */
  stopAuto() {
    const list = this.chosen().filter(s => this.autos.has(s));
    if (!list.length || !this.canPlay()) return false;
    if (this.paused) { this.hooks.notify('paused'); return false; }
    this.hooks.auto(list, -1, 0, this.nextCmd++, true);
    return true;
  }

  /**
   * Routes of my persistent orders, for drawing. Planned again only when an order or a
   * city's owner changed, never per frame.
   */
  autoRoutes() {
    const key = `${this.autoRev}|${this.ownerRev}|${this.featRev}`;
    if (!this.autoPaths || this.autoPaths.key !== key) {
      const list = [];
      for (const [src, o] of this.autos) {
        if (this.owner[src] !== this.me) continue;
        const r = this.routeTo(src, o.dest);
        list.push({ src, dest: o.dest, state: o.state, path: r ? r.path : null });
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
    const def = this.skillDef(slot);
    this.drag = null;
    this.selArmy = -1;
    this.targeting = this.targeting && this.targeting.slot === slot ? null : { slot, def, src: -1 };
  }

  cast(slot, args) {
    this.targeting = null;
    if (this.paused) return this.hooks.notify('paused');
    this.hooks.skill(slot, args, this.nextCmd++);
  }

  /** May skill `def` be aimed at city i? (The server decides; this only guides the pointer.) */
  targetOk(def, i) {
    if (i < 0 || this.isRuin(i)) return false;
    const o = this.owner[i];
    if (def.target === 'enemyCity') return o >= 0 && o !== this.me && !(this.cfg.skills.lastBaseImmune && this.basesOf(o) <= 1);
    return o === this.me;                                // ownCity, and both ends of ownCityPair
  }

  targetClick(p) {
    const T = this.targeting, def = T.def;
    const node = this.nodeAt(p);
    if (def.target === 'edge') {
      const e = this.edgeAt(p);
      if (e) this.cast(T.slot, { a: e.a, b: e.b, f: e.f }); else this.hooks.notify('needRoad');
      return;
    }
    if (!this.targetOk(def, node)) {
      if (def.target === 'enemyCity') this.hooks.notify(node >= 0 && this.owner[node] >= 0 && this.owner[node] !== this.me && !this.isRuin(node) ? 'lastBase' : 'needEnemyCity');
      else this.hooks.notify('needOwnCity');
      return;
    }
    if (def.target !== 'ownCityPair') return this.cast(T.slot, { node });
    // two of my bases: one end, then the other
    if (T.src < 0) T.src = node;
    else if (node !== T.src) this.cast(T.slot, { node: T.src, to: node });
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
    this.selArmy = -1;
    this.routeHover = null;
    this.sel = -1;
    if (this.picked) this.picked.clear();
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
    this.syncBuild();
    this.layoutArmies(t);
    this.drawFields(ctx, lt);
    this.drawRoadFeatures(ctx, t);
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
    this.drawPortals(ctx, t);
    this.drawGuide(ctx, lt);
    this.drawAutoBadges(ctx, lt);
    this.drawRejects(ctx, lt);
    this.drawShots(ctx, lt);
    this.drawFx(ctx, lt);
    this.drawDrag(ctx, lt);
    this.drawTargeting(ctx, lt);
    this.drawChips(ctx, lt);
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
    const items = this.items, pool = this.pool;
    // How many figures stand for an army is a drawing choice (see figuresFor in art.js): one per soldier
    // up to `exact`, then one more per `group`, never more than the quality preset's cap.
    const fig = (this.g3 && this.g3.opts.figures) || FIGURES;
    const figOpts = { exact: fig.exact, group: fig.group, cap: Math.min(fig.cap, this.q.sprites) };
    const settle = 1 - Math.exp(-7 * Math.max(0, Math.min(0.1, t - (this.layT === undefined ? t : this.layT))));   // simulation time: nothing slides while paused
    this.layT = t;
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
      const share = figuresFor(a.n, [a.n1, a.n2, a.n3], figOpts).each;
      const fresh = !a.sm, sm = a.sm || (a.sm = new Map());
      const base = Math.atan2(A.y - Z.y, A.x - Z.x);
      let back = 0, k = 0;
      for (let tier = 3; tier >= 1; tier--) {
        const c = share[tier - 1];
        if (!c) continue;
        const row = ROW[tier];
        for (let j = 0; j < c; j++, k++) {
          let x, y, grow = 1;
          if (a.st === 2) {                               // drawn up around the city it is attacking
            const ringNo = Math.floor(k / 6), idx = k % 6;
            const ang = base + (idx - 2.5) * 0.2 + ringNo * 0.1, rad = 68 + ringNo * 12;      // outside the compound wall
            x = Z.x + Math.cos(ang) * rad;
            y = Z.y + Math.sin(ang) * rad * 0.78 + 4;
          } else {
            const r = Math.floor(j / row), inRow = Math.min(row, c - r * row);
            // Each figure remembers its place in the column and slides to a new one, so a column that
            // loses or gains figures closes up instead of jumping; one that joins a column on the road grows in.
            const want = ((j % row) - (inRow - 1) / 2) * LANE[tier], rel = back + r * GAP[tier], id = tier * 64 + j;
            let q = sm.get(id);
            if (!q) sm.set(id, (q = { off: want, rel, born: fresh ? -1 : t }));
            else { q.off += (want - q.off) * settle; q.rel += (rel - q.rel) * settle; }
            const d = a.sn - q.rel;
            if (d < 46) continue;                         // still inside the compound
            x = A.x + a.ux * d - a.uy * q.off;
            y = A.y + a.uy * d + a.ux * q.off * 0.8;
            if (q.born >= 0) grow = clamp01((t - q.born) / 0.4);
          }
          let dx = a.ux, dy = a.uy;
          if (fire) { const l = Math.hypot(tx - x, ty - y) || 1; dx = (tx - x) / l; dy = (ty - y) / l; }
          const it = pool[n] || (pool[n] = {});
          n++;
          it.x = x; it.y = y; it.dx = dx; it.dy = dy; it.k = k; it.a = a; it.tier = tier; it.side = side; it.grow = grow;
          it.fire = fire; it.tx = tx; it.ty = ty;
          items.push(it);
        }
        back += Math.ceil(c / row) * GAP[tier] + 5;
      }
    }
    items.sort((p, q) => p.y - q.y);
    // Detail level for this frame: by how large a model is on screen, one step down in a crowd.
    const px = this.dpr * this.s * US;
    this.unitLod = Math.min(2, (px >= LOD_CLOSE ? 0 : px >= LOD_FAR ? 1 : 2) + (items.length > LOD_CROWD ? 1 : 0));
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
      sp = { ...u, pivot: u.pivot * US, muzzle: u.muzzle * US, mz: u.mz * US, hover: u.hover * US, bob: u.bob * US, drift: u.drift * US, foot: [u.foot[0] * US, u.foot[1] * US], glow: u.glow && [u.glow[0] * US, u.glow[1] * US, u.glow[2] * US * 0.7] };
      this.specs.set(key, sp);
    }
    return sp;
  }

  drawUnit(ctx, it, t, lt) {
    const s = it.side, a = it.a, tier = it.tier;
    const fam = weaponOf(s.f, s.sub, tier);
    const moving = a.st === 0 && a.v > 1;
    const lod = this.unitLod === undefined ? 1 : this.unitLod, grow = it.grow === undefined ? 1 : it.grow;
    // Everything a unit does is timed by `t`, the simulation clock: it stops on pause and follows the game speed.

    if (tier === 1) {
      const dir8 = ((Math.round(Math.atan2(it.dy, it.dx) / (Math.PI / 4)) % 8) + 8) % 8;
      const frame = moving ? walkFrame(t, it.k) : 0;
      if (this.g3) this.g3.add(`s|${s.f}|${s.sub}|${s.tc.id}|${frame}|${lod}`, () => buildSoldier(s.f, s.sub, s.tc, frame, lod), it.x, it.y, 0, Math.atan2(it.dy / F, it.dx), US * FOOT * grow);
      else this.sprite(ctx, soldierSprite(this.sprites, s.f, s.sub, s.tc, dir8, frame), it.x, it.y, FOOT * grow);
      if (it.fire) {
        const m = soldierMuzzle(s.f, s.sub, it.dx, it.dy);
        this.fire(it, fam, it.x + m[0] * US * FOOT, it.y + m[1] * US * FOOT, t, lt);
      }
      return;
    }

    const spec = this.specOf(s.f, s.sub, tier);
    const g3 = this.g3;
    // How it rides: tracks rattle, hover craft bob, aircraft hold their height and drift across the road.
    const pose = hullPose(spec, t, it.k, moving);
    const ux = it.x - a.uy * pose.sway, uy = it.y + a.ux * pose.sway * 0.8;   // where the hull is; it.x, it.y stays the point on the road under it
    const road = Math.atan2(a.uy / F, a.ux) + pose.yaw;
    const hd = dirIndex(road);                           // the hull stays on the road; only the turret turns
    const ha = g3 ? road : hd * STEP;                    // 3D turns freely; sprites have 32 facings
    let y = uy - pose.lift;
    if (spec.hover) {
      if (!g3) {                                         // the 3D renderer casts a real shadow
        ctx.fillStyle = spec.air ? 'rgba(0,0,0,.26)' : 'rgba(0,0,0,.34)';
        ctx.beginPath(); ctx.ellipse(ux + 3, uy + 3, spec.foot[0] * 0.92, (spec.air ? spec.foot[1] : spec.foot[0]) * 0.92 * F, spec.air ? Math.atan2(a.uy, a.ux) : 0, 0, TAU); ctx.fill();
      }
      if (!spec.air) {                                   // lift glow under a hover craft; aircraft are too high to light the road
        ctx.globalAlpha = 0.28 + 0.12 * Math.sin(t * 5 + it.k);
        ctx.fillStyle = s.G;
        ctx.beginPath(); ctx.ellipse(ux, uy, spec.foot[0] * 0.7, spec.foot[0] * 0.7 * F, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (moving && this.settings.effects) {
      for (let j = 0; j < 2; j++) {                       // dust
        const ph = (t * 1.5 + j * 0.5 + it.k * 0.37) % 1;
        ctx.globalAlpha = (1 - ph) * 0.26;
        ctx.fillStyle = '#b9a783';
        ctx.beginPath(); ctx.arc(it.x - a.ux * (spec.foot[0] + ph * 6), it.y - a.uy * (spec.foot[0] + ph * 6) * 0.8 + 1.4 - ph * 2, 1.1 + ph * 2.4, 0, TAU); ctx.fill();
      }
      if (s.f === 'iron') {                               // exhaust
        const ph = (t * 1.1 + it.k * 0.61) % 1;
        ctx.globalAlpha = (1 - ph) * 0.42;
        ctx.fillStyle = '#2b2927';
        ctx.beginPath(); ctx.arc(it.x - a.ux * 8.5 + ph * 2, it.y - a.uy * 6 - 8.5 - ph * 8, 1.1 + ph * 2.3, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const lift = uy - y, sc = US * grow;
    if (g3) g3.add(`h|${s.f}|${s.sub}|${tier}|${s.tc.id}|${lod}`, () => buildHull(s.f, s.sub, tier, s.tc, lod), ux, uy, lift, ha, sc);
    else this.sprite(ctx, hullSprite(this.sprites, s.f, s.sub, tier, s.tc, hd), ux, y, grow);

    const px = ux + Math.cos(ha) * spec.pivot, py = y + Math.sin(ha) * spec.pivot * F;
    // The turret traverses to its target at a finite rate and looks about when it has none.
    const want = it.fire ? Math.atan2((it.ty - py) / F, it.tx - px) : idleTurret(spec, ha, t, it.k);
    const tur = a.tur || (a.tur = new Map());
    let ts = tur.get(it.k);
    if (!ts) tur.set(it.k, (ts = {}));
    const aim = turnToward(ts, want, t);
    const td = dirIndex(aim);
    const ta = g3 ? aim : td * STEP, tx = Math.cos(ta), ty = Math.sin(ta) * F;
    const mx = px + tx * spec.muzzle, my = py + ty * spec.muzzle - spec.mz;
    const rc = it.fire ? recoilAt(fam, this.fire(it, fam, mx, my, t, lt)) * US : 0;
    if (g3) g3.add(`t|${s.f}|${s.sub}|${tier}|${s.tc.id}|${lod}`, () => buildTurret(s.f, s.sub, tier, s.tc, lod), px - tx * rc, py + lift - ty * rc, lift, ta, sc);
    else this.sprite(ctx, turretSprite(this.sprites, s.f, s.sub, tier, s.tc, td), px - tx * rc, py - ty * rc, grow);
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
    for (const [i, list] of this.featBy.emp) {           // emplacements: reach shown while the base is inspected
      if (this.sel !== i && this.hover !== i) continue;
      const n = this.vn[i];
      for (const e of list) {
        const def = this.cfg.skills[this.sides[e.p].f].find(d => d.emp === e.k);
        const v = def && this.cfg.skills.variants[this.sides[e.p].sub] && this.cfg.skills.variants[this.sides[e.p].sub][def.id];
        const r = def ? def.range * ((v && v.range) || 1) : R;
        ctx.strokeStyle = FEAT_COLOR[e.k]; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.6;
        ctx.setLineDash([5, 6]);
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }
    for (let i = 0; i < this.N; i++) {
      const o = this.owner[i];
      if (o < 0 || this.level[i] < 2 || this.isRuin(i)) continue;
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
        if (T.def.target === 'edge') ring = null;
        else if (T.src === i) ring = '#ffffff';
        else if (this.targetOk(T.def, i)) ring = this.hover === i ? '#ffffff' : SKILL_COLOR[T.def.id];
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
    if (this.st.flags && (this.st.flags[i] & 1) && !(this.build && this.build[i])) return 16 * BS;   // a ruin is low
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
    // A destroyed base (flag bit 0) is a ruin in a breached yard. Work on a base - an upgrade, or
    // rebuilding a ruin - is `this.build[i] = { kind: 'up' | 'rebuild', t0, dur, from?, to? }` on the
    // simulation clock: scaffold goes up, the new structure rises out of its footing, the old sinks.
    const tNow = this.frozenT !== null && this.frozenT !== undefined ? this.frozenT : this.serverNow();
    const ruin = !!(this.st.flags && (this.st.flags[i] & 1));
    const job = (this.build && this.build[i]) || null;
    const bp = job ? buildPose(progressAt(tNow, job.t0, job.dur)) : null;
    // Levels the work goes between. Unless the job says, an upgrade is taken to be from the base's
    // present level to the next (the level changes when the work is done).
    const toLv = job ? job.to || (job.kind === 'up' ? Math.min(3, lv + 1) : lv) : lv;
    const fromLv = job && job.kind === 'up' ? job.from || (toLv === lv ? Math.max(1, lv - 1) : lv) : lv;
    const wreck = ruin && (!job || bp.old > 0);          // the ruin is still (partly) there
    const st = tNow;
    if (this.g3) {
      const YAW = Math.PI / 4, cf = `${i}${this.flip ? 'f' : ''}`;
      // The compound is built per city: its wall has a gate wherever one of this city's roads crosses it.
      if (ruin && (!job || bp.progress < 0.5)) this.g3.add(`cmp|${cf}|${s.f}|${lv}|ruin`, () => compoundModel(s.f, lv, s.tc, this.gatesOf(i), true), x, y, 0, YAW, 1);
      else this.g3.add(`cmp|${cf}|${s.f}|${toLv}|${s.tc.id}`, () => compoundModel(s.f, toLv, s.tc, this.gatesOf(i)), x, y, 0, YAW, 1);
      if (wreck) this.g3.add(`ruin|${i & 3}`, () => ruinModel(i), x, y, BASE_LIFT, YAW, BS, job ? bp.old : 1);
      if (!job) { if (!ruin) this.g3.add(`b|${s.f}|${s.sub}|${lv}|${s.tc.id}`, () => info.model, x, y, BASE_LIFT, YAW, BS); }
      else {
        if (job.kind === 'up' && bp.old > 0 && fromLv !== toLv) this.g3.add(`b|${s.f}|${s.sub}|${fromLv}|${s.tc.id}`, () => baseInfo(s.f, s.sub, fromLv, s.tc).model, x, y, BASE_LIFT, YAW, BS, bp.old);
        this.g3.add(`b|${s.f}|${s.sub}|${toLv}|${s.tc.id}`, () => baseInfo(s.f, s.sub, toLv, s.tc).model, x, y, BASE_LIFT, YAW, BS, bp.rise);
        if (bp.scaffold > 0) { const stage = Math.min(3, Math.floor(bp.progress * 4)); this.g3.add(`scf|${stage}|${toLv}`, () => scaffoldModel(bp.progress, toLv), x, y, BASE_LIFT, YAW, BS, bp.scaffold); }
      }
    } else {
      const up = (spr, k) => { ctx.save(); ctx.translate(x, y); ctx.scale(1, k); drawSprite(ctx, spr, 0, 0); ctx.restore(); };
      if (wreck) up(ruinSprite(this.sprites, s.f, lv), job ? Math.max(0.05, bp.old) : 1);
      if (!job) { if (!ruin) drawSprite(ctx, baseSprite(this.sprites, s.f, s.sub, lv, s.tc), x, y); }
      else {
        up(baseSprite(this.sprites, s.f, s.sub, toLv, s.tc), bp.rise);
        if (bp.scaffold > 0) up(scaffoldSprite(this.sprites, bp.progress, toLv), bp.scaffold);
      }
    }
    if (o >= 0 && !ruin && !job) drawBaseLive(ctx, info, s.tc, x, y, lt, i * 1.9);

    for (const e of this.featBy.emp.get(i) || []) {     // temporary emplacements at the corners of the compound
      const q = empSpot(x, y, e.s), tc = this.color(e.p);
      if (this.g3) {
        this.g3.add(`emp|${e.k}|${tc.id}|b`, () => emplacementModel(e.k, tc, 'base'), q.x, q.y, 0, 0, 1);
        this.g3.add(`emp|${e.k}|${tc.id}|h`, () => emplacementModel(e.k, tc, 'head'), q.x, q.y, 0, e.k === 'turret' ? st * 0.9 + i + e.s : 0, 1);
      }
      drawEmplacement(ctx, e.k, q.x, q.y, tc.main, st, (e.u - st) / Math.max(0.1, e.u - e.t0), i + e.s, !this.g3);
    }
    const ae = this.featBy.aegis.get(i);
    if (ae && ae.u > st) {                              // a cast Base Shield: projectors round the compound and a dome over all of it
      if (this.g3) {
        const dp = domePose(st, i), tc = this.color(ae.p);
        this.g3.add(`dome|p|${tc.id}`, () => shieldDomeModel(tc, 'projectors'), x, y, 0, 0, 1);
        this.g3.add(`dome|d|${tc.id}`, () => shieldDomeModel(tc, 'dome'), x, y, 0, st * 0.15, dp.scale, dp.sy);
      }
      drawAegis(ctx, x, y, st, ae.hp / 10, (ae.u - st) / Math.max(0.1, ae.u - ae.t0), !this.g3);
    }
    if (this.st.shield[i] & 1) {                        // the base's own defence-network shield: a smaller hex-banded dome
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
    const ruin = this.isRuin(i), cap = this.capOf(i);
    const paused = o >= 0 && !ruin && u >= L.threshold;   // production has stopped
    const capFull = o >= 0 && u >= cap;                   // no more reinforcements fit

    const a = fmt(u), b = ruin ? `/${fmt(cap)}` : `/${fmt(L.threshold)}`, pw = fmt(this.st.power[i]);
    ctx.textBaseline = 'middle';
    ctx.font = `700 14px ${FONT}`;
    const wa = ctx.measureText(a).width;
    ctx.font = `600 10px ${FONT}`;
    const wb = o >= 0 ? ctx.measureText(b).width : 0, wp = ctx.measureText(pw).width + 9;
    const tw = Math.max(40, wa + wb + 14, wp + 14);
    const py = y + this.R * F + 18;
    ctx.fillStyle = 'rgba(10,12,13,.92)';
    ctx.beginPath(); ctx.roundRect(x - tw / 2, py - 15, tw, o >= 0 ? 34 : 30, 3); ctx.fill();
    ctx.strokeStyle = capFull ? '#ff8a5c' : col.main;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = col.main;
    ctx.fillRect(x - tw / 2, py - 15, 3.5, o >= 0 ? 34 : 30);

    const left = x + 1.5 - (wa + wb) / 2;
    ctx.textAlign = 'left';
    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = capFull ? '#ff8a5c' : paused ? '#ffd166' : '#ffffff';
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

    if (o >= 0) {
      // Capacity bar: the garrison against the most the city can hold, a notch at the production
      // threshold, and (for my cities) the places already reserved by columns on their way.
      const bx = x - tw / 2 + 6, bw = tw - 10, by = py + 14.5;
      ctx.fillStyle = '#2b3136';
      ctx.fillRect(bx, by, bw, 2.6);
      const fu = Math.min(1, u / cap);
      if (o === this.me) {
        const inc = this.incoming(i);
        if (inc > 0) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(bx + bw * fu, by, bw * Math.min(1 - fu, inc / cap), 2.6); }
      }
      ctx.fillStyle = capFull ? '#ff8a5c' : paused ? '#ffd166' : col.light;
      ctx.fillRect(bx, by, bw * fu, 2.6);
      if (!ruin) { ctx.fillStyle = '#ffffff'; ctx.fillRect(bx + bw * Math.min(1, L.threshold / cap) - 0.5, by - 1.2, 1.2, 5); }
    }

    if (!ruin) {
      ctx.strokeStyle = '#ffd166';                        // rank chevrons = city level
      ctx.lineWidth = 1.8;
      for (let j = 0; j < lv; j++) {
        const cx = x + tw / 2 + 7, cy = py + 10 - j * 5;
        ctx.beginPath(); ctx.moveTo(cx - 4, cy); ctx.lineTo(cx, cy - 3.4); ctx.lineTo(cx + 4, cy); ctx.stroke();
      }
    }

    const canUp = ruin ? !this.featBy.rebuild.has(i) && u >= this.cfg.ruin.cost : lv < 3 && u >= L.upCost;
    if (o === this.me && canUp && this.winner === null) {
      const bx = x - 34, by = y - (ruin ? 30 : this.topOf(i)) + 4 + Math.sin(lt * 5 + i) * 2;
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
      else if (a.fl & (64 | HELD | QUEUED)) {           // standing still: waiting for a route (amber), outside a full city (orange), order cancelled (white)
        ctx.strokeStyle = a.fl & HELD ? '#ffffff' : a.fl & QUEUED ? '#ff8a5c' : '#ffb347'; ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.roundRect(x - w / 2, y - 8, w, 16, 3); ctx.stroke(); ctx.setLineDash([]);
        if (a.o === this.me && a.fl & (HELD | QUEUED)) {
          const tag = t(a.fl & HELD ? 'game.tag.held' : 'game.tag.full');
          ctx.font = `700 9px ${FONT}`;
          const tw2 = ctx.measureText(tag).width + 8;
          ctx.fillStyle = a.fl & HELD ? '#e8edf0' : '#ff8a5c';
          ctx.beginPath(); ctx.roundRect(x - tw2 / 2, y - 21, tw2, 11, 2); ctx.fill();
          ctx.fillStyle = '#111416';
          ctx.textAlign = 'center';
          ctx.fillText(tag, x, y - 15);
          ctx.textAlign = 'left';
        }
      }
      if (a.id === this.selArmy) {                       // the column I have picked
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -performance.now() / 40;
        ctx.beginPath(); ctx.ellipse(a.hx, a.hy, 26, 26 * F, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
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
      if (this.isWarp(u, v)) { drawChronoLink(ctx, A, Z, lt, true); continue; }   // through my wormhole, not along a road
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
    let up = d.ok ? 26 : 0;
    // Only part of what was asked fits into the destination: say how many go and that the rest stay at home.
    if (d.ok && !this.autoMode && plan.asked > plan.total) { this.badge(ctx, tgt.x, by - up, t('game.orderPartial', { troops: plan.total, asked: plan.asked }), '#b5651d'); up += 26; }
    const full = plan.out.filter(o => o.why === 'full').length;
    if (full && !this.autoMode) { this.badge(ctx, tgt.x, by - up, t('game.orderFull'), '#b5651d'); up += 26; }
    if (plan.out.length > full && !this.autoMode) this.badge(ctx, tgt.x, by - up, t('game.orderOut', { count: plan.out.length - full }), '#b3261e');
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
      let at = a.to;
      for (const id of a.path) { if (this.isWarp(at, id)) ctx.moveTo(this.vn[id].x, this.vn[id].y); else ctx.lineTo(this.vn[id].x, this.vn[id].y); at = id; }
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
   * My persistent orders on the ground: a quiet dotted line along each planned
   * route, dimmer than a march, with a small ring on the destination.
   */
  drawAutoRoutes(ctx, lt) {
    if (this.me < 0 || !this.autos.size) return;
    const col = this.color(this.me);
    const move = this.paused ? 0 : lt * 14;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([2, 7]);
    ctx.lineDashOffset = -move;
    const dests = new Set();
    for (const r of this.autoRoutes()) {
      if (!r.path) continue;
      ctx.strokeStyle = col.light;
      ctx.globalAlpha = r.state === 0 ? 0.5 : 0.25;
      ctx.beginPath();
      r.path.forEach((id, i) => { const n = this.vn[id]; if (i && !this.isWarp(r.path[i - 1], id)) ctx.lineTo(n.x, n.y); else ctx.moveTo(n.x, n.y); });
      ctx.stroke();
      dests.add(r.dest);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = col.light;
    for (const id of dests) {
      const n = this.vn[id];
      ctx.beginPath(); ctx.ellipse(n.x, n.y, this.R + 5, (this.R + 5) * F, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A badge on every city of mine with a persistent order: a turning arrow while it is
   * sending, and a plain sign of what it is waiting for otherwise.
   *   0 active   1 waiting for troops   2 no route   3 under attack   (paused: the whole match)
   */
  drawAutoBadges(ctx, lt) {
    if (this.me < 0 || !this.autos.size) return;
    const col = this.color(this.me);
    for (const [src, o] of this.autos) {
      if (this.owner[src] !== this.me) continue;
      const n = this.vn[src];
      const x = n.x + 30, y = n.y - this.topOf(src) - 4;
      const state = this.paused ? 5 : o.state;
      const ring = ['#ffffff', '#9aa3ab', '#ffb347', '#ff5a4d', '#ff8a5c', '#ffffff'][state];
      ctx.fillStyle = 'rgba(10,12,13,.9)';
      ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = state === 0 ? col.light : ring;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.stroke();
      ctx.strokeStyle = ctx.fillStyle = ring;
      ctx.lineWidth = 1.8;
      if (state === 4) {                                 // the destination is full: a filled bar
        ctx.strokeRect(x - 4.5, y - 3, 9, 6); ctx.fillRect(x - 4.5, y - 3, 9, 6);
      } else if (state === 5) {                          // paused
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

  /** Skill targeting preview: where it would go, what it would reach, and which targets are eligible. */
  drawTargeting(ctx, lt) {
    const T = this.targeting, p = this.ptr;
    if (!T || !p) return;
    const def = T.def, col = SKILL_COLOR[def.id], h = this.hover;
    const reach = (n, r, c) => {
      ctx.fillStyle = c; ctx.globalAlpha = 0.1;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = c; ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]); ctx.lineDashOffset = -lt * 30;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    };
    if (def.target === 'edge') {
      // Roads it may be placed on, faintly; the spot under the pointer, as it would stand.
      ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.globalAlpha = 0.22;
      const span = this.cfg.skills.edgeSpan;
      for (const [a, b] of this.edges) {
        if (this.owner[a] !== this.me && this.owner[b] !== this.me) continue;
        const A = this.vn[a], Z = this.vn[b];
        ctx.beginPath(); ctx.moveTo(A.x + (Z.x - A.x) * span[0], A.y + (Z.y - A.y) * span[0]); ctx.lineTo(A.x + (Z.x - A.x) * span[1], A.y + (Z.y - A.y) * span[1]); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const e = this.edgeAt(p);
      if (!e) return;
      const A = this.vn[e.a], Z = this.vn[e.b], L = Math.hypot(Z.x - A.x, Z.y - A.y) || 1, ux = (Z.x - A.x) / L, uy = (Z.y - A.y) / L;
      ctx.globalAlpha = 0.75;
      if (def.obst === 'mire') drawMire(ctx, e.x - ux * def.span / 2, e.y - uy * def.span / 2, e.x + ux * def.span / 2, e.y + uy * def.span / 2, lt, 1);
      else drawBarricade(ctx, e.x, e.y, ux, uy, this.color(this.me).main, 1, 1);
      ctx.globalAlpha = 1;
      return;
    }
    if (def.target === 'ownCityPair') {
      if (T.src < 0) return;
      const a = this.vn[T.src], ok = h >= 0 && h !== T.src && this.targetOk(def, h);
      drawChronoLink(ctx, a, ok ? this.vn[h] : p, lt, ok);       // both bases marked, linked through the air: not a road
      if (ok) this.badge(ctx, this.vn[h].x, this.vn[h].y - this.topOf(h) - 16, t('skills.wormholeBadge', { n: def.capacity, s: def.dur }), '#2f7fe8');
      return;
    }
    if (h < 0 || !this.targetOk(def, h)) return;
    const n = this.vn[h];
    if (def.range) reach(n, def.range, col);               // an emplacement's reach
    if (def.radius) reach(n, def.radius, col);             // the blast: only this base is destroyed, columns inside are hurt
    if (def.target === 'enemyCity') this.badge(ctx, n.x, n.y - this.topOf(h) - 16, t(`skills.${def.id}.badge`), def.id === 'nuke' ? '#b3261e' : '#7a3fd0');
  }

  /** Obstacles on roads: disruption barriers lie on the ground, barricades stand across it. */
  drawRoadFeatures(ctx, st) {
    for (const o of this.featBy.obst) {
      if (o.u <= st) continue;
      const A = this.vn[o.a], Z = this.vn[o.b];
      const wa = this.map.nodes[o.a], wz = this.map.nodes[o.b];
      const L = Math.hypot(wz[0] - wa[0], wz[1] - wa[1]) || 1, f = o.x / L;     // o.x is measured from the lower-numbered city, in world units
      const x = A.x + (Z.x - A.x) * f, y = A.y + (Z.y - A.y) * f;
      const VL = Math.hypot(Z.x - A.x, Z.y - A.y) || 1, ux = (Z.x - A.x) / VL, uy = (Z.y - A.y) / VL;
      const left = (o.u - st) / Math.max(0.1, o.u - o.t0);
      const yaw = Math.atan2(uy / F, ux);                  // the road's direction on the ground
      if (o.k === 'mire') {
        if (this.g3) this.g3.add(`obs|mire|${Math.round(o.span / 4)}`, () => obstacleModel('mire', o.span), x, y, 0, yaw, 1);
        drawMire(ctx, x - ux * o.span / 2, y - uy * o.span / 2, x + ux * o.span / 2, y + uy * o.span / 2, st, left);
      } else {
        if (this.g3) this.g3.add('obs|block', () => obstacleModel('block'), x, y, 0, yaw + Math.PI / 2, 1);
        drawBarricade(ctx, x, y, ux, uy, this.color(o.p).main, o.hp / 10, left, !this.g3);
      }
    }
  }

  /** Wormholes: a portal over each end and the link between them, with what it can still carry. */
  drawPortals(ctx, st) {
    for (const w of this.featBy.worms) {
      if (w.u <= st) continue;
      // Each end stands on the open side of its base's compound.
      const a = { x: this.vn[w.a].x - 66, y: this.vn[w.a].y + 4 }, b = { x: this.vn[w.b].x - 66, y: this.vn[w.b].y + 4 };
      const left = (w.u - st) / Math.max(0.1, w.u - w.t0), tc = this.color(w.p);
      drawChronoLink(ctx, { x: a.x, y: a.y - 20 }, { x: b.x, y: b.y - 20 }, st, true);
      [a, b].forEach((q, j) => {
        if (this.g3) {
          const pose = portalPose(st, w.id + j * 3);
          this.g3.add(`portal|g|${tc.id}`, () => portalModel(tc, 'gate'), q.x, q.y, 0, 0, 1);
          this.g3.add(`portal|s|${tc.id}`, () => portalModel(tc, 'swirl'), q.x, q.y, pose.lift, pose.yaw, pose.scale);
        }
        drawPortal(ctx, q.x, q.y + 12, st, left, w.id + j * 3, !this.g3);
      });
      if (w.p === this.me) {
        const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 70 - Math.hypot(b.x - a.x, b.y - a.y) * 0.06;
        this.badge(ctx, mx, my, t('skills.wormholeLeft', { n: w.left, s: Math.max(0, Math.ceil(w.u - st)) }), '#2f7fe8');
      }
    }
  }

  /** What the tutorial is pointing at: pulsing rings on cities, a glow along roads. */
  setGuide(g) { this.guide = g && ((g.nodes && g.nodes.length) || (g.roads && g.roads.length)) ? g : null; }

  drawGuide(ctx, lt) {
    const g = this.guide;
    if (!g) return;
    const beat = 0.5 + 0.5 * Math.sin(lt * 5);
    ctx.strokeStyle = '#ffe07a';
    ctx.lineCap = 'round';
    for (const [a, b] of g.roads || []) {
      if (!this.vn[a] || !this.vn[b]) continue;
      ctx.globalAlpha = 0.3 + 0.3 * beat; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(this.vn[a].x, this.vn[a].y); ctx.lineTo(this.vn[b].x, this.vn[b].y); ctx.stroke();
    }
    for (const i of g.nodes || []) {
      const n = this.vn[i];
      if (!n) continue;
      const r = this.R + 16 + beat * 6;
      ctx.globalAlpha = 0.95; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.ellipse(n.x, n.y + 1, r, r * F + 2, 0, 0, TAU); ctx.stroke();
      const y = n.y - this.topOf(i) - 40 - beat * 6;        // an arrow pointing down at it
      ctx.fillStyle = '#ffe07a';
      ctx.beginPath(); ctx.moveTo(n.x - 9, y - 10); ctx.lineTo(n.x + 9, y - 10); ctx.lineTo(n.x, y + 4); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Cancel controls: for each route under the pointer (and for the selected city's persistent
   * route or the picked column) the route is lit end to end, its source and destination are
   * ringed, and a cross with the kind of order next to it stops it.
   */
  drawChips(ctx, lt) {
    if (!this.canPlay() || this.drag || this.targeting) return;
    const list = this.cancelChips(), p = this.ptr;
    if (!list.length) return;
    const col = this.color(this.me);
    for (const c of list) {
      const hot = !!p && Math.hypot(p.x - c.x, p.y - c.y) <= 12;
      ctx.strokeStyle = hot ? '#ff8a7a' : c.kind === 'auto' ? col.light : '#ffffff';
      ctx.globalAlpha = hot ? 1 : 0.75;
      ctx.lineWidth = hot ? 4 : 3;
      ctx.setLineDash(c.kind === 'auto' ? [2, 7] : [9, 6]);
      ctx.beginPath();
      c.pts.forEach((q, i) => { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
      ctx.stroke();
      ctx.setLineDash([]);
      for (const id of [c.src, c.dest]) {
        if (id == null || id < 0) continue;
        const n = this.vn[id];
        ctx.beginPath(); ctx.ellipse(n.x, n.y + 1, this.R + 14, (this.R + 14) * F + 2, 0, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      drawCancel(ctx, c.x, c.y, c.kind === 'auto' ? col.light : '#ffffff', hot);
      if (hot || list.length === 1) {
        const label = c.kind === 'auto' ? t('game.cancel.auto') : t('game.cancel.march', { n: fmt(c.n) });
        ctx.font = `700 11px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(10,12,13,.92)';
        ctx.beginPath(); ctx.roundRect(c.x + 14, c.y - 9, w, 18, 3); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, c.x + 19, c.y + 0.5);
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
    let label, off, max = false;
    if (this.isRuin(i)) {
      // A ruin is rebuilt, not upgraded: it costs soldiers and takes time, and comes back at level 1.
      const rb = this.featBy.rebuild.get(i), R = this.cfg.ruin;
      if (rb) { label = t('game.rebuilding', { s: Math.max(0, Math.ceil(rb.u - this.serverNow())) }); off = true; }
      else { label = t('game.rebuild', { cost: R.cost, s: R.time }); off = this.shown(i) < R.cost; }
    } else if (lv >= 3) {
      label = t('game.maxLevel', { name: this.buildingName(this.me, lv) });
      off = max = true;
    } else {
      const cost = this.levels[lv].upCost;
      label = t('game.upgradeTo', { name: this.buildingName(this.me, lv + 1), cost });
      off = this.shown(i) < cost;
    }
    if (this.upLabel !== label) { this.upLabel = label; b.lastElementChild.textContent = label; }
    b.disabled = off;
    b.classList.toggle('max', max);
    b.classList.remove('hidden');
    const half = b.offsetWidth / 2 + 6;
    const sx = this.ox + n.x * this.s;
    const sy = this.oy + (n.y - this.topOf(i) - 18) * this.s;
    b.style.left = `${Math.max(half, Math.min(this.cv.clientWidth - half, sx))}px`;
    b.style.top = `${Math.max(88, sy)}px`;
  }

  /** Details card for the selected (or hovered) city. */
  updateInfo() {
    const el = this.els.info;
    const i = this.sel >= 0 ? this.sel : this.hover;
    if (i < 0 || this.drag || this.targeting) {
      if (this.infoSig) { el.classList.add('hidden'); this.infoSig = ''; }
      return;
    }
    const o = this.owner[i], lv = this.level[i], ruin = this.isRuin(i);
    const au = o === this.me ? this.autos.get(i) : null;
    const inc = o === this.me ? this.incoming(i) : 0;
    const emps = this.featBy.emp.get(i) || [];
    const rb = this.featBy.rebuild.get(i);
    const sig = `${i}|${o}|${lv}|${this.units[i]}|${this.st.power[i]}|${getLang()}|${ruin ? 1 : 0}|${inc}|${this.featRev}|${rb ? Math.ceil(rb.u - this.serverNow()) : ''}|${au ? `${au.dest},${au.pct},${this.paused ? 5 : au.state}` : ''}`;
    if (sig === this.infoSig) return;
    this.infoSig = sig;
    const L = this.levels[lv], cap = this.capOf(i), u = this.units[i];
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
    head.append(mk('strong', '', ruin ? t('info.ruin') : this.buildingName(o, lv)), mk('span', 'info-lv', ruin ? '' : t('info.level', { n: lv })));
    const stats = mk('div', 'info-stats');
    const add = (text, cls) => { for (const part of String(text).split(' · ')) stats.append(mk('span', cls || '', part)); };   // one chip per figure, so the row wraps
    add(ruin ? t('info.garrisonRuin', { n: u, cap }) : t('info.garrison', { n: u, threshold: L.threshold, cap }));
    add(t('info.power', { n: this.st.power[i] }), 'pwr');
    el.append(head, mk('div', 'info-owner', o >= 0 ? this.pname(o) : t('info.neutral')));
    if (ruin) {
      el.append(mk('p', 'info-desc', t('info.ruinDesc')));
      if (rb) el.append(mk('p', 'info-note', t('info.rebuilding', { s: Math.max(0, Math.ceil(rb.u - this.serverNow())) })));
      else if (o >= 0) el.append(mk('p', 'info-note', t('info.ruinHeld', { cost: this.cfg.ruin.cost, s: this.cfg.ruin.time })));
    } else if (o >= 0) {
      const s = this.sides[o], F0 = this.cfg.factions[s.f], U = F0.subs[s.sub].units[lv];
      const fac = mk('div', 'info-fac');
      const img = mk('img');
      img.src = insigniaURL(s.f, s.sub, s.tc);
      img.alt = '';
      fac.append(img, mk('span', '', t('info.faction', { faction: t(`factions.${s.f}.name`), sub: t(`factions.${s.f}.subs.${s.sub}.name`) })));
      el.append(fac, mk('div', 'info-unit', t('info.trains', { unit: t(`units.${U.id}.name`), weapon: t(`weapons.${weaponOf(s.f, s.sub, lv)}`) })));
      el.append(mk('p', 'info-desc', t(`units.${U.id}.desc`)));
      add(t('info.production', { rate: +(L.prod * F0.prod).toFixed(2) }));
      add(t('info.unitStats', { hp: U.hp, atk: +(U.atk / U.interval).toFixed(1), armor: U.armor, range: U.range, speed: +U.move.toFixed(2) }));
      if (lv >= 2) el.append(mk('p', 'info-desc', t(`abilities.${s.f}.${lv}`)));
      // Two separate limits: production stops at the threshold; reinforcements stop at the capacity.
      el.append(mk('p', 'info-note', t(u >= cap ? 'info.full' : u >= L.threshold ? 'info.paused' : 'info.producing', { cap })));
      if (inc > 0) el.append(mk('p', 'info-note', t('info.incoming', { n: inc, room: Math.max(0, cap - u - inc) })));
    } else {
      el.append(mk('p', 'info-desc', t(`levels.${lv}.desc`)), mk('p', 'info-note', t('info.idle')));
    }
    for (const e of emps) el.append(mk('p', 'info-auto', t('info.emplacement', { name: t(`features.${e.k}`), who: this.pname(e.p), s: Math.max(0, Math.ceil(e.u - this.serverNow())) })));
    if (au) el.append(mk('p', 'info-auto', t('game.auto.info', { pct: Math.round(au.pct * 100), state: t(`game.auto.state.${this.paused ? 5 : au.state}`) })));
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
