// A room must be the SAME simulation as the referee, and the protocol must not leak the server's internals.
//
// The first test is the load-bearing one: feed a room the canonical Level-0 input trace, one snapshot per
// tick, and require it to reach the digest `server/tools/sim-replay.mjs` reaches from the same trace. A
// room that drifts from the referee is a third simulation, which is exactly what this whole project exists
// to prevent (docs/plans/server-authoritative-sim.md D1).
//
// The trace is a gitignored S3 asset, so a checkout without it skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoom, MAX_QUEUED_INPUTS, INPUT_QUEUE_TARGET } from './room.js';
import { EVENT_FIELDS, wireEvent } from './protocol.js';
import { runTrace } from '../../tools/sim-replay.mjs';
import { hydrateTrace } from '../../../client/src/replay.js';
import { LEVELS } from '../catalog_seed.js';
import { buildCatalog } from '../sim-host.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const INTRO = LEVELS.find((l) => l.name === 'level-0').descriptor.introTrace;
const tracePath = path.join(repoRoot, 'client', INTRO);
const haveTrace = existsSync(tracePath);
const rawTrace = haveTrace ? JSON.parse(readFileSync(tracePath, 'utf8')) : null;
const skip = haveTrace ? false : `intro trace not pulled (${INTRO}) — run \`npm run assets:pull\``;

test('a room replaying the canonical trace matches the headless referee exactly', { skip }, () => {
  const t = hydrateTrace(rawTrace);
  const room = createRoom({ levelName: 'level-0', seed: t.seed,
    ship: { shipId: t.shipId, loadout: t.loadout, components: t.components } });
  // Fed at the NATURAL rate — one input per tick, which is what a healthy client produces. A room that is
  // handed a backlog deliberately fast-forwards through it (INPUT_QUEUE_TARGET), and that is not a replay.
  for (let i = 0; i < t.ticks.length; i++) {
    room.pushInput([{ t: i, k: t.ticks[i].k, a: t.ticks[i].t }]);
    room.stepOnce();
  }
  assert.equal(room.droppedInputs, 0, 'nothing overflowed');
  assert.equal(room.caughtUpInputs, 0, 'and nothing was fast-forwarded, so every input was simulated in order');

  const ref = runTrace(rawTrace);
  const got = room.digest();
  assert.equal(got.summary.kills, ref.summary.kills);
  assert.equal(got.draws, ref.draws, 'the same number of seeded RNG draws');
  assert.equal(got.hash, ref.hash,
    `a room diverged from the referee (room 0x${got.hash.toString(16)}, referee 0x${ref.hash.toString(16)})`);
});

test('a silent client holds its controls rather than dropping them', () => {
  const room = createRoom({ seed: 3 });
  room.pushInput([{ t: 0, k: ['KeyW'], a: null }]);
  room.stepOnce();
  const movingAt1 = room.world.player.vel.length();
  for (let i = 0; i < 30; i++) room.stepOnce(); // nothing pushed: the last input repeats
  assert.ok(room.world.player.vel.length() > movingAt1,
    'thrust kept being applied through the gap (a network stall is not a released key)');
  assert.equal(room.tick, 31);
});

test('the input queue is bounded, and says so', () => {
  const room = createRoom({ seed: 3 });
  room.pushInput(Array.from({ length: MAX_QUEUED_INPUTS + 50 }, (_, i) => ({ t: i, k: [], a: null })));
  assert.equal(room.queued, MAX_QUEUED_INPUTS, 'held at the cap');
  assert.equal(room.droppedInputs, 50, 'and the overflow is counted, not hidden');
  room.stepOnce();
  assert.equal(room.takeSnapshot().dropped, 50, 'the client is told its input was discarded');
});

test('ack echoes the last client tick applied', () => {
  const room = createRoom({ seed: 3 });
  assert.equal(room.takeSnapshot().ack, null, 'nothing applied yet');
  room.pushInput([{ t: 41, k: [], a: null }, { t: 42, k: [], a: null }]);
  room.stepOnce();
  assert.equal(room.takeSnapshot().ack, 41);
  room.stepOnce();
  assert.equal(room.takeSnapshot().ack, 42);
});

test('an entity is described once, then addressed by id', () => {
  const room = createRoom({ seed: 3 });
  const seen = new Map();
  let firstSnapWithEnemy = null;
  for (let i = 0; i < 400; i++) {
    room.stepOnce();
    if (!room.dueForSnapshot()) continue;
    const s = room.takeSnapshot();
    for (const sp of s.spawns) {
      assert.ok(!seen.has(sp.id), `entity ${sp.id} was described twice`);
      seen.set(sp.id, sp);
    }
    if (!firstSnapWithEnemy && s.enemies.length) firstSnapWithEnemy = s;
  }
  assert.ok(firstSnapWithEnemy, 'the level spawned something within 400 ticks');
  const spawnedEnemies = [...seen.values()].filter((s) => s.kind === 'enemy');
  assert.ok(spawnedEnemies.length > 0, 'the level spawned enemies');
  // A ship is NAMED, not described: the client resolves the model/yaw/scale from the catalog it already
  // holds. So the contract is that the name is a real catalog key — a typo here would leave the client
  // drawing placeholder cones with no error anywhere.
  const catalog = buildCatalog('level-0');
  for (const sp of spawnedEnemies) {
    assert.ok(catalog.shipByName.get(sp.name), `spawn named '${sp.name}', which is not in the catalog`);
    assert.ok(sp.maxHp > 0 && sp.fullScale > 0, 'plus the per-entity numbers the catalog cannot give');
  }
  for (const row of firstSnapWithEnemy.enemies) assert.ok(seen.has(row[0]), 'every row id was described first');
});

test('a snapshot is JSON, and small', () => {
  const room = createRoom({ seed: 3 });
  for (let i = 0; i < 400; i++) room.stepOnce();
  const s = room.takeSnapshot();
  const json = JSON.stringify(s);
  assert.ok(json.length > 0);
  assert.deepEqual(JSON.parse(json).run, s.run, 'round-trips');
  // A guard against an entity graph leaking into the wire: a live enemy carries hitBoxes (dozens of OBBs),
  // so a snapshot that accidentally serialized one would be tens of kilobytes, 15 times a second.
  assert.ok(json.length < 20000, `snapshot is ${json.length} bytes — something big leaked in`);
  assert.ok(!json.includes('hitBoxes'), 'no collision geometry on the wire');
});

// --- the protocol allowlist ---

test('every event in the sim-core catalogue is wired for the network', () => {
  const src = readFileSync(path.join(repoRoot, 'client/src/sim-core/events.js'), 'utf8');
  const catalogue = [...src.matchAll(/^\/\/\s+\{\s*type:\s*'([a-zA-Z]+)'/gm)].map((m) => m[1]);
  assert.ok(catalogue.length >= 19, `parsed ${catalogue.length} event types from the catalogue — parser drifted`);
  for (const type of catalogue) {
    assert.ok(EVENT_FIELDS[type], `event '${type}' is in sim-core/events.js but not in protocol.js EVENT_FIELDS `
      + '— it would be silently dropped on the way to a client');
  }
});

test('an entity reference becomes an id, never the entity', () => {
  const enemy = { name: 'x', hitBoxes: [1, 2, 3], engine: {}, pos: { x: 1, y: 0, z: 2 } };
  const w = wireEvent({ type: 'enemyShieldHit', enemy, pos: { x: 5, y: 0.6, z: 6 }, broke: true }, () => 42);
  assert.deepEqual(w, { type: 'enemyShieldHit', pos: { x: 5, y: 0.6, z: 6 }, broke: true, enemyId: 42 });
  assert.ok(!JSON.stringify(w).includes('hitBoxes'));
});

test('an unknown event is dropped, not forwarded raw', () => {
  assert.equal(wireEvent({ type: 'somethingNew', secret: 1 }, () => null), null);
});

test('a bursty client does not build permanent input lag', () => {
  const room = createRoom({ seed: 11 });
  // 60 ticks arrive at once — a client that stalled for a second and caught up in one frame.
  room.pushInput(Array.from({ length: 60 }, (_, i) => ({ t: i, k: [], a: null })));
  for (let i = 0; i < 40; i++) room.stepOnce();
  assert.ok(room.queued <= INPUT_QUEUE_TARGET + 1,
    `the queue drained to ${room.queued}, not left as standing latency`);
  assert.ok(room.caughtUpInputs > 0, 'and it says how many it fast-forwarded');
  assert.equal(room.droppedInputs, 0, 'nothing was lost to the overflow cap — this is catch-up, not loss');
});

test('a client feeding at the natural rate is never fast-forwarded', () => {
  const room = createRoom({ seed: 11 });
  for (let i = 0; i < 200; i++) { room.pushInput([{ t: i, k: [], a: null }]); room.stepOnce(); }
  assert.equal(room.caughtUpInputs, 0, 'no catch-up when there is nothing to catch up on');
  assert.equal(room.queued, 0);
});
