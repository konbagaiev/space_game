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
import { deriveDrive, enemyShieldSplit, ENEMY_SHIELD_RECHARGE_SEC } from './components.js';
import { simRandom } from './sim-random.js';
import { SHIP_GROUP_SCALE, BULLET_PLANE_Y, SPAWN_GROW_TIME } from './consts.js';

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
export function makeEnemy(world, shipDef) {
  const s = shipDef.stats;
  const catalog = world.catalog;
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
    pos: new Vec3(0, BULLET_PLANE_Y, 0),  // placed in the spawn ring below
    vel: new Vec3(),
    heading: simRandom() * Math.PI * 2,   // GAMEPLAY draw 1: facing decides how long it turns before its first shot
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
