// The side-mission card's "Reward ≈ / XP ≈" is computed from the mission's phases × the ship catalog
// (missions.js expectedRun) — never restated by hand. Pure: no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMissions, expectedRun, round10 } from './missions.js';
import { SHIPS } from './catalog_seed.js';

// An independent re-computation: expected kills of each ship per phase (total × chance / Σchance), then
// credits/XP read the way the live enemy entity reads them (ship-entity.js: reward || 0, xp || 0).
function recompute(phases, ships) {
  const byName = new Map(ships.map((s) => [s.name, s]));
  let credits = 0, xp = 0;
  for (const ph of phases) {
    if (!ph.spawn) continue;
    const w = ph.spawn.pool.reduce((a, p) => a + p.chance, 0);
    for (const p of ph.spawn.pool) {
      const st = byName.get(p.ship).stats;
      const kills = (ph.spawn.total * p.chance) / w;
      credits += kills * (st.reward || 0);
      xp += kills * (st.xp || 0);
    }
  }
  return { credits, xp };
}

test('side-mission card estimate tracks the catalog (credits ×2 on clear; XP = per-kill + the clear bonus)', () => {
  const missions = generateMissions();
  assert.equal(missions.length, 3);
  for (const m of missions) {
    const exp = recompute(m.descriptor.phases, SHIPS);
    assert.ok(exp.credits > 0 && exp.xp > 0);
    assert.equal(m.estReward, round10(2 * exp.credits), `${m.id} estReward`);
    assert.equal(m.estXp, round10(exp.xp + m.descriptor.xpReward), `${m.id} estXp`);
  }
});

test('expectedRun moves with an enemy reward: +100 on the pirate gunner adds 100 × expected gunner kills', () => {
  const phases = generateMissions()[0].descriptor.phases;
  const bumped = SHIPS.map((s) => (s.name === 'pirate gunner'
    ? { ...s, stats: { ...s.stats, reward: s.stats.reward + 100, xp: s.stats.xp + 100 } } : s));
  // expected gunner kills from the pool odds: wave-1 7×0.40 + wave-2 7×0.35 + clear-out 4×0.35 = 6.65
  let gunners = 0;
  for (const ph of phases) {
    if (!ph.spawn) continue;
    const w = ph.spawn.pool.reduce((a, p) => a + p.chance, 0);
    for (const p of ph.spawn.pool) if (p.ship === 'pirate gunner') gunners += (ph.spawn.total * p.chance) / w;
  }
  assert.ok(Math.abs(gunners - 6.65) < 1e-9, `gunners ${gunners}`);
  const a = expectedRun(phases, SHIPS), b = expectedRun(phases, bumped);
  assert.ok(Math.abs((b.credits - a.credits) - 100 * gunners) < 1e-9, `credits +${b.credits - a.credits}`);
  assert.ok(Math.abs((b.xp - a.xp) - 100 * gunners) < 1e-9, `xp +${b.xp - a.xp}`);
});

test('expectedRun throws on a pool ship that is not in the catalog', () => {
  const phases = [{ spawn: { total: 3, pool: [{ ship: 'no such pirate', chance: 1 }] } }];
  assert.throws(() => expectedRun(phases, SHIPS), /no such pirate/);
});

test('expectedRun skips phases without a spawn (e.g. the victory event)', () => {
  assert.deepEqual(expectedRun([{ name: 'victory', event: 'win' }], SHIPS), { credits: 0, xp: 0 });
});
