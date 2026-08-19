// Benchmark flag (?bench) — the deterministic replay perf gate (docs/plans/2026-07-04-0949-
// perf-benchmark-replay.md). Mirrors dev.js's sticky-flag discipline: a truthy ?bench=record / ?bench=replay
// turns the mode ON and remembers it in sessionStorage (so a reload keeps it); ?bench=off / =false clears it;
// no bench param → the stored value decides. Evaluated ONCE per page load and cached. Zero overhead when the
// flag is absent (same as ?dev). Nothing here touches the DOM at import, so it also loads under node (tests).
// The seeded RNG itself now lives in sim-random.js (OPT-IN per gameplay draw site, DECISIONS §73); this module
// only re-exports mulberry32 for back-compat and owns the fixed bench step.
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

// mulberry32 lives in sim-random.js (the seeded-stream owner); re-exported here so long-standing importers
// (bench.test.js, the bench tooling) keep working unchanged.
export { mulberry32 } from './sim-core/sim-random.js';

// The single tunable sim tick rate. ALL sim stepping — live play, ?record/?playback, ?bench, and the
// Level-0 cutscene — advances at this fixed step so a tick maps 1:1 across record and replay. The
// maintainer may lower this (e.g. 30) — it is not a twitch 3D shooter. Changing it changes every NEW
// recording's dt; old traces carry their own dt and still replay at the rate they were recorded.
export const TICK_HZ = 60;
export const BENCH_DT = 1 / TICK_HZ;   // kept as BENCH_DT so existing importers are unchanged
