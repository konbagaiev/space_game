// Always-on gameplay session recorder (docs/plans/2026-08-03-1246-record-all-sessions.md). Every live
// session is captured as a deterministic input-replay (seed + per-tick input, reusing replay.js) and
// uploaded for funnel analytics. This is the PURE half: the capture lifecycle + the floor/cap policy +
// trace assembly. main.js owns the wiring (seed install, the accumulator capture, the network flush).
//
// Ticks are stored RUN-LENGTH PACKED as they arrive (`runs`), never as a flat 60-per-second array. Input
// changes a couple of times a second, so a real session is a few hundred runs instead of tens of thousands
// of retained objects — the difference between a few KB and ~1 MB of live JS heap on the weak tablets whose
// sessions we care about most, and what lets a whole session survive an unload beacon (see sameInput).
import { makeTrace, normalizeLevelName, sameInput } from './replay.js';

// Don't store sub-3s bounces (junk rows). Stop appending past ~30min OR past 20k input changes, whichever
// comes first (the game keeps playing; the tail is simply not recorded). The RUNS cap is the one that binds
// on touch: a finger on the virtual stick changes the aim almost every tick, so a run count — not a tick
// count — is what actually bounds memory and upload size there.
export const MIN_SESSION_TICKS = 180;     // ~3 s at 60 Hz
export const MAX_SESSION_TICKS = 108000;  // ~30 min at 60 Hz
export const MAX_SESSION_RUNS = 20000;    // ≈ 800 KB of packed JSON worst case (continuous analog input)

// A session id is minted CLIENT-side at begin() and stays stable for the whole session, so the same session
// can be uploaded more than once (provisional flush when the tab is backgrounded, final flush on win/death)
// and the server upserts one row instead of accumulating duplicates.
const newSessionId = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// One live recording. begin() at level entry; captureTick() once per sim tick from the accumulator;
// flush(outcome, meta) whenever the session should be shipped — repeatedly while `final:false` (tab hidden /
// unload), then exactly once with `final:true` (win/death), after which nothing more is sent. Kept as one
// object so the whole cluster resets together on a new session.
export function makeSessionRecorder() {
  return {
    active: false,       // true between begin() and the final flush
    final: false,        // a terminal (win/death) flush already went out → this session is closed
    id: null,            // client-minted, stable across the session's provisional + final uploads
    seed: 0, level: null, shipId: null, loadout: null, components: null, skills: null, dt: 0,
    // The ROOM this session was fought in, when it was not the plain level: `{ kind:'duel', aces:N }`, else
    // null (every campaign session). It travels on the trace, so a re-simulation rebuilds the same fight.
    room: null,
    // The digest of the World at the instant the FIGHT ended — the duel referee's comparison point
    // (docs/plans/2026-09-01-1845-duel-referee.md §3.1). null until sealed, and null forever on a session
    // with no room: nothing pays for a digest it will not use.
    anchor: null,
    runs: [],            // [[tickSnapshot, repeatCount], …]
    tickCount: 0,
    sentTicks: 0,        // tickCount at the last provisional upload — never re-send an unchanged trace
    begin({ seed, level, shipId, loadout, components, skills, room, dt }) {
      this.active = true; this.final = false; this.id = newSessionId();
      this.seed = seed >>> 0; this.level = normalizeLevelName(level);
      this.shipId = shipId ?? null; this.loadout = loadout || null; this.components = components || null;
      this.skills = skills || null; // the allocation in force — a replay rebuilds a different ship without it
      this.room = room || null; this.anchor = null;
      this.dt = dt; this.runs = []; this.tickCount = 0; this.sentTicks = 0;
    },
    captureTick(snapshot) {
      if (!this.active || this.tickCount >= MAX_SESSION_TICKS) return;
      const last = this.runs[this.runs.length - 1];
      if (last && sameInput(last[0], snapshot)) last[1]++;
      else {
        if (this.runs.length >= MAX_SESSION_RUNS) return;   // cap hit → stop recording the tail
        this.runs.push([snapshot, 1]);
      }
      this.tickCount++;
    },
    // The fight ended — freeze what the World looked like at that instant
    // (docs/plans/2026-09-01-1845-duel-referee.md §3.1). Once per session: the FIRST tick at which the
    // fight settled is the anchor, and a later tick is a different fight state. It does not consult
    // `active`/`final` — the caller decides when to seal, and the sim's own `cleared`/`death` event flushes
    // the session from inside the very tick that settles it, which closes the recorder in the same breath.
    sealAnchor({ tick, hash, draws }) {
      if (this.anchor) return this.anchor;
      this.anchor = { tick: tick | 0, hash: hash >>> 0, draws: draws | 0 };
      return this.anchor;
    },
    // The trace as it stands RIGHT NOW — pure, mutates nothing, closes nothing. `flush()` uses it, and so
    // can a test or the `?debug` hook that wants to read what has been recorded without ending the session.
    snapshotTrace() {
      return makeTrace({
        id: this.id, level: this.level, seed: this.seed, dt: this.dt,
        shipId: this.shipId, loadout: this.loadout, components: this.components, skills: this.skills,
        room: this.room, runs: this.runs, tickCount: this.tickCount,
      });
    },
    // Returns { id, trace, level, outcome, durationMs, kills, room, anchor } to POST, or null if nothing
    // should be sent.
    // `final` closes the session (win/death); a provisional flush leaves the recorder running, so a player
    // who backgrounds the tab and comes back still ends up with ONE complete row under the same id.
    flush(outcome, { durationMs = 0, kills = 0 } = {}, { final = true } = {}) {
      if (!this.active || this.final) return null;
      // Tab-switching repeatedly re-fires the hidden flush, and the game auto-pauses while hidden, so the
      // trace is often byte-identical to the one already sent. Skip those — but never a FINAL flush, whose
      // point may be the outcome (quit → win) rather than new ticks.
      if (!final && this.tickCount <= this.sentTicks) return null;
      if (final) { this.final = true; this.active = false; }
      if (this.tickCount < MIN_SESSION_TICKS) return null; // trivial bounce → drop
      this.sentTicks = this.tickCount;
      const trace = this.snapshotTrace();
      return { id: this.id, trace, level: this.level, outcome, durationMs, kills,
        room: this.room, anchor: this.anchor };
    },
  };
}
