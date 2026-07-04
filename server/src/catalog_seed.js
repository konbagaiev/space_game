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
  { id: 5, name: 'Basic engine', type: 'engine', weight: 10, price: 500, stats: { power: 10, maxSpeed: 0, exhaust: { color: 0x6fd0ff, speed: 12, life: 0.55, size: 0.5, spread: 0.35 } } }, // starter gear: cheap
  { id: 6, name: 'Scout engine', type: 'engine', weight: 6, price: 250, stats: { power: 12.6, maxSpeed: 10.5, exhaust: { color: 0xff8a5a, speed: 10, life: 0.4, size: 0.4, spread: 0.3 }, buyable: false } }, // enemy gear: resale-only
  { id: 7, name: 'Boss engine', type: 'engine', weight: 50, stats: { power: 19, maxSpeed: 10.4, exhaust: { color: 0xff5a3a, speed: 10, life: 0.6, size: 0.9, spread: 0.45 } } }, // boss buff: maxSpeed 8 → 10.4 (+30%)
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
  { id: 15, name: 'Solid-fuel engine', type: 'engine', weight: 14, price: 1400, stats: { power: 14, maxSpeed: 12, exhaust: { color: 0x7fb0ff, speed: 13, life: 0.55, size: 0.55, spread: 0.35 } } },
  { id: 16, name: 'Ion engine', type: 'engine', weight: 10, price: 6400, stats: { power: 18, maxSpeed: 14, exhaust: { color: 0xffd24d, speed: 14, life: 0.45, size: 0.45, spread: 0.30 } } },
  // Repair drones: faster cadence + higher cap (the "future tiers" from the repair-drone spec).
  // All tick every 1 s; per-tick HP keeps each tier 3× its old healing rate and preserves the ladder.
  { id: 19, name: 'Repair drone II', type: 'repair', weight: 6, price: 1800, stats: { repairPerTick: 1.5, intervalSec: 1, maxFraction: 0.85 } },
  { id: 20, name: 'Nanobot repair', type: 'repair', weight: 8, price: 7000, stats: { repairPerTick: 2, intervalSec: 1, maxFraction: 0.90 } },
  { id: 21, name: 'Advanced thrusters', type: 'thruster', weight: 5, price: 2500, stats: { power: 3.0 } },

  // --- Pirate gunner parts (side missions, docs/plans/mission-enemies-difficulty.md). +20% HP and
  // +50% top speed over the base enemy (fighter: Light hull 30 HP + Scout engine maxSpeed 10.5).
  // Enemy gear → price 0 (hidden from the shop). ids continue past the max (21).
  { id: 22, name: 'Pirate hull', type: 'hull', weight: 10, price: 200, stats: { durability: 36, volume: 45, buyable: false } },          // 30 × 1.2; enemy gear: resale-only
  { id: 23, name: 'Pirate engine', type: 'engine', weight: 6, price: 400, stats: { power: 12.6, maxSpeed: 15.75, exhaust: { color: 0xff6a4a, speed: 10, life: 0.4, size: 0.4, spread: 0.3 }, buyable: false } }, // maxSpeed 10.5 × 1.5; same accel as Scout; enemy gear: resale-only

  // --- Level-4 enemies (docs/plans/level-4-difficulty.md). Tunable; net turn/accel are mass-scaled, so
  // component power is bumped above the headline +30% to land roughly +30% NET after the heavier hulls.
  // Advanced medium pirate (heavy bruiser, 300 HP, turns ~+30% vs the mini-boss):
  { id: 24, name: 'Pirate heavy hull', type: 'hull', weight: 100, price: 1200, stats: { durability: 300, volume: 250, buyable: false } }, // 2× mini-boss (150); enemy gear: resale-only
  { id: 25, name: 'Pirate medium thruster', type: 'thruster', weight: 8, price: 350, stats: { power: 1.25, buyable: false } },          // ~+30% net turn vs Medium (0.63) once mass-scaled; enemy gear: resale-only
  // Second Boss (550 HP, speed/accel/turn ~+30% vs the first boss):
  { id: 26, name: 'Second-boss engine', type: 'engine', weight: 50, price: 1500, stats: { power: 30, maxSpeed: 14.3, exhaust: { color: 0xff3a2a, speed: 11, life: 0.6, size: 0.95, spread: 0.45 }, buyable: false } }, // boss buff: maxSpeed 11 → 14.3 (+30%); enemy gear: resale-only
  { id: 27, name: 'Second-boss thruster', type: 'thruster', weight: 20, price: 900, stats: { power: 2.7, buyable: false } },            // boss 1.66 bumped for ~+30% net turn; enemy gear: resale-only
  { id: 28, name: 'Second-boss hull', type: 'hull', weight: 140, price: 2000, stats: { durability: 550, volume: 600, buyable: false } }, // boss buff: 450 → 550 (+100 HP); enemy gear: resale-only

  // --- Grab (tractor beam) — a new optional component type (single slot like `repair`; no stacking).
  // On kill, enemies sometimes drop a piece of their gear as a metal-box in the arena; a drop within the
  // grab's RANGE is pulled toward the ship, and collected drops deposit into the stash on mission victory.
  //   RANGE (world units) = strength;  PULL SPEED (u/s) = (strength / 2) * (10 / pulledItemWeight).
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
      seekHalfAngle: 60 * Math.PI / 180, detonateRadius: 1.0, blastRadius: 5, // detonateRadius = proximity fuse to the HULL (hitBoxes), not to center — keep small
      blastVisual: 4.5, blastTimeScale: 0.8, blastTint: 0xffb050, // detonation FX: size / speed (<1 = quicker) / tint
      fireCooldown: 5, weight: 8, projectileColor: 0xffaa44, class: 'rocket'
    }
  },
  {
    id: 4, name: 'Rocket pirate', type: 'rocket', price: 200, stats: { // enemy gear: resale-only (hidden from the shop)
      power: 25, accel: 9, turnRate: 1.0, launchSpeed: 12, maxRange: 120, health: 20,
      detonateRadius: 1.0, blastRadius: 5, // hull-proximity fuse (see id 3)
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
      seekHalfAngle: 50 * Math.PI / 180, detonateRadius: 1.2, blastRadius: 7, // hull-proximity fuse (see id 3)
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
];

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
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.011,y:-0.195,z:0.679},h:{x:0.451,y:0.328,z:0.216},u0:{x:-0.0982,y:-0.0993,z:0.9902},u1:{x:0.9863,y:-0.1423,z:0.0835},u2:{x:0.1326,y:0.9848,z:0.1119}},{c:{x:0.257,y:-0.181,z:0.108},h:{x:0.624,y:0.29,z:0.215},u0:{x:-0.0423,y:0.019,z:0.9989},u1:{x:0.9979,y:-0.0476,z:0.0432},u2:{x:0.0484,y:0.9987,z:-0.017}},{c:{x:-0.023,y:-0.111,z:0.19},h:{x:0.362,y:0.325,z:0.266},u0:{x:0.7554,y:0.5454,z:-0.3632},u1:{x:0.6136,y:-0.3943,z:0.6841},u2:{x:-0.2299,y:0.7397,z:0.6325}},{c:{x:0.276,y:-0.162,z:-0.612},h:{x:0.276,y:0.255,z:0.248},u0:{x:0.3905,y:0.166,z:0.9055},u1:{x:0.4954,y:0.7912,z:-0.3587},u2:{x:0.7759,y:-0.5887,z:-0.2267}},{c:{x:0.151,y:-0.044,z:-0.331},h:{x:0.436,y:0.237,z:0.228},u0:{x:0.0032,y:0.0213,z:0.9998},u1:{x:0.8526,y:-0.5225,z:0.0084},u2:{x:0.5226,y:0.8524,z:-0.0198}},{c:{x:-0.2,y:-0.096,z:-0.229},h:{x:0.377,y:0.373,z:0.285},u0:{x:-0.0767,y:-0.166,z:0.9831},u1:{x:0.7058,y:0.6874,z:0.1711},u2:{x:-0.7042,y:0.707,z:0.0645}},{c:{x:-0.15,y:-0.213,z:-0.601},h:{x:0.363,y:0.313,z:0.255},u0:{x:0.8003,y:0.4903,z:-0.3452},u1:{x:-0.1202,y:0.6952,z:0.7087},u2:{x:0.5875,y:-0.5257,z:0.6152}},{c:{x:-0.412,y:-0.179,z:-0.245},h:{x:0.66,y:0.235,z:0.149},u0:{x:0.0324,y:-0.0659,z:0.9973},u1:{x:-0.0973,y:0.9929,z:0.0688},u2:{x:0.9947,y:0.0992,z:-0.0257}},{c:{x:0.134,y:-0.242,z:-0.299},h:{x:0.617,y:0.166,z:0.145},u0:{x:-0.0059,y:-0.0228,z:0.9997},u1:{x:0.9812,y:-0.1929,z:0.0014},u2:{x:0.1928,y:0.981,z:0.0235}},{c:{x:-0.355,y:-0.152,z:0.519},h:{x:0.223,y:0.17,z:0.095},u0:{x:-0.1438,y:-0.0491,z:0.9884},u1:{x:0.9863,y:-0.0886,z:0.1391},u2:{x:0.0807,y:0.9949,z:0.0612}},{c:{x:1.377,y:-0.217,z:-0.509},h:{x:0.535,y:0.174,z:0.056},u0:{x:0.9241,y:0.0037,z:-0.382},u1:{x:0.3816,y:0.04,z:0.9235},u2:{x:-0.0187,y:0.9992,z:-0.0356}},{c:{x:-1.329,y:-0.213,z:-0.478},h:{x:0.505,y:0.175,z:0.056},u0:{x:0.9114,y:-0.0029,z:0.4115},u1:{x:-0.4112,y:0.0366,z:0.9108},u2:{x:0.0177,y:0.9993,z:-0.0321}},{c:{x:-0.041,y:-0.1,z:-0.849},h:{x:0.264,y:0.218,z:0.17},u0:{x:0.4268,y:-0.0205,z:0.9041},u1:{x:0.8909,y:0.1815,z:-0.4164},u2:{x:-0.1556,y:0.9832,z:0.0957}},{c:{x:-0.713,y:-0.214,z:-0.25},h:{x:0.349,y:0.255,z:0.061},u0:{x:0.7366,y:0.0174,z:0.6761},u1:{x:-0.676,y:-0.0141,z:0.7368},u2:{x:-0.0223,y:0.9998,z:-0.0014}},{c:{x:0.728,y:-0.217,z:-0.249},h:{x:0.261,y:0.206,z:0.076},u0:{x:-0.4342,y:0.0139,z:0.9007},u1:{x:0.9007,y:-0.0065,z:0.4343},u2:{x:0.0119,y:0.9999,z:-0.0097}},{c:{x:0,y:0.17,z:-0.848},h:{x:0.317,y:0.23,z:0.068},u0:{x:0.001,y:-0.6716,z:0.7409},u1:{x:-0.004,y:0.7409,z:0.6716},u2:{x:1,y:0.0036,z:0.0019}}], broadR: 2.033 /* hitboxes:auto:end */, yaw: 0, scale: 1.1 },
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
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.309,y:-0.067,z:-1.129},h:{x:0.447,y:0.344,z:0.294},u0:{x:-0.1464,y:-0.5512,z:0.8214},u1:{x:0.9839,y:0.0052,z:0.1789},u2:{x:-0.1029,y:0.8344,z:0.5415}},{c:{x:-0.106,y:-0.295,z:0.638},h:{x:0.732,y:0.369,z:0.15},u0:{x:0.0464,y:-0.0298,z:0.9985},u1:{x:-0.5671,y:0.8221,z:0.0509},u2:{x:0.8224,y:0.5686,z:-0.0212}},{c:{x:-0.022,y:-0.303,z:-0.393},h:{x:0.487,y:0.408,z:0.276},u0:{x:-0.0515,y:-0.0824,z:0.9953},u1:{x:0.985,y:-0.1685,z:0.0371},u2:{x:0.1647,y:0.9822,z:0.0898}},{c:{x:0.002,y:-0.038,z:0.283},h:{x:0.476,y:0.362,z:0.219},u0:{x:-0.0568,y:0.0946,z:0.9939},u1:{x:0.9894,y:0.1384,z:0.0433},u2:{x:-0.1335,y:0.9858,z:-0.1015}},{c:{x:0.133,y:-0.229,z:-0.082},h:{x:0.783,y:0.346,z:0.188},u0:{x:-0.0107,y:-0.0143,z:0.9998},u1:{x:0.3132,y:0.9495,z:0.0169},u2:{x:0.9496,y:-0.3133,z:0.0057}},{c:{x:-0.81,y:-0.178,z:-0.956},h:{x:0.705,y:0.414,z:0.277},u0:{x:-0.4875,y:-0.0816,z:0.8693},u1:{x:0.7397,y:0.4903,z:0.4609},u2:{x:-0.4638,y:0.8677,z:-0.1787}},{c:{x:0.89,y:-0.188,z:-0.931},h:{x:0.629,y:0.407,z:0.21},u0:{x:0.4051,y:-0.1371,z:0.9039},u1:{x:0.8424,y:-0.3281,z:-0.4273},u2:{x:0.3552,y:0.9346,z:-0.0174}},{c:{x:0.373,y:-0.264,z:-0.923},h:{x:0.442,y:0.362,z:0.293},u0:{x:0.9946,y:0.01,z:-0.103},u1:{x:0.0627,y:0.7338,z:0.6765},u2:{x:0.0823,y:-0.6793,z:0.7293}},{c:{x:0.005,y:-0.277,z:-1.559},h:{x:0.448,y:0.319,z:0.309},u0:{x:0.9938,y:0.0588,z:-0.0942},u1:{x:0.0334,y:0.6502,z:0.759},u2:{x:-0.1059,y:0.7575,z:-0.6442}},{c:{x:-0.011,y:0.01,z:-0.483},h:{x:0.569,y:0.48,z:0.17},u0:{x:0.8619,y:0.0029,z:-0.5071},u1:{x:0.5041,y:-0.1136,z:0.8561},u2:{x:0.0552,y:0.9935,z:0.0994}},{c:{x:0.089,y:0.074,z:-1.107},h:{x:0.403,y:0.379,z:0.204},u0:{x:-0.0615,y:0.1599,z:0.9852},u1:{x:-0.6021,y:0.7813,z:-0.1644},u2:{x:0.7961,y:0.6033,z:-0.0482}},{c:{x:0.014,y:-0.146,z:1.156},h:{x:0.594,y:0.368,z:0.279},u0:{x:-0.0252,y:0.0348,z:0.9991},u1:{x:-0.0535,y:0.9979,z:-0.0361},u2:{x:0.9982,y:0.0544,z:0.0233}},{c:{x:-0.175,y:-0.346,z:-1.12},h:{x:0.765,y:0.47,z:0.153},u0:{x:0.9628,y:-0.0533,z:-0.265},u1:{x:0.2658,y:0.0077,z:0.964},u2:{x:0.0494,y:0.9985,z:-0.0216}},{c:{x:0.53,y:-0.119,z:-1.328},h:{x:0.331,y:0.304,z:0.197},u0:{x:-0.3564,y:0.9283,z:0.1057},u1:{x:0.9319,y:0.3614,z:-0.0315},u2:{x:0.0675,y:-0.0872,z:0.9939}},{c:{x:0.017,y:0.444,z:-1.288},h:{x:0.36,y:0.358,z:0.148},u0:{x:0.7714,y:-0.0549,z:0.634},u1:{x:-0.6363,y:-0.0675,z:0.7685},u2:{x:-0.0005,y:0.9962,z:0.087}},{c:{x:0.335,y:0.085,z:-1.108},h:{x:0.343,y:0.275,z:0.088},u0:{x:0.1101,y:0.0073,z:0.9939},u1:{x:0.9896,y:-0.0944,z:-0.1089},u2:{x:0.093,y:0.9955,z:-0.0176}}], broadR: 2.095 /* hitboxes:auto:end */, yaw: Math.PI, scale: 1 },
      groups: { gun: GUN },
      mounts: [{ weapon: 2, group: 'gun', offset: 0, delay: 0 }]
    }
  },
  {
    name: 'basic rocket pirate', type: 'enemy', modelUrl: 'assets/ships/enemy_2_combat.e6fbbe91.glb',
    components: { hull: 2, engine: 6, thruster: 9 }, stats: { // same hull + engine + thrusters as the fighter
      role: 'rocketeer', class: 'fighter', color: MARKER.small, reward: 50,
      // enemy_2 export faces -Z (same pack as enemy_1); yaw Math.PI rotates 180° to face +Z
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.382,y:-0.122,z:0.024},h:{x:0.952,y:0.392,z:0.263},u0:{x:0.0981,y:0.0462,z:0.9941},u1:{x:0.9944,y:-0.0446,z:-0.096},u2:{x:0.0399,y:0.9979,z:-0.0503}},{c:{x:-0.531,y:0.122,z:-1.262},h:{x:0.606,y:0.397,z:0.35},u0:{x:0.777,y:-0.236,z:0.5835},u1:{x:0.0813,y:0.9569,z:0.2788},u2:{x:-0.6242,y:-0.1692,z:0.7628}},{c:{x:1.048,y:-0.264,z:-0.499},h:{x:0.722,y:0.599,z:0.172},u0:{x:0.9249,y:-0.2182,z:-0.3115},u1:{x:0.3069,y:-0.0553,z:0.9501},u2:{x:0.2245,y:0.9743,z:-0.0158}},{c:{x:-1.161,y:-0.292,z:-0.414},h:{x:0.646,y:0.6,z:0.159},u0:{x:0.4751,y:0.1128,z:0.8726},u1:{x:0.8623,y:0.1378,z:-0.4873},u2:{x:-0.1752,y:0.984,z:-0.0318}},{c:{x:-0.263,y:-0.37,z:-0.495},h:{x:0.733,y:0.31,z:0.197},u0:{x:-0.1418,y:-0.1406,z:0.9799},u1:{x:0.8657,y:0.4625,z:0.1916},u2:{x:-0.4801,y:0.8754,z:0.0561}},{c:{x:-0.052,y:-0.191,z:1.054},h:{x:0.718,y:0.36,z:0.252},u0:{x:0.1532,y:-0.2524,z:0.9554},u1:{x:0.9882,y:0.0308,z:-0.1504},u2:{x:0.0086,y:0.9671,z:0.2541}},{c:{x:0.3,y:-0.09,z:0.518},h:{x:0.635,y:0.305,z:0.259},u0:{x:-0.4078,y:-0.0305,z:0.9126},u1:{x:0.4908,y:0.8355,z:0.2472},u2:{x:0.77,y:-0.5487,z:0.3257}},{c:{x:0.101,y:-0.025,z:-1.169},h:{x:0.49,y:0.38,z:0.17},u0:{x:0.818,y:0.5311,z:-0.2208},u1:{x:-0.5234,y:0.8465,z:0.0968},u2:{x:0.2383,y:0.0364,z:0.9705}},{c:{x:-0.198,y:0.14,z:-0.906},h:{x:0.564,y:0.3,z:0.238},u0:{x:0.9767,y:0.1126,z:-0.1827},u1:{x:0.2129,y:-0.401,z:0.891},u2:{x:-0.0271,y:0.9091,z:0.4156}},{c:{x:-0.016,y:0.371,z:-1.009},h:{x:0.624,y:0.336,z:0.153},u0:{x:0.9849,y:-0.0795,z:-0.1537},u1:{x:0.1457,y:-0.0979,z:0.9845},u2:{x:0.0933,y:0.992,z:0.0849}},{c:{x:0.061,y:0.107,z:0.345},h:{x:0.585,y:0.441,z:0.119},u0:{x:0.9542,y:-0.0377,z:0.2967},u1:{x:-0.2983,y:-0.0443,z:0.9535},u2:{x:0.0228,y:0.9983,z:0.0536}},{c:{x:0.044,y:-0.24,z:-0.084},h:{x:0.787,y:0.359,z:0.107},u0:{x:-0.0815,y:0.038,z:0.9959},u1:{x:0.9962,y:-0.029,z:0.0827},u2:{x:0.032,y:0.9989,z:-0.0355}},{c:{x:0.341,y:-0.165,z:-0.391},h:{x:0.632,y:0.38,z:0.255},u0:{x:-0.0131,y:-0.0564,z:0.9983},u1:{x:0.0543,y:0.9969,z:0.057},u2:{x:0.9984,y:-0.055,z:0.01}},{c:{x:0.704,y:-0.03,z:-1.288},h:{x:0.539,y:0.27,z:0.184},u0:{x:-0.5875,y:0.071,z:0.8061},u1:{x:0.7775,y:-0.2267,z:0.5867},u2:{x:0.2244,y:0.9714,z:0.078}},{c:{x:-0.001,y:0.193,z:-0.375},h:{x:0.477,y:0.378,z:0.192},u0:{x:0.0222,y:-0.0265,z:0.9994},u1:{x:0.9992,y:-0.0314,z:-0.023},u2:{x:0.032,y:0.9992,z:0.0258}},{c:{x:0.193,y:-0.246,z:-1.029},h:{x:0.405,y:0.313,z:0.173},u0:{x:0.9619,y:0.1844,z:-0.2017},u1:{x:0.206,y:-0.004,z:0.9785},u2:{x:-0.1796,y:0.9828,z:0.0419}}], broadR: 2.159 /* hitboxes:auto:end */, yaw: Math.PI, scale: 1 },
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
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.309,y:-0.067,z:-1.129},h:{x:0.447,y:0.344,z:0.294},u0:{x:-0.1464,y:-0.5512,z:0.8214},u1:{x:0.9839,y:0.0052,z:0.1789},u2:{x:-0.1029,y:0.8344,z:0.5415}},{c:{x:-0.106,y:-0.295,z:0.638},h:{x:0.732,y:0.369,z:0.15},u0:{x:0.0464,y:-0.0298,z:0.9985},u1:{x:-0.5671,y:0.8221,z:0.0509},u2:{x:0.8224,y:0.5686,z:-0.0212}},{c:{x:-0.022,y:-0.303,z:-0.393},h:{x:0.487,y:0.408,z:0.276},u0:{x:-0.0515,y:-0.0824,z:0.9953},u1:{x:0.985,y:-0.1685,z:0.0371},u2:{x:0.1647,y:0.9822,z:0.0898}},{c:{x:0.002,y:-0.038,z:0.283},h:{x:0.476,y:0.362,z:0.219},u0:{x:-0.0568,y:0.0946,z:0.9939},u1:{x:0.9894,y:0.1384,z:0.0433},u2:{x:-0.1335,y:0.9858,z:-0.1015}},{c:{x:0.133,y:-0.229,z:-0.082},h:{x:0.783,y:0.346,z:0.188},u0:{x:-0.0107,y:-0.0143,z:0.9998},u1:{x:0.3132,y:0.9495,z:0.0169},u2:{x:0.9496,y:-0.3133,z:0.0057}},{c:{x:-0.81,y:-0.178,z:-0.956},h:{x:0.705,y:0.414,z:0.277},u0:{x:-0.4875,y:-0.0816,z:0.8693},u1:{x:0.7397,y:0.4903,z:0.4609},u2:{x:-0.4638,y:0.8677,z:-0.1787}},{c:{x:0.89,y:-0.188,z:-0.931},h:{x:0.629,y:0.407,z:0.21},u0:{x:0.4051,y:-0.1371,z:0.9039},u1:{x:0.8424,y:-0.3281,z:-0.4273},u2:{x:0.3552,y:0.9346,z:-0.0174}},{c:{x:0.373,y:-0.264,z:-0.923},h:{x:0.442,y:0.362,z:0.293},u0:{x:0.9946,y:0.01,z:-0.103},u1:{x:0.0627,y:0.7338,z:0.6765},u2:{x:0.0823,y:-0.6793,z:0.7293}},{c:{x:0.005,y:-0.277,z:-1.559},h:{x:0.448,y:0.319,z:0.309},u0:{x:0.9938,y:0.0588,z:-0.0942},u1:{x:0.0334,y:0.6502,z:0.759},u2:{x:-0.1059,y:0.7575,z:-0.6442}},{c:{x:-0.011,y:0.01,z:-0.483},h:{x:0.569,y:0.48,z:0.17},u0:{x:0.8619,y:0.0029,z:-0.5071},u1:{x:0.5041,y:-0.1136,z:0.8561},u2:{x:0.0552,y:0.9935,z:0.0994}},{c:{x:0.089,y:0.074,z:-1.107},h:{x:0.403,y:0.379,z:0.204},u0:{x:-0.0615,y:0.1599,z:0.9852},u1:{x:-0.6021,y:0.7813,z:-0.1644},u2:{x:0.7961,y:0.6033,z:-0.0482}},{c:{x:0.014,y:-0.146,z:1.156},h:{x:0.594,y:0.368,z:0.279},u0:{x:-0.0252,y:0.0348,z:0.9991},u1:{x:-0.0535,y:0.9979,z:-0.0361},u2:{x:0.9982,y:0.0544,z:0.0233}},{c:{x:-0.175,y:-0.346,z:-1.12},h:{x:0.765,y:0.47,z:0.153},u0:{x:0.9628,y:-0.0533,z:-0.265},u1:{x:0.2658,y:0.0077,z:0.964},u2:{x:0.0494,y:0.9985,z:-0.0216}},{c:{x:0.53,y:-0.119,z:-1.328},h:{x:0.331,y:0.304,z:0.197},u0:{x:-0.3564,y:0.9283,z:0.1057},u1:{x:0.9319,y:0.3614,z:-0.0315},u2:{x:0.0675,y:-0.0872,z:0.9939}},{c:{x:0.017,y:0.444,z:-1.288},h:{x:0.36,y:0.358,z:0.148},u0:{x:0.7714,y:-0.0549,z:0.634},u1:{x:-0.6363,y:-0.0675,z:0.7685},u2:{x:-0.0005,y:0.9962,z:0.087}},{c:{x:0.335,y:0.085,z:-1.108},h:{x:0.343,y:0.275,z:0.088},u0:{x:0.1101,y:0.0073,z:0.9939},u1:{x:0.9896,y:-0.0944,z:-0.1089},u2:{x:0.093,y:0.9955,z:-0.0176}}], broadR: 2.095 /* hitboxes:auto:end */, yaw: Math.PI, scale: 1 }, // orange enemy_1 (faces -Z, yaw PI to face +Z)
      groups: { gun: GUN_LONG },
      mounts: [{ weapon: 9, group: 'gun', offset: 0, delay: 0 }]
    }
  },
  {
    name: 'pirate mini boss', type: 'enemy', modelUrl: 'assets/ships/enemy_3_combat.431cdbbf.glb',
    components: { hull: 3, engine: 6, thruster: 10 }, stats: { // medium hull + scout engine + weak (Medium) thrusters
      role: 'medium', class: 'capital', color: MARKER.medium, reward: 125,
      // enemy_3 export faces -Z (same pack as enemy_1); yaw Math.PI rotates 180° to face +Z
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.596,y:-0.224,z:-0.832},h:{x:0.764,y:0.31,z:0.126},u0:{x:0.0339,y:-0.0184,z:0.9993},u1:{x:0.9953,y:0.0918,z:-0.0321},u2:{x:-0.0911,y:0.9956,z:0.0214}},{c:{x:0.14,y:-0.056,z:0.055},h:{x:0.682,y:0.238,z:0.184},u0:{x:-0.0432,y:-0.1725,z:0.9841},u1:{x:0.838,y:-0.5426,z:-0.0583},u2:{x:0.544,y:0.8221,z:0.168}},{c:{x:-0.172,y:0.16,z:-0.776},h:{x:0.469,y:0.353,z:0.252},u0:{x:0.9358,y:0.2782,z:0.2167},u1:{x:-0.1556,y:-0.2258,z:0.9617},u2:{x:-0.3164,y:0.9336,z:0.168}},{c:{x:0.277,y:0.029,z:-0.891},h:{x:0.426,y:0.319,z:0.276},u0:{x:0.1665,y:-0.0855,z:0.9823},u1:{x:0.9798,y:0.1259,z:-0.1551},u2:{x:-0.1104,y:0.9884,z:0.1047}},{c:{x:-0.105,y:-0.288,z:0.207},h:{x:0.494,y:0.352,z:0.156},u0:{x:0.9525,y:-0.0393,z:0.3021},u1:{x:-0.2978,y:0.0895,z:0.9504},u2:{x:0.0644,y:0.9952,z:-0.0735}},{c:{x:0.048,y:-0.297,z:1.244},h:{x:0.489,y:0.464,z:0.13},u0:{x:0.974,y:0.0048,z:-0.2266},u1:{x:0.2266,y:-0.0053,z:0.974},u2:{x:-0.0035,y:1,z:0.0063}},{c:{x:0.401,y:-0.233,z:-1.305},h:{x:0.44,y:0.315,z:0.246},u0:{x:-0.5949,y:0.0796,z:0.7999},u1:{x:0.7727,y:0.3307,z:0.5418},u2:{x:-0.2213,y:0.9404,z:-0.2582}},{c:{x:0.262,y:-0.209,z:-0.27},h:{x:0.737,y:0.257,z:0.217},u0:{x:0.0181,y:0.0169,z:0.9997},u1:{x:-0.6803,y:0.7329,z:-0.0001},u2:{x:0.7327,y:0.6801,z:-0.0248}},{c:{x:-0.265,y:-0.176,z:-0.44},h:{x:0.98,y:0.265,z:0.146},u0:{x:0.0094,y:0.0236,z:0.9997},u1:{x:0.0059,y:0.9997,z:-0.0236},u2:{x:0.9999,y:-0.0061,z:-0.0093}},{c:{x:-0.019,y:-0.025,z:-1.338},h:{x:0.452,y:0.342,z:0.231},u0:{x:-0.0318,y:-0.329,z:0.9438},u1:{x:0.9881,y:-0.1528,z:-0.0199},u2:{x:0.1507,y:0.9319,z:0.3299}},{c:{x:-0.151,y:0.12,z:-0.29},h:{x:0.33,y:0.325,z:0.173},u0:{x:0.4202,y:0.253,z:0.8715},u1:{x:0.7276,y:0.4799,z:-0.4901},u2:{x:-0.5422,y:0.8401,z:0.0176}},{c:{x:-0.09,y:-0.072,z:-0.136},h:{x:0.876,y:0.214,z:0.17},u0:{x:0.1123,y:0.0021,z:0.9937},u1:{x:0.6293,y:0.7737,z:-0.0728},u2:{x:0.769,y:-0.6335,z:-0.0856}},{c:{x:-0.014,y:-0.248,z:0.707},h:{x:0.344,y:0.336,z:0.218},u0:{x:0.1506,y:-0.2999,z:0.942},u1:{x:0.9863,y:-0.0194,z:-0.1639},u2:{x:0.0675,y:0.9538,z:0.2929}},{c:{x:0.541,y:-0.265,z:-0.596},h:{x:0.459,y:0.275,z:0.115},u0:{x:-0.1218,y:0.0311,z:0.9921},u1:{x:0.9837,y:-0.1295,z:0.1248},u2:{x:0.1324,y:0.9911,z:-0.0148}},{c:{x:-0.09,y:-0.296,z:-1.472},h:{x:0.39,y:0.271,z:0.24},u0:{x:0.9991,y:-0.0223,z:-0.0372},u1:{x:0.0403,y:0.7959,z:0.6041},u2:{x:0.0162,y:-0.605,z:0.7961}},{c:{x:-0.004,y:-0.391,z:-0.593},h:{x:0.669,y:0.262,z:0.062},u0:{x:0.001,y:0.0176,z:0.9998},u1:{x:1,y:0.0001,z:-0.001},u2:{x:-0.0001,y:0.9998,z:-0.0176}}], broadR: 1.931 /* hitboxes:auto:end */, yaw: Math.PI, scale: 2 },
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
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:0.146,y:0.339,z:-1.1},h:{x:0.883,y:0.575,z:0.464},u0:{x:0.9059,y:-0.2645,z:0.3307},u1:{x:-0.3806,y:-0.1661,z:0.9097},u2:{x:0.1857,y:0.95,z:0.2512}},{c:{x:-0.099,y:0.379,z:-0.353},h:{x:0.665,y:0.556,z:0.466},u0:{x:0.1796,y:-0.1867,z:0.9659},u1:{x:0.9487,y:0.2925,z:-0.1198},u2:{x:-0.2601,y:0.9379,z:0.2297}},{c:{x:0.318,y:0.013,z:-0.7},h:{x:0.664,y:0.328,z:0.193},u0:{x:0.0489,y:-0.0671,z:0.9965},u1:{x:0.997,y:0.0632,z:-0.0447},u2:{x:-0.06,y:0.9957,z:0.07}},{c:{x:-0.009,y:0.157,z:0.678},h:{x:0.624,y:0.381,z:0.241},u0:{x:0.0374,y:0.9859,z:0.1631},u1:{x:-0.1153,y:-0.1579,z:0.9807},u2:{x:0.9926,y:-0.0555,z:0.1078}},{c:{x:-0.653,y:0.114,z:-0.645},h:{x:0.739,y:0.45,z:0.184},u0:{x:-0.3353,y:-0.0107,z:0.942},u1:{x:0.942,y:0.0138,z:0.3355},u2:{x:-0.0166,y:0.9998,z:0.0055}},{c:{x:-0.011,y:0.09,z:1.181},h:{x:0.571,y:0.464,z:0.274},u0:{x:-0.0113,y:-0.164,z:0.9864},u1:{x:0.0835,y:0.9829,z:0.1644},u2:{x:0.9964,y:-0.0842,z:-0.0026}},{c:{x:-0.009,y:-0.661,z:-0.926},h:{x:0.344,y:0.253,z:0.229},u0:{x:-0.104,y:0.9286,z:-0.3561},u1:{x:-0.0077,y:0.3573,z:0.934},u2:{x:0.9945,y:0.0999,z:-0.0301}},{c:{x:-0.2,y:-0.033,z:-0.701},h:{x:0.661,y:0.354,z:0.207},u0:{x:-0.0356,y:-0.0547,z:0.9979},u1:{x:0.9772,y:0.2073,z:0.0462},u2:{x:-0.2094,y:0.9767,z:0.046}},{c:{x:-0.007,y:0.117,z:0.273},h:{x:0.389,y:0.303,z:0.286},u0:{x:-0.0884,y:0.8583,z:0.5055},u1:{x:0.9917,y:0.0285,z:0.1251},u2:{x:-0.0929,y:-0.5124,z:0.8537}},{c:{x:0.142,y:-0.151,z:-0.171},h:{x:0.39,y:0.241,z:0.157},u0:{x:-0.1513,y:0.8654,z:-0.4777},u1:{x:-0.2024,y:0.446,z:0.8719},u2:{x:0.9675,y:0.2286,z:0.1076}},{c:{x:0.75,y:0.124,z:-0.31},h:{x:0.546,y:0.398,z:0.17},u0:{x:-0.2787,y:-0.0127,z:0.9603},u1:{x:0.9571,y:-0.086,z:0.2766},u2:{x:0.0791,y:0.9962,z:0.0362}},{c:{x:1.074,y:0.107,z:-0.095},h:{x:0.648,y:0.162,z:0.133},u0:{x:0.02,y:-0.0292,z:0.9994},u1:{x:0.9907,y:0.1352,z:-0.0159},u2:{x:-0.1347,y:0.9904,z:0.0316}},{c:{x:-0.166,y:-0.328,z:-0.172},h:{x:0.309,y:0.159,z:0.14},u0:{x:-0.14,y:-0.5535,z:0.821},u1:{x:0.3783,y:0.7364,z:0.5609},u2:{x:0.915,y:-0.3892,z:-0.1063}},{c:{x:0.228,y:0.734,z:-1.442},h:{x:0.25,y:0.247,z:0.093},u0:{x:-0.033,y:0.4573,z:0.8887},u1:{x:0.1778,y:0.8777,z:-0.445},u2:{x:0.9835,y:-0.1433,z:0.1103}},{c:{x:0.004,y:0.724,z:-0.98},h:{x:0.494,y:0.209,z:0.126},u0:{x:-0.0276,y:-0.0188,z:0.9994},u1:{x:0.9905,y:-0.1351,z:0.0248},u2:{x:0.1346,y:0.9907,z:0.0223}},{c:{x:-1.062,y:0.104,z:0.182},h:{x:0.373,y:0.13,z:0.115},u0:{x:0.0422,y:-0.0319,z:0.9986},u1:{x:-0.0818,y:0.996,z:0.0353},u2:{x:0.9958,y:0.0832,z:-0.0395}}], broadR: 2.141 /* hitboxes:auto:end */, yaw: Math.PI, scale: 3 },
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
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.596,y:-0.224,z:-0.832},h:{x:0.764,y:0.31,z:0.126},u0:{x:0.0339,y:-0.0184,z:0.9993},u1:{x:0.9953,y:0.0918,z:-0.0321},u2:{x:-0.0911,y:0.9956,z:0.0214}},{c:{x:0.14,y:-0.056,z:0.055},h:{x:0.682,y:0.238,z:0.184},u0:{x:-0.0432,y:-0.1725,z:0.9841},u1:{x:0.838,y:-0.5426,z:-0.0583},u2:{x:0.544,y:0.8221,z:0.168}},{c:{x:-0.172,y:0.16,z:-0.776},h:{x:0.469,y:0.353,z:0.252},u0:{x:0.9358,y:0.2782,z:0.2167},u1:{x:-0.1556,y:-0.2258,z:0.9617},u2:{x:-0.3164,y:0.9336,z:0.168}},{c:{x:0.277,y:0.029,z:-0.891},h:{x:0.426,y:0.319,z:0.276},u0:{x:0.1665,y:-0.0855,z:0.9823},u1:{x:0.9798,y:0.1259,z:-0.1551},u2:{x:-0.1104,y:0.9884,z:0.1047}},{c:{x:-0.105,y:-0.288,z:0.207},h:{x:0.494,y:0.352,z:0.156},u0:{x:0.9525,y:-0.0393,z:0.3021},u1:{x:-0.2978,y:0.0895,z:0.9504},u2:{x:0.0644,y:0.9952,z:-0.0735}},{c:{x:0.048,y:-0.297,z:1.244},h:{x:0.489,y:0.464,z:0.13},u0:{x:0.974,y:0.0048,z:-0.2266},u1:{x:0.2266,y:-0.0053,z:0.974},u2:{x:-0.0035,y:1,z:0.0063}},{c:{x:0.401,y:-0.233,z:-1.305},h:{x:0.44,y:0.315,z:0.246},u0:{x:-0.5949,y:0.0796,z:0.7999},u1:{x:0.7727,y:0.3307,z:0.5418},u2:{x:-0.2213,y:0.9404,z:-0.2582}},{c:{x:0.262,y:-0.209,z:-0.27},h:{x:0.737,y:0.257,z:0.217},u0:{x:0.0181,y:0.0169,z:0.9997},u1:{x:-0.6803,y:0.7329,z:-0.0001},u2:{x:0.7327,y:0.6801,z:-0.0248}},{c:{x:-0.265,y:-0.176,z:-0.44},h:{x:0.98,y:0.265,z:0.146},u0:{x:0.0094,y:0.0236,z:0.9997},u1:{x:0.0059,y:0.9997,z:-0.0236},u2:{x:0.9999,y:-0.0061,z:-0.0093}},{c:{x:-0.019,y:-0.025,z:-1.338},h:{x:0.452,y:0.342,z:0.231},u0:{x:-0.0318,y:-0.329,z:0.9438},u1:{x:0.9881,y:-0.1528,z:-0.0199},u2:{x:0.1507,y:0.9319,z:0.3299}},{c:{x:-0.151,y:0.12,z:-0.29},h:{x:0.33,y:0.325,z:0.173},u0:{x:0.4202,y:0.253,z:0.8715},u1:{x:0.7276,y:0.4799,z:-0.4901},u2:{x:-0.5422,y:0.8401,z:0.0176}},{c:{x:-0.09,y:-0.072,z:-0.136},h:{x:0.876,y:0.214,z:0.17},u0:{x:0.1123,y:0.0021,z:0.9937},u1:{x:0.6293,y:0.7737,z:-0.0728},u2:{x:0.769,y:-0.6335,z:-0.0856}},{c:{x:-0.014,y:-0.248,z:0.707},h:{x:0.344,y:0.336,z:0.218},u0:{x:0.1506,y:-0.2999,z:0.942},u1:{x:0.9863,y:-0.0194,z:-0.1639},u2:{x:0.0675,y:0.9538,z:0.2929}},{c:{x:0.541,y:-0.265,z:-0.596},h:{x:0.459,y:0.275,z:0.115},u0:{x:-0.1218,y:0.0311,z:0.9921},u1:{x:0.9837,y:-0.1295,z:0.1248},u2:{x:0.1324,y:0.9911,z:-0.0148}},{c:{x:-0.09,y:-0.296,z:-1.472},h:{x:0.39,y:0.271,z:0.24},u0:{x:0.9991,y:-0.0223,z:-0.0372},u1:{x:0.0403,y:0.7959,z:0.6041},u2:{x:0.0162,y:-0.605,z:0.7961}},{c:{x:-0.004,y:-0.391,z:-0.593},h:{x:0.669,y:0.262,z:0.062},u0:{x:0.001,y:0.0176,z:0.9998},u1:{x:1,y:0.0001,z:-0.001},u2:{x:-0.0001,y:0.9998,z:-0.0176}}], broadR: 1.931 /* hitboxes:auto:end */, yaw: Math.PI, scale: 2 }, // orange enemy_3 (faces -Z, yaw PI to face +Z)
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
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:0.146,y:0.339,z:-1.1},h:{x:0.883,y:0.575,z:0.464},u0:{x:0.9059,y:-0.2645,z:0.3307},u1:{x:-0.3806,y:-0.1661,z:0.9097},u2:{x:0.1857,y:0.95,z:0.2512}},{c:{x:-0.099,y:0.379,z:-0.353},h:{x:0.665,y:0.556,z:0.466},u0:{x:0.1796,y:-0.1867,z:0.9659},u1:{x:0.9487,y:0.2925,z:-0.1198},u2:{x:-0.2601,y:0.9379,z:0.2297}},{c:{x:0.318,y:0.013,z:-0.7},h:{x:0.664,y:0.328,z:0.193},u0:{x:0.0489,y:-0.0671,z:0.9965},u1:{x:0.997,y:0.0632,z:-0.0447},u2:{x:-0.06,y:0.9957,z:0.07}},{c:{x:-0.009,y:0.157,z:0.678},h:{x:0.624,y:0.381,z:0.241},u0:{x:0.0374,y:0.9859,z:0.1631},u1:{x:-0.1153,y:-0.1579,z:0.9807},u2:{x:0.9926,y:-0.0555,z:0.1078}},{c:{x:-0.653,y:0.114,z:-0.645},h:{x:0.739,y:0.45,z:0.184},u0:{x:-0.3353,y:-0.0107,z:0.942},u1:{x:0.942,y:0.0138,z:0.3355},u2:{x:-0.0166,y:0.9998,z:0.0055}},{c:{x:-0.011,y:0.09,z:1.181},h:{x:0.571,y:0.464,z:0.274},u0:{x:-0.0113,y:-0.164,z:0.9864},u1:{x:0.0835,y:0.9829,z:0.1644},u2:{x:0.9964,y:-0.0842,z:-0.0026}},{c:{x:-0.009,y:-0.661,z:-0.926},h:{x:0.344,y:0.253,z:0.229},u0:{x:-0.104,y:0.9286,z:-0.3561},u1:{x:-0.0077,y:0.3573,z:0.934},u2:{x:0.9945,y:0.0999,z:-0.0301}},{c:{x:-0.2,y:-0.033,z:-0.701},h:{x:0.661,y:0.354,z:0.207},u0:{x:-0.0356,y:-0.0547,z:0.9979},u1:{x:0.9772,y:0.2073,z:0.0462},u2:{x:-0.2094,y:0.9767,z:0.046}},{c:{x:-0.007,y:0.117,z:0.273},h:{x:0.389,y:0.303,z:0.286},u0:{x:-0.0884,y:0.8583,z:0.5055},u1:{x:0.9917,y:0.0285,z:0.1251},u2:{x:-0.0929,y:-0.5124,z:0.8537}},{c:{x:0.142,y:-0.151,z:-0.171},h:{x:0.39,y:0.241,z:0.157},u0:{x:-0.1513,y:0.8654,z:-0.4777},u1:{x:-0.2024,y:0.446,z:0.8719},u2:{x:0.9675,y:0.2286,z:0.1076}},{c:{x:0.75,y:0.124,z:-0.31},h:{x:0.546,y:0.398,z:0.17},u0:{x:-0.2787,y:-0.0127,z:0.9603},u1:{x:0.9571,y:-0.086,z:0.2766},u2:{x:0.0791,y:0.9962,z:0.0362}},{c:{x:1.074,y:0.107,z:-0.095},h:{x:0.648,y:0.162,z:0.133},u0:{x:0.02,y:-0.0292,z:0.9994},u1:{x:0.9907,y:0.1352,z:-0.0159},u2:{x:-0.1347,y:0.9904,z:0.0316}},{c:{x:-0.166,y:-0.328,z:-0.172},h:{x:0.309,y:0.159,z:0.14},u0:{x:-0.14,y:-0.5535,z:0.821},u1:{x:0.3783,y:0.7364,z:0.5609},u2:{x:0.915,y:-0.3892,z:-0.1063}},{c:{x:0.228,y:0.734,z:-1.442},h:{x:0.25,y:0.247,z:0.093},u0:{x:-0.033,y:0.4573,z:0.8887},u1:{x:0.1778,y:0.8777,z:-0.445},u2:{x:0.9835,y:-0.1433,z:0.1103}},{c:{x:0.004,y:0.724,z:-0.98},h:{x:0.494,y:0.209,z:0.126},u0:{x:-0.0276,y:-0.0188,z:0.9994},u1:{x:0.9905,y:-0.1351,z:0.0248},u2:{x:0.1346,y:0.9907,z:0.0223}},{c:{x:-1.062,y:0.104,z:0.182},h:{x:0.373,y:0.13,z:0.115},u0:{x:0.0422,y:-0.0319,z:0.9986},u1:{x:-0.0818,y:0.996,z:0.0353},u2:{x:0.9958,y:0.0832,z:-0.0395}}], broadR: 2.141 /* hitboxes:auto:end */, yaw: Math.PI, scale: 3 }, // orange enemy_4 (faces -Z, yaw PI to face +Z)
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
      model: { /* hitboxes:auto:start */ hitBoxes: [{c:{x:-0.382,y:-0.122,z:0.024},h:{x:0.952,y:0.392,z:0.263},u0:{x:0.0981,y:0.0462,z:0.9941},u1:{x:0.9944,y:-0.0446,z:-0.096},u2:{x:0.0399,y:0.9979,z:-0.0503}},{c:{x:-0.531,y:0.122,z:-1.262},h:{x:0.606,y:0.397,z:0.35},u0:{x:0.777,y:-0.236,z:0.5835},u1:{x:0.0813,y:0.9569,z:0.2788},u2:{x:-0.6242,y:-0.1692,z:0.7628}},{c:{x:1.048,y:-0.264,z:-0.499},h:{x:0.722,y:0.599,z:0.172},u0:{x:0.9249,y:-0.2182,z:-0.3115},u1:{x:0.3069,y:-0.0553,z:0.9501},u2:{x:0.2245,y:0.9743,z:-0.0158}},{c:{x:-1.161,y:-0.292,z:-0.414},h:{x:0.646,y:0.6,z:0.159},u0:{x:0.4751,y:0.1128,z:0.8726},u1:{x:0.8623,y:0.1378,z:-0.4873},u2:{x:-0.1752,y:0.984,z:-0.0318}},{c:{x:-0.263,y:-0.37,z:-0.495},h:{x:0.733,y:0.31,z:0.197},u0:{x:-0.1418,y:-0.1406,z:0.9799},u1:{x:0.8657,y:0.4625,z:0.1916},u2:{x:-0.4801,y:0.8754,z:0.0561}},{c:{x:-0.052,y:-0.191,z:1.054},h:{x:0.718,y:0.36,z:0.252},u0:{x:0.1532,y:-0.2524,z:0.9554},u1:{x:0.9882,y:0.0308,z:-0.1504},u2:{x:0.0086,y:0.9671,z:0.2541}},{c:{x:0.3,y:-0.09,z:0.518},h:{x:0.635,y:0.305,z:0.259},u0:{x:-0.4078,y:-0.0305,z:0.9126},u1:{x:0.4908,y:0.8355,z:0.2472},u2:{x:0.77,y:-0.5487,z:0.3257}},{c:{x:0.101,y:-0.025,z:-1.169},h:{x:0.49,y:0.38,z:0.17},u0:{x:0.818,y:0.5311,z:-0.2208},u1:{x:-0.5234,y:0.8465,z:0.0968},u2:{x:0.2383,y:0.0364,z:0.9705}},{c:{x:-0.198,y:0.14,z:-0.906},h:{x:0.564,y:0.3,z:0.238},u0:{x:0.9767,y:0.1126,z:-0.1827},u1:{x:0.2129,y:-0.401,z:0.891},u2:{x:-0.0271,y:0.9091,z:0.4156}},{c:{x:-0.016,y:0.371,z:-1.009},h:{x:0.624,y:0.336,z:0.153},u0:{x:0.9849,y:-0.0795,z:-0.1537},u1:{x:0.1457,y:-0.0979,z:0.9845},u2:{x:0.0933,y:0.992,z:0.0849}},{c:{x:0.061,y:0.107,z:0.345},h:{x:0.585,y:0.441,z:0.119},u0:{x:0.9542,y:-0.0377,z:0.2967},u1:{x:-0.2983,y:-0.0443,z:0.9535},u2:{x:0.0228,y:0.9983,z:0.0536}},{c:{x:0.044,y:-0.24,z:-0.084},h:{x:0.787,y:0.359,z:0.107},u0:{x:-0.0815,y:0.038,z:0.9959},u1:{x:0.9962,y:-0.029,z:0.0827},u2:{x:0.032,y:0.9989,z:-0.0355}},{c:{x:0.341,y:-0.165,z:-0.391},h:{x:0.632,y:0.38,z:0.255},u0:{x:-0.0131,y:-0.0564,z:0.9983},u1:{x:0.0543,y:0.9969,z:0.057},u2:{x:0.9984,y:-0.055,z:0.01}},{c:{x:0.704,y:-0.03,z:-1.288},h:{x:0.539,y:0.27,z:0.184},u0:{x:-0.5875,y:0.071,z:0.8061},u1:{x:0.7775,y:-0.2267,z:0.5867},u2:{x:0.2244,y:0.9714,z:0.078}},{c:{x:-0.001,y:0.193,z:-0.375},h:{x:0.477,y:0.378,z:0.192},u0:{x:0.0222,y:-0.0265,z:0.9994},u1:{x:0.9992,y:-0.0314,z:-0.023},u2:{x:0.032,y:0.9992,z:0.0258}},{c:{x:0.193,y:-0.246,z:-1.029},h:{x:0.405,y:0.313,z:0.173},u0:{x:0.9619,y:0.1844,z:-0.2017},u1:{x:0.206,y:-0.004,z:0.9785},u2:{x:-0.1796,y:0.9828,z:0.0419}}], broadR: 2.159 /* hitboxes:auto:end */, yaw: Math.PI, scale: 1 }, // orange enemy_2 (faces -Z, yaw PI to face +Z)
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
      phases: [
        {
          name: 'wave-1', // only plain fighters, 3 at a time
          spawn: { maxConcurrent: 3, pool: [{ ship: 'Basic pirate ship', chance: 100 }] },
          advanceWhen: { kills: 6 }
        },
        {
          name: 'wave-2', // rocketeers join at 25%
          spawn: {
            maxConcurrent: 3, pool: [
              { ship: 'Basic pirate ship', chance: 75 },
              { ship: 'basic rocket pirate', chance: 25 }]
          },
          advanceWhen: { kills: 12 }
        },
        {
          name: 'finale', // spawning stops; one last rocketeer, then clear the field
          spawn: { maxConcurrent: 4, total: 1, pool: [{ ship: 'basic rocket pirate', chance: 100 }] },
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
      briefing: {
        textKey: 'level.2.briefing',
        text: 'The pirates are storming our weapons factory — we have to push them back before they arm their fleet. Their heavier squadrons are dug in there, so command has refitted your ship: the basic gun is out, a Machine Gun is in. Go take it back, Sentinel.',
        actions: [{ type: 'replaceWeapon', from: 1, to: 5 }], // Basic kinetic -> Machine Gun
      },
      phases: [
        {
          name: 'wave-1', // only fighters until 5 kills
          spawn: { maxConcurrent: 4, pool: [{ ship: 'Basic pirate ship', chance: 100 }] },
          advanceWhen: { kills: 5 }
        },
        {
          name: 'wave-2', // fighters + rocketeers 75/25 until 15 kills
          spawn: {
            maxConcurrent: 4, pool: [
              { ship: 'Basic pirate ship', chance: 75 },
              { ship: 'basic rocket pirate', chance: 25 }]
          },
          advanceWhen: { kills: 12 }
        },
        { name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } },
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
        text: "Good news, Sentinel — we salvaged a spare repair drone and fitted it to your ship. It'll patch up your hull mid-fight, a little at a time. If you take heavy damage, peel off to a quiet corner of the map and let it work.",
        actions: [{ type: 'installComponent', slot: 'repair', component: 12 }],
      },
      phases: [
        {
          name: 'wave-1',
          spawn: {
            maxConcurrent: 4, pool: [
              { ship: 'Basic pirate ship', chance: 75 },
              { ship: 'basic rocket pirate', chance: 25 }]
          },
          advanceWhen: { kills: 8 }
        },
        {
          name: 'wave-2',
          spawn: {
            maxConcurrent: 4, pool: [
              { ship: 'Basic pirate ship', chance: 65 },
              { ship: 'basic rocket pirate', chance: 20 },
              { ship: 'pirate mini boss', chance: 15 }]
          },
          advanceWhen: { kills: 16 }
        },
        { name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } },
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
            maxConcurrent: 5, pool: [
              { ship: 'pirate gunner', chance: 40 },
              { ship: 'basic rocket pirate', chance: 40 },
              { ship: 'advanced medium pirate', chance: 20 }]
          },
          advanceWhen: { kills: 8 }
        },
        {
          name: 'wave-2', // more heavies as the trail closes in on the base
          spawn: {
            maxConcurrent: 5, pool: [
              { ship: 'pirate gunner', chance: 35 },
              { ship: 'basic rocket pirate', chance: 35 },
              { ship: 'advanced medium pirate', chance: 30 }]
          },
          advanceWhen: { kills: 16 }
        },
        { name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } },
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
        // Base station set-piece near the arena center, offset to (-20,-20) (screen top-left). A below-plane, NON-collidable
        // .glb decor (like the freighter) but raised closer to the combat plane so it reads clearly. It is the
        // return-to-base target: after the last kill the client lifts OOB, shows a homing arrow + hint, and makes
        // this station clickable (autopilot flies here → victory). pos.y = -42 with client BASE_STATION_LEN 100
        // keeps its TOP ~y=-2.9, just under the plane (ships fly over it — no collision handling). See DECISIONS §39.
        {
          type: 'base-station', pos: [-20, -42, -20], scale: 1.0, spin: 0.03, // offset up-left of the arena center (screen top-left = -z/-x)
          modelUrl: 'assets/ships/base_station_combat.529dee5e.glb',
          yaw: 0, // a station has no "nose"; 0 reads fine top-down
        },
      ],
    }
  },
];
