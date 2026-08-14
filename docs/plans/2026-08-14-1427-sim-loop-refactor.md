# Sim-loop refactor — one shared tick stepper + a sectioned `update(dt)`

**Feature ID:** 2026-08-14-1427-sim-loop-refactor · **Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor`
**Type:** behaviour-preserving refactor. **No** gameplay, balance, FX, HUD or UI change of any kind.

## Goal

Two structural problems in the client's simulation path, fixed in one pass, with **zero** observable change to
the game.

**Part 1 — the duplicated fixed-timestep tick body.** The deterministic per-tick logic exists TWICE in
`client/src/main.js`: inside the accumulator in `animate()` (the `while (replayAcc >= BENCH_DT …)` loop,
currently lines **792-814**) and inside the `window.__replay.step(n)` hook (currently lines **1543-1567**,
whose own comments say "mirror the accumulator" and "mirror the accumulator's return-home watchdog"). Both
handle: `rs.cutReturning` input clearing, `applyInput` from the trace, `update(BENCH_DT)`, the `rs.index`
advance, `recTicks` capture, `sr.captureTick` for the always-on live session, `cutsceneObserve()`, and the
`rs.noteTick`/`rs.stalled()` return-home watchdog. Editing one without the other silently breaks replay
determinism — the intro cutscene, every stored session trace, and the `22-intro-replay` guard all ride on
this code. Extract **one** shared per-tick function, unit-tested, called by both drivers.

**Part 2 — the 471-line `update(dt)`.** `client/src/sim.js:511-972` is the longest function in the client. It
is already sectioned by `// --- … ---` comments; split it along those exact boundaries into named
module-local functions so `update()` becomes a short table of contents. Pure mechanical extraction: same call
order, same code, comments travel with their code.

User-visible effect: **none.** That is the acceptance criterion, and the verification section below is how it
is proven, not assumed.

## Decisions (already settled — do not re-ask)

1. **The `!rs.done` guards in `__replay.step` are UNIFIED, not preserved as a flag.** `animate()` gates the
   whole loop with `!(rs.play && rs.done)`; `step()` instead uses a bare `if (!rs.done) update(BENCH_DT)` plus
   `!rs.done` on the index advance. The two forms are **not** the same condition — they disagree in the
   post-intro teardown state (`rs.play === null && rs.done === true`) — but that state is **unreachable from
   the `step()` hook**, and where they differ the accumulator's form is the safe one. §1.4 carries the full
   reachability argument; state that version in the code comment (do **not** write "they are equivalent" —
   an earlier draft did, and it is false). The shared function opens with the single guard
   `if (rs.play && rs.done) return 'stop'`; both callers `break` on `'stop'`. No DECISIONS entry (no real
   trade-off was settled — the chosen form is simply the correct one); a CHANGELOG note covers it.
2. **The shared function lives in `client/src/replay.js`** as a dependency-injected export
   (`stepReplayTick`), NOT as a module-local helper in `main.js`. This matches the established precedent —
   `makeReplaySession()` was pulled out of `main.js` into `replay.js` for exactly this reason (`replay.js` is
   the pure, DOM/engine-free, unit-tested core). **8 unit tests in `client/src/replay.test.js` are a
   deliverable, not a nicety** — they are the only automated guard the de-duplication can have, because the
   accumulator itself is DOM/rAF-bound.
3. **Behaviour-neutrality is proven by a one-off hash-parity run** (`__replay.hash()` sampled at fixed tick
   milestones, before vs after). **No golden hash is committed** — a committed golden would be a tripwire that
   every future intentional sim/balance change has to re-bless, which DECISIONS §30 does not buy.
   `22-intro-replay` stays the permanent guard. **A mismatch at any milestone is a hard stop, not a judgement
   call.**
4. **`update(dt)` splits into ~12 module-local functions along the existing comment sections, with the whole
   player half kept as ONE `stepPlayer(dt)`** (its locals `eng`/`accel`/`turn`/`fwd` are produced in the
   control branch and consumed later by the exhaust + `updateGroups` calls; splitting it further would add
   plumbing that does not exist today). Already-one-line delegations (`updateFlipbooks`, `updateDeferredBlasts`,
   `updateShipExhaust`, `updateDrops`, `levelRunner.update`, `settleView`, the `setPieces` loop) stay **inline**
   in `update()`. Everything stays inside `client/src/sim.js` — **no new `sim-*.js` modules**.
5. **The `?bench` replayer's own per-tick loop (`client/src/main.js:1096-1108`) is out of scope** — it has no
   `rs`/cutscene/session-capture and exists to *time* frames. Untouched.

---

## Part 0 — BEFORE you edit anything: capture the baseline hashes

This must happen **first**, on the pristine worktree (HEAD == the baseline build), because the cheapest way to
materialize "build A" is simply *not having refactored yet*. Do not skip ahead.

### 0.1 Prerequisites (once, in the worktree)

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor
npm run assets:pull          # gitignored S3 assets incl. the intro trace the guard needs
cd client && npm install && npx playwright install chromium
```

### 0.2 Add the throwaway parity scenario

Create `client/visual/scenarios/90-hash-parity.mjs` — **temporary, never committed**; it is deleted in the
final step. It mirrors `client/visual/scenarios/22-intro-replay.mjs` (same trace loading, same URL, same
`__replay.step()` driving) but samples the deterministic state hash every 60 stepped ticks and dumps the
sequence to a file whose name comes from `HASH_LABEL`:

```js
// TEMPORARY (2026-08-14-1427-sim-loop-refactor). Samples __replay.hash() through the whole intro re-sim so
// the refactor can be proven byte-identical. DELETE before committing — do not let this land on main.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'hash-parity';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LABEL = process.env.HASH_LABEL || 'before';
const OUT_DIR = '/tmp/sim-loop-refactor';

export default async function ({ page, assert, baseURL }) {
  const seedSrc = fs.readFileSync(path.join(repoRoot, 'server/src/catalog_seed.js'), 'utf8');
  const m = seedSrc.match(/introTrace:\s*'([^']+)'/);
  assert.ok(m, 'catalog_seed.js level-0 descriptor carries an introTrace');
  const tracePath = path.join(repoRoot, 'client', m[1]);
  assert.ok(fs.existsSync(tracePath), `intro trace missing: ${tracePath} — run \`npm run assets:pull\``);
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));

  await page.evaluate(([id, json]) => localStorage.setItem(`replay:${id}`, json),
    [trace.id, JSON.stringify(trace)]);
  const origin = new URL(baseURL).origin;
  await page.goto(`${origin}/?playback&id=${encodeURIComponent(trace.id)}&cutscene=1&debug`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__replay && window.__replay.status().armed)', null, { timeout: 30000 });

  // Sample AFTER each 60-tick chunk. Both the sampled tick index and the hash are recorded: a divergence in
  // WHERE the run freezes/ends shows up as a different tick index even if a hash happens to collide.
  const samples = [];
  let out = null;
  for (let i = 0; i < 120 && !out; i++) {
    const chunk = await page.evaluate(() => {
      const r = window.__replay;
      const over = () => { const c = r.cut(); return c.won || c.done || r.status().playDone; };
      const got = [];
      for (let n = 0; n < 10 && !over(); n++) {
        if (r.cut().frozen) { r.advance(); continue; }
        r.step(60);
        got.push({ tick: r.status().playIndex, hash: r.hash(), enemies: r.state.enemies.length, kills: r.state.G.kills });
      }
      if (!over()) return { got, done: null };
      const c = r.cut(), s = r.status();
      return { got, done: { kills: r.state.G.kills, cards: c.fired, won: c.won, ended: c.done,
                            playDone: s.playDone, tick: s.playIndex, total: s.total, finalHash: r.hash() } };
    });
    samples.push(...chunk.got);
    if (chunk.done) out = chunk.done;
  }
  assert.ok(out, 'the re-sim never reached a terminal state');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `hashes-${LABEL}.json`);
  fs.writeFileSync(file, JSON.stringify({ samples, final: out }, null, 2));
  console.log(`      wrote ${samples.length} hash samples → ${file}`);
  console.log(`      final: ${JSON.stringify(out)}`);
  await page.evaluate((id) => localStorage.removeItem(`replay:${id}`), trace.id);
}
```

### 0.3 Run the BEFORE pass and keep the output

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor/client
HASH_LABEL=before node visual/run.mjs 90-hash-parity
```

Expect `/tmp/sim-loop-refactor/hashes-before.json` with ~40-60 samples and `final.won === true`,
`final.kills === 4`, `final.cards === ["p0","p1","p2","p3","p4"]`. If this pass does not reach a terminal
state on the *unmodified* tree, stop and report — the environment (missing assets, stale DB) is broken and no
parity result would mean anything.

Also record, in the same terminal, the baseline unit-test count for the docs step:

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor/client && npm test   # expect 324 pass / 0 fail today
```

---

## Part 1 — one shared per-tick stepper

### 1.1 Add `stepReplayTick` to `client/src/replay.js`

Insert it **after `applyInput`** (which it calls) and **after `CUTSCENE_STALL_TICKS` / `makeReplaySession`**
so the file still reads top-down; the natural spot is right below `makeReplaySession()` (currently ends at
line **214**), before `shouldPlayIntro` (line **220**).

```js
// ONE tick of the deterministic replay/live loop — the single body shared by BOTH per-tick drivers in
// main.js: the fixed-timestep accumulator inside animate() and the synchronous window.__replay.step(n)
// hook. It used to be written out twice ("mirror the accumulator" in the step() copy), so any edit to one
// silently desynced the other. Everything OUTSIDE one tick stays with the caller: the replayAcc bookkeeping,
// the `steps < 6` cap, the cutFrozen check, the record/playback HUD, and the post-loop cutsceneEnd().
//
// Injected deps (this module stays DOM/engine-free and unit-testable):
//   rs         — the makeReplaySession() object (play/trace/index/done/cut/cutDone/cutReturning + watchdog)
//   keys       — the shared held-key map (mutated in place)
//   touchAim   — the shared touch-steering state (mutated in place)
//   dt         — the fixed step (BENCH_DT)
//   update     — the sim step, called as update(dt)
//   capture    — optional; called right after update() to snapshot this tick's input (record / live session)
//   cutObserve — cutscene observer, called when rs.cut is set (may freeze, engage return-home, or end)
//   cutEnd     — ends the cutscene (used by the return-home watchdog)
//   isWon      — () => levelRunner.won
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
export function stepReplayTick({ rs, keys, touchAim, dt, update, capture, cutObserve, cutEnd, isWon }) {
  if (rs.play && rs.done) return 'stop';            // playback finished — never step, never consume time
  if (rs.cutReturning) {
    for (const c in keys) keys[c] = false; touchAim.active = false; // no recorded input → autopilot isn't cancelled (sim manual-input check)
  } else if (rs.play && rs.trace) {
    if (rs.index < rs.trace.ticks.length) applyInput(rs.trace.ticks[rs.index], keys, touchAim);
    else { rs.done = true; return 'stop'; }         // trace exhausted with the fight unfinished
  }
  update(dt);                                       // the seeded stream is opt-in inside the sim (sim-random.js)
  if (rs.play && rs.trace && !rs.cutReturning) rs.index++;
  if (capture) capture();
  if (rs.cut) cutObserve();
  // RETURN-HOME watchdog (see CUTSCENE_STALL_TICKS): while rs.cutReturning is engaged only a WIN ends the
  // cutscene, so a run that can never dock would loop forever. Only that path reaches here — an EXHAUSTED
  // trace returns 'stop' above and is ended by the caller's post-loop cutsceneEnd().
  if (rs.cut && !rs.cutDone) {
    rs.noteTick(rs.cutReturning && !isWon());
    if (rs.stalled()) { cutEnd(); rs.done = true; return 'stop'; }
  }
  return 'ok';
}
```

**Ordering is load-bearing and must match the current accumulator exactly:** input → `update(dt)` → index
advance → capture → `cutObserve` → watchdog. (In the current `animate()` copy the capture lines sit between
the index advance and `cutsceneObserve()`; keep it there.)

### 1.2 Rewrite the accumulator body in `client/src/main.js`

Anchor: `function animate()` at **line 768**; the block to change is **792-814** (the `while` loop). Add
`stepReplayTick` to the existing `./replay.js` import at the top of `main.js` (the same import that already
brings in `applyInput`, `snapshotInput`, `makeReplaySession`, …).

Build the deps object **once per frame**, immediately before `let steps = 0;` (line 786) — not per tick — so
`live`/`recCapturing` stay correct without per-tick allocation:

```js
      let steps = 0;
      // The per-tick body is shared with window.__replay.step(n) (replay.js stepReplayTick) so the two
      // drivers can no longer drift apart. Built once per frame: `live`/`recCapturing` are read inside the
      // closures, so the values stay current.
      const tickDeps = {
        rs, keys, touchAim, dt: BENCH_DT, update,
        capture: () => {
          if (recCapturing) recTicks.push(snapshotInput(keys, touchAim));
          if (live) sr.captureTick(snapshotInput(keys, touchAim)); // always-on: capture the real operator input per sim tick
        },
        cutObserve: cutsceneObserve,
        cutEnd: cutsceneEnd,
        isWon: () => levelRunner.won,
      };
```

Keep the `while` header **byte-identical** (including `!(rs.play && rs.done)` — now redundant with the
function's entry guard, but keeping it means the wrapper's exit conditions are unchanged) and replace the
body:

```js
      while (replayAcc >= BENCH_DT && steps < 6 && !(rs.play && rs.done) && !cutFrozen) {
        if (stepReplayTick(tickDeps) === 'stop') break; // exhausted trace / stalled return-home: no time consumed
        replayAcc -= BENCH_DT;
        steps++;
      }
```

Everything after the loop is untouched: `updateRecordHud()`, `updatePlaybackHud()`, and
`if (rs.play && rs.done && rs.cut && !rs.cutDone) cutsceneEnd();` (lines 815-817). The `else` branch at 819-823
(non-deterministic live/menu `update(dt)` + `?bench` record snapshot) is untouched.

**Equivalence check to make while editing:** in the old code both early exits (`rs.done = true; break;` on
exhaustion and the watchdog's `break`) skipped `replayAcc -= BENCH_DT; steps++`. The `break` on `'stop'` sits
before those two lines, so that is preserved exactly.

Preserve the long explanatory comments that currently sit at 779-783 (the accumulator rationale) and 787-791
(why `rs.done` must gate playback only) — they describe the wrapper, which stays. The comments that describe
the per-tick body (794, 804-807) move into `stepReplayTick`.

### 1.3 Rewrite `window.__replay.step(n)` in `client/src/main.js`

Anchor: the `step(n = 1)` method at **line 1543** inside the `if (REC || rs.play)` block:

```js
    step(n = 1) {
      if (!isSimSeeded()) return this.status(); // record: not started yet (call begin() first); playback seeds on arm
      const tickDeps = {
        rs, keys, touchAim, dt: BENCH_DT, update,
        capture: () => { if (recCapturing) recTicks.push(snapshotInput(keys, touchAim)); },
        cutObserve: cutsceneObserve,
        cutEnd: cutsceneEnd,
        isWon: () => levelRunner.won,
      };
      for (let i = 0; i < n; i++) {
        if (cutFrozen) break;                                 // a card is up — call advance() to continue
        if (stepReplayTick(tickDeps) === 'stop') break;
      }
      // Mirror animate()'s post-loop exit: when the trace runs out with the fight unfinished, end the cutscene
      // instead of returning a session that can never progress.
      if (rs.play && rs.done && rs.cut && !rs.cutDone) cutsceneEnd();
      return this.status();
    },
```

The method's doc comment above it (lines 1539-1542) stays, minus the now-false "mirrors the accumulator"
phrasing — it no longer *mirrors* the accumulator, it *is* the same body. Reword to say so. Note the deliberate
difference that remains: this hook does **not** feed `sr.captureTick` (there is no live session under
`?record`/`?playback`), which is exactly why `capture` is a caller-supplied callback.

### 1.4 Why unifying the `rs.done` guards is safe (state this in the PR/commit body too)

The critic and reviewer must be able to check this rather than take it on faith. **The argument is
REACHABILITY, not state-equivalence** — the two guard forms are genuinely different conditions, and an earlier
draft of this plan got that wrong. Do not repeat the wrong version anywhere (code comment, commit, CHANGELOG).

**Where the two forms actually differ.** `!rs.done` and `!(rs.play && rs.done)` disagree in exactly one state:
`rs.play === null && rs.done === true`. That state is real and documented — it is the post-intro teardown
state described at `client/src/main.js:787-791` and asserted by `client/visual/scenarios/29-intro-live-handoff.mjs:24-25`
(`playDone === true`, `playActive === false`). It arises because the cutscene-win write at `main.js:1456` is
`cutsceneEnd(); rs.done = true;` and `cutsceneEnd()` (1468-1473) calls `finishIntro()` when `introMode`, which
runs `rs.teardown()` — nulling `rs.play` *before* `rs.done = true` executes. So "every write site is guarded by
`rs.play`" does **not** imply "the resulting state has `rs.play`".

**Why the `step()` hook can never observe that state.**

1. `window.__replay` is only created inside `if (REC || rs.play)` at `client/src/main.js:1516`, evaluated at
   module load — `REC` from `evalRecord(location.search)` (line 64) and `rs.play` from
   `evalPlayback(location.search)` (line 69). No URL flag ⇒ no `__replay` object ⇒ no `step()` caller at all.
2. The only thing that turns a `rs.done = true` write into the torn-down `rs.play === null` state is
   `introMode` (`main.js:71`), and it is set in exactly two places (`grep -n "introMode" client/src/main.js`):
   - `startIntroCutscene()` (`main.js:1386`) — unreachable on a `?record`/`?playback` load, because
     `bootstrap`'s `else if` chain (`main.js:1684-1696`) takes the `REC` / `rs.play` branch *before* it ever
     reaches the `level.name === 'level-0'` intro branch;
   - `__game.simulateIntroEnd()` (`main.js:978`) — the `?debug`-only test seam used by scenario 29, which loads
     without `?playback`, so `__replay` does not exist on that page.
3. Therefore, on every page where `step()` exists, `rs.done === true` implies `rs.play` is still set, and the
   new guard behaves exactly as the old one.
4. The one contrived way to construct the divergent state is to call `__game.simulateIntroEnd()` on a page that
   carries **both** `?playback` and `?debug` (no scenario and no production path does this). Even there the new
   form is the *correct* direction: with `rs.play === null` no trace input is applied, so the tick is a plain
   live-play tick — precisely what the accumulator deliberately does in that state (Fix A of the intro→Level-1
   dead-controls bug). The old bare `!rs.done` would freeze instead. **Test 8 in §1.5 pins this behaviour.**

**Residual behavioural deltas (both inert).** Calling `step(n)` when `rs.play && rs.done` are already true used
to run `n` dead iterations before falling through to the post-loop `cutsceneEnd()`; now it returns after zero
iterations and still runs that same post-loop `cutsceneEnd()`. In those dead iterations the old code:
- ran `cutsceneObserve()` + `rs.noteTick()` up to `n` times — inert, because `cutsceneEnd()` fires in the same
  `step()` call either way and clears everything the observer could have queued (`cutDone = true`, unfreeze,
  hide card);
- kept calling `applyInput(rs.trace.ticks[rs.index], …)` on the frozen index, so `keys`/`touchAim` were left
  holding tick *i+1* rather than tick *i* — inert, because no `update()` ran in those iterations and playback
  is finished (the next thing to touch `keys` is either live input or a fresh session).

**Consumer note.** `client/visual/scenarios/22-intro-replay.mjs:44-46` documents and depends on "`step()`
returns instantly forever once `playDone` is set". The new behaviour satisfies that at least as strictly, so the
scenario's terminal-state loop is unaffected. Its parenthetical wording ("the loop body is unreachable while
`rs.done`") becomes imprecise — it is now `rs.play && rs.done`. **Decision: leave the scenario file untouched**
(it is a comment in a guard we must not perturb during a determinism refactor) and call the wording out in the
PR body as a known, harmless nit. Do not edit `22-intro-replay.mjs`.

### 1.5 Unit tests — `client/src/replay.test.js` (deliverable)

Add `stepReplayTick` to the existing import list at the top of the file (line 3-7). Use the real
`makeReplaySession()` object (so `noteTick`/`stalled` are exercised for real), a plain `keys` object, a plain
`touchAim`, and spy functions. **Eight** tests:

1. **already-done playback is a no-op** — `rs.play = {}`, `rs.done = true` → returns `'stop'`, `update` not
   called, `rs.index` unchanged.
2. **trace exhaustion** — `rs.play`/`rs.trace` set with `rs.index === ticks.length` → returns `'stop'`, sets
   `rs.done = true`, `update` NOT called.
3. **a normal playback tick** — applies the recorded input (a key from the trace tick ends up held in `keys`),
   calls `update` exactly once with the passed `dt`, advances `rs.index` by exactly 1, returns `'ok'`.
4. **`rs.cutReturning` clears input and freezes the index** — every held key becomes `false`,
   `touchAim.active === false`, `update` still runs, `rs.index` does NOT advance, and the recorded trace tick
   is NOT applied.
5. **capture ordering** — with a shared log array, the order recorded is `update` → `capture` → `cutObserve`.
6. **live/record mode (`rs.play === null`)** — no trace input is applied, `rs.index` stays 0, `capture` still
   fires, returns `'ok'`.
7. **the return-home watchdog** — `rs.cut` set, `rs.cutReturning = true`, `isWon: () => false`: calls 1…
   `CUTSCENE_STALL_TICKS - 1` return `'ok'` with `cutEnd` never called; call `CUTSCENE_STALL_TICKS` fires
   `cutEnd` exactly once, sets `rs.done`, returns `'stop'`. Separately: with `isWon: () => true` the counter
   resets (`rs.stallTicks === 0`) and the watchdog never trips.
8. **the post-intro teardown state still steps** (this is the §1.4 guard — the one claim whose failure
   silently breaks determinism, so it gets a test rather than an argument): `rs.play = null`, `rs.done = true`
   → returns `'ok'` and calls `update` exactly **once**. Name the modelled state in the test title/comment:
   *"live play after the intro (finishIntro→teardown nulled rs.play, then the caller set rs.done=true) must
   keep stepping — the old bare `!rs.done` guard would have frozen it (intro→Level-1 dead controls,
   `29-intro-live-handoff`)"*.

---

## Part 2 — `update(dt)` becomes a table of contents

All changes are inside `client/src/sim.js`. **Mechanical extraction only:** no reordering, no renaming of
locals, no "while I'm here" fixes, no logic changes. Every existing comment moves with the code it documents.

### 2.1 The split (current line ranges → new module-local functions)

| Current lines | Content (existing section comment) | Becomes |
|---|---|---|
| 512-514 | the `!G.gameStarted / !alive / won` early return + `G.combatElapsed += dt` | **stays inline** in `update()` |
| 516-631 | repair drone, shield, `eng/accel/turn`, autopilot-vs-manual + `checkMissionZone`, turn/thrust/drag, speed cap, position, **arena drift**, soft boundary/OOB, warp-back grow, rotation + `updateBank`, engine trail, `updateGroups` | `stepPlayer(dt)` |
| 633-682 | `// --- enemy AI ---` | `stepEnemyAI(dt)` |
| 684-749 | `// --- projectiles ---` | `stepBullets(dt)` |
| 751-820 | `// --- rockets: homing … ---` (incl. the `removeRocket` closure at 755) | `stepRockets(dt)` |
| 822-834 | `// --- micro-explosions … ---` | `stepMicroExplosions(dt)` |
| 836-839 | flipbook explosions + deferred boss blasts | **stay inline** (`updateFlipbooks(dt)` / `updateDeferredBlasts(dt)`, with their comments) |
| 841-843 | engine exhaust | **stays inline** (`updateShipExhaust(dt)`, with its comment) |
| 845-859 | `// --- rocket smoke trail ---` | `stepSmokeTrail(dt)` |
| 861-875 | `// --- ship-explosion sparks ---` | `stepSparks(dt)` |
| 877-889 | `// --- ship-explosion shockwave ---` | `stepShockwaves(dt)` |
| 891-892 | `// --- transient banner ---` | `stepBannerFade(dt)` |
| 894-898 | `// --- credit popups ---` | `stepCreditPopups(dt)` |
| 900-946 | `// --- enemy deaths ---` | `stepEnemyDeaths()` (uses no `dt`) |
| 947-950 | `updateDrops(dt)` + `levelRunner.update(dt)` | **stay inline** (with their comments) |
| 952-966 | `// --- player death ---` | `stepPlayerDeath()` (uses no `dt`) |
| 968-971 | `settleView(dt)` + the `setPieces` loop | **stay inline** (with their comments) |

**12** extracted functions (count them in the table: `stepPlayer`, `stepEnemyAI`, `stepBullets`, `stepRockets`,
`stepMicroExplosions`, `stepSmokeTrail`, `stepSparks`, `stepShockwaves`, `stepBannerFade`, `stepCreditPopups`,
`stepEnemyDeaths`, `stepPlayerDeath`) — do **not** merge two sections to hit a smaller number.
`stepPlayer` swallows the arena-drift block (590-594) even though it is not
player-specific: it sits mid-block and moving it out would change the call order. Say so in a one-line comment
inside `stepPlayer`.

All locals move with their section: `eng`/`accel`/`turn`/`manual`/`fwd`/`maxSpeed`/`docking`/`lifted`/`p`/
`dxc`/`dzc`/`oob`/`edge`/`near` into `stepPlayer`; `removeRocket` into `stepRockets`. Module-level state
(`_bulletP0`, `firedBanners`, `SPIRAL_RADIUS`, `SPIRAL_ANGULAR`, `DRAG`, `IDLE_DRAG`, `ENEMY_FIRE_GRACE`) is
already module-scoped and needs no change.

### 2.2 The resulting `update(dt)`

```js
export function update(dt) {
  if (!G.gameStarted || !G.player.alive || levelRunner.won) return; // idle on the welcome screen / frozen on death/victory

  G.combatElapsed += dt; // unpaused combat clock (update() is skipped while paused) — drives the enemy hold-fire grace

  stepPlayer(dt);            // repair/shield, control or autopilot, speed cap, arena drift + soft boundary, exhaust, firing
  stepEnemyAI(dt);
  stepBullets(dt);
  stepRockets(dt);
  stepMicroExplosions(dt);
  // --- flipbook (sprite-sheet) explosions: advance frame, fade + drop when finished ---
  updateFlipbooks(dt);
  // --- deferred boss chain-detonations: fire each staged blast when its delay elapses ---
  updateDeferredBlasts(dt);
  // --- engine exhaust: advance every ship's attached plume (uTime) + decay its thrust throttle so a ship
  //     that stops thrusting fades out. Fixed-cost render objects, not a growing pool (exhaust-fx.js). ---
  updateShipExhaust(dt);
  stepSmokeTrail(dt);
  stepSparks(dt);
  stepShockwaves(dt);
  stepBannerFade(dt);
  stepCreditPopups(dt);
  stepEnemyDeaths();
  // pull in-range drops toward the ship (blue line while active); inside update(dt) → frozen on pause
  updateDrops(dt);
  // drive spawning + phase transitions from the active level
  levelRunner.update(dt);
  stepPlayerDeath();

  settleView(dt); // camera rigid-follow + stars + system-body bearings + speed-field wrap

  // mission set-pieces: their own slow animation (station spin, beams, exhaust, …)
  for (const sp of setPieces) sp.update?.(dt);
}
```

### 2.3 Where the extracted functions go

Place them **immediately after** `update()`'s closing brace (current line 972) and before the `settleView`
doc-comment block (currently 974-981), in call order, under a banner:

```js
// ---------- update(dt) sections ----------
// Each function below is one section of the per-tick sim, lifted verbatim out of update() (2026-08-14
// refactor: update() was 471 lines). Call order in update() IS the execution order — do not reorder.
```

Function declarations hoist, so defining them after `update()` is valid. Do **not** convert them to `const … =
() => {}` (that would not hoist).

### 2.4 Mechanical-extraction self-check

Before running any test, prove the move was verbatim:

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor
norm() { sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | sort; }
git show HEAD:client/src/sim.js | norm > /tmp/sim-loop-refactor/sim-before.txt
norm < client/src/sim.js > /tmp/sim-loop-refactor/sim-after.txt
diff /tmp/sim-loop-refactor/sim-before.txt /tmp/sim-loop-refactor/sim-after.txt
```

The diff must contain **only**: the new `function step*(…) {` headers, their closing `}` lines, the new call
lines inside `update()`, the new banner comment lines, and the removed `}`/blank bookkeeping. Every other
original line must appear on **both** sides. Any content line that exists only on one side is an unintended
edit — fix it before moving on. (`git diff -w client/src/sim.js` is the human-readable companion view.)

**Limit of this check:** it sorts, so it is order-insensitive by construction — it catches added, removed and
changed lines, but **not a reordering** of lines within or between sections. Reordering is covered by **V1
hash parity** (any change to the execution order moves entity positions and so changes the hash) and by
reading `git diff -w`.

---

## Verification (the centrepiece — do all of it, in this order)

### V1. Hash parity, before vs after — the behaviour-neutrality proof

The BEFORE pass was captured in Part 0. After **both** parts are implemented:

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor/client
HASH_LABEL=after node visual/run.mjs 90-hash-parity
diff /tmp/sim-loop-refactor/hashes-before.json /tmp/sim-loop-refactor/hashes-after.json && echo "HASH PARITY OK"
```

- The two files must be **byte-identical** — every `{tick, hash, enemies, kills}` sample at every milestone,
  plus the `final` block (kills, cards, won, tick/total, finalHash).
- **A mismatch at ANY milestone is a hard stop.** Do not rationalize it ("only the last sample", "only one
  hash", "probably load timing"). The refactor changed the sim; find what and fix it, or revert and re-plan.
  The intro re-sim is fully deterministic under `__replay.step()` — there is no legitimate source of variance
  between two runs of the same build on the same machine. If you suspect flakiness, prove it: re-run
  `HASH_LABEL=before2` on the *refactored* tree and confirm `after` == `before2` first.
- Paste both `final` blocks and the sample count into the PR/commit body as the record.
- Both passes must run on the same machine, same Chromium binary, same pulled assets, with no other flags.
- **Scope of what V1 proves.** It drives the `window.__replay.step(n)` caller only — it proves the shared
  `stepReplayTick` body and the whole of Part 2 (`update(dt)`) are byte-identical, but it does **not** exercise
  the `animate()` accumulator rewrite (that path needs real rAF frames). The accumulator caller is covered by
  **V4**'s `29-intro-live-handoff` (live play still steps after the intro — the `rs.done` gate), `30-session-upload-on-hide`
  (`sr.captureTick` still fires per live tick, i.e. the `capture` callback is wired), `04-combat` (the plain
  live path) and by **V5**'s manual pass. Do not read "HASH PARITY OK" as covering both drivers.

### V2. The mandatory intro guard

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor/client
node visual/run.mjs 22-intro-replay
```

Must pass: 4 kills, cards `p0..p4` in order, `won === true`. This is the permanent guard that stays after the
temporary parity scenario is deleted.

### V3. Client unit tests

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor/client && npm test
```

All green (324 at the Part-0 baseline + the 8 new `stepReplayTick` tests → **332**; if your Part-0 baseline
count differs, the expected total is baseline + 8). Server tests are untouched by this change and
are not required; run `cd server && npm test` only if you touched anything under `server/` (you should not).

### V4. The wider visual suite

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor/client && npm run test:visual
```

**Known flaky baseline: ~6 scenarios fail at baseline on this suite** (software WebGL timing). Judge by the
*reliably-passing set* and **zero page errors**, not by a green board. The honest way to do it: you already
have a baseline run available — if in doubt about a failure, `git stash` the change, re-run just that
scenario, and compare. These four are the ones this refactor could plausibly break and they must pass:
`22-intro-replay` (deterministic re-sim), `29-intro-live-handoff` (the accumulator still steps live play after
the intro — the `rs.done` gate), `30-session-upload-on-hide` (`sr.captureTick` still fires per live tick),
`04-combat` (the plain live `update(dt)` path).

### V5. Replay/intro impact statement

This change touches the tick path, so state the impact explicitly (required for any change near the sim):

- **No sim math, collision, damage, RNG draw or ordering changes.** Part 2 is a verbatim code move inside one
  function; Part 1 moves per-tick control flow between callers without altering the sequence of `update()`
  calls or the input applied to them.
- Consumers of the deterministic re-sim: the **Level-0 intro cutscene** (the `introTrace` on the `level-0`
  descriptor in `server/src/catalog_seed.js`), any `?playback` trace, and the **stored session recordings** at
  `/admin/sessions`. All of them replay through the same `stepReplayTick` after this change.
- The proof that none of them diverge is V1 (identical hash sequence for the canonical intro trace) plus V2.
- Live manual check at the end (Stage 9 of the pipeline, on the deployed build): reset progress → play the
  intro end-to-end → it reaches victory and lands on the Level 1 briefing → take off into Level 1 and confirm
  the controls respond (the `rs.done` live-play gate).

### V6. Delete the throwaway scenario

```bash
rm /Users/kbagaiev/Projects/ag-wt/2026-08-14-1427-sim-loop-refactor/client/visual/scenarios/90-hash-parity.mjs
git status --porcelain   # must NOT list 90-hash-parity.mjs
```

---

## Docs to update

1. **`docs/CHANGELOG.md`** — one bullet under `## 2026-08-14` (create the heading if it is not there):

   > - **Sim loop de-duplicated + `update(dt)` sectioned (pure refactor, no behaviour change).** The
   >   fixed-timestep tick body was written twice in `client/src/main.js` — once in `animate()`'s accumulator,
   >   once in `window.__replay.step(n)` ("mirror the accumulator") — so an edit to one could silently desync
   >   replays. Both now call one shared `stepReplayTick()` in `client/src/replay.js` (dependency-injected,
   >   8 new unit tests). The two copies' guards differed (`!rs.done` vs `!(rs.play && rs.done)`); they
   >   disagree only in the post-intro teardown state (`rs.play` nulled by `finishIntro`, `rs.done` still
   >   true), which the `?record`/`?playback`-only `step()` hook can never reach — so they are unified on the
   >   accumulator's live-play-safe form, with a unit test pinning that a torn-down session keeps stepping.
   >   `client/src/sim.js`'s 471-line `update(dt)` was split along its existing comment
   >   sections into 12 module-local `step*()` functions (all still in `sim.js`); `update()` is now a table of
   >   contents. Proven behaviour-neutral by a before/after `__replay.hash()` parity run over the whole
   >   Level-0 intro re-sim (identical at every milestone), plus `22-intro-replay`.

2. **`docs/SUMMARY.md`** — edit in place (and bump the `**Updated:**` date near the top of the file):
   - The **real-time pacing / live play** bullet (currently lines **433-444**, under
     "Combat record/playback (input-replay)"): note that the accumulator and `__replay.step()` now share ONE
     per-tick body, `stepReplayTick()` in `replay.js`; the accumulator keeps only the wrapper (`replayAcc`,
     the 6-step cap, the HUDs, the post-loop `cutsceneEnd`). Keep the existing `rs.done` explanation — it is
     still exactly right — but reword "`while (… && !(rs.play && rs.done) …)`" to mention that the same guard
     now opens `stepReplayTick`.
   - The **two termination guards** bullet (currently lines **465-475**): the sentence "Both loops
     (`animate()` and `__replay.step()`) carry both exits" is now stale — they carry them because they are the
     same body. Reword.
   - The `sim.js` entry in **Client module layout** (line **2739**): describe `update(dt)` as a table of
     contents over the module-local per-section steppers (`stepPlayer`/`stepEnemyAI`/`stepBullets`/
     `stepRockets`/the FX steppers/`stepEnemyDeaths`/`stepPlayerDeath`), all inside `sim.js`.
   - The `replay.js` entry in **Client module layout** (lines **2765-2775**): add `stepReplayTick` next to
     `makeReplaySession()` as the shared per-tick body used by both drivers.
   - The **Tests** section (the client-logic bullet around lines **2778-2800**): add the `stepReplayTick`
     cases (entry guard incl. the post-intro `rs.play=null && rs.done=true` state, exhaustion, index advance,
     capture ordering, watchdog) and update the test count if the section quotes one.

3. **`docs/DECISIONS.md`** — **no entry.** The one candidate trade-off (the `rs.done` guards) is not a
   trade-off: the two forms only differ in a state the `step()` hook cannot reach, and the retained form is
   the live-play-safe one already required elsewhere. DECISIONS §30 says don't manufacture ceremony. The
   reasoning lives in the `stepReplayTick` header comment (§1.1), unit test #8, and the CHANGELOG bullet.

---

## Non-goals (do not do these)

- **The `?bench` replayer's own per-tick loop** (`client/src/main.js:1096-1108`, plus `fullFrame`/`simFrame`) —
  a third, differently-shaped loop with no `rs`/cutscene/session state, built to *time* frames. Leave it alone.
- **`__game.stepSim(n)`** (`client/src/main.js:991`, the `?debug` headless stepping hook) — a fourth raw
  `update(BENCH_DT)` driver, also with no `rs`/capture state. `update`'s signature does not change, so it is
  unaffected; do not touch it (it completes the consumer trace: `animate()`, `__replay.step()`, `?bench`,
  `__game.stepSim`).
- **The comment in `client/visual/scenarios/22-intro-replay.mjs:45-46`** ("the loop body is unreachable while
  `rs.done`" → strictly now `rs.play && rs.done`) — deliberately left as is (§1.4); mention it in the PR body,
  do not edit the guard scenario during a determinism refactor.
- **The ESM cycle `main.js ↔ mainwindow.js/welcome.js`** — separate, deferred item.
- **Moving the `?dev`/`?debug`/`?bench` blocks out of `main.js` into dynamically-imported modules** — deferred.
- **The partial `dom.js` convention** — deferred.
- **New `sim-*.js` modules.** Part 2 stays entirely inside `client/src/sim.js` (explicitly ruled out as too
  invasive for this pass).
- **Any gameplay, balance, FX, HUD, audio or UI change**, however tempting while reading these 471 lines. No
  renames of exported symbols, no dead-code removal, no comment "cleanup", no reordering. If you spot a real
  bug, write it down in the PR body — do not fix it here.
- **Committing the `90-hash-parity.mjs` scenario** or any golden hash constant.
- **`server/`** — untouched.

## Done checklist

- [ ] Part 0 baseline hashes captured on the unmodified tree (`/tmp/sim-loop-refactor/hashes-before.json`).
- [ ] `stepReplayTick` added to `client/src/replay.js` with the **reachability** comment (§1.1/§1.4 — not the
      discarded "equivalent state" wording).
- [ ] `animate()`'s accumulator body replaced; wrapper (`replayAcc`, `steps < 6`, HUDs, post-loop
      `cutsceneEnd`) unchanged.
- [ ] `window.__replay.step(n)` replaced; its stale "mirror the accumulator" wording reworded.
- [ ] 8 new tests in `client/src/replay.test.js` (incl. #8, the `rs.play=null && rs.done=true` post-intro
      state); `npm test` green (baseline + 8 → 332).
- [ ] `update(dt)` split into 12 `step*()` functions in `sim.js`; the sorted-line self-check (2.4) shows only
      headers/closers/call lines (it cannot see reordering — V1 covers that).
- [ ] `diff hashes-before.json hashes-after.json` → identical (pasted into the PR body).
- [ ] `node visual/run.mjs 22-intro-replay` passes.
- [ ] Full visual suite run; `22`/`29`/`30`/`04` pass, no page errors, failures match the known flaky baseline.
- [ ] `90-hash-parity.mjs` deleted; `git status` clean of it.
- [ ] SUMMARY sections updated + `**Updated:**` bumped; CHANGELOG bullet under 2026-08-14; no DECISIONS entry.
