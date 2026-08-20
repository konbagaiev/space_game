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

export const MAX_CATCHUP_STEPS = 6;

export function createDriver(room, { onSnapshot, intervalMs = 1000 * SIM_DT, now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  let acc = 0;
  let last = now();
  let handle = null;
  let behind = 0; // ticks dropped to the catch-up cap — a diagnostic worth logging if it is ever nonzero

  function pump() {
    const t = now();
    acc += (t - last) / 1000;
    last = t;
    let steps = 0;
    while (acc >= SIM_DT && steps < MAX_CATCHUP_STEPS) {
      room.stepOnce();
      if (room.dueForSnapshot()) onSnapshot(room.takeSnapshot());
      acc -= SIM_DT;
      steps++;
    }
    if (acc >= SIM_DT) { behind += Math.floor(acc / SIM_DT); acc = 0; } // fell behind: resume in the present
  }

  return {
    get behind() { return behind; },
    start() { if (!handle) { last = now(); handle = setIntervalFn(pump, intervalMs); } },
    stop() { if (handle) { clearIntervalFn(handle); handle = null; } },
    pump, // exposed so a test can drive it without a timer
  };
}
