#!/usr/bin/env node
// How many bot-brawl rooms fit on one core? (docs/plans/2026-10-06-1530-server-brawl.md S8, the roadmap's
// "rooms per core at N = 20/50/100" question.)
//
//   node server/tools/brawl-capacity.mjs [--n 20,50,100] [--k 1,2,4,8] [--sec 60]
//
// For each (N, K): K brawl rooms of N v N are created exactly the way a `?netbrawl` join creates them
// (`createRoom({ brawl: N })`), each armed by one input, and all K are stepped ROUND-ROBIN on this one thread
// for `sec × 60` ticks. Every `stepOnce` is timed, and on snapshot ticks so is `JSON.stringify(takeSnapshot())`
// (its time and its length). One table row per (N, K):
//   step ms avg / p95 / max · snap ms avg / max · snapshot KB avg / max · KB/s per client (avg bytes × 30)
//   process ms per wall second per room = 60 × stepAvg + 30 × snapAvg
//   rooms per core = floor(1000 / that), plus the same figure from the p95 step (a pessimistic bound)
// …and the same for the FIRST 10 SIM-SECONDS only, because the fight thins out fast (at N = 100 it is
// ~16 v 3 by 60 s) and full load is what a capacity number has to survive.
//
// WHAT IT LEAVES OUT. It runs in-process with no sockets, so WebSocket framing, kernel send cost and the
// event loop's other work are not in it — the live `srv` block (`snapMs`, `proc.cpuPct`) covers those. All
// K rooms share `BRAWL_SEED`, and the seeded stream is process-global (SUMMARY: a known limitation), which
// is harmless here: a brawl draws nothing from it. The run is bounded (K × N ≤ 800 ships a side in total)
// so it cannot exhaust memory on a laptop.
import { performance } from 'node:perf_hooks';
import { createRoom } from '../src/netsim/room.js';
import { BRAWL_WINDOW_TICKS } from '../../client/src/sim-core/brawl.js';

const MAX_SHIPS = 800;   // K × N cap

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const list = (s) => String(s).split(',').map((x) => Number.parseInt(x, 10)).filter((x) => Number.isFinite(x) && x > 0);

const NS = list(arg('n', '20,50,100'));
const KS = list(arg('k', '1,2,4,8'));
const SEC = Math.max(1, Number.parseInt(arg('sec', '60'), 10) || 60);

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f = (x, d = 2) => x.toFixed(d);

function summarize(step, snapMs, bytes) {
  const s = [...step].sort((a, b) => a - b);
  const stepAvg = mean(step), stepP95 = pct(s, 95), stepMax = s[s.length - 1] || 0;
  const snapAvg = mean(snapMs), snapMax = Math.max(0, ...snapMs);
  const kbAvg = mean(bytes) / 1024, kbMax = Math.max(0, ...bytes) / 1024;
  const perRoom = 60 * stepAvg + 30 * snapAvg;
  const perRoomP95 = 60 * stepP95 + 30 * snapAvg;
  return {
    stepAvg, stepP95, stepMax, snapAvg, snapMax, kbAvg, kbMax, kbps: kbAvg * 30, perRoom,
    roomsPerCore: perRoom > 0 ? Math.floor(1000 / perRoom) : Infinity,
    roomsPerCoreP95: perRoomP95 > 0 ? Math.floor(1000 / perRoomP95) : Infinity,
  };
}

function run(n, k) {
  const rooms = Array.from({ length: k }, () => {
    const r = createRoom({ levelName: 'level-1', brawl: n });
    r.pushInput([{ t: 0, k: [] }]);   // arms it on its first step
    return r;
  });
  const all = { step: [], snapMs: [], bytes: [] };
  const early = { step: [], snapMs: [], bytes: [] };
  const ticks = SEC * 60;
  for (let t = 0; t < ticks; t++) {
    for (const r of rooms) {
      const inEarly = r.world.brawl.ticks < BRAWL_WINDOW_TICKS;
      const s0 = performance.now(); r.stepOnce(); const dt = performance.now() - s0;
      all.step.push(dt); if (inEarly) early.step.push(dt);
      if (r.dueForSnapshot()) {
        const s1 = performance.now(); const len = JSON.stringify(r.takeSnapshot()).length; const ds = performance.now() - s1;
        all.snapMs.push(ds); all.bytes.push(len);
        if (inEarly) { early.snapMs.push(ds); early.bytes.push(len); }
      }
    }
  }
  const alive = rooms[0].world.brawl;
  return { all: summarize(all.step, all.snapMs, all.bytes), early: summarize(early.step, early.snapMs, early.bytes),
           end: `${rooms[0].world.allies.length} v ${rooms[0].world.enemies.length}${alive.ended ? ' (ended)' : ''}` };
}

const head = ['N', 'K', 'span', 'step avg/p95/max ms', 'snap avg/max ms', 'snap KB avg/max', 'KB/s/client',
              'ms/s/room', 'rooms/core (avg|p95)', 'end'];
console.log(`brawl capacity — ${SEC} sim-s per run, in-process (no sockets), node ${process.version}`);
console.log(head.join(' | '));
for (const n of NS) {
  for (const k of KS) {
    if (n * k > MAX_SHIPS) { console.log(`${n} | ${k} | skipped (K × N > ${MAX_SHIPS})`); continue; }
    const r = run(n, k);
    for (const [span, x] of [['all', r.all], ['first 10 s', r.early]]) {
      console.log([n, k, span, `${f(x.stepAvg)}/${f(x.stepP95)}/${f(x.stepMax)}`, `${f(x.snapAvg)}/${f(x.snapMax)}`,
                   `${f(x.kbAvg, 1)}/${f(x.kbMax, 1)}`, f(x.kbps, 0), f(x.perRoom, 1),
                   `${x.roomsPerCore}|${x.roomsPerCoreP95}`, span === 'all' ? r.end : ''].join(' | '));
    }
  }
}
