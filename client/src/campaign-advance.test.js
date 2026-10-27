// A duel must NEVER advance campaign progress (maintainer, 2026-10-27). The `?duel` room is built over a real
// level, so before `campaign: false` a won duel — local, netsim, or the instant empty-arena win after a netsim
// mid-fight fallback — reached `commitLevelAdvance()` (POST /advance) exactly like the level it replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { advancesCampaign } from './campaign-advance.js';
import { withDuelRoom } from './sim-core/duel-config.js';
import { applyFightSpec, NO_FIGHT_SPEC } from './sim-core/fight-spec.js';
import { LEVELS } from '../../server/src/catalog_seed.js';

const level = (name) => LEVELS.find((l) => l.name === name).descriptor;

test('a campaign level advances; a side mission and nothing-at-all do not', () => {
  assert.equal(advancesCampaign(level('level-1')), true);
  assert.equal(advancesCampaign(level('level-0')), true, 'the intro advances to Level 1');
  assert.equal(advancesCampaign({ ...level('level-1'), sideMission: true }), false);
  assert.equal(advancesCampaign(null), false);
});

test('a DUEL descriptor never commits an advance — whichever level it is built over, however it is reached', () => {
  for (const name of ['level-0', 'level-1', 'level-4']) {
    assert.equal(advancesCampaign(withDuelRoom(level(name), 2)), false, `duel over ${name}`);
    // The path every host takes (tab boot/advance/login, the room, playback of a duel trace):
    assert.equal(advancesCampaign(applyFightSpec(level(name), { ...NO_FIGHT_SPEC, duel: { aces: 2 } })), false);
    assert.equal(advancesCampaign(applyFightSpec(level(name), { ...NO_FIGHT_SPEC, ally: 'clear-out', duel: { aces: 3 } })), false);
  }
  // …and the other dev fights are still campaign levels: an ?ally / ?lancer run on Level 4 is Level 4.
  assert.equal(advancesCampaign(applyFightSpec(level('level-4'), { ...NO_FIGHT_SPEC, ally: 'clear-out', lancer: 'wave-1' })), true);
});

// sim.js imports `three`, so it cannot be loaded in Node: pin that BOTH halves of the advance ask the predicate.
test('sim.js gates both halves of the campaign advance on advancesCampaign', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sim.js'), 'utf8');
  assert.match(src, /if \(advancesCampaign\(lvl\)\) commitLevelAdvance\(\)/, '`finishing` (server-side half)');
  assert.match(src, /if \(advancesCampaign\(lvl\)\) loadAdvancedLevel\(\)/, '`win` (tab-side half)');
  assert.ok(!/!lvl\.sideMission\) (commitLevelAdvance|loadAdvancedLevel)/.test(src), 'no ungated sideMission-only check is left');
});
