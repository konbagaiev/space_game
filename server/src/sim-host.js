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
// is how a mission is won (`level-runner.checkArrival` → `canDock`), so a headless World has to place it
// even though nothing here will ever draw it.
import { COMPONENTS, WEAPONS, SHIPS, LEVELS, MAPS } from './catalog_seed.js';
import { enemyTotalFromPhases } from './enemy_total.js';
import { createWorld, noopHost } from '../../client/src/sim-core/world.js';
import { makePlayer } from '../../client/src/sim-core/ship-entity.js';
import { clearAndPlaceRun, startRun } from '../../client/src/sim-core/reset-world.js';
import { seedSim } from '../../client/src/sim-core/sim-random.js';
import { Vec3 } from '../../client/src/sim-core/vec.js';

// The catalog the client assembles from `/api` at boot (main.js), built here straight from the seed the
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
export function buildShip(catalog, { shipId = null, loadout = null, components = null, skills = null } = {}) {
  let ship = null;
  for (const s of catalog.shipByName.values()) if (s.id === shipId) { ship = s; break; }
  if (!ship) for (const s of catalog.shipByName.values()) if (s.type === 'player') { ship = s; break; }
  if (!ship) throw new Error('catalog carries no player ship');
  return makePlayer(catalog, {
    ship,
    loadout: loadout || { mounts: ship.stats.mounts },
    components: components || ship.components,
    // Skills change the ship — engine power, weapon damage, shield capacity, and (Maneuver) whether the
    // dodge roll DRAWS from the seeded stream at all. A run must therefore be re-simulated with the same
    // allocation it was played with, or it is a different fight. A live room takes them from the account
    // server-side, never from the client.
    skills,
  });
}

// A World ready to be stepped: catalog resolved, station placed, ship built, seeded stream installed, the
// level script started. `host` defaults to `noopHost`; a room passes one that assigns network ids.
//
// The two-call reset is deliberate and mirrors the browser exactly (`clearAndPlaceRun` → the host's
// scenery → `startRun`); there is simply no scenery to rebuild in between here.
export function createSimWorld({ levelName = 'level-0', seed = 1, ship = {}, host = noopHost } = {}) {
  const catalog = buildCatalog(levelName);
  const world = createWorld({ host });
  world.catalog = catalog;
  world.station = stationFor(catalog.level.map);
  world.player = buildShip(catalog, ship);
  // The account record the simulation itself consults: `ownsReward` reads it to decide whether the
  // last-kill reward drop should appear at all (you never get a second copy). Left null it always dropped.
  world.activeShip = ship.activeShip || null;
  seedSim(seed);
  clearAndPlaceRun(world);
  startRun(world);
  return world;
}
