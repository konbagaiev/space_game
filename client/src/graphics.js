// Graphics quality tiers. Pure data + persistence (no THREE/DOM) so it's testable and can be read
// BEFORE the renderer is constructed (antialias is a WebGLRenderer constructor arg). See
// docs/plans/performance-quality-tiers.md and DECISIONS §23.
export const GRAPHICS_STORAGE_KEY = 'gfxTier';
export const GRAPHICS_DEFAULT = 'high';

// Each tier's knobs. `pixelRatioCap` + `antialias` set the backbuffer resolution / AA;
// `starScale`/`particleScale` thin the additive overdraw; `maxParticles` is a hard ceiling on live
// particles. It was `Infinity` on High and Balance — an unbounded resource on the two tiers most people
// play, which one long firefight could push into the hundreds. Now finite everywhere and at or under the
// instanced pool's own capacity (`SMOKE_MAX` in projectiles.js), so the pool can never be asked to hold
// more than it has room for.
// additive particles (trail + sparks) — new emits skipped over budget — capping per-frame JS on the
// weakest phones (Infinity = off). Tuned on real low-end phones (see DECISIONS §23).
// `envMap` enables a PMREM environment so metallic ship surfaces show real reflections (premium look,
// one extra prefiltered-cubemap lookup per fragment) — off on Performance.
// `nebulaBake` = the one-time procedural-nebula skybox bake (cube-map size + fbm octaves); `null` on
// Performance means "keep the flat background color, no bake" so the weakest phones skip a 6-face shader
// bake hitch.
// `enemyShieldBubbles` = how many enemy shield-hit bubbles may be on screen at once (0 = the effect is off
// entirely and no bubble mesh is ever created; the HP-bar shield strip + the cyan hit flash still play).
// NOTE: a sub-1 `renderScale` knob was tried and REMOVED (2026-06-27) — measured on two GPUs (PowerVR
// GE8320, Mali-G52), a 5.5-7× backbuffer-pixel cut moved fps by *nothing* (the weak-device bottleneck is
// CPU draw-call submit + the GPU/compositor governor, NOT fragment fill rate), so it only blurred the
// image for no gain. Resolution levers are a dead end here; see DECISIONS §23.
// `post` = the post-processing chain (bloom + the ACES/grade/vignette pass; the THREE wiring is in
// postfx.js). It is tiered by PASS COUNT, not by resolution, for exactly the reason above: the only lever
// that protects a weak phone is `post: null` on Performance — no chain at all, ~14 fewer full-screen draw
// submits per frame. `bloomScale: 0.5` on Balance saves FILL, which §23 says is the *less* important axis;
// if a live phone test shows Balance losing frames, the correct follow-up is moving Balance to `post: null`,
// NOT shrinking the bloom further. (`nMips` is not configurable — UnrealBloomPass hardcodes 5 in r160 — so
// `bloomScale` is the only tunable, and Balance keeps all 5 mips.) See DECISIONS §137.
export const TIERS = {
  high:        { label: 'High',        pixelRatioCap: 2,   antialias: true,  starScale: 1.0,  particleScale: 1.0, envMap: true,  maxParticles: 640, enemyShieldBubbles: 6, nebulaBake: { cube: 1024, octaves: 6 }, post: { bloom: true, bloomScale: 1.0, samples: 4 } },
  balance:     { label: 'Balance',     pixelRatioCap: 1.5, antialias: false, starScale: 0.6,  particleScale: 0.6, envMap: true,  maxParticles: 480, enemyShieldBubbles: 3, nebulaBake: { cube: 512,  octaves: 4 }, post: { bloom: true, bloomScale: 0.5, samples: 0 } },
  performance: { label: 'Performance', pixelRatioCap: 1,   antialias: false, starScale: 0.35, particleScale: 0.4, envMap: false, maxParticles: 300,      enemyShieldBubbles: 0, nebulaBake: null,                       post: null },
};

// Post-processing look constants (pure data — the THREE wiring is in postfx.js, the live sliders in
// tune.js). These are STARTING POINTS: the maintainer dials them in a real build via ?tune and the dialed
// numbers are pasted back here. See DECISIONS §137.
export const POST_DEFAULTS = {
  // DIALED ON A REAL FRAME, not derived. The planned starting point (exposure 1.15, bloom 0.55/0.4) blew the
  // base station's white modules into featureless white blobs — its panel detail and hull lettering were gone
  // — which is the "hulls must not glow / the backdrop is not a bright wall" line this feature exists to
  // hold. At these values the same frame keeps its detail, the blacks get DEEPER than before the chain
  // (measured: p05 sRGB luma 0.126 -> 0.049 in open space) and the clipped-white share DROPS (>0.95 luma:
  // 1.44% -> 0.32% of the frame), which is the filmic curve doing its job instead of an exposure push.
  exposure: 1.0,         // three's ACES multiplies by exposure/0.6, so 1.0 is already a 1.67x lift
  bloom: { strength: 0.30, radius: 0.30, threshold: 0.65 }, // threshold MUST clear the dust — see BLOOM_DUST_MARGIN
  vignette: { strength: 0.35, softness: 0.6 },             // 0 strength = off
  grade: { gain: [1, 1, 1], saturation: 1.0 },             // IDENTITY by default (D9 hue lock)
  hullEmissive: 0.25,    // ship emissive floor — deliberately far BELOW bloom.threshold: hulls must not glow
  // The two gain blocks below are >1 on purpose: they push a source above 1.0 in LINEAR HDR so it clears
  // bloom.threshold. They are VALID ONLY WITH A COMPOSER — read them through postGain() (D18), never
  // directly, or Performance clips them per channel and the hue shifts.
  exhaustGain: 1.6,      // plume uGain — pushes the engine core above 1.0 so it IS a bloom source
  fxGain: { explosion: 1.5, muzzle: 1.6, ring: 1.2, bolt: 1.4 }, // scalar HDR multipliers (hue-preserving)
  // The parallax layer. `amp` is its brightness and is the backdrop CEILING knob: it was dialed down from a
  // planned 0.35 on a real frame, where the higher value put the sky right around the ship within 1.6x of the
  // lit hull (42-expensive-look asserts >= 1.5x); at 0.25 that margin is 1.9x and the layer still lifts the
  // sky's mean luminance by ~26%, i.e. it is unmistakably there.
  backdrop: { amp: 0.25, follow: 0.94, offsetMax: 250, radius: 900 },
};
export const BLOOM_DUST_MARGIN = 1.05; // threshold must clear the dust's linear luma by at least 5%

// THE ONLY WAY ANY CALLER MAY READ AN HDR GAIN (D18). Without a composer the frame is written straight to
// an 8-bit sRGB canvas with no tone mapping, so a value above 1.0 clamps PER CHANNEL: 0xffb050 x 1.5 clips
// R and G but not B, which is both a flat white patch AND a hue shift — the two things this feature exists
// to avoid. `hasPost` is `!!G.gfx.post`.
export const postGain = (hasPost, gain) => (hasPost ? gain : 1);
export const TIER_ORDER = ['high', 'balance', 'performance'];

// Resolve a tier name (anything unknown → default) to its knob object, with the name attached.
export function resolveTier(name) {
  const key = TIERS[name] ? name : GRAPHICS_DEFAULT;
  return { name: key, ...TIERS[key] };
}

// Load the saved tier name from a localStorage-like store; default if missing/garbage. On a touch
// device's FIRST run (no saved value) suggest 'balance' so a phone doesn't open in the heaviest mode.
export function loadTier(store, isTouch = false) {
  let saved = null;
  try { saved = store && store.getItem(GRAPHICS_STORAGE_KEY); } catch {}
  if (saved && TIERS[saved]) return saved;
  return isTouch ? 'balance' : GRAPHICS_DEFAULT;
}

// Persist a tier name (clamped to a known tier); returns the stored key.
export function saveTier(store, name) {
  const key = TIERS[name] ? name : GRAPHICS_DEFAULT;
  try { store && store.setItem(GRAPHICS_STORAGE_KEY, key); } catch {}
  return key;
}
