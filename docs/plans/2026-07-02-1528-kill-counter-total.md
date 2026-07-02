# Kill counter as killed/total (e.g. 8/16)

## Goal

The on-screen HUD **Destroyed** counter (top-right) currently shows just the number of enemies
destroyed this run (e.g. `8`). Change it to show **killed / total** (e.g. `8/16`), where *total* is
the number of enemies that will appear in the whole level/mission — so the player can see how far they
are through the fight. *Total* is **precomputed on the server from the descriptor's phase script** and
embedded on the descriptor (`descriptor.enemyTotal`), so the client just reads it. The separate
**Enemies** (alive) counter is unchanged. *Total* is defined as **the exact number of enemies the
player destroys to complete the level** (every enemy that appears is eventually killed — the level ends
on an empty field), so the counter reaches exactly `total` at victory and **never exceeds it**. Verified
totals: level-1 = **16**, level-2 = **17**, level-3 = **21**, level-4 = **22**, every side mission =
**20**.

## Decisions (chosen, do not re-ask)

- **Compute location: SERVER, embedded in the descriptor.** A small shared pure function
  `enemyTotalFromPhases(phases)` is applied where descriptors are built —
  `server/src/catalog_seed.js` (campaign `LEVELS`) and `server/src/missions.js`
  (`generateMissions`) — stamping `descriptor.enemyTotal`. The client reads
  `descriptor.enemyTotal`; it does **not** re-derive from phases. (Maintainer's explicit choice over
  a client-side helper.)
- **Derivation rule** (verified against all five descriptors by tracing the sim's spawn-then-advance
  order — see below). The subtlety a naive "sum the thresholds" gets wrong: `levelRunner.update`
  (`client/src/sim.js` ~89–102) **tops the arena up to `spawn.maxConcurrent` BEFORE** the
  `shouldAdvance` check, so when a `kills`/`killsSincePhase` phase advances there are exactly
  `maxConcurrent` enemies still **alive**. Those leftovers carry into the following field-clearing
  (`allCleared`) phase, which requires killing them — so they count toward the final total. Iterate
  phases, tracking a `carry` (leftovers alive when the last threshold phase advanced):
  - `advanceWhen.kills: N` ⇒ `total = max(total, N)` (cumulative absolute threshold); set
    `carry = spawn.maxConcurrent`.
  - `advanceWhen.killsSincePhase: N` ⇒ `total += N`; set `carry = spawn.maxConcurrent`.
  - `advanceWhen.allCleared` ⇒ if the phase has `spawn.total: T` add `T` (boss/finale new spawns);
    then add `carry` (this phase clears the field, so the carried leftovers die here) and reset
    `carry = 0`.
  - any other phase — a clear-out with `spawn: null` (adds only its inherited `carry`) or the
    `event:'win'` phase — contributes nothing of its own.

  Worked traces (final kill count to clear = counter value at victory):
  - **level-1:** `kills:6`→max 6 (carry 3) · `kills:12`→max 12 (carry 3) · finale `allCleared` total 1
    → `12 + 1 + carry 3` = **16**
  - **level-2:** `kills:5` (carry 4) · `kills:12` (carry 4) · clear-out `allCleared` (+carry 4 → 16) ·
    boss `allCleared` total 1 → **17**
  - **level-3:** `kills:8` (carry 4) · `kills:16` (carry 4) · clear-out (+4 → 20) · boss total 1 → **21**
  - **level-4:** `kills:8` (carry 5) · `kills:16` (carry 5) · clear-out (+5 → 21) · boss total 1 → **22**
  - **side missions:** `kills:7` (carry 4) · `kills:14` (carry 4) · clear-out (+4 → 18) · bosses
    `allCleared` total 2 → **20**
- **Display scope: HUD only.** Change `el.kills.textContent` in `client/src/hud.js`. Leave the
  **Enemies** (alive) counter and **all** game-over / victory overlay copy unchanged.
- **Fallback:** if the total is missing (undefined) or non-positive, show the **bare kill count** with
  no slash. This keeps the display graceful for a not-yet-reseeded local DB (see the reseed note) and
  for any future descriptor whose total can't be derived.
- **No DB / backend-parity code changes.** Descriptors ride through the storage layer as opaque
  JSON — the seeders `JSON.stringify(l.descriptor)` and the readers `JSON.parse(...)` (SQLite) /
  return the JSONB object (Postgres). Adding a property to the descriptor object needs **no** change
  to `db.js` or `db_postgres.js` query logic. Side-mission descriptors never touch the DB at all
  (`generateMissions()` is returned live by `GET /api/missions`).

## How descriptors reach the client (verified serving path)

- **Campaign levels:** `LEVELS` in `catalog_seed.js` → seeded via upsert on server startup
  (`db.js:49–51` stringifies `l.descriptor`; `db_postgres.js:224–226` same) into `levels.descriptor`
  → read back parsed by `getProgress` / `getLevelByName` (`db.js:134/345`, `db_postgres.js:305/509`)
  → served by `GET /api/levels/:name` and the progress JOIN → client sets
  `CATALOG.level = level.descriptor` (`client/src/main.js:486`, `client/src/net.js:104`,
  `client/src/account.js:279`).
- **Side missions:** `generateMissions()` (`server/src/missions.js`) is called **directly** by
  `GET /api/missions` (`server/src/server.js:183`) — never stored. Client sets
  `G.activeMission = m.descriptor` (`client/src/mainwindow.js:169`).
- **At run start:** `reset()` calls `levelRunner.start(G.activeMission || CATALOG.level)`
  (`client/src/sim.js:560`), so `levelRunner.level` is the active descriptor and
  `levelRunner.level.enemyTotal` is available.

> **Reseed caveat (campaign only):** the catalog upserts on **server startup**, so after this change
> the local dev server must be **restarted** for `levels.descriptor` to carry `enemyTotal`; production
> reseeds automatically on deploy. Until a level row is reseeded, `descriptor.enemyTotal` is
> `undefined` and the fallback shows the bare count — no error. **Side missions need no restart beyond
> the server picking up the new code** (generated live per request).

## Steps

### 1. New shared pure function — `server/src/enemy_total.js` (new file)

Create the file:

```js
// Total enemies destroyed to complete a level/mission — precomputed on the server and stamped onto each
// descriptor (`descriptor.enemyTotal`) so the client HUD can show killed/total. This mirrors the exact
// spawn-then-advance behavior of the levelRunner (client/src/sim.js update/shouldAdvance): the arena is
// topped up to `spawn.maxConcurrent` BEFORE the advance check, so a kills/killsSincePhase phase leaves
// `maxConcurrent` enemies ALIVE when it advances. Those leftovers ("carry") are killed by a later
// `allCleared` field-clearing phase, so they count toward the total — a naive sum-of-thresholds
// undercounts and the HUD would show killed > total (e.g. 16/13). Rules:
//   advanceWhen.kills:N           -> total = max(total, N);  carry = maxConcurrent (leftovers alive)
//   advanceWhen.killsSincePhase:N -> total += N;             carry = maxConcurrent
//   advanceWhen.allCleared        -> add spawn.total (boss/finale new spawns) THEN add carry, reset carry
// Clear-out phases (spawn:null) contribute only their inherited carry; the event:'win' phase adds 0.
export function enemyTotalFromPhases(phases) {
  let total = 0;
  let carry = 0; // enemies still alive (== maxConcurrent) when the last threshold phase advanced;
                 // they are killed by a later allCleared phase and aren't in any threshold count
  for (const ph of phases || []) {
    const c = ph && ph.advanceWhen;
    if (!c) continue;
    if (c.kills != null) {
      total = Math.max(total, c.kills);
      carry = (ph.spawn && ph.spawn.maxConcurrent) || 0;
    } else if (c.killsSincePhase != null) {
      total += c.killsSincePhase;
      carry = (ph.spawn && ph.spawn.maxConcurrent) || 0;
    } else if (c.allCleared) {
      if (ph.spawn && ph.spawn.total != null) total += ph.spawn.total; // boss/finale caps (new spawns)
      total += carry;  // this phase clears the field -> the carried leftovers die here
      carry = 0;
    }
  }
  return total;
}
```

### 2. Stamp campaign levels — `server/src/catalog_seed.js`

At the top of the file, add the import (near the other `export const` data — the file currently has no
imports, so add it as line 1–2, above the leading comment or right after it):

```js
import { enemyTotalFromPhases } from './enemy_total.js';
```

Immediately **after** the `export const LEVELS = [ … ];` array literal closes (currently
`catalog_seed.js:492`), stamp each descriptor in place (mutating the same objects the seeders read):

```js
// Precompute the total enemy count per level from its phase script (drives the HUD killed/total).
for (const l of LEVELS) l.descriptor.enemyTotal = enemyTotalFromPhases(l.descriptor.phases);
```

Because `db.js` / `db_postgres.js` import `{ LEVELS }` and `JSON.stringify(l.descriptor)` at seed
time, the stamped field is persisted automatically — no seeder edit.

### 3. Stamp side missions — `server/src/missions.js`

Add the import at the top (after the header comment, alongside the file's existing top-level consts):

```js
import { enemyTotalFromPhases } from './enemy_total.js';
```

In `generateMissions()` (`missions.js:51–64`), compute once and add the field to each descriptor.
Replace the `descriptor: { … }` block so it reads:

```js
export function generateMissions() {
  const phases = sideMissionPhases();
  const enemyTotal = enemyTotalFromPhases(phases);
  return FLAVORS.map((f) => ({
    id: `side-${f.type}`,
    type: f.type,
    titleKey: f.titleKey,
    descKey: f.descKey,
    estReward: EST_REWARD,
    descriptor: {
      title: f.type, map: 'home-system', sideMission: true,
      center: f.center, drift: f.drift || null,
      phases,
      enemyTotal,
    },
  }));
}
```

(`sideMissionPhases()` returns a fresh array each call; compute the total once from that same array so
all three flavors share it.)

### 4. Expose the total to the HUD — `client/src/state.js` + `client/src/sim.js`

**a.** In `client/src/state.js`, add a field to the `G` bag next to `kills` (after line 30):

```js
  kills: 0,                   // destroyed enemies this run (drives the level runner's thresholds + HUD)
  enemyTotal: 0,              // total enemies this level/mission (from descriptor.enemyTotal; 0 = unknown -> HUD hides the /total)
```

**b.** In `client/src/sim.js`, in `levelRunner.start(level)` (currently lines 38–41), set the total
from the active descriptor. `G` is already imported at `sim.js:7`. Change:

```js
  start(level) {
    this.level = level; this.phaseIndex = 0; this.won = false; this.winPending = 0;
    this.enterPhase();
  },
```

to:

```js
  start(level) {
    this.level = level; this.phaseIndex = 0; this.won = false; this.winPending = 0;
    G.enemyTotal = (level && level.enemyTotal) || 0; // total enemies for the HUD killed/total (0 if not seeded)
    this.enterPhase();
  },
```

### 5. Render killed/total — `client/src/hud.js`

At `client/src/hud.js:22`, replace:

```js
  el.kills.textContent = G.kills;
```

with:

```js
  el.kills.textContent = G.enemyTotal > 0 ? `${G.kills}/${G.enemyTotal}` : G.kills;
```

Leave `el.enemies.textContent = enemies.length;` (line 23) and everything else untouched.
No HTML change: `client/index.html` line 25 (`<div id="kills" …>0</div>`) already holds only the
number; its `Destroyed` label (line 24) stays as-is.

## Tests

Add a server unit test `server/src/enemy_total.test.js` (mirrors the existing `node --test` style —
`import { test } from 'node:test'; import assert from 'node:assert/strict';`). It needs **no** DB/app
bootstrap (unlike `server.test.js`), just the pure function + the data. The test has three parts:
hard-coded expected totals (anchors), rule-piece unit checks, and — critically — a **behavior-tied
oracle**: a lightweight deterministic re-implementation of `levelRunner`'s spawn-then-advance loop that
plays each descriptor to an empty field and counts kills, asserting it equals `enemyTotalFromPhases`.
This is what makes the leftover/carry bug unable to silently pass again.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enemyTotalFromPhases } from './enemy_total.js';
import { LEVELS } from './catalog_seed.js';
import { generateMissions } from './missions.js';

// Behavior oracle: replays the levelRunner's spawn-then-advance loop (client/src/sim.js update +
// shouldAdvance) deterministically — the arena tops up to spawn.maxConcurrent, THEN advance is checked;
// the "player" kills one enemy per step when the phase isn't ready to advance. Returns kills to clear.
function simulateKillsToClear(phases) {
  let idx = 0, kills = 0, killsAtPhaseStart = 0, spawnedThisPhase = 0, alive = 0;
  const shouldAdvance = (ph) => {
    const c = ph.advanceWhen;
    if (!c) return false;
    if (c.kills != null) return kills >= c.kills;
    if (c.killsSincePhase != null) return (kills - killsAtPhaseStart) >= c.killsSincePhase;
    if (c.allCleared) {
      const spawnDone = !ph.spawn || (ph.spawn.total != null && spawnedThisPhase >= ph.spawn.total);
      return alive === 0 && spawnDone;
    }
    return false;
  };
  for (let guard = 0; guard < 100000; guard++) {
    const ph = phases[idx];
    if (!ph || ph.event === 'win') break;             // reached victory
    if (ph.spawn) {                                    // top up to maxConcurrent (respect total cap)
      const cap = ph.spawn.total;
      while (alive < ph.spawn.maxConcurrent && (cap == null || spawnedThisPhase < cap)) {
        alive++; spawnedThisPhase++;
      }
    }
    if (shouldAdvance(ph) && idx < phases.length - 1) { // advance carries leftover `alive` forward
      idx++; killsAtPhaseStart = kills; spawnedThisPhase = 0;
      continue;
    }
    if (alive > 0) { alive--; kills++; }               // else the player destroys one enemy
    else break;                                        // stuck (invalid descriptor) — fail loudly below
  }
  return kills;
}

const EXPECTED = { 'level-1': 16, 'level-2': 17, 'level-3': 21, 'level-4': 22 };

test('enemyTotalFromPhases: campaign totals match the anchors AND the sim oracle', () => {
  const byName = Object.fromEntries(LEVELS.map((l) => [l.name, l.descriptor]));
  for (const [name, want] of Object.entries(EXPECTED)) {
    const d = byName[name];
    assert.equal(d.enemyTotal, want, `${name} stamped enemyTotal`);
    assert.equal(enemyTotalFromPhases(d.phases), want, `${name} formula`);
    assert.equal(simulateKillsToClear(d.phases), want, `${name} actual kills-to-clear`);
  }
});

test('side missions: total 20, stamped, formula and sim agree', () => {
  for (const m of generateMissions()) {
    assert.equal(m.descriptor.enemyTotal, 20);
    assert.equal(enemyTotalFromPhases(m.descriptor.phases), 20);
    assert.equal(simulateKillsToClear(m.descriptor.phases), 20);
  }
});

test('enemyTotalFromPhases: rule pieces (carry from leftovers)', () => {
  assert.equal(enemyTotalFromPhases([]), 0);
  // two kills thresholds are a MAX (absolute), not a sum; the last carry only lands via a later allCleared
  assert.equal(enemyTotalFromPhases([
    { spawn: { maxConcurrent: 3 }, advanceWhen: { kills: 6 } },
    { spawn: { maxConcurrent: 3 }, advanceWhen: { kills: 12 } },
    { spawn: null, advanceWhen: { allCleared: true } }, // clears the 3 leftovers -> 12 + 3
  ]), 15);
  // killsSincePhase sums; boss allCleared adds its spawn.total on top of the carry
  assert.equal(enemyTotalFromPhases([
    { spawn: { maxConcurrent: 4 }, advanceWhen: { killsSincePhase: 7 } },
    { spawn: { maxConcurrent: 4 }, advanceWhen: { killsSincePhase: 7 } },
    { spawn: { maxConcurrent: 1, total: 2 }, advanceWhen: { allCleared: true } }, // 7+7 + carry 4 + 2
  ]), 20);
  // a threshold phase with NO following allCleared drops its carry (those leftovers never die)
  assert.equal(enemyTotalFromPhases([
    { spawn: { maxConcurrent: 3 }, advanceWhen: { kills: 5 } },
    { event: 'win' },
  ]), 5);
});
```

Run:
- Server: from `server/` → `npm test`. **Also** the Postgres pass (`npm run test:pg`, and CI runs it)
  — this change adds **no** SQL/schema, and the seed data is backend-agnostic, so both backends pass
  identically; `db.js`/`db_postgres.js` are untouched and stay in sync.
- Client: from `client/` → `node --test` (existing unit tests; this change is a one-line textContent
  format — no new client unit test required). Optional eyeball via `client/visual/` is not needed.

## Docs to update

- **`docs/SUMMARY.md`** — the HUD-counters line (~415): change the **Destroyed** description to note it
  now reads **killed / total** (e.g. `8/16`), total precomputed from the descriptor's phase script and
  embedded as `descriptor.enemyTotal`; **Enemies** (alive) unchanged. Also add a short note in the
  **Level flow** area (~389) that each level/mission descriptor carries a server-computed `enemyTotal`.
  Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`** — add a bullet under today's date (`## 2026-07-02`):
  **"HUD Destroyed counter now killed/total"** — the on-screen kill counter shows `killed/total`
  (e.g. `8/16`); total is precomputed on the server from each descriptor's phase script
  (`enemyTotalFromPhases` → `descriptor.enemyTotal`) for campaign levels + side missions; Enemies
  (alive) counter unchanged. Note the campaign path needs a server restart/deploy to reseed.
- **`docs/DECISIONS.md`** — **no entry.** No real trade-off worth recording (the compute-location
  choice is captured here in the plan; it's not a settled architectural fork).

## Out of scope / non-goals (do not gold-plate — DECISIONS §30)

- Do **not** change the **Enemies** (alive) counter, the game-over overlay (`ui.gameover.sub`), or the
  victory line — HUD `el.kills` only.
- Do **not** add a client-side phase-derivation helper — the total comes solely from
  `descriptor.enemyTotal`.
- Do **not** touch `db.js` / `db_postgres.js` schema or queries, add a migration, or add a new column —
  the total rides inside the existing descriptor JSON.
- Do **not** add i18n strings — `8/16` is a bare number pair with no grammatical number (DECISIONS §10).
- Do **not** make the total live/animated — it's fixed per run, set once in `levelRunner.start`.
- No new API endpoint or `estReward`-style card field; the total is only for the in-fight HUD.
