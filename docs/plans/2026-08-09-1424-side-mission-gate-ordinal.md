# Side-mission / shop gates by level NAME, never by raw serial id

**Status:** ready to implement. **Type:** bug fix (production). **Branch/worktree:**
`2026-08-09-1424-side-mission-gate-ordinal`.

## Goal

The side-mission board opens far too early on production: a player who has only reached the "Level 1"
briefing (i.e. has not yet flown the first playable level) already sees the repeatable side-job board, and
the hangar shop is opened for them a level early too. Both gates compare `players.current_progress` — a raw
`levels.id` — against a hardcoded number (`>= 5` for the board, `>= 3` for the shop backfill), and those
numbers are only correct on a freshly-seeded database. Fix: compare against the **level's seed `name`**
(`current_progress >= (SELECT id FROM levels WHERE name = 'level-5')`), so the gates are immune to id drift.
User-visible effect after the fix: the shop opens exactly after the player clears the first playable level
("Level 1"), the side-mission board opens only after clearing "Level 3", and nobody who already has the shop
loses it.

## Root cause (verified against the production DB)

`levels.id` is a `BIGSERIAL`, and the startup seed (`server/src/db.js:295-300`) does
`INSERT INTO levels (name, descriptor) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE ...`. Postgres evaluates
the `DEFAULT nextval(...)` **before** it detects the conflict, so **every server start/deploy burns five
sequence values**. Level rows added at different times therefore land on wildly different ids. Production
today:

| `levels.id` | `levels.name` | player-facing title | players sitting there |
|---|---|---|---|
| 1 | `level-1` | "Level 0" (intro cutscene) | 68 |
| 6 | `level-2` | "Level 1" (first playable level) | 32 |
| 7 | `level-3` | "Level 2" | 5 |
| 71 | `level-4` | "Level 3" | 7 |
| 564 | `level-5` | "Level 4" | 5 |

(The descriptor↔display off-by-one comes from the `intro_level0_progress_shift` one-shot — `level-N` is
displayed as "Level N−1".)

`current_progress` is the level the player is **on** (their current briefing), so the 32 players at id 6 are
on the "Level 1" briefing and have **not yet flown the first playable level**. The raw-id comparisons gave
them **both** unlocks: `6 >= 5` → side-mission board, `6 >= 3` → shop.

Ordering itself is **not** broken — `advanceProgress()` (`server/src/db.js:490-504`) walks
`SELECT MIN(id) FROM levels WHERE id > current`, which only needs monotonic ids, not contiguous ones. Only
the hardcoded thresholds are wrong.

**Important for the impact analysis:** the shop backfill at `server/src/db.js:342-345` is **not**
migration-guarded — unlike the `intro_level0_progress_shift` one-shot above it, it has no `migrations_pg`
ledger entry and **re-runs on every boot** (it is merely idempotent, via the `shop_unlocked = 0` guard +
`ON CONFLICT DO NOTHING`). So it is not a spent one-shot: it re-grants the shop early to every newly-drifted
player on every deploy, and equally, the fix takes effect for everyone on the next deploy.

## The intended player-facing order (assert this, in these words)

Mind the descriptor↔display off-by-one: `level-1` = the "Level 0" intro cutscene, `level-2` = "Level 1",
`level-3` = "Level 2", `level-4` = "Level 3", `level-5` = "Level 4".

1. **The hangar shop opens after the player clears the FIRST PLAYABLE level** ("Level 1" = descriptor
   `level-2`) — i.e. once `current_progress` has reached **`level-3`**. That is the `unlockShop` briefing
   action on `level-3` (DECISIONS §90, `server/src/catalog_seed.js:509`) and the threshold in the boot
   backfill.
2. **The side-mission board does NOT open then.** It opens only once `current_progress` has reached
   **`level-5`** — i.e. after clearing "Level 3" (`level-4`). DECISIONS §91 semantics are unchanged.
3. So: on `level-2` → both locked. On `level-3`/`level-4` → shop open, board locked. On `level-5` → both
   open.

## Decisions (already made — do not re-litigate)

1. **Gate form: by level NAME, not by ordinal rank and not by raw id.** New exported constants
   `SIDE_MISSIONS_MIN_LEVEL = 'level-5'` and `SHOP_MIN_LEVEL = 'level-3'`, plus one helper
   `reachedLevel(currentProgress, levelName)` doing
   `SELECT EXISTS (SELECT 1 FROM levels WHERE name = $1 AND id <= $2)`. **Fail-closed:** if the named row is
   missing, the gate returns `false` (locked) rather than opening. Rank-based (`COUNT(*) WHERE id <= p >= 5`)
   was considered and **rejected**: it is perturbed by any extra `levels` row and would silently move the
   gate a level earlier the day a level is inserted mid-campaign; `name` is already the seed's stable
   identity key (`ON CONFLICT (name)`).
2. **The shop backfill is fixed the same way** (`SHOP_MIN_LEVEL = 'level-3'`), because it re-runs on every
   boot and is therefore live-wrong, not a spent one-shot.
3. **No revocation, no down-migration.** Players who already have `shop_unlocked = 1` keep it, even if they
   got it early. The side-mission board simply re-locks for the players below `level-5` (it is derived live,
   nothing is persisted).
4. **Stale `players.active_mission_id` needs no migration and no defensive handling.** Traced and confirmed
   inert: the client's module-level `activeMissionId` (`client/src/mainwindow.js:35`) is only ever set from a
   successful `GET /missions` (`client/src/mainwindow.js:381`), which 403s while locked
   (`server/src/server.js:242`); `refreshMissions()` hard-resets it to `null` when the gate is closed
   (`client/src/mainwindow.js:376`); and Take-off falls back to `launchCampaign()` when it is null
   (`client/src/mainwindow.js:361-365`). Server-side, `active_mission_id` is read only by `getMissionState`
   (`server/src/db.js:524`), reachable only through the gated mission endpoints. A re-locked player therefore
   flies the campaign, and if they later reach `level-5` their old taken/active mission simply reappears —
   a valid state. **Reviewer: this is deliberate, do not reopen.**
5. **Hardening scope: the two gates only (DECISIONS §30).** Do **not** change the levels seed's `ON CONFLICT`
   path (the sequence burn stays) and do **not** change `resetPlayer`'s `current_progress = 1` or the column
   `DEFAULT 1`. Add a short comment at each of those two sites recording the raw-id assumption and why it is
   safe: `level-1` is id 1 on every live DB, the FK on `current_progress` would fail loudly rather than
   silently, and the drift is harmless once the gates are name-based.
6. **Regression test: a dedicated file on its own database** (`server/src/levels_drift.test.js`), which
   re-ids the levels to the exact production shape while zero players exist. Details in "Tests".

## Steps

### Step 1 — `server/src/db.js`: the constants + the helper

**1a. Add the constants next to the pool** (right after the `export const pool = new pg.Pool({...})` block at
`server/src/db.js:13-15`), so `migrate()` (which runs earlier in the file) can use them without any
temporal-dead-zone doubt:

```js
// Progress gates are compared by the level's seed NAME, never by a raw `levels.id`. `levels.id` is a
// BIGSERIAL and the startup upsert (`INSERT ... ON CONFLICT (name) DO UPDATE`) burns a sequence value on
// EVERY boot, so ids drift apart over time (production: 1, 6, 7, 71, 564 for level-1..level-5). A
// hardcoded numeric threshold silently unlocks content early on a drifted DB. See DECISIONS §95.
export const SHOP_MIN_LEVEL = 'level-3';          // hangar shop: reached after clearing "Level 1" (DECISIONS §90)
export const SIDE_MISSIONS_MIN_LEVEL = 'level-5'; // side-mission board: reached after clearing "Level 3" (DECISIONS §91)
```

**1b. Add the helper** next to the other level helpers, replacing the old constant at
`server/src/db.js:719-723` (delete `SIDE_MISSIONS_MIN_PROGRESS` and its comment block; put the helper just
after `getLevels()` at `:714-717`):

```js
// Has the player's `current_progress` reached (or passed) the level seeded under `levelName`? The single
// place progress is compared against a story milestone. Fail-closed: an absent level row → false (locked),
// never "open by default". See DECISIONS §95 (why a raw id must never be a threshold).
export async function reachedLevel(currentProgress, levelName, db = pool) {
  const { rows } = await db.query(
    'SELECT EXISTS (SELECT 1 FROM levels WHERE name = $1 AND id <= $2) AS reached',
    [levelName, currentProgress]);
  return !!(rows[0] && rows[0].reached);
}
```

**1c. Rewrite the gate** at `server/src/db.js:1066-1076` inside `getActivePlayerShip()`. Today:

```js
  const progression = await getProgression(playerId);
  ...
    sideMissionsUnlocked: reg.currentProgress >= SIDE_MISSIONS_MIN_PROGRESS, // ...
```

becomes:

```js
  const [progression, sideMissionsUnlocked] = await Promise.all([
    getProgression(playerId),                                          // banked XP → derived level + skill points
    reachedLevel(reg.currentProgress, SIDE_MISSIONS_MIN_LEVEL),        // side-mission board gate (DECISIONS §91/§95)
  ]);
  ...
    sideMissionsUnlocked, // board opens on reaching `level-5` ("Level 4" briefing) — by NAME, never by raw id (DECISIONS §95)
```

(One extra tiny lookup on a unique-indexed column, run in parallel with `getProgression` — negligible next to
the ship/loadout query this function already does.)

**1d. Fix the boot backfill** at `server/src/db.js:334-345`. Replace the two statements and rewrite the
comment block so it states the *name*-based rule and that this backfill re-runs on every boot:

```js
  // Backfill: the hangar shop unlocks on reaching `level-3` (player-facing "Level 2" — i.e. right after
  // clearing the first playable level, "Level 1"/`level-2`), not at the final level (DECISIONS §90).
  // Side missions are gated separately, on reaching `level-5` (DECISIONS §91) — derived live, no backfill.
  // Thresholds are resolved by level NAME: `levels.id` drifts (DECISIONS §95), and the old raw
  // `current_progress >= 3` opened the shop a level early for every drifted player.
  // NOT ledger-guarded: this runs on EVERY boot and is merely idempotent (the `shop_unlocked = 0` guard +
  // ON CONFLICT DO NOTHING), like the Grab/shield backfills above. Players who were granted the shop early
  // by the old comparison KEEP it — there is deliberately no revocation.
  await pool.query(`UPDATE players SET shop_unlocked = 1
    WHERE shop_unlocked = 0 AND current_progress >= (SELECT id FROM levels WHERE name = $1)`, [SHOP_MIN_LEVEL]);
  await pool.query(`INSERT INTO stash (player_id, kind, ref_id, qty)
    SELECT id, 'weapon', 1, 1 FROM players WHERE current_progress >= (SELECT id FROM levels WHERE name = $1)
    ON CONFLICT (player_id, kind, ref_id) DO NOTHING`, [SHOP_MIN_LEVEL]);
```

(Fail-closed here too: a missing `level-3` row makes the subquery NULL → the comparison is NULL → zero rows
updated.)

**1e. Comment-only, per Decision 5** (no behavior change):

- At `server/src/db.js:394` (`resetPlayer`'s `current_progress = 1`), add above the `withTx` call:
  ```js
  // `current_progress = 1` is a raw id: the FIRST level (`level-1`) is id 1 on every live DB, and the FK on
  // current_progress would fail loudly (not silently) if that ever changed. Left as-is deliberately — the
  // gates are name-based now, so id drift is harmless (DECISIONS §95, §30).
  ```
- At `server/src/db.js:125` (`... current_progress INTEGER NOT NULL DEFAULT 1 REFERENCES levels(id)`), append
  a trailing SQL comment: `-- DEFAULT 1 = the first level (level-1, id 1 on every live DB); see DECISIONS §95`.
- At `server/src/db.js:295-300` (the levels seed), add one line above the loop:
  ```js
  // NOTE: the ON CONFLICT path still consumes a `levels_id_seq` value on every boot, so ids drift apart
  // (prod: 1, 6, 7, 71, 564). Deliberately not "fixed": nothing depends on contiguous ids — ordering uses
  // MIN(id) and the gates resolve by name (DECISIONS §95, §30).
  ```

### Step 2 — `server/src/server.js`: the gate comment

`server/src/server.js:219-224` still says `current_progress >= SIDE_MISSIONS_MIN_PROGRESS`. Update that
comment to: "…on reaching the level seeded as `level-5` (`SIDE_MISSIONS_MIN_LEVEL`, the "Level 4" briefing,
i.e. after clearing "Level 3" — DECISIONS §91/§95); compared by level NAME, never by a raw id."
No code change: `server/src/server.js:233` and `:242` keep gating on `active.sideMissionsUnlocked`, and
`shopState` (`:195`) keeps forwarding it.

### Step 3 — `client/src/mainwindow.js`: comment only

`client/src/mainwindow.js:373-376` already gates on the server-derived `sideMissionsUnlocked` flag — **no
client code change**. Optionally append to the comment at `:373`: "(the server derives it by level name, not
by a raw progress id — DECISIONS §95)".

### Step 4 — final concept sweep (run it, then paste the output into the PR/summary)

```
cd <worktree> && grep -rn "SIDE_MISSIONS_MIN_PROGRESS\|current_progress >= [0-9]\|progress >= [0-9]" \
  --exclude-dir=node_modules --exclude-dir=.git server client docs
```

Expected end state: **zero** hits in `server/` and `client/`; the only remaining hits are in the historical
records that must NOT be edited — `docs/CHANGELOG.md` (append-only) and the older briefs
`docs/plans/2026-08-08-base-menu-redesign.md`, `docs/plans/2026-07-08-2224-intro-first-level.md` (historical
plans). `docs/SUMMARY.md` and `docs/DECISIONS.md` must be updated (see "Docs to update"), so they must not
appear either.

## Tests

Run: `cd server && npm test` (the `pretest` script drops+recreates `spacegame_test`; the single data layer is
`db.js`), and `cd client && node --test` (unaffected — no client logic changes).

### 4a. NEW `server/src/levels_drift.test.js` — the regression guard (mandatory)

Why a separate file: reproducing drift needs non-contiguous `levels.id` values, and
`players.current_progress REFERENCES levels(id)` (no `ON UPDATE CASCADE`) makes re-numbering impossible once
players exist. Mutating `levels` inside the shared `spacegame_test` would also race the other five test
files, which `node --test` runs **in parallel, one child process per file** (and the client visual runner
starts its own server against `spacegame_test` too — `client/visual/run.mjs:60-64`). A dedicated database
sidesteps both: the file re-ids the levels **before any player row exists**, so no FK is in the way.

**Database choice / connection.** Derive from `DATABASE_URL` so it works locally and in CI unchanged:

```js
// Isolated DB: never touch spacegame_test (the shared suite + the visual runner use it).
const BASE = process.env.DATABASE_URL || 'postgres://localhost:5432/spacegame_test';
const DRIFT_DB = 'spacegame_test_drift';
const admin = new URL(BASE); admin.pathname = '/postgres';          // maintenance connection
const drift = new URL(BASE); drift.pathname = '/' + DRIFT_DB;
```

CI runs Postgres 16 as the superuser `postgres` (`.github/workflows/ci-cd.yml:14-38`,
`DATABASE_URL=postgres://postgres:postgres@localhost:5432/spacegame_test`), so `CREATE DATABASE` is allowed;
locally the maintainer's role already owns `createdb` (the `pretest` script calls it). `DROP DATABASE ...
WITH (FORCE)` needs PG ≥ 13 — both are 16. No change to `package.json` (the file creates its own DB, so a
bare `node --test` without `pretest` still works).

**File shape** (`node:test`, no deps; env must be set **before** importing `db.js`, whose pool is built at
import time):

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
// ... BASE/DRIFT_DB/admin/drift as above ...
const sql = async (url, q) => { const c = new pg.Client({ connectionString: url }); await c.connect(); try { return await c.query(q); } finally { await c.end(); } };
await sql(admin.href, `DROP DATABASE IF EXISTS ${DRIFT_DB} WITH (FORCE)`);
await sql(admin.href, `CREATE DATABASE ${DRIFT_DB}`);
process.env.DATABASE_URL = drift.href;                    // the pool reads this at import
const db = await import('./db.js');
await db.migrate();
after(async () => { await db.pool.end(); await sql(admin.href, `DROP DATABASE IF EXISTS ${DRIFT_DB} WITH (FORCE)`); });
```

**The drift.** Apply the exact production shape, guarded so a future extra level fails loudly instead of
silently skewing the test:

```js
const PROD_IDS = { 'level-1': 1, 'level-2': 6, 'level-3': 7, 'level-4': 71, 'level-5': 564 };
const seeded = (await db.pool.query('SELECT name FROM levels ORDER BY id')).rows.map((r) => r.name);
assert.deepEqual(seeded, Object.keys(PROD_IDS),
  'the seed still holds exactly level-1..level-5 — extend PROD_IDS if a level was added');
// Safe as one statement: no player rows exist yet (no FK references) and the new ids {1,6,7,71,564}
// do not collide with the remaining old ids {1..5}.
await db.pool.query(`UPDATE levels SET id = CASE name
  WHEN 'level-2' THEN 6 WHEN 'level-3' THEN 7 WHEN 'level-4' THEN 71 WHEN 'level-5' THEN 564 ELSE id END`);
await db.pool.query("SELECT setval('levels_id_seq', 1000)");   // future inserts can't collide
```

**Test 1 — "drifted level ids: the side-mission board opens by level NAME, not by a raw progress id".**
Register `drift-1` (`db.registerPlayer`), then walk `db.advanceProgress` and read
`db.getActivePlayerShip` at each stop. `advanceProgress` runs the level briefing's actions
(`server/src/db.js:497` → `applyBriefingActions` → `unlockShop`), so the shop unlock is exercised for real.
Assert, at each step, the intended order from the section above:

| after | `currentProgress` | `shopUnlocked` | `sideMissionsUnlocked` | note |
|---|---|---|---|---|
| register | 1 (`level-1`, "Level 0") | false | false | |
| 1st advance | **6** (`level-2`, "Level 1" briefing) | **false** | **false** | the exact prod bug: the old `>= 5`/`>= 3` said true for both |
| 2nd advance | 7 (`level-3`, "Level 2") | **true** | **false** | shop opens after clearing the first playable level |
| 3rd advance | 71 (`level-4`, "Level 3") | true | **false** | board still locked |
| 4th advance | 564 (`level-5`, "Level 4") | true | **true** | board opens |

Include an explicit comment on the id-6 row: *"6 >= 5 and 6 >= 3 were both true — this is the assertion that
would have caught the production bug."* Also assert `db.reachedLevel(6, 'level-5') === false` and
`db.reachedLevel(564, 'level-5') === true`, plus the fail-closed case
`db.reachedLevel(564, 'no-such-level') === false`.

**Test 2 — "drifted level ids: the boot shop backfill uses the level name, not `>= 3`".**
Register `drift-early` and `drift-past`; set
`current_progress = (SELECT id FROM levels WHERE name = 'level-2')` (→ 6) and `... 'level-3'` (→ 7)
respectively, with `shop_unlocked = 0` for both, and delete their weapon-1 stash rows. Re-run `db.migrate()`
(idempotent — exercises the backfill), then assert `drift-early.shop_unlocked === 0` ("still on the first
playable level → shop stays locked, even though its raw id 6 >= 3") and `drift-past.shop_unlocked === 1` +
its weapon-1 stash row exists.

### 4b. `server/src/server.test.js` — small updates (contiguous-id DB, still valuable)

These pass today only because `pretest` gives contiguous ids 1..5; keep them as the happy-path coverage and
make their wording/queries id-agnostic:

- `:818` — retitle `shop: unlocks on reaching "Level 2" (id 3) …` → `… on reaching the level-3 row (player-facing "Level 2") …`; same for the inline comments at `:820-822`.
- `:828-844` (backfill test) — replace the literal ids: `UPDATE players SET current_progress = (SELECT id FROM levels WHERE name = 'level-3'), shop_unlocked = 0 WHERE id = 'bf-past'` and `... name = 'level-2' ...` for `bf-early`; retitle to `migration: backfills shop_unlocked + basic gun for players past the first playable level (level-3)`. Add a one-line comment pointing at `levels_drift.test.js` for the drifted-id coverage.
- `:868-879` (the gate test) — retitle to `missions: unlock LATER than the shop — locked at "Level 2", open on reaching level-5 (DECISIONS §91)`, drop the "id 3"/"id 5" phrasing from its comments, and add the same pointer comment.
- Leave `:141` (`assert.equal(reg.currentProgress, 5)`) alone — it is a contiguous-DB fact and is fine here.

### 4c. Untouched suites (state this so nobody "fixes" them)

- **Visual scenarios** `09-mission-setpieces`, `10-mission-board`, `24-freighter-exhaust` clear the campaign
  with 4× `POST /advance` (e.g. `client/visual/scenarios/10-mission-board.mjs:11-14`) → they land on
  `level-5` and the board still opens. No edits needed.
- **Replay/intro impact: none.** This change touches no sim, damage, collision, movement or gameplay-RNG code
  — the deterministic re-sim in `client/src/replay.js` and the recorded Level-0 intro trace are unaffected.
  Still run `cd client && node visual/run.mjs 22-intro-replay` once as the standing guard (the intro path
  ends in an `advance` from `level-1` → `level-2`, which the new gate must leave locked).

## Docs to update (on the branch, per CLAUDE.md)

**`docs/SUMMARY.md`** (bump `**Updated:**` at `:6` and lead its parenthetical with this fix):
- `:1209` and `:1216` — drop the misleading "(id 3)" / "(id 5)" from the level list headings (ids drift; the
  `name` is the identity). Keep the titles.
- `:1216-1221` — the `level-5` bullet: the board "unlocks here once `current_progress` has reached the
  `level-5` row (matched by NAME, not by id — DECISIONS §91/§95)".
- `:1301-1303` — the "Side missions" gameplay bullet: replace ``current_progress >= 5`` with "reached the
  `level-5` row (`sideMissionsUnlocked`, resolved by level name)".
- `:1820-1823` — the shop-backfill sentence: replace ``current_progress >= 3`` with "reached the `level-3`
  row"; add that this backfill runs on every boot and never revokes.
- `:1832-1834` — `getActivePlayerShip` returns `sideMissionsUnlocked` "derived via `reachedLevel(progress,
  SIDE_MISSIONS_MIN_LEVEL='level-5')`" (the old `SIDE_MISSIONS_MIN_PROGRESS = 5` text goes).
- `:1840-1843` — the `GET /missions` gating sentence: same name-based wording.
- Tests section (`:2263+`, the server bullet around `:2302`) — add `server/src/levels_drift.test.js`: "runs
  against its own throwaway DB (`spacegame_test_drift`), re-ids the levels to the production drift shape
  (1, 6, 7, 71, 564) and asserts the shop opens on `level-3` and the board only on `level-5`".
- Project structure listing — add the new test file if the server test files are enumerated there.

**`docs/CHANGELOG.md`** — one bullet under `## 2026-08-09`:
> **Fixed: the side-mission board unlocked far too early (and the shop a level early).** Progress gates
> compared `players.current_progress` against hardcoded level ids (`>= 5` / `>= 3`), but `levels.id` is a
> BIGSERIAL whose sequence is burned by the startup upsert's `ON CONFLICT` path, so production ids had
> drifted to 1, 6, 7, 71, 564 — a player still on the "Level 1" briefing (id 6) was handed **both** the
> side-mission board and the hangar shop. Both gates now resolve the threshold by level **name**
> (`reachedLevel(progress, 'level-5')` / `'level-3'`), fail-closed if the row is missing. Ops detail: the
> shop backfill is **not** ledger-guarded — it re-runs on every boot, so it had been re-granting the shop
> early on each deploy and the fix likewise applies to everyone on the next deploy. Players who already got
> the shop early **keep it** (no revocation); the side-mission board re-locks for players below `level-5`,
> which is inert — a stale `active_mission_id` is never read while the board is locked. New
> `server/src/levels_drift.test.js` reproduces the production id drift on its own database. DECISIONS §95.

**`docs/DECISIONS.md`** — add **§95** (verify it is still free before writing: `grep -n "^## 9[3-9]\." docs/DECISIONS.md`;
`§94` is taken on `main` and parallel sessions may have claimed the next one — if so take the next free
number and use it consistently in code comments, SUMMARY and CHANGELOG):

> **## 95. Progress thresholds are level NAMES, never raw serial ids**
> Decision: any "has the player reached story point X" gate compares `players.current_progress` against
> `(SELECT id FROM levels WHERE name = '<seed name>')` via `reachedLevel()`, never against a hardcoded
> number. Why: `levels.id` is a BIGSERIAL and the idempotent startup seed's `INSERT ... ON CONFLICT (name) DO
> UPDATE` still evaluates `nextval()` before detecting the conflict, so **every deploy burns five sequence
> values** and level rows added at different times drift arbitrarily far apart (prod: 1, 6, 7, 71, 564). A
> numeric threshold is therefore only correct on a freshly-seeded DB — and it fails **open** (silently
> unlocking content early: the "Level 1" briefing at id 6 satisfied both `>= 5` and `>= 3`), which is the
> worst failure direction and is invisible in tests, because `pretest` recreates the DB and always yields
> contiguous ids 1..5. Name-based comparison fails **closed** instead. Rejected alternatives: ordinal rank
> (`COUNT(*) WHERE id <= progress`) — correct today but perturbed by any extra `levels` row and it would
> silently re-anchor the gate if a level were inserted mid-campaign; renumbering the ids or stopping the
> sequence burn — pure churn, nothing depends on contiguous ids (`advanceProgress` uses `MIN(id) > current`),
> and it would not fix the already-drifted production DB (§30). Consequences: §90's shop threshold is
> `SHOP_MIN_LEVEL = 'level-3'` and §91's board threshold is `SIDE_MISSIONS_MIN_LEVEL = 'level-5'` (semantics
> unchanged: shop after the first playable level, board after "Level 3"); the early-granted `shop_unlocked`
> flags are **not** revoked; and the drift is now covered by `server/src/levels_drift.test.js`, which runs on
> its own database because the FK on `current_progress` makes re-numbering impossible once players exist.
> Cross-ref §90, §91, §30, §67 (single Postgres data layer).

Also add a one-line amendment note at the end of **§90** and **§91** ("threshold form corrected to
name-based — see §95; semantics unchanged") rather than rewriting their bodies.

## Rollout / impact

- **No DB migration, no backfill, no downtime step.** The board gate is derived per request; the shop
  backfill self-corrects on the next boot (it runs every boot).
- On deploy: the 32 players at id 6 (`level-2`) lose the side-mission board until they reach `level-5`, and
  **keep** any shop access they were granted early. The 5 at id 7 and 7 at id 71 keep the shop, lose the
  board. The 5 at id 564 are unaffected.
- **Post-deploy live check (stage 9):** (1) `/admin/players` — confirm the progress column still resolves
  (`server/src/admin.js:152` `progressCell` already maps the id through the `getLevels()` list, so drift is
  already handled there — verify, don't change). (2) Log in as / reset a throwaway account, clear the intro →
  land on the "Level 1" briefing → the Missions view must show **only** the campaign card and no side jobs,
  while the shop is still locked; then clear "Level 1" → shop opens, board still absent. (3) `psql` on prod:
  `SELECT id, name FROM levels ORDER BY id;` plus
  `SELECT current_progress, count(*) FROM players GROUP BY 1 ORDER BY 1;` to confirm the distribution matches
  the table above.

## Out of scope / non-goals (DECISIONS §30)

- Renumbering production level ids, adding `ON UPDATE CASCADE`, or changing the seed so it stops burning
  sequence values.
- Changing `resetPlayer` / the `current_progress DEFAULT 1` (comments only).
- Revoking `shop_unlocked` from anyone, or clearing `active_mission_id` (Decision 3/4).
- Any generalized "level ordinal / progression rank" abstraction, a `sort_order` column, or a
  `levels`-caching layer. One helper, two constants.
- Any UI/copy change to the board, the briefings, or the i18n strings — the unlock **semantics** are
  unchanged, only the comparison is fixed.

## Implementer checklist

- [ ] `db.js`: constants added by the pool; `reachedLevel()` added; `SIDE_MISSIONS_MIN_PROGRESS` deleted.
- [ ] `getActivePlayerShip` gate + boot backfill both name-based and fail-closed.
- [ ] Comment-only notes at the seed loop, `resetPlayer`, and the column default.
- [ ] `server.js` / `mainwindow.js` comments refreshed; no behavior change there.
- [ ] New `server/src/levels_drift.test.js` passes and drops its DB afterwards; `spacegame_test` untouched.
- [ ] `cd server && npm test` green; `cd client && node --test` green; `22-intro-replay` green.
- [ ] Step-4 sweep returns no hits in `server/`, `client/`, `docs/SUMMARY.md`, `docs/DECISIONS.md`.
- [ ] SUMMARY + CHANGELOG + DECISIONS §95 written, § number checked for collisions.
