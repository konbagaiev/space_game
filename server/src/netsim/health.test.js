// The process health sampler (docs/plans/2026-10-06-1530-server-brawl.md, Decision 16): one timer, cached
// readings, stoppable — so two rooms never reset each other's event-loop window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealth } from './health.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the sampler caches numeric process readings, starts one timer however often it is asked, and stops', async () => {
  const h = createHealth();
  assert.equal(h.latest(), null, 'nothing before the first reading');
  h.startSampler(20);
  h.startSampler(20);   // idempotent
  assert.equal(h.sampling, true);
  // Busy a little so CPU is non-trivial, then let a few intervals pass.
  const until = Date.now() + 15; while (Date.now() < until) { /* spin */ }
  await wait(80);
  const s = h.latest();
  assert.ok(s, 'a reading is cached');
  for (const k of ['cpuPct', 'rssMB', 'heapMB', 'loopP99', 'loopP50', 'loopMax', 'load1', 'cores']) {
    assert.equal(typeof s[k], 'number', `${k} is a number`);
  }
  assert.ok(!('oversubscribed' in s), 'the getter is not copied');
  assert.ok(s.rssMB > 0);
  // line() reads the cache while sampling — it must not reset the shared window.
  assert.match(h.line(), /event loop p50/);
  h.stop();
  assert.equal(h.sampling, false, 'stop() clears the timer');
  const frozen = h.latest();
  await wait(50);
  assert.equal(h.latest(), frozen, 'no more readings after stop()');
});
