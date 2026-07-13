---
name: reset-progress
description: Reset player game progress by running the server/src/reset.js CLI. Use when the user asks to wipe or reset a player's progress, clear the local game database, do a "full wipe", or reset all accounts. Targets the local Postgres by default; production only if DATABASE_URL is set.
---

# Reset player progress

Thin wrapper over the `server/src/reset.js` CLI. The CLI talks to PostgreSQL via
`server/src/datastore.js` — the local Postgres (`postgres://localhost:5432/spacegame`) by default, or
the DB in `DATABASE_URL` — and migrates the schema first, so it works on a fresh DB too.

## Two modes

1. **One player** (`--player <id>`) — reset a single player's progress; the **account and active
   login are kept**. Clears game history, owned/active ships, stash and events; resets
   level / credits / shop-unlock to a new-player baseline and re-grants the starter ship. Language
   preference is preserved.
2. **All players** (`--all`) — wipe **every** account (fresh database). The seeded catalog
   (ships / weapons / components / maps / levels) is kept and re-seeded on the next server start.

## How to run

Run from the `server/` directory.

- Single player (ask the user for the player id if you don't have it):
  ```bash
  cd server && node src/reset.js --player <PLAYER_ID>
  ```
- All players (destructive — confirm with the user first, then pass `--yes`):
  ```bash
  cd server && node src/reset.js --all --yes
  ```

## Safety

- `--all` refuses to run without `--yes`; always confirm intent with the user before using it.
- By default this hits the **local Postgres** (`spacegame`). It only touches **production** if
  `DATABASE_URL` is set in the environment — do **not** set it unless the user explicitly asks to
  reset prod.
- To find a player's id, ask the user or look it up in the local db
  (`psql spacegame -c 'SELECT id FROM players'`).
