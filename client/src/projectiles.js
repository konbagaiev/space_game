// Projectiles & combat FX: bullets, micro-explosions, the layered ship-death burst (fireball + sparks
// + shockwave), engine exhaust trail, homing rockets and rocket smoke. Spawners push into the shared
// pools in state.js (drained by the update loop) and add meshes to the combat scene. Particle counts
// are gated by the live graphics tier (G.gfx) to cap fill-rate on weak phones.
//
// RNG CONTRACT: the cosmetic FX in here draw the NATIVE `Math.random` on purpose — never `simRandom()`.
// Gameplay-affecting randomness lives in `sim-random.js`; keeping FX out of the seeded stream is what makes
// the recorded intro/replays survive FX changes (DECISIONS §73). Spark/exhaust/smoke counts are also gated on
// the graphics tier, so seeding them would make a trace device-dependent as well.
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, bullets, explosions, sparks, shockwaves, rockets, smoke, enemies, BULLET_PLANE_Y } from './state.js';
import { audio, sfxFor } from './sound-routing.js';
import { pointHitsShip } from './collision.js';
import { applyPlayerDamage } from './components.js';
import { registerShieldImpact } from './shield-fx.js';
import { spawnFlipbookExplosion } from './flipbook-fx.js';
import { makeBolt } from './bolt-fx.js';
import { attachShipExhaust } from './exhaust-fx.js';

// applyPlayerDamage (shield-first damage routing) lives in components.js alongside absorbDamage —
// it's pure shield logic; keeping it there makes it unit-testable without pulling in the FX/engine deps.

// ---------- Shield hit → ripple on the shield bubble (variant B) ----------
// When an incoming hit is absorbed by the player's shield, the shield BUBBLE (shield-fx.js) flashes and
// ripples outward from the impact point. This thin wrapper keeps the damage sites decoupled from the FX
// module; the actual bubble mesh + shader live in shield-fx.js.
export function spawnShieldHit(pos, broke = false) {
  registerShieldImpact(pos, broke);
}

// ---------- Projectiles ----------
// bullets moved to src/state.js
export const bulletGeo = new THREE.SphereGeometry(0.28, 8, 8);

export function spawnBullet(from, dir, weapon, fromPlayer, shooterVel) {
  // velocity = projectile speed along the nose + ship velocity (inherited)
  const vel = dir.clone().normalize().multiplyScalar(weapon.projectileSpeed);
  if (shooterVel) vel.add(shooterVel);
  // Kinetic fire = a glowing, travel-aligned energy bolt + a quick muzzle flash at the barrel; other
  // classes keep the plain sphere. Both are a single Mesh with one material (disposed on despawn in
  // sim.js). No Math.random → replay-safe (bolt orientation is derived from the constant velocity).
  let m;
  if (weapon.class === 'kinetic') {
    m = makeBolt(weapon.projectileColor, vel);
    spawnMuzzleFlash(from, weapon.projectileColor);
  } else {
    m = new THREE.Mesh(bulletGeo, new THREE.MeshBasicMaterial({ color: weapon.projectileColor }));
  }
  m.position.copy(from);
  scene.add(m);
  // despawn by distance traveled (maxRange), not time
  bullets.push({ mesh: m, vel, traveled: 0, maxRange: weapon.maxRange ?? 88, fromPlayer, damage: weapon.power, class: weapon.class });
}

// Quick bright additive pop at the gun barrel on each kinetic shot — reuses the micro-explosion flash
// (round, short-lived), tinted by the weapon color to match the bolt.
function spawnMuzzleFlash(pos, color) {
  spawnExplosion(pos, 1.7, 0.06, color);
}

// Scale a particle count by the current graphics tier (additive overdraw is the mobile fill-rate
// cost). Reads the live `gfx`, so a tier switch affects subsequent spawns immediately. Min 1.
const scaledCount = (n) => Math.max(1, Math.round(n * G.gfx.particleScale));

// Live count of the high-volume additive particles (burst sparks + rocket smoke). The hard ceiling
// `G.gfx.maxParticles` (Infinity off High/Balance) skips new emits when over budget — caps both
// fill-rate overdraw and per-frame JS on the weakest phones. The engine exhaust is no longer a growing
// particle pool (it's a fixed-cost attached plume, exhaust-fx.js), so it isn't counted here.
export const liveParticles = () => sparks.length + smoke.length;

// ---------- Micro-explosions at the impact point ----------
// explosions moved to src/state.js
const EXPLOSION_LIFE = 0.16; // very short flash, sec
export const explosionGeo = new THREE.SphereGeometry(1, 10, 10);

export function spawnExplosion(pos, maxScale = 3, life = EXPLOSION_LIFE, color = 0xffb050) {
  // glowing fiery sphere: additive blending + fade-out (life/color tunable so the same
  // primitive serves a quick hit-flash and a slower, layered ship-death fireball).
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(explosionGeo, mat);
  m.position.copy(pos);
  m.scale.setScalar(0.6);
  scene.add(m);
  explosions.push({ mesh: m, life, maxLife: life, maxScale });
}

// Bullet hit-flash size by weapon class — a tiny kinetic spark vs. a heavier (still small) cannon
// flash. Unset/kinetic → the small spark. Color stays the default 0xffb050 (see spawnExplosion).
export const HIT_FLASH_SCALE = { kinetic: 0.8, cannon: 2 };

// ---------- Ship destruction: a big, colorful burst (layered fireball + sparks + shockwave) ----------
// Much louder than the hit-flash: stacked fireballs (white-hot core -> exhaust-colored glow ->
// orange -> red cloud), a radial spray of sparks, and a flat shockwave ring on the arena plane.
// Scaled by the ship's size (sizeScale) and tinted by its engine's exhaust color.
// sparks moved to src/state.js
const sparkGeo = new THREE.SphereGeometry(1, 6, 6);
// warm ember palette; a few sparks take the engine's exhaust color for variety
const SPARK_COLORS = [0xffffff, 0xfff0a0, 0xffd040, 0xff8030, 0xff3020];
// shockwaves moved to src/state.js
const shockGeo = new THREE.RingGeometry(0.78, 1, 28); // unit ring, scaled up as it expands

export function spawnShipExplosion(pos, exhaustColor = 0xff8030, sizeScale = 1, ringY = BULLET_PLANE_Y) {
  const s = sizeScale; // scales every spatial dimension to the ship's size
  // Fireball: a single flipbook (sprite-sheet) quad — one draw call, one shared texture — replaces the
  // old stack of 4 additive fireball spheres. The sparks + shockwave below stay (they add outward
  // motion the flat flipbook lacks). See flipbook-fx.js + DECISIONS §72 (v2 FX-polish sandbox).
  spawnFlipbookExplosion(pos, s);

  // Radial spark spray: warm embers + a few in the engine's exhaust color, flung outward.
  // Clamp to the live-particle budget so a death mid-fight can't blow past the ceiling on the lowest tier.
  const N = Math.max(0, Math.min(scaledCount(22), G.gfx.maxParticles - liveParticles()));
  for (let i = 0; i < N; i++) {
    const col = (i % 4 === 0) ? exhaustColor : SPARK_COLORS[i % SPARK_COLORS.length];
    const mat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const m = new THREE.Mesh(sparkGeo, mat);
    m.position.copy(pos);
    const size = (0.35 + Math.random() * 0.5) * s;
    m.scale.setScalar(size);
    scene.add(m);
    const a = (i / N) * Math.PI * 2 + Math.random() * 0.5;       // spread around the circle
    const sp = (14 + Math.random() * 26) * s;                    // outward speed scales with size
    const vel = new THREE.Vector3(Math.cos(a) * sp, (Math.random() - 0.5) * 6 * s, Math.sin(a) * sp);
    sparks.push({ mesh: m, vel, life: 2.7 + Math.random() * 2.7, maxLife: 5.4, size });
  }

  // Shockwave: a flat additive ring (tinted by the exhaust color) that expands and fades. It's one big
  // DoubleSide additive quad per death — skip it on the lowest tier to cut overdraw.
  if (G.gfx.particleScale >= 0.5) {
    const ringMat = new THREE.MeshBasicMaterial({
      color: exhaustColor, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(shockGeo, ringMat);
    ring.position.copy(pos); ring.position.y = ringY; // flat ring on the combat plane by default; a below-plane ghost death passes its own depth
    ring.rotation.x = -Math.PI / 2; // lay it flat on the arena
    scene.add(ring);
    shockwaves.push({ mesh: ring, life: 2.4, maxLife: 2.4, maxScale: 22 * s });
  }
}

// ---------- Rocket detonation: a small, fast layered burst ----------
// Same structure as spawnShipExplosion (fireball layers + a few sparks + a shockwave ring) but
// shrunk and quick, so a rocket blast reads as a proper explosion rather than one glowing sphere.
// Size (R), tint and speed all come from the rocket's weapon stats (blastVisual / blastTint /
// blastTimeScale) — see catalog_seed.js. timeScale scales every lifetime (<1 = quicker burst).
// Reuses the same particle pools + tier gating as the ship burst (no sim.js changes needed).
export function spawnRocketBurst(pos, blastVis = 4.5, tint = 0xffb050, timeScale = 1) {
  const R = blastVis;
  const T = timeScale; // multiplies every burst lifetime; keeps the tuned relative timing, just faster/slower
  // Layered fireball: white-hot core -> tinted glow -> orange outer cloud, each bigger, slower, dimmer.
  spawnExplosion(pos, R * 0.5, 0.40 * T, 0xffffff);                                // white-hot core (always)
  if (G.gfx.particleScale >= 0.7) spawnExplosion(pos, R * 0.8, 0.65 * T, tint);    // tinted glow
  spawnExplosion(pos, R * 1.15, 0.90 * T, 0xff5a20);                               // orange outer cloud (always)

  // A few warm sparks flung outward, clamped to the live-particle budget (like the ship burst).
  const N = Math.max(0, Math.min(scaledCount(8), G.gfx.maxParticles - liveParticles()));
  const s = R / 6; // spatial scale relative to the biggest rocket
  for (let i = 0; i < N; i++) {
    const col = SPARK_COLORS[i % SPARK_COLORS.length];
    const mat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const m = new THREE.Mesh(sparkGeo, mat);
    m.position.copy(pos);
    const size = (0.2 + Math.random() * 0.3) * s;
    m.scale.setScalar(size);
    scene.add(m);
    const a = (i / N) * Math.PI * 2 + Math.random() * 0.5;
    const sp = (8 + Math.random() * 14) * s;
    const vel = new THREE.Vector3(Math.cos(a) * sp, (Math.random() - 0.5) * 4 * s, Math.sin(a) * sp);
    sparks.push({ mesh: m, vel, life: (0.5 + Math.random() * 0.6) * T, maxLife: 1.1 * T, size });
  }

  // Flat shockwave ring (tier-gated like the ship burst) — small + short-lived.
  if (G.gfx.particleScale >= 0.5) {
    const ringMat = new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(shockGeo, ringMat);
    ring.position.copy(pos); ring.position.y = BULLET_PLANE_Y; // keep the flat ring on the combat plane
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    shockwaves.push({ mesh: ring, life: 0.85 * T, maxLife: 0.85 * T, maxScale: R * 2.2 });
  }
}

// ---------- Engine trail (exhaust is part of the engine) ----------
// Each ship carries ONE shared exhaust plume (exhaust-fx.js), lazily attached + parented to its mesh so it
// streams rigidly straight along the ship's aft -Z (the old curved position-history trail is gone —
// deliberate trade-off, DECISIONS §74). This is now a fixed-cost render object, not a growing particle
// pool: emitExhaust just flags "thrusting this frame" and the plume fades in/out (updateShipExhaust).
export function emitExhaust(mesh, fwd, shipVel, exhaust) {
  const plume = attachShipExhaust(mesh, exhaust); // lazily builds + caches on mesh.userData.exhaustPlume
  plume.throttleTarget = 1;                        // decayed toward 0 each frame in updateShipExhaust
  // fwd/shipVel are unused now (orientation comes from the parent mesh); kept in the signature so the
  // sim.js call sites (player/enemy thrust) stay unchanged.
}

// ---------- Rockets (homing) ----------
// rockets moved to src/state.js
const rocketGeo = new THREE.ConeGeometry(0.6, 2.4, 8); // nose in +Z (like the ship)
// Spiral-rocket warhead: slimmer + sharper than the standard rocket, brighter emissive tint so the
// three visible rockets read as a distinct weapon. Built procedurally (no .glb).
const spiralRocketGeo = new THREE.ConeGeometry(0.34, 2.0, 6);

// Find the nearest enemy in the front sector [fwd +/- halfAngle].
export function findTargetInSector(pos, fwd, halfAngle) {
  let best = null, bestDist = Infinity;
  for (const e of enemies) {
    if (e.warping) continue; // not a valid homing target until fully formed
    const to = e.mesh.position.clone().sub(pos);
    const d = to.length();
    if (d < 0.001) continue;
    to.divideScalar(d);
    if (fwd.dot(to) >= Math.cos(halfAngle) && d < bestDist) { best = e; bestDist = d; }
  }
  return best;
}

export function spawnRocket(from, fwd, weapon, accel, fromPlayer, target) {
  if (weapon.spiral) return spawnSpiralRocket(from, fwd, weapon, accel, fromPlayer, target);
  const mat = new THREE.MeshBasicMaterial({ color: weapon.projectileColor });
  const m = new THREE.Mesh(rocketGeo, mat);
  m.rotation.x = Math.PI / 2; // cone points along +Z
  const holder = new THREE.Group(); // to steer by heading around Y
  holder.add(m);
  holder.position.copy(from);
  scene.add(holder);
  // start direction - strictly along the ship's nose (without the ship's inertia)
  const vel = fwd.clone().multiplyScalar(weapon.launchSpeed);
  rockets.push({
    obj: holder, vel, accel, turnRate: weapon.turnRate,
    target, fromPlayer,
    damage: weapon.power, detonateR: weapon.detonateRadius,
    blastR: weapon.blastRadius, blastVis: weapon.blastVisual,
    blastTime: weapon.blastTimeScale, blastTint: weapon.blastTint, // detonation-FX speed + tint (data-driven; undefined → spawnRocketBurst defaults)
    sfxExplode: sfxFor('weapon', weapon.class, 'explode'), // detonation sound (DB map); resolved once at spawn
    hp: weapon.health ?? 1,                              // HP: reduced by bullet damage, shot down at 0
    traveled: 0, maxRange: weapon.maxRange ?? 120,       // self-destructs at max flight range
  });
}

// Triple spiral rocket: an invisible leader (homing, no damage, not shootable) + 3 visible rockets that
// orbit its flight axis in a corkscrew. Each visible rocket deals damage, has HP, detonates on its own
// proximity, and can be shot down. All entries share the `rockets` pool.
function spawnSpiralRocket(from, fwd, weapon, accel, fromPlayer, target) {
  // Leader: invisible frame. Reuses the rocket steering fields; `lead:true` marks it non-damaging /
  // non-shootable; `children` counts live orbiters so the leader expires when the last one is gone.
  const leadObj = new THREE.Group();
  leadObj.position.copy(from);
  scene.add(leadObj); // no mesh child → invisible; still moved/steered by sim.js
  const leadVel = fwd.clone().multiplyScalar(weapon.launchSpeed);
  const leader = {
    obj: leadObj, vel: leadVel, accel, turnRate: weapon.turnRate,
    target, fromPlayer, lead: true, children: 3, spiralPhase: 0,
    traveled: 0, maxRange: weapon.maxRange ?? 150,
  };
  rockets.push(leader);
  // Three visible rockets, 120° apart, each a real rocket that rides the leader.
  const sfxExplode = sfxFor('weapon', weapon.class, 'explode');
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: weapon.projectileColor });
    const m = new THREE.Mesh(spiralRocketGeo, mat);
    m.rotation.x = Math.PI / 2; // cone points +Z
    const holder = new THREE.Group();
    holder.add(m);
    holder.position.copy(from);
    scene.add(holder);
    rockets.push({
      obj: holder, vel: leadVel.clone(), fromPlayer,
      spiralOf: leader, spiralPhaseOffset: i * (Math.PI * 2 / 3),
      damage: weapon.power, detonateR: weapon.detonateRadius,
      blastR: weapon.blastRadius, blastVis: weapon.blastVisual,
      blastTime: weapon.blastTimeScale, blastTint: weapon.blastTint,
      sfxExplode, hp: weapon.health ?? 1,
      traveled: 0, maxRange: weapon.maxRange ?? 150,
    });
  }
}

// dealDamage=false - the rocket was shot down by gunfire (explosion without damage)
// INVARIANT: only ever called on VISIBLE rockets (normal rockets + spiral warheads). The spiral leader
// (r.lead) carries no mesh child / blast fields and self-removes in sim.js — it is never passed here.
export function detonateRocket(r, dealDamage = true) {
  if (dealDamage) {
    // Blast damage is HULL-relative (within blastR of the multi-sphere hitbox), matching the hull-relative
    // detonation trigger in sim.js — a center-distance test used to miss because the detonation point sits
    // off the ship's center (on a nose/tail/wing sphere), so a rocket could detonate yet damage nobody.
    // blastR (≥ detonateR) means a rocket that reaches a hull always deals its damage. See DECISIONS §45.
    if (r.fromPlayer) {
      for (const e of enemies) {
        if (e.warping) continue; // invulnerable while forming — no splash damage
        if (pointHitsShip(e, r.obj.position, r.blastR)) e.hp -= r.damage;
      }
    } else if (G.player.alive && pointHitsShip(G.player, r.obj.position, r.blastR)) {
      const dr = applyPlayerDamage(G.player, r.damage);
      if (dr.absorbed) spawnShieldHit(r.obj.position, dr.broke);
    }
  }
  spawnRocketBurst(r.obj.position, r.blastVis, r.blastTint, r.blastTime); // small, fast layered burst (params from the rocket's weapon stats)
  audio.sfx.explosion(0.7, r.sfxExplode, 0.3); // rocket blast — 70% quieter (sampled via the weapon-class map)
  scene.remove(r.obj);
  r.obj.children[0].material.dispose();
}

// Rocket smoke trail: a thin, dissipating haze LINE — small fixed-size gray puffs that only fade out
// (no expansion), emitted densely along the flight path so the trail reads as a vapor line, not a cone.
// smoke moved to src/state.js
const smokeGeo = new THREE.SphereGeometry(1, 6, 6);
export function spawnSmoke(pos) {
  if (liveParticles() >= G.gfx.maxParticles) return;                 // respect the hard ceiling (weak phones)
  if (G.gfx.particleScale < 1 && Math.random() > G.gfx.particleScale) return; // thin on lower tiers
  const mat = new THREE.MeshBasicMaterial({
    color: 0x9aa6b4, transparent: true, opacity: 0.4, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(smokeGeo, mat);
  m.position.copy(pos);
  const size = 0.32 + Math.random() * 0.12; // small, fixed — no growth
  m.scale.setScalar(size);
  scene.add(m);
  smoke.push({ mesh: m, life: 0.5, maxLife: 0.5, baseSize: size });
}
