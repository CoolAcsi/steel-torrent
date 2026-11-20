// Every locale must mirror the English key set and keep the same {placeholders}.
import assert from 'node:assert';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/js/locales');
const load = async f => (await import(path.join(dir, f))).default;
const en = await load('en.js');

const PLURAL = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const isPlural = v => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => PLURAL.has(k));

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlural(v)) out[key] = Object.values(v).join(' ');
    else if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}
const holes = s => [...new Set(s.match(/\{\w+\}/g) || [])].sort().join(',');

const base = flatten(en);
let checked = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'en.js')) {
  const loc = flatten(await load(f));
  const missing = Object.keys(base).filter(k => !(k in loc));
  const extra = Object.keys(loc).filter(k => !(k in base));
  assert.deepStrictEqual(missing, [], `${f}: missing keys`);
  assert.deepStrictEqual(extra, [], `${f}: unknown keys`);
  for (const k of Object.keys(base)) {
    assert.strictEqual(holes(loc[k]), holes(base[k]), `${f}: placeholders differ in "${k}"`);
    assert(loc[k].trim().length > 0, `${f}: empty string for "${k}"`);
  }
  checked++;
  console.log(`${f}: ${Object.keys(loc).length} keys ok`);
}
assert(checked > 0, 'no translations found');

// Keys referenced from markup and code must exist.
import { readFileSync } from 'node:fs';
const pub = path.join(dir, '../..');
const sources = ['index.html', 'armory.html', 'js/main.js', 'js/game.js', 'js/armory.js', 'js/tutorial.js'].map(f => readFileSync(path.join(pub, f), 'utf8')).join('\n');
const used = new Set();
for (const m of sources.matchAll(/data-i18n="([\w.]+)"/g)) used.add(m[1]);
for (const m of sources.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(';')) used.add(p.split(':')[1].trim());
for (const m of sources.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
const unknown = [...used].filter(k => !(k in base) && !isPluralKey(k));
function isPluralKey(k) { return Object.keys(base).some(b => b === k); }
assert.deepStrictEqual(unknown, [], 'keys used but not defined in en.js');
console.log(`${used.size} referenced keys ok`);
