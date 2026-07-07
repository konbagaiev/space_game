// Deterministic generator for the canonical bench trace (docs/plans/2026-07-04-0949-perf-benchmark-replay.md,
// Component 4). Writes client/bench/traces/combat-heavy.json — a scripted, load-pinned synthetic playthrough
// so the perf gate self-tests fully headlessly (no human play needed for v1). Re-running it reproduces
// byte-identical output; commit the JSON alongside this script.
//
// Run: cd client && node bench/gen-trace.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEED = 1234567;   // must match BENCH_SEED in client/src/main.js
const DT = 1 / 60;      // fixed step (60 fps) — record and replay must match
const WARMUP = 120;     // JIT/shader warmup ticks excluded from timing
const TOTAL = 900;      // ~15 s of simulated combat

// Scripted input: hold thrust + fire the whole time; every 80 ticks weave in a short left- then right-turn
// burst — enough steering + sustained fire to exercise projectiles / collisions / FX. Deterministic by index.
const ticks = [];
for (let i = 0; i < TOTAL; i++) {
  const k = ['KeyW', 'Space']; // thrust forward + fire
  const phase = i % 80;
  if (phase < 8) k.push('KeyA');            // left-turn burst
  else if (phase >= 40 && phase < 48) k.push('KeyD'); // right-turn burst
  ticks.push({ k, t: null });
}

const trace = {
  version: 1,
  name: 'combat-heavy',
  seed: SEED,
  dt: DT,
  warmupTicks: WARMUP,
  ticks,
  setup: {
    shipId: 1,                                 // fixed player ship (not account-dependent)
    spawns: [{ atTick: 0, count: 6 }],         // initial enemy wave
    maintainEnemies: 6,                        // LOAD-PIN: respawn to hold 6 enemies each tick
  },
};

const outDir = path.join(__dirname, 'traces');
const outFile = path.join(outDir, 'combat-heavy.json');
await mkdir(outDir, { recursive: true });
await writeFile(outFile, JSON.stringify(trace, null, 2) + '\n');
console.log(`wrote ${path.relative(path.join(__dirname, '..'), outFile)} (${ticks.length} ticks, seed ${SEED})`);
