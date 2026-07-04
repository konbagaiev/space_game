// Benchmark flag (?bench) + seeded RNG — the deterministic replay perf gate (docs/plans/2026-07-04-0949-
// perf-benchmark-replay.md). Mirrors dev.js's sticky-flag discipline: a truthy ?bench=record / ?bench=replay
// turns the mode ON and remembers it in sessionStorage (so a reload keeps it); ?bench=off / =false clears it;
// no bench param → the stored value decides. Evaluated ONCE per page load and cached. Zero overhead when the
// flag is absent (same as ?dev). Nothing here touches the DOM at import, so it also loads under node (tests).
const KEY = 'benchMode';

// Pure decision + storage side effect (unit-testable without a DOM). Returns 'record' | 'replay' | null.
export function evalBench(search, storage) {
  const params = new URLSearchParams(search || '');
  let mode = null; // tri-state override: 'record'/'replay' = force, 'off' = clear, null = no override
  if (params.has('bench')) {
    const v = params.get('bench');
    if (v === 'record' || v === 'replay') mode = v;
    else if (v === 'off' || v === 'false' || v === '0') mode = 'off';
    // any other value → leave mode null (fall back to stored)
  }
  try {
    if (mode === 'record' || mode === 'replay') { storage && storage.setItem(KEY, mode); return mode; }
    if (mode === 'off') { storage && storage.removeItem(KEY); return null; }
    const stored = storage && storage.getItem(KEY);
    return (stored === 'record' || stored === 'replay') ? stored : null;
  } catch { return (mode === 'record' || mode === 'replay') ? mode : null; } // storage blocked → honor the URL only
}

const _search = typeof location !== 'undefined' ? location.search : '';
const _storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
const BENCH = evalBench(_search, _storage);

// The active bench mode this load ('record' | 'replay') or null when off.
export function benchMode() { return BENCH; }
// True when either bench mode is on.
export function isBench() { return BENCH !== null; }

// mulberry32 — a tiny, fast, well-distributed 32-bit PRNG. Deterministic: the same seed reproduces the same
// sequence within a single JS build, which is exactly what the A/B replay needs (see plan §Determinism).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Replace Math.random with a seeded stream so the whole client-side sim is reproducible. Modules call
// Math.random() at call-time (they never cache the function reference), so a global override taken early is
// sufficient. Idempotent — call it again with the same seed to rewind to a clean stream.
export function installSeededRandom(seed) { Math.random = mulberry32(seed); }

// Fixed simulation step used in bench mode (60 fps). The sim already clamps dt to 0.05, so 1/60 is safe.
export const BENCH_DT = 1 / 60;
