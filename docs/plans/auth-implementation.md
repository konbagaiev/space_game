# Player authentication — implementation brief (Vega Sentinels)

> Self-contained handoff for a fresh session. Architecture is decided — see **DECISIONS.md §11**.
> English per the project's English-only rule. AWS-side setup is tracked separately in
> `docs/plans/aws-ses-production-request.md`.

## Goal

Anonymous-first play with an **optional** email/password account.

1. Player plays anonymously today (localStorage UUID, auto-register) — unchanged.
2. **After clearing level 1**, prompt for a **username** (display name) and offer to **register**.
3. **Decline** → keep playing anonymously; the username is saved on the player row.
4. **Accept** → email + password **upgrade the same player row in place** (progress preserved).
5. **Cross-device progress sync requires a verified email.** Until verified, the account works on the
   current device (logged in via session cookie) but can't be logged into elsewhere.

## Locked decisions (DECISIONS §11 — do not re-litigate)

- **Password hashing:** built-in `crypto.scrypt`, per-user random salt, `crypto.timingSafeEqual` compare.
  **No hashing dependency.**
- **Session:** server-side token in an **httpOnly, Secure, SameSite=Lax** cookie. DB stores a **hash**
  of the token; the cookie holds the raw token. **No `cookie-parser`** — parse the `Cookie` header with
  a tiny helper.
- **Username** = display name, not unique, not a credential. **Login is by email.**
- **Identity:** `players.id` UUID stays the game identity; credentials attach to that row (in-place
  upgrade). Fresh-device login **adopts the account's player row**; merging two non-trivial anonymous
  progresses is out of scope for v1.
- **Email:** Amazon SES (us-east-1), outbound only, from `noreply@vega.tenony.com`. **Sent via
  hand-rolled AWS SigV4 over built-in `fetch`, isolated in `server/src/ses.js` — no `@aws-sdk` dep.**
  SES has **production access** (granted 2026-06-21) — out of sandbox, can email arbitrary players
  (see the AWS brief).

## Sequencing / parallel-work hazard

Adds a migration and touches `server.js` + `client/index.html`. Coordinate the **migration number** with
the other in-flight features (i18n grabs the next one too) — don't let two branches both create the same
`00N_*.js`. Work in its own git worktree; land relative to the others deliberately.

## Codebase facts (verified at planning time — re-check before relying)

- **Server:** `express` + `pg` only; Node 23; single middleware `express.json()` (`server/src/server.js:17`).
  No auth/session/cookie/JWT/hash/email libs anywhere.
- **`players` table:** `id` (TEXT PK, browser UUID), `created_at`, `last_seen`, `games_played`,
  `current_progress` (INTEGER, migration 006). No email/password/username/token columns.
- **Player flow:** client makes `crypto.randomUUID()` → `localStorage.playerId`
  (`client/index.html:1035-1041`); auto-registers via `POST /api/players/register` (`server.js:23`,
  `db.js:58-68`). Endpoints: `register`, `GET :id/games`, `GET :id/active-ship`, `GET :id/level`,
  `POST :id/advance`. No auth middleware.
- **Storage:** pluggable `datastore.js` → `db.js` (SQLite, honors `DB_PATH`, local file
  `server/data/game.db`) / `db_postgres.js` (Postgres bootstrap with idempotent `CREATE TABLE IF NOT
  EXISTS`). Migrations: SQLite `migrations/NNN_name.js` (`up(db)`, `PRAGMA user_version`); latest was
  006 — re-check (i18n adds one too).
- **Config/secrets:** server-only `.env` (`docker-compose.yml` `env_file: .env`), kept on the server by
  CI (rsync excludes it). Today only `DATABASE_URL`, `PORT`. `DB_PATH` for tests.
- **Prod:** HTTPS via Traefik (`space.bagaiev.com` today, migrating to `vega.tenony.com` — see the
  rename brief), same-origin client+API. Secure cookies are fine.
- **Tests:** `server/src/server.test.js` spins up `createApp()` on `listen(0)` against a temp SQLite DB
  via `DB_PATH`; `post()`/`getJson()` fetch helpers. Follow this for auth tests.

## Schema (new migration — pick the next free NNN, coordinate)

Add to `players` (mirror in `db_postgres.js` bootstrap):
- `username TEXT` (nullable)
- `email TEXT` (nullable) — **uniqueness via a partial unique index**, NOT an inline `UNIQUE` on
  `ALTER TABLE ADD COLUMN` (SQLite can't add a UNIQUE column): `CREATE UNIQUE INDEX ... ON players(email)
  WHERE email IS NOT NULL` (Postgres supports the same partial index).
- `password_hash TEXT`, `password_salt TEXT` (or one packed `scrypt$N$r$p$salt$hash` column)
- `email_verified INTEGER NOT NULL DEFAULT 0`
- `email_verify_token_hash TEXT`, `email_verify_sent_at INTEGER`

New `sessions` table:
- `token_hash TEXT PRIMARY KEY` (SHA-256 of the cookie token)
- `player_id TEXT NOT NULL` (→ players.id)
- `created_at INTEGER NOT NULL`, `expires_at INTEGER NOT NULL`
- optional `user_agent TEXT`

(Same DECISIONS §9 caveat as `current_progress`: no FK with a non-null default on SQLite ADD COLUMN;
keep `player_id` a plain TEXT, treat as logical FK; Postgres may declare the real FK.)

## Server modules

### `server/src/auth.js` (new) — crypto helpers, no deps
- `hashPassword(plain)` → `{ hash, salt }` via `crypto.scrypt` (e.g. N=16384, r=8, p=1, 64-byte key).
- `verifyPassword(plain, hash, salt)` → `crypto.timingSafeEqual`.
- `newSessionToken()` → `crypto.randomBytes(32).toString('base64url')`; `hashToken(t)` → SHA-256 hex.
- `parseCookies(header)` → `{name: value}` (tiny, no dep).
- `setSessionCookie(res, token, maxAge)` / `clearSessionCookie(res)` → `Set-Cookie` with
  `HttpOnly; Secure; SameSite=Lax; Path=/`. (Secure is fine — prod is HTTPS; for local http tests, gate
  Secure off when `NODE_ENV==='test'` or behind a flag.)
- `requireAuth` Express middleware: read cookie → look up session (not expired) → attach `req.player`.

### `server/src/ses.js` (new) — SES send via SigV4, ISOLATED (single swap point)
- `sendVerificationEmail(toEmail, verifyUrl)` → builds a `SendEmail` (or `SendRawEmail`) request to
  `https://email.<region>.amazonaws.com`, signed with **AWS SigV4** using built-in `crypto`
  (HMAC-SHA256 chain) and sent with built-in `fetch`. No `@aws-sdk`.
- Reads env: `SES_REGION` (us-east-1), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_FROM_ADDRESS`
  (`noreply@vega.tenony.com`), `APP_BASE_URL` (`https://vega.tenony.com`).
- If creds are absent (local dev), no-op + log the link to console so dev flows work without SES.
- Keep ALL signing logic here — DECISIONS §11 notes we may later swap this file for `@aws-sdk/client-ses`.

### Endpoints (`server.js`)
- `POST /api/players/:id/username` — set the display name on the (still anonymous) player.
- `POST /api/auth/register` — `{ playerId, username, email, password }`: reject if email already used;
  hash password; set username/email on the player row; create + store a verify-token hash; send the
  email; create a session; set the cookie. Returns the player (logged in, `email_verified:false`).
- `POST /api/auth/login` — `{ email, password }`: verify; create session; set cookie; return the player
  (incl. `current_progress`). Client then adopts this player id.
- `POST /api/auth/logout` — delete the session; clear the cookie.
- `GET /api/auth/me` — current session → player (or 401).
- `GET /api/auth/verify?token=...` — hash + match an unexpired verify token → `email_verified=1`; clear
  the token; **redirect** to the game with a success flag.
- `POST /api/auth/resend-verification` — (authed) regenerate token + resend; throttle by
  `email_verify_sent_at`.
- **Basic rate limiting / throttling** on register/login/resend (in-memory per-IP is fine for v1).
- Validate inputs (email shape, password length ≥ 8); return 400 on bad input, 401 on bad creds,
  409 on duplicate email.

## Client (`client/index.html`)
- Keep the anonymous UUID flow. After the level-1 victory overlay, show a **username + optional
  register** step (username field → "Continue" keeps anonymous; "Create account" reveals email/password).
- Add a small auth panel: register / login / logout / "verify your email" reminder (when
  `email_verified:false`). Use `fetch` with `credentials: 'include'` so the session cookie rides along.
- On login, replace `localStorage.playerId` with the account's player id and re-fetch progress/active
  ship. On `GET /api/auth/me` success at boot, prefer the session's player over the local UUID.
- A "verify your email to sync across devices" nudge until verified.

## AWS setup (see `docs/plans/aws-ses-production-request.md`)
- ✅ **SES production access** granted (2026-06-21) — sending to real users is unblocked.
- Verify **`vega.tenony.com`** domain identity + DKIM in SES → add the CNAME/TXT records in the
  **`tenony.com` DNS zone**.
- Create IAM user **`vega-sentinels-mailer`** scoped to `ses:SendEmail`/`SendRawEmail`; put its keys +
  `SES_*`/`APP_BASE_URL` in the server `.env`. CI keeps `.env` on the server.

## Tests
- **Server** (`server/src/server.test.js`, temp SQLite, `listen(0)`): register (happy + duplicate email
  409 + weak password 400); login (happy + wrong password 401); session cookie set/cleared;
  `GET /api/auth/me` authed vs 401; verify-token flow flips `email_verified`; username endpoint.
  **Stub `ses.js`** in tests (no real email) — e.g. the no-creds no-op path, asserting it was "called"
  with the right address/link.
- **Unit** for `auth.js`: scrypt round-trip, wrong password fails, token hashing, cookie parsing.

## Docs to update (CLAUDE.md docs workflow)
- `SUMMARY.md` — add an "Accounts / authentication" subsection; bump `**Updated:**`.
- `CHANGELOG.md` — dated bullet (migration, endpoints, session, SES module).
- `DECISIONS.md` §11 already records rationale; update only if the build deviates.

## Acceptance criteria
- A new player can clear level 1, set a username, and **decline** registration → keeps playing
  anonymously with the username saved.
- A player can register (email/password); the account upgrades their existing row **without losing
  progress**; a verification email is sent (or logged locally when SES creds are absent).
- Logging in on a second browser **after verifying** pulls the same `current_progress`.
- Unverified accounts can play on the device they registered on but cannot log in elsewhere.
- Passwords are scrypt-hashed (never stored/logged in plaintext); sessions are httpOnly Secure cookies;
  the DB stores only token hashes.
- No new runtime dependency added (scrypt, cookie parsing, and SES SigV4 are all built-in); all SES
  signing lives in `server/src/ses.js`.
- All existing + new tests pass.
