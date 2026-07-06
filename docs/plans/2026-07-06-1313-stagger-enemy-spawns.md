# Stagger enemy spawns (randomized 2–4 s cooldown)

**Feature ID:** 2026-07-06-1313-stagger-enemy-spawns
**Area:** client level runner (spawn pacing). Client-only — no server / DB / catalog change.

## Goal

Today the level runner re-fills the arena to `maxConcurrent` **every frame**: the opening wave of a phase
snaps to full instantly, and a killed enemy is replaced on the very next frame. This plan gates **every**
enemy spawn behind a randomized **2–4 second** cooldown so enemies trickle in one at a time. The first
enemy of each phase still appears **immediately** (no empty arena at a phase's start); after every spawn a
fresh 2–4 s delay is armed, so a phase populates 1 → 2 → 3… and post-kill replacements also wait 2–4 s.
User-visible effect: fights build up and refill gradually instead of the arena being instantly packed.
Applies to all phases and all levels (campaign + side missions), including the lone boss/finale spawn.

## Decisions (already settled — do not re-open)

1. **First spawn of each phase is IMMEDIATE** (`t=0`); the 2–4 s cooldown is armed **after** each spawn.
   No phase ever shows an empty arena at its start.
2. **Cooldown resets to 0 on `enterPhase()`**, so each new phase's first enemy is immediate, then staggers.
3. **Uniform — no special-casing** the boss / finale phase. Because the first spawn is immediate, the boss
   (which spawns alone after its clear-out phase empties the arena) still appears the instant its phase
   begins. The `win` phase (`event:'win'`, no `spawn` block) and the `winPending` / `returningToBase`
   paths are **untouched**.
4. **Inline delay `2 + Math.random()*2`** via a tiny pure helper (`nextSpawnDelay`). One lightweight unit
   test stubs the random source. **No seeded-RNG system** (DECISIONS §30).
5. **Post-kill replacements are also staggered.** The cooldown only counts down while a slot is actually
   open (`alive < maxConcurrent` and budget remains). While the arena is full the timer is **frozen**, so
   the moment a kill frees a slot the remaining 2–4 s must still elapse — a kill never triggers an instant
   refill. (This is the subtle-but-required behavior; the unit test pins it down — see Tests case 4.)

## Steps

### 1. New pure helper module `client/src/spawn-timing.js` (create)

A leaf module with no heavy imports so it is unit-testable under `node --test` (the real `sim.js` imports
`engine.js`, which builds a `WebGLRenderer` at import and therefore can't load headless — mirrors why
`server/src/enemy_total.js` exists as a separate testable oracle). Contents:

```js
// Enemy spawn stagger: gate every spawn behind a randomized 2–4 s cooldown so phases fill (and refill
// after a kill) one enemy at a time instead of snapping to maxConcurrent. Pure + dependency-free so it
// is unit-testable without the WebGL engine graph; the level runner (sim.js) drives it per fixed step.

export const SPAWN_DELAY_MIN = 2;   // seconds — floor of the post-spawn cooldown
export const SPAWN_DELAY_SPAN = 2;  // seconds — added window (so the delay is 2..4 s)

// Randomized 2..4 s delay to arm after a spawn. `rand` is injectable for deterministic tests.
export function nextSpawnDelay(rand = Math.random) {
  return SPAWN_DELAY_MIN + rand() * SPAWN_DELAY_SPAN;
}

// Advance the stagger gate one fixed step. Returns { spawn, cooldown }:
//   spawn    — may ONE enemy spawn this frame?
//   cooldown — the new cooldown to store back on the runner.
// The cooldown only drains while a slot is open (alive < maxConcurrent AND budget remains); a FULL arena
// freezes the timer, so when a kill frees a slot the remaining 2–4 s still has to elapse (post-kill
// replacements are staggered too, never instant). One spawn per call at most (staggered one at a time).
export function stepSpawnGate({ cooldown, dt, alive, maxConcurrent, capRemaining }, rand = Math.random) {
  const wantSpawn = alive < maxConcurrent && (capRemaining == null || capRemaining > 0);
  if (!wantSpawn) return { spawn: false, cooldown };  // arena full / budget spent → freeze the timer
  const cd = cooldown - dt;
  if (cd <= 0) return { spawn: true, cooldown: nextSpawnDelay(rand) };  // fire + arm the next 2..4 s
  return { spawn: false, cooldown: cd };               // still counting down toward the next spawn
}
```

### 2. Wire it into the level runner — `client/src/sim.js`

**a. Import** (add to the existing import block; the runner already imports `spawnEnemyShip` from
`ship-build.js` on `client/src/sim.js:15`). Add a new import line just after line 15:

```js
import { stepSpawnGate, nextSpawnDelay } from './spawn-timing.js';
```

(`nextSpawnDelay` isn't strictly needed by the caller since `stepSpawnGate` arms the cooldown itself —
import only `stepSpawnGate` unless you find a direct use. Keep the import minimal.)

**b. Add the `spawnCooldown` field** to the `levelRunner` object literal. Current declaration
(`client/src/sim.js:62-63`):

```js
  level: null, phaseIndex: 0, killsAtPhaseStart: 0, spawnedThisPhase: 0, won: false,
  winPending: 0, winText: '', returningToBase: false,
```

Add `spawnCooldown: 0` to the field list, e.g. change the first line to:

```js
  level: null, phaseIndex: 0, killsAtPhaseStart: 0, spawnedThisPhase: 0, spawnCooldown: 0, won: false,
```

**c. Reset the cooldown on phase entry.** In `enterPhase()` (`client/src/sim.js:81-82`), the body opens:

```js
  enterPhase() {
    this.killsAtPhaseStart = G.kills; this.spawnedThisPhase = 0;
```

Change to also zero the cooldown so the new phase's first enemy is immediate (Decision 1 & 2):

```js
  enterPhase() {
    this.killsAtPhaseStart = G.kills; this.spawnedThisPhase = 0; this.spawnCooldown = 0;
```

(`start()` calls `enterPhase()`, so a Restart is covered; no extra reset needed elsewhere.)

**d. Replace the every-frame top-up loop with the staggered gate.** Current block
(`client/src/sim.js:157-166`):

```js
    // spawn up to maxConcurrent (respecting an optional total cap for this phase)
    if (ph.spawn) {
      const cap = ph.spawn.total;
      while (enemies.length < ph.spawn.maxConcurrent && (cap == null || this.spawnedThisPhase < cap)) {
        const def = CATALOG.shipByName.get(this.pickShip(ph.spawn.pool));
        if (!def) break;
        spawnEnemyShip(def);
        this.spawnedThisPhase++;
      }
    }
```

Replace with a single gated spawn per frame:

```js
    // Staggered spawn: one enemy at a time on a randomized 2–4 s cooldown (see spawn-timing.js). The
    // first enemy of a phase is immediate (cooldown reset to 0 in enterPhase); every spawn re-arms 2–4 s.
    // A full arena freezes the timer, so a kill's replacement still waits 2–4 s (never instant).
    if (ph.spawn) {
      const cap = ph.spawn.total;
      const capRemaining = cap == null ? null : cap - this.spawnedThisPhase;
      const gate = stepSpawnGate({
        cooldown: this.spawnCooldown, dt,
        alive: enemies.length, maxConcurrent: ph.spawn.maxConcurrent, capRemaining,
      });
      this.spawnCooldown = gate.cooldown;
      if (gate.spawn) {
        const def = CATALOG.shipByName.get(this.pickShip(ph.spawn.pool));
        if (def) { spawnEnemyShip(def); this.spawnedThisPhase++; }
      }
    }
```

Notes:
- `shouldAdvance` (`client/src/sim.js:173-183`) is unchanged. Its `allCleared` branch already requires the
  phase's `total` to be fully spawned before advancing, and totals are unaffected by pacing (see below), so
  clear-out phases still work — they just take a little longer to fully spawn.
- The `winPending` / `returningToBase` early-returns (`client/src/sim.js:150-156`) run before this block, so
  the finale/return-to-base flow is untouched (Decision 3).

### 3. No server / catalog change

`descriptor.enemyTotal` is a **count** of enemies destroyed to clear a level, computed by
`enemyTotalFromPhases` (`server/src/enemy_total.js`) and stamped in `catalog_seed.js` / `missions.js`.
Staggering changes *pacing*, not the total number that eventually spawn, so `enemyTotal` is unchanged.
`server/src/enemy_total.test.js` (its inline oracle tops the arena up instantly to count totals) still
holds — **do not touch it, `db.js`, `db_postgres.js`, or any seed.** (No SQLite/Postgres parity concern:
this is a client-only change.)

## Tests

### New: `client/src/spawn-timing.test.js` (create)

Run with `cd client && node --test` (matches the existing `client/src/*.test.js` files). Import the pure
helper and assert the full stagger contract by stubbing the random source:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSpawnDelay, stepSpawnGate, SPAWN_DELAY_MIN } from './spawn-timing.js';

test('nextSpawnDelay maps the RNG onto 2..4 s', () => {
  assert.equal(nextSpawnDelay(() => 0), 2);
  assert.equal(nextSpawnDelay(() => 0.5), 3);
  assert.equal(nextSpawnDelay(() => 1), 4);
});

test('first spawn of a phase is immediate (cooldown 0 → spawn now, then arms 2..4 s)', () => {
  const g = stepSpawnGate({ cooldown: 0, dt: 1 / 60, alive: 0, maxConcurrent: 3, capRemaining: null }, () => 0);
  assert.equal(g.spawn, true);
  assert.equal(g.cooldown, SPAWN_DELAY_MIN); // armed to 2 s with rand()==0
});

test('one spawn, then NO spawn until the armed delay elapses', () => {
  // just spawned; cooldown armed to 2 s, arena not full
  let cd = 2, spawns = 0;
  for (let i = 0; i < 100; i++) {           // ~1.6 s of frames — under the 2 s delay
    const g = stepSpawnGate({ cooldown: cd, dt: 1 / 60, alive: 1, maxConcurrent: 3, capRemaining: null });
    cd = g.cooldown; if (g.spawn) spawns++;
  }
  assert.equal(spawns, 0, 'no spawn before the 2 s delay elapses');
  // push past 2 s of accumulated dt → exactly one spawn fires and re-arms
  let fired = 0;
  for (let i = 0; i < 40; i++) {
    const g = stepSpawnGate({ cooldown: cd, dt: 1 / 60, alive: 1, maxConcurrent: 3, capRemaining: null }, () => 0.5);
    cd = g.cooldown; if (g.spawn) { fired++; }
  }
  assert.equal(fired >= 1, true, 'a spawn fires once the delay elapses');
});

test('a FULL arena freezes the timer so post-kill refill still waits (not instant)', () => {
  // cooldown mid-count while arena is full → unchanged, no spawn
  const full = stepSpawnGate({ cooldown: 2.5, dt: 1, alive: 3, maxConcurrent: 3, capRemaining: null });
  assert.equal(full.spawn, false);
  assert.equal(full.cooldown, 2.5, 'timer is frozen while the arena is full');
  // a kill frees a slot but the remaining 2.5 s must still elapse before the replacement
  const afterKill = stepSpawnGate({ cooldown: 2.5, dt: 1, alive: 2, maxConcurrent: 3, capRemaining: null });
  assert.equal(afterKill.spawn, false, 'replacement is NOT instant after a kill');
  assert.equal(afterKill.cooldown, 1.5);
});

test('total-cap budget exhausted → no spawn even at cooldown 0', () => {
  const g = stepSpawnGate({ cooldown: 0, dt: 1, alive: 0, maxConcurrent: 3, capRemaining: 0 });
  assert.equal(g.spawn, false);
});
```

### Visual scenarios — required edits & confirmations

Run with `cd client && node visual/run.mjs` (the suite has a known-flaky baseline of ~6 scenarios; judge by
the reliably-passing set + zero page errors).

- **`client/visual/scenarios/01-smoke.mjs` — MUST BE UPDATED (it asserts the OLD instant-fill behavior).**
  Line 12 currently asserts `assert.equal(info.enemies, info.cap, "the arena fills to the first wave's
  maxConcurrent")`. With staggered spawns the arena holds **exactly 1** enemy after the 200 ms warm-up
  (first-spawn-immediate, next one 2–4 s later), not `cap` (3). Change the assertion and its comment to the
  new reality:

  ```js
  assert.equal(info.enemies, 1, 'the arena seeds one enemy immediately, then staggers the rest in');
  ```

  Keep the `cap` read only if you still want it for context; otherwise it can stay unused/removed. Update
  the file's top comment ("seeds the arena with enemies") is still accurate — no change needed there.

- **`client/visual/scenarios/04-combat.mjs` — UPDATE the assertion (it also encodes instant-refill).**
  Line 19 asserts `assert.ok(data.enemies > 0, 'the level keeps the arena populated during combat')` after
  2500 ms of sweeping fire. Under the new design the arena is intentionally **not** guaranteed populated at
  every instant — if the player kills the lone opening fighter, its replacement waits 2–4 s. Replace with an
  assertion that reflects the new intent (combat is live: enemies present **or** kills being scored):

  ```js
  assert.ok(data.enemies > 0 || data.earned > 0, 'combat is live: enemies present or being destroyed');
  ```

  Also update the comment on lines 1–3 (drop "enemy count maintained"). First-spawn-immediate guarantees ≥1
  enemy at `t=0`, so this remains a meaningful smoke check.

- **Confirmed OK, no edits (they assert only `enemies > 0`, which first-spawn-immediate satisfies):**
  `06-pause.mjs:24` (checks after 400 ms; sim is frozen while paused so no spawn skew), `10-mission-board.mjs:62`
  (side mission still seeds its first enemy immediately), `13-ship-bank.mjs:68`, `03-exhaust-trail.mjs`
  (clears the ring and spawns its own enemies via `g.spawnEnemy` — pacing-independent), `11-l4-enemies.mjs`
  and `16-enemy-health-bar.mjs` (both clear the wave and spawn their own).

## Docs to update

- **`docs/SUMMARY.md` — "Level flow" section.** After the "Spawn composition … is per-phase in the level"
  sentence (around `docs/SUMMARY.md:781-784`), add: *"Enemies spawn **one at a time on a randomized 2–4 s
  cooldown** (`stepSpawnGate`/`nextSpawnDelay` in `client/src/spawn-timing.js`, driven by `levelRunner`):
  the **first** enemy of each phase appears immediately, then each spawn arms a fresh 2–4 s delay, so phases
  fill 1→2→3… toward `maxConcurrent` rather than snapping to it — and a killed enemy's replacement also
  waits 2–4 s (never an instant refill)."* Also update the per-level bullets that say "3 at a time" /
  "5 at a time" only if you want strict accuracy — those numbers are still the **cap** (`maxConcurrent`), so
  leaving them is fine; the new sentence clarifies the pacing.
- **`docs/SUMMARY.md` — client file map** (`docs/SUMMARY.md:1444`, the `sim.js` entry). Add a sibling mention
  of the new leaf, e.g. append to the leaf list: *"`spawn-timing.js` (the pure enemy-spawn stagger gate
  `stepSpawnGate`/`nextSpawnDelay`, unit-tested; driven by `levelRunner`)"*. Bump the SUMMARY `**Updated:**`
  date to 2026-07-06.
- **`docs/CHANGELOG.md`** — add a bullet under a `## 2026-07-06` heading (create it at the top if missing):
  *"**[2026-07-06-1313-stagger-enemy-spawns] Staggered enemy spawns.** The level runner no longer tops the
  arena up to `maxConcurrent` every frame — every enemy spawn is gated by a randomized **2–4 s** cooldown
  (`client/src/spawn-timing.js`). The first enemy of each phase still appears immediately; each subsequent
  spawn (and each post-kill replacement) waits 2–4 s, so phases populate gradually. All phases/levels;
  totals (`enemyTotal`) and the win/return-to-base flow are unchanged. Updated `01-smoke`/`04-combat` visual
  scenarios (they encoded the old instant-fill)."*
- **`docs/DECISIONS.md`** — add **§53** (next free number; §52 is the last): *"## 53. Enemy spawns are
  staggered (2–4 s cooldown), first-of-phase immediate."* Record the trade-off: an instant-refill arena
  felt cramped/spawn-camped; a fixed cooldown paces the fight so it builds up and refills gradually.
  First-spawn-immediate avoids an empty arena at phase start (and keeps the boss appearing on its phase
  entry with no special-case). The cooldown **freezes while the arena is full** so a kill can't trigger an
  instant replacement — this is deliberate, so a future reader doesn't "fix" it back to per-frame top-up.
  Totals are pacing-independent, so no server/`enemyTotal` change. Simplest form (inline `2 + rand()*2`, one
  pure helper), per §30.

## Out of scope / non-goals (do not gold-plate)

- **No per-phase / per-level tuning** of the 2–4 s window — one global range for all phases and levels.
- **No seeded/deterministic-RNG system** — `Math.random()` inline via `nextSpawnDelay`; only the unit test
  injects a stub.
- **No change to `maxConcurrent`, spawn pools, `chance` weights, `total` caps, or `enemyTotal`** — only the
  *timing* of when the existing spawns occur.
- **No new HUD/banner/telemetry** around spawns.
- **No server / DB / catalog / seed / `db_postgres.js` edits.**
- Do **not** touch the `winPending` / `returningToBase` / boss-explosion / return-to-base logic.
