import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalBrawlDev, applyBrawlDev, brawlActive, brawlDevLevel, brawlTierOverride } from './brawl-dev.js';

test('off for a missing flag and for 0/false/off', () => {
  assert.equal(evalBrawlDev(''), null);
  assert.equal(evalBrawlDev('?debug'), null);
  for (const v of ['0', 'false', 'off']) assert.equal(evalBrawlDev(`?brawl=${v}`), null);
});

test('a bare ?brawl shows the setup panel (n: null) with the defaults', () => {
  assert.deepEqual(evalBrawlDev('?brawl'), { n: null, tier: null, sec: 60 });
  assert.deepEqual(evalBrawlDev('?debug&brawl'), { n: null, tier: null, sec: 60 });
});

test('n clamps to 1..30; a garbage or negative count falls back to 20', () => {
  assert.equal(evalBrawlDev('?brawl=99').n, 30);
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
