// Shared game state: entity collections + catalog + input, exported as `const`.
//
// Native-ESM rule that dictates the pattern: an exported `const` array/object/Map is
// shared BY REFERENCE across modules — mutating its contents (push/splice/set/clear,
// or assigning its properties) is visible everywhere. So every module reaches the
// SAME live collection here. Never reassign these bindings; mutate their contents.
//
// (Reassigned scalars can't live here as plain `const`/`let` — they go in a mutable
// state bag instead, introduced as the domains that own them are split out.)

// --- Projectiles & FX pools (filled/drained by the spawn + update code) ---
export const bullets = [];
export const explosions = [];
export const sparks = [];
export const shockwaves = [];
export const trail = [];   // engine exhaust puffs
export const rockets = [];
export const smoke = [];    // rocket smoke trails

// --- Combatants ---
export const enemies = [];

// --- Per-map decor ---
export const moons = [];     // sky-scene moons, built by buildMap()
export const setPieces = []; // combat-scene set-pieces { obj, update } — decor, ignored by gameplay

// --- Sound routing ---
// 'entity|class|event' -> [sound keys] (several = e.g. random music tracks). Filled in bootstrap from /api/sounds.
export const soundMap = new Map();

// --- Catalog (DB-sourced; filled in bootstrap) ---
export const CATALOG = {
  weapons: new Map(),    // id -> { id, name, type, ...stats }
  components: new Map(), // id -> { id, name, type, weight, ...stats }  (hulls + engines)
  enemyShips: [],        // DB ship rows with type 'enemy' (used by spawnEnemy(role) / tests)
  shipByName: new Map(), // name -> ship row (any type; the level's spawn pools reference these)
  level: null,           // the active level descriptor (phase/wave script)
};

// --- Input state ---
export const keys = {};                                          // KeyboardEvent.code -> bool
export const touchAim = { active: false, heading: 0, thrust: 0 }; // touch stick: nose heading + thrust magnitude
