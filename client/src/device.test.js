import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyForm } from './device.js';

test('classifyForm — phone by SHORTEST edge, larger tiers by LONGEST edge', () => {
  // Square-ish single-arg viewports (shortest defaults to longest): tiers keyed off the one dimension.
  assert.equal(classifyForm(320), 'phone');        // 320×320 — short edge < 600
  assert.equal(classifyForm(599), 'phone');        // just under the phone cutoff
  assert.equal(classifyForm(600), 'tablet');       // short edge ≥ 600 → not a phone
  assert.equal(classifyForm(1279), 'tablet');
  assert.equal(classifyForm(1280), 'desktop');
  assert.equal(classifyForm(1919), 'desktop');
  assert.equal(classifyForm(1920), 'desktop-lg');
  assert.equal(classifyForm(3840), 'desktop-lg');
});

test('classifyForm — a long, narrow phone stays a phone regardless of its long edge (Fold-cover fix)', () => {
  // Galaxy Fold cover ≈ 369×905 CSS px. Before the fix, hiding the browser chrome pushed the long edge
  // past 900 and flipped phone→tablet mid-session, ballooning the loadout. Short edge 369 keeps it a phone.
  assert.equal(classifyForm(905, 369), 'phone');   // fullscreen (chrome hidden) — long edge ≥ 900
  assert.equal(classifyForm(880, 369), 'phone');   // windowed (chrome shown) — long edge < 900
  assert.equal(classifyForm(932, 430), 'phone');   // large phone (e.g. iPhone Pro Max) — used to be tablet
});

test('classifyForm — a real tablet is NOT a phone even in a phone-ish aspect', () => {
  assert.equal(classifyForm(1133, 744), 'tablet'); // iPad mini — short edge 744 ≥ 600
  assert.equal(classifyForm(1024, 768), 'tablet'); // classic 4:3 tablet
});
