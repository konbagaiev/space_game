---
name: publish-itch
description: Ship an updated web build to itch.io in one shot using butler (itch.io's official upload CLI) — pull S3 assets, run npm run build:itch, then butler push the unzipped build to the game's HTML5 channel (incremental: only changed files upload). Use whenever the maintainer wants to publish/upload/re-upload a new version of the game to itch.io, or "push an update to itch". Prefer this over any browser-automation upload — butler is the supported, scriptable path. Builds on the build-itch skill + docs/plans/2026-07-01-1824-itch-html5-export.md.
---

# Publish an update to itch.io (butler)

Automates the recurring "I changed the game, get it live on itch" loop. **butler** is itch.io's official
CLI; it uploads only what changed and generates patches. This is the right tool — do NOT script the web
upload form.

The flow is: **`assets:pull` → `npm run build:itch` → `butler push` the unzipped build.** For a
browser-playable HTML build butler must receive the **unzipped files** (index.html at the folder root),
NOT the `.zip` — pushing a zip uploads it as a downloadable, not a playable embed.

## The target string

butler pushes to `USER/GAME:CHANNEL`, e.g. `konbagaiev/vega-sentinels:html5`.
- `USER` = itch username, `GAME` = the game's URL slug (from `USER.itch.io/GAME`), `CHANNEL` = a name you
  choose (use **`html5`** for the browser build).
- Resolve the target in this order: the skill **argument** if given → else the `ITCH_TARGET` env var →
  else a `.itch-target` file at repo root (single line, gitignored). If none is set, ask the maintainer
  for `USER/GAME` once and offer to write it to `.itch-target`.

## Prerequisites (first run only)

1. **butler installed?** `which butler`. If missing on macOS: `brew install butler` (Homebrew is at
   `/opt/homebrew/bin/brew`). Verify `butler version`.
2. **Authenticated?** Check `~/.config/itch/butler_creds`. If absent, butler login is **interactive**
   (opens a browser) — the agent can't do it. Tell the maintainer to run it themselves in the session:
   type `! butler login` at the prompt. (CI/non-interactive alternative: set `BUTLER_API_KEY` from
   itch.io → Settings → API keys.)

## Steps

Run repo-root npm scripts from the repo root.

### 1. Build the upload (same as the build-itch skill)
- `npm run assets:pull` (S3 `.glb`/`.mp3` → `client/assets/`; gitignored, required or the build ships
  modelless). Needs the `aws` default profile.
- `npm run build:itch` → `dist/vega-sentinels-itch.zip` **and** the staged, unzipped tree at
  `dist/itch-staging/` (index.html at its root, prod `API_BASE` baked in). Report the printed file
  count + size.

### 2. Confirm the push directory
- Push `dist/itch-staging/` (the unzipped tree). Sanity-check it exists and has `index.html` at its root
  (`ls dist/itch-staging/index.html`). If `build:itch` ever stops leaving the staging dir, unzip the
  zip into a clean temp dir and push that instead.

### 3. Push with butler
```
butler push dist/itch-staging "$TARGET"       # e.g. konbagaiev/vega-sentinels:html5
```
butler diffs against the last build and uploads only changes. Then confirm:
```
butler status "$TARGET"
```
Report the new build number + state to the maintainer.

### 4. First-push-only: wire "play in browser" (one-time web step)
The very first time you push to a NEW channel, itch doesn't yet know it's a browser embed. Tell the
maintainer to, once, in the web UI (Edit game): make sure the **`html5` channel's** file has **"This
file will be played in the browser"** checked and the embed options set (see the build-itch/itch export
notes), and **delete the earlier manually-uploaded file** if it duplicates the embed. After that, every
`butler push` to the same channel updates the live game with **no web-UI step**.

## Notes / caveats
- **Deploy vs upload are still independent.** This only republishes the static client. The game talks to
  `vega.tenony.com/api` at runtime, so any *server-side* change must be deployed separately (merge to
  main → CI). A pure client change (like this one) only needs `publish-itch`.
- **Incremental:** the ~20 MB of models upload once; later code-only updates push in seconds.
- **No new dependency in the repo** — butler is a system tool, like the `zip` binary the build uses.
- Reproduce manually: `npm run assets:pull && npm run build:itch && butler push dist/itch-staging USER/GAME:html5`.
