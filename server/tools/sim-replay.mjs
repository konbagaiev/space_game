// The headless referee: replay an input trace through `sim-core` in Node, with no browser anywhere.
//
// This is the first time the game's rules run outside a tab, and it is the whole point of the sim-core
// refactor. Two payoffs, one now and one later:
//   • NOW — the divergence oracle. The same trace is replayed here and in a real browser and the two must
//     agree on a digest of the final world AND on how many seeded RNG draws they consumed. That is the
//     standing proof that "one simulation, two hosts" is true rather than aspirational (plan D1), and it is
//     what will keep the browser path honest once a server path exists beside it.
//   • LATER — sealing the economy. `POST /api/games` is client-authoritative today; the client already
//     records every session as an input trace, so the server can re-simulate a submitted trace with exactly
//     this code and decide the reward itself. That is a separate slice; this is its machinery.
//
// Usage:
//   node server/tools/sim-replay.mjs <trace.json> [--ticks N] [--json]
//
// The trace format is documented in client/src/replay.js (`makeTrace`): input + seed, never positions.
// See docs/plans/server-authoritative-sim.md (Slice C).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPONENTS, WEAPONS, SHIPS, LEVELS, MAPS } from '../src/catalog_seed.js';
import { enemyTotalFromPhases } from '../src/enemy_total.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = path.join(here, '..', '..', 'client', 'src');
// sim-core is client-side code by location and host-neutral by contract (boundary.test.js enforces it), so
// Node imports it from where it lives rather than duplicating it.
const simCore = (m) => import(path.join(clientSrc, 'sim-core', m));

const { createWorld, noopHost } = await simCore('world.js');
const { makePlayer } = await simCore('ship-entity.js');
const { clearAndPlaceRun, startRun } = await simCore('reset-world.js');
const { simTick } = await simCore('tick.js');
const { seedSim } = await simCore('sim-random.js');
const { worldDigest } = await simCore('digest.js');
const { Vec3 } = await simCore('vec.js');
const { hydrateTrace, traceLevelName, applyInput } = await import(path.join(clientSrc, 'replay.js'));

// The catalog the client assembles from /api at boot (main.js), built here straight from the seed the
// server would have served. Same shape, same keys — `world.catalog` is the only way the sim reaches it.
export function buildCatalog(levelName = 'level-0') {
  const catalog = { weapons: new Map(), components: new Map(), enemyShips: [], shipByName: new Map(), level: null, levelName: null };
  for (const w of WEAPONS) {
    catalog.weapons.set(w.id, {
      id: w.id, name: w.name, type: w.type, price: w.price,
      modelUrl: w.modelUrl, modelUrlHigh: w.modelUrlHigh, rarity: w.rarity, color: w.color, ...w.stats,
    });
  }
  for (const c of COMPONENTS) catalog.components.set(c.id, c);
  catalog.enemyShips = SHIPS.filter((s) => s.type === 'enemy');
  for (const s of SHIPS) catalog.shipByName.set(s.name, s);
  const level = LEVELS.find((l) => l.name === levelName);
  if (!level) throw new Error(`no level "${levelName}" in catalog_seed.js`);
  // `enemyTotal` is stamped onto the descriptor by the server (enemy_total.js) before it is served, and the
  // simulation reads it — the milestone banners and the last-kill reward drop both key off it.
  catalog.level = { ...level.descriptor, enemyTotal: enemyTotalFromPhases(level.descriptor.phases) };
  catalog.levelName = level.name;
  return catalog;
}

// The home station is a MAP set-piece, so in the browser it arrives with the scenery. It is also simulation
// state — docking at it is how a mission is won — so a headless run has to place it too. Same source of
// truth (the map descriptor), just no mesh.
export function stationFor(mapName) {
  const map = MAPS.find((m) => m.name === mapName);
  const spec = (map && map.descriptor.setpieces || []).find((s) => s.type === 'base-station');
  if (!spec) return null;
  const [x, y, z] = spec.pos;
  return { pos: new Vec3(x, y, z), active: false };
}

// Build the exact ship the trace was recorded with — id-only refs, so it is independent of any account.
// `shipId: null` (or an unknown id) falls back to the catalog's player ship and its default loadout, which
// is what a trace made before the fields existed needs.
function playerFor(catalog, trace) {
  let ship = null;
  for (const s of catalog.shipByName.values()) if (s.id === trace.shipId) { ship = s; break; }
  if (!ship) for (const s of catalog.shipByName.values()) if (s.type === 'player') { ship = s; break; }
  if (!ship) throw new Error('catalog carries no player ship');
  return makePlayer(catalog, {
    ship,
    loadout: trace.loadout || { mounts: ship.stats.mounts },
    components: trace.components || ship.components,
    skills: null, // a recording reproduces the ship it was MADE with; skills are never replayed (§73)
  });
}

// Replay `trace` to the end (or to `maxTicks`) and return the digest plus how it finished.
// `onTick(world, i)` is an escape hatch for tests that need to look mid-run.
export function runTrace(trace, { maxTicks = Infinity, onTick = null } = {}) {
  const t = hydrateTrace(trace);
  const catalog = buildCatalog(traceLevelName(t));
  const world = createWorld({ host: noopHost });
  world.catalog = catalog;
  world.station = stationFor(catalog.level.map);

  world.player = playerFor(catalog, t);
  seedSim(t.seed);              // the deterministic stream, from tick zero — and it zeroes the draw counter
  clearAndPlaceRun(world);      // (no scenery to rebuild between the two here — that is the browser's half)
  startRun(world);

  const dt = t.dt;
  const ticks = t.ticks;
  const n = Math.min(ticks.length, maxTicks);
  let i = 0;
  for (; i < n; i++) {
    applyInput(ticks[i], world.input.keys, world.input.touchAim);
    simTick(world, dt);
    world.events.drain(() => {}); // a headless referee has nothing to do with them; a room would broadcast
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
