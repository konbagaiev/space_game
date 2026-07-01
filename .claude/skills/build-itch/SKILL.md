---
name: build-itch
description: Produce the uploadable web build of the game (a ZIP with index.html at the root) for itch.io and similar static HTML5 hosts — pull the S3 assets, run npm run build:itch, verify the archive, and check whether the prod server (CORS + bearer auth) is already deployed so the uploaded build will actually work. Use whenever the maintainer wants to package/re-package the game for itch.io or another static web-game host, or asks "build the itch zip / the upload file". This is the "Online" build (it talks to https://vega.tenony.com at runtime). Follows docs/plans/2026-07-01-1824-itch-html5-export.md + DECISIONS §33.
---

# Build the itch.io upload (Online web build)

Produce `dist/vega-sentinels-itch.zip` — a static HTML5 bundle (index.html at the ZIP **root**) that
runs on itch.io's CDN and talks to the live backend at **https://vega.tenony.com**. Full rationale:
`docs/plans/2026-07-01-1824-itch-html5-export.md` and DECISIONS §33.

## The two facts this skill exists to keep straight

1. **Building the zip and deploying the server are INDEPENDENT.** `assets:pull` (S3 → `client/assets/`)
   and `build:itch` (zip the client) never touch the server. You can build and upload the zip anytime.
   The **server deploy** (CORS + bearer-token auth) only matters at **play time**: the uploaded game
   calls `vega.tenony.com/api` from itch's origin, so those endpoints must be live or the catalog won't
   load. → Build/upload anytime; **wait for a green deploy before you publish/announce or test-play.**
2. **The `.glb`/`.mp3` assets are gitignored (S3 is canonical).** A bare checkout has no models, so
   `build:itch` alone would ship a modelless ~3 MB zip. **Always `assets:pull` first.** `assets:pull`
   needs the `aws` CLI with the default (admin) profile.

## Steps

Run all repo-root npm scripts from the repo root.

### 1. Sanity: branch + working tree
- `git branch --show-current` — should be `main` (the deployable state). The build zips the **working
  tree**, so uncommitted client edits WILL end up in the zip — warn the maintainer if `git status`
  shows unexpected changes under `client/`.

### 2. Pull the S3 assets (required)
- `npm run assets:pull` — downloads combat `.glb`s + SFX `.mp3`s into `client/assets/` same-origin.
  Idempotent (safe to re-run). If it fails on credentials, the `aws` default profile isn't set up —
  stop and tell the maintainer (see the asset pipeline plan).

### 3. Build the zip
- `npm run build:itch` → `dist/vega-sentinels-itch.zip`. The script (`scripts/build-itch.mjs`) stages
  `index.html` + `styles.css` + `favicon.svg` + `src/` + `locales/` + `assets/`, overwrites the STAGED
  `src/api-base.js` with `API_BASE='https://vega.tenony.com'` (the source tree keeps `''`), excludes
  `*.test.js` / `node_modules` / `.DS_Store`, and asserts the itch limits (≤1000 files / ≤500 MB).
  Report its printed file count + sizes.

### 4. Verify the archive
- `unzip -l dist/vega-sentinels-itch.zip` — confirm **`index.html` is at the root** (NOT
  `client/index.html`; there must be **zero** `client/`-prefixed entries) and `src/api-base.js` is present.
- `unzip -p dist/vega-sentinels-itch.zip src/api-base.js | grep API_BASE` — must show
  `API_BASE = 'https://vega.tenony.com'` (baked prod origin, not `''`).
- Confirm the models are in (`unzip -l … | grep -c 'assets/ships/.*\.glb'` should be ~19, not 0).

### 5. Check whether prod is ready (does the deploy exist yet?)
Tell the maintainer if the uploaded build will actually function. Probe the live CORS preflight:

```
curl -sS -o /dev/null -D - -X OPTIONS https://vega.tenony.com/api/ships \
  -H 'Origin: https://example.itch.zone' \
  -H 'Access-Control-Request-Method: GET' | grep -i 'access-control-allow-origin'
```

- **Header present** (reflects the Origin) → CORS + bearer changes are live; the uploaded build works.
- **No header / connection fails** → the deploy hasn't landed yet. Tell the maintainer to watch the
  GitHub Actions run and re-check before publishing. (The zip itself is still fine to upload now.)

### 6. Hand off — artifact + upload checklist
Report the artifact path and print the itch.io upload steps:

- **Artifact:** `dist/vega-sentinels-itch.zip` (report the size).
- On itch.io: **Create/edit project → Kind of project = HTML.**
- **Upload** the zip → tick **"This file will be played in the browser."**
- **Embed:** *Click to launch in fullscreen* (this game is a full-window canvas) + enable the
  **Fullscreen button**. (Or *Embed in page* with a viewport like 1280×720 if the maintainer prefers.)
- **Save & view page.**

## Notes / caveats to relay
- **Online build:** the itch copy depends on `vega.tenony.com` being up (by design — see DECISIONS §33).
- **What works cross-origin:** guest play + progress (localStorage `playerId`, no cookies) and account
  login/register (bearer token in `localStorage['authToken']` + `Authorization: Bearer`). The
  same-origin site (vega.tenony.com) is unchanged (cookie auth still works there).
- **No asset changes here** — this skill only packages existing assets, so `client/assets/CREDITS.md`
  never needs to change on its account.
- **Not wired into CI.** This is a manual, on-demand package step; the zip is not built by the deploy.
- Reproduce anytime with just: `npm run assets:pull && npm run build:itch`.
