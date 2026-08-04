# Readable "progress" column on the /admin players table

**Feature id:** `2026-08-03-2154-admin-progress-column`
**Scope:** server-only (`server/src/admin.js`, `server/src/db.js`, `server/src/server.js` + tests + docs).
No client changes, no assets, no migrations.

## Goal

The `progress` column on the `/admin` players table renders the raw `current_progress` id as a bare
number (`server/src/admin.js:149`). A `3` there actually means *"the player is on Level 2"* — the id is
off by one from the level's player-facing title, so the column is unreadable at a glance. Replace that
single cell with the level's **title**, a small **progress bar**, and an **`n/N`** fraction, plus a **✔**
marker when the player sits on the **last** level:

```
progress
─────────────────────────
Level 0   ▓░░░░  1/5
Level 2   ▓▓▓░░  3/5
Level 4 ✔ ▓▓▓▓▓  5/5
```

The bar is CSS (a track `<span>` with a `%`-width fill), not literal block characters. The column stays
**sortable by the raw numeric progress** (the inline sort script reads `data-sort`). Nothing else on the
page changes.

## Decisions (already made — do NOT re-open or re-ask)

1. **Titles come from the `levels` table `descriptor.title`** (`'Level 0'`..`'Level 4'`). The `levels.name`
   column is `'level-1'`..`'level-5'` — off by one vs the title — and **must never be shown**.
2. **`N` (the denominator) is derived at render time** as the number of level rows. **Never hardcode 5.**
   **`n` is the ordinal position** of the player's level in the id-ordered list (not the raw id), so a
   future id gap can't render `7/5`.
3. **Data source: a new `getLevels()` in `server/src/db.js`, injected into `mountAdmin` as a 5th
   positional arg** with an `async () => []` default. Rationale: `players.current_progress` is a **FK into
   the `levels` table** (`server/src/db.js:119`), so the table is the only source that cannot drift from
   the id being rendered — importing `LEVELS` from `server/src/catalog_seed.js` would render titles for a
   seed that may not (yet) match the deployed DB rows, and would silently mis-map ids to array positions.
   Injection (rather than joining into `getAdminPlayers`) matches the existing style — `getAdminPlayers` /
   `getAdminSessions` are already injected — and keeps `admin.js` free of DB imports so its render helpers
   stay unit-testable without Postgres. One extra tiny query per admin page load; **no caching** (§30).
4. **Rendering lives in an exported pure helper `progressCell(currentProgress, levels)`** in `admin.js`,
   so `server/src/admin.test.js` can assert it DB-free (that file runs in its own process with the ADMIN_*
   env deleted, and must stay that way).
5. **Unknown / unresolvable progress** (id not present in `levels`, or an empty `levels` list) falls back
   to the current rendering: `<td data-sort="N" class="num">N</td>` — the bare number, no bar, no crash.
6. **✔ appears only when `n === total`** ("on the final level"). There is **no** "campaign finished" flag
   in the schema and we are **not** inventing one.
7. **The admin theme is dark** (`body { background: #0e1116 }`, even rows `#12161d`). The bar's track and
   fill colors must be legible on that background — reuse the palette already in the shell: track
   `#2a2f3a` (the table border color), fill `#7fb2ff` (the link blue), ✔ green `#4ade80`, fraction
   `#9fb3c8` (the muted `td.ref` color). The bar CSS goes **inline in the existing `pageShell` `<style>`
   block** (`server/src/admin.js:102-115`) — no external stylesheet, no new files.

## Steps

### 1. `server/src/db.js` — add `getLevels()`

Insert immediately **after** the existing `getLevel(name)` function (currently `server/src/db.js:621-624`,
right after the `getMap`/`getLevel` pair and before the `// ---------- Hangar shop + stash` banner):

```js
// All levels, id-ordered — the admin "progress" column resolves a player's `current_progress` (an FK
// into this table) to a readable title + n/N. `descriptor.title` is the player-facing name
// ('Level 0'..'Level 4'); the `name` column ('level-1'..'level-5') is off by one and is NOT shown.
export async function getLevels() {
  const { rows } = await pool.query('SELECT id, name, descriptor FROM levels ORDER BY id');
  return rows.map((r) => ({ id: Number(r.id), title: r.descriptor?.title || r.name }));
}
```

`descriptor` is JSONB and comes back already parsed (same as `getLevel`). `id` is BIGSERIAL → Postgres
returns it as a string, hence the `Number(...)` coercion (consistent with `getAdminPlayers`,
`server/src/db.js:583-590`). `server/src/datastore.js` is `export * from './db.js'`, so the new export is
available on the façade with no edit there.

### 2. `server/src/admin.js` — the `progressCell` helper

Add the exported helper directly **above** `renderPage` (i.e. between `pageShell`'s closing brace at
`server/src/admin.js:136` and the `// Render the players table page.` comment at `:138`):

```js
// The players-table "progress" cell. `current_progress` is a raw level id (an FK into the levels table)
// and is off by one from the level's player-facing title, so render the TITLE + a bar + n/N instead.
// `levels` is the id-ordered [{ id, title }] list from getLevels(); both N (levels.length) and the
// ordinal n are derived from it — never hardcoded. A ✔ marks the LAST level. Exported for unit tests.
// Unknown/unresolvable progress (id not in the list, or no levels) → the raw number, as before.
export function progressCell(currentProgress, levels = []) {
  const total = levels.length;
  const idx = levels.findIndex((l) => Number(l.id) === Number(currentProgress));
  if (idx < 0) return `<td data-sort="${esc(currentProgress)}" class="num">${esc(currentProgress)}</td>`;
  const n = idx + 1;
  const pct = Math.round((n / total) * 100);
  const check = n === total ? ' <span class="done">✔</span>' : '';
  return `<td data-sort="${esc(currentProgress)}" class="prog">` +
    `<span class="lvl">${esc(levels[idx].title)}${check}</span>` +
    `<span class="bar"><i style="width:${pct}%"></i></span>` +
    `<span class="frac">${n}/${total}</span></td>`;
}
```

Notes for the implementer:
- The ✔ lives **inside** `.lvl` so the fixed-width `.lvl` keeps every bar left-aligned in the same column
  whether or not the row has a check mark.
- `esc` is the module-level escaper at `server/src/admin.js:34`; the title comes from the DB, so it must
  be escaped. `pct` is computed, never user data → safe inside `style=`.
- The helper returns the **whole `<td>`**, matching how it is spliced into the row template below.

### 3. `server/src/admin.js` — CSS in the shared page shell

Inside the existing `<style>` block of `pageShell`, add these rules right after the
`td.device { ... }` line (`server/src/admin.js:112`):

```css
      /* progress cell: level title (+ ✔ on the last level) · bar · n/N. Colors reuse the dark-theme
         palette above so the bar stays legible on #0e1116 / the #12161d even-row background. */
      td.prog { white-space: nowrap; }
      td.prog .lvl { display: inline-block; min-width: 5.6em; }
      td.prog .done { color: #4ade80; }
      td.prog .bar { display: inline-block; width: 60px; height: 8px; margin: 0 8px; vertical-align: middle;
                     background: #2a2f3a; border-radius: 4px; overflow: hidden; }
      td.prog .bar i { display: block; height: 100%; background: #7fb2ff; }
      td.prog .frac { color: #9fb3c8; font-variant-numeric: tabular-nums; }
```

(The `<style>` block is shared with `/admin/sessions`; that page renders no `.prog` cell, so the extra
rules are inert there. That is fine and simpler than splitting the shell — §30.)

### 4. `server/src/admin.js` — use it in `renderPage`

`renderPage` takes the levels list as a second parameter. Change the signature at
`server/src/admin.js:140`:

```js
function renderPage(players, levels) {
```

and replace the progress cell line (`server/src/admin.js:149`):

```js
      <td data-sort="${p.currentProgress}" class="num">${p.currentProgress}</td>
```

with:

```js
      ${progressCell(p.currentProgress, levels)}
```

Leave the `headers` array (`server/src/admin.js:158-159`) untouched — the column header stays `progress`
and the column count/order is unchanged, so the inline sort script's `data-col` indices still line up.

### 5. `server/src/admin.js` — inject `getLevels` into `mountAdmin`

Change the signature (`server/src/admin.js:199`) and the `/admin` handler (`:200-206`):

```js
// Mount the admin views. `getAdminPlayers`/`getAdminSessions`/`getLevels` are injected (datastore fns) so
// this stays testable; `currentVersion` is the deploy commit for the ✓/✗ version-match marker.
export function mountAdmin(app, getAdminPlayers, getAdminSessions, currentVersion, getLevels = async () => []) {
  app.get('/admin', async (req, res, next) => {
    try {
      if (!checkAuth(req, res)) return;
      const [players, levels] = await Promise.all([getAdminPlayers(1000), getLevels()]);
      res.type('html').send(renderPage(players, levels));
    } catch (e) { next(e); }
  });
```

`getLevels` is appended **last** (after `currentVersion`) and **defaulted**, so the existing 2-arg call in
`server/src/admin.test.js:14` keeps working unchanged. Update the doc comment above `mountAdmin`
(`server/src/admin.js:197-198`) as shown.

### 6. `server/src/server.js` — pass it in

- Add `getLevels` to the datastore import list on `server/src/server.js:8` (right after the existing
  `getLevel,` — same line/import statement).
- Update the call site at `server/src/server.js:480`:

```js
  mountAdmin(app, getAdminPlayers, getAdminSessions, process.env.SENTRY_RELEASE || null, getLevels);
```

These are the only two `mountAdmin(` call sites in the repo (verified: `server/src/server.js:480` and
`server/src/admin.test.js:14`; the other hits are historical `docs/plans/*.md` briefs, which are history —
**do not edit past plan briefs**).

## Tests

Two layers: pure-unit (no DB) for the rendering rules, one integration assertion for the wiring.

### A. `server/src/admin.test.js` (runs with admin disabled, no Postgres)

Extend the import on line 11 to `const { mountAdmin, adminEnabled, progressCell } = await import('./admin.js');`
and append these tests. Fixture at the top of the block:

```js
const LEVELS = [
  { id: 1, title: 'Level 0' }, { id: 2, title: 'Level 1' }, { id: 3, title: 'Level 2' },
  { id: 4, title: 'Level 3' }, { id: 5, title: 'Level 4' },
];
```

1. **`progressCell: title + bar + n/N, sortable by the raw id`**
   - `progressCell(1, LEVELS)` contains `data-sort="1"`, `Level 0`, `1/5`, `width:20%`, and **no** `✔`.
   - `progressCell(3, LEVELS)` contains `data-sort="3"`, `Level 2` (**not** `Level 3`, and not `level-3`),
     `3/5`, `width:60%`, and **no** `✔`.
   - Assert `class="prog"` is present (the bar markup path was taken).
2. **`progressCell: ✔ only on the final level`**
   - `progressCell(5, LEVELS)` contains `Level 4`, `5/5`, `width:100%`, and `✔`.
   - Assert the ✔ appears **inside** the `.lvl` span: `/<span class="lvl">Level 4 <span class="done">✔<\/span><\/span>/`.
3. **`progressCell: N and n are derived, not hardcoded`**
   - A 3-entry list `[{id:1,…},{id:2,…},{id:3,…}]` → `progressCell(2, …)` contains `2/3`, not `2/5`.
   - Non-contiguous ids `[{id:2,title:'A'},{id:5,title:'B'},{id:9,title:'C'}]` → `progressCell(5, …)`
     contains `B` and `2/3` (ordinal position, not the raw id) while still carrying `data-sort="5"`.
4. **`progressCell: unknown progress falls back to the bare number`**
   - `progressCell(7, LEVELS)` **equals** `<td data-sort="7" class="num">7</td>` (exact string) — no bar,
     no `class="prog"`.
   - `progressCell(1, [])` **equals** `<td data-sort="1" class="num">1</td>` (empty levels list, and no
     division by zero).
5. **`progressCell: escapes the level title`**
   - `progressCell(1, [{ id: 1, title: '<script>x</script>' }])` contains `&lt;script&gt;` and **not**
     the raw `<script>`.

### B. `server/src/server.test.js` (Postgres, admin enabled)

Add one test in the admin block, immediately after
`test('admin: aggregates sum kills/time/earned across a player\'s games', …)` (currently ends at
`server/src/server.test.js:1108`):

```js
test('admin: progress column renders the level title + bar + n/N, still sorted by the raw id', async () => {
  await post('/api/players/register', { playerId: 'p_prog' });   // fresh player → current_progress = 1
  const html = await (await get('/admin', adminAuth)).text();
  const row = html.split('<tr>').find((r) => r.includes('p_prog'));
  assert.ok(row, 'the player row is rendered');
  assert.match(row, /<td data-sort="1" class="prog"/, 'sortable by the raw progress id');
  assert.ok(row.includes('Level 0'), 'shows the level title, not the raw id');
  assert.ok(row.includes('1/5'), 'n/N derived from the 5 seeded levels');
  assert.ok(!row.includes('level-1'), 'never shows the levels.name column');
});
```

The seeded catalog has exactly 5 levels (already asserted by
`test('levels: intro Level 0 …')`, `server/src/server.test.js:419-459`), so `1/5` is the correct
expectation for a freshly registered player.

**Existing assertions to re-check (no edits expected, but verify they still pass):**
`server/src/server.test.js:1096-1108` asserts `row.includes('data-sort="5")` / `"150"` / `"180000"` / `"2"`
for the aggregates — the progress cell still emits `data-sort="<raw progress>"`, so those substring
assertions are unaffected. `server/src/server.test.js:1121-1126` only checks `<table` is present.

### How to run

```
cd server && npm test
```
`pretest` drops + recreates the local `spacegame_test` database (Postgres is the single backend; the data
layer is `db.js`). `node --test` runs `server.test.js` and `admin.test.js` in separate processes. No
client test changes — run `cd client && node --test` only as a sanity check that nothing regressed.

### Replay / sim impact

**None.** This is server-rendered admin HTML: no simulation, collision, damage or RNG code is touched, no
client module changes, so recorded session traces and the Level-0 intro replay are unaffected. The
`node visual/run.mjs 22-intro-replay` guard is not required for this change.

## Docs to update

1. **`docs/CHANGELOG.md`** — add a bullet at the **top** of the existing `## 2026-08-03` heading (the
   heading is already there, `docs/CHANGELOG.md:6`):

   > - **[2026-08-03-2154-admin-progress-column] The admin `progress` column is readable.** It rendered the
   >   raw `current_progress` id (a bare `3`, which actually means "Level 2" — the level ids are off by one
   >   from the player-facing titles). Each cell now shows the level **title** from the `levels` table
   >   `descriptor.title`, a small CSS bar, and an `n/N` fraction, with a **✔** when the player is on the
   >   last level. `N` and the ordinal `n` are derived from the `levels` table at render time (new
   >   `getLevels()` in `db.js`, injected into `mountAdmin`) — never hardcoded — and the column still sorts
   >   by the raw numeric progress via `data-sort`. Unknown ids fall back to the bare number.

2. **`docs/SUMMARY.md` — "Admin dashboard (`GET /admin`…)" bullet** (`docs/SUMMARY.md:1777-1791`).
   In the column list on lines 1778-1779, replace `current_progress` with **`progress`** and add a sentence
   after the `getAdminPlayers` clause (around line 1782), e.g.:

   > The **progress** column renders the player's `current_progress` (an FK into `levels`) as the level's
   > player-facing **title** (`descriptor.title`, e.g. `Level 2` — the `levels.name` column `level-1`..
   > `level-5` is off by one and is never shown) plus a CSS bar and an `n/N` fraction, with a **✔** on the
   > last level; `N` = the number of level rows and `n` = the level's ordinal position, both derived per
   > request from the new `getLevels()` datastore fn injected into `mountAdmin` (never hardcoded). The cell
   > keeps `data-sort="<raw id>"`, so sorting is still by real progress; an id missing from `levels` falls
   > back to the bare number (`progressCell` in `server/src/admin.js`).

3. **`docs/SUMMARY.md` `**Updated:**` line** (`docs/SUMMARY.md:6`) — keep the date `2026-08-03` and
   prepend a short bold headline in front of the current one, converting the current headline into the
   `Previously:` chain, e.g.:
   `**Updated:** 2026-08-03 (**The admin `progress` column reads "Level 2 · bar · 3/5"** instead of a raw
   level id. Previously: **Sessions now actually upload from phones/tablets + trace format v2** — …)`.

4. **`docs/DECISIONS.md` — no new entry.** The only judgement call here (read the `levels` table via an
   injected `getLevels()` rather than importing `LEVELS` from `catalog_seed.js`) is small, local, and
   already recorded where it matters: as the doc comment on `getLevels` in `db.js` and in the SUMMARY
   sentence above. Adding a numbered decision for a one-cell admin rendering change would be exactly the
   over-documentation §30 warns against. (Stated explicitly so the implementer doesn't add one "to be
   safe".)

## Out of scope / non-goals (DECISIONS §30)

- **No extra columns.** Only the existing `progress` cell changes; the header list and column order stay
  as they are.
- **No "campaign finished" derivation.** There is no such flag — `current_progress` just caps at the last
  level. The ✔ means exactly "on the final level" and nothing more.
- **No stall / drop-off / funnel info**, no "days since last level-up", no per-level player counts.
- **No changes to `/admin/sessions`** (its `level` column, the ✓/✗ version marker, the ▶ play links).
- **No caching** of the levels list, no memoization, no new config. One small `SELECT` per admin request.
- **No pagination, search, export, or CSS framework**; the page stays a single server-rendered file with
  an inline `<style>` and the existing inline sort script.
- **No client, asset, or catalog changes** → no `assets:*` run, no `CREDITS.md` question, and **no
  `/publish-itch` step** (nothing the itch bundle ships is touched).

## Done checklist

- [ ] `getLevels()` exported from `server/src/db.js` (after `getLevel`), id-ordered, `title` from
      `descriptor.title`.
- [ ] `progressCell(currentProgress, levels)` exported from `server/src/admin.js`; used at the former
      `admin.js:149`; `renderPage(players, levels)`.
- [ ] `.prog` CSS added inside the existing `pageShell` `<style>` block, dark-theme legible.
- [ ] `mountAdmin(..., getLevels = async () => [])` + `Promise.all` in the `/admin` handler; wired from
      `server/src/server.js:8` (import) and `:480` (call).
- [ ] Tests added to `server/src/admin.test.js` (5 unit tests incl. the unknown-progress fallback and the
      `data-sort` raw-number assertion) and `server/src/server.test.js` (1 integration test).
- [ ] `cd server && npm test` green.
- [ ] Sweep before finishing: `grep -rn --include='*.js' -e 'currentProgress' -e 'current_progress' server/src`
      shows no remaining raw-number rendering in `admin.js`; `grep -rn 'mountAdmin(' server/src` shows both
      call sites updated/compatible.
- [ ] CHANGELOG bullet + SUMMARY admin section + `**Updated:**` line done; no DECISIONS entry.
