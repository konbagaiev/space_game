# Monitoring — implementation brief (Vega Sentinels)

> **STATUS (2026-06-21): ✅ IMPLEMENTED.** Sentry (server `@sentry/node` via `instrument.js` +
> `setupExpressErrorHandler`; browser via CDN bundle loaded by `initSentry()`) and DB funnel events
> (migration 010 `events` table, `POST /api/events`, client `track()` helper) are built and tested; both
> Sentry sides no-op until their DSN env is set. **Deviation from the brief:** the browser DSN is served
> at runtime by `GET /api/config` (from `SENTRY_DSN_WEB`) rather than hardcoded inline — so the buildless
> client needs no committed DSN and the value lives in the server `.env` like other config. **To go live
> on prod:** set `SENTRY_DSN_SERVER` + `SENTRY_DSN_WEB` (+ optional `SENTRY_ENVIRONMENT`/`SENTRY_RELEASE`)
> in the server `.env`. UptimeRobot is owned separately (Kostya).

> Self-contained handoff for the work session. Launch-readiness monitoring: **Sentry** (errors, server +
> browser) and **DB events** (product funnel). **UptimeRobot is owned separately by Kostya** (external
> ping of `/api/health` → Telegram) — not in this brief. Grafana stack deferred. English-only.
> Planning-window note: no code was written here. Part of ROADMAP Phase 0.

## Scope & decisions
- **Sentry** for errors — first observability tooling. Server uses the `@sentry/node` package (server
  already depends on express/pg, so a server dep is fine). Browser uses Sentry's **CDN loader** (the
  client is a single `index.html`, no build step — load it like Three.js via a script tag, NOT npm).
- **Two Sentry projects** (recommended): `vega-sentinels-server` and `vega-sentinels-web`, each its own
  DSN. Server DSN → server `.env` (secret-ish). Browser DSN is **public by design** (it ships in the
  client) — fine to inline.
- **No source-map pipeline needed:** both server (plain Node) and client (unminified single file) have
  readable stack traces already. Nice simplification.
- **Keep within free tier:** errors only — `tracesSampleRate: 0` (no perf tracing), session replay off,
  initially. Can enable later.
- **DB events** for the funnel — own table, own endpoint, best-effort, pluggable datastore (matches the
  existing `games`/`reportGame` pattern). No external analytics dep.

## 1. Sentry — server (`@sentry/node`)
- `npm i @sentry/node` in `server/`.
- Initialize **before** building the app, in `server.js` (the entry that calls `createApp()` / listens):
  `Sentry.init({ dsn: process.env.SENTRY_DSN_SERVER, environment: process.env.NODE_ENV || 'production',
  release: process.env.SENTRY_RELEASE, tracesSampleRate: 0 })`.
- Wire the Express error handler (Sentry v8: `Sentry.setupExpressErrorHandler(app)` after routes, before
  your own error middleware). Captures unhandled route errors + unhandled exceptions/rejections.
- If `SENTRY_DSN_SERVER` is unset (local dev/tests), `init` is a no-op / guard it so dev + the test
  suite are unaffected.
- Env (server `.env`, kept on the host by CI like `DATABASE_URL`/SES):
  `SENTRY_DSN_SERVER=...` and (optional) `SENTRY_RELEASE` (CI can pass the git SHA — it already tags the
  image by SHA, so reuse it).

## 2. Sentry — browser (CDN, no build)
- Add the Sentry **CDN/loader** `<script>` in `client/index.html` `<head>` (alongside the existing
  importmap), then `Sentry.init({ dsn: '<public browser DSN>', environment: 'production', release:
  '<git sha or version>', tracesSampleRate: 0 })`. Auto-captures JS errors + `unhandledrejection` from
  real player devices/browsers — the main payoff for a browser game.
- Add gameplay context so crashes are debuggable: `Sentry.setUser({ id: playerId })` (the localStorage
  UUID), `Sentry.setTag('level', currentLevel)` on level change, optional breadcrumbs at key actions.
- Optional: `ignoreErrors` for common browser-extension noise; consider a Sentry **tunnel** later if
  ad-blockers eat events (not needed for v1).
- Note: the browser DSN being public is normal for Sentry — no secret leak.

## 3. Release tagging (optional, recommended)
Pass the git SHA as the `release` in both inits (CI already builds `spacegame:<sha>`), so errors group by
version and you can tell "did my last deploy break it".

## 4. Alerting
Sentry's own alert rules → email to start; later route to the Telegram **ops** chat (Sentry has a
webhook / integrations). Out of scope to wire Telegram here — email default is fine for launch.

## 5. DB events (product funnel)
Goal: see **where players drop off**. The existing `games` table only logs end-of-game results; add
finer events.

### Schema — new migration (`server/src/migrations/0NN_events.js`)
- Pick the next free number (**auth added 009 → likely 010; re-check**). Mirror in the Postgres bootstrap
  (`db_postgres.js`) — storage is pluggable.
- Table `events`:
  - `id` (PK, autoinc / serial)
  - `player_id TEXT NOT NULL` (the UUID; logical FK to players)
  - `type TEXT NOT NULL` (event name, validated against an allowlist)
  - `data` (JSON/JSONB, nullable — context like `{ level: 2, cause: 'rocket' }`)
  - `created_at BIGINT NOT NULL`
  - Indexes: `(type, created_at)` and `(player_id)`.

### Endpoint — `POST /api/events`
- Body `{ playerId, type, data? }` (allow a small batch array too, optional). **Best-effort**, never
  blocks gameplay; return 204/200 quickly.
- **Validate `type` against an allowlist** (reject unknown → avoid junk/abuse). Suggested allowlist:
  `game_start`, `level_start`, `level_clear`, `player_death`, `victory`, `quit`.
- Add `recordEvent(playerId, type, data)` to `datastore.js` → implemented in both `db.js` (SQLite) and
  `db_postgres.js` (Postgres), following how `reportGame`/`recordGame` is written.

### Client hooks (`client/index.html`)
Fire-and-forget (like `reportGame`); don't await:
- `game_start` — on take-off (ship chosen).
- `level_start` / `level_clear` — from the `levelRunner` on phase/level transitions.
- `player_death` — where `player.hp <= 0` is handled (≈ the death branch in the loop), include level +
  cause.
- `victory` — on the win phase.
- `quit` — on tab close/leave: use **`navigator.sendBeacon('/api/events', ...)`** so it sends during
  unload (a normal fetch won't reliably complete on close).
- Helper: a small `track(type, data)` that POSTs (or beacons for `quit`) with the localStorage
  `playerId`.

### Reading the funnel (no tool needed yet)
Plain SQL over `events` answers "how many reached level N / won / died at level N". Example:
`SELECT type, data->>'level' AS level, count(*) FROM events GROUP BY 1,2 ORDER BY 1,2;` (Postgres).
A tiny admin endpoint or manual query is fine for launch; a dashboard later.

## Coordination
Touches `server.js`, `db.js`, `db_postgres.js`, `datastore.js`, a new migration, and
`client/index.html` — several are in the in-flight **auth** session's uncommitted set. Land without
clobbering; **coordinate the migration number** (don't collide with auth's 009). Sentry server init also
edits `server.js`.

## Acceptance criteria
- A thrown server error and a thrown browser error both appear in their Sentry projects (with release +
  player/level context for the browser one); local dev/tests work with Sentry DSNs unset.
- `game_start` / `level_start` / `level_clear` / `player_death` / `victory` / `quit` land in the `events`
  table (both SQLite locally and Postgres in prod), `quit` surviving tab close via `sendBeacon`.
- Unknown event types are rejected; gameplay is unaffected if the events endpoint is slow/down.
- No source-map upload needed; no perf-tracing/replay quota burn (errors-only config).
