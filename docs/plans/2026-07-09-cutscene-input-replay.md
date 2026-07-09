# Level-0 cutscene via deterministic INPUT-replay (and a reusable combat-replay mechanism)

> **Handoff doc for a fresh session.** The current build session is context-heavy; this file is the
> bridge. Start a clean session, read this + `docs/SUMMARY.md` + `docs/DECISIONS.md`, and continue **in
> the existing worktree** (below). Nothing from the old chat is needed — everything is here.

---

## 1. TL;DR — the goal

Replace the current "movie of positions" combat replay (transform-replay) with **deterministic
INPUT-replay**: record the player's **input + RNG seed**, and reproduce the fight by **re-running the
real game `sim` on the actual engine**. The payoff — everything is real, for free:

- player bullets **blue**, enemy bullets **red** (real `projectileColor` per shooter),
- **smooth** motion (real physics, not per-frame teleporting of quantized points),
- real muzzle/hit/explosion FX,
- **real collisions** — you literally see your fire shoot down the rocket, because it *is* the game.

**One mechanism, two consumers:**
1. **Level-0 intro cutscene** — camera on the player, scripted freeze-and-explain text pauses (this doc's
   primary deliverable).
2. **Freighter-escort backdrop battle** — the distant looping set-piece near the freighter (currently
   transform-replay; unify onto the same input-replay mechanism as a **follow-up**, see §8).

---

## 2. Why the current approach fails (what we are replacing)

The existing recorder captures **per-frame transforms** (ship/bullet/rocket *positions*) and "dumb-replays"
them by moving meshes to those positions. It was built for a **distant backdrop**, where its flaws don't
show. For a hero close-up they are fatal and **structural, not bugs**:

- **Bullets are an anonymous position stream** — no shooter identity → cannot be colored by owner (all one
  color; enemy bullets came out blue), and no stable per-bullet id → cannot interpolate → **jerky**
  (teleport per 20 fps sample) + quantization jitter.
- **No collisions** — nothing actually "hits"; it's a flythrough of points. "Can't see my bullets down the
  rocket" is inherent.
- **FX are re-derived heuristically** (muzzle = bullet birth, spark = death near a hull), not the real thing.

Patching this further hits a ceiling. The maintainer saw exactly these three: blue enemy bullets, jerk,
no visible hit on the rocket. **Do not keep polishing transform-replay for the foreground.**

---

## 3. What we already HAVE (reuse vs replace)

### 3a. The determinism foundation — REUSE (this is the big head start)
`client/src/bench.js`:
- `mulberry32(seed)` — tiny deterministic PRNG.
- `installSeededRandom(seed)` — **globally overrides `Math.random`** with the seeded PRNG. So the **62
  `Math.random` calls across 9 files** (`sim.js`, `world.js`, `spawn-timing.js`, `projectiles.js`,
  `drops-config.js`, `ship-build.js`, `main.js`, `audio.js`, `bench.js`) are **already** deterministic
  under this override — no per-call reseed needed.

`client/src/main.js` `window.__bench` (the perf-gate harness, `?bench=record/replay`):
- `record()` / `stop(name)` — captures a compact **input trace**: `{ version, name, seed, dt, warmupTicks,
  ticks: [{ k:[keycodes], t:[heading,thrust]|null }, …] }` (one entry per tick).
- `replay(trace, {mode})` — **re-runs the real `sim` deterministically** at fixed `BENCH_DT`, re-seeding
  `Math.random` from `trace.seed`. This is exactly "run the engine from recorded input."

**So input-replay is ~80% built already** — it is the perf-bench replay + rendering + camera + pauses.
The remaining determinism work is to **verify EXACT reproduction** (the perf bench only needs
statistically-stable frame cost; a cutscene needs the *same kills at the same ticks* so pauses line up)
and to **seed anything the audit finds outside the global override** (Date.now in a sim path, Map/Set
iteration order that feeds the sim, etc.). Maintainer decision (§7): **seed everything.**

### 3b. The cutscene "shell" — KEEP (only the combat source changes)
All of this stays; it is orthogonal to how combat is produced:
- `client/src/cutscene.js` — full-screen overlay lifecycle, **camera-follow-the-player** (via `camOffset`,
  sticks sky/stars), the **pause script runner** (freeze + lower-third card + tap-to-advance), teardown.
- `client/src/cutscene-script.js` — `pauseDueAt`, `validateCutsceneTrack`, `snapToDeathFrame` (pure, unit-tested).
- `client/src/cutscene-fx.js` — pure helpers (tested).
- `client/src/level0-cutscene.js` — the **PAUSES script** (P0–P4 + i18n keys); see §5.
- `client/index.html` `#cutscene` overlay + `#cutscene-skip` + card/text; `client/styles.css` cutscene rules.
- `client/locales/source.json` + `ru.json` — `ui.cutscene.*` (EN source-of-truth + RU). See §5 for the text.
- The `?dev` **"Cutscene" authoring panel** (mark-pause, frame readout, force-play) in `cutscene.js`.
- The **bootstrap landing gate** in `main.js` (§6) — new player watches the cutscene, then advances to Level 1.

### 3c. Transform-replay of combat — REPLACE (this is the part that goes away)
- In `cutscene.js` `cutsceneTick`: the ghost-mesh replay of ships (`slots`), the `bulletPool`, the
  `rocketPool` — all the code that positions meshes from recorded coordinates.
- `client/src/level0-cutscene-track.js` — the recorded **positions** ("the movie"). **Not engine-drivable**;
  keep only as a visual/timing *reference* for the fight, discard once input-replay works.
- `client/src/ghost-battle-track.js` (recenter/quantize), `client/bench/process-scene.mjs` (trim/re-center),
  the `window.__cutscene` / `window.__backdrop` **transform recorders** in `main.js`, the `/record-scene`
  skill — all transform-era tooling. Retire or repurpose for input-recording.

### 3d. The existing recording (reference only)
`~/Downloads/lvl0_rec.js` and the installed `client/src/level0-cutscene-track.js` are a **transform movie**
of a good Level-0 playthrough (5 ships: player + 3 basic pirates + 1 rocket pirate; ~35 s; kills at frames
~155/314, rocketeer born 477, rockets at 531 & 611, rocketeer dies 674, at 20 fps). Use it to sanity-check
that input-replay reproduces a similar fight and to derive the pause event ticks. **It cannot drive the
engine** — the new recording captures *input+seed*, not positions.

---

## 4. What to BUILD (scope for the fresh planner/implementer)

1. **Determinism audit + seed-all.** Confirm `installSeededRandom` covers the whole Level-0 combat path;
   make a recorded Level-0 run **replay EXACTLY** (identical kills/rocket-launches at identical ticks).
   Fix any non-RNG nondeterminism (Date.now in sim, iteration order feeding sim). *Seed everything.*
2. **Level-0 input recorder.** A `?dev` flow to play Level 0 and capture `{ seed, dt, ticks }` → a compact
   trace file (the `__bench` trace shape is a fine starting point). **Must capture the exact seed** so the
   staggered spawns + rocket timing reproduce. (Level 0 = `catalog_seed` name `level-1`, see §5.)
3. **Cutscene replay driver.** Run the real `sim` from the trace (like `__bench.replay`) but **with full
   rendering + camera-follow-the-player + the pause script**. Pauses **freeze the re-sim** at scripted ticks
   (decide: `G.paused` vs a replay-loop-local freeze — must NOT pop the combat Pause overlay; the old
   cutscene used a cutscene-local freeze for this reason), show the localized card, tap resumes. Real
   bullets/rockets/FX/collisions throughout.
4. **Reconcile with the shell (§3b).** Keep camera/pauses/overlay/i18n; swap the combat source from
   transform-replay to input-replay. Re-derive P1–P4 pause ticks from the trace's **actual events** (1st/2nd
   kill, rocketeer spawn, rocketeer's 2nd rocket), each offset **+1 s after the event** (maintainer pref);
   P0 is the pre-fight opening card. Retire the §3c transform code.
5. **Docs + tests.** Update SUMMARY (the cutscene now re-sims from an input trace), CHANGELOG, a DECISIONS
   entry for the mechanism switch (supersede/annotate the transform-replay decision, currently §60). Keep
   `client && node --test` and `server && npm test` green (server tests run on **both** SQLite and Postgres —
   keep `db.js`/`db_postgres.js` in parity; the Level-0 seed + `current_progress` migration already landed).

---

## 5. Level-0 details (the fight + the script)

**Mission descriptor** — `server/src/catalog_seed.js`, `name:'level-1'` (id 1), served while
`current_progress === 1`. Deliberately calm/recordable: enemies warp in **one at a time**
(`maxConcurrent: 1`):
- Phase 1: `spawn: { maxConcurrent:1, total:3, pool:[{ship:'Basic pirate ship', chance:100}] }`
- Phase 2 (finale): `spawn: { maxConcurrent:1, total:1, pool:[{ship:'basic rocket pirate', chance:100}] }`
- No boss, no reward, no briefing.

**Ships/colors** (why bullet color matters): `Basic pirate ship` fires a gun; player gun `projectileColor`
`0x6fe6ff` (blue-cyan), enemy gun `0xff6b6b` (red). `basic rocket pirate` fires a rocket
(`projectileColor 0xffcc66`). Input-replay renders these natively — no color guessing.

**Pause SCRIPT** — `client/src/level0-cutscene.js`, keys in `client/locales/source.json` (EN, source of
truth) + `ru.json` (RU). Each pause fires **~1 s after its trigger**; P0 is the opening card *before* the
fight. Current text (keep unless the maintainer re-tunes):

| Key | When | EN (source of truth) |
|---|---|---|
| `ui.cutscene.p0_intro` | Opening card, before the fight (tap to begin) | *"Fresh out of the flight academy, I'm cruising to my first posting in the shiny new ship they hand every graduate. …Wait. An unidentified ship, closing on me, ignoring my hails — and by the look of it, its weapons are hot."* |
| `ui.cutscene.p1_first_kill` | 1 s after the **1st** kill | *"Heh — he's not alone out here. Time to break out the rockets."* |
| `ui.cutscene.p2_second_kill` | 1 s after the **2nd** kill | *"So this is what all those years of training were for. …How many of them are there?"* |
| `ui.cutscene.p3_rocketeer` | 1 s after the **rocket pirate warps in** | *"Damn — he's packing a rocket launcher, and mine just cut out. Fine. This ship can outrun a rocket."* |
| `ui.cutscene.p4_second_rocket` | 1 s after the rocketeer's **2nd rocket** launch | *"Another one?! Well — the cannon had better not let me down!!!"* |
| `level.0.victory` | Last kill → win overlay (no pause) | (existing victory line) |

RU equivalents already exist in `ru.json` (verbatim to the maintainer's script). `ui.cutscene.skip` /
`ui.cutscene.tap` are the Skip button + tap affordance.

**End of cutscene:** last kill fires the `level.0.victory` overlay; then the cutscene ends → advance to Level 1.

---

## 6. Landing flow (bootstrap) — already built, keep

`client/src/main.js` bootstrap, three cases for a player whose current level is the intro (`level-1`,
`current_progress === 1`):
1. **Real new player** (not headless, not already-seen) **AND a real intro track exists** →
   **WATCH the cutscene**, then `unlockNextLevel()` advances `current_progress` 1→2 → land on **Level 1**
   (welcome). Gated by `introCutsceneReady()` (in `cutscene.js`: non-placeholder + valid).
2. **Headless** (`?debug`/`?bench`), **already-seen**, **or no real track yet** → auto-launch the
   **playable Level 0** (the arena the visual/perf scenarios expect; also the `?dev` record path). This is
   also the safety net so a missing/placeholder track never **advances a new player past Level 0**.
3. Everything else → existing landing (Level 1 → welcome; level 2+ → Main-Window briefing).

For the input-replay version, "a real intro track exists" becomes "a valid **input trace** exists." No
welcome screen / no Take-off button for the new player — first launch drops straight into the intro.

**Level-0 shift migration** (already landed, don't redo): the intro took seed name `level-1` (id 1); the
old campaign L1–L4 shifted to `level-2..level-5`; `server/src/migrations/022_intro_level0_shift.js` bumps
existing players `current_progress += 1`; the Postgres side has the guarded equivalent in `db_postgres.js`.

---

## 7. Decisions already made (do not re-litigate)

- **Deterministic input-replay**, not transform-replay, for foreground combat. *(maintainer)*
- **Seed everything** if the audit finds nondeterminism beyond the global `Math.random` override. *(maintainer)*
- **Stay in the current worktree / branch**, reuse the cutscene shell (§3b); swap only the combat source. *(maintainer)*
- **One mechanism for both** Level-0 cutscene and the freighter backdrop (backdrop = follow-up, §8). *(maintainer)*
- Pause timing **+1 s after each event**; **P0** = pre-fight opening card; **no welcome** for the new player.

---

## 8. Freighter backdrop (follow-up, same mechanism)

The distant escort-mission set-piece (looping ghost battle at a fixed absolute world point, no camera
follow, no pauses) currently uses the **same transform-replay** being retired here. Once input-replay is
proven for the cutscene, migrate the backdrop to it too (a looping deterministic re-sim rendered at the
fixed point). Already on the roadmap ("re-record the freighter backdrop battle with rockets"). Decide with
the maintainer whether it's the **same PR** or a **separate** one — leaning separate to keep the cutscene
PR focused.

---

## 9. Worktree & how to run (for the fresh session)

- **Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-07-08-2007-level-0-intro-cutscene`
  **Branch:** `feature/2026-07-08-2007-level-0-intro-cutscene` (HEAD `8717828`, main already merged in).
- **Uncommitted state:** the transform-replay cutscene + recent patches are **uncommitted** on the branch
  (`git status`: `cutscene.js`, `main.js`, `level0-cutscene*.js`, `projectiles.js`, `ghost-battle-track.js`,
  `process-scene.mjs`, locales, SUMMARY, tests). Keep the **shell** (§3b); the transform-combat (§3c) will
  be removed/replaced. First decide: commit the shell as a checkpoint, or refactor in place.
- **Run local** (`run-local` skill): from the worktree — `npm run assets:pull` (gitignored `.glb`/`.mp3`),
  then `cd server && PORT=4000 node --disable-warning=ExperimentalWarning src/server.js`. Client is served
  statically → hard-reload (Cmd+Shift+R) picks up JS. Local SQLite DB (`server/data/game.db`).
- **Reach Level 0:** fresh account starts at `current_progress 1` = the intro. To reset a stuck local
  account: `sqlite3 server/data/game.db "UPDATE players SET current_progress = 1;"`. `?dev` enables the
  authoring panel; `?debug`/`?bench` bypass the cutscene into the playable Level 0.
- **Tests:** `cd client && node --test` (171 green now); `cd server && npm test` (SQLite; keep Postgres parity).

---

## 10. Open questions for the fresh planner

- Trace format + **where the Level-0 input recorder lives** — extend `window.__bench` vs a dedicated
  `__cutscene` recorder; how the seed is captured for the staggered Level-0 spawn.
- **How pauses freeze the re-sim** without popping the combat Pause overlay (cutscene-local freeze vs `G.paused`).
- **Exactness** — is `installSeededRandom` + fixed `dt` + recorded input enough for tick-identical kills, or
  is more seeding/ordering work needed? (Audit output drives this.)
- Fate of the **transform-replay code** — delete now, or keep until the backdrop is migrated (§8).
- Whether to **commit the shell** first as a checkpoint before the refactor.
