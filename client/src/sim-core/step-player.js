// The player half of a tick: regen, control (by hand or by autopilot), the speed cap, the drifting arena
// and its soft boundary, and firing.
//
// This is the most feel-critical code in the game and the rules it encodes are all load-bearing:
//   • S/↓ is a BRAKE, never a reverse — a kinematic symmetric decel that stops at 0 and cannot flip the
//     direction (DECISIONS §113). The autopilot brakes with exactly the same step.
//   • ANY control input cancels an engaged autopilot, immediately (DECISIONS §39).
//   • The flat top speed is a REPLAY INVARIANT: a replay reproduces recorded INPUT, so every input-driven
//     leg must clamp exactly as recorded. The two legs that are not input-driven — roam cruise and the
//     return-to-base dock — run uncapped, which is what `capLifted` decides.
//   • The soft boundary (DECISIONS §2) warns, then warps back, and is measured from the (possibly
//     drifting) arena centre — not from the origin.
//
// Everything here takes the World, so the same step advances a fight in a browser tab and in Node.
// See docs/plans/server-authoritative-sim.md (Slice B3d).
import { Vec3 } from './vec.js';
import { repairTick, shieldRecharge } from './components.js';
import { headingToDir, shortestAngleDelta, steerToward, keyboardThrust } from './steering.js';
import { updateGroups } from './ship-entity.js';
import { capLifted, arrivedAtPoint, ARRIVE_RADIUS } from './system-map.js';
import { stepMissionZone, MISSION_ZONE_RADIUS } from './level-sim.js';
import { BASE_ARRIVE_RADIUS } from './autopilot-config.js';
import { ARENA, OOB_RETURN_TIME, BULLET_PLANE_Y, SPAWN_GROW_TIME } from './consts.js';
import { showBanner, clearBanner } from './events.js';

const IDLE_DRAG = 0.8;   // soft braking for the player when controls are released
// Flat top speed for the PLAYER only (world units/s). Enemies use their per-engine `maxSpeed` instead.
// Applied after thrust, before position integration, on BOTH the manual and autopilot paths.
export const PLAYER_MAX_SPEED = 30;

export function forwardVec(heading) {
  // nose points in +Z when heading=0 (math lives in steering.js)
  const d = headingToDir(heading);
  return new Vec3(d.x, 0, d.z);
}

// ---------- Autopilot (return-to-base click-to-fly) ----------
// Kinematic symmetric-decel brake: bleed the velocity toward 0 at a constant rate equal to the ship's
// thrust `accel` (Decision 2 — the passive IDLE_DRAG is exponential and can't stop cleanly).
// Shared with the player's manual brake (S/↓ in stepPlayer) — it stops at 0 and never flips the
// direction, which is exactly the "no flying backwards" rule.
function brakeStep(world, accel, dt) {
  const v = world.player.vel, sp = v.length();
  if (sp <= 1e-4) { v.set(0, 0, 0); return; }
  const dec = Math.min(sp, accel * dt); // symmetric decel == thrust accel
  v.addScaledVector(v.clone().normalize(), -dec);
}

// Click-to-fly: brake to a stop → rotate to face the station → accelerate at max → kinematic brake so the
// ship coasts to ~0 right at the station. `heading` convention matches forwardVec/touchAim: desired = atan2(dx, dz).
// Arrival isn't handled here — `checkArrival()` (level-runner.js) ends the mission ONLY while the autopilot
// is engaged, so a manual or cancelled approach never completes it. Since DECISIONS §132 docking is one of
// TWO ways to finish (the "Finish and Return" button is the other); both run `completeMission`.
// Resolve the autopilot's current world-space goal. Returns null if the target vanished (drop collected
// by the passive Grab, drops cleared on reset) → the caller cancels the autopilot.
function autopilotTargetPos(world) {
  const tgt = world.autopilot.target;
  if (!tgt) return null;
  if (tgt.kind === 'station') return world.station ? world.station.pos : null;
  // kind === 'point': a fixed world coordinate (roam navigation / system-map destination)
  if (tgt.kind === 'point') return tgt.pos || null;
  // kind === 'drop': valid only while the drop object is still in the live drops[] array
  return (tgt.drop && world.drops.includes(tgt.drop)) ? tgt.drop.pos : null;
}

function autopilotControl(world, dt, accel, turn) {
  const goal = autopilotTargetPos(world);
  if (!goal) { world.autopilot.active = false; world.autopilot.target = null; return; }
  const player = world.player;
  const pos = player.pos;
  const dx = goal.x - pos.x, dz = goal.z - pos.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  const ap = world.autopilot;

  if (ap.phase === 'brake0') {                    // 1) full stop first
    brakeStep(world, accel, dt);
    if (player.vel.length() < 0.5) ap.phase = 'rotate';
  } else if (ap.phase === 'rotate') {             // 2) rotate the nose to face the station
    player.heading = steerToward(player.heading, desired, turn * dt);
    brakeStep(world, accel, dt);                  // bleed any residual drift while turning
    if (Math.abs(shortestAngleDelta(player.heading, desired)) < 0.05) ap.phase = 'cruise';
  } else {                                        // 3/4) accelerate, then kinematic brake
    player.heading = steerToward(player.heading, desired, turn * dt);
    const speed = player.vel.length();
    const stopDist = (speed * speed) / (2 * accel);
    // TERMINAL BRAKE: once inside the arrive radius, stop chasing and just kill the speed. Without this the
    // ship keeps steering at a goal it is already on top of, overshoots, re-accelerates, and settles into a
    // ~10 u/s orbit around it — so an arrival predicate that waits for the ship to come to rest never fires
    // (a roam destination could never raise its prompt). Excluded for a DROP, whose own pickup radius owns
    // that endgame and whose trajectory is combat-tuned.
    if (ap.target.kind !== 'drop' && dist <= ARRIVE_RADIUS) {
      brakeStep(world, accel, dt);
    } else if (dist > stopDist + 0.5) {
      const fwd = forwardVec(player.heading);
      player.vel.addScaledVector(fwd, accel * dt);
      player.thrusting = true; // render consequence: syncMeshes drives the plume
    } else {
      brakeStep(world, accel, dt);
    }
  }
}

// Fly to the base station to dock. Valid in TWO out-of-combat states, and the difference matters:
//   • a CLEARED sector — arriving ends the mission (checkArrival/canDock), one of the two ways to (§132);
//   • roam — you took off for a free flight and clicked home; there is no mission to end, so arriving just
//     parks and offers to dock (checkStationArrival → the `baseArrival` event).
// Never during a live fight.
export function engageAutopilot(world) {
  const p = world.player;
  if (!p || !p.alive || world.levelRunner.won) return;
  if (!(world.returnToBase || world.roam)) return;
  engage(world, { kind: 'station' });
}
// Fly to a loot drop to grab it. Valid whenever a live drop is clicked — combat AND return-to-base.
export function engageDropAutopilot(world, drop) {
  const p = world.player;
  if (!p || !p.alive || world.levelRunner.won || !world.drops.includes(drop)) return;
  engage(world, { kind: 'drop', drop });
}
// Fly to a fixed world POINT (roam navigation / system-map destination). Allowed OUT OF COMBAT only
// (roam or return-to-base) — never during a live fight. `mission` is the offer id to prompt on arrival
// (or null for a plain point). enterRoam sets roam = true BEFORE calling this, so the gate passes.
export function engagePointAutopilot(world, pos, mission = null) {
  const p = world.player;
  if (!p || !p.alive || world.levelRunner.won) return;
  if (!(world.roam || world.returnToBase)) return;
  engage(world, { kind: 'point', pos: { x: pos.x, z: pos.z }, mission: mission || null });
}
function engage(world, target) {
  world.autopilot.active = true; world.autopilot.phase = 'brake0'; world.autopilot.target = target;
}
// Drop back to manual flight (roam nav buttons: clicking the destination you are already flying to cancels).
export function cancelAutopilot(world) { world.autopilot.active = false; world.autopilot.target = null; }

// A point autopilot never wins a mission by proximity (canDock only fires for kind:'station'). When it
// reaches ARRIVE_RADIUS and comes to rest, park the ship; if it carries a mission id, hand off to the
// arrival prompt (which no-ops for a locked/stale offer). Called from stepPlayer while autopilot is active.
function checkPointArrival(world) {
  const tgt = world.autopilot.target;
  if (!tgt || tgt.kind !== 'point') return;
  const pos = world.player.pos;
  if (!arrivedAtPoint(tgt.pos, { x: pos.x, z: pos.z }, ARRIVE_RADIUS)) return;
  if (world.player.vel.length() > 0.6) return; // wait until the kinematic brake has settled the ship
  const mission = tgt.mission;
  world.autopilot.active = false; world.autopilot.target = null; // park
  if (mission) world.events.emit({ type: 'missionArrival', missionId: mission });
}

// Reaching the base station WHILE ROAMING. The free-flight counterpart of checkArrival(): there is no
// mission to end here (levelRunner.returningToBase is false, so canDock/complete never runs), so the ship
// simply parks at the station and the host is asked whether to dock back into the hangar.
function checkStationArrival(world) {
  const tgt = world.autopilot.target;
  if (!world.roam || !tgt || tgt.kind !== 'station' || !world.station) return;
  const s = world.station.pos, pos = world.player.pos;
  if (Math.hypot(pos.x - s.x, pos.z - s.z) > BASE_ARRIVE_RADIUS) return;
  if (world.player.vel.length() > 0.6) return;   // let the terminal brake settle the ship first
  world.autopilot.active = false; world.autopilot.target = null; // park
  world.player.vel.set(0, 0, 0);                 // and hold station while the prompt is up
  world.events.emit({ type: 'baseArrival' });
}

// Flying into the ACTIVE campaign mission's neighbourhood while roaming. `world.missionZone` is set by the
// roam entry point (mainwindow.enterRoam) and is null unless the campaign is the active choice AND its level
// names a `center` — so the gating ("only when THAT mission is active") lives where `activeMissionId` is
// known, and this is pure geometry + a countdown. Reached however you got there: autopilot or hand-flown.
function checkMissionZone(world, dt) {
  const z = world.missionZone;
  if (!world.roam || !z || !world.player) return;
  // A countdown never runs while you are on your way somewhere ELSE. Picking a destination on the map is an
  // explicit "not now", and it has to be, because a level that fights at the origin puts its zone around the
  // base you take off from: without this, the first three seconds of every trip out into the system would
  // drop you into that level's fight instead, and the star system would be unreachable on four levels out of
  // five. A destination INSIDE the zone (the factory anchor is ~131 u from the Level 3 centre) is not
  // "somewhere else" — that trip is how you get to the mission, so it counts down on arrival as it should.
  // Docking counts too: clicking the home station asks to go INSIDE, and the station sits within the origin
  // zone, so without this the countdown would start the fight before the "Dock at the station?" prompt.
  const tgt = world.autopilot.active ? world.autopilot.target : null;
  const elsewhere = tgt && (tgt.kind === 'station'
    || (tgt.kind === 'point'
        && Math.hypot(tgt.pos.x - z.center.x, tgt.pos.z - z.center.z) > MISSION_ZONE_RADIUS));
  if (elsewhere) {
    if (z.t != null) clearBanner(world);
    z.t = null;
    return;
  }
  const p = world.player.pos;
  const r = stepMissionZone(z, { dist: Math.hypot(p.x - z.center.x, p.z - z.center.z), dt });
  const wasCounting = z.t != null;
  // The countdown is three seconds of nothing happening — spend them fetching and parsing what the fight is
  // about to need, so the moment it starts costs nothing. Without this the enemy models (and the last-kill
  // reward model) are pulled in by levelRunner.start() on the very frame the mission engages, which is felt
  // as a jerk. Once per arming; both preloads are idempotent caches.
  if (!wasCounting && r.t != null && !z.warmed) {
    z.warmed = true;
    const lvl = world.catalog.level;
    if (lvl) {
      world.host.onWarmLevel(lvl);
    }
  }
  if (r.t == null) z.warmed = false; // left the zone → warm again on the next approach (cheap: cached)
  z.t = r.t;
  if (r.t != null && !r.fire && r.t > 0) {
    // Re-armed every tick while the countdown runs, so it holds at full opacity instead of fading.
    // (The old `banner.life = banner.maxLife` nudge that used to follow is gone: showBanner only EMITS now,
    // so the nudge read the PREVIOUS banner's values — and the adapter sets life == maxLife on arrival
    // anyway, which is the invariant that line was reaching for.)
    showBanner(world, 'ui.roam.engaging', { n: Math.ceil(r.t) }, 1);
  } else if (wasCounting && r.t == null) {
    clearBanner(world); // left the zone → drop the countdown banner immediately
  }
  if (r.fire) world.events.emit({ type: 'missionZoneEnter' });
}

// Soft-boundary auto-return: warp the player back to the center, zero velocity, clear the OOB timer,
// and replay the warp-in animation so the return reads as intentional (not a glitch).
export function warpPlayerToCenter(world) {
  const p = world.player;
  p.pos.set(world.arenaCenter.x, BULLET_PLANE_Y, world.arenaCenter.z); // back to the (possibly drifted) arena center
  p.vel.set(0, 0, 0);
  p.oobTime = 0;
  p.spawnAge = 0;                  // (re)start the grow-from-a-dot animation
  p.scale = p.fullScale * 0.001;   // shrink to a dot; stepPlayer grows it back
  world.events.emit({ type: 'warpFlash', pos: p.pos.clone() }); // a small flash at the arrival point
}

export function stepPlayer(world, dt) {
  const player = world.player;
  const { keys, touchAim } = world.input;
  player.thrusting = false; // re-armed below by whichever control path actually thrusts this tick
  // --- repair drone: passive hull regen, capped at a fraction of max HP (no-op without a drone) ---
  if (player.repair) {
    const r = repairTick(player.hp, player.maxHp, player.repair, dt, player._repairAccum);
    player.hp = r.hp; player._repairAccum = r.accum;
  }

  // --- shield: recharge only once fully depleted, then refill to full (no-op without a shield) ---
  if (player.shield) {
    const wasBroken = player._shieldValue <= 0;
    const s = shieldRecharge(player._shieldValue, player.shield.capacity, player.shield.rechargeSec, dt, player._shieldRechargeAccum);
    player._shieldValue = s.shieldValue; player._shieldRechargeAccum = s.accum;
    if (wasBroken && s.shieldValue > 0) world.events.emit({ type: 'shieldReady' }); // recharge just completed → whole sphere flashes once
  }

  const accel = player.acceleration; // derived: acceleration <- main engine power
  const turn = player.turnRate;      // derived: maneuverability <- thruster power

  // Autopilot (return-to-base): ANY control input cancels it and hands control back immediately (DECISIONS §39).
  const manual = touchAim.active
    || keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown']
    || keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight']
    || keys['Space'] || keys['KeyF'] || keys['_rocket']; // KeyF = keyboard rocket, _rocket = touch/mouse 🚀 button
  if (world.autopilot.active && manual) { world.autopilot.active = false; world.autopilot.target = null; }

  // Outside the autopilot/manual split on purpose: flying into the active mission's zone starts it however
  // you got there — autopilot cruise, or hand-flown after cancelling it.
  checkMissionZone(world, dt);

  let fwd;
  if (world.autopilot.active) {
    autopilotControl(world, dt, accel, turn); // sets heading + vel toward the target (brake/rotate/accelerate)
    fwd = forwardVec(player.heading);
    checkPointArrival(world);                 // roam point autopilot: park (+ maybe prompt) on arrival
    checkStationArrival(world);               // roam dock autopilot: park at the base + offer to go back inside
  } else {
    // --- player: turn ---
    if (keys['KeyA'] || keys['ArrowLeft'])  player.heading += turn * dt;
    if (keys['KeyD'] || keys['ArrowRight']) player.heading -= turn * dt;

    // touch: turn the nose toward the touch direction (directional steering)
    if (touchAim.active) {
      player.heading = steerToward(player.heading, touchAim.heading, turn * dt);
    }

    // --- player: thrust (forward only — S/↓ is a brake, never a reverse; DECISIONS §113) ---
    fwd = forwardVec(player.heading);
    const kb = keyboardThrust(keys);
    if (kb.thrust) player.vel.addScaledVector(fwd, accel * kb.thrust * dt);
    if (kb.brake)  brakeStep(world, accel, dt); // same kinematic decel the autopilot uses: bleeds to 0, no overshoot
    if (touchAim.active) player.vel.addScaledVector(fwd, accel * touchAim.thrust * dt); // touch thrust

    // passive braking when no control button is pressed
    // (hold the turn to aim while drifting - inertia is preserved)
    const controlling = touchAim.active
                     || keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown']
                     || keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight'];
    if (!controlling) player.vel.multiplyScalar(Math.max(0, 1 - IDLE_DRAG * dt));
  }

  // Flat top speed: pure inertia, but the player never exceeds their max whenever they are FLYING IT BY
  // HAND — which is the whole replay invariant (see capLifted): a replay reproduces recorded INPUT, so
  // every input-driven leg must clamp exactly as recorded. Autopilot legs are not input-driven, so two of
  // them run uncapped: roam cruise to a destination, and the return-to-base DOCK (so "Return to base" at
  // the end of a mission, and clicking the station while roaming, are a quick trip home rather than a slog).
  // Mobility skill raises the cap by maxSpeedMul (1 when no points / on replays).
  const maxSpeed = PLAYER_MAX_SPEED * (player.maxSpeedMul || 1);
  const docking = world.autopilot.active && !!world.autopilot.target && world.autopilot.target.kind === 'station';
  const lifted = capLifted({ roam: world.roam, autopilot: world.autopilot.active, docking });
  if (!lifted && player.vel.length() > maxSpeed) player.vel.setLength(maxSpeed);
  // the ship keeps flying in its current direction, no matter where the nose points
  player.pos.addScaledVector(player.vel, dt);

  // (The arena-drift block below is not player-specific — it stays here because moving it would reorder the tick.)
  // Drifting arena (e.g. freighter escort): slowly pan the combat zone's center; the boundary, warp-back
  // and mini-map all compute relative to it. Static maps (world.arenaDrift null) keep the center at (0,0).
  if (world.arenaDrift) {
    world.arenaCenter.x += world.arenaDrift.x * dt;
    world.arenaCenter.z += world.arenaDrift.z * dt;
  }

  // Soft boundary (DECISIONS §2): the player can fly past ±ARENA freely (measured from the arena center).
  // Track how long it's been continuously outside; after a grace delay we warn (HUD), and after
  // OOB_RETURN_TIME we warp it back to the center. Re-entering resets the timer and clears the warning.
  const p = player.pos;
  const dxc = p.x - world.arenaCenter.x, dzc = p.z - world.arenaCenter.z;
  const oob = Math.abs(dxc) > ARENA || Math.abs(dzc) > ARENA;
  // In ROAM the arena boundary is meaningless (you fly the whole system) — never warn, never warp back.
  if (oob && !world.roam) {
    player.oobTime += dt;
    // OOB warp-back is LIFTED during return-to-base (§39) so side missions fought far from (0,0) can fly home
    if (player.oobTime >= OOB_RETURN_TIME && !world.returnToBase) warpPlayerToCenter(world);
  } else {
    player.oobTime = 0;
  }

  // warp-back animation: grow from a dot back to full size (reuses the enemy "warp in")
  if (player.spawnAge < SPAWN_GROW_TIME) {
    player.spawnAge = Math.min(SPAWN_GROW_TIME, player.spawnAge + dt);
    const k = 1 - Math.pow(1 - player.spawnAge / SPAWN_GROW_TIME, 3); // ease-out cubic
    player.scale = player.fullScale * Math.max(0.001, k);
  }

  // --- engine trail (when thrusting forward) --- flagged here, drawn in syncMeshes
  if (keys['KeyW'] || keys['ArrowUp'] || (touchAim.active && touchAim.thrust > 0.1)) {
    player.thrusting = true;
  }

  // --- player: fire each group when its key is held (the rocket group also via the touch button) ---
  updateGroups(world, player, fwd, true, dt, (g) => !!(keys[g.key] || (g.name === 'rocket' && keys['_rocket'])));
}

// The last thing a tick does: notice the ship died. Deliberately separate from the damage that killed it —
// several steps can bring hp to 0 and only one death may be announced, so the check runs once, at the end.
export function stepPlayerDeath(world) {
  const p = world.player;
  if (p.hp <= 0 && p.alive) {
    p.alive = false;
    world.events.emit({ type: 'death' }); // the adapter owns the boom, the sting, the overlay and the banking
  }
}
