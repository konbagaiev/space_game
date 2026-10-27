// Does winning THIS level advance the account's campaign progress? The one predicate both halves of the advance
// ask (`sim.js`: `commitLevelAdvance` at `finishing`, `loadAdvancedLevel` at `win`).
//
// Two kinds of fight are not campaign levels and must never move `current_progress`:
//   • a SIDE MISSION (`sideMission`) — its own clear flag is its reward (`reportMissionCleared`);
//   • a dev room that replaced the level's script — today the `?duel` sparring room, which `withDuelRoom`
//     (`sim-core/duel-config.js`) marks `campaign: false`. It is built over a real level, so without the mark a
//     won duel — locally, in a netsim room, or the instant empty-arena "win" after a netsim mid-fight fallback
//     to local — offered "Finish and Return" and silently skipped the player past that level.
// Either way the post-win UI is the side mission's: the victory overlay, Continue to the Hangar, no advance.
//
// Pure (no DOM, no state) so it is unit-tested without a browser. Host-side only: the simulation never reads
// `campaign` (it is not in `worldDigest`), so marking a descriptor changes no replay.
export function advancesCampaign(level) {
  return !!level && !level.sideMission && level.campaign !== false;
}
