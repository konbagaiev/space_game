// Starting a run, the simulation half: empty the world, decide where the fight happens, put the ship on
// the line, zero the counters, and start the level script.
//
// `reset()` in sim.js used to do this AND rebuild the scene — pools disposed, set-pieces re-instantiated,
// the overlay hidden, telemetry sent. Those are two different jobs for two different hosts: a Node
// authority has to do everything below and none of the rest.
//
// IT IS TWO STEPS, AND THE HOST'S SCENERY REBUILD GOES BETWEEN THEM. That is not a stylistic split, it is
// the order the data demands, in both directions:
//   • the rebuild READS `arenaCenter` / `arenaDrift` — a drifting map pins its decor to the zone centre —
//     so `clearAndPlaceRun` must run first;
//   • the rebuild REPLACES `world.station`, because the home station IS a set-piece — so `startRun`, which
//     makes that station clickable for a roam, must run after, or it would arm an object that is about to
//     be thrown away. (A roam with an unclickable station is exactly the bug 32-star-system caught.)
// A headless authority has the same shape: it too has to place its station between the two calls.
//
// See docs/plans/server-authoritative-sim.md (Slice B3d).
import { runCenter } from './level-sim.js';
import { clearDrops } from './drops-sim.js';
import { startLevel, resetLevelRunnerState } from './level-runner.js';
import { BULLET_PLANE_Y, SPAWN_GROW_TIME } from './consts.js';
import { PLAYER_MAX_SPEED } from './step-player.js';

// Step 1: empty the fight and decide where the next one happens. Returns the run's centre `{ x, z }`,
// which the caller needs to place the arena marker and its set-pieces.
export function clearAndPlaceRun(world) {
  for (const b of world.bullets) world.host.onDespawn('bullet', b);
  world.bullets.length = 0;
  for (const r of world.rockets) world.host.onDespawn('rocket', r);
  world.rockets.length = 0;
  clearDrops(world); // release the crates AND DISCARD any uncollected/un-deposited loot on a fresh run
  world.events.clear(); // no events left over from an aborted tick (e.g. a win drained into a teardown)
  world.autopilot.active = false; world.autopilot.target = null; // defensive: no dangling drop-target autopilot

  for (const e of world.enemies) world.host.onDespawn('enemy', e);
  world.enemies.length = 0;
  // …and the friendly side that is not the player. A fresh run never inherits a wingman: he arrives again
  // only if the new level's phase script asks for one (docs/plans/combat-ally.md).
  for (const a of world.allies) world.host.onDespawn('ally', a);
  world.allies.length = 0;

  // Where this run fights: a side mission's own `center`, else the campaign level's (most use the default
  // (0,0); "Level 3" fights at the space factory, "Level 4" inside the far belt outpost).
  const { x: cx, z: cz } = runCenter(world.activeMission, world.catalog.level);
  world.arenaCenter.set(cx, 0, cz);       // fresh run: center the (possibly drifting) combat zone
  // a mission may drift its zone (the freighter escort); the campaign and other missions stay static
  world.arenaDrift = (world.activeMission && world.activeMission.drift)
    ? { x: world.activeMission.drift.x || 0, z: world.activeMission.drift.z || 0 } : null;

  return { x: cx, z: cz };
}

// Step 2: put the ship on the line, zero the run counters, and start the level script.
//
// `keepPlayer` — start the level WITHOUT moving the ship. Used when a mission begins because you FLEW to
// it: you are already at the fight, and yanking the ship to the arena centre would undo the trip you just
// made. Everything else about the run is still fresh (enemies, drops, counters, hp, the seeded stream).
export function startRun(world, { keepPlayer = false } = {}) {
  const { x: cx, z: cz } = world.arenaCenter;
  // WHERE THE SHIP GOES. Three cases, and only one of them moves it:
  //   • roam (Take off) — you launch from your HOME STATION and fly to the mission yourself, so the spawn is
  //     the origin no matter where this level fights. Take off is never a teleport to the mission.
  //   • `keepPlayer` — the mission just started because you ARRIVED: leave the ship exactly where it is and
  //     let the enemies come to you. Heading and velocity are kept too, so the fight opens mid-flight
  //     instead of snapping you to a standstill facing +Z.
  //   • otherwise — a normal level start (retry, or a level that begins where you already are): centre it.
  const p = world.player;
  if (!keepPlayer) {
    const spawn = world.roam ? { x: 0, z: 0 } : { x: cx, z: cz };
    p.pos.set(spawn.x, BULLET_PLANE_Y, spawn.z);
    p.heading = 0;                                 // forward = +Z (forwardVec(0) = (0,0,1))
    p.vel.set(0, 0, PLAYER_MAX_SPEED * 0.1);       // open the fight already gliding forward at 10% of top speed (3 u/s)
  }
  p.hp = p.maxHp;
  p.oobTime = 0;                // fresh run: clear the out-of-bounds timer
  p.spawnAge = SPAWN_GROW_TIME; // and any in-progress warp-back animation (back to full size)
  p.scale = p.fullScale;        // and any in-progress warp shrink
  p._repairAccum = 0;           // fresh run: clear banked repair-drone time
  p._shieldValue = p.shield ? p.shield.capacity : 0; // fresh run: shield full & active
  p._shieldRechargeAccum = 0;
  for (const g of Object.values(p.groups)) { g.cooldown = 0; g.pending.length = 0; } // reset fire groups
  p.alive = true;

  world.earned = 0; world.earnedXp = 0; world.kills = 0; world.banked = false; // new run: reset session credits/XP + the bank-once guard (balance persists)
  world.enemyShieldRefills = 0; // diagnostic: completed enemy shield refills this run (replay triage)
  world.allyKills = 0;          // diagnostic: how many of this run's kills the wingman took
  world.combatElapsed = 0;      // fresh run: restart the enemy hold-fire grace clock

  // ROAM: no level (level = null → the runner's update() early-returns → NO spawns), but clear the SAME
  // shared return-to-base/win/banner state startLevel would (so a prior mission win's `won:true` can't
  // freeze the roaming ship). COMBAT: start the chosen mission / campaign level exactly as before.
  if (world.roam) {
    world.levelRunner.level = null; resetLevelRunnerState(world);
    // …and make the home station clickable for the whole roam, the way clearMission() does after the last
    // kill: while flying freely you can always click home to be flown back and offered a dock.
    if (world.station) world.station.active = true;
  } else {
    startLevel(world, world.activeMission || world.catalog.level); // a chosen side mission overrides the campaign level
  }
}
