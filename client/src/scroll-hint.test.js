import test from 'node:test';
import assert from 'node:assert/strict';
import { hintState, HINT_TOL } from './scroll-hint.js';

// `hintState` is the whole decision the scroll affordance makes: given a scroller's metrics, which edge
// chevron should be lit. The DOM/observer wiring around it is thin by design (attachScrollHint).

test('a panel whose text fits shows no chevron at all', () => {
  assert.deepEqual(hintState({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 }), { up: false, down: false });
  assert.deepEqual(hintState({ scrollTop: 0, scrollHeight: 120, clientHeight: 300 }), { up: false, down: false },
    'content shorter than the panel is not "more text below"');
});

test('a clipped panel at the top points DOWN only — the phone case the feature exists for', () => {
  // A level briefing typed into a short phone work zone: text continues below the fold, nothing above.
  assert.deepEqual(hintState({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 }), { up: false, down: true });
});

test('scrolled to the middle points BOTH ways, and at the bottom UP only', () => {
  assert.deepEqual(hintState({ scrollTop: 300, scrollHeight: 900, clientHeight: 300 }), { up: true, down: true });
  assert.deepEqual(hintState({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 }), { up: true, down: false },
    'at the very end the down chevron must go out — it would be pointing at nothing');
});

test('sub-pixel slack does not light a chevron pointing at nothing', () => {
  // Fractional devicePixelRatio / sub-pixel layout leaves scrollTop a hair off 0 and off the maximum.
  const nearTop = hintState({ scrollTop: 0.5, scrollHeight: 900, clientHeight: 300 });
  assert.equal(nearTop.up, false, 'half a pixel from the top is still the top');
  const nearEnd = hintState({ scrollTop: 599.5, scrollHeight: 900, clientHeight: 300 });
  assert.equal(nearEnd.down, false, 'half a pixel from the end is still the end');
  // And an overflow smaller than the tolerance isn't worth a chevron.
  assert.deepEqual(hintState({ scrollTop: 0, scrollHeight: 301, clientHeight: 300 }), { up: false, down: false });
  assert.ok(HINT_TOL > 0 && HINT_TOL < 8, 'the tolerance is slack, not a real scroll distance');
});

test('a panel that is not laid out yet (hidden view) shows nothing', () => {
  // .mw-view is display:none until its menu item is selected → clientHeight 0 with a real scrollHeight.
  assert.deepEqual(hintState({ scrollTop: 0, scrollHeight: 900, clientHeight: 0 }), { up: false, down: false });
  assert.deepEqual(hintState(null), { up: false, down: false });
  assert.deepEqual(hintState({}), { up: false, down: false });
});
