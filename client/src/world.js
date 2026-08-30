// World building: the arena boundary, the starry sky, the fixed-position star-system backdrop (a star
// + 4 planets + the home planet's moons), the player-locked wrapping speed-field, and the procedural
// mission set-pieces — assembled
// from a map descriptor by buildMap(). The reassigned per-map handles (sky/stars/systemBodies/
// skyAmbient/skySun/arenaDrift/…) live on the shared state bag G; the arena geometry (ARENA/OOB constants,
// arenaCenter, arenaBorder) is exported const.
import * as THREE from 'three';
import { scene, skyScene, renderer, camera } from './engine.js';
import { G, setPieces, world as simWorld } from './state.js'; // simWorld: the running fight (sim-core/world.js)
import { gltfLoader } from './ship-factory.js'; // shared GLTFLoader (meshopt-wired) for the .glb freighter set-piece
import { makeFreighterExhaust } from './exhaust-fx.js'; // shared GPU/baked-texture engine plume (freighter set-piece)
import { SYSTEM, bodyRenderPos, bodyFade, moonAngle, applySystemSpec, planetOriginOffset, worldToLocal } from './sim-core/system-map.js'; // pure star-system geometry + body placement
import { Vec3 } from './sim-core/vec.js';
import { ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME } from './sim-core/consts.js';
import { SPEED_FIELD_RANGES, normalizeSpeedField, scatterLayer, scatterColors,
         wrapField, loadSpeedTune, saveSpeedTune, WRAP_SAFE_RADIUS } from './speed-field.js'; // pure speed-field math/defaults/tune
import { isDev } from './dev.js'; // ?dev gate: only a dev's stored speed-field tune overrides the descriptor
import { POST_DEFAULTS } from './graphics.js'; // the parallax backdrop layer's shipped constants (amp/follow/offsetMax/radius)

// ---------- Arena ----------
// There is no visible floor - ships hover in open space.
// ARENA is the half-size of the square battlefield, used only for the soft-boundary UI (the edge
// marker + the out-of-bounds warning/warp-back; see the OOB logic in update()). NOTHING is hard-clamped
// to it: the player, enemies, bullets and rockets all move and fight freely beyond it. See DECISIONS §2.
export { ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME }; // the soft boundary's rules live in sim-core/consts.js
const ORIGIN = new THREE.Vector3(0, 0, 0); // the base / spawn point — the stand-in ship position before one exists

// The combat zone's CENTER. Usually (0,0), but for a drifting mission (e.g. escort a freighter) the map
// descriptor's `drift` slowly moves it; the soft boundary, warp-back and mini-map all compute relative to
// THIS, not world (0,0). The synced freighter set-piece follows it. See docs/plans/mission-maps.md.
// The combat zone's centre is SIMULATION state — the soft boundary, the warp-back and the mini-map all
// measure from it, and a mission can drift it. It lives on the World; this is the same object under the
// name the renderer has always used, so there is exactly one of it. (A Vec3, not a THREE.Vector3: every
// consumer only reads .x/.z or calls .set(x, 0, z).)
export const arenaCenter = simWorld.arenaCenter;

// A faint glowing square at the arena edge (±ARENA) so the player can SEE where the battlefield
// ends. It sits just above the combat plane; its opacity ramps up as the player nears/crosses it
// (updated in update()), and fog naturally fades the far edge when the player is centered.
export const arenaBorder = (() => {
  const y = 0.4;
  const corners = [[-ARENA, -ARENA], [ARENA, -ARENA], [ARENA, ARENA], [-ARENA, ARENA], [-ARENA, -ARENA]];
  const geo = new THREE.BufferGeometry().setFromPoints(
    corners.map(([x, z]) => new THREE.Vector3(x, y, z))
  );
  const mat = new THREE.LineBasicMaterial({
    color: 0x49e0ff, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = -1;
  scene.add(line);
  return { line, mat };
})();

// ---------- Starry sky ----------
// A soft radial-gradient sprite (white core -> transparent edge), PROCEDURAL (a 64px canvas, no image
// asset). Shared by the bright-star layer — so those stars bloom into a round halo instead of a hard
// square — and by the player-locked speed field's point sprites. Built once and cached.
let starGlowTexture = null;
function getStarGlowTexture() {
  if (starGlowTexture) return starGlowTexture;
  const s = 64, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)'); // tight bright core
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)'); // soft falloff
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  starGlowTexture = new THREE.CanvasTexture(cv);
  return starGlowTexture;
}

// The speed field's own sprite: a CRISP filled dot (opaque core out to 80% of the radius, then a short
// anti-aliasing falloff), PROCEDURAL like the star glow and cached the same way. Deliberately NOT the star
// sprite: that one is a soft radial glow built to make a point bloom into a halo, which averages ~25% alpha
// across its face — a speck using it has to be blown up and whitened before it is visible at all, and then
// it reads as a white blob rather than a lit rock. A hard-edged dot is opaque across its whole face, so a
// 1-2 unit speck at a natural rock tone reads clearly at real size. Built once and cached.
let speedDotTexture = null;
function getSpeedDotTexture() {
  if (speedDotTexture) return speedDotTexture;
  const s = 32, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.78, 'rgba(255,255,255,1)');    // flat, fully opaque face — the whole point
  g.addColorStop(1.0, 'rgba(255,255,255,0)');     // a 2-3px edge only, so it is round and not aliased
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  speedDotTexture = new THREE.CanvasTexture(cv);
  return speedDotTexture;
}

// One random point on a sphere shell (radius * 0.7..1.0), written into `pos` at index i.
function placeStar(pos, i, radius) {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  const dist = radius * (0.7 + Math.random() * 0.3);
  pos[i * 3]     = Math.cos(theta) * r * dist;
  pos[i * 3 + 1] = u * dist; // across the whole sphere, including below the platform
  pos[i * 3 + 2] = Math.sin(theta) * r * dist;
}

// The starfield is TWO point layers: the dim majority (small, opaque) and a bright ~2% that pops via a
// bigger size + a soft additive glow sprite + a near-white, full-luminance color (the three cues that
// actually make a ~1px point read as "brighter"; see DECISIONS §4). Returns a Group so the render loop
// keeps gluing the whole field to the camera (`stars.position.copy(...)`).
function makeStars(count, radius, brightFraction = 0.02) {
  const brightCount = Math.round(count * brightFraction);
  const dimCount = count - brightCount;
  const c = new THREE.Color();
  const group = new THREE.Group();

  // --- dim majority: small opaque points, power-law brightness (many dim, few less-dim) ---
  const dPos = new Float32Array(dimCount * 3), dCol = new Float32Array(dimCount * 3);
  for (let i = 0; i < dimCount; i++) {
    placeStar(dPos, i, radius);
    c.setHSL(0.55 + Math.random() * 0.12, 0.25 + Math.random() * 0.3, 0.7); // bluish <-> warm
    const b = 0.15 + Math.pow(Math.random(), 2.2) * 0.85; // exponent >1 -> mostly dim
    dCol[i * 3] = c.r * b; dCol[i * 3 + 1] = c.g * b; dCol[i * 3 + 2] = c.b * b;
  }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
  const dim = new THREE.Points(dGeo, new THREE.PointsMaterial({
    size: 1.4,
    sizeAttenuation: false, // stars are the same size regardless of distance
    vertexColors: true,
    transparent: false,     // opaque -> drawn in the pass before the planet (so the planet occludes them)
    fog: false,             // fog must not dim the stars
    depthTest: false,       // pure backdrop - the star-system bodies always occlude them
    depthWrite: false,
  }));
  dim.renderOrder = -1;
  group.add(dim);

  // --- bright ~2%: bigger glowing additive sprites, near-white at full luminance ---
  if (brightCount > 0) {
    const bPos = new Float32Array(brightCount * 3), bCol = new Float32Array(brightCount * 3);
    for (let i = 0; i < brightCount; i++) {
      placeStar(bPos, i, radius);
      // near-white with a faint blue/warm tint, kept at full luminance (no dimming) so they read hot
      c.setHSL(0.55 + Math.random() * 0.12, 0.15 + Math.random() * 0.2, 0.92);
      bCol[i * 3] = c.r; bCol[i * 3 + 1] = c.g; bCol[i * 3 + 2] = c.b;
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
    const bright = new THREE.Points(bGeo, new THREE.PointsMaterial({
      size: 5.0,              // ~3.5x the dim size -> reads as a noticeably brighter star
      map: getStarGlowTexture(),
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending, // bright core blooms over the dark backdrop
      fog: false,
      depthTest: true,        // UNLIKE the dim layer: lets the planet occlude them so the glow can't
      depthWrite: false,      // creep onto the planet disk (the transparency gotcha in DECISIONS §5)
    }));
    bright.renderOrder = -1;
    group.add(bright);
  }
  return group;
}

// ---------- Procedural nebula sky (baked ONCE to a cubemap; see DECISIONS §43) ----------
// A GLSL fragment shader generates a multi-octave value-noise nebula (2-3 color layers) + a sparse
// power-law star field over the view DIRECTION. It is rendered ONCE into a WebGLCubeRenderTarget via a
// CubeCamera at buildMap time and assigned to skyScene.background, so the per-frame cost is just a flat
// background draw (same as a static cubemap) while the look stays fully procedural + palette-driven.
// Palette lives in the map descriptor (sky.nebula); NEBULA_ICEBLUE is the safe fallback.
const NEBULA_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// OCTAVES is prepended as a #define per tier (fbm loop bound must be a compile-time constant).
const NEBULA_FRAG = `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uBase, uColA, uColB, uColC;
  uniform float uThLow, uThHigh, uGlow, uStarD, uStarB, uSat, uSeed, uScale;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3) + uSeed);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i + vec3(0,0,0)), n100 = hash(i + vec3(1,0,0));
    float n010 = hash(i + vec3(0,1,0)), n110 = hash(i + vec3(1,1,0));
    float n001 = hash(i + vec3(0,0,1)), n101 = hash(i + vec3(1,0,1));
    float n011 = hash(i + vec3(0,1,1)), n111 = hash(i + vec3(1,1,1));
    return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
               mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return s;
  }
  // jittered-cell stars over the view direction: sparse (threshold 0.982), power-law-ish, soft falloff.
  float starField(vec3 dir, float density) {
    vec3 g = floor(dir * density);
    float h = hash(g + 7.0);
    if (h <= 0.982) return 0.0;
    vec3 jit = (vec3(hash(g + 1.0), hash(g + 2.0), hash(g + 3.0)) - 0.5) * 0.8;
    vec3 cellDir = normalize((g + 0.5 + jit) / density);
    float dist = length(dir - cellDir) * density;
    return smoothstep(0.18, 0.0, dist) * (0.4 + (h - 0.982) / 0.018 * 0.6); // brighter for rarer cells
  }
  void main() {
    vec3 dir = normalize(vDir);
    float d = smoothstep(uThLow, uThHigh, fbm(dir * uScale));
    float t = fbm(dir * uScale * 0.55 + 11.0);
    vec3 neb = mix(uColA, uColB, clamp(t, 0.0, 1.0)) * d + uColC * pow(d, 2.5) * uGlow;
    vec3 star = vec3(starField(dir, uStarD) * uStarB);
    vec3 col = uBase + neb + star;
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, uSat); // desaturate toward uSat (keeps it readable, not garish)
    gl_FragColor = vec4(col, 1.0);
  }`;

// Ice-blue sparse fallback palette (used when the descriptor omits sky.nebula). Matches the approved
// in-engine baseline. Arrays are linear RGB triples; the whole cube goes through the sRGB output path.
const NEBULA_ICEBLUE = {
  base:  [0.01, 0.015, 0.025],
  colA:  [0.12, 0.22, 0.40],
  colB:  [0.20, 0.35, 0.55],
  colC:  [0.10, 0.20, 0.40],
  thLow: 0.55, thHigh: 0.90, glow: 0.30,
  starD: 75, starB: 1.10, sat: 0.90, seed: 0,
  scale: 2.2, // noise frequency: higher = smaller/finer nebula clumps
};

// Bake the nebula into a cubemap and return the WebGLCubeRenderTarget (caller reads .texture and owns
// disposal). `bake` = { cube, octaves } from the active tier's gfx.nebulaBake (never null here — the
// caller only bakes when nebulaBake is truthy). The ShaderMaterial + geometry are throwaway (disposed).
function makeNebulaSky(prm, bake) {
  const uniforms = {
    uBase:  { value: new THREE.Vector3(...prm.base) },
    uColA:  { value: new THREE.Vector3(...prm.colA) },
    uColB:  { value: new THREE.Vector3(...prm.colB) },
    uColC:  { value: new THREE.Vector3(...prm.colC) },
    uThLow: { value: prm.thLow }, uThHigh: { value: prm.thHigh },
    uGlow:  { value: prm.glow },  uStarD:  { value: prm.starD },
    uStarB: { value: prm.starB }, uSat:    { value: prm.sat },
    uSeed:  { value: prm.seed || 0 },
    uScale: { value: prm.scale || 2.2 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    // depthTest/depthWrite MUST be false — this is load-bearing, not incidental. The bake runs under the
    // engine's global `renderer.autoClear = false` (engine.js:94), and CubeCamera.update (three@0.160)
    // does NOT clear between the 6 faces — each face is a plain renderer.render() whose per-render clear
    // is gated on autoClear. So the shared cube DEPTH buffer is never cleared between faces; face 0's
    // wall depths would persist and, since every face is the same box only rotated, coincide with later
    // faces' depths and get REJECTED by the default depthTest:LESS — baking stale face-0 color into faces
    // 1-5 (wrong nebula direction). A full-cover inside-out skybox needs neither depth test nor write, so
    // with both off no stale depth can ever reject a fragment, regardless of the global autoClear state.
    depthTest: false,
    depthWrite: false,
    uniforms,
    vertexShader: NEBULA_VERT,
    fragmentShader: `#define OCTAVES ${bake.octaves}\n` + NEBULA_FRAG,
  });
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const bakeScene = new THREE.Scene();
  bakeScene.add(new THREE.Mesh(geo, mat));

  const rt = new THREE.WebGLCubeRenderTarget(bake.cube);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  new THREE.CubeCamera(0.1, 10, rt).update(renderer, bakeScene); // renders all 6 faces once

  mat.dispose();
  geo.dispose();
  return rt;
}

// ---------- The parallax backdrop layer (a SECOND, coarser nebula in front of the cube) ----------
// A cubemap background is sampled by view DIRECTION only, so it is INCAPABLE of parallax by construction —
// it can never be anything but infinitely far. This layer is the depth it cannot give: a second, coarser,
// dimmer bake mapped onto an ADDITIVE sphere that tracks the camera at a FRACTION of its motion, so the
// wisps slide slowly against the fixed cube behind them.
//
// THE NOT-A-SKYBOX GUARANTEE RESTS ON THE RENDER LIST, NOT ON `renderOrder`. three splits a scene into two
// render lists — an object lands in the TRANSPARENT list iff `material.transparent === true` — and draws
// ALL opaque objects before ANY transparent one; `renderOrder` only sorts WITHIN a list. Every ecliptic body
// is opaque (the star core, the planets and moons, the dim star layer). So a `transparent: true` backdrop
// sphere would be drawn AFTER all of them and — being full-screen, additive and depth-test-free — would wash
// nebula over the planet disks and the terminator and slide across them as the player flies. Hence
// `transparent: false`, which is LOAD-BEARING and not a typo: it puts the sphere in the OPAQUE list, where
// `renderOrder: -3` draws it first, ahead of G.stars (-1) and every body. Additive blending survives
// `transparent: false` — three forces NoBlending only for NormalBlending + transparent:false.
const BACKDROP_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const BACKDROP_FRAG = `
  precision highp float;
  uniform samplerCube uCube;
  uniform float uAmp, uLift;
  varying vec3 vDir;
  void main() {
    // Additive: only what the layer ADDS matters, so no alpha and no occlusion. uAmp is the shipped
    // brightness (the backdrop ceiling — it must never out-brighten a lit hull); uLift rides the star wash.
    gl_FragColor = vec4(textureCube(uCube, normalize(vDir)).rgb * uAmp * uLift, 1.0);
  }`;

// Its own CONSTANT seed and its own noise scale — NOT the base cube's (D17). An fbm truncated to one fewer
// octave is literally the first n-1 terms of the SAME sum, so `{ ...nb, octaves: n-1 }` would land the coarse
// wisps exactly on top of the cube's and composite the picture onto itself: a change that passes every test
// and does nothing on screen (the same failure mode as the first, invisible speed field — DECISIONS §96).
// A different `seed` puts the clouds in different DIRECTIONS; a lower `scale` (2.0 vs the map's 3.6) makes
// them ~1.8x LARGER, so the eye reads big soft masses in front of the cube's fine structure — a different
// picture standing still, before any motion. Constants, so the layer draws zero randomness (D15).
// `thLow`/`thHigh` were dialed on a real frame and the window matters more than it looks: the fbm's values
// cluster around ~0.48, so a threshold band that starts BELOW that (0.42 was tried) lights the whole sky and
// the layer reads as FOG rather than as masses — it filled every dark gap and the frame lost its blacks. The
// shipped 0.55 starts above the median, exactly like the base cube's own sparse setting, so roughly a
// quarter of the sky carries a mass and the rest stays black. A tried-and-rejected 0.42/0.86 (a wide band
// starting low) went the other way and was almost INVISIBLE (+0.003 mean luma).
const NEBULA2_FALLBACK = { seed: 41, scale: 2.0, thLow: 0.55, thHigh: 0.78, glow: 0.5 };

// Parallax accumulator. Fractional follow, accumulated from the camera DELTA and clamped — see
// updateBackdropLayer for why an absolute-position formula cannot work in a 21 000-unit star system.
const _bdOffset = new THREE.Vector3();
const _bdLastCam = new THREE.Vector3();
const _bdDelta = new THREE.Vector3();
let backdropFollow = POST_DEFAULTS.backdrop.follow;

// Build the layer (called only from the bakeNebula branch of buildMap, so it inherits both of that gate's
// conditions for free: no layer on Performance, none under ?debug unless the `nebula` flag is passed).
// `override` is the map descriptor's optional `sky.nebula2` block (per-key, like `sky.nebula`).
function buildBackdropLayer(nb, bake, override) {
  const nb2 = { ...nb, ...NEBULA2_FALLBACK, ...(override || {}), starB: 0, base: [0, 0, 0] };
  // `starB: 0` and `base: [0,0,0]` are REQUIRED: the layer is additive, so its own star field would double
  // the cube's stars and its base colour would lift the whole sky. Only the nebula wisps may survive.
  G.backdropRT = makeNebulaSky(nb2, { cube: Math.max(128, bake.cube >> 1),
                                      octaves: Math.max(3, bake.octaves - 1) });
  const geo = new THREE.SphereGeometry(POST_DEFAULTS.backdrop.radius, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false, depthWrite: false,   // can never depth-reject a body, and never writes depth itself
    transparent: false,                    // <-- LOAD-BEARING (see above). NOT a typo, do not "fix" it.
    blending: THREE.AdditiveBlending, fog: false,
    uniforms: {
      uCube: { value: G.backdropRT.texture },
      uAmp: { value: POST_DEFAULTS.backdrop.amp },
      uLift: { value: 1 },
    },
    vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -3;        // first in the OPAQUE list — ahead of G.stars (-1) and every system body
  mesh.frustumCulled = false;   // it is re-centred on the camera every frame; its bounding sphere is stale by design
  mesh.position.copy(camera.position);
  skyScene.add(mesh);
  G.backdropMesh = mesh;
  G.backdropMat = mat;
  // Seed the parallax from the CURRENT camera, never from the origin: a (0,0,0) seed would make frame 1's
  // "delta" equal the camera's absolute position, which on Level 4 (11 200-16 800 u out, DECISIONS §106)
  // instantly saturates the offset and kills the parallax for the whole level.
  _bdOffset.set(0, 0, 0);
  _bdLastCam.copy(camera.position);
}

function disposeBackdropLayer() {
  if (G.backdropMesh) {
    skyScene.remove(G.backdropMesh);
    G.backdropMesh.geometry.dispose();
    G.backdropMesh.material.dispose();
    G.backdropMesh = null; G.backdropMat = null;
  }
  if (G.backdropRT) { G.backdropRT.dispose(); G.backdropRT = null; }
}

// Per-frame parallax. Called from settleView (the VIEW layer), right after the star sphere is pinned to the
// camera. Consumes NO randomness and touches no sim state: replay-neutral by construction (DECISIONS §73).
//
// `follow` = how much of the camera's motion the layer copies. follow 1 -> locked to the camera = a skybox
// (no parallax); follow 0 -> world-fixed (full parallax). The offset is accumulated from the camera DELTA
// (not from |camPos|) and clamped, because the star system spans ~21 000 u: an absolute-position formula
// would drift the layer's centre thousands of units off the camera, and once that offset exceeds the sphere
// radius the camera exits the sphere and the backdrop VANISHES. Level 4 alone fights at 11 000-16 800 u from
// the origin. Delta-accumulation keeps parallax alive wherever you actually fight and merely SATURATES (the
// layer stops drifting) after ~4 km of travel in one direction — imperceptible on a far nebula.
//
// Geometry sanity (keep it true if you retune): radius 900 + offsetMax 250 -> the sphere is never more than
// 1150 u from the camera, inside camera.far = 1300, and its near wall sits at 650 u — well outside the
// camera-locked star sphere (stars.radius 400). Raise `radius` against camera.far, not by feel.
export function updateBackdropLayer() {
  const mesh = G.backdropMesh;
  if (!mesh) return;
  _bdOffset.add(_bdDelta.subVectors(camera.position, _bdLastCam).multiplyScalar(1 - backdropFollow));
  _bdOffset.clampLength(0, POST_DEFAULTS.backdrop.offsetMax);
  _bdLastCam.copy(camera.position);
  mesh.position.copy(camera.position).sub(_bdOffset);
}

// ?tune / test hooks for the layer's two live knobs. `amp` is the backdrop brightness ceiling the
// 42-expensive-look scenario measures differentially (amp 0 vs the shipped amp).
export const backdropAmp = () => (G.backdropMat ? G.backdropMat.uniforms.uAmp.value : null);
export function setBackdropAmp(v) { if (G.backdropMat) G.backdropMat.uniforms.uAmp.value = v; }
export const getBackdropFollow = () => backdropFollow;
export function setBackdropFollow(v) { backdropFollow = v; }

// ---------- Procedural body textures (built by buildMap for the star-system backdrop) ----------
// The camera looks almost straight down, so the "sky" is visible only near the top edge of the
// screen (the -Z direction). That is where the backdrop bodies sit as a distant background.

// Minimal procedural surface: an ocean world with depth variation and soft white clouds, tinted to
// the map's ocean color.
// Drawn once onto a canvas (no asset files) and used as the planet's color map. The planet does
// not rotate (to keep the terminator consistent), so a static, baked texture is enough.
function makePlanetTexture(oceanHex = 0x5a82c0) {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // depth variation is derived from the ocean color so any tint works (lighter shallows / darker deeps)
  const br = (oceanHex >> 16) & 255, bg = (oceanHex >> 8) & 255, bb = oceanHex & 255;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const shade = (f) => `rgb(${clamp(br * f)},${clamp(bg * f)},${clamp(bb * f)})`;

  ctx.fillStyle = shade(1); // ocean base
  ctx.fillRect(0, 0, w, h);

  // soft radial blob helper (fades to transparent at the rim)
  const blob = (x, y, r, color, alpha) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  };

  // keep features in the central latitude band: at the poles an equirectangular map pinches
  // into visible streaks, so we avoid the top/bottom edges of the canvas.
  const yBand = () => h * (0.14 + Math.random() * 0.72);

  // ocean depth variation: gentle lighter shallows and slightly darker deeps, close to the base
  // so the planet's overall brightness stays the same (it shouldn't look darker/unlit).
  for (let i = 0; i < 26; i++) {
    blob(Math.random() * w, yBand(), 60 + Math.random() * 140,
      Math.random() < 0.5 ? shade(1.36) : shade(0.82), 0.45);
  }
  // a few faint teal landmasses / reefs for variety
  for (let i = 0; i < 8; i++) {
    blob(Math.random() * w, yBand(), 50 + Math.random() * 90, '#4a8b86', 0.3);
  }
  // clouds: soft white wisps over the oceans
  for (let i = 0; i < 60; i++) {
    blob(Math.random() * w, yBand(), 25 + Math.random() * 70, '#eaf2ff', 0.18 + Math.random() * 0.22);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Simple procedural moon surface: the base rock color with a scatter of craters (a darker floor
// plus a lighter rim ring) and faint maria. Albedo only (no directional shading baked in) so it
// doesn't fight the real sky-scene light. Drawn once onto a canvas, no asset files.
function makeMoonTexture(baseHex) {
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const br = (baseHex >> 16) & 255, bg = (baseHex >> 8) & 255, bb = baseHex & 255;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const shade = (f) => `rgb(${clamp(br * f)},${clamp(bg * f)},${clamp(bb * f)})`;
  // keep features off the poles (equirectangular pinching)
  const yBand = () => h * (0.16 + Math.random() * 0.68);

  ctx.fillStyle = shade(1);
  ctx.fillRect(0, 0, w, h);

  // faint maria (large soft light/dark patches)
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * w, y = yBand(), r = 40 + Math.random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, Math.random() < 0.5 ? shade(0.86) : shade(1.12));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.4; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // craters: darker floor + lighter rim ring
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * w, y = yBand(), r = 5 + Math.random() * 16;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = shade(0.7);
    ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = shade(1.3);
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- Star-system bodies (star + 4 planets + the home planet's moons) ----------
// REAL spheres at REAL world positions on the ecliptic the ship flies over: each body sits at its own true
// (x,z), sunk `depth` below the plane and shifted by SYSTEM.offset (system-map.js bodyRenderPos) — the same
// placement the game's original single home planet used, now per body. Nothing is attached to the camera,
// so nothing re-projects and nothing can jump; the perspective and parallax are just real 3D. At the base
// only planet 2 is in range — the other bodies are thousands of units away, past the camera's far plane, and
// are simply not drawn until you FLY to them (updateSystemBodies fades them in near that plane rather than
// popping them). And because the ship flies at y = 0 while a body's top is `depth − size` below it, a planet
// is permanently out of reach even directly overhead. See DECISIONS §98.
// Pure view layer (called from settleView), consumes ZERO sim RNG → replay-neutral.

// The central star (Vega): a .glb sun + a two-layer additive corona. Everything is driven by the star's
// SYSTEM spec — seeded from the map descriptor's `system.star` block and live-tunable in ?roam like every
// other body — so the renderer, the map screen and the tuning console read ONE object. Keys used here:
//
//   modelUrl   the sun .glb (content-hashed, pulled to the server at deploy, served same-origin). Absent or
//              failed → the procedural emissive sphere below stays, so the star can never be a hole.
//   size       the VISUAL radius: the model's longest axis is normalized to size*2, so it exactly fills the
//              sphere it replaces, and the corona scales off the same number and can never drift off the disk.
//   yellowOnly the model ships TWO concentric spheres — an orange emissive core inside a very slightly
//              larger YELLOW shell whose material is transmissive. The shell is see-through face-on, so the
//              core reads through the middle while the shell's long grazing path at the limb reads yellow:
//              an orange disk with a yellow rim. This hides the core so the star is uniformly yellow.
//              Tinting the core yellow instead is NOT possible — its colour is an orange emissive TEXTURE
//              and a material colour only multiplies it; multiplication cannot raise the green channel.
//   glow/halo  the corona's two additive layers, as sprite WIDTH in star radii (0 = off): tight-and-bright
//              over broad-and-dim. Note the shared glow texture puts its falloff at 0.275 of the sprite
//              width from centre — a width below ~3.6 falls entirely BEHIND the disk and reads as a thin
//              rim rather than a corona, which is exactly what the old single 3.0 sprite did.
//   glowColor/haloColor
//              layer brightness rides the COLOUR, not opacity: the distance fade writes material.opacity
//              every frame, so any opacity set here would be overwritten. Darker colour = dimmer layer.
//   spin       surface rotation, rad/s (see updateSystemBodies).
//   lift/liftNear/liftFar
//              the star's wash on the sky backdrop (see applyStarLift).
function makeStarMesh(spec) {
  const g = new THREE.Group();
  // Procedural fallback + fade anchor. Stays in the group even once the model arrives (it is only hidden),
  // because buildSystemBodies captures its material for the distance fade.
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(spec.size, 32, 32),
    new THREE.MeshBasicMaterial({ color: spec.color, fog: false })
  );
  g.add(core);
  // Corona: both layers are children of the star group, so buildSystemBodies picks their materials up for
  // the distance fade and they travel with the body — nothing here is camera-anchored.
  const coronaLayer = (widthInR, color) => {
    if (!(widthInR > 0)) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getStarGlowTexture(), color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    s.scale.setScalar(spec.size * widthInR);
    g.add(s);
  };
  coronaLayer(spec.halo, spec.haloColor ?? spec.color); // broad outer bloom, added first (drawn behind)
  coronaLayer(spec.glow, spec.glowColor ?? spec.color); // tight bright corona hugging the disk
  if (spec.modelUrl) loadStarModel(g, core, spec);
  return g;
}

// Load the sun .glb into an already-built star group. The procedural core stays in the group but is HIDDEN
// rather than removed: buildSystemBodies captured its material for the distance fade, and dropping it would
// leave that list pointing at a disposed material. The model's own materials are appended to the same fade
// list (found via the star handle) so the .glb fades in with everything else instead of hanging in the void
// at full brightness. `fog: false` mirrors the procedural bodies — the sky scene must not be fogged.
//
// PERF NOTE. The visible shell is a MeshPhysicalMaterial with `transmission: 1`, which costs three.js an
// extra render target per frame — the priciest material in the game. It is affordable only because the fade
// HIDES the whole star outside `SYSTEM.fade.out` (760 u): at the base, and everywhere except the star's own
// neighbourhood, the group is invisible and the transmission pass never runs. Swapping the shell for an
// unlit material was tried and rejected: the yellow comes from the transmission, not from a texture (the
// shell's emissive map is the same ORANGE image the core uses), so a flat material renders it orange again.
function loadStarModel(g, core, spec) {
  G.pendingAssets++; // hold the level-load veil until the sun is here (DECISIONS §84)
  gltfLoader.load(spec.modelUrl, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size3 = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // longest axis -> the visual DIAMETER, so the model exactly fills the sphere it replaces
    const s = (spec.size * 2) / (Math.max(size3.x, size3.y, size3.z) || 1);
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s); // recenter on the group origin (= the body's anchor)
    const handle = (G.systemBodies || []).find((b) => b.isStar);
    if (handle) handle.starModel = model; // updateSystemBodies spins THIS, not the group (a sprite always
                                          // faces the camera, so rotating the group would be a no-op)
    model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const isShell = mats.some((m) => (m.transmission ?? 0) > 0); // the yellow outer sphere
      if (!isShell && spec.yellowOnly) { o.visible = false; return; } // hide the orange core
      for (const mat of mats) {
        mat.fog = false;
        if (handle) handle.mats.push({ mat, alwaysTransparent: mat.transparent });
      }
    });
    core.visible = false;
    g.add(model);
    G.needsSceneWarm = true; // late async arrival: compile + upload it before the next frame draws it
    G.pendingAssets--;
  }, undefined, (err) => {
    G.pendingAssets--;
    console.warn('star model failed to load:', spec.modelUrl, err); // keeps the procedural sphere
  });
}

// Build the star + 4 planet meshes (and the home planet's moons) into G.sky. Planet 2 keeps the ocean look
// (map descriptor `d.planet.ocean`); the others reuse the cratered moon texture in their palette color. Each
// handle keeps a reference to its live SYSTEM spec (so the ?roam tunables keep working) and to the materials
// updateSystemBodies fades. Positions come from bodyRenderPos.
function buildSystemBodies(sys, oceanHex) {
  G.systemBodies = [];
  // `mats` remembers each material's ORIGINAL transparency: the fade may force transparency on, but it must
  // never turn it off on something that was always transparent (the star's additive glow sprite).
  const add = (mesh, spec, isStar, materials) => {
    G.sky.add(mesh);
    const h = { mesh, name: spec.name, spec, builtSize: spec.size, isStar, moons: [],
                mats: materials.map((mat) => ({ mat, alwaysTransparent: mat.transparent })) };
    G.systemBodies.push(h);
    return h;
  };
  const star = makeStarMesh(sys.star);
  add(star, sys.star, true, star.children.map((c) => c.material));
  for (const p of sys.planets) {
    const tex = p.ocean ? makePlanetTexture(oceanHex ?? p.color) : makeMoonTexture(p.color);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.0, fog: false });
    const h = add(new THREE.Mesh(new THREE.SphereGeometry(p.size, 48, 48), mat), p, false, [mat]);
    // Moons are siblings in the same group (not children of the planet mesh) so a live `size` tweak on the
    // planet can't scale their orbit radius with it.
    for (const m of p.moons || []) {
      const mm = new THREE.Mesh(
        new THREE.SphereGeometry(m.size, 24, 24),
        new THREE.MeshStandardMaterial({ map: makeMoonTexture(m.color), roughness: 0.95, metalness: 0.0, fog: false })
      );
      G.sky.add(mm);
      h.moons.push({ mesh: mm, spec: m });
    }
  }
  // PLACE THEM NOW. Positions are absolute, so they must be correct the moment the map exists — not one
  // settleView later. The base menu renders the scene while the sim is NOT ticking (G.gameStarted false),
  // so a body left at its default (0,0,0) sat exactly where the camera looks: the emissive star and its
  // additive glow washed the whole hangar backdrop yellow with the ocean planet stacked inside it.
  updateSystemBodies();
}

// Refresh the bodies for this frame. Their WORLD POSITIONS are absolute and player-independent — this only
// re-reads them so the ?roam console tunables (offset / per-body depth+size) and the slow wall-clock orbital
// drift take effect — then:
//   • revolves the home planet's moons around it (wall-clock, view-only), and
//   • fades a body in by distance from the camera, so flying toward one brings it up smoothly instead of
//     popping it into existence the moment it crosses camera.far. Fully faded-out bodies are hidden, which
//     is also what keeps the far side of the system free (at the base you see planet 2 and nothing else).
export function updateSystemBodies() {
  if (!G.systemBodies || !G.sky) return;
  const now = Date.now();
  // The player may not exist yet (buildMap runs before the ship is built) — the base sits at the origin, so
  // that is the right stand-in: it places the hangar backdrop exactly as the player will first see it.
  const ship = (G.player && G.player.pos) ? G.player.pos : ORIGIN;
  for (const b of G.systemBodies) {
    const rp = bodyRenderPos(b.name, now);
    b.mesh.position.set(rp.x, rp.y, rp.z);
    b.mesh.scale.setScalar((b.spec.size || b.builtSize) / b.builtSize); // live `size` tuning, 1 by default
    // fade by distance from the SHIP, so camera zoom can't fade the planet you are parked at
    const a = bodyFade(b.mesh.position.distanceTo(ship));
    b.mesh.visible = a > 0;
    // The sun turns slowly on its axis, and washes the backdrop as you close on it. Both are wall-clock
    // driven view-layer effects: frame-rate independent, identical on every machine, and they draw ZERO sim
    // RNG, so recorded replays stay byte-identical (DECISIONS §73).
    if (b.isStar) {
      // wrapped to one turn: the raw wall-clock product is ~3.6e7 rad, and while a double still resolves the
      // per-frame step there, there is no reason to carry a number that large into the matrix every frame
      if (b.starModel) b.starModel.rotation.y = ((now / 1000) * (b.spec.spin || 0)) % (Math.PI * 2);
      applyStarLift(b.spec, b.mesh.position.distanceTo(ship));
      aimSkySunAtStar(b.mesh.position, ship);
      G.speedFieldDim = starDustFactor(b.spec, b.mesh.position.distanceTo(ship));
    }
    for (const e of b.mats) { e.mat.opacity = a; e.mat.transparent = a < 1 || e.alwaysTransparent; }
    for (const m of b.moons) {
      const ang = moonAngle(m.spec, now), r = m.spec.orbitR;
      m.mesh.position.set(
        b.mesh.position.x + Math.cos(ang) * r,
        b.mesh.position.y + Math.sin(ang) * r * Math.sin(m.spec.tilt),
        b.mesh.position.z + Math.sin(ang) * r * Math.cos(m.spec.tilt)
      );
      m.mesh.visible = b.mesh.visible;
      m.mesh.material.opacity = a;
      m.mesh.material.transparent = a < 1;
    }
  }
}

// Aim the sky scene's directional light so starlight arrives FROM the star. It used to sit at an authored
// fixed position (`sky.sun.pos`), which put the terminator 64° off the star's true bearing — and inverted
// along z, so at the base the home planet's lit limb faced AWAY from Vega. Since the star is a body with a
// real world position, the light can simply be aimed by it.
//
// A DirectionalLight's direction is `target.position - position`, so we put the light AT the star and aim it
// at the point being looked at. The target is the SHIP, not the lit body: only one body is ever in range at
// a time (everything else is faded out), so "from the star toward where you are" is the correct direction
// for whatever you are actually looking at — and it stays correct after you fly 15 000 u to another planet,
// which a per-body constant could not. At the base the ship sits at the origin and the home planet 340 u
// off it, an angular difference of ~1° at the star's 15 000 u range: invisible.
//
// Parallel rays are an approximation for a star at finite distance, but the alternative — a PointLight with
// decay 0 — buys nothing here, because at most ONE body is lit at any moment.
//
// The direction drifts as the star orbits (planet 2's period is 1.5 days, so ~0.24°/minute): real, and far
// too slow to read as movement inside a session. View layer, wall-clock driven, zero sim RNG.
function aimSkySunAtStar(starPos, litPoint) {
  const sun = G.skySun;
  if (!sun) return;
  sun.position.copy(starPos);
  sun.target.position.copy(litPoint);
  sun.target.updateMatrixWorld();
}

// How much of the speed field survives at `dist` from the star. 1 = untouched, 0 = gone.
//
// WHY THE FIELD HAS TO GO NEAR THE STAR. The speed field is the game's "you are moving" cue: small, crisp,
// rock-grey specks, deliberately NOT additive (they are dust, not stars). It lives in the COMBAT scene,
// which is drawn on top of the sky scene, so its specks land over the sun with no depth relationship to it.
// Everywhere else in the game they sit on near-black space and read as dust. Over the sun's corona — a big,
// smooth, bright wash — a grey speck has nowhere to hide and reads as dirt on the lens. Measured on the
// rendered frame: 2.1% of the corona's pixels were specks deviating from their neighbourhood.
//
// Making them brighter does not fix it (white-on-yellow is still a blemish on a smooth gradient) and going
// additive would turn them into sparks, which is the exact look the field's own notes reject.
//
// The cue is not lost: the star is a huge, close, real body, and parallax against IT sells motion far better
// than dust ever did. The ramp starts at `dustFar` = the distance where the star becomes visible at all
// (`fade.out`), so everywhere you actually fly and fight the field is at full strength.
function starDustFactor(spec, dist) {
  const amount = spec.dust ?? 0;
  if (!amount) return 1;
  const near = spec.dustNear ?? 400, far = spec.dustFar ?? 760;
  const t = Math.min(1, Math.max(0, (far - dist) / Math.max(1, far - near)));
  return 1 - amount * (t * t * (3 - 2 * t)); // smoothstep, same shape as the backdrop lift
}

// The star's wash on the backdrop. Space is black everywhere, which makes arriving at a SUN feel
// like arriving at nothing — so the sky background lifts a little as the ship closes in. Ramped with a
// smoothstep between `liftFar` and `liftNear` so there is no visible edge where the effect switches on, and
// capped at `lift` (a fraction) because the point is a hint of proximity, not a lighting change.
//
// `liftFar` (1200) is deliberately just OUTSIDE `SYSTEM.fade.out` (760, where the star itself finishes
// fading in), so the wash grows together with the star appearing. Pulled much further out — 3000 was tried —
// the backdrop brightens across thousands of units of visibly EMPTY space, which reads as a bug, not a sun.
//
// Two background paths, both covered: the baked nebula CUBEMAP (normal play) rides `backgroundIntensity`
// (three r155+), while the flat-COLOR fallback (?debug, or the low tier with nebulaBake off) is multiplied
// in place. The untouched base colour is captured the first time each background object is seen — keyed on
// object identity, so a map rebuild (which assigns a NEW Color) re-captures instead of compounding the lift.
let _bgBase = null, _bgFor = null;
function applyStarLift(spec, dist) {
  const lift = spec.lift || 0, liftNear = spec.liftNear ?? 300, liftFar = spec.liftFar ?? 1200;
  const t = Math.min(1, Math.max(0, (liftFar - dist) / Math.max(1, liftFar - liftNear)));
  const f = 1 + lift * (t * t * (3 - 2 * t)); // smoothstep
  skyScene.backgroundIntensity = f;
  // The lift must drive the parallax LAYER too. `backgroundIntensity` and the Color multiply below both
  // touch only skyScene.background — neither reaches a mesh material — so without this hook the sphere would
  // hold its brightness while the cube behind it lifts, visibly splitting the backdrop into two layers at
  // different brightnesses as you approach the star.
  if (G.backdropMat) G.backdropMat.uniforms.uLift.value = f;
  const bg = skyScene.background;
  if (bg && bg.isColor) {
    if (_bgFor !== bg) { _bgFor = bg; _bgBase = bg.clone(); }
    bg.copy(_bgBase).multiplyScalar(f);
  }
}

// ---------- Shared .glb asteroid pack ----------
// The mission asteroid-field set-piece draws its rocks from a .glb pack of 3 rock meshes (AST_01/02/03,
// each with its own baked texture — CC-BY, see CREDITS.md). This is its ONLY use: the distant backdrop is
// the player-locked Points speed field below (cheaper still — ~920 sprites, 3 draw calls), because at that
// range the rocks are sub-pixel specks where model detail is wasted (a full-disk instanced model field was
// ~1.6M tris; DECISIONS §71 + §96). Load the pack ONCE per URL and hand back normalized VARIANTS: each geometry re-centered
// on its bounding sphere and scaled to UNIT radius, so a caller sizes a rock by a single scale factor.
const _asteroidPacks = new Map(); // url -> Promise<[{ geo, mat }]>
function loadAsteroidPack(url) {
  let p = _asteroidPacks.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      gltfLoader.load(url, (gltf) => {
        const variants = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const geo = o.geometry.clone();
          geo.applyMatrix4(o.matrixWorld);                 // bake the node transform into the geometry
          geo.computeBoundingSphere();
          const { center, radius } = geo.boundingSphere;
          geo.translate(-center.x, -center.y, -center.z);  // center at origin
          geo.scale(1 / radius, 1 / radius, 1 / radius);   // → unit radius; caller scales to taste
          geo.computeBoundingSphere();
          variants.push({ geo, mat: o.material });
        });
        variants.length ? resolve(variants) : reject(new Error('asteroid pack had no meshes'));
      }, undefined, reject);
    });
    _asteroidPacks.set(url, p);
  }
  return p;
}
// A per-use material clone so the mission field can force fog OFF (readable up close) without
// sharing/mutating the pack's material.
function asteroidMat(src, fog) { const m = src.clone(); m.fog = fog; return m; }

// ---------- Player-locked wrapping speed field (the parallax backdrop; DECISIONS §96) ----------
// A FIXED pool of point sprites in 3 depth layers (~920 points, one draw call each) sunk below the combat
// plane in WORLD coordinates, re-wrapped every frame into a ±radius box centred on the PLAYER — so the same
// specks surround the ship everywhere in the system at constant cost, and flying anywhere reads as fast.
// (It replaces an origin-anchored ring of 2000 instanced rocks that the player simply flew out of.)
// Pure render decor in the COMBAT scene: never in a gameplay array, never collidable, never sent to the
// server. The pure math/defaults/clamping live in speed-field.js.
let speedField = null;                                 // { spec, layers: [{ points, pos, half }] }
// The live spec the ?dev folder binds to. Mutated IN PLACE by buildMap (never replaced) so the panel's
// sliders — built once at boot — keep pointing at the current values across level/map switches.
const speedFieldSpec = normalizeSpeedField(undefined); // starts at SPEED_FIELD_DEFAULTS
const SPEED_POINT_WHITE = { r: 1, g: 1, b: 1 };        // see makeSpeedField: the tint lives on the material

// Copy a normalized spec into the stable panel-bound object (in place; see above).
function applySpeedFieldSpec(src) {
  speedFieldSpec.color = src.color;
  if (speedFieldSpec.layers.length !== src.layers.length) speedFieldSpec.layers = src.layers.map((l) => ({ ...l }));
  else src.layers.forEach((l, i) => Object.assign(speedFieldSpec.layers[i], l));
  return speedFieldSpec;
}

// Build the field's THREE objects from a normalized spec and add them to the combat scene. The scatter is
// centred on the ORIGIN and draws the NATIVE Math.random (never simRandom — DECISIONS §73); the first
// settleView wraps it around the player on frame 1.
function makeSpeedField(spec) {
  const rgb = new THREE.Color(spec.color);
  const layers = spec.layers.map((layer) => {
    const pos = scatterLayer(layer, Math.random);
    // Vertex colors carry ONLY the per-point brightness jitter (white × 0.55..1.0); the layer TINT sits on
    // material.color, which PointsMaterial multiplies in — that keeps the ?dev colour picker a one-line live
    // write instead of a re-scatter (and the jitter stops the field reading as a uniform stipple).
    const col = scatterColors(layer, SPEED_POINT_WHITE, Math.random);
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage); // rewritten every frame by the wrap
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: layer.size,
      sizeAttenuation: true,       // world-unit sizes → deeper layers read smaller (real perspective parallax)
      map: getSpeedDotTexture(),   // the field's OWN crisp procedural dot (no image asset, not the star glow)
      color: rgb,
      vertexColors: true,
      transparent: true,
      opacity: layer.opacity,
      depthTest: true,             // planet/set-pieces/ships occlude the field correctly
      depthWrite: false,           // …but the sprites must not cut into each other
      blending: THREE.NormalBlending, // dim rocks, not stars — NOT additive
      fog: true,                   // the deep layer fades out on the combat fog (240..600)
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;  // the pool is re-centred on the player every frame; its bounding sphere is stale by design
    scene.add(points);
    return { points, pos, half: layer.radius };
  });
  return { spec, layers };
}

// Remove the field from the scene and free its GPU resources. buildMap re-runs on every level start / map
// switch (main.js, account.js, net.js, the ?tune rebuild button) — the old asteroid ring was never removed
// there, so each rebuild leaked one InstancedMesh.
function disposeSpeedField() {
  if (!speedField) return;
  for (const L of speedField.layers) {
    scene.remove(L.points);
    L.points.geometry.dispose();
    L.points.material.dispose();
  }
  speedField = null;
}

// Re-centre the field on the player. VIEW-LAYER ONLY: called from settleView(), never from the tick.
// Consumes NO randomness at all, so it is replay-neutral by construction (DECISIONS §73). Only the points
// that actually left the box are rewritten, and the GPU upload is skipped entirely when nothing moved.
//
// WARP-STREAK HOOK (deliberately not built — out of scope): this is the single per-frame place that already
// holds the player transform and every layer's material. A future velocity-stretch pass hangs off HERE (read
// G.player.vel, feed a uStretch uniform after swapping PointsMaterial for a ShaderMaterial). Do not add it now.
export function updateSpeedField(x, z) {
  if (!speedField) return;
  // Dim (and eventually drop) the field near the star — see starDustFactor. `G.speedFieldDim` is written by
  // updateSystemBodies, which settleView runs just before this, so it is always this frame's value. Opacity
  // is recomputed from the SPEC each frame rather than scaled in place, so it can't drift and the ?dev
  // opacity slider (which writes the spec too) keeps working.
  const dim = G.speedFieldDim ?? 1;
  speedField.layers.forEach((L, i) => {
    if (wrapField(L.pos, x, z, L.half)) L.points.geometry.attributes.position.needsUpdate = true;
    const authored = speedField.spec.layers[i]?.opacity ?? L.points.material.opacity;
    L.points.material.opacity = authored * dim;
    L.points.visible = dim > 0.02; // fully faded → skip the draw call entirely
  });
}

// Headless-test hook (the 31-speed-field scenario): the live layers, [] before the first buildMap.
export function speedFieldLayers() { return speedField ? speedField.layers : []; }

// ?dev "Speed field" folder, hosted by the Backdrop panel (ghost-battle.js buildBackdropPanel). Cheap
// look-only controls (size/opacity/colour) write straight to the live materials so a drag doesn't make the
// field jump; the structural ones (count/radius/depth/depthVar) rebuild on release. Every change is
// persisted to localStorage and re-applied on the next buildMap — under isDev() only.
export function buildSpeedFieldFolder(gui) {
  const spec = speedFieldSpec;
  const persist = () => saveSpeedTune(window.localStorage, spec);
  const rebuild = () => { disposeSpeedField(); speedField = makeSpeedField(spec); persist(); };
  const live = (i) => speedField && speedField.layers[i] ? speedField.layers[i].points.material : null;

  const f = gui.addFolder('Speed field');
  f.addColor(spec, 'color').name('Colour').onChange((v) => {
    for (const L of (speedField ? speedField.layers : [])) L.points.material.color.set(v);
    persist();
  });
  const names = ['Layer 0 (near)', 'Layer 1 (mid)', 'Layer 2 (far)'];
  spec.layers.forEach((layer, i) => {
    const lf = f.addFolder(names[i] || `Layer ${i}`);
    lf.add(layer, 'count', SPEED_FIELD_RANGES.count[0], SPEED_FIELD_RANGES.count[1], 10).name('Count').onFinishChange(rebuild);
    lf.add(layer, 'size', SPEED_FIELD_RANGES.size[0], SPEED_FIELD_RANGES.size[1], 0.1).name('Point size')
      .onChange((v) => { const m = live(i); if (m) m.size = v; persist(); });
    lf.add(layer, 'radius', SPEED_FIELD_RANGES.radius[0], SPEED_FIELD_RANGES.radius[1], 10).name('Wrap radius R').onFinishChange(rebuild);
    lf.add(layer, 'depth', SPEED_FIELD_RANGES.depth[0], SPEED_FIELD_RANGES.depth[1], 1).name('Depth (below plane)').onFinishChange(rebuild);
    lf.add(layer, 'depthVar', SPEED_FIELD_RANGES.depthVar[0], SPEED_FIELD_RANGES.depthVar[1], 1).name('Depth spread').onFinishChange(rebuild);
    lf.add(layer, 'opacity', SPEED_FIELD_RANGES.opacity[0], SPEED_FIELD_RANGES.opacity[1], 0.05).name('Opacity')
      .onChange((v) => { const m = live(i); if (m) m.opacity = v; persist(); });
    lf.close();
  });
  // Shipped floor, not a hard limit — the sliders deliberately reach lower so a tighter box can be judged
  // live; below it the wrap edge starts entering the frustum at max zoom-out (pop-in). NOT a fog distance.
  const hint = { note: `R < ${WRAP_SAFE_RADIUS} → wrap edge enters the frustum at max zoom-out (pop-in)` };
  f.add(hint, 'note').name('shipped floor').disable();
  f.add({ dump() {
    console.log('speedField:', JSON.stringify(spec, (k, v) => (k === 'color' ? '0x' + v.toString(16) : v), 2));
    console.log(`(paste into server/src/catalog_seed.js MAPS; keep every layer's radius >= ${WRAP_SAFE_RADIUS} — the shipped no-pop-in floor)`);
  } }, 'dump').name('Dump speed field → console');
}

// ---------- Mission set-pieces (procedural decor in the combat scene) ----------
// Generated in code (no .glb), added to the COMBAT scene so they're lit from above by the combat sun
// like the ships — the near "battle environment" we fight around. They sit ~500 below the combat plane
// (real depth, render behind the ships); materials use `fog: false` so they stay readable at that range.
// Decoration only: not in the gameplay arrays, so bullets pass through and the AI ignores them.
// See docs/plans/mission-maps.md.

// Research station: a central hub + a flat ring on spokes, two solar-panel wings, a few modules, and
// emissive windows. Big and readable from the arena; slowly rotates so it reads as "alive".
function makeResearchStation(spec) {
  const g = new THREE.Group();
  const tint = spec.hue ?? 0x9aa7b5;
  const body = new THREE.MeshStandardMaterial({ color: tint, metalness: 0.85, roughness: 0.42, flatShading: true, fog: false });
  const dark = new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.7, roughness: 0.55, flatShading: true, fog: false });
  const panel = new THREE.MeshStandardMaterial({ color: 0x16284c, metalness: 0.35, roughness: 0.5, emissive: 0x0b1c3a, emissiveIntensity: 0.6, flatShading: true, fog: false });
  const glow = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, fog: false }); // emissive windows / running lights

  // central hub (vertical cylinder, axis = camera-facing y)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 70, 18), body);
  g.add(hub);
  // a window band around the hub
  const band = new THREE.Mesh(new THREE.CylinderGeometry(22.6, 22.6, 8, 18, 1, true), glow);
  band.position.y = 6; g.add(band);
  // a capped dome on top
  const dome = new THREE.Mesh(new THREE.SphereGeometry(22, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  dome.position.y = 35; g.add(dome);

  // outer ring lying flat in the XZ plane, on 4 spokes
  const ring = new THREE.Mesh(new THREE.TorusGeometry(92, 7, 12, 56), body);
  ring.rotation.x = Math.PI / 2; g.add(ring);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(86, 5, 8), dark);
    spoke.position.set(Math.cos(i * Math.PI / 2) * 46, 0, Math.sin(i * Math.PI / 2) * 46);
    spoke.rotation.y = -i * Math.PI / 2; g.add(spoke);
  }
  // running lights spaced around the ring
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const led = new THREE.Mesh(new THREE.SphereGeometry(2.2, 6, 6), glow);
    led.position.set(Math.cos(a) * 92, 0, Math.sin(a) * 92); g.add(led);
  }

  // two solar-panel wings extending along x
  for (const dir of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(40, 3, 4), dark);
    arm.position.set(dir * 42, 22, 0); g.add(arm);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(70, 1.5, 46), panel);
    wing.position.set(dir * 96, 22, 0); g.add(wing);
  }
  // a couple of docking modules near the hub
  for (const dz of [-1, 1]) {
    const mod = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 26), body);
    mod.position.set(0, -8, dz * 30); g.add(mod);
    const lite = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 2), glow);
    lite.position.set(0, -2, dz * 42); g.add(lite);
  }

  const spin = spec.spin ?? 0.06;
  g.rotation.x = spec.tilt ?? 0; // a light tilt so the ring/face reads from the top-down camera
  // spin around the station's OWN (tilted) vertical axis so the tilt is preserved as it rotates
  return { obj: g, update: (dt) => { g.rotateY(spin * dt); } };
}

// One irregular asteroid: a subdivided icosahedron whose vertices are pushed in/out by a coherent
// (position-based, seed-varied) noise so it's lumpy, not round — flat-shaded + a cratered moon texture.
function makeIrregularAsteroid(radius, tex, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const p = geo.attributes.position, v = new THREE.Vector3();
  const a = seed * 1.7, b = seed * 2.3, c = seed * 0.9;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.clone().normalize(); // noise on direction → shared verts move together (no cracks)
    const n = 1 + 0.22 * Math.sin(d.x * 3.3 + a) + 0.18 * Math.sin(d.y * 4.1 + b)
                + 0.20 * Math.sin(d.z * 3.7 + c) + 0.12 * Math.sin((d.x + d.z) * 6.2 + seed);
    v.multiplyScalar(n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, metalness: 0.05, flatShading: true, fog: false }));
}

// Asteroid field + mining stations: each station works a host asteroid with a beam = a stream of
// microparticles flowing from the asteroid up to the station's collector. The rigs are TILTED off
// vertical so the beam has horizontal extent and reads well from the top-down camera. Irregular/cratered
// rocks (real, up-close geometry — nothing like the distant point sprites of the backdrop speed field);
// decor only (not collidable).
function makeAsteroidField(spec) {
  const g = new THREE.Group();
  const base = spec.color ?? 0x6e6a63;
  const count = spec.count ?? 14, spread = spec.spread ?? 120;
  const minS = spec.minSize ?? 6, maxS = spec.maxSize ?? 26;
  const beamColor = spec.beamColor ?? 0xffcc66;
  const metal = new THREE.MeshStandardMaterial({ color: 0x8b94a0, metalness: 0.8, roughness: 0.4, flatShading: true, fog: false });
  const litMat = new THREE.MeshBasicMaterial({ color: beamColor, fog: false });
  const useModel = spec.modelUrl && !location.search.includes('debug'); // ?debug keeps the procedural rocks
  const V = 3; // pack variant count (also the procedural texture count)

  // Precompute the random field scatter ONCE so the tumble list matches whatever ends up rendering the
  // rocks — .glb rocks are placed asynchronously once the pack loads; procedural rocks are placed now.
  const hostR = spec.hostSize ?? 26, beamLen = spec.beamLen ?? 34, tilt = spec.beamTilt ?? 0.5; // tilt rad off vertical
  const N = spec.beamCount ?? 50, width = spec.beamWidth ?? 3, speed = spec.beamSpeed ?? 0.5;
  const UP = new THREE.Vector3(0, 1, 0);
  const fieldData = [];
  for (let i = 0; i < count; i++) {
    fieldData.push({
      pos: [(Math.random() * 2 - 1) * spread, (Math.random() * 2 - 1) * spread * 0.22, (Math.random() * 2 - 1) * spread],
      rot: [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28],
      r: minS + Math.random() * (maxS - minS), vi: (Math.random() * V) | 0,
      sx: (Math.random() - 0.5) * 0.2, sy: (Math.random() - 0.5) * 0.2, sz: (Math.random() - 0.5) * 0.2,
    });
  }

  // mining rigs: a host asteroid (an empty Group whose rock is added by placeRocks) + a tilted station +
  // a tilted beam. Two of them, placed apart.
  const placements = [
    { pos: new THREE.Vector3(-spread * 0.30, -spread * 0.08, spread * 0.18), az: 0.6 },
    { pos: new THREE.Vector3(spread * 0.32, spread * 0.08, -spread * 0.22), az: 3.6 },
  ];
  const rocks = []; // { mesh, sx, sy, sz } tumble list, populated by placeRocks()
  const rigs = placements.map((pl, k) => {
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(pl.az), Math.cos(tilt), Math.sin(tilt) * Math.sin(pl.az)).normalize();
    const host = new THREE.Group(); // the host rock is added by placeRocks() (now, or on pack load)
    host.hostVi = (90 + k) % V;
    host.position.copy(pl.pos); g.add(host);

    const station = new THREE.Group();
    station.add(new THREE.Mesh(new THREE.BoxGeometry(22, 11, 16), metal));
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(5, 9, 13, 12), metal); funnel.position.y = -10; station.add(funnel);
    const slite = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 8), litMat); slite.position.y = 8; station.add(slite);
    const stationPos = pl.pos.clone().addScaledVector(dir, hostR + beamLen);
    station.position.copy(stationPos);
    station.quaternion.setFromUnitVectors(UP, dir); // tilt the station to align with the beam
    g.add(station);

    // beam from the host surface to the collector, along the tilted axis, with perpendicular wobble
    const from = pl.pos.clone().addScaledVector(dir, hostR * 0.7);
    const seg = stationPos.clone().addScaledVector(dir, -12).sub(from);
    const axis = seg.clone().normalize();
    const perp1 = new THREE.Vector3(0, 0, 1);
    if (Math.abs(axis.z) > 0.9) perp1.set(1, 0, 0);
    perp1.crossVectors(axis, perp1).normalize();
    const perp2 = new THREE.Vector3().crossVectors(axis, perp1);
    const bpos = new Float32Array(N * 3), bt = new Float32Array(N), boff = new Float32Array(N);
    for (let i = 0; i < N; i++) { bt[i] = Math.random(); boff[i] = Math.random() * Math.PI * 2; }
    const bgeo = new THREE.BufferGeometry(); bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    const bmat = new THREE.PointsMaterial({ color: beamColor, size: 2.4, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    g.add(new THREE.Points(bgeo, bmat));
    return { host, from, seg, perp1, perp2, bpos, bt, boff, bgeo };
  });

  // Place the field rocks + each rig's host rock. `rockFor(radius, vi)` returns a sized Object3D — either
  // a random .glb variant or a procedural cratered icosahedron. Registers each field rock for tumbling.
  const placeRocks = (rockFor) => {
    fieldData.forEach((d, i) => {
      const m = rockFor(d.r, d.vi, i + 1);
      m.position.set(...d.pos); m.rotation.set(...d.rot);
      g.add(m); rocks.push({ mesh: m, sx: d.sx, sy: d.sy, sz: d.sz });
    });
    rigs.forEach((rig, k) => rig.host.add(rockFor(hostR, rig.host.hostVi, 90 + k)));
  };
  const proceduralRock = () => {
    const texes = [makeMoonTexture(base), makeMoonTexture(0x5f5a52), makeMoonTexture(0x726a60)];
    return (radius, vi, seed) => makeIrregularAsteroid(radius, texes[vi % V], seed * 1.37 + 1);
  };
  if (useModel) {
    loadAsteroidPack(spec.modelUrl).then((variants) => {
      const mats = variants.map((v) => asteroidMat(v.mat, false)); // fog OFF: readable up close in the arena
      placeRocks((radius, vi) => { const m = new THREE.Mesh(variants[vi % variants.length].geo, mats[vi % variants.length]); m.scale.setScalar(radius); return m; });
    }).catch((err) => { console.warn('Asteroid-field model failed, using procedural rocks:', spec.modelUrl, err); placeRocks(proceduralRock()); });
  } else {
    placeRocks(proceduralRock());
  }

  return { obj: g, update: (dt) => {
    for (const r of rocks) { r.mesh.rotation.x += r.sx * dt; r.mesh.rotation.y += r.sy * dt; r.mesh.rotation.z += r.sz * dt; }
    for (const rig of rigs) {
      rig.host.rotation.y += 0.05 * dt;
      for (let i = 0; i < N; i++) {
        rig.bt[i] += dt * speed; if (rig.bt[i] > 1) rig.bt[i] -= 1;
        const t = rig.bt[i], c = Math.cos(rig.boff[i]), s = Math.sin(rig.boff[i]);
        const wob = Math.sin(rig.boff[i] + t * 6) * width * (1 - t); // taper toward the collector
        rig.bpos[i * 3]     = rig.from.x + rig.seg.x * t + (rig.perp1.x * c + rig.perp2.x * s) * wob;
        rig.bpos[i * 3 + 1] = rig.from.y + rig.seg.y * t + (rig.perp1.y * c + rig.perp2.y * s) * wob;
        rig.bpos[i * 3 + 2] = rig.from.z + rig.seg.z * t + (rig.perp1.z * c + rig.perp2.z * s) * wob;
      }
      rig.bgeo.attributes.position.needsUpdate = true;
    }
  } };
}

// Cargo freighter (for "save the transport"): the first .glb-backed set-piece — it loads a real cargo-ship
// model (auto center/scale/`yaw`-oriented like a ship model) and keeps a fiery exhaust particle stream
// (hot→orange→red) streaming aft from behind the model's real engines. Nose faces +z (travel direction).
// When `spec.sync`, it follows the drifting arena center so it stays "below the battlefield" as the zone pans.
const FREIGHTER_MODEL_LEN = 130; // normalize the glb's longest axis to the old procedural spine length,
                                 // so the existing set-piece pos + scale:0.33 stay visually equivalent
function makeFreighter(spec) {
  const g = new THREE.Group();

  // --- Exhaust: the shared GPU/baked-texture, shader-driven axis-aligned plume (exhaust-fx.js), built
  //     ONCE (no per-frame buffer re-upload). Reads spec.exhaust merged over the module defaults
  //     (palette/count/len/size/speed + optional turbulence/softness). OPTIONAL & server-driven; absent →
  //     all defaults. Honors the GLOBAL (a)/(b) look toggle shared with every ship plume. ---
  const fx = makeFreighterExhaust(spec);

  // Emitter origin + lateral spread are MUTABLE: the plume is built now, but the model (whose real rear
  // bounds define where fire should stream from) loads async. The loader pushes the derived origin/spread
  // into the plume uniforms via fx.setOrigin. Sensible pre-load default so a plume shows immediately.
  const emit = new THREE.Vector3(0, 0, -60); // group-local (pre-scale) units
  let spread = 3;                            // lateral jitter half-extent, group-local
  fx.setOrigin(emit, spread);
  g.add(fx.obj);

  // load the .glb (exhaust-only during load and on error — no procedural fallback), then re-derive the
  // emitter from the model's real group-local rear bounds so fire streams from behind the actual engines
  if (spec.modelUrl) G.pendingAssets++; // hold the level-load veil until the set-piece is here (DECISIONS §84)
  if (spec.modelUrl) gltfLoader.load(spec.modelUrl, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size3 = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = FREIGHTER_MODEL_LEN / (Math.max(size3.x, size3.y, size3.z) || 1);
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s); // recenter at group origin
    const pivot = new THREE.Group();
    pivot.rotation.y = spec.yaw ?? 0;               // orient nose to +Z (data-fixed, like ship models)
    pivot.add(model);
    G.needsSceneWarm = true; // late async arrival: compile + upload it before the next frame draws it
    G.pendingAssets--;
    pivot.updateMatrixWorld(true);                  // measure while unparented → local == world
    const lbox = new THREE.Box3().setFromObject(pivot); // group-local bounds after scale+yaw
    // single rear-center emitter: model's tail (-Z), vertical center, spread scaled to the rear width
    emit.set(0, (lbox.min.y + lbox.max.y) / 2, lbox.min.z);
    spread = (lbox.max.x - lbox.min.x) * 0.2;
    fx.setOrigin(emit, spread); // push the model-derived origin/spread into the plume uniforms
    g.add(pivot);
  }, undefined, (err) => { G.pendingAssets--; console.warn('Freighter model failed to load, keeping exhaust only:', spec.modelUrl, err); });

  return { obj: g, dispose: () => fx.dispose(), update: (dt) => {
    fx.update(dt); // advance the plume's uTime (no buffer re-upload)
    // a transport in transit: it slowly cruises forward (along its nose, +z) at `speed` units/sec
    if (spec.speed) g.position.z += spec.speed * dt;
    // (escort drift) ride the zone center while the arena is drifting — off unless a mission turns it on
    if (spec.sync && simWorld.arenaDrift) { g.position.x = arenaCenter.x; g.position.z = arenaCenter.z; }
  } };
}

// Shared builder for the .glb STATION set-pieces (the base station and the space factory): a below-plane,
// NON-collidable model, mirroring the freighter's async center/scale/`yaw` normalization but with no
// exhaust, slowly spinning on its y axis. Stations are raised closer to the combat plane than the freighter
// so they read clearly from the top-down camera. `STATION_LEN` normalizes the model's LONGEST axis, which is
// what makes two models of wildly different source scale sit side by side at a comparable on-screen size.
//
// SIZING NOTE. The camera is near-top-down, so the axis you SEE is the model's widest one — which is the one
// being normalized. A "flat" model therefore does NOT read smaller than a tall one at the same len; flatness
// only costs height, which top-down barely shows. So len is a straight on-screen-footprint dial: at the
// factory's depth the frame is ~140 u tall, so len 120 covers ~85% of it — a landmark you arrive AT, a step
// up from the home station without overflowing the frame.
//
// VERTICAL-EXTENT NOTE (§17): the model must stay entirely BELOW the plane the ships fly on (y ≈ 0.6), or it
// pokes through and occludes them. The check is `pos.y + halfHeight < 0.6`, where halfHeight comes out of
// `STATION_LEN` and the source model's proportions — so changing either means re-checking the seed's pos.y:
//   • base station — a TALL model (y ≈ 0.78 of its longest axis): len 100 → halfHeight ≈ 39, seed y = -42,
//     top ≈ -2.9. ✓
//   • space factory — a WIDE, FLAT ring (y ≈ 0.23 of its longest axis, bbox 6.49 x 1.52 x 6.49): len 120 →
//     halfHeight ≈ 14, seed y = -28, top ≈ -14. ✓
const STATION_LEN = { 'base-station': 100, 'space-factory': 120 };

function makeStationModel(spec) {
  const g = new THREE.Group();
  const len = STATION_LEN[spec.type] ?? 100;
  if (spec.modelUrl) G.pendingAssets++; // hold the level-load veil until the set-piece is here (DECISIONS §84)
  if (spec.modelUrl) gltfLoader.load(spec.modelUrl, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size3 = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = len / (Math.max(size3.x, size3.y, size3.z) || 1);
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s); // recenter at group origin
    const pivot = new THREE.Group();
    pivot.rotation.y = spec.yaw ?? 0;
    pivot.add(model);
    G.needsSceneWarm = true; // late async arrival: compile + upload it before the next frame draws it
    G.pendingAssets--;
    g.add(pivot);
  }, undefined, (err) => { G.pendingAssets--; console.warn(`${spec.type} model failed to load:`, spec.modelUrl, err); });
  const spin = spec.spin ?? 0;
  return { obj: g, update: (dt) => { if (spin) g.rotation.y += spin * dt; } };
}

// Dispatch a set-piece spec to its procedural builder, position it, and add it to the combat scene.
//
// RNG CONTRACT: decor (this builder, the mission asteroid scatter, stars, nebula/planet textures, the speed
// field's one-time scatter) draws the NATIVE `Math.random` on purpose — never `simRandom()`. Gameplay-affecting
// randomness lives in `sim-random.js`; keeping decor out of the seeded stream is what makes the recorded
// intro/replays survive decor changes (DECISIONS §73). Set-pieces are (re)built inside reset(), i.e. BEFORE
// tick 0, so a seeded decor draw would displace the whole fight's stream — that is exactly how the .glb
// asteroid field broke the intro. (The speed field's per-frame wrap draws NO randomness at all, and runs in
// the view layer anyway.) Consequence, accepted: decor layout differs between two playbacks of the same
// trace (cosmetic).
export function buildSetPiece(spec) {
  let entry = null;
  switch (spec.type) {
    case 'research-station': entry = makeResearchStation(spec); break;
    case 'asteroid-field':   entry = makeAsteroidField(spec); break;
    case 'freighter':        entry = makeFreighter(spec); break;
    case 'base-station':     entry = makeStationModel(spec); break;
    case 'space-factory':    entry = makeStationModel(spec); break;
    default: return; // unknown type → skip (forward-compatible with new set-pieces)
  }
  if (spec.scale && spec.scale !== 1) entry.obj.scale.setScalar(spec.scale);
  // FRAME (see docs/plans/heliocentric-coordinate-frame.md). Default `frame:"planet:2"` — pos is a LOCAL
  // offset in the base zone, placed verbatim (byte-identical to before). `frame:"world"` — pos is a STAR-frame
  // (space-fixed) coordinate: convert to the base zone's local frame each frame so the object stays put in
  // space while the base orbits past it. Placement only (never read by the sim → replay-neutral like the sky
  // bodies; the [x,z] convert, y stays a literal depth).
  if (spec.frame === 'world') {
    const wx = spec.pos[0], wy = spec.pos[1], wz = spec.pos[2];
    const place = () => {
      const l = worldToLocal({ x: wx, z: wz }, planetOriginOffset(Date.now()));
      entry.obj.position.set(l.x, wy, l.z);
    };
    place();
    const inner = entry.update;
    entry.update = (dt) => { if (inner) inner(dt); place(); };
  } else {
    entry.obj.position.set(...spec.pos);
  }
  scene.add(entry.obj);
  setPieces.push(entry);
  // Stash the base station on G so the sim/HUD/click code can find it (the return-to-base target).
  // `pos` is captured here because the station never moves and the SIMULATION needs it (docking distance);
  // `obj` is the body, which a headless host would not have. See sim-core/world.js `station`.
  if (spec.type === 'base-station') {
    const o = entry.obj.position;
    G.baseStation = { obj: entry.obj, pos: new Vec3(o.x, o.y, o.z), active: false };
  }
  // (The ambient ghost battle is NOT built here — it's a fixed-world-anchor decor built in sim.js reset() for
  // every NON-freighter mission, not tied to the freighter set-piece. See DECISIONS §59.)
}

// ---------- Build the scene from a map descriptor (see server catalog_seed.js MAPS) ----------
// Generic generator: builds the sky backdrop (background, lights, star + 4-planet system bodies, stars),
// the player-locked speed-field, and any mission set-pieces from `descriptor`. The combat-scene light is
// constant (readability).
export function buildMap(descriptor) {
  const d = descriptor;
  G.currentMapDescriptor = descriptor; // remembered for the ?tune panel's rebuild button
  // clear set-pieces from a previous map (switching maps between levels)
  for (const sp of setPieces) scene.remove(sp.obj);
  setPieces.length = 0;
  // arena drift: maps with a `drift` (units/sec on x,z) slowly pan the combat zone; default = static
  simWorld.arenaDrift = d.drift ? { x: d.drift.x || 0, z: d.drift.z || 0 } : null;
  G.baseStation = null; // rebuilt by buildSetPiece below when the map has a base-station set-piece
  arenaCenter.set(0, 0, 0);
  arenaBorder.line.position.set(0, 0, 0);
  // Baked procedural nebula sky (DECISIONS §43): tier-gated (gfx.nebulaBake null on Performance → flat
  // color) and SKIPPED under the ?debug test hook (mirrors prewarmShaders; keeps the visual suite's
  // backdrop unchanged — do not regen baselines). Dispose the previous bake before rebuilding (buildMap
  // re-runs on every level start / map switch, so a leaked cube RT would accumulate).
  if (G.nebulaRT) { G.nebulaRT.dispose(); G.nebulaRT = null; }
  disposeBackdropLayer();   // same leak class as the nebula RT: buildMap re-runs on every level/map switch
  // `nebula` is an OPT-IN test flag on top of ?debug: it turns the bake (and with it the parallax layer)
  // back on for a scenario that needs the real backdrop while keeping ?debug's window.__game hooks — which
  // the backdrop-brightness assertion needs to project the player to screen. Every existing scenario omits
  // it and is therefore byte-identical.
  const bakeNebula = G.gfx.nebulaBake
    && (!location.search.includes('debug') || location.search.includes('nebula'));
  if (bakeNebula) {
    const nb = { ...NEBULA_ICEBLUE, ...(d.sky.nebula || {}) }; // descriptor overrides fall back per-key
    G.nebulaRT = makeNebulaSky(nb, G.gfx.nebulaBake);
    skyScene.background = G.nebulaRT.texture;
    // Layer 1: the additive, camera-tracking parallax nebula in FRONT of the cube (its own seed + scale).
    buildBackdropLayer(nb, G.gfx.nebulaBake, d.sky.nebula2);
  } else {
    skyScene.background = new THREE.Color(d.background);
  }
  // Sky lights are recreated per map, so the PREVIOUS pair has to come out of the scene first. It didn't
  // until 2026-08-10: every level start / map switch added another ambient + another directional light, so a
  // session accumulated them — the planets got brighter and their terminator flatter the longer you played,
  // and (once the light started being aimed from the star) the stale fixed-direction lights kept lighting the
  // planet from the old authored angle alongside the aimed one. Same class of leak as the nebula RT above.
  if (G.skyAmbient) skyScene.remove(G.skyAmbient);
  if (G.skySun) { skyScene.remove(G.skySun.target); skyScene.remove(G.skySun); }
  G.skyAmbient = new THREE.AmbientLight(d.sky.ambient.color, d.sky.ambient.intensity); // night-side fill
  skyScene.add(G.skyAmbient);
  // The terminator source. Its POSITION is not authored: updateSystemBodies re-aims it every frame so the
  // light arrives FROM the star (see aimSkySunAtStar). The descriptor's `sun.pos` is only the pre-first-frame
  // placement and the fallback for a map with no star. Colour + intensity ARE authored (and ?tune-able).
  G.skySun = new THREE.DirectionalLight(d.sky.sun.color, d.sky.sun.intensity);
  G.skySun.position.set(...d.sky.sun.pos);
  skyScene.add(G.skySun);
  skyScene.add(G.skySun.target); // three reads the direction from target.matrixWorld — it must be in the scene

  // When the nebula is baked it supplies the dense STATIC star field, so thin the MOVING parallax layer
  // to ~0.4× (it now only sells depth, not density). On the flat-color path keep full count. Still scales
  // with the quality tier (gfx.starScale). See DECISIONS §43.
  const starMul = bakeNebula ? 0.4 : 1.0;
  G.stars = makeStars(Math.round(d.stars.count * G.gfx.starScale * starMul), d.stars.radius);
  G.stars.renderOrder = -1; // draw stars first, before the star-system bodies
  skyScene.add(G.stars);

  // The sky group holds the star + 4 planets + the home planet's moons. It stays at the WORLD ORIGIN and
  // never moves: the bodies carry absolute world positions on the ecliptic (bodyRenderPos), so you fly over
  // them with real perspective and nothing is camera-anchored (see updateSystemBodies / §98). The
  // descriptor's `system` block is merged into SYSTEM first, so the renderer, the map screen and the ?roam
  // tunables all read one object.
  applySystemSpec(descriptor.system);
  G.sky = new THREE.Group();
  G.sky.position.set(0, 0, 0);
  skyScene.add(G.sky);
  buildSystemBodies(SYSTEM, d.planet && d.planet.ocean);

  // Player-locked wrapping speed field (was: an origin-anchored asteroid ring — DECISIONS §96). Reads
  // `d.speedField` only (falls back to the defaults when missing); the legacy `d.asteroids` shim was retired.
  disposeSpeedField();                       // buildMap re-runs per level/map switch — the old ring LEAKED here
  const base = normalizeSpeedField(d.speedField);
  speedField = makeSpeedField(applySpeedFieldSpec(isDev() ? loadSpeedTune(window.localStorage, base) : base));

  // mission set-pieces (decor in the combat scene), fixed in this shared world; remembered so each run
  // rebuilds them fresh (resets the cruising freighter)
  G.mapSetpieces = d.setpieces || [];
  for (const sp of G.mapSetpieces) buildSetPiece(sp);
}
