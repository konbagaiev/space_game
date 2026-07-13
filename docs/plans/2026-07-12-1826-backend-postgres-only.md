# Backend: Postgres-only (drop the SQLite backend)

## Goal

Bind the backend to **PostgreSQL only** and delete the parallel SQLite implementation, so there is a
**single storage engine** and a **single migration story**. Today the same data layer is hand-written
twice — `server/src/db.js` (SQLite, 678 lines) and `server/src/db_postgres.js` (Postgres, 865 lines) —
selected at runtime by `datastore.js` based on `DATABASE_URL`. Every schema/query change has to be made
in both files by hand, and the server test suite only ran the SQLite copy for free (Postgres was a
separate `test:pg` pass), so parity drift is a documented, recurring risk. Postgres already runs in
production and is now available locally (Homebrew `postgresql@16`), so SQLite no longer buys us anything
we can't get from a throwaway local Postgres DB.

**This is a pure maintainability refactor — NO runtime behavior change.** Prod already runs Postgres;
its runtime path (`db_postgres.js`) is unchanged in behavior. We are only: removing the SQLite branch,
renaming `db_postgres.js → db.js`, deleting the SQLite files, making the test suite drop/recreate a
local Postgres test DB, and updating docs/skills/CI. The public datastore API and every query stay
byte-for-byte the same on the Postgres path.

## Decisions (already settled — do not re-open)

- **Q1 — Local default connection.** The data layer defaults the `pg.Pool` connection string to
  `postgres://localhost:5432/spacegame` when `DATABASE_URL` is unset, so a bare `npm start` / `reset.js`
  still works locally with zero env against the local brew Postgres. Prod and CI always set
  `DATABASE_URL` explicitly. The test suite uses `spacegame_test`.
- **Q2 — Naming & façade.** Rename `db_postgres.js → db.js` (reclaim the name now that the SQLite `db.js`
  is deleted → "`db.js` = the one data layer"). **Keep `datastore.js`** as the thin re-export façade that
  every consumer imports; drop its backend selector (it becomes a static `import ... from './db.js'`).
  Keep a `backend = 'postgres'` constant exported from `datastore.js` (used by `reset.js`'s log line and
  the `/api/health` response in `server.js:119/121`).
- **Q3 — Clean-DB for tests.** Add a `pretest` script that drops+recreates `spacegame_test`
  (`dropdb --if-exists spacegame_test && createdb spacegame_test`) — this fixes **stale schema** (a
  persistent PG server keeps old columns a `resetAllPlayers()` TRUNCATE can't repair). Fold the old
  `test:pg` into `test` (which now sets `DATABASE_URL` to the `spacegame_test` DB). **Keep** the in-suite
  `resetAllPlayers()` at `server.test.js:25-28` so a direct `node --test src/server.test.js` (which skips
  `pretest`) still starts from clean **data**. `createApp()` already calls `migrate()`
  (`server.js:51`), so a freshly recreated empty DB gets schema + catalog on boot — no extra migrate step
  is needed. `dropdb`/`createdb` are preinstalled on GitHub's `ubuntu-latest`.
- **Q4 — Delete outright.** Delete the entire `server/src/migrations/` directory (001…023), the SQLite
  migration runner `server/src/migrate.js`, and `server/src/backfill-grab.test.js` (a node:sqlite unit
  test of migration 019). Git preserves the history; the Postgres idempotent bootstrap + the
  `migrations_pg` one-shot ledger in `db.js` (renamed) is the single go-forward migration story. The
  Grab backfill remains idempotently guarded inside `db.js migrate()` (the renamed `db_postgres.js`
  lines ~263-268), already applied in prod, so it needs no ported unit test (§30).

## Consumer sweep (what references the deleted/renamed symbols, and how each is handled)

Ran `grep -rn -E "db_postgres|node:sqlite|DatabaseSync|test:pg|ExperimentalWarning|migrations/|DB_PATH|backend ===|\bSQLite\b|PRAGMA user_version" .` (excluding `node_modules`, `.git`, and — for the plain word `SQLite`/`PRAGMA` — the **historical** `docs/plans/*.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/pipeline-runs.jsonl`). Broadening the sweep to the plain word `SQLite` + `PRAGMA user_version` (not just the code symbols) surfaced several **active** files still describing the deleted backend. Results:

**Active code/config — MUST update (steps below):**
- `server/src/datastore.js` — the selector (`db.js` vs `db_postgres.js`) → static import of `./db.js`.
- `server/src/db.js` — the SQLite layer → **delete**.
- `server/src/db_postgres.js` — → **rename to `db.js`**; edit its comments + pool default.
- `server/src/migrate.js`, `server/src/migrations/` (001…023) — → **delete**.
- `server/src/backfill-grab.test.js` — imports `node:sqlite` + `migrations/019_backfill_grab.js` → **delete**.
- `server/src/server.test.js` — `DB_PATH` temp-file setup (imports + `dbPath`, lines ~5-9, `after()`
  ~32-37), the two-backend comment (~20-27) + the `if (process.env.DATABASE_URL)` guard, the
  `backend === 'sqlite'` branch importing `db_postgres.js` (~803-815), and two inline test comments that
  name SQLite (line 160 "SQLite accepts the boolean…"; line 349 "…on SQLite + Postgres") → simplify (step 5).
- `server/src/catalog_seed.js:4` — comment "see db.js / db_postgres.js" → "see db.js".
- `server/src/server.js:2` — file header "Storage is SQLite (see db.js)." → "Storage is PostgreSQL
  (see db.js)."; and **`:257`** — comment "the Postgres path (see the SQLite/Postgres parity note in
  DECISIONS)." → trim the parity aside (leave the historical auth-race note; step 10).
- `server/package.json` — scripts (`pretest`, merged `test`, drop `test:pg`, drop the
  `--disable-warning=ExperimentalWarning` flags — node:sqlite was their only trigger).
- `Dockerfile:24` — prod `CMD` has `--disable-warning=ExperimentalWarning` → drop it.
- `.github/workflows/ci-cd.yml` — collapse the two server-test steps into one Postgres step (comment
  lines 11-14 + steps at 34-39 name SQLite).
- `server/src/reset.js:1,37` — header comment + skill references (Postgres-only wording; step 9).
- `server/src/auth.js:87` — comment "backend-agnostic (datastore picks SQLite/Postgres)" → "backend-agnostic
  via the datastore façade" (step 10).
- **Root `README.md:4`** — project overview says "Node.js + Express + **SQLite** backend" → PostgreSQL (step 11).
- **`server/README.md`** — line 4 ("Storage is SQLite via `node:sqlite`"), the whole "Storage &
  migrations" section (~lines 33-46: `server/data/game.db`, the `migrate.js` runner, `PRAGMA
  user_version`, `src/migrations/NNN_name.js`), and the "Layout" bullets (`src/db.js — opens the SQLite
  database`, `src/migrate.js`, `src/migrations/`) all document deleted files → rewrite to the Postgres
  bootstrap + `migrations_pg` ledger story (step 11).
- **`.gitignore:4`** — comment "# Server data (SQLite db)" is now inert → one-line comment fix (step 10).
- `client/src/format.js:20` — comment "server's sellPrice (db.js / db_postgres.js)" → "(db.js)".

**Dev tooling — the isolated-server runners (FUNCTIONAL fix, not just a comment):** `client/visual/run.mjs`,
`client/bench/run.mjs`, and `client/bench/gen-backdrop.mjs` each spawn `src/server.js` with
`env: { …, DB_PATH: <os.tmpdir()>/…​.db }` to keep "real data untouched" via a throwaway SQLite file.
With SQLite gone, **`DB_PATH` is ignored** and the pool falls back to its default
`postgres://localhost:5432/spacegame` — i.e. these tools would silently hit the developer's **real local
dev DB**, breaking the documented isolation. Fix by pointing them at the throwaway test DB instead
(step 12). Also drop the now-inert `--disable-warning=ExperimentalWarning` flag and the "throwaway
SQLite" comments in the same files:
- `client/bench/run.mjs` (spawn flag `:118`, header comment `:5`, `DB_PATH` env `:119`),
  `client/bench/gen-backdrop.mjs` (`:77`, `:7`, `:78`), `client/visual/run.mjs` (`:63`, `:4`, `:64`),
  and `client/visual/README.md:32` ("throwaway SQLite DB (your real `game.db` is untouched)").
- `.claude/skills/run-local/SKILL.md` — flag `:45` **and** the prose `:68` ("SQLite backend").
- `.claude/skills/update-ship-model/SKILL.md:100`, `.claude/skills/record-backdrop-clip/SKILL.md:31`,
  `.claude/skills/record-playback/SKILL.md:29` (flag only).

**Pipeline agent instructions — the "keep both backends in sync / test on both" guidance is now wrong:**
- `.claude/agents/feature-implementer.md:23-24` — "Server tests must pass on **both** SQLite and Postgres —
  keep `db.js` and `db_postgres.js` in sync." → single Postgres backend / `npm test` on Postgres (step 13).
- `.claude/agents/feature-planner.md:47` — same reword (step 13).
- `.claude/agents/code-reviewer.md:29` ("full suite passes … server on **both SQLite and Postgres**.
  Blocking if not") and `:35` ("SQLite/Postgres parity gaps") → single-Postgres wording (step 13).
- `.claude/agents/plan-critic.md:30` ("Server = both SQLite + Postgres") → "Server = Postgres" (step 13).
- `.claude/skills/reset-progress/SKILL.md` — full rewrite (Postgres-only; step 9).
- `.claude/skills/update-ship-model/SKILL.md:16` — "`db.js` / `db_postgres.js`" → "`db.js`".

**Docs — updated in the Docs section (SUMMARY / DECISIONS / CHANGELOG), NOT the historical briefs:**
- `docs/SUMMARY.md` lines ~1380-1382, 1633-1634, 1648-1654, 1700-1711, 1809, 1816, 1821, 1850.
- `docs/plans/*.md` (dozens of matches: repair-drone, mission-generator, hangar-shop, etc.) are
  **point-in-time historical briefs — DO NOT edit them.** Same for past `docs/CHANGELOG.md` /
  `docs/DECISIONS.md` entries (append-only history; never rewrite prior entries).

**No matches in `client/` runtime code, `scripts/`, or `server.js` logic that read the SQLite path
beyond the comments above.** `client/src/format.js` only has a comment. The `backend` const is consumed
by `server.js:119/121` (health) and `reset.js:28/32` (log) — both keep working with `backend = 'postgres'`.

---

## Steps

### 1. Rename `db_postgres.js → db.js` (delete the old SQLite `db.js` first)

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-07-12-1826-backend-postgres-only/server
git rm src/db.js                 # remove the 678-line SQLite layer
git mv src/db_postgres.js src/db.js   # Postgres layer takes the reclaimed name
```

Then edit the **new** `src/db.js` header + pool so it reads as the single data layer (no "same API as
the SQLite layer" framing):

- **Line 1-3** (the file header), replace:
  ```js
  // PostgreSQL data layer (used in production when DATABASE_URL is set).
  // Same API as the SQLite layer (db.js), but async. Connects to the shared Postgres.
  import pg from 'pg';
  ```
  with:
  ```js
  // The data layer — PostgreSQL (the only storage engine). All functions are async.
  // Connects via DATABASE_URL; defaults to a local Postgres for zero-config dev/test.
  import pg from 'pg';
  ```
- **Line 6** (pool), replace:
  ```js
  export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  ```
  with:
  ```js
  // DATABASE_URL in prod/CI; a local Postgres default so `npm start` / reset.js work with zero env.
  export const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/spacegame',
  });
  ```
- **Lines 8-9** (the `migrate()` docblock), replace the "Versioned PG migrations are a TODO … The SQLite
  path keeps its versioned runner." wording with the fact that this IS the migration story:
  ```js
  // Idempotent schema bootstrap + the migrations_pg one-shot ledger — the single, forward-only
  // migration story (DECISIONS §9). Safe to run on every boot: CREATE TABLE IF NOT EXISTS + guarded
  // ALTER/one-shots, then an upsert of the catalog from catalog_seed.js.
  ```
- Sweep the remaining "mirrors the SQLite …" / "Mirrors db.js" comments in the file (grep the renamed
  `src/db.js` for `SQLite` and `db\.js`): lines ~221, 241, 263, 269, 306, 394, 494, 534, 721, 792, 805.
  These are now self-referential/stale. Trim each so it stands alone, e.g. line 221
  "Mirrors the SQLite seedCatalog (backend parity)." → "Orphaned enemy rows are pruned on re-seed so a
  player can't lose an owned ship." and line 263 "… (DECISIONS §40; mirrors SQLite migration 019)." →
  "… (DECISIONS §40; one-shot backfill, idempotent via the `NOT (components ? 'grab')` guard)." Keep the
  behavior; only drop the "mirrors SQLite / the other backend" framing. Do **not** touch the SQL.

### 2. `datastore.js` — drop the selector, keep the façade

Edit `server/src/datastore.js` lines 1-6. Replace:
```js
// Data backend selector: PostgreSQL when DATABASE_URL is set (production),
// otherwise SQLite (local dev / tests). Both expose the same async API.
const usePostgres = !!process.env.DATABASE_URL;
const impl = usePostgres ? await import('./db_postgres.js') : await import('./db.js');

export const backend = usePostgres ? 'postgres' : 'sqlite';
```
with:
```js
// Thin façade over the single data layer (db.js — PostgreSQL). Kept as the stable import surface
// every consumer (server.js, reset.js, tests) uses, so the data layer's filename can change without
// touching them.
const impl = await import('./db.js');

export const backend = 'postgres';
```
Leave lines 7-49 (the `export const foo = (...a) => impl.foo(...a)` re-exports) exactly as they are.

### 3. Delete the SQLite migration runner + migrations directory

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-07-12-1826-backend-postgres-only/server
git rm src/migrate.js
git rm -r src/migrations
```
Confirm nothing else imports them: `grep -rn "migrate.js\|migrations/\|runMigrations\|user_version" src`
should return nothing after this (the only prior importers were `db.js` — now deleted — and the two
`migrations/*_.js` self-comments, gone with the directory).

### 4. Delete the orphaned SQLite unit test

```bash
git rm src/backfill-grab.test.js
```
(It imports `node:sqlite`'s `DatabaseSync` + `migrations/019_backfill_grab.js`, both deleted. The
Postgres Grab backfill in `db.js migrate()` is retained and idempotent — Q4.)

### 5. `server.test.js` — drop the SQLite temp-file scaffolding + the `backend === 'sqlite'` branch

`server/src/server.test.js`:
- **Lines 3-9** — remove the `os`/`path`/`fs` imports + temp-DB setup that only served SQLite. Replace:
  ```js
  import os from 'node:os';
  import path from 'node:path';
  import fs from 'node:fs';

  // Use a throwaway temp database (must be set before importing the server/db).
  const dbPath = path.join(os.tmpdir(), `spacegame-test-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test'; // non-Secure cookies so local-http tests can read/replay them
  ```
  with:
  ```js
  process.env.NODE_ENV = 'test'; // non-Secure cookies so local-http tests can read/replay them
  ```
- **Lines 20-28** — rewrite the two-backend comment + keep `resetAllPlayers()` (now unconditional; the
  suite always runs on Postgres):
  ```js
  // The suite runs against Postgres (the only backend). `pretest` drops+recreates spacegame_test for a
  // clean schema; a direct `node --test` skips that, so wipe the player-scoped tables here for clean
  // data too (the seeded catalog is kept). See package.json `pretest` + the Postgres CI job.
  const { resetAllPlayers } = await import('./datastore.js');
  await resetAllPlayers();
  ```
  (Drop the `if (process.env.DATABASE_URL) { … }` guard — it's always Postgres now.)
- **Lines 32-37** — the `after()` currently closes the server and `fs.rmSync`es the SQLite files.
  Simplify to just close the server:
  ```js
  after(() => { server.close(); });
  ```
- **~Lines 803-815** — the "orphaned enemy pruned on re-seed" test. Collapse the `backend === 'sqlite'`
  branch. Replace the `if (backend === 'sqlite') { … } else { … }` block with just the Postgres path:
  ```js
  const { pool } = await import('./db.js');
  await pool.query("INSERT INTO ships (name, type, stats, components) VALUES ($1, 'enemy', '{}'::jsonb, '{}'::jsonb) ON CONFLICT (name) DO NOTHING", [STALE]);
  ```
  and drop the now-unused `backend` from that test's `const { backend, migrate } = await import('./datastore.js');`
  → `const { migrate } = await import('./datastore.js');`.
- **Line ~160** — inline comment "SQLite accepts the boolean, so this only fails under the Postgres test
  pass." → drop the SQLite aside, e.g. "Postgres rejects a boolean in an INTEGER column, so a mis-typed
  reset would surface here." (keep the assertion unchanged.)
- **Line ~349** — comment "…survives the JSON-blob round-trip (seedCatalog → fetch) on SQLite + Postgres"
  → "…survives the JSON-blob round-trip (seedCatalog → fetch)". (Drop the backend list; assertion stays.)

### 6. `package.json` scripts

Edit `server/package.json` lines 7-12. Replace the whole `"scripts"` block:
```json
  "scripts": {
    "start": "node --disable-warning=ExperimentalWarning src/server.js",
    "migrate": "node --disable-warning=ExperimentalWarning -e \"import('./src/datastore.js').then(m=>m.migrate())\"",
    "test": "node --disable-warning=ExperimentalWarning --test",
    "test:pg": "DATABASE_URL=\"${DATABASE_URL:-postgres://localhost:5432/spacegame_test}\" node --disable-warning=ExperimentalWarning --test"
  },
```
with (node:sqlite gone → the ExperimentalWarning flags are no longer needed; `pretest` gives a clean
schema; `test` now targets Postgres by default):
```json
  "scripts": {
    "start": "node src/server.js",
    "migrate": "node -e \"import('./src/datastore.js').then(m=>m.migrate())\"",
    "pretest": "dropdb --if-exists spacegame_test && createdb spacegame_test",
    "test": "DATABASE_URL=\"${DATABASE_URL:-postgres://localhost:5432/spacegame_test}\" node --test"
  },
```
Notes for the implementer:
- `npm test` runs `pretest` automatically (npm lifecycle), so the DB is recreated fresh each run.
- In CI, `DATABASE_URL` is set by the job env (step 8) → the `${DATABASE_URL:-…}` default is only used
  for local dev.
- `dropdb`/`createdb` connect to the maintenance `postgres` DB, so an open pool from a prior run isn't a
  problem (`pretest` runs before the test process opens its pool).

### 7. `Dockerfile` — drop the inert flag

`Dockerfile:24`, replace:
```dockerfile
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
```
with:
```dockerfile
CMD ["node", "src/server.js"]
```
(Verify no other `--disable-warning` occurrences remain in the Dockerfile.)

### 8. `.github/workflows/ci-cd.yml` — one Postgres test job

The current `test` job runs the server suite **twice** (SQLite `npm test`, then Postgres with
`DATABASE_URL`). Collapse to a single Postgres pass. The `postgres:16` service block, checkout, and node
setup stay. Edit **only the `test` job**; leave the entire `deploy` job (lines 41-141) untouched.

Replace the service comment + the two server-test steps. Current (lines 9-39):
```yaml
  test:
    runs-on: ubuntu-latest
    # A throwaway Postgres so the server suite runs against BOTH backends. The same tests run twice:
    # once on SQLite (loose typing) and once on Postgres (strict). Postgres-only regressions — e.g. a
    # JS boolean written to an INTEGER column, which SQLite silently accepts but Postgres rejects with
    # a 500 — only surface in the Postgres pass. The container is fresh each run → clean slate.
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: spacegame_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '23'
      - name: Client logic tests
        run: cd client && node --test
      - name: Install server deps
        run: cd server && npm ci
      - name: Server API tests (SQLite)
        run: cd server && npm test
      - name: Server API tests (Postgres)
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/spacegame_test
        run: cd server && npm test
```
Replace with:
```yaml
  test:
    runs-on: ubuntu-latest
    # A throwaway Postgres service — the only storage engine. `pretest` drops+recreates spacegame_test
    # each run for a clean schema; the container is fresh anyway. Runs the full server API suite.
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: spacegame_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '23'
      - name: Client logic tests
        run: cd client && node --test
      - name: Install server deps
        run: cd server && npm ci
      - name: Server API tests (Postgres)
        env:
          # pretest (dropdb/createdb) + the pg pool both read these; PGPASSWORD lets dropdb authenticate.
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/spacegame_test
          PGHOST: localhost
          PGUSER: postgres
          PGPASSWORD: postgres
          PGDATABASE: spacegame_test
        run: cd server && npm test
```
Why the extra `PG*` env: `pretest` calls the `dropdb`/`createdb` binaries, which authenticate via libpq
env vars (not the `DATABASE_URL` the app pool uses). Without `PGHOST/PGUSER/PGPASSWORD` they'd try a
local peer/socket connection and fail against the service container. (Locally the maintainer's `dropdb`
connects as the superuser role `kbagaiev` over the default socket, so no env is needed.)

### 9. `reset.js` + the reset-progress skill → Postgres

- `server/src/reset.js` header comment (lines 1-8): replace the "SQLite locally … PostgreSQL when
  DATABASE_URL is set" framing with Postgres-only wording:
  ```js
  // CLI: reset player progress. Talks to PostgreSQL via datastore.js (DATABASE_URL, or a local
  // Postgres default). The schema is migrated first so it works against a fresh database too.
  ```
  Line 37's `process.exit(0); // close the (Postgres) pool …` comment can drop the "SQLite handle" aside:
  `process.exit(0); // close the Postgres pool and exit cleanly`.
- `.claude/skills/reset-progress/SKILL.md`: rewrite the description + body to remove all SQLite framing.
  Specifically:
  - **Frontmatter `description`**: drop "Targets local SQLite by default; production Postgres only if
    DATABASE_URL is set." → "Targets the local Postgres by default; production only if DATABASE_URL is set."
  - **Body** (lines 8-10): "SQLite locally (`server/data/game.db`), PostgreSQL when `DATABASE_URL` is
    set" → "the local Postgres (`postgres://localhost:5432/spacegame`) by default, or the DB in
    `DATABASE_URL`".
  - **How to run** (lines 27, 31): drop `--disable-warning=ExperimentalWarning`
    (`cd server && node src/reset.js --player <PLAYER_ID>`).
  - **Safety** (lines 37-40): "By default this hits the **local SQLite** db … look it up in the local db
    (`players` table in `server/data/game.db`)" → "By default this hits the **local Postgres**
    (`spacegame`). It only touches **production** if `DATABASE_URL` is set … look it up in the local db
    (`psql spacegame -c 'SELECT id FROM players'`)."

### 10. Remaining source-comment / config cleanup (grouped, mechanical)

- `server/src/catalog_seed.js:4` — "(see db.js / db_postgres.js)" → "(see db.js)".
- `server/src/server.js:2` — file header "Storage is SQLite (see db.js)." → "Storage is PostgreSQL
  (see db.js).".
- `server/src/server.js:257` — the comment explains a past Postgres auth-session race and adds a
  SQLite/Postgres parity aside. Trim the parity clause; keep the reason the `await` is there (the
  historical note stays accurate without the SQLite comparison).
- `server/src/auth.js:87` — "backend-agnostic (datastore picks SQLite/Postgres)." → "backend-agnostic
  via the datastore façade." (`getSessionPlayer` is still injected; only the SQLite mention goes.)
- `.gitignore:4` — comment "# Server data (SQLite db)" → "# Server data (legacy local dir; unused now
  that storage is Postgres)". (The `server/data/` ignore line can stay — harmless.)
- `client/src/format.js:20` — "(db.js / db_postgres.js)" → "(db.js)".
- `.claude/skills/update-ship-model/SKILL.md:16` — "`db.js` / `db_postgres.js`, ships keyed by **name**"
  → "`db.js`, ships keyed by **name**".

(The `--disable-warning=ExperimentalWarning` flag removals and the "throwaway SQLite" comment fixes in the
bench/visual runners + skills are handled together in step 12; the pipeline-agent rewrites in step 13.)

### 11. READMEs — root project doc + `server/README.md`

**Root `README.md:4-5`** — the overview line currently reads:
```
Built on **Three.js** (frontend) with a **Node.js + Express + SQLite** backend
(anonymous player auto-registration and game history; multiplayer is planned).
```
Replace "Node.js + Express + SQLite" with "Node.js + Express + PostgreSQL".

**`server/README.md`** — three edits (this doc still describes deleted files: `server/data/game.db`,
`migrate.js`, `PRAGMA user_version`, `src/migrations/NNN_name.js`):
- **Lines 4-5** (intro) — "Storage is SQLite via the built-in `node:sqlite` module (no native
  dependencies)." → "Storage is **PostgreSQL** (via the `pg` driver); it connects via `DATABASE_URL`, or a
  local `postgres://localhost:5432/spacegame` default for zero-config dev."
- **The entire "## Storage & migrations" section (~lines 33-46)** — replace the SQLite-file + versioned-
  runner description with the Postgres story (mirror the SUMMARY rewrite):
  ```markdown
  ## Storage & migrations

  PostgreSQL. In production `DATABASE_URL` points at the shared Postgres; locally it defaults to
  `postgres://localhost:5432/spacegame` (create it once with `createdb spacegame`). No file to
  provision — just a reachable Postgres.

  The schema is an **idempotent bootstrap** in `src/db.js` `migrate()`: `CREATE TABLE IF NOT EXISTS`
  + guarded `ALTER TABLE … ADD COLUMN IF NOT EXISTS` and `DO $$ … $$` one-shots, then an upsert of the
  catalog from `catalog_seed.js`. One-off data backfills are recorded in a `migrations_pg
  (name, applied_at)` ledger so they run at most once. This is the single, forward-only migration story
  (DECISIONS §9).

  - `migrate()` runs automatically on server startup (`createApp()` awaits it).
  - Run it standalone (e.g. before starting): `npm run migrate`.
  - Evolve the schema by editing `migrate()` (idempotent statements only — it runs on every boot).
  ```
  (Keep the "Tables (after `001_init`)" list if you like as a quick reference, but drop the `001_init`
  framing — there are no numbered migration files anymore; simplest is to remove that sub-list since the
  authoritative schema is `catalog_seed.js` + `db.js migrate()`.)
- **The "## Layout" bullets (~lines 53-56)** — replace:
  ```
  - `src/db.js` — opens the SQLite database and exposes queries.
  - `src/migrate.js` — migration runner (also runnable via `npm run migrate`).
  - `src/migrations/` — ordered migration files (`001_init.js`, ...).
  ```
  with the single line:
  ```
  - `src/db.js` — the PostgreSQL data layer (schema bootstrap in `migrate()` + all queries).
  ```
  and leave the `src/server.js` bullet, trimming its "runs migrations on startup" tail to "runs
  `migrate()` on startup" (cosmetic).

### 12. Dev-tool runners — point the isolated server at the throwaway test DB (not the real local DB)

In each of the three runners, the spawn passes `DB_PATH` (now a no-op) so the isolated server would fall
back to the real `postgres://localhost:5432/spacegame`. Point them at `spacegame_test` instead, remove the
now-dead `dbPath` line, and fix the stale flag + comments. These are **local-only** dev tools (CI does not
run them); they now require a reachable local Postgres.

**Caveat (document near the runner, e.g. `visual/README.md`):** the spawned server's `migrate()` runs
`CREATE TABLE IF NOT EXISTS`, not `CREATE DATABASE` — so `spacegame_test` must already exist. Running
`cd server && npm test` once (its `pretest` creates it) or `createdb spacegame_test` is a one-time
prerequisite before using these tools.

- **`client/visual/run.mjs`** — at ~line 60-64, delete `const dbPath = path.join(os.tmpdir(), …)` and
  change the spawn env from `DB_PATH: dbPath` to
  `DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost:5432/spacegame_test'`. **Also delete
  line ~123** in the `finally` block — `await rm(dbPath, { force: true }).catch(() => {});` — which still
  references `dbPath`; leaving it throws a `ReferenceError` in `finally` (breaks `npm run test:visual`).
  There's no throwaway file to clean up now (the `spacegame_test` DB is intentionally persistent). If `rm`
  is then unused, drop its import too. (`bench/run.mjs` and `gen-backdrop.mjs` have **no** such cleanup
  line — this deletion applies only to `visual/run.mjs`.) Update the
  header comment `:4` ("throwaway SQLite DB") and the inline `:59` comment to say "throwaway Postgres DB
  (`spacegame_test`) so real data is untouched". In all three runners `os` is used **only** for the
  removed `dbPath` line — so also **drop the `import os from 'node:os'`** (verified: `path` is still used
  for dir/asset paths and stays; `os` becomes unused). Same for `server.test.js` in step 5 (its `os`,
  `path`, and `fs` imports served only the SQLite temp file — remove all three).
- **`client/bench/run.mjs`** — same at ~line 117-119: delete the `dbPath` line, swap `DB_PATH: dbPath` →
  the `DATABASE_URL` default above, drop the `--disable-warning=ExperimentalWarning` spawn arg (`:118`),
  and fix the header comment `:5` ("throwaway SQLite" → "throwaway Postgres `spacegame_test`").
- **`client/bench/gen-backdrop.mjs`** — same at ~line 76-78: delete the `dbPath` line, swap the env, drop
  the flag arg (`:77`), fix the header comment `:7`.
- **`client/visual/README.md:32`** — "throwaway SQLite DB (your real `game.db` is untouched)" →
  "throwaway Postgres DB `spacegame_test` (your real `spacegame` DB is untouched)".
- **`.claude/skills/run-local/SKILL.md`** — drop the flag at `:45`; fix the prose at `:68` ("SQLite
  backend." → "Postgres backend.").
- **`.claude/skills/{update-ship-model:100, record-backdrop-clip:31, record-playback:29}`** — drop the
  `--disable-warning=ExperimentalWarning` flag (server-start commands).

### 13. Pipeline agent + skill instructions — single-backend wording

The parity/dual-backend guidance in the pipeline agents is now wrong. Reword (keep each file's tone):
- `.claude/agents/feature-implementer.md:23-24` — "Server tests must pass on **both** SQLite and
  Postgres — keep `server/src/db.js` and `server/src/db_postgres.js` in sync." → "Server tests run against
  Postgres (`npm test` drops+recreates a local `spacegame_test`); the data layer is the single
  `server/src/db.js` (PostgreSQL)."
- `.claude/agents/feature-planner.md:47` — "remember server tests run on **both** SQLite and Postgres —
  keep `db.js` and `db_postgres.js` in sync)." → "server tests run against Postgres (`npm test`
  drops+recreates a local `spacegame_test`); the single data layer is `db.js`)."
- `.claude/agents/code-reviewer.md:29` — "the **full suite passes** (client + server, server on both
  SQLite and Postgres). Blocking if not." → "the **full suite passes** (client + server; `npm test` runs
  the server suite on Postgres). Blocking if not." And **`:35`** — "…broken edge cases, or SQLite/Postgres
  parity gaps." → "…broken edge cases." (drop the parity clause; the parity risk no longer exists).
- `.claude/agents/plan-critic.md:30` — "(Server = both SQLite + Postgres.)" → "(Server = Postgres.)".
- `.claude/skills/reset-progress/SKILL.md` — full Postgres-only rewrite (step 9).
- `.claude/skills/update-ship-model/SKILL.md:16` — "`db.js` / `db_postgres.js`" → "`db.js`" (step 10).

### 14. Retire the obsolete memory note (orchestrator handles — flag only)

The `backend-parity-sqlite-postgres` memory note (keep `db.js`/`db_postgres.js` in sync; tests are
SQLite-only) is now false — one backend, suite runs on Postgres. The orchestrator retires/replaces it; no
implementer action beyond this flag (repeated in the Docs section).

---

## Tests

No new test files — this is a refactor and the **existing server API suite is the guard**. It already
covers register / progress / record-game / stash / auth / admin against the Postgres path; the change
just makes that path the only one and gives it a clean DB.

**How to verify (run from the worktree):**

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-07-12-1826-backend-postgres-only/server
npm test        # pretest drops+recreates spacegame_test, then the full suite runs on Postgres
```
Expected: the suite is green (86/86 today on a freshly recreated Postgres DB). `pretest` must succeed —
if `dropdb`/`createdb` aren't on PATH or Postgres isn't running, that's an environment problem, not a
code failure (local: `brew services list` should show `postgresql@16` started).

Client tests are unaffected:
```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-07-12-1826-backend-postgres-only/client && node --test
```

**Zero-config local runtime checks (behavioral parity, no `DATABASE_URL`):**
```bash
cd server
node -e "import('./src/datastore.js').then(m=>m.migrate()).then(()=>console.log('migrate ok'))"  # → creates/updates schema in local `spacegame`
PORT=4000 node src/server.js &   # boots against localhost:5432/spacegame; GET /api/health → {"backend":"postgres",...}
node src/reset.js                # prints usage; --player/--all target local Postgres
```
(These assume a local `spacegame` DB exists: `createdb spacegame` once if not. Behavior is otherwise
identical to before — same catalog, same endpoints.)

**Grep gate (must be clean after the change).** Target the active code/config/doc surfaces directly and
**exclude `docs/`** — SUMMARY, CHANGELOG, and DECISIONS §67 intentionally keep explanatory "SQLite"
references (they document the removal), and `docs/plans/*` + `docs/pipeline-runs.jsonl` are historical:
```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-07-12-1826-backend-postgres-only
grep -rn -E "db_postgres|node:sqlite|DatabaseSync|test:pg|DB_PATH|\bsqlite\b|\bSQLite\b|PRAGMA user_version" \
  --exclude-dir=node_modules --exclude-dir=.git \
  server client .github .claude Dockerfile .gitignore README.md
```
Should return **nothing**. Every active surface — `server/` (incl. the renamed `db.js` and both READMEs),
`client/` (bench/visual runners + READMEs + `format.js`), `.github/workflows/ci-cd.yml`, `.claude/agents`
+ `.claude/skills`, `Dockerfile`, `.gitignore`, root `README.md` — must be free of the deleted backend.
A hit is a dangling reference to fix. (This broadened matcher — plain `SQLite` + `PRAGMA user_version`, not
just the code symbols — is what caught the READMEs, agent rubrics, and the dev-tool `DB_PATH` isolation
regression that the first pass missed.)

---

## Docs to update

### `docs/SUMMARY.md` (bump `**Updated:**` to 2026-07-12)
- **Backend section, ~lines 1380-1382** — the "Storage is pluggable" bullet. Rewrite:
  > **Storage is PostgreSQL** (`db.js`, via `pg`), exposed through the `datastore.js` façade (one async
  > API). Connects via `DATABASE_URL`; defaults to `postgres://localhost:5432/spacegame` for zero-config
  > local dev/test. (SQLite was dropped 2026-07-12 — see DECISIONS §67.)
- **Schema subsection, ~lines 1633-1634** — replace "SQLite uses a versioned migration runner
  (`migrate.js`, `PRAGMA user_version`); Postgres uses idempotent `CREATE TABLE IF NOT EXISTS`
  bootstrap (versioned PG migrations: TODO)." with:
  > **Schema** is an idempotent `CREATE TABLE IF NOT EXISTS` + guarded `ALTER`/one-shot bootstrap in
  > `db.js migrate()`, plus a `migrations_pg (name, applied_at)` ledger for one-off data backfills — the
  > single forward-only migration story (DECISIONS §9). Runs on every boot (`createApp()` awaits it).
- **Reset subsection, ~lines 1648-1654** — drop the per-backend "both implemented in `db.js`/`db_postgres.js`"
  and "SQLite `DELETE`s + `sqlite_sequence` reset; Postgres `TRUNCATE`" split; describe only the Postgres
  path (`resetPlayer` / `resetAllPlayers` in `db.js`; `--all --yes` `TRUNCATE … RESTART IDENTITY CASCADE`).
  Drop "Backend is auto-selected by `DATABASE_URL` (local SQLite unless …)".
- **Deployment / test subsection, ~lines 1700-1711** — replace "The `test` CI job runs it twice — once
  on SQLite (`npm test`) and once against a throwaway `postgres:16` service container … so Postgres-only
  regressions that SQLite's loose typing hides get caught" with a single-Postgres description: the CI
  `test` job runs the suite once against a `postgres:16` service container; `npm test` locally
  drops+recreates `spacegame_test` via `pretest`. Remove the "`createdb spacegame_test` once first" note
  (pretest handles it).
- **Tests section, ~lines 1809, 1816, 1821** — drop the `npm run test:pg` mentions; "temp SQLite DB
  (`DB_PATH` env …)" → "a `spacegame_test` Postgres DB recreated by `pretest`"; drop "`db.js` honors
  `DB_PATH`".
- **~line 1850** (repo layout one-liner) — "Node.js/Express backend + SQLite" → "Node.js/Express backend
  + PostgreSQL".

### `docs/DECISIONS.md` — new entry §67 (insert before "## Future ideas" at line ~2346)
```
## 67. Backend is Postgres-only — the SQLite layer was dropped to kill dual-implementation drift

The data layer was written twice by hand — `db.js` (SQLite via `node:sqlite`) and `db_postgres.js`
(Postgres via `pg`) — selected at runtime by `datastore.js` on `DATABASE_URL`. Every schema/query change
had to land in **both** files, and the test suite only ran the SQLite copy for free, so Postgres-only
bugs (a JS boolean into an INTEGER column; a missing transaction) repeatedly slipped through until a
separate `test:pg` pass. That parity tax is the documented recurring risk (was the
`backend-parity-sqlite-postgres` memory note).

**Decision:** Postgres is the single storage engine. Deleted `db.js` (SQLite), `migrate.js`, and
`migrations/001…023`; renamed `db_postgres.js → db.js`; `datastore.js` is now a static façade over it.
The idempotent bootstrap + `migrations_pg` one-shot ledger is the single forward-only migration story.

**What replaced SQLite's one real benefit — zero local setup:** the test suite drops+recreates a local
`spacegame_test` DB in a `pretest` step (matching CI's throwaway `postgres:16` container), and the pool
defaults to `postgres://localhost:5432/spacegame` so `npm start`/`reset.js` still work with no env. This
is cheap now that Postgres runs locally (Homebrew `postgresql@16`, same major as prod/CI).

**No runtime change:** prod already ran Postgres; forward-only migrations (§9) mean the prod schema is
untouched. Cross-ref §30 (keep it simple — one backend, not two).
```

### `docs/CHANGELOG.md` — add under a `## 2026-07-12` heading (create it at the top)
```
- **Backend is Postgres-only — SQLite dropped (maintainability, no behavior change).** Deleted the
  hand-maintained SQLite data layer (`db.js`, 678 lines), the `migrate.js` runner, and
  `migrations/001…023`; renamed `db_postgres.js → db.js` (the single data layer); `datastore.js` is now
  a static façade with `backend = 'postgres'`. The pool defaults to `postgres://localhost:5432/spacegame`
  so `npm start`/`reset.js` work with zero env; prod/CI set `DATABASE_URL`. `npm test` now targets
  Postgres and a `pretest` drops+recreates `spacegame_test` for a clean schema (folds in the old
  `test:pg`); CI runs one Postgres job (the second, SQLite, job removed). Removed the now-inert
  `--disable-warning=ExperimentalWarning` flags (node:sqlite was their only trigger) from
  package.json/Dockerfile/bench/visual/skills. reset-progress skill + README rewritten Postgres-only.
  Deleted `backfill-grab.test.js` (SQLite-only unit test of migration 019; the PG backfill stays
  idempotent in `db.js migrate()`). See DECISIONS §67.
```

### Memory note (orchestrator handles — flag only)
The `backend-parity-sqlite-postgres` memory note (keep `db.js`/`db_postgres.js` in sync; tests are
SQLite-only) is now **obsolete** — there is one backend and the suite runs on Postgres. The orchestrator
should retire/replace it; no action for the implementer beyond this flag.

---

## Out of scope / non-goals

- **No runtime behavior change.** Do not "improve" any query, schema, index, or endpoint while renaming.
  The Postgres path must behave exactly as it does today; this is a delete-and-rename refactor.
- **No prod migration / data change.** Prod already runs Postgres; forward-only migrations (§9) mean the
  deploy touches nothing schema-wise. Do not add a migration.
- **Do not edit historical `docs/plans/*.md` briefs** or past `docs/CHANGELOG.md` / `docs/DECISIONS.md`
  entries — they are point-in-time history. Only the living `SUMMARY.md`, a new CHANGELOG bullet, and the
  new DECISIONS §67 change.
- **Do not collapse `datastore.js`** into direct `db.js` imports across consumers (Q2 kept the façade to
  avoid churn in `server.js`/`reset.js`/tests for no gain — §30).
- **No connection pooling / config / ORM changes**, no `.env` file scheme, no Docker Postgres for local
  dev (the maintainer uses brew `postgresql@16`).
- **Do not port `backfill-grab.test.js`** to Postgres — the backfill is a historical one-shot, already
  applied in prod and idempotently guarded (Q4).

## Risk / rollback

Low risk. Prod is **unaffected at runtime** — it already runs Postgres (`db_postgres.js`), which this
change only renames; forward-only migrations (DECISIONS §9) mean no schema change on deploy. The one real
failure mode is a **dangling SQLite reference** (an import of the deleted `db.js`/`migrations`, or a stray
`node:sqlite`) breaking boot or a test — the **consumer grep sweep** (steps' grep gate) is the mitigation:
after the change, the gate grep must be clean outside historical docs. Rollback is a git revert of the
branch (no data migration to undo). CI is the backstop: the single Postgres `test` job must go green
before the `deploy` job (untouched) runs.
