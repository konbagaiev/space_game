import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyForm } from './device.js';

test('classifyForm — form-factor breakpoints (longest edge)', () => {
  assert.equal(classifyForm(320), 'phone');
  assert.equal(classifyForm(899), 'phone');
  assert.equal(classifyForm(900), 'tablet');
  assert.equal(classifyForm(1279), 'tablet');
  assert.equal(classifyForm(1280), 'desktop');
  assert.equal(classifyForm(1919), 'desktop');
  assert.equal(classifyForm(1920), 'desktop-lg');
  assert.equal(classifyForm(3840), 'desktop-lg');
});
