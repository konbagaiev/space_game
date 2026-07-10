// Level-0 intro cutscene — the pause SCRIPT, laid over an input-replay playback of the intro fight
// (docs/plans/2026-07-09-replay-record.md → cutscene step). Each beat is triggered by a SIM EVENT observed
// during playback, NOT a fixed tick — so it survives a re-recording (the maintainer's ask). Every event-driven
// pause fires ~`delaySec` after its trigger. P0 is a pre-fight opening card (shown before the first tick).
// Text resolves at runtime via i18n (`ui.cutscene.*`, EN source + RU). The runtime lives in main.js.
export const LEVEL0_CUTSCENE = {
  level: 'level-1',                 // the intro four-ship level (seed name level-1)
  rocketeerShip: 'basic rocket pirate', // enemy whose warp-in triggers P3 and whose rockets trigger P4
  delaySec: 1,                      // fire each event-driven pause ~1s after its trigger
  pauses: [
    { id: 'p0', on: 'opening',                textKey: 'ui.cutscene.p0_intro' },        // before the fight (tap to begin)
    { id: 'p1', on: 'kill',         n: 1,     textKey: 'ui.cutscene.p1_first_kill' },   // 1s after the 1st kill
    { id: 'p2', on: 'kill',         n: 2,     textKey: 'ui.cutscene.p2_second_kill' },  // 1s after the 2nd kill
    { id: 'p3', on: 'rocketeer',              textKey: 'ui.cutscene.p3_rocketeer' },    // 1s after the rocketeer warps in
    { id: 'p4', on: 'enemyRocket',  n: 2,     textKey: 'ui.cutscene.p4_second_rocket' },// 1s after the rocketeer's 2nd rocket
  ],
};
