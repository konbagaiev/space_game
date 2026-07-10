# Fix: intro replay teardown on `finishIntro()` + server-authoritative intro trigger (reset replays the intro)

**Feature ID:** 2026-07-10-1303-fix-intro-replay-teardown
**Area:** client — new-player intro flow (`client/src/main.js`) + replay core (`client/src/replay.js`);
server — intro trigger gate / tests
**Type:** two related bug fixes + small testability seams (unit-tested session object + pure gate function)

> **This plan covers TWO related fixes on the same branch** (the second was approved during live-test):
> **Fix A** — the intro→Take-off dead-screen (teardown the replay/cutscene session on `finishIntro`).
> **Fix B** — `reset-progress` doesn't replay the intro (a stale client `localStorage['introSeen']` flag
> suppresses it; make the trigger server-authoritative). Fix A is unchanged from the prior revision;
> Fix B is additive.

## Goal

**Fix A.** After the new-player intro cutscene finishes and lands on the Level 1 briefing, clicking
**Take-off** does nothing — no player ship, no enemies, no input response. Fix it by tearing down the
playback/cutscene session when the intro ends (`finishIntro()`), so `animate()` returns to the normal
`update(dt)` branch and the live Level-1 sim actually ticks. To make the teardown **unit-testable** (not
a loose bag of resets buried in the DOM-bound `main.js`), the playback/cutscene lifecycle state is
extracted into a small `makeReplaySession()` factory in the already-pure, already-unit-tested
`client/src/replay.js`, with an `active` getter and a `teardown()` method covered by a regression test.

**Fix B.** After `reset-progress` (server sets `current_progress → 1`), the intro cutscene does NOT
replay — the player drops straight into the playable Level 0. Root cause: the bootstrap intro gate reads
a **client-side `localStorage['introSeen']`** flag (`client/src/main.js:1317`) that persists across a
server-side progress reset, permanently suppressing the cutscene on that browser. Server progress is
already the authoritative one-time gate — `introTrace` is seeded ONLY on the `level-1` descriptor
(`server/src/catalog_seed.js:397`), which the server serves only while `current_progress === 1`
(`getCurrentLevel` joins progress → levels, `server/src/db.js:134-140`). So drop the redundant
`localStorage` guard and gate solely on "the served level carries `introTrace`" (plus the existing
headless check). This makes a genuine progress reset replay the intro, and the trigger becomes a pure,
unit-tested function.

## Fix A — Root cause (confirmed against the worktree code)

The intro reuses the `?playback` machinery:

- `startIntroCutscene()` (`client/src/main.js` ~1040-1047) sets the **module-level** playback state
  `PLAY = { id, cutscene:true }` and `G.replayMode = true`, then calls `startPlaybackSession(trace)`
  which sets `CUT = LEVEL0_CUTSCENE`, `playTrace`, `playIndex`, `playArmed`, etc.
- When the cutscene ends, `finishIntro()` (`client/src/main.js` ~1051) advances progress 1→2
  (`unlockNextLevel`) and lands on the Level 1 briefing (`showMain`) — but it **never clears** `PLAY`,
  `G.replayMode`, or the `play*`/`cut*` module vars.
- `animate()` (`client/src/main.js` ~594) branches on `if (REC || PLAY) { … } else { update(dt) }`.
  Because `PLAY` stays truthy, the loop is **permanently stuck in the playback branch** — which is inert
  because `playDone === true` (the stepping `while` loop never runs). The live `else → update(dt)` branch
  never executes.
- On Take-off, `launchCampaign()` (`client/src/mainwindow.js:61-72`) calls `reset()` to (re)start the
  level and sets `G.gameStarted = true`, but the live sim needs `update(dt)` from the `else` branch — and
  that branch is unreachable. Result: **zero sim ticks** → no player, no enemies, no input.

Additionally, `G.replayMode` left `true` keeps the *real* Level-1 win read-only: the server side effects
in `sim.js` are gated on `!G.replayMode` (`client/src/sim.js:135`), so a genuine win wouldn't advance
progress / bank credits / deposit loot. It must be reset too.

## Fix A — Design: one session object, cleanly torn down

### 1. New unit in `client/src/replay.js`

Add a factory `makeReplaySession()` that owns the PLAYBACK + CUTSCENE lifecycle state, with an `active`
getter (the exact predicate `animate()` gates on) and a single `teardown()` that resets **every** field
together. Put it alongside the other exports (e.g. after `validateTrace`):

```js
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
```

### 2. Scope boundary — what the session owns vs what stays module-level in `main.js`

- **Session owns** (rename every read/write site in `main.js` — see the enumeration in §3):
  `PLAY→rs.play`, `playTrace→rs.trace`, `playArmed→rs.armed`, `playIndex→rs.index`,
  `playDone→rs.done`, `CUT→rs.cut`, `cutDone→rs.cutDone`, `cutReturning→rs.cutReturning`.
- **Stays module-level in `main.js` — do NOT move:**
  - `replayAcc` — the real-time accumulator is **shared with the record path** and is reset by
    `reset()` / session start as today; not part of the return-to-live gate.
  - All record vars: `recCapturing`, `recTicks`, `recSeed`, `recHudEl`, `recStartBtn`, …
  - `G.replayMode` — lives on the shared `G` bag and is read by `sim.js`. Reset it **explicitly** in
    `finishIntro()` (below), not via the session.
  - Cutscene RUNTIME detail: `cutFrozen`, `cutFired`, `cutQueue`, `cutPrevKills`, `cutRocketeerSeen`,
    `cutSeenRockets`, `cutEnemyRockets`, and the overlay elements (`cutOverlayEl`, `cutCardEl`,
    `cutSkipEl`) — these are managed by `cutsceneStart()` / `cutsceneEnd()` and are not part of the gate.

### 3. Wiring the session into `main.js` — full, mechanical rename (enumerated)

**Import** — extend the existing replay import at `client/src/main.js:25`:

```js
import { evalRecord, evalPlayback, normalizeLevelName, snapshotInput, applyInput, makeTrace, validateTrace, makeReplaySession } from './replay.js';
```

**Declaration** — at `client/src/main.js:56-89`, replace the module-level `let PLAY = …` and the
`let playTrace/playIndex/playDone/playArmed` (65-68) and `let CUT/cutDone/cutReturning` (86, 88-89)
declarations. Create the single instance and seed `play` from the URL:

```js
// line 56 area — one session instance; the intro cutscene also SETS rs.play programmatically (bootstrap)
const rs = makeReplaySession();
rs.play = evalPlayback(typeof location !== 'undefined' ? location.search : ''); // { id, cutscene } | null
// line 58 — dev record/playback sessions are READ-ONLY: the sim must not advance progress on a (re)played win
if (REC || rs.play) G.replayMode = true;
```

Then **delete** the now-unused declarations at lines 65-68 (`playTrace`, `playIndex`, `playDone`,
`playArmed`) and 86/88/89 (`CUT`, `cutDone`, `cutReturning`) — their state now lives on `rs`. Keep every
other `let` in that block (including `replayAcc`, `introMode`, `cutFrozen`, `cutFired`, `cutQueue`, etc.).

**Every reference to rename** (grep verified — `\bPLAY\b|playTrace|playArmed|playIndex|playDone|\bCUT\b|\bcutDone\b|\bcutReturning\b` in `client/src/main.js`). Touch each of these lines:

| Line | Now | Becomes |
|------|-----|---------|
| 58 | `if (REC || PLAY)` | `if (REC || rs.play)` |
| 593 | `(BENCH || REC || PLAY) ? BENCH_DT …` | `(BENCH || REC || rs.play) ? BENCH_DT …` |
| 596 | `if (REC || PLAY) {` | `if (REC || rs.play) {` |
| 602 | `(recCapturing || playArmed)` | `(recCapturing || rs.armed)` |
| 605 | `while (… && !playDone && !cutFrozen)` | `… && !rs.done && !cutFrozen` |
| 606 | `if (cutReturning) {` | `if (rs.cutReturning) {` |
| 608 | `} else if (PLAY && playTrace) {` | `} else if (rs.play && rs.trace) {` |
| 609 | `if (playIndex < playTrace.ticks.length) applyInput(playTrace.ticks[playIndex], …)` | `rs.index`, `rs.trace.ticks.length`, `rs.trace.ticks[rs.index]` |
| 610 | `else { playDone = true; break; }` | `else { rs.done = true; break; }` |
| 613 | `if (PLAY && playTrace && !cutReturning) playIndex++;` | `if (rs.play && rs.trace && !rs.cutReturning) rs.index++;` |
| 615 | `if (CUT) cutsceneObserve();` | `if (rs.cut) cutsceneObserve();` |
| 620 | `if (PLAY) updatePlaybackHud();` | `if (rs.play) updatePlaybackHud();` |
| 621 | `if (PLAY && playDone && CUT && !cutDone) cutsceneEnd();` | `if (rs.play && rs.done && rs.cut && !rs.cutDone) cutsceneEnd();` |
| 943 | comment "(see the PLAY block there)" | update wording to `rs.play` (cosmetic) |
| 945 | `playTrace = trace; playIndex = 0; playDone = false;` | `rs.trace = trace; rs.index = 0; rs.done = false;` |
| 967 | `if (PLAY.cutscene && normalizeLevelName(trace.level) === …)` | `if (rs.play.cutscene && …)` |
| 968 | `CUT = LEVEL0_CUTSCENE;` | `rs.cut = LEVEL0_CUTSCENE;` |
| 974 | comment "once playArmed" | update to `rs.armed` (cosmetic) |
| 975 | `watchModelsReady(() => { playArmed = true; });` | `watchModelsReady(() => { rs.armed = true; });` |
| 1026 | `if (!playHudEl || !playTrace) return;` | `if (!playHudEl || !rs.trace) return;` |
| 1028 | `Math.min(playIndex, playTrace.ticks.length)} / ${playTrace.ticks.length}${playDone ? …}` | `rs.index`, `rs.trace.ticks.length` (×2), `rs.done` |
| 1042 | `playTrace = trace;` | `rs.trace = trace;` |
| 1043 | `PLAY = { id: trace.id, cutscene: true };` | `rs.play = { id: trace.id, cutscene: true };` |
| 1064 | `const p0 = CUT.pauses.find(…)` | `rs.cut.pauses.find(…)` |
| 1070 | `if (cutDone) return;` | `if (rs.cutDone) return;` |
| 1071 | `const dueAt = playIndex + Math.round(CUT.delaySec / BENCH_DT);` | `rs.index`, `rs.cut.delaySec` |
| 1075 | `CUT.pauses.find(…)` | `rs.cut.pauses.find(…)` |
| 1080 | `enemies.some((e) => e.name === CUT.rocketeerShip)` | `rs.cut.rocketeerShip` |
| 1082 | `CUT.pauses.find(…)` | `rs.cut.pauses.find(…)` |
| 1088 | `CUT.pauses.find(…)` | `rs.cut.pauses.find(…)` |
| 1091 | `if (cutQueue.length && playIndex >= cutQueue[0].atTick)` | `… && rs.index >= …` |
| 1100 | `if (!cutReturning && G.returnToBase && !levelRunner.won)` | `if (!rs.cutReturning && …)` |
| 1101 | `cutReturning = true;` | `rs.cutReturning = true;` |
| 1104 | `} else if (cutReturning && levelRunner.won) {` | `} else if (rs.cutReturning && levelRunner.won) {` |
| 1105 | `cutsceneEnd(); playDone = true;` | `cutsceneEnd(); rs.done = true;` |
| 1113 | `cutDone = true; cutFrozen = false; cutQueue = [];` | `rs.cutDone = true; …` (leave `cutFrozen`/`cutQueue`) |
| 1114 | `CUT.pauses.forEach(…)` | `rs.cut.pauses.forEach(…)` |
| 1118 | `cutDone = true; cutFrozen = false; cutReturning = false; …` | `rs.cutDone = true; cutFrozen = false; rs.cutReturning = false; …` |
| 1147 | `if (!CUT || cutDone) return;` | `if (!rs.cut || rs.cutDone) return;` |
| 1156 | `if (REC || PLAY) {` (the `__replay` hook guard) | `if (REC || rs.play) {` |
| 1170 | `status: () => ({ …, playIndex, playDone, total: playTrace ? playTrace.ticks.length : 0 })` | `rs.index`, `rs.done`, `rs.trace ? rs.trace.ticks.length : 0` |
| 1172 | `cut: () => ({ on: !!CUT, …, done: cutDone, returning: cutReturning, … })` | `!!rs.cut`, `rs.cutDone`, `rs.cutReturning` |
| 1185 | `if (cutReturning) {` (sync stepper) | `if (rs.cutReturning) {` |
| 1187 | `} else if (PLAY && playTrace) {` | `} else if (rs.play && rs.trace) {` |
| 1188 | `if (playIndex < playTrace.ticks.length) applyInput(playTrace.ticks[playIndex], …)` | `rs.index`, `rs.trace…` |
| 1189 | `else { playDone = true; break; }` | `else { rs.done = true; break; }` |
| 1191 | `if (!playDone) withSimRand(…)` | `if (!rs.done) withSimRand(…)` |
| 1192 | `if (PLAY && playTrace && !cutReturning && !playDone) playIndex++;` | all `rs.*` |
| 1194 | `if (CUT) cutsceneObserve();` | `if (rs.cut) cutsceneObserve();` |
| 1244 | `if (PLAY) {` (bootstrap) | `if (rs.play) {` |
| 1245 | `playTrace = await loadTrace(PLAY.id);` | `rs.trace = await loadTrace(rs.play.id);` |
| 1246 | `playTrace ? validateTrace(playTrace) : […PLAY.id…]` | `rs.trace`, `rs.play.id` |
| 1255 | `: PLAY ? \`/api/levels/${normalizeLevelName(playTrace.level)}\`` | `: rs.play ? … rs.trace.level` |
| 1306 | `} else if (PLAY) {` | `} else if (rs.play) {` |
| 1307 | `startPlaybackSession(playTrace);` | `startPlaybackSession(rs.trace);` |

The rename is purely mechanical — **no behavior change** for `?record`/`?playback`; the guard predicate
`rs.active` is `!!rs.play`, identical to the old truthiness of `PLAY`. (`rs` is `const` but its fields
mutate — that is intended.) After the rename, `grep -nE '\bPLAY\b|playTrace|playArmed|playIndex|playDone|\bCUT\b|\bcutDone\b|\bcutReturning\b' client/src/main.js` must return **zero** matches (only the `rs.*` forms remain).

### 4. The fix in `finishIntro()`

`client/src/main.js` ~1051-1058. Replace the missing teardown with a call to `rs.teardown()` plus the
explicit `G.replayMode = false`:

```js
async function finishIntro() {
  if (!introMode) return;
  introMode = false;
  // Tear down the playback/cutscene session so animate() leaves the (now-inert) `if (REC || rs.play)`
  // branch and returns to live `else → update(dt)` — otherwise Take-off's reset() gets zero sim ticks
  // (no player/enemies/input). Clear replayMode too so the REAL Level-1 win can advance/bank (sim.js
  // gates its server effects on !G.replayMode).
  rs.teardown();
  G.replayMode = false;
  try { await unlockNextLevel(); } catch (e) { console.error('[intro] advance failed', e); }
  if (CATALOG.level && CATALOG.level.briefing) showMain(CATALOG.level.briefing);
  else showWelcome(getPlayerShips());
}
```

(The old `localStorage.setItem('introSeen', '1')` line is deleted here as part of Fix B — see Fix B §3.
`unlockNextLevel` advancing `current_progress` 1→2 is now the sole one-time gate.)

Do the teardown **synchronously before** the `await unlockNextLevel()` so the very next `animate()`
frame already takes the live branch (no window where the loop lingers in the dead playback branch after
the overlay is gone). `finishIntro()` is reached from **all** intro-end paths, so this single point
covers them:

- normal completion: `cutsceneObserve()` return-to-base win → `cutsceneEnd()` → `finishIntro()`;
- trace exhausted: `animate()`'s `rs.done` uncover → `cutsceneEnd()` → `finishIntro()`;
- **Skip / Escape**: `cutsceneSkip()` → `cutsceneEnd()` → `finishIntro()`.

`cutsceneEnd()` calls `finishIntro()` only `if (introMode)` (`client/src/main.js` ~1121), so the teardown
runs exactly once per intro. The headless / no-trace fallbacks never set `rs.play` programmatically (they
run the playable Level 0), so they are unaffected.

### Why `finishIntro` is the single correct point (not a shared helper)

The only other consumer of this session state is a real `?playback` session, and it **never needs this
teardown**: its Restart button is `location.reload()` (`client/src/main.js` ~1019) — a fresh page load
re-derives `rs.play` from the URL, so there is no in-page "playback → live" transition to clean up.
Wiring `rs.teardown()` into any other flow would be over-engineering (DECISIONS §30). Keep the call
inline in `finishIntro()`.

## Fix B — Design: server-authoritative intro trigger (reset replays the intro)

### 1. New pure gate in `client/src/replay.js`

Add a pure, unit-tested function that decides whether to auto-play the intro on this load. It replaces
the inline `headless` / `seen` / `introSeen` logic in the bootstrap:

```js
// Decide whether to auto-play the intro cutscene for this load. Server-authoritative: `introTrace` is
// present ONLY on the level-1 descriptor served while current_progress===1 (a NEW or freshly-RESET
// player), so hasIntroTrace is the real one-time gate — no client localStorage flag, so a genuine
// progress reset replays the intro. Headless suites (?debug/?bench) always get the playable Level 0.
export function shouldPlayIntro(search, hasIntroTrace) {
  const headless = search.includes('debug') || search.includes('bench');
  return !headless && !!hasIntroTrace;
}
```

Keep the headless check **byte-identical** to the current inline one
(`search.includes('debug') || search.includes('bench')`) so the headless suites behave exactly as today.

### 2. Bootstrap change in `client/src/main.js`

In the `else if (level.name === 'level-1')` branch (`client/src/main.js` ~1312-1320), replace the inline
`headless` / `seen` / `introSeen` logic with the pure gate. Current code:

```js
    } else if (level.name === 'level-1') {
      // Intro. A REAL new player (not headless, not already-seen) with a canonical recording → WATCH the
      // CUTSCENE, then finishIntro advances to Level 1. Headless (?debug/?bench visual/perf suites),
      // already-seen, or no recording → the PLAYABLE Level 0 (the arena the harnesses expect + ?dev re-record).
      const headless = location.search.includes('debug') || location.search.includes('bench');
      let seen = false; try { seen = !!localStorage.getItem('introSeen'); } catch {}
      let started = false;
      if (!headless && !seen && CATALOG.level.introTrace) started = await startIntroCutscene();
      if (!started) { document.body.classList.remove('menu'); G.gameStarted = true; reset(); }
    } else if (CATALOG.level.briefing) {
```

Becomes:

```js
    } else if (level.name === 'level-1') {
      // Intro. Server-authoritative one-time gate: `introTrace` is on the level-1 descriptor the server
      // serves ONLY while current_progress===1 (a NEW or freshly RESET player) → WATCH the CUTSCENE, then
      // finishIntro advances to Level 1. A genuine progress reset REPLAYS the intro (no localStorage flag).
      // Headless (?debug/?bench suites) or no recording → the PLAYABLE Level 0 (the arena the harnesses
      // expect + ?dev re-record).
      let started = false;
      if (shouldPlayIntro(location.search, CATALOG.level.introTrace)) started = await startIntroCutscene();
      if (!started) { document.body.classList.remove('menu'); G.gameStarted = true; reset(); }
    } else if (CATALOG.level.briefing) {
```

Add `shouldPlayIntro` to the replay import at `client/src/main.js:25` (alongside `makeReplaySession`
from Fix A).

### 3. Remove the now-dead `introSeen` write

Delete the `localStorage.setItem('introSeen', '1')` line in `finishIntro()` (`client/src/main.js:1052` —
the `try { localStorage.setItem('introSeen', '1'); } catch {}` line). After this, `introSeen` must appear
**nowhere** in `client/`: `grep -rn introSeen client/` must return zero matches.

### Why this is correct + the trade-off it accepts

The server already enforces the one-time nature: `unlockNextLevel` (called in `finishIntro`) advances
`current_progress` 1→2, and thereafter `getCurrentLevel` serves `level-2`, whose descriptor has **no**
`introTrace` → `shouldPlayIntro` returns false → no intro. So the localStorage flag was redundant. The
accepted trade-off: if `finishIntro`'s server advance fails (network error) the progress stays 1, so a
reload replays the cutscene — acceptable, because the replay is READ-ONLY and skippable and correctly
reflects "you have not actually advanced." Recorded as a DECISIONS entry (see below).

## Testing

### New unit test — the real regression guard (`client/src/replay.test.js`)

Add a test that fails if `teardown()` ever forgets a field (the exact defect being fixed). Import
`makeReplaySession` (extend the existing import in the test file) and add:

```js
test('makeReplaySession: fresh session is inactive; teardown clears every field', () => {
  const s = makeReplaySession();
  assert.equal(s.active, false);

  // simulate an ACTIVE intro cutscene (the state finishIntro must fully clear)
  s.play = { id: 'level-1-intro', cutscene: true };
  s.trace = { ticks: [{}, {}] };
  s.armed = true; s.index = 5; s.done = true;
  s.cut = { pauses: [] }; s.cutDone = true; s.cutReturning = true;
  assert.equal(s.active, true);

  s.teardown();
  assert.equal(s.active, false);
  // deepEqual the owned fields back to a fresh session's defaults — this is what catches a forgotten reset
  const fresh = makeReplaySession();
  for (const k of ['play', 'trace', 'armed', 'index', 'done', 'cut', 'cutDone', 'cutReturning'])
    assert.deepEqual(s[k], fresh[k], `teardown must reset ${k}`);
});
```

This guards the **teardown-completeness invariant** (the bug was a partial/absent reset). The
end-to-end wiring — that `finishIntro()` actually calls `rs.teardown()` at the right moment and Take-off
then runs the live sim — is covered by the live acceptance test below (the DOM/three.js glue in
`main.js` is not reachable from the Node harness, which is why the seam was extracted).

### New unit test — Fix B intro trigger (`client/src/replay.test.js`)

Add a `shouldPlayIntro` test (import it alongside `makeReplaySession`):

```js
test('shouldPlayIntro: server-authoritative gate — trace present + not headless', () => {
  assert.equal(shouldPlayIntro('', true), true);              // new/RESET player (trace present) → plays the intro — the reset→cutscene guard
  assert.equal(shouldPlayIntro('', false), false);            // progress advanced (no trace) → no intro
  assert.equal(shouldPlayIntro('?debug', true), false);       // headless visual suite → playable Level 0
  assert.equal(shouldPlayIntro('?bench=replay', true), false);// headless perf suite → playable Level 0
  assert.equal(shouldPlayIntro('?tune', true), true);         // a non-debug/bench dev flag still plays
});
```

The first assertion is the **reset → cutscene regression guard** (the exact case that failed live: a
progress-1 player with a trace-carrying level must trigger the intro, with no localStorage flag able to
suppress it).

Run: `cd client && node --test`.

### New server test — the server half of "reset → intro" (`server/src/server.test.js`)

The existing suite already spins up the app and hits `/api/players/:id/level` (which returns the full
`{ name, descriptor }` from `getCurrentLevel`), and the reset test already drives a player to progress-5
then back to 1. Extend it (cheaply, no new scaffolding) to assert the served descriptor carries
`introTrace` at progress 1 and not after advancing:

- In the **progress** test (`server/src/server.test.js` ~95): after asserting the fresh player is on
  `level-1`, also assert `(await getJson('/api/players/prog-2/level')).descriptor.introTrace` is truthy;
  after the first advance to `level-2`, assert its `descriptor.introTrace` is falsy (`undefined`).
- In the **reset** test (`server/src/server.test.js` ~129-142): after the reset lands the player back on
  `level-1`, assert `(await getJson('/api/players/reset-1/level')).descriptor.introTrace` is truthy —
  i.e. a reset player is served an intro-capable level. This is the server-side "reset → intro" guard
  that pairs with the client `shouldPlayIntro` test.

This is reachable with the current harness (the endpoint already returns the descriptor), so fold it in.
Server tests run on **both SQLite and Postgres**; this change is read-only assertions on the seeded
catalog (no schema/query change), so `db.js`/`db_postgres.js` stay untouched and in sync.

### Existing suites must still pass

The Fix A rename touches the live `?record`/`?playback` + intro-cutscene loop, so the regression risk is
on those flows. Confirm `cd client && node --test` (unit) is green and `cd server && npm test` (both
SQLite and Postgres) is green. No DB schema/query change in either fix, so `db.js`/`db_postgres.js` are
untouched.

### Live acceptance test (end-to-end — verifies the actual fixes)

1. **(Fix B — the exact case that failed live)** With an EXISTING browser that has already seen the
   intro, run `reset-progress` for that player (server sets `current_progress → 1`) and do a **plain
   reload WITHOUT clearing localStorage**. The intro cutscene must **auto-play** (previously the stale
   `introSeen` flag dropped the player into the playable Level 0).
2. The intro cutscene plays (opening card → the re-simmed fight with the P1–P4 pauses → "Return to
   base" → victory).
3. **(Fix A)** It advances 1→2 and lands on the **Level 1 Main Window briefing** with a **Take off**
   button.
4. Click **Take off** → confirm **live combat**: a controllable player ship spawns, enemies spawn, and
   keyboard/touch input moves + fires. (Before Fix A: dead screen, no ship/enemies/input.)
5. Also exercise the **Skip** path (Skip button / Escape during the cutscene) → same landing → Take-off
   → same live combat, confirming Skip → `cutsceneEnd` → `finishIntro` → `rs.teardown()` runs too.
6. After clearing the intro once (progress now 2), reload → confirm the intro does **not** replay (lands
   on the Level 1 briefing), i.e. the server-progress gate still makes it one-time in the normal case.
7. Sanity-check `?playback&id=<some recording>` still replays a fight (the Fix A rename must not regress
   it) and `?debug`/`?bench` still get the playable Level 0 (headless gate intact).

## Docs to update

- **`docs/CHANGELOG.md`** — add a bullet under the existing `## 2026-07-10` heading (newest on top),
  bold lead, covering BOTH fixes, e.g.:
  > **[2026-07-10-1303-fix-intro-replay-teardown] Intro → Take-off dead-screen fix + reset now replays
  > the intro.** (1) The playback/cutscene lifecycle state is now one `makeReplaySession()` object in
  > `replay.js` (unit-tested `teardown()`); `finishIntro()` calls `rs.teardown()` + clears `G.replayMode`
  > before landing on the Level 1 briefing, so `animate()` leaves the inert `if (REC || rs.play)` branch
  > and Take-off's `reset()` runs the live sim (previously the loop stayed stuck in playback → no
  > player/enemies/input). (2) The intro trigger is now **server-authoritative**: gated solely on the
  > served level carrying `introTrace` (present only while `current_progress===1`) + the headless check,
  > via a new pure `shouldPlayIntro()` — the redundant client `localStorage['introSeen']` guard is gone,
  > so a genuine `reset-progress` now REPLAYS the intro. New `shouldPlayIntro` unit test + a server test
  > that a progress-1/reset player is served an `introTrace`-carrying level.
- **`docs/SUMMARY.md`**:
  - Intro-flow sentence (~line 378): (a) note that on finish/Skip `finishIntro` **tears down the
    playback/cutscene session** (`rs.teardown()` + clears `G.replayMode`) so the render loop returns to
    live combat and the subsequent Take-off runs the real Level-1 sim; (b) rewrite the gating clause: the
    intro is gated **solely by server progress** (`introTrace` on the served `level-1` descriptor, present
    only while `current_progress===1`) + the headless check, via `shouldPlayIntro` — **not** localStorage;
    a genuine progress reset REPLAYS it. **Remove the "already-seen (`introSeen`)" wording** wherever it
    appears (the intro-flow sentence ~378 and the header summary ~line 6 both mention it).
  - Record/playback subsection (Tools, ~line 329+): note the playback/cutscene state is now a single
    `makeReplaySession()` object (owned state: `play`/`trace`/`armed`/`index`/`done`/`cut`/`cutDone`/
    `cutReturning`; `active` getter = the `animate()` gate; unit-tested `teardown()`).
  - Bump the `**Updated:**` date.
- **`docs/DECISIONS.md`** — add a new numbered entry **§63** (last existing is §62), recording the
  server-authoritative intro gate trade-off, e.g.:
  > **§63. Intro cutscene is gated by server progress alone (no client `introSeen`), so `reset-progress`
  > replays it.** The one-time-ness comes from `current_progress` (the server serves `introTrace` only
  > while progress===1; `finishIntro`→`unlockNextLevel` advances 1→2). We dropped the redundant client
  > `localStorage['introSeen']` guard because it persisted across a server reset and permanently
  > suppressed the cutscene on that browser, breaking the reset→replay expectation. Trade-off accepted:
  > if `finishIntro`'s advance fails (network), a reload replays the READ-ONLY, skippable cutscene —
  > which correctly reflects "you have not actually advanced." Simpler + single source of truth (§30).

## Out of scope / non-goals

- Do **not** move `replayAcc`, the record vars, `G.replayMode`, or the cutscene RUNTIME detail
  (`cutFrozen`/`cutFired`/`cutQueue`/overlay els) onto the session — only the eight gate-relevant fields
  listed in Fix A §2 move.
- Do **not** change any playback/cutscene BEHAVIOR — the `main.js` edit is a mechanical rename plus the
  `finishIntro` teardown call and the `shouldPlayIntro` gate swap; `startIntroCutscene`,
  `startPlaybackSession`, the `?playback` Restart flow, and the cutscene script/pauses are otherwise
  untouched.
- Do **not** change the server one-time gate mechanism (progress advance / `getCurrentLevel` /
  `catalog_seed` `introTrace`) — Fix B only *removes* the redundant client guard and adds read-only
  assertions; the server already gates correctly.
- Do **not** add DOM/Playwright integration tests for `main.js` — the `makeReplaySession` +
  `shouldPlayIntro` unit tests, the server test, and the live acceptance test are the coverage.
- No server schema, catalog data, or asset changes — no `publish-itch` / deploy-model step (no
  content-hashed asset changed). The only server-side edit is added test assertions.
