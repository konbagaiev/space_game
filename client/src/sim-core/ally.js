// Building the Sentinel wingman and putting him in the World.
//
// He is a THIRD party in the fight: not the player, not an enemy. Enemies target him, hostile fire hits
// him, his kills advance the mission — and he pays the player nothing (docs/plans/combat-ally.md §2.5).
// His flying lives in `step-ally.js`; this is only what he IS and how he arrives.
import { makePlayer } from './ship-entity.js';
import { BULLET_PLANE_Y } from './consts.js';
import { headingToDir } from './steering.js';
import { ALLY_SHIP_NAME, ALLY_COMPONENTS, ALLY_MOUNTS, ALLY_COLOR, ALLY_ARRIVE_BEHIND, ALLY_WARP_SEC } from './ally-config.js';

// The ally's NUMBERS — no randomness, no position. He is built through makePlayer, not makeEnemyShell:
// he carries REAL components (a 200 HP hull, a repair drone, a catalog shield) rather than an enemy's
// derived 1/3-shield split, and the player ship row's fire groups already carry the `ai` rules
// (gun: range 45 / aimTol 0.25, rocket: range 80 / aimTol 0.40) his fire rule reads.
// Draws NOTHING from the seeded stream — see the RNG guarantee in the plan/DECISIONS §73.
// Takes the catalog, not the World, because the netsim client builds this same shell from a wire descriptor.
// THE HULL BOTH SENTINEL PILOTS FLY. Split out of `makeAlly` for the DUEL ROOM's ace (`ace.js`), which is
// the same ship with the same gear pointed the other way: one build, so re-arming the wingman re-arms the
// thing you spar against and the two can never quietly drift into different fights. It sets everything that
// is true of the SHIP and nothing that is true of a SIDE — no `isAlly`, no colour, no target bookkeeping.
export function makeSentinelHull(catalog) {
  const shipDef = catalog.shipByName.get(ALLY_SHIP_NAME);
  if (!shipDef) return null;
  const a = makePlayer(catalog, {
    ship: shipDef,
    loadout: { mounts: ALLY_MOUNTS },
    components: ALLY_COMPONENTS,
    skills: null,           // no skills → dodge 0 → a hostile hit never rolls the seeded stream
  });
  a.name = shipDef.name;
  a.radius = 2.6 * (a.sizeScale || 1); // health-bar/minimap anchor (makePlayer has no `radius`; enemies do)
  a.target = null;          // the ship he is charging
  a.passArmed = false;      // the current target is BEHIND him: the re-search (and the retreat check) are armed
  a.retreating = false;     // opening the gap so the drone can work
  a.intercept = null;       // the incoming ROCKET he is shooting down (point defence, step-ally.js 4d)
  a.thrusting = false;
  return a;
}

export function makeAlly(catalog) {
  const a = makeSentinelHull(catalog);
  if (!a) return null;
  a.color = ALLY_COLOR;     // the livery: one number against the same .glb (§2 "already free")
  a.isAlly = true;
  // (`target` / `passArmed` / `retreating` / `thrusting` are the shared hull's — see makeSentinelHull. The
  //  retreat opens the gap to the nearest ENEMY (ALLY_BREAK_OFF_DIST) so the drone can work; he is STILL a
  //  valid enemy target while he does it.)
  return a;
}

// Arrive. Called from the level runner when a phase carries `ally: true`; refuses a second one.
export function spawnAlly(world) {
  if (world.allies.length) return null;
  const a = makeAlly(world.catalog);
  if (!a) return null;
  // Behind the player's nose, so he warps in astern and flies past — deterministic, no RNG.
  const p = world.player, d = headingToDir(p.heading);
  a.pos.set(p.pos.x - d.x * ALLY_ARRIVE_BEHIND, BULLET_PLANE_Y, p.pos.z - d.z * ALLY_ARRIVE_BEHIND);
  a.heading = p.heading;
  a.spawnAge = 0; a.spawnDur = ALLY_WARP_SEC; a.warping = true; a.scale = a.fullScale * 0.001;
  world.allies.push(a);
  world.host.onSpawn('ally', a);
  return a;
}
