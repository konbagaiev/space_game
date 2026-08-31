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
// `post` = the additive GLOW OVERLAY (the THREE wiring is in postfx.js). The frame itself is drawn straight
// to the canvas on every tier — there is no full-frame chain and no offscreen composite of the base image —
// so `post` gates only the extra pass that re-renders the GLOW LAYER small, blurs it and adds it back.
// `glowScale` is that buffer's size as a fraction of the canvas. It is tiered by PASS COUNT rather than by
// resolution for exactly the reason above: the lever that protects a weak phone is `post: null` on
// Performance — no overlay at all, 6 fewer draw submits per frame and today's exact image. Balance keeps the
// overlay at a smaller `glowScale`, which saves FILL (the *less* important axis per §23); if a live phone
// test shows Balance losing frames, the correct follow-up is moving Balance to `post: null`, NOT shrinking
// the glow buffer further. See DECISIONS §138.
export const TIERS = {
  high:        { label: 'High',        pixelRatioCap: 2,   antialias: true,  starScale: 1.0,  particleScale: 1.0, envMap: true,  maxParticles: 640, enemyShieldBubbles: 6, nebulaBake: { cube: 1024, octaves: 6 }, post: { bloom: true, glowScale: 0.50, lights: 16 } },
  balance:     { label: 'Balance',     pixelRatioCap: 1.5, antialias: false, starScale: 0.6,  particleScale: 0.6, envMap: true,  maxParticles: 480, enemyShieldBubbles: 3, nebulaBake: { cube: 512,  octaves: 4 }, post: { bloom: true, glowScale: 0.35, lights: 4 } },
  performance: { label: 'Performance', pixelRatioCap: 1,   antialias: false, starScale: 0.35, particleScale: 0.4, envMap: false, maxParticles: 300,      enemyShieldBubbles: 0, nebulaBake: null,                       post: null },
};

// Post-processing look constants (pure data — the THREE wiring is in postfx.js, the live sliders in
// tune.js). These are STARTING POINTS: the maintainer dials them in a real build via ?tune and the dialed
// numbers are pasted back here. See DECISIONS §138.
export const POST_DEFAULTS = {
  // THE GLOW OVERLAY. `strength` scales the blurred glow as it is added over the finished frame; `radius` is
  // the blur step in glow-buffer texels (one H/V iteration; the sources are already soft, see postfx.js);
  // `threshold` is the LINEAR Rec.601 luma a glow-layer pixel must clear; `knee` is the
  // soft band above it (a hard cut makes a decaying explosion's glow pop in and out).
  // The threshold's historical justification is DECISIONS §138(d): it sits above the speed-field dust's
  // 0.6079 so the field can never turn into sparks (§96). Since the pivot that is belt-and-braces — the dust
  // is not on the glow layer at all — but the margin is still asserted, because a re-tint that brightens the
  // dust should fail a test rather than quietly rely on the layer.
  // strength HALVED from 1.0 on live feedback: at 1.0 the ship flew inside its own glow spot instead of
  // being lit by it.
  // `radius` is the blur STEP in glow-buffer texels. Below ~0.8 the kernel's five taps overlap, which is what
  // makes a small source smear instead of repeating itself; above it they separate and a compact source
  // combs. Brightness lives in `strength`, never in the size of a source; WIDTH lives in the source texture,
  // not in extra blur levels (postfx.js renderGlow says why there is only one).
  bloom: { strength: 0.5, radius: 0.7, threshold: 0.65, knee: 0.25 },
  // Ship emissive FLOOR — deliberately far BELOW the glow threshold, so a hull is never a standing light
  // source. (A hull DOES glow while it is being hit: hit-fx's flash drives the same emissive to white at
  // intensity 1.6 AND puts the hull on the glow layer for 0.12 s. That is the intended read — a hit is a
  // light, a hull is not. See DECISIONS §137 + §138.)
  hullEmissive: 0,
  // The two gain blocks below are >1 on purpose: they push a source above 1.0 in LINEAR HDR so it clears the
  // glow threshold in the (HalfFloat) glow buffer. They are VALID ONLY WITH THE OVERLAY — read them through
  // postGain() (D18), never directly, or Performance clips them per channel and the hue shifts.
  exhaustGain: 1.6,      // plume uGain — pushes the engine core above 1.0 so it IS a glow source
  fxGain: { explosion: 1.5, muzzle: 1.6, ring: 1.2, bolt: 1.4 }, // scalar HDR multipliers (hue-preserving)
  // The parallax backdrop layer. `amp` is its brightness and is the backdrop CEILING knob: it was dialed
  // down from a planned 0.35 on a real frame, where the higher value put the sky right around the ship
  // within 1.6x of the lit hull; at 0.25 the layer still lifts the sky's mean luminance by ~26%, i.e. it is
  // unmistakably there. (Unrelated to the overlay — it ships on the same tiers as the nebula bake.)
  backdrop: { amp: 0.25, follow: 0.94, offsetMax: 250, radius: 900 },
};
export const BLOOM_DUST_MARGIN = 1.05; // threshold must clear the dust's linear luma by at least 5%

// THE ONLY WAY ANY CALLER MAY READ AN HDR GAIN (D18). Without the glow overlay nothing turns >1 light into
// glow, and the frame is written straight to an 8-bit sRGB canvas: a value above 1.0 then clamps PER
// CHANNEL — 0xffb050 x 1.5 clips R and G but not B, which is both a flat white patch AND a hue shift, the
// two things this feature exists to avoid. `hasPost` is `!!G.gfx.post`.
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
