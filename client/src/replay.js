// Input-replay record/playback core (docs/plans/2026-07-09-replay-record.md).
//
// A "recording" is NOT a movie of positions — it is the player's INPUT + the RNG seed. Playback re-runs the
// REAL sim (the seeded gameplay stream from sim-random.js, fixed BENCH_DT step) from that input, so
// everything is native: real bullet colors, smooth physics, real FX, real collisions. One mechanism, many
// consumers (the canonical Level-0 determinism fixture, the admin session viewer, video capture, …).
//
// This module is the PURE, DOM-free, engine-free half — URL-flag parsing + the trace shape + the per-tick
// input snapshot/apply. main.js owns the wiring (it holds update()/reset()/keys/the render loop). Keeping the
// pure half here makes it unit-testable and keeps the trace format in one documented place.

// The trace format version we WRITE. Bump on any breaking shape change so a stale recording is rejected
// loudly. v2 stores the ticks RUN-LENGTH PACKED (`runs` + `tickCount`) instead of a flat `ticks` array —
// input changes ~2×/second while we capture 60 ticks/second, so a real session collapses ~24× (measured on
// a 131 s desktop session: 7867 ticks → 279 runs, 254 KB → 10.7 KB). That is what makes a whole session fit
// in an unload beacon and keeps the live recorder's retained memory flat on a weak device.
// v4 adds `skills` — the character-progression allocation the run was played with. It is a CORRECTNESS
// fix, not a format tidy-up: skills change engine power, weapon damage, shield capacity and — through
// Maneuver's dodge — whether the hostile-hit roll DRAWS from the seeded stream at all. A v3 trace replayed
// on a skill-less ship is a different fight: measured on the Level-0 trace, Maneuver 3 turns 4 kills into
// 3 and kills the player (21 extra RNG draws shift every later enemy spawn), and Mobility 3 turns it into
// 1 kill and flies the ship 300 units off course. That is what "the player is fighting ghosts" looked like
// in the admin session viewer. The version is what tells a consumer whether a trace can be trusted to
// reproduce: **v4 and up can, v1–v3 cannot** unless the player had no points spent.
// v3 changes no bytes — it marks the 0-BASED LEVEL RENUMBERING. A trace stores the level NAME it was
// recorded on, and every campaign level moved down one that day (the intro went `level-1` → `level-0`), so a
// v1/v2 trace's stored name now points at the WRONG level: replaying the shipped intro asset would have
// loaded "Level 1" and re-simmed a fight the recorded input never fought. The version IS the marker of
// which naming a trace speaks — see `traceLevelName`. Nothing was rewritten in place: the intro asset is
// content-hashed on S3, and every recorded session trace in the bucket is equally affected.
export const TRACE_VERSION = 4;
// Versions we can still READ. v1 traces exist in the wild (the shipped Level-0 intro asset + every session
// recorded before 2026-08-03), and they stay playable forever — hydrateTrace() normalizes both shapes.
export const READABLE_TRACE_VERSIONS = new Set([1, 2, 3, 4]);

// Map a `level` URL value to a catalog level NAME. A bare number N → the seed name `level-N` (so
// `?record=1&level=0` records the intro four-ship fight, whose seed name is `level-0`); a non-numeric value is
// treated as an explicit name already (`level=level-0`). Trimmed; empty → the default intro level.
// Since the 0-based renumbering the number in the URL IS the campaign level number (0 = intro).
export function normalizeLevelName(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return 'level-0';
  return /^\d+$/.test(s) ? `level-${s}` : s;
}

// The level a TRACE should be replayed on. Not the same thing as `normalizeLevelName`: a trace carries a
// name recorded at some point in the past, and the campaign was renumbered down one when levels went
// 0-based. So pre-v3 traces are shifted here, at the one boundary where a stored name is read, instead of
// aliasing globally — `level-1` is a perfectly good CURRENT name (it is "Level 1"), so a blanket alias
// would break the live campaign to fix the archive. Anything that cannot be shifted (an unknown shape, or
// `level-0` in a legacy trace, which never existed) is passed through untouched. Pure.
export function traceLevelName(trace) {
  const name = normalizeLevelName(trace && trace.level);
  const legacy = !trace || !(Number(trace.version) >= 3);
  const m = legacy && /^level-(\d+)$/.exec(name);
  return m && Number(m[1]) > 0 ? `level-${Number(m[1]) - 1}` : name;
}

// ?record=1&level={id} → { level } | null. URL-only (NOT sticky like ?dev/?bench): recording is an explicit,
// per-visit act — you never want a reload to silently keep recording. `?record=0|false|off` disables.
export function evalRecord(search) {
  const p = new URLSearchParams(search || '');
  if (!p.has('record')) return null;
  const v = p.get('record');
  if (v === '0' || v === 'false' || v === 'off') return null;
  return { level: normalizeLevelName(p.get('level')) };
}

// ?playback&id={id}  (or the shorthand ?playback={id}) → { id, finish } | null. URL-only. A missing id
// resolves to the most recent same-browser recording (main.js falls back to the 'last' dev-cache slot).
// `&finish` (=1) presses "Finish and Return" for the pilot when the sector clears, and stops the re-sim on
// the victory overlay. A trace records keys and touch, never a MOUSE CLICK, so the button that ends a
// mission is not in it and a winning replay would otherwise sit in a cleared sector forever.
export function evalPlayback(search) {
  const p = new URLSearchParams(search || '');
  if (!p.has('playback')) return null;
  const v = p.get('playback');
  const id = (p.get('id') || (v && v !== '' && v !== '1' && v !== 'true' ? v : '') || '').trim();
  const finish = p.has('finish') && !['0', 'false', 'off'].includes(p.get('finish'));
  return { id: id || null, finish };
}

// Snapshot the resolved input for ONE tick, exactly as the recorder captures it and the replayer re-applies it:
// the set of held key codes + the touch-aim (heading/thrust) when the virtual stick is active. Must be taken
// AFTER update() so a replay re-derives an identical frame (mirrors the ?bench recorder).
//
// The touch-aim is QUANTIZED (heading 1e-3 rad ≈ 0.06°, thrust 1e-2) before it is stored. Two reasons, both
// load-bearing for a phone/tablet recording: a raw float serializes as ~18 characters where the rounded one
// takes ~6, and — far more important — an analog stick moves every single tick, so unrounded values would
// defeat the run-length packing completely (see packTicks) on exactly the devices whose sessions we keep
// losing. The step is far below what a finger can express, so the replay is not measurably less faithful.
const q = (v, step) => Math.round(v / step) * step;
export function snapshotInput(keys, touchAim) {
  return {
    k: Object.keys(keys).filter((c) => keys[c]),
    t: touchAim && touchAim.active ? [q(touchAim.heading, 1e-3), q(touchAim.thrust, 1e-2)] : null,
  };
}

// Do two tick snapshots hold the SAME input? Element-wise on `k` (never a set compare): `snapshotInput`
// derives it from `Object.keys(keys)` on one shared, never-reassigned object, so the order is stable across
// ticks and a positional compare is both correct and cheap. Powers the run-length packing on both ends.
export function sameInput(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = a.k || [], kb = b.k || [];
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
  const ta = a.t, tb = b.t;
  if (!ta !== !tb) return false;
  return !ta || (ta[0] === tb[0] && ta[1] === tb[1]);
}

// Run-length pack a flat tick array → `[[tick, repeatCount], …]`.
export function packTicks(ticks) {
  const runs = [];
  for (const tick of ticks || []) {
    const last = runs[runs.length - 1];
    if (last && sameInput(last[0], tick)) last[1]++;
    else runs.push([tick, 1]);
  }
  return runs;
}

// Expand packed runs back to a flat tick array. The SAME snapshot object is repeated across a run — safe
// because applyInput only ever READS a tick (it mutates `keys`/`touchAim`, never the tick), and it keeps a
// 10-minute playback at a few hundred objects instead of 36 000.
export function unpackTicks(runs) {
  const ticks = [];
  for (const r of runs || []) for (let i = 0; i < r[1]; i++) ticks.push(r[0]);
  return ticks;
}

// How many sim ticks a trace holds, whichever shape it is in (v1 flat / v2 packed).
export function traceTickCount(t) {
  if (!t) return 0;
  if (Array.isArray(t.ticks)) return t.ticks.length;
  if (Array.isArray(t.runs)) return Number.isFinite(t.tickCount) ? t.tickCount : t.runs.reduce((n, r) => n + r[1], 0);
  return 0;
}

// Normalize ANY readable trace to one that carries a flat `.ticks` array, so every consumer (the playback
// accumulator, the HUD counters, the bench) indexes ticks the one way it always has. v1 passes through
// untouched; v2 is expanded once at load. Idempotent.
export function hydrateTrace(t) {
  if (!t || Array.isArray(t.ticks)) return t;
  return { ...t, ticks: unpackTicks(t.runs) };
}

// Apply one recorded tick onto the shared input state before update(): clear every held key, set the recorded
// ones, and restore the touch-aim. Mutates `keys`/`touchAim` in place (never reassigns — the sim holds the same
// references). Live keyboard/touch is overwritten each tick, so playback ignores the operator's input.
export function applyInput(tick, keys, touchAim) {
  for (const c in keys) keys[c] = false;
  for (const c of (tick && tick.k) || []) keys[c] = true;
  if (touchAim) {
    if (tick && tick.t) { touchAim.active = true; touchAim.heading = tick.t[0]; touchAim.thrust = tick.t[1]; }
    else touchAim.active = false;
  }
}

// ~15 s of sim time at the fixed 1/60 step. Once `?playback&finish` engages "return to base"
// (rs.returning) only a WIN ends it: rs.index is frozen and rs.done is never set, so a run that can never
// dock (dead player, or a desync that leaves the ship unable to reach the station) loops forever. This
// bail-out ends the playback instead of leaving it on a dead screen.
// The limit must clear a LEGITIMATE flight home: the station sits at [-10,-42,-10] (catalog_seed.js),
// BASE_ARRIVE_RADIUS = 45 (autopilot-config.js:5) and PLAYER_MAX_SPEED = 30 (sim.js), so a fight that ends
// ~200 u out is a ~7 s flight — 8 s would abort real runs. 15 s is ~2× the expected worst case.
export const RETURN_HOME_STALL_TICKS = 900;

// Assemble a trace object from the captured run. `seed` is the mulberry32 seed actually installed at record
// start (the ONLY thing beyond input that determinism needs — the audit found no other non-seeded source in the
// sim path). `dt` is the fixed step used both to record and to replay. `shipId` + `loadout`/`components` rebuild
// the EXACT player ship+weapons used at record time, so a replay is independent of the current account loadout
// (both are id-only refs — `loadout.mounts:[{weapon,group,…}]`, `components:{hull,engine,…}` — so serializable).
// Takes EITHER a flat `ticks` array (dev ?record, tests) or already-packed `runs` (+ `tickCount`) straight
// from the live recorder, and always emits the packed v2 shape. The runs are copied, so a recorder that
// keeps capturing after a provisional upload cannot mutate a trace already handed to the transport.
export function makeTrace({ id, level, seed, dt, shipId, loadout, components, skills, ticks, runs, tickCount }) {
  const packed = runs ? runs.map((r) => [r[0], r[1]]) : packTicks(ticks);
  return {
    version: TRACE_VERSION,
    kind: 'input-replay',
    id: id || null,
    level: normalizeLevelName(level),
    seed: seed >>> 0,
    dt,
    shipId: shipId == null ? null : shipId,
    loadout: loadout || null,       // { mounts:[{weapon,group,offset,delay}] } — null → playback uses ship defaults
    components: components || null,  // { hull,engine,thruster,repair,grab } ids — null → ship defaults
    // The character-progression allocation in force during the run. WITHOUT it a replay rebuilds a
    // different ship and diverges immediately (see the v4 note at the top) — null means "none spent",
    // which is also how every pre-v4 trace has to be read.
    skills: skills || null,
    tickCount: Number.isFinite(tickCount) ? tickCount : packed.reduce((n, r) => n + r[1], 0),
    runs: packed,                    // [[tickSnapshot, repeatCount], …] — hydrateTrace() expands it at load
  };
}

// The live playback session. Kept as ONE object so the whole cluster is torn down together — a PARTIAL
// reset leaves animate() stuck in the playback branch (the intro→Level-1 dead-screen bug this guards
// against). Unit-tested; main.js holds exactly one instance. NOTE: `replayAcc`, the record vars and
// `G.replayMode` stay module-level in main.js — they are NOT part of the return-to-live gate.
export function makeReplaySession() {
  return {
    play: null,          // was module `PLAY` — { id, finish } | null; the animate() gate
    trace: null,         // was playTrace  — the loaded trace during ?playback
    armed: false,        // was playArmed  — step the trace only after the ship model has loaded
    index: 0,            // was playIndex  — next playback tick to apply
    done: false,         // was playDone   — trace exhausted (freezes the re-sim on the last frame)
    autoFinish: false,   // ?playback&finish — press "Finish and Return" when the sector clears
    returning: false,    // …and it has been pressed: the ship is flying home, input is muted
    stallTicks: 0,       // consecutive RETURN-HOME ticks without a win (see RETURN_HOME_STALL_TICKS)
    get active() { return !!this.play; },
    // Count one stepped tick. `returningNoWin` = the return home is engaged and the level is still not won.
    noteTick(returningNoWin) { this.stallTicks = returningNoWin ? this.stallTicks + 1 : 0; return this.stallTicks; },
    stalled(limitTicks = RETURN_HOME_STALL_TICKS) { return this.stallTicks >= limitTicks; },
    teardown() {
      this.play = null; this.trace = null; this.armed = false; this.index = 0;
      this.done = false; this.autoFinish = false; this.returning = false;
      this.stallTicks = 0;
    },
  };
}

// ONE tick of the deterministic replay/live loop — the single body shared by BOTH per-tick drivers in
// main.js: the fixed-timestep accumulator inside animate() and the synchronous window.__replay.step(n)
// hook. It used to be written out twice ("mirror the accumulator" in the step() copy), so any edit to one
// silently desynced the other. Everything OUTSIDE one tick stays with the caller: the replayAcc bookkeeping,
// the `steps < 6` cap and the record/playback HUD.
//
// Injected deps (this module stays DOM/engine-free and unit-testable):
//   rs         — the makeReplaySession() object (play/trace/index/done/autoFinish/returning + watchdog)
//   keys       — the shared held-key map (mutated in place)
//   touchAim   — the shared touch-steering state (mutated in place)
//   dt         — the fixed step (BENCH_DT)
//   update     — the sim step, called as update(dt)
//   capture    — optional; called right after update() to snapshot this tick's input (record / live session)
//   onTick     — optional; called every tick after `capture` (the Level-0 intro director rides this)
//   isCleared  — () => the sector is clear and the mission has not been ended yet
//   isWon      — () => levelRunner.won
//   finish     — presses "Finish and Return" (finishMission)
// Returns 'ok' (tick ran) or 'stop' (caller must break out of its loop WITHOUT consuming time/steps).
//
// NOTE on the entry guard: the accumulator gated its loop with `!(rs.play && rs.done)` while step() used a
// bare `!rs.done`. The two forms only differ in the state `rs.play === null && rs.done === true` — the
// post-intro teardown state (finishIntro → rs.teardown() nulls rs.play, then the caller sets rs.done = true).
// That state is UNREACHABLE from the step() hook: window.__replay only exists when ?record/?playback was on
// the URL at load, and the intro path that produces it (introMode) is never entered on such a load. Unified
// here on the accumulator's live-play-safe form, which is also the safe direction where they differ: a live
// session that inherited a stale rs.done must keep stepping — the intro→Level-1 dead-controls bug, guarded by
// visual/scenarios/29-intro-live-handoff.mjs. Pinned by a unit test (`rs.play=null, rs.done=true` → steps).
export function stepReplayTick({ rs, keys, touchAim, dt, update, capture, onTick, isCleared, isWon, finish }) {
  if (rs.play && rs.done) return 'stop';            // playback finished — never step, never consume time
  if (rs.returning) {
    for (const c in keys) keys[c] = false; touchAim.active = false; // no recorded input → autopilot isn't cancelled (sim manual-input check)
  } else if (rs.play && rs.trace) {
    if (rs.index < rs.trace.ticks.length) applyInput(rs.trace.ticks[rs.index], keys, touchAim);
    else { rs.done = true; return 'stop'; }         // trace exhausted with the fight unfinished
  }
  update(dt);                                       // the seeded stream is opt-in inside the sim (sim-random.js)
  if (rs.play && rs.trace && !rs.returning) rs.index++;
  if (capture) capture();
  if (onTick) onTick();                             // per-tick observer (the Level-0 intro director)
  // ?playback&finish — press "Finish and Return" for the pilot when the sector clears, and stop the re-sim
  // on the victory overlay. A trace cannot carry that click, so without this a winning replay never ends.
  // The watchdog below is why the stall counter exists: while `returning` is engaged only a WIN ends the
  // playback (rs.index is frozen and rs.done is never set), so a run that can never dock would loop forever.
  if (rs.autoFinish && !rs.done) {
    if (!rs.returning && isCleared()) {
      rs.returning = true;
      for (const c in keys) keys[c] = false; touchAim.active = false; // no input → the autopilot isn't cancelled
      finish();
    } else if (rs.returning && isWon()) { rs.done = true; return 'stop'; }
    if (rs.noteTick(rs.returning && !isWon()) >= RETURN_HOME_STALL_TICKS) { rs.done = true; return 'stop'; }
  }
  return 'ok';
}

// Validate a loaded trace before we drive the engine from it. Returns an array of problem strings (empty = ok),
// so a stale/corrupt recording fails loudly with a reason instead of silently running an empty or wrong fight.
export function validateTrace(t) {
  const problems = [];
  if (!t || typeof t !== 'object') return ['trace is not an object'];
  if (t.kind !== 'input-replay') problems.push(`kind is "${t.kind}", expected "input-replay"`);
  if (!READABLE_TRACE_VERSIONS.has(t.version)) problems.push(`version ${t.version} is not readable (${[...READABLE_TRACE_VERSIONS].join('/')})`);
  if (!Number.isFinite(t.seed)) problems.push('seed missing or not a finite number');
  if (!Number.isFinite(t.dt) || t.dt <= 0) problems.push('dt missing or not a positive number');
  if (!t.level) problems.push('level missing');
  // `skills` is optional (absent in v1–v3) but must be an object when present: it rebuilds the ship.
  if (t.skills != null && typeof t.skills !== 'object') problems.push('skills is present but not an object');
  // Either shape is accepted: v1's flat `ticks`, or v2's packed `runs`. Both must be non-empty.
  if (Array.isArray(t.ticks)) { if (t.ticks.length === 0) problems.push('ticks is empty'); }
  else if (Array.isArray(t.runs)) {
    if (t.runs.length === 0) problems.push('runs is empty');
    else if (!t.runs.every((r) => Array.isArray(r) && r.length === 2 && Number.isFinite(r[1]) && r[1] > 0)) problems.push('runs holds a malformed [tick, count] pair');
    if (!Number.isFinite(t.tickCount) || t.tickCount <= 0) problems.push('tickCount missing or not a positive number');
  } else problems.push('neither ticks nor runs is an array');
  return problems;
}
