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

butler pushes to `USER/GAME:CHANNEL`. **This game's target is `bagaiev/vega-sentinels:html5`**
(from `https://bagaiev.itch.io/vega-sentinels`; `html5` is the browser channel).
- Resolve the target in this order: the skill **argument** if given → else the `ITCH_TARGET` env var →
  else the default above. `USER` = itch username, `GAME` = the URL slug (from `USER.itch.io/GAME`),
  `CHANNEL` = a name you choose (`html5` for the browser build).

## Prerequisites (first run only)

1. **butler installed?** `which butler` (verify with `butler -V`). **Do NOT `brew install butler`** — the
   Homebrew `butler` cask is a different app (Butler.app, a launcher), not itch's CLI. Install itch's butler
   from its official broth channel (single static Go binary):
   ```
   curl -L -o /tmp/butler.zip https://broth.itch.ovh/butler/darwin-amd64/LATEST/archive/default
   unzip -o /tmp/butler.zip -d /tmp/butler-dl && chmod +x /tmp/butler-dl/butler
   mv /tmp/butler-dl/butler /opt/homebrew/bin/butler        # a dir already on PATH
   butler -V
   ```
   On Apple Silicon the `darwin-amd64` binary runs via Rosetta; if `butler -V` reports "bad CPU type",
   run `softwareupdate --install-rosetta --agree-to-license` once. (Official download page:
   https://itchio.itch.io/butler.)
2. **Authenticated?** Verify by actually calling the API — `butler status bagaiev/vega-sentinels:html5`.
   If it prints the channel/build table, you're authed → go straight to the push. **Do NOT gate on a creds
   file path** — the location is platform-specific (macOS: `~/Library/Application Support/itch/butler_creds`;
   Linux: `~/.config/itch/butler_creds`), so a missing file at one path is a false negative and has twice
   led to wrongly asking the maintainer to re-log-in. Only if `butler status` reports an **auth error** is
   login needed: butler login is **interactive** (opens a browser) — the agent can't do it, so tell the
   maintainer to run it themselves in the session (type `! butler login` at the prompt). (CI/non-interactive
   alternative: set `BUTLER_API_KEY` from itch.io → Settings → API keys.)

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
