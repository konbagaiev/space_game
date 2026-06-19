# Server (backend)

Node.js + Express backend. It serves the game client (static files from `../client`) AND a
JSON API on the same origin, so the client can call `/api/...` without CORS. Storage is SQLite
via the built-in `node:sqlite` module (no native dependencies).

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

SQLite file at `server/data/game.db` (gitignored). On a fresh/remote server the file and schema
are created automatically — no separate DB service to provision; just make sure `server/data/`
is writable and persistent.

Schema is managed by a **minimal migration runner** (`src/migrate.js`, no dependencies). The
schema version is stored in SQLite's built-in `PRAGMA user_version`. Migrations are
`src/migrations/NNN_name.js` files, each exporting `up(db)`; the runner applies, in order, every
migration whose number is greater than the current version, each in a transaction.

- Migrations run automatically on server startup.
- Run them standalone (e.g. on deploy, before starting): `npm run migrate`.
- Add a change: create the next file (e.g. `002_add_x.js`) with an `up(db)` — never edit applied ones.

Tables (after `001_init`):
- `players` — `id` (browser UUID, PK), `created_at`, `last_seen`, `games_played`.
- `games` — `id`, `player_id`, `score`, `kills`, `duration_ms`, `ended_at`.

## Layout

- `src/server.js` — Express app (static client + API routes); runs migrations on startup.
- `src/db.js` — opens the SQLite database and exposes queries.
- `src/migrate.js` — migration runner (also runnable via `npm run migrate`).
- `src/migrations/` — ordered migration files (`001_init.js`, ...).

## Planned next

Server-issued identity token (harden against id spoofing), leaderboards, matchmaking,
multiplayer (WebSocket). The client (Three.js) lives in `../client`.
