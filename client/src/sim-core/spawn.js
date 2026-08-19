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

// A bullet: straight flight, no steering, culled by distance travelled rather than time.
// `shooterVel` is the firing ship's velocity — bullets inherit it (rockets deliberately do not, §70).
export function makeBullet(from, dir, weapon, fromPlayer, shooterVel) {
  const vel = new Vec3(dir.x, dir.y, dir.z).normalize().multiplyScalar(weapon.projectileSpeed);
  if (shooterVel) vel.add(shooterVel);
  return {
    pos: new Vec3(from.x, from.y, from.z),
    vel,
    traveled: 0,
    maxRange: weapon.maxRange ?? 88,
    fromPlayer,
    damage: weapon.power,
    class: weapon.class,
    projectileColor: weapon.projectileColor, // presentation, carried so the host needs no catalog lookup
  };
}

// Fields every damaging rocket shares — a normal one and a spiral warhead differ only in how they steer.
function rocketBody(from, weapon, fromPlayer, maxRangeDefault) {
  return {
    pos: new Vec3(from.x, from.y, from.z),
    fromPlayer,
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
export function makeRocket(from, fwd, weapon, accel, fromPlayer, target) {
  const vel = new Vec3(fwd.x, fwd.y, fwd.z).multiplyScalar(weapon.launchSpeed);
  return {
    ...rocketBody(from, weapon, fromPlayer, 120),
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
export function makeSpiralVolley(from, fwd, weapon, accel, fromPlayer, target) {
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
    lead: true,
    children: 3,
    spiralPhase: 0,
    traveled: 0,
    maxRange: weapon.maxRange ?? 150,
  };
  const warheads = [];
  for (let i = 0; i < 3; i++) {
    warheads.push({
      ...rocketBody(from, weapon, fromPlayer, 150),
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

export function spawnBullet(world, from, dir, weapon, fromPlayer, shooterVel) {
  const b = makeBullet(from, dir, weapon, fromPlayer, shooterVel);
  world.bullets.push(b);
  world.host.onSpawn('bullet', b);
  return b;
}

// A `spiral` weapon fires a whole volley (leader + 3 warheads) rather than one rocket.
export function spawnRocket(world, from, fwd, weapon, accel, fromPlayer, target) {
  const made = weapon.spiral
    ? makeSpiralVolley(from, fwd, weapon, accel, fromPlayer, target)
    : [makeRocket(from, fwd, weapon, accel, fromPlayer, target)];
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
