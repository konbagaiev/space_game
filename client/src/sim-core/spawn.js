// Projectile constructors: the DATA half of spawning a bullet or a rocket.
//
// A projectile is two things — the numbers that decide what it does (where it is, how fast, how much
// damage, how far it flies) and the Three.js object that lets you see it. Those used to be born together
// in `projectiles.js`, which meant no shot could exist without a scene graph. The numbers live here; the
// body is attached by the World's host (`world.host.onSpawn`), and a headless authority simply has no host
// worth speaking of.
//
// Everything returned is plain data with copied vectors. Note especially what is NOT here: no mesh, no
// material, and no `sfxExplode`. That last one used to be resolved at spawn time via `sfxFor(...)` and
// stored on the rocket — a client sound-map lookup baked into simulation state. The rocket now carries its
// `weaponClass` and the client resolves the sound when it actually detonates.
//
// See docs/plans/server-authoritative-sim.md (Slice B3).
import { Vec3 } from './vec.js';
import { pointHitsShip } from './collision.js';
import { applyShieldedDamage } from './components.js';

// A bullet: straight flight, no steering, culled by distance travelled rather than time.
// `shooterVel` is the firing ship's velocity — bullets inherit it (rockets deliberately do not, §70).
//
// `fromAlly` — WHO on the friendly side fired this. It exists for exactly one rule: an ally's kill pays no
// credits and no XP (docs/plans/combat-ally.md §2.5). It never crosses the wire: nothing is drawn
// differently. `fromPlayer` stays "fired by the FRIENDLY SIDE" and is what damage routing reads.
export function makeBullet(from, dir, weapon, fromPlayer, shooterVel, fromAlly = false) {
  const vel = new Vec3(dir.x, dir.y, dir.z).normalize().multiplyScalar(weapon.projectileSpeed);
  if (shooterVel) vel.add(shooterVel);
  return {
    pos: new Vec3(from.x, from.y, from.z),
    vel,
    traveled: 0,
    maxRange: weapon.maxRange ?? 88,
    fromPlayer,
    fromAlly,
    damage: weapon.power,
    class: weapon.class,
    projectileColor: weapon.projectileColor, // presentation, carried so the host needs no catalog lookup
  };
}

// Fields every damaging rocket shares — a normal one and a spiral warhead differ only in how they steer.
function rocketBody(from, weapon, fromPlayer, maxRangeDefault, fromAlly = false) {
  return {
    pos: new Vec3(from.x, from.y, from.z),
    fromPlayer,
    fromAlly,
    damage: weapon.power,
    detonateR: weapon.detonateRadius,
    blastR: weapon.blastRadius,
    blastVis: weapon.blastVisual,
    // detonation-FX speed + ring tint + fireball brightness (data-driven; undefined → spawnRocketBurst defaults)
    blastTime: weapon.blastTimeScale,
    blastTint: weapon.blastTint,
    blastBright: weapon.blastBright,
    weaponClass: weapon.class,       // the client resolves the detonation sound from this, at detonation
    projectileColor: weapon.projectileColor,
    hp: weapon.health ?? 1,          // reduced by bullet damage; shot down at 0
    traveled: 0,
    maxRange: weapon.maxRange ?? maxRangeDefault,
  };
}

// A homing rocket. Launch direction is strictly the ship's nose with NO inherited inertia — realistic
// velocity inheritance was tried and rejected as unplayable (DECISIONS §70).
export function makeRocket(from, fwd, weapon, accel, fromPlayer, target, fromAlly = false) {
  const vel = new Vec3(fwd.x, fwd.y, fwd.z).multiplyScalar(weapon.launchSpeed);
  return {
    ...rocketBody(from, weapon, fromPlayer, 120, fromAlly),
    vel,
    heading: Math.atan2(vel.x, vel.z),
    accel,
    turnRate: weapon.turnRate,
    target,
  };
}

// Triple spiral rocket: one INVISIBLE leader that homes, plus three visible warheads that ride its flight
// axis in a corkscrew. The leader carries no damage and cannot be shot down; `children` counts live
// orbiters so it expires once the last one is gone. Returns [leader, ...warheads] in push order — the
// caller adds them all to `world.rockets` and gives each a body.
export function makeSpiralVolley(from, fwd, weapon, accel, fromPlayer, target, fromAlly = false) {
  const leadVel = new Vec3(fwd.x, fwd.y, fwd.z).multiplyScalar(weapon.launchSpeed);
  const heading = Math.atan2(leadVel.x, leadVel.z);
  const leader = {
    pos: new Vec3(from.x, from.y, from.z),
    vel: leadVel,
    heading,
    accel,
    turnRate: weapon.turnRate,
    target,
    fromPlayer,
    fromAlly,           // carried on the leader too; harmless (it deals no damage and kills nothing)
    lead: true,
    children: 3,
    spiralPhase: 0,
    traveled: 0,
    maxRange: weapon.maxRange ?? 150,
  };
  const warheads = [];
  for (let i = 0; i < 3; i++) {
    warheads.push({
      ...rocketBody(from, weapon, fromPlayer, 150, fromAlly),
      vel: leadVel.clone(),
      heading,
      spiralOf: leader,
      spiralPhaseOffset: i * (Math.PI * 2 / 3), // 120° apart
    });
  }
  return [leader, ...warheads];
}

// ---------- Spawning into a World ----------
// These are the calls the simulation makes. Each builds the entity's data, adds it to the World, and asks
// the host to give it a body — in the browser a Three.js object, on a server nothing at all. Despawning is
// the mirror: tell the host to let the body go, THEN drop the entity, because the host still needs the
// reference to dispose it.

export function spawnBullet(world, from, dir, weapon, fromPlayer, shooterVel, fromAlly = false) {
  const b = makeBullet(from, dir, weapon, fromPlayer, shooterVel, fromAlly);
  world.bullets.push(b);
  world.host.onSpawn('bullet', b);
  return b;
}

// A `spiral` weapon fires a whole volley (leader + 3 warheads) rather than one rocket.
export function spawnRocket(world, from, fwd, weapon, accel, fromPlayer, target, fromAlly = false) {
  const made = weapon.spiral
    ? makeSpiralVolley(from, fwd, weapon, accel, fromPlayer, target, fromAlly)
    : [makeRocket(from, fwd, weapon, accel, fromPlayer, target, fromAlly)];
  for (const r of made) {
    world.rockets.push(r);
    world.host.onSpawn('rocket', r);
  }
  return made;
}

// Remove `list[index]` and release its body. `kind` tells the host what it is disposing.
//
// `alive = false` is set for every kind, so "has this entity left the World?" is a fact the entity itself
// carries. Anything holding a reference to it — a pooled shield bubble bound to a ship, say — can ask it
// directly instead of probing the scene graph for a mesh that a headless host never created.
export function despawnAt(world, kind, list, index) {
  const e = list[index];
  e.alive = false;
  world.host.onDespawn(kind, e);
  list.splice(index, 1);
  return e;
}

// A rocket goes off: deal its blast damage, then say so. `dealDamage = false` is a rocket SHOT DOWN by
// gunfire — it still makes the bang, it just does not hurt anyone.
//
// Blast damage is HULL-relative (within blastR of the multi-sphere hitbox), matching the hull-relative
// detonation trigger in the rocket step. A centre-distance test used to miss, because the detonation point
// sits off the ship's centre — on a nose/tail/wing sphere — so a rocket could go off and damage nobody.
// blastR (>= detonateR) means a rocket that reaches a hull always deals its damage. See DECISIONS §45.
//
// This does NOT release the rocket's body: every rocket leaves the world through despawnAt(). Detonating
// and despawning are different things — a rocket that reaches its maxRange despawns without detonating.
export function detonateRocket(world, r, dealDamage = true) {
  if (dealDamage) {
    if (r.fromPlayer) {
      for (const e of world.enemies) {
        if (e.warping) continue; // invulnerable while forming — no splash damage
        if (pointHitsShip(e, r.pos, r.blastR)) {
          e.lastHitBy = r.fromAlly ? 'ally' : 'player'; // WHO gets paid for the kill (docs/plans/combat-ally.md §2.5)
          const dr = applyShieldedDamage(e, r.damage); // shield first, excess spills to the hull this tick
          if (dr.absorbed) world.events.emit({ type: 'enemyShieldHit', enemy: e, pos: r.pos.clone(), broke: dr.broke });
        }
      }
    } else {
      if (world.player && world.player.alive && pointHitsShip(world.player, r.pos, r.blastR)) {
        const dr = applyShieldedDamage(world.player, r.damage);
        if (dr.absorbed) world.events.emit({ type: 'shieldHit', pos: r.pos.clone(), broke: dr.broke });
      }
      // …and the third party. A blast splashes everyone hostile fire can reach, so the ally takes it too —
      // the loop is skipped entirely when there is no ally, which is every level that ships today.
      // `enemyShieldHit` is reused deliberately: it is the "bubble on THAT ship" event (it carries an entity
      // reference and is already id-swapped on the wire); `shieldHit` is specifically the player's own.
      for (const a of world.allies || []) {
        if (a.warping) continue;               // untouchable while forming (§54)
        if (!pointHitsShip(a, r.pos, r.blastR)) continue;
        const dr = applyShieldedDamage(a, r.damage);
        if (dr.absorbed) world.events.emit({ type: 'enemyShieldHit', enemy: a, pos: r.pos.clone(), broke: dr.broke });
      }
    }
  }
  world.events.emit({
    type: 'detonate', pos: r.pos.clone(), weaponClass: r.weaponClass,
    blastVis: r.blastVis, blastTint: r.blastTint, blastTime: r.blastTime, blastBright: r.blastBright,
  });
}
