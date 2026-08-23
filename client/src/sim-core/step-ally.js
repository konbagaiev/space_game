// The wingman's half of a tick: how the Sentinel ally flies, aims, fires, breaks off and escorts.
//
// This is NOT `stepEnemyAI` pointed the other way, and the difference is the whole design
// (docs/plans/combat-ally.md §3). An enemy holds a stand-off band and beelines at a drag-limited crawl;
// the ally flies the PLAYER's movement model — charge at full thrust, fly past, brake and come about
// TOGETHER, re-pick, build speed again. He holds fire across the player's line, breaks off to heal, and
// escorts when there is nothing to fight.
//
// THE MOVEMENT MODEL IS THE PLAYER'S, and that is load-bearing (maintainer, 2026-08-23): thrust decides
// ACCELERATION, top speed is a property of the SHIP. So he caps at `PLAYER_MAX_SPEED * (maxSpeedMul || 1)`
// read from `step-player.js` — never a literal, never `engine.maxSpeed` — and he never touches the enemy
// `DRAG` or the player's passive `IDLE_DRAG`. He is an AI: he always holds a control, so he is either
// thrusting or braking (`brakeVel`), never "hands off".
//
// HE CANNOT DIE (§2.4). `hp` is floored at `ALLY_MIN_HP` and there is no ally death path anywhere — nothing
// tests `ally.hp <= 0`, no step despawns him, and `stepEnemyDeaths` only walks `world.enemies`. The floor
// runs at the TOP of this step while damage lands later in the same tick (`stepBullets`/`stepRockets` come
// after `stepAlly` in tick.js), so his hp can sit at or below 0 for the rest of a tick and his bar can draw
// 0 % for one frame. That is cosmetic; do not read it as a revival, and do not "fix" it with a death check.
//
// DRAWS NOTHING FROM THE SEEDED STREAM (DECISIONS §73): no dodge (skills are null → dodge 0, so
// `resolveHostileBulletHit` never rolls), no spawn ring, no reload jitter (that is enemy-only).
import { Vec3 } from './vec.js';
import { repairTick, shieldRecharge } from './components.js';
import { headingToDir, shortestAngleDelta, steerToward, inForwardSector } from './steering.js';
import { updateGroups } from './ship-entity.js';
import { PLAYER_MAX_SPEED, brakeVel } from './step-player.js';
import {
  ALLY_BEHIND_ANGLE, ALLY_SNAP_ANGLE, ALLY_TURN_EXIT_ANGLE, ALLY_FIRE_BLOCK_HALF_ANGLE, ALLY_TARGET_LEASH,
  ALLY_RETREAT_HP_FRAC, ALLY_REJOIN_HP_FRAC, ALLY_RETREAT_DIST, ALLY_ESCORT_DIST, ALLY_ESCORT_BAND,
  ALLY_MIN_HP,
} from './ally-config.js';

// ---------- Pure helpers (unit-testable with plain objects, no catalog, no World) ----------

const planarDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// The heading that points from `pos` at `e` — same convention as forwardVec/touchAim: atan2(dx, dz).
const angleTo = (pos, e) => Math.atan2(e.pos.x - pos.x, e.pos.z - pos.z);

// Nearest enemy by hull CENTRE, skipping the ones still forming. `leash` is a PLAYER-relative filter:
// `Infinity` (the shipped default) means "nearest to HIMSELF", which is literal §2d; a finite value only
// admits enemies within that distance of the player, which is the one-number fix if he wanders off frame.
export function nearestEnemyTo(pos, enemies, player, leash = Infinity) {
  let best = null, bestD = Infinity;
  for (const e of enemies) {
    if (e.warping) continue;
    if (leash !== Infinity && player && planarDist(player.pos, e.pos) > leash) continue;
    const d = planarDist(pos, e.pos);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

// The BEST-AIMED enemy inside `tol` radians of the nose, or null. "I could shoot that one right now."
export function aimedEnemy(pos, heading, enemies, tol) {
  let best = null, bestAbs = tol;
  for (const e of enemies) {
    if (e.warping) continue;
    const d = Math.abs(shortestAngleDelta(heading, angleTo(pos, e)));
    if (d <= bestAbs) { best = e; bestAbs = d; }
  }
  return best;
}

// §2.6 — NEVER a tracer through the player's hull. Hold fire while the player is inside the firing cone
// AND nearer than the target: past the target he is not in the way, and outside the cone the shot misses
// him anyway. `fwd` and `toPlayer` are plain XZ.
export function holdFireForPlayer(fwd, toPlayer, playerDist, targetDist) {
  if (!(playerDist < targetDist)) return false;
  return inForwardSector(fwd, toPlayer, ALLY_FIRE_BLOCK_HALF_ANGLE);
}

// The break-off rule: ≤20 % hull AND the shield down. Both, always — a shield still up means he is not yet
// taking hull damage and has no reason to leave.
export function shouldRetreat(a) {
  return a.hp <= ALLY_RETREAT_HP_FRAC * a.maxHp && !(a._shieldValue > 0);
}
// …and the way back in: ≥40 % hull AND the shield full again.
export function shouldRejoin(a) {
  return a.hp >= ALLY_REJOIN_HP_FRAC * a.maxHp && (!a.shield || a._shieldValue >= a.shield.capacity);
}

// Fly to a point and STOP on it, with the player's own arrival rule (step-player.autopilotControl):
// thrust while the distance still to cover exceeds the kinematic stopping distance v²/(2·accel), else brake.
// Returns 1 (thrust) or 0 (brake this tick) — never negative: he has no reverse, exactly like the player.
//
// THE FIRST ARGUMENT IS THE CLOSING SPEED, NOT THE GROUND SPEED, and the caller decides which is which:
// the stopping distance that matters is the one for the speed at which the GAP is shrinking. Against a
// stationary destination the two are the same; against a MOVING one they are not, and using ground speed
// there brakes for a rendezvous that is not happening (see the escort branch, which is where this bit).
export function approachThrust(closingSpeed, remaining, accel) {
  const v = Math.max(0, closingSpeed);           // opening (negative) needs no braking allowance at all
  return remaining > (v * v) / (2 * accel) + 0.5 ? 1 : 0;
}

// ---------- The step ----------

export function stepAlly(world, dt) {
  if (!world.allies.length) return;   // no ally in this fight: nothing below runs, nothing draws
  const player = world.player;
  for (const a of world.allies) {
    // 1. Warp-in grow — the same rule enemies get (DECISIONS §54): the delay IS the arrival animation.
    if (a.spawnAge < a.spawnDur) {
      a.spawnAge = Math.min(a.spawnDur, a.spawnAge + dt);
      const k = 1 - Math.pow(1 - a.spawnAge / a.spawnDur, 3); // ease-out cubic
      a.scale = a.fullScale * Math.max(0.001, k);
      if (a.spawnAge >= a.spawnDur) a.warping = false;        // fully formed: now a normal combatant
    }

    // 2. Repair drone + shield, ALWAYS — including mid-charge. 1 HP/s to the drone's 0.8 cap; the shield
    //    refills all-or-nothing 10 s after breaking (components.repairTick / shieldRecharge).
    if (a.repair) {
      const rp = repairTick(a.hp, a.maxHp, a.repair, dt, a._repairAccum);
      a.hp = rp.hp; a._repairAccum = rp.accum;
    }
    if (a.shield) {
      const s = shieldRecharge(a._shieldValue, a.shield.capacity, a.shield.rechargeSec, dt, a._shieldRechargeAccum);
      a._shieldValue = s.shieldValue; a._shieldRechargeAccum = s.accum;
    }
    if (a.hp < ALLY_MIN_HP) a.hp = ALLY_MIN_HP;   // HE CANNOT DIE (§2.4) — there is no ally death path

    // 3. The player is gone → come to a stop and hold fire, the same wind-down enemies do
    //    (step-enemies.js) — but braked like a pilot letting go, not on the enemy's exponential DRAG.
    if (!player.alive) {
      brakeVel(a.vel, a.acceleration, dt);
      a.pos.addScaledVector(a.vel, dt);
      a.thrusting = false;
      continue;
    }

    const enemies = world.enemies;   // `nearestEnemyTo`/`aimedEnemy` skip the warping ones themselves
    let desired, thrust = 0, wantsFire = false, dist = Infinity, diff = 0;

    if (a.retreating) {
      // 4a. BREAKING OFF. Straight out from the arena centre to ALLY_RETREAT_DIST and STOP there — the
      //     player's arrival rule, so he settles on the holding point instead of sailing past it (at
      //     30 u/s the stopping distance is ~52 u, which is most of the run). He does not fire while
      //     healing — a wingman leaving reads as leaving. HE IS STILL A TARGET while he does it (the veto
      //     of 2026-08-23); he outruns every Level-4 enemy, so breaking contact is his to win.
      const dx = a.pos.x - world.arenaCenter.x, dz = a.pos.z - world.arenaCenter.z;
      const d = Math.hypot(dx, dz);
      desired = d > 1e-3 ? Math.atan2(dx, dz) : a.heading;   // outward, radially
      // Ground speed IS the closing speed here: the holding point is STATIONARY and he is flying straight
      // at it. (Any lateral drift left over from the fight only overstates it, which brakes him early —
      // safe.) The escort branch below must NOT copy this line; its destination moves.
      thrust = approachThrust(a.vel.length(), ALLY_RETREAT_DIST - d, a.acceleration);
      if (shouldRejoin(a)) a.retreating = false;             // ≥40% hull AND the shield full → back in
    } else {
      // 4b. THE PASS. Target bookkeeping first, then geometry against the FINAL target.
      if (a.target && !enemies.includes(a.target)) { a.target = null; a.passArmed = false; }
      if (!a.target) { a.target = nearestEnemyTo(a.pos, enemies, player, ALLY_TARGET_LEASH); a.passArmed = false; }
      if (a.target) {
        const d0 = shortestAngleDelta(a.heading, angleTo(a.pos, a.target));
        if (!a.passArmed && Math.abs(d0) > ALLY_BEHIND_ANGLE) {
          // THE TARGET IS BEHIND HIM: the pass is over. This is the ONLY place the retreat is decided —
          // "low health never interrupts a charge" (§2d).
          a.passArmed = true;
          if (shouldRetreat(a)) { a.retreating = true; a.target = null; }
        }
        if (a.passArmed && a.target) {
          // Re-search, armed. Either something swung round into a shot he could take RIGHT NOW, or somebody
          // else is simply nearer after the pass.
          const snap = aimedEnemy(a.pos, a.heading, enemies, ALLY_SNAP_ANGLE);
          const near = nearestEnemyTo(a.pos, enemies, player, ALLY_TARGET_LEASH);
          const next = snap || (near !== a.target ? near : null);
          // A SNAP target is already inside the aim cone, so §2d's "switch to that one and accelerate at
          // it" applies at once: end the come-about. A merely NEARER one does not end it — he would
          // accelerate off at whatever angle it happens to sit at, instead of coming about first.
          if (next && next !== a.target) { a.target = next; if (next === snap) a.passArmed = false; }
        }
        // COME ABOUT ENDS when the nose reaches the target: stop braking, charge again, already able to fire.
        if (a.passArmed && a.target
            && Math.abs(shortestAngleDelta(a.heading, angleTo(a.pos, a.target))) <= ALLY_TURN_EXIT_ANGLE) {
          a.passArmed = false;
        }
      }
      if (a.target) {
        const tx = a.target.pos.x - a.pos.x, tz = a.target.pos.z - a.pos.z;
        dist = Math.hypot(tx, tz);
        desired = Math.atan2(tx, tz);
        // CHARGE (thrust) or COME ABOUT (brake) — the reversal is brake + turn TOGETHER, never a
        // constant-speed arc. He still steers at the target in both, so the only difference this line
        // makes is whether the engine is lit.
        thrust = a.passArmed ? 0 : 1;
        wantsFire = true;
      } else {
        // 4c. NOTHING TO FIGHT: escort. Close to ~10 u of the player and hold — a wingman with nothing to do
        //     should read as escorting, not as drifting scenery (§2d). Same arrival rule as the retreat,
        //     with ONE difference that is the whole point: the destination MOVES, so the approach is judged
        //     on the CLOSING speed — the component of (his velocity − the player's) along the line to the
        //     player — not on his ground speed. Ground speed would have him braking at 30 u/s while flying
        //     in formation, because his 52 u stopping distance exceeds the gap he is trying to hold; he
        //     would settle ~62 u back, off the frame, and no constant could fix it (the 52 falls out of
        //     v²/2a). NOT `enemyThrustFactor` either, whose -0.6 band is a REVERSE the player does not
        //     have (DECISIONS §113).
        const tx = player.pos.x - a.pos.x, tz = player.pos.z - a.pos.z;
        const pd = Math.hypot(tx, tz);
        desired = pd > 1e-6 ? Math.atan2(tx, tz) : a.heading;
        const remaining = pd - ALLY_ESCORT_DIST;
        const closing = pd > 1e-6                       // >0 closing, <0 opening; 0 when flying in formation
          ? ((a.vel.x - player.vel.x) * tx + (a.vel.z - player.vel.z) * tz) / pd
          : 0;
        thrust = remaining > ALLY_ESCORT_BAND ? approachThrust(closing, remaining, a.acceleration) : 0;
      }
    }

    diff = shortestAngleDelta(a.heading, desired);
    a.heading = steerToward(a.heading, desired, a.turnRate * dt);
    // The nose. Built from steering.js's own `headingToDir` rather than importing step-enemies'/step-player's
    // private `forwardVec` — both of which are exactly these two lines. It must be a real planar Vec3, not
    // the bare {x,z} `headingToDir` returns: everything downstream reads more than x and z.
    // `Vec3.addScaledVector` and `makeBullet`'s direction normalise read `.y` (a missing one puts NaN in his
    // velocity and in every bullet he fires), and `findTargetInSector` calls `fwd.dot(...)`, which a plain
    // object does not have — his rocket seeker would throw on the first launch.
    const d = headingToDir(a.heading);
    const fwd = new Vec3(d.x, 0, d.z);
    // THE PLAYER'S MOVEMENT MODEL, not the enemy's: thrust OR brake (never both, never a passive drag),
    // then the player's FLAT cap. `a.engine.maxSpeed` is deliberately ignored — top speed is a property of
    // the ship, not of the engine (maintainer, 2026-08-23) — and the enemy `DRAG` is never imported.
    if (thrust > 0) a.vel.addScaledVector(fwd, a.acceleration * thrust * dt);
    else brakeVel(a.vel, a.acceleration, dt);
    const maxSpeed = PLAYER_MAX_SPEED * (a.maxSpeedMul || 1);   // no skills → 1 → exactly a fresh player's 30
    if (a.vel.length() > maxSpeed) a.vel.setLength(maxSpeed);
    a.pos.addScaledVector(a.vel, dt);     // no arena clamp: he fights out of bounds like everyone else
    a.thrusting = thrust > 0;             // render consequence only (the exhaust plume)

    // 5. FIRE. The pulse is free: a group only fires inside its own aimTol, so he goes quiet through the
    //    pass and opens up out of the turn without a line of code. What IS written is the discipline —
    //    never a tracer through the player's hull (§2.6).
    const toP = { x: player.pos.x - a.pos.x, z: player.pos.z - a.pos.z };
    const blocked = holdFireForPlayer(fwd, toP, Math.hypot(toP.x, toP.z), dist);
    // No `rocketTarget` argument: the friendly branch of `fireMount` resolves its own seeker target with
    // `findTargetInSector` (the same rule the player's rockets follow), so passing `a.target` would be a
    // dead argument. Only an ENEMY is handed a target, because a hostile rocket's is "whoever I fly at".
    updateGroups(world, a, fwd, 'ally', dt,
      (g) => wantsFire && !a.warping && !blocked && g.ai && dist < g.ai.range && Math.abs(diff) < g.ai.aimTol);
  }
}
