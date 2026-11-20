// Copies the parts of Three.js the game uses into public/vendor/three.
//
// The game is served as plain ES modules under a strict Content-Security-Policy
// (script-src 'self', no inline scripts), so it can use neither a bundler step
// at deploy time nor an import map. Three's add-ons import the bare name
// 'three'; this script follows the imports from the entry files below, copies
// each file once and rewrites every bare 'three' to a relative path, so the
// browser can load the result as it is.
//
//   npm install            (three is a devDependency: only this script needs it)
//   node scripts/vendor-three.mjs
//
// The output is checked in. Re-run after changing the three version or ENTRIES.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'node_modules', 'three');
const OUT = path.join(root, 'public', 'vendor', 'three');

const ENTRIES = [
  'build/three.module.js',
  'examples/jsm/postprocessing/EffectComposer.js',
  'examples/jsm/postprocessing/TexturePass.js',
  'examples/jsm/postprocessing/GTAOPass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js',
  'examples/jsm/postprocessing/OutputPass.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
];

/** Where a source file lands: the build at the top, add-ons under addons/. */
const target = rel => (rel.startsWith('build/') ? rel.slice(6) : rel.replace(/^examples\/jsm\//, 'addons/'));
const SPEC = /((?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?)(['"])([^'"\n]+)\2/g;

const done = new Map();          // source path -> rewritten text
function take(rel) {
  if (done.has(rel)) return;
  done.set(rel, null);
  const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const out = src.replace(SPEC, (all, head, q, spec) => {
    let dep;
    if (spec === 'three') dep = 'build/three.module.js';
    else if (spec.startsWith('.')) dep = path.posix.join(path.posix.dirname(rel), spec);
    else if (spec.startsWith('three/addons/')) dep = `examples/jsm/${spec.slice(13)}`;
    else throw new Error(`${rel}: cannot vendor import "${spec}"`);
    take(dep);
    let to = path.posix.relative(path.posix.dirname(target(rel)), target(dep));
    if (!to.startsWith('.')) to = `./${to}`;
    return `${head}${q}${to}${q}`;
  });
  done.set(rel, out);
}
for (const e of ENTRIES) take(e);

fs.rmSync(OUT, { recursive: true, force: true });
let bytes = 0;
for (const [rel, text] of done) {
  const file = path.join(OUT, target(rel));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  bytes += text.length;
}
const version = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;
fs.copyFileSync(path.join(SRC, 'LICENSE'), path.join(OUT, 'LICENSE'));
fs.writeFileSync(path.join(OUT, 'VERSION'), `three ${version}\nvendored by scripts/vendor-three.mjs; do not edit by hand\n`);
console.log(`three ${version}: ${done.size} files, ${(bytes / 1024).toFixed(0)} KB -> public/vendor/three`);
