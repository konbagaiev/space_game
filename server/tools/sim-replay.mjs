// The headless referee: replay an input trace through `sim-core` in Node, with no browser anywhere.
//
// This was the first time the game's rules ran outside a tab, and it is the whole point of the sim-core
// refactor. Two payoffs, one now and one later:
//   • NOW — the divergence oracle. The same trace is replayed here and in a real browser and the two must
//     agree on a digest of the final world AND on how many seeded RNG draws they consumed
//     (`client/visual/scenarios/36-sim-divergence.mjs`). That is the standing proof that "one simulation,
//     two hosts" is true rather than aspirational (plan D1), and it is what keeps the browser path honest
//     now that a server path exists beside it.
//   • LATER — sealing the economy. `POST /api/games` is client-authoritative today; the client already
//     records every session as an input trace, so the server can re-simulate a submitted trace with
//     exactly this code and decide the reward itself. That is a separate slice; this is its machinery.
//
// The World it replays into is built by `server/src/sim-host.js` — the SAME factory a live netsim room
// uses, on purpose: a referee and a room that set their worlds up differently would be two simulations
// again.
//
// Usage:
//   node server/tools/sim-replay.mjs <trace.json> [--ticks N] [--json]
//
// The trace format is documented in client/src/replay.js (`makeTrace`): input + seed, never positions.
// See docs/plans/server-authoritative-sim.md (Slice C).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSimWorld } from '../src/sim-host.js';
import { simTick } from '../../client/src/sim-core/tick.js';
import { worldDigest } from '../../client/src/sim-core/digest.js';
import { hydrateTrace, traceLevelName, applyInput } from '../../client/src/replay.js';

// Re-exported because the referee's own tests assert on them, and because "what catalog/station did this
// run use" is part of reading a replay result.
export { buildCatalog, stationFor } from '../src/sim-host.js';

// Replay `trace` to the end (or to `maxTicks`) and return the digest plus how it finished.
// `onTick(world, i)` is an escape hatch for tests that need to look mid-run.
export function runTrace(trace, { maxTicks = Infinity, onTick = null } = {}) {
  const t = hydrateTrace(trace);
  const world = createSimWorld({
    levelName: traceLevelName(t),
    seed: t.seed,
    ship: { shipId: t.shipId, loadout: t.loadout, components: t.components },
  });

  const dt = t.dt;
  const ticks = t.ticks;
  const n = Math.min(ticks.length, maxTicks);
  let i = 0;
  for (; i < n; i++) {
    applyInput(ticks[i], world.input.keys, world.input.touchAim);
    simTick(world, dt);
    world.events.drain(() => {}); // a headless referee has nothing to do with them; a room broadcasts them
    if (onTick) onTick(world, i);
    if (!world.player.alive || world.levelRunner.won) { i++; break; }
  }
  return { world, ticksRun: i, ticksTotal: ticks.length, ...worldDigest(world) };
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node server/tools/sim-replay.mjs <trace.json> [--ticks N] [--json]');
    process.exit(2);
  }
  const tickArg = args.find((a) => a.startsWith('--ticks'));
  const maxTicks = tickArg ? Number(tickArg.split('=')[1] ?? args[args.indexOf(tickArg) + 1]) : Infinity;
  const trace = JSON.parse(readFileSync(file, 'utf8'));
  const r = runTrace(trace, { maxTicks });
  if (args.includes('--json')) {
    console.log(JSON.stringify({ hash: r.hash, draws: r.draws, ticksRun: r.ticksRun, ticksTotal: r.ticksTotal, ...r.summary }, null, 2));
  } else {
    const s = r.summary;
    console.log(`trace ${trace.id || '(unnamed)'} · level ${traceLevelName(trace)} · seed ${trace.seed} · dt ${trace.dt}`);
    console.log(`ticks ${r.ticksRun}/${r.ticksTotal}  kills ${s.kills}  credits ${s.earned}  xp ${s.earnedXp}  hp ${s.hp}`);
    console.log(`enemies ${s.enemies}  bullets ${s.bullets}  rockets ${s.rockets}  drops ${s.drops}  loot ${s.loot}`);
    console.log(`phase ${s.phase}  won ${s.won}  returning ${s.returning}`);
    console.log(`hash 0x${r.hash.toString(16)}  rng draws ${r.draws}`);
  }
}
