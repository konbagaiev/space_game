// CALL-SITE GUARD: the fight spec is applied in ONE way, everywhere (duplication audit §B4/§B5).
//
// The level half used to be a five-deep chain of per-flag wrappers written out differently at each call site
// (`?lancer` was missing from the level advance; `?lancer` and `?brawl` from the login reload), and the ship
// half was written five more times. The wrappers are gone; this pins that nobody writes a call site that
// re-introduces a per-flag transform, and that the playback spec is installed BEFORE the level is built.
// A source check, on purpose: main.js / account.js / net.js / ship-build.js import `three`, so they cannot be
// loaded in Node (the sim-host side of the same contract is in server/src/sim-host.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
// Comments talk ABOUT the old wrappers (their history is worth keeping), so strip them before matching.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = (f) => stripComments(readFileSync(path.join(dir, f), 'utf8'));

const FORBIDDEN = /applyAllyDev|applyLancerDev|applyDuelDev|applyTraceRoom|applyBrawlDev|duelBuild|beamLoadout|withAllyAt|withLancersAt|withDuelRoom|withBrawlRoom|withBeamGun/;

for (const f of ['main.js', 'account.js', 'net.js']) {
  test(`${f} builds the level through applyFightSpec, and no per-flag transform`, () => {
    const src = code(f);
    assert.ok(src.includes('applyFightSpec('), `${f} must apply the level half via applyFightSpec(`);
    const m = src.match(FORBIDDEN);
    assert.equal(m, null, `${f} still names ${m && m[0]} — apply the spec through sim-core/fight-spec.js instead`);
  });
}

test('ship-build.js builds the player through resolvePlayerBuild, and no per-flag transform', () => {
  const src = code('ship-build.js');
  assert.ok(src.includes('resolvePlayerBuild('));
  const m = src.match(FORBIDDEN);
  assert.equal(m, null, `ship-build.js still names ${m && m[0]}`);
});

test('main.js: both recorders record the resolved build and the whole spec', () => {
  const src = code('main.js');
  assert.ok(src.includes('roomFromFightSpec('), 'trace.room comes from the spec');
  assert.ok((src.match(/resolvePlayerBuild\(/g) || []).length >= 2, 'the live recorder AND ?record resolve the flown build');
  assert.ok(!src.includes("room: duelDev() ?"), 'the old duel-only room literal is gone');
  assert.ok(src.includes("sr.room?.kind === 'duel'"), 'the anchor digest is sealed for DUELS only, not for a dev fight');
});

test('main.js: under ?playback the TRACE\'s spec is installed before the level is built', () => {
  const src = code('main.js');
  const load = src.indexOf('rs.trace = await loadTrace(');
  const use = src.indexOf('useTraceFightSpec(');
  const apply = src.indexOf('applyFightSpec(');
  assert.ok(load >= 0 && use >= 0 && apply >= 0, 'all three anchors exist');
  assert.ok(load < use && use < apply, `useTraceFightSpec must sit in the playback load block (load ${load} < use ${use} < apply ${apply})`);
});
