# Catalog & economy guards — Phase 4 of the drift fixes (audit A2, B1, B2)

> Self-contained handoff for the implementer. This is **Phase 4** of
> `docs/plans/2026-10-20-base-menu-state-and-drift-fixes.md` (Phases 1–3 shipped — DECISIONS §162, §163).
> The findings are `docs/plans/2026-10-20-duplication-audit.md` §A2, §B1, §B2. Every `file:line` below was
> re-verified against the code on 2026-10-22, after Phases 1–3 moved things around. The phase plan's own
> anchors are stale in places, so **use this file's anchors, not the phase plan's**.
> English only. Keep it simple (DECISIONS §30).

## Goal

Three server-side things are hand-kept copies of something else, and each has drifted:

1. **A2.** The side-mission card's "Reward ≈ / XP ≈" comes from constants written before enemy rewards
   were rebalanced. It shows **~2360 credits / 1000 XP**, but a full run actually pays **~3510 / ~2750**.
   After the fix the estimate is computed from the mission's own phases and the ship catalog, so it can't
   drift again.
2. **B1.** `POST /api/players/:id/buy` sells anything in the catalog, including price-0 boss parts (which
   come free) and enemy gear the shop hides. After the fix the server refuses any row the shop wouldn't
   offer. The rule is **one predicate** imported by the shop, the rarity classifier and `buyItem`.
3. **B2.** `reset.js --all` leaves `gameplay_sessions` rows (and their S3 traces) behind for deleted
   players, and the new-player baseline is restated in four places. After the fix `--all` deletes the S3
   trace objects and then truncates the table. One constant feeds every place that writes a new player's
   starting values, and tests pin both lists.

None of this changes what a player sees in combat. The only visible change is the side-mission card's
numbers.

## Decisions (answered by the maintainer — do not re-ask)

- **D1 (A2).** `estReward` and `estXp` both come from **one** catalog-derived calculation:
  - `estReward = round10(2 × expected per-kill credits)`. Clearing a mission doubles the credits
    (`client/src/sim-core/level-runner.js:168`).
  - `estXp = round10(expected per-kill XP + MISSION_XP)`. Per-kill XP is not doubled; the one-shot bonus
    is added once (`level-runner.js:169`).
  - Today that gives **3510 / 2750**. Both assume the player lands every kill (an ally kill pays nothing,
    `step-enemies.js:163`) and ignore loot resale. That's fine: the card says "≈".
- **D2 (B1).** Refuse **both** price-0 rows and `stats.buyable === false` rows, with `403 { error: 'not for
  sale' }`. This amends DECISIONS §40.6, which only left `buyable:false` unenforced because "no UI path
  offers those" — the server must not rely on that.
- **D3 (B2, `--all`).** `--all` **truncates `gameplay_sessions` and deletes each row's S3 trace object.**
  1. Read every `s3_key` first.
  2. Delete the objects.
  3. **Truncate only if every delete succeeded.** On any failure, abort with nothing truncated, report the
     failed keys and exit 1. Re-running is safe: an S3 DELETE of a missing key returns 204.
  - **S3 not configured** (no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in the env, i.e. local dev and
    tests) is a clean no-op. Log one line ("S3 not configured — N trace object(s) not deleted"), then
    truncate as usual.
    **Amended at implementation (maintainer):** with no creds `--all` now **refuses** (nothing listed or
    truncated) unless the caller passes `skipS3: true` / `reset.js --all --no-s3`, which truncates without
    touching S3 and warns about orphans. A host-based "local DB is fine" rule was rejected: an SSH tunnel to
    prod looks like localhost. See DECISIONS §165.
  - Anonymous rows (`player_id IS NULL`) go too. `--all` wipes the whole table.
- **D4 (B2, per-player reset).** Unchanged behaviour. It keeps `sessions` (the login), `perf_samples` and
  `gameplay_sessions`; today it deletes `games, player_ships, stash, events, taken_missions,
  cleared_missions` (`server/src/db.js:514`). The keep-list becomes explicit and commented.
- **D5 (B2, defaults).** `NEW_PLAYER_DEFAULTS` is the one source for:
  - the `registerPlayer` INSERT (now writes the values explicitly instead of relying on column defaults),
  - the `registerPlayer` return,
  - the reset UPDATE,
  - the `players` DDL defaults, interpolated into the migration template literal.
  
  The DDL interpolation only takes effect on a **fresh** database. `ADD COLUMN IF NOT EXISTS … DEFAULT x`
  is a no-op on an existing one, which is exactly why the INSERT must be explicit. Prod's column defaults
  then stop mattering.
- **D6 (implementation choices made here, with reasons).**
  - **One DELETE request per key, with a small concurrency limit (8), not the batch `DeleteObjects` API.**
    Batch needs a `?delete` query string, which the hand-rolled `s3Request` canonicalises as empty
    (`server/src/s3.js:24-27`), plus a Content-MD5 header and an XML body. Per-key DELETE reuses
    `s3Request` unchanged. `--all` is a rare manual wipe, so speed doesn't matter (DECISIONS §30).
  - **Safety rail:** only delete keys matching `/^recordings\/sessions\/[^/]+\.json$/`. Any other key
    counts as a failure, so the truncate aborts. The bucket also holds the game's assets (e.g.
    the intro trace at S3 key `recordings/level0-intro.<hash>.json` — `scripts/assets-config.mjs:18`, a
    sibling of `recordings/sessions/`; `catalog_seed.js:703` references it as `assets/recordings/…`), and a
    corrupt row must never be able
    to delete one.
  - **The two collateral sell tests seed the stash through `POST /api/players/:id/loot`** instead of
    buying. That is how a Light hull really reaches a stash (looted, then resold), so their 112 / 224 / 336
    numbers stay. Only the buy test switches to a buyable row.

## Steps

### A2 — side-mission estimate from the catalog (`server/src/missions.js`)

Today:
- `server/src/missions.js:9` imports only `enemyTotalFromPhases`.
- `:37-41` hard-code `WAVE_KILLS = 14`, `WAVE_AVG` from 40/40/100 and `EST_REWARD` with a 200-per-boss
  figure.
- `:44` `MISSION_XP = 1000`.
- `:80-81` put `estReward: EST_REWARD, estXp: MISSION_XP` on every mission.

Real catalog (`server/src/catalog_seed.js`):
- `basic rocket pirate` reward/xp 50 (`:487`)
- `pirate gunner` 50 (`:509`)
- `pirate mini boss` 125 (`:518`)
- `first pirate boss` 250 (`:534`)

The phases (`missions.js:15-34`) spawn 7 + 7 + 4 + 2.

1. `import { SHIPS } from './catalog_seed.js';` in `missions.js`. There is no cycle: `catalog_seed.js`
   imports only `./enemy_total.js` and `../../client/src/sim-core/ship-classes.js` (`catalog_seed.js:1,5`).
2. Replace `:37-41` (keep `MISSION_XP` at `:44`) with an exported pure function. **Compute each phase as
   `total × Σ(chance·value) / Σchance`** so the arithmetic stays exact. Today's sum, 1752.5, is exact in
   binary, and `Math.round(350.5) = 351` gives 3510. Dividing per pool entry first can produce
   3504.999… and round down to 3500.
   ```js
   // Expected credits/XP of one full run, from the phases and the ship catalog — never restated by hand.
   // Assumes the player lands every kill (an ally kill pays nothing) and ignores loot resale: it is an "≈".
   export function expectedRun(phases, ships = SHIPS) {
     let credits = 0, xp = 0;
     for (const ph of phases) {
       const sp = ph.spawn; if (!sp) continue;
       let w = 0, c = 0, x = 0;
       for (const p of sp.pool) {
         const s = ships.find((r) => r.name === p.ship);
         if (!s) throw new Error(`missions: pool ship "${p.ship}" is not in the catalog`); // fail loudly
         w += p.chance; c += p.chance * s.stats.reward; x += p.chance * (s.stats.xp ?? s.stats.reward);
       }
       credits += (sp.total * c) / w;
       xp += (sp.total * x) / w;
     }
     return { credits, xp };
   }
   const round10 = (n) => Math.round(n / 10) * 10;
   ```
   (The snippet is illustrative. Check field names against `SHIPS`: rows have `name` and `stats.reward` /
   `stats.xp`. Pool entries have `ship` (a name) and `chance`.)
3. In `generateMissions()` (`:76`) compute once, next to `enemyTotal`:
   ```js
   const run = expectedRun(phases);
   const estReward = round10(run.credits * 2), estXp = round10(run.xp + MISSION_XP);
   ```
   Use them at `:80-81`. Update the comment block above `MISSION_XP` (`:42-43`) to say the card's XP now
   **includes** per-kill XP.
4. **Stale freighter comment**, `missions.js:69-73` (the block above `generateMissions`). It says the
   render pos is offset to **-400** ahead of a center at **-450**. Reality: center **(-100, -950)**
   (`FLAVORS`, `:59`) and render pos z **-900** (`catalog_seed.js:1093`). Rewrite those sentences with the
   real numbers, or point at the `FLAVORS` comment (`:52-55`), which is already correct, instead of
   restating them.
5. Nothing changes on the client: `client/src/mainwindow.js:300,317,474-475` and the i18n keys
   `ui.mission.est_reward` / `ui.mission.est_xp` (`client/locales/source.json:78,82`) just show the new
   numbers.

### B1 — one "is it for sale" predicate, enforced by `buyItem`

The rule is copied in two places today:
- `client/src/shop.js:175` (`buyableNow`): `(n.price ?? 0) > 0 && n.s?.buyable !== false && itemUnlocked(n.s)`
- `server/src/catalog_seed.js:347-348` (`classifyRarity`): `(row.price ?? 0) > 0 && row.stats?.buyable !== false`

`server/src/db.js:976-996` (`buyItem`) checks neither.

What this blocks today:
- **Price 0:** components 3, 4, 7, 10, 11 (Medium/Boss hull, Boss engine, Medium/Boss thrusters).
- **`buyable:false`:** components 2, 6, 9, 22–28, 32, 33 and weapons 2, 4, 9, 10, 13.
- Ships can't be bought at all (`catalogItem`, `db.js:918-930`, only knows `component` / `weapon`).

The only client caller of `/buy` is the shop button (`shop.js:580`), and it is fed by `buyableNow`.
Starter gear comes from `ensureDefaultShip`, loot from `depositLoot` (`db.js:1095`). Nothing legitimate
buys a blocked row, and there is no crafting.

1. **New file `client/src/sim-core/shop-rules.js`.** It goes under `sim-core` because the server may
   import from `client/` but not the other way round (DECISIONS §136; `catalog_seed.js:5` already imports
   `sim-core/ship-classes.js`; the Dockerfile copies all of `client/`). It must stay free of three/DOM
   imports.
   ```js
   // Is this catalog row for sale in the hangar shop? ONE rule for the shop list (shop.js buyableNow), the
   // drop rarity (catalog_seed.js classifyRarity) and the server's buy gate (db.js buyItem). Takes price +
   // stats separately because the two sides shape rows differently (client weapons are flattened: s = row).
   // Level/mission gates (minLevel/minMission) are a separate, player-dependent check — not this rule.
   export const isShopItem = (price, stats) => (price | 0) > 0 && !(stats && stats.buyable === false);
   ```
2. `client/src/shop.js:175`: `shopCatalog().filter((n) => isShopItem(n.price, n.s) && itemUnlocked(n.s))`.
   Add the import next to the others (`shop.js:6-15`).
3. `server/src/catalog_seed.js:347-348`: `row.rarity || (isShopItem(row.price, row.stats) ? 'common' :
   'trash')`. Import from `'../../client/src/sim-core/shop-rules.js'`. The output must not change; the
   guard below checks that.
4. `server/src/db.js` `buyItem` (`:976`): right after the `if (!item)` line (`:979`), before the level and
   mission gates, add:
   ```js
   // Not on sale at all (price 0, or enemy gear marked buyable:false) — the shop never offers it, and the
   // server does not trust the shop list for that (DECISIONS §40.6 as amended). Looted copies still deposit.
   if (!isShopItem(item.price, item.stats)) return { ok: false, status: 403, error: 'not for sale' };
   ```
   Check that a weapon row's `stats` coming out of `catalogItem` really carries `buyable`. The weapon test
   below (weapon 2) fails if it doesn't.
5. **The three existing buyers of a blocked row must change**, or they break:
   - `server/src/server.test.js:1046-1057` ("buy adds to the stash…") buys component **2**. Switch it to
     the **Basic hull (component 1, price 300, buyable)**: credits `start - 300` after the buy, `start -
     300 + 225` after the sell (floor(300·0.75) = 225). The player starts with 1000 credits
     (`clearCampaign` only advances). Update the comment at `:1048-1049`; it currently states the old §40.6
     loophole as a feature.
   - `server/src/server.test.js:1061` ("sell honors a quantity…") buys 3× component 2. Replace the loop
     with a loot deposit:
     ```js
     await post('/api/players/sell-qty/loot', { items: [1, 2, 3].map(() => ({ kind: 'component', refId: 2 })) });
     ```
     The 112 / 224 numbers stay. Update the inline comment.
   - `client/visual/scenarios/12-sell-confirm.mjs:13-14` buys 3× component 2 via `fetch`. Swap it for the
     same `POST /api/players/${pid}/loot` body. The 112 / 336 numbers stay; update the comment at `:10`.
6. **DECISIONS: amend §40.6.** Don't edit §40's text (CLAUDE.md: never rewrite history). Add a new
   numbered entry (the next free number — **164 at the time of writing; re-check, parallel branches
   collide**) titled along the lines of *"The server refuses what the shop never offers"*. It says:
   - §40.6's "fine since no UI path offers those" is retired;
   - `isShopItem` is the one rule;
   - price-0 rows were never covered by §40.6 and are blocked too;
   - looting and equipping a blocked row stay allowed;
   - the `/loot` route is still client-trusted (§40), so this closes the **buy** hole only. See non-goals.

### B2 — reset lists, S3 trace deletion, new-player defaults

Today:
- Per-player DELETE list: `db.js:514`.
- `--all` TRUNCATE: `db.js:525-527`.
- `gameplay_sessions`: `db.js:262-283`. `player_id` is nullable with no FK; `s3_key TEXT NOT NULL`.
- Tables with a `player_id` column: `games` (:126), `player_ships` (:178), `sessions` (:225), `events`
  (:236), `perf_samples` (:249), `gameplay_sessions` (:264), `stash` (:292), `taken_missions` (:306),
  `cleared_missions` (:319).
- New-player values are restated at:
  - DDL defaults `:112-114`, `:119-120`, `:205`, `:299`, `:330-335`;
  - the `registerPlayer` INSERT `:496` (relies on DDL defaults) and its return `:498`;
  - the reset UPDATE `:516`.
- S3 traces are keyed `recordings/sessions/${id}.json` (`server/src/server.js:583`).
- The only readers of those keys are `getSessionS3Key` (`db.js:800`) → `GET /api/sessions/:id/trace`, the
  admin sessions list, and the read-only `server/tools/verify-sessions.mjs:108`. All of them read *rows*,
  so after a truncate nothing points at a deleted object.

1. **`server/src/s3.js`: add DELETE**, in the same style as `putTrace` / `getTrace` (`:37-54`):
   ```js
   // Is S3 configured at all? (creds in the env — same test putTrace/getTrace use to no-op.)
   export const s3Configured = () => haveCreds();
   // Delete one trace object. Returns { ok, key, status }. S3 answers 204 for a missing key too (idempotent).
   export async function deleteTrace(key) {
     if (!haveCreds()) return { ok: false, key, status: 0 };
     try {
       const res = await s3Request('DELETE', key, null);
       return { ok: res.ok, key, status: res.status };
     } catch (e) { console.warn('[s3] deleteTrace failed:', e?.message); return { ok: false, key, status: 0 }; }
   }
   ```
   `s3Request` already signs any method with an empty-payload hash when `body` is null. No other change is
   needed there.
2. **`server/src/db.js`: the table lists.** Put these near `resetPlayer` (`:500`):
   ```js
   // Every table holding per-player data (each has a player_id column), plus players itself. A test pins this
   // against information_schema, so a new player-scoped table cannot be forgotten by the --all wipe again.
   export const PLAYER_SCOPED_TABLES = ['players', 'games', 'player_ships', 'stash', 'events', 'sessions',
     'perf_samples', 'gameplay_sessions', 'taken_missions', 'cleared_missions'];
   // What the PER-PLAYER reset deliberately keeps: the login (sessions), device telemetry (perf_samples) and
   // the session-recording archive (gameplay_sessions — analytics of a real person replaying stays useful).
   const PER_PLAYER_RESET_KEEPS = ['players', 'sessions', 'perf_samples', 'gameplay_sessions'];
   const PER_PLAYER_RESET_DELETES = PLAYER_SCOPED_TABLES.filter((t) => !PER_PLAYER_RESET_KEEPS.includes(t));
   ```
   `resetPlayer` loops over `PER_PLAYER_RESET_DELETES`. The result must equal today's `:514` list, which
   is what D4 requires. Order doesn't matter: none of those tables reference each other.
3. **`resetAllPlayers` (`db.js:525`), rewritten with injectable dependencies** so it can be tested without
   S3 and without truncating the shared test DB (see Tests):
   ```js
   const SESSION_TRACE_KEY = /^recordings\/sessions\/[^/]+\.json$/; // never touch anything else in the bucket
   export async function resetAllPlayers({
     s3 = { configured: s3Configured, deleteTrace },
     listKeys = async () => (await pool.query('SELECT s3_key FROM gameplay_sessions')).rows.map((r) => r.s3_key),
     truncate = () => pool.query(`TRUNCATE ${PLAYER_SCOPED_TABLES.join(', ')} RESTART IDENTITY CASCADE`),
     log = console.log,
   } = {}) {
     const keys = await listKeys();
     let deleted = 0;
     if (!s3.configured()) {
       log(`[reset] S3 not configured — ${keys.length} session trace object(s) not deleted`);
     } else {
       const failed = keys.filter((k) => !SESSION_TRACE_KEY.test(k));       // refuse, never delete
       const todo = keys.filter((k) => SESSION_TRACE_KEY.test(k));
       for (let i = 0; i < todo.length; i += 8) {                            // 8 at a time
         const rs = await Promise.all(todo.slice(i, i + 8).map((k) => s3.deleteTrace(k)));
         for (const r of rs) r.ok ? deleted++ : failed.push(r.key);
       }
       if (failed.length) return { ok: false, deleted, failed, truncated: false };
     }
     await truncate();
     return { ok: true, deleted, failed: [], truncated: true, skippedS3: !s3.configured() };
   }
   ```
   (Illustrative. Keep it this small, and update the comment above it at `:521-524`.) Import
   `s3Configured, deleteTrace` from `'./s3.js'`; `s3.js` only imports `node:crypto`, so there is no cycle.
   - **Race, documented, not handled:** a session uploaded between `listKeys` and `truncate` loses its row,
     and its object is orphaned. `--all` is a rare manual wipe, so write that down in the comment and in
     SUMMARY. Locking `gameplay_sessions` across network deletes would stall live uploads.
4. **`server/src/reset.js:29-33`: report the result.** On `ok`, print the existing line plus `deleted N
   session trace(s)`, or the "S3 not configured" note. On `!ok`, `console.error` the count and the first
   10 failed keys, say "nothing truncated — fix S3 access and re-run (deletes are idempotent)", and
   `process.exit(1)`. Update the header comment (`:1-8`) to say `--all` also deletes S3 session traces when
   S3 is configured.
5. **Where prod `--all` must run.** `haveCreds()` reads env vars only. Run from a laptop with
   `DATABASE_URL` pointing at prod, S3 is "not configured": it would truncate and orphan every trace.
   Update `.claude/skills/reset-progress/SKILL.md` ("Safety" section) to say a **production** `--all` runs
   **inside the app container**, where the server `.env` supplies the AWS creds: `ssh` to the VPS, then
   `docker compose exec app node src/reset.js --all --yes` (the image's `WORKDIR` is `/app/server`,
   Dockerfile `:14`). Also say that if the output says "S3 not configured" on prod, the traces were
   orphaned.
6. **`NEW_PLAYER_DEFAULTS`** (in `db.js`, top-level, above `migrate`):
   ```js
   // A new player's starting values — the ONE source for the registerPlayer INSERT + return, the per-player
   // reset UPDATE and the players DDL defaults. Keys are column names. language is NOT here: reset keeps it.
   export const NEW_PLAYER_DEFAULTS = Object.freeze({
     games_played: 0, current_progress: 0, credits: 1000, shop_unlocked: 0, active_mission_id: null,
     experience: 0, skill_kinetic: 0, skill_rocket: 0, skill_shields: 0, skill_maneuver: 0, skill_mobility: 0,
   });
   export const NEW_PLAYER_LANGUAGE = 'en';
   ```
   - **Reset UPDATE (`:516`):** build the SET clause from the keys with `$n` placeholders, e.g.
     `const cols = Object.keys(NEW_PLAYER_DEFAULTS);` →
     `UPDATE players SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1` with
     `[playerId, ...Object.values(NEW_PLAYER_DEFAULTS)]`. Keep the `shop_unlocked` comment at `:507`: the
     value must stay the INTEGER `0`, not `false`. Test `server.test.js:145-175` still guards that.
   - **INSERT (`:496`):** add the default columns explicitly, plus `language` = `NEW_PLAYER_LANGUAGE`, using
     the same placeholder pattern.
   - **Return (`:498`):** `gamesPlayed: D.games_played, currentProgress: D.current_progress, language:
     NEW_PLAYER_LANGUAGE, credits: D.credits, shopUnlocked: !!D.shop_unlocked`.
   - **DDL:** the `players` migration is one template literal (opening backtick at `db.js:107`). Interpolate
     `${D.credits}` at `:114` / `:120`, `'${NEW_PLAYER_LANGUAGE}'` at `:113` / `:119`, `${D.games_played}` at
     `:112`, `${D.current_progress}` at `:205`, `${D.shop_unlocked}` at `:299`, and the experience/skill
     zeros at `:330-335`. Add one comment saying these only shape a **fresh** DB (ADD COLUMN IF NOT EXISTS
     is a no-op on an existing one), which is why the INSERT writes the values explicitly. **Leave the
     one-shot migration's `SET DEFAULT 0` at `:83` alone.** It is history: it runs once inside the
     `levels_zero_based_ids` migration.
   - Don't touch other readers of these columns (e.g. `playerSummary`, `:1109`). They read rows, not
     defaults.

## Replay / intro impact

None.
- A2 changes only the `estReward` / `estXp` fields; the descriptor's `phases` are untouched.
- B1 and B2 are server economy and ops code.
- No `sim-core` file changes except the **new** `shop-rules.js`, which no sim step imports.

Don't run `22-trace-replay`.

## Tests

The server suite runs against the **shared** local Postgres `spacegame_test`. All worktrees share it, and
`node --test` runs the files **concurrently**. Two rules follow:
- **No test may hit real S3:** inject fakes.
- **No new test may TRUNCATE.** The truncate would wipe sibling files' rows mid-run.

1. **`server/src/server.test.js:17-18`.** The suite calls `resetAllPlayers()` at startup. After B2 that
   would also truncate `gameplay_sessions`, which `gameplay-sessions.test.js` is populating in parallel,
   and it would hit S3 if the developer's shell exports AWS creds. Replace it with a direct, documented
   truncate:
   ```js
   // Clean player data for a direct `node --test` (pretest already drops the DB). NOT resetAllPlayers():
   // that deletes S3 traces and truncates gameplay_sessions, which gameplay-sessions.test.js fills in parallel.
   const { pool: pgPool, PLAYER_SCOPED_TABLES } = await import('./datastore.js');
   await pgPool.query(`TRUNCATE ${PLAYER_SCOPED_TABLES.filter((t) => t !== 'gameplay_sessions').join(', ')} RESTART IDENTITY CASCADE`);
   ```
   (Use whatever name doesn't clash with a later `pool` import in that file. Check.)
2. **B2 orchestration (no DB writes, no S3).** Add these to `server.test.js`. They call `resetAllPlayers`
   with all four dependencies injected: fake `s3`, `listKeys`, `truncate` (a flag) and `log` (captures
   lines).
   - **S3 not configured:** truncate is called; one log line mentions the key count; `deleteTrace` is never
     called.
   - **All deletes succeed** (3 keys): every key is deleted once, truncate is called, `deleted === 3`.
   - **One delete fails:** `ok:false`, `failed` contains that key, **truncate is not called**.
   - **A key outside `recordings/sessions/`** (e.g. `assets/recordings/x.json`): it is never passed to
     `deleteTrace`, it shows up in `failed`, and truncate is not called.
3. **B2 table coverage (read-only).** Query `information_schema.columns WHERE table_schema = 'public' AND
   column_name = 'player_id'` and assert every `table_name` is in `PLAYER_SCOPED_TABLES`. Also assert
   `gameplay_sessions` is in it. **Negative check:** temporarily remove a table from the constant and
   confirm the test goes red, then restore it.
4. **B2 defaults (unique ids, no truncate).**
   - Register `np-fresh` and compare its `NEW_PLAYER_DEFAULTS` columns (one `SELECT ${cols} FROM
     players`) with the constant.
   - Register `np-dirty`, `UPDATE` every one of those columns to a non-default value (credits 5,
     current_progress 2, shop_unlocked 1, active_mission_id 'side-mining', experience 900, each skill 1,
     games_played 3), call `resetPlayer('np-dirty')`, and assert it equals the constant too.
   - Assert the `POST /api/players/register` response for a brand-new id carries `credits ===
     NEW_PLAYER_DEFAULTS.credits` and `currentProgress === NEW_PLAYER_DEFAULTS.current_progress`.
5. **B1 server tests** (`server.test.js`, near the shop tests, after `:1057`):
   - **Setup:** clear the campaign for a fresh id so the shop gate is open, and `UPDATE players SET credits
     = 50000` so credits are never the reason for a refusal.
   - **Price 0:** buy component **4** (Boss hull) → status 403 with `error === 'not for sale'`. Asserting the
     body matters: the shop-lock and level gates also return 403.
   - **`buyable:false`:** do the same for weapon **2** (Kinetic pirate, price 120).
   - **Nothing changed:** after both refusals, `/stash` shows unchanged credits, and neither row is in the
     stash.
   - **Classifier output is unchanged:** for every row of `COMPONENTS` and `WEAPONS` from
     `catalog_seed.js`, `row.rarity === 'common'` exactly when `isShopItem(row.price, row.stats)` and the
     row has no explicit `rarity` override. Rows with an override (e.g. Triple spiral → 'rare') keep it.
6. **B1 client unit test.** New `client/src/sim-core/shop-rules.test.js`. Cases: priced with no stats →
   true; price 0 → false; missing price → false; `buyable:false` → false; `buyable:true` → true; a
   flattened weapon object passed as `stats` → honoured.
7. **A2: new `server/src/missions.test.js`** (pure, no DB, `node:test` + `assert/strict`, like
   `enemy_total.test.js`):
   - **Tracks the catalog:** independently recompute the expectation in the test (loop the phases from
     `generateMissions()[0].descriptor.phases` over `SHIPS`). Assert every mission's `estReward ===
     round10(2·credits)` and `estXp === round10(xp + descriptor.xpReward)`.
   - **Moves with a reward:** call `expectedRun(phases, ships)` with a copy of `SHIPS` where `pirate
     gunner`'s `reward` and `xp` are +100. Credits must rise by exactly `100 × (expected gunner count)`,
     computed from the pool odds (7·0.40 + 7·0.35 + 4·0.35 = 6.65 → +665).
   - **Unknown pool ship throws.**
   - **Negative test:** confirm the "tracks the catalog" assertion fails against the old `EST_REWARD`
     formula (temporarily, by hand), then restore. Don't pin the literal 3510 / 2750. Rebalancing must not
     need a test edit; the numbers belong in the CHANGELOG.
   - `server.test.js:880` (`m.estReward > 0`) stays as it is.

**Run:**
- `cd server && npm test` (drops and recreates `spacegame_test`).
- `cd client && node --test`.
- **Visual: only `node visual/run.mjs 12-sell-confirm`.** It is touched, so it must still pass. Don't run
  the full suite. Before trusting the result, check that no other worktree holds port 4173
  (`lsof -i :4173`).

## Docs to update

- **SUMMARY** (`docs/SUMMARY.md`): bump `**Updated:**` (line 6).
  - **Reset** bullet (`:4108-4116`):
    - `--player` keeps account, login, language, `perf_samples` and `gameplay_sessions` (the commented
      keep-list);
    - `--all` deletes every `gameplay_sessions` row's S3 trace (only keys under `recordings/sessions/`,
      8 at a time) and then truncates `PLAYER_SCOPED_TABLES`;
    - if any delete fails it aborts with nothing truncated and exits 1; re-running is safe;
    - with no S3 creds it logs and truncates (traces orphaned), so prod `--all` runs inside the app
      container;
    - an upload racing the wipe can orphan one object.
  - **Session recordings "Ops prerequisite"** (`:3801-3803`, and the same sentence near `:3754` if it's
    repeated there): the IAM key now also needs **`s3:DeleteObject`** on `recordings/sessions/*` for
    `--all`. Without it the reset aborts before truncating.
  - **Shop / pirate parts** bullet (`:919-923`): the server's `buyItem` now refuses price-0 and
    `buyable:false` rows (`403 not for sale`) via `isShopItem` in `client/src/sim-core/shop-rules.js`, the
    same predicate the shop list and the rarity classifier use. Looted copies still deposit, sell and
    equip.
  - **API surface** (`:3731`): add the 403 "not for sale" to `/buy`.
  - **Side missions** (`:3705+`): the card's est. reward / XP are computed by `expectedRun()` from the
    phases × catalog (credits ×2 on clear, XP = per-kill + 1000 bonus; ≈3510 / ≈2750 today).
  - **New-player baseline:** wherever SUMMARY states the 1000 credits / level-0 start, add that it lives in
    `NEW_PLAYER_DEFAULTS` (`db.js`).
- **CHANGELOG**: a bullet under `## 2026-10-22` (it exists at `docs/CHANGELOG.md:6`). Lead with a bold
  phrase like **"Server economy guards"** and cover:
  - the side-mission estimate (2360/1000 → 3510/2750, computed from the catalog);
  - `buyItem` refusing unsellable rows;
  - `reset --all` covering `gameplay_sessions` plus S3 trace deletion (abort-on-failure);
  - `NEW_PLAYER_DEFAULTS`;
  - the ops note (IAM `s3:DeleteObject`; prod `--all` inside the container).
- **DECISIONS**: one new entry (next free number, ~164) that **amends §40.6** (B1, see step B1.6). In the
  same entry, or a second one, record the `--all` trade-offs: delete-then-truncate with abort-on-failure,
  over best-effort; per-key DELETE over batch; the key-prefix safety rail; the accepted upload race.
- **Phase plan** `docs/plans/2026-10-20-base-menu-state-and-drift-fixes.md`: under the `## Phase 4`
  heading (`:245`), add one status line: "Shipped 2026-10-22 — see `2026-10-22-1953-catalog-economy-guards.md`
  (B2 decision changed: S3 traces ARE deleted)."
- **Skill** `.claude/skills/reset-progress/SKILL.md`: step B2.5.

## Deploy / ops (orchestrator + maintainer, not the implementer)

- **IAM:** the server's IAM key has only `s3:PutObject` + `s3:GetObject` on
  `arn:aws:s3:::vega-sentinels-assets/recordings/sessions/*` (SUMMARY `:3801-3803`). Add `s3:DeleteObject`
  on the same ARN **only with the maintainer's go-ahead**. Without it the code is still safe: a prod
  `--all` aborts before truncating. Find the IAM user from the access key in the VPS `.env` (`aws iam
  get-access-key-last-used --access-key-id …`, `default` profile).
- No catalog hash or model changes, so **no `/publish-itch`**. The itch build reads `/api/players/*/missions`
  live and gets the new estimates automatically.

## Out of scope / non-goals

- **The `/loot` route stays client-trusted** (`server.js:255`, DECISIONS §40). A crafted request can still
  deposit any row, a Boss hull included, and sell it. B1 closes the **buy** hole only; sealing loot is the
  separate server-sealed-rewards integrity item. Say so in the DECISIONS entry. Don't build it here.
- Don't delete S3 objects on the **per-player** reset, and don't touch `perf_samples` / `events` retention.
- No S3 orphan sweeper, and no `DeleteObjects` batch API.
- Don't change mission balance, enemy rewards or the i18n strings. Don't show a credit range.
- Don't touch audit items B3–B6, C1 (the skill list ×7: the skill column names in `NEW_PLAYER_DEFAULTS`
  are just the reset's existing list) or C3 (sell rate). Phase 5 covers B5/B6.
- No client UI change beyond `buyableNow` using the shared predicate.
