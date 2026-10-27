// Building a fight in Node: the catalog, the station, the ship, the World.
//
// `client/src/sim-core/` is the game's rules and is host-neutral by contract (its `boundary.test.js`
// enforces no `three`, no DOM, no `fetch`, no import outside the folder — and that every module actually
// loads in Node). What it does NOT provide is the setup a browser does for itself at boot: fetching the
// catalog from `/api`, building the player from the account's active ship, and placing the home station as
// part of the map's scenery. This module is that setup, done from the seed instead of over HTTP.
//
// Two callers, and they want the same World for different reasons:
//   • `server/tools/sim-replay.mjs` — the headless referee, replaying a recorded input trace;
//   • `server/src/netsim/room.js` — a live server-run mission instance.
// Sharing this is the point: a room and a referee that built their worlds differently would be two
// simulations again (docs/plans/server-authoritative-sim.md D1).
//
// The one thing worth stating plainly: **the home station is simulation state, not scenery.** Docking at it
// is one of the two ways a mission ends (`level-runner.checkArrival` → `canDock`; the "Finish and Return"
// button is the other, DECISIONS §132), so a headless World has to place it even though nothing here will
// ever draw it.
import { COMPONENTS, WEAPONS, SHIPS, LEVELS, MAPS } from './catalog_seed.js';
import { enemyTotalFromPhases } from './enemy_total.js';
import { createWorld, noopHost } from '../../client/src/sim-core/world.js';
import { catalogFromRows, shipById } from '../../client/src/sim-core/catalog.js';
import { makePlayer } from '../../client/src/sim-core/ship-entity.js';
import { clearAndPlaceRun, startRun } from '../../client/src/sim-core/reset-world.js';
import { seedSim } from '../../client/src/sim-core/sim-random.js';
import { Vec3 } from '../../client/src/sim-core/vec.js';
import { NO_FIGHT_SPEC, applyFightSpec, resolvePlayerBuild } from '../../client/src/sim-core/fight-spec.js';
import { BRAWL_LEVEL, BRAWL_SEED, spawnBrawl, clampBrawlN } from '../../client/src/sim-core/brawl.js';

// The catalog the client assembles from `/api` at boot (main.js), built here straight from the seed the
// server would have served — through the same `catalogFromRows`, ships id-ordered on both. Same shape,
// same keys — `world.catalog` is the only way the sim reaches it.
export function buildCatalog(levelName = 'level-0') {
  const catalog = catalogFromRows({ weapons: WEAPONS, components: COMPONENTS, ships: SHIPS });  // the ONE flatten (sim-core/catalog.js)
  const level = LEVELS.find((l) => l.name === levelName);
  if (!level) throw new Error(`no level "${levelName}" in catalog_seed.js`);
  // `enemyTotal` is stamped onto the descriptor by the server (enemy_total.js) before it is served, and the
  // simulation reads it — the milestone banners and the last-kill reward drop both key off it.
  catalog.level = { ...level.descriptor, enemyTotal: enemyTotalFromPhases(level.descriptor.phases) };
  catalog.levelName = level.name;
  return catalog;
}

// The home station, from the map descriptor. In the browser it arrives with the scenery; here it arrives
// on its own, with no mesh — same source of truth either way.
export function stationFor(mapName) {
  const map = MAPS.find((m) => m.name === mapName);
  const spec = (map && map.descriptor.setpieces || []).find((s) => s.type === 'base-station');
  if (!spec) return null;
  const [x, y, z] = spec.pos;
  return { pos: new Vec3(x, y, z), active: false };
}

// Build the exact ship a client (or a recording) is playing — id-only refs, so it is independent of any
// account row. An unknown `shipId` falls back to the catalog's player ship and its default loadout, which
// is what a trace recorded before those fields existed needs.
//
// `spec` is the FIGHT SPEC (`sim-core/fight-spec.js`): its ship half — `?beam`'s gun, `?duel`'s forced kit —
// is applied by the same `resolvePlayerBuild` the browser's ship builder and both recorders call.
export function buildShip(catalog, { shipId = null, loadout = null, components = null, skills = null } = {},
                          spec = NO_FIGHT_SPEC) {
  let ship = shipById(catalog, shipId);   // seed ids are explicit (= every DB's), so this really matches
  if (!ship) for (const s of catalog.shipByName.values()) if (s.type === 'player') { ship = s; break; }
  if (!ship) throw new Error('catalog carries no player ship');
  // The fight spec (`?beam`, `?duel`) is applied HERE, to the EFFECTIVE loadout, rather than to the account row
  // in socket.js.
  // The fallback is why: an account lookup that fails leaves `loadout` null and the room flies the catalog
  // default, and a swap applied upstream would have silently done nothing in exactly that case — the same
  // shape of bug this flag is being forwarded to fix. One place, one resolved loadout, no hole.
  //
  // AND ON THAT FALLBACK PATH THE MOUNTS ARE `ship.stats.mounts` — THE MODULE-LEVEL SEED ARRAY. `withBeamGun`
  // being non-mutating is therefore not a style preference here: mutating in place would rewrite the shared
  // catalog row and hand every later room in the process a beam-armed player. (Same trap as `withAllyAt`
  // and `withLancersAt` with a level's `phases`.)
  const effective = loadout || { mounts: ship.stats.mounts };
  // Skills change the ship — engine power, weapon damage, shield capacity, and (Maneuver) whether the
  // dodge roll DRAWS from the seeded stream at all. A run must therefore be re-simulated with the same
  // allocation it was played with, or it is a different fight. A live room takes them from the account
  // server-side, never from the client. (A duel clears them: `withDuelKit`.)
  return makePlayer(catalog, resolvePlayerBuild(
    { ship, loadout: effective, components: components || ship.components, skills }, spec));
}

// A World ready to be stepped: catalog resolved, station placed, ship built, seeded stream installed, the
// level script started. `host` defaults to `noopHost`; a room passes one that assigns network ids.
//
// The two-call reset is deliberate and mirrors the browser exactly (`clearAndPlaceRun` → the host's
// scenery → `startRun`); there is simply no scenery to rebuild in between here.
// `ally` — the name of the phase this fight's WINGMAN arrives on, or null. A room may be asked to run him
// (the ?ally dev flag today; Level 5's own descriptor tomorrow).
// `lancer` — the name of the phase whose spawn pool becomes 100% PIRATE LANCERS, or null (the ?lancer dev
// flag today; Level 5's own descriptor tomorrow).
// `beam` — mount the player's Charged beam (the ?beam dev flag). It has to be honoured HERE and not only in
// the browser: the room builds the authoritative player, so a client-only swap gave the two ends different
// weapons and drew an aiming sight over a ship that was firing a machine gun.
// `duel` — the `?duel` sparring room as `{ aces: N }`, or null. Rebuilt server-side so a duel trace can be
// re-simulated by the referee (docs/plans/2026-09-01-1845-duel-referee.md).
// The headless referee (`server/tools/sim-replay.mjs`) passes the whole spec the trace recorded
// (`fightSpecFromTrace`) — all null/false for a campaign trace, so a re-simulated campaign run is unchanged.
// `brawl` — the bot brawl's count per side (`?netbrawl=N`, a server-run room), or null. It forces the level
// to `BRAWL_LEVEL`, replaces the script with the inert brawl room, seeds `BRAWL_SEED` and spawns both teams
// UN-ARMED (the room arms the fight on the client's first input). It wins over `ally`, `lancer` and `duel`,
// which are ignored. The world is stepped with `brawlTick`, never `simTick` (room.js).
export function createSimWorld({ levelName = 'level-0', seed = 1, ship = {}, host = noopHost, ally = null,
                                 lancer = null, beam = false, duel = null, brawl = null } = {}) {
  if (brawl) levelName = BRAWL_LEVEL;
  const catalog = buildCatalog(levelName);
  // The FIGHT SPEC, applied by the same two sim-core functions the browser uses, in the same one order
  // (`sim-core/fight-spec.js`: brawl replaces everything; else ally, lancer, duel last). Both COPY —
  // `buildCatalog` shares the seed's `phases` array (see that module's header).
  const spec = { ally, lancer, beam: !!beam, duel, brawl };
  catalog.level = applyFightSpec(catalog.level, spec);
  const world = createWorld({ host });
  world.catalog = catalog;
  world.station = stationFor(catalog.level.map);
  world.player = buildShip(catalog, ship || {}, spec);
  // The account record the simulation itself consults: `ownsReward` reads it to decide whether the
  // last-kill reward drop should appear at all (you never get a second copy). Left null it always dropped.
  world.activeShip = ship.activeShip || null;
  seedSim(seed);
  clearAndPlaceRun(world);
  startRun(world);
  // The brawl spawns from its own fixed seed, after the run has started — the order the browser uses
  // (`brawl-host.js startBrawl`: reset(), then seedSim + spawnBrawl).
  if (brawl) { seedSim(BRAWL_SEED); spawnBrawl(world, clampBrawlN(brawl)); }
  return world;
}
