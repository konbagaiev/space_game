import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveProgress, levelFromXp, levelUpCost, XP_BASE, XP_STEP, adoptBankedProgression } from './progression.js';
import * as server from '../../server/src/progression.js';

// The client duplicates the XP curve because it is served as static ES modules and cannot import from
// `server/` at runtime (see progression.js). This is the guard that keeps the copy honest: retune the
// server curve without retuning the client and these fail.
test('client curve mirrors server/src/progression.js exactly', () => {
  assert.equal(XP_BASE, server.XP_BASE);
  assert.equal(XP_STEP, server.XP_STEP);
  for (let l = 0; l <= 30; l++) assert.equal(levelUpCost(l), server.levelUpCost(l));
  for (const xp of [0, 1, 999, 1000, 1001, 2499, 2500, 7000, 12345, 250000]) {
    assert.deepEqual(levelFromXp(xp), server.levelFromXp(xp), `xp=${xp}`);
  }
});

test('liveProgress: unbanked run XP below the threshold just fills the bar', () => {
  const prog = { level: 2, xpIntoLevel: 300 };
  assert.deepEqual(liveProgress(prog, 700), { level: 2, into: 1000, span: 2000 }); // level 2 costs 2000
});

test('liveProgress: crossing the threshold mid-run bumps the level and resets the bar', () => {
  const prog = { level: 2, xpIntoLevel: 1900 };
  assert.deepEqual(liveProgress(prog, 150), { level: 3, into: 50, span: 2500 });
  assert.deepEqual(liveProgress(prog, 100), { level: 3, into: 0, span: 2500 }); // exactly on the threshold levels up
});

test('liveProgress: one huge haul rolls through several levels', () => {
  // From level 0 with 0 banked: 1000 (→1) + 1500 (→2) + 2000 (→3) = 4500, then 200 into level 3 (span 2500).
  assert.deepEqual(liveProgress({ level: 0, xpIntoLevel: 0 }, 4700), { level: 3, into: 200, span: 2500 });
});

test('liveProgress: no earned XP (or missing progression) is the banked state itself', () => {
  assert.deepEqual(liveProgress({ level: 4, xpIntoLevel: 800 }), { level: 4, into: 800, span: 3000 });
  assert.deepEqual(liveProgress(null, 0), { level: 0, into: 0, span: 1000 });
  assert.deepEqual(liveProgress({ level: 1, xpIntoLevel: 200 }, -50), { level: 1, into: 200, span: 1500 });
});

// ---- adoptBankedProgression: what the client holds after POST /api/games banks a run ----
// The server returns the full `progression` (the GET active-ship object); the client must ADOPT it, not
// rebuild it from the flat fields — a rebuild can't know about a skill spent since, so it drifted.
const BANKED_PREV = Object.freeze({ experience: 900, level: 0, xpIntoLevel: 900, xpForNextLevel: 1000,
  skillPoints: 1, skills: Object.freeze({ kinetic: 0 }) });

test('adoptBankedProgression: a server progression is the authority, even when a local rebuild disagrees', () => {
  // 2500 XP = level 2 (two levels gained from level 0). The rebuild would say skillPoints 1 + 2 = 3; the
  // server knows one point was spent since and says 2. The server wins.
  const res = { experience: 2500, level: 2, leveledUp: true, xpEarned: 1600,
    progression: { experience: 2500, level: 2, xpIntoLevel: 0, xpForNextLevel: 2000, skillPoints: 2,
      skills: { kinetic: 1 } } };
  const out = adoptBankedProgression(BANKED_PREV, res);
  assert.deepEqual(out, res.progression);
  assert.notEqual(out, res.progression, 'a copy, not the response object');
  assert.notDeepEqual(out, adoptBankedProgression(BANKED_PREV, { ...res, progression: undefined }),
    'the case really is one where the local rebuild would disagree');
});

test('adoptBankedProgression: an old server (flat fields only) falls back to the curve, +1 point per level gained', () => {
  const out = adoptBankedProgression(BANKED_PREV, { experience: 2500, level: 2, leveledUp: true, xpEarned: 1600 });
  const at = levelFromXp(2500);
  assert.equal(out.experience, 2500);
  assert.equal(out.level, 2);
  assert.equal(out.xpIntoLevel, at.into);
  assert.equal(out.xpForNextLevel, at.span);
  assert.equal(out.skillPoints, BANKED_PREV.skillPoints + 2);
  assert.deepEqual(out.skills, BANKED_PREV.skills);
  // no level gained → no points added
  assert.equal(adoptBankedProgression(BANKED_PREV, { experience: 950, level: 0 }).skillPoints, BANKED_PREV.skillPoints);
});

test('adoptBankedProgression: never mutates the previous progression', () => {
  const prev = { experience: 900, level: 0, xpIntoLevel: 900, xpForNextLevel: 1000, skillPoints: 1, skills: {} };
  const snap = JSON.parse(JSON.stringify(prev));
  adoptBankedProgression(prev, { experience: 2500, level: 2 });
  adoptBankedProgression(prev, { experience: 2500, level: 2, progression: { level: 2, skillPoints: 2 } });
  assert.deepEqual(prev, snap);
});
