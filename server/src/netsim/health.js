// What the MACHINE is doing to this process.
//
// A room that stops stepping for half a second looks the same from the outside whether the OS descheduled
// the process or the process blocked itself, and the two have opposite fixes: the first is "something else
// on this box", the second is "our code". Only a measurement taken inside the process can tell them apart,
// and Node ships exactly the right one.
//
// `monitorEventLoopDelay` is a native histogram of how late the event loop is, sampled at a fixed interval
// and independent of anything we run: if it is high while our own stepping is fast, we were not being given
// the CPU. It costs a timer in libuv and is designed to be left on.
//
// This was built after a playtest on 2026-08-20 showed room stalls of 300–750 ms while a synthetic client
// driving the same room saw none — and the machine turned out to be running at a load average of 17.6 on
// ten cores, with Spotlight indexing, a VM and an agent competing. Guessing at that from the game's own
// numbers had already cost most of a day.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import os from 'node:os';

const NS = 1e6; // the histogram is in nanoseconds; everything here is milliseconds

export function createHealth({ resolution = 10 } = {}) {
  const loop = monitorEventLoopDelay({ resolution });
  loop.enable();
  const cores = os.cpus().length;

  // The histogram measures the interval between its own samples, so an idle process reads `resolution`
  // rather than zero. Subtracting it is what turns the number into "how late was the loop".
  const ms = (ns) => +Math.max(0, ns / NS - resolution).toFixed(1);

  return {
    // A reading of the last window, and a reset so the next one is independent. Milliseconds throughout.
    sample() {
      const s = {
        loopP50: ms(loop.percentile(50)),
        loopP99: ms(loop.percentile(99)),
        loopMax: ms(loop.max),
        load1: +os.loadavg()[0].toFixed(2),
        load5: +os.loadavg()[1].toFixed(2),
        cores,
        // Above 1 the machine has more runnable work than cores, and a 60 Hz timer starts slipping.
        get oversubscribed() { return this.load1 > this.cores; },
      };
      loop.reset();
      return s;
    },

    // One line, for a log where it has to sit next to a stall.
    line() {
      const s = this.sample();
      return `event loop p50 ${s.loopP50} ms p99 ${s.loopP99} max ${s.loopMax}; `
        + `load ${s.load1}/${s.load5} on ${s.cores} cores${s.load1 > s.cores ? ' — OVERSUBSCRIBED' : ''}`;
    },

    stop() { loop.disable(); },
  };
}

// One process, one histogram: several rooms asking would each reset the others' window.
let shared = null;
export const health = () => (shared ||= createHealth());
