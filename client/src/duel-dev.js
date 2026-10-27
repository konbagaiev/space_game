// ?duel — DEV ONLY: the sparring room. You, a starter gun and a repair drone, against N ships flying the
// Sentinel wingman's own pilot code.
//
//   ?duel                     two aces (the default), on Level 1's map
//   ?duel=3                   three of them (clamped to ACE_COUNT_MAX)
//   ?duel&level=4             the same room, built over that level instead
//   ?duel=0 | ?duel=false     off (and no `duel` param at all is off)
//
// WHAT IT ACTUALLY DOES, in three places, each a strict no-op with the flag off. The first two are not
// written here: the flag is one field of the FIGHT SPEC (`fight-spec-dev.js`), and every host applies the spec
// through the same two sim-core functions (`sim-core/fight-spec.js`):
//   1. the LEVEL — `applyFightSpec` (→ `withDuelRoom`) throws the fetched descriptor's phase script away and
//      puts back a single phase carrying `aces: N` plus the usual `event: 'win'` phase. It keeps the level's
//      map and combat centre, so the room is fought in a real place with real scenery;
//   2. the SHIP — `resolvePlayerBuild` (→ `withDuelKit`) forces the player's loadout and components (the
//      starter kinetic + the basic Repair drone) and clears `skills`, so the duel is the same fight whatever
//      the account has equipped or trained (see the skills caveat below — it decides whether a fleeing ace can
//      be caught). A netsim ROOM applies both too: `?duel` is forwarded on the handshake as `duel=<aces>`;
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
//   • it changes the FIGHT, and campaign sessions are recorded — so the session's trace carries the room
//     (`trace.room = { kind:'duel', aces:N }`, plus any `ally`/`lancer`/`beam` riding along) and its row is
//     labelled `duel:level-N` (server.js POST /api/sessions), which makes `classifyTrace` report `level-mismatch`
//     and the campaign survey (`server/tools/verify-sessions.mjs`) count it as `unverifiable` rather than
//     re-simulating it into a false disagreement. A duel is not a campaign run and must not pollute that
//     survey; it is judged on its OWN terms by the duel referee, whose verdict is the `verdict` column on
//     /admin/sessions (docs/plans/2026-09-01-1845-duel-referee.md).
//   • an ace pays no credits and no XP, but its death still rolls the normal 20 % loot drop, which is
//     deposited on victory. Fly the room on a throwaway local player.
//   • YOU HAVE NO SKILLS IN HERE, and one consequence is worth stating outright. `withDuelKit` passes
//     `skills: null` (`sim-core/duel-config.js`) so the room is the same fight whatever the account has trained — which
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
// still the one place the ?duel flag is described. The forced kit (`DUEL_LOADOUT`/`DUEL_COMPONENTS`/
// `withDuelKit`) lives there too — import it from `sim-core/duel-config.js`.
export { DUEL_PHASES, withDuelRoom };

// The level `?duel` builds the room over when `&level=` is absent. Level 0 is the playable intro and its
// director is timed against a phase script this flag deletes — see the header.
export const DUEL_DEFAULT_LEVEL = 'level-1';

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
