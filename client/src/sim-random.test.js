import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mulberry32, seedSim, simRandom, isSimSeeded } from './sim-random.js';

// The seeded stream is process-global (one module instance), so every test that installs a seed clears it
// again — the teardown invariant this module exists to guarantee.
const withNativeStub = (value, fn) => {
  const prev = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = prev; }
};

test('mulberry32: same seed reproduces the same sequence; different seeds diverge', () => {
  const a = mulberry32(1234567), b = mulberry32(1234567);
  const seqA = Array.from({ length: 8 }, () => a());
  const seqB = Array.from({ length: 8 }, () => b());
  assert.deepEqual(seqA, seqB);

  const c = mulberry32(7654321);
  assert.notDeepEqual(seqA, Array.from({ length: 8 }, () => c()));
  for (const x of seqA) assert.ok(x >= 0 && x < 1);
});

test('seedSim: two fresh streams from the same seed produce identical sequences', () => {
  seedSim(1234567);
  const first = Array.from({ length: 8 }, () => simRandom());
  seedSim(1234567);
  const second = Array.from({ length: 8 }, () => simRandom());
  assert.deepEqual(first, second);
  seedSim(7654321);
  assert.notDeepEqual(first, Array.from({ length: 8 }, () => simRandom()));
  seedSim(null);
});

test('seedSim(n) twice rewinds to the same first value (record/playback rely on it)', () => {
  seedSim(7);
  const a = simRandom(); simRandom(); simRandom();
  seedSim(7);
  assert.equal(simRandom(), a);
  seedSim(null);
});

test('simRandom(): with no seed installed it draws the native Math.random (live play)', () => {
  seedSim(null);
  assert.equal(isSimSeeded(), false);
  withNativeStub(0.4242, () => {
    assert.equal(simRandom(), 0.4242);
    assert.equal(simRandom(), 0.4242);
  });
});

test('seedSim(null) really returns to live play (the teardown invariant)', () => {
  seedSim(7);
  assert.equal(isSimSeeded(), true);
  withNativeStub(0.4242, () => {
    assert.notEqual(simRandom(), 0.4242);   // seeded stream, not the native stub
    seedSim(null);                          // == finishIntro()/stopRecordSession() teardown
    assert.equal(isSimSeeded(), false);
    assert.equal(simRandom(), 0.4242);      // back on the native RNG
  });
});
