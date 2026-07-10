// Input-replay record/playback core (docs/plans/2026-07-09-replay-record.md).
//
// A "recording" is NOT a movie of positions — it is the player's INPUT + the RNG seed. Playback re-runs the
// REAL sim (seeded Math.random via bench.js installSeededRandom, fixed BENCH_DT step) from that input, so
// everything is native: real bullet colors, smooth physics, real FX, real collisions. One mechanism, many
// consumers (the Level-0 cutscene, a "watch the fight from another angle" viewer, video capture, …).
//
// This module is the PURE, DOM-free, engine-free half — URL-flag parsing + the trace shape + the per-tick
// input snapshot/apply. main.js owns the wiring (it holds update()/reset()/keys/the render loop). Keeping the
// pure half here makes it unit-testable and keeps the trace format in one documented place.

// The trace format version. Bump on any breaking shape change so a stale recording is rejected loudly.
export const TRACE_VERSION = 1;

// Map a `level` URL value to a catalog level NAME. A bare number N → the seed name `level-N` (so
// `?record=1&level=1` records the intro four-ship fight, whose seed name is `level-1`); a non-numeric value is
// treated as an explicit name already (`level=level-1`). Trimmed; empty → the default intro level.
export function normalizeLevelName(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return 'level-1';
  return /^\d+$/.test(s) ? `level-${s}` : s;
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

// ?playback&id={id}  (or the shorthand ?playback={id}) → { id, cutscene } | null. URL-only. A missing id
// resolves to the most recent same-browser recording (main.js falls back to the 'last' dev-cache slot).
// `&cutscene` (=1) overlays the level's scripted, event-driven text pauses (Level-0 intro cutscene).
export function evalPlayback(search) {
  const p = new URLSearchParams(search || '');
  if (!p.has('playback')) return null;
  const v = p.get('playback');
  const id = (p.get('id') || (v && v !== '' && v !== '1' && v !== 'true' ? v : '') || '').trim();
  const cutscene = p.has('cutscene') && !['0', 'false', 'off'].includes(p.get('cutscene'));
  return { id: id || null, cutscene };
}

// Snapshot the resolved input for ONE tick, exactly as the recorder captures it and the replayer re-applies it:
// the set of held key codes + the touch-aim (heading/thrust) when the virtual stick is active. Must be taken
// AFTER update() so a replay re-derives an identical frame (mirrors the ?bench recorder).
export function snapshotInput(keys, touchAim) {
  return {
    k: Object.keys(keys).filter((c) => keys[c]),
    t: touchAim && touchAim.active ? [touchAim.heading, touchAim.thrust] : null,
  };
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

// Assemble a trace object from the captured run. `seed` is the mulberry32 seed actually installed at record
// start (the ONLY thing beyond input that determinism needs — the audit found no other non-seeded source in the
// sim path). `dt` is the fixed step used both to record and to replay. `shipId` + `loadout`/`components` rebuild
// the EXACT player ship+weapons used at record time, so a replay is independent of the current account loadout
// (both are id-only refs — `loadout.mounts:[{weapon,group,…}]`, `components:{hull,engine,…}` — so serializable).
export function makeTrace({ id, level, seed, dt, shipId, loadout, components, ticks }) {
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
    ticks: ticks ? ticks.slice() : [],
  };
}

// The live playback/cutscene session (the intro cutscene rides the ?playback machinery). Kept as ONE
// object so the whole cluster is torn down together — a PARTIAL reset leaves animate() stuck in the
// playback branch (the intro→Level-1 dead-screen bug this guards against). Unit-tested; main.js holds
// exactly one instance. NOTE: `replayAcc`, the record vars, `G.replayMode`, and the cutscene-runtime
// detail (cutFrozen/cutFired/cutQueue/… + overlay els) stay module-level in main.js — they are NOT part
// of the return-to-live gate.
export function makeReplaySession() {
  return {
    play: null,          // was module `PLAY` — { id, cutscene } | null; the animate() gate
    trace: null,         // was playTrace  — the loaded trace during ?playback / intro
    armed: false,        // was playArmed  — step the trace only after the ship model has loaded
    index: 0,            // was playIndex  — next playback tick to apply
    done: false,         // was playDone   — trace exhausted (freezes the re-sim on the last frame)
    cut: null,           // was CUT        — the LEVEL0_CUTSCENE script or null
    cutDone: false,      // was cutDone    — after Skip / last pause: stop observing events
    cutReturning: false, // was cutReturning — fight cleared → simulate "Return to base"
    get active() { return !!this.play; },
    teardown() {
      this.play = null; this.trace = null; this.armed = false; this.index = 0;
      this.done = false; this.cut = null; this.cutDone = false; this.cutReturning = false;
    },
  };
}

// Decide whether to auto-play the intro cutscene for this load. Server-authoritative: `introTrace` is
// present ONLY on the level-1 descriptor served while current_progress===1 (a NEW or freshly-RESET
// player), so hasIntroTrace is the real one-time gate — no client localStorage flag, so a genuine
// progress reset replays the intro. Headless suites (?debug/?bench) always get the playable Level 0.
export function shouldPlayIntro(search, hasIntroTrace) {
  const headless = search.includes('debug') || search.includes('bench');
  return !headless && !!hasIntroTrace;
}

// Validate a loaded trace before we drive the engine from it. Returns an array of problem strings (empty = ok),
// so a stale/corrupt recording fails loudly with a reason instead of silently running an empty or wrong fight.
export function validateTrace(t) {
  const problems = [];
  if (!t || typeof t !== 'object') return ['trace is not an object'];
  if (t.kind !== 'input-replay') problems.push(`kind is "${t.kind}", expected "input-replay"`);
  if (t.version !== TRACE_VERSION) problems.push(`version ${t.version} != ${TRACE_VERSION}`);
  if (!Number.isFinite(t.seed)) problems.push('seed missing or not a finite number');
  if (!Number.isFinite(t.dt) || t.dt <= 0) problems.push('dt missing or not a positive number');
  if (!t.level) problems.push('level missing');
  if (!Array.isArray(t.ticks)) problems.push('ticks is not an array');
  else if (t.ticks.length === 0) problems.push('ticks is empty');
  return problems;
}
