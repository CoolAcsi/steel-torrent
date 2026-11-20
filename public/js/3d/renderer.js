// The battlefield in 3D, on Three.js.
//
// Loaded on demand (it pulls in the engine), and only this module knows the
// engine exists: the game hands it the same things it used to hand the old
// hand-written renderer -- the painted ground, where the scenery stands, and
// every frame a list of "this model, here, facing that way".
//
// What it draws:
//   - cities, units and lamps: the game's own low-poly models, converted to
//     meshes and instanced, with physically based materials
//   - towers with procedural facades and a skyline, real trees
//   - overcast image-based light, one soft shadow-casting key light
//   - the wet ground: the scene mirrored in the ground plane, blurred and
//     weighted by the terrain's wetness map
//   - bloom on lamps and lit windows, filmic tone mapping, 4x MSAA, depth fog,
//     and (high preset) ambient occlusion
//
// Projection. The game lays everything out for a fixed strategy view: a point
// at view position (x, y) and height z appears at (x, y - z). That is an affine
// map, slightly sheared rather than a true orthographic camera, so it is given
// to the engine as an explicit projection matrix. The 2D overlay (plates,
// rings, routes, input) therefore lines up with the 3D picture exactly as before.
//
// Coordinates in here: X right, Y up, Z toward the camera. View (x, y) and
// height z map to X = x, Y = z, Z = y / F.
import * as THREE from '../../vendor/three/three.module.js';
import { EffectComposer } from '../../vendor/three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from '../../vendor/three/addons/postprocessing/TexturePass.js';
import { GTAOPass } from '../../vendor/three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from '../../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from '../../vendor/three/addons/utils/BufferGeometryUtils.js';
import { F } from '../iso.js';
import { modelBuckets, SURFACES } from './meshdata.js';
import { surfaceTextures } from './textures.js';
import { facadeTextures, towerParts, LOOK_COUNT } from './facade.js';

const VLEN = Math.hypot(1, F);
const VY = 1 / VLEN, VZ = F / VLEN;                 // toward the camera: VY along the ground, VZ upward
const MAX_H = 340;                                  // tallest thing in the scene
// Toward the light: upper left and slightly in FRONT of the scene. Every wall the camera can
// see faces the camera's side, so a key light from behind would leave all of them in shade;
// from the front-left it lights the left-hand faces, shades the right-hand ones and throws
// shadows up and to the right, which is what gives the buildings volume.
const SUN = new THREE.Vector3(-0.66, 0.66, 0.36).normalize();
const FOG = new THREE.Color().setRGB(0.66, 0.714, 0.77, THREE.SRGBColorSpace);
const MIRROR_SKY = new THREE.Color().setRGB(0.5, 0.55, 0.61, THREE.SRGBColorSpace);   // the cloud a puddle shows where nothing stands over it
const GLOW = 1.05;                                  // how far above white a light source is drawn: enough to read as lit, not enough to flood

export class Renderer3D {
  /**
   * @param canvas
   * @param opts { shadowSize, ao, bloom, reflections }
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = { shadowSize: 4096, ao: false, bloom: true, reflections: true, ...opts };
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);                        // the game sizes the canvas in device pixels itself
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.info.autoReset = false;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.lost = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });

    const scene = this.scene = new THREE.Scene();
    scene.background = FOG;
    scene.fog = new THREE.Fog(FOG, 0, 1);
    this.world = new THREE.Group();                   // everything that stands on the ground and is mirrored in it
    scene.add(this.world);
    this.props = new THREE.Group();                   // towers and trees: rebuilt when the layout changes
    this.world.add(this.props);

    // Overcast sky as an environment map: pale overhead, bright at the horizon, dark below.
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
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xc6d4e6, 0x4c5158, 0.34);
    this.skyC = this.hemi.color.clone();
    this.gndC = this.hemi.groundColor.clone();
    const sun = this.sun = new THREE.DirectionalLight(0xeaf1ff, 1.22);    // overcast, but with enough direction to model form
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.opts.shadowSize, this.opts.shadowSize);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.7;
    sun.shadow.radius = 3;
    scene.add(this.hemi, sun, sun.target);
    // Two spare lights for brief events (a detonation, a chrono field): always in the scene, dark
    // until used, so switching one on never recompiles a shader.
    this.pulses = [0, 1].map(() => {
      const l = new THREE.PointLight(0xffffff, 0, 900, 1.6);
      l.userData = { t0: 0, dur: 0, peak: 0 };
      scene.add(l);
      return l;
    });

    // The game's projection, as a camera whose matrices are set by hand each frame.
    const cam = this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cam.matrixAutoUpdate = false;
    cam.matrix.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, VY, -VZ), new THREE.Vector3(0, VZ, VY));   // looks along -(0, VZ, VY)
    cam.updateMatrixWorld(true);
    this.P = new THREE.Matrix4();

    // Ground: one quad showing the painted terrain, with wet reflections.
    this.reflRT = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.uRes = { value: new THREE.Vector2(1, 1) };
    this.uReflectK = { value: 1 };
    this.groundTex = new THREE.CanvasTexture(document.createElement('canvas'));
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.wetTex = new THREE.CanvasTexture(document.createElement('canvas'));
    this.groundTex.anisotropy = this.wetTex.anisotropy = this.maxAniso;
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], 3));
    quad.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));        // far edge = top of the painting
    quad.setIndex([0, 2, 1, 1, 2, 3]);
    const gm = new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 1, metalness: 0 });
    // Fine surface detail, tiled in world space over the painting at two scales: the painting
    // says what the ground is (asphalt, paving, yard), this gives it grit and relief.
    const GD = surfaceTextures('ground');
    const detail = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = this.maxAniso; return t; };
    const tDetail = detail(GD.albedo), tDetailN = detail(GD.normal);
    gm.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { tWet: { value: this.wetTex }, tReflect: { value: this.reflRT.texture }, uRes: this.uRes, uReflectK: this.uReflectK, tDetail: { value: tDetail }, tDetailN: { value: tDetailN } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tWet;\nuniform sampler2D tReflect;\nuniform sampler2D tDetail;\nuniform sampler2D tDetailN;\nuniform vec2 uRes;\nuniform float uReflectK;\nvarying vec2 vGround;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float detA = texture2D( tDetail, vGround / 52.0 ).g, detB = texture2D( tDetail, vGround / 15.0 + 0.37 ).g;
          diffuseColor.rgb *= mix( 1.0, detA * detB * 1.42, 0.62 );`)
        // Roughness from the wetness map (puddles are mirrors, dry stone is matt), broken up by the grit.
        .replace('#include <roughnessmap_fragment>', 'float wetK = texture2D( tWet, vMapUv ).r;\nfloat roughnessFactor = clamp( mix( 0.95, 0.10, wetK * wetK ) + ( 0.84 - detB ) * 0.9, 0.06, 1.0 );')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 dnA = texture2D( tDetailN, vGround / 52.0 ).xy * 2.0 - 1.0, dnB = texture2D( tDetailN, vGround / 15.0 + 0.37 ).xy * 2.0 - 1.0;
          vec2 dn = ( dnA + dnB ) * mix( 0.5, 0.16, wetK );              // standing water lies flat over the relief
          normal = normalize( ( viewMatrix * vec4( normalize( vec3( dn.x, 1.0, dn.y ) ), 0.0 ) ).xyz );`)
        // The mirrored scene, blurrier where the ground is less wet, laid over the lit ground.
        .replace('#include <opaque_fragment>', `
          vec3 mirror = textureLod( tReflect, gl_FragCoord.xy / uRes + dn * 0.004, 0.4 + ( 1.0 - wetK ) * 4.5 ).rgb;
          outgoingLight = mix( outgoingLight, mirror, uReflectK * smoothstep( 0.3, 1.0, wetK ) * 0.62 );
          #include <opaque_fragment>`);
    };
    this.ground = new THREE.Mesh(quad, gm);
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    this.ground.visible = false;
    scene.add(this.ground);

    // The scene is drawn once into a multisampled HDR buffer; the post-processing chain then
    // works on plain buffers, so no pass after the first pays for multisampling.
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }));
    this.composer.addPass(new TexturePass(this.sceneRT.texture));
    this.gtao = new GTAOPass(scene, cam, 4, 4);
    this.gtao.updateGtaoMaterial({ radius: 11, distanceExponent: 1.4, thickness: 1.2, scale: 1.5, samples: 8, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    this.gtao.blendIntensity = 0.95;
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.2, 0.55, 1.08);   // selective: only real light sources clear the threshold
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.pools = new Map();         // model key -> instanced meshes
    this.used = [];
    this.materials = new Map();
    this.facades = null;
    this.W = this.H = 0;
    this.stats = { draws: 0, triangles: 0, meshes: 0 };
    this.configure(this.opts);
  }

  /** Change what the preset allows: { shadowSize, ao, bloom, reflections }. */
  configure(o) {
    Object.assign(this.opts, o);
    const s = this.sun.shadow;
    if (s.mapSize.x !== this.opts.shadowSize) {
      s.mapSize.set(this.opts.shadowSize, this.opts.shadowSize);
      if (s.map) { s.map.dispose(); s.map = null; }
    }
    this.gtao.enabled = !!this.opts.ao;
    this.bloom.enabled = !!this.opts.bloom;
    this.uReflectK.value = this.opts.reflections ? 1 : 0;
    this.sized = false;
  }

  get reflections() { return this.opts.reflections; }
  set reflections(v) { this.configure({ reflections: !!v }); }

  resize(w, h) {
    if (w === this.W && h === this.H && this.sized) return;
    this.W = w; this.H = h; this.sized = true;
    this.renderer.setSize(w, h, false);
    this.sceneRT.setSize(w, h);
    this.composer.setSize(w, h);
    // Ambient occlusion and bloom are soft by nature: half resolution is enough and far cheaper.
    this.gtao.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.bloom.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.reflRT.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.uRes.value.set(w, h);
  }

  /** The painted terrain (a canvas the size of the screen, in device pixels) and its wetness map. */
  setGround(source, wet) {
    for (const [tex, img] of [[this.groundTex, source], [this.wetTex, wet]]) {
      if (!img) continue;
      if (tex.image !== img || tex.image.width !== tex.w || tex.image.height !== tex.h) tex.dispose();   // size changed: new storage
      tex.image = img; tex.w = img.width; tex.h = img.height;
      tex.needsUpdate = true;
    }
    this.ground.visible = true;
  }

  // ------------------------------------------------------------ static scenery

  /**
   * Towers and trees for this layout, in view coordinates.
   * @param s { towers: [{ x, y, a, floors, look, seed }], trees: [{ x, y, s, kind }] }
   */
  setScenery(s) {
    for (const m of this.props.children) if (!m.userData.sharedGeometry) m.geometry.dispose();
    this.props.clear();

    if (!this.facades) {
      const tex = (cv, srgb) => {
        const t = new THREE.CanvasTexture(cv);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = this.maxAniso;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      this.facades = Array.from({ length: LOOK_COUNT }, (_, look) => {
        const T = facadeTextures(look);
        return new THREE.MeshStandardMaterial({
          map: tex(T.albedo, true), roughnessMap: tex(T.rough, false), roughness: 1, metalness: 0,
          emissiveMap: tex(T.light, true), emissive: 0xffffff, emissiveIntensity: 1.15,
        });
      });
      this.plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 });
      this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
      this.treeGeo = treeGeometries();
    }
    const add = mesh => { mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; this.props.add(mesh); };

    const walls = Array.from({ length: LOOK_COUNT }, () => []), plain = [];
    const KIND = { plinth: '#8f969d', cornice: '#8f8c85', plant: '#3e4247', mast: '#2e3338', base: '#3d4248', tank: '#70777d', sign: '#2a2f35', sawtooth: '#566069' };
    const AWNING = ['#6f3a34', '#2f5648', '#7d7038', '#39496f'];
    const turn = new THREE.Matrix4();
    for (const t of s.towers || []) {
      turn.makeRotationY(Math.PI / 4).setPosition(t.x, 0, t.y / F);          // faces line up with the paving
      for (const p of towerParts(t).parts) {
        const h = p.y1 - p.y0;
        let g = p.kind === 'tank' ? new THREE.CylinderGeometry(p.hw, p.hw, h, 10) : new THREE.BoxGeometry(p.hw * 2, h, p.hd * 2);
        if (p.kind === 'sawtooth') {                                          // north-light roof: one edge of the box dropped to the roof
          const pos = g.attributes.position;
          for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0 && pos.getX(i) < 0) pos.setY(i, -h / 2 + 0.3);
          g = g.toNonIndexed();
          g.computeVertexNormals();
        }
        g.translate(p.ox || 0, (p.y0 + p.y1) / 2, p.oz || 0);
        g.applyMatrix4(turn);
        if (p.kind === 'facade') {
          // Box faces come in the order +x, -x, +y, -y, +z, -z, four vertices each: the two pairs of
          // walls can have different widths, so each gets its own bay count.
          const uv = g.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (i < 8 ? p.baysD : p.bays) / 4, uv.getY(i) * p.floors / 4);
          walls[t.look % LOOK_COUNT].push(g);
        } else plain.push(tinted(g, p.kind === 'awning' ? AWNING[p.tint] : KIND[p.kind]));
      }
    }
    walls.forEach((list, look) => { if (list.length) add(new THREE.Mesh(mergeGeometries(list), this.facades[look])); });
    if (plain.length) add(new THREE.Mesh(mergeGeometries(plain), this.plainMat));
    for (const g of [...walls.flat(), ...plain]) g.dispose();

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    this.treeGeo.forEach((geo, kind) => {
      const list = (s.trees || []).filter(t => t.kind === kind);
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, this.treeMat, list.length);
      list.forEach((t, i) => {
        m4.compose(pos.set(t.x, 0, t.y / F), q.setFromAxisAngle(up, i * 2.4), sc.setScalar(t.s * 1.05));
        mesh.setMatrixAt(i, m4);
      });
      mesh.userData.sharedGeometry = true;            // the two tree shapes are reused by every layout
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.props.add(mesh);
    });
  }

  // ------------------------------------------------------------ per-frame instances

  /** Start a frame: forget last frame's instances. */
  begin() {
    for (const p of this.used) p.n = 0;
    this.used.length = 0;
  }

  /**
   * One shared material per surface type. The face colour comes from the mesh; the
   * surface's textures add seams, wear and relief on top of it.
   */
  material(b) {
    const key = b.glow ? 'glow' : b.surface;
    let m = this.materials.get(key);
    if (!m) {
      if (b.glow) m = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(GLOW, GLOW, GLOW) });
      else {
        const S = SURFACES[b.surface];
        m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: S.metal, roughness: S.rough });
        if (S.tex) {
          const T = surfaceTextures(S.tex);
          const tex = (cv, srgb) => {
            const t = new THREE.CanvasTexture(cv);
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = this.maxAniso;
            if (srgb) t.colorSpace = THREE.SRGBColorSpace;
            return t;
          };
          m.map = tex(T.albedo, true);
          m.roughnessMap = tex(T.rough, false);
          m.roughness = Math.min(1, S.rough / 0.82);       // the map carries variation around ~0.82
          m.normalMap = tex(T.normal, false);
          m.normalScale = new THREE.Vector2(S.bump, S.bump);
        }
      }
      this.materials.set(key, m);
    }
    return m;
  }

  /**
   * Queue one instance. The meshes for `key` are built from `build()` (a Model) the
   * first time it is needed and kept on the GPU.
   * @param x,y   view position   @param lift height above ground
   * @param yaw   rotation about the vertical axis   @param scale uniform scale
   */
  add(key, build, x, y, lift, yaw, scale) {
    let p = this.pools.get(key);
    if (!p) {
      p = { n: 0, cap: 16, attr: null, meshes: [] };
      p.attr = new THREE.InstancedBufferAttribute(new Float32Array(16 * p.cap), 16);
      p.attr.setUsage(THREE.DynamicDrawUsage);
      for (const b of modelBuckets(build())) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(b.color, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2));
        const mesh = new THREE.InstancedMesh(geo, this.material(b), 1);
        mesh.instanceMatrix = p.attr;                 // every part of the model shares one set of placements
        mesh.castShadow = !b.glow;
        mesh.receiveShadow = !b.glow;
        mesh.frustumCulled = false;
        mesh.tris = b.position.length / 9;
        p.meshes.push(mesh);
        this.world.add(mesh);
      }
      this.pools.set(key, p);
    }
    if (p.n === 0) this.used.push(p);
    if (p.n === p.cap) {                              // grow the placement buffer
      p.cap *= 2;
      const bigger = new THREE.InstancedBufferAttribute(new Float32Array(16 * p.cap), 16);
      bigger.setUsage(THREE.DynamicDrawUsage);
      bigger.array.set(p.attr.array);
      p.attr = bigger;
      for (const m of p.meshes) { m.instanceMatrix = bigger; }
    }
    // Turn about the vertical by the game's yaw (which turns x toward the camera), scale, place.
    const c = Math.cos(yaw) * scale, s = Math.sin(yaw) * scale, a = p.attr.array, o = p.n++ * 16;
    a[o] = c; a[o + 1] = 0; a[o + 2] = s; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = scale; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = -s; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = lift; a[o + 14] = y / F; a[o + 15] = 1;
  }

  // ------------------------------------------------------------ frame

  /**
   * Draw the frame.
   * @param v { k, ox, oy, ox0, oy0 }  device pixels per view unit and the view origin in device
   *          pixels, with (ox, oy) and without (ox0, oy0) camera shake
   */
  render(v) {
    if (this.lost || !this.W) return;
    const { k } = v, W = this.W, H = this.H;
    const { renderer, scene, camera, sun, hemi, world, ground } = this;

    for (const p of this.pools.values()) {
      const on = p.n > 0;
      for (const m of p.meshes) { m.visible = on; m.count = p.n; }
      if (on) p.attr.needsUpdate = true;
    }

    // Visible ground, in world units, and the depth range along the view axis that holds
    // everything standing on it (and its mirror image below).
    const x0 = -v.ox0 / k, x1 = (W - v.ox0) / k;
    const z0 = -v.oy0 / k / F, z1 = (H - v.oy0) / k / F;
    ground.position.set(x0, 0, z0);
    ground.scale.set(x1 - x0, 1, z1 - z0);
    const zFar = z0 - MAX_H / F;                                    // bases of tall things beyond the top edge
    const dmin = zFar * VY - MAX_H * VZ, dmax = (z1 + 40) * VY + MAX_H * VZ, dd = dmax - dmin;

    // World -> clip, exactly the game's layout: pixel (X k + ox, (Z F - Y) k + oy), depth along the view axis.
    this.P.set(
      (2 * k) / W, 0, 0, (2 * v.ox) / W - 1,
      0, (2 * k) / H, (-2 * k * F) / H, 1 - (2 * v.oy) / H,
      0, (-2 * VZ) / dd, (-2 * VY) / dd, (2 * dmin) / dd + 1,
      0, 0, 0, 1,
    );
    camera.projectionMatrix.multiplyMatrices(this.P, camera.matrix);  // the camera's own rotation is folded back out
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.near = -dmax; camera.far = -dmin;                          // what depth-reading passes need to know

    // Haze: none on the near half of the field, about a third at its far edge, thicker beyond.
    const dTop = -(z0 * VY), dMid = -((z0 + (z1 - z0) * 0.5) * VY);
    scene.fog.near = dMid;
    scene.fog.far = dMid + (dTop - dMid) / 0.3;

    // Key light and its shadow frustum, fitted to what is on screen.
    const cx = (x0 + x1) / 2, cz = (zFar + z1) / 2, span = Math.hypot(x1 - x0, z1 - zFar) / 2 + MAX_H * 0.6;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + SUN.x * 2400, SUN.y * 2400, cz + SUN.z * 2400);
    const sc = sun.shadow.camera;
    if (sc.right !== span) { sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 200; sc.far = 5200; sc.updateProjectionMatrix(); }

    const nowS = performance.now() / 1000;
    for (const l of this.pulses) {
      const u = l.userData, q = u.dur ? (nowS - u.t0) / u.dur : 1;
      l.intensity = q >= 1 ? 0 : u.peak * (1 - q) * (1 - q);
    }
    renderer.info.reset();
    if (this.opts.reflections) {
      // Reflection pass: the whole world mirrored in the ground plane, lights included, so the
      // mirror image is lit and shadowed exactly like the original. Same projection, so it lands
      // on screen where the reflection belongs and the ground shader can sample it by pixel.
      world.scale.y = -1;
      sun.position.y *= -1;
      hemi.color.copy(this.gndC); hemi.groundColor.copy(this.skyC);
      scene.environmentRotation.x = Math.PI;
      ground.visible = false;
      scene.background = MIRROR_SKY;
      renderer.setRenderTarget(this.reflRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      world.scale.y = 1;
      sun.position.y *= -1;
      hemi.color.copy(this.skyC); hemi.groundColor.copy(this.gndC);
      scene.environmentRotation.x = 0;
      ground.visible = true;
      scene.background = FOG;
    }
    renderer.setRenderTarget(this.sceneRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    this.composer.render();
    const i = renderer.info.render;
    this.stats = { draws: i.calls, triangles: i.triangles, meshes: this.pools.size };
  }

  /**
   * Light the scene briefly from a point just above the ground: buildings, units and wet
   * paving around an effect catch its colour for `dur` seconds.
   * @param x,y view position  @param strength roughly "how many lamps"
   */
  pulse(x, y, color, strength, dur) {
    const l = this.pulses.reduce((a, b) => (a.intensity <= b.intensity ? a : b));     // reuse the dimmer one
    l.color.set(color);
    l.position.set(x, 70, y / F);
    l.userData = { t0: performance.now() / 1000, dur, peak: strength * 60000 };
  }

  /** Block until the GPU has finished (for measuring frame cost). */
  finish() {
    const gl = this.renderer.getContext();
    gl.finish();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }
}

function tinted(g, hex) {
  if (g.index) g = g.toNonIndexed();
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Conifer and broadleaf, a handful of flat-shaded solids each. */
function treeGeometries() {
  return [
    mergeGeometries([
      tinted(new THREE.CylinderGeometry(1, 1.3, 5, 6).translate(0, 2.5, 0), '#2c2218'),
      tinted(new THREE.ConeGeometry(8, 12, 7).translate(0, 10, 0), '#2c5a36'),
      tinted(new THREE.ConeGeometry(6.4, 11, 7).translate(0, 16, 0), '#34683f'),
      tinted(new THREE.ConeGeometry(4.6, 10, 7).translate(0, 22, 0), '#3e7548'),
    ]),
    mergeGeometries([
      tinted(new THREE.CylinderGeometry(1.1, 1.5, 7, 6).translate(0, 3.5, 0), '#2c2218'),
      tinted(new THREE.IcosahedronGeometry(9, 1).scale(1, 0.88, 1).translate(0, 14, 0), '#3b6b3d'),
      tinted(new THREE.IcosahedronGeometry(6, 1).translate(-4, 18, 2), '#4a7d4a'),
    ]),
  ];
}
