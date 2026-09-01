// The `?duel` sparring room, as a DESCRIPTOR TRANSFORM — host-neutral so a server can rebuild the same
// room the browser fought in (docs/plans/2026-09-01-1845-duel-referee.md §S1). The flag itself, the URL
// parsing and the forced ship stay in `client/src/duel-dev.js`; only the rules of the room live here, for
// the same reason `ally-config.js withAllyAt`, `lancer-config.js withLancersAt` and `beam-config.js
// withBeamGun` do: the headless referee and a netsim room have to build the fight from the same source as
// the tab, or they are two different simulations again.
import { ACE_COUNT_MAX } from './ace.js';

// The room's phase script. One fighting phase, then the win phase every level ends on.
export const DUEL_PHASES = (n) => ([
  { name: 'duel', aces: n, advanceWhen: { allCleared: true } },
  { name: 'victory', event: 'win', delay: 1.5, text: 'Sparring complete' },
]);

// KEPT from the level it is built over: `map` and `center` (the room is fought in a real place, with the
// level's own scenery). REPLACED: the phases and the enemy total. DROPPED: `briefing`, `lastKillDrop`,
// `introTrace`, `intro` and `xpReward` — every one of them is a promise about a campaign level this is not.
//
// The transform itself, pure and flag-free so it can be tested without a URL. Non-mutating: a NEW
// descriptor with a NEW phases array (`buildCatalog` shallow-copies a level, so its `phases` array is
// shared with the module-level seed — the same trap `withAllyAt` documents).
export function withDuelRoom(descriptor, count) {
  if (!descriptor) return descriptor;
  const n = Math.max(1, Math.min(ACE_COUNT_MAX, count | 0));
  return {
    ...descriptor,
    title: `Duel — ${n} ace${n === 1 ? '' : 's'}`,
    xpReward: 0,
    enemyTotal: n,
    finalStageBanner: false,   // a two-ship room has no "final stage" to announce
    briefing: undefined, lastKillDrop: undefined, introTrace: undefined, intro: undefined,
    phases: DUEL_PHASES(n),
  };
}

// THE ANCHOR: the instant the FIGHT ended, which is not the instant the trace ends.
//
// A mission ends twice (DECISIONS §130). The arena empties → `clearMission` sets `levelRunner.cleared` and
// decides the reward; only later does the player click "Finish and Return", fly home and dock, and only
// docking sets `levelRunner.won`. That click and that dock are NOT in an input trace — a trace records keys
// and touch, never a mouse click (DECISIONS §129: "a headless referee can never win") — so at the end of a
// winning duel the browser's World carries `won`/`finishing`/`returningToBase` and an engaged autopilot
// while the referee's carries none of them, and every one of those fields is inside `worldDigest`.
// Digesting the FINAL state would therefore mark every honest winning duel `disagree`.
//
// `cleared` and death are different: both are decided inside `sim-core` as a pure consequence of the fight,
// with nobody clicking anything, so a browser, a netsim room and a headless referee all reach them on the
// same tick. That is why this — and only this — is the comparison point.
export const duelAnchorReached = (world) =>
  !!(world.levelRunner.cleared || !world.player.alive);
