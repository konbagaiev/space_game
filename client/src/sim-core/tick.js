// One tick of a fight — the whole of it, and nothing else.
//
// This is the module a server runs. Give it a World and a timestep and it advances the fight: the ship
// under whatever input the World is carrying, the enemies, the projectiles, the deaths, the Grab, and the
// level script's spawning. It draws nothing, plays nothing and talks to nobody — everything it decided is
// on `world.events` for the host to drain.
//
// CALL ORDER IS THE EXECUTION ORDER. It has been reordered exactly once, deliberately (the presentation
// half was lifted out wholesale), and it must not be shuffled casually: the deaths run after the
// projectiles that caused them, the level script spawns after the deaths that free its slots, and the
// player's death check is last so the tick it dies on is complete. A reorder is a behaviour change wearing
// tidying-up's clothes; the intro replay's tick count is the thing that catches it.
//
// See docs/plans/server-authoritative-sim.md (Slice B3d/C).
import { stepPlayer, stepPlayerDeath } from './step-player.js';
import { stepEnemyAI, stepEnemyDeaths } from './step-enemies.js';
import { stepBullets, stepRockets } from './step-projectiles.js';
import { stepDrops } from './drops-sim.js';
import { updateLevelRunner } from './level-runner.js';

// Returns whatever the Grab is currently pulling (or null) — the one piece of this the host wants back,
// because the pull beam is drawn around it. Presentation only; nothing in the sim reads it.
export function simTick(world, dt) {
  world.combatElapsed += dt; // unpaused combat clock (skipped while paused) — drives the enemy hold-fire grace

  // Read ONCE, before the steps: the tick on which the ship dies must complete normally (that is the tick
  // that fires the explosion and the death event). From the next one the fight winds down — a dead ship
  // does not fly or fire even with a key held, and the level stops sending more enemies at a wreck.
  const alive = world.player.alive;

  if (alive) stepPlayer(world, dt); // repair/shield, control or autopilot, speed cap, arena drift + soft boundary, firing
  stepEnemyAI(world, dt);           // …which cuts the engines and holds fire once the player is gone
  stepBullets(world, dt);
  stepRockets(world, dt);
  stepEnemyDeaths(world);
  const grabTarget = stepDrops(world, dt); // the Grab: arm, pull, collect (inert without a live player)
  if (alive) updateLevelRunner(world, dt); // spawning + phase transitions from the active level
  stepPlayerDeath(world);
  return grabTarget;
}
