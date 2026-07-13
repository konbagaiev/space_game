---
name: update-ship-model
description: Add, replace, or re-tint a ship's 3D model end-to-end — build the optimized glbs, push them to S3 (canonical store), wire the content-hashed URLs into catalog_seed.js, delete the superseded objects on S3 when it's a replacement, ALWAYS restart the local server after, and deploy to prod. Use whenever the user asks to add/change/swap/recolor a ship or enemy model (or a sound asset). Follows docs/plans/ship-model-pipeline.md.
---

# Update a ship model (S3 + catalog + local restart + deploy)

The asset pipeline keeps **no binaries in git** — S3 (`vega-sentinels-assets`) is canonical, the
content-hashed URLs live in `server/src/catalog_seed.js`, combat glbs are pulled onto the server at
deploy and served same-origin, hangar glbs go via CloudFront. Full rationale:
`docs/plans/ship-model-pipeline.md` + `docs/plans/adding-a-ship-model.md`. Scripts: `scripts/assets-*.mjs`.

## Two non-obvious facts this skill exists to enforce

1. **The catalog is upserted into the DB only on server STARTUP** (`seedCatalog` in `server/src/db.js`,
   ships keyed by **name**). So changing `catalog_seed.js` does nothing until a
   restart. → **Locally, ALWAYS restart the server after a model change.** On prod, the deploy starts a
   fresh container, so the reseed is automatic.
2. **A stale running server + replaced files = the "generic primitive" bug.** If the old combat glb is
   deleted but the server still serves the old hash (old DB seed), the browser 404s the model and falls
   back to the primitive cone. The fix is the restart in step 7 (and a browser hard-refresh).

## Steps

Run repo-root npm scripts from the repo root; the server from `server/`. Requires the `aws` CLI with
the default (admin) profile for `assets:push` / deletes.

### 1. Produce the new source glb
- **New model:** drop the high-poly source in `assets-src/<base>.glb` (also backed up to S3 `source/`).
- **Re-tint / recolor (e.g. enemies):** edit `TARGET` (sRGB hex) in `scripts/assets-recolor.mjs`, then
  `npm run assets:recolor` — it re-derives `enemy_*_orange.glb` from the red `enemy_*.glb` sources,
  tinting only the RED materials (brightness preserved). It prints the next build command.

### 2. Build the optimized glbs
```bash
npm run assets:build <base> [<base> ...]   # pass base names to build a SUBSET (skips the 48 MB player)
```
gltf-transform emits a content-hashed `*_combat.<hash>.glb` (meshopt, KB-scale, same-origin) and
`*_hangar.<hash>.glb` (meshopt + WebP, CloudFront) into `assets-dist/`. **Copy the printed hashes.**

### 3. Push to S3 — ALWAYS
```bash
npm run assets:push     # uploads assets-dist/ (combat+hangar) + assets-src/ sources to S3
```

### 4. Wire the catalog (+ the marker color by size tier)
Edit `server/src/catalog_seed.js`: set the ship's `modelUrl` (combat, `assets/ships/<combat>.glb`) and,
if it has one, `modelUrlHigh` (hangar, the full CloudFront URL) to the new hashes from step 2.

**Marker color — use the `MARKER` size-tier palette, never an ad-hoc hex.** The off-screen edge arrows
(`#markers`), the corner minimap dots (`#minimap`) and the hangar ship-dot all read each ship's
`stats.color` (they do NOT tint the 3D model — the .glb bakes its own color). `MARKER` is defined once
near the top of `catalog_seed.js`. Set the new/changed ship's `color` to the tier that matches its size:
- **small → `MARKER.small`** (orange) — enemy_1 fighters/gunners + enemy_2 rocketeers
- **medium → `MARKER.medium`** (red) — enemy_3 mediums
- **boss → `MARKER.boss`** (maroon) — enemy_4 bosses

(The player keeps its own blue.) If a visual scenario asserts a ship's `color`
(`client/visual/scenarios/11-l4-enemies.mjs`), update that assertion to the tier value.

### 5. Refresh the local serve dir
The combat glbs are served same-origin from `client/assets/ships/` (gitignored). Copy the new ones in
and remove the ones you're replacing:
```bash
rm -f client/assets/ships/<old_combat>.glb
cp assets-dist/<new_combat>.glb client/assets/ships/
```

### 5b. Regenerate the collision hitbox
The ship's `model.hitBoxes` / `model.broadR` (the per-part OBB collision hull) are auto-fit from the
combat glb. After the new glb is in `client/assets/ships/` (step 5), regenerate them so collision follows
the new/changed shape:
```bash
npm install                 # one-time: pulls vhacd-js (build-time-only convex-decomposition dep)
npm run assets:hitboxes     # decomposes the glb (V-HACD, memory-capped) → one PCA box per part into catalog_seed.js (idempotent, round-trip verified)
```
Re-run whenever the model, `yaw`, or `scaleMul` changes. Eyeball the fit in-game with the dev-only
`?hitboxes` wireframe overlay. (Primitive/un-modeled ships have none and use the legacy single sphere.)

**Check the bullet-plane coverage report (top-down aim).** `assets:hitboxes` prints, per ship, how many
hitboxes the top-down bullet plane crosses at the current `model.lift` — e.g. `· plane y=0 35/48 (lift 0.2)`
— and a `⚠ up to N at lift≈L` when raising/lowering the model would seat ≥2 more boxes on the plane. The
game is top-down and every bullet flies in one fixed horizontal plane (`state.js` `BULLET_PLANE_Y`), so a
model whose hull sits off it is partly **see-through from above** — centre-aimed shots pass over/under it.
If a ship is flagged, set/adjust its **`stats.model.lift`** (a signed group-local Y offset that raises the
visual model *and* its hitboxes together; positive = up, negative = down) toward the suggested value, then
re-run to confirm the count rose. `lift` is a **judgement call**, not an auto-apply: pushing to the
absolute max can float the model noticeably, so pick the smallest offset that seats the hull and confirm it
looks right in-game with `?hitboxes`. See DECISIONS §47 + `docs/SUMMARY.md`.

### 6. Drift-check guard
```bash
npm run assets:check    # every model_url* + SOUNDS url in the seed must exist on S3 — must say OK
```

### 7. Restart the local server — ALWAYS after a model change
The catalog reseeds only on startup (see fact #1). Find and restart it:
```bash
# find it:  ps aux | grep 'src/server.js' | grep -v grep   → kill <pid>
cd server && node src/server.js   # run in background
```
Verify: `curl -s localhost:4000/api/ships` shows the new `modelUrl`; the new glb returns 200 and the
old one 404. Tell the user to **hard-refresh** the browser (Cmd+Shift+R) to drop the cached catalog.

### 8. Delete the superseded objects on S3 — only for a REPLACEMENT
Remove the **old hashes you replaced** (and the matching old local files). **Keep** every hash still
referenced by `catalog_seed.js` and any *current* (single-version) asset that simply isn't wired to a
ship yet — those are not "old versions". Leave `source/` originals alone.

**Do NOT use a `for f in $LIST` loop** — this repo's shell is **zsh**, which does NOT word-split
unquoted variables, so the loop silently passes the whole blob as one key and deletes nothing. Use one
atomic call instead:
```bash
aws s3api delete-objects --bucket vega-sentinels-assets --delete '{"Objects":[
  {"Key":"ships-combat/<old_combat>.glb"},
  {"Key":"ships-hangar/<old_hangar>.glb"}
]}'
rm -f client/assets/ships/<old_combat>.glb
```
Re-run `npm run assets:check` afterwards to prove nothing referenced was removed.

### 9. Credits — ask the maintainer (mandatory)
Per `CLAUDE.md`: any model **added/replaced/removed** → confirm whether `client/assets/CREDITS.md`
changes (new source → add a row; last use removed → drop the stale row; a CC-BY attribution must stay
while in use). Don't decide silently.

### 10. Docs, commit, deploy
- Update `docs/CHANGELOG.md` (today's date) + `docs/SUMMARY.md` (model section / hashes).
- Commit `catalog_seed.js` + docs (+ `CREDITS.md`). **No binaries** — they're gitignored and live on S3.
- Deploy to prod = **push to `main`** → CI runs `assets:check` + `assets:pull` (bakes combat glbs into
  the image), blue-green deploys, and the fresh container reseeds the catalog automatically. Watch it:
  `gh run watch <id> --exit-status`. Verify with `curl` against `vega.tenony.com` after.

### 11. Re-publish the itch.io build — ALWAYS after a model change reaches prod
The itch export **bundles the combat `.glb` files** into its ZIP (served same-origin from itch.io) but
fetches the **ship catalog LIVE** from `vega.tenony.com` (`API_BASE` baked by `scripts/build-itch.mjs`).
So the moment the prod catalog serves a **new model hash**, the already-published itch ZIP still has the
**old** glb → the client 404s the new hash and falls back to the **generic primitive cone** for exactly
the changed ships (the "generic primitive" bug, itch edition). Whenever a model change lands on prod, also
run **`/publish-itch`** (`assets:pull` → `build:itch` → `butler push dist/itch-staging
bagaiev/vega-sentinels:html5`) so the ZIP re-bundles the new glbs. Verify with
`butler status bagaiev/vega-sentinels:html5`. (Pure model/client change → only publish-itch; the server
was already redeployed in step 10.) See DECISIONS §37.

## Checklist
S3 pushed ✅ · old S3 objects deleted (if replacement) ✅ · catalog wired ✅ · local files refreshed ✅ ·
**hitboxes regenerated (`assets:hitboxes`)** ✅ · `assets:check` OK ✅ · **local server restarted** ✅ ·
CREDITS confirmed ✅ · docs + commit + deploy ✅ ·
**itch re-published (`/publish-itch`)** ✅
