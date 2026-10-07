import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBrawlCount, evalBrawlDev, applyBrawlDev, brawlActive, brawlDevLevel, brawlTierOverride } from './brawl-dev.js';

test('off for a missing flag and for 0/false/off', () => {
  assert.equal(evalBrawlDev(''), null);
  assert.equal(evalBrawlDev('?debug'), null);
  for (const v of ['0', 'false', 'off']) assert.equal(evalBrawlDev(`?brawl=${v}`), null);
});

test('a bare ?brawl shows the setup panel (n: null) with the defaults', () => {
  assert.deepEqual(evalBrawlDev('?brawl'), { n: null, tier: null, sec: 60, server: false });
  assert.deepEqual(evalBrawlDev('?debug&brawl'), { n: null, tier: null, sec: 60, server: false });
});

test('n clamps to 1..100; a garbage or negative count falls back to 20', () => {
  assert.equal(evalBrawlDev('?brawl=999').n, 100);
  assert.equal(evalBrawlDev('?brawl=1').n, 1);
  assert.equal(evalBrawlDev('?brawl=12').n, 12);
  assert.equal(evalBrawlDev('?brawl=-3').n, 20);
  assert.equal(evalBrawlDev('?brawl=abc').n, 20);
});

test('tier must be a real tier; sec clamps to 10..300', () => {
  assert.equal(evalBrawlDev('?brawl=5&tier=garbage').tier, null);
  assert.equal(evalBrawlDev('?brawl=5&tier=performance').tier, 'performance');
  assert.equal(evalBrawlDev('?brawl=5&sec=3').sec, 10);
  assert.equal(evalBrawlDev('?brawl=5&sec=9999').sec, 300);
  assert.equal(evalBrawlDev('?brawl=5&sec=45').sec, 45);
});

test('with the flag off (node has no location) everything is inert and applyBrawlDev is the identity', () => {
  assert.equal(brawlActive(), false);
  assert.equal(brawlDevLevel(), null);
  assert.equal(brawlTierOverride(), null);
  const x = { phases: [] };
  assert.equal(applyBrawlDev(x), x, 'the SAME object back');
  assert.notEqual(applyBrawlDev(x, { n: 5 }), x, '…and a brawl room when on');
});

test('parseBrawlCount: digits are clamped to 1..100; anything else keeps the count already shown', () => {
  assert.equal(parseBrawlCount('37', 20), 37);
  assert.equal(parseBrawlCount(' 64 ', 20), 64);
  assert.equal(parseBrawlCount('500', 20), 100, 'over the top clamps to the max');
  assert.equal(parseBrawlCount('0', 20), 1, 'zero clamps to the min');
  assert.equal(parseBrawlCount('', 37), 37, 'an emptied field keeps the last count');
  assert.equal(parseBrawlCount('abc', 37), 37);
  assert.equal(parseBrawlCount('-5', 37), 37, 'a minus sign is not a digit');
  assert.equal(parseBrawlCount('4.5', 37), 37);
  assert.equal(parseBrawlCount(undefined), 20, 'no fallback given → the default');
});

test('?netbrawl: the same flag simulated by a server room — it wins over ?brawl, and off falls through', () => {
  assert.deepEqual(evalBrawlDev('?netbrawl=12'), { n: 12, tier: null, sec: 60, server: true });
  assert.deepEqual(evalBrawlDev('?netbrawl'), { n: null, tier: null, sec: 60, server: true }, 'bare = setup panel');
  for (const v of ['0', 'false', 'off']) assert.equal(evalBrawlDev(`?netbrawl=${v}`), null);
  const both = evalBrawlDev('?brawl=5&netbrawl=7');
  assert.equal(both.n, 7); assert.equal(both.server, true);
  assert.equal(evalBrawlDev('?brawl=5').server, false);
  assert.deepEqual(evalBrawlDev('?netbrawl=off&brawl=5'), { n: 5, tier: null, sec: 60, server: false });
  assert.equal(evalBrawlDev('?netbrawl=999&tier=performance&sec=20').n, 100, 'the same clamps');
  assert.equal(evalBrawlDev('?netbrawl=4&tier=performance&sec=20').tier, 'performance');
  assert.equal(evalBrawlDev('?netbrawl=4&sec=20').sec, 20);
});
