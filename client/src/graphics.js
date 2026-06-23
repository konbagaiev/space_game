// Graphics quality tiers. Pure data + persistence (no THREE/DOM) so it's testable and can be read
// BEFORE the renderer is constructed (antialias is a WebGLRenderer constructor arg). See
// docs/plans/performance-quality-tiers.md and DECISIONS §23.
export const GRAPHICS_STORAGE_KEY = 'gfxTier';
export const GRAPHICS_DEFAULT = 'high';

// Each tier's knobs. pixelRatioCap + antialias drive fragment cost (the mobile bottleneck — fill rate,
// not draw calls/triangles); starScale/particleScale thin the additive overdraw. Starting points —
// tune on a real low-end phone.
export const TIERS = {
  high:        { label: 'High',        pixelRatioCap: 2,   antialias: true,  starScale: 1.0,  particleScale: 1.0 },
  balance:     { label: 'Balance',     pixelRatioCap: 1.5, antialias: false, starScale: 0.6,  particleScale: 0.6 },
  performance: { label: 'Performance', pixelRatioCap: 1,   antialias: false, starScale: 0.35, particleScale: 0.4 },
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
