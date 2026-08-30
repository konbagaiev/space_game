// The hit-feel invariants that are REQUIREMENTS rather than tunables (docs/plans/2026-08-30-1505-combat-hit-feel.md).
//
// Every magnitude in HIT_FX is a placeholder the maintainer tunes in the ?dev panel, so there is nothing
// worth asserting about the numbers. What must not drift is the SHAPE of the feature: the impulse is
// instant-out and eases back, a new hit refreshes instead of accumulating, a salvo cannot stack, and zero
// jitter reproduces today's uniform tracer.
//
// The OTHER rule of this feature — "did it reach the hull" is `toHull > 0`, not `!absorbed` — is not here,
// because it is not a pure function: it is what the six sim-side emit sites decide. It is guarded where it
// actually lives — `components.test.js` pins the `{ absorbed, broke, toHull }` contract (including the
// break-with-spill case) and `visual/scenarios/42-hit-feel.mjs` fires a real rocket into a PARTIAL shield
// and asserts the shield broke AND the camera shuddered. A mirror of the predicate living here would read
// like coverage of those call sites while guarding nothing (DECISIONS §30).
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { HIT_FX, impulse01, makeImpulse, refreshImpulse, ageImpulse, tracerLook } from './hit-fx-config.js';

// --- D6a: instant displacement out, smooth ease back ---
test('impulse01 starts at FULL (no ramp-in) and is finished at/after its duration', () => {
  assert.equal(impulse01(0), 1);
  assert.equal(impulse01(-0.5), 1); // defensive: a negative age is still "just hit"
  assert.equal(impulse01(1), 0);
  assert.equal(impulse01(2), 0);
});

test('impulse01 decreases monotonically across its life', () => {
  let prev = impulse01(0);
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const v = impulse01(t);
    assert.ok(v < prev, `impulse01(${t.toFixed(2)}) = ${v} is not below the previous ${prev}`);
    prev = v;
  }
});

test('impulse01 DECELERATES into rest — it settles instead of snapping back', () => {
  const early = impulse01(0.0) - impulse01(0.1);
  const late  = impulse01(0.9) - impulse01(1.0);
  assert.ok(late < early, `the last slice (${late}) must move less than the first (${early})`);
});

// --- D6b: refresh, never accumulate ---
test('a second hit RESETS the impulse rather than summing with the one in flight', () => {
  const st = makeImpulse();
  assert.equal(refreshImpulse(st, 0.2, 0), true);
  ageImpulse(st, 0.1);                       // halfway through
  assert.ok(st.age > 0);
  const mid = impulse01(st.age / st.dur);
  assert.ok(mid > 0 && mid < 1);
  assert.equal(refreshImpulse(st, 0.2, 0), true);
  assert.equal(st.age, 0, 'age is reset, not carried');
  const v = ageImpulse(st, 1 / 60);
  assert.ok(v > 0.8 && v <= 1, `the refreshed impulse is back to ~full (got ${v})`);
  // and it can never exceed 1, however many hits land
  for (let i = 0; i < 20; i++) { refreshImpulse(st, 0.2, 0); assert.ok(ageImpulse(st, 1 / 60) <= 1); }
});

// --- D6c: the salvo cooldown ---
test('a cooldown drops the rest of a salvo — a triple warhead punches ONCE', () => {
  const st = makeImpulse();
  assert.equal(refreshImpulse(st, 0.12, 0.15), true,  'the first warhead lands');
  assert.equal(refreshImpulse(st, 0.12, 0.15), false, 'the second, in the same instant, is dropped');
  ageImpulse(st, 0.01);
  assert.equal(refreshImpulse(st, 0.12, 0.15), false, 'and so is the third, 10 ms later');
  // …and once the cooldown has run out, the next real hit is taken again.
  for (let i = 0; i < 20; i++) ageImpulse(st, 0.01); // 0.20 s > 0.15 s cooldown
  assert.equal(st.cool, 0);
  assert.equal(refreshImpulse(st, 0.12, 0.15), true, 'a hit after the cooldown is accepted');
});

test('an impulse goes inactive once its duration is spent', () => {
  const st = makeImpulse();
  refreshImpulse(st, 0.1, 0);
  for (let i = 0; i < 10; i++) ageImpulse(st, 0.02);
  assert.equal(st.active, false);
  assert.equal(ageImpulse(st, 0.02), 0);
});

// --- D9: tracers vary, and zero jitter restores today's look exactly ---
test('tracerLook with zero jitter is EXACTLY the class base (both classes)', () => {
  const cfg = { kineticLen: 1.0, kineticBright: 1.0, cannonLen: 1.9, cannonBright: 1.35, jitterLen: 0, jitterBright: 0 };
  assert.deepEqual(tracerLook('kinetic', cfg, Math.random), { len: 1.0, bright: 1.0 });
  assert.deepEqual(tracerLook('cannon', cfg, Math.random), { len: 1.9, bright: 1.35 });
});

test('tracerLook reproduces the historical BOLT_SCALE numbers when tuned back to them', () => {
  // BOLT_SCALE was { kinetic: 1, cannon: 1.7 } and every bolt was a clone of the last: the "0 restores the
  // old look" contract this feature promises.
  const uniform = { kineticLen: 1.0, kineticBright: 1, cannonLen: 1.7, cannonBright: 1, jitterLen: 0, jitterBright: 0 };
  assert.equal(tracerLook('kinetic', uniform).len, 1);
  assert.equal(tracerLook('cannon', uniform).len, 1.7);
  assert.equal(tracerLook('kinetic', uniform).bright, 1);
  assert.equal(tracerLook('cannon', uniform).bright, 1);
});

test('tracerLook jitter is a symmetric fraction around the base', () => {
  const cfg = { kineticLen: 2, kineticBright: 1, cannonLen: 4, cannonBright: 2, jitterLen: 0.25, jitterBright: 0.2 };
  const lo = tracerLook('kinetic', cfg, () => 0);   // rand 0 → the lower bound
  const hi = tracerLook('kinetic', cfg, () => 1);   // rand 1 → the upper bound
  assert.equal(lo.len, 2 * 0.75);
  assert.equal(hi.len, 2 * 1.25);
  assert.equal(lo.bright, 1 * 0.8);
  assert.equal(hi.bright, 1 * 1.2);
  const mid = tracerLook('cannon', cfg, () => 0.5); // rand 0.5 → dead on the base
  assert.equal(mid.len, 4);
  assert.equal(mid.bright, 2);
});

test('an unknown weapon class falls back to the kinetic tracer', () => {
  const cfg = { ...HIT_FX.tracer, jitterLen: 0, jitterBright: 0 };
  assert.deepEqual(tracerLook('beam', cfg), tracerLook('kinetic', cfg));
  assert.deepEqual(tracerLook(undefined, cfg), tracerLook('kinetic', cfg));
});

test('the shipped defaults are the shape the panel and the FX read', () => {
  for (const k of ['flash', 'punch', 'shake', 'tracer']) assert.ok(HIT_FX[k], `HIT_FX.${k} exists`);
  // D5: both punch channels ship OFF — the maintainer picks the natural one in flight.
  assert.equal(HIT_FX.punch.shove, 0);
  assert.equal(HIT_FX.punch.pop, 0);
  assert.ok(HIT_FX.punch.cooldown > 0, 'the salvo cooldown is a requirement, not an option');
  assert.ok(HIT_FX.shake.cooldown > 0);
});
