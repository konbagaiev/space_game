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
import { makeClientId } from './client-id.js';
import { createWorld } from './sim-core/world.js';
import { SPAWN_GROW_TIME, BULLET_PLANE_Y } from './sim-core/consts.js';

// Mutable state bag: scalars that get reassigned AND read across module boundaries live here
// (an exported `let` can't be reassigned from an importing module — a property on a shared
// `const` object can). Write `G.x = …`; read `G.x`. Scalars are promoted onto G as the domains
// that own them are split out — start with what the engine needs at construction.
export const G = {
  gfx: resolveTier(loadTier(window.localStorage, Device.hasTouch)), // current graphics quality knobs (tier switch reloads the page)
  rotated: false,                                               // portrait-phone 90° rotation currently active
  // The active player ship. It LIVES on the World (sim-core/world.js) — the simulation needs it and cannot
  // reach this file in Node — but every call site says `G.player`, so this proxies rather than duplicates.
  get player() { return world.player; },
  set player(p) { world.player = p; },
  // --- world (built/reassigned by buildMap in world.js; read by the loop + ?tune panel + reset) ---
  sky: null,                  // THREE.Group (at the world origin) holding the star + planets + moons (sky scene)
  systemBodies: null,         // [{ mesh, name, spec, dir, moons, isStar }] — fixed-position star-system bodies
  stars: null,                // THREE.Group starfield (follows the camera in the loop)
  skyAmbient: null,           // sky-scene ambient light (mutated live by the ?tune panel)
  skySun: null,               // sky-scene directional light (the terminator source)
  currentMapDescriptor: null, // last descriptor passed to buildMap() (?tune "Rebuild" button)
  nebulaRT: null,             // WebGLCubeRenderTarget of the baked nebula sky (disposed + rebuilt by buildMap); null on the flat-color (Performance/?debug) path
  mapSetpieces: [],           // the current map's set-piece specs (reset() rebuilds them fresh each run)
  // (arenaDrift moved onto the World — it is simulation state; see sim-core/world.js)
  // --- run/account scalars (read by the HUD; written by the loop, level runner, bank + account flows) ---
  needsSceneWarm: false,      // set by sim.reset(): the render loop compiles/uploads the freshly built level once
  // Essential .glb loads still in flight (ship models + set-pieces). The level-load veil stays up while
  // this is > 0, so a player never starts a fight looking at procedural placeholder cones (DECISIONS §84).
  pendingAssets: 0,
  balance: 0,                 // persistent account balance (loaded from the server; banked at run end)
  // --- backend identity + per-session funnel guards (read across net/sim/UI; reassigned by login/reset/advance) ---
  // Anonymous player id kept in localStorage (auto-register). `let`-style reassignment (an account login
  // adopts the account's row) is why it lives on G. Best-effort: null if storage is blocked.
  playerId: (() => {
    try {
      let id = localStorage.getItem('playerId');
      if (!id) { id = makeClientId(); localStorage.setItem('playerId', id); } // NOT crypto.randomUUID() — that's secure-context-only (breaks over http://<ip>)
      return id;
    } catch { return null; }
  })(),
                              //   (no unlockNextLevel/bankRun/depositLoot/funnel on a replayed win). Set in main.js.
  gameStartTime: performance.now(), // run start (for the recorded game duration)
  gameStartSent: false,       // game_start funnel event fires once per page-load session (the funnel's top)
  quitSent: false,            // quit funnel event fires once per session when the player leaves
  pendingBriefing: null,      // a level briefing to show before the next Restart (set on advance)
  // --- player ship selection / loadout (read across welcome/shop/account/net/sim) ---
  currentShipName: null,      // name of the ship currently built into the scene
  // --- run lifecycle (read across sim/UI; written by reset/take-off/pause) ---
  gameStarted: false,         // false on the welcome screen (backdrop renders, but the level isn't running)
  paused: false,              // client-side freeze: the sim update is skipped while true (rendering continues)
  // --- star-system roam / navigation (docs/plans/2026-08-09-1456-star-system-map.md) ---
  mapOpen: false,             // the system-map overlay is open → the render loop skips update() (raw freeze,
                              //   NOT setPaused, so the "Paused" overlay doesn't stack under the map)
  onMissionArrival: null,     // callback(missionId) set by mainwindow: show the "Start mission?" prompt on arrival
  onMissionZoneEnter: null,   // callback() set by mainwindow: clear roam + launch the campaign level
  // The active mission's place in the system while roaming: { pos:{x,z}, missionId } or null. Set by
  // enterRoam (objectForActiveMission). Drives the roam HUD — the gold off-screen mission pointer and the
  // bottom-center "Autopilot to Mission" button; both hide when it is null (no active mission target).
  roamMission: null,
  // --- return-to-base / autopilot (set after the last kill; read across sim/HUD/input) ---
  // click-to-fly autopilot. target = the base station (return-to-base dock) OR a loot drop (fly to grab it).
  // active + target.kind==='station' is the mandatory "dock" gate (only the station target can win the mission).
  // The home station — lives on the World (docking decides the mission win), reached under its old name.
  get baseStation() { return world.station; },
  set baseStation(s) { world.station = s; },
  // transient centered HUD announcement ("10 enemies left", "Final Stage"): appears at full opacity and
  // fades to 0 over `maxLife` seconds. opacity = life/maxLife; hidden once life hits 0 (see updateBanner).
  banner: { text: '', life: 0, maxLife: 0 },
};

// --- Projectiles & FX pools (filled/drained by the spawn + update code) ---
// THE World for this browser tab: one running fight, owning its entities and its event queue
// (sim-core/world.js). It exists because the simulation can no longer reach module singletons — sim-core
// must load in Node, where this file cannot. Its collections are re-exported below under their historical
// names, so every client module that reads `enemies`/`bullets`/`rockets`/`drops` is unchanged; the browser
// host (which gives entities their Three.js bodies) is installed by sim.js at boot.
export const world = createWorld();
export const { enemies, bullets, rockets, drops } = world;
// The sim's outbound channel for this world — see sim-core/events.js and the adapter in sim.js.
export const simEvents = world.events;

export const explosions = [];
export const sparks = [];
export const shockwaves = [];
export const creditPopups = []; // floating "+xx" credit-gain popups at enemy death { pos, amount, life, maxLife }
export const smoke = [];    // rocket smoke trails
export const flipbooks = []; // sprite-sheet explosion quads (flipbook-fx.js) { mesh, mat, frame, fps }

// --- Combatants ---

// --- Per-map decor ---
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
  levelName: null,       // the active level's SEED NAME (level-N) — the trace level for session recording
};

// The World resolves ship/weapon/component rows through this same catalog object — sim-core cannot import
// `state.js` (Node), so the data has to hang off the World rather than be reached for.
world.catalog = CATALOG;

// --- Gameplay constants ---
// These decide gameplay, so they live in sim-core (the authority needs them and cannot import this file);
// re-exported here under their historical names so existing importers are unchanged.
//
// BULLET_PLANE_Y is the single canonical combat plane. INVARIANT: every ship's group sits at this world Y,
// and because muzzle/exhaust spawn from the ship's position + a PLANAR (y=0) forward/right vector, ALL
// bullets — player and enemy, every model — fly in exactly this horizontal plane. Ships are top-down, so
// gameplay is 2D at this height; a model whose hull sits off this plane is corrected with
// `stats.model.lift` (raises the visual mesh AND its hitboxes onto the plane — see sim-core/ship-config.js),
// NOT by moving the bullets. Anything that must line up with combat (ship spawn/recenter Y, hit-ring FX)
// references THIS, never a bare 0.6.
export { SPAWN_GROW_TIME, BULLET_PLANE_Y };

// --- Input state ---
export const keys = {};                                          // KeyboardEvent.code -> bool
export const touchAim = { active: false, heading: 0, thrust: 0 }; // touch stick: nose heading + thrust magnitude

// The World reads its input through here rather than importing this file (it cannot, in Node). Same
// objects, so every existing writer — the keydown handlers, the touch stick, replay playback — is
// unchanged; a server would instead swap in the per-tick snapshot a client sent it.
world.input = { keys, touchAim };

// RUN STATE lives on the World — the simulation owns it and cannot reach this file in Node — but every
// call site in the client says `G.kills`, `G.roam`, `G.autopilot`… so reach it under those names instead of
// keeping a second copy in sync. Notes worth carrying over from where these used to be declared:
//   roam        — free flight; NEVER true during a recorded/campaign fight, so capLifted() is false there
//                 and replays stay byte-identical.
//   missionZone — the fly-into-it start for the ACTIVE campaign mission while roaming:
//                 { center:{x,z}, title, t } or null. Armed by mainwindow.enterRoam only when the campaign
//                 is the active choice and its level names a `center`; `t` is the live countdown, stepped by
//                 sim.js checkMissionZone, which calls onMissionZoneEnter when it runs out.
for (const k of ['kills', 'enemyTotal', 'earned', 'earnedXp', 'banked', 'combatElapsed', 'enemyShieldRefills',
                 'activeMission', 'roam', 'returnToBase', 'replayMode', 'missionZone', 'autopilot',
                 'activeShip']) {
  Object.defineProperty(G, k, {
    get: () => world[k],
    set: (v) => { world[k] = v; },
    enumerable: true,
    configurable: true,
  });
}
