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
// `post` = the REAL POINT LIGHTS on engines, rockets in flight and explosion flashes (the THREE wiring is
// in engine-lights.js). `lights` is the size of the FIXED light pool, built once at boot: three bakes the
// light count into every lit material's shader as `#define NUM_POINT_LIGHTS n`, so the pool can never grow
// or shrink at runtime without recompiling every lit material (DECISIONS §83's stall). `?lights=N` overrides
// it for measurement.
// The ladder is MEASURED, not guessed — Redmi 15C / Mali-G52, 2026-08-31: 0 lights holds ~60 fps; 16 drops,
// worst ZOOMED IN at the station and mild once the station is small on screen. That shape is the tell: three
// evaluates every point light for every fragment of every lit material, so the cost tracks LIT PIXELS. Hence
// it is tiered by how much per-fragment lighting a device pays, and Performance pays none (`post: null`),
// which is the same conclusion §23 reached about weak phones: give them a clean off-path, not a smaller
// version of the expensive one. There is no post-processing chain of any kind — the frame is drawn straight
// to the canvas with its own MSAA and no tone mapping. See DECISIONS §138.
export const TIERS = {
  high:        { label: 'High',        pixelRatioCap: 2,   antialias: true,  starScale: 1.0,  particleScale: 1.0, envMap: true,  maxParticles: 640, enemyShieldBubbles: 6, nebulaBake: { cube: 1024, octaves: 6 }, post: { lights: 16 } },
  balance:     { label: 'Balance',     pixelRatioCap: 1.5, antialias: false, starScale: 0.6,  particleScale: 0.6, envMap: true,  maxParticles: 480, enemyShieldBubbles: 3, nebulaBake: { cube: 512,  octaves: 4 }, post: { lights: 4 } },
  performance: { label: 'Performance', pixelRatioCap: 1,   antialias: false, starScale: 0.35, particleScale: 0.4, envMap: false, maxParticles: 300,      enemyShieldBubbles: 0, nebulaBake: null,                       post: null },
};

// Shipped LOOK constants — pure data (the THREE wiring lives in world.js / ship-factory.js, the live sliders
// in tune.js). Starting points: the maintainer dials them in a real build via ?tune and the dialed numbers
// are pasted back here. See DECISIONS §138.
// (Named LOOK_ rather than POST_ since 2026-08-31: there is no post-processing left to name it after. The
// bloom/exposure/grade/vignette/HDR-gain blocks that used to live here were deleted with the glow overlay
// and the composer before it — with nothing to turn a >1 colour into light, a value above 1.0 only clips at
// the 8-bit sRGB write. FX colours are the authored ones again.)
export const LOOK_DEFAULTS = {
  // Ship emissive FLOOR — a self-lit minimum so a hull never goes fully black against the backdrop.
  // IT SHIPS AT 0, i.e. the floor is live but OFF: at 0.25 it flattened the hulls and killed their glint on
  // a real screen. The mechanism stays (ship-factory.js applyHullEmissiveFloor + floorMark/reFloor) because
  // it is the documented value hit-fx's hull flash RESTORES TO, and because turning it back on is a one-line
  // experiment. Whatever it is set to, it must stay a floor, not a light.
  hullEmissive: 0,
  // The parallax backdrop layer (world.js): a second, coarser nebula bake on an additive camera-tracking
  // sphere in front of the fixed cube. `amp` is its brightness and the backdrop CEILING knob — dialed down
  // from a planned 0.35 on a real frame, where the higher value put the sky right around the ship within
  // 1.6x of the lit hull; at 0.25 the layer still lifts the sky's mean luminance by ~26%, i.e. it is
  // unmistakably there. `follow` is how much of the camera's motion it copies (1 = a skybox, no parallax).
  backdrop: { amp: 0.25, follow: 0.94, offsetMax: 250, radius: 900 },
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
