import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFrames, windowStats, windowOf, brawlShouldEnd, buildBrawlResult, formatBrawlCard, serverWindowStats, summarizeSrv } from './brawl-stats.js';

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

// --- ?netbrawl: the server's numbers ---
const srvAt = (tick, { p95 = 1, sum = 30720, loop = 2, cpu = 10, ticks = 60, behind = 0, max = 2048, buf = 0 } = {}) => ({
  tick, ticks, behind, stepMs: { avg: p95 / 2, p95, max: p95 * 2 }, snapMs: { avg: 0.1, max: 0.2 },
  snapBytes: { sum, max }, snapPerSec: 30, bufMax: buf, proc: { loopP99: loop, cpuPct: cpu, rssMB: 80 },
});

test('serverWindowStats groups the per-second srv samples into the card\'s 10-sim-second windows', () => {
  const xs = [srvAt(60, { p95: 1 }), srvAt(600, { p95: 3, loop: 9 }), srvAt(601, { p95: 2, sum: 10240 }), srvAt(1200)];
  const w = serverWindowStats(xs, 600);
  assert.deepEqual(w.map((x) => x.w), [0, 1]);
  assert.equal(w[0].stepP95, 3, 'the worst p95 of the window (tick 600 is window 0)');
  assert.equal(w[0].loopP99, 9);
  assert.equal(w[0].kbps, 30);
  assert.equal(w[1].kbps, 20, 'the mean of 10 and 30 KB/s');
  assert.deepEqual(serverWindowStats([], 600), []);
});

test('summarizeSrv: the run\'s server summary, or null without samples', () => {
  assert.equal(summarizeSrv([]), null);
  assert.equal(summarizeSrv(null), null);
  const s = summarizeSrv([srvAt(60, { p95: 1, ticks: 60, cpu: 10, max: 4096, buf: 2048 }),
                          srvAt(120, { p95: 4, ticks: 55, behind: 5, cpu: 30, loop: 7, sum: 61440 })]);
  assert.equal(s.stepP95, 4);
  assert.equal(s.stepMax, 8);
  assert.equal(s.ticksMin, 55);
  assert.equal(s.behind, 5);
  assert.equal(s.kbpsAvg, 45);
  assert.equal(s.kbpsMax, 60);
  assert.equal(s.snapKbMax, 4);
  assert.equal(s.cpuAvg, 20);
  assert.equal(s.loopP99Max, 7);
  assert.equal(s.rssMaxMB, 80);
  assert.equal(s.bufMaxKB, 2);
});

test('formatBrawlCard says who simulated the run; a server run adds its rows and three columns', () => {
  const windows = [{ w: 0, fromSec: 0, toSec: 10, avgMs: 16, p95Ms: 20, worstMs: 30, frames: 600, meanInFrame: 30, partial: false, alive: [19, 20] },
                   { w: 1, fromSec: 10, toSec: 20, avgMs: 15, p95Ms: 18, worstMs: 25, frames: 600, meanInFrame: 25, partial: false, alive: [15, 16] }];
  const local = formatBrawlCard(buildBrawlResult({ n: 5, tier: 'performance', res: '1x1', dpr: 1, wallSec: 10, simSec: 10, windows }));
  assert.deepEqual(local.rows[0], ['Simulated by', 'this tab']);
  assert.equal(local.table.head.length, 6, 'the old six columns');
  assert.ok(!JSON.stringify(local).includes('Server step'));

  const xs = [srvAt(60, { p95: 1 }), srvAt(600, { p95: 3 })];
  const r = buildBrawlResult({ n: 5, tier: 'performance', res: '1x1', dpr: 1, wallSec: 10, simSec: 10, windows,
    server: true, srv: summarizeSrv(xs), serverWindows: serverWindowStats(xs, 600), endedBy: 'link-lost', closeCode: 1006 });
  assert.equal(r.server, true);
  assert.equal(r.closeCode, 1006);
  const c = formatBrawlCard(r);
  assert.deepEqual(c.rows[0], ['Simulated by', 'server room']);
  assert.deepEqual(c.table.head.slice(-3), ['srv step p95', 'KB/s', 'loop p99']);
  assert.deepEqual(c.table.body[0].slice(-3), ['3', '30', '2'], 'window 0 matched by w');
  assert.deepEqual(c.table.body[1].slice(-3), ['—', '—', '—'], 'a window the server sent nothing for');
  const text = JSON.stringify(c.rows);
  for (const k of ['Server step ms avg / p95 / max', 'Server ticks/s (min)', 'Down KB/s avg / max',
                   'Server CPU % avg (process)', 'Event loop p99 max ms', 'Snapshot KB max']) assert.ok(text.includes(k), k);
  assert.ok(c.rows.some(([k, v]) => k === 'Ended by' && v === 'link-lost'));
  assert.ok(c.rows.some(([k, v]) => k === 'Link closed (code)' && v === '1006'));
});
