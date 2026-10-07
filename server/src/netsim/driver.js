// The clock. Steps a room at TICK_HZ and hands out snapshots at the slower snapshot rate.
//
// Split out of `room.js` so the room stays clock-free and testable by a for-loop (a test that waits on the
// wall clock is asserting something about the CPU). Everything time-dependent about a live room is here,
// and it is deliberately small.
//
// **Catch-up is bounded.** If the event loop stalls — GC, a slow query on the same process — the naive fix
// is to step however many ticks the elapsed time allows. That turns a hiccup into a spiral: a long stall
// queues a burst of steps, which takes longer, which queues more. The browser's own accumulator caps at 6
// steps per frame for exactly this reason (`main.js`), so this caps too, and drops the excess time on the
// floor: a room that fell behind resumes in the present rather than fast-forwarding the fight.
import { performance } from 'node:perf_hooks';
import { SIM_DT } from '../../../client/src/sim-core/consts.js';
import { health } from './health.js';

export const MAX_CATCHUP_STEPS = 6;

// A gap between pumps past this is not jitter, it is the process being busy with something else — and it is
// felt as the whole world freezing and then jumping. Six ticks at 60 Hz.
export const STALL_LOG_MS = 100;

// THE ROOM'S OWN LOAD (`srv`, docs/plans/2026-10-06-1530-server-brawl.md). Once per wall second the driver
// closes a measurement window — step time per tick, snapshot build+stringify+send time and bytes, the
// largest socket send buffer seen, ticks stepped, ticks dropped to the catch-up cap — and the NEXT snapshot
// carries it as `snap.srv`, with the process figures (`health().latest()`, CPU/RSS/heap/event loop/load) and
// the socket's room counts under `proc`. Every 10th window is also logged as one JSON line
// (`evt: 'netsim-room'`) for the Loki stack. Every room gets it — one code path, near-free.
export const SRV_WINDOW_MS = 1000;
export const SRV_LOG_EVERY = 10;

const r2 = (x) => Math.round(x * 100) / 100;
// The same floor-index percentile `brawl-stats.js` and the devPerf sampler use.
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const statsOf = (xs) => {
  if (!xs.length) return { avg: 0, p95: 0, max: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  return { avg: r2(xs.reduce((a, b) => a + b, 0) / xs.length), p95: r2(pct(sorted, 95)), max: r2(sorted[sorted.length - 1]) };
};

export function createDriver(room, { onSnapshot, intervalMs = 1000 * SIM_DT, now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
                                     hrNow = () => performance.now(), label = null, bufferedAmount = () => 0,
                                     procStats = () => null, healthFn = health, log = console } = {}) {
  let acc = 0;
  let last = now();
  let handle = null;
  let behind = 0; // ticks dropped to the catch-up cap — a diagnostic worth logging if it is ever nonzero
  let stalls = 0; // pumps that arrived late enough to be felt

  // The open measurement window, the finished one waiting for a snapshot to ride on, and the last 10 for
  // the log line's maxima.
  let win = null;
  let pendingSrv = null;
  let lastSrv = null;
  let windows = 0;
  let max10 = { stepMs: 0, snapBytes: 0 };
  const openWindow = (t) => {
    win = { start: t, ticks: 0, step: [], snapMs: [], bytes: 0, bytesMax: 0, snaps: 0, bufMax: 0, behindAt: behind };
  };
  openWindow(now());

  function closeWindow(t) {
    const step = statsOf(win.step), snap = statsOf(win.snapMs);
    let proc = {};
    try { proc = { ...((healthFn && healthFn().latest?.()) || {}), ...((procStats && procStats()) || {}) }; } catch {}
    const srv = {
      t: Date.now(), ticks: win.ticks, behind: behind - win.behindAt,
      stepMs: step, snapMs: { avg: snap.avg, max: snap.max },
      snapBytes: { sum: win.bytes, max: win.bytesMax }, snapPerSec: win.snaps, bufMax: win.bufMax,
      proc,
    };
    pendingSrv = srv; lastSrv = srv;
    max10.stepMs = Math.max(max10.stepMs, step.max);
    max10.snapBytes = Math.max(max10.snapBytes, win.bytesMax);
    windows++;
    if (windows % SRV_LOG_EVERY === 0) {
      try {
        log?.log?.(JSON.stringify({ evt: 'netsim-room', room: label, brawl: room.world?.brawl?.n ?? null,
                                    tick: room.tick, ...srv, max10: { ...max10 } }));
      } catch {}
      max10 = { stepMs: 0, snapBytes: 0 };
    }
    openWindow(t);
  }

  function pump() {
    const t = now();
    if (t - win.start >= SRV_WINDOW_MS) closeWindow(t);
    const gap = t - last;
    acc += gap / 1000;
    last = t;
    // A room that is not being stepped says so. The client can measure the SYMPTOM — a snapshot carrying one
    // interval of sim time that took most of a second to arrive — but only this side can say whether the
    // room was starved (this log) or the link was. Playtest on 2026-08-20 saw stalls of 300–750 ms with the
    // tab rendering happily throughout, which is what sent the search here.
    if (gap > STALL_LOG_MS) {
      stalls++;
      // …and WHY. A high event-loop delay with fast stepping means the process was not given the CPU; a low
      // one means we blocked ourselves. They look identical from the client and they have opposite fixes.
      console.warn(`[netsim] the room was not stepped for ${Math.round(gap)} ms `
        + `(tick ${room.tick}, ${stalls} stalls this room) — ${healthFn().line()}`);
    }
    let steps = 0;
    const work = now();
    while (acc >= SIM_DT && steps < MAX_CATCHUP_STEPS) {
      const s0 = hrNow(); room.stepOnce(); win.step.push(hrNow() - s0); win.ticks++;
      if (room.dueForSnapshot()) {
        // Build + stringify + send, timed as one: that is what a snapshot costs this process.
        const s1 = hrNow(); const snap = room.takeSnapshot();
        if (pendingSrv) { snap.srv = pendingSrv; pendingSrv = null; }
        const bytes = +onSnapshot(snap) || 0;   // `onSnapshot` may return the bytes it sent
        win.snapMs.push(hrNow() - s1); win.bytes += bytes; win.bytesMax = Math.max(win.bytesMax, bytes); win.snaps++;
        win.bufMax = Math.max(win.bufMax, +bufferedAmount() || 0);
      }
      acc -= SIM_DT;
      steps++;
    }
    // …and whether the stepping ITSELF is what takes the time. A tick is budgeted 16.7 ms; a pump that
    // needs more than a third of that for its whole batch is worth knowing about before it becomes a stall.
    const spent = now() - work;
    if (spent > STALL_LOG_MS) console.warn(`[netsim] stepping took ${Math.round(spent)} ms for ${steps} tick(s)`);
    if (acc >= SIM_DT) { behind += Math.floor(acc / SIM_DT); acc = 0; } // fell behind: resume in the present
  }

  return {
    get behind() { return behind; },
    get stalls() { return stalls; },
    // The most recent finished `srv` window (whether or not a snapshot has carried it yet). For the tests.
    get lastSrv() { return lastSrv; },
    // A (re)start opens a fresh window, so a paused room's idle time is never counted as one long second.
    start() { if (!handle) { last = now(); openWindow(last); pendingSrv = null; handle = setIntervalFn(pump, intervalMs); } },
    stop() { if (handle) { clearIntervalFn(handle); handle = null; } },
    pump, // exposed so a test can drive it without a timer
  };
}
