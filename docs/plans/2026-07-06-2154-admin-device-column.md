# Admin dashboard — "device" column (browser · device model, best-effort)

**Feature ID:** 2026-07-06-2154-admin-device-column

## Goal

Add a **"device"** column to the private `GET /admin` dashboard showing, for each player, the fullest
label we can derive about what they played from — best case `Chrome · Samsung Galaxy A03s`, degrading to
`Chrome · Android 10`, then to the raw User-Agent, then to blank — never crashing on odd/empty UAs. Two
new nullable columns on `players` (`user_agent`, `device_model`) are captured at the boot
`POST /api/players/register` call (the same path that already captures `referrer`), so the data covers
**every** player, anonymous included — not just account-holders. The device model on modern Android is not
in the UA string (Chrome's UA Reduction hides it), so the server opts in to the `Sec-CH-UA-Model` Client
Hint via an `Accept-CH` response header and stores the hinted device **code**; `admin.js` maps common
codes to marketing names at render time. This is a maintainer-only visibility feature; there is no
user-visible change in the game itself.

## Decisions (all settled — do not re-ask)

1. **Coverage — capture at boot register, store on `players`.** The UA + model hint are read from the
   request headers of the existing `POST /api/players/register` call and stored on the `players` row.
   `sessions.user_agent` is **not** used (it only exists for account-holders; most players are anonymous).
2. **Client Hints — yes, best-effort.** The server sends
   `Accept-CH: Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version` on **every** response
   (small middleware). Chromium browsers then attach `Sec-CH-UA-Model` (the device **code**, e.g.
   `"SM-A037F"`) to subsequent same-origin requests — including the boot register fetch, so it works from
   the **first same-origin (prod) visit** onward. Non-Chromium browsers (Safari/Firefox) ignore it; the
   **cross-origin itch.io embed** won't get the hint (no delegation) → those visits degrade to UA-only. No
   retroactive recovery for existing rows (they stay NULL until the player next boots). This is accepted.
3. **Model name — curated hand-rolled lookup + raw-code fallback. NO new npm dependency.** A small
   `DEVICE_NAMES` map in `admin.js` (common Samsung / Pixel / Xiaomi / a few Apple codes → marketing
   names); unknown codes render as the raw code. UA→browser/OS parsing is also hand-rolled (a few robust
   regexes, null on junk). All parsing/formatting happens **in `admin.js` at render time** so the label can
   improve later with **no migration/backfill**.
4. **Freshness — latest-wins.** Each boot register call overwrites `user_agent`/`device_model` with any
   **non-null** value it carries (via `COALESCE(?, col)` so a call that omits the info doesn't wipe a good
   prior value). This differs from `referrer`, which stays **write-once**.
5. **Storage — two nullable TEXT columns** on `players`: `user_agent` and `device_model` (the raw hinted
   code). One migration `021` for SQLite (migrations dir + `PRAGMA user_version` auto-bump) mirrored in the
   Postgres bootstrap (`db_postgres.js`).
6. **Column placement — last column** of the admin table (after `referrer`), so the positional
   `data-col` sort indices of the existing columns are unchanged.
7. **No client-side code change.** The browser attaches `User-Agent` and (after `Accept-CH`)
   `Sec-CH-UA-Model` automatically; `client/src/net.js registerBoot()` already POSTs to
   `/api/players/register`. Nothing to add on the client.

## Steps

### 1. Migration `021` — add `players.user_agent` + `players.device_model` (both backends)

The current highest migration is `020_item_rarity_color.js`; the next free number is **`021`** (the
coordinator's brief said "019" — that is stale; use 021). `migrate.js` derives `PRAGMA user_version` from
the numeric filename prefix, so the file name is the version.

**SQLite** — create `server/src/migrations/021_player_device.js`:

```js
// 021 — device capture (docs/plans/2026-07-06-2154-admin-device-column.md): the raw User-Agent plus the
// Sec-CH-UA-Model client-hint (device CODE, e.g. "SM-A037F") captured at the boot register call,
// latest-wins. Both nullable TEXT; admin.js parses them into a "Browser · Device/OS" label at render time
// (no backfill — existing rows stay NULL until the player next boots).
export const up = (db) => {
  db.exec(`ALTER TABLE players ADD COLUMN user_agent TEXT;`);
  db.exec(`ALTER TABLE players ADD COLUMN device_model TEXT;`);
};
```

Nullable `ADD COLUMN` with no default is legal in SQLite (same as `018_player_referrer.js`).

**Postgres** — in `server/src/db_postgres.js` `migrate()`: add the two columns to the `CREATE TABLE IF NOT
EXISTS players (...)` body (lines 12–20, next to `referrer`) **and** add idempotent ALTERs right after the
existing `referrer` ALTER at **line 23**:

```sql
    ALTER TABLE players ADD COLUMN IF NOT EXISTS user_agent   TEXT;   -- raw UA from the boot register call (latest-wins)
    ALTER TABLE players ADD COLUMN IF NOT EXISTS device_model TEXT;   -- Sec-CH-UA-Model device code, latest-wins
```

### 2. `registerPlayer` — accept + persist device (latest-wins), both backends

Add a third arg `device = null` (shape `{ userAgent, model }`). Referrer stays write-once (INSERT only);
device is written on **both** paths with `COALESCE(?, col)` so a `null` never wipes a good prior value.

**`server/src/db.js`** — replace the function at **lines 74–86**:

```js
export function registerPlayer(id, referrer = null, device = null) {
  const now = Date.now();
  const ua = device && device.userAgent ? String(device.userAgent).slice(0, 512) : null;
  const model = device && device.model ? String(device.model).slice(0, 128) : null;
  const existing = db.prepare('SELECT created_at, games_played, current_progress, language, credits, shop_unlocked FROM players WHERE id = ?').get(id);
  if (existing) {
    // last_seen bump + latest-wins device (COALESCE keeps a prior value when this call has none); referrer never touched (write-once).
    db.prepare('UPDATE players SET last_seen = ?, user_agent = COALESCE(?, user_agent), device_model = COALESCE(?, device_model) WHERE id = ?').run(now, ua, model, id);
    ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: existing.games_played, currentProgress: existing.current_progress, language: existing.language, credits: existing.credits, shopUnlocked: !!existing.shop_unlocked, createdAt: existing.created_at };
  }
  const ref = referrer ? String(referrer).slice(0, 512) : null;   // safety cap
  db.prepare('INSERT INTO players (id, created_at, last_seen, referrer, user_agent, device_model) VALUES (?, ?, ?, ?, ?, ?)').run(id, now, now, ref, ua, model);
  ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, currentProgress: 1, language: 'en', credits: 1000, shopUnlocked: false, createdAt: now };
}
```

**`server/src/db_postgres.js`** — mirror it at **lines 266–278**:

```js
export async function registerPlayer(id, referrer = null, device = null) {
  const now = Date.now();
  const ua = device && device.userAgent ? String(device.userAgent).slice(0, 512) : null;
  const model = device && device.model ? String(device.model).slice(0, 128) : null;
  const { rows } = await pool.query('SELECT created_at, games_played, current_progress, language, credits, shop_unlocked FROM players WHERE id = $1', [id]);
  if (rows[0]) {
    await pool.query('UPDATE players SET last_seen = $1, user_agent = COALESCE($2, user_agent), device_model = COALESCE($3, device_model) WHERE id = $4', [now, ua, model, id]);
    await ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: rows[0].games_played, currentProgress: rows[0].current_progress, language: rows[0].language, credits: rows[0].credits, shopUnlocked: !!rows[0].shop_unlocked, createdAt: Number(rows[0].created_at) };
  }
  const ref = referrer ? String(referrer).slice(0, 512) : null;
  await pool.query('INSERT INTO players (id, created_at, last_seen, referrer, user_agent, device_model) VALUES ($1, $2, $3, $4, $5, $6)', [id, now, now, ref, ua, model]);
  await ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, currentProgress: 1, language: 'en', credits: 1000, shopUnlocked: false, createdAt: now };
}
```

`datastore.js:8` re-exports `registerPlayer` with `(...a)`, so the new arg passes through — **no change to
`datastore.js`**. All other auto-register callers (`getActivePlayerShip`, level, games, etc.) call
`registerPlayer(playerId)` with no device → `device` is `null` → `COALESCE` preserves the existing UA.

### 3. `getAdminPlayers` — select + map the two new columns (both backends + shapes)

**`server/src/db.js`** `getAdminPlayers` (lines 304–322): add `p.user_agent, p.device_model` to the SELECT
list and to the mapped object:

```js
    SELECT p.id, p.username, p.email, p.email_verified, p.created_at, p.last_seen,
           p.current_progress, p.credits, p.games_played, p.referrer, p.user_agent, p.device_model,
           COALESCE(SUM(g.duration_ms), 0) AS total_time_ms,
```
```js
      referrer: r.referrer ?? null,
      userAgent: r.user_agent ?? null, deviceModel: r.device_model ?? null,
      totalTimeMs: Number(r.total_time_ms), totalKills: Number(r.total_kills), totalEarned: Number(r.total_earned),
```

**`server/src/db_postgres.js`** `getAdminPlayers` (lines 471–489): make the **identical** SELECT + mapping
edits (same column names; these are plain TEXT so no `Number()` coercion needed):

```js
    SELECT p.id, p.username, p.email, p.email_verified, p.created_at, p.last_seen,
           p.current_progress, p.credits, p.games_played, p.referrer, p.user_agent, p.device_model,
           COALESCE(SUM(g.duration_ms), 0) AS total_time_ms,
```
```js
    referrer: r.referrer ?? null,
    userAgent: r.user_agent ?? null, deviceModel: r.device_model ?? null,
    totalTimeMs: Number(r.total_time_ms), totalKills: Number(r.total_kills), totalEarned: Number(r.total_earned),
```

### 4. `server.js` — send `Accept-CH` + read the hint in the register route

**(a) `Accept-CH` middleware.** Add a small app-level middleware so every response (including the static
`index.html`) advertises the hints. Place it immediately **before** `app.use(express.json());` (**line
54**):

```js
  // Ask Chromium browsers to send device Client Hints (UA Reduction hides the device model). The hints
  // arrive on subsequent same-origin requests — e.g. the boot POST /api/players/register — where we read
  // Sec-CH-UA-Model. Best-effort: other browsers ignore it; cross-origin (itch) isn't delegated the hint.
  // See docs/plans/2026-07-06-2154-admin-device-column.md.
  app.use((req, res, next) => {
    res.setHeader('Accept-CH', 'Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version');
    next();
  });
```

**(b) Register route** (lines 77–83): read the UA + the model hint and forward as the `device` arg. The
`Sec-CH-UA-Model` value is an RFC-8941 string, i.e. wrapped in double-quotes (`"SM-A037F"`) — strip them:

```js
  app.post('/api/players/register', wrap(async (req, res) => {
    const { playerId, referrer } = req.body || {};
    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({ error: 'playerId (string) required' });
    }
    const model = String(req.headers['sec-ch-ua-model'] || '').replace(/"/g, '').trim() || null; // client-hint device code
    const device = { userAgent: req.headers['user-agent'] || null, model };
    res.json(await registerPlayer(playerId, typeof referrer === 'string' ? referrer : null, device));
  }));
```

No other call sites change. `getAdminPlayers` is already imported and `mountAdmin(app, getAdminPlayers)`
(line 406) already wires it — no change there.

### 5. `admin.js` — device-label parser + render the column

Add, after the existing `fmtDate` helper (**line 36**), the curated map + parsers, exported so tests can
unit-check them:

```js
// Curated device-code → marketing-name lookup for the Sec-CH-UA-Model client hint (which returns a device
// CODE, e.g. "SM-A037F", not "Galaxy A03s"). Best-effort convenience — extend as new devices appear;
// unknown codes fall through to the raw code. No dependency (DECISIONS §55).
const DEVICE_NAMES = {
  // Samsung Galaxy (SM-*)
  'SM-A037F': 'Galaxy A03s', 'SM-A125F': 'Galaxy A12', 'SM-A155F': 'Galaxy A15',
  'SM-A515F': 'Galaxy A51', 'SM-A536B': 'Galaxy A53', 'SM-A546B': 'Galaxy A54',
  'SM-G991B': 'Galaxy S21', 'SM-S911B': 'Galaxy S23', 'SM-S918B': 'Galaxy S23 Ultra',
  // Xiaomi / Redmi
  '2201117TY': 'Redmi Note 11', '23021RAAEG': 'Redmi Note 12',
  // Apple (rarely populated — Safari/iOS don't send this hint; here for completeness)
  'iPhone14,5': 'iPhone 13', 'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
  // (Google Pixel already returns its marketing name as the "code", e.g. "Pixel 8" — no mapping needed.)
};

// Best-effort UA → browser name. Order matters: Edge/Opera/Samsung masquerade as Chrome, and Chrome
// masquerades as Safari. Returns null on empty/junk.
export function parseBrowser(ua) {
  if (!ua) return null;
  if (/EdgA?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  return null;
}

// Best-effort UA → OS/platform label (with version where the UA exposes it). Returns null on empty/junk.
export function parseOS(ua) {
  if (!ua) return null;
  let m;
  if ((m = /Android \d+(?:\.\d+)?/.exec(ua))) return m[0];                                  // "Android 10"
  if ((m = /(?:iPhone|iPad); CPU (?:iPhone )?OS (\d+)[._](\d+)/.exec(ua))) return `iOS ${m[1]}.${m[2]}`;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

// Compose the fullest label we can: "Browser · Model" (best), "Browser · OS", "Browser", "OS", the raw UA
// (truncated), or '' — never throws. `model` is the raw Sec-CH-UA-Model code (may be null/empty).
export function deviceLabel(userAgent, model) {
  const ua = userAgent || '';
  const browser = parseBrowser(ua);
  const name = model ? (DEVICE_NAMES[model] || model) : null;   // marketing name or raw code
  const right = name || parseOS(ua);
  if (browser && right) return `${browser} · ${right}`;
  if (browser) return browser;
  if (right) return right;
  return ua.slice(0, 200);   // unparseable → raw UA (may be '')
}
```

**Render the column** (last column). In `renderPage` (lines 41–56), add a cell after the `referrer` `<td>`
(line 55). `title` carries the full raw UA on hover; the visible text is escaped:

```js
      <td class="ref"><code>${esc(p.referrer)}</code></td>
      <td class="device" title="${esc(p.userAgent)}">${esc(deviceLabel(p.userAgent, p.deviceModel))}</td>
    </tr>`).join('');
```

Add `'device'` to the end of the `headers` array (line 57–58):

```js
  const headers = ['id', 'username', 'email', 'verified', 'created', 'last seen', 'progress', 'credits',
    'games', 'time played', 'kills', 'earned', 'referrer', 'device'];
```

Add a CSS rule next to `td.ref` (line 71) so long labels wrap:

```css
      td.device { max-width: 260px; word-break: break-word; color: #cbd5e1; }
```

The existing inline column-sort script is index-driven and needs no change — the new header/cell are at
the same trailing index in both `headers` and each `<tr>`.

## Tests

### Server — `server/src/server.test.js` (runs on BOTH SQLite and Postgres)

Admin env + helpers already exist (`ADMIN_USER`/`ADMIN_PASSWORD` at lines 11–12; `post(p, body, headers)`,
`get(p, headers)`, `adminAuth` at lines 38–42). Add near the other admin tests (~line 990+).

**(a) Pure `deviceLabel` parse-ladder unit tests** — import the parser at the top of the file
(`import { deviceLabel } from './admin.js';`) and assert:

- Android Chrome + known code →
  `deviceLabel('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', 'SM-A037F')` === `'Chrome · Galaxy A03s'`
- Android Chrome + **unknown** code (same UA, `'SM-ZZZZ'`) === `'Chrome · SM-ZZZZ'` (raw-code fallback)
- Android Chrome + **no** model (same UA, `null`) === `'Chrome · Android 10'`
- Desktop Chrome/Windows →
  `deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', null)` === `'Chrome · Windows'`
- iPhone Safari →
  `deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', null)` === `'Safari · iOS 17.4'`
- Empty/junk: `deviceLabel('', null)` === `''`; `deviceLabel('!!!garbage!!!', null)` === `'!!!garbage!!!'`
  (asserts it never throws and returns a string).

**(b) Integration — capture + render + latest-wins.** Use the header-passing `post`:

```js
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// 1) first boot: Android + model hint (quoted, as browsers send it)
await post('/api/players/register', { playerId: 'devx' }, { 'user-agent': ANDROID_UA, 'sec-ch-ua-model': '"SM-A037F"' });
let html = await (await get('/admin', adminAuth)).text();
assert.ok(html.includes('Chrome · Galaxy A03s'));
// 2) latest-wins: same player boots on desktop (no model hint) → label updates, model cleared to OS
await post('/api/players/register', { playerId: 'devx' }, { 'user-agent': DESKTOP_UA });
html = await (await get('/admin', adminAuth)).text();
assert.ok(html.includes('Chrome · Windows'));
```

> Note on latest-wins in step 2: `COALESCE` preserves the prior `device_model` when a call omits the hint,
> so `device_model` stays `'SM-A037F'` while `user_agent` becomes the desktop UA. `deviceLabel` prefers the
> model, so the label would still read `Chrome · Galaxy A03s`. To make the desktop switch visible in this
> test, either (i) assert on `user_agent`/`device_model` via a targeted admin-HTML substring that includes
> the new UA, **or** (ii) send an explicit empty hint on the desktop call (`'sec-ch-ua-model': '""'`) — the
> route strips quotes to `''` → `null`, and `COALESCE` keeps the old model. Prefer approach (i): assert the
> HTML now contains `DESKTOP_UA` (it's in the cell `title=`), which proves the UA was overwritten. Keep the
> `Chrome · Galaxy A03s` label assertion in step 1 only. (Implementer: pick whichever keeps the test
> honest; do not assert `Chrome · Windows` unless you also clear the model.)

**(c) Anonymous coverage / no-hint:** `GET /api/players/notdev/active-ship` (auto-registers with **no**
device) → `/admin` shows that player row with an **empty** device cell (no crash on null UA).

Run:
- SQLite: `cd server && npm test`
- Postgres parity: `cd server && npm run test:pg` — **required**: the new columns + `COALESCE` UPSERT +
  the extra SELECT columns must behave identically on Postgres (MEMORY: backend-parity-sqlite-postgres).

### Client — `cd client && node --test`

No client code changes → no new client test. The existing client suite must still pass.

## Docs to update

- **`docs/SUMMARY.md`**:
  - In the admin/referrer sentence (~lines 116–119): note the new **device** column — `/admin` now shows a
    best-effort `Browser · Device/OS` label per player, and that `players` gained nullable `user_agent` +
    `device_model` columns captured at the boot register call (latest-wins), via an `Accept-CH:
    Sec-CH-UA-Model` response header + the `Sec-CH-UA-Model` client hint; parsing/curated code→name lookup
    lives in `server/src/admin.js` (`deviceLabel`).
  - In the Backend data-model description of `players`, add `user_agent` + `device_model` (nullable TEXT,
    latest-wins; `device_model` is the raw Sec-CH-UA-Model device code).
  - Bump the highest migration to **`021`** and add it to the migrations list.
  - Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`** — one bullet under `## 2026-07-06`: **Admin "device" column** — `/admin` now
  shows the browser + device model each player played from (best-effort `Chrome · Galaxy A03s`, degrading
  to `Chrome · Android 10` → raw UA → blank); new nullable `players.user_agent`/`device_model` (migration
  021 / PG bootstrap) captured at boot via an `Accept-CH: Sec-CH-UA-Model` header + client hint,
  latest-wins; curated code→name lookup + hand-rolled UA parser in `server/src/admin.js`, no new deps.
- **`docs/DECISIONS.md`** — add **§55**: *Admin device label = hand-rolled UA parse + curated
  code→marketing-name lookup, no dependency.* Record the trade-off: we skip `ua-parser-js`/a full device DB
  (DECISIONS §30 keep-it-simple, and the admin panel's no-new-deps precedent) and accept a small curated
  map with raw-code fallback; the model comes from the `Sec-CH-UA-Model` client hint (opt-in via
  `Accept-CH`), so it only works for Chromium **same-origin** visits going forward (no retroactive data, no
  model from Safari/Firefox or the cross-origin itch embed) — a deliberately partial, best-effort signal
  for eyeballing, not analytics. Raw values are stored and all parsing is at render time so the label can
  improve without a migration/backfill.

## Out of scope / non-goals (DECISIONS §30 — don't gold-plate)

- **No** npm dependency (no `ua-parser-js`, no device database). Curated map + regexes only.
- **No** backfill of existing rows and **no** use of `sessions.user_agent`; existing players stay NULL
  until they next boot on a same-origin build.
- **No** exhaustive device coverage — the `DEVICE_NAMES` map is a small starter set; unknown codes show the
  raw code, and that is fine.
- **No** storing/parsing of `Sec-CH-UA-Platform` / `Sec-CH-UA-Platform-Version` beyond requesting them in
  `Accept-CH` (we store only the model code + raw UA; OS/version come from the UA at render time).
- **No** `Critical-CH` retry, no per-session device history, no new admin columns for browser/OS split, no
  filtering/analytics/CSV. One display column, sortable by the existing generic sort.
- **No** client-side code change (the browser sends the headers automatically).
