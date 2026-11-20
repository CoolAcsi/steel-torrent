// Localization. All player-facing text lives in ./locales/<code>.js.
//
// To add a language: copy locales/en.js to locales/<code>.js, translate the
// values, then import it here and add it to LOCALES. Nothing else changes —
// the selector, detection and fallback pick it up automatically.
import en from './locales/en.js';
import zhCN from './locales/zh-CN.js';

const LOCALES = {
  en,
  'zh-CN': zhCN,
};
const FALLBACK = 'en';
const STORE_KEY = 'st_lang';

let lang = FALLBACK;
let numberFmt = new Intl.NumberFormat(FALLBACK);
const pluralRules = {};
const listeners = new Set();

function lookup(dict, key) {
  let v = dict;
  for (const part of key.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[part];
  }
  return v;
}

function plural(code, n) {
  const pr = pluralRules[code] || (pluralRules[code] = new Intl.PluralRules(code));
  return pr.select(n);
}

/** Best supported locale for a BCP 47 tag: exact match, then same language. */
function match(tag) {
  if (!tag) return null;
  const want = String(tag).toLowerCase();
  const codes = Object.keys(LOCALES);
  return codes.find(c => c.toLowerCase() === want)
    || codes.find(c => c.toLowerCase().split('-')[0] === want.split('-')[0])
    || null;
}

/** Saved choice, else the first system language we support, else English. */
export function detectLang() {
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch { /* storage unavailable */ }
  if (saved && LOCALES[saved]) return saved;
  for (const tag of navigator.languages || [navigator.language]) {
    const m = match(tag);
    if (m) return m;
  }
  return FALLBACK;
}

export function languages() {
  return Object.keys(LOCALES).map(code => ({ code, name: LOCALES[code].$name || code }));
}

export function getLang() {
  return lang;
}

/**
 * Translate `key` (dotted path). `{name}` placeholders are filled from
 * `params`; numbers are formatted for the locale. A value may be an object of
 * plural forms ({ one, other, ... }), chosen by `params.count`.
 * Missing keys fall back to English, then to the key itself.
 */
export function t(key, params) {
  let code = lang;
  let v = lookup(LOCALES[lang], key);
  if (v == null) { code = FALLBACK; v = lookup(LOCALES[FALLBACK], key); }
  if (v == null) return key;
  if (typeof v === 'object') {
    const n = Number(params && params.count) || 0;
    v = v[plural(code, n)] ?? v.other ?? Object.values(v)[0];
  }
  if (!params) return String(v);
  return String(v).replace(/\{(\w+)\}/g, (m, name) => {
    const x = params[name];
    if (x == null) return m;
    return typeof x === 'number' ? numberFmt.format(x) : String(x);
  });
}

/** Locale-aware number. */
export function fmt(n) {
  return numberFmt.format(n);
}

/** Fill every element carrying data-i18n / data-i18n-attr under `root`. */
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}

export function setLang(code, persist = true) {
  lang = LOCALES[code] ? code : FALLBACK;
  numberFmt = new Intl.NumberFormat(lang);
  if (persist) {
    try { localStorage.setItem(STORE_KEY, lang); } catch { /* ignore */ }
  }
  document.documentElement.lang = lang;
  document.title = t('app.title');
  applyDom();
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn) {
  listeners.add(fn);
}

// Applied on import so nothing renders untranslated. Detection is not
// persisted: only an explicit choice in the selector is remembered.
setLang(detectLang(), false);
