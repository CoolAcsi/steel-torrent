// Proof of concept: the battlefield on Three.js.
//
// Same scene as the Babylon.js PoC (see ../shared/scene.js). What Three.js adds
// over the game's hand-written renderer here:
//   - physically based materials lit by an overcast sky (image-based lighting)
//   - soft filtered shadows
//   - ground-truth ambient occlusion (GTAO) as a post pass
//   - blurred planar reflections weighted by the ground's wetness map
//   - HDR bloom on lamps and lit windows, filmic tone mapping, 4x MSAA
//   - depth fog, so the skyline fades into the rain
// Number plates and rain stay on a 2D canvas above, positioned through the camera.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildScene, fitCamera, makeView, attachControls, PITCH, SUN, FOG } from '../shared/scene.js';
import { modelBuckets, groupInstances } from '../shared/meshdata.js';
import { facadeTextures, towerParts } from '../shared/facade.js';
import { makeOverlay, makePanel } from '../shared/overlay.js';

// ?lite=1: the tuned profile -- ambient occlusion and bloom at half resolution, 2048 shadow map.
const LITE = new URLSearchParams(location.search).has('lite');
const t0 = performance.now();
const S = buildScene();
const tScene = performance.now() - t0;

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.info.autoReset = false;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const fogColor = new THREE.Color().setRGB(FOG[0], FOG[1], FOG[2], THREE.SRGBColorSpace);
scene.background = fogColor;
scene.fog = new THREE.Fog(fogColor, 1, 2);
const world = new THREE.Group();          // everything that stands on the ground (and is mirrored in it)
scene.add(world);

// ------------------------------------------------------------ light

// Overcast sky as an environment map: pale overhead, bright at the horizon, dark below.
{
  const sky = new THREE.Scene();
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP;
      void main() {
        float h = normalize(vP).y;
        vec3 c = h > 0.0 ? mix(vec3(0.86, 0.90, 0.95), vec3(0.60, 0.69, 0.80), pow(h, 0.55))
                         : mix(vec3(0.40, 0.43, 0.46), vec3(0.13, 0.15, 0.17), pow(-h, 0.4));
        gl_FragColor = vec4(c * 1.15, 1.0);
      }`,
  })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(sky, 0.03).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
}
const hemi = new THREE.HemisphereLight(0xc6d4e6, 0x4c5158, 0.3);
const sun = new THREE.DirectionalLight(0xeaf1ff, 0.95);
sun.castShadow = true;
sun.shadow.mapSize.set(LITE ? 2048 : 4096, LITE ? 2048 : 4096);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.7;
sun.shadow.radius = 5;
scene.add(hemi, sun, sun.target);

// ------------------------------------------------------------ meshes from the game's models

const stdCache = new Map();
function bucketMaterial(b) {
  const key = b.glow ? 'glow' : `${b.metal}|${b.rough}`;
  let m = stdCache.get(key);
  if (!m) {
    m = b.emissive
      ? new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(3.2, 3.2, 3.2) })     // HDR, so it blooms
      : new THREE.MeshStandardMaterial({ vertexColors: true, metalness: b.metal, roughness: b.rough });
    stdCache.set(key, m);
  }
  return m;
}

const dummy = new THREE.Object3D();
function addInstances(groups, scale = 1, lift = 0, yawOffset = 0, shadows = true) {
  for (const g of groups) {
    for (const b of modelBuckets(g.model(), scale)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(b.color, 3));
      const mesh = new THREE.InstancedMesh(geo, bucketMaterial(b), g.items.length);
      g.items.forEach((it, i) => {
        dummy.position.set(it.x, (it.y || 0) + lift, it.z);
        dummy.rotation.set(0, -((it.yaw || 0) + yawOffset), 0);       // game yaw turns x toward the camera
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.castShadow = shadows && !b.emissive;
      mesh.receiveShadow = !b.emissive;
      world.add(mesh);
    }
  }
}

addInstances(groupInstances(S.cities.map(c => ({ key: c.padKey, model: c.pad, x: c.x, z: c.z }))));
addInstances(groupInstances(S.cities.map(c => ({ key: c.baseKey, model: c.base, x: c.x, z: c.z }))), S.cities[0].baseScale, 3, Math.PI / 4);
addInstances(groupInstances(S.units));
addInstances(groupInstances(S.lamps.map(p => ({ key: 'lamp', model: S.lamp, x: p.x, z: p.z }))), 1, 0, 0, false);

// ------------------------------------------------------------ towers

{
  const tex = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const facades = [[], [], []], plain = [];
  const KIND = { plinth: '#8f969d', cornice: '#8f8c85', plant: '#3e4247', mast: '#2e3338' };
  const turn = new THREE.Matrix4();
  for (const t of S.towers) {
    turn.makeRotationY(Math.PI / 4).setPosition(t.x, 0, t.z);
    for (const p of towerParts(t).parts) {
      const g = new THREE.BoxGeometry(p.hw * 2, p.y1 - p.y0, p.hd * 2);
      g.translate(p.ox || 0, (p.y0 + p.y1) / 2, p.oz || 0);
      g.applyMatrix4(turn);
      if (p.kind === 'facade') {
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * p.bays / 4, uv.getY(i) * p.floors / 4);
        facades[t.look].push(g);
      } else {
        const c = new THREE.Color(KIND[p.kind]), n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        plain.push(g);
      }
    }
  }
  facades.forEach((list, look) => {
    if (!list.length) return;
    const T = facadeTextures(look);
    const mesh = new THREE.Mesh(mergeGeometries(list), new THREE.MeshStandardMaterial({
      map: tex(T.albedo, true), roughnessMap: tex(T.rough, false), roughness: 1, metalness: 0,
      emissiveMap: tex(T.light, true), emissive: 0xffffff, emissiveIntensity: 1.5,
    }));
    mesh.castShadow = mesh.receiveShadow = true;
    world.add(mesh);
  });
  const mesh = new THREE.Mesh(mergeGeometries(plain), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 }));
  mesh.castShadow = mesh.receiveShadow = true;
  world.add(mesh);
}

// ------------------------------------------------------------ trees (real ones, instanced)

{
  const tint = (g, hex) => {
    if (g.index) g = g.toNonIndexed();
    const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const kinds = [
    mergeGeometries([
      tint(new THREE.CylinderGeometry(1, 1.3, 5, 6).translate(0, 2.5, 0), '#2c2218'),
      tint(new THREE.ConeGeometry(8, 12, 7).translate(0, 10, 0), '#2c5a36'),
      tint(new THREE.ConeGeometry(6.4, 11, 7).translate(0, 16, 0), '#34683f'),
      tint(new THREE.ConeGeometry(4.6, 10, 7).translate(0, 22, 0), '#3e7548'),
    ]),
    mergeGeometries([
      tint(new THREE.CylinderGeometry(1.1, 1.5, 7, 6).translate(0, 3.5, 0), '#2c2218'),
      tint(new THREE.IcosahedronGeometry(9, 1).scale(1, 0.88, 1).translate(0, 14, 0), '#3b6b3d'),
      tint(new THREE.IcosahedronGeometry(6, 1).translate(-4, 18, 2), '#4a7d4a'),
    ]),
  ];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
  kinds.forEach((geo, kind) => {
    const list = S.trees.filter(t => t.kind === kind);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, i * 2.4, 0);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    dummy.scale.setScalar(1);
    mesh.castShadow = mesh.receiveShadow = true;
    world.add(mesh);
  });
}

// ------------------------------------------------------------ ground with wet reflections

const reflRT = new THREE.WebGLRenderTarget(4, 4, {
  type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
});
const uRes = { value: new THREE.Vector2(1, 1) }, uReflectK = { value: 1 };
let ground;
{
  const G = S.ground;
  const albedo = new THREE.CanvasTexture(G.albedo);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = maxAniso;
  const wet = new THREE.CanvasTexture(G.wet);
  wet.anisotropy = maxAniso;
  const geo = new THREE.PlaneGeometry(G.x1 - G.x0, G.z1 - G.z0).rotateX(-Math.PI / 2).translate((G.x0 + G.x1) / 2, 0, (G.z0 + G.z1) / 2);
  const mat = new THREE.MeshStandardMaterial({ map: albedo, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tWet: { value: wet }, tReflect: { value: reflRT.texture }, uRes, uReflectK });
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tWet;\nuniform sampler2D tReflect;\nuniform vec2 uRes;\nuniform float uReflectK;')
      // Roughness straight from the wetness map: puddles are mirrors, dry stone is matt.
      .replace('#include <roughnessmap_fragment>', 'float wetK = texture2D( tWet, vMapUv ).r;\nfloat roughnessFactor = mix( 0.95, 0.10, wetK * wetK );')
      // The mirrored scene, blurrier where the ground is less wet, laid over the lit ground.
      .replace('#include <opaque_fragment>', `
        vec3 mirror = textureLod( tReflect, gl_FragCoord.xy / uRes, 0.4 + ( 1.0 - wetK ) * 4.5 ).rgb;
        outgoingLight = mix( outgoingLight, mirror, uReflectK * smoothstep( 0.3, 1.0, wetK ) * 0.62 );
        #include <opaque_fragment>`);
  };
  ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  scene.add(ground);
}

// ------------------------------------------------------------ camera, post-processing, overlay

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 200, 7000);
const DIST = 3000;
const composerRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 4, 4);
gtao.updateGtaoMaterial({ radius: 16, distanceExponent: 1.2, thickness: 1.2, scale: 1.25, samples: 12, screenSpaceRadius: false });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
gtao.blendIntensity = 0.95;
composer.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.34, 0.75, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const v3 = new THREE.Vector3();
let cssW = 1, cssH = 1;
const overlay = makeOverlay(document.getElementById('ov'), S.plates, (x, y, z) => {
  v3.set(x, y, z).project(camera);
  return [(v3.x * 0.5 + 0.5) * cssW, (0.5 - v3.y * 0.5) * cssH];
});

const view = makeView();
let pxPerUnit = 1;
function layout() {
  cssW = Math.max(2, window.innerWidth); cssH = Math.max(2, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(cssW, cssH);
  composer.setPixelRatio(dpr);
  composer.setSize(cssW, cssH);
  if (LITE) { gtao.setSize(cssW * dpr / 2, cssH * dpr / 2); bloom.setSize(cssW * dpr / 2, cssH * dpr / 2); }
  reflRT.setSize(Math.round(cssW * dpr / 2), Math.round(cssH * dpr / 2));
  uRes.value.set(cssW * dpr, cssH * dpr);
  overlay.resize(cssW, cssH, dpr);

  const c = fitCamera(S.frame, cssW, cssH, view);
  pxPerUnit = c.scale;
  camera.left = -c.halfW; camera.right = c.halfW; camera.top = c.halfH; camera.bottom = -c.halfH;
  camera.position.set(c.target[0] + c.dir[0] * DIST, c.target[1] + c.dir[1] * DIST, c.target[2] + c.dir[2] * DIST);
  camera.lookAt(c.target[0], c.target[1], c.target[2]);
  camera.updateProjectionMatrix();

  // Haze starts a little in front of the middle of the field and reaches ~45% at its far edge;
  // the skyline beyond that dissolves into it.
  // (measured on the whole field, so zooming in does not change the weather)
  const full = fitCamera(S.frame, cssW, cssH);
  const reach = (full.halfH / Math.sin(PITCH)) * Math.cos(PITCH);
  const shift = (c.target[2] - full.target[2]) * Math.cos(PITCH);     // how much nearer the zoomed camera sits
  scene.fog.near = DIST + shift + reach * 0.1;
  scene.fog.far = scene.fog.near + (reach * 0.9) / 0.3;

  const span = Math.hypot(c.halfW, c.halfH / Math.sin(PITCH)) + 260;
  sun.target.position.set(c.target[0], 0, c.target[2]);
  sun.position.set(c.target[0] + SUN[0] * 2000, SUN[1] * 2000, c.target[2] + SUN[2] * 2000);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 200, far: 4500 });
  sun.shadow.camera.updateProjectionMatrix();
}
window.addEventListener('resize', layout);
layout();
attachControls(canvas, S.frame, view, () => pxPerUnit, layout);

// ------------------------------------------------------------ frame

const flags = { reflections: true };
const skyC = hemi.color.clone(), gndC = hemi.groundColor.clone();

function renderFrame(lt) {
  if (window.innerWidth < 2 || window.innerHeight < 2) return;        // hidden tab: nothing to draw into
  renderer.info.reset();
  if (flags.reflections) {
    // Reflection pass: the whole world mirrored in the ground plane, lights included, so the
    // mirror image is lit and shadowed exactly like the original. Same camera, so it lands on
    // screen where the reflection belongs and the ground shader can sample it by pixel.
    world.scale.y = -1;
    sun.position.y *= -1;
    hemi.color.copy(gndC); hemi.groundColor.copy(skyC);
    scene.environmentRotation.x = Math.PI;
    ground.visible = false;
    renderer.setRenderTarget(reflRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    world.scale.y = 1;
    sun.position.y *= -1;
    hemi.color.copy(skyC); hemi.groundColor.copy(gndC);
    scene.environmentRotation.x = 0;
    ground.visible = true;
  }
  composer.render();
  overlay.draw(lt);
}

let last = 0, avg = 0, shown = 0;
const panel = makePanel('Three.js r' + THREE.REVISION + (LITE ? ' · tuned' : ''), [
  { label: 'Wet reflections', key: 'R', get: () => flags.reflections, set: v => { flags.reflections = v; uReflectK.value = v ? 1 : 0; } },
  { label: 'Ambient occlusion', key: 'O', get: () => gtao.enabled, set: v => { gtao.enabled = v; } },
  { label: 'Bloom', key: 'B', get: () => bloom.enabled, set: v => { bloom.enabled = v; } },
  { label: 'Shadows', key: 'S', get: () => sun.castShadow, set: v => { sun.castShadow = v; } },
  { label: 'Rain', key: 'W', get: () => overlay.state.rain, set: v => { overlay.state.rain = v; } },
  { label: 'Number plates', key: 'P', get: () => overlay.state.plates, set: v => { overlay.state.plates = v; } },
]);

function loop(now) {
  requestAnimationFrame(loop);
  const lt = now / 1000;
  if (last) avg = avg ? avg * 0.95 + (now - last) * 0.05 : now - last;
  last = now;
  renderFrame(lt);
  if (now - shown > 500) {
    shown = now;
    const i = renderer.info.render;
    panel.stats(`${(1000 / (avg || 16.7)).toFixed(0)} fps   ${i.calls} draw calls\n${(i.triangles / 1000).toFixed(0)}k triangles per frame\n[H] hide this panel`);
  }
}
requestAnimationFrame(loop);

// For measuring: frames rendered back to back with the GPU forced to finish each one.
window.__poc = {
  engine: 'three', scene: S.counts, sceneMs: Math.round(tScene), startMs: Math.round(performance.now() - t0), panel, flags,
  bench(n = 100) {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    for (let i = 0; i < 10; i++) renderFrame(i * 0.016);
    const s = performance.now();
    for (let i = 0; i < n; i++) { renderFrame(i * 0.016); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    const i = renderer.info.render;
    return { msPerFrame: +((performance.now() - s) / n).toFixed(2), calls: i.calls, triangles: i.triangles, size: [canvas.width, canvas.height] };
  },
};
