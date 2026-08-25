// The pirate lancer's dev injection: what the `?lancer` flag does to a level descriptor.
//
// NON-MUTATING, and that is load-bearing: `buildCatalog` shallow-copies a level, so its `phases` array is
// SHARED with the module-level seed — mutating a phase in place would give every room in the process
// lancers. Do not "simplify" this to an assignment. (Same trap as withAllyAt.)
export const LANCER_SHIP_NAME = 'pirate lancer';
export const DEV_LANCER_DEFAULT_PHASE = 'wave-1'; // the FIRST wave, so a test flight meets one in seconds
// Two simultaneous 1-second telegraphs is a legible fight; five is a red lattice. Clamped, never raised.
export const DEV_LANCER_MAX_CONCURRENT = 2;

// Swap one phase's spawn POOL to 100% lancers and clamp its concurrency. `spawn.total` and `advanceWhen`
// are DELIBERATELY UNTOUCHED: `advanceWhen: { kills: N }` is CUMULATIVE kills (level-runner.js:270), so
// lowering a total below its phase's kill threshold hangs the level forever — and `enemyTotal` is the sum of
// every phase's total (server/src/enemy_total.js), which drives the HUD and the last-kill reward drop.
export function withLancersAt(level, phaseName) {
  if (!level || !Array.isArray(level.phases)) return level;
  let found = false;
  const phases = level.phases.map((ph) => {
    if (ph.name !== phaseName || !ph.spawn) return ph;
    found = true;
    return { ...ph, spawn: {
      ...ph.spawn,
      pool: [{ ship: LANCER_SHIP_NAME, chance: 100 }],
      maxConcurrent: Math.min(ph.spawn.maxConcurrent ?? DEV_LANCER_MAX_CONCURRENT, DEV_LANCER_MAX_CONCURRENT),
    } };
  });
  return found ? { ...level, phases } : level; // an unknown (or spawn-less) phase name changes nothing
}
