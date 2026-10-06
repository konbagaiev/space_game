import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inEarshotNdc, EARSHOT_MARGIN } from './earshot.js';

test('on screen is audible; the centre, the corners and the thin band past the edge', () => {
  assert.equal(inEarshotNdc(0, 0, 0.5), true);
  assert.equal(inEarshotNdc(1, -1, 0.5), true, 'a corner of the frame');
  assert.equal(inEarshotNdc(1 + EARSHOT_MARGIN * 0.9, 0, 0.5), true, 'just past the edge, inside the margin');
});

test('off screen is silent: past the margin on either axis, behind the camera, or not a number', () => {
  assert.equal(inEarshotNdc(1 + EARSHOT_MARGIN * 1.1, 0, 0.5), false);
  assert.equal(inEarshotNdc(0, -3, 0.5), false);
  assert.equal(inEarshotNdc(0, 0, 1.2), false, 'behind the camera projects |z| > 1');
  assert.equal(inEarshotNdc(NaN, 0, 0.5), false);
  assert.equal(inEarshotNdc(0, 0, NaN), false);
});

test('the margin is a parameter: 0 means strictly the frame', () => {
  assert.equal(inEarshotNdc(1.05, 0, 0, 0), false);
  assert.equal(inEarshotNdc(1.0, 0, 0, 0), true);
});
