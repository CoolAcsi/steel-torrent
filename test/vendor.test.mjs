// The 3D renderer and the vendored engine must load as plain ES modules under
// the game's Content-Security-Policy: no import map, no bare module names, no
// eval. This checks every import under public/vendor and public/js/3d resolves
// to a file that is served, and that the engine stays out of the first page load.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const SPEC = /(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?['"]([^'"\n]+)['"]|import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const importsOf = file => [...fs.readFileSync(file, 'utf8').matchAll(SPEC)].map(m => m[1] || m[2]);

let files = 0, imports = 0;
for (const file of [...walk(path.join(pub, 'vendor')), ...walk(path.join(pub, 'js'))].filter(f => f.endsWith('.js'))) {
  files++;
  for (const spec of importsOf(file)) {
    imports++;
    assert(spec.startsWith('.'), `${path.relative(root, file)}: bare module name "${spec}" cannot be loaded without an import map`);
    const target = path.join(path.dirname(file), spec);
    assert(fs.existsSync(target), `${path.relative(root, file)}: "${spec}" does not exist`);
    assert(target.startsWith(pub), `${path.relative(root, file)}: "${spec}" is outside public/`);
  }
}
for (const file of walk(path.join(pub, 'vendor')).filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(file, 'utf8');
  assert(!/\beval\s*\(|new Function\s*\(/.test(src), `${path.relative(root, file)} uses eval or new Function, which the CSP forbids`);
}

// Nothing that loads with the page may reach the engine by static import: it is fetched on demand only.
const seen = new Set();
(function follow(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?['"]([^'"\n]+)['"]/g)) follow(path.join(path.dirname(file), m[1]));
})(path.join(pub, 'js', 'main.js'));
const leaked = [...seen].filter(f => f.includes(`${path.sep}vendor${path.sep}`) || f.includes(`${path.sep}js${path.sep}3d${path.sep}`));
assert.deepStrictEqual(leaked.map(f => path.relative(pub, f)), [], 'the engine must not be part of the first page load');
assert(/import\(\s*'\.\/3d\/renderer\.js'\s*\)/.test(fs.readFileSync(path.join(pub, 'js', 'game.js'), 'utf8')), 'game.js should load the 3D renderer on demand');

const version = fs.readFileSync(path.join(pub, 'vendor', 'three', 'VERSION'), 'utf8').split('\n')[0];
const wanted = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.three;
assert.strictEqual(version, `three ${wanted.replace(/^[^\d]*/, '')}`, 'public/vendor/three is out of date: run node scripts/vendor-three.mjs');
console.log(`vendored modules ok (${files} files, ${imports} imports, ${version}; first page load reaches ${seen.size} modules, none of them the engine)`);
