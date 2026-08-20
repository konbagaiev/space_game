// The headless referee, under `node --test`.
//
// `36-sim-divergence` already replays this trace on both hosts and compares them — but it needs Playwright,
// a browser and ~40 s, so it only runs when someone runs the visual suite. This is the 300 ms version: it
// exercises the Node half alone, and it is what will fail first if a sim-core change breaks the authority.
// The two are complements, not duplicates: this one pins the OUTCOME, the visual one pins AGREEMENT.
//
// The trace is a gitignored S3 asset (`npm run assets:pull`), so a checkout without it skips rather than
// fails — a missing asset is not a broken simulation, and a red suite that means "you did not pull" trains
// people to ignore red suites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrace, buildCatalog, stationFor } from './sim-replay.mjs';
import { LEVELS } from '../src/catalog_seed.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INTRO = LEVELS.find((l) => l.name === 'level-0').descriptor.introTrace;
const tracePath = path.join(repoRoot, 'client', INTRO);
const haveTrace = existsSync(tracePath);
const trace = haveTrace ? JSON.parse(readFileSync(tracePath, 'utf8')) : null;
const skip = haveTrace ? false : `intro trace not pulled (${INTRO}) — run \`npm run assets:pull\``;

test('buildCatalog assembles what the simulation reads off the World', () => {
  const c = buildCatalog('level-0');
  assert.ok(c.weapons.size > 0 && c.components.size > 0, 'weapons + components resolved');
  assert.ok(c.enemyShips.length > 0, 'enemy ship rows present');
  assert.ok(c.shipByName.get('Basic pirate ship'), 'the level-0 spawn pool resolves by name');
  // enemyTotal is stamped by the server before the descriptor is served; the sim reads it for the
  // milestone banners and the last-kill reward drop, so a referee that omits it plays a different level.
  assert.equal(c.level.enemyTotal, 4, 'level-0 totals four enemies');
});

test('stationFor places the home station from the map descriptor', () => {
  const s = stationFor('home-system');
  assert.ok(s, 'home-system carries a base-station set-piece');
  assert.equal(s.active, false, 'it starts unclickable, as in the browser');
  assert.deepEqual([s.pos.x, s.pos.y, s.pos.z], [-10, -42, -10]);
});

test('the Level-0 trace replays to a cleared arena, headless', { skip }, () => {
  const r = runTrace(trace);
  assert.equal(r.ticksRun, r.ticksTotal, 'the whole trace ran (no early death or win)');
  assert.equal(r.summary.kills, 4, 'all four enemies destroyed');
  assert.equal(r.summary.enemies, 0, 'the arena is empty');
  assert.equal(r.summary.earned, 125, 'credits banked by the kills');
  assert.equal(r.summary.returning, true, 'the win phase opened the return-to-base gate');
  // NOT won: docking needs the autopilot, and a trace records keys and touch, never a mouse click. The
  // browser's cutscene fakes that click; a referee has no business reproducing it (see 36-sim-divergence).
  assert.equal(r.summary.won, false);
  assert.ok(r.world.player.alive, 'the recorded run survives it');
});

test('replaying the same trace twice is bit-identical', { skip }, () => {
  const a = runTrace(trace);
  const b = runTrace(trace);
  assert.equal(a.hash, b.hash, 'same digest');
  assert.equal(a.draws, b.draws, 'same number of seeded RNG draws');
});

test('the seeded stream is consumed, and only by the simulation', { skip }, () => {
  const r = runTrace(trace, { maxTicks: 600 });
  assert.ok(r.draws > 0, 'the level runner drew for spawn timing and ship choice');
  // A tight ceiling on purpose: 600 ticks of level-0 spawn a couple of ships, and makeEnemy draws 3× each
  // on top of the spawn gate's own draw. A cosmetic path leaking into the gameplay stream (DECISIONS §73)
  // would blow past this immediately — that is the whole point of the bound.
  assert.ok(r.draws < 60, `expected a handful of gameplay draws in 600 ticks, got ${r.draws}`);
});

test('a truncated trace stops where it is told and leaves a live fight', { skip }, () => {
  const r = runTrace(trace, { maxTicks: 300 });
  assert.equal(r.ticksRun, 300);
  assert.equal(r.summary.returning, false, 'nowhere near the end of the level yet');
  assert.ok(r.world.levelRunner.level, 'the level script is running');
});
