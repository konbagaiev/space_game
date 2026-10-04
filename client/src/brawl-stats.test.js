import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFrames, windowStats, windowOf, brawlShouldEnd, buildBrawlResult, formatBrawlCard } from './brawl-stats.js';

test('summarizeFrames: avg, floor-index p95, worst and fps on a known array', () => {
  const ms = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
  const s = summarizeFrames(ms, 2);
  assert.equal(s.frames, 20);
  assert.equal(s.avgMs, 105);
  assert.equal(s.p95Ms, 200, 'floor(0.95 × 20) = index 19');
  assert.equal(s.worstMs, 200);
  assert.equal(s.fps, 10);
  assert.deepEqual(summarizeFrames([], 1), { frames: 0, avgMs: 0, p95Ms: 0, worstMs: 0, fps: 0 });
});

test('windowStats: frames split by the tick at frame end into 600-tick windows; the partial tail is flagged', () => {
  assert.equal(windowOf(0, 600), 0);
  assert.equal(windowOf(600, 600), 0, 'tick 600 is the last tick of window 0');
  assert.equal(windowOf(601, 600), 1);
  const samples = [
    { ms: 10, tick: 6, inFrame: 40 }, { ms: 30, tick: 300, inFrame: 38 }, { ms: 20, tick: 600, inFrame: 36 },
    { ms: 50, tick: 606, inFrame: 20 }, { ms: 50, tick: 900, inFrame: 10 },
  ];
  const rows = windowStats(samples, 600);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { w: 0, fromSec: 0, toSec: 10, avgMs: 20, p95Ms: 30, worstMs: 30, frames: 3, meanInFrame: 38, partial: false });
  assert.equal(rows[1].partial, true);
  assert.equal(rows[1].toSec, 15);
  assert.equal(rows[1].meanInFrame, 15);
});

test('brawlShouldEnd: wipe-out wins over time; neither → null', () => {
  assert.equal(brawlShouldEnd({ wallMs: 1000, secLimit: 60, over: true }), 'wipeout');
  assert.equal(brawlShouldEnd({ wallMs: 60000, secLimit: 60, over: false }), 'time');
  assert.equal(brawlShouldEnd({ wallMs: 59999, secLimit: 60, over: false }), null);
});

test('buildBrawlResult: the sim/wall ratio and the result kind', () => {
  const r = buildBrawlResult({ n: 20, tier: 'balance', res: '1600x800', dpr: 2, wallSec: 60, simSec: 45, frameMs: [16, 17] });
  assert.equal(r.kind, 'brawl-result');
  assert.equal(r.ratio, 0.75);
  assert.equal(r.overall.frames, 2);
  assert.equal(r.interrupted, false);
});

test('formatBrawlCard: carries sim/wall, p95, the window table with "full load", and the engine note', () => {
  const r = buildBrawlResult({
    n: 20, tier: 'performance', res: '1600x800', dpr: 2, wallSec: 60, simSec: 20, frameMs: [16],
    windows: [
      { w: 0, fromSec: 0, toSec: 10, avgMs: 16, p95Ms: 20, worstMs: 30, frames: 600, meanInFrame: 30, partial: false, alive: [19, 20] },
      { w: 1, fromSec: 10, toSec: 20, avgMs: 15, p95Ms: 18, worstMs: 25, frames: 600, meanInFrame: 25, partial: false, alive: [15, 16] },
    ],
    interrupted: true, engine: 'Chromium/140.0.0.0',
  });
  const c = formatBrawlCard(r);
  const text = JSON.stringify(c);
  assert.ok(text.includes('sim/wall'));
  assert.ok(text.includes('p95'));
  assert.ok(text.includes('full load'));
  assert.ok(text.includes('INTERRUPTED'));
  assert.ok(text.includes('Chromium/140.0.0.0'), 'the engine string is shown as-is');
  assert.equal(c.table.body.length, 2);
  assert.ok(c.note.includes('same JS engine'));
});
