// What stays 2D in both proofs of concept, exactly as in the game: number
// plates (drawn on a canvas above the 3D view and positioned by projecting
// world points through the engine's camera) and the rain. Plus a small panel
// to switch renderer features on and off and read the frame cost.
import { F } from '/public/js/iso.js';

const TAU = Math.PI * 2;
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function hash(n) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return (n ^ (n >>> 15)) >>> 0;
}

/**
 * @param canvas  2D canvas stacked over the 3D one
 * @param plates  [{ x, z, h, text, tc, city }] from the scene
 * @param project (X, Y, Z) => [cssX, cssY]
 */
export function makeOverlay(canvas, plates, project) {
  const ctx = canvas.getContext('2d');
  const state = { rain: true, plates: true };
  function resize(w, h, dpr) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    state.w = w; state.h = h; state.dpr = dpr;
  }
  function draw(lt) {
    const { w, h, dpr } = state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (state.rain) {
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 30; i++) {                       // rings where drops land
        const beat = lt / (0.9 + (i % 5) * 0.13) + i * 0.37;
        const ph = beat % 1, hsh = hash(i * 7919 + Math.floor(beat) * 104729);
        const x = ((hsh % 1000) / 1000) * w, y = (((hsh >>> 10) % 1000) / 1000) * h;
        ctx.strokeStyle = `rgba(214,228,242,${(0.34 * (1 - ph)).toFixed(3)})`;
        ctx.beginPath(); ctx.ellipse(x, y, 1.5 + ph * 8, (1.5 + ph * 8) * F, 0, 0, TAU); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(216,228,242,.2)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let i = 150; i > 0; i--) {                      // streaks
        const hsh = hash(Math.imul(i, 0x9e3779b1));
        const fall = (lt * (620 + (hsh % 300)) + ((hsh >>> 8) % 4096)) % (h + 80);
        const x = (((hsh >>> 4) % 2000) / 2000) * (w + 160) - fall * 0.22, y = -40 + fall, len = 14 + (hsh % 12);
        ctx.moveTo(x, y); ctx.lineTo(x - len * 0.22, y + len);
      }
      ctx.stroke();
    }
    if (state.plates) {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (const p of plates) {
        const [x, y0] = project(p.x, p.h, p.z);
        const y = p.city ? y0 : y0 - 12;
        ctx.font = `700 ${p.city ? 13 : 11}px ${FONT}`;
        const tw = ctx.measureText(p.text).width + (p.city ? 18 : 14), th = p.city ? 20 : 16;
        ctx.fillStyle = 'rgba(10,12,14,.88)';
        ctx.beginPath(); ctx.roundRect(x - tw / 2, y - th / 2, tw, th, 3); ctx.fill();
        ctx.fillStyle = p.tc.main;
        ctx.fillRect(x - tw / 2, y - th / 2, 3, th);
        if (p.city) { ctx.strokeStyle = p.tc.main; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(x - tw / 2, y - th / 2, tw, th, 3); ctx.stroke(); }
        ctx.fillStyle = '#fff';
        ctx.fillText(p.text, x + 1.5, y + 0.5);
      }
    }
  }
  return { state, resize, draw };
}

/**
 * Feature switches and a stats line.
 * @param title   engine name
 * @param toggles [{ id, label, key, get, set }]
 */
export function makePanel(title, toggles) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:12px;top:12px;z-index:5;font:12px/1.5 ${FONT};color:#e8edf2;background:rgba(14,17,21,.86);border:1px solid #2c333b;border-left:3px solid #e8b72c;border-radius:4px;padding:10px 12px;min-width:210px;user-select:none`;
  const head = document.createElement('div');
  head.style.cssText = 'font-weight:700;font-size:13px;letter-spacing:.04em;margin-bottom:6px';
  head.textContent = title;
  el.append(head);
  for (const t of toggles) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = t.get();
    box.addEventListener('change', () => t.set(box.checked));
    t.box = box;
    row.append(box, document.createTextNode(`${t.label}  [${t.key}]`));
    el.append(row);
  }
  const stats = document.createElement('div');
  stats.style.cssText = 'margin-top:8px;padding-top:6px;border-top:1px solid #2c333b;color:#aab4be;white-space:pre';
  el.append(stats);
  const back = document.createElement('a');
  back.href = '../'; back.textContent = '← all proofs of concept';
  back.style.cssText = 'display:block;margin-top:6px;color:#8fb8e8;text-decoration:none';
  el.append(back);
  document.body.append(el);
  window.addEventListener('keydown', e => {
    const t = toggles.find(q => q.key.toLowerCase() === e.key.toLowerCase());
    if (t) { t.box.checked = !t.box.checked; t.set(t.box.checked); }
    if (e.key.toLowerCase() === 'h') el.style.display = el.style.display === 'none' ? '' : 'none';
  });
  return { el, stats: text => { stats.textContent = text; }, hide: on => { el.style.display = on ? 'none' : ''; } };
}
