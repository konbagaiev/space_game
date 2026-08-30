// Post-processing: the whole "expensive look" render path lives here.
//
// THE PASS ORDER IS THE FEATURE (DECISIONS §137). The scene is rendered LINEAR HDR into a HalfFloat render
// target, bloom picks out everything above the threshold, and only the FINAL pass applies exposure + colour
// grade + ACES filmic tonemapping + vignette + the sRGB encode. Tonemapping before bloom is the classic
// wrong order: it squashes everything into 0..1 first, which makes the bloom threshold meaningless and the
// glow flat and grey. Two rules follow, and both are load-bearing:
//   1. `renderer.toneMapping` stays NoToneMapping PERMANENTLY (D3). We own the ACES step. Do not "fix" this.
//      (The hangar's own separate renderer does set ACES — model-viewer.js — because it has no composer.)
//   2. The composer's render target MUST be HalfFloatType (D4). With an 8-bit target every source clamps at
//      1.0 before the bloom high-pass ever sees it, and the bloom comes out flat.
//
// We deliberately do NOT use three's `OutputPass` (D2): its render() compares `renderer.toneMapping` against
// a cached value and sets `material.needsUpdate = true` on a mismatch — with our NoToneMapping renderer that
// would recompile a shader EVERY FRAME. Our grade pass owns tonemapping instead.
//
// Tiering is by PASS COUNT, not resolution (graphics.js `post`): Performance builds no composer at all and
// keeps today's two-pass frame. Every HDR gain above 1.0 is therefore gated through `postGain`/`fxColor` —
// without a composer a >1 colour clips PER CHANNEL at the 8-bit sRGB write, which flattens the FX and shifts
// its hue (D18). Never read POST_DEFAULTS.fxGain/exhaustGain directly.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { scene, skyScene, camera, renderer, onResize, gameW, gameH } from './engine.js';
import { G } from './state.js';
import { POST_DEFAULTS, postGain } from './graphics.js';

// ---------- Pass 0: the existing two-pass frame, verbatim, into the composer's read buffer ----------
// This reproduces main.js's historical four lines exactly (clear → sky → clearDepth → combat), which is
// DECISIONS §5's two-scene lighting invariant. `needsSwap = false` so BOTH scenes land in the same buffer —
// that is what makes the depth clear between them behave identically to today.
//
// Two stock RenderPasses would NOT be equivalent: r160's RenderPass.render() calls renderer.clearDepth()
// BEFORE setRenderTarget(), so a two-RenderPass chain only works by accident of which target is still bound.
class SceneRenderPass extends Pass {
  constructor() { super(); this.needsSwap = false; }
  render(r, writeBuffer, readBuffer) {
    r.setRenderTarget(this.renderToScreen ? null : readBuffer);
    r.clear();                    // exactly today's renderer.clear() (autoClear is globally false)
    r.render(skyScene, camera);   // pass 1: the sky, with its own light — DECISIONS §5
    r.clearDepth();               // exactly today's clearDepth()
    r.render(scene, camera);      // pass 2: combat on top
  }
}

// ---------- The final grade pass: grade -> ACES (with exposure) -> vignette -> sRGB ----------
const GRADE_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// `#include <tonemapping_pars_fragment>` DECLARES `uniform float toneMappingExposure;` itself (verified in
// the pinned three@0.160 build) — declaring it again here is a GLSL redeclaration error and the shader would
// not compile at all. Exposure is applied EXACTLY ONCE, inside three's ACESFilmicToneMapping(), which
// multiplies by toneMappingExposure / 0.6 internally. Do not add a second exposure multiply.
// Using three's own chunk (rather than a hand-rolled curve) is what makes the hangar — which tonemaps via
// `renderer.toneMapping = ACESFilmicToneMapping` — apply a bit-identical curve to the fight.
const GRADE_FRAG = /* glsl */`
  #include <tonemapping_pars_fragment>
  uniform sampler2D tDiffuse;
  uniform vec3 uGain;
  uniform float uSat, uVigStrength, uVigSoftness;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    // Colour grade, IDENTITY by default (D9 hue lock): a per-channel gain plus a saturation lerp toward
    // luma. It ships neutral and exists as a live ?tune knob, not as a shipped tint.
    vec3 c = texel.rgb * uGain;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c = ACESFilmicToneMapping(c);                     // exposure lives inside this call
    // Vignette AFTER the curve, so it darkens the displayed image rather than eating HDR headroom.
    float r = length(vUv - 0.5) * 1.41421356;         // 0 at the centre .. 1 at a corner
    c *= 1.0 - uVigStrength * smoothstep(uVigSoftness, 1.0, r);
    gl_FragColor = vec4(c, texel.a);
    #include <colorspace_fragment>
  }
`;

function makeGradePass() {
  const p = new ShaderPass({
    name: 'GradePass',
    uniforms: {
      tDiffuse: { value: null },
      toneMappingExposure: { value: POST_DEFAULTS.exposure },
      uGain: { value: new THREE.Vector3(...POST_DEFAULTS.grade.gain) },
      uSat: { value: POST_DEFAULTS.grade.saturation },
      uVigStrength: { value: POST_DEFAULTS.vignette.strength },
      uVigSoftness: { value: POST_DEFAULTS.vignette.softness },
    },
    vertexShader: GRADE_VERT,
    fragmentShader: GRADE_FRAG,
  });
  // Belt and braces: with `toneMapped = false` three can never prepend its own copy of
  // tonemapping_pars_fragment to this shader (it only does so when renderer.toneMapping !== NoToneMapping),
  // so our explicit #include can never collide with it.
  p.material.toneMapped = false;
  return p;
}

// A bloom pass that KEEPS its resolution scale across resizes. EffectComposer.setSize forwards the
// effective size to every pass, and UnrealBloomPass.setSize rebuilds its bright + 5 mip targets from
// width/2, height/2 — discarding the scaled `resolution` handed to the constructor. applyOrientation runs on
// every resize/orientationchange, which on a PHONE (the exact audience bloomScale exists for) fires
// routinely, so without this Balance's only fill saving evaporates on the first rotate.
class ScaledBloomPass extends UnrealBloomPass {
  constructor(resolution, strength, radius, threshold, scale) {
    super(resolution, strength, radius, threshold);
    this.bloomScale = scale;
  }
  setSize(w, h) {
    const s = this.bloomScale || 1;
    super.setSize(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
  }
}

let composer = null;
let bloomPass = null;
let gradePass = null;

// The visual harness runs on software WebGL (SwiftShader), where full-resolution MSAA + a full-size bloom
// chain would drag every scenario into wall-clock timeouts. The CHAIN and the LOOK are unchanged there —
// only the fill cost drops. Harness-speed measure only; it never affects a player's build.
const HARNESS = typeof location !== 'undefined' && location.search.includes('debug');

function createPostFx() {
  const post = G.gfx.post;
  if (!post) return;                       // Performance tier: no composer at all (D6)
  const cfg = HARNESS
    ? { ...post, samples: 0, bloomScale: Math.min(post.bloomScale, 0.5) }
    : post;
  const w = gameW(), h = gameH();
  const dpr = renderer.getPixelRatio();
  // HalfFloat is a HARD requirement (D4). `samples` gives the composer back the canvas MSAA it bypasses
  // (D5) — WebGL2 only, and there is no FXAA pass by design.
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples: renderer.capabilities.isWebGL2 ? cfg.samples : 0,
  });
  rt.texture.name = 'postfx.scene';
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new SceneRenderPass());
  if (cfg.bloom) {
    bloomPass = new ScaledBloomPass(
      new THREE.Vector2(Math.round(w * dpr * cfg.bloomScale), Math.round(h * dpr * cfg.bloomScale)),
      POST_DEFAULTS.bloom.strength, POST_DEFAULTS.bloom.radius, POST_DEFAULTS.bloom.threshold,
      cfg.bloomScale);
    composer.addPass(bloomPass);
  }
  gradePass = makeGradePass();
  composer.addPass(gradePass);
  composer.setSize(w, h);   // sizes both RTs to w*dpr and re-sizes every pass from the same numbers
  onResize.push((rw, rh) => composer.setSize(rw, rh));
}
createPostFx();

// THE single frame entry point — used by BOTH main.js animate() and the ?bench fullFrame, so the two can
// never drift apart (the bench must measure the real, composed frame).
export function renderFrame() {
  renderer.info.reset();
  if (composer) { composer.render(); return; }
  // Performance tier (and any composer-less path): today's two-pass frame, unchanged. The IMAGE is not
  // byte-identical to today there — the hull emissive floor and the larger dust are tier-independent — but
  // the render PATH is, and every HDR gain is pinned to 1.0 by postGain so nothing clips (D18).
  renderer.clear();
  renderer.render(skyScene, camera);
  renderer.clearDepth();
  renderer.render(scene, camera);
}

// The chain's own state, for the ?debug hook (main.js __game.postfx) and the 42-expensive-look scenario.
// "Zero page errors + NoToneMapping" is NOT a liveness check — it is equally true when createPostFx threw
// and the frame silently fell back to the raw two-pass path. This is.
export const postStatus = () => ({ active: !!composer, bloom: !!bloomPass });

// The live uniform objects, for the ?tune Post folder (a drag must be instant, not a rebuild).
export const postUniforms = () => (gradePass ? gradePass.material.uniforms : null);
export const bloomHandle = () => bloomPass;

// A colour pushed above 1.0 in LINEAR HDR so it clears the bloom threshold and actually glows. A SCALAR
// multiply on a linear colour is hue-preserving by construction (D9) — that is the whole reason the FX
// retune is expressed as gains rather than as new hexes.
export const hdrColor = (hex, gain) => new THREE.Color(hex).multiplyScalar(gain);

// THE ONLY WAY FX CODE MAY READ AN HDR GAIN. On Performance (no composer, no tone mapping) this returns the
// plain colour: a >1 value would clamp per channel at the 8-bit sRGB write, flattening the FX AND shifting
// its hue (0xffb050 x 1.5 clips R and G but not B) — the two things this feature exists to remove (D18).
export const fxColor = (hex, key) => hdrColor(hex, postGain(!!G.gfx.post, POST_DEFAULTS.fxGain[key]));
