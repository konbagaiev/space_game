// The browser's FIGHT SPEC — which dev flags change this page load's fight (`sim-core/fight-spec.js`).
//
// The ONE place the tab decides it. The per-flag parsers stay where each flag is documented (`ally-dev.js`,
// `beam-dev.js` for `?beam` and `?lancer`, `duel-dev.js`, `brawl-dev.js`); this folds their answers into the
// one spec every call site applies through `applyFightSpec` (the level) and `resolvePlayerBuild` (the ship):
// the boot, the login reload, the level advance, the ship builder, both recorders and the netsim handshake.
//
// UNDER `?playback` THE TRACE DECIDES, NOT THE URL. The bootstrap calls `useTraceFightSpec(trace)` right after
// validating the recording, so ▶ play rebuilds the fight that was flown (a duel row's URL carries no `?duel`;
// a dev row's carries none of its flags) — DECISIONS §170.
//
// NOT STICKY (DECISIONS §81): nothing is stored. With no fight flag on the URL the spec is `NO_FIGHT_SPEC`
// itself, and both sim-core functions hand back the very objects they were given.
//
// Must NOT import `state.js` (`brawl-dev.js` is imported by `state.js`, so a path back would be a cycle).
import { evalAllyDev } from './ally-dev.js';
import { evalBeamDev, evalLancerDev } from './beam-dev.js';
import { evalDuelDev } from './duel-dev.js';
import { evalBrawlDev } from './brawl-dev.js';
import { NO_FIGHT_SPEC, fightSpecFromTrace } from './sim-core/fight-spec.js';

// Pure: the URL alone decides. `NO_FIGHT_SPEC` (the same object) when no fight flag is present.
// `brawl` is a BOOLEAN here: `?brawl=N` and `?netbrawl=N` both mean "this is the brawl room"; the room's bot
// count travels separately (`NETSIM.brawl`, main.js).
export function parseFightSpec(search) {
  const s = search || '';
  const ally = evalAllyDev(s);
  const lancer = evalLancerDev(s);
  const beam = !!evalBeamDev(s);
  const duel = evalDuelDev(s);
  const brawl = evalBrawlDev(s);
  if (!ally && !lancer && !beam && !duel && !brawl) return NO_FIGHT_SPEC;
  return {
    ally: ally ? ally.phase : null,
    lancer: lancer ? lancer.phase : null,
    beam,
    duel: duel ? { aces: duel.count } : null,
    brawl: brawl ? true : null,
  };
}

// Resolved LAZILY on first ask: the ship builder asks mid-boot, at a point this module must not have to be
// ordered against (the reason `?beam` was lazy before it joined the spec).
let SPEC;
export function fightSpec() {
  if (SPEC === undefined) SPEC = parseFightSpec(typeof location === 'undefined' ? '' : location.search);
  return SPEC;
}
// ?playback: the fight is the one the TRACE was fought in, not the URL's.
export function useTraceFightSpec(trace) { SPEC = fightSpecFromTrace(trace); }
// Test seam: force the spec (pass `undefined` to re-read the URL on the next ask).
export function setFightSpec(s) { SPEC = s; }
