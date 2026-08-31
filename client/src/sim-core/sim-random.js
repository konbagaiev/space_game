// The SEEDED SIM RNG — the single source of randomness for GAMEPLAY draws (spawn timing, spawn positions,
// which enemy spawns, enemy reload jitter, loot rolls). Deterministic input-replay (?record/?playback, the
// canonical Level-0 trace, the ?bench perf gate) reproduces a fight from (seed + per-tick input), which only
// works if the seeded stream is consumed by the SIM and by nothing else.
//
// This is OPT-IN by design (DECISIONS §73): cosmetic code — explosion sparks, exhaust, smoke, shield/flipbook
// /bolt FX, world decor + set-pieces — keeps calling plain Math.random and is therefore replay-NEUTRAL.
// The previous opt-out model (a seeded Math.random swapped in around update()/reset()) meant any FX or decor
// change silently shifted the stream and broke the recorded intro; it did, three times.
//
// RULE FOR NEW CODE: if a draw changes what the SIM does (positions, timing, damage, loot), call simRandom().
// If it only changes what the frame LOOKS like, call Math.random(). When in doubt: cosmetic.
//
// Imports NOTHING on purpose: the pure leaves that need it (drops-config.js, and sim.js's injection into
// spawn-timing.js) stay dependency-free and node-safe.

// mulberry32 — a tiny, fast, well-distributed 32-bit PRNG. Deterministic: the same seed reproduces the same
// sequence within a single JS build, which is exactly what record/playback and the A/B replay need.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = null; // null = live play (native Math.random); a function = a seeded record/playback/bench run.
// How many draws this run has taken. It is not a diagnostic curiosity: it is how a §73 violation is caught.
// Two hosts replaying the same trace must consume the seeded stream the SAME NUMBER OF TIMES; a cosmetic
// path that reached into simRandom() shows up here as a count mismatch long before it shows up as a desync
// somebody has to debug. Reset by seedSim, which is called exactly once per deterministic run.
let draws = 0;

// Install (or clear) the seeded stream. seedSim(n) → deterministic; seedSim(null) → back to native.
// Called at record start, at playback/intro arm, by the ?bench replayer, and cleared on teardown.
export function seedSim(seed) { rand = (seed == null) ? null : mulberry32(seed >>> 0); draws = 0; }

// One gameplay random in [0,1). Falls back to Math.random when no seed is installed (normal play).
export function simRandom() { draws++; return rand ? rand() : Math.random(); }

// Draws taken since the last seedSim(). Part of the browser↔Node divergence oracle (see sim-core/digest.js).
export function simRandomDraws() { return draws; }

// True while a seeded stream is installed (diagnostics / tests).
export function isSimSeeded() { return rand !== null; }
