# Ship ids in the seed + one catalog builder (duplication audit B3, C8)

**Date:** 2026-10-24. **Run:** `2026-10-24-1926-ship-ids-catalog-builder` (Phase 2 of
[`2026-10-24-duplication-audit-closeout.md`](2026-10-24-duplication-audit-closeout.md)). Evidence:
[`2026-10-20-duplication-audit.md`](2026-10-20-duplication-audit.md) §B3, §C8.
**Risk: prod data.** A startup migration renumbers `ships` rows on every database whose ids differ from the seed.

## Goal

The server builds ships from the seed `SHIPS` array, and those rows have **no `id`**. The database gives each
ship a sequence id because the upsert is keyed by name (`server/src/db.js:396-401`, `ON CONFLICT (name)`). So
`buildShip` (`server/src/sim-host.js:67-72`), which matches `s.id === shipId`, never matches. Every server-side
build (netsim room, `sim-replay.mjs`, both verifiers) falls back to the first player ship. That is harmless
with one flyable hull and wrong the day a second one ships. On top of that, each database numbers ships
differently: prod uses 1/132/141/368…2329, local `spacegame` uses 1..9 + 1337, and a fresh `spacegame_test`
uses 1..10.

This change does three things:
1. Gives every seed ship a **fixed id equal to prod's**.
2. Upserts ships by id, and **reconciles** any database that disagrees once per boot (a no-op when nothing
   disagrees).
3. Replaces the two hand-written catalog flatteners (`client/src/main.js:2240-2243`, `server/src/sim-host.js:36-44`)
   with **one `catalogFromRows`** in `client/src/sim-core/catalog.js`, and replaces the two weapon/component
   row mappers in `db.js` with one per table, so stash rows carry `rarity`/`color`/model URLs like catalog rows.

Players will not notice anything. Prod's ids already equal the seed, so the prod migration is a no-op. Player
ship id 1 is the same everywhere, so recorded traces and live rooms behave exactly as before.

## Facts this plan rests on (verified, read-only, before planning)

**Ship ids per database** (the orchestrator read them; prod via the VPS, read-only):

| name | seed line | **prod id (= new seed id)** | local `spacegame` | fresh `spacegame_test` |
|---|---|---|---|---|
| Basic player ship | `catalog_seed.js:461` | **1** | 1 | 1 |
| Basic pirate ship | `:476` | **368** | 2 | 2 |
| basic rocket pirate | `:486` | **369** | 3 | 3 |
| pirate gunner | `:499` | **132** | 4 | 4 |
| pirate mini boss | `:517` | **371** | 5 | 5 |
| first pirate boss | `:533` | **372** | 6 | 6 |
| advanced medium pirate | `:551` | **141** | 7 | 7 |
| second pirate boss | `:566` | **374** | 8 | 8 |
| advanced rocket pirate | `:584` | **375** | 9 | 9 |
| pirate lancer | `:604` | **2329** | 1337 | 10 |

Prod `ships_id_seq.last_value` = 2929. That is drift: the name-keyed upsert burned a sequence value on every
boot, the same way levels drifted (DECISIONS §102).

**Who stores or carries a ship id. The rename is safe because only id 1 is ever persisted.** Each line below
was checked in the code:
- `player_ships.ship_id` is the **only FK** into `ships` (`db.js:202`, no `ON UPDATE CASCADE`). It references
  only ship 1 in all three databases. `ensureDefaultShip` picks `type='player' ORDER BY id LIMIT 1`
  (`db.js:497`), which is 1.
- Traces (`?record`, live session recording → S3 + `gameplay_sessions`, the intro fixture, the bench trace)
  carry `shipId`. It always comes from `flownBuild` (`client/src/replay.js:181`), which reads
  `G.currentShipName`. Only player ships are ever built as the player (`client/src/ship-build.js:64`; the
  welcome screen and `main.js:2263` filter `type === 'player'`). All three pulled
  `client/assets/recordings/level0-intro.*.json` and `client/bench/traces/combat-heavy.json` contain
  `"shipId":1`. The S3 session traces were not opened; their `shipId` is inferred from the same recorder.
- `gameplay_sessions` has no ship column (`db.js:285-305`). Telemetry `events.data` carries only
  level/kills (`net.js:212`, `sim.js:390/452/795`). `stash` holds only weapon/component refs (`db.js:314-321`).
- The netsim handshake sends `active.ship.id`, i.e. `player_ships.ship_id` = 1 (`server/src/netsim/socket.js:155`).
  `beamCharge.shipId` is a runtime **network entity id**, not a DB id (`server/src/netsim/protocol.js:64`).
- Enemies are referenced **by name** everywhere: level spawn pools (`ship: '<name>'`, `catalog_seed.js:743-958`),
  missions (`server/src/missions.js:12-14`), the backdrop clip (`shipName`, `client/src/ghost-battle.js:61`),
  `preloadLevelShipModels` (`ship-build.js:145`). Nothing in `client/src/sim-core/` reads a ship row's `.id`.

**Catalog order (a side effect, decided below).** `/api/ships` returns `ORDER BY id` (`db.js:930`), so the
client's `CATALOG.enemyShips` follows id order. The server's `buildCatalog` follows the seed array's order.
Every sim and test consumer looks ships up by **name** or by a **unique `role`** (`spawnEnemy(role)`,
`ship-build.js:131`; roles are unique, `catalog_seed.js:466-626`), so order changes no fight. The only
index-based consumers are dev tools: `?bench` setup (`main.js:1662`, `:1678` → `enemyShips[0]`),
`bakeBackdrop` (`main.js:1708-1709` → `[0]`,`[1]`,`[2]`), the `?tune` formation spawner (`client/src/tune.js:158-161` →
`defs[0]`, `defs[1]`, `defs[last]`), and a role-less `spawnEnemy()` in visual scenarios 13 and 19. Their assertions do not depend on which hull spawns (19 matches `/killed \+\d+$/`).

## Decisions (chosen — do not re-ask)

1. **Seed ids = prod's ids** (table above). Prod therefore needs no data change.
2. **Reconcile runs BEFORE the ships upsert, in ONE transaction, using the park pattern** from
   `renumberLevelsZeroBased` (`db.js:64-110`). The upsert becomes `ON CONFLICT (id)`. Without the reconcile, an
   explicit `INSERT id=368 'Basic pirate ship'` against local row `2 'Basic pirate ship'` violates
   `UNIQUE(name)` and the server fails to boot.
   - **Park offset `SHIP_PARK = 1_000_000`.** It must clear both the largest seed id (2329) and prod's
     sequence (2929).
   - **Mismatched rows** come from two clauses:
     1. a row whose `name` is in the seed under a **different id** (it must move);
     2. a row at seed id X whose name ≠ `nameOf(X)` **only if another DB row currently carries `nameOf(X)`**
        (that other row must move INTO X, so the occupant has to get out of the way).

     All of them are parked, then each seed-named parked row moves to its seed id. Parked rows with **no seed
     name are left parked**. The existing enemy prune (`db.js:405-411`) then deletes them if they are enemies;
     a non-seed *player* row (none exist) stays parked and is logged, as the levels migration does.
   - **A pure rename is NOT a mismatch.** When the seed renames ship X and no other row carries the new name,
     row X keeps its id and its `player_ships` rows. The `ON CONFLICT (id) DO UPDATE SET name = …` upsert then
     renames it in place.
     - Why this matters: an unconditional clause 2 would park the renamed row and insert a fresh X beside it,
       leaving every `player_ships` row pointing at a frozen parked copy. For the player ship, that would put
       every player on stale stats.
3. **Drop and re-add `player_ships_ship_id_fkey`** around the move, and move `player_ships.ship_id` in
   lockstep, as the levels migration does with `players_current_progress_fkey`. No current database needs
   this (player ship 1 matches everywhere), but the code must be correct for one that does.
4. **Per-boot, idempotent, no `migrations_pg` entry.** The check is a cheap `SELECT`. When nothing mismatches
   it returns without opening a transaction and logs nothing. When it moves rows it logs one
   `console.warn('[migrate] ships: renumbered …')` line listing `name old→new`, plus any left-parked rows.
   - **Why not a ledger:** worktrees share one local Postgres. A main-branch server (old code, name-keyed
     upsert, sequence ids) can insert a new seed ship under a sequence id after this branch ran. A one-shot
     would never look again; a per-boot check self-heals.
5. **Sequence:** after the upsert, `SELECT setval('ships_id_seq', GREATEST((SELECT MAX(id) FROM ships), 1))`,
   like levels (`db.js:430`). On prod this moves the sequence back from 2929 to 2329. That is harmless: ids
   are explicit, and the only sequence-backed insert left is a test's stale row.
   - **Correction to the brief:** the closeout says to bump the sequence "same as the other tables do —
     grep `setval`". In fact **only `levels` calls `setval`**. `weapons`/`components` have `BIGINT PRIMARY KEY`
     with no sequence at all (`db.js:164`, `:188`). Fix that sentence in the closeout file (Docs step).
6. **Both catalogs sort ships by id.** `catalogFromRows` sorts a *copy* of `ships` by `id` before building
   `enemyShips`/`shipByName`, so the server catalog (fed the seed) matches the client's (fed `/api`, already
   id-ordered).
   - **Accepted side effect (local/test only; prod already has this order):** `enemyShips[0]` becomes
     **pirate gunner (132)** instead of Basic pirate ship, and `[1]`,`[2]` become advanced medium pirate (141)
     and Basic pirate ship (368). The `?bench` cast, a freshly baked backdrop clip, and a role-less
     `spawnEnemy()` therefore spawn different hulls locally than before.
     - Bench A/B stays comparable because both sides read the same DB at run time, but it is not comparable
       with historical bench numbers.
     - The committed backdrop clip is name-keyed and unaffected until it is re-baked.
     - State this in SUMMARY.
7. **`catalogFromRows` covers weapons/components/ships only, not `level`** (a deliberate departure from the
   closeout's sketched signature). The two hosts build the level differently by design: the client wraps it
   in the dev-flag chain (`main.js:2250`; Phase 4/B4 owns that), and the server stamps `enemyTotal`
   (`sim-host.js:46-49`). Folding `level` in would be Phase 4's job done badly here. The function fills a
   **target object in place** because the client's `CATALOG` identity is load-bearing (`world.catalog = CATALOG`,
   `client/src/state.js:140`).
8. **One row mapper per catalog table in `db.js`** (`weaponRow`, `componentRow`, `shipRow`), used by
   `getWeapons`/`getComponents`/`getShips` and by `catalogItem`. `catalogItem` returns
   `{ kind, refId, ...row }`, so it **adds** `id`, `modelUrl`, `modelUrlHigh`, `rarity`, `color` to every
   stash row, buy/sell result and equip lookup. This is additive only: the client picks named fields
   (`client/src/shop.js:41-45`). Unifying the INSERT column lists (`db.js:386`, `:392`) is out of scope (see
   Non-goals).

## Steps

Line numbers are as of `main` @ `695b907`. Re-read each anchor before editing.

### B3 — fixed ship ids

1. **`server/src/catalog_seed.js` `SHIPS` (`:460`)** — add `id: <prod id>` as the first key of each of the ten
   rows, per the table. Example:
   ```js
   {
     id: 1, name: 'Basic player ship', type: 'player',
   ```
   Add a comment above `SHIPS` stating the rule: ids are explicit and equal prod's; a new ship takes the next
   unused id above the current max (2329); never renumber an existing ship. `STARTER_SHIP` (`:638`) now has
   `.id === 1`. The `assets:*` hitbox/muzzle scripts only rewrite marker blocks inside `stats.model`, so they
   are unaffected (`scripts/assets-hitboxes.test.mjs` builds its own fixture).

2. **`server/src/db.js` — new `reconcileShipIds(SHIPS)`**, an exported async function placed next to
   `renumberLevelsZeroBased` (`:64`). Returns `{ moved: [{name, from, to}], parked: [{id, name}] }`.
   ```js
   export const SHIP_PARK = 1_000_000; // clear of every seed id (max 2329) and prod's drifted sequence (2929)
   export async function reconcileShipIds(SHIPS) {
     const idOf = new Map(SHIPS.map((s) => [s.name, s.id]));
     const nameOf = new Map(SHIPS.map((s) => [s.id, s.name]));
     const { rows } = await pool.query('SELECT id, name FROM ships');
     const all = rows.map((r) => ({ id: Number(r.id), name: r.name }));
     const names = new Set(all.map((r) => r.name));
     const bad = all.filter((r) =>
       (idOf.has(r.name) && idOf.get(r.name) !== r.id)                       // has a seed name, wrong id → moves
       || (nameOf.has(r.id) && nameOf.get(r.id) !== r.name                    // sits on seed id X under another name…
           && names.has(nameOf.get(r.id))));                                  // …AND X's real owner exists elsewhere → evict
     // A row on X whose name nobody else carries is a pure RENAME: left alone, the upsert renames it in place.
     if (!bad.length) return { moved: [], parked: [] };
     const client = await pool.connect();
     try {
       await client.query('BEGIN');
       await client.query('ALTER TABLE player_ships DROP CONSTRAINT IF EXISTS player_ships_ship_id_fkey');
       const ids = bad.map((r) => r.id);
       await client.query('UPDATE ships SET id = id + $1 WHERE id = ANY($2::bigint[])', [SHIP_PARK, ids]);
       await client.query('UPDATE player_ships SET ship_id = ship_id + $1 WHERE ship_id = ANY($2::bigint[])', [SHIP_PARK, ids]);
       const moved = [], parked = [];
       for (const r of bad) {
         const to = idOf.get(r.name);
         if (to == null) { parked.push({ id: r.id + SHIP_PARK, name: r.name }); continue; }
         await client.query('UPDATE player_ships SET ship_id = $1 WHERE ship_id = $2', [to, r.id + SHIP_PARK]);
         await client.query('UPDATE ships SET id = $1 WHERE id = $2', [to, r.id + SHIP_PARK]);
         moved.push({ name: r.name, from: r.id, to });
       }
       await client.query(`ALTER TABLE player_ships ADD CONSTRAINT player_ships_ship_id_fkey
                           FOREIGN KEY (ship_id) REFERENCES ships(id)`);
       await client.query('COMMIT');
       // one warn line: moved (name old→new) + any left parked (non-seed rows; the enemy prune removes those)
       return { moved, parked };
     } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
   }
   ```
   *(Illustrative; match the levels migration's error handling and log style.)* After parking, a seed id X
   is occupied only by:
   - the row that already carries `nameOf(X)` (not mismatched, so nothing moves into X); or
   - a pure-rename row, which clause 2 left alone *because* no row carries `nameOf(X)` (so again nothing
     moves into X).

   The move therefore cannot collide.
   - **One loud failure is possible and acceptable:** parking `id + SHIP_PARK` can hit the PK of a row left
     parked by an earlier boot (a non-seed player row). The transaction then rolls back and the boot fails
     with the PK error. That is the right outcome for a state no known DB has. Put this sentence as a code
     comment.
   - Throwing on error is right: a half-renamed table must not boot.

3. **`db.js` ships upsert (`:396-401`)**:
   - Call `await reconcileShipIds(SHIPS);` immediately before the loop.
   - Change the INSERT to include `id` and key on it:
     `INSERT INTO ships (id, name, type, stats, model_url, model_url_high, components) VALUES ($1, … $7) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = …`.
     Including `name` in the update set means a future seed rename updates the row in place, as levels does.
   - After the prune (`:411`), add
     `await pool.query("SELECT setval('ships_id_seq', GREATEST((SELECT MAX(id) FROM ships), 1))");`.
   - Update the comment at `:381-382` ("ships/maps/levels by name" → ships by id, maps by name).

4. **`client/src/sim-core/catalog.js` — `shipById(catalog, id)`** (created in step 6; listed here because B3
   uses it). It is a linear scan over `catalog.shipByName.values()` returning the row or `null`.
   - Use it in `server/src/sim-host.js:70` (`buildShip`), replacing the inline loop.
   - Use it in `client/src/main.js:1594` and `:1736`, deleting both local `shipById`/`shipByIdGlobal` helpers
     and calling `shipById(CATALOG, id)` at `:1655`, `:1706`, `:1883`.
   - Keep `buildShip`'s fallback to the first player ship. It is still needed for traces recorded before the
     fields existed.

### C8 — one catalog builder, one row mapper

5. **Pin the old behaviour FIRST** (before steps 6-8): create `client/src/sim-core/catalog.test.js` and copy
   today's `sim-host.buildCatalog` flatten logic (`sim-host.js:36-44`) **inline into the test** as
   `legacyFlatten(seed)`. After the swap, the test asserts that `catalogFromRows` over the seed equals
   `legacyFlatten` on:
   - the `weapons` Map (deepStrictEqual),
   - the `components` Map,
   - the `shipByName` Map (node compares Map entries unordered),
   - `enemyShips` **as the legacy array sorted by id** (Decision 6).

   Also assert explicitly:
   - `[...catalogFromRows(seed).enemyShips].map((s) => s.id)` is ascending.
   - **Component and ship** rows are the **same object references** as the seed rows. The sim-host comment
     at `:77-81` depends on non-cloned shared rows plus non-mutating `with*` helpers. **Weapons are fresh
     flattened objects** (stats spread to top level), so for them assert equality only, not identity.
   - `catalogFromRows` does not mutate its input `ships` array (it sorts a copy).
   - Calling it twice on the same target leaves no stale entries (clear + refill).

6. **New `client/src/sim-core/catalog.js`** (THREE-free, importable from Node):
   ```js
   // One flattening of /api (browser) or seed (server) rows into the catalog shape the sim reads.
   export function emptyCatalog() { return { weapons: new Map(), components: new Map(), enemyShips: [], shipByName: new Map(), level: null, levelName: null }; }
   export function catalogFromRows({ weapons, components, ships }, target = emptyCatalog()) {
     target.weapons.clear(); target.components.clear(); target.shipByName.clear();
     for (const w of weapons) target.weapons.set(w.id, { id: w.id, name: w.name, type: w.type, price: w.price,
       modelUrl: w.modelUrl, modelUrlHigh: w.modelUrlHigh, rarity: w.rarity, color: w.color, ...w.stats });
     for (const c of components) target.components.set(c.id, c);
     const byId = [...ships].sort((a, b) => a.id - b.id);
     target.enemyShips = byId.filter((s) => s.type === 'enemy');
     for (const s of byId) target.shipByName.set(s.name, s);
     return target;
   }
   export function shipById(catalog, id) { for (const s of catalog.shipByName.values()) if (s.id === id) return s; return null; }
   ```
   Move the weapon-flatten comment from `main.js:2237-2239` here.

7. **`server/src/sim-host.js` `buildCatalog` (`:34-52`)**:
   `const catalog = catalogFromRows({ weapons: WEAPONS, components: COMPONENTS, ships: SHIPS });`, then keep
   the level lookup + `enemyTotal` stamp as is. Import from `'../../client/src/sim-core/catalog.js'`.

8. **`client/src/main.js` bootstrap (`:2240-2243`)**: replace the four lines with
   `catalogFromRows({ weapons, components, ships }, CATALOG);`. `CATALOG` is filled in place (Decision 7).
   `account.js:283` and `net.js:273` only reassign `CATALOG.level`; leave them.

9. **`server/src/db.js` mappers (`:929-941`, `:1002-1014`)**: extract
   `const weaponRow = (r) => ({ id: Number(r.id), name, type, price, stats, modelUrl: r.model_url, modelUrlHigh: r.model_url_high, rarity, color })`,
   `componentRow` (adds `weight`) and `shipRow`, plus one SELECT column-list constant per table, e.g.
   `const WEAPON_COLS = 'id, name, type, price, stats, model_url, model_url_high, rarity, color'`.
   - `getWeapons`/`getComponents`/`getShips` become `rows.map(weaponRow)` etc.
   - `catalogItem` selects the same columns (`WHERE id = $1`) and returns
     `r ? { kind, refId: Number(r.id), ...weaponRow(r) } : null` (component analogue).
   - Check every `catalogItem` caller (`:1063`, `:1069`, `:1096`, `:1119`, `:1127`, `:1137`) still reads only
     fields that exist. All of them read `price`/`stats`/`type`/`name`, which are unchanged.

## Tests

Server tests run against Postgres (`cd server && npm test` drops and recreates `spacegame_test`). Client:
`cd client && node --test src/sim-core` (or the whole `node --test`).

- **New `server/src/ships_drift.test.js`** — the migration guard, reproducing a mis-numbered DB **state**.
  Copy the isolated-DB scaffold of `server/src/levels_drift.test.js:20-40` with its own database
  `spacegame_test_ships`. That database is mandatory: the test renumbers `ships`, and doing that inside the
  shared `spacegame_test` would race parallel test files and the visual runner. Then:
  - `await db.migrate()` (fresh, correct ids).
  - `rewindToLocalShape()`:
    1. Drop the FK.
    2. Park all ships (`id + 900000`, `name 'tmp-'||name`).
    3. Reassign **local-style ids in seed order: player → 1, the nine enemies → 2..10** with their real names.
    4. Insert a **stale enemy row `'zzz stale (test)'` at id 368** (a seed target id).
    5. Insert a player (`registerPlayer` or a raw `players` row) plus a `player_ships` row on ship 1.
    6. Re-add the FK and `setval('ships_id_seq', 1000)`.
  - **Test (a) local shape:** `await db.migrate()`, then assert:
    - every seed name's DB id === its seed id;
    - `'zzz stale (test)'` is gone (pruned);
    - the `player_ships` row still joins to `'Basic player ship'` with `ship_id = 1`;
    - `player_ships_ship_id_fkey` exists (`SELECT 1 FROM pg_constraint WHERE conname = …`);
    - `ships_id_seq` last_value ≥ 2329;
    - no row has `id >= SHIP_PARK`.
  - **Test (b) FK path:** rewind again, but put **'Basic player ship' at id 50** with the `player_ships` row
    pointing at 50. After `migrate()`, assert the row now has `ship_id = 1` and still joins to the player
    ship. This exercises the lockstep move that no real DB needs today.
  - **Test (c) idempotent:** a second `reconcileShipIds(SHIPS)` returns `{ moved: [], parked: [] }`, and a
    second `migrate()` changes no id. Also `setval('ships_id_seq', 2929)` (prod's drifted value) before that
    second `migrate()`, and assert the sequence drops to 2329 with the `(id, name)` list unchanged.
  - **Test (d) pure rename keeps the row:**
    - Player case: `UPDATE ships SET name = 'old player hull name' WHERE id = 1`, with a `player_ships` row on
      ship 1. After `migrate()`, assert:
      - the `reconcileShipIds(SHIPS)` return value (capture it by calling it directly before `migrate()`, or
        spy on it) is `{ moved: [], parked: [] }`;
      - ship 1's name is back to `'Basic player ship'`;
      - the `player_ships` row still has `ship_id = 1`;
      - no row has `id >= SHIP_PARK`;
      - `'old player hull name'` no longer exists.
    - Repeat for an enemy: rename id 368 to `'old pirate name'`. After `migrate()`, 368 is
      `'Basic pirate ship'` again, nothing is parked, and the enemy prune did not delete the row (same id).
    - This fails under an unconditional clause 2: the renamed row would be parked and `player_ships` stranded
      on it.
  - **Negative-test:** run the file once with step 3's upsert/reconcile reverted (old `ON CONFLICT (name)`).
    Test (a) must fail on the id assertion: ids stay 2..10, or the server crashes on the unique name. Record
    the observed failure in the run notes.
- **New `server/src/sim-host.test.js`** (B3 guard):
  - Every `buildCatalog().shipByName` row has an integer `id`, ids are unique, and each equals the
    `SHIPS` entry's id. This fails on old code (`id` undefined).
  - Construct a catalog via `catalogFromRows` from the seed plus one extra **player** row
    `{ ...STARTER_SHIP, id: 0, name: 'test hull', modelUrl: 'test.glb' }`. Its lower id sorts it **before**
    the starter, so it is what the fallback would pick. Assert
    `buildShip(cat, { shipId: STARTER_SHIP.id }).modelUrl === STARTER_SHIP.modelUrl` and
    `buildShip(cat, { shipId: 0 }).modelUrl === 'test.glb'`. With the match broken, the first assertion
    would return `test.glb`.
  - `buildShip(cat, { shipId: 99999 })` falls back to the first player ship (unchanged behaviour).
- **`client/src/sim-core/catalog.test.js`** — as in step 5.
- **Stash row carries catalog fields** — extend `server/src/server.test.js:1039`
  (`shop: unlocks on clearing the campaign…`). After `const gun = …`, assert that `gun.rarity`, `gun.color`,
  `gun.id === 1` and `'modelUrl' in gun` equal what `/api/weapons` returns for id 1
  (`deepEqual` of `{rarity, color, modelUrl, modelUrlHigh}` vs the catalog row). This fails on old code
  (fields absent).
- **Existing tests to re-check, not change:**
  - `server/src/server.test.js:1005` (stale enemy prune): the stale row now gets a sequence id ≥ 2330 and is
    neither a seed name nor a seed id, so reconcile ignores it and prune removes it. It should pass unchanged.
  - `server/src/shared-contracts.test.js:46`: `STARTER_SHIP` identity, unchanged.
  - `server/src/levels_drift.test.js`: unaffected (its own DB; ships are re-seeded by its `migrate()` calls,
    which now also reconcile, a no-op on a fresh seed).
- **Visual — pre-approved, run only this:** `cd client && node visual/run.mjs 22-trace-replay` (the catalog
  feeds the sim; the intro fixture is `shipId: 1`, so the digest must be bit-identical). Run `lsof -i :4173`
  first; one visual invocation at a time. **Do not** run the full visual suite or the perf A/B gate (opt-in,
  the maintainer's call).

### Replay / intro impact

- **No sim behaviour change.** `buildShip` now resolves `shipId: 1` by id instead of via the fallback. That is
  the same row, so the built player is identical.
- **Server enemy order changes, but nothing in the sim indexes `enemyShips`.** The re-sim spawns from pools
  by name. `ally-sim.test.js` / `reward-drop.test.js` look ships up by name, and the aim-fraction test
  (`ally-sim.test.js:697`) maps over all of them.
- The Level-0 intro is a live fight (DECISIONS §138), not a playback. `22-trace-replay` is the determinism
  guard and must stay green.
- Stage-9 live-test: on the deployed build, fly Level 0 → Level 1 briefing once. Open an admin `/admin/sessions`
  ▶ play on an older session and confirm the same ship model appears.

## Docs to update

- **CHANGELOG** (`docs/CHANGELOG.md`, under `## 2026-10-24`, on top): **Ship ids are fixed in the seed;
  one catalog builder (duplication audit B3, C8)**. Cover:
  - seed ids = prod's;
  - `ON CONFLICT (id)` + per-boot `reconcileShipIds` (park pattern, FK lockstep) + `setval`;
  - `buildShip` now really matches by id;
  - `catalogFromRows`/`shipById` in `sim-core/catalog.js` used by both hosts, ships id-sorted on both;
  - stash rows now carry `id/rarity/color/modelUrl/modelUrlHigh`;
  - **ops:** the reconcile runs at server start and is a no-op on prod (ids already match). It renumbers
    local `spacegame` (2..9, 1337 → prod ids) on first boot and logs one `[migrate] ships:` line.
- **SUMMARY** (`docs/SUMMARY.md`; bump `**Updated:**` at `:6`):
  - **Backend → Catalog tables** (`:3691`): ships now have explicit seed ids (= prod) and are upserted
    `ON CONFLICT (id)`. Describe `reconcileShipIds` next to the migrations paragraph (`:3661-3672`): per boot,
    no ledger, park + FK lockstep, unmapped enemies pruned. A seed **rename** keeps the row's id and
    `player_ships` (renamed in place by the upsert). A row is evicted from a seed id only when the ship that
    belongs there exists elsewhere. Note `setval('ships_id_seq')`.
  - **Ship model (DB-driven)** (`:890`): one line, "the catalog is flattened once by
    `client/src/sim-core/catalog.js catalogFromRows` (browser from `/api`, server `buildCatalog` from the seed);
    ships are id-ordered on both hosts."
  - **Simulation state is Three.js-free** (`:4298`): add `catalog.js` to the sim-core file list.
  - The local-only enemy-order side effect (Decision 6) in the `?bench` / backdrop-bake tool notes (`:459`
    "Every dev URL flag" area, or wherever `bakeBackdrop`/bench setup is described): `enemyShips[0]` is the
    lowest-id enemy (pirate gunner).
  - **Tests** (`:5108`): add `ships_drift.test.js`, `sim-host.test.js`, `sim-core/catalog.test.js`.
- **DECISIONS** — **§168** (check the tail; §167 is the last as of planning): "Ship ids are explicit and equal
  prod's; mismatching databases are reconciled every boot, not once". Record:
  - why prod's ids, not 1..10 (prod has the user data, so zero prod writes);
  - why per-boot over a `migrations_pg` one-shot (shared local DB + old-code servers can reintroduce drift);
  - why the "occupies a seed id" eviction is conditional: an unconditional rule turns a seed rename into
    park + insert and strands `player_ships` on a frozen parked row. With the condition, a rename is an
    in-place `ON CONFLICT (id)` update;
  - why ships are sorted by id on both hosts (identical catalogs, and the accepted dev-tool order change).
- **Audit** `docs/plans/2026-10-20-duplication-audit.md`:
  - B3 row (`:76`) and C8 row (`:87`) → `**fixed 2026-10-24** (\`<commit>\`, §168)`;
  - the same marker plus a `_Fixed by [this plan]…_` line on headings `:240` and `:345`;
  - remove B3 and C8 from "Not planned yet" (`:13`) and add a "fixed by Phase 2" bullet next to the Phase 1 one.
- **Closeout** `docs/plans/2026-10-24-duplication-audit-closeout.md`:
  - top status (`:3`) → "Phases 1–2 done";
  - add a `**Status:** done 2026-10-24 (\`<commit>\`, merge \`<merge>\`, run 2026-10-24-1926-ship-ids-catalog-builder), [plan](2026-10-24-1926-ship-ids-catalog-builder.md).`
    line under the Phase 2 heading (`:110`);
  - fix B3 step 2's "same as the other tables do" sentence (`:125-126`) to say only `levels` uses `setval`;
  - bump the "Next DECISIONS number" line (`:33`) to §169.

## Deploy

- Prod deploy via CI as usual. **Watch the CI deploy log / `docker compose logs app` at startup.** Expect **no**
  `[migrate] ships:` line (prod ids already equal the seed).
  - **If one appears, stop and report it to the maintainer.** It means prod differs from the read-only snapshot.
  - Afterwards, read back `SELECT id, name FROM ships ORDER BY id` and
    `SELECT COUNT(*), MIN(ship_id), MAX(ship_id) FROM player_ships` (expect 167 / 1 / 1, or more rows if
    players joined since), plus `SELECT last_value FROM ships_id_seq` (expect 2329).
  - **Rollback is safe.** A previous image (`ON CONFLICT (name)`, no reconcile) still works against the new
    explicit ids. Its name-keyed upsert updates the same rows in place, and its sequence-backed path only
    runs for a name the table lacks, which gets an id above 2329. Rolling back needs no data step.
- **Re-publish itch** (`/publish-itch`) after the prod deploy: `client/src/main.js` and the new
  `client/src/sim-core/catalog.js` changed, and the itch ZIP bundles client code. No asset or content hash
  changes.
- Local: the first `npm start` against `spacegame` will log the renumbering (2..9, 1337 → prod ids). That is
  expected.

## Out of scope / non-goals

- Unifying the INSERT column lists of the catalog upserts (`db.js:386`, `:392`, ships). The audit mentions it,
  but nothing reads them twice. Leave it.
- Folding `level` into `catalogFromRows`, or touching the dev-flag chain (`applyAllyDev`/… in `main.js`,
  `account.js`, `net.js`): Phase 4 (B4).
- A ship-select / second flyable hull, or any change to `buildShip`'s fallback rule.
- Renumbering anything else (weapons/components already have explicit ids).
- Re-baking the backdrop clip or re-recording the bench trace.
