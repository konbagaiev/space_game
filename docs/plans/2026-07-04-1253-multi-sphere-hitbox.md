# Multi-sphere ship hitbox — build brief (Vega Sentinels)

> Feature ID `2026-07-04-1253-multi-sphere-hitbox`. Replace the single fat collision sphere per ship
> with a **multi-sphere hitbox (~5-10 spheres)** auto-fitted to the hull, so hit detection follows the
> elongated model instead of a bubble. Segment-based fit (not sphere-packing), cheap distance tests,
> broad-phase first. Keep it simple — DECISIONS §30.

## Goal

Today every ship collides as one sphere: enemies use `radius = 2.6 * scale` (`client/src/ship-build.js:93`),
the player is a hardcoded `2.6` (`client/src/sim.js:451`) that ignores its model, and player↔rocket ignores
size entirely (`client/src/sim.js:501`). On long hulls this both **over-covers** the sides (bullets that
visually miss still hit) and **under-covers** the nose/tail (`2.6 < 3.06`, the model's real world half-length),
so tip shots miss. This feature auto-fits **5-10 spheres to each ship's real hull** in the asset pipeline,
stores them in the seed, and switches all four bullet/rocket↔ship collision sites to a **broad-phase sphere →
per-model narrow-phase** test. Ships without generated spheres (primitive/cone fallbacks) keep the current
single-sphere behavior. Net user-visible effect: hits register where the ship actually is; grazing shots past
a thin fuselage no longer connect, and shots at the nose/engines do.

## Decisions (settled — do not reopen)

- **Fit = segment slices, not sphere-packing.** ~6 axial spheres (one per Z-slice, radius = that slice's
  cross-section half-extent) + up to 2 lateral **wing** spheres when a slice is much wider than tall
  (`xspan > 1.4 × yspan`), capped at **10** total. Fewer for short/stubby models is fine (drop empty/degenerate
  slices).
- **Coordinate frame (LOAD-BEARING).** Spheres are stored in the **same group-local frame as
  `userData.noseZ`/`tailZ`** — i.e. the model **after** the runtime normalization in
  `client/src/ship-factory.js:42-69`: auto-scale `s = SHIP_MODEL_LEN(3.4) / max(size.x,y,z) * scaleMul`,
  recenter by `-center*s`, then **yaw** (`pivot.rotation.y = yaw`). This is also the outer group's local frame
  at rest (the `bankGroup` is identity except for a **cosmetic** runtime roll). At collision time each sphere is
  transformed by `ship.mesh.matrixWorld` (which folds in position + heading + the `1.8 × sizeScale` world scale
  but **not** the child bank roll → collisions correctly ignore the cosmetic roll, matching SUMMARY line 754),
  with world radius `r * ship.mesh.scale.x`. The auto-fit script **replicates that exact normalization** on the
  glb verts before slicing, reading each ship's `yaw`/`scaleMul` from the seed.
- **`broadR` enclosing radius.** The script emits `broadR = max over spheres of (|center| + r)` (group-local
  units, same frame). Runtime broad-phase radius = `broadR * mesh.scale.x`. This **replaces** the `2.6` broad
  test for modeled ships (it is larger along the long axis → finally covers the full hull). Primitive/cone ships
  with no `hitSpheres` fall back to the legacy world radius `2.6 * sizeScale`.
- **Padding.** Global `HITSPHERE_PAD = 1.1` inflate baked into every sphere radius **by the script** (so runtime
  stays a plain distance test). Keeps hit feel close to today's generous bubble while following the hull.
- **Config lands in the seed by AUTO-REWRITE.** `assets:hitspheres` writes `hitSpheres`/`broadR` directly into
  each ship's `model:{}` block in `server/src/catalog_seed.js`, via a **marker-delimited, idempotent** surgical
  edit (see Step 4) that preserves comments, key order and the other model keys. Verified by re-importing the
  seed and deep-comparing.
- **Fit against the COMBAT glb** (`client/assets/ships/*.glb`, obtained via `npm run assets:pull`) — it is what
  actually renders and is read via the same `NodeIO().registerExtensions(ALL_EXTENSIONS)` loader
  `scripts/assets-recolor.mjs:15,32` already uses (handles meshopt). No new dependency.
- **`?hitspheres` debug overlay in scope** — dev-only wireframe spheres over every ship, mirroring the
  `?debug` hook pattern (`client/src/main.js:501`). No HUD, no toggle UI.
- **Keep `e.radius`.** It is still used for the over-enemy health-bar anchor (`client/src/hud.js:190`) and marker
  placement; collision stops reading it but the field stays.

## Steps

### 1. New collision module — `client/src/collision.js` (new file)

Pure-ish geometry, importable in `node --test` (only `three`-core `Vector3`/matrix math, no addons/DOM):

```js
// Multi-sphere ship hitbox tests. Broad-phase (one enclosing sphere) → narrow-phase (per-model spheres).
// hitSpheres/broadR live in the group-local noseZ frame (see ship-factory.js); mesh.matrixWorld folds in
// position + heading + 1.8×sizeScale but NOT the cosmetic bank roll (a child group). Radii scale by mesh.scale.x.
import * as THREE from 'three';
const _v = new THREE.Vector3();

// World broad-phase radius. Modeled ships → broadR (group-local) × world scale; primitives → legacy 2.6×sizeScale.
export function broadRadius(ship) {
  const sc = ship.mesh.scale.x || 1;
  if (ship.hitSpheres && ship.broadR) return ship.broadR * sc;
  return 2.6 * (ship.sizeScale || 1);
}

// True if world `point` is within `pad` world units of the ship's hull. Broad-phase first; ships without
// hitSpheres fall back to the single broad sphere (unchanged behavior for primitive/cone ships).
export function pointHitsShip(ship, point, pad = 0) {
  const br = broadRadius(ship) + pad;
  if (ship.mesh.position.distanceToSquared(point) > br * br) return false;
  if (!ship.hitSpheres) return true;               // broad sphere IS the hitbox for primitives
  const sc = ship.mesh.scale.x || 1;
  ship.mesh.updateMatrixWorld();                   // sim mutates position mid-frame; refresh before transforming
  const m = ship.mesh.matrixWorld;
  for (const s of ship.hitSpheres) {
    _v.set(s.x, s.y, s.z).applyMatrix4(m);
    const r = s.r * sc + pad;
    if (_v.distanceToSquared(point) <= r * r) return true;
  }
  return false;
}
```

### 2. Wire the four collision sites — `client/src/sim.js`

Add the import near the other local imports at the top of `sim.js`:
`import { pointHitsShip } from './collision.js';`

- **`client/src/sim.js:446`** (bullet↔enemy):
  `if (b.mesh.position.distanceTo(e.mesh.position) < e.radius) {`
  → `if (pointHitsShip(e, b.mesh.position)) {`
- **`client/src/sim.js:451`** (bullet↔player, the hardcoded 2.6):
  `if (G.player.mesh.position.distanceTo(b.mesh.position) < 2.6) {`
  → `if (pointHitsShip(G.player, b.mesh.position)) {`
- **`client/src/sim.js:499`** (rocket↔enemy):
  `if (e.mesh.position.distanceTo(r.obj.position) <= Math.max(r.detonateR, e.radius)) { det = true; break; }`
  → `if (pointHitsShip(e, r.obj.position, r.detonateR)) { det = true; break; }`
  (the rocket's `detonateR` becomes the `pad`, so it detonates within `detonateR` of the real hull — a
  strict improvement over `Math.max(detonateR, radius)`.)
- **`client/src/sim.js:501`** (rocket↔player, currently ignores player size):
  `} else if (G.player.alive && G.player.mesh.position.distanceTo(r.obj.position) <= r.detonateR) {`
  → `} else if (G.player.alive && pointHitsShip(G.player, r.obj.position, r.detonateR)) {`

Leave the bullet↔rocket interception (`sim.js:461`, `< 2.4`) untouched — rockets aren't ships.

### 3. Carry `hitSpheres`/`broadR` onto entities

- **`client/src/ship-factory.js`** — extend `shipModelCfg` (`ship-factory.js:14-23`) to surface the new keys:
  add to the returned object `hitSpheres: m.hitSpheres ?? null,` and `broadR: m.broadR ?? null,`.
- **`client/src/ship-build.js`** — `buildPlayer` (after `sizeScale: mc.scale,` near `ship-build.js:48`): add
  `hitSpheres: mc.hitSpheres, broadR: mc.broadR,`.
- **`client/src/ship-build.js`** — `spawnEnemyShip` (in the `e` object near `ship-build.js:93`, alongside
  `radius: 2.6 * mc.scale,` which STAYS for the health bar): add `hitSpheres: mc.hitSpheres, broadR: mc.broadR,`.

`stats.model.hitSpheres`/`broadR` are plain JSON inside the `stats` blob → they round-trip through
`seedCatalog` with no schema change (same path as `model.muzzle`/`yaw` today). No `db.js`/`db_postgres.js`
edit needed.

### 4. Auto-fit script — `scripts/assets-hitspheres.mjs` (new) + `assets:hitspheres` npm script

Add to the repo-root `package.json` `scripts`: `"assets:hitspheres": "node scripts/assets-hitspheres.mjs"`.

The script (run after `npm run assets:pull` so combat glbs are present locally):

1. **Read ship configs** by importing the seed (it only imports the pure `./enemy_total.js`, so it loads
   standalone): `import { SHIPS } from '../server/src/catalog_seed.js';`. For each ship with a `modelUrl`,
   read `stats.model.yaw ?? 0` and `stats.model.scaleMul ?? 1`. Resolve the local file
   `client/assets/ships/<basename-of-modelUrl>`; error loudly if missing (tell the user to `assets:pull`).
2. **Load the glb** with `new NodeIO().registerExtensions(ALL_EXTENSIONS)` (from `@gltf-transform/core` +
   `@gltf-transform/extensions`, matching `assets-recolor.mjs`).
3. **Gather world-space verts.** Recurse the default scene (`doc.getRoot().listScenes()[0]`, `node.listChildren()`),
   carrying an accumulated `THREE.Matrix4` (compose `THREE.Matrix4().fromArray(node.getMatrix())` down the
   parent chain). For each node with `node.getMesh()`, for each primitive read `POSITION` via
   `prim.getAttribute('POSITION')` (`.getElement(i, out)`), transform each vertex by the accumulated matrix into
   a flat array. (Reusing `three` for the matrix/vector math — it is already a client dep; the script runs in
   Node with core THREE only.)
4. **Replicate the runtime normalization** (mirror `ship-factory.js:42-69`; hardcode `SHIP_MODEL_LEN = 3.4`
   with a comment pointing at `ship-factory.js:32`):
   - AABB → `size`, `center`; `s = 3.4 / max(size.x,size.y,size.z) * scaleMul`.
   - Transform every vert: `v = (v - center) * s`, then rotate about Y by `yaw`
     (`THREE.Matrix4().makeRotationY(yaw)`). Now verts are in the noseZ/group-local frame.
5. **Slice + fit** (forward = **+Z**):
   - Split `[zmin, zmax]` into **6 equal Z-bands**. For each band with verts: sphere center `(cx, cy, zmid)`
     where `cx,cy` = midpoint of that band's X/Y extents; radius = max over the band's verts of
     `hypot(vx-cx, vy-cy)`. Drop bands with no verts or radius `< 0.15` (degenerate tip slivers).
   - **Wing spheres:** find the band with the largest X-span where `xspan > 1.4 * yspan`; add up to 2 spheres
     at `(±0.6*xHalf, cy, zmid)` with radius = that band's Y half-thickness (`max(0.2, yspan/2)`). Skip if it
     would exceed the cap of 10.
   - Apply `HITSPHERE_PAD = 1.1` to every radius. Round `x,y,z,r` to 3 decimals.
   - `broadR = max over spheres of (hypot(x,y,z) + r)`, rounded to 3 decimals.
6. **Safe idempotent write-back** into `server/src/catalog_seed.js`. Pure function
   `upsertHitSpheres(fileText, modelUrl, spheres, broadR)` (export it for the unit test):
   - Anchor on the ship's **unique** `modelUrl: '<url>'` occurrence; from that index find the next match of
     `/model:\s*\{/` (the `\b`/`:` guard means it won't match `modelUrl:`/`modelUrlHigh:`) — that is the same
     ship's model block.
   - The generator owns exactly one **marker-delimited span** it writes inside that block:
     `/* hitspheres:auto:start */ hitSpheres: [ {x:..,y:..,z:..,r:..}, ... ], broadR: N /* hitspheres:auto:end */,`
   - If a `/\/\* hitspheres:auto:start \*\/[\s\S]*?\/\* hitspheres:auto:end \*\/,?/` span already exists between
     that `model: {` and its... (scan forward, this span is self-delimiting so no brace-matching of the model
     block — which is what makes the nested `{x,y,z,r}` objects safe) → **replace it in place**. Else **insert**
     the span immediately after the model block's opening `{`.
   - Never touch `yaw`/`scale`/`scaleMul`/`muzzle`/`exhaust` or any comment — the edit only adds/replaces the
     marked span.
7. **Round-trip verification (mandatory).** After writing, `await import('../server/src/catalog_seed.js?ts=' +
   Date.now())` (cache-busted) and for each ship assert `SHIPS.find(s => s.modelUrl === url).stats.model.hitSpheres`
   deep-equals the generated array and `broadR` matches. If the import throws or values mismatch, restore the
   original text (held in memory) and exit non-zero with a diff. This proves the surgical edit produced valid,
   correctly-parsing JS. Print a per-ship summary (`<name>: N spheres, broadR X`).

Idempotency: because the span is marker-delimited and regenerated deterministically, **running the script twice
produces an identical file** (asserted by the unit test in Step 8).

### 5. Debug overlay — `client/src/hitspheres-debug.js` (new) + one hook in `main.js`

- New module exporting `HITSPHERES_DEBUG` (`typeof location !== 'undefined' && location.search.includes('hitspheres')`,
  evaluated once) and `syncHitSpheres(scene, player, enemies)`. It pools wireframe `THREE.Mesh`
  (`SphereGeometry(1,10,8)`, `MeshBasicMaterial({ color: 0x00ff88, wireframe: true, depthTest: false })`), one
  per hit-sphere across all live ships, plus a fainter enclosing broad-sphere per ship; each frame it positions
  each wireframe at the sphere's world center (`_v.set(s.x,s.y,s.z).applyMatrix4(ship.mesh.matrixWorld)`) and
  sets its scale to `s.r * ship.mesh.scale.x`. Hide unused pooled meshes when ship count drops. Ships without
  `hitSpheres` show only their broad sphere.
- **`client/src/main.js`** — import `{ HITSPHERES_DEBUG, syncHitSpheres }` and, inside `animate()` right after
  `if (!G.paused) update(dt);` (`main.js:456` region), add:
  `if (HITSPHERES_DEBUG) syncHitSpheres(scene, G.player, enemies);`.
  This is dev-only and inert in normal play (mirrors the `?debug`/`?tune` gates).

### 6. Generate the spheres for all existing ships

Run the pipeline once and commit the resulting seed edit:
```bash
npm run assets:pull            # combat glbs → client/assets/ships/ (gitignored)
npm run assets:hitspheres      # writes hitSpheres/broadR into catalog_seed.js, verifies round-trip
```
Covers every ship/structure with a `modelUrl`: `player`, `enemy_1..4`, `enemy_1..4_orange`, `freighter`,
`base_station` (freighter/base_station are set-pieces — generating spheres is harmless; their collision paths
are unchanged by this feature). Eyeball with `?hitspheres` in-game (Step 9).

## Tests

- **`client/src/collision.test.js`** (new) — `node --test`. Construct a fake ship
  `{ mesh: new THREE.Object3D(), sizeScale: 1, hitSpheres: [...], broadR: R }`, set `mesh.position`/`scale`,
  `mesh.updateMatrixWorld()`, and assert `pointHitsShip`: (a) a point inside a nose sphere hits, (b) a point
  just outside every sphere but inside the broad radius **misses** (proves narrow-phase actually runs), (c) a
  point beyond `broadRadius` misses (broad-phase reject), (d) `pad` expands the hit, (e) a ship with
  `hitSpheres: null` falls back to `2.6 * sizeScale` broad behavior, (f) `mesh.scale` scales both center and
  radius (a hit at scale 1 stays a hit at scale 2, a near-miss can flip). If importing `three` in the test
  harness is a problem, also test the extracted pure sphere test directly. Run: `cd client && node --test`.
- **`scripts/assets-hitspheres.test.mjs`** (new) — unit-test the exported `upsertHitSpheres` on a small
  fixture string containing two ships with `model:{}` blocks and inline comments: (a) first run inserts the
  marker span and the fixture still parses to the right values, (b) surrounding keys/comments are byte-identical
  except the inserted span, (c) **running it twice yields an identical string** (idempotent). Run:
  `node --test scripts/assets-hitspheres.test.mjs`.
- **`server`** — add a small assertion (in the existing catalog/seed test, or a new one) that a seeded ship's
  `stats.model.hitSpheres` survives `seedCatalog` → fetch, so the JSON-blob round-trip is covered on **both**
  SQLite and Postgres (`cd server && npm test`). No `db.js`/`db_postgres.js` change is expected; the test just
  guards the parity-sensitive JSON path.
- **Client visual suite** unaffected structurally; judge by the reliably-passing set + zero page errors
  (baseline is flaky per the visual-suite note).

## Docs to update

- **`docs/SUMMARY.md`** — the ship-model / collision section (around lines **290-297** on `model.*`, and line
  **754** "collisions use `mesh.position`"): document `model.hitSpheres` + `broadR` (auto-fit, group-local noseZ
  frame, `HITSPHERE_PAD 1.1`), the broad-phase→narrow-phase collision, that all four bullet/rocket↔ship sites
  use it (player included, fixing the old hardcoded 2.6), the primitive single-sphere fallback, that `e.radius`
  now only anchors the health bar, and the `?hitspheres` overlay. Bump `**Updated:**`.
- **`docs/CHANGELOG.md`** — one bullet under today's date: **"Multi-sphere ship hitboxes"** — auto-fit ~5-10
  spheres per hull in `assets:hitspheres`, seed-stored `model.hitSpheres`/`broadR`, broad→narrow collision at
  all four bullet/rocket↔ship sites (fixes hardcoded player 2.6 + missing player↔rocket radius), `?hitspheres`
  debug overlay.
- **`docs/plans/ship-model-pipeline.md`** — add `npm run assets:hitspheres` (after `assets:pull`) as a step in
  the "adding/updating a model" flow; note it auto-writes `hitSpheres`/`broadR` into the seed.
- **`docs/plans/adding-a-ship-model.md`** — extend the `stats.model` block doc with `hitSpheres`/`broadR` (auto-
  generated, don't hand-author; regenerate via `assets:hitspheres`; primitives omit them) and add a step to run
  it + eyeball with `?hitspheres`.
- **`.claude/skills/update-ship-model/SKILL.md`** — insert a step (after step 5 "refresh the local serve dir",
  before the drift check): run `npm run assets:hitspheres` to (re)generate the hull spheres into the seed, and
  add it to the checklist.
- **`docs/DECISIONS.md`** — new **§45**: multi-sphere hitbox via **segment-slice auto-fit** (chosen over
  sphere-packing and over hand-authored spheres — §30), stored in the noseZ group-local frame, broad-phase
  enclosing sphere + `HITSPHERE_PAD 1.1`, seed auto-rewrite by marker-delimited idempotent edit, and primitive
  single-sphere fallback.

## Out of scope / non-goals (DECISIONS §30)

- **No sphere-packing / convex decomposition / physics engine** — segment slices only.
- **No per-frame BVH / spatial hash / broad-phase grid** — the existing per-ship enclosing sphere is the only
  broad-phase; narrow-phase runs only when it passes.
- **No ship↔ship or ship↔drop collision changes** — only the four bullet/rocket↔ship sites. Bullet↔rocket
  interception (`sim.js:461`) and the loot-drop/tractor pickup radii stay as-is.
- **No new hitbox tuning UI** beyond the read-only `?hitspheres` wireframe (no lil-gui panel, no per-sphere HUD).
- **No `e.radius` removal** — kept for the health-bar/marker anchor.
- **No hangar/high-poly fitting** — spheres are fit to the combat glb only (what renders in battle).
- **No re-publish/deploy steps here** — this is client + pipeline + seed data; no model asset hash changes, so
  no `/publish-itch` step is required (the combat glbs themselves are untouched).
