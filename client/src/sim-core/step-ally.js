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
// HE CAN DIE, and when he does he is gone for the rest of the MISSION (§2.4, reversed 2026-08-23 after the
// maintainer watched an immortal wingman soak three boss rockets at a sliver of hull). `stepAllyDeaths`
// below is the death path; it runs after the projectiles that caused it, exactly like `stepEnemyDeaths`.
// He pays NOTHING on the way out — no credits, no XP, no loot roll, and `world.kills` does not move — so a
// level's phase thresholds, `enemyTotal`, `isLastKillDrop` and the `cleared` payload are all untouched. A
// fresh run empties `world.allies` (`reset-world.clearAndPlaceRun`) and the level's phase spawns him again,
// which is what "returns in the next mission" means.
//
// THE RETREAT IS THEREFORE THE THING STANDING BETWEEN LOW HULL AND A DEAD WINGMAN — which is why it is
// taken the INSTANT the threshold is crossed, mid-charge or not, and why §2d's "low health never interrupts
// a charge" is retired (see `shouldRetreat`). He can still die; that is not protection, it is a chance.
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
  ALLY_RETREAT_HP_FRAC, ALLY_REJOIN_HP_FRAC, ALLY_BREAK_OFF_DIST, ALLY_ESCORT_DIST, ALLY_ESCORT_BAND,
} from './ally-config.js';
import { despawnAt } from './spawn.js';

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

// The break-off rule: ≤25 % hull AND the shield down.
//
// ACTED ON THE INSTANT IT BECOMES TRUE — mid-charge or not. This **supersedes §2d's "low health never
// interrupts a charge"** (maintainer, 2026-08-23), and that rule is retired rather than bent: it was
// written while the ally COULD NOT DIE, when interrupting a charge bought nothing because the retreat was
// only ever about healing. Once he became mortal the same words meant "die mid-charge". Level 4's boss
// carries 2× weapon 10 and 3× weapon 4 — up to ~35 damage/second on target — so at 200 max HP the window
// between crossing the threshold and being dead is about ONE SECOND, against a pass cycle of ~6 s. A
// decision taken once per pass therefore landed inside the fatal window about one time in six, which is
// exactly what the maintainer kept watching: he pressed on and died.
//
// THE SHIELD CLAUSE IS NOW NEARLY FREE, and it is worth knowing why it is still here. Damage routes through
// the shield before the hull (DECISIONS §76), so at the instant any HULL damage lands the shield is already
// down by construction — under a damage-triggered check this clause can essentially never be the thing that
// blocks a retreat. It stays because the maintainer specified "≤25 % with the shield down", and it still
// says something true: a wingman whose shield came back up is no longer taking hull damage.
export function shouldRetreat(a) {
  return a.hp <= ALLY_RETREAT_HP_FRAC * a.maxHp && !(a._shieldValue > 0);
}
// …and the way back in: ≥40 % hull AND the shield full again.
export function shouldRejoin(a) {
  return a.hp >= ALLY_REJOIN_HP_FRAC * a.maxHp && (!a.shield || a._shieldValue >= a.shield.capacity);
}

// ---------- Aiming a weapon whose bullets INHERIT the shooter's velocity ----------
//
// THE DEFECT THIS FIXES. A kinetic bullet leaves at `nose × projectileSpeed + shipVelocity`
// (`spawn.js makeBullet` — rockets deliberately do NOT inherit, DECISIONS §70). So a ship drifting sideways
// with its nose exactly ON a target fires a shot that does not travel toward it, and misses a STATIONARY
// enemy. Pointing the nose at the target is only correct while flying straight down it.
//
// It hits the WINGMAN harder than anything else in the game: his entire manoeuvre is a firing pass with
// heavy lateral drift, so he is almost never flying down his own nose at the moment he shoots.
//
// THE CORRECTION. Given `u` (unit SHIP-CENTRE→target), ship velocity `v` and muzzle speed `s`, choose the
// nose `n` (|n| = 1) so that `n·s + v` is parallel to `u`: split `v` into its components along and across
// `u`, spend just enough of `n` across `u` to cancel the crossing part, and put the rest along `u`.
//
// `u` IS FROM THE HULL CENTRE, NOT FROM THE MUZZLE, and the difference is a real ~3-4° of parallax at 20 u
// (the muzzle sits `noseZ` ahead of the centre). It is not corrected, for two reasons: the muzzle position
// is a function of the nose we are solving FOR, so taking it exactly would need an iteration for a few
// degrees; and every other aim in the game — the player's, every enemy's — carries the identical parallax,
// so removing it here alone would make him the odd one out. Stated rather than hidden.
//
// NOT SOLVABLE when the crossing part of `v` exceeds `s` — no nose direction can cancel more drift than the
// bullet has speed. `solved:false` then, and the fallback aims the nose straight into the drift, which is
// the closest achievable direction. For the ally it cannot happen: Heavy cannon `projectileSpeed` is 65
// against his 30 u/s cap, and there is a test pinning the bound.
//
// **This corrects the SHOOTER's drift, not the TARGET's motion.** Leading a moving target is a different
// (and larger) problem and is deliberately not attempted here.
//
// **ALLY-ONLY, on purpose.** `stepEnemyAI` has exactly the same flaw and is deliberately left alone:
// correcting enemy aim raises the difficulty of all five levels at once and would move every recorded
// replay, so it gets its own slice with its own balance pass (DECISIONS §134). These helpers live here,
// beside their one caller, rather than in `steering.js`, so that "ally only" is visible rather than implied.

// The nose direction to hold. `u` (ship centre → target) and `vel` are planar {x,z}; `u` must be unit.
// Returns a unit {x,z} plus whether the compensation was achievable.
export function aimWithDrift(u, vel, speed) {
  const along = vel.x * u.x + vel.z * u.z;
  const px = vel.x - along * u.x, pz = vel.z - along * u.z;   // the part of the drift that CROSSES the line
  const p = Math.hypot(px, pz);
  if (!(speed > 0) || p < 1e-9) return { x: u.x, z: u.z, solved: true }; // no crossing drift → nose on target
  if (p >= speed) return { x: -px / p, z: -pz / p, solved: false };      // unreachable: kill as much as we can
  const across = p / speed;                                   // how much of the nose the cancellation costs
  const alongN = Math.sqrt(Math.max(0, 1 - across * across));
  return { x: u.x * alongN - (px / p) * across, z: u.z * alongN - (pz / p) * across, solved: true };
}

// Where a bullet fired down `fwd` will ACTUALLY travel, as a unit {x,z} — the thing to judge the shot on.
// Returns null if the shot has no direction at all (a ship somehow moving backwards faster than it fires).
export function bulletDir(fwd, vel, speed) {
  const x = fwd.x * speed + vel.x, z = fwd.z * speed + vel.z;
  const l = Math.hypot(x, z);
  return l < 1e-9 ? null : { x: x / l, z: z / l };
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

// Which muzzle speed the NOSE is optimised for: the ship's BALLISTIC (non-homing) mounts. A ship with no
// gun at all gets 0, which makes `aimWithDrift` a no-op — the nose then simply points at the target, which
// is right for a homing-only loadout.
//
// `type === 'bullet'`, not `!== 'rocket'`: a BEAM has no `projectileSpeed` at all. (That half was already a
// no-op — `undefined > best` is false — so this is a statement of intent, not a bug fix; `isBallistic`
// below is the half that actually mattered.)
export function gunSpeed(ship) {
  let best = 0;
  for (const g of Object.values(ship.groups || {})) {
    for (const m of g.mounts || []) {
      if (m.weapon && m.weapon.type === 'bullet' && m.weapon.projectileSpeed > best) best = m.weapon.projectileSpeed;
    }
  }
  return best;
}

// Does this fire group throw something that INHERITS the ship's velocity? Bullets do; rockets do not (§70),
// and a BEAM is a hitscan with no flight time at all. That is why every gate below is asked per GROUP: off
// one nose the three weapons travel down different lines, so they need different answers to both "is this
// shot on target?" and "does it cross the player?".
//
// `type === 'bullet'` rather than `!== 'rocket'` is LOAD-BEARING for the beam. A wingman carrying a beam AND
// a kinetic (he can be handed the player's gear) would otherwise treat the beam group as ballistic and lead
// its aim by the OTHER gun's projectile speed — and a hitscan must never be led. Provably neutral for every
// row that exists today, since every non-rocket weapon in the shipped catalog except the beam is a bullet.
export const isBallistic = (g) => (g.mounts || []).some((m) => m.weapon && m.weapon.type === 'bullet');

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
    // THE BREAK-OFF DECISION, TAKEN HERE AND ACTED ON AT ONCE. Evaluated every tick rather than wired to a
    // damage callback: the two are behaviourally identical and this one needs no plumbing. `shouldRetreat`
    // can only newly become true when damage lands — the repair drone only ever RAISES hp, and
    // `shieldRecharge` only ever refills — so "every tick" fires on exactly the ticks a damage-triggered
    // check would, and does it without a second path through the damage router to keep in step.
    // There is deliberately NO per-pass gate and no timed cadence: at ~35 boss damage/second the threshold
    // is about one second wide (see shouldRetreat), so any cadence at all is a coin flip on his life.
    if (!a.retreating && shouldRetreat(a)) {
      a.retreating = true;
      a.target = null;        // he is leaving: drop the charge, whatever stage of the pass it was at
      a.passArmed = false;
    }

    // 3. The player is gone → come to a stop and hold fire, the same wind-down enemies do
    //    (step-enemies.js) — but braked like a pilot letting go, not on the enemy's exponential DRAG.
    if (!player.alive) {
      brakeVel(a.vel, a.acceleration, dt);
      a.pos.addScaledVector(a.vel, dt);
      a.thrusting = false;
      continue;
    }

    const enemies = world.enemies;   // `nearestEnemyTo`/`aimedEnemy` skip the warping ones themselves
    let desired, thrust = 0, wantsFire = false, dist = Infinity;
    let toTarget = null;             // unit vector at the enemy he is shooting at, for the fire gate
    let escorting = false;           // "hold station on the player" — reached from TWO places, see below

    // ≥40% hull AND the shield full → back in. Checked before the branch, so the tick he recovers on is
    // already a fighting tick.
    if (a.retreating && shouldRejoin(a)) a.retreating = false;

    // The thing he is running FROM. Deliberately unleashed (`Infinity`): `ALLY_TARGET_LEASH` is about which
    // enemies are worth ENGAGING and has nothing to say about which one is currently shooting at him.
    const threat = a.retreating ? nearestEnemyTo(a.pos, enemies, player, Infinity) : null;

    if (a.retreating && threat) {
      // 4a. BREAKING OFF — measured from the THREAT, never from the arena centre.
      //
      //     Fly DIRECTLY AWAY from the nearest enemy (recomputed every tick: as he runs, the nearest one
      //     can change) until the gap reaches ALLY_BREAK_OFF_DIST, then hold and let the drone work. He
      //     does not fire while healing — a wingman leaving reads as leaving. HE IS STILL A TARGET while
      //     he does it (the veto of 2026-08-23); he caps at 30 u/s against 10.5-15.75 for every Level-4
      //     enemy, so breaking contact is a race he wins.
      //
      //     THIS USED TO AIM AT A RADIUS FROM THE ARENA CENTRE and it did not work at all: enemies spawn
      //     at 70..130 from that centre, so the 70 u "holding point" was the inner edge of their spawn
      //     ring — and since he charges enemies out at 70..130, his own distance from the centre was
      //     normally already past it. `70 − d` went negative, `approachThrust` correctly returned 0 (he
      //     has no reverse), and he stopped dead in the middle of the fight: retreating, holding fire,
      //     going nowhere. See ally-config.js.
      const ax = a.pos.x - threat.pos.x, az = a.pos.z - threat.pos.z;
      const gap = Math.hypot(ax, az);
      desired = gap > 1e-6 ? Math.atan2(ax, az) : a.heading;   // away from it, not outward from anywhere
      // THE DESTINATION MOVES, so this is the ESCORT case and not the old stationary-point one: what the
      // arrival rule needs is the rate at which the remaining distance is being eaten, and here that is the
      // rate the GAP IS OPENING — the component of (his velocity − the enemy's) along the away vector.
      // Ground speed would be wrong for the same reason it was wrong for the escort: a pursuer matching his
      // course means the gap is not opening at all, however fast he is flying. A NEGATIVE value (still
      // being closed on) is clamped to 0 by approachThrust, which is exactly right — full thrust is all he
      // can do about it.
      const tvx = threat.vel ? threat.vel.x : 0, tvz = threat.vel ? threat.vel.z : 0;
      const opening = gap > 1e-6 ? ((a.vel.x - tvx) * ax + (a.vel.z - tvz) * az) / gap : 0;
      thrust = approachThrust(opening, ALLY_BREAK_OFF_DIST - gap, a.acceleration);
    } else if (a.retreating) {
      // 4a′. Retreating with NOTHING TO RUN FROM. The arena is empty, so there is no gap to open and no
      //      direction that means anything; flying off into blank space would just take him off the map.
      //      Hold station on the player instead and heal there — he still does not fire (`wantsFire` stays
      //      false), so he still reads as out of the fight, and `shouldRejoin` brings him back as usual.
      escorting = true;
    } else {
      // 4b. THE PASS. Target bookkeeping first, then geometry against the FINAL target.
      if (a.target && !enemies.includes(a.target)) { a.target = null; a.passArmed = false; }
      if (!a.target) { a.target = nearestEnemyTo(a.pos, enemies, player, ALLY_TARGET_LEASH); a.passArmed = false; }
      if (a.target) {
        const d0 = shortestAngleDelta(a.heading, angleTo(a.pos, a.target));
        if (!a.passArmed && Math.abs(d0) > ALLY_BEHIND_ANGLE) {
          a.passArmed = true;   // THE TARGET IS BEHIND HIM: the pass is over, arm the re-search.
          // (The retreat used to be decided here and nowhere else — "low health never interrupts a charge".
          //  That rule is retired: it is taken the instant the threshold is crossed, at the top of the step.)
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
        toTarget = dist > 1e-6 ? { x: tx / dist, z: tz / dist } : { x: Math.sin(a.heading), z: Math.cos(a.heading) };
        // THE NOSE IS AIMED FOR THE GUN, not at the target. His bullets inherit his velocity, and he is
        // almost always drifting across his own line of fire, so pointing the nose AT the enemy is what
        // makes him miss (see aimWithDrift). The rocket group is unaffected by the choice — it launches
        // along whatever the nose happens to be and then HOMES, so it corrects itself — and the gun is the
        // weapon that has to be right: 0.6 s cooldown against the rocket's 5 s.
        const aim = aimWithDrift(toTarget, a.vel, gunSpeed(a));
        desired = Math.atan2(aim.x, aim.z);
        // CHARGE (thrust) or COME ABOUT (brake) — the reversal is brake + turn TOGETHER, never a
        // constant-speed arc. He still steers at the target in both, so the only difference this line
        // makes is whether the engine is lit.
        thrust = a.passArmed ? 0 : 1;
        wantsFire = true;
      } else {
        escorting = true;   // 4c. NOTHING TO FIGHT: escort (the shared block below)
      }
    }

    // 4c. ESCORT — hold station on the player. Reached from TWO places: nothing to fight, or retreating with
    //     nothing to run from. A wingman with nothing to do should read as escorting, not as drifting
    //     scenery (§2d). Same arrival rule as the break-off, and for the same reason: the destination MOVES,
    //     so the approach is judged on the CLOSING speed — the component of (his velocity − the player's)
    //     along the line to the player — not on his ground speed. Ground speed would have him braking at
    //     30 u/s while flying in FORMATION, because his 52 u stopping distance exceeds the gap he is trying
    //     to hold; he would settle ~62 u back, off the frame, and no constant could fix it (the 52 falls out
    //     of v²/2a). NOT `enemyThrustFactor` either, whose -0.6 band is a REVERSE the player does not have
    //     (DECISIONS §113).
    if (escorting) {
      const tx = player.pos.x - a.pos.x, tz = player.pos.z - a.pos.z;
      const pd = Math.hypot(tx, tz);
      desired = pd > 1e-6 ? Math.atan2(tx, tz) : a.heading;
      const remaining = pd - ALLY_ESCORT_DIST;
      const closing = pd > 1e-6                       // >0 closing, <0 opening; 0 when flying in formation
        ? ((a.vel.x - player.vel.x) * tx + (a.vel.z - player.vel.z) * tz) / pd
        : 0;
      thrust = remaining > ALLY_ESCORT_BAND ? approachThrust(closing, remaining, a.acceleration) : 0;
    }

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

    // 5. FIRE. ONE IDEA, APPLIED TWICE: every question about a shot is asked of the PATH THE PROJECTILE
    //    ACTUALLY TAKES, per group — never of the nose, because since `aimWithDrift` the nose is
    //    deliberately off the bearing and the two ballistics on this hull do not share a path:
    //      • a BULLET inherits the ship's velocity, so its path is `fwd × speed + vel` — the corrected line;
    //      • a ROCKET inherits nothing (§70), so its path IS the nose, and it homes afterwards.
    //    Both the AIM gate and the §2.6 SAFETY gate read that same per-group `path`, which is what keeps
    //    them honest: judging the rocket on the corrected line would let it launch up to ~0.5 rad off the
    //    true bearing while the gate reported "aligned", and judging its safety on the bullet's line would
    //    quietly LOOSEN "never a tracer through your hull" for the one weapon that still flies down the nose.
    //    The firing PULSE is still free: a group only fires inside its own aimTol, so he goes quiet through
    //    the pass and opens up out of the turn without a line of code.
    //    This predicate is the ally's own; `stepPlayer` and `stepEnemyAI` keep the shared rule untouched.
    const bulletSpeed = gunSpeed(a);
    const bearing = toTarget ? Math.atan2(toTarget.x, toTarget.z) : 0;
    const toP = { x: player.pos.x - a.pos.x, z: player.pos.z - a.pos.z };
    const playerDist = Math.hypot(toP.x, toP.z);
    // No `rocketTarget` argument: the friendly branch of `fireMount` resolves its own seeker target with
    // `findTargetInSector` (the same rule the player's rockets follow), so passing `a.target` would be a
    // dead argument. Only an ENEMY is handed a target, because a hostile rocket's is "whoever I fly at".
    updateGroups(world, a, fwd, 'ally', dt, (g) => {
      if (!wantsFire || a.warping || !toTarget || !g.ai || !(dist < g.ai.range)) return false;
      // WHERE THIS GROUP'S PROJECTILE GOES. A ballistic mount's speed is its own; a group with no ballistic
      // mount (or a ship with no gun) flies down the nose.
      const ballistic = isBallistic(g) && bulletSpeed > 0;
      const path = ballistic ? bulletDir(fwd, a.vel, g.mounts[0].weapon.projectileSpeed || bulletSpeed) : fwd;
      if (!path) return false;                     // no direction at all → do not fire
      // §2.6 — never through the player's hull, judged on the path this group's projectile really takes.
      if (holdFireForPlayer(path, toP, playerDist, dist)) return false;
      return Math.abs(shortestAngleDelta(Math.atan2(path.x, path.z), bearing)) < g.ai.aimTol;
    });
  }
}

// The wingman dies. Deliberately separate from the damage that killed him — several steps can bring hp to 0
// and only one death may be announced — and deliberately AFTER the projectile steps, which is the same
// placement and the same reason `stepEnemyDeaths` has.
//
// **He is worth nothing, and that is the whole point of not reusing `stepEnemyDeaths`.** No credits, no XP,
// no loot roll, and `world.kills` is untouched — so a phase's `advanceWhen: {kills:N}`, `world.enemyTotal`,
// `isLastKillDrop` and the `cleared` payload all behave exactly as if he had never been there. His death
// also does not end the mission: nothing here looks at the win condition.
//
// It emits `allyDown` rather than `kill`. `kill` is built for enemies — it carries `reward`/`xp`/`role` and
// the client's adapter reads them — so borrowing it would mean emitting a reward of 0 for a thing that is
// not a kill, and every future reader would have to work out which of the two it was. `allyDown` carries
// exactly what the explosion needs. **The FX is the whole announcement**: player-facing copy is out of
// scope for this step (§2), and a wingman that vanished in silence would read as a bug.
//
// `world.allies` can therefore SHRINK mid-run. Both hosts run this same code in the same tick order, so the
// digest stays deterministic; on the wire he simply stops being listed, which is the despawn path every
// ghost already uses.
export function stepAllyDeaths(world) {
  const allies = world.allies;
  for (let i = allies.length - 1; i >= 0; i--) {
    const a = allies[i];
    if (a.hp > 0) continue;
    world.events.emit({
      type: 'allyDown', pos: a.pos.clone(),
      exhaustColor: a.engine && a.engine.exhaust ? a.engine.exhaust.color : a.color,
      sizeScale: a.sizeScale || 1, shipClass: a.class, weightClass: a.weightClass ?? null,
    });
    despawnAt(world, 'ally', allies, i);   // sets alive = false and releases the host's body
  }
}
