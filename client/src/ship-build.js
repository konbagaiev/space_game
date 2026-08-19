// Ship building & weapons: resolve a DB ship's components/weapons/fire-groups into a live entity,
// build the player and spawn enemies, and drive the fire-group cooldown/volley logic. Bridges the
// catalog (state.CATALOG) + the pure derivation (components.js) + the ship factory + projectiles.
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, CATALOG, enemies, SPAWN_GROW_TIME, BULLET_PLANE_Y } from './state.js';
import { deriveDrive, skillEffects } from './sim-core/components.js';
import { shipModelCfg, modelSpec, makeShip, preloadShipModel } from './ship-factory.js';
import { resolveWeapon as resolveWeaponIn, resolveComponents as resolveComponentsIn,
         buildMounts as buildMountsIn, buildGroups, spawnEnemy as spawnEnemyIn,
         updateGroups as updateGroupsIn } from './sim-core/ship-entity.js';

// Advance a ship's fire groups in THIS tab's World. The firing logic itself is sim-core's (it decides what
// is spawned and emits `fire`); this only binds the World so the two call sites in sim.js are unchanged.
export const updateGroups = (ship, fwd, isPlayer, dt, wantsFire) =>
  updateGroupsIn(world, ship, fwd, isPlayer, dt, wantsFire);
import { world } from './state.js';                             // the World these shots are fired into
import { disposeShipExhaust } from './exhaust-fx.js'; // free the retired player mesh's attached plume on a ship swap
import { Vec3 } from './sim-core/vec.js';                 // sim transforms are plain vectors, not THREE.Vector3
import { SHIP_GROUP_SCALE } from './sim-core/consts.js';  // ship world scale = SHIP_GROUP_SCALE × sizeScale

// Catalog resolution lives in sim-core/ship-entity.js (a server has to do it too). These wrappers bind
// THIS tab's World so the long-standing call signatures — `resolveComponents(refs)` and friends — keep
// working for the shop and the player builder.
const resolveWeapon = (id) => resolveWeaponIn(world.catalog, id);
export const resolveComponents = (refs) => resolveComponentsIn(world.catalog, refs);
const buildMounts = (defs) => buildMountsIn(world.catalog, defs);

export function buildPlayer(active) {
  const s = active.ship.stats;
  const mc = shipModelCfg(s); // per-ship model presentation (yaw/scale + optional overrides)
  const { hull, engine, thruster, repair, grab, shield } = resolveComponents(active.components); // hull + engine + thrusters + repair drone + grab + shield
  // Character-progression skill effects. Only the player's REAL active ship carries skills; previews and
  // ?playback overrides pass none (skills == null → identity), so recordings reproduce the exact ship they
  // were made with and stay deterministic. resolveComponents/buildMounts return fresh objects, so scaling
  // engine/thruster/shield/weapon copies here never mutates the shared catalog.
  const fx = skillEffects(active.skills);
  if (engine) engine.power *= fx.mobilityMul;     // Mobility: +5%/pt engine power (→ acceleration)
  if (thruster) thruster.power *= fx.mobilityMul; // Mobility: +5%/pt thruster power (→ turn rate)
  if (shield) shield.capacity = Math.round(shield.capacity * fx.shieldMul); // Shields: +5%/pt capacity
  const p = {
    mesh: makeShip(s.color, modelSpec(active.ship.modelUrl, mc)),
    // --- SIM TRANSFORM (the authority; the mesh is a copy of it — see sim.js syncMeshes) ---
    pos: new Vec3(0, BULLET_PLANE_Y, 0), // world position on the canonical combat plane
    vel: new Vec3(),
    heading: 0,                       // rotation angle around Y
    scale: SHIP_GROUP_SCALE * mc.scale, // CURRENT uniform world scale (warp-in shrinks it); drives hitboxes + muzzle
    fullScale: SHIP_GROUP_SCALE * mc.scale, // the full-size scale to grow back into after a warp
    noseZ: mc.muzzle ?? 1.6,          // group-local muzzle offset from the catalog (1.6 = the primitive's cone nose)
    sizeScale: mc.scale,
    hitBoxes: mc.hitBoxes, broadR: mc.broadR, // per-part OBB hitbox (null on primitives → single-sphere fallback)
    class: s.class,                   // sound class (DB) → drives explode/hit SFX via sfxFor('ship', class, …)
    hull, engine, thruster, repair, grab, shield, // `repair` = repair-drone stats (or null); `grab` = tractor stats (or null); `shield` = base-shield stats { capacity, rechargeSec } or null — all feed mass
    _repairAccum: 0,                  // seconds banked toward the next repair tick (held for repairTick)
    _shieldValue: shield ? shield.capacity : 0, // current absorption remaining (starts full & active)
    _shieldRechargeAccum: 0,          // seconds banked while broken → drives recharge + HUD purple fill
    mounts: buildMounts(active.loadout.mounts), // resolved weapons; also feeds ship mass
    hp: hull ? hull.durability : 0, maxHp: hull ? hull.durability : 0, // hull may be unequipped in the hangar; the launchable gate blocks take-off
    alive: true,
    oobTime: 0,                  // seconds the ship has been continuously out of bounds (soft boundary)
    spawnAge: SPAWN_GROW_TIME,   // == full size: no warp-in animation on a fresh build (set to 0 to play it)
    spawnDur: SPAWN_GROW_TIME,   // warp-back duration
  };
  p.mesh.scale.setScalar(p.scale); // seed the render copy so the first frame is right (syncMeshes owns it after)
  // Kinetic/Rocket skills: clone each mounted weapon and scale the COPY (never the shared catalog object).
  for (const m of p.mounts) {
    const w = { ...m.weapon };
    if (w.type === 'rocket') {
      if (w.power != null) w.power *= fx.rocketDmgMul;               // Rocket: +5%/pt damage
      if (w.launchSpeed != null) w.launchSpeed *= fx.rocketSpeedMul; // Rocket: +5%/pt launch speed
    } else {
      if (w.power != null) w.power *= fx.kineticDmgMul;              // Kinetic: +5%/pt damage
      w.aimAssistDeg = (w.aimAssistDeg || 0) + fx.aimAssistBonusDeg; // Kinetic: +0.5°/pt aim-assist cone (additive)
    }
    m.weapon = w;
  }
  p.dodge = fx.dodge;                   // Maneuver: dodge % (0 = never dodges) — rolled in sim on a hostile hit
  p.rocketSpeedMul = fx.rocketSpeedMul; // Rocket: also scales the player's in-flight rocket accel (see fireMount)
  p.maxSpeedMul = fx.mobilityMul;       // Mobility: +5%/pt max speed (applied at the sim velocity clamp)
  p.groups = buildGroups(s.groups, p.mounts); // fire channels (gun / rocket / ...)
  deriveDrive(p); // acceleration <- engine power, turnRate <- engine turnPower, scaled by mass
  return p;
}

// (Re)build the player ship from a catalog ship row and swap it into the scene. For the player's
// *active* ship we use its persisted loadout/components (so a DB weapon swap from a level briefing
// actually takes effect); other (preview) ships fall back to their catalog defaults. G.currentShipName
// + G.activeShip live on the shared bag — written by the welcome/shop/account/net flows.
export function buildPlayerFor(ship, override = null) {
  if (G.player) { disposeShipExhaust(G.player.mesh); scene.remove(G.player.mesh); } // the retired mesh carries a parented plume → dispose its ShaderMaterials (GPU-leak guard)
  // `override` ({ loadout, components }) forces an EXACT build independent of the current account — used by
  // ?playback so a recording reproduces the ship+weapons it was MADE with, not whatever the player has equipped
  // now (e.g. a machine gun unlocked on a later level would otherwise leak into an intro-level playback).
  const useActive = !override && G.activeShip && G.activeShip.ship && G.activeShip.ship.name === ship.name;
  const loadout = override ? override.loadout : (useActive ? G.activeShip.loadout : { mounts: ship.stats.mounts });
  const components = override ? override.components : (useActive ? G.activeShip.components : ship.components);
  // Skills apply ONLY to the real active ship — never to previews or ?playback overrides (which must
  // reproduce the exact ship a recording was made with, keeping replays deterministic).
  const skills = (!override && useActive && G.activeShip.progression) ? G.activeShip.progression.skills : null;
  G.player = buildPlayer({ ship, loadout, components, skills });
  G.currentShipName = ship.name;
  scene.add(G.player.mesh);
}

// Build one enemy from a DB ship row (type 'enemy') into this tab's World. The entity's numbers come from
// sim-core; its Three.js body is attached by the host (see sim.js). Kept here under its historical name so
// the debug hooks and visual scenarios that call it are unchanged.
export function spawnEnemyShip(shipDef) {
  return spawnEnemyIn(world, shipDef);
}

// Give an enemy entity its Three.js body — the browser half of world.host.onSpawn('enemy', e). The entity
// already carries everything needed: which model, how it is oriented and scaled, and where it is. The mesh
// transform is seeded here rather than left to syncMeshes because an enemy can spawn AFTER syncMeshes has
// already run this tick (levelRunner.update() is late in update()), and it must be drawn in the right place
// on the very frame it appears.
export function attachEnemyBody(e) {
  e.mesh = makeShip(e.color, modelSpec(e.modelUrl, e.modelCfg));
  e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
  e.mesh.rotation.y = e.heading;
  e.mesh.scale.setScalar(e.scale);
  scene.add(e.mesh);
}

export function detachEnemyBody(e) {
  if (!e.mesh) return;
  disposeShipExhaust(e.mesh); // free the dead ship's attached exhaust plume (ShaderMaterials)
  scene.remove(e.mesh);
  e.mesh = null;
}

// Spawn a specific enemy by role name (used by tests/tools), falling back to the first kind.
export function spawnEnemy(role) {
  const def = CATALOG.enemyShips.find((s) => s.stats.role === role) || CATALOG.enemyShips[0];
  return def ? spawnEnemyShip(def) : null;
}

// Warm the .glb of every enemy this level can spawn, so the FIRST spawn of each type is an instant clone
// of a cached template instead of a mid-fight fetch/parse/texture-upload (the stall that had weak phones
// dropping to single-digit fps for the first seconds of a fight, and left enemies flying as the
// placeholder primitive until their model finally landed). Same idea as preloadRewardModel, which already
// warms the last-kill drop for exactly this reason. Names come from the descriptor's spawn pools; a name
// the catalog doesn't carry is simply skipped.
export function preloadLevelShipModels(level) {
  const names = new Set();
  for (const ph of level?.phases || []) for (const p of ph.spawn?.pool || []) if (p.ship) names.add(p.ship);
  for (const name of names) {
    const def = (CATALOG.enemyShips || []).find((s) => s.name === name);
    if (def?.modelUrl) preloadShipModel(def.modelUrl);
  }
}
