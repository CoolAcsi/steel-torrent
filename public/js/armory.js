// Armory: every faction / subfaction / unit side by side, at inspection size
// and at battle zoom, with a team-colour picker and a grayscale check.
import { COLORS, DIRS, STEP, hullSprite, turretSprite, soldierSprite, baseSprite, baseInfo, unitSpec } from './art.js';
import { drawBaseLive, insigniaURL } from './buildings.js';
import { SpriteCache, drawSprite, F } from './iso.js';
import { FACTIONS, FACTION_IDS, subIds, weaponOf } from './factions.js';
import { WEAPON, drawShot, recoilAt } from './weapons.js';
import { t, applyDom, setLang, getLang, languages, onLangChange } from './i18n.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const Z = 2.1;            // inspection zoom
const ZB = 0.8;           // typical in-match zoom
const CW = 300, CH = 176; // card canvas, world units at inspection zoom
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const big = new SpriteCache(), small = new SpriteCache();
big.setScale(dpr * Z);
small.setScale(dpr * ZB);

let team = COLORS[0];
const cards = [];

function vehicle(ctx, cache, f, sub, lvl, x, y, d, lt, fire) {
  const spec = unitSpec(f, sub, lvl);
  const lift = spec.hover ? spec.hover + Math.sin(lt * 3 + lvl) * 1.1 : 0;
  if (spec.hover) {
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + 3, spec.foot[0] * 0.92, spec.foot[0] * 0.92 * F, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.3 + 0.12 * Math.sin(lt * 5);
    ctx.fillStyle = FACTIONS[f].mat.glow;
    ctx.beginPath(); ctx.ellipse(x, y - lift * 0.4, spec.foot[0] * 0.7, spec.foot[0] * 0.7 * F, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  const a = d * STEP, fam = weaponOf(f, sub, lvl);
  const ph = (lt / WEAPON[fam].period) % 1;
  const rc = fire ? recoilAt(fam, ph) : 0;
  const px = x + Math.cos(a) * spec.pivot, py = y - lift + Math.sin(a) * spec.pivot * F;
  drawSprite(ctx, hullSprite(cache, f, sub, lvl, team, d), x, y - lift);
  drawSprite(ctx, turretSprite(cache, f, sub, lvl, team, d), px - Math.cos(a) * rc, py - Math.sin(a) * F * rc);
  if (fire) {
    const mx = px + Math.cos(a) * spec.muzzle, my = py + Math.sin(a) * F * spec.muzzle - spec.mz;
    drawShot(ctx, {
      fam, lvl, x: mx, y: my, tx: mx + Math.cos(a) * 46, ty: my + Math.sin(a) * F * 46 + spec.mz - 6, ph,
      seed: Math.floor(lt / WEAPON[fam].period) * 7 + lvl, lt, A: FACTIONS[f].subs[sub].accent2, G: FACTIONS[f].mat.glow,
    });
  }
}

function drawCard(c, lt) {
  const { ctx, f, sub } = c;
  const k = dpr * Z;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#4a5733';
  ctx.fillRect(0, 0, c.cv.width, c.cv.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // structures (back row)
  [1, 2, 3].forEach((lv, i) => {
    const x = 52 + i * 98, y = 78;
    drawSprite(ctx, baseSprite(big, f, sub, lv, team), x, y);
    drawBaseLive(ctx, baseInfo(f, sub, lv, team), team, x, y, lt, i * 1.9);
  });

  // units (front row): infantry toward and away, vehicles turning slowly
  const frame = Math.floor(lt * 8) & 3;
  drawSprite(ctx, soldierSprite(big, f, sub, team, 1, frame), 22, 152);
  drawSprite(ctx, soldierSprite(big, f, sub, team, 0, frame), 42, 150);
  drawSprite(ctx, soldierSprite(big, f, sub, team, 5, frame), 62, 153);
  const d = Math.floor(lt * 2.2) % DIRS;
  vehicle(ctx, big, f, sub, 2, 110, 146, 3, lt, true);
  vehicle(ctx, big, f, sub, 2, 166, 150, d, lt, false);
  vehicle(ctx, big, f, sub, 3, 222, 146, 3, lt, true);
  vehicle(ctx, big, f, sub, 3, 276, 150, (d + 16) % DIRS, lt, false);

  // the same units at battle zoom
  const b = c.bctx, kb = dpr * ZB;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.fillStyle = '#4a5733';
  b.fillRect(0, 0, c.bcv.width, c.bcv.height);
  b.setTransform(kb, 0, 0, kb, 0, 0);
  b.lineCap = 'round';
  for (let i = 0; i < 6; i++) drawSprite(b, soldierSprite(small, f, sub, team, 1, (frame + i) & 3), 16 + (i % 3) * 11 + (i > 2 ? 5 : 0), 30 + (i > 2 ? 12 : 0));
  for (let i = 0; i < 3; i++) vehicle(b, small, f, sub, 2, 84 + i * 30, 30 + i * 6, 3, lt, i === 0);
  for (let i = 0; i < 2; i++) vehicle(b, small, f, sub, 3, 200 + i * 36, 30 + i * 6, 3, lt, i === 0);
  drawSprite(b, baseSprite(small, f, sub, 1, team), 300, 36);
  drawSprite(b, baseSprite(small, f, sub, 2, team), 384, 36);
  drawSprite(b, baseSprite(small, f, sub, 3, team), 468, 36);
}

function build() {
  const list = $('arm-list');
  list.textContent = '';
  cards.length = 0;
  for (const f of FACTION_IDS) {
    const sec = el('section', 'arm-faction');
    sec.style.setProperty('--c', FACTIONS[f].accent);
    const head = el('div', 'arm-fhead');
    head.append(el('h2', '', t(`factions.${f}.name`)), el('p', '', t(`factions.${f}.desc`)));
    sec.append(head);
    const row = el('div', 'arm-subs');
    for (const sub of subIds(f)) {
      const card = el('article', 'arm-card');
      const title = el('div', 'arm-title');
      const img = el('img');
      img.src = insigniaURL(f, sub, team);
      img.alt = '';
      const names = el('div');
      names.append(el('h3', '', t(`factions.${f}.subs.${sub}.name`)), el('p', '', t(`factions.${f}.subs.${sub}.desc`)));
      title.append(img, names);

      const cv = el('canvas', 'arm-cv');
      cv.width = Math.round(CW * Z * dpr);
      cv.height = Math.round(CH * Z * dpr);
      const units = el('ul', 'arm-units');
      for (const lv of [1, 2, 3]) {
        const li = el('li');
        li.append(
          el('b', '', t(`factions.${f}.units.${lv}.name`)),
          el('span', 'arm-role', `${t(`roles.${lv}`)} · ${t(`weapons.${weaponOf(f, sub, lv)}`)}`),
          el('span', '', t(`factions.${f}.units.${lv}.desc`)),
        );
        units.append(li);
      }
      const structs = el('p', 'arm-structs', `${t('armory.structures')}: ${[1, 2, 3].map(lv => t(`factions.${f}.buildings.${lv}`)).join(' · ')}`);
      const bcv = el('canvas', 'arm-bcv');
      bcv.width = Math.round(520 * ZB * dpr);
      bcv.height = Math.round(70 * ZB * dpr);
      card.append(title, cv, units, structs, el('small', '', t('armory.battleZoom')), bcv);
      row.append(card);
      cards.push({ f, sub, cv, ctx: cv.getContext('2d'), bcv, bctx: bcv.getContext('2d') });
    }
    sec.append(row);
    list.append(sec);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const lt = now / 1000;
  for (const c of cards) {
    const r = c.cv.getBoundingClientRect();
    if (r.bottom < -50 || r.top > innerHeight + 50) continue;   // only animate what is on screen
    drawCard(c, lt);
  }
}

// ---------------------------------------------------------------- controls

const colors = $('arm-colors');
COLORS.forEach(c => {
  const b = el('button', 'swatch');
  b.type = 'button';
  b.style.setProperty('--c', c.main);
  b.title = t(`colors.${c.id}`);
  b.setAttribute('aria-label', b.title);
  b.onclick = () => { team = c; build(); };
  colors.append(b);
});
$('arm-gray').onchange = e => document.body.classList.toggle('gray', e.target.checked);

for (const sel of document.querySelectorAll('.lang-select')) {
  for (const l of languages()) {
    const o = el('option', '', l.name);
    o.value = l.code;
    sel.append(o);
  }
  sel.value = getLang();
  sel.addEventListener('change', () => setLang(sel.value));
}
onLangChange(build);

applyDom();
build();
requestAnimationFrame(frame);
