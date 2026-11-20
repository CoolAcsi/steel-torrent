// Lobby, room and connection handling. The match itself lives in game.js.
import { GameView } from './game.js';
import { COLORS } from './art.js';
import { insigniaURL } from './buildings.js';
import { FACTION_IDS, subIds, normalize } from './factions.js';
import { sfx } from './sfx.js';
import { SKILL_COLOR } from './fx.js';
import { t, fmt, applyDom, setLang, getLang, languages, onLangChange } from './i18n.js';

const $ = id => document.getElementById(id);
const AI_LEVELS = ['easy', 'normal', 'hard'];

const store = {
  get(area, k) { try { return area.getItem(k); } catch { return null; } },
  set(area, k, v) { try { area.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  ws: null,
  id: null,
  lan: [],
  port: 0,
  publicUrl: '',
  room: null,
  rooms: [],
  me: -1,            // my seat in the running match
  overlay: null,     // what the end-of-match overlay shows, so it can be re-translated
  pendingJoin: (new URLSearchParams(location.search).get('room') || '').toUpperCase(),
};

const view = new GameView($('cv'), { hud: $('hud-players'), upgrade: $('btn-upgrade'), cityActions: $('city-actions'), info: $('info'), gl: $('gl') }, {
  send: (from, to, pct, id) => send({ t: 'send', from, to, pct, id }),
  skill: (slot, args, id) => send({ t: 'skill', slot, args, id }),
  // Announce superweapons from anyone, and my own casts.
  onCast: e => { if (e.p === state.me || e.skill === 'nuke' || e.skill === 'phase' || e.skill === 'dominion') toast(t('game.cast', { name: view.pname(e.p), skill: t(`skills.${e.skill}.name`) })); },
  onCrate: e => { if (e.by === state.me) toast(t('game.cratePicked', { reward: t(`crates.${e.reward}.name`), desc: t(`crates.${e.reward}.desc`) })); },
  upgrade: node => (view.paused ? toast(t('game.paused')) : send({ t: 'up', node })),
  // Persistent orders: set (or, with `off`, stop) auto dispatch for these cities. The server keeps and runs them.
  auto: (from, to, pct, id, off) => send({ t: 'auto', from, to, pct, id, off: off || undefined }),
  autoPairs: (pairs, pct, id, replace) => send({ t: 'auto', pairs, pct, id, replace: replace || undefined }),
  autoSegOff: (segFrom, segTo, id) => send({ t: 'auto', off: true, segFrom, segTo, id }),
  onCtl: (c, was) => {
    syncCtl();
    if (c.paused !== was.paused && view.active) toast(c.paused ? t('game.pausedBy', { name: c.by || '' }) : t('game.resumed'));
    else if (c.speed !== was.speed && view.active) toast(t('game.speedSet', { speed: c.speed, name: speedName(c.speed) }));
  },
  onAutos: () => syncAuto(),
  resync: () => send({ t: 'resync' }),
  notify: (code, params) => toast(t(`game.${code}`, params)),
  onElim: p => {
    if (p === state.me) { if (view.winner === null) showDefeat(); }
    else toast(t('game.eliminated', { name: view.pname(p) }));
  },
  onOver: winner => showOver(winner),
  // State could not be repaired with a keyframe: drop the connection and let
  // session recovery rebuild the match from the server's copy.
  onDesync: () => {
    toast(t('net.desync'));
    if (state.ws) state.ws.close();
  },
});

// ---------------------------------------------------------------- helpers

function send(obj) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj));
}

function current() {
  return ['home', 'room', 'game'].find(s => !$(s).classList.contains('hidden'));
}

function show(id) {
  for (const s of ['home', 'room', 'game']) $(s).classList.toggle('hidden', s !== id);
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function setUrlRoom(code) {
  const url = code ? `${location.pathname}?room=${code}` : location.pathname;
  history.replaceState(null, '', url);
}

function myName() {
  let n = $('name').value.trim();
  if (!n) {
    n = t('home.defaultName', { n: 10 + Math.floor(Math.random() * 90) });
    $('name').value = n;
  }
  store.set(localStorage, 'st_name', n);
  return n;
}

/** The faction this player last chose, sent when creating or joining a room. */
function myFaction() {
  const [f, sub] = String(store.get(localStorage, 'st_faction') || '').split('/');
  return FACTION_IDS.includes(f) ? { faction: f, sub } : {};
}

/** Lobby player name; AI callsigns are translated. */
function playerName(p) {
  return p.bot >= 0 ? t(`bots.${p.bot}`) : p.name;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back for plain-http LAN addresses.
    const ta = el('textarea');
    ta.value = text;
    ta.className = 'offscreen';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
    ta.remove();
    return ok;
  }
}

// ---------------------------------------------------------------- language

for (const sel of document.querySelectorAll('.lang-select')) {
  for (const l of languages()) {
    const o = el('option', '', l.name);
    o.value = l.code;
    sel.append(o);
  }
  sel.value = getLang();
  sel.addEventListener('change', () => setLang(sel.value));
}

// Static markup is handled by data-i18n; everything built in code re-renders here.
onLangChange(code => {
  for (const sel of document.querySelectorAll('.lang-select')) sel.value = code;
  renderRoomList();
  if (state.room && state.room.state === 'lobby') renderRoom();
  syncSfxLabel();
  syncQuitLabel();
  renderNet();
  view.relabel();
  if (current() === 'game') { buildSkillBar(); buildSpeeds(); syncCtl(); syncAuto(); }
  renderOverlay();
});

// ---------------------------------------------------------------- connection
// Same-origin WebSocket (ws:// on http, wss:// on https), so the page works
// unchanged on localhost, a LAN address or a public domain behind a proxy.
//
// Health: an application ping every few seconds measures latency and proves
// the link is alive; silence for STALE_MS forces a reconnect. Reconnects back
// off exponentially and stop after MAX_TRIES, leaving a manual retry button.

const PING_MS = 4000;
const STALE_MS = 12000;
const MAX_TRIES = 8;
const net = { status: 'connecting', tries: 0, rtt: null, lastMsg: 0, ping: 0, retry: 0, expectRoom: 0, warnedBuild: false };

function renderNet() {
  const b = $('net');
  let label;
  if (net.status === 'online') {
    label = net.rtt == null ? t('net.connected') : t('net.latency', { ms: Math.round(net.rtt) });
    b.dataset.q = net.rtt == null || net.rtt < 120 ? 'good' : net.rtt < 250 ? 'ok' : 'poor';
  } else if (net.status === 'offline') {
    label = `${t('net.offline')} · ${t('net.retry')}`;
    b.dataset.q = 'off';
  } else {
    label = net.tries ? t('net.reconnecting', { n: net.tries, max: MAX_TRIES }) : t('net.connecting');
    b.dataset.q = 'wait';
  }
  $('net-label').textContent = label;
  b.disabled = net.status !== 'offline';
}

function setNet(status) {
  net.status = status;
  renderNet();
}

$('net').onclick = () => {
  if (net.status !== 'offline') return;
  net.tries = 0;
  connect();
};

function connect() {
  clearTimeout(net.retry);
  setNet('connecting');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;

  ws.onopen = () => {
    net.tries = 0;
    net.rtt = null;
    net.lastMsg = performance.now();
    setNet('online');
    send({ t: 'hello', name: myName(), token: store.get(sessionStorage, 'st_token') });
    clearInterval(net.ping);
    net.ping = setInterval(() => {
      if (performance.now() - net.lastMsg > STALE_MS) return ws.close();   // link went quiet
      send({ t: 'ping', c: performance.now() });
    }, PING_MS);
    send({ t: 'ping', c: performance.now() });
  };

  ws.onmessage = e => {
    net.lastMsg = performance.now();
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    const h = handlers[m.t];
    if (h) h(m);
  };

  ws.onclose = () => {
    if (state.ws !== ws) return;
    clearInterval(net.ping);
    state.room = null;
    if (net.tries >= MAX_TRIES) return setNet('offline');
    net.tries++;
    setNet('connecting');
    const delay = Math.min(8000, 400 * 2 ** (net.tries - 1)) + Math.random() * 300;
    net.retry = setTimeout(connect, delay);
  };
}

// Reconnect promptly when the device comes back online or the tab is shown again.
window.addEventListener('online', () => { if (net.status !== 'online') { net.tries = 0; connect(); } });

const handlers = {
  welcome(m) {
    state.id = m.id;
    state.lan = m.lan;
    state.port = m.port;
    state.publicUrl = m.publicUrl;
    store.set(sessionStorage, 'st_token', m.token);

    const meta = document.querySelector('meta[name="build"]');
    if (meta && m.build && meta.content !== m.build && !net.warnedBuild) {
      net.warnedBuild = true;
      toast(t('net.update'));
    }

    if (state.pendingJoin) {
      // Give a session resume (which arrives as a `room` message) a moment to win.
      const code = state.pendingJoin;
      state.pendingJoin = '';
      $('code').value = code;
      setTimeout(() => { if (!state.room) send({ t: 'join', code, ...myFaction() }); }, 150);
    } else if (current() !== 'home') {
      // We were in a room before the drop. If the server does not put us back,
      // the session is gone: say so instead of sitting on a dead screen.
      clearTimeout(net.expectRoom);
      net.expectRoom = setTimeout(() => {
        if (state.room) return;
        view.stop();
        state.overlay = null;
        renderOverlay();
        setUrlRoom('');
        show('home');
        toast(t('net.sessionLost'));
      }, 900);
    }
  },

  pong(m) {
    const rtt = performance.now() - m.c;
    net.rtt = net.rtt == null ? rtt : net.rtt * 0.6 + rtt * 0.4;
    renderNet();
  },

  rooms(m) {
    state.rooms = m.rooms;
    renderRoomList();
  },

  room(m) {
    state.room = m;
    setUrlRoom(m.code);
    if (m.state === 'lobby') {
      view.stop();
      state.overlay = null;
      renderOverlay();
      show('room');
      renderRoom();
    } else {
      renderOverlay();
      syncCtl();                       // the host may have changed: so may who can pause
    }
  },

  start(m) {
    state.me = m.you;
    state.report = m.report || null;
    state.overlay = null;
    renderOverlay();
    show('game');
    view.start(m);
    buildSkillBar();
    buildSpeeds();
    syncCtl();
    syncAuto();
    const mine = m.players[m.you];
    if (m.winner !== null) showOver(m.winner);
    else if (mine && m.time < 2) {
      banner(t('game.youCommand', { color: t(`colors.${COLORS[mine.color].id}`) }), COLORS[mine.color].main);
    }
  },

  d(m) { view.onUpdate(m); },
  k(m) { view.onUpdate(m); },
  ack(m) { view.onAck(m.id, m); },
  no(m) { toast(t(`skills.refused.${m.why}`)); },
  ctl(m) { view.onCtl(m); },
  auto(m) { view.setAutos(m.list || []); },
  report(m) { state.report = m.rows; state.realSecs = m.real; renderOverlay(); },
  ev(m) { view.onEvent(m); },

  left(m) {
    state.room = null;
    state.overlay = null;
    renderOverlay();
    view.stop();
    setUrlRoom('');
    show('home');
    if (m.code) toast(t(`errors.${m.code}`));
  },

  err(m) {
    const key = `errors.${m.code}`;
    const msg = t(key);
    toast(msg === key ? t('errors.generic') : msg);
    setUrlRoom('');
  },
};

// ---------------------------------------------------------------- home

function renderRoomList() {
  const box = $('room-list');
  box.textContent = '';
  for (const r of state.rooms) {
    const b = el('button');
    b.type = 'button';
    b.append(
      el('span', 'rl-code', r.code),
      el('span', 'rl-meta', t('home.roomEntry', { host: r.host })),
      el('span', 'rl-count', t('home.roomCount', { n: r.n, max: r.max })),
    );
    b.onclick = () => { send({ t: 'name', name: myName() }); send({ t: 'join', code: r.code, ...myFaction() }); };
    box.append(b);
  }
}

$('name').value = store.get(localStorage, 'st_name') || '';
$('name').addEventListener('change', () => send({ t: 'name', name: myName() }));

$('btn-host').onclick = () => {
  sfx.unlock();
  send({ t: 'name', name: myName() });
  send({ t: 'create', ...myFaction() });
};

$('join-form').onsubmit = e => {
  e.preventDefault();
  sfx.unlock();
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) return toast(t('errors.code_length'));
  send({ t: 'name', name: myName() });
  send({ t: 'join', code, ...myFaction() });
};

// ---------------------------------------------------------------- room

/** Addresses other players can open. Public URL if configured, else this origin, else LAN. */
function inviteBases() {
  if (state.publicUrl) return [state.publicUrl];
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!local) return [location.origin];
  return state.lan.map(ip => `http://${ip}:${state.port}`);
}

function factionControl(p, editable, asBot) {
  const [f, sub] = normalize(p.faction, p.sub);
  const box = el('span', 'fac');
  const img = el('img');
  img.src = insigniaURL(f, sub, COLORS[p.color]);
  img.alt = '';
  box.append(img);
  const label = `${t(`factions.${f}.name`)} · ${t(`factions.${f}.subs.${sub}.name`)}`;
  if (!editable) {
    box.append(el('span', 'fac-name', label));
    return box;
  }
  const sel = el('select', 'fac-select');
  sel.setAttribute('aria-label', t('room.faction'));
  for (const fid of FACTION_IDS) {
    const grp = el('optgroup');
    grp.label = t(`factions.${fid}.name`);
    for (const s of subIds(fid)) {
      const o = el('option', '', `${t(`factions.${fid}.name`)} · ${t(`factions.${fid}.subs.${s}.name`)}`);
      o.value = `${fid}/${s}`;
      grp.append(o);
    }
    sel.append(grp);
  }
  sel.value = `${f}/${sub}`;
  sel.onchange = () => {
    const [nf, ns] = sel.value.split('/');
    if (!asBot) store.set(localStorage, 'st_faction', sel.value);
    send({ t: 'faction', id: asBot ? p.id : undefined, faction: nf, sub: ns });
  };
  box.append(sel);
  return box;
}

function renderRoom() {
  const r = state.room;
  const isHost = r.hostId === state.id;
  $('room-code').textContent = r.code;

  const links = $('invite-links');
  links.textContent = '';
  const bases = inviteBases();
  for (const base of bases) {
    const url = `${base}/?room=${r.code}`;
    const row = el('div', 'link-row');
    const copy = el('button', 'btn small', t('room.copy'));
    copy.onclick = async () => {
      const ok = await copyText(url);
      copy.textContent = t(ok ? 'room.copied' : 'room.copyFail');
      setTimeout(() => { copy.textContent = t('room.copy'); }, 1500);
    };
    row.append(el('code', '', url), copy);
    links.append(row);
  }
  if (!bases.length) links.append(el('p', 'note', t('room.noLan')));

  $('players-title').textContent = t('room.players', { n: r.players.length, max: r.max });
  const list = $('players');
  list.textContent = '';
  for (const p of r.players) {
    const li = el('li');
    const mine = p.id === state.id;
    const name = playerName(p);
    const sw = el(mine ? 'button' : 'span', 'swatch');
    sw.style.setProperty('--c', COLORS[p.color].main);
    if (mine) {
      sw.title = t('room.changeColor');
      sw.setAttribute('aria-label', t('room.changeColor'));
      sw.onclick = () => send({ t: 'color' });
    }
    li.append(sw, el('span', 'pname', name));
    if (mine) li.append(el('span', 'badge', t('room.you')));
    if (p.id === r.hostId) li.append(el('span', 'badge host', t('room.host')));
    if (p.ai) {
      const label = t('ai.badge', { level: t(`ai.${p.ai}`) });
      if (isHost) {
        const b = el('button', 'badge', label);
        b.title = t('room.changeDifficulty');
        b.onclick = () => send({ t: 'setAI', id: p.id, level: AI_LEVELS[(AI_LEVELS.indexOf(p.ai) + 1) % 3] });
        li.append(b);
      } else {
        li.append(el('span', 'badge', label));
      }
    }
    if (isHost && !mine) {
      const x = el('button', 'x', '×');
      x.title = t('room.remove', { name });
      x.setAttribute('aria-label', x.title);
      x.onclick = () => send({ t: 'kick', id: p.id });
      li.append(x);
    }
    li.append(factionControl(p, mine || (isHost && !!p.ai), !mine));
    list.append(li);
  }

  const full = r.players.length >= r.max;
  $('host-controls').classList.toggle('hidden', !isHost);
  for (const b of $('host-controls').querySelectorAll('button')) b.disabled = full;
  // Room settings: the host edits them, everyone sees them.
  $('opt-crates').checked = !!(r.opts && r.opts.crates);
  $('opt-crates').disabled = !isHost;
  $('btn-start').classList.toggle('hidden', !isHost);
  $('btn-start').disabled = r.players.length < 2;
  $('room-hint').textContent = !isHost ? t('room.hintWaiting')
    : r.players.length < 2 ? t('room.hintNeedOpponent')
    : t('room.hintBases', { count: 5 + r.players.length * 5 });
}

for (const b of $('host-controls').querySelectorAll('button')) {
  b.onclick = () => send({ t: 'addAI', level: b.dataset.ai });
}
$('opt-crates').onchange = e => send({ t: 'opt', crates: e.target.checked });
$('btn-start').onclick = () => { sfx.unlock(); send({ t: 'start' }); };
$('btn-leave-room').onclick = () => send({ t: 'leave' });

// ---------------------------------------------------------------- match UI

function banner(text, color) {
  const b = $('banner');
  b.textContent = text;
  b.style.setProperty('--c', color);
  b.classList.remove('hidden');
  b.style.animation = 'none';
  void b.offsetWidth;   // restart the CSS animation
  b.style.animation = '';
  setTimeout(() => b.classList.add('hidden'), 3300);
}

/** Draw the end-of-match overlay from state.overlay (null hides it). */
function renderOverlay() {
  const o = state.overlay;
  $('overlay').classList.toggle('hidden', !o);
  if (!o) return;
  const isHost = state.room && state.room.hostId === state.id;
  const title = $('ov-title');
  if (o.kind === 'defeated') {
    title.textContent = t('over.defeated');
    title.className = 'loss';
    $('ov-sub').textContent = t('over.lostLastBase');
  } else {
    const won = o.winner === state.me;
    title.textContent = t(won ? 'over.victory' : 'over.defeat');
    title.className = won ? 'win' : 'loss';
    const name = o.winner >= 0 && view.players[o.winner] ? view.pname(o.winner) : t('over.nobody');
    $('ov-sub').textContent = (won ? t('over.lastStanding') : t('over.holdsField', { name }))
      + (isHost ? '' : ` ${t('over.waitingHost')}`);
  }
  $('ov-watch').classList.toggle('hidden', o.kind !== 'defeated');
  $('ov-lobby').classList.toggle('hidden', !isHost);
  renderResults(o.kind === 'over');
}

// Post-match statistics, straight from the server's event counters.
const RESULT_COLS = [
  ['produced'], ['granted'], ['converted'], ['lostToConversion', 'lostConv'], ['kills'], ['losses'],
  ['dealt'], ['taken'], ['captured'], ['lost', 'citiesLost'], ['peak'], ['level3'],
  ['encWon', 'encounters'], ['basic'], ['supers'], ['crates'],
];
let resultSort = { key: 'kills', dir: -1 };

function renderResults(show) {
  const box = $('results'), rows = state.report;
  box.classList.toggle('hidden', !show || !rows);
  $('overlay').classList.toggle('with-results', !!(show && rows));
  if (!show || !rows) return;
  const mins = Math.floor(rows[0].duration / 60), secs = String(rows[0].duration % 60).padStart(2, '0');
  $('ov-sub').textContent = `${$('ov-sub').textContent} ${t('results.duration', { time: `${mins}:${secs}` })}`;
  // Match length is simulation time; if the match was paused or not at 1x, real time differs and is shown too.
  if (state.realSecs != null && Math.abs(state.realSecs - rows[0].duration) > 2) {
    const r = state.realSecs;
    $('ov-sub').textContent += ` ${t('results.durationReal', { time: `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}` })}`;
  }

  const table = $('results-table');
  table.textContent = '';
  const head = el('tr');
  head.append(el('th', 'r-player', t('results.player')));
  for (const [key, label] of RESULT_COLS) {
    const th = el('th', resultSort.key === key ? 'sorted' : '', t(`results.${label || key}`));
    th.tabIndex = 0;
    th.onclick = () => { resultSort = { key, dir: resultSort.key === key ? -resultSort.dir : -1 }; renderResults(true); };
    th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.onclick(); } };
    head.append(th);
  }
  table.append(head);
  const order = rows.map((r, seat) => ({ r, seat }))
    .sort((a, b) => (b.r.winner - a.r.winner) || (a.r[resultSort.key] - b.r[resultSort.key]) * resultSort.dir || a.seat - b.seat);
  for (const { r, seat } of order) {
    const tr = el('tr', r.winner ? 'winner' : seat === state.me ? 'me' : '');
    const who = el('td', 'r-player');
    const pl = view.players[seat];
    const img = el('img');
    img.src = insigniaURL(r.faction, r.sub, COLORS[pl.color]);
    img.alt = '';
    const names = el('div');
    names.append(el('b', '', view.pname(seat)), el('span', '', `${t(`factions.${r.faction}.name`)} · ${t(`factions.${r.faction}.subs.${r.sub}.name`)}`));
    who.append(img, names, el('span', `badge ${r.winner ? 'host' : ''}`, t(r.winner ? 'results.won' : 'results.lost')));
    tr.append(who);
    for (const [key] of RESULT_COLS) {
      const td = el('td', '', key === 'encWon' ? `${fmt(r.encWon)} / ${fmt(r.encLost)}` : fmt(r[key]));
      if (key === 'crates' && r.crates) td.title = Object.entries(r.rewards).map(([id, n]) => `${t(`crates.${id}.name`)} ×${n}`).join('\n');
      tr.append(td);
    }
    table.append(tr);
  }
}

// ---------------------------------------------------------------- skill bar

const SKILL_KEYS = ['Z', 'X', 'C'];
let skillButtons = [];

function buildSkillBar() {
  const box = $('skills');
  box.textContent = '';
  skillButtons = [];
  if (!view.map || state.me < 0) return;
  const defs = view.cfg.skills[view.sides[state.me].f];
  defs.forEach((def, slot) => {
    const b = el('button', `skill${def.super ? ' super' : ''}`);
    b.type = 'button';
    b.style.setProperty('--c', SKILL_COLOR[def.id]);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'skill-ico');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${def.id}`);
    svg.append(use);
    const state2 = el('span', 'skill-state');
    b.append(svg, el('kbd', '', SKILL_KEYS[slot]), state2);
    b.setAttribute('aria-label', t(`skills.${def.id}.name`));
    b.onclick = () => view.beginTarget(slot);
    const tip = () => showSkillTip(def);
    b.onmouseenter = tip; b.onfocus = tip;
    b.onmouseleave = b.onblur = () => { if (!view.targeting) $('skill-tip').classList.add('hidden'); };
    box.append(b);
    skillButtons.push({ b, def, slot, label: state2 });
  });
}

function showSkillTip(def, targeting) {
  const tip = $('skill-tip');
  tip.textContent = '';
  tip.style.setProperty('--c', SKILL_COLOR[def.id]);
  tip.append(el('b', '', t(`skills.${def.id}.name`)));
  tip.append(el('span', '', targeting ? `${t(`skills.${def.id}.target`)} ${t('skills.cancelHint')}` : t(`skills.${def.id}.desc`)));
  if (!targeting) tip.append(el('small', '', `${t(`skills.${def.id}.target`)} · ${t('skills.cooldown', { s: def.cd })}`));
  tip.classList.remove('hidden');
}

let tipFor = -1;
setInterval(() => {
  if (current() !== 'game' || !skillButtons.length) return;
  const s = view.skillState();
  if (!s) return;
  const can = view.canPlay();
  for (const { b, def, slot, label } of skillButtons) {
    let text = '', p = 0, ready = false;
    if (def.super) {
      if (s.l3 < s.l3Need) text = `${s.l3}/${s.l3Need}`;
      else if (s.charge < s.need) { p = 1 - s.charge / s.need; text = `${Math.floor((s.charge / s.need) * 100)}%`; }
      else ready = true;
      b.title = s.l3 < s.l3Need ? t('skills.needL3', { need: s.l3Need, have: s.l3 }) : ready ? t('skills.ready') : t('skills.charging', { pct: Math.floor((s.charge / s.need) * 100) });
    } else {
      const cd = s.cd[slot];
      if (cd > 0) { p = cd / def.cd; text = String(Math.ceil(cd)); } else ready = true;
      b.title = ready ? t('skills.ready') : t('skills.cooldown', { s: Math.ceil(cd) });
    }
    b.style.setProperty('--p', p.toFixed(3));
    b.disabled = !can || !ready;
    b.classList.toggle('ready', ready && can);
    b.classList.toggle('locked', def.super && s.l3 < s.l3Need);
    b.classList.toggle('active', !!view.targeting && view.targeting.slot === slot);
    if (label.textContent !== text) label.textContent = text;
  }
  // While targeting, the tip explains what to click.
  const tg = view.targeting ? view.targeting.slot : -1;
  if (tg !== tipFor) {
    tipFor = tg;
    if (tg >= 0) showSkillTip(skillButtons[tg].def, true); else $('skill-tip').classList.add('hidden');
  }
  const buffs = $('buffs');
  const want = [['mobilize', s.mobilize], ['rapid', s.rapid], ['surge', s.surge]].filter(x => x[1] > 0)
    .map(([id, left]) => t(`buffs.${id}`, { s: Math.ceil(left) })).join('|');
  if (buffs.dataset.v !== want) {
    buffs.dataset.v = want;
    buffs.textContent = '';
    for (const text of want ? want.split('|') : []) buffs.append(el('span', 'buff', text));
  }
}, 200);

// ---------------------------------------------------------------- settings

const gfx = Object.assign({ quality: 'high', effects: true, shake: true, flash: true, webgl: true }, JSON.parse(store.get(localStorage, 'st_gfx') || '{}'));
view.applySettings(gfx);
$('set-quality').value = gfx.quality;
$('set-effects').checked = !gfx.effects;
$('set-shake').checked = !gfx.shake;
$('set-flash').checked = !gfx.flash;
$('set-webgl').checked = gfx.webgl;
function saveGfx() {
  gfx.webgl = $('set-webgl').checked;
  gfx.quality = $('set-quality').value;
  gfx.effects = !$('set-effects').checked;
  gfx.shake = !$('set-shake').checked;
  gfx.flash = !$('set-flash').checked;
  store.set(localStorage, 'st_gfx', JSON.stringify(gfx));
  view.applySettings(gfx);
}
for (const id of ['set-quality', 'set-effects', 'set-shake', 'set-flash', 'set-webgl']) $(id).onchange = saveGfx;
$('btn-settings').onclick = () => $('settings').classList.toggle('hidden');
$('settings-close').onclick = () => $('settings').classList.add('hidden');
$('settings').onclick = e => { if (e.target === $('settings')) $('settings').classList.add('hidden'); };

function showDefeat() {
  sfx.lose();
  state.overlay = { kind: 'defeated' };
  renderOverlay();
}

function showOver(winner) {
  if (winner === state.me) sfx.win();
  else if (view.alive[state.me]) sfx.lose();
  state.overlay = { kind: 'over', winner };
  renderOverlay();
}

$('ov-lobby').onclick = () => send({ t: 'lobby' });
$('ov-watch').onclick = () => { state.overlay = null; renderOverlay(); };
$('ov-leave').onclick = () => send({ t: 'leave' });

function setPct(v) {
  view.pct = v;
  for (const b of $('pct').querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.pct) === v);
  if (view.active && view.canPlay()) send({ t: 'auto', setPct: true, pct: v });
}
for (const b of $('pct').querySelectorAll('button')) b.onclick = () => setPct(Number(b.dataset.pct));

for (const [i, b] of [...$('pct').querySelectorAll('button')].entries()) b.title = `${b.textContent} (${i + 1})`;

// ---------------------------------------------------------------- pause, speed, auto dispatch
// Pause and speed belong to the room: the buttons only ask, the server decides and tells
// everyone (handlers.ctl). By default only the host may ask.

const SPEED_NAMES = { 0.5: 'verySlow', 0.75: 'slow', 1: 'normal', 1.5: 'fast', 2: 'veryFast' };
const speedName = v => t(`speed.${SPEED_NAMES[v] || 'normal'}`);
const isHost = () => !!state.room && state.room.hostId === state.id;
const mayControl = () => view.active && view.winner === null && (isHost() || !(view.cfg && view.cfg.control.hostOnly));

function buildSpeeds() {
  const sel = $('speed');
  sel.textContent = '';
  for (const v of (view.cfg && view.cfg.speeds) || [1]) {
    const o = el('option', '', `${v}×  ${speedName(v)}`);
    o.value = String(v);
    sel.append(o);
  }
}

function syncCtl() {
  if (!view.cfg) return;
  const can = mayControl(), b = $('btn-pause');
  const label = can ? t(view.paused ? 'hud.resume' : 'hud.pause') : t('game.hostOnly');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.disabled = !can;
  b.classList.toggle('on', view.paused);
  b.querySelector('use').setAttribute('href', view.paused ? '#i-play' : '#i-pause');
  $('speed').value = String(view.speed);
  $('speed').disabled = !can;
  const shown = view.paused && view.active && view.winner === null;
  $('paused').classList.toggle('hidden', !shown);
  $('paused-by').textContent = view.pausedBy ? t('pause.by', { name: view.pausedBy }) : '';
  $('pause-resume').classList.toggle('hidden', !can);
  if (shown && !can) $('paused-by').textContent += ` · ${t('pause.waiting')}`;
}

function togglePause() {
  if (!mayControl()) return toast(t('game.hostOnly'));
  send({ t: 'pause', on: !view.paused });
}
function setSpeed(v) {
  if (!mayControl()) { syncCtl(); return toast(t('game.hostOnly')); }
  send({ t: 'speed', v });
}
$('btn-pause').onclick = togglePause;
$('pause-resume').onclick = togglePause;
$('pause-settings').onclick = () => $('settings').classList.remove('hidden');
$('pause-leave').onclick = () => $('btn-quit').click();
$('speed').onchange = () => setSpeed(Number($('speed').value));

function syncAuto() {
  const b = $('btn-auto');
  b.classList.toggle('on', view.autoMode);
  b.querySelector('span').textContent = t(view.autoMode ? 'hud.auto' : 'hud.autoPick');
  const n = view.map ? view.chosen().filter(s => view.hasAutoFrom(s)).length : 0;
  const stop = $('btn-auto-stop');
  stop.classList.toggle('hidden', !n);
  if (n) stop.textContent = t('hud.autoStop', { count: n });

  const rb = $('btn-rally');
  rb.classList.toggle('on', view.rallyMode);
  rb.querySelector('span').textContent = t(view.rallyMode ? 'hud.rallyPick' : 'hud.rally');
  const go = $('btn-rally-go');
  const canPlay = view.map && view.canPlay();
  if (canPlay && view.rallyMode && view.rallyTargets.size > 0) {
    go.classList.remove('hidden');
    go.classList.toggle('attack', [...view.rallyTargets].some(id => view.owner[id] !== view.me));
    go.textContent = t('hud.rallyGo', { count: view.rallyTargets.size });
  } else if (canPlay && !view.rallyMode && view.sel >= 0) {
    const isRally = view.owner[view.sel] === view.me;
    go.classList.remove('hidden');
    go.classList.toggle('attack', !isRally);
    go.textContent = t(isRally ? 'hud.rallyHere' : 'hud.attackHere');
  } else {
    go.classList.add('hidden');
  }
}
$('btn-auto').onclick = () => view.setAutoMode();
$('btn-auto-stop').onclick = () => view.stopAuto();
$('btn-rally').onclick = () => view.setRallyMode();
$('btn-rally-go').onclick = () => view.confirmRally();
setInterval(() => { if (view.active) syncAuto(); }, 250);     // the stop/rally buttons follow the selection

// ---------------------------------------------------------------- keyboard
// Every match command has a key. H (or ?) lists them in-game.

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function toggleKeys(show) {
  const panel = $('keys');
  panel.classList.toggle('hidden', show === undefined ? !panel.classList.contains('hidden') : !show);
}
$('btn-keys').onclick = () => toggleKeys();
$('keys-close').onclick = () => toggleKeys(false);
$('keys').onclick = e => { if (e.target === $('keys')) toggleKeys(false); };

window.addEventListener('keydown', e => {
  if ($('game').classList.contains('hidden') || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const keysOpen = !$('keys').classList.contains('hidden');

  if (key === 'Escape') {
    if (!$('settings').classList.contains('hidden')) return $('settings').classList.add('hidden');
    return keysOpen ? toggleKeys(false) : view.cancel();
  }
  if (key === 'h' || key === '?') return toggleKeys();
  if (keysOpen || state.overlay) return;             // dialogs take the keyboard

  const pct = '1234'.indexOf(key);
  if (key.length === 1 && pct >= 0) return setPct([0.25, 0.5, 0.75, 1][pct]);
  if (ARROWS[key]) {
    e.preventDefault();
    const [dx, dy] = ARROWS[key];
    return e.shiftKey ? view.sendDir(dx, dy) : view.moveSel(dx, dy);
  }
  if (key === 'e') return view.cycleOwn(1);
  if (key === 'q') return view.cycleOwn(-1);
  if (key === 's') return view.sendToHover();
  if (key === 'a') return view.pickAll();
  if (key === 'r') return view.setAutoMode();
  if (key === 'g') return view.setRallyMode();
  if (key === 'Enter' && (view.rallyMode || view.sel >= 0)) return view.confirmRally();
  if (key === 'Delete' || key === 'Backspace') return view.stopAuto();
  if (key === 'p') return togglePause();
  if (key === '[' || key === ']') {
    const list = view.cfg.speeds, at = list.indexOf(view.speed) + (key === ']' ? 1 : -1);
    if (at >= 0 && at < list.length) setSpeed(list[at]);
    return;
  }
  const slot = 'zxc'.indexOf(key);
  if (key.length === 1 && slot >= 0) return view.beginTarget(slot);
  if (key === 'm') { sfx.unlock(); sfx.toggle(); return syncSfxLabel(); }
  if ((key === 'u' || key === ' ') && view.sel >= 0) {
    e.preventDefault();
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();   // Space must not also press a button
    if (view.paused) toast(t('game.paused')); else send({ t: 'up', node: view.sel });
  }
});
window.addEventListener('keyup', e => { if (e.key === 'Shift') view.onShiftUp(); });
window.addEventListener('blur', () => { view.shiftRally = false; });

function syncSfxLabel() {
  const b = $('btn-sfx');
  const label = t(sfx.on ? 'hud.soundOn' : 'hud.soundOff');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.classList.toggle('off', !sfx.on);
  b.querySelector('use').setAttribute('href', sfx.on ? '#i-sound' : '#i-mute');
}
$('btn-sfx').onclick = () => { sfx.unlock(); sfx.toggle(); syncSfxLabel(); };

let quitArmed = 0;
function syncQuitLabel() {
  $('quit-label').textContent = t(quitArmed ? 'hud.leaveConfirm' : 'hud.leave');
  $('btn-quit').classList.toggle('armed', !!quitArmed);
}
$('btn-quit').onclick = () => {
  // Two taps to leave, so a stray touch does not forfeit the match.
  if (quitArmed && Date.now() - quitArmed < 2500) {
    quitArmed = 0;
    syncQuitLabel();
    send({ t: 'leave' });
  } else {
    const armedAt = (quitArmed = Date.now());
    syncQuitLabel();
    setTimeout(() => { if (quitArmed === armedAt) { quitArmed = 0; syncQuitLabel(); } }, 2500);
  }
};

applyDom();
syncSfxLabel();
syncQuitLabel();
connect();
