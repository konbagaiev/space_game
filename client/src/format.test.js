import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { setSource, setBundle } from './i18n.js';
import { esc, cssColor, slotLabel, priceLabel, sellLabel, SELL_RATE } from './format.js';

// Seed a tiny English catalog so the i18n-aware helpers resolve to real strings.
setBundle({});
setSource({
  'ui.shop.free': { source: 'Free' },
  'ui.shop.slot.hull': { source: 'Hull' },
});

test('esc: escapes the HTML-significant characters', () => {
  assert.equal(esc('<a href="x">b & c</a>'), '&lt;a href=&quot;x&quot;&gt;b &amp; c&lt;/a&gt;');
  assert.equal(esc('plain'), 'plain');
  assert.equal(esc(42), '42'); // coerces non-strings
});

test('cssColor: 0xRRGGBB int → #rrggbb, zero-padded', () => {
  assert.equal(cssColor(0xff8800), '#ff8800');
  assert.equal(cssColor(0x000010), '#000010');
  assert.equal(cssColor(0xffffff), '#ffffff');
});

test('slotLabel: translates a known slot, falls back to the raw key', () => {
  assert.equal(slotLabel('hull'), 'Hull');
  assert.equal(slotLabel('thruster'), 'ui.shop.slot.thruster'); // no entry → key fallback
});

test('priceLabel: positive shows credits, zero/free is localized', () => {
  assert.equal(priceLabel(12), '12 ◈');
  assert.equal(priceLabel(0), 'Free');
});

test('sellLabel: floor(price * SELL_RATE) credits, free when zero', () => {
  assert.equal(SELL_RATE, 0.75);
  assert.equal(sellLabel(100), '75 ◈');
  assert.equal(sellLabel(11), '8 ◈'); // floor(8.25)
  assert.equal(sellLabel(0), 'Free');
});
