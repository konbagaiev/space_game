// Shared game state: entity collections + catalog + input, exported as `const`.
//
// Native-ESM rule that dictates the pattern: an exported `const` array/object/Map is
// shared BY REFERENCE across modules — mutating its contents (push/splice/set/clear,
// or assigning its properties) is visible everywhere. So every module reaches the
// SAME live collection here. Never reassign these bindings; mutate their contents.
//
// (Reassigned scalars can't live here as plain `const`/`let` — they go in the mutable
// state bag G below, introduced as the domains that own them are split out.)
import { loadTier, resolveTier } from './graphics.js';
import { Device } from './device.js';

// Mutable state bag: scalars that get reassigned AND read across module boundaries live here
// (an exported `let` can't be reassigned from an importing module — a property on a shared
// `const` object can). Write `G.x = …`; read `G.x`. Scalars are promoted onto G as the domains
// that own them are split out — start with what the engine needs at construction.
export const G = {
  gfx: resolveTier(loadTier(window.localStorage, Device.hasTouch)), // current graphics quality knobs (tier switch reloads the page)
  rotated: false,                                               // portrait-phone 90° rotation currently active
  player: null,                                                 // the active player ship (built by buildPlayer in bootstrap/takeoff)
  // --- world (built/reassigned by buildMap in world.js; read by the loop + ?tune panel + reset) ---
  sky: null,                  // THREE.Group holding the planet + moons (sky scene)
  stars: null,                // THREE.Group starfield (follows the camera in the loop)
  skyAmbient: null,           // sky-scene ambient light (mutated live by the ?tune panel)
  skySun: null,               // sky-scene directional light (the terminator source)
  currentMapDescriptor: null, // last descriptor passed to buildMap() (?tune "Rebuild" button)
  nebulaRT: null,             // WebGLCubeRenderTarget of the baked nebula sky (disposed + rebuilt by buildMap); null on the flat-color (Performance/?debug) path
  mapSetpieces: [],           // the current map's set-piece specs (reset() rebuilds them fresh each run)
  arenaDrift: null,           // THREE.Vector3 (units/sec on x,z) when the current map drifts, else null
  // --- run/account scalars (read by the HUD; written by the loop, level runner, bank + account flows) ---
  kills: 0,                   // destroyed enemies this run (drives the level runner's thresholds + HUD)
  enemyTotal: 0,              // total enemies this level/mission (from descriptor.enemyTotal; 0 = unknown -> HUD hides the /total)
  earned: 0,                  // credits earned this run: each kill adds the ship's `reward`; doubled on level completion
  balance: 0,                 // persistent account balance (loaded from the server; banked at run end)
  // --- backend identity + per-session funnel guards (read across net/sim/UI; reassigned by login/reset/advance) ---
  // Anonymous player id kept in localStorage (auto-register). `let`-style reassignment (an account login
  // adopts the account's row) is why it lives on G. Best-effort: null if storage is blocked.
  playerId: (() => {
    try {
      let id = localStorage.getItem('playerId');
      if (!id) { id = crypto.randomUUID(); localStorage.setItem('playerId', id); }
      return id;
    } catch { return null; }
  })(),
  banked: false,              // guard so a run banks its credits exactly once
  gameStartTime: performance.now(), // run start (for the recorded game duration)
  gameStartSent: false,       // game_start funnel event fires once per page-load session (the funnel's top)
  quitSent: false,            // quit funnel event fires once per session when the player leaves
  pendingBriefing: null,      // a level briefing to show before the next Restart (set on advance)
  // --- player ship selection / loadout (read across welcome/shop/account/net/sim) ---
  activeShip: null,           // the player's active-ship record { ship, loadout, components, ... }
  currentShipName: null,      // name of the ship currently built into the scene
  activeMission: null,        // the side mission being played (null = the campaign level)
  // --- run lifecycle (read across sim/UI; written by reset/take-off/pause) ---
  gameStarted: false,         // false on the welcome screen (backdrop renders, but the level isn't running)
  paused: false,              // client-side freeze: the sim update is skipped while true (rendering continues)
  // --- return-to-base / autopilot (set after the last kill; read across sim/HUD/input) ---
  returnToBase: false,                             // true after the last kill: OOB lifted, arrow + hint on, station clickable
  // click-to-fly autopilot. target = the base station (return-to-base dock) OR a loot drop (fly to grab it).
  // active + target.kind==='station' is the mandatory "dock" gate (only the station target can win the mission).
  autopilot: { active: false, phase: 'brake0', target: null },
  baseStation: null,                               // { obj, active } — set by buildSetPiece; .active = clickable this run
};

// --- Projectiles & FX pools (filled/drained by the spawn + update code) ---
export const bullets = [];
export const explosions = [];
export const sparks = [];
export const shockwaves = [];
export const creditPopups = []; // floating "+xx" credit-gain popups at enemy death { pos, amount, life, maxLife }
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

// --- Gameplay constants ---
export const SPAWN_GROW_TIME = 1.0; // ships grow from a dot to full size over this many seconds (warp-in)

// --- Input state ---
export const keys = {};                                          // KeyboardEvent.code -> bool
export const touchAim = { active: false, heading: 0, thrust: 0 }; // touch stick: nose heading + thrust magnitude
