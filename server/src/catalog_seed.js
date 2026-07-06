import { enemyTotalFromPhases } from './enemy_total.js';

// Seed data for the ships/weapons catalog — a snapshot of the game's ship/weapon design.
// Both backends seed from this via an idempotent upsert on startup (see db.js / db_postgres.js),
// so editing this file updates the catalog on the next start.
//
// References are by id everywhere. A ship has named fire GROUPS (a channel triggered by a key for
// the player, or by an AI range/aim rule for enemies) and a list of MOUNTS, each a weapon on a
// group with a lateral offset (side-by-side fire) and a delay (staggered volley). A player's
// loadout (player_ships.loadout) may override `mounts`; empty ⇒ the ship's default mounts.

// --- components: ships are assembled from a hull + an engine + maneuvering thrusters (weapons are
// separate, in WEAPONS). `weight` (a column) sums into the ship's mass; `stats` (json) hold the rest.
//   hull     : { durability (= maxHp), volume }
//   engine   : { power -> acceleration, maxSpeed, exhaust }
//   thruster : { power -> turn rate (maneuverability) }
// So mobility = engine power (accel) / thruster power (turn), each scaled by mass. Stable explicit
// ids (referenced from ships.components / player_ships.components as { hull, engine, thruster }).
// Optional top-level `price` (credits, for the hangar shop) defaults to 0 when omitted — the economy
// is inert until real prices are set; sell price is floor(price * 0.75), computed server-side.
export const COMPONENTS = [
  { id: 1, name: 'Basic hull', type: 'hull', weight: 20, price: 300, stats: { durability: 100, volume: 100 } }, // starter gear: cheap, buyable
  { id: 2, name: 'Light hull', type: 'hull', weight: 8, price: 150, stats: { durability: 30, volume: 40, buyable: false } }, // enemy gear: resale-only (hidden from the shop)
  { id: 3, name: 'Medium hull', type: 'hull', weight: 60, stats: { durability: 150, volume: 200 } },
  { id: 4, name: 'Boss hull', type: 'hull', weight: 100, stats: { durability: 310, volume: 400 } }, // boss buff: 210 → 310 (+100 HP)
  { id: 5, name: 'Basic engine', type: 'engine', weight: 10, price: 500, stats: { power: 15, maxSpeed: 0, exhaust: { color: 0x6fd0ff, speed: 12, life: 0.55, size: 0.5, spread: 0.35 } } }, // starter gear: cheap
  { id: 6, name: 'Scout engine', type: 'engine', weight: 6, price: 250, stats: { power: 19, maxSpeed: 10.5, exhaust: { color: 0xff8a5a, speed: 10, life: 0.4, size: 0.4, spread: 0.3 }, buyable: false } }, // enemy gear: resale-only
  { id: 7, name: 'Boss engine', type: 'engine', weight: 50, stats: { power: 29, maxSpeed: 10.4, exhaust: { color: 0xff5a3a, speed: 10, life: 0.6, size: 0.9, spread: 0.45 } } }, // boss buff: maxSpeed 8 → 10.4 (+30%)
  { id: 8, name: 'Basic thrusters', type: 'thruster', weight: 4, price: 400, stats: { power: 2.0 } }, // starter gear: cheap
  { id: 9, name: 'Scout thrusters', type: 'thruster', weight: 3, price: 200, stats: { power: 1.6, buyable: false } }, // enemy gear: resale-only
  { id: 10, name: 'Medium thrusters', type: 'thruster', weight: 8, stats: { power: 0.63 } }, // sluggish (turn ~0.35)
  { id: 11, name: 'Boss thrusters', type: 'thruster', weight: 20, stats: { power: 1.66 } }, // turn ~0.42 = 1.2× medium
  // repair drone (4th component type): passively heals the hull mid-combat, up to a fraction of max HP.
  // Installed on the player's ship via the level-3 briefing's installComponent action.
  { id: 12, name: 'Repair drone', type: 'repair', weight: 4, price: 500,
    modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/repair_drone_hangar.b9d0fa33.glb', // menu-only item icon
    stats: { repairPerTick: 1, intervalSec: 1, maxFraction: 0.8, model: { yaw: 0, scale: 1 } } }, // granted at L3; cheap to rebuy. Ticks every 1 s (3× the old 3 s cadence) for the same HP per tick. `model`: item-preview yaw/scale.

  // --- Player shop ladder (docs/plans/catalog-economy.md). Upgrades are mass trade-offs, not
  // power-creep; ids continue from 12. The enemy/starter parts above stay out of the shop (price 0 →
  // hidden by the client's price>0 shop filter); only these priced rows are buyable.
  // Hull: "a new ship = a new hull" — 2× HP for a real mobility cost (mass 48→78: accel ~6.2, turn ~1.2).
  { id: 13, name: 'Heavy hull', type: 'hull', weight: 50, price: 6000, stats: { durability: 200, volume: 350 } },
  // Engines: Racing = T2 (more power, heavier); Ion = high-accel and light (premium top-tier).
  { id: 15, name: 'Solid-fuel engine', type: 'engine', weight: 14, price: 1400, stats: { power: 21, maxSpeed: 12, exhaust: { color: 0x7fb0ff, speed: 13, life: 0.55, size: 0.55, spread: 0.35 } } },
  { id: 16, name: 'Ion engine', type: 'engine', weight: 10, price: 6400, stats: { power: 27, maxSpeed: 14, exhaust: { color: 0xffd24d, speed: 14, life: 0.45, size: 0.45, spread: 0.30 } } },
  // Repair drones: faster cadence + higher cap (the "future tiers" from the repair-drone spec).
  // All tick every 1 s; per-tick HP keeps each tier 3× its old healing rate and preserves the ladder.
  { id: 19, name: 'Repair drone II', type: 'repair', weight: 6, price: 1800, stats: { repairPerTick: 1.5, intervalSec: 1, maxFraction: 0.85 } },
  { id: 20, name: 'Nanobot repair', type: 'repair', weight: 8, price: 7000, stats: { repairPerTick: 2, intervalSec: 1, maxFraction: 0.90 } },
  { id: 21, name: 'Advanced thrusters', type: 'thruster', weight: 5, price: 2500, stats: { power: 3.0 } },

  // --- Pirate gunner parts (side missions, docs/plans/mission-enemies-difficulty.md). +20% HP and
  // +50% top speed over the base enemy (fighter: Light hull 30 HP + Scout engine maxSpeed 10.5).
  // Enemy gear → price 0 (hidden from the shop). ids continue past the max (21).
  { id: 22, name: 'Pirate hull', type: 'hull', weight: 10, price: 200, stats: { durability: 36, volume: 45, buyable: false } },          // 30 × 1.2; enemy gear: resale-only
  { id: 23, name: 'Pirate engine', type: 'engine', weight: 6, price: 400, stats: { power: 19, maxSpeed: 15.75, exhaust: { color: 0xff6a4a, speed: 10, life: 0.4, size: 0.4, spread: 0.3 }, buyable: false } }, // maxSpeed 10.5 × 1.5; same accel as Scout; enemy gear: resale-only

  // --- Level-4 enemies (docs/plans/level-4-difficulty.md). Tunable; net turn/accel are mass-scaled, so
  // component power is bumped above the headline +30% to land roughly +30% NET after the heavier hulls.
  // Advanced medium pirate (heavy bruiser, 300 HP, turns ~+30% vs the mini-boss):
  { id: 24, name: 'Pirate heavy hull', type: 'hull', weight: 100, price: 1200, stats: { durability: 300, volume: 250, buyable: false } }, // 2× mini-boss (150); enemy gear: resale-only
  { id: 25, name: 'Pirate medium thruster', type: 'thruster', weight: 8, price: 350, stats: { power: 1.25, buyable: false } },          // ~+30% net turn vs Medium (0.63) once mass-scaled; enemy gear: resale-only
  // Second Boss (550 HP, speed/accel/turn ~+30% vs the first boss):
  { id: 26, name: 'Second-boss engine', type: 'engine', weight: 50, price: 1500, stats: { power: 45, maxSpeed: 14.3, exhaust: { color: 0xff3a2a, speed: 11, life: 0.6, size: 0.95, spread: 0.45 }, buyable: false } }, // boss buff: maxSpeed 11 → 14.3 (+30%); enemy gear: resale-only
  { id: 27, name: 'Second-boss thruster', type: 'thruster', weight: 20, price: 900, stats: { power: 2.7, buyable: false } },            // boss 1.66 bumped for ~+30% net turn; enemy gear: resale-only
  { id: 28, name: 'Second-boss hull', type: 'hull', weight: 140, price: 2000, stats: { durability: 550, volume: 600, buyable: false } }, // boss buff: 450 → 550 (+100 HP); enemy gear: resale-only

  // --- Grab (tractor beam) — a new optional component type (single slot like `repair`; no stacking).
  // On kill, enemies sometimes drop a piece of their gear as a metal-box in the arena; a drop within the
  // grab's RANGE is pulled toward the ship, and collected drops deposit into the stash on mission victory.
  //   Inverse-square field: FIELD = strength·5/dist²; the beam engages where FIELD ≥ 0.4, so RANGE is
  //   EMERGENT (base strength 10 → ≈11.2 u, Advanced 20 → ≈15.8 u = √2× base) and weight-INDEPENDENT.
  //   PULL SPEED (u/s) = FIELD · (10 / pulledItemWeight) · 0.67 (PULL_SPEED_SCALE — reel-in speed tune, not reach)
  //                       — rises the closer the drop is; light parts faster.
  // The player owns the base Grab from the start; the Advanced grab is buyable (see docs/plans/2026-07-03-1412-grab-tractor-drops.md).
  { id: 29, name: 'Grab', type: 'grab', weight: 2, price: 500, stats: { strength: 10 } },
  { id: 30, name: 'Advanced grab', type: 'grab', weight: 3, price: 2000, stats: { strength: 20 } },
];

// --- weapons: type 'bullet' | 'rocket'; stats hold the (now fully DB-driven) characteristics ---
// bullets: power (damage), projectileSpeed, maxRange (units), fireCooldown, weight, projectileColor.
// rockets: power (damage), accel, turnRate (maneuverability), launchSpeed, maxRange, health
//   (HP — reduced by a bullet's `power`; the rocket is shot down when it hits 0, so e.g. 20 HP
//   takes two 10-damage gun hits), blastRadius (AoE — can hit several), detonateRadius, blastVisual,
//   seekHalfAngle (homing search cone), fireCooldown, weight, projectileColor.
// Optional top-level `price` (credits, hangar shop) defaults to 0 when omitted (see COMPONENTS note).
export const WEAPONS = [
  {
    id: 1, name: 'Basic kinetic', type: 'bullet', price: 800, stats: { // granted into the stash on shop unlock; sells ~600 to help fund the Heavy hull
      power: 10, projectileSpeed: 40, maxRange: 88, fireCooldown: 0.18, weight: 6, projectileColor: 0x6fe6ff, class: 'kinetic'
    }
  },
  {
    id: 2, name: 'Kinetic pirate', type: 'bullet', price: 120, stats: { // enemy gear: resale-only (hidden from the shop)
      power: 4, projectileSpeed: 40, maxRange: 88, fireCooldown: 1.1, weight: 4, projectileColor: 0xff6b6b, class: 'kinetic', buyable: false
    }
  },
  {
    id: 3, name: 'Rocket (homing)', type: 'rocket', price: 600, stats: { // player starter rocket: cheap to rebuy
      power: 60, accel: 10, turnRate: 1.0, launchSpeed: 12, maxRange: 150, health: 10,
      seekHalfAngle: 60 * Math.PI / 180, detonateRadius: 0.5, blastRadius: 5, // detonateRadius = proximity fuse to the HULL (hitBoxes), not to center — near contact; floor ≥ ~1 frame of rocket travel so a fast rocket can't tunnel past
      blastVisual: 4.5, blastTimeScale: 0.8, blastTint: 0xffb050, // detonation FX: size / speed (<1 = quicker) / tint
      fireCooldown: 5, weight: 8, projectileColor: 0xffaa44, class: 'rocket'
    }
  },
  {
    id: 4, name: 'Rocket pirate', type: 'rocket', price: 200, stats: { // enemy gear: resale-only (hidden from the shop)
      power: 20, accel: 9, turnRate: 1.0, launchSpeed: 6, maxRange: 120, health: 20,
      detonateRadius: 0.5, blastRadius: 5, // hull-proximity fuse (see id 3)
      blastVisual: 4.5, blastTimeScale: 0.8, blastTint: 0xffb050, // detonation FX: size / speed (<1 = quicker) / tint
      fireCooldown: 4, weight: 6, projectileColor: 0xffcc66, class: 'rocket', buyable: false // class only drives detonation (→ blast); enemy fire stays synth (isPlayer gate)
    }
  },
  {
    id: 5, name: 'Machine Gun', type: 'bullet', price: 1500,
    modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/machine_gun_hangar.aabc98c9.glb', // menu-only item icon
    stats: { // rapid-fire kinetic: low per-hit damage, high rate of fire — strong, so NOT cheap
      power: 7, projectileSpeed: 50, maxRange: 100, fireCooldown: 0.1, weight: 8, projectileColor: 0xffe066, class: 'kinetic',
      model: { yaw: 0, scale: 1 } // item preview presentation (yaw/scale); tune after the visual check
    }
  },
  // --- Player shop ladder weapons (docs/plans/catalog-economy.md). Trade-offs: damage ↔ fire-rate ↔ range ↔ weight.
  {
    id: 6, name: 'Heavy cannon', type: 'bullet', price: 2000, stats: { // hard-hitting, slow fire, long range
      power: 35, projectileSpeed: 65, maxRange: 140, fireCooldown: 0.6, weight: 10, projectileColor: 0xff8a3c, class: 'cannon'
    }
  },
  {
    id: 7, name: 'Heavy Machine Gun', type: 'bullet', price: 6000, stats: { // strong all-rounder: med damage, high rate of fire
      power: 12, projectileSpeed: 48, maxRange: 100, fireCooldown: 0.12, weight: 8, projectileColor: 0xb46bff, class: 'kinetic'
    }
  },
  {
    id: 8, name: 'Heavy rocket', type: 'rocket', price: 2600, stats: { // homing: high damage, slow reload, big blast
      power: 90, accel: 9, turnRate: 0.8, launchSpeed: 12, maxRange: 180, health: 20,
      seekHalfAngle: 50 * Math.PI / 180, detonateRadius: 0.5, blastRadius: 7, // hull-proximity fuse (see id 3)
      blastVisual: 6, blastTimeScale: 0.8, blastTint: 0xffb050, // detonation FX: size / speed (<1 = quicker) / tint
      fireCooldown: 7, weight: 12, projectileColor: 0xff7a3c, class: 'rocket'
    }
  },
  // Enemy weapon for the pirate gunner (side missions) + the upgraded boss: a long-range, rapid-fire
  // kinetic mirroring the player's Machine Gun's reach. Low per-hit damage, high RoF. Price 0 (enemy gear).
  {
    id: 9, name: 'Pirate machine gun', type: 'bullet', price: 300, stats: { // enemy gear: resale-only (hidden from the shop)
      power: 3, projectileSpeed: 50, maxRange: 90, fireCooldown: 0.18, weight: 6, projectileColor: 0xff5a4a, class: 'kinetic', buyable: false
    }
  },
  // Second Boss main gun (level-4): a hard-hitting, slow, long-range cannon (one shot/sec). Enemy gear.
  {
    id: 10, name: 'Advanced pirate cannon', type: 'bullet', price: 600, stats: { // enemy gear: resale-only (hidden from the shop)
      power: 10, projectileSpeed: 60, maxRange: 110, fireCooldown: 1.0, weight: 10, projectileColor: 0xff4a3a, class: 'cannon', buyable: false
    }
  },
  // Player shop ladder — top of the rocket ladder (above Heavy rocket 2600). A triple-warhead homing
  // rocket: an INVISIBLE leading rocket homes (findTargetInSector) and defines the path; three VISIBLE
  // rockets spiral around its flight axis, each a real rocket (own power + HP, own proximity detonation,
  // individually shootable-down). `spiral:true` triggers the leader+3-orbiter spawn in projectiles.js.
  {
    id: 11, name: 'Triple spiral rocket', type: 'rocket', price: 4000, rarity: 'rare', stats: {
      power: 40, accel: 12, turnRate: 1.0, launchSpeed: 14, maxRange: 150, health: 10, // per visible rocket
      seekHalfAngle: 60 * Math.PI / 180, detonateRadius: 0.5, blastRadius: 5, // hull-proximity fuse (see id 3)
      blastVisual: 4.5, blastTimeScale: 0.8, blastTint: 0xffb050,
      fireCooldown: 7, weight: 13, projectileColor: 0x66ddff, class: 'rocket',
      spiral: true // spawn as an invisible leader + 3 visible spiraling rockets (see spawnRocket)
    }
  },
];

// --- item rarity + color (drives the in-world drop glow + the pickup-log tint on the client).
// Rule: a shop-available item (price>0 AND not buyable:false) is 'common'; everything else (pirate/enemy
// gear + price-0 boss parts) is 'trash'; a row may set `rarity` explicitly to override (Triple spiral → 'rare').
const RARITY_COLOR = { trash: '#ffffff', common: '#59e0a0', rare: '#0000ff' };
const classifyRarity = (row) =>
  row.rarity || (((row.price ?? 0) > 0 && row.stats?.buyable !== false) ? 'common' : 'trash');
for (const row of [...COMPONENTS, ...WEAPONS]) {
  row.rarity = classifyRarity(row);
  row.color = RARITY_COLOR[row.rarity];
}

// --- sounds: the SFX asset registry (key -> same-origin content-hashed url, optional playback gain).
// Volume is mostly baked into the files (gain defaults to 1); per-sound `gain` trims it at playback. These
// are the rows of the `sounds` table; the client
// fetches them (/api/sounds), preloads each, and plays by key. All CC0 (see client/assets/CREDITS.md).
export const SOUNDS = [
  { key: 'kinetic',  url: 'assets/sounds/kinetic.6d8dda6a.mp3', gain: 0.7 }, // machine-gun fire, -30%
  { key: 'rocket',   url: 'assets/sounds/rocket.0e10b34a.mp3' },
  { key: 'cannon',   url: 'assets/sounds/cannon.689d2b52.mp3' },
  { key: 'shipHit',  url: 'assets/sounds/shipHit.8b58950e.mp3' },
  { key: 'shipBoom', url: 'assets/sounds/shipBoom.dcd028da.mp3' },
  { key: 'blast',    url: 'assets/sounds/blast.fcd21671.mp3' },
  // Background music (looping, stereo). Scenes pick a random track via sound_map (entity 'scene').
  { key: 'music_hangar_1', url: 'assets/sounds/music_hangar_1.5c9e57e1.mp3' },
  { key: 'music_combat_1', url: 'assets/sounds/music_combat_1.33e682a2.mp3' },
  { key: 'music_combat_2', url: 'assets/sounds/music_combat_2.d9aa57d1.mp3' }, // "Energetic Synthwave" (Pixabay)
];

// --- sound_map: routing. (entity, class, event) -> sound key. `entity` is 'ship' | 'weapon'; `class` is
// the entity's stats.class; `event` is ship 'explode'/'hit' or weapon 'fire'/'explode' (rocket detonation).
// The client resolves at runtime (sfxFor / tracksFor) — NO hardcoded routing. Unmapped -> synth/silent.
// Multiple rows may share (entity,class,event) — e.g. several music tracks per scene, played at random.
// Enemy weapon FIRE is never sampled (gated by isPlayer at the call site), so only the rocket 'explode'
// row affects enemies (their rocket detonation = blast, matching the old hardcoded behavior).
export const SOUND_MAP = [
  { entity: 'weapon', class: 'kinetic', event: 'fire',    sound: 'kinetic' },
  { entity: 'weapon', class: 'cannon',  event: 'fire',    sound: 'cannon' },
  { entity: 'weapon', class: 'rocket',  event: 'fire',    sound: 'rocket' },
  { entity: 'weapon', class: 'rocket',  event: 'explode', sound: 'blast' },   // rocket detonation
  { entity: 'ship',   class: 'fighter', event: 'explode', sound: 'blast' },   // small ships
  { entity: 'ship',   class: 'capital', event: 'explode', sound: 'shipBoom' },// medium/large ships
  { entity: 'ship',   class: 'player',  event: 'explode', sound: 'shipBoom' },
  { entity: 'ship',   class: 'player',  event: 'hit',     sound: 'shipHit' },
  // Background music per scene (add more rows with the same (scene,class,'music') for random rotation).
  { entity: 'scene',  class: 'hangar',  event: 'music',   sound: 'music_hangar_1' },
  { entity: 'scene',  class: 'combat',  event: 'music',   sound: 'music_combat_1' },
  { entity: 'scene',  class: 'combat',  event: 'music',   sound: 'music_combat_2' },
];

// fire-group presets (a group can carry a player key and/or an enemy AI rule; ships use what fits)
const GUN = { key: 'Space', ai: { range: 45, aimTol: 0.25 } };
const GUN_LONG = { ai: { range: 90, aimTol: 0.25 } }; // long-range MG (pirate gunner): engage from afar
const ROCKET = { key: 'KeyF', ai: { range: 80, aimTol: 0.40 } };

// Map/border marker colors by ship SIZE TIER. The off-screen edge arrows (#markers), the corner
// minimap dots (#minimap) and the hangar ship-dot all read each ship's `stats.color` — they do NOT
// tint the 3D model (the .glb bakes its own color). Convention — keep new enemies consistent with it:
//   small  → orange  (enemy_1 fighters/gunners + enemy_2 rocketeers)
//   medium → red     (enemy_3 mediums)
//   boss   → maroon  (enemy_4 bosses)
const MARKER = { small: 0xf4741f, medium: 0xe53935, boss: 0x800020 };

// --- ships: one table for player + enemies. `components` references a hull + an engine by id
// (player_ships.components may override them); `stats` carry role/color + groups + mounts, plus a
// `model` block (per-ship model presentation: yaw/scale + optional scaleMul/muzzle/exhaust overrides —
// see docs/plans/adding-a-ship-model.md).
// fighter, rocketeer and the medium share the SAME engine (6); the medium is sluggish only because of
// its heavier hull (mass). The boss has its own hull + engine; weapons are shared (in WEAPONS).
// `modelUrl` = the COMBAT (low-poly, same-origin) model; the optional `modelUrlHigh` = the HANGAR
// (high-poly, CloudFront, lazy-loaded) model. In-git primitives stay as `assets/ships/<ship>.glb`;
// content-hashed CDN/S3 URLs come from the asset pipeline (docs/plans/ship-model-pipeline.md). No ship
// has a high-poly model yet (all `modelUrlHigh` null).
export const SHIPS = [
  {
    name: 'Basic player ship', type: 'player',
    modelUrl: 'assets/ships/player_combat.f7171045.glb',
    modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/player_hangar.7f573bc5.glb',
    components: { hull: 1, engine: 5, thruster: 8, grab: 29 }, stats: { // player starts with the base Grab (id 29)
      role: 'player', class: 'player', color: 0x4d8bff, nameKey: 'ship.player_basic.name',
      // "Air & Space Vessel" by Raven (CC-BY); yaw 0 (nose already leads travel), set via visual check
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-1.277,y:-0.208,z:-0.461},h:{x:0.56,y:0.183,z:0.1},u0:{x:0.9093,y:-0.0005,z:0.4162},u1:{x:-0.4161,y:0.0157,z:0.9092},u2:{x:0.007,y:0.9999,z:-0.0141}},{c:{x:0.094,y:-0.15,z:-0.465},h:{x:0.544,y:0.208,z:0.148},u0:{x:0.0369,y:0.0225,z:0.9991},u1:{x:0.0085,y:0.9997,z:-0.0228},u2:{x:0.9993,y:-0.0093,z:-0.0367}},{c:{x:-0.067,y:-0.16,z:-0.659},h:{x:0.348,y:0.275,z:0.231},u0:{x:-0.6111,y:-0.4137,z:0.6748},u1:{x:0.0417,y:0.8345,z:0.5494},u2:{x:0.7905,y:-0.3639,z:0.4927}},{c:{x:0.231,y:-0.163,z:-0.374},h:{x:0.447,y:0.237,z:0.121},u0:{x:0.0114,y:0.0195,z:0.9997},u1:{x:-0.1488,y:0.9887,z:-0.0176},u2:{x:0.9888,y:0.1486,z:-0.0142}},{c:{x:-0.325,y:-0.231,z:-0.313},h:{x:0.297,y:0.195,z:0.135},u0:{x:-0.0123,y:0.0725,z:0.9973},u1:{x:0.1443,y:0.9871,z:-0.07},u2:{x:0.9895,y:-0.1431,z:0.0226}},{c:{x:0.033,y:0.051,z:-0.326},h:{x:0.404,y:0.197,z:0.103},u0:{x:0.0856,y:0.009,z:0.9963},u1:{x:0.9959,y:-0.0302,z:-0.0853},u2:{x:0.0294,y:0.9995,z:-0.0115}},{c:{x:0.375,y:-0.171,z:-0.11},h:{x:0.224,y:0.201,z:0.176},u0:{x:0.1042,y:0.9703,z:-0.2184},u1:{x:0.2995,y:0.1788,z:0.9372},u2:{x:0.9484,y:-0.1631,z:-0.2719}},{c:{x:0.015,y:-0.253,z:0.303},h:{x:0.364,y:0.167,z:0.125},u0:{x:-0.0457,y:0.0011,z:0.999},u1:{x:0.9965,y:0.07,z:0.0455},u2:{x:-0.0698,y:0.9975,z:-0.0043}},{c:{x:-0.066,y:-0.09,z:-0.272},h:{x:0.368,y:0.259,z:0.146},u0:{x:0.0033,y:0.3934,z:0.9193},u1:{x:0.0469,y:0.9183,z:-0.3932},u2:{x:0.9989,y:-0.0444,z:0.0154}},{c:{x:-0.258,y:-0.074,z:-0.091},h:{x:0.215,y:0.163,z:0.109},u0:{x:0.6349,y:0.0938,z:0.7669},u1:{x:0.7374,y:0.2225,z:-0.6377},u2:{x:-0.2305,y:0.9704,z:0.0721}},{c:{x:-0.145,y:-0.147,z:0.131},h:{x:0.317,y:0.213,z:0.182},u0:{x:0.7764,y:0.6295,z:0.0305},u1:{x:-0.6012,y:0.7543,z:-0.2638},u2:{x:-0.189,y:0.1865,z:0.9641}},{c:{x:-0.039,y:-0.204,z:0.839},h:{x:0.319,y:0.202,z:0.146},u0:{x:0.1375,y:-0.1103,z:0.9843},u1:{x:0.9905,y:0.0099,z:-0.1373},u2:{x:0.0054,y:0.9939,z:0.1106}},{c:{x:0.374,y:-0.174,z:0.342},h:{x:0.395,y:0.15,z:0.14},u0:{x:-0.0955,y:0.0034,z:0.9954},u1:{x:0.8975,y:-0.4322,z:0.0876},u2:{x:0.4305,y:0.9018,z:0.0382}},{c:{x:-0.701,y:-0.221,z:-0.218},h:{x:0.292,y:0.254,z:0.1},u0:{x:0.4912,y:0.0232,z:0.8707},u1:{x:0.8708,y:0.0118,z:-0.4916},u2:{x:-0.0217,y:0.9997,z:-0.0144}},{c:{x:0.329,y:-0.236,z:-0.427},h:{x:0.28,y:0.185,z:0.136},u0:{x:0.0053,y:0.0601,z:0.9982},u1:{x:0.1463,y:0.9874,z:-0.0602},u2:{x:0.9892,y:-0.1463,z:0.0035}},{c:{x:-0.417,y:-0.177,z:-0.642},h:{x:0.264,y:0.134,z:0.1},u0:{x:0.0081,y:-0.1518,z:0.9884},u1:{x:0.9937,y:0.1115,z:0.0089},u2:{x:-0.1115,y:0.9821,z:0.1517}},{c:{x:-0.164,y:-0.237,z:-0.026},h:{x:0.276,y:0.173,z:0.104},u0:{x:0.9619,y:0.273,z:0.0171},u1:{x:-0.2734,y:0.9615,z:0.0288},u2:{x:-0.0086,y:-0.0324,z:0.9994}},{c:{x:-0.456,y:-0.174,z:0.074},h:{x:0.207,y:0.165,z:0.143},u0:{x:0.1064,y:-0.0615,z:0.9924},u1:{x:0.8498,y:0.5239,z:-0.0586},u2:{x:-0.5163,y:0.8496,z:0.108}},{c:{x:1.001,y:-0.216,z:-0.349},h:{x:0.594,y:0.162,z:0.1},u0:{x:0.927,y:0.0009,z:-0.3752},u1:{x:0.3751,y:0.0105,z:0.9269},u2:{x:-0.0048,y:0.9999,z:-0.0094}},{c:{x:-0.198,y:-0.175,z:0.316},h:{x:0.215,y:0.132,z:0.126},u0:{x:-0.0419,y:0.0333,z:0.9986},u1:{x:0.4609,y:0.8874,z:-0.0102},u2:{x:0.8864,y:-0.4598,z:0.0526}},{c:{x:0.132,y:-0.195,z:0.615},h:{x:0.375,y:0.143,z:0.129},u0:{x:-0.1367,y:-0.0892,z:0.9866},u1:{x:-0.3685,y:0.929,z:0.033},u2:{x:0.9195,y:0.3591,z:0.1599}},{c:{x:0.28,y:-0.277,z:0.17},h:{x:0.199,y:0.189,z:0.117},u0:{x:-0.0221,y:-0.0241,z:0.9995},u1:{x:0.9991,y:-0.0364,z:0.0213},u2:{x:0.0359,y:0.999,z:0.0249}},{c:{x:-0.356,y:-0.031,z:-0.37},h:{x:0.238,y:0.167,z:0.117},u0:{x:0.4603,y:-0.3294,z:0.8244},u1:{x:0.7787,y:-0.2962,z:-0.5531},u2:{x:0.4263,y:0.8966,z:0.1202}},{c:{x:-0.081,y:-0.173,z:0.301},h:{x:0.216,y:0.17,z:0.151},u0:{x:0.0073,y:0.9925,z:-0.1217},u1:{x:0.8792,y:0.0516,z:0.4736},u2:{x:-0.4764,y:0.1104,z:0.8723}},{c:{x:-0.025,y:-0.026,z:0.342},h:{x:0.256,y:0.13,z:0.1},u0:{x:0.1361,y:-0.2153,z:0.967},u1:{x:0.9904,y:0.0544,z:-0.1273},u2:{x:-0.0252,y:0.975,z:0.2207}},{c:{x:0.113,y:-0.14,z:0.16},h:{x:0.245,y:0.244,z:0.167},u0:{x:-0.139,y:-0.2919,z:0.9463},u1:{x:-0.0385,y:0.9564,z:0.2894},u2:{x:0.9896,y:-0.0038,z:0.1441}},{c:{x:0.438,y:-0.174,z:-0.347},h:{x:0.206,y:0.137,z:0.1},u0:{x:-0.0904,y:0.1231,z:0.9883},u1:{x:-0.2646,y:0.9537,z:-0.143},u2:{x:0.9601,y:0.2744,z:0.0537}},{c:{x:-0.457,y:-0.127,z:-0.431},h:{x:0.414,y:0.108,z:0.1},u0:{x:0.0202,y:0.0469,z:0.9987},u1:{x:0.8625,y:0.5044,z:-0.0412},u2:{x:-0.5057,y:0.8622,z:-0.0303}},{c:{x:0.279,y:-0.178,z:0.053},h:{x:0.313,y:0.142,z:0.108},u0:{x:0.0274,y:-0.0384,z:0.9989},u1:{x:0.9579,y:-0.2846,z:-0.0372},u2:{x:0.2857,y:0.9579,z:0.029}},{c:{x:-0.373,y:-0.182,z:0.449},h:{x:0.288,y:0.124,z:0.104},u0:{x:0.0846,y:0.0082,z:0.9964},u1:{x:-0.4499,y:0.8926,z:0.0308},u2:{x:0.8891,y:0.4509,z:-0.0792}},{c:{x:-0.44,y:-0.191,z:-0.25},h:{x:0.242,y:0.181,z:0.128},u0:{x:-0.1418,y:-0.0019,z:0.9899},u1:{x:0.9803,y:-0.1394,z:0.1402},u2:{x:0.1377,y:0.9902,z:0.0216}},{c:{x:0.439,y:-0.157,z:-0.671},h:{x:0.233,y:0.121,z:0.1},u0:{x:-0.0045,y:-0.0909,z:0.9958},u1:{x:-0.2513,y:0.964,z:0.0869},u2:{x:0.9679,y:0.2499,z:0.0271}},{c:{x:0.344,y:-0.072,z:-0.378},h:{x:0.236,y:0.159,z:0.117},u0:{x:-0.3884,y:-0.0072,z:0.9214},u1:{x:-0.6597,y:0.7003,z:-0.2726},u2:{x:0.6434,y:0.7138,z:0.2768}},{c:{x:0,y:0.185,z:-0.849},h:{x:0.306,y:0.22,z:0.1},u0:{x:0.0009,y:-0.6596,z:0.7516},u1:{x:-0.0055,y:0.7516,z:0.6596},u2:{x:1,y:0.0047,z:0.0029}},{c:{x:-0.304,y:-0.23,z:0.277},h:{x:0.165,y:0.142,z:0.135},u0:{x:0.0964,y:0.9768,z:0.1911},u1:{x:0.9063,y:-0.0067,z:-0.4226},u2:{x:0.4115,y:-0.2139,z:0.8859}},{c:{x:-0.075,y:-0.099,z:0.563},h:{x:0.278,y:0.181,z:0.107},u0:{x:0.1671,y:-0.1269,z:0.9777},u1:{x:0.9459,y:0.3003,z:-0.1227},u2:{x:-0.2781,y:0.9454,z:0.1702}},{c:{x:0.635,y:-0.208,z:-0.229},h:{x:0.266,y:0.141,z:0.1},u0:{x:-0.0805,y:-0.0174,z:0.9966},u1:{x:0.9967,y:-0.0135,z:0.0803},u2:{x:0.0121,y:0.9998,z:0.0184}},{c:{x:0.01,y:-0.25,z:-0.093},h:{x:0.253,y:0.224,z:0.11},u0:{x:0.9128,y:-0.0176,z:0.408},u1:{x:-0.4083,y:-0.0454,z:0.9117},u2:{x:-0.0025,y:0.9988,z:0.0486}},{c:{x:-0.195,y:-0.156,z:-0.308},h:{x:0.298,y:0.259,z:0.117},u0:{x:0.0307,y:0.1105,z:0.9934},u1:{x:0.1174,y:0.9866,z:-0.1134},u2:{x:0.9926,y:-0.1201,z:-0.0173}},{c:{x:-0.113,y:-0.173,z:0.497},h:{x:0.222,y:0.203,z:0.125},u0:{x:0.4522,y:0.0158,z:0.8918},u1:{x:0.8905,y:-0.065,z:-0.4504},u2:{x:0.0508,y:0.9978,z:-0.0435}},{c:{x:-0.093,y:-0.235,z:0.432},h:{x:0.206,y:0.148,z:0.1},u0:{x:0.0066,y:0.9221,z:-0.3868},u1:{x:-0.0465,y:0.3867,z:0.921},u2:{x:0.9989,y:0.0119,z:0.0454}},{c:{x:0.005,y:-0.097,z:-1.002},h:{x:0.156,y:0.132,z:0.1},u0:{x:-0.1432,y:-0.1303,z:0.9811},u1:{x:0.9877,y:0.0449,z:0.1501},u2:{x:-0.0636,y:0.9905,z:0.1223}},{c:{x:1.68,y:-0.215,z:-0.641},h:{x:0.183,y:0.1,z:0.1},u0:{x:-0.0931,y:0.0388,z:0.9949},u1:{x:-0.0632,y:0.997,z:-0.0448},u2:{x:0.9936,y:0.0671,z:0.0904}},{c:{x:0.175,y:-0.178,z:-0.78},h:{x:0.122,y:0.116,z:0.1},u0:{x:-0.119,y:0.9672,z:0.2246},u1:{x:0.9601,y:0.0544,z:0.2743},u2:{x:-0.2531,y:-0.2482,z:0.9351}},{c:{x:-0.39,y:-0.23,z:-0.606},h:{x:0.162,y:0.135,z:0.102},u0:{x:0.5995,y:-0.591,z:0.5397},u1:{x:-0.1417,y:0.5852,z:0.7984},u2:{x:0.7877,y:0.5552,z:-0.2671}},{c:{x:0.498,y:-0.2,z:-0.238},h:{x:0.312,y:0.12,z:0.1},u0:{x:-0.0078,y:0.009,z:0.9999},u1:{x:0.731,y:-0.6823,z:0.0119},u2:{x:0.6823,y:0.7311,z:-0.0012}},{c:{x:0.063,y:-0.135,z:0.446},h:{x:0.188,y:0.165,z:0.132},u0:{x:-0.0815,y:-0.0001,z:0.9967},u1:{x:-0.4229,y:0.9055,z:-0.0345},u2:{x:0.9025,y:0.4243,z:0.0739}},{c:{x:0.793,y:-0.22,z:-0.384},h:{x:0.14,y:0.127,z:0.1},u0:{x:0.5202,y:-0.0973,z:0.8485},u1:{x:0.847,y:-0.069,z:-0.5272},u2:{x:0.1098,y:0.9929,z:0.0466}}], broadR: 2.001 /* hitboxes:auto:end */, lift: 0.18, yaw: 0, scale: 1.1 }, // lift: raise the hull into the top-down bullet plane (bbox center sat above the deck)
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 1, group: 'gun', offset: 0, delay: 0 },
        { weapon: 3, group: 'rocket', offset: 0, delay: 0 },
      ]
    }
  },
  {
    name: 'Basic pirate ship', type: 'enemy', modelUrl: 'assets/ships/enemy_1_combat.527b5a89.glb', modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/enemy_1_hangar.aa6fed25.glb',
    components: { hull: 2, engine: 6, thruster: 9 }, stats: { // light hull (30 hp) + scout engine/thrusters
      role: 'fighter', class: 'fighter', color: MARKER.small, reward: 25,
      // the enemy_1 .glb was exported nose-toward -Z; yaw Math.PI rotates it 180° so it faces +Z like all ships
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:0.228,y:-0.132,z:0.243},h:{x:0.363,y:0.198,z:0.155},u0:{x:0.0983,y:-0.1354,z:0.9859},u1:{x:0.3103,y:0.9455,z:0.0989},u2:{x:0.9456,y:-0.2962,z:-0.135}},{c:{x:-0.007,y:0.406,z:-1.127},h:{x:0.412,y:0.333,z:0.192},u0:{x:-0.0833,y:-0.3334,z:0.9391},u1:{x:0.9937,y:0.0426,z:0.1033},u2:{x:-0.0745,y:0.9418,z:0.3278}},{c:{x:0.303,y:-0.344,z:-1.012},h:{x:0.415,y:0.316,z:0.133},u0:{x:0.9987,y:-0.0428,z:0.0269},u1:{x:-0.0182,y:0.1925,z:0.9811},u2:{x:0.0471,y:0.9804,z:-0.1915}},{c:{x:-0.02,y:-0.037,z:1.025},h:{x:0.4,y:0.216,z:0.207},u0:{x:0.0075,y:-0.133,z:0.9911},u1:{x:0.1018,y:0.9861,z:0.1316},u2:{x:0.9948,y:-0.0999,z:-0.0209}},{c:{x:0.506,y:0.011,z:-1.059},h:{x:0.361,y:0.313,z:0.145},u0:{x:-0.0299,y:-0.0474,z:0.9984},u1:{x:0.973,y:-0.23,z:0.0182},u2:{x:0.2288,y:0.972,z:0.053}},{c:{x:1.058,y:-0.208,z:-0.856},h:{x:0.505,y:0.18,z:0.119},u0:{x:0.1675,y:0.0239,z:0.9856},u1:{x:0.0893,y:0.9952,z:-0.0393},u2:{x:0.9818,y:-0.0946,z:-0.1646}},{c:{x:0.012,y:-0.19,z:1.337},h:{x:0.419,y:0.27,z:0.246},u0:{x:-0.2445,y:0.0205,z:0.9694},u1:{x:0.8558,y:-0.4654,z:0.2257},u2:{x:0.4558,y:0.8849,z:0.0963}},{c:{x:-0.439,y:-0.403,z:-1.046},h:{x:0.356,y:0.312,z:0.1},u0:{x:-0.6695,y:0.1416,z:0.7292},u1:{x:0.7164,y:-0.1363,z:0.6843},u2:{x:0.1962,y:0.9805,z:-0.0102}},{c:{x:-0.977,y:-0.146,z:-0.856},h:{x:0.502,y:0.217,z:0.169},u0:{x:-0.0546,y:-0.0112,z:0.9984},u1:{x:0.6747,y:0.7367,z:0.0452},u2:{x:0.736,y:-0.6762,z:0.0326}},{c:{x:-0.183,y:-0.146,z:-0.173},h:{x:0.284,y:0.21,z:0.139},u0:{x:-0.1687,y:0.1708,z:0.9708},u1:{x:0.1224,y:0.9809,z:-0.1513},u2:{x:0.978,y:-0.0933,z:0.1864}},{c:{x:0.102,y:0.004,z:-0.505},h:{x:0.475,y:0.377,z:0.169},u0:{x:-0.5364,y:-0.0317,z:0.8434},u1:{x:0.8419,y:-0.0898,z:0.5321},u2:{x:0.0589,y:0.9955,z:0.0749}},{c:{x:0.072,y:-0.348,z:-0.481},h:{x:0.436,y:0.28,z:0.177},u0:{x:-0.2854,y:-0.0224,z:0.9581},u1:{x:0.958,y:0.0218,z:0.2859},u2:{x:-0.0273,y:0.9995,z:0.0152}},{c:{x:-0.206,y:0.062,z:-1.352},h:{x:0.369,y:0.241,z:0.168},u0:{x:0.9547,y:0.2631,z:-0.1394},u1:{x:-0.1741,y:0.8729,z:0.4557},u2:{x:0.2415,y:-0.4108,z:0.8792}},{c:{x:-0.23,y:0.049,z:-0.765},h:{x:0.388,y:0.22,z:0.13},u0:{x:0.9505,y:0.3089,z:0.0344},u1:{x:-0.2479,y:0.8203,z:-0.5154},u2:{x:-0.1874,y:0.4814,z:0.8563}},{c:{x:-0.001,y:-0.017,z:0.239},h:{x:0.441,y:0.44,z:0.1},u0:{x:0.6485,y:0.0273,z:0.7607},u1:{x:0.7612,y:-0.0095,z:-0.6485},u2:{x:-0.0105,y:0.9996,z:-0.0269}},{c:{x:-0.172,y:-0.249,z:-0.538},h:{x:0.394,y:0.27,z:0.185},u0:{x:0.1957,y:-0.421,z:0.8857},u1:{x:0.0917,y:0.907,z:0.4109},u2:{x:0.9764,y:-0.0008,z:-0.2161}},{c:{x:-0.053,y:-0.182,z:-1.583},h:{x:0.371,y:0.286,z:0.268},u0:{x:0.8999,y:-0.1052,z:-0.4232},u1:{x:0.2604,y:0.908,z:0.3281},u2:{x:0.3498,y:-0.4054,z:0.8446}},{c:{x:0.115,y:0.188,z:-1.094},h:{x:0.364,y:0.232,z:0.122},u0:{x:0.093,y:-0.1813,z:0.979},u1:{x:-0.4737,y:0.8568,z:0.2037},u2:{x:0.8757,y:0.4827,z:0.0062}},{c:{x:0.591,y:-0.166,z:-1.352},h:{x:0.448,y:0.322,z:0.161},u0:{x:0.9872,y:0.0134,z:0.1592},u1:{x:-0.0017,y:0.9973,z:-0.0734},u2:{x:-0.1597,y:0.0722,z:0.9845}},{c:{x:-0.691,y:-0.186,z:-1.308},h:{x:0.386,y:0.238,z:0.159},u0:{x:0.9306,y:0.2967,z:-0.2142},u1:{x:-0.3106,y:0.9499,z:-0.0337},u2:{x:0.1935,y:0.0979,z:0.9762}},{c:{x:0.697,y:-0.239,z:-1.028},h:{x:0.33,y:0.291,z:0.141},u0:{x:0.0574,y:0.5924,z:0.8036},u1:{x:0.0165,y:0.8042,z:-0.5941},u2:{x:0.9982,y:-0.0474,z:-0.0363}},{c:{x:-0.079,y:0.005,z:0.53},h:{x:0.321,y:0.225,z:0.217},u0:{x:0.8506,y:0.2353,z:0.4702},u1:{x:-0.3003,y:0.9515,z:0.0671},u2:{x:-0.4316,y:-0.1983,z:0.88}},{c:{x:0.884,y:-0.163,z:-0.772},h:{x:0.331,y:0.272,z:0.219},u0:{x:0.8917,y:-0.2721,z:0.3618},u1:{x:0.0675,y:0.8702,z:0.4881},u2:{x:-0.4476,y:-0.4108,z:0.7943}},{c:{x:-0.099,y:-0.395,z:-1.145},h:{x:0.386,y:0.213,z:0.104},u0:{x:-0.2526,y:0.0475,z:0.9664},u1:{x:0.9182,y:0.3266,z:0.2239},u2:{x:-0.305,y:0.944,z:-0.1261}},{c:{x:-0.094,y:-0.403,z:0.544},h:{x:0.643,y:0.182,z:0.103},u0:{x:-0.0209,y:0.0501,z:0.9985},u1:{x:-0.4774,y:0.877,z:-0.054},u2:{x:0.8784,y:0.4778,z:-0.0055}},{c:{x:-0.928,y:-0.262,z:-0.844},h:{x:0.501,y:0.269,z:0.12},u0:{x:-0.2085,y:0.0156,z:0.9779},u1:{x:0.9696,y:-0.1277,z:0.2088},u2:{x:0.1281,y:0.9917,z:0.0115}},{c:{x:-0.653,y:-0.15,z:-0.901},h:{x:0.286,y:0.278,z:0.188},u0:{x:0.382,y:0.9234,z:-0.0378},u1:{x:0.8315,y:-0.3613,z:-0.4219},u2:{x:0.4033,y:-0.1298,z:0.9058}},{c:{x:0.984,y:-0.125,z:-1.078},h:{x:0.304,y:0.238,z:0.109},u0:{x:0.0685,y:0.0813,z:0.9943},u1:{x:0.9441,y:-0.3274,z:-0.0383},u2:{x:0.3224,y:0.9414,z:-0.0991}},{c:{x:-0.356,y:-0.203,z:-0.89},h:{x:0.341,y:0.271,z:0.151},u0:{x:0.4506,y:0.8628,z:0.2292},u1:{x:0.8917,y:-0.447,z:-0.0708},u2:{x:-0.0414,y:-0.2363,z:0.9708}},{c:{x:0.188,y:-0.194,z:0.493},h:{x:0.308,y:0.288,z:0.182},u0:{x:-0.0979,y:0.6788,z:0.7277},u1:{x:-0.0351,y:0.7285,z:-0.6842},u2:{x:0.9946,y:0.0925,z:0.0475}},{c:{x:0.44,y:-0.14,z:-0.904},h:{x:0.292,y:0.203,z:0.127},u0:{x:0.9913,y:0.0239,z:-0.1296},u1:{x:-0.0002,y:0.9837,z:0.1799},u2:{x:0.1318,y:-0.1783,z:0.9751}},{c:{x:-0.187,y:-0.202,z:0.152},h:{x:0.394,y:0.264,z:0.1},u0:{x:-0.1277,y:0.1679,z:0.9775},u1:{x:-0.5044,y:0.8376,z:-0.2098},u2:{x:0.8539,y:0.5199,z:0.0223}},{c:{x:-0.126,y:0.16,z:-1.093},h:{x:0.373,y:0.225,z:0.123},u0:{x:-0.1549,y:-0.3538,z:0.9224},u1:{x:0.4277,y:0.8176,z:0.3854},u2:{x:0.8905,y:-0.4542,z:-0.0247}},{c:{x:-0.183,y:-0.229,z:0.863},h:{x:0.449,y:0.179,z:0.152},u0:{x:0.0527,y:-0.0301,z:0.9982},u1:{x:0.9981,y:0.0344,z:-0.0516},u2:{x:-0.0328,y:0.999,z:0.0319}},{c:{x:-0.368,y:-0.356,z:-0.765},h:{x:0.367,y:0.165,z:0.136},u0:{x:0.9913,y:0.0519,z:0.121},u1:{x:-0.1312,y:0.4664,z:0.8748},u2:{x:0.011,y:0.883,z:-0.4692}},{c:{x:0.032,y:-0.48,z:0.367},h:{x:0.405,y:0.16,z:0.1},u0:{x:0.0368,y:0.0719,z:0.9967},u1:{x:0.9426,y:0.3287,z:-0.0585},u2:{x:-0.3319,y:0.9417,z:-0.0557}},{c:{x:0.197,y:-0.182,z:-0.416},h:{x:0.483,y:0.188,z:0.1},u0:{x:-0.0515,y:0.0086,z:0.9986},u1:{x:0.003,y:1,z:-0.0085},u2:{x:0.9987,y:-0.0026,z:0.0515}},{c:{x:0.185,y:-0.352,z:-1.364},h:{x:0.267,y:0.225,z:0.124},u0:{x:0.8979,y:-0.3637,z:0.2478},u1:{x:0.4369,y:0.6688,z:-0.6015},u2:{x:0.053,y:0.6484,z:0.7595}},{c:{x:0.148,y:-0.353,z:0.343},h:{x:0.547,y:0.167,z:0.1},u0:{x:0.0175,y:-0.0597,z:0.9981},u1:{x:0.3939,y:0.9179,z:0.048},u2:{x:0.919,y:-0.3923,z:-0.0396}},{c:{x:0.892,y:-0.306,z:-1.067},h:{x:0.297,y:0.234,z:0.1},u0:{x:0.1295,y:-0.0139,z:0.9915},u1:{x:0.9589,y:0.2565,z:-0.1217},u2:{x:-0.2526,y:0.9664,z:0.0466}},{c:{x:0.16,y:-0.22,z:0.835},h:{x:0.252,y:0.183,z:0.132},u0:{x:0.1338,y:-0.0911,z:0.9868},u1:{x:0.8896,y:-0.4278,z:-0.1601},u2:{x:0.4367,y:0.8993,z:0.0238}},{c:{x:-0.371,y:0.103,z:-1.045},h:{x:0.268,y:0.204,z:0.1},u0:{x:-0.01,y:-0.0494,z:0.9987},u1:{x:0.9972,y:0.0729,z:0.0136},u2:{x:-0.0735,y:0.9961,z:0.0485}},{c:{x:-0.359,y:-0.349,z:-1.326},h:{x:0.356,y:0.174,z:0.116},u0:{x:0.9929,y:-0.0919,z:-0.076},u1:{x:0.0319,y:-0.4099,z:0.9116},u2:{x:0.1149,y:0.9075,z:0.4041}},{c:{x:0.061,y:-0.391,z:0.938},h:{x:0.295,y:0.213,z:0.132},u0:{x:-0.1451,y:0.1724,z:0.9743},u1:{x:0.9054,y:0.4201,z:0.0605},u2:{x:-0.3989,y:0.891,z:-0.217}},{c:{x:-0.571,y:0.013,z:-1.152},h:{x:0.255,y:0.145,z:0.1},u0:{x:-0.0117,y:0.0092,z:0.9999},u1:{x:0.69,y:0.7238,z:0.0014},u2:{x:0.7237,y:-0.6899,z:0.0148}},{c:{x:0.006,y:-0.425,z:-0.047},h:{x:0.198,y:0.193,z:0.102},u0:{x:-0.3334,y:0.7006,z:-0.6308},u1:{x:0.9422,y:0.2247,z:-0.2484},u2:{x:0.0323,y:0.6772,z:0.7351}},{c:{x:-0.804,y:-0.042,z:-0.94},h:{x:0.373,y:0.209,z:0.1},u0:{x:-0.0315,y:-0.0025,z:0.9995},u1:{x:0.9896,y:0.1404,z:0.0315},u2:{x:-0.1404,y:0.9901,z:-0.002}},{c:{x:0.112,y:0.018,z:-1.378},h:{x:0.278,y:0.185,z:0.141},u0:{x:-0.1775,y:0.9239,z:0.3389},u1:{x:0.8812,y:-0.0041,z:0.4728},u2:{x:-0.4382,y:-0.3825,z:0.8134}}], broadR: 2.097 /* hitboxes:auto:end */, lift: 0.21, yaw: Math.PI, scale: 1 } /* enemy_1: lift raises the hull onto the bullet plane (assets:hitboxes coverage) */,
      groups: { gun: GUN },
      mounts: [{ weapon: 2, group: 'gun', offset: 0, delay: 0 }]
    }
  },
  {
    name: 'basic rocket pirate', type: 'enemy', modelUrl: 'assets/ships/enemy_2_combat.e6fbbe91.glb',
    components: { hull: 2, engine: 6, thruster: 9 }, stats: { // same hull + engine + thrusters as the fighter
      role: 'rocketeer', class: 'fighter', color: MARKER.small, reward: 50,
      // enemy_2 export faces -Z (same pack as enemy_1); yaw Math.PI rotates 180° to face +Z
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.09,y:-0.121,z:-1.211},h:{x:0.419,y:0.269,z:0.169},u0:{x:0.9939,y:0.0615,z:0.0911},u1:{x:-0.0363,y:0.9662,z:-0.2554},u2:{x:-0.1038,y:0.2505,z:0.9625}},{c:{x:-0.348,y:-0.076,z:-0.42},h:{x:0.491,y:0.304,z:0.258},u0:{x:-0.1039,y:-0.016,z:0.9945},u1:{x:0.5984,y:0.7977,z:0.0753},u2:{x:0.7945,y:-0.6029,z:0.0734}},{c:{x:0.414,y:-0.022,z:0.508},h:{x:0.42,y:0.283,z:0.183},u0:{x:-0.3442,y:0.02,z:0.9387},u1:{x:0.911,y:-0.2346,z:0.3391},u2:{x:0.227,y:0.9719,z:0.0625}},{c:{x:0.036,y:0.209,z:-0.6},h:{x:0.392,y:0.339,z:0.177},u0:{x:0.9616,y:-0.0181,z:-0.2738},u1:{x:0.2693,y:-0.1287,z:0.9544},u2:{x:0.0525,y:0.9915,z:0.1189}},{c:{x:-0.465,y:0.011,z:-1.083},h:{x:0.35,y:0.285,z:0.191},u0:{x:0.0951,y:-0.2011,z:0.9749},u1:{x:0.1304,y:0.9735,z:0.1881},u2:{x:0.9869,y:-0.1092,z:-0.1188}},{c:{x:0.075,y:0.145,z:-0.102},h:{x:0.517,y:0.435,z:0.129},u0:{x:0.7552,y:-0.0432,z:0.6541},u1:{x:-0.6549,y:-0.0046,z:0.7557},u2:{x:0.0296,y:0.9991,z:0.0318}},{c:{x:0.386,y:0.184,z:-0.983},h:{x:0.33,y:0.227,z:0.148},u0:{x:-0.317,y:0.9152,z:-0.2488},u1:{x:0.8781,y:0.1841,z:-0.4416},u2:{x:0.3584,y:0.3584,z:0.862}},{c:{x:0.357,y:-0.049,z:-0.276},h:{x:0.625,y:0.284,z:0.248},u0:{x:0.0412,y:-0.0578,z:0.9975},u1:{x:-0.432,y:0.8991,z:0.07},u2:{x:0.9009,y:0.4338,z:-0.0121}},{c:{x:-0.431,y:0.065,z:0.422},h:{x:0.497,y:0.273,z:0.248},u0:{x:0.1639,y:0.0706,z:0.9839},u1:{x:0.8977,y:0.4028,z:-0.1785},u2:{x:-0.409,y:0.9126,z:0.0027}},{c:{x:0.013,y:-0.28,z:1.298},h:{x:0.459,y:0.199,z:0.124},u0:{x:-0.0821,y:-0.0441,z:0.9956},u1:{x:0.992,y:0.0926,z:0.0859},u2:{x:-0.096,y:0.9947,z:0.0361}},{c:{x:0.242,y:-0.104,z:0.875},h:{x:0.38,y:0.195,z:0.12},u0:{x:-0.3286,y:-0.3253,z:0.8867},u1:{x:0.1176,y:0.9174,z:0.3801},u2:{x:0.9371,y:-0.2292,z:0.2633}},{c:{x:0.06,y:0.155,z:-1.06},h:{x:0.343,y:0.312,z:0.117},u0:{x:0.7923,y:0.0165,z:-0.6099},u1:{x:0.5894,y:0.2377,z:0.7721},u2:{x:-0.1577,y:0.9712,z:-0.1785}},{c:{x:-0.772,y:-0.004,z:-1.267},h:{x:0.523,y:0.256,z:0.14},u0:{x:0.3721,y:0.0088,z:0.9282},u1:{x:0.9276,y:-0.0399,z:-0.3715},u2:{x:0.0338,y:0.9992,z:-0.023}},{c:{x:-0.552,y:0.338,z:-1.171},h:{x:0.376,y:0.26,z:0.134},u0:{x:0.3918,y:0.0448,z:0.9189},u1:{x:0.9149,y:0.0863,z:-0.3943},u2:{x:-0.097,y:0.9953,z:-0.0071}},{c:{x:0.354,y:0.346,z:-1.171},h:{x:0.413,y:0.335,z:0.121},u0:{x:0.7998,y:-0.1738,z:-0.5746},u1:{x:0.5624,y:-0.1177,z:0.8184},u2:{x:0.2099,y:0.9777,z:-0.0036}},{c:{x:-0.907,y:-0.204,z:-0.317},h:{x:0.518,y:0.242,z:0.17},u0:{x:-0.078,y:-0.0528,z:0.9956},u1:{x:0.8351,y:0.542,z:0.0942},u2:{x:-0.5446,y:0.8387,z:0.0018}},{c:{x:0.688,y:-0.194,z:-0.306},h:{x:0.558,y:0.302,z:0.196},u0:{x:-0.1367,y:0.0153,z:0.9905},u1:{x:0.9636,y:-0.2299,z:0.1366},u2:{x:0.2298,y:0.9731,z:0.0166}},{c:{x:0.12,y:-0.255,z:0.725},h:{x:0.289,y:0.279,z:0.142},u0:{x:0.1873,y:0.2154,z:0.9584},u1:{x:0.8654,y:0.4255,z:-0.2647},u2:{x:-0.4648,y:0.879,z:-0.1067}},{c:{x:0.737,y:-0.047,z:-1.25},h:{x:0.556,y:0.299,z:0.195},u0:{x:-0.5102,y:0.0111,z:0.86},u1:{x:0.8326,y:-0.2441,z:0.4971},u2:{x:0.2155,y:0.9697,z:0.1153}},{c:{x:-0.213,y:-0.184,z:0.459},h:{x:0.499,y:0.217,z:0.126},u0:{x:0.082,y:0.0099,z:0.9966},u1:{x:-0.6868,y:0.7252,z:0.0493},u2:{x:0.7222,y:0.6885,z:-0.0663}},{c:{x:1.326,y:-0.284,z:-0.568},h:{x:0.454,y:0.325,z:0.141},u0:{x:-0.67,y:0.1512,z:0.7268},u1:{x:0.7077,y:-0.1655,z:0.6869},u2:{x:0.2241,y:0.9746,z:0.0038}},{c:{x:0.343,y:-0.259,z:-0.415},h:{x:0.481,y:0.22,z:0.149},u0:{x:0.0547,y:0.0522,z:0.9971},u1:{x:0.9912,y:0.1181,z:-0.0605},u2:{x:-0.1209,y:0.9916,z:-0.0452}},{c:{x:-1.23,y:-0.295,z:-0.545},h:{x:0.502,y:0.41,z:0.159},u0:{x:0.498,y:0.1603,z:0.8522},u1:{x:0.8612,y:0.024,z:-0.5078},u2:{x:-0.1019,y:0.9868,z:-0.1261}},{c:{x:-0.649,y:-0.165,z:-0.287},h:{x:0.534,y:0.185,z:0.175},u0:{x:0.0331,y:-0.0024,z:0.9995},u1:{x:0.9924,y:0.1188,z:-0.0326},u2:{x:-0.1186,y:0.9929,z:0.0063}},{c:{x:0.08,y:-0.252,z:-0.121},h:{x:0.778,y:0.272,z:0.1},u0:{x:0.0326,y:0.0154,z:0.9993},u1:{x:0.9994,y:0.0104,z:-0.0328},u2:{x:-0.0109,y:0.9998,z:-0.0151}},{c:{x:0.977,y:-0.229,z:-0.268},h:{x:0.467,y:0.182,z:0.175},u0:{x:-0.0801,y:-0.0032,z:0.9968},u1:{x:0.98,y:0.1824,z:0.0793},u2:{x:-0.182,y:0.9832,z:-0.0115}},{c:{x:-0.051,y:-0.26,z:-0.944},h:{x:0.373,y:0.198,z:0.1},u0:{x:0.9932,y:-0.0598,z:0.1},u1:{x:-0.0986,y:0.0262,z:0.9948},u2:{x:0.0621,y:0.9979,z:-0.0201}},{c:{x:-0.02,y:0.129,z:0.464},h:{x:0.372,y:0.304,z:0.107},u0:{x:0.3912,y:-0.1325,z:0.9107},u1:{x:0.9182,y:-0.0098,z:-0.3959},u2:{x:0.0613,y:0.9911,z:0.1178}},{c:{x:-0.285,y:0.213,z:-1.034},h:{x:0.249,y:0.245,z:0.174},u0:{x:-0.3091,y:0.7093,z:-0.6335},u1:{x:-0.2057,y:0.6005,z:0.7727},u2:{x:0.9285,y:0.3692,z:-0.0397}},{c:{x:-0.184,y:0.034,z:0.523},h:{x:0.574,y:0.183,z:0.132},u0:{x:0.03,y:-0.2212,z:0.9748},u1:{x:0.8571,y:0.5075,z:0.0888},u2:{x:-0.5144,y:0.8328,z:0.2048}},{c:{x:-0.017,y:-0.015,z:0.955},h:{x:0.374,y:0.322,z:0.1},u0:{x:0.8086,y:0.2647,z:-0.5254},u1:{x:0.5802,y:-0.2112,z:0.7866},u2:{x:-0.0972,y:0.9409,z:0.3244}},{c:{x:0.374,y:0.055,z:-1.208},h:{x:0.315,y:0.182,z:0.17},u0:{x:-0.1754,y:0.9485,z:0.2637},u1:{x:-0.1579,y:-0.2915,z:0.9434},u2:{x:0.9718,y:0.1238,z:0.2009}},{c:{x:-0.373,y:-0.405,z:-0.304},h:{x:0.53,y:0.205,z:0.131},u0:{x:-0.0739,y:-0.0979,z:0.9925},u1:{x:0.8773,y:0.4669,z:0.1114},u2:{x:-0.4743,y:0.8789,z:0.0514}},{c:{x:0.001,y:-0.1,z:1.267},h:{x:0.302,y:0.296,z:0.161},u0:{x:0.6371,y:-0.2205,z:0.7386},u1:{x:0.7704,y:0.2126,z:-0.6011},u2:{x:-0.0245,y:0.952,z:0.3053}},{c:{x:0.009,y:0.376,z:-0.929},h:{x:0.42,y:0.193,z:0.1},u0:{x:0.9996,y:-0.0131,z:0.0234},u1:{x:-0.0239,y:-0.0373,z:0.999},u2:{x:0.0122,y:0.9992,z:0.0376}},{c:{x:0.367,y:-0.167,z:-1.064},h:{x:0.296,y:0.2,z:0.167},u0:{x:-0.0054,y:-0.0683,z:0.9976},u1:{x:0.7452,y:0.665,z:0.0496},u2:{x:-0.6668,y:0.7437,z:0.0473}},{c:{x:0.379,y:-0.441,z:-0.294},h:{x:0.521,y:0.17,z:0.13},u0:{x:0.0592,y:-0.082,z:0.9949},u1:{x:0.9226,y:-0.376,z:-0.0859},u2:{x:0.3811,y:0.923,z:0.0534}},{c:{x:-0.559,y:-0.252,z:-0.381},h:{x:0.458,y:0.345,z:0.101},u0:{x:0.453,y:-0.0152,z:0.8914},u1:{x:0.8913,y:0.0314,z:-0.4524},u2:{x:-0.0211,y:0.9994,z:0.0277}},{c:{x:1.072,y:-0.316,z:-0.773},h:{x:0.254,y:0.214,z:0.155},u0:{x:0.9587,y:-0.1474,z:-0.2431},u1:{x:0.2761,y:0.6867,z:0.6725},u2:{x:-0.0678,y:0.7119,z:-0.699}},{c:{x:-0.14,y:-0.221,z:1.006},h:{x:0.253,y:0.216,z:0.114},u0:{x:0.7421,y:-0.5832,z:0.3303},u1:{x:-0.2102,y:0.2654,z:0.9409},u2:{x:0.6365,y:0.7677,z:-0.0744}},{c:{x:0.289,y:-0.174,z:0.417},h:{x:0.473,y:0.156,z:0.1},u0:{x:-0.0606,y:0.0492,z:0.9969},u1:{x:0.6989,y:0.7151,z:0.0071},u2:{x:0.7126,y:-0.6972,z:0.0777}},{c:{x:-0.324,y:0.118,z:-1.214},h:{x:0.283,y:0.185,z:0.114},u0:{x:-0.084,y:0.9959,z:0.0342},u1:{x:0.9402,y:0.0679,z:0.3337},u2:{x:-0.33,y:-0.0602,z:0.9421}},{c:{x:-0.057,y:0.391,z:-1.156},h:{x:0.321,y:0.154,z:0.113},u0:{x:0.9998,y:0.0183,z:-0.0117},u1:{x:0.0146,y:-0.1684,z:0.9856},u2:{x:-0.016,y:0.9855,z:0.1686}},{c:{x:-1.499,y:-0.355,z:-0.154},h:{x:0.29,y:0.1,z:0.1},u0:{x:0.0182,y:-0.0154,z:0.9997},u1:{x:-0.08,y:0.9967,z:0.0168},u2:{x:0.9966,y:0.0803,z:-0.0169}},{c:{x:-0.27,y:-0.27,z:-0.414},h:{x:0.482,y:0.175,z:0.111},u0:{x:-0.0299,y:0.032,z:0.999},u1:{x:0.9996,y:0.0019,z:0.0299},u2:{x:-0.001,y:0.9995,z:-0.032}},{c:{x:-1.297,y:-0.297,z:-0.122},h:{x:0.173,y:0.1,z:0.1},u0:{x:0.0121,y:0.0125,z:0.9998},u1:{x:-0.3509,y:0.9364,z:-0.0075},u2:{x:0.9364,y:0.3507,z:-0.0157}},{c:{x:1.301,y:-0.294,z:-0.122},h:{x:0.173,y:0.1,z:0.1},u0:{x:-0.0227,y:0.0134,z:0.9997},u1:{x:0.9084,y:0.4178,z:0.0151},u2:{x:-0.4175,y:0.9084,z:-0.0217}},{c:{x:1.516,y:-0.337,z:-0.154},h:{x:0.29,y:0.1,z:0.1},u0:{x:-0.0157,y:-0.015,z:0.9998},u1:{x:0.1013,y:0.9947,z:0.0166},u2:{x:0.9947,y:-0.1015,z:0.0141}}], broadR: 2.053 /* hitboxes:auto:end */, lift: 0.17, yaw: Math.PI, scale: 1 } /* enemy_2: lift raises the hull onto the bullet plane (assets:hitboxes coverage) */,
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 2, group: 'gun', offset: 0, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0, delay: 0 },
      ]
    }
  },
  {
    // Pirate gunner (side missions): a tougher, faster skirmisher — Pirate hull (36 HP) + Pirate engine
    // (top speed +50%) + Scout thrusters, one long-range Pirate machine gun. Uses the orange enemy_1 model.
    name: 'pirate gunner', type: 'enemy', modelUrl: 'assets/ships/enemy_1_orange_combat.f3b006ba.glb', modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/enemy_1_orange_hangar.5e6e1cc4.glb',
    components: { hull: 22, engine: 23, thruster: 9 }, stats: {
      role: 'pirate_gunner', class: 'fighter', color: MARKER.small, reward: 50,
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:0.228,y:-0.132,z:0.243},h:{x:0.363,y:0.198,z:0.155},u0:{x:0.0983,y:-0.1354,z:0.9859},u1:{x:0.3103,y:0.9455,z:0.0989},u2:{x:0.9456,y:-0.2962,z:-0.135}},{c:{x:-0.007,y:0.406,z:-1.127},h:{x:0.412,y:0.333,z:0.192},u0:{x:-0.0833,y:-0.3334,z:0.9391},u1:{x:0.9937,y:0.0426,z:0.1033},u2:{x:-0.0745,y:0.9418,z:0.3278}},{c:{x:0.303,y:-0.344,z:-1.012},h:{x:0.415,y:0.316,z:0.133},u0:{x:0.9987,y:-0.0428,z:0.0269},u1:{x:-0.0182,y:0.1925,z:0.9811},u2:{x:0.0471,y:0.9804,z:-0.1915}},{c:{x:-0.02,y:-0.037,z:1.025},h:{x:0.4,y:0.216,z:0.207},u0:{x:0.0075,y:-0.133,z:0.9911},u1:{x:0.1018,y:0.9861,z:0.1316},u2:{x:0.9948,y:-0.0999,z:-0.0209}},{c:{x:0.506,y:0.011,z:-1.059},h:{x:0.361,y:0.313,z:0.145},u0:{x:-0.0299,y:-0.0474,z:0.9984},u1:{x:0.973,y:-0.23,z:0.0182},u2:{x:0.2288,y:0.972,z:0.053}},{c:{x:1.058,y:-0.208,z:-0.856},h:{x:0.505,y:0.18,z:0.119},u0:{x:0.1675,y:0.0239,z:0.9856},u1:{x:0.0893,y:0.9952,z:-0.0393},u2:{x:0.9818,y:-0.0946,z:-0.1646}},{c:{x:0.012,y:-0.19,z:1.337},h:{x:0.419,y:0.27,z:0.246},u0:{x:-0.2445,y:0.0205,z:0.9694},u1:{x:0.8558,y:-0.4654,z:0.2257},u2:{x:0.4558,y:0.8849,z:0.0963}},{c:{x:-0.439,y:-0.403,z:-1.046},h:{x:0.356,y:0.312,z:0.1},u0:{x:-0.6695,y:0.1416,z:0.7292},u1:{x:0.7164,y:-0.1363,z:0.6843},u2:{x:0.1962,y:0.9805,z:-0.0102}},{c:{x:-0.977,y:-0.146,z:-0.856},h:{x:0.502,y:0.217,z:0.169},u0:{x:-0.0546,y:-0.0112,z:0.9984},u1:{x:0.6747,y:0.7367,z:0.0452},u2:{x:0.736,y:-0.6762,z:0.0326}},{c:{x:-0.183,y:-0.146,z:-0.173},h:{x:0.284,y:0.21,z:0.139},u0:{x:-0.1687,y:0.1708,z:0.9708},u1:{x:0.1224,y:0.9809,z:-0.1513},u2:{x:0.978,y:-0.0933,z:0.1864}},{c:{x:0.102,y:0.004,z:-0.505},h:{x:0.475,y:0.377,z:0.169},u0:{x:-0.5364,y:-0.0317,z:0.8434},u1:{x:0.8419,y:-0.0898,z:0.5321},u2:{x:0.0589,y:0.9955,z:0.0749}},{c:{x:0.072,y:-0.348,z:-0.481},h:{x:0.436,y:0.28,z:0.177},u0:{x:-0.2854,y:-0.0224,z:0.9581},u1:{x:0.958,y:0.0218,z:0.2859},u2:{x:-0.0273,y:0.9995,z:0.0152}},{c:{x:-0.206,y:0.062,z:-1.352},h:{x:0.369,y:0.241,z:0.168},u0:{x:0.9547,y:0.2631,z:-0.1394},u1:{x:-0.1741,y:0.8729,z:0.4557},u2:{x:0.2415,y:-0.4108,z:0.8792}},{c:{x:-0.23,y:0.049,z:-0.765},h:{x:0.388,y:0.22,z:0.13},u0:{x:0.9505,y:0.3089,z:0.0344},u1:{x:-0.2479,y:0.8203,z:-0.5154},u2:{x:-0.1874,y:0.4814,z:0.8563}},{c:{x:-0.001,y:-0.017,z:0.239},h:{x:0.441,y:0.44,z:0.1},u0:{x:0.6485,y:0.0273,z:0.7607},u1:{x:0.7612,y:-0.0095,z:-0.6485},u2:{x:-0.0105,y:0.9996,z:-0.0269}},{c:{x:-0.172,y:-0.249,z:-0.538},h:{x:0.394,y:0.27,z:0.185},u0:{x:0.1957,y:-0.421,z:0.8857},u1:{x:0.0917,y:0.907,z:0.4109},u2:{x:0.9764,y:-0.0008,z:-0.2161}},{c:{x:-0.053,y:-0.182,z:-1.583},h:{x:0.371,y:0.286,z:0.268},u0:{x:0.8999,y:-0.1052,z:-0.4232},u1:{x:0.2604,y:0.908,z:0.3281},u2:{x:0.3498,y:-0.4054,z:0.8446}},{c:{x:0.115,y:0.188,z:-1.094},h:{x:0.364,y:0.232,z:0.122},u0:{x:0.093,y:-0.1813,z:0.979},u1:{x:-0.4737,y:0.8568,z:0.2037},u2:{x:0.8757,y:0.4827,z:0.0062}},{c:{x:0.591,y:-0.166,z:-1.352},h:{x:0.448,y:0.322,z:0.161},u0:{x:0.9872,y:0.0134,z:0.1592},u1:{x:-0.0017,y:0.9973,z:-0.0734},u2:{x:-0.1597,y:0.0722,z:0.9845}},{c:{x:-0.691,y:-0.186,z:-1.308},h:{x:0.386,y:0.238,z:0.159},u0:{x:0.9306,y:0.2967,z:-0.2142},u1:{x:-0.3106,y:0.9499,z:-0.0337},u2:{x:0.1935,y:0.0979,z:0.9762}},{c:{x:0.697,y:-0.239,z:-1.028},h:{x:0.33,y:0.291,z:0.141},u0:{x:0.0574,y:0.5924,z:0.8036},u1:{x:0.0165,y:0.8042,z:-0.5941},u2:{x:0.9982,y:-0.0474,z:-0.0363}},{c:{x:-0.079,y:0.005,z:0.53},h:{x:0.321,y:0.225,z:0.217},u0:{x:0.8506,y:0.2353,z:0.4702},u1:{x:-0.3003,y:0.9515,z:0.0671},u2:{x:-0.4316,y:-0.1983,z:0.88}},{c:{x:0.884,y:-0.163,z:-0.772},h:{x:0.331,y:0.272,z:0.219},u0:{x:0.8917,y:-0.2721,z:0.3618},u1:{x:0.0675,y:0.8702,z:0.4881},u2:{x:-0.4476,y:-0.4108,z:0.7943}},{c:{x:-0.099,y:-0.395,z:-1.145},h:{x:0.386,y:0.213,z:0.104},u0:{x:-0.2526,y:0.0475,z:0.9664},u1:{x:0.9182,y:0.3266,z:0.2239},u2:{x:-0.305,y:0.944,z:-0.1261}},{c:{x:-0.094,y:-0.403,z:0.544},h:{x:0.643,y:0.182,z:0.103},u0:{x:-0.0209,y:0.0501,z:0.9985},u1:{x:-0.4774,y:0.877,z:-0.054},u2:{x:0.8784,y:0.4778,z:-0.0055}},{c:{x:-0.928,y:-0.262,z:-0.844},h:{x:0.501,y:0.269,z:0.12},u0:{x:-0.2085,y:0.0156,z:0.9779},u1:{x:0.9696,y:-0.1277,z:0.2088},u2:{x:0.1281,y:0.9917,z:0.0115}},{c:{x:-0.653,y:-0.15,z:-0.901},h:{x:0.286,y:0.278,z:0.188},u0:{x:0.382,y:0.9234,z:-0.0378},u1:{x:0.8315,y:-0.3613,z:-0.4219},u2:{x:0.4033,y:-0.1298,z:0.9058}},{c:{x:0.984,y:-0.125,z:-1.078},h:{x:0.304,y:0.238,z:0.109},u0:{x:0.0685,y:0.0813,z:0.9943},u1:{x:0.9441,y:-0.3274,z:-0.0383},u2:{x:0.3224,y:0.9414,z:-0.0991}},{c:{x:-0.356,y:-0.203,z:-0.89},h:{x:0.341,y:0.271,z:0.151},u0:{x:0.4506,y:0.8628,z:0.2292},u1:{x:0.8917,y:-0.447,z:-0.0708},u2:{x:-0.0414,y:-0.2363,z:0.9708}},{c:{x:0.188,y:-0.194,z:0.493},h:{x:0.308,y:0.288,z:0.182},u0:{x:-0.0979,y:0.6788,z:0.7277},u1:{x:-0.0351,y:0.7285,z:-0.6842},u2:{x:0.9946,y:0.0925,z:0.0475}},{c:{x:0.44,y:-0.14,z:-0.904},h:{x:0.292,y:0.203,z:0.127},u0:{x:0.9913,y:0.0239,z:-0.1296},u1:{x:-0.0002,y:0.9837,z:0.1799},u2:{x:0.1318,y:-0.1783,z:0.9751}},{c:{x:-0.187,y:-0.202,z:0.152},h:{x:0.394,y:0.264,z:0.1},u0:{x:-0.1277,y:0.1679,z:0.9775},u1:{x:-0.5044,y:0.8376,z:-0.2098},u2:{x:0.8539,y:0.5199,z:0.0223}},{c:{x:-0.126,y:0.16,z:-1.093},h:{x:0.373,y:0.225,z:0.123},u0:{x:-0.1549,y:-0.3538,z:0.9224},u1:{x:0.4277,y:0.8176,z:0.3854},u2:{x:0.8905,y:-0.4542,z:-0.0247}},{c:{x:-0.183,y:-0.229,z:0.863},h:{x:0.449,y:0.179,z:0.152},u0:{x:0.0527,y:-0.0301,z:0.9982},u1:{x:0.9981,y:0.0344,z:-0.0516},u2:{x:-0.0328,y:0.999,z:0.0319}},{c:{x:-0.368,y:-0.356,z:-0.765},h:{x:0.367,y:0.165,z:0.136},u0:{x:0.9913,y:0.0519,z:0.121},u1:{x:-0.1312,y:0.4664,z:0.8748},u2:{x:0.011,y:0.883,z:-0.4692}},{c:{x:0.032,y:-0.48,z:0.367},h:{x:0.405,y:0.16,z:0.1},u0:{x:0.0368,y:0.0719,z:0.9967},u1:{x:0.9426,y:0.3287,z:-0.0585},u2:{x:-0.3319,y:0.9417,z:-0.0557}},{c:{x:0.197,y:-0.182,z:-0.416},h:{x:0.483,y:0.188,z:0.1},u0:{x:-0.0515,y:0.0086,z:0.9986},u1:{x:0.003,y:1,z:-0.0085},u2:{x:0.9987,y:-0.0026,z:0.0515}},{c:{x:0.185,y:-0.352,z:-1.364},h:{x:0.267,y:0.225,z:0.124},u0:{x:0.8979,y:-0.3637,z:0.2478},u1:{x:0.4369,y:0.6688,z:-0.6015},u2:{x:0.053,y:0.6484,z:0.7595}},{c:{x:0.148,y:-0.353,z:0.343},h:{x:0.547,y:0.167,z:0.1},u0:{x:0.0175,y:-0.0597,z:0.9981},u1:{x:0.3939,y:0.9179,z:0.048},u2:{x:0.919,y:-0.3923,z:-0.0396}},{c:{x:0.892,y:-0.306,z:-1.067},h:{x:0.297,y:0.234,z:0.1},u0:{x:0.1295,y:-0.0139,z:0.9915},u1:{x:0.9589,y:0.2565,z:-0.1217},u2:{x:-0.2526,y:0.9664,z:0.0466}},{c:{x:0.16,y:-0.22,z:0.835},h:{x:0.252,y:0.183,z:0.132},u0:{x:0.1338,y:-0.0911,z:0.9868},u1:{x:0.8896,y:-0.4278,z:-0.1601},u2:{x:0.4367,y:0.8993,z:0.0238}},{c:{x:-0.371,y:0.103,z:-1.045},h:{x:0.268,y:0.204,z:0.1},u0:{x:-0.01,y:-0.0494,z:0.9987},u1:{x:0.9972,y:0.0729,z:0.0136},u2:{x:-0.0735,y:0.9961,z:0.0485}},{c:{x:-0.359,y:-0.349,z:-1.326},h:{x:0.356,y:0.174,z:0.116},u0:{x:0.9929,y:-0.0919,z:-0.076},u1:{x:0.0319,y:-0.4099,z:0.9116},u2:{x:0.1149,y:0.9075,z:0.4041}},{c:{x:0.061,y:-0.391,z:0.938},h:{x:0.295,y:0.213,z:0.132},u0:{x:-0.1451,y:0.1724,z:0.9743},u1:{x:0.9054,y:0.4201,z:0.0605},u2:{x:-0.3989,y:0.891,z:-0.217}},{c:{x:-0.571,y:0.013,z:-1.152},h:{x:0.255,y:0.145,z:0.1},u0:{x:-0.0117,y:0.0092,z:0.9999},u1:{x:0.69,y:0.7238,z:0.0014},u2:{x:0.7237,y:-0.6899,z:0.0148}},{c:{x:0.006,y:-0.425,z:-0.047},h:{x:0.198,y:0.193,z:0.102},u0:{x:-0.3334,y:0.7006,z:-0.6308},u1:{x:0.9422,y:0.2247,z:-0.2484},u2:{x:0.0323,y:0.6772,z:0.7351}},{c:{x:-0.804,y:-0.042,z:-0.94},h:{x:0.373,y:0.209,z:0.1},u0:{x:-0.0315,y:-0.0025,z:0.9995},u1:{x:0.9896,y:0.1404,z:0.0315},u2:{x:-0.1404,y:0.9901,z:-0.002}},{c:{x:0.112,y:0.018,z:-1.378},h:{x:0.278,y:0.185,z:0.141},u0:{x:-0.1775,y:0.9239,z:0.3389},u1:{x:0.8812,y:-0.0041,z:0.4728},u2:{x:-0.4382,y:-0.3825,z:0.8134}}], broadR: 2.097 /* hitboxes:auto:end */, lift: 0.21, yaw: Math.PI, scale: 1 } /* enemy_1: lift raises the hull onto the bullet plane (assets:hitboxes coverage) */, // orange enemy_1 (faces -Z, yaw PI to face +Z)
      groups: { gun: GUN_LONG },
      mounts: [{ weapon: 9, group: 'gun', offset: 0, delay: 0 }]
    }
  },
  {
    name: 'pirate mini boss', type: 'enemy', modelUrl: 'assets/ships/enemy_3_combat.431cdbbf.glb',
    components: { hull: 3, engine: 6, thruster: 10 }, stats: { // medium hull + scout engine + weak (Medium) thrusters
      role: 'medium', class: 'capital', color: MARKER.medium, reward: 125,
      // enemy_3 export faces -Z (same pack as enemy_1); yaw Math.PI rotates 180° to face +Z
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.028,y:-0.255,z:0.903},h:{x:0.443,y:0.281,z:0.162},u0:{x:-0.19,y:0.0211,z:0.9816},u1:{x:0.9806,y:0.0525,z:0.1887},u2:{x:-0.0476,y:0.9984,z:-0.0307}},{c:{x:0.026,y:-0.039,z:-1.199},h:{x:0.394,y:0.321,z:0.184},u0:{x:0.3372,y:-0.2189,z:0.9156},u1:{x:0.9391,y:0.1468,z:-0.3107},u2:{x:-0.0664,y:0.9646,z:0.2551}},{c:{x:0.002,y:-0.263,z:1.438},h:{x:0.333,y:0.286,z:0.139},u0:{x:0.7527,y:-0.1933,z:0.6293},u1:{x:-0.6507,y:-0.0736,z:0.7557},u2:{x:0.0997,y:0.9784,z:0.1812}},{c:{x:-0.106,y:-0.217,z:-1.415},h:{x:0.397,y:0.247,z:0.242},u0:{x:0.9917,y:0.1113,z:-0.0643},u1:{x:-0.0283,y:0.677,z:0.7354},u2:{x:-0.1254,y:0.7275,z:-0.6746}},{c:{x:-0.12,y:0.137,z:-0.565},h:{x:0.421,y:0.228,z:0.126},u0:{x:-0.1354,y:-0.4159,z:0.8993},u1:{x:0.5532,y:0.7213,z:0.4168},u2:{x:0.822,y:-0.5539,z:-0.1324}},{c:{x:-0.303,y:-0.265,z:1.3},h:{x:0.441,y:0.215,z:0.104},u0:{x:0.3473,y:0.0029,z:0.9377},u1:{x:0.9337,y:-0.0938,z:-0.3455},u2:{x:0.087,y:0.9956,z:-0.0352}},{c:{x:0.374,y:-0.048,z:-0.82},h:{x:0.278,y:0.224,z:0.199},u0:{x:0.1617,y:0.0363,z:0.9862},u1:{x:0.9373,y:0.307,z:-0.165},u2:{x:-0.3088,y:0.951,z:0.0156}},{c:{x:0.181,y:-0.004,z:-0.266},h:{x:0.283,y:0.234,z:0.171},u0:{x:-0.6681,y:0.2785,z:0.69},u1:{x:0.5259,y:-0.4793,z:0.7027},u2:{x:0.5264,y:0.8323,z:0.1738}},{c:{x:-0.29,y:-0.231,z:-0.706},h:{x:0.38,y:0.198,z:0.176},u0:{x:-0.0057,y:0.0013,z:1},u1:{x:0.1121,y:0.9937,z:-0.0007},u2:{x:0.9937,y:-0.1121,z:0.0058}},{c:{x:0.296,y:-0.268,z:-1.327},h:{x:0.277,y:0.218,z:0.193},u0:{x:0.302,y:0.1299,z:0.9444},u1:{x:0.4981,y:0.8232,z:-0.2725},u2:{x:0.8128,y:-0.5527,z:-0.1839}},{c:{x:0.325,y:-0.284,z:-0.853},h:{x:0.335,y:0.229,z:0.17},u0:{x:0.026,y:-0.0571,z:0.998},u1:{x:0.9195,y:0.3932,z:-0.0015},u2:{x:-0.3923,y:0.9177,z:0.0627}},{c:{x:0.26,y:0.162,z:-0.947},h:{x:0.308,y:0.213,z:0.17},u0:{x:0.9383,y:0.0118,z:-0.3456},u1:{x:0.3457,y:-0.0076,z:0.9383},u2:{x:-0.0084,y:0.9999,z:0.0112}},{c:{x:0.28,y:-0.258,z:0.271},h:{x:0.411,y:0.217,z:0.18},u0:{x:-0.277,y:0.0346,z:0.9602},u1:{x:0.7531,y:-0.6129,z:0.2393},u2:{x:0.5968,y:0.7894,z:0.1437}},{c:{x:-0.239,y:-0.065,z:-0.388},h:{x:0.298,y:0.201,z:0.166},u0:{x:-0.0741,y:-0.0313,z:0.9968},u1:{x:0.9923,y:-0.1023,z:0.0706},u2:{x:0.0997,y:0.9943,z:0.0386}},{c:{x:-0.027,y:-0.082,z:0.492},h:{x:0.281,y:0.192,z:0.129},u0:{x:-0.0254,y:-0.2204,z:0.9751},u1:{x:0.9976,y:0.0572,z:0.0389},u2:{x:-0.0644,y:0.9737,z:0.2184}},{c:{x:0.041,y:-0.02,z:0.049},h:{x:0.359,y:0.318,z:0.163},u0:{x:0.9807,y:0.0961,z:-0.1701},u1:{x:0.189,y:-0.2459,z:0.9507},u2:{x:-0.0496,y:0.9645,z:0.2593}},{c:{x:0.143,y:0.129,z:-0.638},h:{x:0.28,y:0.217,z:0.134},u0:{x:-0.5385,y:0.841,z:0.0516},u1:{x:-0.2653,y:-0.2274,z:0.937},u2:{x:0.7998,y:0.4909,z:0.3456}},{c:{x:-0.418,y:-0.249,z:-1.287},h:{x:0.345,y:0.185,z:0.172},u0:{x:0.4262,y:-0.1046,z:0.8985},u1:{x:0.8935,y:-0.1068,z:-0.4363},u2:{x:0.1416,y:0.9888,z:0.048}},{c:{x:0.224,y:-0.102,z:-0.964},h:{x:0.46,y:0.163,z:0.132},u0:{x:0.0343,y:0.0097,z:0.9994},u1:{x:-0.3998,y:0.9166,z:0.0048},u2:{x:0.9159,y:0.3998,z:-0.0353}},{c:{x:-0.613,y:-0.243,z:-0.567},h:{x:0.488,y:0.32,z:0.107},u0:{x:0.1869,y:0.0058,z:0.9824},u1:{x:0.9763,y:0.1096,z:-0.1864},u2:{x:-0.1088,y:0.994,z:0.0149}},{c:{x:0.528,y:-0.252,z:-0.55},h:{x:0.454,y:0.204,z:0.116},u0:{x:-0.1262,y:-0.0089,z:0.992},u1:{x:0.9805,y:-0.1528,z:0.1234},u2:{x:0.1505,y:0.9882,z:0.028}},{c:{x:0.024,y:-0.39,z:-0.508},h:{x:0.577,y:0.234,z:0.1},u0:{x:-0.0054,y:-0.0012,z:1},u1:{x:0.9999,y:-0.0099,z:0.0054},u2:{x:0.0099,y:0.9999,z:0.0013}},{c:{x:0.126,y:-0.393,z:-1.303},h:{x:0.355,y:0.243,z:0.1},u0:{x:0.9708,y:-0.0078,z:-0.2396},u1:{x:0.2397,y:0.0435,z:0.9699},u2:{x:-0.0029,y:0.999,z:-0.0441}},{c:{x:0.073,y:-0.299,z:0.487},h:{x:0.328,y:0.24,z:0.101},u0:{x:0.9547,y:-0.0321,z:-0.2959},u1:{x:0.2968,y:0.1744,z:0.9389},u2:{x:-0.0215,y:0.9842,z:-0.176}},{c:{x:-0.287,y:-0.204,z:0.47},h:{x:0.301,y:0.233,z:0.211},u0:{x:0.702,y:0.1895,z:0.6865},u1:{x:-0.4612,y:-0.6135,z:0.641},u2:{x:-0.5426,y:0.7666,z:0.3433}},{c:{x:0.056,y:0.112,z:-0.495},h:{x:0.264,y:0.167,z:0.162},u0:{x:-0.4521,y:0.8901,z:-0.0575},u1:{x:-0.2833,y:-0.0822,z:0.9555},u2:{x:0.8458,y:0.4482,z:0.2893}},{c:{x:0.014,y:0.086,z:-1.571},h:{x:0.346,y:0.192,z:0.146},u0:{x:0.9997,y:0.014,z:-0.0203},u1:{x:0.0244,y:-0.4345,z:0.9004},u2:{x:-0.0038,y:0.9006,z:0.4347}},{c:{x:-0.319,y:0.12,z:-0.851},h:{x:0.39,y:0.235,z:0.163},u0:{x:0.444,y:-0.0974,z:0.8907},u1:{x:0.8958,y:0.0694,z:-0.439},u2:{x:-0.0191,y:0.9928,z:0.1181}},{c:{x:-0.347,y:-0.211,z:-0.043},h:{x:0.392,y:0.146,z:0.104},u0:{x:-0.0665,y:0.0448,z:0.9968},u1:{x:0.9908,y:0.1213,z:0.0606},u2:{x:-0.1182,y:0.9916,z:-0.0524}},{c:{x:-0.272,y:-0.048,z:-0.803},h:{x:0.283,y:0.203,z:0.175},u0:{x:-0.0521,y:0.0691,z:0.9962},u1:{x:0.7766,y:-0.6244,z:0.0839},u2:{x:0.6279,y:0.778,z:-0.0211}},{c:{x:0.025,y:-0.328,z:1.246},h:{x:0.3,y:0.243,z:0.1},u0:{x:-0.2139,y:0.0342,z:0.9762},u1:{x:0.9765,y:0.0328,z:0.2129},u2:{x:-0.0248,y:0.9989,z:-0.0404}},{c:{x:-0.291,y:-0.319,z:-0.137},h:{x:0.493,y:0.187,z:0.116},u0:{x:-0.0915,y:-0.0027,z:0.9958},u1:{x:0.9067,y:-0.4137,z:0.0822},u2:{x:0.4118,y:0.9104,z:0.0402}},{c:{x:0.549,y:-0.253,z:-1.346},h:{x:0.312,y:0.254,z:0.123},u0:{x:-0.415,y:-0.0563,z:0.9081},u1:{x:0.9098,y:-0.0297,z:0.4139},u2:{x:0.0037,y:0.998,z:0.0635}},{c:{x:0.293,y:-0.241,z:-0.277},h:{x:0.351,y:0.197,z:0.181},u0:{x:-0.0548,y:-0.0053,z:0.9985},u1:{x:0.0247,y:0.9997,z:0.0067},u2:{x:0.9982,y:-0.025,z:0.0547}},{c:{x:0.13,y:-0.184,z:0.8},h:{x:0.576,y:0.108,z:0.1},u0:{x:0.0097,y:-0.0523,z:0.9986},u1:{x:-0.2015,y:0.978,z:0.0532},u2:{x:0.9794,y:0.2017,z:0.001}},{c:{x:-0.105,y:0.148,z:-0.913},h:{x:0.336,y:0.191,z:0.163},u0:{x:0.2264,y:0.9697,z:0.0918},u1:{x:-0.5777,y:0.0578,z:0.8142},u2:{x:0.7842,y:-0.2373,z:0.5733}},{c:{x:-0.002,y:0.204,z:-0.243},h:{x:0.22,y:0.176,z:0.129},u0:{x:0.0987,y:-0.0429,z:0.9942},u1:{x:0.995,y:0.0161,z:-0.0981},u2:{x:-0.0118,y:0.9989,z:0.0443}},{c:{x:-0.041,y:0.041,z:-0.158},h:{x:0.265,y:0.157,z:0.113},u0:{x:0.9705,y:0.0851,z:0.2256},u1:{x:-0.1538,y:-0.5022,z:0.8509},u2:{x:-0.1857,y:0.8605,z:0.4743}},{c:{x:-0.657,y:-0.222,z:-1.408},h:{x:0.208,y:0.148,z:0.1},u0:{x:-0.0402,y:-0.0177,z:0.999},u1:{x:0.9897,y:0.1367,z:0.0423},u2:{x:-0.1374,y:0.9904,z:0.012}},{c:{x:0.04,y:0.276,z:-0.846},h:{x:0.238,y:0.168,z:0.1},u0:{x:-0.0461,y:0.0616,z:0.997},u1:{x:-0.6159,y:0.784,z:-0.0769},u2:{x:0.7865,y:0.6176,z:-0.0018}},{c:{x:0.231,y:-0.29,z:1.104},h:{x:0.287,y:0.217,z:0.1},u0:{x:-0.4243,y:0.0015,z:0.9055},u1:{x:0.9053,y:0.0245,z:0.4242},u2:{x:-0.0215,y:0.9997,z:-0.0118}},{c:{x:-0.232,y:-0.126,z:-1.194},h:{x:0.228,y:0.157,z:0.1},u0:{x:0.0317,y:0.0164,z:0.9994},u1:{x:0.8799,y:0.4738,z:-0.0357},u2:{x:-0.4741,y:0.8805,z:0.0005}},{c:{x:0.756,y:-0.281,z:-0.654},h:{x:0.369,y:0.126,z:0.1},u0:{x:-0.0066,y:0,z:1},u1:{x:1,y:0.0024,z:0.0066},u2:{x:-0.0024,y:1,z:0}},{c:{x:0.065,y:0.183,z:-1.041},h:{x:0.281,y:0.125,z:0.1},u0:{x:0.999,y:-0.0352,z:-0.0257},u1:{x:0.0383,y:0.9906,z:0.1316},u2:{x:0.0209,y:-0.1325,z:0.991}},{c:{x:-0.438,y:-0.249,z:0.109},h:{x:0.217,y:0.108,z:0.1},u0:{x:0.0493,y:0,z:0.9988},u1:{x:-0.0003,y:1,z:0.0001},u2:{x:0.9988,y:0.0003,z:-0.0493}},{c:{x:-0.004,y:0.025,z:0.211},h:{x:0.247,y:0.138,z:0.1},u0:{x:0.0372,y:-0.0154,z:0.9992},u1:{x:0.9973,y:-0.0627,z:-0.0381},u2:{x:0.0632,y:0.9979,z:0.0131}},{c:{x:0.018,y:-0.374,z:0.122},h:{x:0.314,y:0.193,z:0.1},u0:{x:0.9989,y:0.0111,z:0.0458},u1:{x:-0.046,y:0.0143,z:0.9988},u2:{x:-0.0104,y:0.9998,z:-0.0148}},{c:{x:-0.473,y:0.015,z:-0.774},h:{x:0.2,y:0.121,z:0.1},u0:{x:0.0184,y:0.0024,z:0.9998},u1:{x:0.9932,y:0.1145,z:-0.0185},u2:{x:-0.1146,y:0.9934,z:-0.0003}}], broadR: 1.902 /* hitboxes:auto:end */, lift: 0.2, yaw: Math.PI, scale: 2 }, // lift: raise the model into the top-down bullet plane (nose sat below it)
      groups: { rocket: ROCKET },
      // two rocket launchers side by side, fired one after the other (0.3s stagger)
      mounts: [
        { weapon: 4, group: 'rocket', offset: -0.8, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0.8, delay: 0.3 },
      ]
    }
  },
  // The end-of-level boss: big orange ship (its own .glb), its own hull + engine, two guns side by
  // side + two staggered rocket launchers.
  {
    name: 'first pirate boss', type: 'enemy', modelUrl: 'assets/ships/enemy_4_combat.e6d652e9.glb',
    components: { hull: 4, engine: 7, thruster: 11 }, stats: {
      role: 'boss', class: 'capital', color: MARKER.boss, reward: 250,
      // enemy_4 export faces -Z (same pack as enemy_1); yaw Math.PI rotates 180° to face +Z
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:0.494,y:0.121,z:-0.357},h:{x:0.538,y:0.272,z:0.205},u0:{x:-0.0754,y:0.0478,z:0.996},u1:{x:0.8433,y:-0.5299,z:0.0893},u2:{x:0.5321,y:0.8467,z:-0.0004}},{c:{x:-0.134,y:-0.174,z:-0.228},h:{x:0.34,y:0.176,z:0.138},u0:{x:0.216,y:0.8014,z:-0.5578},u1:{x:0.0955,y:0.5512,z:0.8289},u2:{x:0.9717,y:-0.2323,z:0.0426}},{c:{x:-0.812,y:0.124,z:-0.425},h:{x:0.529,y:0.361,z:0.153},u0:{x:-0.4085,y:-0.0518,z:0.9113},u1:{x:0.9127,y:-0.0389,z:0.4069},u2:{x:0.0144,y:0.9979,z:0.0631}},{c:{x:0.376,y:0.022,z:-0.797},h:{x:0.526,y:0.191,z:0.18},u0:{x:-0.0806,y:-0.1685,z:0.9824},u1:{x:0.5116,y:0.8389,z:0.1858},u2:{x:0.8554,y:-0.5176,z:-0.0186}},{c:{x:-0.018,y:0.099,z:-0.228},h:{x:0.444,y:0.344,z:0.217},u0:{x:0.87,y:0.1471,z:-0.4705},u1:{x:0.4823,y:-0.0566,z:0.8742},u2:{x:-0.102,y:0.9875,z:0.1202}},{c:{x:-0.038,y:0.015,z:1.27},h:{x:0.609,y:0.52,z:0.259},u0:{x:0.1797,y:0.8152,z:-0.5506},u1:{x:-0.0908,y:0.571,z:0.8159},u2:{x:0.9795,y:-0.0966,z:0.1767}},{c:{x:0.035,y:0.073,z:0.551},h:{x:0.513,y:0.307,z:0.218},u0:{x:0.1468,y:0.9645,z:0.2194},u1:{x:0.0999,y:-0.2352,z:0.9668},u2:{x:0.9841,y:-0.12,z:-0.1309}},{c:{x:0.026,y:0.432,z:0.627},h:{x:0.393,y:0.256,z:0.197},u0:{x:0.1327,y:0.8008,z:0.5841},u1:{x:0.9872,y:-0.1591,z:-0.0063},u2:{x:-0.0879,y:-0.5775,z:0.8117}},{c:{x:1.035,y:0.118,z:-0.117},h:{x:0.672,y:0.175,z:0.136},u0:{x:0.0747,y:-0.0477,z:0.9961},u1:{x:0.9952,y:-0.0601,z:-0.0775},u2:{x:0.0636,y:0.997,z:0.043}},{c:{x:-0.094,y:0.27,z:-0.629},h:{x:0.396,y:0.346,z:0.225},u0:{x:0.231,y:-0.3912,z:0.8909},u1:{x:0.038,y:0.9185,z:0.3935},u2:{x:0.9722,y:0.057,z:-0.227}},{c:{x:-0.033,y:0.67,z:-1.26},h:{x:0.506,y:0.388,z:0.257},u0:{x:-0.1938,y:0.1293,z:0.9725},u1:{x:0.9682,y:0.185,z:0.1683},u2:{x:-0.1582,y:0.9742,z:-0.1611}},{c:{x:-0.002,y:0.395,z:-1.333},h:{x:0.405,y:0.308,z:0.165},u0:{x:0.2408,y:0.0117,z:0.9705},u1:{x:0.9699,y:0.0329,z:-0.2411},u2:{x:-0.0347,y:0.9994,z:-0.0035}},{c:{x:0.34,y:0.364,z:-1.272},h:{x:0.322,y:0.299,z:0.219},u0:{x:0.7763,y:0.4299,z:0.4611},u1:{x:-0.4337,y:-0.1666,z:0.8855},u2:{x:-0.4575,y:0.8874,z:-0.0572}},{c:{x:0.036,y:0.487,z:-0.448},h:{x:0.422,y:0.31,z:0.282},u0:{x:0.9712,y:-0.2381,z:0.0038},u1:{x:0.1918,y:0.7726,z:-0.6052},u2:{x:0.1411,y:0.5885,z:0.7961}},{c:{x:-0.406,y:0.188,z:-0.378},h:{x:0.352,y:0.323,z:0.26},u0:{x:0.7916,y:0.3381,z:-0.5089},u1:{x:0.4355,y:0.272,z:0.8581},u2:{x:-0.4286,y:0.9009,z:-0.0681}},{c:{x:0.155,y:0.392,z:-0.946},h:{x:0.416,y:0.232,z:0.189},u0:{x:0.0045,y:0.9995,z:0.0298},u1:{x:0.9755,y:-0.011,z:0.2198},u2:{x:-0.22,y:-0.0281,z:0.9751}},{c:{x:0,y:-0.476,z:-0.916},h:{x:0.303,y:0.195,z:0.138},u0:{x:0.001,y:-0.624,z:0.7814},u1:{x:1,y:0.0002,z:-0.0011},u2:{x:0.0005,y:0.7814,z:0.624}},{c:{x:0.038,y:0.256,z:-1.45},h:{x:0.457,y:0.329,z:0.109},u0:{x:0.7381,y:0.032,z:-0.6739},u1:{x:0.6747,y:-0.0362,z:0.7372},u2:{x:0.0008,y:0.9988,z:0.0483}},{c:{x:0.076,y:0.098,z:1.507},h:{x:0.395,y:0.235,z:0.1},u0:{x:-0.0432,y:0.9561,z:0.2898},u1:{x:-0.1722,y:-0.2929,z:0.9405},u2:{x:0.9841,y:-0.0092,z:0.1773}},{c:{x:0.354,y:0.145,z:-1.052},h:{x:0.412,y:0.285,z:0.187},u0:{x:0.9942,y:-0.0599,z:0.0892},u1:{x:-0.0864,y:0.0489,z:0.9951},u2:{x:0.0639,y:0.997,z:-0.0435}},{c:{x:-0.096,y:0.569,z:0.708},h:{x:0.542,y:0.397,z:0.114},u0:{x:0.0063,y:0.9729,z:-0.2312},u1:{x:0.0543,y:0.2306,z:0.9715},u2:{x:0.9985,y:-0.0186,z:-0.0514}},{c:{x:-0.123,y:0.237,z:-1.051},h:{x:0.361,y:0.305,z:0.294},u0:{x:0.501,y:0.8633,z:-0.0617},u1:{x:0.8638,y:-0.4943,z:0.0975},u2:{x:-0.0537,y:0.1022,z:0.9933}},{c:{x:0.818,y:0.13,z:-0.524},h:{x:0.556,y:0.207,z:0.133},u0:{x:0.0171,y:-0.0564,z:0.9983},u1:{x:0.9994,y:-0.0303,z:-0.0188},u2:{x:0.0313,y:0.9979,z:0.0559}},{c:{x:-0.001,y:0.469,z:0.032},h:{x:0.336,y:0.28,z:0.23},u0:{x:0.0012,y:-0.5354,z:0.8446},u1:{x:1,y:0.0034,z:0.0007},u2:{x:-0.0033,y:0.8446,z:0.5354}},{c:{x:-0.381,y:0.416,z:-1.241},h:{x:0.278,y:0.259,z:0.18},u0:{x:0.3306,y:0.0077,z:0.9437},u1:{x:0.9437,y:-0.0088,z:-0.3306},u2:{x:0.0057,y:0.9999,z:-0.0102}},{c:{x:-0.009,y:0.21,z:0.346},h:{x:0.305,y:0.29,z:0.214},u0:{x:0.9987,y:-0.0268,z:-0.0423},u1:{x:0.0466,y:0.1878,z:0.9811},u2:{x:0.0183,y:0.9818,z:-0.1889}},{c:{x:0.074,y:0.183,z:-1.279},h:{x:0.538,y:0.186,z:0.1},u0:{x:0.9993,y:0.0377,z:0.0072},u1:{x:-0.0376,y:0.9992,z:-0.0168},u2:{x:-0.0078,y:0.0166,z:0.9998}},{c:{x:-0.408,y:-0.028,z:-0.669},h:{x:0.389,y:0.177,z:0.145},u0:{x:0.0643,y:-0.149,z:0.9868},u1:{x:-0.0219,y:0.9883,z:0.1506},u2:{x:0.9977,y:0.0313,z:-0.0602}},{c:{x:-0.287,y:0.356,z:-0.791},h:{x:0.282,y:0.187,z:0.133},u0:{x:0.0005,y:-0.1545,z:0.988},u1:{x:0.3014,y:0.9421,z:0.1471},u2:{x:0.9535,y:-0.2977,z:-0.047}},{c:{x:-0.001,y:-0.007,z:0.164},h:{x:0.232,y:0.223,z:0.152},u0:{x:-0.0006,y:0.8264,z:-0.563},u1:{x:1,y:0.0007,z:-0.0001},u2:{x:-0.0003,y:0.563,z:0.8264}},{c:{x:-1.066,y:0.102,z:0.226},h:{x:0.327,y:0.126,z:0.115},u0:{x:0.0576,y:0.001,z:0.9983},u1:{x:-0.0601,y:0.9982,z:0.0025},u2:{x:0.9965,y:0.0602,z:-0.0576}},{c:{x:0.144,y:-0.095,z:-0.268},h:{x:0.247,y:0.14,z:0.1},u0:{x:-0.1692,y:0.9806,z:-0.0992},u1:{x:-0.0112,y:0.0988,z:0.995},u2:{x:0.9855,y:0.1694,z:-0.0057}},{c:{x:-0.533,y:0.182,z:-0.994},h:{x:0.371,y:0.259,z:0.16},u0:{x:-0.5559,y:-0.0651,z:0.8287},u1:{x:0.8265,y:0.0624,z:0.5594},u2:{x:-0.0881,y:0.9959,z:0.0191}},{c:{x:-0.245,y:0.849,z:-1.49},h:{x:0.198,y:0.144,z:0.1},u0:{x:-0.3519,y:0.9246,z:-0.1459},u1:{x:-0.0353,y:0.1426,z:0.9891},u2:{x:0.9354,y:0.3532,z:-0.0176}},{c:{x:0.122,y:-0.796,z:-0.873},h:{x:0.252,y:0.12,z:0.1},u0:{x:-0.0748,y:0.6352,z:0.7687},u1:{x:-0.1147,y:0.7603,z:-0.6394},u2:{x:0.9906,y:0.136,z:-0.016}},{c:{x:-0.003,y:0.322,z:-0.272},h:{x:0.37,y:0.186,z:0.163},u0:{x:0.9961,y:0.011,z:-0.0872},u1:{x:0.0864,y:-0.308,z:0.9475},u2:{x:0.0165,y:0.9513,z:0.3078}},{c:{x:-0.228,y:0.087,z:1.479},h:{x:0.271,y:0.1,z:0.1},u0:{x:-0.0112,y:0.023,z:0.9997},u1:{x:0.9842,y:-0.1762,z:0.015},u2:{x:0.1765,y:0.9841,z:-0.0207}},{c:{x:0.259,y:0.535,z:-0.585},h:{x:0.302,y:0.157,z:0.135},u0:{x:0.0703,y:0.0095,z:0.9975},u1:{x:-0.3227,y:0.9464,z:0.0137},u2:{x:0.9439,y:0.3229,z:-0.0696}},{c:{x:-0.122,y:-0.796,z:-0.873},h:{x:0.252,y:0.12,z:0.1},u0:{x:0.0749,y:0.6352,z:0.7687},u1:{x:0.1149,y:0.7603,z:-0.6394},u2:{x:0.9906,y:-0.1362,z:0.0161}},{c:{x:0.247,y:0.859,z:-1.494},h:{x:0.19,y:0.144,z:0.1},u0:{x:0.3153,y:0.9466,z:-0.0679},u1:{x:-0.0096,y:0.0747,z:0.9972},u2:{x:0.949,y:-0.3137,z:0.0327}},{c:{x:-0.359,y:0.036,z:-1.101},h:{x:0.237,y:0.225,z:0.1},u0:{x:0.4111,y:-0.0188,z:0.9114},u1:{x:0.9116,y:0.016,z:-0.4108},u2:{x:-0.0069,y:0.9997,z:0.0237}},{c:{x:-0.522,y:0.152,z:-0.009},h:{x:0.189,y:0.1,z:0.1},u0:{x:0.029,y:-0.0105,z:0.9995},u1:{x:0.5803,y:0.8144,z:-0.0083},u2:{x:0.8139,y:-0.5803,z:-0.0297}},{c:{x:0.235,y:-0.38,z:-0.1},h:{x:0.231,y:0.138,z:0.1},u0:{x:0.0156,y:-0.1273,z:0.9917},u1:{x:0.994,y:-0.1059,z:-0.0292},u2:{x:0.1087,y:0.9862,z:0.1248}},{c:{x:0.176,y:0.086,z:1.479},h:{x:0.273,y:0.1,z:0.1},u0:{x:0.0375,y:-0.0299,z:0.9988},u1:{x:0.9799,y:0.1973,z:-0.0308},u2:{x:-0.1961,y:0.9799,z:0.0367}},{c:{x:-0.003,y:0.034,z:-0.768},h:{x:0.46,y:0.1,z:0.1},u0:{x:0.0031,y:0.0095,z:0.9999},u1:{x:0.7868,y:-0.6172,z:0.0035},u2:{x:0.6172,y:0.7867,z:-0.0094}},{c:{x:0.145,y:0.306,z:-0.731},h:{x:0.319,y:0.293,z:0.273},u0:{x:-0.119,y:0.9926,z:-0.024},u1:{x:0.5464,y:0.0857,z:0.8332},u2:{x:0.8291,y:0.086,z:-0.5525}},{c:{x:-0.406,y:0.129,z:-0.703},h:{x:0.238,y:0.182,z:0.17},u0:{x:0.9932,y:0.1164,z:0.0053},u1:{x:-0.0051,y:-0.0013,z:1},u2:{x:-0.1164,y:0.9932,z:0.0007}},{c:{x:-0.066,y:0.638,z:-0.695},h:{x:0.337,y:0.256,z:0.237},u0:{x:0.9655,y:0.2318,z:0.1188},u1:{x:-0.2008,y:0.9529,z:-0.2272},u2:{x:-0.1659,y:0.1955,z:0.9666}}], broadR: 2.087 /* hitboxes:auto:end */, lift: -0.132, yaw: Math.PI, scale: 3 } /* enemy_4: lift LOWERS the boss hull onto the bullet plane (bbox centre sat below the deck; assets:hitboxes coverage) */,
      // Boss buff (docs/plans/mission-enemies-difficulty.md): two Pirate machine guns (id 9) replace the
      // old basic-kinetic guns; rockets unchanged. Also buffs the level-3 boss (same ship) — intended.
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 9, group: 'gun', offset: -0.6, delay: 0 },
        { weapon: 9, group: 'gun', offset: 0.6, delay: 0 },
        { weapon: 4, group: 'rocket', offset: -0.9, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0.9, delay: 0.3 },
      ]
    }
  },
  // --- Level-4 enemies (docs/plans/level-4-difficulty.md) ---
  {
    // Advanced medium pirate: the L4 heavy — orange enemy_3 (mini-boss) model, 300 HP, turns ~+30% faster,
    // one long-range Pirate MG + two rocket launchers.
    name: 'advanced medium pirate', type: 'enemy', modelUrl: 'assets/ships/enemy_3_orange_combat.f848a735.glb', modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/enemy_3_orange_hangar.f14238c7.glb',
    components: { hull: 24, engine: 6, thruster: 25 }, stats: {
      role: 'advanced_medium_pirate', class: 'capital', color: MARKER.medium, reward: 200,
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.028,y:-0.255,z:0.903},h:{x:0.443,y:0.281,z:0.162},u0:{x:-0.19,y:0.0211,z:0.9816},u1:{x:0.9806,y:0.0525,z:0.1887},u2:{x:-0.0476,y:0.9984,z:-0.0307}},{c:{x:0.026,y:-0.039,z:-1.199},h:{x:0.394,y:0.321,z:0.184},u0:{x:0.3372,y:-0.2189,z:0.9156},u1:{x:0.9391,y:0.1468,z:-0.3107},u2:{x:-0.0664,y:0.9646,z:0.2551}},{c:{x:0.002,y:-0.263,z:1.438},h:{x:0.333,y:0.286,z:0.139},u0:{x:0.7527,y:-0.1933,z:0.6293},u1:{x:-0.6507,y:-0.0736,z:0.7557},u2:{x:0.0997,y:0.9784,z:0.1812}},{c:{x:-0.106,y:-0.217,z:-1.415},h:{x:0.397,y:0.247,z:0.242},u0:{x:0.9917,y:0.1113,z:-0.0643},u1:{x:-0.0283,y:0.677,z:0.7354},u2:{x:-0.1254,y:0.7275,z:-0.6746}},{c:{x:-0.12,y:0.137,z:-0.565},h:{x:0.421,y:0.228,z:0.126},u0:{x:-0.1354,y:-0.4159,z:0.8993},u1:{x:0.5532,y:0.7213,z:0.4168},u2:{x:0.822,y:-0.5539,z:-0.1324}},{c:{x:-0.303,y:-0.265,z:1.3},h:{x:0.441,y:0.215,z:0.104},u0:{x:0.3473,y:0.0029,z:0.9377},u1:{x:0.9337,y:-0.0938,z:-0.3455},u2:{x:0.087,y:0.9956,z:-0.0352}},{c:{x:0.374,y:-0.048,z:-0.82},h:{x:0.278,y:0.224,z:0.199},u0:{x:0.1617,y:0.0363,z:0.9862},u1:{x:0.9373,y:0.307,z:-0.165},u2:{x:-0.3088,y:0.951,z:0.0156}},{c:{x:0.181,y:-0.004,z:-0.266},h:{x:0.283,y:0.234,z:0.171},u0:{x:-0.6681,y:0.2785,z:0.69},u1:{x:0.5259,y:-0.4793,z:0.7027},u2:{x:0.5264,y:0.8323,z:0.1738}},{c:{x:-0.29,y:-0.231,z:-0.706},h:{x:0.38,y:0.198,z:0.176},u0:{x:-0.0057,y:0.0013,z:1},u1:{x:0.1121,y:0.9937,z:-0.0007},u2:{x:0.9937,y:-0.1121,z:0.0058}},{c:{x:0.296,y:-0.268,z:-1.327},h:{x:0.277,y:0.218,z:0.193},u0:{x:0.302,y:0.1299,z:0.9444},u1:{x:0.4981,y:0.8232,z:-0.2725},u2:{x:0.8128,y:-0.5527,z:-0.1839}},{c:{x:0.325,y:-0.284,z:-0.853},h:{x:0.335,y:0.229,z:0.17},u0:{x:0.026,y:-0.0571,z:0.998},u1:{x:0.9195,y:0.3932,z:-0.0015},u2:{x:-0.3923,y:0.9177,z:0.0627}},{c:{x:0.26,y:0.162,z:-0.947},h:{x:0.308,y:0.213,z:0.17},u0:{x:0.9383,y:0.0118,z:-0.3456},u1:{x:0.3457,y:-0.0076,z:0.9383},u2:{x:-0.0084,y:0.9999,z:0.0112}},{c:{x:0.28,y:-0.258,z:0.271},h:{x:0.411,y:0.217,z:0.18},u0:{x:-0.277,y:0.0346,z:0.9602},u1:{x:0.7531,y:-0.6129,z:0.2393},u2:{x:0.5968,y:0.7894,z:0.1437}},{c:{x:-0.239,y:-0.065,z:-0.388},h:{x:0.298,y:0.201,z:0.166},u0:{x:-0.0741,y:-0.0313,z:0.9968},u1:{x:0.9923,y:-0.1023,z:0.0706},u2:{x:0.0997,y:0.9943,z:0.0386}},{c:{x:-0.027,y:-0.082,z:0.492},h:{x:0.281,y:0.192,z:0.129},u0:{x:-0.0254,y:-0.2204,z:0.9751},u1:{x:0.9976,y:0.0572,z:0.0389},u2:{x:-0.0644,y:0.9737,z:0.2184}},{c:{x:0.041,y:-0.02,z:0.049},h:{x:0.359,y:0.318,z:0.163},u0:{x:0.9807,y:0.0961,z:-0.1701},u1:{x:0.189,y:-0.2459,z:0.9507},u2:{x:-0.0496,y:0.9645,z:0.2593}},{c:{x:0.143,y:0.129,z:-0.638},h:{x:0.28,y:0.217,z:0.134},u0:{x:-0.5385,y:0.841,z:0.0516},u1:{x:-0.2653,y:-0.2274,z:0.937},u2:{x:0.7998,y:0.4909,z:0.3456}},{c:{x:-0.418,y:-0.249,z:-1.287},h:{x:0.345,y:0.185,z:0.172},u0:{x:0.4262,y:-0.1046,z:0.8985},u1:{x:0.8935,y:-0.1068,z:-0.4363},u2:{x:0.1416,y:0.9888,z:0.048}},{c:{x:0.224,y:-0.102,z:-0.964},h:{x:0.46,y:0.163,z:0.132},u0:{x:0.0343,y:0.0097,z:0.9994},u1:{x:-0.3998,y:0.9166,z:0.0048},u2:{x:0.9159,y:0.3998,z:-0.0353}},{c:{x:-0.613,y:-0.243,z:-0.567},h:{x:0.488,y:0.32,z:0.107},u0:{x:0.1869,y:0.0058,z:0.9824},u1:{x:0.9763,y:0.1096,z:-0.1864},u2:{x:-0.1088,y:0.994,z:0.0149}},{c:{x:0.528,y:-0.252,z:-0.55},h:{x:0.454,y:0.204,z:0.116},u0:{x:-0.1262,y:-0.0089,z:0.992},u1:{x:0.9805,y:-0.1528,z:0.1234},u2:{x:0.1505,y:0.9882,z:0.028}},{c:{x:0.024,y:-0.39,z:-0.508},h:{x:0.577,y:0.234,z:0.1},u0:{x:-0.0054,y:-0.0012,z:1},u1:{x:0.9999,y:-0.0099,z:0.0054},u2:{x:0.0099,y:0.9999,z:0.0013}},{c:{x:0.126,y:-0.393,z:-1.303},h:{x:0.355,y:0.243,z:0.1},u0:{x:0.9708,y:-0.0078,z:-0.2396},u1:{x:0.2397,y:0.0435,z:0.9699},u2:{x:-0.0029,y:0.999,z:-0.0441}},{c:{x:0.073,y:-0.299,z:0.487},h:{x:0.328,y:0.24,z:0.101},u0:{x:0.9547,y:-0.0321,z:-0.2959},u1:{x:0.2968,y:0.1744,z:0.9389},u2:{x:-0.0215,y:0.9842,z:-0.176}},{c:{x:-0.287,y:-0.204,z:0.47},h:{x:0.301,y:0.233,z:0.211},u0:{x:0.702,y:0.1895,z:0.6865},u1:{x:-0.4612,y:-0.6135,z:0.641},u2:{x:-0.5426,y:0.7666,z:0.3433}},{c:{x:0.056,y:0.112,z:-0.495},h:{x:0.264,y:0.167,z:0.162},u0:{x:-0.4521,y:0.8901,z:-0.0575},u1:{x:-0.2833,y:-0.0822,z:0.9555},u2:{x:0.8458,y:0.4482,z:0.2893}},{c:{x:0.014,y:0.086,z:-1.571},h:{x:0.346,y:0.192,z:0.146},u0:{x:0.9997,y:0.014,z:-0.0203},u1:{x:0.0244,y:-0.4345,z:0.9004},u2:{x:-0.0038,y:0.9006,z:0.4347}},{c:{x:-0.319,y:0.12,z:-0.851},h:{x:0.39,y:0.235,z:0.163},u0:{x:0.444,y:-0.0974,z:0.8907},u1:{x:0.8958,y:0.0694,z:-0.439},u2:{x:-0.0191,y:0.9928,z:0.1181}},{c:{x:-0.347,y:-0.211,z:-0.043},h:{x:0.392,y:0.146,z:0.104},u0:{x:-0.0665,y:0.0448,z:0.9968},u1:{x:0.9908,y:0.1213,z:0.0606},u2:{x:-0.1182,y:0.9916,z:-0.0524}},{c:{x:-0.272,y:-0.048,z:-0.803},h:{x:0.283,y:0.203,z:0.175},u0:{x:-0.0521,y:0.0691,z:0.9962},u1:{x:0.7766,y:-0.6244,z:0.0839},u2:{x:0.6279,y:0.778,z:-0.0211}},{c:{x:0.025,y:-0.328,z:1.246},h:{x:0.3,y:0.243,z:0.1},u0:{x:-0.2139,y:0.0342,z:0.9762},u1:{x:0.9765,y:0.0328,z:0.2129},u2:{x:-0.0248,y:0.9989,z:-0.0404}},{c:{x:-0.291,y:-0.319,z:-0.137},h:{x:0.493,y:0.187,z:0.116},u0:{x:-0.0915,y:-0.0027,z:0.9958},u1:{x:0.9067,y:-0.4137,z:0.0822},u2:{x:0.4118,y:0.9104,z:0.0402}},{c:{x:0.549,y:-0.253,z:-1.346},h:{x:0.312,y:0.254,z:0.123},u0:{x:-0.415,y:-0.0563,z:0.9081},u1:{x:0.9098,y:-0.0297,z:0.4139},u2:{x:0.0037,y:0.998,z:0.0635}},{c:{x:0.293,y:-0.241,z:-0.277},h:{x:0.351,y:0.197,z:0.181},u0:{x:-0.0548,y:-0.0053,z:0.9985},u1:{x:0.0247,y:0.9997,z:0.0067},u2:{x:0.9982,y:-0.025,z:0.0547}},{c:{x:0.13,y:-0.184,z:0.8},h:{x:0.576,y:0.108,z:0.1},u0:{x:0.0097,y:-0.0523,z:0.9986},u1:{x:-0.2015,y:0.978,z:0.0532},u2:{x:0.9794,y:0.2017,z:0.001}},{c:{x:-0.105,y:0.148,z:-0.913},h:{x:0.336,y:0.191,z:0.163},u0:{x:0.2264,y:0.9697,z:0.0918},u1:{x:-0.5777,y:0.0578,z:0.8142},u2:{x:0.7842,y:-0.2373,z:0.5733}},{c:{x:-0.002,y:0.204,z:-0.243},h:{x:0.22,y:0.176,z:0.129},u0:{x:0.0987,y:-0.0429,z:0.9942},u1:{x:0.995,y:0.0161,z:-0.0981},u2:{x:-0.0118,y:0.9989,z:0.0443}},{c:{x:-0.041,y:0.041,z:-0.158},h:{x:0.265,y:0.157,z:0.113},u0:{x:0.9705,y:0.0851,z:0.2256},u1:{x:-0.1538,y:-0.5022,z:0.8509},u2:{x:-0.1857,y:0.8605,z:0.4743}},{c:{x:-0.657,y:-0.222,z:-1.408},h:{x:0.208,y:0.148,z:0.1},u0:{x:-0.0402,y:-0.0177,z:0.999},u1:{x:0.9897,y:0.1367,z:0.0423},u2:{x:-0.1374,y:0.9904,z:0.012}},{c:{x:0.04,y:0.276,z:-0.846},h:{x:0.238,y:0.168,z:0.1},u0:{x:-0.0461,y:0.0616,z:0.997},u1:{x:-0.6159,y:0.784,z:-0.0769},u2:{x:0.7865,y:0.6176,z:-0.0018}},{c:{x:0.231,y:-0.29,z:1.104},h:{x:0.287,y:0.217,z:0.1},u0:{x:-0.4243,y:0.0015,z:0.9055},u1:{x:0.9053,y:0.0245,z:0.4242},u2:{x:-0.0215,y:0.9997,z:-0.0118}},{c:{x:-0.232,y:-0.126,z:-1.194},h:{x:0.228,y:0.157,z:0.1},u0:{x:0.0317,y:0.0164,z:0.9994},u1:{x:0.8799,y:0.4738,z:-0.0357},u2:{x:-0.4741,y:0.8805,z:0.0005}},{c:{x:0.756,y:-0.281,z:-0.654},h:{x:0.369,y:0.126,z:0.1},u0:{x:-0.0066,y:0,z:1},u1:{x:1,y:0.0024,z:0.0066},u2:{x:-0.0024,y:1,z:0}},{c:{x:0.065,y:0.183,z:-1.041},h:{x:0.281,y:0.125,z:0.1},u0:{x:0.999,y:-0.0352,z:-0.0257},u1:{x:0.0383,y:0.9906,z:0.1316},u2:{x:0.0209,y:-0.1325,z:0.991}},{c:{x:-0.438,y:-0.249,z:0.109},h:{x:0.217,y:0.108,z:0.1},u0:{x:0.0493,y:0,z:0.9988},u1:{x:-0.0003,y:1,z:0.0001},u2:{x:0.9988,y:0.0003,z:-0.0493}},{c:{x:-0.004,y:0.025,z:0.211},h:{x:0.247,y:0.138,z:0.1},u0:{x:0.0372,y:-0.0154,z:0.9992},u1:{x:0.9973,y:-0.0627,z:-0.0381},u2:{x:0.0632,y:0.9979,z:0.0131}},{c:{x:0.018,y:-0.374,z:0.122},h:{x:0.314,y:0.193,z:0.1},u0:{x:0.9989,y:0.0111,z:0.0458},u1:{x:-0.046,y:0.0143,z:0.9988},u2:{x:-0.0104,y:0.9998,z:-0.0148}},{c:{x:-0.473,y:0.015,z:-0.774},h:{x:0.2,y:0.121,z:0.1},u0:{x:0.0184,y:0.0024,z:0.9998},u1:{x:0.9932,y:0.1145,z:-0.0185},u2:{x:-0.1146,y:0.9934,z:-0.0003}}], broadR: 1.902 /* hitboxes:auto:end */, lift: 0.2, yaw: Math.PI, scale: 2 }, // orange enemy_3 (faces -Z, yaw PI to face +Z); lift: raise into the top-down bullet plane
      groups: { gun: GUN_LONG, rocket: ROCKET },
      mounts: [
        { weapon: 9, group: 'gun', offset: 0, delay: 0 },
        { weapon: 4, group: 'rocket', offset: -0.8, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0.8, delay: 0.3 },
      ]
    }
  },
  {
    // Second Boss (the L4 finale): orange enemy_4 (first-boss) model, 450 HP, ~+30% speed/accel/turn,
    // three rocket launchers + two Advanced pirate cannons. Distinct role 'boss2' (the test helper
    // spawnEnemy('boss') still resolves to the first boss).
    name: 'second pirate boss', type: 'enemy', modelUrl: 'assets/ships/enemy_4_orange_combat.39a83261.glb', modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/enemy_4_orange_hangar.b66f341f.glb',
    components: { hull: 28, engine: 26, thruster: 27 }, stats: {
      role: 'boss2', class: 'capital', color: MARKER.boss, reward: 500,
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:0.494,y:0.121,z:-0.357},h:{x:0.538,y:0.272,z:0.205},u0:{x:-0.0754,y:0.0478,z:0.996},u1:{x:0.8433,y:-0.5299,z:0.0893},u2:{x:0.5321,y:0.8467,z:-0.0004}},{c:{x:-0.134,y:-0.174,z:-0.228},h:{x:0.34,y:0.176,z:0.138},u0:{x:0.216,y:0.8014,z:-0.5578},u1:{x:0.0955,y:0.5512,z:0.8289},u2:{x:0.9717,y:-0.2323,z:0.0426}},{c:{x:-0.812,y:0.124,z:-0.425},h:{x:0.529,y:0.361,z:0.153},u0:{x:-0.4085,y:-0.0518,z:0.9113},u1:{x:0.9127,y:-0.0389,z:0.4069},u2:{x:0.0144,y:0.9979,z:0.0631}},{c:{x:0.376,y:0.022,z:-0.797},h:{x:0.526,y:0.191,z:0.18},u0:{x:-0.0806,y:-0.1685,z:0.9824},u1:{x:0.5116,y:0.8389,z:0.1858},u2:{x:0.8554,y:-0.5176,z:-0.0186}},{c:{x:-0.018,y:0.099,z:-0.228},h:{x:0.444,y:0.344,z:0.217},u0:{x:0.87,y:0.1471,z:-0.4705},u1:{x:0.4823,y:-0.0566,z:0.8742},u2:{x:-0.102,y:0.9875,z:0.1202}},{c:{x:-0.038,y:0.015,z:1.27},h:{x:0.609,y:0.52,z:0.259},u0:{x:0.1797,y:0.8152,z:-0.5506},u1:{x:-0.0908,y:0.571,z:0.8159},u2:{x:0.9795,y:-0.0966,z:0.1767}},{c:{x:0.035,y:0.073,z:0.551},h:{x:0.513,y:0.307,z:0.218},u0:{x:0.1468,y:0.9645,z:0.2194},u1:{x:0.0999,y:-0.2352,z:0.9668},u2:{x:0.9841,y:-0.12,z:-0.1309}},{c:{x:0.026,y:0.432,z:0.627},h:{x:0.393,y:0.256,z:0.197},u0:{x:0.1327,y:0.8008,z:0.5841},u1:{x:0.9872,y:-0.1591,z:-0.0063},u2:{x:-0.0879,y:-0.5775,z:0.8117}},{c:{x:1.035,y:0.118,z:-0.117},h:{x:0.672,y:0.175,z:0.136},u0:{x:0.0747,y:-0.0477,z:0.9961},u1:{x:0.9952,y:-0.0601,z:-0.0775},u2:{x:0.0636,y:0.997,z:0.043}},{c:{x:-0.094,y:0.27,z:-0.629},h:{x:0.396,y:0.346,z:0.225},u0:{x:0.231,y:-0.3912,z:0.8909},u1:{x:0.038,y:0.9185,z:0.3935},u2:{x:0.9722,y:0.057,z:-0.227}},{c:{x:-0.033,y:0.67,z:-1.26},h:{x:0.506,y:0.388,z:0.257},u0:{x:-0.1938,y:0.1293,z:0.9725},u1:{x:0.9682,y:0.185,z:0.1683},u2:{x:-0.1582,y:0.9742,z:-0.1611}},{c:{x:-0.002,y:0.395,z:-1.333},h:{x:0.405,y:0.308,z:0.165},u0:{x:0.2408,y:0.0117,z:0.9705},u1:{x:0.9699,y:0.0329,z:-0.2411},u2:{x:-0.0347,y:0.9994,z:-0.0035}},{c:{x:0.34,y:0.364,z:-1.272},h:{x:0.322,y:0.299,z:0.219},u0:{x:0.7763,y:0.4299,z:0.4611},u1:{x:-0.4337,y:-0.1666,z:0.8855},u2:{x:-0.4575,y:0.8874,z:-0.0572}},{c:{x:0.036,y:0.487,z:-0.448},h:{x:0.422,y:0.31,z:0.282},u0:{x:0.9712,y:-0.2381,z:0.0038},u1:{x:0.1918,y:0.7726,z:-0.6052},u2:{x:0.1411,y:0.5885,z:0.7961}},{c:{x:-0.406,y:0.188,z:-0.378},h:{x:0.352,y:0.323,z:0.26},u0:{x:0.7916,y:0.3381,z:-0.5089},u1:{x:0.4355,y:0.272,z:0.8581},u2:{x:-0.4286,y:0.9009,z:-0.0681}},{c:{x:0.155,y:0.392,z:-0.946},h:{x:0.416,y:0.232,z:0.189},u0:{x:0.0045,y:0.9995,z:0.0298},u1:{x:0.9755,y:-0.011,z:0.2198},u2:{x:-0.22,y:-0.0281,z:0.9751}},{c:{x:0,y:-0.476,z:-0.916},h:{x:0.303,y:0.195,z:0.138},u0:{x:0.001,y:-0.624,z:0.7814},u1:{x:1,y:0.0002,z:-0.0011},u2:{x:0.0005,y:0.7814,z:0.624}},{c:{x:0.038,y:0.256,z:-1.45},h:{x:0.457,y:0.329,z:0.109},u0:{x:0.7381,y:0.032,z:-0.6739},u1:{x:0.6747,y:-0.0362,z:0.7372},u2:{x:0.0008,y:0.9988,z:0.0483}},{c:{x:0.076,y:0.098,z:1.507},h:{x:0.395,y:0.235,z:0.1},u0:{x:-0.0432,y:0.9561,z:0.2898},u1:{x:-0.1722,y:-0.2929,z:0.9405},u2:{x:0.9841,y:-0.0092,z:0.1773}},{c:{x:0.354,y:0.145,z:-1.052},h:{x:0.412,y:0.285,z:0.187},u0:{x:0.9942,y:-0.0599,z:0.0892},u1:{x:-0.0864,y:0.0489,z:0.9951},u2:{x:0.0639,y:0.997,z:-0.0435}},{c:{x:-0.096,y:0.569,z:0.708},h:{x:0.542,y:0.397,z:0.114},u0:{x:0.0063,y:0.9729,z:-0.2312},u1:{x:0.0543,y:0.2306,z:0.9715},u2:{x:0.9985,y:-0.0186,z:-0.0514}},{c:{x:-0.123,y:0.237,z:-1.051},h:{x:0.361,y:0.305,z:0.294},u0:{x:0.501,y:0.8633,z:-0.0617},u1:{x:0.8638,y:-0.4943,z:0.0975},u2:{x:-0.0537,y:0.1022,z:0.9933}},{c:{x:0.818,y:0.13,z:-0.524},h:{x:0.556,y:0.207,z:0.133},u0:{x:0.0171,y:-0.0564,z:0.9983},u1:{x:0.9994,y:-0.0303,z:-0.0188},u2:{x:0.0313,y:0.9979,z:0.0559}},{c:{x:-0.001,y:0.469,z:0.032},h:{x:0.336,y:0.28,z:0.23},u0:{x:0.0012,y:-0.5354,z:0.8446},u1:{x:1,y:0.0034,z:0.0007},u2:{x:-0.0033,y:0.8446,z:0.5354}},{c:{x:-0.381,y:0.416,z:-1.241},h:{x:0.278,y:0.259,z:0.18},u0:{x:0.3306,y:0.0077,z:0.9437},u1:{x:0.9437,y:-0.0088,z:-0.3306},u2:{x:0.0057,y:0.9999,z:-0.0102}},{c:{x:-0.009,y:0.21,z:0.346},h:{x:0.305,y:0.29,z:0.214},u0:{x:0.9987,y:-0.0268,z:-0.0423},u1:{x:0.0466,y:0.1878,z:0.9811},u2:{x:0.0183,y:0.9818,z:-0.1889}},{c:{x:0.074,y:0.183,z:-1.279},h:{x:0.538,y:0.186,z:0.1},u0:{x:0.9993,y:0.0377,z:0.0072},u1:{x:-0.0376,y:0.9992,z:-0.0168},u2:{x:-0.0078,y:0.0166,z:0.9998}},{c:{x:-0.408,y:-0.028,z:-0.669},h:{x:0.389,y:0.177,z:0.145},u0:{x:0.0643,y:-0.149,z:0.9868},u1:{x:-0.0219,y:0.9883,z:0.1506},u2:{x:0.9977,y:0.0313,z:-0.0602}},{c:{x:-0.287,y:0.356,z:-0.791},h:{x:0.282,y:0.187,z:0.133},u0:{x:0.0005,y:-0.1545,z:0.988},u1:{x:0.3014,y:0.9421,z:0.1471},u2:{x:0.9535,y:-0.2977,z:-0.047}},{c:{x:-0.001,y:-0.007,z:0.164},h:{x:0.232,y:0.223,z:0.152},u0:{x:-0.0006,y:0.8264,z:-0.563},u1:{x:1,y:0.0007,z:-0.0001},u2:{x:-0.0003,y:0.563,z:0.8264}},{c:{x:-1.066,y:0.102,z:0.226},h:{x:0.327,y:0.126,z:0.115},u0:{x:0.0576,y:0.001,z:0.9983},u1:{x:-0.0601,y:0.9982,z:0.0025},u2:{x:0.9965,y:0.0602,z:-0.0576}},{c:{x:0.144,y:-0.095,z:-0.268},h:{x:0.247,y:0.14,z:0.1},u0:{x:-0.1692,y:0.9806,z:-0.0992},u1:{x:-0.0112,y:0.0988,z:0.995},u2:{x:0.9855,y:0.1694,z:-0.0057}},{c:{x:-0.533,y:0.182,z:-0.994},h:{x:0.371,y:0.259,z:0.16},u0:{x:-0.5559,y:-0.0651,z:0.8287},u1:{x:0.8265,y:0.0624,z:0.5594},u2:{x:-0.0881,y:0.9959,z:0.0191}},{c:{x:-0.245,y:0.849,z:-1.49},h:{x:0.198,y:0.144,z:0.1},u0:{x:-0.3519,y:0.9246,z:-0.1459},u1:{x:-0.0353,y:0.1426,z:0.9891},u2:{x:0.9354,y:0.3532,z:-0.0176}},{c:{x:0.122,y:-0.796,z:-0.873},h:{x:0.252,y:0.12,z:0.1},u0:{x:-0.0748,y:0.6352,z:0.7687},u1:{x:-0.1147,y:0.7603,z:-0.6394},u2:{x:0.9906,y:0.136,z:-0.016}},{c:{x:-0.003,y:0.322,z:-0.272},h:{x:0.37,y:0.186,z:0.163},u0:{x:0.9961,y:0.011,z:-0.0872},u1:{x:0.0864,y:-0.308,z:0.9475},u2:{x:0.0165,y:0.9513,z:0.3078}},{c:{x:-0.228,y:0.087,z:1.479},h:{x:0.271,y:0.1,z:0.1},u0:{x:-0.0112,y:0.023,z:0.9997},u1:{x:0.9842,y:-0.1762,z:0.015},u2:{x:0.1765,y:0.9841,z:-0.0207}},{c:{x:0.259,y:0.535,z:-0.585},h:{x:0.302,y:0.157,z:0.135},u0:{x:0.0703,y:0.0095,z:0.9975},u1:{x:-0.3227,y:0.9464,z:0.0137},u2:{x:0.9439,y:0.3229,z:-0.0696}},{c:{x:-0.122,y:-0.796,z:-0.873},h:{x:0.252,y:0.12,z:0.1},u0:{x:0.0749,y:0.6352,z:0.7687},u1:{x:0.1149,y:0.7603,z:-0.6394},u2:{x:0.9906,y:-0.1362,z:0.0161}},{c:{x:0.247,y:0.859,z:-1.494},h:{x:0.19,y:0.144,z:0.1},u0:{x:0.3153,y:0.9466,z:-0.0679},u1:{x:-0.0096,y:0.0747,z:0.9972},u2:{x:0.949,y:-0.3137,z:0.0327}},{c:{x:-0.359,y:0.036,z:-1.101},h:{x:0.237,y:0.225,z:0.1},u0:{x:0.4111,y:-0.0188,z:0.9114},u1:{x:0.9116,y:0.016,z:-0.4108},u2:{x:-0.0069,y:0.9997,z:0.0237}},{c:{x:-0.522,y:0.152,z:-0.009},h:{x:0.189,y:0.1,z:0.1},u0:{x:0.029,y:-0.0105,z:0.9995},u1:{x:0.5803,y:0.8144,z:-0.0083},u2:{x:0.8139,y:-0.5803,z:-0.0297}},{c:{x:0.235,y:-0.38,z:-0.1},h:{x:0.231,y:0.138,z:0.1},u0:{x:0.0156,y:-0.1273,z:0.9917},u1:{x:0.994,y:-0.1059,z:-0.0292},u2:{x:0.1087,y:0.9862,z:0.1248}},{c:{x:0.176,y:0.086,z:1.479},h:{x:0.273,y:0.1,z:0.1},u0:{x:0.0375,y:-0.0299,z:0.9988},u1:{x:0.9799,y:0.1973,z:-0.0308},u2:{x:-0.1961,y:0.9799,z:0.0367}},{c:{x:-0.003,y:0.034,z:-0.768},h:{x:0.46,y:0.1,z:0.1},u0:{x:0.0031,y:0.0095,z:0.9999},u1:{x:0.7868,y:-0.6172,z:0.0035},u2:{x:0.6172,y:0.7867,z:-0.0094}},{c:{x:0.145,y:0.306,z:-0.731},h:{x:0.319,y:0.293,z:0.273},u0:{x:-0.119,y:0.9926,z:-0.024},u1:{x:0.5464,y:0.0857,z:0.8332},u2:{x:0.8291,y:0.086,z:-0.5525}},{c:{x:-0.406,y:0.129,z:-0.703},h:{x:0.238,y:0.182,z:0.17},u0:{x:0.9932,y:0.1164,z:0.0053},u1:{x:-0.0051,y:-0.0013,z:1},u2:{x:-0.1164,y:0.9932,z:0.0007}},{c:{x:-0.066,y:0.638,z:-0.695},h:{x:0.337,y:0.256,z:0.237},u0:{x:0.9655,y:0.2318,z:0.1188},u1:{x:-0.2008,y:0.9529,z:-0.2272},u2:{x:-0.1659,y:0.1955,z:0.9666}}], broadR: 2.087 /* hitboxes:auto:end */, lift: -0.132, yaw: Math.PI, scale: 3 } /* enemy_4: lift LOWERS the boss hull onto the bullet plane (bbox centre sat below the deck; assets:hitboxes coverage) */, // orange enemy_4 (faces -Z, yaw PI to face +Z)
      groups: { gun: GUN_LONG, rocket: ROCKET },
      mounts: [
        { weapon: 10, group: 'gun', offset: -0.6, delay: 0 },
        { weapon: 10, group: 'gun', offset: 0.6, delay: 0 },
        { weapon: 4, group: 'rocket', offset: -0.9, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0, delay: 0.3 },
        { weapon: 4, group: 'rocket', offset: 0.9, delay: 0.6 },
      ]
    }
  },
  {
    // Advanced rocket pirate: an advanced-tier rocketeer on the orange enemy_2 model — Pirate hull (36 HP) +
    // Pirate engine + Scout thrusters, a long-range Pirate MG + a rocket launcher. NOT yet wired into any
    // level (kept for future use, e.g. a harder rocketeer wave); stats are a sensible default, tune as needed.
    name: 'advanced rocket pirate', type: 'enemy', modelUrl: 'assets/ships/enemy_2_orange_combat.01d7a8d4.glb', modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/enemy_2_orange_hangar.cb830103.glb',
    components: { hull: 22, engine: 23, thruster: 9 }, stats: {
      role: 'advanced_rocket_pirate', class: 'fighter', color: MARKER.small, reward: 75,
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.09,y:-0.121,z:-1.211},h:{x:0.419,y:0.269,z:0.169},u0:{x:0.9939,y:0.0615,z:0.0911},u1:{x:-0.0363,y:0.9662,z:-0.2554},u2:{x:-0.1038,y:0.2505,z:0.9625}},{c:{x:-0.348,y:-0.076,z:-0.42},h:{x:0.491,y:0.304,z:0.258},u0:{x:-0.1039,y:-0.016,z:0.9945},u1:{x:0.5984,y:0.7977,z:0.0753},u2:{x:0.7945,y:-0.6029,z:0.0734}},{c:{x:0.414,y:-0.022,z:0.508},h:{x:0.42,y:0.283,z:0.183},u0:{x:-0.3442,y:0.02,z:0.9387},u1:{x:0.911,y:-0.2346,z:0.3391},u2:{x:0.227,y:0.9719,z:0.0625}},{c:{x:0.036,y:0.209,z:-0.6},h:{x:0.392,y:0.339,z:0.177},u0:{x:0.9616,y:-0.0181,z:-0.2738},u1:{x:0.2693,y:-0.1287,z:0.9544},u2:{x:0.0525,y:0.9915,z:0.1189}},{c:{x:-0.465,y:0.011,z:-1.083},h:{x:0.35,y:0.285,z:0.191},u0:{x:0.0951,y:-0.2011,z:0.9749},u1:{x:0.1304,y:0.9735,z:0.1881},u2:{x:0.9869,y:-0.1092,z:-0.1188}},{c:{x:0.075,y:0.145,z:-0.102},h:{x:0.517,y:0.435,z:0.129},u0:{x:0.7552,y:-0.0432,z:0.6541},u1:{x:-0.6549,y:-0.0046,z:0.7557},u2:{x:0.0296,y:0.9991,z:0.0318}},{c:{x:0.386,y:0.184,z:-0.983},h:{x:0.33,y:0.227,z:0.148},u0:{x:-0.317,y:0.9152,z:-0.2488},u1:{x:0.8781,y:0.1841,z:-0.4416},u2:{x:0.3584,y:0.3584,z:0.862}},{c:{x:0.357,y:-0.049,z:-0.276},h:{x:0.625,y:0.284,z:0.248},u0:{x:0.0412,y:-0.0578,z:0.9975},u1:{x:-0.432,y:0.8991,z:0.07},u2:{x:0.9009,y:0.4338,z:-0.0121}},{c:{x:-0.431,y:0.065,z:0.422},h:{x:0.497,y:0.273,z:0.248},u0:{x:0.1639,y:0.0706,z:0.9839},u1:{x:0.8977,y:0.4028,z:-0.1785},u2:{x:-0.409,y:0.9126,z:0.0027}},{c:{x:0.013,y:-0.28,z:1.298},h:{x:0.459,y:0.199,z:0.124},u0:{x:-0.0821,y:-0.0441,z:0.9956},u1:{x:0.992,y:0.0926,z:0.0859},u2:{x:-0.096,y:0.9947,z:0.0361}},{c:{x:0.242,y:-0.104,z:0.875},h:{x:0.38,y:0.195,z:0.12},u0:{x:-0.3286,y:-0.3253,z:0.8867},u1:{x:0.1176,y:0.9174,z:0.3801},u2:{x:0.9371,y:-0.2292,z:0.2633}},{c:{x:0.06,y:0.155,z:-1.06},h:{x:0.343,y:0.312,z:0.117},u0:{x:0.7923,y:0.0165,z:-0.6099},u1:{x:0.5894,y:0.2377,z:0.7721},u2:{x:-0.1577,y:0.9712,z:-0.1785}},{c:{x:-0.772,y:-0.004,z:-1.267},h:{x:0.523,y:0.256,z:0.14},u0:{x:0.3721,y:0.0088,z:0.9282},u1:{x:0.9276,y:-0.0399,z:-0.3715},u2:{x:0.0338,y:0.9992,z:-0.023}},{c:{x:-0.552,y:0.338,z:-1.171},h:{x:0.376,y:0.26,z:0.134},u0:{x:0.3918,y:0.0448,z:0.9189},u1:{x:0.9149,y:0.0863,z:-0.3943},u2:{x:-0.097,y:0.9953,z:-0.0071}},{c:{x:0.354,y:0.346,z:-1.171},h:{x:0.413,y:0.335,z:0.121},u0:{x:0.7998,y:-0.1738,z:-0.5746},u1:{x:0.5624,y:-0.1177,z:0.8184},u2:{x:0.2099,y:0.9777,z:-0.0036}},{c:{x:-0.907,y:-0.204,z:-0.317},h:{x:0.518,y:0.242,z:0.17},u0:{x:-0.078,y:-0.0528,z:0.9956},u1:{x:0.8351,y:0.542,z:0.0942},u2:{x:-0.5446,y:0.8387,z:0.0018}},{c:{x:0.688,y:-0.194,z:-0.306},h:{x:0.558,y:0.302,z:0.196},u0:{x:-0.1367,y:0.0153,z:0.9905},u1:{x:0.9636,y:-0.2299,z:0.1366},u2:{x:0.2298,y:0.9731,z:0.0166}},{c:{x:0.12,y:-0.255,z:0.725},h:{x:0.289,y:0.279,z:0.142},u0:{x:0.1873,y:0.2154,z:0.9584},u1:{x:0.8654,y:0.4255,z:-0.2647},u2:{x:-0.4648,y:0.879,z:-0.1067}},{c:{x:0.737,y:-0.047,z:-1.25},h:{x:0.556,y:0.299,z:0.195},u0:{x:-0.5102,y:0.0111,z:0.86},u1:{x:0.8326,y:-0.2441,z:0.4971},u2:{x:0.2155,y:0.9697,z:0.1153}},{c:{x:-0.213,y:-0.184,z:0.459},h:{x:0.499,y:0.217,z:0.126},u0:{x:0.082,y:0.0099,z:0.9966},u1:{x:-0.6868,y:0.7252,z:0.0493},u2:{x:0.7222,y:0.6885,z:-0.0663}},{c:{x:1.326,y:-0.284,z:-0.568},h:{x:0.454,y:0.325,z:0.141},u0:{x:-0.67,y:0.1512,z:0.7268},u1:{x:0.7077,y:-0.1655,z:0.6869},u2:{x:0.2241,y:0.9746,z:0.0038}},{c:{x:0.343,y:-0.259,z:-0.415},h:{x:0.481,y:0.22,z:0.149},u0:{x:0.0547,y:0.0522,z:0.9971},u1:{x:0.9912,y:0.1181,z:-0.0605},u2:{x:-0.1209,y:0.9916,z:-0.0452}},{c:{x:-1.23,y:-0.295,z:-0.545},h:{x:0.502,y:0.41,z:0.159},u0:{x:0.498,y:0.1603,z:0.8522},u1:{x:0.8612,y:0.024,z:-0.5078},u2:{x:-0.1019,y:0.9868,z:-0.1261}},{c:{x:-0.649,y:-0.165,z:-0.287},h:{x:0.534,y:0.185,z:0.175},u0:{x:0.0331,y:-0.0024,z:0.9995},u1:{x:0.9924,y:0.1188,z:-0.0326},u2:{x:-0.1186,y:0.9929,z:0.0063}},{c:{x:0.08,y:-0.252,z:-0.121},h:{x:0.778,y:0.272,z:0.1},u0:{x:0.0326,y:0.0154,z:0.9993},u1:{x:0.9994,y:0.0104,z:-0.0328},u2:{x:-0.0109,y:0.9998,z:-0.0151}},{c:{x:0.977,y:-0.229,z:-0.268},h:{x:0.467,y:0.182,z:0.175},u0:{x:-0.0801,y:-0.0032,z:0.9968},u1:{x:0.98,y:0.1824,z:0.0793},u2:{x:-0.182,y:0.9832,z:-0.0115}},{c:{x:-0.051,y:-0.26,z:-0.944},h:{x:0.373,y:0.198,z:0.1},u0:{x:0.9932,y:-0.0598,z:0.1},u1:{x:-0.0986,y:0.0262,z:0.9948},u2:{x:0.0621,y:0.9979,z:-0.0201}},{c:{x:-0.02,y:0.129,z:0.464},h:{x:0.372,y:0.304,z:0.107},u0:{x:0.3912,y:-0.1325,z:0.9107},u1:{x:0.9182,y:-0.0098,z:-0.3959},u2:{x:0.0613,y:0.9911,z:0.1178}},{c:{x:-0.285,y:0.213,z:-1.034},h:{x:0.249,y:0.245,z:0.174},u0:{x:-0.3091,y:0.7093,z:-0.6335},u1:{x:-0.2057,y:0.6005,z:0.7727},u2:{x:0.9285,y:0.3692,z:-0.0397}},{c:{x:-0.184,y:0.034,z:0.523},h:{x:0.574,y:0.183,z:0.132},u0:{x:0.03,y:-0.2212,z:0.9748},u1:{x:0.8571,y:0.5075,z:0.0888},u2:{x:-0.5144,y:0.8328,z:0.2048}},{c:{x:-0.017,y:-0.015,z:0.955},h:{x:0.374,y:0.322,z:0.1},u0:{x:0.8086,y:0.2647,z:-0.5254},u1:{x:0.5802,y:-0.2112,z:0.7866},u2:{x:-0.0972,y:0.9409,z:0.3244}},{c:{x:0.374,y:0.055,z:-1.208},h:{x:0.315,y:0.182,z:0.17},u0:{x:-0.1754,y:0.9485,z:0.2637},u1:{x:-0.1579,y:-0.2915,z:0.9434},u2:{x:0.9718,y:0.1238,z:0.2009}},{c:{x:-0.373,y:-0.405,z:-0.304},h:{x:0.53,y:0.205,z:0.131},u0:{x:-0.0739,y:-0.0979,z:0.9925},u1:{x:0.8773,y:0.4669,z:0.1114},u2:{x:-0.4743,y:0.8789,z:0.0514}},{c:{x:0.001,y:-0.1,z:1.267},h:{x:0.302,y:0.296,z:0.161},u0:{x:0.6371,y:-0.2205,z:0.7386},u1:{x:0.7704,y:0.2126,z:-0.6011},u2:{x:-0.0245,y:0.952,z:0.3053}},{c:{x:0.009,y:0.376,z:-0.929},h:{x:0.42,y:0.193,z:0.1},u0:{x:0.9996,y:-0.0131,z:0.0234},u1:{x:-0.0239,y:-0.0373,z:0.999},u2:{x:0.0122,y:0.9992,z:0.0376}},{c:{x:0.367,y:-0.167,z:-1.064},h:{x:0.296,y:0.2,z:0.167},u0:{x:-0.0054,y:-0.0683,z:0.9976},u1:{x:0.7452,y:0.665,z:0.0496},u2:{x:-0.6668,y:0.7437,z:0.0473}},{c:{x:0.379,y:-0.441,z:-0.294},h:{x:0.521,y:0.17,z:0.13},u0:{x:0.0592,y:-0.082,z:0.9949},u1:{x:0.9226,y:-0.376,z:-0.0859},u2:{x:0.3811,y:0.923,z:0.0534}},{c:{x:-0.559,y:-0.252,z:-0.381},h:{x:0.458,y:0.345,z:0.101},u0:{x:0.453,y:-0.0152,z:0.8914},u1:{x:0.8913,y:0.0314,z:-0.4524},u2:{x:-0.0211,y:0.9994,z:0.0277}},{c:{x:1.072,y:-0.316,z:-0.773},h:{x:0.254,y:0.214,z:0.155},u0:{x:0.9587,y:-0.1474,z:-0.2431},u1:{x:0.2761,y:0.6867,z:0.6725},u2:{x:-0.0678,y:0.7119,z:-0.699}},{c:{x:-0.14,y:-0.221,z:1.006},h:{x:0.253,y:0.216,z:0.114},u0:{x:0.7421,y:-0.5832,z:0.3303},u1:{x:-0.2102,y:0.2654,z:0.9409},u2:{x:0.6365,y:0.7677,z:-0.0744}},{c:{x:0.289,y:-0.174,z:0.417},h:{x:0.473,y:0.156,z:0.1},u0:{x:-0.0606,y:0.0492,z:0.9969},u1:{x:0.6989,y:0.7151,z:0.0071},u2:{x:0.7126,y:-0.6972,z:0.0777}},{c:{x:-0.324,y:0.118,z:-1.214},h:{x:0.283,y:0.185,z:0.114},u0:{x:-0.084,y:0.9959,z:0.0342},u1:{x:0.9402,y:0.0679,z:0.3337},u2:{x:-0.33,y:-0.0602,z:0.9421}},{c:{x:-0.057,y:0.391,z:-1.156},h:{x:0.321,y:0.154,z:0.113},u0:{x:0.9998,y:0.0183,z:-0.0117},u1:{x:0.0146,y:-0.1684,z:0.9856},u2:{x:-0.016,y:0.9855,z:0.1686}},{c:{x:-1.499,y:-0.355,z:-0.154},h:{x:0.29,y:0.1,z:0.1},u0:{x:0.0182,y:-0.0154,z:0.9997},u1:{x:-0.08,y:0.9967,z:0.0168},u2:{x:0.9966,y:0.0803,z:-0.0169}},{c:{x:-0.27,y:-0.27,z:-0.414},h:{x:0.482,y:0.175,z:0.111},u0:{x:-0.0299,y:0.032,z:0.999},u1:{x:0.9996,y:0.0019,z:0.0299},u2:{x:-0.001,y:0.9995,z:-0.032}},{c:{x:-1.297,y:-0.297,z:-0.122},h:{x:0.173,y:0.1,z:0.1},u0:{x:0.0121,y:0.0125,z:0.9998},u1:{x:-0.3509,y:0.9364,z:-0.0075},u2:{x:0.9364,y:0.3507,z:-0.0157}},{c:{x:1.301,y:-0.294,z:-0.122},h:{x:0.173,y:0.1,z:0.1},u0:{x:-0.0227,y:0.0134,z:0.9997},u1:{x:0.9084,y:0.4178,z:0.0151},u2:{x:-0.4175,y:0.9084,z:-0.0217}},{c:{x:1.516,y:-0.337,z:-0.154},h:{x:0.29,y:0.1,z:0.1},u0:{x:-0.0157,y:-0.015,z:0.9998},u1:{x:0.1013,y:0.9947,z:0.0166},u2:{x:0.9947,y:-0.1015,z:0.0141}}], broadR: 2.053 /* hitboxes:auto:end */, lift: 0.17, yaw: Math.PI, scale: 1 } /* enemy_2: lift raises the hull onto the bullet plane (assets:hitboxes coverage) */, // orange enemy_2 (faces -Z, yaw PI to face +Z)
      groups: { gun: GUN_LONG, rocket: ROCKET },
      mounts: [
        { weapon: 9, group: 'gun', offset: 0, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0, delay: 0 },
      ]
    }
  },
];

// --- levels: a JSON descriptor the client's level runner plays. A level uses a map and runs an
// ordered list of phases. Each phase optionally spawns enemies from a pool weighted by `chance`
// (spawn frequency — NOT ship mass), up to `maxConcurrent`, with an optional `total` cap, and
// advances when a condition is met:
//   { kills: N }           — N cumulative kills this level
//   { killsSincePhase: N }  — N kills since entering this phase
//   { allCleared: true }    — no enemies left (and the phase's `total` has all spawned)
// A phase with `event: 'win'` ends the level with a victory overlay.
export const LEVELS = [
  // Level 1 — beginner-friendly: gentle ramp, no boss.
  {
    name: 'level-1', descriptor: {
      title: 'Level 1', map: 'home-system',
      lastKillDrop: { kind: 'weapon', refId: 5 },   // cosmetic reward drop on the last enemy (Machine Gun); server force-installs the real copy on victory
      phases: [
        {
          name: 'wave-1', // only plain fighters, 3 at a time
          spawn: { maxConcurrent: 3, total: 6, pool: [{ ship: 'Basic pirate ship', chance: 100 }] },
          advanceWhen: { kills: 6 }
        },
        {
          name: 'wave-2', // rocketeers join at 25%
          spawn: {
            maxConcurrent: 3, total: 6, pool: [
              { ship: 'Basic pirate ship', chance: 75 },
              { ship: 'basic rocket pirate', chance: 25 }]
          },
          advanceWhen: { kills: 12 }
        },
        {
          name: 'finale', // two last rocketeers materialize, then clear the field (carries the remainder)
          spawn: { maxConcurrent: 4, total: 2, pool: [{ ship: 'basic rocket pirate', chance: 100 }] },
          advanceWhen: { allCleared: true }
        },
        { name: 'victory', event: 'win', delay: 2, textKey: 'level.1.victory', text: 'Level 1 cleared! Nice flying, Sentinel.' },
      ]
    }
  },
  // Level 2 — medium: ends with a single mini-boss (the medium) as the boss.
  // `briefing` is shown when the player unlocks this level (after clearing level 1); its `actions`
  // run server-side once, on advance (see advanceProgress). Here: swap the basic gun for a Machine Gun.
  {
    name: 'level-2', descriptor: {
      title: 'Level 2', map: 'home-system',
      lastKillDrop: { kind: 'component', refId: 12 }, // cosmetic reward drop on the last enemy (Repair drone)
      briefing: {
        textKey: 'level.2.briefing',
        text: 'You pulled a Machine Gun out of the wreckage back there, Sentinel — lighter on the trigger and a real help for shooting down incoming rockets. Now push the pirates off our weapons factory before they arm their fleet.',
        actions: [{ type: 'replaceWeapon', from: 1, to: 5 }], // Basic kinetic -> Machine Gun
      },
      phases: [
        {
          name: 'wave-1', // only fighters until 5 kills
          spawn: { maxConcurrent: 4, total: 5, pool: [{ ship: 'Basic pirate ship', chance: 100 }] },
          advanceWhen: { kills: 5 }
        },
        {
          name: 'wave-2', // fighters + rocketeers 75/25 until 12 kills
          spawn: {
            maxConcurrent: 4, total: 7, pool: [
              { ship: 'Basic pirate ship', chance: 75 },
              { ship: 'basic rocket pirate', chance: 25 }]
          },
          advanceWhen: { kills: 12 }
        },
        { name: 'clear-out', // deterministic final wave before the boss (carries the old "carry" count)
          spawn: { maxConcurrent: 4, total: 4, pool: [
            { ship: 'Basic pirate ship', chance: 75 },
            { ship: 'basic rocket pirate', chance: 25 }] },
          advanceWhen: { allCleared: true } },
        {
          name: 'boss', // a single medium appears alone — it's the level's boss
          spawn: { maxConcurrent: 1, total: 1, pool: [{ ship: 'pirate mini boss', chance: 1 }] },
          advanceWhen: { allCleared: true }
        },
        { name: 'victory', event: 'win', delay: 5, textKey: 'level.2.victory', text: 'Level 2 cleared! The mid-boss is down.' },
      ]
    }
  },
  // Level 3 — the full fight: waves of all three enemy types, then the Sector boss.
  // Briefing shown when the player reaches level 3 (after clearing level 2). Installs the repair drone.
  {
    name: 'level-3', descriptor: {
      title: 'Level 3', map: 'home-system',
      briefing: {
        textKey: 'level.3.briefing',
        text: "I see you salvaged a repair drone from that last fight, Sentinel — good. It's fitted and will patch your hull mid-battle, a little at a time. If you take heavy damage, peel off to a quiet corner and let it work.",
        actions: [{ type: 'installComponent', slot: 'repair', component: 12 }],
      },
      phases: [
        {
          name: 'wave-1',
          spawn: {
            maxConcurrent: 4, total: 8, pool: [
              { ship: 'Basic pirate ship', chance: 75 },
              { ship: 'basic rocket pirate', chance: 25 }]
          },
          advanceWhen: { kills: 8 }
        },
        {
          name: 'wave-2',
          spawn: {
            maxConcurrent: 4, total: 8, pool: [
              { ship: 'Basic pirate ship', chance: 65 },
              { ship: 'basic rocket pirate', chance: 20 },
              { ship: 'pirate mini boss', chance: 15 }]
          },
          advanceWhen: { kills: 16 }
        },
        { name: 'clear-out', // deterministic final wave before the boss (carries the old "carry" count)
          spawn: { maxConcurrent: 4, total: 4, pool: [
            { ship: 'Basic pirate ship', chance: 65 },
            { ship: 'basic rocket pirate', chance: 20 },
            { ship: 'pirate mini boss', chance: 15 }] },
          advanceWhen: { allCleared: true } },
        {
          name: 'boss',
          spawn: { maxConcurrent: 1, total: 1, pool: [{ ship: 'first pirate boss', chance: 1 }] },
          advanceWhen: { allCleared: true }
        },
        { name: 'victory', event: 'win', delay: 5, textKey: 'level.3.victory', text: 'Sector cleared. Congratulations, Sentinel!' },
      ]
    }
  },
  // Level 4 — "Find the pirate base" (docs/plans/level-4-find-the-pirate-base.md). The story level after
  // L3; reaching it (clearing L3) shows this briefing and OPENS THE HANGAR SHOP + side missions
  // (`unlockShop` action — text-only otherwise). Clearly harder than L3: pirate gunners + more heavies,
  // higher kill thresholds, and the upgraded boss (two pirate MGs). Sets up L5 ("Storm the pirate base").
  {
    name: 'level-4', descriptor: {
      title: 'Level 4', map: 'home-system',
      briefing: {
        textKey: 'level.4.briefing',
        text: "Several ships bolted from the factory just before we arrived — we tracked their heading, and your job is to find where they're hiding. While you're docked, look over the upgrade gear the factory has on hand: we counted a lot of heavy ships among the ones that fled, so kit out accordingly. Good hunting, Sentinel.",
        actions: [{ type: 'unlockShop' }], // reaching L4 (after clearing L3) opens the shop + side missions
      },
      phases: [
        {
          name: 'wave-1', // pirate gunners + rocketeers + advanced medium pirates (docs/plans/level-4-difficulty.md)
          spawn: {
            maxConcurrent: 5, total: 8, pool: [
              { ship: 'pirate gunner', chance: 40 },
              { ship: 'basic rocket pirate', chance: 40 },
              { ship: 'advanced medium pirate', chance: 20 }]
          },
          advanceWhen: { kills: 8 }
        },
        {
          name: 'wave-2', // more heavies as the trail closes in on the base
          spawn: {
            maxConcurrent: 5, total: 8, pool: [
              { ship: 'pirate gunner', chance: 35 },
              { ship: 'basic rocket pirate', chance: 35 },
              { ship: 'advanced medium pirate', chance: 30 }]
          },
          advanceWhen: { kills: 16 }
        },
        { name: 'clear-out', // deterministic final wave before the boss (carries the old "carry" count)
          spawn: { maxConcurrent: 5, total: 5, pool: [
            { ship: 'pirate gunner', chance: 35 },
            { ship: 'basic rocket pirate', chance: 35 },
            { ship: 'advanced medium pirate', chance: 30 }] },
          advanceWhen: { allCleared: true } },
        {
          name: 'boss', // the Second Boss guards the base's coordinates
          spawn: { maxConcurrent: 1, total: 1, pool: [{ ship: 'second pirate boss', chance: 1 }] },
          advanceWhen: { allCleared: true }
        },
        { name: 'victory', event: 'win', delay: 5, textKey: 'level.4.victory', text: "Tracked. The pirate base just lit up our long-range scan — they're dug in deep. Rearm and regroup, Sentinel; next, we take it down." },
      ]
    }
  },
];

// Precompute the total enemy count per level from its phase script (drives the HUD killed/total).
for (const l of LEVELS) l.descriptor.enemyTotal = enemyTotalFromPhases(l.descriptor.phases);

// --- maps: a JSON descriptor the client renders generically (buildMap). `generator` picks the code
// generator; `params` are its inputs. The current scene (blue ocean planet + two cratered moons +
// stars + a parallax asteroid layer + sky lighting) is the 'home-system' map. No binary assets —
// the textures are procedural from these colors/params.
export const MAPS = [
  {
    name: 'home-system', descriptor: {
      generator: 'planet-system',
      background: 0x1b2531, // dark slate-blue space tint (RGB 27,37,49; tuned via ?tune)
      sky: {
        ambient: { color: 0x3a506e, intensity: 0.7 },           // night-side fill
        sun: { color: 0xfff2e0, intensity: 3.4, pos: [170, -80, 40] }, // side light -> terminator
        // Procedural nebula skybox palette (baked once to a cubemap by buildMap; see DECISIONS §43).
        // "Ice blue sparse": deep-black space + faint blue wisps + a dense static star field, tuned so
        // the backdrop never competes with ships/bullets/FX. Linear-RGB triples; omit any key to use the
        // client's NEBULA_ICEBLUE fallback. Performance tier + ?debug ignore this (flat `background`).
        nebula: {
          base:  [0.01, 0.015, 0.025],
          colA:  [0.12, 0.22, 0.40],
          colB:  [0.20, 0.35, 0.55],
          colC:  [0.10, 0.20, 0.40],
          thLow: 0.55, thHigh: 0.90, glow: 0.30,
          starD: 75, starB: 1.10, sat: 0.90, seed: 0,
          scale: 3.6, // noise frequency: higher = smaller/finer nebula clumps (2.2 = original baseline)
        },
      },
      stars: { count: 2500, radius: 400 },
      planet: { pos: [-150, -285, -110], radius: 60, ocean: 0x5a82c0, halo: { color: 0x6fa8ff, opacity: 0.13 } },
      moons: [
        { radius: 11, color: 0xb9b2a6, orbitR: 96, tilt: 0.5, speed: 0.0625 },
        { radius: 7, color: 0x8f9aa6, orbitR: 136, tilt: -0.35, speed: -0.04 },
      ],
      // a field of small rocks filling the whole disk (inner=0) out to radius `spread`=1000 — inside
      // the arena AND far beyond it; the far edge fades into the fog (~600), so distant rocks read as
      // a faraway field you can fly out into
      asteroids: { count: 2000, inner: 0, spread: 1000, color: 0x6b6f78, minSize: 0.18, maxSize: 0.5, depth: 10, depthVar: 24 },
      // Mission set-pieces live in ONE shared world at FIXED positions — they exist on every level/mission;
      // a mission only changes WHERE you fight (its `center` in missions.js spawns you over the matching
      // one; the others sit at a distance). Spread far apart so they don't overlap. Just below the plane
      // (strong parallax like the background asteroids), static decor (not collidable). docs/plans/mission-maps.md.
      setpieces: [
        { type: 'asteroid-field', pos: [-550, -100, 0], scale: 1.0, color: 0x6e6a63, count: 24, spread: 240, hostSize: 26, beamLen: 34, beamTilt: 0.5, beamColor: 0xffcc66 },
        { type: 'research-station', pos: [400, -125, 0], scale: 0.6, hue: 0x9aa7b5, spin: 0.05, tilt: 0.35 },
        // Freighter set-piece: the first .glb-backed set-piece. modelUrl = combat glb (served same-origin,
        // baked in by assets:pull at deploy). `yaw` orients the nose to +Z like a ship model (0 = this
        // model already faces +Z; its bridge/engines are aft at -Z). `exhaust` is an OPTIONAL, server-
        // delivered effect config (palette + particle params) — omit to use the built-in fiery defaults;
        // this is the light extension point for future server-driven model effects (DECISIONS §38).
        {
          type: 'freighter', pos: [-100, -48, -450], scale: 0.33, speed: 2,
          modelUrl: 'assets/ships/freighter_combat.ffdacc37.glb',
          yaw: 0, // nose already faces +Z (bridge-aft freighter); flip to Math.PI for a -Z export
          // exhaust: { palette: { hot: 0xfff1c0, mid: 0xff7a2a, end: 0x7a1208 }, count: 90, len: 48, size: 5, speed: 1.4 },
        },
        // Base station set-piece pushed off the arena center to (-60,-60) (screen top-left) so the
        // player ship — which spawns/fights near the origin — is never framed against the big station and
        // lost on its backdrop. A below-plane, NON-collidable .glb decor (like the freighter) but raised
        // closer to the combat plane so it reads clearly. It is the return-to-base target: after the last
        // kill the client lifts OOB, shows a homing arrow + hint, and makes this station clickable (autopilot
        // flies here → victory). pos.y = -42 with client BASE_STATION_LEN 100 keeps its TOP ~y=-2.9, just
        // under the plane (ships fly over it — no collision handling). See DECISIONS §39.
        {
          type: 'base-station', pos: [-60, -42, -60], scale: 1.0, spin: 0.03, // up-left of the arena center (screen top-left = -z/-x)
          modelUrl: 'assets/ships/base_station_combat.529dee5e.glb',
          yaw: 0, // a station has no "nose"; 0 reads fine top-down
        },
      ],
    }
  },
];
