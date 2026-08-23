// A ROOM runs the wingman — and puts him on the wire.
//
// This is the whole point of building him in `sim-core`: there is no second, server-side ally to write, so
// what is left to guard is the wire. That the room produces a `kind: 'ally'` descriptor, that its snapshot
// rows carry the documented columns, that no snapshot leaks the server's collision geometry, and that a
// room with an ally is still DETERMINISTIC — the same seed and the same inputs reach the same digest.
//
// What this file does NOT prove, deliberately: browser-vs-Node agreement for a world that HAS an ally.
// It re-runs a room against itself (Node-vs-Node). Both hosts import the very same `sim-core` modules, and
// `step-ally.js` has no browser-only branch, so a divergence would have to come from somewhere that does
// not exist yet; a second cross-host oracle is a follow-up for when Level 5 can be recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom } from './room.js';
import { COLUMNS, EVENT_FIELDS } from './protocol.js';

const stepFor = (room, ticks, take = () => {}) => {
  for (let i = 0; i < ticks; i++) {
    room.stepOnce();
    if (room.dueForSnapshot()) take(room.takeSnapshot());
  }
};

test('a room asked for an ally produces a kind:\'ally\' spawn descriptor', () => {
  const room = createRoom({ levelName: 'level-4', seed: 99, ally: 'wave-1' });
  let desc = null;
  stepFor(room, 120, (snap) => { for (const s of snap.spawns) if (s.kind === 'ally') desc = desc || s; });
  assert.ok(desc, 'the room told the client about him');
  assert.equal(desc.name, 'Basic player ship', 'named, not described — the client resolves the model itself');
  assert.equal(desc.shipClass, 'player');
  assert.equal(desc.color, 0x3ddc84, 'his livery is the one thing the client cannot derive');
  assert.equal(desc.maxHp, 200);
  assert.ok(desc.fullScale > 0 && desc.sizeScale > 0);
  assert.equal(desc.hitBoxes, undefined, 'and NOT the server\'s collision geometry');
});

test('snapshots carry `allies` rows of the documented width, and never leak hitBoxes', () => {
  const room = createRoom({ levelName: 'level-4', seed: 99, ally: 'wave-1' });
  const width = COLUMNS.allies.split(',').length;
  assert.equal(width, COLUMNS.enemies.split(',').length, 'same column order as an enemy, by design');
  let seenRow = false;
  stepFor(room, 240, (snap) => {
    assert.ok(Array.isArray(snap.allies), 'the key is always present, even when empty');
    for (const r of snap.allies) {
      seenRow = true;
      assert.equal(r.length, width, `a row is ${width} columns: ${COLUMNS.allies}`);
      assert.ok(Number.isFinite(r[0]), 'id');
      for (const v of r) assert.ok(Number.isFinite(v), 'every column is a finite number');
    }
    assert.ok(!JSON.stringify(snap).includes('hitBoxes'), 'no snapshot ever carries collision geometry');
  });
  assert.ok(seenRow, 'the wingman was actually listed');
});

test('an ally room is DETERMINISTIC: the same seed and inputs reach the same digest', () => {
  const run = () => {
    const room = createRoom({ levelName: 'level-4', seed: 4242, ally: 'wave-1' });
    for (let i = 0; i < 400; i++) {
      room.pushInput([{ t: i, k: i % 3 === 0 ? ['KeyW'] : ['KeyW', 'KeyA'], a: null }]);
      room.stepOnce();
    }
    return room.digest();
  };
  const a = run(), b = run();
  assert.equal(a.hash, b.hash, 'bit-identical worlds');
  assert.equal(a.draws, b.draws, 'and the same number of seeded draws');
  assert.equal(a.summary.allies, 1, 'with the wingman actually in the world being hashed');
});

test('a room WITHOUT the flag is the fight that ships: no ally, no allies rows', () => {
  const room = createRoom({ levelName: 'level-4', seed: 4242 });
  stepFor(room, 240, (snap) => {
    assert.deepEqual(snap.allies, [], 'nothing to send');
    for (const s of snap.spawns) assert.notEqual(s.kind, 'ally');
  });
  assert.equal(room.digest().summary.allies, 0);
});

test('the kill event carries `byAlly` over the wire, or a room\'s client would log his kills as yours', () => {
  assert.ok(EVENT_FIELDS.kill.includes('byAlly'));
});
