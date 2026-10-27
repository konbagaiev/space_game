// The `?duel` sparring room, as a DESCRIPTOR TRANSFORM — host-neutral so a server can rebuild the same
// room the browser fought in (docs/plans/2026-09-01-1845-duel-referee.md §S1). The flag itself and the URL
// parsing stay in `client/src/duel-dev.js`; the rules of the room and its forced kit live here, for
// the same reason `ally-config.js withAllyAt`, `lancer-config.js withLancersAt` and `beam-config.js
// withBeamGun` do: the headless referee and a netsim room have to build the fight from the same source as
// the tab, or they are two different simulations again.
import { ACE_COUNT_MAX } from './ace.js';

// THE DUEL KIT (moved here from `client/src/duel-dev.js` so the room and the referee build the SAME ship the
// tab flies — `fight-spec.js resolvePlayerBuild` is the one place it is applied, in every host).
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

// Force the player's ship to the duel kit. Skills are dropped on purpose: the duel is about the flying, and a
// skilled account would be sparring against an unskilled ace. The `ship` row (the hull you fly) is kept.
//
// `skills: null` IS WHY A FLEEING ACE CANNOT BE CAUGHT IN HERE, and the chain is intact rather than broken:
// `skills.mobility` → `mobilityMul = 1 + 0.05·pts` (`components.js`) → `p.maxSpeedMul` (`ship-entity.js`) →
// `PLAYER_MAX_SPEED × maxSpeedMul` (`step-player.js`). It is simply fed `null` here, so both hulls sit on
// exactly 30 u/s. See the skills caveat in `client/src/duel-dev.js`'s header for what that means for the retreat.
export function withDuelKit(build) {
  return { ...build, loadout: DUEL_LOADOUT, components: DUEL_COMPONENTS, skills: null };
}

// The room's phase script. One fighting phase, then the win phase every level ends on.
export const DUEL_PHASES = (n) => ([
  { name: 'duel', aces: n, advanceWhen: { allCleared: true } },
  { name: 'victory', event: 'win', delay: 1.5, text: 'Sparring complete' },
]);

// KEPT from the level it is built over: `map` and `center` (the room is fought in a real place, with the
// level's own scenery). REPLACED: the phases and the enemy total. ADDED: `campaign: false` — a won duel never
// advances campaign progress (`client/src/campaign-advance.js`). DROPPED: `briefing`, `lastKillDrop`,
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
    // NOT A CAMPAIGN LEVEL: winning the room must never advance the account past the level it was built over.
    // Read only by the HOST (`client/src/campaign-advance.js`); the simulation never looks at it.
    campaign: false,
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
