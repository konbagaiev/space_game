# Admin panel — registered players + per-player stats + referrer capture

**Feature ID:** 2026-07-02-1352-admin-panel-player-stats

## Goal

Give the maintainer a private, server-rendered `/admin` dashboard to see **who has registered on prod**
and **how they play**: one HTML table listing every player (id short, username, email, email_verified,
created_at, last_seen, current_progress, credits, games_played) plus per-player aggregates from the
existing `games` table (total time played, total ships destroyed, total credits earned). Also **capture a
`referrer`** on each player at row creation (write-once) — `document.referrer` + URL params (`?ref=`, UTM)
— so we can see where players came from, shown in the same table. The admin surface is protected by **HTTP
Basic Auth** (`ADMIN_USER`/`ADMIN_PASSWORD` from the server `.env`) and is **disabled → 404 when either
env var is unset**, so it is never wide open on prod.

## Decisions (all settled — do not re-ask)

- **Access:** HTTP Basic Auth on `/admin`. Credentials from `ADMIN_USER` / `ADMIN_PASSWORD` (server
  `.env`). If either is missing/empty → the route returns **404** (admin disabled). Compare both fields
  with `crypto.timingSafeEqual` (built-in `node:crypto`, already used in `auth.js`). No new deps.
- **Presentation:** a real server-rendered `/admin` HTML page (not JSON), served by Express. No admin
  framework, no build step (client is buildless). Data is embedded in the page; **client-side column
  sorting** is minimal inline JS (click a `<th>` → sort rows by that column). No server-side sort, no
  pagination.
- **Scale:** single aggregated query `players LEFT JOIN games GROUP BY player`, ordered `last_seen DESC`,
  **hard cap 1000 rows**.
- **Referrer path (Q1 — write-once at row creation):** `registerPlayer(id, referrer)` gains an optional
  `referrer` arg and writes it **only on the INSERT path** (new-row creation), never on the `last_seen`
  UPDATE path — this gives "first-registration-only" for free. The client sends the referrer by calling
  the **existing (currently client-unused) `POST /api/players/register`** once, early in `bootstrap()`,
  before the level/active-ship fetches (which also auto-register). All other auto-register call sites
  (active-ship, level, games, etc.) pass **no** referrer and keep working unchanged.
- **Referrer format (Q2):** the client builds a compact JSON string
  `{ referrer: document.referrer||null, ref, utm_source, utm_medium, utm_campaign }`, **omitting empty
  keys**; the server **truncates to 512 chars** as a safety cap and stores it verbatim in one nullable
  `referrer` TEXT column. Existing prod players keep `referrer = NULL` (no backfill — expected). The admin
  panel renders it raw (monospace, wrapped).

## Steps

### 1. Migration — add `players.referrer` (both backends)

**SQLite** — create `server/src/migrations/018_player_referrer.js` (next free number; current highest is
`017_password_reset.js`, and `PRAGMA user_version` is driven by the numeric prefix — see
`server/src/migrate.js`):

```js
// 018 — referrer capture (docs/plans/2026-07-02-1352-admin-panel-player-stats.md): where a player came
// from, captured once at row creation (write-once; never overwritten on later visits). Nullable TEXT; a
// compact JSON string of document.referrer + ?ref=/UTM params, truncated to 512 chars server-side.
export const up = (db) => {
  db.exec(`ALTER TABLE players ADD COLUMN referrer TEXT;`);
};
```

A nullable ADD COLUMN with no default is legal in SQLite (unlike the `current_progress` FK case in
DECISIONS §9).

**Postgres** — in `server/src/db_postgres.js` `migrate()`, add `referrer` to the `players` table body
(the `CREATE TABLE IF NOT EXISTS players (...)` at lines 12–19) **and** an idempotent ALTER next to the
existing player ALTERs (near lines 20–21 / 102–110) so existing prod DBs pick it up:

```sql
ALTER TABLE players ADD COLUMN IF NOT EXISTS referrer TEXT;   -- where the player first came from (write-once)
```

### 2. `registerPlayer` — accept + persist referrer on INSERT only (both backends)

**`server/src/db.js`** — change the signature and INSERT (current function at lines 74–85):

```js
export function registerPlayer(id, referrer = null) {
  const now = Date.now();
  const existing = db.prepare('SELECT created_at, games_played, current_progress, language, credits, shop_unlocked FROM players WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, id);   // NOTE: referrer never touched here (write-once)
    ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: existing.games_played, currentProgress: existing.current_progress, language: existing.language, credits: existing.credits, shopUnlocked: !!existing.shop_unlocked, createdAt: existing.created_at };
  }
  const ref = referrer ? String(referrer).slice(0, 512) : null;   // safety cap
  db.prepare('INSERT INTO players (id, created_at, last_seen, referrer) VALUES (?, ?, ?, ?)').run(id, now, now, ref);
  ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, currentProgress: 1, language: 'en', credits: 1000, shopUnlocked: false, createdAt: now };
}
```

**`server/src/db_postgres.js`** — mirror it (function at lines 253–264). The INSERT at line 261 becomes:

```js
export async function registerPlayer(id, referrer = null) {
  const now = Date.now();
  const { rows } = await pool.query('SELECT created_at, games_played, current_progress, language, credits, shop_unlocked FROM players WHERE id = $1', [id]);
  if (rows[0]) {
    await pool.query('UPDATE players SET last_seen = $1 WHERE id = $2', [now, id]);   // referrer untouched (write-once)
    await ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: rows[0].games_played, currentProgress: rows[0].current_progress, language: rows[0].language, credits: rows[0].credits, shopUnlocked: !!rows[0].shop_unlocked, createdAt: Number(rows[0].created_at) };
  }
  const ref = referrer ? String(referrer).slice(0, 512) : null;
  await pool.query('INSERT INTO players (id, created_at, last_seen, referrer) VALUES ($1, $2, $3, $4)', [id, now, now, ref]);
  await ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, currentProgress: 1, language: 'en', credits: 1000, shopUnlocked: false, createdAt: now };
}
```

`datastore.js:8` already re-exports `registerPlayer` with `(...a)`, so the new arg passes through — **no
change needed** to `datastore.js` for registerPlayer.

### 3. `getAdminPlayers` datastore query (both backends + re-export)

**`server/src/db.js`** — add near `stats()` (line 281):

```js
// All players joined to their aggregated game history (admin panel). One row per player, newest-active
// first, capped. total_* come from the games table (SUM/COUNT); games_played is the players counter.
export function getAdminPlayers(limit = 1000) {
  return db.prepare(`
    SELECT p.id, p.username, p.email, p.email_verified, p.created_at, p.last_seen,
           p.current_progress, p.credits, p.games_played, p.referrer,
           COALESCE(SUM(g.duration_ms), 0) AS total_time_ms,
           COALESCE(SUM(g.kills), 0)       AS total_kills,
           COALESCE(SUM(g.credits), 0)     AS total_earned
    FROM players p LEFT JOIN games g ON g.player_id = p.id
    GROUP BY p.id
    ORDER BY p.last_seen DESC
    LIMIT ?`).all(limit)
    .map((r) => ({
      id: r.id, username: r.username ?? null, email: r.email ?? null,
      emailVerified: !!r.email_verified, createdAt: r.created_at, lastSeen: r.last_seen,
      currentProgress: r.current_progress, credits: r.credits, gamesPlayed: r.games_played,
      referrer: r.referrer ?? null,
      totalTimeMs: Number(r.total_time_ms), totalKills: Number(r.total_kills), totalEarned: Number(r.total_earned),
    }));
}
```

**`server/src/db_postgres.js`** — mirror it (add near the other read functions). **Postgres returns
`BIGINT`/`SUM` as strings and `email_verified` as an INTEGER** — coerce every numeric with `Number(...)`
and `email_verified` with `!!Number(...)`, exactly like `createdAt: Number(...)` already does at line 259:

```js
export async function getAdminPlayers(limit = 1000) {
  const { rows } = await pool.query(`
    SELECT p.id, p.username, p.email, p.email_verified, p.created_at, p.last_seen,
           p.current_progress, p.credits, p.games_played, p.referrer,
           COALESCE(SUM(g.duration_ms), 0) AS total_time_ms,
           COALESCE(SUM(g.kills), 0)       AS total_kills,
           COALESCE(SUM(g.credits), 0)     AS total_earned
    FROM players p LEFT JOIN games g ON g.player_id = p.id
    GROUP BY p.id
    ORDER BY p.last_seen DESC
    LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: r.id, username: r.username ?? null, email: r.email ?? null,
    emailVerified: !!Number(r.email_verified), createdAt: Number(r.created_at), lastSeen: Number(r.last_seen),
    currentProgress: Number(r.current_progress), credits: Number(r.credits), gamesPlayed: Number(r.games_played),
    referrer: r.referrer ?? null,
    totalTimeMs: Number(r.total_time_ms), totalKills: Number(r.total_kills), totalEarned: Number(r.total_earned),
  }));
}
```

**`server/src/datastore.js`** — add the re-export beside `stats` (line 20):

```js
export const getAdminPlayers = (...a) => impl.getAdminPlayers(...a);
```

### 4. New module `server/src/admin.js` — Basic Auth + HTML render + mount

SUMMARY's file map prefers modular server files (`auth.js`, `missions.js`, `ses.js`, `reset.js`). Create
`server/src/admin.js`:

```js
// Admin dashboard (docs/plans/2026-07-02-1352-admin-panel-player-stats.md): a private, server-rendered
// /admin page listing players + per-player game aggregates. Guarded by HTTP Basic Auth from the env
// (ADMIN_USER / ADMIN_PASSWORD); when either is unset the route 404s (disabled — never open on prod).
import crypto from 'node:crypto';

// Constant-time compare of two strings that never short-circuits on length (hash both sides to a fixed
// width first, so timing can't leak the credential length either).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function adminEnabled() {
  return !!(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD);
}

// Returns true if the request carries valid Basic Auth. On failure it writes the response (401 with a
// WWW-Authenticate challenge, or 404 when admin is disabled) and returns false.
function checkAuth(req, res) {
  if (!adminEnabled()) { res.status(404).end(); return false; }   // disabled → indistinguishable from "no such route"
  const header = req.headers.authorization || '';
  const m = /^Basic (.+)$/.exec(header);
  if (m) {
    const [user, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
    const pass = rest.join(':'); // passwords may contain ':'
    if (safeEqual(user, process.env.ADMIN_USER) && safeEqual(pass, process.env.ADMIN_PASSWORD)) return true;
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Vega Sentinels admin"');
  res.status(401).end('Authentication required');
  return false;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (ms) => { const s = Math.round((ms || 0) / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}h ${m}m`; };
const fmtDate = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '');

// Render the players table page. `data-sort` on each cell holds the raw numeric/string value used by the
// inline column-sort script (so sorting is by real value, not the formatted display text).
function renderPage(players) {
  const rows = players.map((p) => `
    <tr>
      <td title="${esc(p.id)}"><code>${esc(p.id.slice(0, 8))}</code></td>
      <td>${esc(p.username)}</td>
      <td>${esc(p.email)}</td>
      <td data-sort="${p.emailVerified ? 1 : 0}">${p.emailVerified ? 'yes' : ''}</td>
      <td data-sort="${p.createdAt}">${fmtDate(p.createdAt)}</td>
      <td data-sort="${p.lastSeen}">${fmtDate(p.lastSeen)}</td>
      <td data-sort="${p.currentProgress}" class="num">${p.currentProgress}</td>
      <td data-sort="${p.credits}" class="num">${p.credits}</td>
      <td data-sort="${p.gamesPlayed}" class="num">${p.gamesPlayed}</td>
      <td data-sort="${p.totalTimeMs}" class="num">${fmtTime(p.totalTimeMs)}</td>
      <td data-sort="${p.totalKills}" class="num">${p.totalKills}</td>
      <td data-sort="${p.totalEarned}" class="num">${p.totalEarned}</td>
      <td class="ref"><code>${esc(p.referrer)}</code></td>
    </tr>`).join('');
  const headers = ['id', 'username', 'email', 'verified', 'created', 'last seen', 'progress', 'credits',
    'games', 'time played', 'kills', 'earned', 'referrer'];
  const ths = headers.map((h, i) => `<th data-col="${i}">${esc(h)}</th>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Vega Sentinels — admin</title>
    <style>
      body { font: 14px system-ui, sans-serif; margin: 1rem; background: #0e1116; color: #e6e6e6; }
      h1 { font-size: 1.1rem; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #2a2f3a; padding: 4px 8px; text-align: left; vertical-align: top; }
      th { cursor: pointer; background: #171b22; position: sticky; top: 0; user-select: none; }
      th:hover { background: #202632; }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.ref { max-width: 320px; word-break: break-all; color: #9fb3c8; }
      code { color: #cfe3ff; }
      tr:nth-child(even) td { background: #12161d; }
    </style></head><body>
    <h1>Players — ${players.length}${players.length >= 1000 ? ' (capped)' : ''}</h1>
    <table id="t"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>
    <script>
      // Click a header to sort by that column (numeric when every cell parses as a number, else string).
      const table = document.getElementById('t');
      let sortCol = -1, asc = true;
      const cellVal = (tr, i) => { const td = tr.children[i]; return td.dataset.sort ?? td.textContent; };
      table.querySelectorAll('th').forEach((th, i) => th.addEventListener('click', () => {
        asc = sortCol === i ? !asc : true; sortCol = i;
        const rows = [...table.tBodies[0].rows];
        const numeric = rows.every((r) => cellVal(r, i) === '' || !isNaN(parseFloat(cellVal(r, i))));
        rows.sort((a, b) => {
          const x = cellVal(a, i), y = cellVal(b, i);
          const c = numeric ? (parseFloat(x || 0) - parseFloat(y || 0)) : String(x).localeCompare(String(y));
          return asc ? c : -c;
        });
        rows.forEach((r) => table.tBodies[0].appendChild(r));
      }));
    </script></body></html>`;
}

// Mount GET /admin on the app. `getAdminPlayers` is injected (datastore fn) so this stays testable.
export function mountAdmin(app, getAdminPlayers) {
  app.get('/admin', async (req, res, next) => {
    try {
      if (!checkAuth(req, res)) return;
      const players = await getAdminPlayers(1000);
      res.type('html').send(renderPage(players));
    } catch (e) { next(e); }
  });
}
```

### 5. Wire it into `server.js`

- **Import** (extend the `datastore.js` import block at lines 8–11) — add `getAdminPlayers`; and add a new
  import line for the admin module:

  ```js
  import { mountAdmin } from './admin.js';
  ```
  (add `getAdminPlayers` to the existing `from './datastore.js'` list).

- **Register route body** (lines 76–83) — read + forward the referrer:

  ```js
  app.post('/api/players/register', wrap(async (req, res) => {
    const { playerId, referrer } = req.body || {};
    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({ error: 'playerId (string) required' });
    }
    res.json(await registerPlayer(playerId, typeof referrer === 'string' ? referrer : null));
  }));
  ```

- **Mount admin** — after the `/api/config` route (line 360) and **before** `app.use(express.static(...))`
  (line 395). `/admin` is not under `/api`, so the CORS middleware (scoped to `/api`) never touches it —
  admin stays same-origin only, which is what we want.

  ```js
  mountAdmin(app, getAdminPlayers);
  ```

### 6. Client — capture + send referrer once at boot

**`client/src/net.js`** — add a helper (export it). It builds the compact JSON string and POSTs
`/api/players/register`. Best-effort like the rest of the module.

```js
// Build a compact referrer string (document.referrer + ?ref=/UTM params), omitting empty keys. Sent once
// at boot so the server can store it write-once on player-row creation (admin panel; DECISIONS: referrer).
function referrerPayload() {
  try {
    const p = new URLSearchParams(location.search);
    const out = {};
    if (document.referrer) out.referrer = document.referrer;
    for (const [k, key] of [['ref', 'ref'], ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_campaign', 'utm_campaign']]) {
      const v = p.get(k); if (v) out[key] = v;
    }
    return Object.keys(out).length ? JSON.stringify(out) : null;
  } catch { return null; }
}

// Register the current player early in boot, sending the referrer. The server writes referrer only when
// it creates the row (write-once); this is a no-op enrichment for a returning player. Best-effort.
export async function registerBoot() {
  if (!G.playerId) return;
  try {
    await fetch(API_BASE + '/api/players/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: G.playerId, referrer: referrerPayload() }),
    });
  } catch { /* best-effort: offline / file:// still plays */ }
}
```

**`client/src/main.js`** — import `registerBoot` (extend the existing `net.js` import at line 17) and call
it in `bootstrap()` **after `restoreSession()`** (so `G.playerId` is settled — an account login may have
adopted the account row) and **before** the `levelUrl` fetch (line 464). Insert right after line 461
(`await restoreSession();`):

```js
    // Ensure the player row exists (write-once referrer capture) before the level/active-ship fetches,
    // which also auto-register but carry no referrer.
    await registerBoot();
```

This guarantees the row is created with the referrer on a first visit; the later
`active-ship`/`level`/`games` calls only bump `last_seen`.

## Tests

### Server — `server/src/server.test.js` (runs on BOTH SQLite and Postgres)

Add tests (the suite already has `post`, `getJson`, `base` helpers; add a small `get(path, headers)` if
not present, and an `adminAuth` header helper). Because `rateLimit`/cookies already run under
`NODE_ENV=test`, admin needs `ADMIN_USER`/`ADMIN_PASSWORD` set — **set them at the top of the test file
before `createApp()`** (near the existing `process.env.NODE_ENV = 'test'` at line 10):

```js
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'secret';
```

Cases:
1. **Referrer write-once:** `POST /api/players/register` with `{ playerId: 'ref1', referrer: '{"ref":"twitter"}' }`
   → then `POST` the same id again with a *different* referrer → fetch `/admin` (with auth) and assert the
   row for `ref1` still shows the **first** referrer (never overwritten). (Assert via the HTML containing
   the first value and not the second, or add a targeted read — simplest: grep the HTML.)
2. **Referrer only on creation via auto-register:** hit `GET /api/players/notaref/active-ship` (auto-
   registers with no referrer) → `/admin` shows that player with an empty referrer cell.
3. **Aggregates:** register `p_stats`, `POST /api/games` twice with known `kills`/`durationMs`/`credits`
   → `/admin` HTML contains the summed kills/time/earned and `games_played = 2`.
4. **Auth required:** `GET /admin` with no `Authorization` → **401** and a `WWW-Authenticate` header.
5. **Auth rejects bad creds:** wrong password → **401**.
6. **Auth accepts good creds:** `Authorization: Basic base64('admin:secret')` → **200**, body contains
   `<table` and the seeded players.
7. **Disabled → 404:** this one is awkward in-process (env is set for the suite). Cover it as a **unit
   test of `adminEnabled()`/`checkAuth`** by importing `admin.js` directly with the env vars temporarily
   deleted, OR add a dedicated tiny test file `server/src/admin.test.js` that imports `mountAdmin` on a
   throwaway express app with `ADMIN_USER` unset and asserts 404. Prefer the dedicated file so the main
   suite's env stays set.

Basic-auth header helper:
```js
const adminAuth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };
```

Run:
- SQLite: `cd server && npm test`
- Postgres parity: `cd server && npm run test:pg` (or the documented Postgres pass) — **required** because
  the new SUM/BIGINT coercion and the `email_verified` INTEGER→bool cast are exactly the class of bug
  SQLite hides (MEMORY: backend-parity-sqlite-postgres).

### Client — `cd client && node --test`

No new logic worth a unit test beyond `referrerPayload` shaping. Optional: if the implementer factors
`referrerPayload` into a pure exported helper, add a tiny test asserting it omits empty keys and includes
`ref`/UTM. Not required (keep it simple); the existing client tests must still pass.

## Docs to update

- **`docs/SUMMARY.md`** — in the **Backend** section:
  - Add `players.referrer` (nullable TEXT, write-once at creation, compact JSON of `document.referrer` +
    `?ref=`/UTM, ≤512 chars) to the data-model description of `players`.
  - Note the new **`/admin`** page (server-rendered players + per-player game aggregates, HTTP Basic Auth
    via `ADMIN_USER`/`ADMIN_PASSWORD`, 404 when unset) and the `getAdminPlayers` datastore fn +
    `server/src/admin.js` in the file map.
  - Note `registerPlayer` now takes an optional `referrer` (written only on INSERT) and that the client
    calls `POST /api/players/register` once at boot (previously unused by the client).
  - Bump migration count / highest migration to `018` and add it to the migrations list.
  - Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`** — one bullet under today's date (`## 2026-07-02`): **Admin panel + referrer
  capture** — new `/admin` dashboard (players + aggregated stats, Basic Auth), new write-once
  `players.referrer` column (migration 018 / PG bootstrap), client sends `document.referrer`/`?ref=`/UTM
  at boot.
- **`docs/DECISIONS.md`** — add a numbered entry only if a real trade-off is worth recording. There is one
  small one: **admin auth = env-gated HTTP Basic + 404-when-unset (no admin user table, no session)** —
  simplest thing that is safe on prod for a single maintainer (DECISIONS §30). Add a short entry noting
  Basic Auth over a bespoke admin login, and referrer stored as one opaque JSON TEXT column (not parsed
  per-param columns) because it's for eyeballing, not querying.

## Out of scope / non-goals (DECISIONS §30 — don't gold-plate)

- **No** pagination, server-side sorting, search, filtering, or CSV export (client-side click-to-sort
  only).
- **No** `/api/admin/*` JSON endpoints — the HTML page embeds its own data. (Basic Auth is written to
  protect any future `/api/admin/*`, but none are added now.)
- **No** per-param referrer columns, no UTM analytics/rollups, no backfill of existing players' referrers.
- **No** charts, no live refresh, no editing/deleting players from the panel (read-only view).
- **No** rate limiting or lockout on `/admin` beyond Basic Auth.
- **No** change to how `games`/aggregates are recorded — read the existing `games` table as-is.
