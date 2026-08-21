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
import { SIM_DT } from '../../../client/src/sim-core/consts.js';
import { health } from './health.js';

export const MAX_CATCHUP_STEPS = 6;

// A gap between pumps past this is not jitter, it is the process being busy with something else — and it is
// felt as the whole world freezing and then jumping. Six ticks at 60 Hz.
export const STALL_LOG_MS = 100;

export function createDriver(room, { onSnapshot, intervalMs = 1000 * SIM_DT, now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  let acc = 0;
  let last = now();
  let handle = null;
  let behind = 0; // ticks dropped to the catch-up cap — a diagnostic worth logging if it is ever nonzero
  let stalls = 0; // pumps that arrived late enough to be felt

  function pump() {
    const t = now();
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
        + `(tick ${room.tick}, ${stalls} stalls this room) — ${health().line()}`);
    }
    let steps = 0;
    const work = now();
    while (acc >= SIM_DT && steps < MAX_CATCHUP_STEPS) {
      room.stepOnce();
      if (room.dueForSnapshot()) onSnapshot(room.takeSnapshot());
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
    start() { if (!handle) { last = now(); handle = setIntervalFn(pump, intervalMs); } },
    stop() { if (handle) { clearIntervalFn(handle); handle = null; } },
    pump, // exposed so a test can drive it without a timer
  };
}
