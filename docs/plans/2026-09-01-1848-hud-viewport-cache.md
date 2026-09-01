# Cache the viewport in `applyOrientation` — the HUD stops forcing synchronous layout every frame

**Feature id:** `2026-09-01-1848-hud-viewport-cache`
**Source brief:** `docs/plans/hud-viewport-layout-thrash.md` (maintainer-authored; read it for the measurement
and the device passport — it is the *why*, this file is the *how*).
**Size:** ~15 lines of source across two files, plus one new visual scenario. Do not inflate it.

---

## 1. Goal

`gameW()` / `gameH()` (`client/src/engine.js:34-35`) read `window.innerWidth` / `innerHeight` on **every
call**. Those are layout-inducing reads: if the layout is dirty Blink must flush style + layout
synchronously before it can answer. Five HUD functions call the pair every frame, each interleaved with
their own style writes, so the frame is a write → read → write → read sequence and every read forces a
mid-frame recalc (measured on a real Redmi 15C: **1.82 forced recalcs/frame, 0.99 ms/frame**; roughly two
thirds of the `js.dom` the game reports is this self-inflicted layout).

Fix: make the two accessors return a **cached** value, refreshed in `applyOrientation()`
(`client/src/engine.js:82`) — which is already documented as *"the only place we size the renderer"* and is
already bound to `resize` + `orientationchange` (`client/src/main.js:1974-1975`). Signatures are unchanged,
so all seven call sites keep working untouched.

**This is not a perf change and must not be justified or reported as one.** The frame is GPU-bound (in the
same trace: renderer main thread 36 % busy, GPU process 66 %, 117 long tasks vs 9). The ~1 ms saved will be
absorbed into GPU wait. **Do not report an fps delta as a success criterion, and do not re-measure the phone
numbers — they came from a USB-attached device this session does not have.** The user-visible effect is:
none intended. The effect that matters is that the main thread stops doing work it invented for itself, and
`js.dom` starts meaning what it says.

The other half of the deliverable is a **guard scenario** — see §4 and §5.

---

## 2. Decisions (already settled — do not re-ask)

| # | Question | Decision |
|---|---|---|
| 1 | Boot-ordering edge (a `gameW()` call before `applyOrientation()` returns `0`) | **Initialize at declaration**: `let _gameW = window.innerWidth, _gameH = window.innerHeight;`. No throw, no fail-loud accessor — a hard error at boot is a worse outcome than a correct pre-boot value. **Leave `engine.js:58` and `:77` alone** (they read `window` directly at module-eval); minimal diff. |
| 2 | How the guard observes the cache | **Both**: (a) add `get gameW()` / `get gameH()` to the `?debug` `window.__game` hook (inert in production), **and** (c) a *behavioral* assertion that the off-screen edge markers land on the **new** viewport's edge box after a resize. (c) is the one that covers the maintainer's stated top risk — "a stale cache means HUD markers land in the wrong place, and on a phone rotation you see it immediately" — so it is written with teeth (§4, Case 2). |
| 3 | Negative test of the guard | **Both**: (a) a required one-time manual proof — revert the two accessors to the live-read form, run scenario 48, record the **failure output verbatim** in the final report, restore the fix (§5); **and** (b) a permanent ~3-line self-check inside the scenario (deliberately read `window.innerWidth` once, assert the counter incremented, then zero it) so the instrumentation can never silently stop counting. |
| 4 | `toGame()` (`engine.js:38`) still reads `window.innerWidth` live on pointer events | **Fold it onto the cache**: `gameH() - clientX` (when rotated, the game height *is* the raw window width). Same three lines, same cache, removes the last live viewport read on the interaction path. Call it out in the plan text and in the SUMMARY edit. |
| 5 | DECISIONS entry | **Yes** — a cached viewport vs a live read is a real trade-off (staleness risk bought in exchange for no forced layout). New **§149**, text in §6.3. |

Baked-in assumptions, already accepted:

- Case 1 asserts **strict zero** `innerWidth`/`innerHeight` reads over a fixed count of real rAF frames in
  **steady state** (no resize, no pointer events inside the window). Verified there is no other per-frame
  reader in the client: the only reads are `engine.js:34,35,38,58,77,84`, `device.js:43,54` (boot + resize
  only, and `applyDevice()` is called *from* `applyOrientation()`, so a resize legitimately reads the
  window), and `main.js:135` (the `?netjerk` dump — not per-frame).
- Frames are driven by **chained `requestAnimationFrame`** (precedents:
  `client/visual/scenarios/44-playable-intro.mjs:60`, `37-netsim.mjs:225`) — never a wall-clock sleep, and
  never `__game.stepSim` (the HUD updaters live in the `animate()` DOM block, `client/src/main.js:1121-1134`,
  not in the sim step).
- Case 2 resizes with `page.setViewportSize` (precedent: `client/visual/scenarios/15-mobile-landscape.mjs:12`),
  and the zero-read window is scoped **before** the resize.
- Brief §5.4 ("does URL-bar churn reach `applyOrientation`?") is **already verified** —
  `client/src/main.js:1974-1975` binds both `resize` and `orientationchange` straight to `applyOrientation`.
  No investigation step.

---

## 3. Source changes

### 3.1 `client/src/engine.js:34-39` — the cache + `toGame`

Replace the two accessors and `toGame`'s rotated branch. Keep the existing block comment above them
(lines 27-33) and extend it; the new code:

```js
// The logical game size is CACHED, not read live. `window.innerWidth/innerHeight` are layout-inducing
// reads, and five per-frame HUD functions call this pair interleaved with their own style writes, which
// forced a synchronous style+layout flush mid-frame (measured on a real phone: 1.82 forced recalcs and
// 0.99 ms per frame — docs/plans/hud-viewport-layout-thrash.md). applyOrientation() below is the single
// choke point for boot/resize/orientationchange, so it is the ONE place that reads the viewport.
// Initialized here (rather than left at 0) so a caller that runs before the boot-time applyOrientation()
// still gets a real size: G.rotated is not set yet at module-eval, and unrotated is the correct answer
// for that instant. See DECISIONS §149.
let _gameW = window.innerWidth, _gameH = window.innerHeight;
export const gameW = () => _gameW;
export const gameH = () => _gameH;
// Inverse of CSS `transform: translateX(100vw) rotate(90deg); transform-origin: top left` → game coords.
// Reads the CACHE too (when rotated the game height IS the raw window width), so a pointer event never
// forces layout either.
export function toGame(clientX, clientY) {
  return G.rotated ? { x: clientY, y: gameH() - clientX } : { x: clientX, y: clientY };
}
```

`_gameW`/`_gameH` are declared at module top level (line ~34), well above `applyOrientation`'s definition
(:82) and its boot call (:91) — no TDZ issue, the `let` initializer runs first.

### 3.2 `client/src/engine.js:82-90` — `applyOrientation` writes the cache

```js
export function applyOrientation() {
  applyDevice();                                                  // recompute form axis + body classes
  G.rotated = Device.hasTouch && window.innerHeight > window.innerWidth; // touch device held in portrait
  document.body.classList.toggle('rot', G.rotated);
  // The viewport read on THIS path, once per resize (applyDevice() at device.js:54 and the
  // G.rotated test above read it too — ~5 reads per resize, all outside the frame; what the
  // change removes is the ~10 reads PER FRAME). MUST be after G.rotated is set — the two swap on it.
  _gameW = G.rotated ? window.innerHeight : window.innerWidth;
  _gameH = G.rotated ? window.innerWidth  : window.innerHeight;
  camera.aspect = _gameW / _gameH;
  camera.updateProjectionMatrix();
  renderer.setSize(_gameW, _gameH);
}
```

The old `const w = gameW(), h = gameH();` at `:86` goes away — the function now assigns the cache and uses
it directly.

**Do not touch** `engine.js:58` (`renderer.setSize(window.innerWidth, window.innerHeight)`) or `:77`
(the camera's initial aspect). They run at module-eval, before `applyOrientation()`, and are corrected by
its boot call at `:91`. Minimal diff (decision 1).

### 3.3 `client/src/main.js` — two getters on the `?debug` hook

`gameW`/`gameH` are already imported at `client/src/main.js:16`. Inside the `window.__game = { … }` literal
(starts at `client/src/main.js:1271`), next to the other diagnostics (e.g. beside
`get gameStarted() { … }` around `:1309`), add:

```js
    // The CACHED logical game size (engine.js). Exposed so 48-hud-viewport-cache can prove the cache
    // TRACKS a resize rather than merely never being read (a frozen cache passes a zero-read test).
    get gameW() { return gameW(); },
    get gameH() { return gameH(); },
```

These are **getters returning numbers**, so the scenario reads `__game.gameW` (not `__game.gameW()`). Keep
that consistent.

### 3.4 Nothing else changes

The five HUD call sites (`client/src/hud.js:198,231,279,302,356`) and `eventNdc`
(`client/src/main.js:451`) are untouched — same signatures, same values.

---

## 4. The guard: `client/visual/scenarios/48-hud-viewport-cache.mjs` (new file)

### 4.1 What it is defending — the sixth-function property

The five HUD updaters were written from **one template** (`const w = gameW(), h = gameH(), margin = 0.92;`
at `hud.js:198`, `:231`, `:279`, and the same opening at `:302`, `:356`). A sixth overlay will be written
from that same template. The guard exists so that when someone writes that sixth function **against
`window.innerWidth` directly**, the suite fails.

That is why the counter is installed as an **own-property shadow on `window`**: it counts a read from
**any caller anywhere in the page**, not just from `engine.js`. A sixth function that calls `gameW()`
instead reads the cache, produces no window read, and correctly passes — there is no defect in that case.

Honest limit, state it in the file's header comment: the guard covers the
`window.innerWidth`/`innerHeight` pattern — the template actually in question. A future function that
forced layout via `getBoundingClientRect()` or `documentElement.clientWidth` would not be caught by it.
(`hud.js:137`'s `void n.offsetWidth` is a *deliberate* reflow on the hud-log path, not per-frame, and is
explicitly out of scope.)

### 4.2 Shape

Boot state: `client/visual/run.mjs` normally hands every scenario a live level-0 fight (player alive,
result overlay hidden, intro silenced), viewport 1280×800. **Do not depend on that.** The runner shares one
`spacegame_test` player across runs *and across worktrees*, so leftover DB state can leave the page on the
Welcome or the Hangar with no fight running — `06-pause.mjs:16-20` exists for exactly this. Open with the
same fallback and then assert the state, so the guard's reliability never rests on shared DB state.

Sequence:

0. **Make the boot state unambiguous.**
   ```js
   await page.evaluate(() => {
     const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
     if (vis('mainwin')) document.getElementById('mw-takeoff').click();
     else if (vis('welcome')) document.getElementById('takeoff').click();
   });
   await page.waitForFunction(() => !!(window.__game && window.__game.gameStarted && window.__game.player), null, { timeout: 10000 });
   ```
   Then `assert.ok(await page.evaluate(() => window.__game.gameStarted), 'a fight is running (the HUD path is live)')`.

1. **Freeze + seed.** `__game.setPaused(true)` (exposed at `main.js:1310`) — the DOM block of `animate()`
   runs regardless of `G.paused` (`main.js:1121-1134` sits outside the `if (!G.paused …) update(dt)`), so
   the HUD keeps updating while the world stands still; `setPaused` shows `#pause-overlay`, **not** the
   result `overlay` the HUD early-returns on, so markers stay live. Then spawn one enemy far off-screen so
   at least one edge marker exists every frame:
   ```js
   const g = window.__game, p = g.player;
   g.setPaused(true);
   const e = g.spawnEnemy('fighter');
   e.pos.x = p.pos.x + 400; e.pos.z = p.pos.z + 150;   // leave e.pos.y on the bullet plane
   ```
   (`pos` is a `Vec3` — `client/src/sim-core/vec.js:25`; setting `.x`/`.z` in place is enough. Precedent for
   `spawnEnemy('fighter')` in a scenario: `client/visual/scenarios/08-arena-boundaries.mjs:43`.)

   **The arena is not empty when you get here.** Level-0's wave 1 puts a basic pirate in the world
   (level-0's first phase, `server/src/catalog_seed.js:733` — `maxConcurrent: 1`; the runner steps only until
   `enemyCount > 0`, `run.mjs:129-141`), spawned on
   a ring 70-130 u from the arena centre (`sim-core/ship-entity.js:179`). With `CAM_OFFSET (0,110,26)`, fov 55
   and aspect 1.6 the visible ground patch is only ~±94 u in x by ~±60 u in z, so that pirate is off-screen
   more often than not — i.e. it usually owns a marker too, and `setPaused(true)` freezes it. Your seeded
   enemy is `push`ed LAST (`sim-core/ship-entity.js:191`) and marker-pool slots are handed out in `enemies`
   order (`hud.js:198-213`), so it is **never** `markerPool[0]`. Step 3's sampler is written around that.

2. **Instrument + self-check (decision 3b).** Shadow both properties with counting getters that
   **delegate** to the originals, so behavior is unchanged:
   ```js
   const findDesc = (obj, key) => {
     for (let o = obj; o; o = Object.getPrototypeOf(o)) {
       const d = Object.getOwnPropertyDescriptor(o, key);
       if (d) return d;
     }
     return null;
   };
   const probe = { n: 0, orig: {} };
   for (const key of ['innerWidth', 'innerHeight']) {
     const d = findDesc(window, key);
     if (!d || !d.get) throw new Error(`no getter for window.${key}`);
     probe.orig[key] = d;
     Object.defineProperty(window, key, {
       configurable: true, enumerable: true, set: d.set,
       get() { probe.n++; return d.get.call(window); },
     });
   }
   window.__vpProbe = probe;
   const before = probe.n; void window.innerWidth; const counted = probe.n - before; // self-check
   ```
   Assert `counted === 1`. Then zero `probe.n`.

3. **Case 1 — zero reads over N real frames.** `FRAMES = 8`. Inside a single `page.evaluate` (one CDP
   round trip, no wall-clock waits):
   ```js
   const frame = () => new Promise((r) => requestAnimationFrame(r));
   await frame();                       // land on a frame boundary
   const t0 = markerSig();              // proof-of-life sample (see below)
   window.__vpProbe.n = 0;              // zero AFTER the boundary frame
   for (let i = 0; i < FRAMES / 2; i++) await frame();
   window.__game.enemies.at(-1).pos.z += 400;   // move the seeded enemy: forces a re-place
   for (let i = 0; i < FRAMES / 2; i++) await frame();
   return { reads: window.__vpProbe.n, t0, t1: markerSig() };
   ```
   where `markerSig()` is a signature over **every** visible edge arrow — deliberately **independent of
   marker-pool ordering**:
   ```js
   const markerSig = () => [...document.querySelectorAll('#markers .marker')]
     .filter((n) => n.style.display === 'block')
     .map((n) => n.style.transform)
     .join('|');
   ```
   Sampling "the first visible marker" would be **wrong** and would fail on a working build: pool slots go
   to enemies in `enemies` order, the seeded enemy is last, and the pre-existing level-0 pirate (step 1) is
   both usually off-screen and — under pause — stationary, so the first arrow never moves. The joined
   signature changes as soon as the seeded enemy's own arrow moves, wherever it sits in the pool.

   Assertions, in this order:
   - `t0` and `t1` are non-empty — an edge marker is actually being placed (the HUD path ran at all);
   - `t1 !== t0` — **anti-vacuity**: `updateMarkers` really executed *inside* the counted window. Without
     this the whole test could pass by measuring nothing (the HUD functions early-return when there is no
     player or the result overlay is up, and a zero-read assertion over frames that ran no HUD code passes
     trivially). The world is paused, so the only thing that can move an arrow is the deliberate `pos.z`
     bump — deterministic, not dependent on AI drift.
   - `reads === 0` — the actual guard. Message must include the observed count.

   **If the anti-vacuity check goes red, do NOT weaken or delete it.** It is the one thing standing between
   this guard and a vacuous pass. Diagnose instead, in this order: (1) is a fight running
   (`__game.gameStarted`, step 0)? (2) does `#markers .marker` hold at least one `display:block` element?
   (3) did the bump reach the seeded enemy (`__game.enemies.at(-1)` — check it is yours)? (4) is the seeded
   enemy actually off-screen (if its arrow is absent, push it further out, e.g. `+700`)? Only if the
   pre-existing enemies genuinely get in the way, isolate the seeded one right after spawning it
   (`g.enemies.splice(0, g.enemies.length - 1)` — the leftover meshes are cosmetic and affect no assertion)
   and say so in a comment. Loosening the assertion is not one of the options.

4. **Case 2 — the cache tracks a resize (teeth).** `VIEW_B = { width: 900, height: 600 }` (smaller **and** a
   different aspect: the shrink reproduces the phone-rotation symptom — a stale cache puts markers outside
   the visible area).
   - Sample the visible markers **before** the resize (parse the `translate3d(Xpx,Ypx,0)` numbers out of
     `style.transform` with a regex — those are raw game-space px, and the harness context is not touch so
     `G.rotated` is false and game space == viewport space).
   - Zero `window.__vpProbe.n` **immediately before** `page.setViewportSize`, so the next count means
     "reads caused by THIS resize" and nothing else.
   - `await page.setViewportSize(VIEW_B)`, then drive 3 rAF frames in the page.
   - Assert `__game.gameW === 900 && __game.gameH === 600` (decision 2a).
   - Assert `probe.n > 0` — positive proof the refresh came from a **fresh window read** inside
     `applyOrientation` (`applyDevice()` legitimately reads it too; that is exactly why the zero-read
     window is scoped before the resize).
   - Behavioral, with teeth (decision 2c). Every visible `#markers .marker` — enemy, drop and mission
     arrows all share the same rule (`hud.js:198-213`, `:231-`, `:279-284`; `margin = 0.92`, and
     `k = margin / max(|x|,|y|)` normalizes the dominant axis to exactly 0.92) — must satisfy, against the
     **new** dimensions:
     ```js
     assert.ok(m.x >= 0 && m.x <= 900 && m.y >= 0 && m.y <= 600, 'edge marker is inside the NEW viewport');
     const edge = Math.max(Math.abs(2 * m.x / 900 - 1), Math.abs(2 * m.y / 600 - 1));
     assert.ok(Math.abs(edge - 0.92) < 0.02, `edge marker sits on the 0.92 edge box of the NEW viewport (got ${edge.toFixed(3)})`);
     ```
     plus `markers.length > 0` so this cannot pass on an empty set. Arithmetic check that this has teeth:
     with a **frozen** cache (still 1280×800) a right-edge marker is placed at `0.96 × 1280 = 1228.8` px —
     outside the 900-px viewport, and `2 × 1228.8 / 900 − 1 = 1.73`, nowhere near 0.92. Both assertions fire.
     `place()` rounds to `toFixed(1)`, so the 0.02 tolerance is ~30× the rounding error.
   - `await shot('after-resize')` — one PNG artifact for review.

5. **Cleanup.** Restore the original descriptors (`Object.defineProperty(window, key, probe.orig[key])`)
   and `delete window.__vpProbe`. Hygiene only — the runner reloads the page per scenario.

### 4.3 Notes for the implementer

- Keep the file in the tone of its neighbours: a header comment that states what defect it defends and
  why the test is shaped this way (see `15-mobile-landscape.mjs` and `16-enemy-health-bar.mjs`).
- The snippets above are **illustrative, not literal** — write them out properly and make the scenario
  actually run before calling it done.
- After the resize `applyDevice()` reclassifies the form 1280×800 `desktop` → 900×600 `tablet`
  (`classifyForm`, `client/src/device.js:31-37`) and swaps a body class. No `.marker` CSS keys off
  `dev-*` (checked `client/styles.css:1088-1103`), so this is inert — but if a marker unexpectedly
  disappears, that is the first thing to look at.
- `page.setViewportSize` is per-page and every scenario reloads, so it cannot leak to another scenario
  (same as `15-mobile-landscape.mjs`).

---

## 5. Negative test of the guard — REQUIRED, and its output goes in the final report

A guard that passes both before and after is not a guard. Prove it fails against the pre-fix code:

1. With scenario 48 green, temporarily revert **only** the two accessor bodies in `client/src/engine.js`
   to the live-read form (leave the `applyOrientation` assignments in place so the file still parses and
   Case 2 still has a fresh value):
   ```js
   export const gameW = () => G.rotated ? window.innerHeight : window.innerWidth;
   export const gameH = () => G.rotated ? window.innerWidth : window.innerHeight;
   ```
2. Run `node visual/run.mjs 48-hud-viewport-cache` from `client/`.
3. **Expected failure mode, spelled out:** **Case 1 fails** on the `reads === 0` assertion with a large
   non-zero count — the per-frame HUD calls are 2 reads × up to 5 functions ≈ 8-10 per frame (the mission
   marker's read at `hud.js:279` is behind an early return, so the exact number varies), i.e. roughly
   **60-80 reads over 8 frames**. **Case 2 is not reached** — `assert` throws on Case 1 and the scenario
   aborts there, so the report must not claim an observation that was never made. (Case 2 is the guard
   against a *broken fix* — a frozen cache — not against the pre-fix code, which a live read makes
   trivially fresh. Say that as reasoning, not as an observed result.)
   If Case 1 passes here, the guard is measuring nothing — stop and diagnose before going further (most
   likely the anti-vacuity assertion or the instrumentation, not the game).
4. Restore the fix (`git checkout -- client/src/engine.js` if the revert was the only edit in the file, or
   re-apply §3.1) and re-run the scenario to confirm it is green again.
5. **Paste the failure output verbatim into the final report** (the `✗ 48-hud-viewport-cache` block with the
   assertion message and the observed read count).

---

## 6. Tests, docs, gates

### 6.1 Tests to run — and the ones NOT to run

- `cd client && node visual/run.mjs 48-hud-viewport-cache` — the new guard. **Check `lsof -i :4173` first**:
  a parallel pipeline worktree exists in this repo and the runner's port is hardcoded, so two runs at once
  silently test each other's code. If the port is busy, either wait or run with `VISUAL_PORT=4183`.
- `cd client && node --test` — the existing client unit suite must stay green (it does not load `engine.js`;
  three-importing modules cannot load under `node --test` at all, which is precisely why the guard is a
  visual scenario).
- `cd server && npm test` — **not needed**, nothing server-side changes. Skip it.
- **Do NOT run** the 49-scenario visual suite or the A/B perf bench (DECISIONS §141: opt-in, the
  maintainer's call at the pipeline's visual gate). If something looks like it needs the full suite,
  **report it, do not run it**.

**Replay / intro impact: none, and here is why.** This change touches no sim state. `gameW`/`gameH` feed
(a) `camera.aspect` + `renderer.setSize`, (b) the five DOM overlay updaters, and (c) `eventNdc`
(`main.js:451`) which maps a *mouse* position to NDC for the station/drop raycasts — all render- and
input-side, all returning the same values as before. The deterministic sim (`sim-core/`) never reads them,
and `client/src/replay.js` consumers re-run `sim.update()`, not the DOM block. So no recorded trace can
diverge and **`22-trace-replay` is not required here** — the "sim change → run the intro guard" rule does
not apply to a change that never reaches `update()`. (Run it anyway only if a reviewer disputes that.)

### 6.2 Docs to update (CLAUDE.md workflow)

**CHANGELOG** — one bullet under the existing `## 2026-09-01` heading (newest on top), honest about the
non-effect:

> - **The HUD stopped forcing a synchronous layout every frame.** `gameW()`/`gameH()` read
>   `window.innerWidth`/`innerHeight` on every call, and five per-frame HUD updaters called them interleaved
>   with their own style writes — so each read flushed style + layout mid-frame (measured on a Redmi 15C:
>   **1.82 forced recalcs and 0.99 ms per frame**, about two thirds of the `js.dom` the game reports). The
>   two values are now a **cache** refreshed in `applyOrientation()`, which was already the single choke
>   point for boot/resize/orientationchange; `toGame()` uses it too, so a pointer event no longer forces
>   layout either. **No fps change is expected** — that frame is GPU-bound and the ~1 ms goes into GPU wait;
>   what this buys is less main-thread jitter and a `js.dom` number that measures DOM work instead of
>   self-inflicted layout. Guarded by `client/visual/scenarios/48-hud-viewport-cache.mjs` (zero viewport
>   reads across 8 real frames + the markers land on the *new* edge box after a resize).

**SUMMARY** — edit in place, bump `**Updated:**` (line 6) to `2026-09-01` with a short phrase for this
change. Sections to touch:

- **~line 373-381** (the "Landscape on phones (forced via rotation)" bullet, the live description of
  `applyOrientation`/`gameW`/`gameH`/`toGame`): say that `gameW()/gameH()` return a **cached** logical size
  written by `applyOrientation()` — the one place the viewport is read — and that `toGame()` reads that
  cache too; note the cache is initialized at module-eval so a pre-boot call is still correct.
- **~line 4411** (module map, the `engine.js` entry `renderer/scene/skyScene/camera/lights + orientation +
  zoom`): add that the logical size is a cache refreshed at the choke point.
- **~line 4432** (module map, `hud.js` — "the per-frame draws"): one clause that the per-frame overlays read
  the cached size, so the overlay pass no longer forces layout.
- **~line 434** (the URL-flag table row for `?debug`) or the `window.__game` description at **~line 4486**:
  mention the new `gameW`/`gameH` getters on the hook.
- **~line 4982-4995** (the end of the visual scenario list, after the `47-duel-room` paragraph): add
  `48-hud-viewport-cache` — what it asserts (zero `window.innerWidth/innerHeight` reads across 8 real rAF
  frames with an anti-vacuity check that `updateMarkers` really ran, plus a resize that must move the edge
  markers onto the new viewport's 0.92 edge box) and why it exists (five HUD functions from one template →
  the sixth must fail the suite).
- **Leave line 294 alone** — it is a historical roll-up and is still factually correct.

**DECISIONS** — add **§149** (the file currently ends at §148):

> ## 149. The logical game size is a CACHE refreshed at the choke point, not a live viewport read
>
> `gameW()`/`gameH()` read `window.innerWidth`/`innerHeight` on every call, and five per-frame HUD updaters
> called them interleaved with style writes → a forced synchronous style+layout flush mid-frame (Redmi 15C,
> 2026-09-01: 1.82 forced recalcs and 0.99 ms per frame; `docs/plans/hud-viewport-layout-thrash.md`).
>
> Options: **(a)** keep the live read — never stale, but every caller pays a layout flush; **(b)** cache it
> and refresh in `applyOrientation()` — one read per resize, but a missed refresh puts every HUD marker in
> the wrong place; **(c)** read once per frame at the top of `animate()` — still one forced layout per
> frame, and it adds a new ordering rule for anyone writing HUD code.
>
> Chose **(b)**. `applyOrientation()` is already the only place the renderer is sized and is already bound
> to `resize` + `orientationchange` (`main.js:1974-1975`), so there is no second refresh path to keep in
> sync — the cache cannot go stale without the renderer going stale with it, which is a failure we would
> see instantly. The residual staleness risk is bought back with a guard
> (`client/visual/scenarios/48-hud-viewport-cache.mjs`) that asserts **both** halves: zero live reads in
> steady state, *and* a real resize moving the edge markers onto the new viewport's edge box — because a
> frozen cache passes a zero-read test perfectly.
>
> **Not a perf claim.** The frame is GPU-bound (renderer main thread 36 % busy vs the GPU process's 66 %,
> 117 long tasks against 9), so the ~1 ms goes into GPU wait and fps is expected to be unchanged. The
> reason is code correctness: the main thread stops doing work it invented for itself, and `js.dom`
> measures DOM work again.

### 6.3 Final gate before handing off

1. `cd client && node visual/run.mjs 48-hud-viewport-cache` → green (port checked first).
2. `cd client && node --test` → green.
3. The negative test (§5) done, output pasted in the report, fix restored, scenario green again.
4. **Consistency sweep** — `grep -rn "innerWidth\|innerHeight" client/src client/index.html` and confirm
   the only remaining reads are `engine.js` (module-eval `setSize`/camera aspect, the `G.rotated` test and
   the two cache assignments), `device.js:43,54`, and `main.js:135`. Nothing per-frame.
5. `grep -rn "gameW\|gameH" docs/SUMMARY.md` and re-read each hit: no surviving sentence may still describe
   them as reading the live window.

---

## 7. Out of scope (DECISIONS §30 — do not gold-plate)

- **The incomplete level-start warm** (brief §7: five 58-190 ms main-thread blocks around the veil, shader
  programs climbing 14 → 26 → 32 → 42 with the last leg *after* the veil drops). Bigger win, **separate
  brief**. Do not fold any part of it in.
- **Re-measuring the phone numbers.** No device is attached; the brief's numbers are evidence, not
  estimates. "I could not verify the number" is not a blocker.
- **Any other forced-layout source**: `hud.js:137`'s `void n.offsetWidth` is a deliberate reflow to restart
  a CSS animation, on the log-line path, not per-frame. Leave it.
- **`engine.js:58` / `:77`** — the module-eval `window` reads stay (decision 1).
- **Reporting an fps delta**, running the full visual suite, or running the perf bench.
- Any refactor of the five HUD updaters themselves. Their call sites do not change.
