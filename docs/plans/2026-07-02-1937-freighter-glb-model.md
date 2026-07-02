# Freighter set-piece → real `.glb` model (keep the fiery exhaust) — build brief

> **Status:** planned. Cosmetic. First `.glb`-backed **set-piece** (all others are procedural).
> Feature ID: `2026-07-02-1937-freighter-glb-model`.

## Goal

Replace the procedural box-built cargo freighter set-piece with a real sourced `.glb` model, while
**keeping** the animated additive fiery particle-exhaust trail streaming from behind the engines. The
freighter is the "save the transport" decor that cruises slowly through the shared world; today it is the
project's only fully procedural set-piece (spine + bridge + window + 4 cargo containers + engine block +
4 nozzles, all `BoxGeometry`). After this change it loads `freighter_combat.<hash>.glb` (auto
center/scale/orient like a ship model), and the exhaust re-derives its emitter origin from the loaded
model's real rear bounds so fire streams from behind the actual engines. User-visible effect: a
recognizable 3D cargo ship (not a stack of grey boxes) drifting below the battlefield with a live flame
trail. It also seeds a **light, server-driven "effect config"** extension point: the exhaust's palette
and particle params become optional fields on the set-piece spec in `catalog_seed.js` (delivered to the
client via the map descriptor), with the current look as defaults.

## Decisions (chosen — do not re-litigate)

1. **Standalone loader inside `world.js`.** Reuse the exported `gltfLoader` from
   `client/src/ship-factory.js` and the same `Box3` center/scale/`yaw` pattern as `applyShipModel`, but
   write a small standalone load path inside `makeFreighter`. Do **not** refactor or generalize
   `applyShipModel` — it is coupled to combat-ship semantics (`bankGroup`, `tint`, `SHIP_MODEL_LEN`
   normalization, `noseZ`/`tailZ` userData) the freighter doesn't share (DECISIONS §30, keep it simple).
2. **Exhaust only, no box fallback.** Build just the fiery exhaust `Points` synchronously so a trail is
   visible immediately; add the `.glb` group when it resolves. On load error → `console.warn` and keep
   the exhaust running. **Remove the old procedural box-hull construction entirely** (spine, bridge,
   window, cargo containers, engine block, nozzles). No procedural-primitive fallback.
3. **Single rear-center emitter, re-derived from the loaded model.** Drop the 4 hardcoded
   `±7/±5, z=-86` nozzle points. Emit from one origin at the model's group-local rear
   (`x = 0`, `y = (lbox.min.y + lbox.max.y)/2`, `z = lbox.min.z`), with the lateral jitter/spread scaled
   to the model's rear width. Keep particle count (~90) and trail length (~48). Because the exhaust is
   built **synchronously** but the model loads **async**, the emitter origin must be **mutable**: store a
   shared `emit` `THREE.Vector3` (+ a `spread` scalar) that the loader **overwrites** once the model
   resolves, and have the `update(dt)` loop read them each frame.
4. **Normalize the model's longest axis to ~130 units** (`FREIGHTER_MODEL_LEN = 130`, the old procedural
   spine length) so the existing spec `pos: [-100,-48,-450]` + `scale: 0.33` stay visually equivalent.
   May need eyeball tuning (see Verify). Author **`yaw`** on the set-piece spec (default `0`): the
   implementer **must preview the `.glb` in a web glTF viewer** and set `yaw: Math.PI` if it is a `-Z`
   export, so the nose points `+Z` (forward = travel direction) like the primitive did. Preserve
   `spec.speed` cruise, `spec.sync` drift, `spec.scale`.
5. **Data-driven exhaust effect (server-configurable).** The exhaust parameters — palette (`hot`/`mid`/
   `end` colors), particle `count`, trail `len`, point `size`, emit `speed` — are read from an **optional
   `exhaust: {...}` object on the freighter set-piece spec** in `server/src/catalog_seed.js`, falling back
   to the current hardcoded values as defaults (look unchanged when omitted). The spec already flows
   server → client via the map descriptor (`/api/maps/:name` → `buildMap` → `G.mapSetpieces` →
   `buildSetPiece` → `makeFreighter`), so this is exactly the "effect config delivered from the server"
   we want with **no new transport**. Keep it a **light** extension point (DECISIONS §30): make only the
   one existing exhaust effect spec-configurable with safe defaults, mark it with a short comment as the
   seed for future server-driven model effects — **do not** build an effect registry, multiple effect
   types, or any speculative framework. **No reference palette was provided by the maintainer**, so the
   current fiery palette (`0xfff1c0` / `0xff7a2a` / `0x7a1208`) stays the default; a server-provided
   palette can override it later.
6. **`assets:check` unchanged.** The set-piece `modelUrl` lives on the map spec, not on
   `SHIPS`/`COMPONENTS`/`WEAPONS`, so `scripts/assets-check.mjs` does **not** validate it (confirmed by
   reading that script — it only scans those three arrays + `SOUNDS`). That's fine: `assets:pull` /
   the CI deploy step `aws s3 sync`s the whole `ships-combat/` prefix, so the combat glb is baked into
   prod regardless. **Do not** modify `assets-check.mjs`.

## Source model & credits

- Source glb currently at `/Users/kbagaiev/Downloads/freighter_-_spaceship.glb` (132 KB). Copy it into
  the pipeline source dir (see Steps) as `assets-src/freighter.glb`.
- **CC-BY 4.0 — attribution mandatory.** "Freighter - Spaceship" (https://skfb.ly/oPRwV) by
  Felipe Augusto Vera, licensed under Creative Commons Attribution
  (http://creativecommons.org/licenses/by/4.0/). Must be added to `client/assets/CREDITS.md` (see Steps).

## Steps

### 1 — Asset pipeline (produce the combat glb)

Run from the worktree root `/Users/kbagaiev/Projects/ag-wt/2026-07-02-1937-freighter-glb-model`. See
`docs/plans/ship-model-pipeline.md`; the `assets:*` scripts live in `scripts/`.

1. `mkdir -p assets-src && cp /Users/kbagaiev/Downloads/freighter_-_spaceship.glb assets-src/freighter.glb`
   (the build script keys presets off the **source base name** `freighter`; `assets-src/` is gitignored).
2. **Preview orientation now.** Open `assets-src/freighter.glb` in a web glTF viewer
   (`gltf-viewer.donmccurdy.com`) and note which way the nose points → determines `yaw` in Step 3
   (`+Z` export → `yaw: 0`; `-Z` export → `yaw: Math.PI`). macOS Quick Look can't preview it.
3. `npm run assets:build freighter` — emits `assets-dist/freighter_combat.<hash>.glb` +
   `assets-dist/freighter_hangar.<hash>.glb` (content-hashed) and prints a `modelUrl`/`modelUrlHigh`
   line. The freighter needs **only the combat glb**; ignore the hangar output (no hangar/menu view for a
   set-piece). This is a low-poly pack model (default `combat` preset: heavy decimate + meshopt), so no
   `PRESET_OVERRIDES` entry is needed.
4. `npm run assets:push` — uploads `assets-dist/` + the source to S3 (bucket `vega-sentinels-assets`).
   This is what lets CI's deploy-time `assets:pull` bake the combat glb into prod.
5. Copy the built combat glb to where the server serves it same-origin so it loads locally:
   `cp assets-dist/freighter_combat.<hash>.glb client/assets/ships/` (this dir is gitignored — models are
   never committed; `combatServe = client/assets/ships` per `scripts/assets-config.mjs`).
6. Note the exact combat path printed: `assets/ships/freighter_combat.<hash>.glb` — used as `modelUrl` in
   Step 2.

### 2 — Wire the model + exhaust config onto the set-piece spec

`server/src/catalog_seed.js`, the `home-system` map's `setpieces` array, freighter entry at **~L529**:

```js
{ type: 'freighter', pos: [-100, -48, -450], scale: 0.33, hue: 0x8a8f9c, cargoHue: 0xb0763a, speed: 2 },
```

Replace with (fill the real hash from Step 1.6; set `yaw` from the Step 1.2 preview — likely `Math.PI` for
a `-Z` export, else `0`). `hue`/`cargoHue` no longer color a procedural hull, but keep them harmlessly or
drop them — the glb brings its own materials; **drop them** to avoid dead fields:

```js
// Freighter set-piece: first .glb-backed set-piece. modelUrl = combat glb (served same-origin, baked in
// by assets:pull at deploy). `yaw` orients the nose to +Z like a ship model. `exhaust` is an OPTIONAL,
// server-delivered effect config (palette + particle params) — omit to use the built-in fiery defaults;
// this is the light extension point for future server-driven model effects (DECISIONS §38).
{
  type: 'freighter', pos: [-100, -48, -450], scale: 0.33, speed: 2,
  modelUrl: 'assets/ships/freighter_combat.<hash>.glb',
  yaw: 0, // ← set Math.PI if the glTF-viewer check shows a -Z nose
  // exhaust: { palette: { hot: 0xfff1c0, mid: 0xff7a2a, end: 0x7a1208 }, count: 90, len: 48, size: 5, speed: 1.4 },
},
```

Leave the `exhaust:` line commented (documents the shape; the defaults live in the client). The spec
passes through the map API as plain JSON — no schema/validation changes needed elsewhere.

### 3 — Rewrite `makeFreighter` in `client/src/world.js`

Current `makeFreighter(spec)` spans **L459–L500**; `buildSetPiece` (L503–L515) already applies
`spec.scale` and `spec.pos` to `entry.obj` and calls `entry.update(dt)` each frame — **keep that
contract** (`return { obj, update }`).

Add a module-level constant near the other set-piece helpers (top of the freighter section, ~L456):

```js
const FREIGHTER_MODEL_LEN = 130; // normalize the glb's longest axis to the old procedural spine length,
                                 // so the existing set-piece pos + scale:0.33 stay visually equivalent
```

Import note: `gltfLoader` is exported from `client/src/ship-factory.js`; add it to `world.js`'s existing
import from that module (or add an import if none exists). Verify the exact import line already present in
`world.js` and extend it — do not duplicate the `GLTFLoader`/`MeshoptDecoder` setup (reuse the shared
instance so meshopt-compressed combat glbs decode).

Rewrite the body so it:

**(a) Reads the effect config with defaults (spec-driven):**

```js
function makeFreighter(spec) {
  const g = new THREE.Group();

  // --- Exhaust effect config: OPTIONAL, delivered from the server via the set-piece spec (map descriptor).
  //     Falls back to the built-in fiery look. Extension point for future server-driven model effects. ---
  const ex = spec.exhaust || {};
  const pal = ex.palette || {};
  const N    = ex.count ?? 90;
  const len  = ex.len   ?? 48;
  const size = ex.size  ?? 5;
  const espd = ex.speed ?? 1.4;
  const cHot = new THREE.Color(pal.hot ?? 0xfff1c0);
  const cMid = new THREE.Color(pal.mid ?? 0xff7a2a);
  const cEnd = new THREE.Color(pal.end ?? 0x7a1208);
  const tmp  = new THREE.Color();
```

**(b) Builds ONLY the exhaust `Points` synchronously** (reuse the current geometry/attribute setup from
L476–L483, but keyed on `N`/`size`), with a **mutable emitter origin + spread** the loader will overwrite:

```js
  // Emitter origin + lateral spread are MUTABLE: the exhaust is built now, but the model (whose real rear
  // bounds define where fire should stream from) loads async. The loader overwrites these; the update loop
  // reads them each frame. Sensible pre-load default so a trail shows immediately.
  const emit = new THREE.Vector3(0, 0, -60); // group-local (pre-scale) units
  let spread = 3;                            // lateral jitter half-extent, group-local

  const epos = new Float32Array(N * 3), ecol = new Float32Array(N * 3), et = new Float32Array(N);
  const eoff = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { et[i] = Math.random(); eoff[i * 2] = Math.random() - 0.5; eoff[i * 2 + 1] = Math.random() - 0.5; }
  const egeo = new THREE.BufferGeometry();
  egeo.setAttribute('position', new THREE.BufferAttribute(epos, 3));
  egeo.setAttribute('color', new THREE.BufferAttribute(ecol, 3));
  const emat = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  g.add(new THREE.Points(egeo, emat));
```

**(c) Loads the glb async** (only if `spec.modelUrl` is set), auto center/scale/orient, then re-derives
the emitter from the model's group-local rear bounds:

```js
  if (spec.modelUrl) gltfLoader.load(spec.modelUrl, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size3 = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = FREIGHTER_MODEL_LEN / (Math.max(size3.x, size3.y, size3.z) || 1);
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s); // recenter at group origin
    const pivot = new THREE.Group();
    pivot.rotation.y = spec.yaw ?? 0;               // orient nose to +Z (data-fixed, like ship models)
    pivot.add(model);
    pivot.updateMatrixWorld(true);                  // measure while unparented → local == world
    const lbox = new THREE.Box3().setFromObject(pivot); // group-local bounds after scale+yaw
    // Single rear-center emitter: model's tail (-Z), vertical center, spread scaled to rear width.
    emit.set(0, (lbox.min.y + lbox.max.y) / 2, lbox.min.z);
    spread = (lbox.max.x - lbox.min.x) * 0.2; // eyeball-tune (see Verify)
    g.add(pivot);
  }, undefined, (err) => console.warn('Freighter model failed to load, keeping exhaust only:', spec.modelUrl, err));
```

**(d) Updates** — same particle animation as before but reading `emit`/`spread`/`espd`/`len`; keep the
cruise + sync exactly (L495–L498):

```js
  return { obj: g, update: (dt) => {
    for (let i = 0; i < N; i++) {
      et[i] += dt * espd; if (et[i] > 1) et[i] -= 1;
      const t = et[i], sp = 1 + t * 4;
      epos[i * 3]     = emit.x + eoff[i * 2] * spread * sp;
      epos[i * 3 + 1] = emit.y + eoff[i * 2 + 1] * spread * sp;
      epos[i * 3 + 2] = emit.z - t * len;
      if (t < 0.5) tmp.copy(cHot).lerp(cMid, t / 0.5); else tmp.copy(cMid).lerp(cEnd, (t - 0.5) / 0.5);
      ecol[i * 3] = tmp.r; ecol[i * 3 + 1] = tmp.g; ecol[i * 3 + 2] = tmp.b;
    }
    egeo.attributes.position.needsUpdate = true; egeo.attributes.color.needsUpdate = true;
    if (spec.speed) g.position.z += spec.speed * dt;           // cruise forward along +Z (nose)
    if (spec.sync && G.arenaDrift) { g.position.x = arenaCenter.x; g.position.z = arenaCenter.z; } // escort drift
  } };
}
```

Delete the old materials (`body`/`dark`/`cargo`), the box meshes, the `nozzles` array, and the old
`enz` per-particle nozzle-index attribute — they're gone with the procedural hull.

### 4 — CREDITS

Add a row to the table in `client/assets/CREDITS.md` (after the existing `machine_gun_hangar` row):

```
| ships/freighter_combat.\<hash\>.glb (Freighter set-piece — cargo transport decor) | Felipe Augusto Vera | https://skfb.ly/oPRwV | CC-BY 4.0 | 2026-07-02 |
```

And add a verbatim-attribution paragraph under the `## Models` section (matching the enemy/player/item
blocks), e.g. after the player-ship block:

```
The **freighter** set-piece (`freighter_combat`) is **"Freighter - Spaceship"** by **Felipe Augusto
Vera** (Sketchfab, **CC-BY 4.0** — attribution required, so this entry must stay while in use).

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Freighter - Spaceship" (https://skfb.ly/oPRwV) by Felipe Augusto Vera is licensed under Creative
> Commons Attribution (http://creativecommons.org/licenses/by/4.0/).
```

### 5 — Restart local server & verify

Catalog reseeds only on server startup, so **restart the local server** after editing
`catalog_seed.js` (otherwise `/api/maps/home-system` still serves the old spec).

## Tests

- **Server** (`cd server && npm test`): confirms the seed still loads and `/api/maps/:name` serves the
  `home-system` descriptor with the freighter spec (now carrying `modelUrl`/`yaw`). Server tests run on
  **both SQLite and Postgres** — this change touches only seed data (a plain JS array of objects), no
  `db.js`/`db_postgres.js` schema, so no parity work is needed; just make sure both suites stay green.
- **Client** (`cd client && node --test`): run the unit suite; nothing here asserts on the freighter, but
  it guards against syntax/import breakage in `world.js`.
- **Visual harness** (`cd client && node visual/run.mjs`): the client visual suite has a known-flaky
  baseline (~6 scenarios fail regardless) — judge by the reliably-passing set + **zero page errors**.
  With the combat glb copied into `client/assets/ships/` (Step 1.5) the model resolves locally; confirm
  no `Freighter model failed to load` warning and no page errors.
- **Manual visual verification** (cosmetic feature — this is the real check): load the game, fly to the
  freighter (freighter side-mission `center`, `(-100, -450)`), and confirm:
  1. the `.glb` loads (a real cargo ship, not boxes / not nothing);
  2. it flies **nose-first** in its travel direction (+Z) — if it cruises backwards, flip `yaw`
     (`0 ↔ Math.PI`) in the spec (Step 2);
  3. it is a sane size at `scale: 0.33` — if noticeably too big/small, tune `FREIGHTER_MODEL_LEN`
     (`world.js`) or the spec `scale`;
  4. the fiery exhaust streams from **behind the real engines** (the model's `-Z` tail), not from the
     center or nose — if the flame origin/width looks off, tune the `spread` multiplier (`0.2`) or the
     `emit` derivation in the loader.

## Docs to update

- **`docs/SUMMARY.md`** — the **`freighter` set-piece** bullet (**L537–L539**): rewrite from "a cargo ship
  (spine + containers + bridge + engine block/nozzles)" to describe it as the **first `.glb`-backed
  set-piece** (loads `freighter_combat` combat glb, auto center/scale/`yaw`-oriented like a ship model),
  keeping the **fiery exhaust** (now a single rear-center emitter re-derived from the model's bounds) and
  the cruise/`sync` behavior. Also mention the exhaust is an **optional, server-delivered `exhaust:`
  effect config** on the spec (palette + particle params, defaults built in). Touch the surrounding
  set-piece intro (L518–L528) if its "generated **in code** (no `.glb`)" wording now needs "…except the
  freighter, which loads a `.glb`". Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`** — add a bullet under the existing **`## 2026-07-02`** heading (newest on top):
  **"Freighter set-piece is now a real `.glb` model."** — replaced the procedural box freighter with the
  CC-BY "Freighter - Spaceship" combat glb (first glb set-piece; standalone loader in `world.js` reusing
  `gltfLoader`), kept the fiery exhaust (now a single rear-center emitter derived from the model bounds),
  and made the exhaust palette/params an optional server-delivered `exhaust:` config on the set-piece
  spec. Mention the CREDITS addition and that a `publish-itch` is needed once on prod (see below).
- **`docs/DECISIONS.md`** — add **§38** (next number; §37 is the last): "First `.glb` set-piece —
  standalone loader, exhaust made server-configurable." Record: (1) the freighter is the first
  `.glb`-backed set-piece; (2) its loader is **standalone in `world.js`** (reuses the shared `gltfLoader`
  + the same center/scale/`yaw` normalization) rather than sharing `applyShipModel`, which is coupled to
  combat-ship semantics; (3) the fiery exhaust was made a **spec/server-configurable effect** (palette +
  particle params on the set-piece spec, delivered via the map descriptor) as the deliberate, **light**
  seed for future server-driven model effects — no registry/framework built (DECISIONS §30). Note the
  rejected alternative (generalize `applyShipModel` / build an effect system now).
- **`client/assets/CREDITS.md`** — the CC-BY row + attribution paragraph (Step 4). Mandatory while the
  asset is in use.

## Publish-itch reminder

This is a **prod model/hash change**. Per **DECISIONS §37**, once this lands on prod, run `/publish-itch`
so the itch.io bundle (which bundles glbs but reads the catalog live) doesn't 404 the new freighter glb.
Call this out in the CHANGELOG bullet. (Not part of the local implementation — a post-deploy step.)

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **No effect framework.** Make only the one existing exhaust effect spec-configurable with defaults. No
  effect registry, no multiple effect types, no generic "set-piece effect" abstraction, no per-particle
  turbulence/curl or new blend modes.
- **No refactor of `applyShipModel`** or of the ship model path; do not try to share code beyond reusing
  the exported `gltfLoader` instance.
- **No procedural-box fallback** and no placeholder mesh while loading — exhaust-only during load and on
  error (Decision 2).
- **No hangar/menu view** for the freighter; the hangar glb from `assets:build` is unused (a set-piece is
  never inspected in the item preview). Do not wire `modelUrlHigh`.
- **No `assets-check.mjs` change** (Decision 6) and **no schema/migration/`db.js` work** — this is seed
  data + client code only.
- **No new mission, no collidability, no `sync`/drift mission activation** — the freighter stays static
  decor that cruises; the escort-drift mechanic remains off (no mission turns it on).
- **No reference-image palette work** — none was provided; keep the current fiery defaults.
- **No commit/push** unless the maintainer asks.
