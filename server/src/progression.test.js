import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelUpCost, xpForLevel, levelFromXp, unspentSkillPoints, XP_BASE, XP_STEP } from './progression.js';

test('levelUpCost: arithmetic ramp 1000, 1500, 2000, ...', () => {
  assert.equal(levelUpCost(0), 1000);
  assert.equal(levelUpCost(1), 1500);
  assert.equal(levelUpCost(2), 2000);
  assert.equal(levelUpCost(5), XP_BASE + XP_STEP * 5);
  assert.equal(levelUpCost(-3), 1000); // negatives clamp to level 0's cost
});

test('xpForLevel: cumulative XP to reach a level matches the approved table', () => {
  assert.equal(xpForLevel(0), 0);
  assert.equal(xpForLevel(1), 1000);
  assert.equal(xpForLevel(2), 2500);
  assert.equal(xpForLevel(3), 4500);
  assert.equal(xpForLevel(4), 7000);
  assert.equal(xpForLevel(5), 10000);
});

test('levelFromXp: a new player is level 0 with a full 1000 span to level 1', () => {
  assert.deepEqual(levelFromXp(0), { level: 0, into: 0, span: 1000 });
  assert.deepEqual(levelFromXp(500), { level: 0, into: 500, span: 1000 });
});

test('levelFromXp: thresholds land exactly on the cumulative table', () => {
  assert.deepEqual(levelFromXp(1000), { level: 1, into: 0, span: 1500 });
  assert.deepEqual(levelFromXp(2499), { level: 1, into: 1499, span: 1500 });
  assert.deepEqual(levelFromXp(2500), { level: 2, into: 0, span: 2000 });
  assert.deepEqual(levelFromXp(7000), { level: 4, into: 0, span: 3000 });
});

test('levelFromXp: clamps garbage input to level 0', () => {
  assert.equal(levelFromXp(-100).level, 0);
  assert.equal(levelFromXp(NaN).level, 0);
  assert.equal(levelFromXp(undefined).level, 0);
});

test('levelFromXp: round-trips against xpForLevel for the first several levels', () => {
  for (let L = 0; L <= 8; L++) {
    assert.equal(levelFromXp(xpForLevel(L)).level, L, `reaching xpForLevel(${L})`);
    if (L > 0) assert.equal(levelFromXp(xpForLevel(L) - 1).level, L - 1, `one XP short of ${L}`);
  }
});

test('unspentSkillPoints: level grants one point each, minus what is already allocated', () => {
  assert.equal(unspentSkillPoints(0, 0), 0);        // level 0 -> 0 points
  assert.equal(unspentSkillPoints(2500, 0), 2);     // level 2, nothing spent
  assert.equal(unspentSkillPoints(2500, 1), 1);     // level 2, one spent
  assert.equal(unspentSkillPoints(2500, 2), 0);     // level 2, both spent
  assert.equal(unspentSkillPoints(2500, 5), 0);     // never negative (over-allocation guard)
});
