# Ship hitbox via convex decomposition → one OBB per part — build brief (Vega Sentinels)

> Feature ID `2026-07-04-1253-multi-sphere-hitbox` (OBB iteration). **Supersedes** the multi-**sphere**
> hitbox already built on this branch (commits `fc8ca51`, `c1a0ab3`). Inscribed spheres cannot cover
> thin wings — a per-cross-section sphere is "a ball with bulges" and either over-covers the gaps between
> wings or under-covers the wingtips. This iteration replaces the spheres with a **V-HACD convex
> decomposition → one oriented bounding box (OBB) per near-convex part**: each wing (incl. its tip pod) is
> its own part, and one tight OBB per part gives ~100% surface coverage with ~0.64% max poke-out in a
> 7-15-box budget. Keep it simple — DECISIONS §30. The spheres were the first cut on this same unmerged
> branch; nothing shipped to prod, so this is a clean in-place replacement, no back-compat.

## Goal

Replace the per-ship `stats.model.hitSpheres` array with `stats.model.hitBoxes` — a handful of oriented
bounding boxes auto-fit to the hull by decomposing the combat glb into near-convex parts (V-HACD via
`vhacd-js`) and wrapping each part in a PCA oriented box. Collision (`client/src/collision.js`) stays a
**broad-phase enclosing sphere → narrow-phase point-vs-OBB-set** test, THREE-free. Net user-visible
effect vs the spheres: hits follow the actual winged silhouette — a bullet that passes through the empty
gap **beyond a thin wing** no longer connects, while shots that visually touch a wingtip do. The four
bullet/rocket↔ship sites, the hull-relative rocket blast-damage fix, and the retuned `detonateRadius`
(~1.0/1.2) all carry over from the sphere iteration **unregressed** — this change is confined to the
hitbox primitive (sphere → OBB), its offline fitter, its schema key, and its debug overlay.

## Decisions (settled — do not reopen)

- **Fit = V-HACD convex decomposition, one PCA-OBB per part** (chosen over inscribed/packed spheres, over
  hand-authored boxes, and over a physics engine). Rationale: spheres can't wrap a thin swept wing; a
  near-convex part wrapped in a tight OBB can. See `docs/plans/multi-sphere-hitbox-fit-research.md` + the
  two-spike verdict. §30: this is still just "does this point touch the hull" — a handful of cheap OBB
  projection tests, no runtime BVH/physics.
- **OBB storage schema** — each box is
  `{ c:{x,y,z}, h:{x,y,z}, u0:{x,y,z}, u1:{x,y,z}, u2:{x,y,z} }`: center `c`, half-extents `h`, and three
  **orthonormal group-local axis vectors** `u0,u1,u2`. Stored in the **same normalized group-local noseZ
  frame** the spheres used (after ship-factory's auto-scale to `SHIP_MODEL_LEN` 3.4 + recenter + `yaw`).
  `broadR` (the enclosing broad-phase radius, same frame) is kept alongside, recomputed as the exact
  farthest OBB corner from the origin.
- **Runtime point-vs-OBB test** (THREE-free projection test): world point `p`, world box center `wc = M·c`
  (affine, `M = mesh.matrixWorld`). For each axis `uᵢ`: rotate it by `M`'s upper-3×3 and **normalize**
  (the world scale is uniform `sc = mesh.scale.x`, so `|M₃·uᵢ| = sc`), giving world unit axis `wuᵢ`; the
  point is inside iff `|dot(p − wc, wuᵢ)| ≤ hᵢ·sc + pad` for **all three** axes. `pad` (rocket proximity
  fuse / blast reach) expands every half-extent — a square-cornered Minkowski inflate, exact enough for a
  fuse. Transforming by `matrixWorld` folds in position + heading + the 1.8×sizeScale world scale but
  **not** the child `bankGroup` roll → collisions correctly ignore the cosmetic bank (matches SUMMARY).
- **Full replace, no back-compat.** New key `hitBoxes` **replaces** `hitSpheres` everywhere; the sphere
  narrow-phase is deleted from `collision.js`. The fitter, script name (`assets-hitboxes.mjs` /
  `assets:hitboxes`), markers (`/* hitboxes:auto:start|end */`), overlay (`?hitboxes`), and tests are all
  renamed. The write-back also **strips any legacy `/* hitspheres:auto:* */` span** in the same model
  block so a single run migrates the seed cleanly (no orphan `hitSpheres:` data).
- **Fit tight, not generous.** The spheres baked a multiplicative `HITSPHERE_PAD 1.1` (round + generous).
  OBBs are meant to be **tight** (that's the whole point — misses in the wing gap), so the fitter adds only
  a tiny additive `HITBOX_MARGIN = 0.05` (group-local units, ~1.5% of length) to each half-extent for
  surface-hit reliability. No 2× inflate — the scale-sanity test fails on any oversized result.
- **Memory safety (HARD requirement).** A prior spike OOM-froze the maintainer's Mac. The fitter caps
  `voxelResolution: 100000` (≤100k) and `maxHulls: 16`, plus `maxVerticesPerHull: 32`. No unbounded
  voxel/distance/recursion work — `maxRecursionDepth` left at the library default (10). These caps are
  non-negotiable; state them in-code and in the docs.
- **`vhacd-js` is a build-time-only dep** (never shipped to the browser; the fitter runs in Node). It has
  **no `main`/`exports`, only `"module"`** → import the subpath `vhacd-js/lib/vhacd.js`, not the bare
  specifier. API (confirmed from its shipped `lib/vhacd.d.ts`):
  `const dec = await ConvexMeshDecomposition.create();` then
  `dec.computeConvexHulls({ positions: Float64Array /*xyz triplets*/, indices: Uint32Array /*triangles*/ }, { maxHulls: 16, voxelResolution: 100000, fillMode: 'raycast', maxVerticesPerHull: 32, minVolumePercentError: 1, messages: 'none' })`
  → returns `Mesh[]`, each `{ positions: Float64Array, indices: Uint32Array }`. **PCA-OBB is fit from each
  hull's `positions`** (the vertex cloud). `fillMode: 'raycast'` handles the non-watertight combat glbs —
  no watertight repair needed.
- **Deterministic output (for idempotency).** PCA eigenvector order/sign is otherwise arbitrary; the
  fitter **canonicalizes** each OBB — order the 3 axes by **descending half-extent** (`u0` = longest), and
  flip each axis so its largest-magnitude component is ≥ 0. With fixed V-HACD options + a deterministic
  Jacobi eigensolver + canonicalization + fixed rounding, **running the script twice yields a
  byte-identical seed** (asserted by the unit test).
- **Primitive/un-modeled ships** (no `hitBoxes`) keep the legacy single broad sphere `2.6 × sizeScale`
  (`LEGACY_R`), exactly as today — unchanged.
- **Keep `e.radius`** (`2.6 × scale`) — still the over-enemy health-bar / marker anchor
  (`client/src/hud.js`); collision does not read it.
- **No re-publish/deploy of itch.** The combat **glbs are untouched** (no content-hash change) — only
  collision *data* in the seed changes. Per the itch-republish lesson, republish is only needed on a model
  **asset hash** change; there is none here, so **no `/publish-itch` step**.

## Steps

### 1. Add the dependency — repo-root `package.json`

- Add `"vhacd-js": "^0.0.1"` to `devDependencies` (build-time only). `@gltf-transform/core` +
  `@gltf-transform/extensions` are already present (the sphere fitter uses them). Run `npm install`.
- **Verify the real API before wiring the fitter.** `vhacd-js` is not yet installed in the worktree, so
  the API in this plan is cited from its published `lib/vhacd.d.ts` but **unverified at runtime**. After
  `npm install`, open `node_modules/vhacd-js/lib/vhacd.d.ts` and confirm: the subpath entry is
  `vhacd-js/lib/vhacd.js` (no `main`/`exports`), `ConvexMeshDecomposition.create()` returns a
  `Promise`, `computeConvexHulls(mesh, options)` takes `{ positions: Float64Array, indices: Uint32Array }`
  and the `Options`/`fillMode` fields used below (`maxHulls`, `voxelResolution`, `fillMode: 'raycast'`,
  `maxVerticesPerHull`, `messages`), and each returned hull is `{ positions, indices }`. If the shipped
  API differs (e.g. a renamed export or a different mesh shape), adjust the fitter (Step 4) to match
  **before** building it — do not assume this plan's signature over the installed types.
- Rename the npm script `package.json:11`:
  `"assets:hitspheres": "node scripts/assets-hitspheres.mjs",` → `"assets:hitboxes": "node scripts/assets-hitboxes.mjs",`.

### 2. Runtime collision — `client/src/collision.js` (rewrite the narrow phase)

Keep the module **THREE-free** (inline `matrixWorld.elements` math, importable under `node --test`). Keep
`LEGACY_R = 2.6` and the `distSq` helper. Replace `hitSpheres` → `hitBoxes` and the sphere loop with a
point-vs-OBB loop:

```js
const LEGACY_R = 2.6; // primitive/cone fallback radius, ×sizeScale

function distSq(p, x, y, z) {
  const dx = p.x - x, dy = p.y - y, dz = p.z - z;
  return dx * dx + dy * dy + dz * dz;
}

// World broad-phase radius. Modeled ships → broadR (group-local) × world scale; primitives → legacy.
export function broadRadius(ship) {
  const sc = ship.mesh.scale.x || 1;
  if (ship.hitBoxes && ship.broadR) return ship.broadR * sc;
  return LEGACY_R * (ship.sizeScale || 1);
}

// Rotate a group-local unit axis u by matrixWorld's upper-3x3, normalize (uniform world scale sc), and
// return whether the offset (dx,dy,dz) projects within h·sc + pad along it. THREE-free.
function withinAxis(e, u, dx, dy, dz, h, sc, pad) {
  let ax = e[0] * u.x + e[4] * u.y + e[8] * u.z;
  let ay = e[1] * u.x + e[5] * u.y + e[9] * u.z;
  let az = e[2] * u.x + e[6] * u.y + e[10] * u.z;
  const len = Math.hypot(ax, ay, az) || 1; // == sc for a unit axis under uniform scale
  ax /= len; ay /= len; az /= len;
  const proj = dx * ax + dy * ay + dz * az;
  return Math.abs(proj) <= h * sc + pad;
}

// True if world `point` is within `pad` world units of the ship's hull. Broad-phase first; ships without
// hitBoxes fall back to the single broad sphere (unchanged for primitive/cone ships).
export function pointHitsShip(ship, point, pad = 0) {
  const p = ship.mesh.position;
  const br = broadRadius(ship) + pad;
  if (distSq(point, p.x, p.y, p.z) > br * br) return false;
  if (!ship.hitBoxes) return true;               // broad sphere IS the hitbox for primitives
  const sc = ship.mesh.scale.x || 1;
  ship.mesh.updateMatrixWorld();                 // sim mutates position mid-frame; refresh before transform
  const e = ship.mesh.matrixWorld.elements;      // column-major 4x4 (pos + heading + uniform world scale)
  for (const b of ship.hitBoxes) {
    const cx = e[0] * b.c.x + e[4] * b.c.y + e[8] * b.c.z + e[12];
    const cy = e[1] * b.c.x + e[5] * b.c.y + e[9] * b.c.z + e[13];
    const cz = e[2] * b.c.x + e[6] * b.c.y + e[10] * b.c.z + e[14];
    const dx = point.x - cx, dy = point.y - cy, dz = point.z - cz;
    if (withinAxis(e, b.u0, dx, dy, dz, b.h.x, sc, pad)
      && withinAxis(e, b.u1, dx, dy, dz, b.h.y, sc, pad)
      && withinAxis(e, b.u2, dx, dy, dz, b.h.z, sc, pad)) return true;
  }
  return false;
}
```

Update the module header comment (sphere → OBB). The exported surface (`pointHitsShip`, `broadRadius`) is
unchanged, so **`sim.js` and `projectiles.js` need no edits** — their four `pointHitsShip(...)` calls and
the hull-relative `detonateRocket` blast-damage loop carry over verbatim.

### 3. Carry `hitBoxes`/`broadR` onto entities (rename from hitSpheres)

- **`client/src/ship-factory.js:22`** — replace `hitSpheres: m.hitSpheres ?? null,` with
  `hitBoxes: m.hitBoxes ?? null, // per-part OBB hitbox (group-local noseZ frame); null → primitive single-sphere fallback`.
  Keep line 23 `broadR: m.broadR ?? null,` (comment already fits).
- **`client/src/ship-build.js:49`** (buildPlayer): `hitSpheres: mc.hitSpheres, broadR: mc.broadR,` →
  `hitBoxes: mc.hitBoxes, broadR: mc.broadR,`.
- **`client/src/ship-build.js:95`** (spawnEnemyShip): same rename. Leave line 94
  `radius: 2.6 * mc.scale,` (health-bar anchor) untouched; update its trailing comment `hitSpheres/broadR`
  → `hitBoxes/broadR`.

`stats.model.hitBoxes`/`broadR` are plain JSON inside the `stats` blob → they round-trip through
`seedCatalog` with **no `db.js`/`db_postgres.js` change** (same path as `model.muzzle`/`yaw`).

### 4. Offline fitter — `scripts/assets-hitboxes.mjs` (new; replaces `assets-hitspheres.mjs`)

Delete `scripts/assets-hitspheres.mjs`. New script, run after `npm run assets:pull` (combat glbs local).
Reuse verbatim from the old fitter: the header/pull guard, `decodeToPlain` (meshopt → plain temp glb via
`npx @gltf-transform/cli dedup`, read with `NodeIO().registerExtensions(ALL_EXTENSIONS)`), the column-major
matrix helpers (`mul`, `xform`, `IDENT`), and the seed round-trip verification + restore-on-mismatch.

Changes vs the sphere fitter:

1. **Gather merged positions + indices** (V-HACD needs triangles, the sphere fitter dropped indices).
   Extend `gatherVerts` → `gatherMesh(node, parentM, out)` where `out = { pos: [], idx: [] }`: for each
   primitive, transform each `POSITION` vertex by the accumulated matrix and push into `out.pos`, read the
   primitive's `indices` accessor (`prim.getIndices()`), and push each index **offset by the running
   vertex base** (`base = out.pos.length/3` before this primitive). Handle a null index accessor
   (un-indexed prim) by emitting sequential `[base, base+1, base+2, …]`.
2. **Replicate the normalization** exactly as the sphere fitter did (mirror `ship-factory.js:44-58`;
   hardcode `SHIP_MODEL_LEN = 3.4` with a comment → `ship-factory.js:34`): raw AABB → `center`, `size`;
   `s = 3.4 / max(size.x,size.y,size.z) * scaleMul`; each vert `v = (v - center)*s` then `rotateY(yaw)`.
   Produce `Float64Array positions` (normalized xyz triplets) + `Uint32Array indices`.
3. **Decompose** (create the decomposer **once**, reuse across ships):
   ```js
   import { ConvexMeshDecomposition } from 'vhacd-js/lib/vhacd.js';
   const dec = await ConvexMeshDecomposition.create();
   const hulls = dec.computeConvexHulls(
     { positions, indices },
     { maxHulls: 16, voxelResolution: 100000, fillMode: 'raycast',
       maxVerticesPerHull: 32, minVolumePercentError: 1, messages: 'none' },
   );
   ```
   The caps (`voxelResolution ≤ 100000`, `maxHulls ≤ 16`) are the **memory guard** — do not raise them.
4. **PCA-OBB per hull** (`fitOBB(hullPositions) → { c, h, u0, u1, u2 }`), from each hull's `positions`:
   - centroid `mean`; symmetric 3×3 covariance of `(v − mean)`.
   - eigen-decompose via a small **Jacobi rotation** solver for a symmetric 3×3 (cyclic sweeps until
     off-diagonals < 1e-10 or ~12 sweeps) → 3 orthonormal eigenvectors = box axes.
   - project all hull verts onto each axis → per-axis `[min,max]`; half-extent `hᵢ = (max−min)/2 + HITBOX_MARGIN`;
     center `c = mean + Σ ((minᵢ+maxᵢ)/2)·axisᵢ`.
   - **canonicalize**: sort the 3 (axis, half-extent) triples by descending half-extent (`u0`=longest);
     flip each axis so its largest-|component| is ≥ 0. Deterministic.
   - `HITBOX_MARGIN = 0.05`. Round `c`/`h` to 3 decimals (`r3`), axes to 4 decimals (`r4`) — runtime
     re-normalizes axes, so 4-decimal unit vectors are safe.
5. **`broadR`** — exact farthest corner: for each box, over the 8 sign combos
   `corner = c ± h.x·u0 ± h.y·u1 ± h.z·u2`, take `max(|corner|)`; `broadR = max over boxes`, `r3`-rounded.
6. **Idempotent seed write-back** — export `upsertHitBoxes(fileText, modelUrl, boxes, broadR)` (for the
   unit test). Same anchor strategy as the old `upsertHitSpheres` (find `modelUrl: '<url>'`, then the next
   `/model\s*:\s*\{/`), but:
   - The owned span is
     `/* hitboxes:auto:start */ hitBoxes: [ {c:{x,..},h:{x,..},u0:{x,..},u1:{x,..},u2:{x,..}}, … ], broadR: N /* hitboxes:auto:end */,`.
   - The replace regex right after `model: {` consumes an optional **existing hitboxes span OR a legacy
     hitspheres span** and re-emits the hitboxes span:
     `/^\{[ \t]*(?:\/\* hit(?:boxes|spheres):auto:start \*\/[\s\S]*?\/\* hit(?:boxes|spheres):auto:end \*\/,[ \t]*)?/`.
     This migrates every ship off the old `hitSpheres` data in one pass and stays idempotent.
7. **Round-trip verify** (unchanged pattern): re-import the written seed cache-busted, deep-compare each
   ship's `stats.model.hitBoxes`/`broadR`; on any mismatch restore the original text and exit non-zero.
   Print a per-ship summary (`<name>: N boxes, broadR X`).

### 5. Debug overlay — `client/src/hitboxes-debug.js` (new; replaces `hitspheres-debug.js`)

Delete `client/src/hitspheres-debug.js`. New module (may use THREE — it is client-side):

- `export const HITBOXES_DEBUG = typeof location !== 'undefined' && location.search.includes('hitboxes');`
- `export function syncHitBoxes(scene, player, enemies)` — pool wireframe boxes
  (`THREE.BoxGeometry(1,1,1)`, `MeshBasicMaterial({ color:0x00ff88, wireframe:true, depthTest:false })`),
  one per box across all live ships, plus a fainter enclosing broad **sphere** per ship (unchanged from
  the old overlay: `SphereGeometry(1,10,8)`, scaled `broadR·sc`). Each frame, for each box: world center
  `_v.set(b.c).applyMatrix4(mesh.matrixWorld)`; world axes = each `uᵢ` rotated by
  `_nm.getNormalMatrix(mesh.matrixWorld)` then normalized; build the box mesh's matrix with
  `m.makeBasis(wu0,wu1,wu2)` then scale its three columns by `2·hᵢ·sc` and `m.setPosition(worldCenter)`;
  set `boxMesh.matrixAutoUpdate = false; boxMesh.matrix.copy(m)`. Hide unused pooled meshes when ship/box
  count drops. Ships without `hitBoxes` show only the broad sphere.
- **`client/src/main.js:24`** — `import { HITBOXES_DEBUG, syncHitBoxes } from './hitboxes-debug.js';`.
- **`client/src/main.js:458`** — `if (HITBOXES_DEBUG) syncHitBoxes(scene, G.player, enemies);`.

### 6. Regenerate hitbox data for every modeled ship — `server/src/catalog_seed.js`

```bash
npm install                    # pulls vhacd-js
npm run assets:pull            # combat glbs → client/assets/ships/ (gitignored)
npm run assets:hitboxes        # decompose → PCA-OBBs → writes hitBoxes/broadR, strips legacy hitSpheres, verifies round-trip
```

Rewrites the **9 modeled ships in `SHIPS`** (player, enemy_1..4, enemy_1..4_orange) — the
`/* hitspheres:auto:* */` spans currently at `catalog_seed.js:223,236,246,260,270,286,305,321` and the
remaining orange block. The fitter iterates `SHIPS.filter(s => s.modelUrl)`; the set-pieces `freighter` /
`base_station` live in **`MAPS`** (`catalog_seed.js:514+`), are **not** fitted, and are untouched (their
collision paths are unchanged by this feature). Also update the stray prose comment on `catalog_seed.js:99`
(`detonateRadius = proximity fuse to the HULL (hitSpheres) …`) → `(hitBoxes)`. Eyeball in-game with
`?hitboxes` (Step 8 verification).

## Tests

- **`client/src/collision.test.js`** (rewrite for OBB) — `cd client && node --test`. Reuse the THREE-free
  `mesh(px,py,pz,s)` stub (column-major `matrixWorld.elements`). Define an axis-aligned box
  (`u0/u1/u2` = world axes) so the projection test is hand-checkable, e.g. a nose box
  `{ c:{x:0,y:0,z:1}, h:{x:0.4,y:0.3,z:0.6}, u0:{x:1,y:0,z:0}, u1:{x:0,y:1,z:0}, u2:{x:0,y:0,z:1} }`.
  Keep/adapt the sphere test intents: (a) a point inside a box hits; (b) a point inside `broadR` but
  outside every box **misses** (narrow-phase runs); (c) a point beyond `broadR` misses (broad reject);
  (d) `pad` expands the hit; (e) `hitBoxes:null` falls back to `2.6×sizeScale` broad behavior; (f)
  `mesh.scale` scales both center and half-extents (a near-miss flips to a hit at scale 2). Add a **rotated
  box** case: axes at 45° in XZ, assert a point that would be inside an *axis-aligned* box of the same
  extents but is *outside* the rotated one **misses** (proves the orientation is actually applied, not
  ignored).
- **OUTCOME test — bullet hits the hull but misses in the gap beyond a wing** (the whole point of tight
  boxes): build a ship with a thin fuselage box (narrow in X, centered) + one wing box offset to `+X` with
  a **gap** to `+X` beyond its tip and to `−X` on the other side. Assert: a point on the fuselage → hit; a
  point on the wing box → hit; a point in the **empty lateral gap** between fuselage and wingtip that is
  within `broadR` but outside all boxes → **miss**; a point just beyond the wingtip → miss. This is the
  regression the spheres could not satisfy.
- **OUTCOME test — a rocket actually damages an enemy** (carry the sphere iteration's regression, retargeted
  to `hitBoxes`): mirror the hull-relative `detonateRocket` loop
  (`if (pointHitsShip(enemy, rocket.obj.position, rocket.blastR)) enemy.hp -= rocket.damage;`) with a
  detonation point on a nose box but **beyond `blastR` of the center**, assert hp drops; cover player→enemy
  and enemy→player. Guards that the OBB change didn't reintroduce "rockets deal no damage."
- **`scripts/assets-hitboxes.test.mjs`** (new; replaces `assets-hitspheres.test.mjs`) —
  `node --test scripts/assets-hitboxes.test.mjs`:
  - `upsertHitBoxes` on a two-`model:{}`-block fixture: inserts the `/* hitboxes:auto:* */` span, preserves
    surrounding keys/comments, only touches the target ship, and **running twice is idempotent**.
  - **Migration**: a fixture whose block already contains a legacy `/* hitspheres:auto:start */ hitSpheres:[…], broadR:… /* hitspheres:auto:end */,`
    span → after `upsertHitBoxes`, the legacy span is gone and only the hitboxes span remains.
  - **Edited text still parses** to the generated values (import a temp `.mjs`, deep-compare `hitBoxes`).
  - **Scale-sanity (must FAIL on a 2×-inflated fit)** — for **every modeled ship in `SHIPS`** with a
    `modelUrl` (`import { SHIPS }`; there are **9** — player + enemy_1..4 + enemy_1..4_orange; the
    set-pieces `freighter`/`base_station` live in `MAPS`, are **not** fitted, and must **not** be
    asserted on). `assert(modeled.length >= 9)`. Let `LEN = SHIP_MODEL_LEN = 3.4`, `HALF = 1.7`. For each:
    - has `hitBoxes` array with `length >= 1` + numeric `broadR`. (Floor is `1`, not `3`: V-HACD box
      count is geometry-dependent — a near-convex ship may decompose into 1-2 hulls. Inflation is guarded
      by the size/span ceilings below, not the count.)
    - `0.8 ≤ broadR ≤ HALF + 0.7` (≈ 2.4). A ~2.8 round-bubble fails the ceiling; the `+0.7` headroom
      allows a legit OBB corner that sticks out diagonally past the half-length.
    - each box half-extent `h.{x,y,z} ≤ HALF + 0.15` (no single box longer than the hull's half-length).
    - **union FULL span** — build the group-local axis-aligned bounds over the 8 corners
      `c ± h.x·u0 ± h.y·u1 ± h.z·u2` of **every** box; the span (`max − min`) along the **longest** of the
      three axes must be `3.0 ≤ span ≤ 4.0`. This measures the **full** extent, matching
      `ship-factory.js:47` which normalizes the model's longest-axis **full** extent to `LEN = 3.4` (so a
      correct tight union spans ≈ 3.4, `≥ 3.4` in practice because a rotated OBB's axis-aligned bounds
      exceed the model). **Floor 3.0** trips on a genuine ~2× **under-fit** (a fit covering only half the
      ~3.4 hull spans ~1.7 ≪ 3.0); **ceiling 4.0** trips on a ~2× **over-fit** (a doubled fit spans ~6.8),
      while leaving room above 3.4 for rotated-OBB overhang.
    - **Implementer note:** these bounds are deliberately loose enough to never reject a correct fit.
      When you run `assets:hitboxes` (Step 6), record each ship's actual box count / `broadR` / union span
      and confirm every modeled ship clears the `>= 1` count and sits comfortably inside these bounds; if
      an outlier hugs a bound, investigate the fit before tightening.
- **`server/src/server.test.js:328-331`** — replace the `hitSpheres` assertions: assert
  `Array.isArray(player.stats.model.hitBoxes)` (`.length >= 1` — the winged player realistically yields
  several, but keep the floor at `1` to match the geometry-dependent count guarded elsewhere by the size
  bounds), each box has numeric `c/h/u0/u1/u2` with `x,y,z`, and `typeof …broadR === 'number'`. Guards the
  JSON-blob round-trip on **both** SQLite and Postgres (`cd server && npm test`). No
  `db.js`/`db_postgres.js` change expected.
- **Client visual suite** — structurally unaffected; judge by the reliably-passing set + zero page errors
  (baseline is flaky per the visual-suite note).

## Docs to update

- **`docs/SUMMARY.md`** — the ship-model/collision paragraph (**lines ~305-325**, `model.hitSpheres` +
  `model.broadR`), the intro reference (**lines 9-11**), and the collision note (**line ~781**): rewrite
  `hitSpheres`→`hitBoxes`, "~4-8 spheres … along the longest horizontal axis" → "one **oriented bounding
  box per near-convex part** (V-HACD decomposition, ~7-15 boxes)", frame + `broadR` unchanged, narrow-phase
  = point-vs-OBB (`|dot(p−c,uᵢ)| ≤ hᵢ` per axis), tight fit (`HITBOX_MARGIN 0.05`, no 1.1 bubble),
  `assets:hitboxes` writes them, `?hitboxes` overlay, primitive single-sphere fallback unchanged. Keep the
  detonateR/blast paragraphs (still true). Bump `**Updated:**`.
- **`docs/CHANGELOG.md`** — one bullet under today's date: **"Ship hitboxes: convex-decomposition OBBs
  (replaces multi-sphere)"** — `assets:hitboxes` decomposes each combat glb with V-HACD and fits one PCA
  oriented box per part into `model.hitBoxes`/`broadR`; runtime narrow-phase is point-vs-OBB in
  `collision.js`; `?hitboxes` overlay; tight fit so bullets miss in the gap beyond a wing; rocket
  hull-relative damage + `detonateRadius` carry over unchanged. Note it supersedes the same-branch
  multi-sphere iteration; no glb hash change so no itch republish.
- **`docs/DECISIONS.md` §45** — retitle to "Ship hitbox via convex decomposition → one OBB per part (vs
  multi-sphere / hand-authored / a physics engine)". Rewrite the fit paragraphs (drop the sphere-slice +
  radius-cap detail) to describe V-HACD (`vhacd-js`, subpath import, `raycast` fill, memory caps
  `voxelResolution 100000`/`maxHulls 16`) + per-hull PCA-OBB + canonicalization for determinism + the
  `{c,h,u0,u1,u2}` schema + the point-vs-OBB runtime test. **Keep** the still-true paragraphs verbatim:
  hull-relative rocket blast damage, the `detonateRadius` retune (~1.0/1.2), the meshopt-decode approach,
  and the auto-rewrite/round-trip. Add a one-line note that inscribed spheres were the first cut on this
  branch, superseded because they can't cover thin wings (cite the research brief).
- **`docs/plans/ship-model-pipeline.md:61-65`** — `assets:hitspheres`→`assets:hitboxes`,
  `hitSpheres`→`hitBoxes`, `?hitspheres`→`?hitboxes`; note it needs `vhacd-js` (`npm install` once) and
  decomposes the combat glb (memory-capped).
- **`docs/plans/adding-a-ship-model.md:22-23,49-55,75-82`** — replace the `hitSpheres`/example +
  the "collision hitbox (auto-generated)" section + the generate step with `hitBoxes`
  (`{c,h,u0,u1,u2}` per part), `assets:hitboxes`, `?hitboxes`; still "don't hand-author".
- **`.claude/skills/update-ship-model/SKILL.md:70-77,135`** — `assets:hitspheres`→`assets:hitboxes`,
  `hitSpheres`→`hitBoxes`, `?hitspheres`→`?hitboxes`, checklist line "hitspheres regenerated" → "hitboxes
  regenerated"; note the one-time `npm install` for `vhacd-js`.

## Out of scope / non-goals (DECISIONS §30)

- **No runtime physics engine / GJK / per-triangle collision** — offline V-HACD only; runtime is a
  handful of point-vs-OBB projection tests behind the existing broad sphere.
- **No min-volume-optimal OBB search** — PCA-from-hull-vertices is enough (the spike verified ~0.64%
  poke-out). No iterative rotating-calipers refinement.
- **No per-frame BVH / spatial hash** — the per-ship enclosing sphere is the only broad phase.
- **No ship↔ship / ship↔drop / bullet↔rocket collision changes** — only the same four bullet/rocket↔ship
  sites, and they keep calling `pointHitsShip` unchanged.
- **No new tuning UI** beyond the read-only `?hitboxes` wireframe (no lil-gui, no per-box HUD).
- **No `e.radius` removal** — kept for the health-bar/marker anchor.
- **No hangar/high-poly fitting** — boxes are fit to the combat glb only.
- **No `db.js`/`db_postgres.js` schema change** — `hitBoxes` rides the existing `stats` JSON blob.
- **No `/publish-itch` / redeploy of assets** — no combat-glb hash changes, only seed collision data.
```
