// Ship building & weapons: resolve a DB ship's components/weapons/fire-groups into a live entity,
// build the player and spawn enemies, and drive the fire-group cooldown/volley logic. Bridges the
// catalog (state.CATALOG) + the pure derivation (components.js) + the ship factory + projectiles.
import * as THREE from 'three';
import { scene } from './engine.js';
import { arenaCenter } from './world.js';
import { G, CATALOG, enemies, SPAWN_GROW_TIME, BULLET_PLANE_Y } from './state.js';
import { deriveDrive, enemyShieldSplit, ENEMY_SHIELD_RECHARGE_SEC, skillEffects } from './components.js';
import { shipModelCfg, modelSpec, makeShip, preloadShipModel } from './ship-factory.js';
import { spawnBullet, spawnRocket, findTargetInSector, findBulletAimTarget } from './projectiles.js';
import { disposeShipExhaust } from './exhaust-fx.js'; // free the retired player mesh's attached plume on a ship swap
import { audio, sfxFor } from './sound-routing.js';
import { simRandom } from './sim-random.js'; // seeded GAMEPLAY stream: enemy spawn placement/facing + reload jitter

export const resolveWeapon = (id) => (id != null ? CATALOG.weapons.get(id) || null : null);
// Resolve a ship's component refs ({ hull, engine, thruster, repair, grab, shield }) to objects (id + stats + weight).
// `id` is carried through so the loot-drop picker can name the exact looted item (reads hull.id/engine.id/…).
export function resolveComponents(refs) {
  const r = refs || {};
  const get = (id) => { const c = CATALOG.components.get(id); return c ? { id: c.id, name: c.name, weight: c.weight, ...c.stats } : null; };
  return { hull: get(r.hull), engine: get(r.engine), thruster: get(r.thruster), repair: get(r.repair), grab: get(r.grab), shield: get(r.shield) };
}

// Resolve a ship's mounts (weapon ids -> weapon objects).
function buildMounts(mountDefs) {
  return (mountDefs || [])
    .map((m) => ({ weapon: resolveWeapon(m.weapon), group: m.group, offset: m.offset || 0, delay: m.delay || 0 }))
    .filter((m) => m.weapon);
}
// Group a ship's mounts into fire channels. A group has a player key and/or an enemy AI rule, its
// own cooldown (= the slowest mounted weapon's reload), and a `pending` queue for staggered volleys.
function buildGroups(groupDefs, mounts) {
  const groups = {};
  for (const [name, def] of Object.entries(groupDefs || {})) {
    const gm = mounts.filter((m) => m.group === name);
    const reload = gm.reduce((mx, m) => Math.max(mx, m.weapon.fireCooldown || 0), 0);
    groups[name] = { name, key: def.key, ai: def.ai || null, mounts: gm, reload, cooldown: 0, pending: [] };
  }
  return groups;
}

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
    vel: new THREE.Vector3(),
    heading: 0,                       // rotation angle around Y
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
    spawnScale: null,            // full target scale, captured lazily at the first warp-back
  };
  p.mesh.scale.multiplyScalar(p.sizeScale); // apply sizeScale to the player too (enemies do this at spawn)
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

// Build one enemy from a DB ship row (type 'enemy'); weapons + fire groups come from its stats.
export function spawnEnemyShip(shipDef) {
  const s = shipDef.stats;
  const mc = shipModelCfg(s); // per-ship model presentation (yaw/scale + optional overrides)
  const { hull, engine, thruster } = resolveComponents(shipDef.components);
  const { shieldCap, hullMax } = enemyShieldSplit(hull.durability); // 1/3 shield + 2/3 hull; total unchanged
  const e = {
    name: shipDef.name, // DB ship name (English) — shown in the event-log kill line
    role: s.role, class: s.class, color: s.color, sizeScale: mc.scale, reward: s.reward || 0, xp: s.xp || 0,
    dodge: s.dodge || 0, // dodge % (all current enemies = 0 → always hit; future enemies may dodge)
    mesh: makeShip(s.color, modelSpec(shipDef.modelUrl, mc)), // model defines the look; never tint enemies by color
    vel: new THREE.Vector3(),
    heading: simRandom() * Math.PI * 2,   // GAMEPLAY: facing decides how long it turns before its first shot
    hull, engine, thruster,
    mounts: buildMounts(s.mounts),
    hp: hullMax,
    maxHp: hullMax, // HULL max only (the shield is a separate pool) — drives the floating health bar
    // Derived shield (NOT a DB component): same shape as the player's resolved shield component, minus
    // `weight` — so shipMass() skips it and enemy mass/accel/turn are bit-identical to before.
    shield: shieldCap > 0 ? { capacity: shieldCap, rechargeSec: ENEMY_SHIELD_RECHARGE_SEC } : null,
    _shieldValue: shieldCap,   // starts full & active
    _shieldRechargeAccum: 0,   // seconds banked while broken → drives recharge + the purple bar fill
    radius: 2.6 * mc.scale,  // health-bar/marker anchor only (collision now uses hitBoxes/broadR)
    hitBoxes: mc.hitBoxes, broadR: mc.broadR, // per-part OBB hitbox (null on primitives → single-sphere fallback)
    alive: true,
  };
  e.groups = buildGroups(s.groups, e.mounts);
  e.mesh.scale.multiplyScalar(mc.scale); // bigger model for heavy enemies
  // "warp in": grow from a dot to full size over SPAWN_GROW_TIME (see the enemy update loop)
  e.spawnScale = e.mesh.scale.clone(); // the full target scale to grow into
  e.spawnAge = 0;
  e.spawnDur = SPAWN_GROW_TIME; // warp-in duration; the level runner overrides this to the stagger delay
  e.warping = true;             // invulnerable + can't fire + not homing-targetable until fully formed
  e.mesh.scale.setScalar(0.001); // start as a dot
  deriveDrive(e);
  // spawn in a ring around the MISSION ZONE center (arenaCenter), not the hero — waves originate at the
  // arena/set-piece even after the player wanders. No arena clamp (enemies fight fine out of bounds).
  const ang = simRandom() * Math.PI * 2;   // GAMEPLAY: where the enemy appears
  const d = 70 + simRandom() * 60; // 70..130 from the zone center
  e.mesh.position.set(
    arenaCenter.x + Math.cos(ang) * d,
    BULLET_PLANE_Y, // sit on the canonical combat plane so enemy hull + fire line up with the player's
    arenaCenter.z + Math.sin(ang) * d
  );
  scene.add(e.mesh);
  enemies.push(e);
  return e;
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

const rightVec = (fwd) => new THREE.Vector3(fwd.z, 0, -fwd.x); // perpendicular to fwd, in the plane

// Fire one mount: spawn its projectile at the muzzle + lateral offset (side-by-side fire).
function fireMount(ship, mount, fwd, isPlayer) {
  const sc = ship.mesh.scale.x || 1;                       // current world scale (incl. spawn-grow + sizeScale)
  const noseZ = (ship.mesh.userData.noseZ ?? 1.6) * sc;    // spawn at the model's actual nose, not a fixed offset
  const muzzle = ship.mesh.position.clone()
    .addScaledVector(fwd, noseZ)
    .addScaledVector(rightVec(fwd), mount.offset * (ship.sizeScale || 1));
  const w = mount.weapon;
  if (w.type === 'rocket') {
    const target = isPlayer ? findTargetInSector(muzzle, fwd, w.seekHalfAngle ?? Math.PI) : G.player;
    // Player rocket accel rides the ship's (mobility-boosted) acceleration, then the Rocket skill's own
    // speed multiplier on top so "+rocket speed" is felt through the whole flight, not just launch.
    const accel = isPlayer ? ship.acceleration * (ship.rocketSpeedMul || 1) : (w.accel ?? ship.acceleration);
    spawnRocket(muzzle, fwd, w, accel, isPlayer, target);
    if (isPlayer) audio.sfx.rocket(sfxFor('weapon', w.class, 'fire')); // player rockets sampled; enemy fire is silent (rocket detonations still play)
  } else {
    let dir = fwd; // default: straight along the nose (spawnBullet clones+normalizes, so fwd is not mutated)
    if (w.aimAssistDeg) {
      const target = findBulletAimTarget(muzzle, fwd, w.aimAssistDeg * Math.PI / 180, isPlayer);
      if (target) {
        const aim = target.mesh.position.clone().sub(muzzle); // toward the target's CURRENT position (no leading)
        aim.y = 0;                                            // keep the shot on the combat plane
        if (aim.lengthSq() > 1e-6) dir = aim.normalize();     // unit; spawnBullet re-normalizes anyway
      }
    }
    spawnBullet(muzzle, dir, w, isPlayer, ship.vel);
    // The weapon's class → its 'fire' sound via the DB map (sfxFor); unset → synthesized zap.
    // Enemy fire makes no sound at all (intentional — only the player's own shots are audible).
    if (isPlayer) audio.sfx.shoot(sfxFor('weapon', w.class, 'fire'));
  }
}

// Advance a ship's fire groups: drain queued (staggered) volleys, and start a new volley when
// `wantsFire(group)` is true and the group is off cooldown. One trigger fires ALL the group's
// mounts, each after its own `delay` (so two launchers fire one after the other).
export function updateGroups(ship, fwd, isPlayer, dt, wantsFire) {
  for (const g of Object.values(ship.groups)) {
    g.cooldown -= dt;
    for (let i = g.pending.length - 1; i >= 0; i--) {
      g.pending[i].t -= dt;
      if (g.pending[i].t <= 0) { fireMount(ship, g.pending[i].mount, fwd, isPlayer); g.pending.splice(i, 1); }
    }
    if (g.mounts.length && g.cooldown <= 0 && wantsFire(g)) {
      g.cooldown = g.reload + (isPlayer ? 0 : simRandom() * 0.5); // enemies stagger their reloads a bit (GAMEPLAY: shifts when their bullets exist)
      for (const m of g.mounts) g.pending.push({ mount: m, t: m.delay });
    }
  }
}

