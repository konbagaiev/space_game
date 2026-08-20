// Client-side prediction of the local ship (plan Slice E).
//
// In a room the ship you fly is drawn from snapshots, so it answers the controls a round trip late — about
// 250 ms measured locally, and every millisecond of it is felt, because the ship is the one thing whose
// motion the player is authoring rather than watching. Prediction removes that: the client runs the SAME
// `sim-core` step on its own copy the instant a key is held, and corrects it whenever the authority
// disagrees.
//
// The shape is deliberately the humblest one that is honest:
//
//   • A SHADOW WORLD holds nothing but the player. It has no enemies, no level script and no host, and its
//     events are drained and thrown away — it exists to answer one question, "where would my ship be", and
//     answering it needs none of that. Anything else the room decides (who was hit, what spawned, what was
//     collected) stays the room's, so there is nothing for the two to disagree about except the ship.
//   • It is stepped by `stepPlayer` — the real one, the same function the room runs. Predicting with a
//     second, simplified movement model is how prediction usually rots: the copy drifts from the authority
//     for reasons nobody can reproduce. Sharing the code is the entire point of `sim-core` existing.
//   • On every snapshot the shadow is RESET to the authoritative pose and the inputs the server has not yet
//     acknowledged are replayed on top. That is exactly what `replay.js` does — simulate from a state plus
//     a list of inputs — applied once per snapshot instead of once per session.
//
// What it deliberately does NOT predict: firing, damage, or anything about other entities. Those are the
// room's and are not the player's to author. Bullets fired locally are a separate slice.
import { createWorld, noopHost } from './sim-core/world.js';
import { makePlayer } from './sim-core/ship-entity.js';
import { stepPlayer } from './sim-core/step-player.js';
import { SIM_DT, BULLET_PLANE_Y } from './sim-core/consts.js';
import { applyInput } from './replay.js';

// How many unacknowledged input ticks will ever be replayed in one correction. At 60 Hz this is a second of
// input; past that the connection is in trouble and re-simulating a longer tail costs more than it buys.
export const MAX_REPLAY_TICKS = 60;

export function createPredictor(catalog, activeShip) {
  // A World with a player and nothing else. `noopHost` because a predicted ship needs no mesh — the drawn
  // ship is the real one in the real World; this is only a calculation.
  const world = createWorld({ host: noopHost });
  world.catalog = catalog;
  let player;
  try {
    player = makePlayer(catalog, {
      ship: activeShip.ship,
      loadout: activeShip.loadout || { mounts: activeShip.ship.stats.mounts },
      components: activeShip.components || activeShip.ship.components,
      // The room builds the ship from the SAME account record, skills included. A mismatch here would show
      // up as the prediction quietly disagreeing about acceleration or turn rate.
      skills: (activeShip.progression && activeShip.progression.skills) || null,
    });
  } catch { return null; } // an incomplete account record simply means no prediction, not a broken tab
  world.player = player;

  return {
    world,
    get pose() { return { x: player.pos.x, z: player.pos.z, h: player.heading }; },

    // Adopt the authority's view of the ship. Everything the step reads has to come across, not just the
    // transform: a shield or a repair drone that disagreed would make the copy drift for invisible reasons.
    reset(p, autopilot, arena) {
      player.pos.set(p.x, BULLET_PLANE_Y, p.z);
      player.vel.set(p.vx || 0, 0, p.vz || 0);
      player.heading = p.h;
      player.scale = p.sc;
      player.hp = p.hp; player.maxHp = p.maxHp;
      player._shieldValue = p.sh; player._shieldRechargeAccum = p.shr || 0;
      player.alive = p.alive;
      player.oobTime = p.oob || 0;
      if (arena) world.arenaCenter.set(arena.x, 0, arena.z);
      // The autopilot flies the ship, so a prediction that ignored it would fight the server the whole way
      // home. Only its shape matters here; the room owns the target itself.
      world.autopilot.active = !!(autopilot && autopilot.active);
      world.autopilot.phase = (autopilot && autopilot.phase) || 'brake0';
      world.autopilot.target = null; // no local target to fly to — see `predictable` below
    },

    // One tick of the player's own input. Projectiles and events are discarded: this World is not showing
    // anyone anything.
    step(tick) {
      applyInput({ k: tick.k, t: tick.a }, world.input.keys, world.input.touchAim);
      stepPlayer(world, SIM_DT);
      world.bullets.length = 0; world.rockets.length = 0;
      world.events.clear();
    },

    // Prediction is only honest while the ship is under the player's own control. An engaged autopilot is
    // flying toward a target this World does not have, and a dead ship is not being authored at all — in
    // both cases the snapshot is the better answer and the caller should use it directly.
    predictable(autopilot, alive) { return !!alive && !(autopilot && autopilot.active); },
  };
}
