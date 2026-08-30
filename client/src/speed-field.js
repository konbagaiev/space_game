// The player-locked wrapping speed field — PURE math + defaults + ?dev tune persistence. No THREE, no DOM,
// so it loads under bare `node --test` (there is no jsdom here; pure modules are the testable surface, cf.
// ghost-battle-track.js sitting next to the THREE-bound ghost-battle.js). The THREE build, the per-frame
// entry point and the dev folder live in world.js (`makeSpeedField`/`updateSpeedField`/`buildSpeedFieldFolder`);
// the wrap is driven from the VIEW layer (`settleView` in sim.js), never from the deterministic tick.
//
// RNG CONTRACT: the one-time scatter takes an INJECTED `rng` and production passes the NATIVE `Math.random`
// — never `simRandom()`. Decor must stay out of the seeded GAMEPLAY stream, or a decor draw displaces the
// whole fight's values and desyncs the recorded intro (that is exactly how the .glb asteroid field broke it;
// DECISIONS §73). The per-frame wrap draws no randomness at all, so it is replay-neutral by construction.
//
// See docs/plans/2026-08-09-1410-player-locked-speed-field.md.

// Minimum wrap half-box: a recycled point must reappear where the player CANNOT SEE IT. Two DIFFERENT
// mechanisms cover the two ends of the depth stack (both worked at ZOOM_MAX = 3.5 x CAM_OFFSET; see the
// plan's "No pop-in" section). NOTE: THREE.Fog fogs on VIEW DEPTH (-mvPosition.z), NOT radial distance —
// with this near-top-down camera the two are very different, so do NOT re-derive this from fog.far.
//  - SHALLOW layers (y ~ -18..-90) never even reach fogNear (240): a point 620 out is only ~413 deep in
//    view space at max zoom-out. They are hidden by the FRUSTUM — the near layer's visible patch tops out
//    at |dx| ~ 459 / |dz| ~ 274 (fov 55 -> tan 0.5206 vertical, x 16:9 -> 0.9255 horizontal).
//  - DEEP layers (y ~ -220..-280) DO out-reach the frustum horizontally, but their view depth there is
//    >= 668 > fogFar (600), so they are fully fogged (at ZOOM_MAX the far layer effectively vanishes).
// 600 clears both with margin at aspect <= ~2.4; beyond that (ultra-wide) the SHALLOW layers' radius must
// grow. Asserted against the defaults in speed-field.test.js.
export const WRAP_SAFE_RADIUS = 600;

// Provisional shipped look — the maintainer dials these live in the ?dev "Speed field" folder and the
// dialed-in numbers are baked back into the map descriptor (server catalog_seed.js `speedField`).
// Layers are ordered near -> far; `depth`/`depthVar` sink each layer below the combat plane
// (point y = -(depth + rng()*depthVar)); `size` is in WORLD units (sizeAttenuation).
// Small, CRISP, rock-coloured specks — not white blobs. Two separate lessons are baked in here:
//  - the first pass was invisible (dark grey, soft star-glow sprite) — see the contrast floor below;
//  - the second pass was visible but wrong: big near-white haloes, and "there are no white blobs like that
//    in space". The fix for BOTH is the SPRITE, not the colour — the speed field now uses its own hard-edged
//    dot (`getSpeedDotTexture` in world.js) instead of the star layer's soft radial glow. A crisp sprite is
//    opaque across its whole face, so a 1-2 unit speck reads clearly at a natural rock tone; the glow sprite
//    averages ~25% alpha, which is why it had to be blown up and whitened to be seen at all.
export const SPEED_FIELD_DEFAULTS = {
  color: 0xd2ccc1, // warm rock grey, lit — brighter, but deliberately NOT white
  // Weighted toward the NEAR layer: the close specks are the ones that actually sweep past and sell speed,
  // the deep ones barely move and mostly add clutter. So density climbs as the layers come closer and the
  // far layers are thinned out, with every size pulled down to fine-grain.
  // Sizes are ~30% larger than the first shipped pass (0.8/1.3/2.0): SPEED READS VIA SIZE, never via glow.
  // The post chain's bloom threshold sits deliberately ABOVE this field's luma (see linearLuma601 below),
  // so the only lever left for "the specks sweep past faster" is how big they are.
  layers: [
    { count: 760, size: 1.04, radius: 620, depth: 10,  depthVar: 16, opacity: 1.00 },
    { count: 220, size: 1.69, radius: 620, depth: 90,  depthVar: 40, opacity: 0.95 },
    { count: 110, size: 2.6,  radius: 620, depth: 220, depthVar: 60, opacity: 0.82 },
  ],
};

// CONTRAST FLOOR — the first shipped values (grey 0x6b6f78, size 0.9-2.6, opacity 0.55-0.9) rendered a field
// that was geometrically perfect and LITERALLY INVISIBLE: composited over the map background (0x0a1624) a
// ~2.5px soft-gradient sprite in dark grey lands within a few percent of the background, and the live test
// came back "I see nothing". DECISIONS §4 already said what makes a ~1px point read: bigger + brighter +
// near-white. Density and pixel counts were reasoned about; CONTRAST was not. `contrastRatio` below turns
// that lesson into an assertion so no future re-tune can quietly sink back under the floor.
// This is a cheap PROXY, not a real visibility model — it ignores the sprite's alpha falloff and the point's
// on-screen size, which were the other two halves of the failure. The floor is therefore CALIBRATED FROM THE
// ESCAPED DEFECT rather than derived: the combination that shipped invisible (0x6b6f78 at opacity 0.55)
// scores 2.39, the corrected layers score 5.6-8.1, so 3.5 sits between them with margin on both sides.
// Treat a failure as "this will probably vanish — go look at a real frame", not as a precise threshold.
export const BG_LUMA = 0.055;          // perceived luminance of the map background 0x0a1624
export const MIN_CONTRAST = 3.5;       // a layer must be at least this many times brighter than the sky

// Perceived luminance (Rec. 709) of a layer as the player actually sees it: the tint, knocked down by the
// DIMMEST per-point brightness jitter (scatterColors' 0.55 floor) and by the layer's opacity.
export function layerLuma(colorHex, opacity, jitterFloor = 0.55) {
  const r = ((colorHex >> 16) & 255) / 255, g = ((colorHex >> 8) & 255) / 255, b = (colorHex & 255) / 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) * jitterFloor * opacity;
}
export function contrastRatio(colorHex, opacity) { return layerLuma(colorHex, opacity) / BG_LUMA; }

// sRGB 0..1 -> linear, per the sRGB transfer function three uses (ColorManagement).
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// LINEAR Rec.601 luma of a hex colour — the exact quantity three's LuminosityHighPassShader thresholds on
// (`dot(texel.rgb, vec3(0.299,0.587,0.114))` over linear HDR). This is what decides whether the dust glows:
// the bloom threshold must sit ABOVE this value or the field turns into sparks (DECISIONS §96 forbids that).
// NOT interchangeable with layerLuma() above, which is a perceptual sRGB proxy for the CONTRAST floor.
export function linearLuma601(hex) {
  const r = srgbToLinear(((hex >> 16) & 255) / 255);
  const g = srgbToLinear(((hex >> 8) & 255) / 255);
  const b = srgbToLinear((hex & 255) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Slider bounds for the ?dev folder AND the clamp applied to every descriptor/stored value. `radius` may be
// dialed BELOW WRAP_SAFE_RADIUS on purpose — exploring a tighter box is a legitimate live experiment; the
// panel labels the pop-in it causes rather than the code silently clamping it away.
export const SPEED_FIELD_RANGES = {
  count: [0, 1200], size: [0.2, 20], radius: [200, 1200],
  // `depth` reaches well NEGATIVE on purpose: y = -(depth + rng()*depthVar), so a negative depth lifts a
  // layer ABOVE the combat plane, between the camera and the ships. That is the strongest "particles flying
  // past" cue there is — screen speed scales as camOffset.y / (camOffset.y - y), so y=+40 is ~1.5x the ship's
  // apparent speed and y=+90 is ~3.4x, where the plane-level layers sit at ~1x. The shipped look stays
  // below-plane; this range exists so a foreground dust layer can be judged live in the ?dev panel.
  depth: [-110, 400], depthVar: [0, 160], opacity: [0.05, 1],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Wrap a delta into [-half, half). Handles arbitrarily large deltas in ONE step (a teleport/warp-back must
// not need many frames to settle).
export function wrapDelta(d, half) {
  const span = 2 * half;
  let m = (d + half) % span;
  if (m < 0) m += span;
  return m - half;
}

// Re-centre a layer's positions on (cx,cz): every point that fell outside the +-half box is translated by an
// EXACT multiple of the span (so the pattern never drifts). Writes ONLY the points that moved and returns how
// many coordinates were rewritten, so the caller can skip the GPU upload when nothing did (a stationary
// player uploads nothing). `y` is never touched — the wrap is XZ-only, layer depth is fixed.
export function wrapField(pos, cx, cz, half) {
  let moved = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const dx = pos[i] - cx;
    if (dx >= half || dx < -half) { pos[i] = cx + wrapDelta(dx, half); moved++; }
    const dz = pos[i + 2] - cz;
    if (dz >= half || dz < -half) { pos[i + 2] = cz + wrapDelta(dz, half); moved++; }
  }
  return moved;
}

// One layer's one-time scatter, centred on the ORIGIN (buildMap runs before the player has moved; the first
// settleView wraps everything into place on frame 1). Draws exactly 3 rng values per point (x, z, y).
// `rng` is injected for tests; production passes the NATIVE Math.random (see the RNG contract above).
export function scatterLayer(layer, rng = Math.random) {
  const { count, radius, depth, depthVar } = layer;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (rng() * 2 - 1) * radius;              // x in [-radius, radius)
    pos[i * 3 + 2] = (rng() * 2 - 1) * radius;              // z in [-radius, radius)
    pos[i * 3 + 1] = -(depth + rng() * depthVar);           // sunk below the combat plane
  }
  return pos;
}

// Per-point brightness jitter (vertexColors) so the field doesn't read as a uniform stipple: each point keeps
// the layer colour at 55-100% luminance. `rgb` is { r, g, b } in 0..1 (a THREE.Color works as-is). One rng
// draw per point, same injected-rng contract as scatterLayer.
export function scatterColors(layer, rgb, rng = Math.random) {
  const col = new Float32Array(layer.count * 3);
  for (let i = 0; i < layer.count; i++) {
    const b = 0.55 + rng() * 0.45;
    col[i * 3] = rgb.r * b; col[i * 3 + 1] = rgb.g * b; col[i * 3 + 2] = rgb.b * b;
  }
  return col;
}

// Fill a layer spec from the defaults per key and clamp every number into SPEED_FIELD_RANGES.
function normalizeLayer(src, def) {
  const out = {};
  for (const k of Object.keys(def)) {
    const v = Number(src && src[k]);
    const r = SPEED_FIELD_RANGES[k];
    out[k] = clamp(Number.isFinite(v) ? v : def[k], r[0], r[1]);
  }
  return out;
}

// Tolerate a descriptor with no/partial speedField (an old DB row, a map that omits it, a malformed stored
// tune): every missing key falls back to SPEED_FIELD_DEFAULTS and every number is clamped. A spec with its
// own layer list keeps that list's LENGTH (so a dev can drop to one layer); an absent/empty list -> defaults.
export function normalizeSpeedField(spec) {
  const D = SPEED_FIELD_DEFAULTS;
  const color = Number.isFinite(Number(spec && spec.color))
    ? clamp(Math.floor(Number(spec.color)), 0, 0xffffff) : D.color;
  const src = Array.isArray(spec && spec.layers) && spec.layers.length ? spec.layers : D.layers;
  const layers = src.map((l, i) => normalizeLayer(l, D.layers[i] || D.layers[D.layers.length - 1]));
  return { color, layers };
}

// ---- ?dev live-tune persistence (mirrors ghost-battle-track.js loadGhostTune/saveGhostTune): injected
// store, try/catch around it, everything clamped on read AND write. Dev-only — buildMap applies a stored
// tune only under isDev(), players always get the descriptor. ----
export const SPEED_TUNE_KEY = 'speedFieldTune';

export function loadSpeedTune(store, fallback) {
  try {
    const s = store && store.getItem(SPEED_TUNE_KEY);
    if (s) return normalizeSpeedField(JSON.parse(s));
  } catch { /* private mode / malformed JSON -> the passed default */ }
  return fallback;
}

export function saveSpeedTune(store, spec) {
  const c = normalizeSpeedField(spec);
  try { store && store.setItem(SPEED_TUNE_KEY, JSON.stringify(c)); } catch { /* private mode */ }
  return c;
}
