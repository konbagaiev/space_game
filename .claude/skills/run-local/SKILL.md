---
name: run-local
description: Start the game's local server on http://localhost:4000 with real ship models + sounds — pull the S3 assets first (they're gitignored), then launch server/src/server.js. Use whenever the maintainer wants to run/play/test the game locally, "start the local server", "run it on localhost:4000", or playtest a feature worktree. Works from the main checkout or a git worktree.
---

# Run the game locally (localhost:4000)

Start the backend (which also serves the client) on **http://localhost:4000**, with the real
`.glb` ship models and `.mp3` sounds in place. Works from the **main checkout** or a **feature
worktree** — run it from whichever directory you want to play.

## The one fact this skill exists to keep straight

**The `.glb`/`.mp3` assets are gitignored — S3 is canonical (DECISIONS §14/§22).** A bare checkout
(and every fresh `git worktree`) has **no models and no sounds**, so the game would render generic
placeholder cones with silent combat. **Always `assets:pull` before starting the server.**
`assets:pull` needs the `aws` CLI with the default (admin) profile.

This is the gap that bit us: launching a worktree server without pulling → modelless, soundless game.

## Steps

Let `ROOT` = the directory you want to run (the main checkout **or** a worktree path). Run the
repo-root npm scripts from `ROOT`.

### 1. Pull models + sounds from S3
```
cd "$ROOT" && npm run assets:pull
```
This downloads combat `.glb`s → `client/assets/ships/` and SFX `.mp3`s → `client/assets/sounds/`
(same-origin, so they load locally). It ends with `Done. Combat models + SFX are in place`.
- If `aws` isn't configured / creds are missing, this fails — tell the maintainer; the game will
  otherwise run but with placeholder ships and no audio.
- Idempotent: safe to re-run (skips files already present).

### 2. Check the port is free
```
lsof -nP -iTCP:4000 -sTCP:LISTEN
```
If something is already on :4000 (often an old server or the main checkout's server), either stop it
or the new `listen` will `EADDRINUSE`. Don't blindly kill a process you didn't start — ask.

### 3. Start the server (background)
```
cd "$ROOT/server" && PORT=4000 node src/server.js
```
Run it **in the background** (it's a long-running process). It prints
`Space game server running: http://localhost:4000`.
- **A worktree gets its own fresh DB** (`server/data/game.db`, gitignored). On first start the catalog
  is **seeded** (ships/weapons/components/**maps** — incl. set-pieces — /levels), so the player begins
  as a **new account at level 1**.
- `node_modules` normally exists in a worktree; if `express` is missing, run `npm install` in `server/`.

### 4. Verify it's up
```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/
```
Expect `200`. Optionally spot-check an asset serves:
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/assets/ships/player_combat.<hash>.glb`
(any hashed `player_combat*.glb` under `client/assets/ships/`). Then give the maintainer the URL.

## Notes

- **Fresh DB → level 1.** To test **side missions** or a later campaign level without grinding, use the
  **`reset-progress`** skill / `server/src/reset.js` to set a player's progress or unlock the shop, or
  play through the campaign. Ask the maintainer which they want.
- **Local, no email/prod.** Auth email (SES) and the prod Postgres are not involved — this is the local
  Postgres backend. `?dev` enables the perf overlay; `?tune` the palette panel.
- **Don't confuse with the itch build.** `build-itch`/`publish-itch` package a static bundle that talks
  to **prod**; this skill runs the **local** server for development/playtesting.
- Keep it simple (DECISIONS §30): this skill is just `assets:pull` + `node server.js` — no watchers,
  rebuild loops, or process managers.
