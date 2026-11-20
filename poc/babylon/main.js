// Proof of concept: the battlefield on Babylon.js.
//
// Same scene as the Three.js PoC (see ../shared/scene.js). Here almost
// everything comes from the engine itself rather than from custom shaders:
//   - PBR materials lit by an overcast environment
//   - percentage-closer soft shadows
//   - SSAO2 ambient occlusion pipeline
//   - MirrorTexture planar reflections (engine-blurred), laid over the ground
//     through the wetness map
//   - DefaultRenderingPipeline: HDR bloom, ACES tone mapping, 4x MSAA
//   - scene fog, so the skyline fades into the rain
// Number plates and rain stay on a 2D canvas above, positioned through the camera.
/* global BABYLON */
import { buildScene, fitCamera, makeView, attachControls, PITCH, SUN, FOG } from '../shared/scene.js';
import { modelBuckets, groupInstances } from '../shared/meshdata.js';
import { facadeTextures, towerParts } from '../shared/facade.js';
import { makeOverlay, makePanel } from '../shared/overlay.js';

const B = BABYLON;
// ?lite=1: the tuned profile -- ambient occlusion and bloom at half resolution, 2048 shadow map.
const LITE = new URLSearchParams(location.search).has('lite');
const t0 = performance.now();
const S = buildScene();
const tScene = performance.now() - t0;

const canvas = document.getElementById('gl');
const engine = new B.Engine(canvas, false, { stencil: false, powerPreference: 'high-performance' });
const scene = new B.Scene(engine);
scene.useRightHandedSystem = true;                 // X right, Y up, Z toward the camera, like the shared scene
scene.skipPointerMovePicking = true;
const fogLinear = new B.Color3(FOG[0], FOG[1], FOG[2]).toLinearSpace();
scene.clearColor = new B.Color4(fogLinear.r, fogLinear.g, fogLinear.b, 1);
scene.fogMode = B.Scene.FOGMODE_LINEAR;
scene.fogColor = fogLinear;

const camera = new B.FreeCamera('cam', new B.Vector3(0, 1000, 1000), scene);
camera.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
camera.minZ = 200; camera.maxZ = 7000;
const DIST = 3000;

// ------------------------------------------------------------ light

{
  // Overcast sky as an environment: pale overhead, bright at the horizon, dark below.
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#a9bdd4'); grad.addColorStop(0.46, '#e6edf5'); grad.addColorStop(0.5, '#aab0b6'); grad.addColorStop(0.62, '#5a5f64'); grad.addColorStop(1, '#3c4044');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
  scene.environmentTexture = new B.EquiRectangularCubeTexture(c.toDataURL('image/png'), scene, 128);
  scene.environmentIntensity = 0.8;
}
const hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene);
hemi.diffuse = B.Color3.FromHexString('#c6d4e6').toLinearSpace();
hemi.groundColor = B.Color3.FromHexString('#4c5158').toLinearSpace();
hemi.specular = B.Color3.Black();
hemi.intensity = 0.8;
const sun = new B.DirectionalLight('sun', new B.Vector3(-SUN[0], -SUN[1], -SUN[2]), scene);
sun.diffuse = B.Color3.FromHexString('#eaf1ff').toLinearSpace();
sun.intensity = 2.2;
sun.autoUpdateExtends = false;
sun.autoCalcShadowZBounds = false;
const shadows = new B.ShadowGenerator(LITE ? 2048 : 4096, sun);
shadows.usePercentageCloserFiltering = true;
shadows.filteringQuality = B.ShadowGenerator.QUALITY_HIGH;
shadows.bias = 0.0006;
shadows.normalBias = 0.012;
shadows.darkness = 0.1;

// ------------------------------------------------------------ meshes from the game's models

const worldMeshes = [];                 // everything that stands on the ground (and is mirrored in it)
function register(mesh, cast = true) {
  mesh.receiveShadows = true;
  mesh.alwaysSelectAsActiveMesh = true;                    // static scene: skip per-frame culling tests
  if (cast) shadows.addShadowCaster(mesh);
  worldMeshes.push(mesh);
  return mesh;
}

const matCache = new Map();
function bucketMaterial(b) {
  const key = b.glow ? `glow|${b.glow.join()}` : `${b.metal}|${b.rough}`;
  let m = matCache.get(key);
  if (!m) {
    m = new B.PBRMaterial(`m${key}`, scene);
    m.backFaceCulling = false;
    if (b.glow) {                                           // a light source: its own colour, bright enough to bloom
      m.albedoColor = B.Color3.Black(); m.metallic = 0; m.roughness = 1;
      m.emissiveColor = new B.Color3(b.glow[0], b.glow[1], b.glow[2]);
      m.emissiveIntensity = 3.2;
    } else { m.albedoColor = B.Color3.White(); m.metallic = b.metal; m.roughness = b.rough; }
    matCache.set(key, m);
  }
  return m;
}

/** 4x4 for "turn about the vertical by the game's yaw, scale, move": same layout as a GL column-major matrix. */
function place(out, o, x, y, z, yaw, s = 1) {
  const c = Math.cos(-yaw) * s, n = Math.sin(-yaw) * s;
  out.set([c, 0, -n, 0, 0, s, 0, 0, n, 0, c, 0, x, y, z, 1], o);
}

function addInstances(groups, scale = 1, lift = 0, yawOffset = 0, cast = true) {
  for (const g of groups) {
    modelBuckets(g.model(), scale).forEach((b, bi) => {
      const mesh = new B.Mesh(`${g.key}#${bi}`, scene);
      const vd = new B.VertexData();
      const n = b.position.length / 3;
      vd.positions = b.position;
      vd.normals = b.normal;
      const rgba = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { rgba[i * 4] = b.color[i * 3]; rgba[i * 4 + 1] = b.color[i * 3 + 1]; rgba[i * 4 + 2] = b.color[i * 3 + 2]; rgba[i * 4 + 3] = 1; }
      vd.colors = rgba;
      vd.indices = Uint32Array.from({ length: n }, (_, i) => i);
      vd.applyToMesh(mesh);
      mesh.useVertexColors = !b.glow;
      mesh.hasVertexAlpha = false;
      mesh.material = bucketMaterial(b);
      const buf = new Float32Array(g.items.length * 16);
      g.items.forEach((it, i) => place(buf, i * 16, it.x, (it.y || 0) + lift, it.z, (it.yaw || 0) + yawOffset));
      mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
      register(mesh, cast && !b.emissive);
    });
  }
}

addInstances(groupInstances(S.cities.map(c => ({ key: c.padKey, model: c.pad, x: c.x, z: c.z }))));
addInstances(groupInstances(S.cities.map(c => ({ key: c.baseKey, model: c.base, x: c.x, z: c.z }))), S.cities[0].baseScale, 3, Math.PI / 4);
addInstances(groupInstances(S.units));
addInstances(groupInstances(S.lamps.map(p => ({ key: 'lamp', model: S.lamp, x: p.x, z: p.z }))), 1, 0, 0, false);

// ------------------------------------------------------------ towers

{
  const tex = cv => {
    const t = new B.DynamicTexture('t', cv, scene, true);
    t.update();
    t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 8;
    return t;
  };
  const KIND = { plinth: '#8f969d', cornice: '#8f8c85', plant: '#3e4247', mast: '#2e3338' };
  const facades = [[], [], []], plain = [];
  let id = 0;
  for (const t of S.towers) {
    for (const p of towerParts(t).parts) {
      const opt = { width: p.hw * 2, height: p.y1 - p.y0, depth: p.hd * 2 };
      if (p.kind === 'facade') opt.faceUV = Array.from({ length: 6 }, () => new B.Vector4(0, 0, p.bays / 4, p.floors / 4));
      else { const c = B.Color3.FromHexString(KIND[p.kind]).toLinearSpace(); opt.faceColors = Array.from({ length: 6 }, () => new B.Color4(c.r, c.g, c.b, 1)); }
      const box = B.MeshBuilder.CreateBox(`tw${id++}`, opt, scene);
      // the part sits on the tower's own axes, the tower is turned 45 degrees to line up with the paving
      const a = Math.PI / 4, ox = p.ox || 0, oz = p.oz || 0;
      box.rotation.y = a;
      box.position.set(t.x + ox * Math.cos(a) + oz * Math.sin(a), (p.y0 + p.y1) / 2, t.z - ox * Math.sin(a) + oz * Math.cos(a));
      (p.kind === 'facade' ? facades[t.look] : plain).push(box);
    }
  }
  facades.forEach((list, look) => {
    if (!list.length) return;
    const T = facadeTextures(look);
    const mesh = B.Mesh.MergeMeshes(list, true, true);
    const m = new B.PBRMaterial(`facade${look}`, scene);
    m.albedoTexture = tex(T.albedo);
    m.metallicTexture = tex(T.rough);                       // green = roughness, blue = metalness (none)
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useRoughnessFromMetallicTextureAlpha = false;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.metallic = 1; m.roughness = 1;
    m.emissiveTexture = tex(T.light);
    m.emissiveColor = B.Color3.White();
    m.emissiveIntensity = 1.5;
    mesh.material = m;
    register(mesh);
  });
  const mesh = B.Mesh.MergeMeshes(plain, true, true);
  const m = new B.PBRMaterial('towerPlain', scene);
  m.albedoColor = B.Color3.White(); m.metallic = 0.05; m.roughness = 0.78;
  mesh.useVertexColors = true; mesh.hasVertexAlpha = false;
  mesh.material = m;
  register(mesh);
}

// ------------------------------------------------------------ trees (real ones, instanced)

{
  const tint = (mesh, hex) => {
    mesh.convertToFlatShadedMesh();
    const c = B.Color3.FromHexString(hex).toLinearSpace(), n = mesh.getTotalVertices(), col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b, 1], i * 4);
    mesh.setVerticesData(B.VertexBuffer.ColorKind, col, false, 4);
    return mesh;
  };
  const cone = (r, h, y, hex) => { const m = B.MeshBuilder.CreateCylinder('c', { diameterTop: 0, diameterBottom: r * 2, height: h, tessellation: 7 }, scene); m.position.y = y; return tint(m, hex); };
  const trunk = (r, h) => { const m = B.MeshBuilder.CreateCylinder('t', { diameterTop: r * 2, diameterBottom: r * 2.6, height: h, tessellation: 6 }, scene); m.position.y = h / 2; return tint(m, '#2c2218'); };
  const ball = (r, x, y, z, sy, hex) => { const m = B.MeshBuilder.CreateIcoSphere('i', { radius: r, subdivisions: 2 }, scene); m.position.set(x, y, z); m.scaling.y = sy; return tint(m, hex); };
  const kinds = [
    B.Mesh.MergeMeshes([trunk(1, 5), cone(8, 12, 10, '#2c5a36'), cone(6.4, 11, 16, '#34683f'), cone(4.6, 10, 22, '#3e7548')], true, true),
    B.Mesh.MergeMeshes([trunk(1.1, 7), ball(9, 0, 14, 0, 0.88, '#3b6b3d'), ball(6, -4, 18, 2, 1, '#4a7d4a')], true, true),
  ];
  const mat = new B.PBRMaterial('tree', scene);
  mat.albedoColor = B.Color3.White(); mat.metallic = 0; mat.roughness = 0.92;
  kinds.forEach((mesh, kind) => {
    const list = S.trees.filter(t => t.kind === kind);
    mesh.useVertexColors = true; mesh.hasVertexAlpha = false;
    mesh.material = mat;
    const buf = new Float32Array(list.length * 16);
    list.forEach((t, i) => place(buf, i * 16, t.x, 0, t.z, i * 2.4, t.s));
    mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
    register(mesh);
  });
}

// ------------------------------------------------------------ ground with wet reflections

let mirror, wetSheet;
{
  const G = S.ground;
  const quad = (name, y) => {
    const m = new B.Mesh(name, scene), vd = new B.VertexData();
    vd.positions = [G.x0, y, G.z0, G.x1, y, G.z0, G.x0, y, G.z1, G.x1, y, G.z1];
    vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    vd.uvs = [0, 1, 1, 1, 0, 0, 1, 0];                      // far edge = top of the painting
    vd.indices = [0, 2, 1, 1, 2, 3];
    vd.applyToMesh(m);
    m.alwaysSelectAsActiveMesh = true;
    return m;
  };

  // Two maps derived from the wetness painting: roughness (green) for the ground itself,
  // and how much mirror to lay over it.
  const w = 2048, h = Math.round(2048 * G.wet.height / G.wet.width);
  const orm = document.createElement('canvas'), mask = document.createElement('canvas');
  orm.width = mask.width = w; orm.height = mask.height = h;
  const oc = orm.getContext('2d'), mc = mask.getContext('2d');
  oc.drawImage(G.wet, 0, 0, w, h);
  const src = oc.getImageData(0, 0, w, h), dst = mc.createImageData(w, h);
  for (let i = 0; i < src.data.length; i += 4) {
    const k = src.data[i] / 255;
    const t = Math.max(0, Math.min(1, (k - 0.3) / 0.7)), a = t * t * (3 - 2 * t) * 0.62;
    src.data[i] = 0; src.data[i + 1] = Math.round((0.95 - 0.85 * k * k) * 255); src.data[i + 2] = 0;
    dst.data[i] = dst.data[i + 1] = dst.data[i + 2] = Math.round(a * 255); dst.data[i + 3] = 255;
  }
  oc.putImageData(src, 0, 0); mc.putImageData(dst, 0, 0);
  const tex = (cv, name) => { const t = new B.DynamicTexture(name, cv, scene, true); t.update(); t.anisotropicFilteringLevel = 16; return t; };

  const ground = quad('ground', 0);
  const gm = new B.PBRMaterial('ground', scene);
  gm.albedoTexture = tex(G.albedo, 'albedo');
  gm.metallicTexture = tex(orm, 'orm');
  gm.useRoughnessFromMetallicTextureGreen = true;
  gm.useRoughnessFromMetallicTextureAlpha = false;
  gm.useMetallnessFromMetallicTextureBlue = true;
  gm.metallic = 1; gm.roughness = 1;
  gm.backFaceCulling = false;
  ground.material = gm;
  ground.receiveShadows = true;

  // The engine's planar mirror: the world rendered from below the ground plane, then blurred.
  mirror = new B.MirrorTexture('mirror', { ratio: 0.5 }, scene, true);
  mirror.mirrorPlane = new B.Plane(0, -1, 0, 0);
  mirror.renderList = worldMeshes;
  mirror.adaptiveBlurKernel = 20;
  mirror.level = 1;

  // A sheet just above the ground shows the mirror wherever the wetness mask says so.
  wetSheet = quad('wet', 0.12);
  const wm = new B.StandardMaterial('wet', scene);
  wm.diffuseColor = wm.specularColor = wm.emissiveColor = wm.ambientColor = B.Color3.Black();
  wm.reflectionTexture = mirror;
  wm.opacityTexture = tex(mask, 'mask');
  wm.opacityTexture.getAlphaFromRGB = true;
  wm.disableLighting = true;
  wm.backFaceCulling = false;
  wetSheet.material = wm;
  wetSheet.applyFog = false;
}

// ------------------------------------------------------------ post-processing, camera, overlay

const pipe = new B.DefaultRenderingPipeline('post', true, scene, [camera]);
pipe.samples = 4;
pipe.bloomEnabled = true;
pipe.bloomThreshold = 0.9;
pipe.bloomWeight = 0.3;
pipe.bloomKernel = 80;
pipe.bloomScale = LITE ? 0.25 : 0.5;
pipe.imageProcessingEnabled = true;
pipe.imageProcessing.toneMappingEnabled = true;
pipe.imageProcessing.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
pipe.imageProcessing.exposure = 0.92;

// (forceGeometryBuffer: in its default pre-pass mode SSAO2 dropped every emissive surface in this scene --
//  lamps and lit windows rendered black -- so it is given a geometry buffer instead)
const ssao = new B.SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: LITE ? 0.5 : 0.75, blurRatio: LITE ? 0.5 : 1 }, [camera], true);
ssao.radius = 14;
ssao.totalStrength = 1.25;
ssao.base = 0.05;
ssao.samples = 16;
ssao.maxZ = 7000;
ssao.minZAspect = 0.5;
ssao.expensiveBlur = true;

let cssW = 1, cssH = 1, dpr = 1;
const id4 = B.Matrix.Identity();
const overlay = makeOverlay(document.getElementById('ov'), S.plates, (x, y, z) => {
  const p = B.Vector3.Project(new B.Vector3(x, y, z), id4, scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
  return [p.x / dpr, p.y / dpr];
});

const view = makeView();
let pxPerUnit = 1;
function layout() {
  cssW = Math.max(2, window.innerWidth); cssH = Math.max(2, window.innerHeight);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  engine.setHardwareScalingLevel(1 / dpr);
  engine.resize();
  overlay.resize(cssW, cssH, dpr);

  const c = fitCamera(S.frame, cssW, cssH, view);
  pxPerUnit = c.scale;
  camera.orthoLeft = -c.halfW; camera.orthoRight = c.halfW; camera.orthoTop = c.halfH; camera.orthoBottom = -c.halfH;
  camera.position.set(c.target[0] + c.dir[0] * DIST, c.target[1] + c.dir[1] * DIST, c.target[2] + c.dir[2] * DIST);
  camera.setTarget(new B.Vector3(c.target[0], c.target[1], c.target[2]));

  // Haze: same curve as the Three.js PoC, measured on the whole field so zooming does not change the weather.
  const full = fitCamera(S.frame, cssW, cssH);
  const reach = (full.halfH / Math.sin(PITCH)) * Math.cos(PITCH);
  const shift = (c.target[2] - full.target[2]) * Math.cos(PITCH);
  scene.fogStart = DIST + shift + reach * 0.1;
  scene.fogEnd = scene.fogStart + (reach * 0.9) / 0.3;

  const span = Math.hypot(c.halfW, c.halfH / Math.sin(PITCH)) + 260;
  sun.position.set(c.target[0] + SUN[0] * 2000, SUN[1] * 2000, c.target[2] + SUN[2] * 2000);
  sun.orthoLeft = -span; sun.orthoRight = span; sun.orthoTop = span; sun.orthoBottom = -span;
  sun.shadowMinZ = 200; sun.shadowMaxZ = 4500;
}
window.addEventListener('resize', layout);
layout();
attachControls(canvas, S.frame, view, () => pxPerUnit, layout);

// ------------------------------------------------------------ frame

const perf = new B.SceneInstrumentation(scene);
function renderFrame(lt) {
  if (window.innerWidth < 2 || window.innerHeight < 2) return;        // hidden tab: nothing to draw into
  scene.render();
  overlay.draw(lt);
}

const flags = { reflections: true, ao: true };
const panel = makePanel('Babylon.js ' + B.Engine.Version + (LITE ? ' · tuned' : ''), [
  { label: 'Wet reflections', key: 'R', get: () => flags.reflections, set: v => { flags.reflections = v; wetSheet.setEnabled(v); mirror.renderList = v ? worldMeshes : []; } },
  { label: 'Ambient occlusion', key: 'O', get: () => flags.ao, set: v => {
    flags.ao = v;
    const mgr = scene.postProcessRenderPipelineManager;
    if (v) mgr.attachCamerasToRenderPipeline('ssao', camera); else mgr.detachCamerasFromRenderPipeline('ssao', camera);
  } },
  { label: 'Bloom', key: 'B', get: () => pipe.bloomEnabled, set: v => { pipe.bloomEnabled = v; } },
  { label: 'Shadows', key: 'S', get: () => sun.shadowEnabled, set: v => { sun.shadowEnabled = v; } },
  { label: 'Rain', key: 'W', get: () => overlay.state.rain, set: v => { overlay.state.rain = v; } },
  { label: 'Number plates', key: 'P', get: () => overlay.state.plates, set: v => { overlay.state.plates = v; } },
]);

let last = 0, avg = 0, shown = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (last) avg = avg ? avg * 0.95 + (now - last) * 0.05 : now - last;
  last = now;
  renderFrame(now / 1000);
  if (now - shown > 500) {
    shown = now;
    panel.stats(`${(1000 / (avg || 16.7)).toFixed(0)} fps   ${perf.drawCallsCounter.current} draw calls\n${(scene.getActiveIndices() / 3000).toFixed(0)}k triangles in view\n[H] hide this panel`);
  }
}
scene.executeWhenReady(() => requestAnimationFrame(loop));

// For measuring: frames rendered back to back with the GPU forced to finish each one.
window.__poc = {
  engine: 'babylon', scene: S.counts, sceneMs: Math.round(tScene), startMs: Math.round(performance.now() - t0), panel, flags,
  bench(n = 100) {
    const gl = engine._gl, px = new Uint8Array(4);
    for (let i = 0; i < 10; i++) renderFrame(i * 0.016);
    const s = performance.now();
    for (let i = 0; i < n; i++) { renderFrame(i * 0.016); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return { msPerFrame: +((performance.now() - s) / n).toFixed(2), calls: perf.drawCallsCounter.current, triangles: scene.getActiveIndices() / 3, size: [engine.getRenderWidth(), engine.getRenderHeight()] };
  },
};
