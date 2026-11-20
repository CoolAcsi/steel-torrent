// The tutorial overlay. Lessons are run and judged by the server (game/tutorial.js); this file
// shows what the current step asks for, points at it, and reports the few actions only this
// screen can know about (looking at a base, moving the camera, pressing a locked button).
// It does not decide when a step is done and has no "next step" button.
import { t, onLangChange } from './i18n.js';
import { subIds } from './factions.js';

const KEY = 'st_tut';
const TOTAL = 11;
const DWELL = 2;          // polls a base must stay under the pointer (or selected) to count as inspected

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function initTutorial({ view, send, toast, name, faction }) {
  const $ = id => document.getElementById(id);
  const panel = $('tutorial'), pins = $('tut-pins');
  const lessonNos = v => (Array.isArray(v) ? [...new Set(v.filter(n => Number.isInteger(n) && n >= 1 && n <= TOTAL))] : []);

  // ---------------------------------------------------------------- progress (this browser only)
  const prog = { done: [], skipped: [], prompt: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    prog.done = lessonNos(saved.done);
    prog.skipped = lessonNos(saved.skipped).filter(n => !prog.done.includes(n));
    prog.prompt = !!saved.prompt;
  } catch { /* no storage, or not ours */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prog)); } catch { /* private mode */ } };

  const S = { on: false, m: null, list: false, sent: new Set(), dwell: { node: -1, n: 0 }, armed: 0, guideSig: '', min: null };
  // On a small screen the panel starts folded to the instruction alone, so it hides as little of the map as it can.
  const small = () => window.matchMedia('(max-width: 720px)').matches;

  // ---------------------------------------------------------------- talking to the server

  function open(lesson, extra = {}) {
    prog.prompt = true;
    save();
    renderHome();
    send({ t: 'name', name: name() });
    send({
      t: 'tutorial', lesson, prog: { done: prog.done, skipped: prog.skipped },
      caps: { camera: !!view.hasCamera }, ...faction(), ...extra,
    });
  }
  const go = o => send({ t: 'tutorial', ...o });

  /** Report something the player did that only this screen can see. Only what the current step asks for is sent, once. */
  function did(kind, node) {
    const m = S.m;
    if (!S.on || !m || m.done || m.want !== kind) return;
    const key = `${kind}:${node == null ? '' : node}`;
    if (S.sent.has(key)) return;
    S.sent.add(key);
    send({ t: 'tut', did: kind, node });
  }

  function onLesson(m) {
    const changed = !S.m || S.m.key !== m.key || S.m.n !== m.n || !!S.m.done !== !!m.done || S.m.run !== m.run;   // a restart of the same step counts
    S.on = true;
    S.m = m;
    if (changed) { S.sent.clear(); S.dwell = { node: -1, n: 0 }; }
    // A step about single orders: drop out of Auto, or a drag would make another persistent route.
    if (changed && !m.done && m.mode === 'once' && view.autoMode && view.setAutoMode) view.setAutoMode(false);
    if (m.prog) {
      prog.done = lessonNos(m.prog.done);
      prog.skipped = lessonNos(m.prog.skipped).filter(n => !prog.done.includes(n));
      save();
    }
    if (m.failed) toast(t('tutorial.failed'));
    if (m.end) S.list = true;
    document.getElementById('game').classList.add('tut-on');
    render();
    layout();
    renderHome();
  }

  function onLeft() {
    if (!S.on) return;
    S.on = false;
    S.m = null;
    S.list = false;
    document.getElementById('game').classList.remove('tut-on');
    panel.classList.add('hidden');
    if (view.setInset) view.setInset(null);
    pins.textContent = '';
    if (view.setGuide) view.setGuide(null);
    S.guideSig = '';
    renderHome();
  }

  // ---------------------------------------------------------------- the panel

  const status = n => (prog.done.includes(n) ? 'done' : S.m && S.m.n === n && !S.m.end ? 'now' : prog.skipped.includes(n) ? 'skipped' : 'open');

  function button(cls, label, title, fn) {
    const b = mk('button', `btn tiny ${cls}`, label);
    b.type = 'button';
    if (title) b.title = title;
    b.onclick = fn;
    return b;
  }

  function render() {
    const m = S.m;
    panel.classList.toggle('hidden', !S.on || !m);
    if (!S.on || !m) return;
    panel.textContent = '';
    panel.classList.toggle('done', !!m.done);
    if (S.min === null) S.min = small();
    const folded = S.min && !m.done && !S.list;       // a finished lesson and the lesson list always show their buttons
    panel.classList.toggle('min', folded);

    const head = mk('header', 'tut-head'), names = mk('div');
    names.append(mk('small', '', t('tutorial.lesson', { n: m.n, of: m.of })), mk('b', '', t(`tutorial.l${m.n}.title`)));
    const fold = mk('button', 'tut-fold', folded ? '+' : '–');
    fold.type = 'button';
    fold.setAttribute('aria-expanded', String(!folded));
    fold.title = t(folded ? 'tutorial.more' : 'tutorial.less');
    fold.setAttribute('aria-label', fold.title);
    fold.onclick = () => { S.min = !folded; render(); };
    head.append(names, fold);
    panel.append(head);

    if (S.list) {
      // Every lesson with its mark; any of them can be started from here.
      const ol = mk('ol', 'tut-list');
      for (let n = 1; n <= TOTAL; n++) {
        const st = status(n), li = mk('li', st), b = mk('button', '', '');
        b.type = 'button';
        b.append(mk('span', 'tut-no', String(n)), mk('span', 'tut-name', t(`tutorial.l${n}.title`)), mk('span', 'tut-mark', t(`tutorial.status.${st}`)));
        b.onclick = () => { S.list = false; go({ lesson: n }); };
        li.append(b);
        ol.append(li);
      }
      panel.append(ol);
      if (m.end) panel.append(mk('p', 'tut-note', t(prog.done.length >= TOTAL ? 'tutorial.allDone' : 'tutorial.ended')));
      const row = mk('div', 'tut-actions');
      const armed = Date.now() < S.armed;
      row.append(
        button(armed ? 'armed' : 'ghost', t(armed ? 'tutorial.restartConfirm' : 'tutorial.restart'), '', () => {
          if (Date.now() < S.armed) { S.armed = 0; S.list = false; prog.done = []; prog.skipped = []; save(); go({ lesson: 1, reset: true }); } else { S.armed = Date.now() + 4000; render(); setTimeout(render, 4100); }
        }),
        button('', t('tutorial.close'), '', () => { S.list = false; render(); }),
        button('ghost', t('tutorial.exit'), '', () => send({ t: 'leave' })),
      );
      panel.append(row);
      return;
    }

    const where = m.done ? t('tutorial.complete')
      : t('tutorial.step', { step: m.step, total: m.total }) + (m.parts > 1 ? ` · ${t('tutorial.part', { part: m.part, parts: m.parts })}` : '');
    panel.append(mk('div', 'tut-step', where));
    const bar = mk('div', 'tut-bar');
    bar.style.setProperty('--p', String(m.done ? 1 : (m.step - 1) / m.total));
    panel.append(bar);
    panel.append(mk('p', 'tut-text', t(m.key)));
    if (m.done && m.all) panel.append(mk('p', 'tut-note', t('tutorial.allDone')));

    if (m.pick && !m.done) {
      // Lessons that differ by faction can be played as any of them: choosing one starts the lesson again.
      const row = mk('div', 'tut-pick');
      row.append(mk('small', '', t('tutorial.pick')));
      for (const f of m.pick) {
        const b = button(f === m.faction ? 'on' : '', t(`factions.${f}.name`), '', () => { if (f !== m.faction) go({ lesson: m.n, faction: f, sub: subIds(f)[0] }); });
        b.setAttribute('aria-pressed', String(f === m.faction));
        row.append(b);
      }
      panel.append(row);
    }

    const row = mk('div', 'tut-actions');
    if (m.done) {
      if (m.n < m.of) row.append(button('primary', t('tutorial.next'), '', () => go({ lesson: m.n + 1 })));
      row.append(button('', t('tutorial.again'), '', () => go({ lesson: m.n })));
    } else {
      row.append(
        button('', t('tutorial.retry'), t('tutorial.retryHint'), () => go({ lesson: m.n })),
        button('', t('tutorial.skip'), t('tutorial.skipHint'), () => go({ skip: true })),
      );
    }
    row.append(
      button('', t('tutorial.lessons'), '', () => { S.list = true; render(); }),
      button('ghost', t('tutorial.exit'), '', () => send({ t: 'leave' })),
    );
    panel.append(row);
  }

  // ---------------------------------------------------------------- pointing at things

  /** Where base i is on the page, from the game view's own layout (the same one its labels use). */
  function place(i) {
    const p = view.vn && view.vn[i];
    if (!p || !view.s) return null;
    const r = view.cv.getBoundingClientRect();
    return { x: r.left + view.ox + p.x * view.s, y: r.top + view.oy + p.y * view.s, R: (view.R || 36) * view.s };
  }

  function layout() {
    const m = S.m;
    if (!S.on || !m || !view.active) { pins.textContent = ''; return; }
    const hi = m.hi || { nodes: [], labels: {}, roads: [], hud: [] };

    // The map is laid out clear of this panel (beside it or below it), so no base hides under it.
    // Sizes are rounded up so a line more or less of text does not re-lay the whole map.
    if (view.setInset) {
      const cv = document.getElementById('cv'), pr = panel.getBoundingClientRect(), cr = cv.getBoundingClientRect();
      const shown = !panel.classList.contains('hidden') && pr.width > 0 && !S.list;
      view.setInset(shown ? { w: Math.ceil((cr.right - pr.left + 10) / 20) * 20, h: Math.ceil((pr.bottom - cr.top - 54 + 12) / 48) * 48 } : null);
    }

    // In-canvas guide, when the game view offers one (rings on bases, glow on roads).
    const sig = `${m.n}|${m.key}|${m.done ? 1 : 0}`;
    if (view.setGuide && sig !== S.guideSig) {
      S.guideSig = sig;
      view.setGuide(m.done || (!hi.nodes.length && !hi.roads.length) ? null : { nodes: hi.nodes, roads: hi.roads });
    }

    // Letter tags on every named base, a ring on the ones this step is about, a marker on its roads,
    // and a frame round each HUD control it mentions. All of it is positioned from live layout, so
    // it follows a resize or a change of renderer.
    const want = [];
    for (const [id, label] of Object.entries(hi.labels || {})) {
      const p = place(+id);
      if (!p) continue;
      const on = hi.nodes.includes(+id);
      want.push({ k: `tag${id}`, cls: `tut-tag${on ? ' on' : ''}`, text: label, x: p.x - p.R * 0.95, y: p.y - p.R * 1.05 });
      if (on && !view.setGuide) want.push({ k: `ring${id}`, cls: 'tut-ring', x: p.x, y: p.y, w: p.R * 2.9, h: p.R * 2.2 });
    }
    for (const [a, b] of hi.roads || []) {
      const p = place(a), q = place(b);
      if (p && q && !view.setGuide) want.push({ k: `road${a}_${b}`, cls: 'tut-road', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    }
    for (const sel of m.done ? [] : hi.hud || []) {
      const e = document.querySelector(sel);
      const r = e && e.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) continue;
      want.push({ k: `hud${sel}`, cls: `tut-frame${hi.tap ? ' tap' : ''}`, x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8, tap: !!hi.tap, text: hi.tap ? t('tutorial.tap') : '' });
    }
    const have = new Map([...pins.children].map(e => [e.dataset.k, e]));
    for (const w of want) {
      let e = have.get(w.k);
      if (!e) { e = mk('div'); e.dataset.k = w.k; pins.append(e); }
      have.delete(w.k);
      if (e.className !== w.cls) e.className = w.cls;
      if (w.text != null && e.textContent !== w.text) e.textContent = w.text;
      e.style.left = `${Math.round(w.x)}px`;
      e.style.top = `${Math.round(w.y)}px`;
      if (w.w) { e.style.width = `${Math.round(w.w)}px`; e.style.height = `${Math.round(w.h)}px`; }
      // A locked control cannot be clicked itself; its frame takes the click instead.
      e.onclick = w.tap ? () => did('locked') : null;
    }
    for (const e of have.values()) e.remove();
  }

  // Looking at a base: it is under the pointer, or selected, and has stayed so for a moment
  // (the game view may also say so itself, through hooks.onInspect).
  function watch() {
    if (!S.on) return;
    layout();
    const m = S.m;
    if (!m || m.done || m.want !== 'inspect' || !view.active) return;
    const i = view.hover >= 0 ? view.hover : view.sel;
    if (i == null || i < 0 || !(m.hi.nodes || []).includes(i)) { S.dwell = { node: -1, n: 0 }; return; }
    S.dwell = S.dwell.node === i ? { node: i, n: S.dwell.n + 1 } : { node: i, n: 1 };
    if (S.dwell.n >= DWELL) did('inspect', i);
  }
  setInterval(watch, 200);
  window.addEventListener('resize', layout);
  window.addEventListener('keydown', e => {
    if (S.on && S.m && S.m.want === 'locked' && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'c' && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) did('locked');
  });

  // ---------------------------------------------------------------- main menu

  function renderHome() {
    const p = $('tut-prompt'), n = $('tut-progress');
    if (p) p.classList.toggle('hidden', prog.prompt || prog.done.length > 0 || prog.skipped.length > 0);
    if (n) n.textContent = prog.done.length ? `${prog.done.length} / ${TOTAL}` : t('tutorial.menuHint');
  }
  $('btn-tutorial').onclick = () => open();
  $('tut-prompt-start').onclick = () => open(1);
  $('tut-prompt-later').onclick = () => { prog.prompt = true; save(); renderHome(); };
  renderHome();
  onLangChange(() => { renderHome(); render(); layout(); });

  return {
    get active() { return S.on; },
    open, onLesson, onLeft,
    /** For the game view: the camera moved ('pan' | 'zoom'), or a base's details were opened. */
    did,
  };
}
