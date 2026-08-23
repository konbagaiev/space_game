// A World is one running fight: its entities, its event queue, and the host that gives its entities a body.
//
// Why this exists at all: `client/src/state.js` cannot be imported in Node — its module body reads
// `window.localStorage` through the graphics tier. So the simulation can never reach the module-level
// collections it grew up on, and the collections have to arrive as an argument instead. That is not
// architectural taste; it is the shape the packaging forces (DECISIONS §116-118, and
// docs/plans/server-authoritative-sim.md D2).
//
// One process can therefore hold many Worlds — which is what a server needs — while the browser simply
// creates one and hands its collections back out through `state.js`, so client code that reads `enemies`
// or `bullets` never learns anything changed.
//
// THE HOST. A bullet in the browser needs a mesh in the scene; the same bullet on a server needs nothing
// at all. The simulation must not know which it is talking to, so it announces lifecycle instead:
// `world.host.onSpawn(kind, entity)` when it creates something, `world.host.onDespawn(kind, entity)` when
// it destroys it. The browser host attaches and disposes Three.js objects; the Node host is `noopHost`
// below and does nothing. `kind` is one of 'enemy' | 'ally' | 'bullet' | 'rocket' | 'drop'.
//
// WHAT THE WORLD HOLDS, beyond the obvious: `enemies` and `allies` are the two combatant lists that are
// not the player. The fight is three-sided in TARGETING — an enemy steers, aims and homes at the nearer of
// player-or-ally — and two-sided in DAMAGE ROUTING, because friendly fire is off in both directions
// (DECISIONS §134). `allies` is empty in every shipped level; the wingman arrives only when a level PHASE
// carries `ally: true`. `allyKills` is a maintainer's readout of his share of the run and is deliberately
// in neither the digest nor the summary.
//
// Note this is deliberately NOT the event queue. Events describe things that HAPPENED, are copied, and are
// drained in a batch at end of tick; the host is a lifecycle callback that has to run at the exact moment
// the entity appears or disappears, because a mesh must exist before the next render and must be disposed
// before the entity reference is dropped.
import { createEventQueue } from './events.js';
import { createLevelRunnerState } from './level-runner.js';
import { Vec3 } from './vec.js';

// A host that gives entities no body — the authority, the headless referee, and every unit test.
// The host also answers `onWarmLevel(level)`: "this level is about to be fought, get ready". In a browser
// that means fetching and parsing the .glb of every ship the level can spawn plus its reward drop, so no
// spawn pays for a download mid-fight. On a server it means nothing at all — which is exactly why the
// simulation asks rather than doing it.
export const noopHost = { onSpawn() {}, onDespawn() {}, onWarmLevel() {} };

export function createWorld({ host = noopHost } = {}) {
  return {
    host,
    events: createEventQueue(),

    // --- entities ---
    player: null,      // set by the host once the ship is built (ship-build.buildPlayer)
    enemies: [],
    // The friendly ships this fight has that are NOT the player. At most one today (the Sentinel wingman,
    // docs/plans/combat-ally.md); an ARRAY because every consumer — the digest, the netsim ghost map, the
    // HUD bars, the minimap — is list-shaped already. Empty in every shipped level: the ally arrives only
    // when a level PHASE asks for him.
    allies: [],
    bullets: [],
    rockets: [],
    drops: [],
    pendingLoot: [],   // items collected this run — deposited into the stash on VICTORY only

    // --- where this run is being fought ---
    // The combat zone's centre. A mission may drift it (the freighter escort), and the soft boundary,
    // warp-back and mini-map are all measured from it — so it is simulation state, not scenery.
    arenaCenter: new Vec3(),
    arenaDrift: null,  // { x, z } world units per second, or null for a static map

    // The home station: { pos, active, obj? }. `pos` is what the simulation needs (docking distance
    // decides the mission win); `active` is whether it can be clicked right now, which the sim also owns
    // because it turns on with the return-to-base gate. `obj` is the host's mesh and is simply absent on a
    // server. Static — set once when the map's base-station set-piece is built.
    station: null,

    // --- run state: what this fight has done so far ---
    kills: 0,               // destroyed enemies this run (drives the level runner's thresholds + HUD)
    enemyTotal: 0,          // total enemies this level/mission (0 = unknown → the HUD hides the /total)
    earned: 0,              // credits earned this run: each kill adds the ship's `reward`; doubled on victory
    earnedXp: 0,            // character experience this run: each kill adds the ship's `xp`; + a mission bonus on victory
    banked: false,          // guard so a run banks its credits exactly once
    combatElapsed: 0,       // seconds of UNPAUSED combat since run start; gates the enemy hold-fire grace
    enemyShieldRefills: 0,  // diagnostic: enemy shields that completed a refill this run (replay-desync triage)
    // DIAGNOSTIC ONLY — how many of this run's kills the ALLY took. It exists to answer the one question
    // the dev flag is for: "is the wingman stealing the fight?" (docs/plans/combat-ally.md §3). Read off
    // `window.__game.allyKills`; deliberately NOT in the digest or the summary, and nothing gameplay
    // reads it.
    allyKills: 0,

    // --- what kind of run this is ---
    activeMission: null,    // the side mission being played (null = the campaign level)
    roam: false,            // free flight: world up, no levelRunner, no enemies
    returnToBase: false,    // true after the last kill: OOB lifted, arrow + hint on, station clickable
    replayMode: false,      // ?record/?playback dev session → the run must NOT mutate the server
    missionZone: null,      // the armed fly-into-it zone + its live countdown (roam → campaign handover)
    autopilot: { active: false, phase: 'brake0', target: null },
    // Where click-to-fly COMMANDS go. Null = this World simulates them itself (single-player). A netsim
    // client sets it, because the autopilot belongs to the room: setting it locally would be talking to a
    // World nobody steps. Deliberately not the event queue — events describe what HAPPENED; this is an
    // intent travelling the other way, from the player toward whoever is simulating.
    onCommand: null,
    // Did the current run begin WITHOUT moving the ship (a mission entered by flying into it)? Read by the
    // netsim client, which has to tell the room; irrelevant in single-player, where reset() acts directly.
    runKeepPlayer: false,
    // The player's active-ship record { ship, loadout, components, progression, … }. The simulation needs
    // it to decide whether the last-kill reward drop should appear at all (you never get a second copy).
    activeShip: null,
    // Milestone banners already shown this run ('final', 10, 5) — each fires once. Cleared on reset.
    firedBanners: new Set(),

    // The level script's position in its own run: which phase, what it has spawned, whether it is won.
    // The functions that read and advance it live in level-runner.js.
    levelRunner: createLevelRunnerState(),

    // Input for THIS tick: { keys, touchAim } in the shape replay.js already records and replays. The
    // browser points this at its live keyboard/touch objects; a server replaces it per tick with what the
    // client sent. Either way the simulation only ever reads it.
    input: { keys: {}, touchAim: { active: false, heading: 0, thrust: 0 } },
  };
}
