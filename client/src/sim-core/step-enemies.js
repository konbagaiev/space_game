// The enemy half of a tick: how every hostile ship flies, aims and fires, and what happens when one dies.
//
// The AI is deliberately simple and has not changed in the move: turn toward its target at the hull's turn
// rate, hold a stand-off distance of about 20 units, and fire each mount whose range + aim tolerance is
// satisfied. Its TARGET is the nearer of the player and any ally (`nearestHostileTarget`) — which is the
// player verbatim in every fight that has no wingman, i.e. every level that ships today. What it does NOT do is as load-bearing as what it does — a warping enemy is invulnerable,
// silent and unhomeable until it has finished materialising (DECISIONS §54), and nobody fires at all
// during the opening ENEMY_FIRE_GRACE seconds, which is what stops a fresh run from opening under fire.
//
// The death step is where a run's numbers move: kills, credits, XP, the milestone banners, and the loot
// roll. Two RNG draws hang off it and both are replay contract (DECISIONS §73): the per-kill drop roll
// happens ONLY when the last-kill reward drop did not, and it stays the last draw of the step.
//
// See docs/plans/server-authoritative-sim.md (Slice B3d).
import { Vec3 } from './vec.js';
import { shieldRecharge } from './components.js';
import { headingToDir, shortestAngleDelta, steerToward, enemyThrustFactor } from './steering.js';
import { updateGroups } from './ship-entity.js';
import { despawnAt } from './spawn.js';
import { simRandom } from './sim-random.js';
import { isLastKillDrop } from './level-sim.js';
import { spawnDrop, ownsReward } from './drops-sim.js';
import { DROP_CHANCE, WEIGHT_FALLBACK, pickLoot } from './drops-config.js';
import { showBanner } from './events.js';
import { nearestHostileTarget } from './targeting.js';

let warnedWeight = false;
function warnMissingWeight() {
  if (!warnedWeight) { warnedWeight = true; console.warn('drops: item has no weight — using WEIGHT_FALLBACK'); }
}

const DRAG = 1.8;           // friction (enemies)
const ENEMY_FIRE_GRACE = 5; // seconds at run start during which enemies move/aim but hold fire

function forwardVec(heading) {
  // nose points in +Z when heading=0 (math lives in steering.js)
  const d = headingToDir(heading);
  return new Vec3(d.x, 0, d.z);
}

export function stepEnemyAI(world, dt) {
  const player = world.player;
  for (const e of world.enemies) {
    // spawn animation: grow from a dot to full size over the enemy's warp duration (ease-out). While
    // warping the enemy is invulnerable + can't fire + isn't homing-targetable (guards below); the
    // duration is its stagger interval so "the delay IS the arrival animation" (DECISIONS §54).
    if (e.spawnAge < e.spawnDur) {
      e.spawnAge = Math.min(e.spawnDur, e.spawnAge + dt);
      const t = e.spawnAge / e.spawnDur;
      const k = 1 - Math.pow(1 - t, 3); // ease-out cubic
      e.scale = e.fullScale * Math.max(0.001, k);
      if (e.spawnAge >= e.spawnDur) e.warping = false; // fully formed: now a normal combatant
    }

    // --- enemy shield: recharge only once fully depleted, then refill to full (same rule as the player).
    // NOTE: the timer runs from the BREAKING hit and keeps banking under continuous fire — hull damage
    // never resets it (see DECISIONS §76).
    if (e.shield) {
      const wasBroken = e._shieldValue <= 0;
      const s = shieldRecharge(e._shieldValue, e.shield.capacity, e.shield.rechargeSec, dt, e._shieldRechargeAccum);
      e._shieldValue = s.shieldValue; e._shieldRechargeAccum = s.accum;
      if (wasBroken && s.shieldValue > 0) world.enemyShieldRefills++; // diagnostic counter (replay triage)
    }

    // THE PLAYER IS DEAD: cut the engines and hold fire. There is nothing left to chase and nobody left to
    // shoot, and a wreck being pounded on the "Ship Destroyed" screen — complete with the sounds — reads as
    // the game not having noticed. They coast to a stop on their own drag instead of freezing, so the scene
    // settles rather than stopping dead.
    //
    // Single-player never reaches this: `update()` returns early once the ship is gone, so its loop stops
    // before anything can be seen. The rule lives here anyway, because there is one simulation and the room
    // keeps stepping.
    if (!player.alive) {
      e.vel.multiplyScalar(Math.max(0, 1 - DRAG * dt));
      e.pos.addScaledVector(e.vel, dt);
      e.thrusting = false;
      continue;
    }

    // WHO THIS SHIP IS FIGHTING: the nearer of the player and any ally. With no ally in the world this is
    // `world.player` verbatim, so every shipped level and every recorded trace is unchanged (§73).
    const target = nearestHostileTarget(world, e.pos) || player;
    const toTarget = target.pos.clone().sub(e.pos);
    const dist = toTarget.length();
    toTarget.normalize();

    // target angle toward whoever it picked
    const desired = Math.atan2(toTarget.x, toTarget.z);
    const diff = shortestAngleDelta(e.heading, desired); // used below for aim checks
    e.heading = steerToward(e.heading, desired, e.turnRate * dt);

    const ef = forwardVec(e.heading);
    // keep distance ~20: close in from afar, back off if too close
    const thrust = enemyThrustFactor(dist);
    e.vel.addScaledVector(ef, e.acceleration * thrust * dt);
    e.vel.multiplyScalar(Math.max(0, 1 - DRAG * dt));
    if (e.engine.maxSpeed && e.vel.length() > e.engine.maxSpeed) e.vel.setLength(e.engine.maxSpeed);

    e.pos.addScaledVector(e.vel, dt); // no arena clamp: enemies chase the player out of bounds

    // engine trail: same exhaust behavior as the player, when thrusting forward
    e.thrusting = thrust > 0.1;

    // fire each group whose AI rule (range + aim tolerance) is satisfied — and only after the opening grace
    updateGroups(world, e, ef, 'enemy', dt,
      (g) => !e.warping && world.combatElapsed >= ENEMY_FIRE_GRACE && g.ai && dist < g.ai.range && Math.abs(diff) < g.ai.aimTol,
      target);            // …and its rockets home on whoever it is flying at
  }
}

// The catalog row behind a drop. Resolving it used to be the client's job (drops.js looked the weight up
// before calling into sim-core); the World carries the catalog now, so the simulation resolves it itself
// and a headless run drops the same items at the same weights.
const catalogRow = (world, item) =>
  item.kind === 'component' ? world.catalog.components.get(item.refId) : world.catalog.weapons.get(item.refId);

export function stepEnemyDeaths(world) {
  const enemies = world.enemies;
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].hp <= 0) {
      // colorful death burst: sized to the ship, tinted by its engine's exhaust color
      const e = enemies[i];
      // Bosses go up bigger + in stages (secondary detonation + expanding rings); everyone else = the
      // standard flipbook fireball + one ring.
      const isBoss = e.role === 'boss' || e.role === 'boss2';
      const reward = e.reward || 0;
      const xp = e.xp || 0;
      // WHO KILLED IT decides only the money. Progress does not care: `world.kills` counts every death, or a
      // level with `advanceWhen: {kills:8}` whose ally took three would never advance and the HUD would
      // freeze over an empty sector (docs/plans/combat-ally.md §2.5). Last hit wins.
      const byAlly = e.lastHitBy === 'ally';
      // ONE event carries everything the presentation needs — every value copied, because by the time the
      // adapter runs this entity is already spliced out of `enemies`.
      world.events.emit({
        type: 'kill', pos: e.pos.clone(), isBoss, exhaustColor: e.engine.exhaust.color,
        sizeScale: e.sizeScale || 1, role: e.role, shipClass: e.class,
        reward: byAlly ? 0 : reward, xp: byAlly ? 0 : xp, byAlly, name: e.name,
      });

      despawnAt(world, 'enemy', enemies, i);
      world.kills++;              // count (drives level thresholds + HUD) — EVERY death, whoever landed it
      if (byAlly) world.allyKills++; // DIAGNOSTIC: the wingman's share of this run (nothing in the sim reads it)
      // "N enemies left" banner at the 10- and 5-remaining milestones (once each, only when the level's
      // total is known). kills increments by 1, so `left` lands on each value exactly once.
      if (world.enemyTotal > 0) {
        const left = world.enemyTotal - world.kills;
        if ((left === 10 || left === 5) && !world.firedBanners.has(left)) {
          world.firedBanners.add(left);
          showBanner(world, 'ui.banner.enemies_left', { count: left });
        }
      }
      world.earned += byAlly ? 0 : reward;   // credits (reward for this ship type) — an ALLY kill pays nothing
      world.earnedXp += byAlly ? 0 : xp;     // character experience (banked with the run at /api/games)
      // reward drop: the LAST enemy of a level that carries a lastKillDrop drops the reward model (cosmetic —
      // no stash deposit; the real copy is server-installed on victory), but only if the player doesn't already
      // own it. Otherwise fall back to the usual 20% metal-box loot roll (one of the enemy's non-hull parts /
      // mounted weapons the grab can pull in — deposited on victory; hulls never drop).
      const lvl = world.levelRunner.level;
      const lkd = lvl && lvl.lastKillDrop;
      if (lkd && isLastKillDrop({ kills: world.kills, enemyTotal: world.enemyTotal }) && !ownsReward(world, lkd)) {
        // A reward the catalog does not carry is skipped entirely (it has no model and no weight) — the
        // same early-out drops.js made when it could not resolve the row.
        const cat = catalogRow(world, lkd);
        if (cat && !spawnDrop(world, e.pos, lkd, cat.weight || WEIGHT_FALLBACK, true)) {
          console.warn('drops: cap reached, skipping reward drop');
        }
      } else if (simRandom() < DROP_CHANCE) {   // GAMEPLAY draw (does this kill drop loot?)
        const loot = pickLoot(e);
        if (loot) {
          const cat = catalogRow(world, loot);
          if (!cat || !cat.weight) warnMissingWeight();
          if (!spawnDrop(world, e.pos, loot, (cat && cat.weight) || WEIGHT_FALLBACK)) {
            console.warn('drops: cap reached, skipping');
          }
        }
      }
    }
  }
}
