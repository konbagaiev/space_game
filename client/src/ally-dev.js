// ?ally — DEV ONLY: fly the Sentinel wingman locally.
//
// TWO PARAMS, AND THEY COMPOSE. `?ally` names the PHASE he arrives on; the existing **`level`** param names
// the LEVEL to fly — the same param, and the same `normalizeLevelName` mapping, that `?record=1&level=<id>`
// already uses (`replay.js`). A third convention was deliberately not invented.
//
//   ?ally                     the default phase ('clear-out'), on whatever level this tab was going to fly
//   ?ally=wave-1              that phase instead
//   ?ally&level=4             the default phase, on Level 4 — regardless of the account's progress
//   ?ally=wave-1&level=4      both
//   ?ally=0 | ?ally=false     off (and no `ally` param at all is off)
//
// **Why the level half exists.** Without it the flag injects into whatever level the account happens to be
// on, and Level 3 and Level 4 have IDENTICAL phase names (`wave-1`/`wave-2`/`clear-out`/`boss`/`victory`) —
// so a test flight aimed at Level 4 silently landed on Level 3 and nobody could tell from the URL. A dev
// flag whose effect depends on campaign progress is a trap; naming the level makes a test flight
// reproducible without grinding to it.
//
// It injects the REAL arrival mechanism (a phase's `ally: true`) rather than spawning him itself, so what is
// being tested locally is exactly what Level 5 will ship. A phase name the level does not carry changes
// nothing at all.
//
// NOT STICKY, ANYWHERE (the §81 rule `dev.js` follows): the URL alone decides, nothing is stored, and with
// the flag absent the simulation has no ally, runs no ally step, draws no extra randomness and produces a
// byte-identical world (DECISIONS §73).
//
// TWO CAVEATS WORTH KNOWING, both inherent to it being a dev flag:
//   • `?ally` changes the FIGHT, and campaign sessions are recorded. A session played with it on contains an
//     entity the level descriptor on the SERVER does not produce, so `server/tools/sim-replay.mjs` and
//     `server/tools/verify-sessions.mjs` re-simulate it into a divergence and file it under "disagree".
//     Expected, not a bug: it is a dev session, not evidence about the build.
//   • `&level=` forces the level THIS TAB FLIES, not the account's progress. Winning it still advances the
//     account the server-side way (`/advance` reads the player's own row), and after that advance the tab
//     follows the account again — the phase injection keeps applying, the forced level does not. Prefer
//     `?ally` runs on a throwaway local player.
import { withAllyAt, DEV_ALLY_DEFAULT_PHASE } from './sim-core/ally-config.js';
import { normalizeLevelName } from './replay.js';

// Pure + storage-free, so it is unit-testable without a DOM: the URL alone decides.
// Returns `{ phase, level }` or null. `phase`: bare `?ally` / `?ally=true` / `?ally=1` → the default phase,
// `?ally=<name>` → that phase. `level`: the normalized seed name when a `level` param is present, else null
// meaning "whatever level this tab was going to fly anyway".
export function evalAllyDev(search) {
  const p = new URLSearchParams(search || '');
  const v = p.get('ally');
  if (v == null) return null;
  if (v === '0' || v === 'false' || v === 'off') return null;
  const phase = (v === '' || v === 'true' || v === '1') ? DEV_ALLY_DEFAULT_PHASE : v;
  // Only when the param is actually there: `normalizeLevelName(null)` is 'level-0', which would silently
  // drag every bare `?ally` run back to the intro level.
  const level = p.has('level') ? normalizeLevelName(p.get('level')) : null;
  return { phase, level };
}

const ALLY_DEV = evalAllyDev(typeof location !== 'undefined' ? location.search : '');

// The flag for this page load, or null.
export function allyDev() { return ALLY_DEV; }

// The level `?ally&level=…` forces, or null to follow the account/trace as usual. Read once at bootstrap,
// where the level descriptor is fetched.
export function allyDevLevel() { return ALLY_DEV && ALLY_DEV.level; }

// Wrap a level descriptor on its way into the catalog. A no-op with the flag off — the SAME object comes
// back out, so nothing about a normal run changes.
export function applyAllyDev(descriptor) {
  return ALLY_DEV ? withAllyAt(descriptor, ALLY_DEV.phase) : descriptor;
}
