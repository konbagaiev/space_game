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
export const TIERS = {
  high:        { label: 'High',        pixelRatioCap: 2,   antialias: true,  starScale: 1.0,  particleScale: 1.0, envMap: true,  maxParticles: 640, enemyShieldBubbles: 6, nebulaBake: { cube: 1024, octaves: 6 } },
  balance:     { label: 'Balance',     pixelRatioCap: 1.5, antialias: false, starScale: 0.6,  particleScale: 0.6, envMap: true,  maxParticles: 480, enemyShieldBubbles: 3, nebulaBake: { cube: 512,  octaves: 4 } },
  performance: { label: 'Performance', pixelRatioCap: 1,   antialias: false, starScale: 0.35, particleScale: 0.4, envMap: false, maxParticles: 300,      enemyShieldBubbles: 0, nebulaBake: null },
};
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
