# Ship-model asset pipeline — brief (Vega Sentinels)

> **Implemented 2026-06-23 (tooling + schema + AWS/CI wiring). Only "add a real model" remains.**
> **Done:** the `ships.model_url_high` schema field (migration 012 / PG bootstrap, seed + datastore + API);
> the repo-root `package.json` + `scripts/assets-{build,push,pull,check}.mjs` (gltf-transform via npx + aws
> cli — `assets:build` verified end-to-end on a real glb); content-hashed naming; the drift-check / deploy
> guard (`assets:check`); `.gitignore` for scratch/dist/hashed combat glbs; the scoped **read-only IAM user
> `vega-assets-ci-read`** (verified read-allowed / write-denied) + its key in GitHub secrets
> `ASSETS_AWS_ACCESS_KEY_ID`/`ASSETS_AWS_SECRET_ACCESS_KEY`; and the **`ci-cd.yml` deploy job** runs
> `assets:check` + `assets:pull` (combat models → baked into the image) before rsync/build. All a safe no-op
> today (in-git primitives, empty `ships-combat/`). **Remaining:** produce the first real sourced model
> (drop source in `assets-src/` → `npm run assets:build` → `assets:push` → paste the printed URLs into
> `catalog_seed.js` → commit). See DECISIONS §14.
>
> **Compression policy (so models actually load + preview):** the client uses a plain `GLTFLoader`, so
> **combat glbs are built vanilla** — no meshopt geometry compression, no `EXT_mesh_gpu_instancing`,
> textures kept in their original format — which means they load in-game AND **open in macOS Quick Look /
> Preview**. Size comes from decimation (`--simplify`) + 256px textures. **Hangar** glbs keep **meshopt +
> WebP** (download size); the client wires `setMeshoptDecoder` so they load, but Quick Look can't show them.
> **Viewing a compressed (hangar) glb on macOS:** drag it into a browser viewer — `gltf-viewer.donmccurdy.com`,
> `gltf.report`, `sandbox.babylonjs.com`, or `modelviewer.dev/editor` (all support meshopt/Draco/KTX2); or
> `npx @gltf-transform/cli inspect file.glb` for stats. Quick Look only handles vanilla glb (= the combat ones).

> How to source, optimize, store, and keep ship models in sync. Extends DECISIONS §14 (source↔runtime
> split, CDN) and uses the provisioned CDN: bucket `vega-sentinels-assets`, CloudFront
> `d1843uwjdjg4vs.cloudfront.net`. English-only. Planning window — no code here.

## Low-poly generation — CLI tools exist (no Blender needed)
- **gltf-transform** (`@gltf-transform/cli`): `simplify` (meshoptimizer mesh decimation → low-poly) +
  `optimize` (dedup/weld + Draco/meshopt compression + texture resize / WebP / KTX2). Scriptable.
  (Alt: **gltfpack** `-si <ratio>` — one-shot simplify+compress.)
- From ONE high-poly source per ship, produce **two** outputs:
  - **`<ship>_combat.glb`** — aggressively simplified + compressed → **KB-scale** (the ship is tiny on a
    top-down screen, so heavy decimation is fine).
  - **`<ship>_hangar.glb`** — optimized high-poly (Draco/meshopt + KTX2 textures) → **~1–4 MB**.
- Auto-decimation is fine for tiny combat ships; a hero/hangar model may want a manual pass.

## Storage policy (no binaries in git; S3 is canonical)
- **Source high-poly originals → S3 `source/` prefix** (off-machine backup; lets the pipeline re-run).
- **Combat low-poly → S3 `ships-combat/`**, **pulled to the server at deploy** (CI `aws s3 sync` before
  build) and **served same-origin** from the server's disk. Not in git. Runtime stays same-origin (no
  CORS/CDN dependency); the S3 dependency is deploy-time only, baked into the image.
- **Hangar high-poly → S3 + CloudFront**, lazy-loaded (DECISIONS §14).
- **Content-hashed filenames** everywhere: `<ship>.<hash>.glb`. Hash = version. For the CDN (hangar):
  caches forever, new model = new URL, no invalidation. For combat: the redeploy picks up the new hash.

## Where the links live
In **`catalog_seed.js` per ship**: `model_url` (combat) + `model_url_high` (hangar) → seeded into the DB
(`ships.model_url` / `model_url_high`). Single source of truth for which model a ship uses. CDN entries
are full CloudFront URLs; in-git combat entries stay `assets/ships/<ship>.glb`. (`model_url` already
exists; `model_url_high` is the hangar field from §14.)

## Sync at commit / deploy
Binaries on S3 are **decoupled from app deploys** — the deploy ships only the repo (in-git combat glbs +
the seed carrying the URLs); CDN binaries are already on S3.

**Adding/updating a model (local script — recommended):**
1. Drop the high-poly source (→ `assets-src/` / S3 `source/`), note its target ship.
2. `npm run assets:build` → gltf-transform emits `_combat.glb` + `_hangar.glb`, content-hashed.
3. `npm run assets:push` → `aws s3 cp/sync` the CDN outputs (+ source) to the bucket.
4. The script prints the resulting URLs → paste into `catalog_seed.js` (`model_url` / `model_url_high`).
5. Commit `catalog_seed.js` (URL/path references only — **no binaries**). On deploy, CI `aws s3 sync`s the
   combat models onto the server (baked into the image) and seeds the URLs; hangar models already on CDN.

Because content-hashed URLs live in git and the bytes live on S3, they **can't drift** — a URL only
resolves if that exact build was pushed.

## CI/CD role
- **Generation stays local** — a script (needs the source models + human judgment on the decimation).
- **CI pulls combat models from S3 at deploy** (`aws s3 sync ships-combat/ → client/assets/ships/`,
  before `docker build`, with a read-only key) and bakes them into the image → runtime same-origin, no
  startup S3 dependency.
- **Drift-check / deploy guard:** every `model_url*` in `catalog_seed.js` must exist on S3, else **fail
  the build/deploy** (no ghost ships).

## Resolved
1. **NO binaries in git** — not even combat low-poly. **All models live on S3** (canonical). Combat
   low-poly is **pulled from S3 onto the server at DEPLOY time** (CI step) and **served same-origin** from
   the server's disk — so runtime has no CORS / no client-side CDN dependency (the all-CDN-at-runtime
   downsides don't apply). Hangar high-poly stays on CloudFront, lazy-loaded.
   - **Pull during CI build, NOT at container startup.** CI job: after checkout →
     `aws s3 sync s3://vega-sentinels-assets/ships-combat/ client/assets/ships/` → then the existing
     rsync + `docker build` → the blue-green container is self-contained. This keeps the healthcheck /
     zero-downtime rollout independent of S3 (don't gate readiness on a startup S3 fetch).
   - **Fail the deploy loudly** if any `model_url` referenced in `catalog_seed.js` didn't download (no
     shipping ghost ships).
   - **Trade-offs accepted:** deploy now depends on S3 (recoverable, infrequent); changing a model
     requires a redeploy to land on the server; CI needs an AWS read secret; local dev needs a pull step.
2. **Source originals → S3 `source/` prefix** (canonical, off-machine backup). The local gitignored
   folder is a scratch/staging drawer (to be tidied), NOT the source of truth.
3. **CI drift-check → yes** (and it doubles as the deploy guard): every `model_url*` referenced in
   `catalog_seed.js` must exist on S3, else fail the build/deploy.
4. **Creds:** local `assets:push` uses `claude_admin`. **CI pull uses a scoped read-only key**
   (`vega-assets-ci-read`, S3 GetObject/ListBucket on the assets bucket) as a GitHub secret — NOT admin.
5. **Local dev:** `npm run assets:pull` (`aws s3 sync` → the gitignored assets dir) to get models locally.

## Coordination
A `package.json` `assets:build`/`assets:push` script (gltf-transform + aws cli), `catalog_seed.js` URL
entries, the existing CDN (bucket/distribution), and `applyShipModel` (already loads `model_url`; loads
`model_url_high` lazily per the hangar plan).
