// Turning a catalog ship row into a fighting entity — the DATA half.
//
// A ship is a pile of resolved numbers (hull durability, engine power, which weapons hang off which fire
// group, how big its hitbox is) plus, in a browser, a Three.js group to look at. Those were built together
// in `ship-build.js`, so no enemy could exist without a scene graph. The numbers live here; the body is
// attached by the World's host (`world.host.onSpawn('enemy', e)`), which on a server does nothing.
//
// Everything is resolved through `world.catalog` rather than a module singleton, because a Node process
// hosts several Worlds and `state.js` cannot load there at all.
//
// ORDER OF RNG DRAWS IS PART OF THE CONTRACT. `makeEnemy` draws from the seeded gameplay stream three
// times, in this order: facing, then spawn angle, then spawn distance (DECISIONS §73). Every recorded input
// trace — the shipped Level-0 intro among them — replays against that exact sequence, so reordering these,
// or adding a draw between them, silently invalidates the archive. Add new draws at the END.
//
// See docs/plans/server-authoritative-sim.md (Slice B3b).
import { Vec3 } from './vec.js';
import { shipModelCfg } from './ship-config.js';
import { deriveDrive, skillEffects, enemyShieldSplit, ENEMY_SHIELD_RECHARGE_SEC } from './components.js';
import { simRandom } from './sim-random.js';
import { SHIP_GROUP_SCALE, BULLET_PLANE_Y, SPAWN_GROW_TIME } from './consts.js';
import { spawnBullet, spawnRocket } from './spawn.js';
import { findTargetInSector } from './targeting.js';
import { isBeamGroup, updateBeamGroup } from './beam.js';

export const resolveWeapon = (catalog, id) => (id != null ? catalog.weapons.get(id) || null : null);

// Resolve a ship's component refs ({ hull, engine, thruster, repair, grab, shield }) to objects
// (id + stats + weight). `id` is carried through so the loot-drop picker can name the exact looted item
// (reads hull.id/engine.id/…).
export function resolveComponents(catalog, refs) {
  const r = refs || {};
  const get = (id) => { const c = catalog.components.get(id); return c ? { id: c.id, name: c.name, weight: c.weight, ...c.stats } : null; };
  return { hull: get(r.hull), engine: get(r.engine), thruster: get(r.thruster), repair: get(r.repair), grab: get(r.grab), shield: get(r.shield) };
}

// Resolve a ship's mounts (weapon ids -> weapon objects).
export function buildMounts(catalog, mountDefs) {
  return (mountDefs || [])
    .map((m) => ({ weapon: resolveWeapon(catalog, m.weapon), group: m.group, offset: m.offset || 0, delay: m.delay || 0 }))
    .filter((m) => m.weapon);
}

// Group a ship's mounts into fire channels. A group has a player key and/or an enemy AI rule, its own
// cooldown (= the slowest mounted weapon's reload), and a `pending` queue for staggered volleys.
export function buildGroups(groupDefs, mounts) {
  const groups = {};
  for (const [name, def] of Object.entries(groupDefs || {})) {
    const gm = mounts.filter((m) => m.group === name);
    const reload = gm.reduce((mx, m) => Math.max(mx, m.weapon.fireCooldown || 0), 0);
    groups[name] = { name, key: def.key, ai: def.ai || null, mounts: gm, reload, cooldown: 0, pending: [] };
  }
  return groups;
}

// Build one enemy from a DB ship row (type 'enemy'); weapons + fire groups come from its stats.
// Draws three times from the seeded stream — see the header note before touching the order.
// The PLAYER ship as data — the same pile of resolved numbers an enemy is, built from the account's
// active-ship record `{ ship, loadout, components, skills }`. The browser hangs a mesh off it afterwards
// (ship-build.buildPlayer); a headless referee re-simulating a submitted trace does not, and that is the
// only difference between the two.
//
// Skills apply ONLY to a real active ship. Previews and ?playback overrides pass `skills: null` (→ the
// identity multipliers), which is what lets a recording reproduce the exact ship it was made with no matter
// what the account has equipped now.
export function makePlayer(catalog, active) {
  const s = active.ship.stats;
  const mc = shipModelCfg(s); // per-ship model presentation (yaw/scale + optional overrides)
  const { hull, engine, thruster, repair, grab, shield } = resolveComponents(catalog, active.components);
  // resolveComponents/buildMounts return fresh objects, so scaling engine/thruster/shield/weapon copies
  // here never mutates the shared catalog.
  const fx = skillEffects(active.skills);
  if (engine) engine.power *= fx.mobilityMul;     // Mobility: +5%/pt engine power (→ acceleration)
  if (thruster) thruster.power *= fx.mobilityMul; // Mobility: +5%/pt thruster power (→ turn rate)
  if (shield) shield.capacity = Math.round(shield.capacity * fx.shieldMul); // Shields: +5%/pt capacity
  const p = {
    // --- SIM TRANSFORM (the authority; a mesh, where there is one, is a copy of it — see sim.js syncMeshes) ---
    pos: new Vec3(0, BULLET_PLANE_Y, 0), // world position on the canonical combat plane
    vel: new Vec3(),
    heading: 0,                       // rotation angle around Y
    scale: SHIP_GROUP_SCALE * mc.scale, // CURRENT uniform world scale (warp-in shrinks it); drives hitboxes + muzzle
    fullScale: SHIP_GROUP_SCALE * mc.scale, // the full-size scale to grow back into after a warp
    noseZ: mc.muzzle ?? 1.6,          // group-local muzzle offset from the catalog (1.6 = the primitive's cone nose)
    sizeScale: mc.scale,
    modelUrl: active.ship.modelUrl, modelCfg: mc, // what the host needs to give this ship a body
    color: s.color,
    hitBoxes: mc.hitBoxes, broadR: mc.broadR, // per-part OBB hitbox (null on primitives → single-sphere fallback)
    class: s.class,                   // sound class (DB) → drives explode/hit SFX via sfxFor('ship', class, …)
    hull, engine, thruster, repair, grab, shield, // `repair` = repair-drone stats (or null); `grab` = tractor stats (or null); `shield` = base-shield stats { capacity, rechargeSec } or null — all feed mass
    _repairAccum: 0,                  // seconds banked toward the next repair tick (held for repairTick)
    _shieldValue: shield ? shield.capacity : 0, // current absorption remaining (starts full & active)
    _shieldRechargeAccum: 0,          // seconds banked while broken → drives recharge + HUD purple fill
    mounts: buildMounts(catalog, active.loadout.mounts), // resolved weapons; also feeds ship mass
    hp: hull ? hull.durability : 0, maxHp: hull ? hull.durability : 0, // hull may be unequipped in the hangar; the launchable gate blocks take-off
    alive: true,
    oobTime: 0,                  // seconds the ship has been continuously out of bounds (soft boundary)
    spawnAge: SPAWN_GROW_TIME,   // == full size: no warp-in animation on a fresh build (set to 0 to play it)
    spawnDur: SPAWN_GROW_TIME,   // warp-back duration
  };
  // Kinetic/Rocket skills: clone each mounted weapon and scale the COPY (never the shared catalog object).
  for (const m of p.mounts) {
    const w = { ...m.weapon };
    if (w.type === 'rocket') {
      if (w.power != null) w.power *= fx.rocketDmgMul;               // Rocket: +5%/pt damage
      if (w.launchSpeed != null) w.launchSpeed *= fx.rocketSpeedMul; // Rocket: +5%/pt launch speed
    } else {
      if (w.power != null) w.power *= fx.kineticDmgMul;              // Kinetic: +5%/pt damage
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

// An enemy's NUMBERS, with no randomness and no position — everything a hostile ship is except where it
// happens to be and which way it happens to face.
//
// Split out for the netsim client: a room owns the fight, so the browser's copy of an enemy is a ghost it
// draws rather than a combatant it simulates, and it must build that ghost WITHOUT drawing from the seeded
// stream (a client that consumed gameplay randomness would desync from the authority immediately). Sharing
// the construction rather than writing a second, thinner "render-only enemy" is the point: one place
// decides what an enemy's shield split, mass, hitboxes and full scale are.
//
// Takes the catalog directly, not the World, because a ghost is built from a name off the wire.
export function makeEnemyShell(catalog, shipDef) {
  const s = shipDef.stats;
  const mc = shipModelCfg(s); // per-ship model config (yaw/scale + hitboxes + the baked muzzle offset)
  const { hull, engine, thruster } = resolveComponents(catalog, shipDef.components);
  const { shieldCap, hullMax } = enemyShieldSplit(hull.durability); // 1/3 shield + 2/3 hull; total unchanged
  const e = {
    name: shipDef.name, // DB ship name (English) — shown in the event-log kill line
    role: s.role, class: s.class, color: s.color, sizeScale: mc.scale, reward: s.reward || 0, xp: s.xp || 0,
    dodge: s.dodge || 0, // dodge % (all current enemies = 0 → always hit; future enemies may dodge)
    modelUrl: shipDef.modelUrl, // the host builds the body from this + `mc`
    modelCfg: mc,
    // --- SIM TRANSFORM (the authority; any mesh is a copy of it — see sim.js syncMeshes) ---
    pos: new Vec3(0, BULLET_PLANE_Y, 0),  // placed by the caller
    vel: new Vec3(),
    heading: 0,                           // set by the caller (a random facing in makeEnemy; the wire in netsim)
    noseZ: mc.muzzle ?? 1.6,              // group-local muzzle offset from the catalog (1.6 = the primitive's cone nose)
    hull, engine, thruster,
    mounts: buildMounts(catalog, s.mounts),
    hp: hullMax,
    maxHp: hullMax, // HULL max only (the shield is a separate pool) — drives the floating health bar
    // Derived shield (NOT a DB component): same shape as the player's resolved shield component, minus
    // `weight` — so shipMass() skips it and enemy mass/accel/turn are bit-identical to before.
    shield: shieldCap > 0 ? { capacity: shieldCap, rechargeSec: ENEMY_SHIELD_RECHARGE_SEC } : null,
    _shieldValue: shieldCap,   // starts full & active
    _shieldRechargeAccum: 0,   // seconds banked while broken → drives recharge + the purple bar fill
    radius: 2.6 * mc.scale,  // health-bar/marker anchor only (collision uses hitBoxes/broadR)
    hitBoxes: mc.hitBoxes, broadR: mc.broadR, // per-part OBB hitbox (null on primitives → single-sphere fallback)
    alive: true,
  };
  e.groups = buildGroups(s.groups, e.mounts);
  // "warp in": grow from a dot to full size over SPAWN_GROW_TIME (see the enemy update loop)
  e.fullScale = SHIP_GROUP_SCALE * mc.scale; // full world scale to grow into (bigger model for heavy enemies)
  e.spawnAge = 0;
  e.spawnDur = SPAWN_GROW_TIME; // warp-in duration; the level runner overrides this to the stagger delay
  e.warping = true;             // invulnerable + can't fire + not homing-targetable until fully formed
  e.scale = e.fullScale * 0.001; // start as a dot
  deriveDrive(e);
  return e;
}

export function makeEnemy(world, shipDef) {
  const e = makeEnemyShell(world.catalog, shipDef);
  // THE THREE DRAWS, in their contract order. They stay HERE, after the shell, and the shell takes none —
  // so factoring it out left the sequence facing → angle → distance exactly as every recorded trace expects
  // (DECISIONS §73). The intro oracle's unchanged tick count is the proof.
  e.heading = simRandom() * Math.PI * 2;   // GAMEPLAY draw 1: facing decides how long it turns before its first shot
  // spawn in a ring around the MISSION ZONE centre, not the hero — waves originate at the arena/set-piece
  // even after the player wanders. No arena clamp (enemies fight fine out of bounds).
  const ang = simRandom() * Math.PI * 2;   // GAMEPLAY draw 2: where the enemy appears
  const d = 70 + simRandom() * 60;         // GAMEPLAY draw 3: 70..130 from the zone centre
  e.pos.set(
    world.arenaCenter.x + Math.cos(ang) * d,
    BULLET_PLANE_Y, // sit on the canonical combat plane so enemy hull + fire line up with the player's
    world.arenaCenter.z + Math.sin(ang) * d,
  );
  return e;
}

// Build an enemy, add it to the World, and ask the host to give it a body.
export function spawnEnemy(world, shipDef) {
  const e = makeEnemy(world, shipDef);
  world.enemies.push(e);
  world.host.onSpawn('enemy', e);
  return e;
}

// ---------- Firing ----------
const rightVec = (fwd) => new Vec3(fwd.z, 0, -fwd.x); // perpendicular to fwd, in the plane

// Fire one mount: spawn its projectile at the muzzle + lateral offset (side-by-side fire).
// Emits `fire` rather than playing a sound: only the player's own shots are audible, and deciding that is
// the client's business, not the simulation's.
function fireMount(world, ship, mount, fwd, side, rocketTarget) {
  const isPlayer = side === 'player';
  const friendly = side !== 'enemy';       // the PROJECTILE's `fromPlayer` means "fired by the friendly side"
  const sc = ship.scale || 1;                              // current world scale (incl. spawn-grow + sizeScale)
  const noseZ = (ship.noseZ ?? 1.6) * sc;                  // spawn at the model's actual nose, not a fixed offset
  const muzzle = ship.pos.clone()
    .addScaledVector(fwd, noseZ)
    .addScaledVector(rightVec(fwd), mount.offset * (ship.sizeScale || 1));
  const w = mount.weapon;
  if (w.type === 'rocket') {
    // Friendlies seek an enemy in the nose sector; a hostile rocket is handed whoever its shooter is flying
    // at (the player today, the player OR an ally once one exists).
    const target = friendly
      ? findTargetInSector(world, muzzle, fwd, w.seekHalfAngle ?? Math.PI)
      : (rocketTarget || world.player);
    // Player rocket accel rides the ship's (mobility-boosted) acceleration, then the Rocket skill's own
    // speed multiplier on top so "+rocket speed" is felt through the whole flight, not just launch.
    const accel = isPlayer ? ship.acceleration * (ship.rocketSpeedMul || 1) : (w.accel ?? ship.acceleration);
    spawnRocket(world, muzzle, fwd, w, accel, friendly, target, side === 'ally');
    // NOTE the split: the projectile's `fromPlayer` is "friendly side"; the EVENT's is "it was YOUR shot".
    // Only the player's fire is audible (sim.js adapter) — the ally's guns must be silent (§2.6).
    world.events.emit({ type: 'fire', weaponClass: w.class, isRocket: true, fromPlayer: isPlayer });
  } else {
    // Straight along the nose, always. There used to be an auto-aim cone here (DECISIONS §89/§112) that
    // silently redirected a bullet at any target within ±aimAssistDeg — removed in §124: it decides where a
    // shot goes from information the shooter does not have, which reads as the game aiming for you, and in
    // a server-run room it aimed at a position the player was not even being shown.
    spawnBullet(world, muzzle, fwd, w, friendly, ship.vel, side === 'ally');
    world.events.emit({ type: 'fire', weaponClass: w.class, isRocket: false, fromPlayer: isPlayer });
  }
}

// Advance a ship's fire groups: drain queued (staggered) volleys, and start a new volley when
// `wantsFire(group)` is true and the group is off cooldown. One trigger fires ALL the group's
// mounts, each after its own `delay` (so two launchers fire one after the other).
// `side` is 'player' | 'ally' | 'enemy'. `rocketTarget` is only read for an ENEMY's rockets — whoever its
// shooter is flying at — because a friendly rocket resolves its own seeker target from the nose sector.
export function updateGroups(world, ship, fwd, side, dt, wantsFire, rocketTarget = null) {
  for (const g of Object.values(ship.groups)) {
    // A BEAM group has its own tick: a charge that spans ticks, and a hitscan instead of a projectile. A
    // branch here rather than a fourth call site is what makes "any weapon on any ship" keep meaning what it
    // means today — player, ally and enemy all get it, and a ship without one never takes this branch.
    if (isBeamGroup(g)) { updateBeamGroup(world, ship, g, fwd, side, dt, wantsFire); continue; }
    g.cooldown -= dt;
    for (let i = g.pending.length - 1; i >= 0; i--) {
      g.pending[i].t -= dt;
      if (g.pending[i].t <= 0) { fireMount(world, ship, g.pending[i].mount, fwd, side, rocketTarget); g.pending.splice(i, 1); }
    }
    if (g.mounts.length && g.cooldown <= 0 && wantsFire(g)) {
      // Only ENEMIES stagger their reloads, and only they draw for it. The player and the ally consume no
      // randomness here, which is what keeps every recorded trace bit-identical (DECISIONS §73).
      g.cooldown = g.reload + (side === 'enemy' ? simRandom() * 0.5 : 0); // (GAMEPLAY: shifts when their bullets exist)
      for (const m of g.mounts) g.pending.push({ mount: m, t: m.delay });
    }
  }
}
