import { test } from 'node:test';
import assert from 'node:assert/strict';
// tap-gesture is pure (no DOM), so it's node-testable directly. A single-finger gesture is a TAP until it
// travels beyond TAP_SLOP px from its touchstart point (measured in rotated game space); beyond that it's a
// DRAG (steering). These cover the slop boundary the touch handler relies on.
import { TAP_SLOP, exceedsSlop } from './tap-gesture.js';

test('TAP_SLOP is 10px', () => {
  assert.equal(TAP_SLOP, 10);
});

test('within slop → false (still a tap)', () => {
  assert.equal(exceedsSlop(0, 0, 0, 0), false);        // no movement
  assert.equal(exceedsSlop(0, 0, 7, 0), false);        // 7px straight
  assert.equal(exceedsSlop(0, 0, 7, 7), false);        // ~9.9px diagonal
  assert.equal(exceedsSlop(100, 100, 106, 108), false); // 10px from an offset origin (not the axis)
});

test('exactly at 10px is not "exceeds" (> slop, so the boundary is a tap)', () => {
  assert.equal(exceedsSlop(0, 0, 10, 0), false);
  assert.equal(exceedsSlop(0, 0, 6, 8), false);        // 3-4-5 → exactly 10px
});

test('beyond slop → true (it is now a drag)', () => {
  assert.equal(exceedsSlop(0, 0, 11, 0), true);
  assert.equal(exceedsSlop(0, 0, 0, 20), true);
  assert.equal(exceedsSlop(0, 0, 8, 8), true);          // ~11.3px diagonal
});

test('custom slop argument is honored', () => {
  assert.equal(exceedsSlop(0, 0, 15, 0, 20), false);
  assert.equal(exceedsSlop(0, 0, 25, 0, 20), true);
});
