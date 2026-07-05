// Ship building & weapons: resolve a DB ship's components/weapons/fire-groups into a live entity,
// build the player and spawn enemies, and drive the fire-group cooldown/volley logic. Bridges the
// catalog (state.CATALOG) + the pure derivation (components.js) + the ship factory + projectiles.
import * as THREE from 'three';
import { scene } from './engine.js';
import { arenaCenter } from './world.js';
import { G, CATALOG, enemies, SPAWN_GROW_TIME, BULLET_PLANE_Y } from './state.js';
import { deriveDrive } from './components.js';
import { shipModelCfg, modelSpec, makeShip } from './ship-factory.js';
import { spawnBullet, spawnRocket, findTargetInSector } from './projectiles.js';
import { audio, sfxFor } from './sound-routing.js';

export const resolveWeapon = (id) => (id != null ? CATALOG.weapons.get(id) || null : null);
// Resolve a ship's component refs ({ hull, engine, thruster, repair, grab }) to objects (id + stats + weight).
// `id` is carried through so the loot-drop picker can name the exact looted item (reads hull.id/engine.id/…).
export function resolveComponents(refs) {
  const r = refs || {};
  const get = (id) => { const c = CATALOG.components.get(id); return c ? { id: c.id, name: c.name, weight: c.weight, ...c.stats } : null; };
  return { hull: get(r.hull), engine: get(r.engine), thruster: get(r.thruster), repair: get(r.repair), grab: get(r.grab) };
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
  const { hull, engine, thruster, repair, grab } = resolveComponents(active.components); // hull + engine + thrusters + repair drone + grab
  const p = {
    mesh: makeShip(s.color, modelSpec(active.ship.modelUrl, mc)),
    vel: new THREE.Vector3(),
    heading: 0,                       // rotation angle around Y
    sizeScale: mc.scale,
    hitBoxes: mc.hitBoxes, broadR: mc.broadR, // per-part OBB hitbox (null on primitives → single-sphere fallback)
    class: s.class,                   // sound class (DB) → drives explode/hit SFX via sfxFor('ship', class, …)
    hull, engine, thruster, repair, grab, // `repair` = repair-drone stats (or null); `grab` = tractor stats (or null) — feeds mass + the grab pull sim
    _repairAccum: 0,                  // seconds banked toward the next repair tick (held for repairTick)
    mounts: buildMounts(active.loadout.mounts), // resolved weapons; also feeds ship mass
    hp: hull ? hull.durability : 0, maxHp: hull ? hull.durability : 0, // hull may be unequipped in the hangar; the launchable gate blocks take-off
    alive: true,
    oobTime: 0,                  // seconds the ship has been continuously out of bounds (soft boundary)
    spawnAge: SPAWN_GROW_TIME,   // == full size: no warp-in animation on a fresh build (set to 0 to play it)
    spawnScale: null,            // full target scale, captured lazily at the first warp-back
  };
  p.mesh.scale.multiplyScalar(p.sizeScale); // apply sizeScale to the player too (enemies do this at spawn)
  p.groups = buildGroups(s.groups, p.mounts); // fire channels (gun / rocket / ...)
  deriveDrive(p); // acceleration <- engine power, turnRate <- engine turnPower, scaled by mass
  return p;
}

// (Re)build the player ship from a catalog ship row and swap it into the scene. For the player's
// *active* ship we use its persisted loadout/components (so a DB weapon swap from a level briefing
// actually takes effect); other (preview) ships fall back to their catalog defaults. G.currentShipName
// + G.activeShip live on the shared bag — written by the welcome/shop/account/net flows.
export function buildPlayerFor(ship) {
  if (G.player) scene.remove(G.player.mesh);
  const useActive = G.activeShip && G.activeShip.ship && G.activeShip.ship.name === ship.name;
  const loadout = useActive ? G.activeShip.loadout : { mounts: ship.stats.mounts };
  const components = useActive ? G.activeShip.components : ship.components;
  G.player = buildPlayer({ ship, loadout, components });
  G.currentShipName = ship.name;
  scene.add(G.player.mesh);
}

// Build one enemy from a DB ship row (type 'enemy'); weapons + fire groups come from its stats.
export function spawnEnemyShip(shipDef) {
  const s = shipDef.stats;
  const mc = shipModelCfg(s); // per-ship model presentation (yaw/scale + optional overrides)
  const { hull, engine, thruster } = resolveComponents(shipDef.components);
  const e = {
    name: shipDef.name, // DB ship name (English) — shown in the event-log kill line
    role: s.role, class: s.class, color: s.color, sizeScale: mc.scale, reward: s.reward || 0,
    mesh: makeShip(s.color, modelSpec(shipDef.modelUrl, mc)), // model defines the look; never tint enemies by color
    vel: new THREE.Vector3(),
    heading: Math.random() * Math.PI * 2,
    hull, engine, thruster,
    mounts: buildMounts(s.mounts),
    hp: hull.durability,
    maxHp: hull.durability, // for the over-enemy health bar (shown once hp dips below max)
    radius: 2.6 * mc.scale,  // health-bar/marker anchor only (collision now uses hitBoxes/broadR)
    hitBoxes: mc.hitBoxes, broadR: mc.broadR, // per-part OBB hitbox (null on primitives → single-sphere fallback)
    alive: true,
  };
  e.groups = buildGroups(s.groups, e.mounts);
  e.mesh.scale.multiplyScalar(mc.scale); // bigger model for heavy enemies
  // "warp in": grow from a dot to full size over SPAWN_GROW_TIME (see the enemy update loop)
  e.spawnScale = e.mesh.scale.clone(); // the full target scale to grow into
  e.spawnAge = 0;
  e.mesh.scale.setScalar(0.001); // start as a dot
  deriveDrive(e);
  // spawn in a ring around the MISSION ZONE center (arenaCenter), not the hero — waves originate at the
  // arena/set-piece even after the player wanders. No arena clamp (enemies fight fine out of bounds).
  const ang = Math.random() * Math.PI * 2;
  const d = 70 + Math.random() * 60; // 70..130 from the zone center
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
    const accel = isPlayer ? ship.acceleration : (w.accel ?? ship.acceleration);
    spawnRocket(muzzle, fwd, w, accel, isPlayer, target);
    if (isPlayer) audio.sfx.rocket(sfxFor('weapon', w.class, 'fire')); // player rockets sampled; enemy fire is silent (rocket detonations still play)
  } else {
    spawnBullet(muzzle, fwd, w, isPlayer, ship.vel);
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
      g.cooldown = g.reload + (isPlayer ? 0 : Math.random() * 0.5); // enemies stagger their reloads a bit
      for (const m of g.mounts) g.pending.push({ mount: m, t: m.delay });
    }
  }
}

