// Always-on gameplay session recorder (docs/plans/2026-08-03-1246-record-all-sessions.md). Every live
// session is captured as a deterministic input-replay (seed + per-tick input, reusing replay.js) and
// uploaded for funnel analytics. This is the PURE half: the capture lifecycle + the floor/cap policy +
// trace assembly. main.js owns the wiring (seed install, the accumulator capture, the network flush).
import { makeTrace, normalizeLevelName } from './replay.js';

// Don't store sub-3s bounces (junk rows). Stop appending past ~10min to bound memory + upload size
// (the game keeps playing; the tail is simply not recorded). Both in sim ticks at the fixed step.
export const MIN_SESSION_TICKS = 180;    // ~3 s at 60 Hz
export const MAX_SESSION_TICKS = 36000;  // ~10 min at 60 Hz

// One live recording. begin() at level entry; captureTick() once per sim tick from the accumulator;
// end(outcome, meta) exactly once (win/death/unload) → the flush payload or null (below floor / already
// flushed / no seed). Kept as one object so the whole cluster resets together on a new session.
export function makeSessionRecorder() {
  return {
    active: false,       // true between begin() and end()
    flushed: false,      // end() ran once → guards win+unload double-send
    seed: 0, level: null, shipId: null, loadout: null, components: null, dt: 0,
    ticks: [],
    begin({ seed, level, shipId, loadout, components, dt }) {
      this.active = true; this.flushed = false;
      this.seed = seed >>> 0; this.level = normalizeLevelName(level);
      this.shipId = shipId ?? null; this.loadout = loadout || null; this.components = components || null;
      this.dt = dt; this.ticks = [];
    },
    captureTick(snapshot) { if (this.active && this.ticks.length < MAX_SESSION_TICKS) this.ticks.push(snapshot); },
    // Returns { trace, level, outcome, durationMs, kills } to POST, or null if nothing should be sent.
    end(outcome, { durationMs = 0, kills = 0 } = {}) {
      if (!this.active || this.flushed) return null;
      this.flushed = true; this.active = false;
      if (this.ticks.length < MIN_SESSION_TICKS) return null; // trivial bounce → drop
      const trace = makeTrace({
        id: null, level: this.level, seed: this.seed, dt: this.dt,
        shipId: this.shipId, loadout: this.loadout, components: this.components, ticks: this.ticks,
      });
      return { trace, level: this.level, outcome, durationMs, kills };
    },
  };
}
