// ?duel — DEV ONLY: the sparring room. You, a starter gun and a repair drone, against N ships flying the
// Sentinel wingman's own pilot code.
//
//   ?duel                     two aces (the default), on Level 1's map
//   ?duel=3                   three of them (clamped to ACE_COUNT_MAX)
//   ?duel&level=4             the same room, built over that level instead
//   ?duel=0 | ?duel=false     off (and no `duel` param at all is off)
//
// WHAT IT ACTUALLY DOES, in three separate places, each a strict no-op with the flag off:
//   1. the LEVEL — `applyDuelDev` throws the fetched descriptor's phase script away and puts back a single
//      phase carrying `aces: N` plus the usual `event: 'win'` phase. It keeps the level's map and combat
//      centre, so the room is fought in a real place with real scenery;
//   2. the SHIP — `duelBuild` forces the player's loadout and components (the starter kinetic + the basic
//      Repair drone) and clears `skills`, so the duel is the same fight whatever the account has equipped
//      or trained (see the skills caveat below — it decides whether a fleeing ace can be caught);
//   3. the LAUNCH — `mainwindow.js takeOff` drops you straight into the fight instead of into roam. A
//      sparring room you have to fly to is a sparring room you stop using.
//
// WHY IT FORCES A LEVEL BY DEFAULT (`level-1`), where `?ally` follows the account: the room replaces the
// phase script wholesale, and Level 0 is the playable intro — its director speaks timed lines against a
// phase script that would no longer be there. Level 1 is the plainest real combat level, so it is the base
// unless `&level=` says otherwise (same param, same normalization, as `?record` and `?ally`).
//
// NOT STICKY (DECISIONS §81): the URL alone decides, nothing is stored, and with the flag absent the
// simulation spawns no ace, runs no ace step and draws no extra randomness.
//
// CAVEATS, all inherited from being a dev flag:
//   • it changes the FIGHT, and campaign sessions are recorded — so a `?duel` session's row is labelled
//     `duel:level-N` (server.js POST /api/sessions), which makes `classifyTrace` report `level-mismatch`
//     and the campaign survey (`server/tools/verify-sessions.mjs`) count it as `unverifiable` rather than
//     re-simulating it into a false disagreement. A duel is not a campaign run and must not pollute that
//     survey; it is judged on its OWN terms by the duel referee, whose verdict is the `verdict` column on
//     /admin/sessions (docs/plans/2026-09-01-1845-duel-referee.md).
//   • an ace pays no credits and no XP, but its death still rolls the normal 20 % loot drop, which is
//     deposited on victory. Fly the room on a throwaway local player.
//   • YOU HAVE NO SKILLS IN HERE, and one consequence is worth stating outright. `duelBuild` passes
//     `skills: null` (see it below) so the room is the same fight whatever the account has trained — which
//     also means no Mobility (+5 %/pt max speed), no dodge and no damage talents. Both hulls therefore sit
//     on exactly `PLAYER_MAX_SPEED`, so **you can neither out-run nor catch a pilot flying the same hull**.
//     It bites on the ace's RETREAT: that runs at full thrust for the arena border and keeps full thrust
//     past it while the pursuer holds the gap under ~68 u (step-ally.js 4a, DECISIONS §154), so chasing a
//     fleeing ace is unwinnable on speed BY CONSTRUCTION and ends only when your own out-of-bounds rule
//     warps you back to the arena centre after `OOB_RETURN_TIME` 30 s. This is deliberate and is a property
//     of this room alone: in a campaign fight your Mobility does apply, so a chase there is not symmetric.
import { ACE_COUNT_DEFAULT, ACE_COUNT_MAX } from './sim-core/ace.js';
import { normalizeLevelName } from './replay.js';
import { DUEL_PHASES, withDuelRoom } from './sim-core/duel-config.js';

// Moved to sim-core so the SERVER can rebuild a duel from a recorded trace (the headless referee and a
// netsim room build the fight from the same module the tab does). Re-exported here because this file is
// still the one place the ?duel flag is described, and every existing importer reads them from it.
export { DUEL_PHASES, withDuelRoom };

// The level `?duel` builds the room over when `&level=` is absent. Level 0 is the playable intro and its
// director is timed against a phase script this flag deletes — see the header.
export const DUEL_DEFAULT_LEVEL = 'level-1';

// The forced ship: the starter kinetic in the gun group and the basic Repair drone in the repair slot, over
// the Basic player ship's own hull/engine/thrusters/shield/grab. Catalog ids, matching `catalog_seed.js`:
// weapon 1 = Basic kinetic, weapon 3 = Rocket (homing), component 12 = Repair drone.
//
// THE ROCKET IS KEPT because it is the starter ship's own second mount, and the aces carry one — dropping
// it would make the duel asymmetric in a way nobody asked for. One line to delete if the maintainer wants
// a gun-only room.
export const DUEL_LOADOUT = { mounts: [
  { weapon: 1, group: 'gun', offset: 0, delay: 0 },
  { weapon: 3, group: 'rocket', offset: 0, delay: 0 },
] };
export const DUEL_COMPONENTS = { hull: 1, engine: 5, thruster: 8, repair: 12, grab: 29, shield: 31 };

// Pure + storage-free, so it is unit-testable without a DOM: the URL alone decides.
// Returns `{ count, level }` or null.
export function evalDuelDev(search) {
  const p = new URLSearchParams(search || '');
  const v = p.get('duel');
  if (v == null) return null;
  if (v === '0' || v === 'false' || v === 'off') return null;
  const n = Number.parseInt(v, 10);
  const count = Number.isFinite(n) && n > 0 ? Math.min(ACE_COUNT_MAX, n) : ACE_COUNT_DEFAULT;
  const level = p.has('level') ? normalizeLevelName(p.get('level')) : DUEL_DEFAULT_LEVEL;
  return { count, level };
}

const DUEL_DEV = evalDuelDev(typeof location !== 'undefined' ? location.search : '');

// The flag for this page load, or null.
export function duelDev() { return DUEL_DEV; }

// The level the room is built over, or null with the flag off. Read at bootstrap, where the level
// descriptor is fetched.
export function duelDevLevel() { return DUEL_DEV && DUEL_DEV.level; }

// Wrap a level descriptor on its way into the catalog. A no-op with the flag off — the SAME object comes
// back out, so nothing about a normal run changes.
//
// KEPT from the level it is built over: `map` and `center` (the room is fought in a real place, with the
// level's own scenery). REPLACED: the phases and the enemy total. DROPPED: `briefing`, `lastKillDrop`,
// `introTrace`, `intro` and `xpReward` — every one of them is a promise about a campaign level this is not.
export function applyDuelDev(descriptor) {
  return DUEL_DEV ? withDuelRoom(descriptor, DUEL_DEV.count) : descriptor;
}

// ?playback of a DUEL trace: the URL carries no ?duel, so rebuild the room from the recording itself.
// Without this the admin "▶ play" link on a duel row replays the plain base level and shows a different
// fight — which is exactly the row a maintainer clicks when investigating a `disagree`.
export function applyTraceRoom(descriptor, trace) {
  const room = trace && trace.room;
  return (room && room.kind === 'duel') ? withDuelRoom(descriptor, room.aces) : descriptor;
}

// Force the player's ship. A no-op with the flag off — the SAME object comes back out, so `buildPlayerFor`
// is unchanged for every normal build. Skills are dropped on purpose: the duel is about the flying, and a
// skilled account would be sparring against an unskilled ace.
//
// `skills: null` IS WHY A FLEEING ACE CANNOT BE CAUGHT IN HERE, and the chain is intact rather than broken:
// `skills.mobility` → `mobilityMul = 1 + 0.05·pts` (`components.js`) → `p.maxSpeedMul` (`ship-entity.js`) →
// `PLAYER_MAX_SPEED × maxSpeedMul` (`step-player.js`). It is simply fed `null` here, so both hulls sit on
// exactly 30 u/s. See the skills caveat in the header for what that means for the retreat.
export function duelBuild(build) {
  if (!DUEL_DEV) return build;
  return { ...build, loadout: DUEL_LOADOUT, components: DUEL_COMPONENTS, skills: null };
}
