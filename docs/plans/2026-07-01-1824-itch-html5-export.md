# itch.io HTML5 export — an "Online" build that points at the live server

**Feature ID:** 2026-07-01-1824-itch-html5-export
**Status:** planned (implementer picks this up with no other context — everything needed is here)

## Goal

Ship an **itch.io HTML5 export** of Vega Sentinels: a static ZIP (with `index.html` at its root) that
runs inside itch.io's iframe and talks to the **existing production backend** at
`https://vega.tenony.com`. Today the client and API are served from **one origin** (so all client code
calls `/api/...` with relative paths, and the auth session rides an httpOnly cookie). itch.io serves only
static files from a rotating CDN origin, so a copy of the client running there must (a) call the API on an
**absolute** cross-origin base, (b) get **CORS** headers from the server, and (c) authenticate **without a
third-party cookie** (bearer token in `localStorage`). The user-visible effect: players can open the game
on its itch.io page, play as a guest immediately, **and** log into their real account — progress syncs
against the same production database. The normal same-origin deploy at `vega.tenony.com` must be
**completely unchanged** (relative URLs, cookie auth, no CORS needed).

## Decisions (all resolved — do not re-ask)

1. **Detection = a baked `api-base.js` module.** New file `client/src/api-base.js` exports
   `export const API_BASE = ''`. Empty string = current same-origin relative behavior. The itch build
   script overwrites **only the itch copy** of that file with `export const API_BASE =
   'https://vega.tenony.com'`. No runtime hostname sniffing (itch serves from rotating
   `*.itch.zone`/`*.hwcdn.net` subdomains and `file://` has an empty hostname — all fragile); no itch
   domain allowlist needed; the prod deploy ships `''` untouched.
2. **CORS = reflect any origin, WITHOUT credentials.** Because auth moves to bearer tokens, we do **not**
   set `Access-Control-Allow-Credentials`. This keeps CSRF off the table (no cookies ride cross-origin) and
   lets us safely reflect the request `Origin` (equivalent to `*`).
3. **Auth = bearer tokens (dual-path, additive).** Login/register/reset responses **also** return the raw
   session token in the JSON body; the server accepts the token from **either** the existing
   `session` cookie **or** an `Authorization: Bearer <token>` header. The same-origin site keeps working on
   the cookie exactly as before. The client stores the token in `localStorage['authToken']` and sends it as
   a bearer header. **Security note:** a bearer token in `localStorage` is XSS-exposed like any SPA token —
   accepted here (game progress only, no sensitive data; maintainer's stated risk acceptance). No
   credentials on CORS keeps CSRF off the table.
4. **Build = system `zip` via `child_process`.** New `scripts/build-itch.mjs`, root npm alias
   `build:itch`. Run **manually**, not wired into CI. Output `dist/vega-sentinels-itch.zip` (already
   `.gitignore`d — see the `dist/` line in `.gitignore`).
5. **Docs:** SUMMARY subsection + CHANGELOG bullet (dated 2026-07-01) + a DECISIONS entry.

---

## Steps

### Step 1 — New client module `client/src/api-base.js`

Create `client/src/api-base.js`:

```js
// The base URL every /api call is prefixed with. Empty string = same-origin relative (the normal
// deploy at vega.tenony.com, where the client and API share one origin — see server/src/server.js).
// The itch.io build (scripts/build-itch.mjs) OVERWRITES this file's copy in the ZIP with the absolute
// production origin, because on itch the client runs on itch's CDN and must call the API cross-origin.
// Do NOT sniff the hostname at runtime (itch uses rotating *.itch.zone / *.hwcdn.net subdomains);
// the value is baked at build time. See docs/plans/2026-07-01-1824-itch-html5-export.md.
export const API_BASE = '';
```

The build script (Step 6) replaces the whole file with the same content but
`export const API_BASE = 'https://vega.tenony.com';`. Keep the file to this exact shape (a single
exported `const` on its own line) so a naive full-file overwrite is trivial and robust.

### Step 2 — Prefix every client `/api` fetch site with `API_BASE`

**`client/index.html` has zero `/api` calls** (the ESM split moved them all into `client/src/*.js`) — do
not touch it. Below is the **complete** list of fetch sites. `client/src/audio.js:139` `fetch(url)` fetches
**content-hashed sound assets** (relative/CloudFront URLs, not `/api`) — **leave it unprefixed**.

**2a. `client/src/net.js`** — add the import at the top (near line 7, alongside the existing
`import { G, CATALOG } from './state.js';`):

```js
import { API_BASE } from './api-base.js';
```

Then:
- **`fetchJson` (line 13-17)** — prefix **only `/api` URLs** inside the helper, so all its `/api` callers
  are covered at once **without** rewriting its **non-`/api`, relative** callers:
  ```js
  export const fetchJson = async (url) => {
    // Prefix API_BASE for /api calls only. `fetchJson` is ALSO used for bundled same-origin assets
    // (client/src/i18n.js loadLanguage fetches 'locales/source.json' + `locales/${lang}.json`), which
    // MUST stay relative — on the itch build they load same-origin from the ZIP, and /locales gets no
    // CORS header (CORS is scoped to /api). Prefixing those would produce a malformed cross-origin URL.
    const r = await fetch(url.startsWith('/api') ? API_BASE + url : url);
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return r.json();
  };
  ```
  **Do NOT unconditionally prefix.** `client/src/i18n.js:48-49` (`loadLanguage`, called from
  `main.js:459` and `welcome.js:97`) calls this same `fetchJson` with **relative, non-`/api`** paths
  `'locales/source.json'` and `` `locales/${current}.json` ``; those must pass through untouched (the
  `source.json` load has no `.catch`, so a malformed URL would break i18n bootstrap on itch — the exact
  target platform). With the `startsWith('/api')` guard, every `/api/...` caller is prefixed and every
  bundled-asset caller stays relative. This guard is the single place both kinds of URL flow through — no
  other shared helper mixes `/api` and non-`/api` paths (`authFetch` in `account.js` is auth-only `/api`).
- **line 27** `fetch('/api/games', …)` → `fetch(API_BASE + '/api/games', …)`
- **line 47** `navigator.sendBeacon('/api/events', …)` → `navigator.sendBeacon(API_BASE + '/api/events', …)`
- **line 49** `fetch('/api/events', …)` → `fetch(API_BASE + '/api/events', …)`
- **line 62** `fetch(\`/api/players/${G.playerId}/advance\`, …)` → `fetch(API_BASE + \`/api/players/${G.playerId}/advance\`, …)`
- Update the module comment at the top of `net.js` (lines 3-4, "Served same-origin, so the API is always
  reachable via relative /api URLs.") to note that URLs are now prefixed with `API_BASE` (empty on the
  same-origin deploy, the prod origin on the itch build).

**2b. `client/src/main.js`** — add `import { API_BASE } from './api-base.js';` near the existing
`import { fetchJson, … } from './net.js';` (line 16). Then:
- **line 299** `navigator.sendBeacon('/api/perf', …)` → `navigator.sendBeacon(API_BASE + '/api/perf', …)`
- **line 300** `fetch('/api/perf', …)` → `fetch(API_BASE + '/api/perf', …)`
- Lines 466-491 all go through `fetchJson` → **already covered** by 2a (no edit).

**2b-bis. `client/src/mainwindow.js`** — **line 161** `fetchJson(\`/api/players/${G.playerId}/missions\`)`
goes through `fetchJson` → **already covered** by the 2a helper guard (no edit needed; listed here so the
completeness claim holds).

**2c. `client/src/shop.js`** — add the import; **line 261** `fetch(\`/api/players/${G.playerId}/${path}\`, …)`
→ `fetch(API_BASE + \`/api/players/${G.playerId}/${path}\`, …)`. Line 296 uses `fetchJson` (covered).

**2d. `client/src/settings.js`** — add the import; **line 131**
`fetch(\`/api/players/${G.playerId}/reset\`, …)` → `fetch(API_BASE + \`/api/players/${G.playerId}/reset\`, …)`.

**2e. `client/src/welcome.js`** — add the import; **line 104**
`fetch(\`/api/players/${G.playerId}/language\`, …)` → `fetch(API_BASE + \`/api/players/${G.playerId}/language\`, …)`.

**2f. `client/src/account.js`** — bearer-token + base handling (details in Step 3). This covers the
`authFetch` sites (lines 136, 167, 183, 205, 223, 258, 269), `/api/auth/me` (289), `/api/config` (315), and
the `fetchJson` sites (242, 244, 248 — covered by 2a).

**Telemetry `sendBeacon` caveat (note in the plan, not a blocker):** `/api/events` and `/api/perf` beacons
carry `Content-Type: application/json` (non-CORS-safelisted), so a **cross-origin** beacon may be dropped
by some browsers (beacons can't do a preflight). This is **best-effort telemetry only** — gameplay is
unaffected, and both call sites already fall back to `fetch(..., { keepalive: true })` which the CORS
middleware (Step 5) fully supports. Do **not** add complexity to "fix" beacons; just prefix the URL.

### Step 3 — Client bearer-token auth (`client/src/account.js`)

At the top of `account.js`, add the import (alongside the existing `import { fetchJson } from './net.js';`,
line 10):

```js
import { API_BASE } from './api-base.js';
```

Add a token-storage helper near the top (after the imports / before `authFetch`):

```js
const AUTH_TOKEN_KEY = 'authToken'; // bearer session token for cross-origin (itch) auth; see DECISIONS
const getAuthToken = () => { try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; } };
const setAuthToken = (tok) => { try { tok ? localStorage.setItem(AUTH_TOKEN_KEY, tok) : localStorage.removeItem(AUTH_TOKEN_KEY); } catch {} };
```

Rewrite `authFetch` (lines 38-40) to prefix `API_BASE`, attach the bearer header when present, and keep
`credentials: 'include'` (harmless same-origin; ignored cross-origin since the server doesn't allow
credentials):

```js
// Auth requests: prefix API_BASE (empty same-origin, prod origin on the itch build). Send the bearer
// token from localStorage when we have one (the cross-origin itch path — third-party cookies are
// unreliable) AND keep credentials:'include' so the same-origin cookie still rides along.
const authFetch = (path, opts = {}) => {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const { headers: _drop, ...rest } = opts; // headers already merged above; don't let ...opts clobber them
  return fetch(API_BASE + path, { credentials: 'include', headers, ...rest });
};
```

Persist the token on every auth success (the server now returns `token` in the body — Step 4):
- **`doRegister` (line ~171)**: after `accountPlayer = j;` add `if (j.token) setAuthToken(j.token);`
- **`doLogin` (line ~187)**: after `accountPlayer = j;` add `if (j.token) setAuthToken(j.token);`
- **`doReset` (line ~226)**: after `accountPlayer = j;` add `if (j.token) setAuthToken(j.token);`

Clear it on logout — **`logout` (line ~258)**: after the `authFetch('/api/auth/logout', …)` call, add
`setAuthToken(null);` (before or after clearing `accountPlayer`, either order).

Route `/api/auth/me` and `/api/config` through the new base/bearer:
- **`restoreSession` (line 289)**: replace
  `const me = await fetch('/api/auth/me', { credentials: 'include' });` with
  `const me = await authFetch('/api/auth/me');` (a GET; `authFetch` supplies base + bearer + credentials).
- **`initSentry` (line 315)**: replace `fetch('/api/config')` with `fetch(API_BASE + '/api/config')`.

Update the module header comment (lines 3-4, "The session rides on an httpOnly cookie, so all calls send
credentials.") to note the dual-path: same-origin uses the cookie, cross-origin (itch) uses a bearer token
stored in `localStorage`.

### Step 4 — Server: return the token + accept it as a bearer (dual-path)

**No `db.js` / `db_postgres.js` change is needed** — the session token, its SHA-256 hashing, and
`createSession`/`getSessionPlayer`/`deleteSession` are identical across both backends and already carry
everything. We only (a) also **return** the raw token and (b) also **read** it from a header. Both changes
live in the backend-agnostic layer (`server/src/auth.js` + `server/src/server.js`), so parity is preserved
by construction. Still run **both** SQLite and Postgres test passes (Step 7).

**4a. `server/src/auth.js` — accept a bearer token.** Replace `sessionTokenFromReq` (lines 76-79) so it
checks the `Authorization: Bearer` header first, then falls back to the cookie:

```js
// Read the raw session token from a request: an Authorization: Bearer header (the cross-origin itch
// path) OR the session cookie (the same-origin site). Header first so an explicit bearer wins.
export function sessionTokenFromReq(req) {
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}
```

This one change covers **both** consumers automatically: `makeRequireAuth` (auth.js, used by `/api/auth/me`
and `/api/auth/resend-verification`) and the `logout` route (server.js, line 277). No other edit to
`auth.js`.

**4b. `server/src/server.js` — return the token from `startSession`.** Change `startSession` (lines
220-224) to return the raw token:

```js
const startSession = async (res, playerId, req) => {
  const token = newSessionToken();
  await createSession(playerId, hashToken(token), req.headers['user-agent']);
  setSessionCookie(res, token); // keep the cookie for the same-origin site (backward-compat)
  return token;                 // also hand it back so the JSON body can carry it (cross-origin bearer)
};
```

Include the token in the three auth responses that open a session:
- **register (line 258-259)** — the current code is `await startSession(res, playerId, req); res.json(player);`;
  `player` is the `registerAccount(...)` result (a plain player object), so it spreads cleanly:
  ```js
  const token = await startSession(res, playerId, req);
  res.json({ ...player, token });
  ```
- **login (line 271-272)**:
  ```js
  const token = await startSession(res, row.id, req);
  res.json({ ...(await getPlayerPublic(row.id)), token });
  ```
- **reset-password (line 328-329)**:
  ```js
  const token = await startSession(res, playerId, req);
  res.json({ ...(await getPlayerPublic(playerId)), token });
  ```

`/api/auth/me` (line 284) returns `req.player` **without** a token — it's read-only and the client already
holds the token; do not add it there.

### Step 5 — Server: CORS middleware (reflect origin, no credentials)

In `server/src/server.js`, add a small CORS middleware **scoped to `/api`**, mounted right after
`app.use(express.json());` (line 53) and **before** the routes. It must sit before the routes so the
`OPTIONS` preflight is answered, and it is scoped to `/api` so the static client serving (line 377,
`app.use(express.static(clientDir))` — only relevant on the same-origin deploy) is untouched.

```js
// CORS for the cross-origin itch.io build (docs/plans/2026-07-01-1824-itch-html5-export.md). We reflect
// the request Origin and do NOT allow credentials — the itch client authenticates with a bearer token,
// never a cookie, so no credentials cross the boundary and CSRF stays off the table. Scoped to /api so
// the same-origin static client serving is unaffected. Same-origin requests carry no Origin header and
// are unchanged.
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.status(204).end(); // preflight
  next();
});
```

Notes for the implementer:
- We reflect the Origin (rather than a literal `*`) so the header is well-formed and future-proof if
  credentials were ever added; either is equivalent here since credentials are off.
- Do **not** set `Access-Control-Allow-Credentials`. Adding it while reflecting an arbitrary origin is the
  thing to avoid.
- `Vary: Origin` keeps any cache from serving one origin's CORS header to another.

### Step 6 — Build script `scripts/build-itch.mjs` + npm alias

Create `scripts/build-itch.mjs` (ESM, Node ≥ 18, no new dependency — uses `node:fs`, `node:path`,
`node:child_process`). It:

1. Resolves repo root from `import.meta.url` (the script lives in `scripts/`; root is `..`).
2. Builds a clean staging dir at `dist/itch-staging/` (remove if present, recreate).
3. Copies this **allowlist** from `client/` into the staging root (so `index.html` is at the ZIP root):
   - `index.html`, `styles.css`, `favicon.svg`
   - `src/` (recursive) — **exclude** any `*.test.js`
   - `locales/` (recursive)
   - `assets/` (recursive) — the combat `.glb`s + sounds already present in the working tree
   Use `fs.cpSync(src, dest, { recursive: true, filter })` with a filter that drops `*.test.js`,
   `.DS_Store`, and `node_modules`. Do **not** copy `client/package.json`, `client/package-lock.json`,
   `client/visual/` (dev/test only).
4. Overwrites `dist/itch-staging/src/api-base.js` with the prod variant:
   ```js
   const PROD = "export const API_BASE = 'https://vega.tenony.com';\n";
   // (prepend the same header comment as the source file for clarity — optional)
   fs.writeFileSync(path.join(staging, 'src', 'api-base.js'), PROD);
   ```
5. Zips the **contents** of the staging dir (so paths are relative, `index.html` at root) via the system
   `zip` binary:
   ```js
   execFileSync('zip', ['-r', '-X', '-q', path.resolve(root, 'dist/vega-sentinels-itch.zip'), '.'],
     { cwd: staging, stdio: 'inherit' });
   ```
   Delete any pre-existing `dist/vega-sentinels-itch.zip` first (`zip` appends to an existing archive).
6. Verifies + prints:
   - file count (`unzip -l` parse, or count files walked while copying) and total extracted byte size;
   - **assert** `fileCount <= 1000` and `extractedBytes <= 500 * 1024 * 1024`, throwing (non-zero exit)
     if either is exceeded (itch limits — client is ~14 MB / a few hundred files, so this is a guard, not
     a real constraint);
   - print the final `dist/vega-sentinels-itch.zip` path + its on-disk size and the file count.
7. Optionally leaves `dist/itch-staging/` in place (it's under gitignored `dist/`), or removes it — either
   is fine; removing keeps `dist/` tidy.

Add the alias to the **root** `package.json` `scripts` block (after the `assets:*` entries):

```json
"build:itch": "node scripts/build-itch.mjs"
```

`dist/` is already `.gitignore`d (confirmed — the `dist/` line under `# Builds`), so no gitignore change is
needed. If the implementer prefers an explicit note, they may add a comment, but no new pattern is
required.

### Step 7 — Tests

**Server (`server/src/server.test.js`)** — the suite already boots the app on a random port and has a
`sessionCookie(res)` helper + `authHeader(token)` cookie helper (lines 40-48). Add tests proving the
bearer path while keeping the cookie path green:

1. **Register returns a token in the body; the bearer is accepted by `/api/auth/me`:**
   ```js
   test('auth: register returns a bearer token that /api/auth/me accepts (cross-origin path)', async () => {
     const j = await (await post('/api/auth/register',
       { playerId: 'bearer-1', email: 'bearer1@example.com', password: 'password123' })).json();
     assert.ok(j.token, 'register response carries a session token');
     const me = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${j.token}` } });
     assert.equal(me.status, 200);
     assert.equal((await me.json()).id, 'bearer-1');
   });
   ```
2. **Login returns a token; a bad bearer is 401:**
   ```js
   test('auth: login returns a bearer token; a bogus bearer is rejected', async () => {
     await post('/api/auth/register', { playerId: 'bearer-2', email: 'bearer2@example.com', password: 'password123' });
     const j = await (await post('/api/auth/login', { email: 'bearer2@example.com', password: 'password123' })).json();
     assert.ok(j.token);
     assert.equal((await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${j.token}` } })).status, 200);
     assert.equal((await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer nope' } })).status, 401);
   });
   ```
3. **Logout via bearer invalidates the session:**
   ```js
   test('auth: logout via Authorization header drops the session', async () => {
     const j = await (await post('/api/auth/register', { playerId: 'bearer-3', email: 'bearer3@example.com', password: 'password123' })).json();
     const h = { Authorization: `Bearer ${j.token}` };
     assert.equal((await fetch(base + '/api/auth/me', { headers: h })).status, 200);
     await post('/api/auth/logout', {}, h);
     assert.equal((await fetch(base + '/api/auth/me', { headers: h })).status, 401);
   });
   ```
4. **CORS preflight + reflected origin, no credentials:**
   ```js
   test('cors: /api reflects the Origin, allows Authorization, and never allows credentials', async () => {
     const pre = await fetch(base + '/api/ships', {
       method: 'OPTIONS',
       headers: { Origin: 'https://itch.zone', 'Access-Control-Request-Headers': 'authorization' },
     });
     assert.equal(pre.status, 204);
     assert.equal(pre.headers.get('access-control-allow-origin'), 'https://itch.zone');
     assert.match(pre.headers.get('access-control-allow-headers') || '', /authorization/i);
     assert.equal(pre.headers.get('access-control-allow-credentials'), null); // credentials OFF by design
     const get = await fetch(base + '/api/ships', { headers: { Origin: 'https://itch.zone' } });
     assert.equal(get.headers.get('access-control-allow-origin'), 'https://itch.zone');
   });
   ```
5. **Keep the existing cookie-path tests green** — the `me: authed returns the player…` test (line 497)
   and the reset-password session tests (lines ~558-566) must still pass unchanged (the cookie still gets
   set + accepted).

Run: `cd server && npm test` (SQLite) **and** `cd server && npm run test:pg` (Postgres) — both must pass
(parity). If Postgres isn't available locally, note in the PR that CI's Postgres pass covers it, but the
change touches no storage code so it's parity-safe by construction.

**Client (`cd client && node --test`)** — the existing pure-logic unit tests don't exercise `fetch`. No new
client test is required (the fetch prefixing is a mechanical wrap and `API_BASE=''` is a no-op for the
existing suite). Just confirm the client tests still pass after adding the `api-base.js` import.

**Build smoke (manual):** `npm run build:itch` from the repo root must produce
`dist/vega-sentinels-itch.zip` with `index.html` at the ZIP root and the staged `src/api-base.js`
containing the prod origin. Verify with `unzip -l dist/vega-sentinels-itch.zip | head` (index.html at
root) and `unzip -p dist/vega-sentinels-itch.zip src/api-base.js` (shows the prod `API_BASE`).

**CORS curl example (manual, against a running server):**
```
curl -i -X OPTIONS http://localhost:4000/api/ships \
  -H 'Origin: https://itch.zone' -H 'Access-Control-Request-Headers: authorization'
# → 204, Access-Control-Allow-Origin: https://itch.zone, Access-Control-Allow-Headers: Content-Type, Authorization
```

### Step 8 — Docs

**`docs/SUMMARY.md`** — add a new subsection (place it near the Backend/API section, wherever the API
surface + deploy are described) titled **"itch.io HTML5 export"** covering:
- The client fetches the API via `API_BASE` (`client/src/api-base.js`): empty string = same-origin
  relative (the normal `vega.tenony.com` deploy, client + API one origin); the itch build bakes
  `https://vega.tenony.com` into that one file.
- Auth is **dual-path**: same-origin uses the httpOnly `session` cookie (unchanged); cross-origin (itch)
  uses a **bearer token** returned in the login/register/reset JSON body, stored in
  `localStorage['authToken']`, sent as `Authorization: Bearer`. The server accepts either
  (`sessionTokenFromReq` reads the header then the cookie). Guest play works cross-origin with no auth (the
  gameplay/economy endpoints key off the localStorage `playerId`, not a cookie).
- CORS: `server/src/server.js` reflects the request `Origin` on `/api`, allows `Authorization`+`Content-Type`,
  answers `OPTIONS` with 204, and does **not** allow credentials (bearer auth ⇒ no cookies cross-origin ⇒
  no CSRF).
- How to produce it: `npm run build:itch` → `dist/vega-sentinels-itch.zip` (index.html at root; excludes
  tests/node_modules; asserts ≤1000 files / ≤500 MB). Upload steps: itch.io project → Kind of project =
  HTML → upload the ZIP → tick "This file will be played in the browser" → set the embed viewport → save.
  Limits: ≤1000 files, ≤500 MB extracted, ≤200 MB/file (client ~14 MB, well under).
- Bump the `**Updated:**` date line.

**`docs/CHANGELOG.md`** — add under a `## 2026-07-01` heading (create if missing), newest on top:
> **itch.io HTML5 export ("Online" build).** New `npm run build:itch` (`scripts/build-itch.mjs`) assembles
> a static ZIP (index.html at root) that runs on itch.io and talks to the live backend at
> `https://vega.tenony.com`. Client API calls now go through a baked `API_BASE`
> (`client/src/api-base.js`; empty = same-origin, prod origin on the itch build). Server gained CORS on
> `/api` (reflects Origin, no credentials) and **bearer-token auth** — login/register/reset return the
> session token in the body and the server accepts `Authorization: Bearer` alongside the existing cookie,
> so account login works inside the itch iframe (third-party cookies are unreliable). The same-origin
> `vega.tenony.com` deploy is unchanged (relative URLs, cookie auth). Guest play works cross-origin via
> the localStorage `playerId`.

**`docs/DECISIONS.md`** — add a numbered entry (next free number) recording:
- **Online build points at prod, not an offline bundle.** itch serves only static files; bundling a whole
  server/DB offline would be a second codebase + no shared progression. Pointing the static client at the
  existing prod API reuses one backend and one player database; the cost is a hard dependency on
  `vega.tenony.com` being up (acceptable — it already is for the web deploy).
- **Bearer tokens over `SameSite=None` cookies for cross-origin iframe auth.** A third-party cookie in an
  iframe is blocked/unreliable across modern browsers regardless of `SameSite=None; Secure`, and flipping
  the primary deploy to `SameSite=None` would weaken its CSRF posture for no gain. A bearer token in
  `localStorage` (returned in the auth body, sent as `Authorization: Bearer`) works cross-origin
  deterministically. Trade-off: `localStorage` tokens are XSS-exposed — accepted (game progress only, no
  sensitive data). The cookie path stays for the same-origin site (additive, not a replacement).
- **Reflect-any CORS is safe here because credentials are off.** With no `Access-Control-Allow-Credentials`
  and bearer (not cookie) auth cross-origin, reflecting an arbitrary `Origin` can't be leveraged for a
  credentialed cross-site request — so an allowlist of itch's rotating CDN subdomains would add maintenance
  for no security benefit.
- **Caveat:** guest play always works on itch (localStorage `playerId`); account login now works via the
  bearer token.

---

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **No offline/bundled build.** This is the online build only.
- **No CI wiring for `build:itch`** — it's a manual, on-demand script.
- **No new zip dependency** — use the system `zip` binary.
- **No `db.js` / `db_postgres.js` schema or query changes** — bearer support is entirely in
  `auth.js` + `server.js`; the token and session tables already exist.
- **No hostname/runtime detection, no query-param or config-file toggle** — `API_BASE` is baked at build
  time, full stop.
- **No refactor of the fetch layer into a single client `apiUrl()` abstraction** beyond prefixing
  `API_BASE` — keep the change mechanical and minimal.
- **No attempt to make cross-origin `sendBeacon` telemetry bulletproof** — it's best-effort with a
  `fetch(keepalive)` fallback; a dropped cross-origin beacon is acceptable.
- **No itch.io metadata/theming, screenshots, or store-page copy** — that's a manual publishing task.
