// Character-progression math on the CLIENT: the XP curve, mirrored from `server/src/progression.js`.
//
// The server stays the authority — it banks `experience` and derives the level a run is worth. But the
// HUD has to resolve XP into a level *before* the run is banked: the always-on XP bar previews the
// current run's unbanked XP, and a player who crosses a level threshold mid-fight should see the "Level
// up" toast and a reset bar right there, not minutes later back at base. That needs the curve locally,
// and the client is served as plain static ES modules (it cannot import from `server/`), so the two
// constants are duplicated here. `progression.test.js` asserts the two implementations agree for every
// level in range, so a retune on the server side fails the tests instead of silently drifting the HUD.
export const XP_BASE = 1000; // cost to reach level 1 from level 0
export const XP_STEP = 500;  // extra cost added per subsequent level

// XP required to advance FROM `level` to `level+1` (level >= 0): 1000, 1500, 2000, 2500, ...
export function levelUpCost(level) {
  return XP_BASE + XP_STEP * Math.max(0, level | 0);
}

// Roll a player's BANKED progression (`activeShip.progression`: level + XP into that level) forward by
// the XP earned so far this run, and report where the bar actually stands right now:
// `{ level, into, span }` — the live level, XP into it, and that level's span toward the next. Earning
// enough for several levels in one fight rolls through all of them (the loop, not a single subtraction).
export function liveProgress(prog, earnedXp = 0) {
  let level = Math.max(0, (prog && prog.level) | 0);
  let into = Math.max(0, ((prog && prog.xpIntoLevel) || 0) + Math.max(0, earnedXp || 0));
  let span = levelUpCost(level);
  while (into >= span) { into -= span; level++; span = levelUpCost(level); }
  return { level, into, span };
}

// Resolve a TOTAL banked experience into `{ level, into, span }` (same contract as the server's
// `levelFromXp`) — used when the bank response hands back a fresh `experience` and the client has to
// rebuild the progression fields the HUD reads.
export function levelFromXp(experience) {
  return liveProgress({ level: 0, xpIntoLevel: 0 }, Math.floor(experience || 0));
}
