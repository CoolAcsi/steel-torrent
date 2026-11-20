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
import { surfaceTextures, groundTexture } from './textures.js';
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
// Inspection: a neutral white key light and grey ambient, no haze, no grading, no weathering
// overlay, no bloom, a dry ground. For judging what a material is by itself (?look=inspect).
LOOKS.inspect = { neutral: true, exposure: 1.0, sun: 1.5, sunCol: 0xffffff, hemi: 0.6, env: 0.7, detail: 1, roughK: 1, relief: 1, sat: 1, rim: 0, grime: 0, wear: 1,
  glow: 1.05, warm: [1, 1, 1], bloom: 0, bloomAt: 4, windows: 1, wetDark: 0, mirror: 0, groundSat: 1,
  grade: { sat: 1, contrast: 1, shadow: [1, 1, 1], light: [1, 1, 1], vig: 0, sharp: 0, ink: 0 } };
export const DEFAULT_LOOK = 'field';

/**
 * Weather, laid over the look: the look says how surfaces are treated, the weather says what
 * sky they stand under. Numbers multiply the look's own value unless noted; 'rain' is the sky
 * every look was made for and changes nothing. Set with the `weather` option or setWeather().
 *   exposure, sun, hemi, env   light balance (times the look's)
 *   sunCol, sky, gnd           colour of the key light and of the sky / ground ambient (replace)
 *   sunDir                     direction toward the key light (replace): lower = longer shadows
 *   shadowR                    softness of the shadow edge (replace; 3 under rain)
 *   fog, fogAmt, mirrorSky     haze colour (sRGB), how much of it at the far edge of the field, and
 *                              what a puddle shows where nothing stands over it (replace)
 *   glow, windows, bloom       lamps, lit windows and their spill (times); bloomAt is added to the threshold
 *   wetDark, mirror, groundSat, grime, rim   as in LOOKS (times). mirror 0 also skips the reflection pass
 *   snow                       0..1: snow lying on whatever faces up (roofs, crowns, decks; paint keeps its colour)
 *   lamp                       light the street lamps throw on the ground, beyond what is painted
 *   uplight                    lamp light caught by the lower part of everything standing on the ground
 *   grade                      sat, contrast, shadow, light (times), vig (added)
 */
export const WEATHER = {
  rain: { exposure: 1, sun: 1, sunCol: null, sky: null, gnd: null, sunDir: null, shadowR: 3, hemi: 1, env: 1,
    fog: [0.66, 0.714, 0.77], fogAmt: 0.3, mirrorSky: [0.5, 0.55, 0.61], glow: 1, windows: 1, bloom: 1, bloomAt: 0,
    wetDark: 1, mirror: 1, groundSat: 1, grime: 1, rim: 1, snow: 0, lamp: 0, uplight: 0,
    grade: { sat: 1, contrast: 1, shadow: [1, 1, 1], light: [1, 1, 1], vig: 0 } },
  // Snow: a bright, flat, white overcast. Weak key light with soft shadows, strong ambient lifted by
  // the white ground, cool white haze, nothing mirrors; lamps and windows stay warm against it.
  snow: { exposure: 0.92, sun: 0.62, sunCol: 0xf1f5ff, sky: 0xdfe8f4, gnd: 0x9aa5b4, sunDir: null, shadowR: 5, hemi: 1.4, env: 1,
    fog: [0.84, 0.88, 0.93], fogAmt: 0.46, mirrorSky: [0.8, 0.84, 0.9], glow: 1.05, windows: 1.1, bloom: 1, bloomAt: 0.1,
    wetDark: 0.4, mirror: 0, groundSat: 1, grime: 0.7, rim: 1.2, snow: 1, lamp: 0, uplight: 0,
    grade: { sat: 0.96, contrast: 0.98, shadow: [0.95, 1, 1.07], light: [1, 1, 1.02], vig: -0.06 } },
  // Sun: a clear warm key light from lower in the sky (crisp, longer shadows), blue sky ambient
  // in the shade, dry ground that mirrors nothing, hardly any haze; lamps and windows barely show.
  sun: { exposure: 1, sun: 1.75, sunCol: 0xfff3dc, sky: 0xb9d2f5, gnd: 0x6a6456, sunDir: [-0.72, 0.52, 0.4], shadowR: 1.6, hemi: 1.15, env: 0.8,
    fog: [0.78, 0.84, 0.9], fogAmt: 0.08, mirrorSky: [0.6, 0.7, 0.84], glow: 0.5, windows: 0.15, bloom: 0.6, bloomAt: 0.1,
    wetDark: 0, mirror: 0, groundSat: 1.15, grime: 0.8, rim: 1, snow: 0, lamp: 0, uplight: 0,
    grade: { sat: 1.08, contrast: 1.04, shadow: [0.96, 1, 1.06], light: [1.04, 1, 0.94], vig: -0.06 } },
  // Night: dark blue ambient and a weak moon for a key light; lamp pools, lit windows and every
  // glowing part carry the scene, the wet street mirrors them, and they spill more.
  night: { exposure: 1, sun: 0.2, sunCol: 0x9db8ff, sky: 0x4a66a8, gnd: 0x161c2a, sunDir: null, shadowR: 4, hemi: 0.9, env: 0.3,
    fog: [0.035, 0.05, 0.09], fogAmt: 0.36, mirrorSky: [0.1, 0.13, 0.21], glow: 1.5, windows: 2.1, bloom: 2.1, bloomAt: -0.1,
    wetDark: 1.1, mirror: 1.1, groundSat: 1, grime: 1, rim: 1.6, snow: 0, lamp: 1, uplight: 0.5,
    grade: { sat: 1, contrast: 1.05, shadow: [0.9, 0.97, 1.14], light: [1.03, 1, 0.97], vig: 0.1 } },
};
export const DEFAULT_WEATHER = 'rain';

const ATLAS_GRID = 4;                               // surface atlas: cells per side (each holds one material and a wrapped border)
const GLOW = 1.05;                                  // how far above white a light source is drawn: enough to read as lit, not enough to flood

export class Renderer3D {
  /**
   * @param canvas
   * @param opts { shadowSize, ao, bloom, reflections, look, weather,
   *               figures: { batch, cap } - how many figures stand for an army (see figuresFor in art.js) }
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
    this.fogC = FOG.clone();                          // haze and backdrop, and what puddles show of the sky: set by the weather
    this.mirrorSky = MIRROR_SKY.clone();
    this.fogAmt = 0.3;
    this.sunDir = SUN.clone();
    scene.background = this.fogC;
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
    this.lampTex = new THREE.CanvasTexture(document.createElement('canvas'));      // where lamp light falls on the ground (night)
    this.matTex = new THREE.CanvasTexture(document.createElement('canvas'));       // what the ground is made of: asphalt, grass, brick (else stone)
    this.groundTex.anisotropy = this.wetTex.anisotropy = this.maxAniso;
    // Treatment of surfaces and ground, shared by their shaders and set by setLook().
    this.uLook = { uDetail: { value: 1 }, uRoughK: { value: 1 }, uSat: { value: 1 }, uRim: { value: 0 }, uGrime: { value: 0 }, uWear: { value: 1 },
      uWetDark: { value: 0 }, uMirror: { value: 1 }, uGroundSat: { value: 1 },
      uSnow: { value: 0 }, uLamp: { value: 0 }, uUplight: { value: 0 } };              // the last three belong to the weather
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], 3));
    quad.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));        // far edge = top of the painting
    quad.setIndex([0, 2, 1, 1, 2, 3]);
    const gm = new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 1, metalness: 0 });
    // What each kind of ground is made of, tiled in world space over the painting: the painting
    // says where the road, the flags, the brick and the lawn are (and `tMat` repeats it as a
    // mask); these give each its own grain, relief and response to light.
    const gtex = name => {
      const S = 256, src = groundTexture(name, S), data = new Uint8Array(src.length);
      for (let y = 0; y < S; y++) data.set(src.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);      // rows bottom-up, as the GPU wants them
      const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.anisotropy = this.maxAniso; t.needsUpdate = true;
      return t;
    };
    const tGA = gtex('g_asphalt'), tGS = gtex('g_stone'), tGB = gtex('g_brick'), tGG = gtex('g_grass');
    gm.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uLook, { tWet: { value: this.wetTex }, tLamp: { value: this.lampTex }, tMat: { value: this.matTex }, tReflect: { value: this.reflRT.texture }, uRes: this.uRes, uReflectK: this.uReflectK,
        tGA: { value: tGA }, tGS: { value: tGS }, tGB: { value: tGB }, tGG: { value: tGG } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tWet;\nuniform sampler2D tLamp;\nuniform sampler2D tMat;\nuniform sampler2D tReflect;\nuniform sampler2D tGA;\nuniform sampler2D tGS;\nuniform sampler2D tGB;\nuniform sampler2D tGG;\nuniform vec2 uRes;\nuniform float uReflectK;\nuniform float uWetDark;\nuniform float uMirror;\nuniform float uGroundSat;\nuniform float uSnow;\nuniform float uLamp;\nuniform float uDetail;\nvarying vec2 vGround;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 gMat = texture2D( tMat, vMapUv ).rgb;                               // asphalt, grass, brick
          float gStone = clamp( 1.0 - gMat.r - gMat.g - gMat.b, 0.0, 1.0 );
          vec2 gTurn = vec2( vGround.x + vGround.y, vGround.y - vGround.x ) * 0.7071;   // the paving grid lies at 45 degrees
          // r = tone, g = roughness, ba = normal
          vec4 gDet = texture2D( tGA, vGround / 30.0 ) * gMat.r + texture2D( tGG, vGround / 22.0 ) * gMat.g + texture2D( tGB, gTurn / 26.0 ) * gMat.b + texture2D( tGS, gTurn / 38.0 ) * gStone;
          float gBig = texture2D( tGS, vGround / 211.0 + 0.37 ).r;                   // the same stone read very large: districts weather differently
          // lying snow is smooth: the grit of the paving under it only just shows
          float snowK = uSnow * smoothstep( 0.42, 0.68, min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) );
          diffuseColor.rgb *= mix( 1.0, gDet.r * 1.2 * ( 0.9 + 0.24 * ( gBig - 0.42 ) / 0.42 ), min( 1.0, 0.85 * uDetail ) * ( 1.0 - 0.8 * snowK ) );
          { float gl = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            diffuseColor.rgb = max( vec3( 0.0 ), mix( vec3( gl ), diffuseColor.rgb, uGroundSat ) ) * ( 1.0 - uWetDark * texture2D( tWet, vMapUv ).r ); }`)
        // Roughness from the wetness map (puddles are mirrors, dry stone is matt) and from the material itself.
        .replace('#include <roughnessmap_fragment>', 'float wetK = texture2D( tWet, vMapUv ).r;\nfloat roughnessFactor = clamp( mix( gDet.g, 0.10, wetK * wetK ) + ( gDet.g - 0.85 ) * 0.5, 0.06, 1.0 );')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 dn = ( gDet.ba * 2.0 - 1.0 ) * mix( 1.0, 0.25, wetK ) * ( 1.0 - 0.6 * snowK );   // standing water lies flat over the relief, and so does snow
          dn = mix( dn, vec2( dn.x - dn.y, dn.x + dn.y ) * 0.7071, gMat.b + gStone );             // the turned materials' relief, turned back
          normal = normalize( ( viewMatrix * vec4( normalize( vec3( dn.x, 1.0, dn.y ) ), 0.0 ) ).xyz );`)
        // The mirrored scene, blurrier where the ground is less wet, laid over the lit ground.
        .replace('#include <opaque_fragment>', `
          vec3 mirror = textureLod( tReflect, gl_FragCoord.xy / uRes + dn * 0.004, 0.4 + ( 1.0 - wetK ) * 4.5 ).rgb;
          outgoingLight = mix( outgoingLight, mirror, min( 0.95, uReflectK * smoothstep( 0.3, 1.0, wetK ) * 0.62 * uMirror ) );
          // Lamp light on the ground (tLamp says where the pools are): the painting carries it
          // by day, at night it has to shine on its own.
          if ( uLamp > 0.0 ) { float lampK = texture2D( tLamp, vMapUv ).r; outgoingLight += uLamp * lampK * lampK * vec3( 1.0, 0.6, 0.27 ) * ( 0.1 + diffuseColor.rgb * 2.4 ); }
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
    this.weather = WEATHER[this.opts.weather] ? this.opts.weather : DEFAULT_WEATHER;
    this.setLook(look);
  }

  /** Switch treatment (see LOOKS). Takes effect on the next frame; nothing is rebuilt. */
  setLook(name) {
    this.look = LOOKS[name] ? name : DEFAULT_LOOK;
    this.lookDef = LOOKS[this.look];
    this.applyLook();
  }

  /**
   * Switch the sky the scene stands under: 'rain' (the default), 'snow', 'sun' or 'night' (see
   * WEATHER). Light, fog, wetness, glow and grade change on the next frame; nothing is rebuilt.
   * The ground painting is the caller's: repaint it for the same weather (buildTerrain's
   * `weather`) and hand it over with setGround() to get its snow cover or dry paving.
   */
  setWeather(name) {
    this.weather = WEATHER[name] ? name : DEFAULT_WEATHER;
    this.applyLook();
  }

  /** The look under the current weather, written to lights, materials and passes. */
  applyLook() {
    const L = this.lookDef, K = L.neutral ? WEATHER.rain : WEATHER[this.weather], KG = K.grade;   // inspection light ignores the weather
    this.renderer.toneMappingExposure = L.exposure * K.exposure;
    this.sun.intensity = L.sun * K.sun; this.sun.color.set(K.sunCol === null ? L.sunCol : K.sunCol);
    this.sun.shadow.radius = K.shadowR;
    if (K.sunDir) this.sunDir.set(...K.sunDir).normalize(); else this.sunDir.copy(SUN);
    this.hemi.intensity = L.hemi * K.hemi;
    this.skyC.set(L.neutral ? 0xd8d8d8 : K.sky === null ? 0xc6d4e6 : K.sky); this.gndC.set(L.neutral ? 0x6c6c6c : K.gnd === null ? 0x4c5158 : K.gnd);
    this.hemi.color.copy(this.skyC); this.hemi.groundColor.copy(this.gndC);
    this.scene.environmentIntensity = L.env * K.env;
    this.fogC.setRGB(...K.fog, THREE.SRGBColorSpace); this.scene.fog.color.copy(this.fogC);
    this.mirrorSky.setRGB(...K.mirrorSky, THREE.SRGBColorSpace);
    this.fogAmt = L.neutral ? 0.0001 : K.fogAmt;
    this.bloom.strength = L.bloom * K.bloom; this.bloom.threshold = L.bloomAt + K.bloomAt;
    const u = this.uLook;
    u.uDetail.value = L.detail; u.uRoughK.value = L.roughK; u.uSat.value = L.sat; u.uRim.value = L.rim * K.rim; u.uGrime.value = L.grime * K.grime; u.uWear.value = L.wear == null ? 1 : L.wear;
    u.uWetDark.value = L.wetDark * K.wetDark; u.uMirror.value = L.mirror * K.mirror; u.uGroundSat.value = L.groundSat * K.groundSat;
    u.uSnow.value = K.snow; u.uLamp.value = K.lamp; u.uUplight.value = K.uplight;
    const glow = L.glow * K.glow;
    if (this.surfMat) { this.surfMat.normalScale.set(L.relief, L.relief); this.glowMat.color.setRGB(L.warm[0] * glow, L.warm[1] * glow, L.warm[2] * glow); }
    for (const m of this.facades || []) { m.emissiveIntensity = L.windows * K.windows; m.emissive.setRGB(...L.warm); }
    const g = this.grade.uniforms, G = L.grade;
    g.uSat.value = G.sat * KG.sat; g.uContrast.value = G.contrast * KG.contrast;
    g.uShadow.value.set(G.shadow[0] * KG.shadow[0], G.shadow[1] * KG.shadow[1], G.shadow[2] * KG.shadow[2]);
    g.uLight.value.set(G.light[0] * KG.light[0], G.light[1] * KG.light[1], G.light[2] * KG.light[2]);
    g.uVig.value = Math.max(0, G.vig + KG.vig); g.uSharp.value = G.sharp; g.uInk.value = G.ink;
    this.grade.enabled = !L.neutral && (L !== LOOKS.current || this.weather !== DEFAULT_WEATHER);
  }

  /** Figures that stand for an army of n soldiers with tier counts [n1, n2, n3], under this renderer's options. Drawing only. */
  figuresFor(n, tiers) { return figuresFor(n, tiers, this.opts.figures); }

  /** Change what the preset allows: { shadowSize, ao, bloom, reflections, figures }, and optionally the `weather`. */
  configure(o) {
    if (o && o.figures) o = { ...o, figures: { ...this.opts.figures, ...o.figures } };
    Object.assign(this.opts, o);
    if (o && o.weather && this.lookDef && o.weather !== this.weather) this.setWeather(o.weather);
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

  /**
   * The painted terrain (a canvas the size of the screen, in device pixels) and its wetness map;
   * `wet.lamps`, when the painter left one, is the map of lamp light on the ground.
   */
  setGround(source, wet) {
    for (const [tex, img] of [[this.groundTex, source], [this.wetTex, wet], [this.lampTex, wet && wet.lamps], [this.matTex, wet && wet.mat]]) {
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
    // Scenery built from the game's own Models (see props.js): drawn through the same surface
    // material, instancing, shadows and mirror as bases and units. [{ key, build, x, y, yaw, scale }]
    this.staticProps = s.props || [];
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
      // Snow settles on whatever faces up: roofs, ledges, the tops of crowns. Nothing is lit under it.
      for (const m of [...this.facades, this.plainMat, this.treeMat]) {
        m.onBeforeCompile = sh => {
          sh.uniforms.uSnow = this.uLook.uSnow;
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uSnow;')
            .replace('#include <lights_physical_fragment>', `if ( uSnow > 0.0 ) {
                float cover = uSnow * smoothstep( 0.45, 0.8, dot( normal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) );
                diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.84, 0.88, 0.93 ), cover );
                roughnessFactor = mix( roughnessFactor, 0.92, cover ); metalnessFactor *= 1.0 - cover; totalEmissiveRadiance *= 1.0 - cover;
              }
              #include <lights_physical_fragment>`);
        };
        m.customProgramCacheKey = () => 'snow-cap';
      }
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
      if (t.prop) continue;                                                  // a plot that is not a tower: drawn from its Model (s.props)
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
   * Every surface type in ONE material. The authored materials of all surfaces (textures.js) are
   * packed into three atlases:
   *   colour   base colour, with `paint` in alpha: how much of the face colour applies there
   *   orm      ambient occlusion, roughness, metalness, and the material's chip pattern in alpha
   *   normal   relief
   * Each vertex carries the atlas cell of its surface and the shader tiles the material inside
   * that cell, so a tank of painted plate, blackened steel, rubber-padded track and glass is one
   * draw call. What the shader adds is only what a tile cannot know: where the edges of the
   * object are. Along outside corners the paint is broken up by the material's own chip pattern
   * down to what is underneath (steel under armour paint, pale stone under a concrete arris);
   * in creases against another part or the ground, dirt collects.
   */
  surfaceMaterial() {
    if (this.surfMat) return this.surfMat;
    const names = Object.keys(SURFACES);
    const T = this.opts.texSize === 512 ? 512 : 256, pad = T / 32, cell = T + 2 * pad, size = ATLAS_GRID * cell;
    const A = new Uint8Array(size * size * 4), O = new Uint8Array(size * size * 4), N = new Uint8Array(size * size * 4);
    this.tiles = {};
    const wearP = [], wearC = [];
    for (let i = 0; i < ATLAS_GRID * ATLAS_GRID; i++) { wearP.push(new THREE.Vector4(0, 0, 1, 0)); wearC.push(new THREE.Vector3(0.5, 0.5, 0.5)); }
    names.forEach((name, i) => {
      const S = SURFACES[name], col = i % ATLAS_GRID, row = Math.floor(i / ATLAS_GRID);
      this.tiles[name] = [col, ATLAS_GRID - 1 - row];                    // cell origin in texture space (v runs upward)
      const idx = col + (ATLAS_GRID - 1 - row) * ATLAS_GRID, W = S.wear;
      wearP[idx].set(W[0], W[4], W[5], W[6]);
      wearC[idx].set(Math.pow(W[1], 2.2), Math.pow(W[2], 2.2), Math.pow(W[3], 2.2));   // sRGB in the table, linear in the shader
      const M = S.tex ? surfaceTextures(S.tex, T) : null;
      // Each cell holds one repeat of the material plus a wrapped border, so filtering at the
      // cell's edge reads the same material, not its neighbour. Rows are stored bottom-up.
      for (let y = 0; y < cell; y++) {
        const sy = (y - pad) & (T - 1), dy = size - 1 - (row * cell + y);
        for (let x = 0; x < cell; x++) {
          const q = (dy * size + col * cell + x) * 4, sq = (sy * T + ((x - pad) & (T - 1))) * 4;
          if (M) {
            A[q] = M.albedo[sq]; A[q + 1] = M.albedo[sq + 1]; A[q + 2] = M.albedo[sq + 2]; A[q + 3] = M.albedo[sq + 3];
            O[q] = M.orm[sq]; O[q + 1] = M.orm[sq + 1]; O[q + 2] = M.orm[sq + 2]; O[q + 3] = M.orm[sq + 3];
            N[q] = M.normal[sq]; N[q + 1] = M.normal[sq + 1]; N[q + 2] = M.normal[sq + 2]; N[q + 3] = 255;
          } else {                                                       // a surface with no material of its own: plain, matt
            A[q] = A[q + 1] = A[q + 2] = 236; A[q + 3] = 255;
            O[q] = 255; O[q + 1] = 242; O[q + 2] = 0; O[q + 3] = 128;
            N[q] = N[q + 1] = 128; N[q + 2] = 255; N[q + 3] = 255;
          }
        }
      }
    });
    const tex = (data, srgb) => {
      const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.anisotropy = Math.min(4, this.maxAniso);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    };
    this.atlas = { size, cell, T, bytes: Math.round(size * size * 4 * 3 * 4 / 3) };
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
    const normalChunk = swap('normal_fragment_maps', 'texture2D( normalMap, vNormalMapUv )', 'atlasTex( normalMap, vNormalMapUv )');
    this.uWear = { uWearP: { value: wearP }, uWearC: { value: wearC } };
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 tile;\nattribute vec4 edge;\nattribute vec4 edgeK;\nvarying vec2 vTile;\nvarying vec3 vModel;\nvarying vec4 vEdge;\nvarying vec4 vEdgeK;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = tile;\nvModel = position;\nvEdge = edge;\nvEdgeK = edgeK;');
      Object.assign(sh.uniforms, this.uLook, this.uWear);
      const need = chunk => { if (!sh.fragmentShader.includes(`#include <${chunk}>`)) throw new Error(`standard shader no longer includes ${chunk}`); return `#include <${chunk}>`; };
      let f = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vTile;
        varying vec3 vModel;
        varying vec4 vEdge;
        varying vec4 vEdgeK;
        uniform float uDetail; uniform float uRoughK; uniform float uSat; uniform float uRim; uniform float uGrime; uniform float uSnow; uniform float uUplight; uniform float uWear;
        uniform vec4 uWearP[ ${ATLAS_GRID * ATLAS_GRID} ]; uniform vec3 uWearC[ ${ATLAS_GRID * ATLAS_GRID} ];
        float hash3( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
        float noise3( vec3 x ) {
          vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( hash3( i ), hash3( i + vec3( 1, 0, 0 ) ), f.x ), mix( hash3( i + vec3( 0, 1, 0 ) ), hash3( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( hash3( i + vec3( 0, 0, 1 ) ), hash3( i + vec3( 1, 0, 1 ) ), f.x ), mix( hash3( i + vec3( 0, 1, 1 ) ), hash3( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }
        // One repeat of a surface's material inside its atlas cell; gradients come from the
        // unwrapped coordinate so the wrap seam does not flicker.
        vec4 atlasTex( sampler2D t, vec2 uv ) {
          const float pad = ${(pad / cell).toFixed(6)};
          const float k = ${((T / cell) / ATLAS_GRID).toFixed(6)};
          vec2 st = ( vTile + pad + fract( uv ) * ${(T / cell).toFixed(6)} ) / ${ATLAS_GRID.toFixed(1)};
          return textureGrad( t, st, dFdx( uv ) * k, dFdy( uv ) * k );
        }`);
      // Base colour, roughness, metalness and occlusion, all decided together.
      f = f.replace(need('map_fragment'), '').replace(need('color_fragment'), `
        vec4 surfA = atlasTex( map, vMapUv );                 // rgb tone / own colour, a = paint
        vec4 surfO = atlasTex( roughnessMap, vMapUv );        // ao, roughness, metalness, chip pattern
        int surfI = int( vTile.x + vTile.y * ${ATLAS_GRID.toFixed(1)} + 0.5 );
        vec4 wearP = uWearP[ surfI ];                         // edge wear: width, metalness, roughness, lighten
        // The face colour (faction paint, a team marking), its saturation set by the look: above 1
        // only what is already paint gains colour, so greys stay neutral.
        vec3 paint = vColor.rgb;
        { float lum = dot( paint, vec3( 0.2126, 0.7152, 0.0722 ) );
          float chroma = max( paint.r, max( paint.g, paint.b ) ) - min( paint.r, min( paint.g, paint.b ) );
          float k = uSat > 1.0 ? 1.0 + ( uSat - 1.0 ) * smoothstep( 0.05, 0.24, chroma ) : uSat;
          paint = max( vec3( 0.0 ), mix( vec3( lum ), paint, k ) ); }
        // The same chip pattern read much larger: no two repeats of a tile weather alike.
        float macro = atlasTex( roughnessMap, vMapUv * 0.283 + 0.37 ).a;
        vec3 tone = max( vec3( 0.03 ), mix( vec3( 1.0 ), surfA.rgb * 1.09, uDetail ) ) * ( 0.9 + 0.2 * macro );
        vec3 base = mix( surfA.rgb, paint * tone, surfA.a );
        float surfR = surfO.g, surfM = surfO.b, surfAO = surfO.r;
        // Edges of the object itself. vEdge: distance to each edge of this face; vEdgeK: what kind it is.
        vec4 dW = mix( vec4( 1e3 ), vEdge / max( vEdgeK, vec4( 0.05 ) ), step( 0.02, vEdgeK ) );
        vec4 dC = mix( vec4( 1e3 ), vEdge, step( 0.02, - vEdgeK ) );
        float dWear = min( min( dW.x, dW.y ), min( dW.z, dW.w ) ), dCrease = min( min( dC.x, dC.y ), min( dC.z, dC.w ) );
        float wearW = wearP.x * uWear * ( 0.35 + 1.3 * macro );   // some stretches of an edge are knocked about more than others
        if ( wearW > 0.0 ) {
          // Outside corners: on the corner about half the paint has gone, in flakes; a width in, only the odd one.
          float chip = smoothstep( -0.04, 0.04, surfO.a - ( 0.47 + 0.5 * dWear / wearW ) );
          vec3 under = wearP.w > 0.0 ? base * wearP.w + 0.015 : uWearC[ surfI ];
          base = mix( base, under, chip );
          surfR = mix( surfR, wearP.z, chip ); surfM = mix( surfM, wearP.y, chip );
        }
        { // Creases: where this part meets another, or the ground, dirt and damp stay.
          float crease = 1.0 - smoothstep( 0.0, 1.5, dCrease + ( surfO.a - 0.5 ) * 1.1 );
          base *= 1.0 - 0.55 * crease; surfR = mix( surfR, 0.96, 0.7 * crease ); surfM *= 1.0 - 0.8 * crease; surfAO *= 1.0 - 0.5 * crease; }
        diffuseColor.rgb = base;
        // Weathering, fixed to the model: dirt patches, streaks that run down the sides, road dirt at the foot.
        float grime = 0.0;
        if ( uGrime > 0.0 ) {
          float blot = noise3( vModel * 0.2 ) * 0.62 + noise3( vModel * 0.71 + 7.3 ) * 0.38;
          float streak = noise3( vec3( vModel.x * 1.1, vModel.y * 0.1, vModel.z * 1.1 ) + 3.1 );
          float foot = 1.0 - smoothstep( 0.3, 5.0, vModel.y );
          grime = clamp( uGrime * ( smoothstep( 0.44, 0.74, blot ) * 0.62 + smoothstep( 0.52, 0.84, streak ) * 0.4 + foot * 0.42 ), 0.0, 0.9 );
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.4, 0.36, 0.31 ) + vec3( 0.014, 0.012, 0.009 ), grime );
        }`);
      f = f.replace(need('roughnessmap_fragment'), 'float roughnessFactor = surfR;').replace(need('metalnessmap_fragment'), 'float metalnessFactor = surfM;');
      f = f.replace(need('normal_fragment_maps'), normalChunk);
      // roughness contrast around the middle: polished scratches against dull grime
      f = f.replace('#include <lights_physical_fragment>', `roughnessFactor = mix( clamp( 0.55 + ( roughnessFactor - 0.55 ) * uRoughK, 0.06, 1.0 ), 0.94, grime * 0.85 ); metalnessFactor *= 1.0 - grime * 0.7;
        // Snow: a broken cover on what faces up. Paint (faction colour, team markings) is left
        // nearly clear, so sides read as they do in any other weather.
        if ( uSnow > 0.0 ) {
          float upK = dot( normal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
          float paintK = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) ) - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) );
          float cover = uSnow * smoothstep( 0.6, 0.92, upK + ( noise3( vModel * 0.33 + 11.0 ) - 0.5 ) * 0.5 ) * ( 1.0 - 0.85 * smoothstep( 0.06, 0.22, paintK ) ) * 0.88;
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.84, 0.88, 0.93 ), cover );
          roughnessFactor = mix( roughnessFactor, 0.92, cover ); metalnessFactor *= 1.0 - cover; totalEmissiveRadiance *= 1.0 - cover;
        }
        #include <lights_physical_fragment>`);
      // Occlusion from the material (joints, the foot of a bolt, the gap between links) and from creases:
      // all of the ambient light, and part of the direct light, since these are narrow places.
      f = f.replace(need('aomap_fragment'), `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= surfAO; reflectedLight.indirectSpecular *= mix( 1.0, surfAO, 0.8 );
        reflectedLight.directDiffuse *= mix( 1.0, surfAO, 0.45 ); reflectedLight.directSpecular *= mix( 1.0, surfAO, 0.6 );`);
      // edge light: faces turning away from the camera catch the sky
      f = f.replace('#include <opaque_fragment>', `outgoingLight += uRim * pow( 1.0 - clamp( normal.z, 0.0, 1.0 ), 2.2 ) * vec3( 0.62, 0.7, 0.82 ) * ( 0.35 + diffuseColor.rgb );
        // lamp light from street level: strongest at the foot of whatever stands there, gone by roof height
        outgoingLight += uUplight * ( 1.0 - smoothstep( 2.0, 46.0, vModel.y ) ) * vec3( 1.0, 0.66, 0.36 ) * diffuseColor.rgb;
        #include <opaque_fragment>`);
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => `surface-atlas-${T}`;
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(GLOW, GLOW, GLOW) });
    // Fields (a shield dome, a wormhole throat, a mire): light added over whatever is behind, seen from both sides.
    this.fieldMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    if (this.lookDef) { this.surfMat = m; this.setLook(this.look); }
    return m;
  }

  /** Meshes for one model: everything solid in one geometry (one draw call), light sources in another. */
  meshesFor(model) {
    const mat = this.surfaceMaterial();
    const solid = { p: [], n: [], c: [], t: [], k: [], e: [], ek: [] }, out = [];
    let glow = null, field = null;
    for (const b of modelBuckets(model)) {
      if (b.glow) { glow = glow || { p: [], n: [], c: [] }; glow.p.push(b.position); glow.n.push(b.normal); glow.c.push(b.color); continue; }
      if (b.field) { field = field || { p: [], n: [], c: [] }; field.p.push(b.position); field.n.push(b.normal); field.c.push(b.color); continue; }
      const tile = this.tiles[b.surface] || this.tiles.panel, verts = b.position.length / 3;
      const k = new Float32Array(verts * 2);
      for (let i = 0; i < verts; i++) { k[i * 2] = tile[0]; k[i * 2 + 1] = tile[1]; }
      solid.p.push(b.position); solid.n.push(b.normal); solid.c.push(b.color); solid.t.push(b.uv); solid.k.push(k); solid.e.push(b.edge); solid.ek.push(b.edgeK);
    }
    const cat = list => { const a = new Float32Array(list.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of list) { a.set(x, o); o += x.length; } return a; };
    if (solid.p.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(cat(solid.p), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(cat(solid.n), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cat(solid.c), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(cat(solid.t), 2));
      geo.setAttribute('tile', new THREE.BufferAttribute(cat(solid.k), 2));
      geo.setAttribute('edge', new THREE.BufferAttribute(cat(solid.e), 4));
      geo.setAttribute('edgeK', new THREE.BufferAttribute(cat(solid.ek), 4));
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

    for (const p of this.staticProps || []) this.add(p.key, p.build, p.x, p.y, 0, p.yaw || 0, p.scale || 1);
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
    scene.fog.far = dMid + (dTop - dMid) / this.fogAmt;

    // Key light and its shadow frustum, fitted to what is on screen.
    const cx = (x0 + x1) / 2, cz = (zFar + z1) / 2, span = Math.hypot(x1 - x0, z1 - zFar) / 2 + MAX_H * 0.6;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + this.sunDir.x * 2400, this.sunDir.y * 2400, cz + this.sunDir.z * 2400);
    const sc = sun.shadow.camera;
    if (sc.right !== span) { sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 200; sc.far = 5200; sc.updateProjectionMatrix(); }

    const nowS = performance.now() / 1000;
    for (const l of this.pulses) {
      const u = l.userData, q = u.dur ? (nowS - u.t0) / u.dur : 1;
      l.intensity = q >= 1 ? 0 : u.peak * (1 - q) * (1 - q);
    }
    renderer.info.reset();
    if (this.opts.reflections && this.uLook.uMirror.value > 0) {             // dry or snow-covered ground mirrors nothing: no pass
      // Reflection pass: the whole world mirrored in the ground plane, lights included, so the
      // mirror image is lit and shadowed exactly like the original. Same projection, so it lands
      // on screen where the reflection belongs and the ground shader can sample it by pixel.
      world.scale.y = -1;
      sun.position.y *= -1;
      hemi.color.copy(this.gndC); hemi.groundColor.copy(this.skyC);
      scene.environmentRotation.x = Math.PI;
      ground.visible = false;
      scene.background = this.mirrorSky;
      renderer.setRenderTarget(this.reflRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      world.scale.y = 1;
      sun.position.y *= -1;
      hemi.color.copy(this.skyC); hemi.groundColor.copy(this.gndC);
      scene.environmentRotation.x = 0;
      ground.visible = true;
      scene.background = this.fogC;
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
