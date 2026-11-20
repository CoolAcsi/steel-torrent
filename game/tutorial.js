'use strict';
// The playable tutorial: eleven short lessons, each a real match on a small hand-made map.
//
// A lesson runs in the ordinary simulation and is played with the ordinary orders. What makes
// it a lesson is a list of steps, each with a completion check that reads the authoritative
// state: what the simulation holds, the events it emitted, and the orders the player's client
// actually sent. A step is never passed by a timer or a "next" button. The few things the
// server cannot see (looking at a base, moving the camera, pressing a locked button) are
// reported by the client and accepted only for the step that asks for them.
//
// A lesson may have several parts. Each part is its own small scenario (its own map and, where
// the lesson needs it, its own roster), started as a fresh match.
const { BALANCE: B, FACTIONS } = require('./config');
const { Game, makeGroup } = require('./sim');

const ME = 0, FOE = 1;
const TOTAL = 11;
const FOE_ROSTER = ['veil', 'forge'];
const SPEEDS = B.speeds;

// ------------------------------------------------------------ small helpers for checks

const mine = c => c.owner === ME;
const sends = ctx => ctx.msgs.filter(m => m.t === 'send');
const accepted = (m, from) => m.res.some(r => r[1] > 0 && (from == null || r[0] === from));
const saw = (ctx, k, f) => ctx.ev.some(e => e.k === k && (!f || f(e)));
const did = (ctx, what, node) => ctx.did.some(d => d.did === what && (node == null || d.node === node));
const empOf = (g, kind) => g.emps.some(e => e.owner === ME && e.kind === kind);
const obstOf = (g, kind) => g.obst.some(o => o.owner === ME && o.kind === kind);
/** Give one of the player's bases exactly `n` soldiers of its own first tier (a scripted reset between steps). */
const setGarrison = (g, id, n) => {
  const c = g.nodes[id], p = g.players[c.owner];
  if (!p) return;
  c.groups = [makeGroup(p.faction, p.sub, 1, n)];
};
const foeColumn = (g, from, to, n, s, o = {}) => {
  const p = g.players[FOE];
  const a = g.newArmy(FOE, from, to, [makeGroup(p.faction, p.sub, o.tier || 1, n)], s);
  if (o.hold) a.hold = true;
  return a;
};
const hostile = g => g.armies.filter(a => a.owner === FOE && a.groups.length);

// ------------------------------------------------------------ lessons
//
// (The lesson panel sits over the top right of the screen, so no map puts a base there.)
// part:  { roster, names: { A: nodeId, ... }, map: [[x, y, owner, level, soldiers], ...], roads,
//          setup(g, ctx, sess), tick(g, ctx, sess), steps: [...] | sess => [...] }
// step:  { key, at: ['A', ...], roads: [['A', 'B']], hud: [css selectors], want, tap,
//          check(g, ctx, sess), enter(g, ctx, sess) }
//   `want` names a client-reported action this step accepts (inspect, pan, zoom, locked).
//   `tap` asks the overlay to make its HUD highlight clickable, for a button that is disabled.
// ctx:   { ev: events this step, msgs: orders this step, did: client reports this step,
//          env: { paused, speed }, mem: {}, t0 }

const SKILL = n => `#skills .skill:nth-child(${n})`;

const LESSONS = [null,
  // 1 ------------------------------------------------------------------ camera and inspection
  { id: 'camera', parts: [{
    names: { A: 0, B: 1, C: 2, D: 3 },
    map: [[200, 300, ME, 2, 25], [430, 170, -1, 1, 6], [680, 380, FOE, 3, 30], [430, 480, -1, 2, 8]],
    roads: [[0, 1], [1, 2], [0, 3], [3, 2]],
    steps: sess => [
      ...(sess.caps.camera ? [
        // Zoom first: with the whole map on screen there is nowhere for the camera to move.
        { key: 'zoom', want: 'zoom', check: (g, ctx) => did(ctx, 'zoom') },
        { key: 'pan', want: 'pan', check: (g, ctx) => did(ctx, 'pan') },
      ] : []),
      { key: 'own', at: ['A'], want: 'inspect', check: (g, ctx) => did(ctx, 'inspect', 0) },
      { key: 'neutral', at: ['B'], want: 'inspect', check: (g, ctx) => did(ctx, 'inspect', 1) },
      { key: 'enemy', at: ['C'], want: 'inspect', check: (g, ctx) => did(ctx, 'inspect', 2) },
    ],
  }] },

  // 2 ------------------------------------------------------------------ ownership, threshold, capacity
  { id: 'capacity', parts: [{
    names: { A: 0, B: 1, C: 2, N: 3, F: 4 },
    map: [[200, 190, ME, 1, 16], [470, 430, ME, 1, 55], [200, 430, ME, 1, 60], [470, 190, -1, 1, 4], [720, 310, FOE, 1, 10]],
    roads: [[0, 2], [2, 1], [1, 3], [0, 3], [3, 4]],
    steps: [
      // A fills to its production threshold and stops there, while the player is looking at it.
      { key: 'threshold', at: ['A'], want: 'inspect', check: (g, ctx) => did(ctx, 'inspect', 0) && g.nodes[0].units >= B.levels[g.nodes[0].level].threshold },
      // Production alone never passes the threshold, so more than that means reinforcements went in.
      { key: 'reinforce', at: ['C', 'A'], check: g => mine(g.nodes[0]) && g.nodes[0].units > B.levels[g.nodes[0].level].threshold },
      // B has five places left: an order from C fills it and the rest of the share stays at home.
      { key: 'full', at: ['C', 'B'], check: g => mine(g.nodes[1]) && g.nodes[1].units >= g.capOf(g.nodes[1]) },
      { key: 'out', at: ['B', 'N'], check: (g, ctx) => sends(ctx).some(m => accepted(m, 1)) },
    ],
  }] },

  // 3 ------------------------------------------------------------------ single-city dispatch
  { id: 'dispatch', parts: [{
    names: { A: 0, B: 1, F: 2 },
    map: [[220, 300, ME, 1, 20], [480, 300, -1, 1, 5], [760, 300, FOE, 1, 12]],
    roads: [[0, 1], [1, 2]],
    steps: [
      { key: 'send', at: ['A', 'B'], check: (g, ctx) => sends(ctx).some(m => m.to === 1 && accepted(m, 0)) },
      { key: 'capture', at: ['B'], check: g => mine(g.nodes[1]) },
      { key: 'all', at: ['A', 'B'], hud: ['#pct'], check: (g, ctx) => sends(ctx).some(m => m.pct >= 0.99 && accepted(m)) },
    ],
  }] },

  // 4 ------------------------------------------------------------------ multi-city selection, pathfinding
  { id: 'multi', parts: [{
    names: { A: 0, B: 1, C: 2, T: 3, F: 4 },
    map: [[180, 180, ME, 1, 20], [180, 430, ME, 1, 20], [430, 305, ME, 1, 20], [690, 305, -1, 1, 10], [930, 305, FOE, 1, 12]],
    roads: [[0, 2], [1, 2], [2, 3], [0, 1], [3, 4]],
    steps: [
      // One order, at least two of my bases in it, and at least one of them not next to the target.
      { key: 'order', at: ['A', 'B', 'C', 'T'], check: (g, ctx) => sends(ctx).some(m => m.to === 3 && m.res.filter(r => r[1] > 0).length >= 2 && m.res.some(r => r[1] > 0 && r[2] >= 2)) },
      { key: 'capture', at: ['T'], check: g => mine(g.nodes[3]) },
    ],
  }] },

  // 5 ------------------------------------------------------------------ interception and combat
  { id: 'combat', parts: [{
    names: { A: 0, E: 1 },
    map: [[200, 300, ME, 1, 30], [780, 300, FOE, 1, 5]],
    roads: [[0, 1]],
    setup(g, ctx) { ctx.mem.col = foeColumn(g, 1, 0, 6, 150, { hold: true }); },
    tick(g, ctx) {
      // The enemy column camps on the road until the player marches; then it comes on. Until the
      // player has won a fight on the road, a lost or wasted column is replaced by another.
      const col = ctx.mem.col, out = g.armies.some(a => a.owner === ME && a.groups.length);
      if (col && col.groups.length && col.hold && out) col.hold = false;
      if (g.stats[ME].encWon < 1 && !hostile(g).length && !g.nodes[1].siege.length && g.nodes[1].owner === FOE) {
        ctx.mem.col = foeColumn(g, 1, 0, 6, 150, { hold: true });
      }
    },
    steps: [
      { key: 'march', at: ['A', 'E'], roads: [['A', 'E']], check: (g, ctx) => saw(ctx, 'clash') && g.armies.some(a => a.owner === ME && a.state === 'engaged') },
      { key: 'win', roads: [['A', 'E']], check: g => g.stats[ME].encWon >= 1 },
      { key: 'siege', at: ['E'], check: g => mine(g.nodes[1]) },
    ],
  }] },

  // 6 ------------------------------------------------------------------ upgrades and troop tiers
  { id: 'upgrade', parts: [{
    names: { A: 0, N: 1, F: 2 },
    map: [[240, 300, ME, 1, 45], [500, 300, -1, 1, 6], [770, 300, FOE, 1, 10]],
    roads: [[0, 1], [1, 2]],
    steps: [
      { key: 'up2', at: ['A'], hud: ['#btn-upgrade'], check: g => mine(g.nodes[0]) && g.nodes[0].level >= 2 },
      { key: 'tier2', at: ['A'], want: 'inspect', check: (g, ctx) => did(ctx, 'inspect', 0) && g.nodes[0].groups.some(x => x.t >= 2 && x.n > 0) },
      { key: 'up3', at: ['A'], hud: ['#btn-upgrade'], check: g => mine(g.nodes[0]) && g.nodes[0].level >= 3 },
      { key: 'mixed', at: ['A', 'N'], check: (g, ctx) => sends(ctx).some(m => accepted(m, 0)) },
    ],
  }] },

  // 7 ------------------------------------------------------------------ persistent dispatch, cancelling
  { id: 'auto', parts: [{
    names: { A: 0, B: 1, F: 2 },
    map: [[190, 320, ME, 2, 30], [800, 320, ME, 1, 8], [800, 540, FOE, 1, 12]],
    roads: [[0, 1], [1, 2]],
    // In the two steps about a single column it marches at a walk, so there is time to point at it.
    tick(g, ctx, sess) {
      if (!g.walkable) { const base = g.baseSpeed.bind(g); g.baseSpeed = a => base(a) * (g.walk && a.owner === ME ? 0.35 : 1); g.walkable = true; }
      g.walk = sess.step >= 2;
    },
    steps: [
      { key: 'on', at: ['A', 'B'], hud: ['#btn-auto'], check: g => [...g.autos.values()].some(o => o.src === 0 && o.owner === ME) },
      { key: 'off', at: ['A'], roads: [['A', 'B']], hud: ['#btn-auto-stop'], check: (g, ctx) => ![...g.autos.values()].some(o => o.src === 0) && ctx.msgs.some(m => m.t === 'auto' && m.off),
        // The next two steps are about single orders. What the route already delivered is taken
        // off the board, so B has room again and A has troops to send, however long the route ran.
        after(g) {
          g.armies = g.armies.filter(a => a.owner !== ME);
          setGarrison(g, 0, 30); setGarrison(g, 1, 8);
        } },
      // `mode: 'once'` has the client drop back to single dispatch: with Auto still on, a drag
      // would make another persistent route, and there would be no marching order to cancel.
      { key: 'halt', mode: 'once', at: ['A', 'B'], roads: [['A', 'B']], hud: ['#btn-auto'], check: (g, ctx) => saw(ctx, 'route', e => e.p === ME && e.why === 'held') },
      { key: 'redirect', mode: 'once', at: ['A', 'B'], check: (g, ctx) => saw(ctx, 'route', e => e.p === ME && e.why === 'new') },
    ],
  }] },

  // 8 ------------------------------------------------------------------ pause and the five speeds
  { id: 'time', parts: [{
    names: { A: 0, B: 1 },
    map: [[200, 300, ME, 2, 40], [780, 300, ME, 1, 12]],
    roads: [[0, 1]],
    setup(g) {
      // Columns shuttle between the two bases, so there is always something to watch.
      g.setAuto(ME, [0], 1, 0.25);
      g.setAuto(ME, [1], 0, 0.25);
    },
    tick(g, ctx) { (ctx.mem.speeds || (ctx.mem.speeds = new Set())).add(ctx.env.speed); },
    steps: [
      { key: 'pause', hud: ['#btn-pause'], check: (g, ctx) => ctx.env.paused },
      { key: 'resume', hud: ['#btn-pause'], check: (g, ctx) => !ctx.env.paused },
      { key: 'fast', hud: ['#speed'], check: (g, ctx) => ctx.env.speed === Math.max(...SPEEDS) },
      { key: 'slow', hud: ['#speed'], check: (g, ctx) => ctx.env.speed === Math.min(...SPEEDS) },
      { key: 'all', hud: ['#speed'], check: (g, ctx) => SPEEDS.every(v => ctx.mem.speeds.has(v)) && ctx.env.speed === B.defaultSpeed },
    ],
  }] },

  // 9 ------------------------------------------------------------------ shields, towers, obstacles
  { id: 'defense', parts: [
    { // Meridian: Base Shield, Suppression Emplacement
      roster: ['meridian', 'aegis'],
      names: { A: 0, B: 1, E: 2 },
      map: [[240, 220, ME, 2, 30], [240, 470, ME, 1, 15], [760, 470, FOE, 1, 20]],
      roads: [[0, 2], [0, 1]],
      setup(g) { g.players[ME].cd = [0, 0]; },
      steps: [
        { key: 'shield', at: ['A'], hud: [SKILL(1)], check: g => !!g.nodes[0].aegis,
          // The attack the shield was raised against arrives a moment later.
          after(g) { foeColumn(g, 2, 0, 12, g.dist(2, 0) - 170); } },
        { key: 'absorb', at: ['A'], check: g => g.stats[ME].absorbed > 0 },
        { key: 'tower', at: ['B'], hud: [SKILL(2)], check: g => empOf(g, 'slow') },
      ],
    },
    { // Iron: Deploy Defense, Route Barricade. The only road that touches the player's base is A-E.
      roster: ['iron', 'bastion'],
      names: { A: 0, E: 1, N: 2 },
      map: [[240, 220, ME, 2, 30], [760, 470, FOE, 1, 20], [430, 540, -1, 1, 6]],
      roads: [[0, 1], [1, 2]],
      setup(g) { g.players[ME].cd = [0, 0]; },
      tick(g, ctx) { if (hostile(g).some(a => a.atBlock)) ctx.mem.blocked = true; },
      steps: [
        { key: 'turret', at: ['A'], hud: [SKILL(1)], check: g => empOf(g, 'turret') },
        { key: 'block', roads: [['A', 'E']], hud: [SKILL(2)], check: g => obstOf(g, 'block'),
          // A column sets out along the barricaded road as soon as the barricade stands.
          after(g) { foeColumn(g, 1, 0, 14, 10); } },
        { key: 'held', roads: [['A', 'E']], check: (g, ctx) => !!ctx.mem.blocked },
      ],
    },
    { // Veil: Psychic Guard, Disruption Barrier
      roster: ['veil', 'dominion'],
      names: { A: 0, E: 1, N: 2 },
      map: [[240, 220, ME, 2, 30], [760, 470, FOE, 1, 20], [430, 540, -1, 1, 6]],
      roads: [[0, 1], [1, 2]],
      foe: ['iron', 'bastion'],
      setup(g) { g.players[ME].cd = [0, 0]; },
      steps: [
        { key: 'psi', at: ['A'], hud: [SKILL(1)], check: g => empOf(g, 'psi') },
        { key: 'mire', roads: [['A', 'E']], hud: [SKILL(2)], check: g => obstOf(g, 'mire') },
      ],
    },
  ] },

  // 10 ----------------------------------------------------------------- superweapons
  { id: 'super', pick: true, parts: [{
    names: { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 },
    map: [[190, 190, ME, 3, 30], [190, 450, ME, 3, 30], [420, 320, ME, 2, 12], [900, 480, ME, 1, 10], [670, 390, FOE, 2, 25], [640, 580, FOE, 1, 10]],
    roads: [[0, 2], [1, 2], [2, 4], [4, 5], [4, 3]],
    foe: sess => (sess.roster[0] === 'veil' ? ['iron', 'bastion'] : FOE_ROSTER),
    setup(g) { const p = g.players[ME]; p.charge = p.need - 6; },
    // C cannot afford its upgrade by itself until the locked button has been tried: while that
    // step is open it produces nothing, so the third level-3 base cannot come first.
    tick(g, ctx, sess) { if (sess.step === 0) g.nodes[2].acc = 0; },
    steps: sess => {
      const f = sess.roster[0];
      const fired = (g, ctx) => saw(ctx, 'cast', e => e.p === ME && e.skill === B.skills[f][2].id);
      return [
        // The button is locked: the player presses it anyway (the client reports the press, or a
        // refused cast reaches the server) while two level-3 bases are all they hold.
        { key: 'locked', hud: [SKILL(3)], want: 'locked', tap: true,
          check: (g, ctx) => g.level3Count(ME) < B.skills.superNeedsL3 && (did(ctx, 'locked') || ctx.msgs.some(m => m.t === 'skill' && m.slot === 2)) },
        { key: 'third', at: ['A', 'B', 'C'], hud: ['#btn-upgrade'], check: g => g.level3Count(ME) >= B.skills.superNeedsL3 },
        { key: `cast_${f}`, at: f === 'meridian' ? ['A', 'D'] : ['E'], hud: [SKILL(3)], check: fired },
        f === 'iron' ? { key: 'result_iron', at: ['E'], check: (g, ctx) => saw(ctx, 'ruin', e => e.by === ME) }
          : f === 'veil' ? { key: 'result_veil', at: ['E'], check: (g, ctx) => saw(ctx, 'cap', e => e.by === ME && e.mind) }
          : { key: 'result_meridian', at: ['A', 'D'], check: (g, ctx) => saw(ctx, 'warp', e => e.p === ME) },
      ];
    },
  }] },

  // 11 ----------------------------------------------------------------- ruins
  { id: 'ruin', parts: [{
    names: { A: 0, R: 1, F: 2 },
    map: [[220, 300, ME, 1, 45], [500, 300, FOE, 2, 20], [800, 300, FOE, 1, 10]],
    roads: [[0, 1], [1, 2]],
    setup(g) {
      // An allied nuclear strike is already on its way to R: announced like any other, landing like any other.
      const def = B.skills.iron[2], c = g.nodes[1], delay = 6;
      g.strikes.push({ id: g.nextId++, kind: 'nuke', owner: ME, node: 1, x: c.x, y: c.y, r: def.radius, at: g.t + delay, def });
      g.outEvents.push({ k: 'cast', p: ME, skill: 'nuke', node: 1, x: c.x, y: c.y, r: def.radius, delay });
    },
    steps: [
      { key: 'strike', at: ['R'], want: 'inspect', check: (g, ctx) => g.nodes[1].ruin && did(ctx, 'inspect', 1) },
      { key: 'capture', at: ['A', 'R'], check: g => g.nodes[1].ruin && mine(g.nodes[1]) },
      { key: 'rebuild', at: ['R'], hud: ['#btn-upgrade'], check: g => mine(g.nodes[1]) && (!!g.nodes[1].rebuild || !g.nodes[1].ruin) },
      { key: 'rebuilt', at: ['R'], check: g => mine(g.nodes[1]) && !g.nodes[1].ruin },
    ],
  }] },
];

// ------------------------------------------------------------ sessions

const validRoster = (f, sub) => typeof f === 'string' && Object.hasOwn(FACTIONS, f) && FACTIONS[f].includes(sub);
const lessonNo = v => (Number.isInteger(v) && v >= 1 && v <= TOTAL ? v : 0);
const cleanList = v => (Array.isArray(v) ? [...new Set(v.slice(0, 2 * TOTAL).filter(x => lessonNo(x)))] : []);

/** A new tutorial session. `m` is the client's opening message: its roster, what it can report, its saved progress. */
function session(m = {}) {
  const prog = m.prog && typeof m.prog === 'object' ? m.prog : {};
  const done = new Set(cleanList(prog.done));
  return {
    n: 0, part: 0, step: 0, game: null, def: null, steps: null, ctx: null, done: false, failed: false,
    pref: validRoster(m.faction, m.sub) ? [m.faction, m.sub] : ['iron', 'bastion'],
    roster: null, foe: null,
    caps: { camera: !!(m.caps && m.caps.camera) },
    prog: { done, skipped: new Set(cleanList(prog.skipped).filter(n => !done.has(n))) },
  };
}

/** The lesson to play when none is named: the first not yet completed or skipped, else the first skipped, else the first. */
function firstOpen(sess) {
  for (let n = 1; n <= TOTAL; n++) if (!sess.prog.done.has(n) && !sess.prog.skipped.has(n)) return n;
  for (let n = 1; n <= TOTAL; n++) if (!sess.prog.done.has(n)) return n;
  return 1;
}

/**
 * Begin lesson `n` at `part`: a fresh match in its scripted state. Returns the rosters for the
 * two seats, [mine, opponent], each [faction, sub]; the match is `sess.game`.
 */
function begin(sess, n, part = 0) {
  const def = LESSONS[n], P = def.parts[part];
  sess.n = n; sess.part = part; sess.step = 0; sess.def = def; sess.done = false;
  sess.run = (sess.run || 0) + 1;                // every (re)start is a new run: the client forgets what it reported in the last one
  sess.roster = P.roster || sess.pref;
  sess.foe = typeof P.foe === 'function' ? P.foe(sess) : P.foe || FOE_ROSTER;
  const xs = P.map.map(p => p[0]), ys = P.map.map(p => p[1]);
  const g = new Game(
    [{ ai: null, faction: sess.roster[0], sub: sess.roster[1] }, { ai: null, faction: sess.foe[0], sub: sess.foe[1] }],
    n * 100 + part,
    { crates: false, map: { w: Math.max(...xs) + 160, h: Math.max(...ys) + 160, nodes: P.map, edges: P.roads } },
  );
  // A lesson is not a match to be won or lost: nobody is eliminated and it never ends by itself.
  // (Losing every base restarts the lesson instead, see advance.)
  g.checkEliminations = () => {};
  sess.game = g;
  sess.ctx = { ev: [], msgs: [], did: [], env: { paused: false, speed: B.defaultSpeed }, mem: {}, t0: 0 };
  sess.steps = typeof P.steps === 'function' ? P.steps(sess) : P.steps;
  if (P.setup) P.setup(g, sess.ctx, sess);
  return [sess.roster, sess.foe];
}

/** Events the simulation emitted since the last call. */
function observe(sess, events) {
  if (!sess.ctx || sess.done) return;
  for (const e of events) sess.ctx.ev.push(e);
  if (sess.ctx.ev.length > 400) sess.ctx.ev.splice(0, sess.ctx.ev.length - 400);
}

/**
 * An order the player's client sent, after the server has dealt with it. Dispatch orders are
 * recorded with the simulation's own per-city answer, so a check sees what really happened.
 */
function note(sess, m) {
  const ctx = sess.ctx, g = sess.game;
  if (!ctx || !g || sess.done) return;
  const res = Number.isInteger(m.id) ? g.players[ME].results.get(m.id) : null;
  if (m.t === 'send' && Array.isArray(m.from)) ctx.msgs.push({ t: 'send', from: m.from, to: m.to | 0, pct: Number(m.pct) || 0, res: res || [] });
  else if (m.t === 'auto') ctx.msgs.push({ t: 'auto', off: !!m.off, res: res || [] });
  else if (m.t === 'skill') ctx.msgs.push({ t: 'skill', slot: m.slot });
  else if (m.t === 'tut') {
    // Client-reported actions count only for the step that asks for them, about a base that exists.
    const step = sess.steps[sess.step];
    if (!step || step.want !== m.did) return;
    if (m.did === 'inspect' && !(Number.isInteger(m.node) && g.nodes[m.node])) return;
    ctx.did.push({ did: m.did, node: m.did === 'inspect' ? m.node : undefined });
  }
  if (ctx.msgs.length > 60) ctx.msgs.shift();
}

/**
 * Run the lesson's script and its completion checks. `env` is the room's { paused, speed }.
 * Returns what changed: null, 'step', 'part' (the next part must be started), 'done' (lesson
 * complete) or 'fail' (the player lost every base: the part must be started again).
 */
function advance(sess, env) {
  const g = sess.game, ctx = sess.ctx;
  if (!g || !ctx || sess.done) return null;
  ctx.env = env;
  const P = sess.def.parts[sess.part];
  // The opponent in a lesson is a target, not a player: its bases keep the garrison they were given.
  for (const c of g.nodes) if (c.owner === FOE) c.acc = 0;
  if (P.tick) P.tick(g, ctx, sess);
  if (!g.nodes.some(mine)) { sess.failed = true; return 'fail'; }
  let changed = null;
  while (sess.step < sess.steps.length && sess.steps[sess.step].check(g, ctx, sess)) {
    const passed = sess.steps[sess.step];
    if (passed.after) passed.after(g, ctx, sess);
    sess.step++;
    ctx.ev = []; ctx.msgs = []; ctx.did = []; ctx.t0 = g.t;
    changed = 'step';
  }
  if (sess.step < sess.steps.length) return changed;
  if (sess.part + 1 < sess.def.parts.length) return 'part';
  sess.done = true;
  sess.prog.done.add(sess.n);
  sess.prog.skipped.delete(sess.n);
  return 'done';
}

/** The player gives up on the current lesson: recorded as skipped, never as completed. */
function skip(sess) {
  if (sess.n && !sess.done && !sess.prog.done.has(sess.n)) sess.prog.skipped.add(sess.n);
}

function reset(sess) {
  sess.prog.done.clear();
  sess.prog.skipped.clear();
}

/** What the client is told: where the lesson stands, what to say, what to point at. */
function message(sess) {
  const def = sess.def, parts = def.parts;
  // Step numbers run through the whole lesson. Later parts are counted from their definitions.
  const count = (P, i) => (i === sess.part ? sess.steps.length : (typeof P.steps === 'function' ? P.steps(sess) : P.steps).length);
  let before = 0, total = 0;
  parts.forEach((P, i) => { const k = count(P, i); if (i < sess.part) before += k; total += k; });
  const names = parts[sess.part].names, step = sess.done ? null : sess.steps[sess.step];
  const id = l => names[l];
  const hi = step ? {
    nodes: (step.at || []).map(id),
    labels: Object.fromEntries(Object.entries(names).map(([l, n]) => [n, l])),
    roads: (step.roads || []).map(([a, b]) => [id(a), id(b)]),
    hud: step.hud || [],
    tap: step.tap || undefined,
  } : { nodes: [], labels: Object.fromEntries(Object.entries(names).map(([l, n]) => [n, l])), roads: [], hud: [] };
  const failed = sess.failed;
  sess.failed = false;
  return {
    t: 'lesson', n: sess.n, of: TOTAL, id: def.id, part: sess.part + 1, parts: parts.length, run: sess.run,
    step: sess.done ? total : before + sess.step + 1, total,
    key: sess.done ? `tutorial.l${sess.n}.done` : `tutorial.l${sess.n}.${parts.length > 1 ? `p${sess.part + 1}_` : ''}${step.key}`,
    want: step ? step.want : undefined, mode: step ? step.mode : undefined, hi, done: sess.done || undefined,
    all: sess.prog.done.size >= TOTAL || undefined, failed: failed || undefined,
    pick: def.pick ? Object.keys(FACTIONS) : undefined, faction: sess.roster[0], sub: sess.roster[1],
    prog: { done: [...sess.prog.done].sort((a, b) => a - b), skipped: [...sess.prog.skipped].sort((a, b) => a - b) },
  };
}

/** Every text key a lesson can show, for the locale tests. */
function allKeys() {
  const out = [];
  for (let n = 1; n <= TOTAL; n++) {
    const def = LESSONS[n];
    out.push(`tutorial.l${n}.title`, `tutorial.l${n}.done`);
    def.parts.forEach((P, i) => {
      const variants = def.pick ? Object.keys(FACTIONS).map(f => [f, FACTIONS[f][0]]) : [P.roster || ['iron', 'bastion']];
      for (const roster of variants) {
        for (const caps of [{ camera: true }, { camera: false }]) {
          const steps = typeof P.steps === 'function' ? P.steps({ roster, caps }) : P.steps;
          for (const s of steps) out.push(`tutorial.l${n}.${def.parts.length > 1 ? `p${i + 1}_` : ''}${s.key}`);
        }
      }
    });
  }
  return [...new Set(out)];
}

module.exports = { TOTAL, LESSONS, session, firstOpen, begin, observe, note, advance, skip, reset, message, allKeys, lessonNo, validRoster };
