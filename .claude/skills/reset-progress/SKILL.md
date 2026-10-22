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
   login are kept** (and their perf telemetry + session recordings). Clears game history, owned/active ships, stash and events; resets
   level / credits / shop-unlock to a new-player baseline and re-grants the starter ship. Language
   preference is preserved.
2. **All players** (`--all`) — wipe **every** account (fresh database), including every
   session recording: it first deletes each `gameplay_sessions` row's S3 trace object (when S3 is
   configured), then truncates. The seeded catalog (ships / weapons / components / maps / levels) is
   kept and re-seeded on the next server start.

## How to run

Run from the `server/` directory.

- Single player (ask the user for the player id if you don't have it):
  ```bash
  cd server && node src/reset.js --player <PLAYER_ID>
  ```
- All players on the **local dev DB** (destructive — confirm with the user first, then pass `--yes`).
  Locally there are no AWS creds, so pass `--no-s3` (truncates without touching S3; any session traces
  in S3 are orphaned — harmless for a local DB, whose uploads were no-ops anyway):
  ```bash
  cd server && node src/reset.js --all --yes --no-s3
  ```
  Without `--no-s3` and without creds, `--all` refuses and touches nothing.

## Safety

- `--all` refuses to run without `--yes`; always confirm intent with the user before using it.
- By default this hits the **local Postgres** (`spacegame`). It only touches **production** if
  `DATABASE_URL` is set in the environment — do **not** set it unless the user explicitly asks to
  reset prod.
- **Production `--all` runs INSIDE the app container**, never from a laptop: the S3 trace deletes need
  the AWS creds that only the server `.env` supplies. Run:
  ssh to the VPS (host in the Deployment section of `docs/SUMMARY.md`), then:
  ```bash
  cd /opt/projects/spacegame && docker compose exec app node src/reset.js --all --yes
  ```
  (the image's `WORKDIR` is `/app/server`; `app` is the compose service.) **Never** use `--no-s3` against
  prod (not even through an SSH tunnel — it looks like localhost): it would orphan every session trace.
- If `--all` reports failed S3 deletes it has truncated **nothing** — fix S3 access (the IAM key needs
  `s3:DeleteObject` on `recordings/sessions/*`) and re-run; deletes are idempotent.
- To find a player's id, ask the user or look it up in the local db
  (`psql spacegame -c 'SELECT id FROM players'`).
