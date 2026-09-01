# The level-load warm is incomplete — shader programs still compile after the veil drops

**Status:** ready to investigate and build. Measured on a real phone 2026-09-01. The trace numbers below
cannot be reproduced without a USB-attached phone, so treat them as given.

**This is the largest single source of felt stutter in the game right now**, and unlike the HUD viewport
fix (`hud-viewport-layout-thrash.md`) it is expected to produce a *visible* improvement.

---

## 1. The defect

At level start the game raises a full-screen veil ("Preparing the sector...") and, one frame later,
compiles shaders and uploads textures behind it — `prewarmShaders()` at `client/src/main.js:790`, veil
logic at `main.js:1148-1166`. This exists because three.js compiles a material's shader program **lazily,
on first draw**, and on a weak phone that lands as a multi-hundred-millisecond block mid-fight
(DECISIONS §83; the comment at `main.js:1140` records ~3.2 s in a single render call).

The warm does not finish the job. `prewarmShaders` compiles a fixed `warmRig` (explosion, bullet,
flipbook, ring materials) plus `renderer.compile(skyScene)` and `renderer.compile(scene)` — and
`renderer.compile` only compiles **what is in the scene at that moment**. Anything entering the scene
afterwards compiles live, in front of the player.

## 2. Evidence (measured — do not re-derive)

**Passport.** Redmi 15C (`25078RA3EE`), Android 15, Chrome 137, Mali-G52 MC2, buffer 1600×720 at dpr 2,
landscape. Graphics tier **`high`** — the saved value; the game has **no hardware auto-detection**.

**Telemetry across one level start** (`/api/perf`, session `54d9b4ba`, 2026-09-01 14:48:53 UTC):

| programs | geometries | textures | `js.render` | state |
|---|---|---|---|---|
| 14 | 17 | 8 | **1073 ms** | the warm frame, veil up — by design |
| 26 | — | — | 14.6 ms | |
| 32 | 29 | 25 | **204 ms** | **veil already down, player in control** |
| 42 | 30 | 29 | **66 ms** | **veil already down** |
| 42–43 | 30 | 29 | ~5–15 ms | settled |

The **32 → 42 leg happens during live play.** That is the defect in one line.

**Trace (83 s, aligned to the veil).** Nine main-thread blocks over 50 ms in the whole capture; **five of
them inside the two seconds around the veil**: 190 ms @ −231 ms, 71 ms @ −40 ms, 58 ms @ +98 ms,
162 ms @ +528 ms, 66 ms @ +698 ms. From +1.5 s to +20 s: **zero**. The problem is sharply localised,
which also makes it verifiable.

**Sampled JS, window +1.5 s…+6 s** (the busiest window of the trace, idle only 48%): `(program)` — native
non-JS time, i.e. driver calls, compilation, uploads — **22.4% self, 1010 ms**, roughly double its share
in every other window. Alongside it: `upload` 186 ms inclusive, `GLTFLoader` 141 ms, `texSubImage2D`
116 ms self. GPU process over the same trace: `SharedImageStub::OnCreateSharedImage` 9718 ms across 409
calls, averaging **23.76 ms each**.

**Corroboration from four earlier sessions.** In steady-state samples, a second in which a new program,
geometry or texture is created carries **25× the long-task rate** on Mali-G52 (0.50/s vs 0.02/s) and 4×
on the older PowerVR device. Resource creation *is* the stall signature.

## 3. The constraint that makes this its own plan — read before touching the gate

**The simulation ticks under the veil.** `update(dt)` runs at `main.js:1109`; the veil gate is the
`return` at `main.js:1161`, well below it, and it skips only rendering. So every frame the veil is up is
still a simulated frame.

Consequences, all of which bind this work:

1. **Holding the veil longer changes the number of sim ticks before the player gets control**, i.e. it
   changes game state, not just presentation.
2. Session recordings and input replays are keyed to tick counts (all live play runs the deterministic
   `TICK_HZ=60` loop). A change in tick count can invalidate stored traces.
3. Therefore **any change to the gate must be justified against the replay guard**, and
   `node visual/run.mjs 22-intro-replay` (asserts 4 kills, checkpoints p0..p4, and a win) **must** be run
   and must pass unchanged.
4. Warming *more* while the veil is up is comparatively safe if it does not extend how many frames the
   veil covers. Warming *longer* is the dangerous shape. Prefer designs that do more work per veil frame
   over designs that add veil frames.

Note `WARM_MAX_WAIT_MS = 9000` (`main.js:790`) — the hard cap on waiting for in-flight assets, so a
wedged download can never lock a player out. Do not remove it.

## 4. What is NOT yet known — investigate before designing

**Which programs make up the 32 → 42 leg is unknown.** I did not identify them, and the fix depends
entirely on the answer. Do this first, and do it by measurement:

`window.__game` (gated on `?debug`, not `?dev`) exposes `renderer`. `renderer.info.programs` is an array
whose entries carry `cacheKey` and `usedTimes`. So a headless scenario can snapshot the set of
`cacheKey`s at the moment the veil drops, play on for several seconds, snapshot again, and **diff**. That
names the late programs exactly, with no phone involved.

Only once they are named should the fix be chosen. Plausible shapes, none of them pre-approved:
enemy/FX material variants that only enter the scene on first spawn; drop and pickup materials; things
whose last material gets disposed during a lull and recompiles (DECISIONS §83 is precisely about not
letting the last material of a program config be disposed — check whether that rule is being violated
again). `preloadShipModel` (`ship-build.js:128`) already covers ship models, and `warmModel`
(`ship-factory.js`) already does `renderer.compile` + `initTexture` per template — so ship hulls are
probably *not* the gap. Confirm rather than assume.

## 5. Success criteria — phone-free and measurable

The primary criterion is deterministic and needs no device:

- **After the veil drops, `renderer.info.programs.length` must stop growing.** A visual scenario can
  assert that program count is stable across N seconds of play following the veil, with a small explicit
  allowance if some late compile turns out to be genuinely unavoidable — in which case the allowance must
  be justified in the plan, not silently widened.
- Geometry and texture counts should likewise settle.

Secondary, and only confirmable on the phone (the maintainer can run it): main-thread blocks over 50 ms
in the two seconds around the veil should fall from five toward zero, without the veil itself getting
noticeably longer.

Do **not** report fps as the success metric. The frame is GPU-bound in steady state (renderer main thread
36% busy vs GPU process 66% over the same trace); this work targets **stutter at the level start**, which
is a different thing from average frame rate.

## 6. Out of scope

- **The HUD viewport read (`gameW`/`gameH`)** — separate brief, `hud-viewport-layout-thrash.md`.
- **The fairness bug that the sim runs while the player watches the veil** (enemies shoot at someone who
  is looking at "Preparing the sector..."). It is real, it is in ROADMAP, and it lives in the same few
  lines — but it is a *design* change with its own replay implications, not a performance fix. Do not
  fold it in. §3 above is only about not *breaking* tick counts.

## 7. Docs to update (CLAUDE.md workflow)

- **CHANGELOG.md** — bullet under today's date; lead with the user-visible effect (less stutter at level
  start).
- **SUMMARY.md** — update the level-load/warm description and the numbers; bump `**Updated:**`.
- **DECISIONS.md** — likely warranted here, and it should *amend or extend §83* rather than open a
  parallel entry, since §83 already owns "warm a level after it is built".

## 8. Agent gates

Per `docs/plans/multi-agent-pipeline.md` and DECISIONS §141: the 49-scenario visual suite and the A/B perf
bench are **opt-in** — ask the maintainer before running either; a stuck agent reports instead of
grinding. Two worktrees running `visual/run.mjs` concurrently silently test each other's code (hardcoded
port 4173) — check `lsof -i :4173` first. The visual suite fails ~6 scenarios at baseline; judge by the
reliably-passing set and zero page errors, not by a green run.
