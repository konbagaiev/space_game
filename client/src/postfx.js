// Post-processing: the "expensive look" render path.
//
// THE FRAME IS DRAWN STRAIGHT TO THE CANVAS, EXACTLY AS IT ALWAYS WAS. The historical two-pass sequence
// (clear -> sky -> clearDepth -> combat) writes to the default framebuffer on EVERY tier, with the canvas's
// own native MSAA (`WebGLRenderer({ antialias })`) and no tone mapping. Glow is then composited ON TOP as an
// ADDITIVE OVERLAY: only the objects on the GLOW LAYER are re-rendered into a small offscreen buffer, that
// buffer is thresholded and blurred, and the result is added back over the finished image.
//
// THIS IS A PIVOT AWAY FROM A FULL-FRAME EffectComposer, and it was forced by measurement, not taste
// (DECISIONS §138 "the pivot" + §138(l)). Two findings drove it:
//
//   • On the maintainer's machine (macOS Chrome, ANGLE Metal, Apple M1 Pro, WebGL2, MAX_SAMPLES 4) a
//     MULTISAMPLED render target inside a composer, combined with UnrealBloomPass, renders the frame ~90-100%
//     BLACK. No GL error; RGBA16F reports 4-sample support. 240-frame controlled runs, one variable each:
//         bloomScale 0.5, samples 0  ->   0.0% of the frame black
//         bloomScale 1.0, samples 0  ->   0.0% black       (bloomScale is not involved)
//         bloomScale 0.5, samples 4  -> 100.0% black
//         bloomScale 1.0, samples 4  ->  90-94% black
//         samples 4, bloom pass OFF  ->   0.1% black       (it needs BOTH msaa and the bloom pass)
//     Moving the MSAA onto the scene pass's own target and resolving into a plain buffer did not help (93%
//     black); forcing a framebuffer unbind between passes did not help.
//   • So a composer on this hardware cannot have MSAA — but routing the frame through one is exactly what
//     THREW AWAY the free MSAA the canvas already had. Before this feature there was no aliasing problem and
//     no black artifact. Supersampling was tried as a replacement and rejected: it buys back at 2.25x the
//     fill what used to cost nothing.
//
// Consequences, all deliberate:
//   • NO ACES / EXPOSURE / GRADE / VIGNETTE. There is no full-frame pass to put them in, and the lighting
//     was authored for direct sRGB output — ACES (which multiplies by exposure/0.6 = a 1.67x lift) was also
//     what over-exposed the station and the ships. `renderer.toneMapping` stays NoToneMapping, now simply
//     because nothing ever sets it.
//   • NO AA PASS of any kind. AA is the canvas's again, as it was before this feature (D5 is void).
//   • The `post` tier knob survives but gates THE OVERLAY: Performance is `post: null` and gets today's exact
//     frame, and every HDR gain above 1.0 is still read through `postGain`/`fxColor` (D18) because those
//     gains only make sense where something turns >1 light into glow.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { scene, skyScene, camera, renderer, onResize, gameW, gameH, sun, combatAmbient } from './engine.js';
import { G } from './state.js';
import { POST_DEFAULTS, postGain } from './graphics.js';
import { GLOW_LAYER, markGlow } from './glow-layer.js';

// ---------- shaders ----------
const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Separable 5-tap gaussian (linear-sampled offsets), optionally high-passing on the way in. `uHighPass`
// switches the threshold on for the FIRST pass only — folding it into the blur saves a whole extra
// full-screen pass over the glow buffer.
//
// The threshold is measured on the LINEAR Rec.601 luma, the same quantity three's own LuminosityHighPass
// uses, so DECISIONS §138(d)'s dust arithmetic still reads the same way even though the dust is no longer
// on the glow layer at all.
const BLUR_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uDir;              // (1,0) horizontal, (0,1) vertical, pre-multiplied by the texel size
  uniform float uThreshold, uKnee, uHighPass;
  varying vec2 vUv;
  vec3 tap(vec2 uv) {
    vec3 c = max(texture2D(tDiffuse, uv).rgb, 0.0);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    // A SOFT knee, not a hard cut: a hard threshold makes the glow pop in and out as a source fades, which
    // reads as flicker on a decaying explosion.
    float k = mix(1.0, smoothstep(uThreshold, uThreshold + uKnee, l), uHighPass);
    return c * k;
  }
  void main() {
    vec3 s  = tap(vUv) * 0.2270270270;
    s += (tap(vUv + uDir * 1.3846153846) + tap(vUv - uDir * 1.3846153846)) * 0.3162162162;
    s += (tap(vUv + uDir * 3.2307692308) + tap(vUv - uDir * 3.2307692308)) * 0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }
`;

// The composite. The glow buffer is LINEAR; the canvas already holds an sRGB-ENCODED image, so the glow is
// encoded before it is added — otherwise a linear value added onto an encoded frame reads far too dim.
// Additive, no depth: it can only ever ADD light to the finished frame, never occlude or dim any of it.
const COMPOSITE_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    vec3 c = max(texture2D(tDiffuse, vUv).rgb, 0.0) * uStrength;
    c = mix(c * 12.92, 1.055 * pow(c, vec3(0.41666666)) - 0.055, step(vec3(0.0031308), c));
    gl_FragColor = vec4(max(c, 0.0), 1.0);
  }
`;

// ---------- state ----------
let overlay = null;          // null on Performance (and if construction ever fails) — see renderFrame
const _clear = new THREE.Color();
const BLACK = new THREE.Color(0, 0, 0);

// The live look knobs, shared with the ?tune "Post" folder and with the visual scenario. Mutated in place so
// a slider drag is felt on the next frame with no rebuild.
// `?glow=0` silences the overlay from the URL. Needed to judge the real-point-light fork (engine-lights.js)
// on its own: with the overlay running, its halo is what you see, and no amount of real light changes that.
function glowFromUrl(dflt) {
  try {
    const n = Number.parseFloat(new URLSearchParams(window.location.search).get('glow') ?? '');
    return Number.isFinite(n) && n >= 0 ? n : dflt;
  } catch { return dflt; }
}

const glow = {
  strength: glowFromUrl(POST_DEFAULTS.bloom.strength),
  radius: POST_DEFAULTS.bloom.radius,
  threshold: POST_DEFAULTS.bloom.threshold,
  knee: POST_DEFAULTS.bloom.knee,
};

function makeRT(w, h) {
  // HalfFloat is a HARD requirement (D4): the whole point of the glow buffer is that a source lifted above
  // 1.0 in linear HDR (fxColor / exhaustGain) survives long enough to be thresholded. An 8-bit buffer would
  // clamp every one of them to 1.0 first and the threshold would stop distinguishing anything.
  // No depth and no stencil: the glow sources are additive and unordered — depth would cost bandwidth and
  // buy nothing (see the note in renderGlow about the one lit case).
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

function createOverlay() {
  const post = G.gfx.post;
  if (!post || !post.bloom) return;      // Performance tier: no overlay at all (D6)
  const scale = post.glowScale;
  const dpr = renderer.getPixelRatio();
  const w = Math.max(8, Math.round(gameW() * dpr * scale));
  const h = Math.max(8, Math.round(gameH() * dpr * scale));
  const glowRT = makeRT(w, h);                                   // the glow-layer objects, at `scale`
  const blurA = makeRT(Math.max(4, w >> 1), Math.max(4, h >> 1)); // …thresholded + blurred at half of that
  const blurB = makeRT(Math.max(4, w >> 1), Math.max(4, h >> 1));
  glowRT.texture.name = 'glow.sources';
  blurA.texture.name = 'glow.blurA';
  blurB.texture.name = 'glow.blurB';

  const blurMat = () => new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() },
      uThreshold: { value: glow.threshold }, uKnee: { value: glow.knee }, uHighPass: { value: 0 },
    },
    vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const compositeMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: blurB.texture }, uStrength: { value: glow.strength } },
    vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG,
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
  });
  const quad = new FullScreenQuad(compositeMat);

  overlay = { scale, glowRT, blurA, blurB, blur: blurMat(), composite: compositeMat, quad };
  sizeOverlay(gameW(), gameH());

  // THE COMBAT LIGHTS JOIN THE LAYER, and this is not cosmetic. A hull on the glow layer (it goes there for
  // the 0.12 s of a hit flash — see hit-fx.js) is a MeshStandardMaterial, and three keys its shader programs
  // on the LIGHT COUNT: rendering the same material in a pass with zero lights would compile a second
  // program variant on the first hit — precisely the first-draw recompile hitch `warmModel` exists to
  // prevent. Marking the two combat lights keeps the glow pass's light state identical to the base pass's,
  // so no new variant is ever needed. It has no other effect: a light still only lights objects that are
  // actually drawn, and nothing else is on the layer.
  markGlow(sun);
  markGlow(combatAmbient);

  onResize.push((w2, h2) => sizeOverlay(w2, h2));
}

function sizeOverlay(w, h) {
  if (!overlay) return;
  const dpr = renderer.getPixelRatio();
  const gw = Math.max(8, Math.round(w * dpr * overlay.scale));
  const gh = Math.max(8, Math.round(h * dpr * overlay.scale));
  overlay.glowRT.setSize(gw, gh);
  overlay.blurA.setSize(Math.max(4, gw >> 1), Math.max(4, gh >> 1));
  overlay.blurB.setSize(Math.max(4, gw >> 1), Math.max(4, gh >> 1));
}

createOverlay();

// One blur pass: `src` -> `dst`, along `dir`, at `step` blur-buffer texels.
function blurPass(src, dst, dirX, dirY, step, highPass) {
  const u = overlay.blur.uniforms;
  u.tDiffuse.value = src.texture;
  u.uDir.value.set(dirX * step / dst.width, dirY * step / dst.height);
  u.uThreshold.value = glow.threshold;
  u.uKnee.value = glow.knee;
  u.uHighPass.value = highPass ? 1 : 0;
  overlay.quad.material = overlay.blur;
  renderer.setRenderTarget(dst);
  overlay.quad.render(renderer);   // the quad covers every pixel with NoBlending — no clear needed
}

// The overlay itself. Runs AFTER the finished frame is already on the canvas.
function renderGlow() {
  if (!(glow.strength > 0)) return;      // strength 0 = off, and costs exactly nothing (the ?tune A/B)
  const { glowRT, blurA, blurB } = overlay;

  // --- 1. render ONLY the glow-layer objects, on black ---
  const savedMask = camera.layers.mask;
  renderer.getClearColor(_clear);
  const savedAlpha = renderer.getClearAlpha();
  camera.layers.set(GLOW_LAYER);         // mask = 1 << GLOW_LAYER: nothing else is drawn or even sorted
  renderer.setRenderTarget(glowRT);
  renderer.setClearColor(BLACK, 1);
  renderer.clear(true, false, false);
  // The sky scene first, for the star's corona and the bright-star layer. Its BACKGROUND (the baked nebula
  // cube) is drawn too — three's background box bypasses camera layers — and that is fine and deliberate:
  // the nebula's linear luma is far under the threshold, so the high-pass in the first blur pass removes it.
  // Nulling the background instead would set `needsUpdate` on three's background box material EVERY FRAME,
  // which is the same per-frame material churn D2 rejected `OutputPass` for.
  renderer.render(skyScene, camera);
  renderer.render(scene, camera);
  camera.layers.mask = savedMask;
  renderer.setClearColor(_clear, savedAlpha);

  // --- 2. threshold + blur: ONE level, two passes, and that is deliberate ---
  // The sources on this layer are ALREADY soft: the plume emitter and the FX sprites are radial-gradient
  // textures, i.e. pre-blurred blobs. Stacking a multi-level blur chain on top of them was softening what
  // was already soft — the live result was "пятно слишком большое" plus stripes, because the extra
  // eighth-resolution level held each source in ~2 texels where the 5-tap kernel combs instead of smearing.
  // Removing that level fixed both at once and made the pass cheaper. If a WIDER glow is ever wanted, widen
  // the SOURCE (the emitter sprite / the FX texture), do not add levels back.
  // THE KERNEL IS 5 TAPS AT +/-1.385 AND +/-3.231 *STEPS*, and that one fact caused every glow artifact this
  // feature shipped and then fixed. Those taps integrate into a smooth smear only while (a) the step keeps
  // them on adjacent texels and (b) the source is more than a texel or two wide. Break either and each tap
  // reproduces the source instead of blurring it — five copies, and since the last pass of a level is
  // vertical, they read as VERTICAL STRIPES in the source's own colour. Both halves were hit live:
  //   • widening the second iteration to step 2.6 put the taps +/-3.6 and +/-8.4 texels apart;
  //   • then shrinking the plume emitter to dim it put the source UNDER a texel — dimming by size, not by
  //     `strength`, which is why brightness and size are separate knobs and must stay that way.
  // Hence step < ~0.8 (POST_DEFAULTS.bloom.radius) and a source sized in exhaust-fx.js's `emitterBase`.
  blurPass(glowRT, blurA, 1, 0, glow.radius, true);
  blurPass(blurA, blurB, 0, 1, glow.radius, false);

  // --- 3. add it over the finished canvas ---
  overlay.composite.uniforms.tDiffuse.value = blurB.texture;
  overlay.composite.uniforms.uStrength.value = glow.strength;
  overlay.quad.material = overlay.composite;
  renderer.setRenderTarget(null);
  overlay.quad.render(renderer);
}

// THE single frame entry point — used by BOTH main.js animate() and the ?bench fullFrame, so the two can
// never drift apart (the bench must measure the real frame, overlay included).
export function renderFrame() {
  renderer.info.reset();
  // The historical frame, unchanged, straight to the canvas: two passes, native canvas MSAA, no tone
  // mapping, nothing read back. This is byte-for-byte the sequence that shipped before this feature, and it
  // is the same on every tier — DECISIONS §5's two-scene lighting invariant.
  renderer.clear();
  renderer.render(skyScene, camera);   // pass 1: the sky, with its own light
  renderer.clearDepth();
  renderer.render(scene, camera);      // pass 2: combat on top
  if (overlay) renderGlow();           // and the glow, added over it
}

// The overlay's own state, for the ?debug hook (main.js __game.postfx) and 43-expensive-look. "No page
// errors" is NOT a liveness check — it is equally true when createOverlay() threw and the frame silently
// fell back to the bare two-pass path. This is.
export const postStatus = () => ({
  active: !!overlay, bloom: !!overlay,
  scale: overlay ? overlay.scale : null,
  strength: glow.strength, threshold: glow.threshold, radius: glow.radius,
});

// GL ground truth for the render path, read from the context rather than from the constructor arguments —
// the whole point is to catch the case where what we asked for is not what we got. `canvasSamples` is the
// number this pivot exists to protect: the frame is drawn to the DEFAULT framebuffer, so on High it must be
// > 1 (the canvas's own MSAA) instead of the 0 a composer target reported.
export function postTargets() {
  const gl = renderer.getContext();
  const size = renderer.getSize(new THREE.Vector2());
  const out = {
    dpr: renderer.getPixelRatio(),
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    rendererSize: [size.x, size.y],
    currentTarget: renderer.getRenderTarget() ? 'rt' : 'canvas',
    canvasSamples: gl.getParameter(gl.SAMPLES),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    toneMapping: renderer.toneMapping,
    overlay: null,
  };
  if (overlay) {
    out.overlay = {
      scale: overlay.scale,
      glow: [overlay.glowRT.width, overlay.glowRT.height],
      blur: [overlay.blurA.width, overlay.blurA.height],
    };
  }
  return out;
}

// The live knob object for the ?tune "Post" folder and the ?debug hooks (a drag must be instant).
export const glowParams = () => glow;

// A colour pushed above 1.0 in LINEAR HDR so it clears the glow threshold and actually blooms. A SCALAR
// multiply on a linear colour is hue-preserving by construction (D9) — that is the whole reason the FX
// retune is expressed as gains rather than as new hexes. The gain survives the pivot because the GLOW BUFFER
// is still HDR: it is where a >1 source stays >1 long enough to be thresholded.
export const hdrColor = (hex, gain) => new THREE.Color(hex).multiplyScalar(gain);

// THE ONLY WAY FX CODE MAY READ AN HDR GAIN (D18). With no overlay there is nothing that turns >1 light into
// glow, and the value would only clamp per channel at the 8-bit sRGB write — a flat white patch AND a hue
// shift (0xffb050 x 1.5 clips R and G but not B). So on Performance every gain resolves to exactly 1.0 and
// the FX are byte-identical to before this change.
export const fxColor = (hex, key) => hdrColor(hex, postGain(!!G.gfx.post, POST_DEFAULTS.fxGain[key]));
