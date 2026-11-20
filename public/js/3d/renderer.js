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
import { ShaderPass } from '../../vendor/three/addons/postprocessing/ShaderPass.js';
import { figuresFor, FIGURES } from '../art.js';
import { Model } from '../iso.js';
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
/**
 * Looks: one renderer, several treatments of the same scene. The game uses DEFAULT_LOOK; another
 * can be chosen with ?look=current|a|b|c in the address (or the `look` option / setLook()).
 * 'current' is the plain treatment earlier rounds shipped with; a, b and c are the three samples
 * the default was chosen from.
 *   exposure, sun, hemi, env   light balance
 *   detail      how strongly seams, streaks and grime mark a surface (1 = as painted)
 *   roughK      contrast of roughness variation: above 1, scratches polish and dirt dulls more
 *   relief      strength of the normal maps
 *   sat         saturation of surface colours (faction paint, team markings)
 *   rim         light caught on edges turned away from the camera
 *   glow, bloom, bloomAt   how bright light sources are and how much of it spills
 *   grime       weathering laid over every model: dirt patches, rain streaks, road dirt at the foot
 *   warm        colour of lamps and lit windows
 *   wetDark, mirror, groundSat   the ground: how much water darkens it, how strongly it mirrors, its colour
 *   grade       the finished picture: saturation, contrast, split tone (shadow/light), vignette,
 *               sharpening and ink (a dark line where colour changes abruptly: silhouettes, panel edges)
 */
export const LOOKS = {
  current: { exposure: 1.08, sun: 1.22, sunCol: 0xeaf1ff, hemi: 0.34, env: 0.55, detail: 1, roughK: 1, relief: 1, sat: 1, rim: 0, grime: 0,
    glow: 1.05, warm: [1, 1, 1], bloom: 0.2, bloomAt: 1.08, windows: 1.15, wetDark: 0, mirror: 1, groundSat: 1,
    grade: { sat: 1, contrast: 1, shadow: [1, 1, 1], light: [1, 1, 1], vig: 0, sharp: 0, ink: 0 } },
  // A. Gritty realism: darker, greyer, wet and worn. Grime, streaks and road dirt on every hull and
  //    wall, strong roughness variation, deep relief, a darker and more mirror-like street, warm
  //    lamps and windows as the only saturated note, almost no bloom, cool shadows.
  a: { exposure: 1.05, sun: 1.15, sunCol: 0xdfe9f7, hemi: 0.27, env: 0.85, detail: 1.45, roughK: 1.9, relief: 1.8, sat: 0.74, rim: 0, grime: 1,
    glow: 1.3, warm: [1.25, 0.94, 0.58], bloom: 0.14, bloomAt: 1.05, windows: 1.5, wetDark: 0.34, mirror: 1.45, groundSat: 0.62,
    grade: { sat: 0.86, contrast: 1.12, shadow: [0.92, 1.0, 1.1], light: [1.05, 1.0, 0.93], vig: 0.32, sharp: 0.15, ink: 0 } },
  // B. Clean military model: crisp seams and bevels, light wear, clear colour blocking (paint and
  //    team colour stay saturated, bare metal stays neutral), a little brighter and sharper.
  b: { exposure: 1.2, sun: 1.38, sunCol: 0xf2f5ff, hemi: 0.38, env: 0.6, detail: 1.25, roughK: 1.25, relief: 1.3, sat: 1.4, rim: 0.14, grime: 0.22,
    glow: 1.05, warm: [1, 1, 1], bloom: 0.18, bloomAt: 1.08, windows: 1.1, wetDark: 0.08, mirror: 1, groundSat: 1.04,
    grade: { sat: 1.03, contrast: 1.06, shadow: [1, 1, 1], light: [1, 1, 1], vig: 0.06, sharp: 0.55, ink: 0 } },
  // C. Bold stylised: flat simple surfaces, inked silhouettes and edges, strong edge light,
  //    saturated paint, a drier street, generous glow.
  c: { exposure: 1.26, sun: 1.5, sunCol: 0xfff6e8, hemi: 0.46, env: 0.35, detail: 0.3, roughK: 0.4, relief: 0.3, sat: 1.7, rim: 0.7, grime: 0,
    glow: 1.35, warm: [1.08, 1.0, 0.86], bloom: 0.32, bloomAt: 1.0, windows: 1.4, wetDark: 0, mirror: 0.55, groundSat: 1.3,
    grade: { sat: 1.18, contrast: 1.1, shadow: [1, 1, 1], light: [1.02, 1.0, 0.98], vig: 0, sharp: 0.2, ink: 0.7 } },
  // The game's look: B with A's mood. B's crisp seams, saturated paint and team colour and its
  // sharpening, so sides stay easy to tell apart at gameplay zoom; about 40% of A's weathering;
  // A's darker, more mirror-like wet street and its warm lamps and windows; slightly cool shadows.
  field: { exposure: 1.16, sun: 1.32, sunCol: 0xeaf0fb, hemi: 0.33, env: 0.7, detail: 1.3, roughK: 1.45, relief: 1.45, sat: 1.36, rim: 0.14, grime: 0.4,
    glow: 1.25, warm: [1.2, 0.95, 0.64], bloom: 0.16, bloomAt: 1.06, windows: 1.4, wetDark: 0.3, mirror: 1.4, groundSat: 0.7,
    grade: { sat: 1.0, contrast: 1.08, shadow: [0.95, 1.0, 1.06], light: [1.03, 1.0, 0.96], vig: 0.16, sharp: 0.45, ink: 0 } },
};
export const DEFAULT_LOOK = 'field';

const ATLAS_GRID = 4, ATLAS_CELL = 256, ATLAS_PAD = 8;   // surface atlas: cells per side, cell size and wrapped border in pixels
const GLOW = 1.05;                                  // how far above white a light source is drawn: enough to read as lit, not enough to flood

export class Renderer3D {
  /**
   * @param canvas
   * @param opts { shadowSize, ao, bloom, reflections, look,
   *               figures: { exact, group, cap } - how many figures stand for an army (see figuresFor in art.js) }
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = { shadowSize: 4096, ao: false, bloom: true, reflections: true, ...opts, figures: { ...FIGURES, ...(opts.figures || {}) } };
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
    // Treatment of surfaces and ground, shared by their shaders and set by setLook().
    this.uLook = { uDetail: { value: 1 }, uRoughK: { value: 1 }, uSat: { value: 1 }, uRim: { value: 0 }, uGrime: { value: 0 },
      uWetDark: { value: 0 }, uMirror: { value: 1 }, uGroundSat: { value: 1 } };
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
      Object.assign(sh.uniforms, this.uLook, { tWet: { value: this.wetTex }, tReflect: { value: this.reflRT.texture }, uRes: this.uRes, uReflectK: this.uReflectK, tDetail: { value: tDetail }, tDetailN: { value: tDetailN } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tWet;\nuniform sampler2D tReflect;\nuniform sampler2D tDetail;\nuniform sampler2D tDetailN;\nuniform vec2 uRes;\nuniform float uReflectK;\nuniform float uWetDark;\nuniform float uMirror;\nuniform float uGroundSat;\nvarying vec2 vGround;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float detA = texture2D( tDetail, vGround / 52.0 ).g, detB = texture2D( tDetail, vGround / 15.0 + 0.37 ).g;
          diffuseColor.rgb *= mix( 1.0, detA * detB * 1.42, 0.62 );
          { float gl = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            diffuseColor.rgb = max( vec3( 0.0 ), mix( vec3( gl ), diffuseColor.rgb, uGroundSat ) ) * ( 1.0 - uWetDark * texture2D( tWet, vMapUv ).r ); }`)
        // Roughness from the wetness map (puddles are mirrors, dry stone is matt), broken up by the grit.
        .replace('#include <roughnessmap_fragment>', 'float wetK = texture2D( tWet, vMapUv ).r;\nfloat roughnessFactor = clamp( mix( 0.95, 0.10, wetK * wetK ) + ( 0.84 - detB ) * 0.9, 0.06, 1.0 );')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 dnA = texture2D( tDetailN, vGround / 52.0 ).xy * 2.0 - 1.0, dnB = texture2D( tDetailN, vGround / 15.0 + 0.37 ).xy * 2.0 - 1.0;
          vec2 dn = ( dnA + dnB ) * mix( 0.5, 0.16, wetK );              // standing water lies flat over the relief
          normal = normalize( ( viewMatrix * vec4( normalize( vec3( dn.x, 1.0, dn.y ) ), 0.0 ) ).xyz );`)
        // The mirrored scene, blurrier where the ground is less wet, laid over the lit ground.
        .replace('#include <opaque_fragment>', `
          vec3 mirror = textureLod( tReflect, gl_FragCoord.xy / uRes + dn * 0.004, 0.4 + ( 1.0 - wetK ) * 4.5 ).rgb;
          outgoingLight = mix( outgoingLight, mirror, min( 0.95, uReflectK * smoothstep( 0.3, 1.0, wetK ) * 0.62 * uMirror ) );
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
    // Grading on the finished picture: part of a look, off (identity) for the shipped one.
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uRes: this.uRes, uSat: { value: 1 }, uContrast: { value: 1 }, uShadow: { value: new THREE.Vector3(1, 1, 1) }, uLight: { value: new THREE.Vector3(1, 1, 1) },
        uVig: { value: 0 }, uSharp: { value: 0 }, uInk: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uSat; uniform float uContrast; uniform vec3 uShadow; uniform vec3 uLight;
        uniform float uVig; uniform float uSharp; uniform float uInk; varying vec2 vUv;
        vec3 at( vec2 o ) { return texture2D( tDiffuse, vUv + o / uRes ).rgb; }
        void main() {
          vec4 c = texture2D( tDiffuse, vUv );
          if ( uSharp > 0.0 || uInk > 0.0 ) {
            float r = max( 1.0, uRes.y / 1200.0 );                       // about one screen pixel whatever the density
            vec3 n = at( vec2( 0.0, r ) ), s = at( vec2( 0.0, -r ) ), e = at( vec2( r, 0.0 ) ), w = at( vec2( -r, 0.0 ) );
            vec3 gx = e - w, gy = n - s;
            c.rgb += uSharp * ( c.rgb - ( n + s + e + w ) * 0.25 );
            c.rgb *= 1.0 - uInk * smoothstep( 0.26, 0.72, sqrt( dot( gx, gx ) + dot( gy, gy ) ) );
          }
          float l = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          c.rgb = mix( vec3( l ), c.rgb, uSat );
          c.rgb = ( c.rgb - 0.5 ) * uContrast + 0.5;
          c.rgb *= mix( uShadow, uLight, smoothstep( 0.12, 0.7, l ) ) * ( 1.0 - uVig * smoothstep( 0.4, 0.95, distance( vUv, vec2( 0.5 ) ) ) );
          gl_FragColor = vec4( clamp( c.rgb, 0.0, 1.0 ), 1.0 );
        }`,
    });
    this.composer.addPass(this.grade);
    

    this.pools = new Map();         // model key -> instanced meshes
    this.used = [];
    this.materials = new Map();
    this.facades = null;
    this.W = this.H = 0;
    this.stats = { draws: 0, triangles: 0, meshes: 0 };
    this.configure(this.opts);
    let look = this.opts.look;
    // ?look= is read from the address the page was opened with: the app tidies the address bar
    // (drops what it does not know) before this renderer exists, so location.search may have lost it.
    try {
      const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      look = look || new URLSearchParams(location.search).get('look') || (nav && new URL(nav.name).searchParams.get('look'));
    } catch { /* no address to read */ }
    this.setLook(look);
  }

  /** Switch treatment (see LOOKS). Takes effect on the next frame; nothing is rebuilt. */
  setLook(name) {
    this.look = LOOKS[name] ? name : DEFAULT_LOOK;
    const L = LOOKS[this.look];
    this.lookDef = L;
    this.renderer.toneMappingExposure = L.exposure;
    this.sun.intensity = L.sun; this.sun.color.set(L.sunCol);
    this.hemi.intensity = L.hemi;
    this.scene.environmentIntensity = L.env;
    this.bloom.strength = L.bloom; this.bloom.threshold = L.bloomAt;
    const u = this.uLook;
    u.uDetail.value = L.detail; u.uRoughK.value = L.roughK; u.uSat.value = L.sat; u.uRim.value = L.rim; u.uGrime.value = L.grime;
    u.uWetDark.value = L.wetDark; u.uMirror.value = L.mirror; u.uGroundSat.value = L.groundSat;
    if (this.surfMat) { this.surfMat.normalScale.set(L.relief, L.relief); this.glowMat.color.setRGB(L.warm[0] * L.glow, L.warm[1] * L.glow, L.warm[2] * L.glow); }
    for (const m of this.facades || []) { m.emissiveIntensity = L.windows; m.emissive.setRGB(...L.warm); }
    const g = this.grade.uniforms;
    g.uSat.value = L.grade.sat; g.uContrast.value = L.grade.contrast; g.uShadow.value.set(...L.grade.shadow); g.uLight.value.set(...L.grade.light);
    g.uVig.value = L.grade.vig; g.uSharp.value = L.grade.sharp; g.uInk.value = L.grade.ink;
    this.grade.enabled = L !== LOOKS.current;
  }

  /** Figures that stand for an army of n soldiers with tier counts [n1, n2, n3], under this renderer's options. Drawing only. */
  figuresFor(n, tiers) { return figuresFor(n, tiers, this.opts.figures); }

  /** Change what the preset allows: { shadowSize, ao, bloom, reflections, figures }. */
  configure(o) {
    if (o && o.figures) o = { ...o, figures: { ...this.opts.figures, ...o.figures } };
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
    this.grade.uniforms.uRes.value.set(w, h);   // a pass keeps its own copy of its uniforms
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
    this.sceneryMaterials();
    this.buildScenery(s);
  }

  /** Materials of the static scenery (office facades, plain trim, trees): made once, on first need. */
  sceneryMaterials() {
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
          emissiveMap: tex(T.light, true), emissive: new THREE.Color().setRGB(...(this.lookDef ? this.lookDef.warm : [1, 1, 1])), emissiveIntensity: this.lookDef ? this.lookDef.windows : 1.15,
        });
      });
      this.plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 });
      this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
      this.treeGeo = treeGeometries();
    }
  }

  // (setScenery, continued: the geometry)
  buildScenery(s) {
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
   * Every surface type in ONE material. The procedural textures of all surfaces are packed
   * into three atlases (colour detail, roughness + metalness, relief); each vertex carries
   * the atlas cell of its surface, and the shader tiles the texture inside that cell. A tank
   * made of painted plate, bare steel, rubber track and glass is therefore one draw call, not
   * four, and painted armour, exposed steel, concrete, rubber and fabric still each answer the
   * light in their own way.
   */
  surfaceMaterial() {
    if (this.surfMat) return this.surfMat;
    const names = Object.keys(SURFACES);
    const size = ATLAS_GRID * ATLAS_CELL, inner = ATLAS_CELL - 2 * ATLAS_PAD;
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
    const A = mk(), O = mk(), N = mk();
    const a = A.getContext('2d'), o = O.getContext('2d', { willReadFrequently: true }), n = N.getContext('2d', { willReadFrequently: true });
    a.fillStyle = '#fff'; a.fillRect(0, 0, size, size);
    o.fillStyle = 'rgb(255,200,0)'; o.fillRect(0, 0, size, size);
    n.fillStyle = 'rgb(128,128,255)'; n.fillRect(0, 0, size, size);
    this.tiles = {};
    names.forEach((name, i) => {
      const S = SURFACES[name], col = i % ATLAS_GRID, row = Math.floor(i / ATLAS_GRID);
      const x = col * ATLAS_CELL, y = row * ATLAS_CELL;
      this.tiles[name] = [col, ATLAS_GRID - 1 - row];                    // cell origin in texture space (v runs upward)
      const T = S.tex ? surfaceTextures(S.tex) : null;
      // Each cell holds one repeat of the texture plus a wrapped border, so filtering at the
      // cell's edge reads the same texture, not its neighbour.
      const fill = (ctx, img) => {
        const pat = ctx.createPattern(img, 'repeat');
        pat.setTransform(new DOMMatrix().translate(x + ATLAS_PAD, y + ATLAS_PAD).scale(inner / img.width));
        ctx.fillStyle = pat; ctx.fillRect(x, y, ATLAS_CELL, ATLAS_CELL);
      };
      if (T) { fill(a, T.albedo); fill(o, T.rough); fill(n, T.normal); }
      // roughness in green (the map varies around ~0.82 of the surface's own value), metalness in blue
      const od = o.getImageData(x, y, ATLAS_CELL, ATLAS_CELL), d = od.data, k = S.rough / 0.82;
      for (let q = 0; q < d.length; q += 4) { d[q + 1] = T ? Math.min(255, d[q + 1] * k) : S.rough * 255; d[q + 2] = S.metal * 255; d[q + 3] = 255; }
      o.putImageData(od, x, y);
      if (T && S.bump !== 1) {                                           // relief strength is per surface
        const nd = n.getImageData(x, y, ATLAS_CELL, ATLAS_CELL), e = nd.data;
        for (let q = 0; q < e.length; q += 4) { e[q] = 128 + (e[q] - 128) * S.bump; e[q + 1] = 128 + (e[q + 1] - 128) * S.bump; }
        n.putImageData(nd, x, y);
      }
    });
    const tex = (cv, srgb) => {
      const t = new THREE.CanvasTexture(cv);
      t.anisotropy = Math.min(4, this.maxAniso);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const orm = tex(O, false);
    const m = this.surfMat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex(A, true), roughnessMap: orm, metalnessMap: orm, normalMap: tex(N, false),
      roughness: 1, metalness: 1, normalScale: new THREE.Vector2(1, 1),
    });
    const swap = (chunk, from, to) => {
      const src = THREE.ShaderChunk[chunk];
      if (!src.includes(from)) throw new Error(`shader chunk ${chunk} changed: cannot place the surface atlas`);
      return src.replace(from, to);
    };
    const frag = {
      // colour detail: 1 = as painted, below 1 fades it toward a plain surface, above 1 deepens seams and grime
      map_fragment: swap('map_fragment', 'texture2D( map, vMapUv )', 'atlasDetail( atlasTex( map, vMapUv ) )'),
      roughnessmap_fragment: swap('roughnessmap_fragment', 'texture2D( roughnessMap, vRoughnessMapUv )', 'atlasTex( roughnessMap, vRoughnessMapUv )'),
      metalnessmap_fragment: swap('metalnessmap_fragment', 'texture2D( metalnessMap, vMetalnessMapUv )', 'atlasTex( metalnessMap, vMetalnessMapUv )'),
      normal_fragment_maps: swap('normal_fragment_maps', 'texture2D( normalMap, vNormalMapUv )', 'atlasTex( normalMap, vNormalMapUv )'),
    };
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 tile;\nvarying vec2 vTile;\nvarying vec3 vModel;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = tile;\nvModel = position;');
      Object.assign(sh.uniforms, this.uLook);
      let f = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vTile;
        varying vec3 vModel;
        uniform float uDetail; uniform float uRoughK; uniform float uSat; uniform float uRim; uniform float uGrime;
        float hash3( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
        float noise3( vec3 x ) {
          vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( hash3( i ), hash3( i + vec3( 1, 0, 0 ) ), f.x ), mix( hash3( i + vec3( 0, 1, 0 ) ), hash3( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( hash3( i + vec3( 0, 0, 1 ) ), hash3( i + vec3( 1, 0, 1 ) ), f.x ), mix( hash3( i + vec3( 0, 1, 1 ) ), hash3( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }
        vec4 atlasDetail( vec4 c ) { return vec4( max( vec3( 0.03 ), mix( vec3( 1.0 ), c.rgb, uDetail ) ), c.a ); }
        // One repeat of a surface's texture inside its atlas cell; gradients come from the
        // unwrapped coordinate so the wrap seam does not flicker.
        vec4 atlasTex( sampler2D t, vec2 uv ) {
          const float pad = ${(ATLAS_PAD / ATLAS_CELL).toFixed(5)};
          const float k = ${((1 - 2 * ATLAS_PAD / ATLAS_CELL) / ATLAS_GRID).toFixed(5)};
          vec2 st = ( vTile + pad + fract( uv ) * ( 1.0 - 2.0 * pad ) ) / ${ATLAS_GRID.toFixed(1)};
          return textureGrad( t, st, dFdx( uv ) * k, dFdy( uv ) * k );
        }`);
      for (const [chunk, src] of Object.entries(frag)) {
        if (!f.includes(`#include <${chunk}>`)) throw new Error(`standard shader no longer includes ${chunk}`);
        f = f.replace(`#include <${chunk}>`, src);
      }
      // saturation of the surface colour (faction paint and team markings), after the face colour is applied
      f = f.replace('#include <color_fragment>', `#include <color_fragment>
        { float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          float chroma = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) ) - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) );
          // above 1 only what is already paint gains colour, so bare metal and concrete stay neutral
          float k = uSat > 1.0 ? 1.0 + ( uSat - 1.0 ) * smoothstep( 0.05, 0.24, chroma ) : uSat;
          diffuseColor.rgb = max( vec3( 0.0 ), mix( vec3( lum ), diffuseColor.rgb, k ) ); }
        // Weathering, fixed to the model: dirt patches, streaks that run down the sides, road dirt at the foot.
        float grime = 0.0;
        if ( uGrime > 0.0 ) {
          float blot = noise3( vModel * 0.2 ) * 0.62 + noise3( vModel * 0.71 + 7.3 ) * 0.38;
          float streak = noise3( vec3( vModel.x * 1.1, vModel.y * 0.1, vModel.z * 1.1 ) + 3.1 );
          float foot = 1.0 - smoothstep( 0.3, 5.0, vModel.y );
          grime = clamp( uGrime * ( smoothstep( 0.44, 0.74, blot ) * 0.62 + smoothstep( 0.52, 0.84, streak ) * 0.4 + foot * 0.42 ), 0.0, 0.9 );
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.4, 0.36, 0.31 ) + vec3( 0.014, 0.012, 0.009 ), grime );
        }`);
      // roughness contrast around the middle: polished scratches against dull grime
      f = f.replace('#include <lights_physical_fragment>', `roughnessFactor = mix( clamp( 0.55 + ( roughnessFactor - 0.55 ) * uRoughK, 0.06, 1.0 ), 0.94, grime * 0.85 ); metalnessFactor *= 1.0 - grime * 0.7;
        #include <lights_physical_fragment>`);
      // edge light: faces turning away from the camera catch the sky
      f = f.replace('#include <opaque_fragment>', `outgoingLight += uRim * pow( 1.0 - clamp( normal.z, 0.0, 1.0 ), 2.2 ) * vec3( 0.62, 0.7, 0.82 ) * ( 0.35 + diffuseColor.rgb );
        #include <opaque_fragment>`);
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => 'surface-atlas';
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(GLOW, GLOW, GLOW) });
    // Fields (a shield dome, a wormhole throat, a mire): light added over whatever is behind, seen from both sides.
    this.fieldMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    if (this.lookDef) { this.surfMat = m; this.setLook(this.look); }
    return m;
  }

  /** Meshes for one model: everything solid in one geometry (one draw call), light sources in another. */
  meshesFor(model) {
    const mat = this.surfaceMaterial();
    const solid = { p: [], n: [], c: [], t: [], k: [] }, out = [];
    let glow = null, field = null;
    for (const b of modelBuckets(model)) {
      if (b.glow) { glow = glow || { p: [], n: [], c: [] }; glow.p.push(b.position); glow.n.push(b.normal); glow.c.push(b.color); continue; }
      if (b.field) { field = field || { p: [], n: [], c: [] }; field.p.push(b.position); field.n.push(b.normal); field.c.push(b.color); continue; }
      const tile = this.tiles[b.surface] || this.tiles.panel, verts = b.position.length / 3;
      const k = new Float32Array(verts * 2);
      for (let i = 0; i < verts; i++) { k[i * 2] = tile[0]; k[i * 2 + 1] = tile[1]; }
      solid.p.push(b.position); solid.n.push(b.normal); solid.c.push(b.color); solid.t.push(b.uv); solid.k.push(k);
    }
    const cat = list => { const a = new Float32Array(list.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of list) { a.set(x, o); o += x.length; } return a; };
    if (solid.p.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(cat(solid.p), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(cat(solid.n), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cat(solid.c), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(cat(solid.t), 2));
      geo.setAttribute('tile', new THREE.BufferAttribute(cat(solid.k), 2));
      out.push({ geo, mat, glow: false });
    }
    if (glow) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(cat(glow.p), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(cat(glow.n), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cat(glow.c), 3));
      out.push({ geo, mat: this.glowMat, glow: true });
    }
    if (field) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(cat(field.p), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(cat(field.n), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cat(field.c), 3));
      out.push({ geo, mat: this.fieldMat, glow: true, field: true });
    }
    return out;
  }

  /**
   * Queue one instance. The meshes for `key` are built from `build()` (a Model) the
   * first time it is needed and kept on the GPU.
   * @param x,y   view position   @param lift height above ground
   * @param yaw   rotation about the vertical axis   @param scale uniform scale
   * @param sy    extra vertical scale (1 = none): a structure being assembled rises from its footing
   */
  add(key, build, x, y, lift, yaw, scale, sy = 1) {
    let p = this.pools.get(key);
    if (!p) {
      p = { n: 0, cap: 16, attr: null, meshes: [] };
      p.attr = new THREE.InstancedBufferAttribute(new Float32Array(16 * p.cap), 16);
      p.attr.setUsage(THREE.DynamicDrawUsage);
      for (const part of this.meshesFor(build())) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, 1);
        mesh.instanceMatrix = p.attr;                 // every part of the model shares one set of placements
        mesh.castShadow = !part.glow;
        mesh.receiveShadow = !part.glow;
        mesh.frustumCulled = false;
        if (part.field) { mesh.userData.field = true; mesh.renderOrder = 2; }
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
    a[o + 4] = 0; a[o + 5] = scale * sy; a[o + 6] = 0; a[o + 7] = 0;
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
    this.lastView = v;
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
    // Fields are light, not surfaces: keep them out of the passes that read depth and normals (ambient occlusion).
    for (const p of this.used) for (const m of p.meshes) if (m.userData.field) m.visible = false;
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

  /**
   * Do the start-up work before the first frame instead of in it, in three stages, giving the
   * page back between them so a loading animation keeps moving:
   *   'textures'  paint the surface atlas and the facade textures
   *   'shaders'   compile the programs of every material (in the background where the
   *               browser can compile shaders in parallel)
   *   'scene'     build the models the match will use and draw one hidden frame, so buffers,
   *               shadow map and post-processing are ready
   * After it resolves the first visible frame costs about what every later frame costs.
   * Safe to call more than once, and optional: without it all of this happens in the first frame.
   * @param onStage (stage, fraction 0..1) => void
   * @param plan    { models: [[key, build], ...]  the same keys and builders later passed to add(),
   *                  view: what render() will be given (defaults to the last view drawn) }
   * @returns { textures, shaders, scene, total } milliseconds spent in each stage
   */
  async prepare(onStage = () => {}, plan = {}) {
    const now = () => performance.now(), rest = () => new Promise(r => setTimeout(r, 0));
    const ms = {}, T0 = now();
    if (this.lost) return { textures: 0, shaders: 0, scene: 0, total: 0 };
    let t = now();
    onStage('textures', 0);
    this.surfaceMaterial();
    onStage('textures', 0.6);
    await rest();
    this.sceneryMaterials();
    ms.textures = now() - t;
    onStage('textures', 1);
    await rest();

    t = now();
    onStage('shaders', 0);
    // One of each kind of surface in the scene, so each material's program is built: a model
    // with a solid face, a light and a field.
    this.begin();
    this.add('~warm', () => { const m = new Model(); m.box(-1, 1, -1, 1, 0, 1, '#808080'); m.cyl(0, 0, 0.5, 1, 2, '#ffffff', { n: 3, glow: true }); m.tag('field'); m.cyl(0, 0, 0.5, 2, 3, '#4080ff', { n: 3 }); return m; }, -1e5, -1e5, 0, 0, 1);
    for (const p of this.used) for (const m of p.meshes) { m.visible = true; m.count = 1; }
    const groundWas = this.ground.visible;
    this.ground.visible = true;
    this.renderer.setRenderTarget(this.sceneRT);       // programs depend on what they render into
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* compiled on first use instead */ }
    this.renderer.setRenderTarget(null);
    this.ground.visible = groundWas;
    ms.shaders = now() - t;
    onStage('shaders', 1);
    await rest();

    t = now();
    onStage('scene', 0);
    const list = plan.models || [];
    let slice = now();
    for (let i = 0; i < list.length; i++) {
      this.add(list[i][0], list[i][1], -1e5, -1e5, 0, 0, 1);    // built, and placed off screen so the hidden frame uploads it
      if (now() - slice > 8) { onStage('scene', 0.8 * (i + 1) / list.length); await rest(); slice = now(); }
    }
    const view = plan.view || this.lastView;
    if (this.W && view && this.ground.visible) { this.render(view); this.finish(); }
    this.begin();
    for (const p of this.pools.values()) for (const m of p.meshes) m.visible = false;
    ms.scene = now() - t;
    onStage('scene', 1);
    ms.total = now() - T0;
    return ms;
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
