# Server (backend)

Node.js + Express backend. It serves the game client (static files from `../client`) AND a
JSON API on the same origin, so the client can call `/api/...` without CORS. Storage is
**PostgreSQL** (via the `pg` driver); it connects via `DATABASE_URL`, or a local
`postgres://localhost:5432/spacegame` default for zero-config dev.

## Run

```
cd server
npm install        # first time only (installs express)
npm start          # http://localhost:4000
```

Then open **http://localhost:4000** in the browser (the server serves the game).
Port can be overridden with `PORT=xxxx npm start`.

## What it does now

- **Auto-registration by browser:** the client generates a UUID on first visit, stores it in
  `localStorage`, and sends it on load. The server creates the player record if it's new.
- **Game history:** when a game ends, the client posts the result; it's saved to the player's history.

## API

- `POST /api/players/register` — body `{ playerId }` → upserts the player. Returns
  `{ id, isNew, gamesPlayed, createdAt }`.
- `POST /api/games` — body `{ playerId, score, kills, durationMs }` → stores one finished game.
  Returns `{ gameId }`.
- `GET /api/players/:id/games` — that player's game history (newest first).
- `GET /api/health` — `{ ok, players, games }`.

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

## Layout

- `src/server.js` — Express app (static client + API routes); runs `migrate()` on startup.
- `src/db.js` — the PostgreSQL data layer (schema bootstrap in `migrate()` + all queries).

## Production

Live at **https://vega.tenony.com** on a shared Hetzner VPS (178.104.91.144). The legacy host
**https://space.bagaiev.com** stays routed to the same container during the transition.

- Runs as Docker container `spacegame_app` (built from the repo `Dockerfile`, 1 GB mem limit),
  behind **Traefik** (auto-HTTPS via Let's Encrypt) on the shared `proxy` + `backend` networks.
  The Traefik router serves both hosts (`Host(vega.tenony.com) || Host(space.bagaiev.com)`); the
  internal container/image/router name stays `spacegame` (renaming is cosmetic churn).
- Uses the shared `shared_postgres` (database + role `spacegame`) — selected via `DATABASE_URL`.
- Files live at `/opt/projects/spacegame/`; the server-only `.env` (not in git) holds
  `DATABASE_URL=postgres://spacegame:***@shared_postgres:5432/spacegame` and `PORT=4000`.

### Deploy
Automated via GitHub Actions (`.github/workflows/ci-cd.yml`): push to `main` runs the tests, then
rsyncs the repo to the server and runs `docker compose up -d --build`. Required repo secrets:
`DEPLOY_SSH_KEY` (private key), `DEPLOY_HOST` (178.104.91.144), `DEPLOY_USER` (root).

Manual deploy (from a machine with SSH access):
```
rsync -az --exclude node_modules --exclude .git --exclude server/data ./ root@178.104.91.144:/opt/projects/spacegame/
ssh root@178.104.91.144 "cd /opt/projects/spacegame && docker compose up -d --build"
```

## Planned next

Server-issued identity token (harden against id spoofing), leaderboards, matchmaking,
multiplayer (WebSocket). The client (Three.js) lives in `../client`.
