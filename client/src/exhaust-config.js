// Pure, THREE-free seams for the shared exhaust FX (exhaust-fx.js). Kept in a separate module so the
// config merge / fade / palette / hash invariants are unit-testable under `node --test` (which cannot
// resolve the browser importmap's `three`). Same split pattern as ghost-battle-track.js ↔ ghost-battle.js.
//
// REPLAY SAFETY: `hash()` is the ONLY randomness source for the plume — a deterministic sin-based hash
// (like flipbook-fx.js), NOT Math.random and NOT simRandom. The exhaust never touches the seeded sim
// stream, so recorded replays/intro are byte-identical before/after this FX (DECISIONS §73).

// Shipped defaults for the FREIGHTER plume (paste ?dev-tuned values here to change the default look).
// Freighter reads `spec.exhaust` merged over these (plumeCfg).
export const EXHAUST_DEFAULTS = {
  mode: 'points',            // 'points' (a, silhouette-preserving glow points) | 'flame' (b, noise-scroll)
  count: 90, len: 48, size: 5, speed: 1.4, spread: 3,
  palette: { hot: 0xfff1c0, mid: 0xff7a2a, end: 0x7a1208 },
  turbulence: 0.4,           // lateral wobble amount (0 = laminar)
  softness: 1.0,             // glow edge / alpha falloff multiplier
};

// Shipped defaults for the per-SHIP engine plume (smaller than the freighter; palette is derived from the
// engine's single exhaust color at attach time, so these palette entries are placeholders).
export const SHIP_DEFAULTS = {
  count: 24, len: 6, size: 3, speed: 1.6, spread: 0.6,
  palette: { hot: 0xffffff, mid: 0xff8030, end: 0x401004 },
  turbulence: 0.5,
  softness: 1.0,
};

// Cheap stable pseudo-hash in [0,1) — seeds per-particle attributes deterministically (NOT sim RNG).
// Same shape as flipbook-fx.js's hash: identical inputs → identical output, always in [0,1).
export function hash(a, b = 0, c = 0) {
  const s = Math.sin(a * 12.9898 + b * 0.017 + c * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Merge a set-piece `spec.exhaust` over the module defaults. Missing keys fall back to defaults; provided
// keys override; the nested `palette` merges per-key (so a spec that sets only `palette.hot` keeps the
// default mid/end). Pure — no mutation of the inputs.
export function plumeCfg(spec, defaults = EXHAUST_DEFAULTS) {
  const ex = (spec && spec.exhaust) || {};
  const pal = ex.palette || {};
  return {
    ...defaults,
    ...ex,
    palette: { ...defaults.palette, ...pal },
  };
}

// Smoothed throttle fade: lerp `cur` toward `target` at a fixed rate (dt*8, capped at 1 so a huge dt can't
// overshoot). Ships set target=1 on thrusting frames and 0 otherwise, so the plume rises fast then decays.
// Clamped ≥ 0 so it never goes negative.
export function decayThrottle(cur, target, dt) {
  const next = cur + (target - cur) * Math.min(1, dt * 8);
  return next < 0 ? 0 : next;
}

// Derive a 3-stop hot→mid→end palette from a single engine exhaust color: mid === the input color, hot a
// brightened version, end a darkened version — so the shared shader path (built for the freighter's
// 3-color gradient) works unchanged for ships that only carry one color.
export function derivePalette(color) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const bright = (c) => Math.min(255, Math.round(c * 1.4 + 40));
  const dark = (c) => Math.round(c * 0.35);
  const pack = (rr, gg, bb) => (rr << 16) | (gg << 8) | bb;
  return {
    hot: pack(bright(r), bright(g), bright(b)),
    mid: color,
    end: pack(dark(r), dark(g), dark(b)),
  };
}
