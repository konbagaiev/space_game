// ?ally — DEV ONLY: inject the ally's arrival into the level this tab is about to fly.
//
// It injects the REAL mechanism (a phase's `ally: true`) rather than spawning him itself, so what is being
// tested locally is exactly what Level 5 will ship. Bare `?ally` uses DEV_ALLY_DEFAULT_PHASE ('clear-out'
// on Level 4 — the deterministic wave before the boss); `?ally=wave-1` names another phase. A phase name
// the level does not carry changes nothing.
//
// NOT STICKY, ANYWHERE (the §81 rule `dev.js` follows): the URL alone decides, nothing is stored, and with
// the flag absent the simulation has no ally, runs no ally step, draws no extra randomness and produces a
// byte-identical world (DECISIONS §73).
//
// ONE CAVEAT WORTH KNOWING: `?ally` changes the FIGHT, and campaign sessions are recorded. Every campaign
// run is uploaded as a replay, and a session played with this flag on contains an entity the level
// descriptor on the SERVER does not produce — so `server/tools/sim-replay.mjs` and
// `server/tools/verify-sessions.mjs` will re-simulate it into a divergence and file it under "disagree".
// That is expected, not a bug: it is a dev session, not evidence about the build. Prefer `?ally` runs on a
// throwaway local player.
import { withAllyAt, DEV_ALLY_DEFAULT_PHASE } from './sim-core/ally-config.js';

// Pure + storage-free, so it is unit-testable without a DOM: the URL alone decides.
// Returns `{ phase }` or null. `?ally` / `?ally=true` / `?ally=1` → the default phase; `?ally=<name>` →
// that phase; anything falsy (`?ally=0`, `?ally=false`, no param at all) → off.
export function evalAllyDev(search) {
  const v = new URLSearchParams(search || '').get('ally');
  if (v == null) return null;
  if (v === '0' || v === 'false') return null;
  if (v === '' || v === 'true' || v === '1') return { phase: DEV_ALLY_DEFAULT_PHASE };
  return { phase: v };
}

const ALLY_DEV = evalAllyDev(typeof location !== 'undefined' ? location.search : '');

// The flag for this page load, or null.
export function allyDev() { return ALLY_DEV; }

// Wrap a level descriptor on its way into the catalog. A no-op with the flag off — the SAME object comes
// back out, so nothing about a normal run changes.
export function applyAllyDev(descriptor) {
  return ALLY_DEV ? withAllyAt(descriptor, ALLY_DEV.phase) : descriptor;
}
