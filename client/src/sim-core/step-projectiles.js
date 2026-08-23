// The projectile steps: how a bullet and a rocket spend their tick.
//
// Both were the busiest part of `sim.js` and the last big pieces still living beside the renderer. They
// take the World explicitly now, which is what lets the same code advance a fight in a browser and in Node.
//
// Notable rules preserved verbatim, because each was a bug once:
//   • bullets use a SWEPT test — the segment from where the bullet WAS to where it now IS — so a fast shot
//     cannot step clean over a thin wing between frames (DECISIONS §45).
//   • a warping enemy is untouchable: bullets pass through, rockets do not detonate on it (§54) — and the
//     same rule now covers a warping ALLY, who is a third party hostile fire can hit (DECISIONS §134).
//   • a hostile projectile tests the player FIRST, then every ally in list order; both loops are skipped
//     entirely when `world.allies` is empty, which is every level that ships today.
//   • the Maneuver dodge roll is drawn ONLY when dodge > 0, so a no-skill run consumes zero extra RNG and
//     every existing recording replays bit-identically (§73).
//   • a spiral volley's leader carries no hp and is never shootable; each warhead frees its slot on death.
//
// See docs/plans/server-authoritative-sim.md (Slice B3c).
import { Vec3 } from './vec.js';
import { steerToward, spiralOffset } from './steering.js';
import { applyShieldedDamage } from './components.js';
import { segmentHitsShip, pointHitsShip, resolveHostileBulletHit } from './collision.js';
import { simRandom } from './sim-random.js';
import { despawnAt, detonateRocket } from './spawn.js';

const _bulletP0 = new Vec3(); // reused: a bullet's pre-move position for the swept collision test
// Triple spiral rocket: warhead corkscrew around the leader's flight axis.
const SPIRAL_RADIUS = 1.4;  // orbit radius around the leader axis (world units)
const SPIRAL_ANGULAR = 6;   // rad/s — how fast the warheads corkscrew

export function stepBullets(world, dt) {
  // --- projectiles ---
  for (let i = world.bullets.length - 1; i >= 0; i--) {
    const b = world.bullets[i];
    // SWEPT test: capture the pre-move position, then test the whole movement segment [p0→p1] vs the hull
    // so a fast bullet (~1-3 world units/frame) can't tunnel through a thin box between frames.
    _bulletP0.copy(b.pos);
    b.traveled += b.vel.length() * dt;
    b.pos.addScaledVector(b.vel, dt);

    let hit = false;
    let absorbed = false;                 // this hit landed on a SHIELD → cyan flash instead of the orange spark
    if (b.fromPlayer) {
      for (const e of world.enemies) {
        if (e.warping) continue; // invulnerable while forming — world.bullets pass through
        if (segmentHitsShip(e, _bulletP0, b.pos)) {
          e.lastHitBy = b.fromAlly ? 'ally' : 'player'; // WHO gets paid for the kill (docs/plans/combat-ally.md §2.5)
          const dr = applyShieldedDamage(e, b.damage); // shield first, excess spills to the hull this tick
          if (dr.absorbed) { absorbed = true; world.events.emit({ type: 'enemyShieldHit', enemy: e, pos: b.pos.clone(), broke: dr.broke }); }
          hit = true; world.events.emit({ type: 'hit', target: 'enemy' }); break;
        }
      }
    } else {
      // Maneuver skill: on a geometric connect, evade with probability dodge/(100+dodge) (hit chance =
      // 100/(100+dodge-accuracy); accuracy is 0 until that skill ships). The RNG is drawn ONLY when
      // dodge>0, so a no-skill run — and every existing recording — consumes zero extra draws and replays
      // bit-identically (DECISIONS §73 opt-in-per-draw contract).
      const dodge = world.player.dodge || 0;
      const dodgeRoll = dodge > 0 ? () => simRandom() >= 100 / (100 + dodge) : null;
      const res = resolveHostileBulletHit(world.player, _bulletP0, b.pos, b.damage, dodgeRoll);
      if (res.hit) {
        hit = true;
        if (res.dodged) {
          world.events.emit({ type: 'evade', pos: world.player.pos.clone() }); // "EVADE" text, no damage/FX
        } else {
          if (res.impact) b.pos.copy(res.impact); // shield up → stop the bullet ON the sphere so its hit-flash lands there, not at the hull inside
          if (res.damageResult.absorbed) world.events.emit({ type: 'shieldHit', pos: b.pos.clone(), broke: res.damageResult.broke }); // cyan ripple where the shot connects with the shield
          world.events.emit({ type: 'hit', target: 'player', shipClass: world.player.class }); // sampled impact when OUR ship is struck
        }
      } else if (world.allies.length) {
        // The third party. Player first, then allies, in list order — deterministic, and skipped entirely
        // when there is no ally (which is every level that ships today).
        for (const a of world.allies) {
          if (!a.alive || a.warping) continue;   // untouchable while forming (§54); and a wingman already down is gone
          const ra = resolveHostileBulletHit(a, _bulletP0, b.pos, b.damage, null); // no dodge: the ally has no skills
          if (!ra.hit) continue;
          hit = true;
          if (ra.impact) b.pos.copy(ra.impact);
          if (ra.damageResult.absorbed) { absorbed = true; world.events.emit({ type: 'enemyShieldHit', enemy: a, pos: b.pos.clone(), broke: ra.damageResult.broke }); }
          world.events.emit({ type: 'hit', target: 'ally', shipClass: a.class });
          break;
        }
      }
    }

    // interception: a bullet damages an opposite-side rocket; it's shot down when its hp runs out
    if (!hit) {
      for (let j = world.rockets.length - 1; j >= 0; j--) {
        const r = world.rockets[j];
        if (r.lead) continue;                        // the invisible spiral leader has no hp — not shootable
        if (r.fromPlayer === b.fromPlayer) continue; // only world.rockets of the opposite side
        if (b.pos.distanceTo(r.pos) < 2.4) {
          r.hp -= b.damage;
          if (r.hp <= 0) { detonateRocket(world, r, false); if (r.spiralOf) r.spiralOf.children--; despawnAt(world, 'rocket', world.rockets, j); } // destroyed (a spiral warhead frees its leader slot)
          hit = true; break;                                                 // else it survives, takes another
        }
      }
    }

    // limited only by range/hits — world.bullets fly normally beyond the arena (no boundary culling)
    if (hit || b.traveled >= b.maxRange) {
      // Class-keyed hit-flash: a small flipbook mini-blast (kinetic spark / cannon flash). A hit ABSORBED
      // by a shield instead plays the same mini-blast smaller and tinted CYAN (SHIELD_HIT_TINT), so "the
      // field stopped it" reads differently from an orange hull hit while staying in the one FX family
      // (DECISIONS §75). spawnHitSprite draws no RNG → replay-safe either way.
      if (hit) world.events.emit({ type: 'bulletImpact', pos: b.pos.clone(), weaponClass: b.class, absorbed });
      despawnAt(world, 'bullet', world.bullets, i);
    }
  }
}

export function stepRockets(world, dt) {
  // --- world.rockets: homing (accelerate toward target), detonate near the enemy ---
  // Spiral-rocket volley = 1 invisible leader (r.lead: homes, no damage, no smoke) + 3 visible warheads
  // (r.spiralOf: ride the leader in a corkscrew, each a real rocket). A warhead freeing its slot decrements
  // the leader's `children`; the leader self-removes when the last is gone (or it hits maxRange).
  const removeRocket = (idx, r) => { if (r.spiralOf) r.spiralOf.children--; despawnAt(world, 'rocket', world.rockets, idx); };
  for (let i = world.rockets.length - 1; i >= 0; i--) {
    const r = world.rockets[i];

    if (r.lead) {
      // Invisible leader: home + move exactly like a normal rocket, but no smoke, no detonation.
      if (r.target && (r.fromPlayer ? !world.enemies.includes(r.target) : !r.target.alive)) r.target = null;
      if (r.target) {
        const to = r.target.pos.clone().sub(r.pos);
        const desired = Math.atan2(to.x, to.z);
        const cur = steerToward(Math.atan2(r.vel.x, r.vel.z), desired, r.turnRate * dt);
        const speed = r.vel.length() + r.accel * dt;
        r.vel.set(Math.sin(cur) * speed, 0, Math.cos(cur) * speed);
      }
      r.traveled += r.vel.length() * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.spiralPhase += SPIRAL_ANGULAR * dt;
      // Expire when out of range OR all children gone (children decremented on each warhead removal).
      if (r.traveled >= r.maxRange || r.children <= 0) despawnAt(world, 'rocket', world.rockets, i);
      continue;
    }

    if (r.spiralOf) {
      // Visible warhead: position = leader.pos + corkscrew offset; velocity tracked for orientation + smoke.
      const L = r.spiralOf;
      const axisV = L.vel.lengthSq() > 1e-4 ? L.vel.clone().normalize() : new Vec3(0, 0, 1);
      const o = spiralOffset({ x: axisV.x, y: axisV.y, z: axisV.z }, L.spiralPhase + r.spiralPhaseOffset, SPIRAL_RADIUS);
      const off = new Vec3(o.x, o.y, o.z);
      const prev = r.pos.clone();
      r.pos.copy(L.pos).add(off);
      const moved = r.pos.clone().sub(prev);
      r.vel.copy(moved).multiplyScalar(1 / Math.max(dt, 1e-4)); // for orientation + smoke direction
      r.traveled = L.traveled; // share the leader's range accounting
      if (r.vel.lengthSq() > 0.01) r.heading = Math.atan2(r.vel.x, r.vel.z);
      world.events.emit({ type: 'smoke', pos: r.pos.clone() }); // corkscrew trail: three offset helices (same fading-line puffs)
      // detonation/shoot-down handled by the shared block below (uses removeRocket → child-count decrement)
    } else {
      // Normal rocket: existing homing + move.
      // target lost: for a player rocket - if the enemy died; for an enemy one - if the player died
      if (r.target && (r.fromPlayer ? !world.enemies.includes(r.target) : !r.target.alive)) r.target = null;
      if (r.target) {
        // maneuver: turn the velocity vector toward the target (turnRate) + accelerate forward (accel)
        const to = r.target.pos.clone().sub(r.pos);
        const desired = Math.atan2(to.x, to.z);
        const cur = steerToward(Math.atan2(r.vel.x, r.vel.z), desired, r.turnRate * dt);
        const speed = r.vel.length() + r.accel * dt;
        r.vel.set(Math.sin(cur) * speed, 0, Math.cos(cur) * speed);
      }
      r.traveled += r.vel.length() * dt;
      r.pos.addScaledVector(r.vel, dt);
      if (r.vel.lengthSq() > 0.01) r.heading = Math.atan2(r.vel.x, r.vel.z);
      world.events.emit({ type: 'smoke', pos: r.pos.clone() }); // light smoke trail
    }

    let det = false;
    if (r.fromPlayer) {
      for (const e of world.enemies) {
        if (e.warping) continue; // no detonation on a forming enemy
        if (pointHitsShip(e, r.pos, r.detonateR)) { det = true; break; }
      }
    } else {
      if (world.player.alive && pointHitsShip(world.player, r.pos, r.detonateR)) det = true;
      else if (world.allies.length) {
        for (const a of world.allies) { if (a.alive && !a.warping && pointHitsShip(a, r.pos, r.detonateR)) { det = true; break; } }
      }
    }
    // limited only by range/detonation — world.rockets fly normally beyond the arena (no boundary culling)
    if (det || r.traveled >= r.maxRange) { detonateRocket(world, r); removeRocket(i, r); }
  }
}
