import { test } from 'node:test';
import assert from 'node:assert/strict';
// The autopilot dock/win predicate is pure (THREE-free), so it is node-testable directly. The critical
// invariant: a chest-aimed (drop-target) autopilot can NEVER dock/win the mission — only a station target
// within the arrive radius does.
import { BASE_ARRIVE_RADIUS, canDock } from './autopilot-config.js';

const station = (active) => ({ active, phase: 'brake0', target: { kind: 'station' } });
const drop = (active) => ({ active, phase: 'brake0', target: { kind: 'drop', drop: {} } });

test('canDock: a drop-targeted autopilot never docks, even at dist 0', () => {
  assert.equal(canDock(drop(true), 0), false);
  assert.equal(canDock(drop(true), BASE_ARRIVE_RADIUS), false);
});

test('canDock: false when the autopilot is inactive', () => {
  assert.equal(canDock(station(false), 0), false);
});

test('canDock: false when outside the arrive radius', () => {
  assert.equal(canDock(station(true), BASE_ARRIVE_RADIUS + 1), false);
});

test('canDock: true for an engaged station-targeted autopilot within the radius', () => {
  assert.equal(canDock(station(true), 0), true);
  assert.equal(canDock(station(true), BASE_ARRIVE_RADIUS), true);
});

test('canDock: guards a null/target-less autopilot', () => {
  assert.equal(canDock(null, 0), false);
  assert.equal(canDock({ active: true, target: null }, 0), false);
});
