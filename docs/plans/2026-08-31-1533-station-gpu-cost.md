# Base station GPU cost — small textures now, a shading fork to measure

> **WHAT SHIPPED DIFFERS FROM THIS PLAN. Read this box before trusting any number below.**
> The plan specifies **256² WebP** textures (D1) and justifies the change as a **VRAM** win
> (21.3 MiB → 1.33 MiB). Neither survived contact:
> - **Shipped at full 1024² WebP** (1 588 268 B → 276 404 B). Texture *size* was then measured to move fps
>   by nothing, so shrinking bought only VRAM — which no measurement showed we needed — while 256² visibly
>   smeared the solar-panel grid the player docks against. The maintainer rejected it on looks. The fix that
>   remained is the **format**: uncompressed source PNG → WebP at the same resolution.
> - **The win is DOWNLOAD, not VRAM.** VRAM is unchanged at 21.3 MiB (it follows pixel dimensions, not file
>   format). The download matters because the first load on a weak phone overruns the 9 s asset budget.
> - **The visual scenario's guard changed accordingly** — from "every texture ≤ 256²" to "the .glb is
>   ≤ 400 KB and its textures are `EXT_texture_webp`, not PNG".
> - **The `?stationmat` rungs were measured and none was promoted.** Backface culling saves 4% and the
>   normal map 2% — the depth-complexity argument for ordering them was wrong (tile-based GPUs discard
>   hidden layers before shading). Two further measurement forks were added after review: `?res=N` and
>   `?speedfield=0`.
>
> Current truth: DECISIONS §144 (this change), §145 (how GPU cost is measured), §140's amendment
> (resolution), and the ROADMAP entries on the station, the sky pass and the load veil.

**Feature id:** `2026-08-31-1533-station-gpu-cost`
**Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-08-31-1533-station-gpu-cost` (all paths below are relative
to it unless stated otherwise)

## Goal

The base station is the game's measured frame-rate cliff on weak phones (Redmi 15C / Mali-G52: ~60 fps
everywhere, dropping only when the camera is close and the station fills the screen — ROADMAP "The station is
the frame-rate cliff"). It is also, by a wide margin, the most expensive object in memory: it ships **four
1024² PNG maps ≈ 21.3 MiB of VRAM, ~54% of the VRAM of every model in the game combined**, because the
`combat` preset's `textureSize: 256` is a **silent no-op** whenever `textureCompress` is `false`
(gltf-transform performs the resize *inside* the textureCompress stage). This change does three things:
(1) rebuilds the base-station combat glb at 256² WebP — 21.3 MiB → ~1.3 MiB of VRAM and 1.55 MB → ~90 KB of
download, with **no look change** (same material, same `doubleSided`, same normal map); (2) makes that
pipeline trap impossible to hit silently again, with a build-time throw and a unit test; and (3) adds
**`?stationmat=<rung>`**, an off-by-default measurement fork that lets the maintainer see and measure cheaper
shading on a real phone before anything about the station's look is decided. Player-visible effect of what
actually ships by default: the station looks the same, loads ~17× faster, and stops occupying half the
game's texture memory.

## The measured facts this plan is built on

All verified directly against the shipped
`client/assets/ships/base_station_combat.529dee5e.glb` (JSON chunk parsed; do not re-derive, but do
re-confirm anything you build new logic on).

| Fact | Value |
| --- | --- |
| Meshes / primitives / draw calls | 1 / 1 / **1** |
| Triangles | **2 723** |
| Materials | 1 — `Space_Station_Mat2K`, `doubleSided: true` |
| Vertex attributes | `POSITION`, `NORMAL`, `TANGENT`, `TEXCOORD_0` |
| Extensions | `EXT_meshopt_compression`, `KHR_mesh_quantization` |
| Textures | 4 × **1024² PNG** — baseColor 634 KB, emissive 42 KB, normal 617 KB, metallicRoughness 205 KB |
| Material factors | no `metallicFactor`/`roughnessFactor` → glTF defaults of **1**, modulated by the MR map; `emissiveFactor [1,1,1]` + emissive map |
| File size | 1 588 268 bytes |

VRAM arithmetic (RGBA8 + full mip chain = ×4/3): 1024² = 5.33 MiB each → **21.3 MiB** for four.
512² = 1.33 MiB each → 5.33 MiB. 256² = 341 KiB each → **1.33 MiB**.

**Two claims from the original brief were wrong and have been re-measured. Do not plan around the old ones.**

1. **The hull is NOT closed.** Welded by position: 1 414 verts, 2 723 tris, 4 157 unique edges, of which
   **147 are boundary edges (3.5%)** plus 1 non-manifold edge. `side = FrontSide` is therefore **not** a free
   win — it can punch visible holes in the model. It goes behind the flag, never unconditional.
2. **The normal map carries real relief.** Mean deviation from flat 14/127, RMS 31.3; **22.8% of texels have
   real relief, 17.3% strong**. Dropping it visibly flattens roughly a fifth of the surface. Also behind the
   flag.

Two more facts that shape the design:

- **`scene.environment` is a RoomEnvironment PMREM on High *and* Balance** (`client/src/engine.js:47-54`,
  `client/src/graphics.js:46-47`). With `metalness` at (map-modulated) 1, a large part of what currently
  lights this station is that IBL reflection — and `MeshPhongMaterial`/`MeshBasicMaterial` do not read
  `scene.environment` at all. A material-class swap is not a neutral "cheaper shading" change; it re-lights
  the station. That is precisely why it ships as a flag, not a decision.
- **Rebuilding the source with today's preset reproduces the shipped file byte-for-byte** (1 588 268 bytes),
  which is the proof that the asset did go through the pipeline and the resize did nothing.

## Decisions (already made — do not re-ask)

| # | Decision |
| --- | --- |
| D1 | **Texture size 256**, matching `space_factory` (which is bigger on screen and reads fine at 256). Build **both 256 and 512** and attach a close-up screenshot pair at the review gate; fall back to 512 only if 256 reads as mush. Ship 256 unless told otherwise. |
| D2 | **The plan does not pick a material.** The maintainer refused to decide by description — they must see it and measure it on the phone. Ship a `?stationmat=` measurement fork instead (below). |
| D3 | **Base station only.** `space-factory` behaviour through the shared `makeStationModel` must be unchanged (it already ships 256 WebP and its look is settled). |
| D4 | **Pipeline fix = option (i):** a `base_station` entry in `PRESET_OVERRIDES`, plus a build-time **throw** when `textureSize` is set while `textureCompress === false`, plus a unit test. Actually making `--texture-size` work for uncompressed builds (which would re-hash ~6 other models) is a ROADMAP follow-up, **not** this feature. |
| D5 | Root **`"test": "node --test scripts/"`** + a CI step, so the new guard *and* the currently-orphaned `scripts/assets-hitboxes.test.mjs` actually run. |
| D6 | **CREDITS:** the attribution row (`client/assets/CREDITS.md:29`) uses a `<hash>` placeholder and the asset/author/licence are unchanged → **row stays as-is**. Only the prose at `client/assets/CREDITS.md:101-104` is updated to name the new build settings. |
| D7 | **URL flag, not a `?tune` slider** — the measurement happens on a phone where lil-gui is unusable, and the perf run wants a clean boot. Follows the established `?lights=N` / `?beam` / `?ally` pattern. |
| D8 | **No tier gating** on the flag (DECISIONS §30). One rung for everybody who passes it. |
| D9 | **One deploy.** Textures + flag ship together. If a rung wins on the phone, a later one-line commit promotes it to the default. |
| D10 | Terminology: **"base station"** throughout, never bare "station" — the docs use "station" for both set-pieces. |

### Expectations, stated up front so nobody is surprised

The default change (textures) is a **memory and download** win and is expected to move fps by **roughly
nothing**. The measured cliff is per-light ALU: three evaluates every point light for every fragment of every
lit material, while texture fetches happen once per fragment regardless of light count. The maintainer has
confirmed the memory win alone justifies shipping it. **The fps hypothesis is what the flag exists to test**,
on the Redmi, after deploy.

## The `?stationmat=` ladder

Cumulative, so each rung is exactly one visible delta on top of the previous one. Base station only.

| Value | Effect |
| --- | --- |
| absent / `standard` / `0` / `off` / `false` | **Default.** Today's material, untouched. A strict no-op — the frame is byte-identical to not having the feature. |
| `lean` | `side = THREE.FrontSide` + `normalMap = null`. Still `MeshStandardMaterial`, so the IBL look survives. |
| `phong` | `lean` + swap to `MeshPhongMaterial` carrying `map` / `color` / `emissive` / `emissiveMap`. Blinn-Phong per light instead of GGX. **Loses `scene.environment` IBL** (High and Balance both have it). |
| `basic` | `MeshBasicMaterial` with `map` + `color`. Zero lighting maths — the measurement floor. **`MeshBasicMaterial` has no emissive slot at all, so the lit windows go dark on this rung.** That is expected, not a bug; say so in the flag's own comment. |
| anything else (incl. a bare `?stationmat`) | `console.warn` naming the valid rungs, then `standard`. A measurement flag that silently does nothing is the exact bug this feature is fixing. |

---

# Steps

## Step 0 — worktree prep (do this first, it is load-bearing)

The worktree's `client/assets/ships/` contains only `.gitkeep` (models are gitignored, S3-canonical) and
`assets-src/` has no base-station source. Nothing renders correctly until you fix both.

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-31-1533-station-gpu-cost
npm run assets:pull                       # S3 → client/assets/ships + sounds + recordings
cp "/Users/kbagaiev/Projects/another_game_attempt/assets-src/future stations/base station/low_poly_space_station..glb" \
   assets-src/base_station.glb
```

**Why the copy and that exact name.** `scripts/assets-build.mjs:49` does a **non-recursive**
`fs.readdirSync(DIR.src)`, so a source inside `assets-src/future stations/base station/` is invisible to the
build. The output base name is derived from the source file name
(`assets-build.mjs:55`, `hashRename(tmpCombat, \`${base}_combat\`, …)`), so the source **must** be
`assets-src/base_station.glb` to produce `base_station_combat.<hash>.glb`. The original subfolder (with its
`credits.txt`) stays where it is — `assets-src/` is gitignored, so nothing here is committed.

**Two shared-resource hazards — a parallel pipeline run is live in another worktree right now:**

- The visual runner hardcodes port **4173** and two worktrees running it simultaneously silently test each
  other's code. Always pass `VISUAL_PORT` (e.g. `4183`) and check `lsof -i :4183` first.
- The visual runner defaults to the shared `spacegame_test` database, which the other worktree's
  `cd server && npm test` **drops and recreates** in its `pretest`. Give this run its own DB:
  `createdb spacegame_station_visual` once, then pass `DATABASE_URL` (the runner honours it —
  `client/visual/run.mjs:64`).

## Step 1 — make the silent no-op impossible (`scripts/`)

### 1a. `scripts/assets-config.mjs`

**Fix the base preset.** `PRESET.combat` (line 38) currently reads
`{ simplifyRatio: 0.2, simplifyError: 0.04, textureSize: 256, compress: 'meshopt', textureCompress: false, instance: false }`.
`textureSize: 256` there is a lie — it has never done anything for any model that did not also set
`textureCompress`. **Remove it** and replace it with a comment that says why there is no default texture
size. This changes nothing about any existing build output (it was already a no-op), so **no model hash
moves**.

```js
  // combat: smallest possible runtime download — heavy decimation + meshopt geometry compression.
  // NO DEFAULT `textureSize`, deliberately: gltf-transform performs the resize INSIDE its textureCompress
  // stage, so `--texture-size` is a silent no-op whenever `--texture-compress false`. A preset that wants
  // smaller textures must opt into `textureCompress` as well (see PRESET_OVERRIDES) — and `checkPreset`
  // below throws if it forgets. This is how base_station shipped 4x 1024 PNGs (21.3 MiB of VRAM) under a
  // preset that said 256.
  combat: { simplifyRatio: 0.2, simplifyError: 0.04, compress: 'meshopt', textureCompress: false, instance: false },
```

**Add the `base_station` override** to `PRESET_OVERRIDES` (alphabetically near `asteroids`/`metal_box`; the
file's convention is a long comment explaining *why*, which the critic will look for). Model it on the
`space_factory` entry at lines 92-103:

```js
  // Base-station set-piece (the return-to-base target, normalized to 100 u). Its source ships four 1024²
  // PNGs — baseColor 634 KB, normal 617 KB, metallicRoughness 205 KB, emissive 42 KB — which is 21.3 MiB of
  // VRAM with mips, ~54% of the VRAM of every model in the game put together, against 2 723 triangles in a
  // SINGLE draw call. It is fill/bandwidth-bound, never submit-bound. It had no entry here at all, so it
  // inherited `textureCompress: false` and the base preset's texture size did nothing (see PRESET.combat):
  // this is the model that exposed that trap.
  // 256 (not 128, which the metal box uses) for the same reason as space_factory: normalized to 100 u this
  // thing fills a large part of the frame when you dock, where 128px panels read as mush.
  // `pruneSolidTextures: false` protects the emissive map — mostly black with small lit windows, exactly the
  // low-contrast shape optimize's solid-texture heuristic likes to flatten, and flattening it would make the
  // whole hull glow.
  base_station: {
    combat: { textureSize: 256, textureCompress: 'webp', pruneSolidTextures: false },
    hangar: { textureSize: 256, textureCompress: 'webp', pruneSolidTextures: false }, // never shown in a menu; keep it small on S3 too
  },
```

**Add the guard, as a pure exported function** (it lives here, next to the presets, so the unit test can
import it without pulling in `child_process`):

```js
// The preset trap this file exists to prevent: gltf-transform's `optimize` performs its texture RESIZE
// inside the textureCompress stage, so `--texture-size N --texture-compress false` silently keeps the
// source resolution. Called by assets-build before every optimize() and asserted over every preset by
// scripts/assets-config.test.mjs.
export function checkPreset(p, label = 'preset') {
  if (p && p.textureSize != null && p.textureCompress === false) {
    throw new Error(`${label}: textureSize ${p.textureSize} with textureCompress:false — gltf-transform `
      + 'resizes inside the textureCompress stage, so the resize would be a SILENT no-op. Set '
      + "textureCompress (e.g. 'webp') or drop textureSize.");
  }
  return p;
}
```

### 1b. `scripts/assets-build.mjs`

In `optimize()` (lines 20-35): call the guard, and stop passing `--texture-size` when it is absent (today it
would stringify to `'undefined'`).

- Add `checkPreset` to the import on line 12.
- First line of `optimize()`: `checkPreset(p, path.basename(input));`
- Replace `'--texture-size', String(p.textureSize),` with
  `...(p.textureSize != null ? ['--texture-size', String(p.textureSize)] : []),`
- Extend the function's header comment with the one-sentence explanation of the stage ordering.

### 1c. Root test script + CI (D5)

- `package.json` (repo root) — add to `scripts`: `"test": "node --test scripts/"`.
- `.github/workflows/ci-cd.yml`, in the **`test`** job, after the `Client logic tests` step
  (lines 27-28), add:

```yaml
      - name: Install asset-pipeline deps
        run: npm ci
      - name: Asset pipeline tests
        run: npm test
```

`npm ci` at the repo root is needed because `scripts/assets-hitboxes.test.mjs` imports
`@gltf-transform/core` + `@gltf-transform/extensions` (root devDependencies). That test **skips cleanly**
when the combat glbs are absent (`scripts/assets-hitboxes.test.mjs:169`), which is the CI case — verify
that by running `npm test` at the root of a checkout with an empty `client/assets/ships/` before you trust
CI. If any pre-existing test in `scripts/` fails for a reason unrelated to this feature, **stop and report
it** rather than "fixing" it inside this change.

## Step 2 — unit test for the guard: `scripts/assets-config.test.mjs` (new)

Pure, no network, no glb. `node --test scripts/`.

- Every shipped preset is honest: loop over `Object.keys(PRESET)` × (`Object.keys(PRESET_OVERRIDES)` plus a
  sentinel base name with no override) and assert `checkPreset(presetFor(base, kind))` does not throw.
- **Negative test the guard** (a guard that cannot fail is not a guard):
  `assert.throws(() => checkPreset({ textureSize: 256, textureCompress: false }), /silent no-op/i)`.
- `checkPreset({ textureCompress: false })` (no size) does **not** throw — that is the legitimate
  "keep the source textures" case most combat models use.
- `presetFor('base_station', 'combat')` deep-equals the intended shape: `textureSize: 256`,
  `textureCompress: 'webp'`, `pruneSolidTextures: false`, `compress: 'meshopt'`, `simplifyRatio: 0.2`.
- `PRESET.combat` has **no** `textureSize` key (pins the fix in 1a against a well-meaning re-add).

## Step 3 — build the glb, and prove the lit windows survived

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-31-1533-station-gpu-cost
npm run assets:build base_station
```

**Pass the base name.** A bare `npm run assets:build` rebuilds and re-hashes **every** model in
`assets-src/`, which would drag unrelated catalog rows into this change.

The build prints both output names and the `modelUrl` line to paste. Expect the combat glb at roughly
**~90 KB** (the brief measured 88 KB).

### 3a. The 512 comparison build (D1)

Temporarily set `base_station.combat.textureSize` to `512`, rebuild into a scratch copy, and keep that file
**out of** `assets-dist/` for the final push (rename it, e.g.
`/tmp/base_station_combat_512.glb`) so `assets:push` cannot upload it. Restore the override to 256. The 512
build exists only to produce the review-gate screenshot pair.

**Tell the maintainer what to look for in that pair, because two different artefacts are in play and only
one of them looks like "blur".** The baseColor map at 256² is the classic softness — hull panel lines and
painted markings go mushy. But the **normal map** goes through the same 4× downsample *and* lossy WebP, and
its artefact does not read as blur at all: it reads as **shading noise / mottling on surfaces that should be
flat**, because a compressed normal map perturbs the lighting direction rather than the colour. Measured on
the 256² WebP build, the normal map's mean luminance is 137.6/255 with 97.5% of texels above half its peak —
i.e. it is dense, full-frame data, the worst case for a lossy codec, unlike the emissive map next to it.
Frame the pair at the docking distance where the base station fills the frame, with the camera close enough
that a flat panel covers a good chunk of the screen.

### 3b. Verify the build (all three checks, they catch different failures)

1. **Structure** — the material must still carry all four texture slots; `pruneSolidTextures: false` is what
   protects the emissive one, and if it had been flattened the material would have lost `emissiveTexture`
   and the image count would drop to 3:

```bash
node -e "
const fs=require('fs');const f=process.argv[1];const b=fs.readFileSync(f);
const jl=b.readUInt32LE(12);const j=JSON.parse(b.slice(20,20+jl).toString('utf8'));
const m=j.materials[0];
console.log('images', j.images.map(i=>i.mimeType));
console.log('slots', {base:!!m.pbrMetallicRoughness.baseColorTexture, mr:!!m.pbrMetallicRoughness.metallicRoughnessTexture, normal:!!m.normalTexture, emissive:!!m.emissiveTexture});
console.log('emissiveFactor', m.emissiveFactor, 'doubleSided', m.doubleSided);
console.log('bytes', b.length);
" assets-dist/base_station_combat.<hash>.glb
```
Required: 4 images, all `image/webp`; all four slots `true`; `emissiveFactor [1,1,1]`;
`doubleSided true` (the default rung must not change the material).

*Note for anyone extending that script:* once the textures are WebP they route through **`EXT_texture_webp`**,
so `j.textures[i].source` is `undefined` and the image index lives at
`j.textures[i].extensions.EXT_texture_webp.source`. (The check above only tests slot presence on the
material, so it is unaffected — verified against a real 256 WebP build.)

2. **Resolution** — `npx --yes @gltf-transform/cli@^4 inspect assets-dist/base_station_combat.<hash>.glb`
   and confirm the texture table reads **256×256** for all four, plus 2 723 triangles / 1 material still.

3. **The lit windows are still LIT — measured, not merely present.** This is the check that matters and the
   one an existence test cannot do. The emissive map is **~99.5% black**: on the shipped 1024² PNG its mean
   luminance is **1.26/255** and only **0.42% of texels** carry any real light. Two things can put the
   windows out without removing the map: `optimize`'s solid-texture pruner flattening it (which checks 1
   and 2 above *do* catch), and — the risk nothing else catches — a **4× downsample averaging 16 texels into
   1 on a mostly-black map, followed by lossy WebP**. A present-but-dark emissive map passes every structural
   test and ships a base station with its windows out.

   So measure it. Numbers below were taken this session with headless Chromium (`drawImage` → `getImageData`,
   Rec.709 luminance `0.2126R + 0.7152G + 0.0722B` on the raw 8-bit values, no sRGB decode) on both the
   shipped 1024² PNG and a real `--texture-size 256 --texture-compress webp --prune-solid-textures false`
   build of the source:

   | emissive map | peak luma | mean | texels ≥ 128 | as a fraction |
   | --- | --- | --- | --- | --- |
   | 1024² PNG (shipped source build) | **215.9** | 1.26 | 4 355 / 1 048 576 | **0.415%** |
   | 256² WebP (this feature's build) | **204.4** | 1.38 | 246 / 65 536 | **0.375%** |

   The windows survive the resize comfortably — the peak drops only ~5% and the lit *fraction* is nearly
   identical, which is what makes a fraction (rather than a count) the right quantity: it is stable across
   256² / 512² / 1024², so the same assertion holds whichever of D1's options ships. The floors used by the
   scenario in Step 6 are **peak ≥ 160** and **lit fraction ≥ 0.20%**, both roughly 1.9-2× under the measured
   values. Re-run the measurement on your actual build and report the two numbers at the review gate; if
   either lands near its floor rather than near the table above, stop and say so — that means the build
   settings differ from the ones measured here.

4. **Perception, by eye** — the screenshots from Step 6 must show the windows reading *as windows* against
   the dark hull, not as a uniform glow (the flattened-emissive failure) and not as a barely-there smear.
   The numbers above are the guard; the frame is the confirmation.

## Step 4 — wire the new URL into the catalog and get it into a running game

`server/src/catalog_seed.js:1094` — replace the `modelUrl` on the `base-station` set-piece:

```js
          modelUrl: 'assets/ships/base_station_combat.<new-hash>.glb',
```

Leave `pos`, `scale`, `spin`, `yaw` alone: the build changes only textures, so the bounding box, the
`STATION_LEN` 100 normalization and the §17 vertical-extent check (`pos.y = -42`, top ≈ -2.9) are all
unaffected.

**Getting the new URL into a running game — the catalog lives in Postgres, not in the file.**
`server/src/db.js:378-382` upserts every `MAPS` descriptor **on server startup**, so an edited
`catalog_seed.js` reaches nobody until the process restarts:

- **Local:** copy the built glb into the serve dir so the client can actually fetch it, then restart:
  `cp assets-dist/base_station_combat.<hash>.glb client/assets/ships/` and
  `cd server && npm start` (kill the old process first). The visual runner spawns its own server, so it
  reseeds on every run automatically — but it reads the glb from `client/assets/ships/`, hence the copy.
- **Prod:** the normal deploy. The CI deploy job runs `assets:check` (which will now demand the **new** key
  on S3 — so Step 8's `assets:push` must happen **before** the merge to `main`) and then `assets:pull`,
  baking the glb into the image; the container restart reseeds `maps`.

## Step 5 — the `?stationmat=` fork

### 5a. `client/src/station-mat.js` (new, ~40 lines)

**Must not import `three`.** `node --test` cannot load a client module that imports three, so the pure
parser has to live in a three-free module or its test simply will not run.

```js
// `?stationmat=<rung>` — a MEASUREMENT FORK for the BASE STATION's shading, off by default.
//
// Why a fork and not a decision: the base station is the measured frame-rate cliff (ROADMAP), and the two
// obvious cheap-shading moves are BOTH risky on this specific asset, measured on the shipped glb:
//   • the hull is NOT closed — 147 of its 4 157 edges are boundary edges (3.5%) — so FrontSide can punch
//     visible holes rather than just halving the rasterized fragments;
//   • the normal map carries real relief — 22.8% of texels deviate meaningfully from flat, 17.3% strongly —
//     so dropping it visibly flattens roughly a fifth of the surface.
// And `scene.environment` (a RoomEnvironment PMREM) is live on High AND Balance, so a swap away from
// MeshStandardMaterial loses the IBL that currently does much of the lighting on a metalness-1 hull.
// None of that can be settled by argument: it is looked at, and measured on a phone. Hence a URL flag
// (like ?lights=N / ?beam / ?ally) rather than a ?tune slider — lil-gui is unusable on the device where the
// measurement happens, and a perf run wants a clean boot.
//
// The rungs are CUMULATIVE, so each one is a single visible delta:
//   standard (default)  today's material, untouched — a strict no-op
//   lean                side = FrontSide + normalMap = null (still MeshStandardMaterial, keeps the IBL)
//   phong               lean + MeshPhongMaterial (Blinn-Phong per light instead of GGX; NO IBL)
//   basic               MeshBasicMaterial — zero lighting maths, the measurement FLOOR. Note it has no
//                       emissive slot at all, so the station's lit windows go dark on this rung. Expected.
// View-layer only: no sim state, no randomness → replay-neutral by construction (DECISIONS §73).
export const STATION_MAT_RUNGS = ['standard', 'lean', 'phong', 'basic'];

// Pure + storage-free, so it is unit-testable without a DOM: the URL alone decides. `warn` is injectable
// for the test.
export function evalStationMat(search, warn) {
  const v = new URLSearchParams(search || '').get('stationmat');
  if (v == null) return 'standard';
  const s = String(v).toLowerCase();
  if (s === '0' || s === 'off' || s === 'false') return 'standard';
  if (STATION_MAT_RUNGS.includes(s)) return s;
  // A measurement flag that silently does nothing is exactly the bug this whole feature is fixing.
  (warn || ((m) => { try { console.warn(m); } catch { /* no console */ } }))(
    `?stationmat="${v}" is not a rung — expected ${STATION_MAT_RUNGS.join(' | ')}. Falling back to standard.`);
  return 'standard';
}

// Read at IMPORT time, like ?ally / ?lancer: the set-piece glb loads far later than module load, so there
// is no boot-ordering trap here.
const RUNG = evalStationMat(typeof location !== 'undefined' ? location.search : '');
export function stationMat() { return RUNG; }
```

### 5b. `client/src/world.js` — apply it

Add the import beside the other client-module imports (after line 18):

```js
import { stationMat } from './station-mat.js'; // ?stationmat: base-station shading measurement fork (off by default)
```

Add the applier immediately above `makeStationModel` (which begins at `client/src/world.js:1236`). **The
snippet below is illustrative, not literal — type-check it as you write it**, in particular that
`o.material` may be an array and that `THREE.Color` values are passed to constructors, not copied by
reference into a disposed material:

```js
// Apply a ?stationmat rung to the base station's materials. BASE STATION ONLY (the space factory's look is
// settled and its textures are already 256 WebP). Called from inside the glb onLoad, BEFORE the model is
// parented and before G.needsSceneWarm is raised, so prewarmShaders()'s renderer.compile() sees the final
// material and the very first frame that draws the station draws THIS one — no first-frame recompile hitch.
function applyStationMat(model, rung) {
  if (rung === 'standard') return;              // strict no-op for every real player
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const wasArray = Array.isArray(o.material);
    const mats = wasArray ? o.material : [o.material];
    const next = mats.map((m) => {
      m.side = THREE.FrontSide;
      m.normalMap = null;
      if (rung === 'lean') { m.needsUpdate = true; return m; } // removing a map changes the program
      const shared = { name: m.name, map: m.map, side: THREE.FrontSide, fog: m.fog,
        transparent: m.transparent, opacity: m.opacity };
      const out = rung === 'phong'
        ? new THREE.MeshPhongMaterial({ ...shared, color: m.color, emissive: m.emissive,
            emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity, shininess: 30 })
        // MeshBasicMaterial has NO emissive slot — the lit windows go dark here. That is the floor, on purpose.
        : new THREE.MeshBasicMaterial({ ...shared, color: m.color });
      m.dispose();                               // construct first, then dispose: the Colors are read above
      return out;
    });
    o.material = wasArray ? next : next[0];
  });
}
```

Then, inside `makeStationModel`'s `gltfLoader.load` success callback (currently
`client/src/world.js:1240-1254`), call it right after `const model = gltf.scene;` and **only** for the base
station:

```js
    if (spec.type === 'base-station') applyStationMat(model, stationMat());
```

**Trace it to the pixel, not to the assignment.** The ordering that matters:
`makeStationModel` bumps `G.pendingAssets` before the load and decrements it in the callback
(`world.js:1239`, `1252`); the callback sets `G.needsSceneWarm = true` (`world.js:1251`);
`main.js:1148-1165` raises the level-load veil, waits until `G.pendingAssets === 0`, then calls
`prewarmShaders()` → `renderer.compile(scene, camera)` (`main.js:804-805`) and only then drops the veil.
So a material replaced **before** the callback's `g.add(pivot)` is the one that gets compiled and the one
the first visible frame draws. Placing the call after `g.add(...)`, or anywhere outside the callback, would
either miss the compile or race the load.

Two things not to do: do not mutate `spec`, and do not touch the `space-factory` branch — `33-space-factory`
asserts on that object.

### 5c. `client/src/station-mat.test.js` (new)

`cd client && node --test`. Pure — imports only `station-mat.js`:

- absent → `'standard'`; `?stationmat=standard` → `'standard'`; `?stationmat=0|off|false` → `'standard'`,
  and none of those calls the injected `warn`.
- each of `lean` / `phong` / `basic` (and an upper-case `LEAN`) → itself.
- `?stationmat=cheap` and a **bare `?stationmat`** → `'standard'` **and** the injected `warn` was called once
  with a message naming the rungs. (This is the negative test for D7's "never silently do nothing".)
- `STATION_MAT_RUNGS[0] === 'standard'` — the default is a rung name, so the scenario can drive the ladder
  from the exported list.

## Step 6 — visual scenario: `client/visual/scenarios/46-base-station.mjs` (new)

There is **no existing coverage of the glb base station**: `09-mission-setpieces.mjs` covers the three
*procedural* set-pieces (research station / asteroid field / freighter); `42-hit-feel.mjs` and
`43-expensive-look.mjs` both deliberately fly *away* from the base station before measuring anything (see
`43-expensive-look.mjs:108-112`) and assert nothing about it; `44-playable-intro.mjs` only mentions it in
briefing copy. So none of them will catch this and none of them needs editing — but re-read those three
before you finish and confirm that claim still holds for your change.

Write a new scenario. Follow `43-expensive-look.mjs:70-93` for the pattern: own `page.goto`, pinned
viewport, the two-branch take-off click (welcome screen on a fresh profile, Main Window once an earlier
scenario in the same worker has written progress).

A helper that boots one rung and reports the material, then four calls to it:

```js
const readStation = async (page, query) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/?debug${query}`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 20000 });
  await page.evaluate(() => { /* two-branch take-off click, copied from 43 */ });
  // The runner's own boot gate calls __game.silenceIntro() (run.mjs:141), but this scenario navigates
  // itself, so it has to do it too — otherwise all four rung screenshots, which ARE the review-gate
  // artefact, carry the intro director's line and card over the base station.
  await page.evaluate(() => window.__game && window.__game.silenceIntro && window.__game.silenceIntro());
  // Wait for the ASYNC glb to be parented, not for a wall clock.
  await page.waitForFunction(() => {
    const s = window.__game && window.__game.baseStation;
    if (!s) return false;
    let mesh = null; s.obj.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    return !!(mesh && mesh.material && mesh.material.map && mesh.material.map.image);
  }, null, { timeout: 30000 });
  return page.evaluate(() => { /* … pull the fields out of the first mesh's material … */ });
};
```

`window.__game.baseStation` is already exposed (`client/src/main.js:1381`).

Assertions:

1. **Default rung (`?debug`)** — `material.type === 'MeshStandardMaterial'`, `side === 2`
   (`THREE.DoubleSide`), `normalMap` non-null. Pins "the shipped default changes no look".
2. **Every texture is ≤ 256²** — read `image.width`/`image.height` off `map`, `emissiveMap`, `normalMap`,
   `roughnessMap`/`metalnessMap`. **This is the regression test for the whole feature**: it fails on today's
   1024² build and passes after Step 3, and it is what stops a future preset edit from silently shipping
   1024² again. Put the VRAM arithmetic in the assertion message.
3. **The lit windows are still LIT — measure the map, do not test that it exists.** `emissiveMap != null` is
   *not* the assertion: it only catches pruning, which the Step 3b structure check already catches, and it
   is blind to the failure this feature can actually cause — a 4× downsample averaging 16 texels into 1 on a
   99.5%-black map, then lossy WebP, leaving the map present but dark. Draw the map and read its pixels:

   ```js
   // inside page.evaluate, with `mat` = the base station's material
   const img = mat.emissiveMap && mat.emissiveMap.image;   // ImageBitmap or HTMLImageElement — both drawable
   const c = document.createElement('canvas');
   c.width = img.width; c.height = img.height;
   const g2 = c.getContext('2d', { willReadFrequently: true });
   g2.drawImage(img, 0, 0);
   const d = g2.getImageData(0, 0, c.width, c.height).data;
   const n = c.width * c.height;
   let peak = 0, lit = 0;
   for (let i = 0; i < n; i++) {
     const L = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]; // Rec.709 on raw 8-bit
     if (L > peak) peak = L;
     if (L >= 128) lit++;
   }
   return { peak, litFrac: lit / n };
   ```

   Assert **`peak >= 160`** and **`litFrac >= 0.002`** (0.20% of texels at or above 128). Measured this
   session: the shipped 1024² PNG gives peak **215.9** / litFrac **0.415%**; a real 256² WebP build of the
   source gives peak **204.4** / litFrac **0.375%** — so both floors sit ~1.9-2× under the real values, and
   a *fraction* (not a count) is used because it is stable across 256² / 512² / 1024². **Put those measured
   baselines in the assertion messages**, e.g. `` `emissive peak ${peak.toFixed(1)} — the lit windows went
   out (measured 204.4 at 256² WebP, 215.9 at the 1024² source)` ``, so whoever hits the failure knows
   whether they are looking at a regression or a changed build setting. Keep asserting `emissiveMap` is
   non-null first, as a clean failure message when the pruner *has* flattened it (Rec.709 on a null map
   throws an unreadable error instead).
4. **`?stationmat=lean`** — still `MeshStandardMaterial`, `side === 0` (`FrontSide`), `normalMap === null`.
5. **`?stationmat=phong`** — `type === 'MeshPhongMaterial'`, `emissiveMap` non-null, `side === 0`.
6. **`?stationmat=basic`** — `type === 'MeshBasicMaterial'`, `side === 0`.
7. **`?stationmat=nonsense`** — falls back to `MeshStandardMaterial` with `side === 2` (the flag never
   half-applies).
8. `shot('default')`, `shot('lean')`, `shot('phong')`, `shot('basic')` — the eyeball artefacts, framed with
   the base station in shot. The level starts the player docked at the base station with its modules filling
   the middle of the frame (`43-expensive-look.mjs:109`), so a screenshot straight after the boot gate shows
   it; if the ship has drifted, set `g.player.pos` near `(-10, 0, -10)` + `g.stepSim(3)` before the shot.

Run it (note both isolation flags):

```bash
cd client
DATABASE_URL=postgres://localhost:5432/spacegame_station_visual VISUAL_PORT=4183 \
  node visual/run.mjs 46-base-station
```

The scenario number may collide with the parallel run in
`2026-08-31-1515-ship-weight-class` — re-check the highest number in
`client/visual/scenarios/` at merge time and renumber if needed.

### Replay / intro impact

**None, and here is the check rather than the assertion.** This change touches (a) texture bytes inside a
set-piece glb and (b) a view-layer material on a non-collidable decor object. `makeStationModel` is called
from `buildSetPiece`, uses no `simRandom()` (the decor RNG contract at `client/src/world.js:1261-1268`), and
the base station has no collision or damage path — the sim only reads `G.baseStation.pos`, which is set from
the seed's `pos` and is unchanged. Nothing in `sim.update()` sees the material or the texture size, so the
recorded Level-0 intro trace re-sims identically. Run `node visual/run.mjs 22-trace-replay` anyway (it is
cheap, and it is the standing guard for "did the sim move"), with the same `VISUAL_PORT`/`DATABASE_URL`
isolation.

## Step 7 — docs

- **`docs/CHANGELOG.md`** — one bullet under a `## 2026-08-31` heading (create it if the parallel run has
  not): lead with **"The base station stops eating half the game's texture memory"**; the 21.3 MiB → 1.3 MiB
  and 1.55 MB → ~90 KB numbers; the `--texture-size`/`textureCompress` stage-ordering bug and the new
  build-time throw + root `npm test` + CI step; the `?stationmat` fork and that it is off by default; the
  honest note that the texture win is memory/download and is not expected to move fps.
- **`docs/SUMMARY.md`** (edit in place, and bump `**Updated:**` on line 6):
  - **Asset pipeline** (~lines 1111-1155): the new `base_station` override; that `PRESET.combat` has **no**
    default `textureSize` and why; `checkPreset` and the build-time throw; the new root `npm test`
    (`node --test scripts/`) and its CI step.
  - **Set-pieces → `base-station`** (lines 2684-2690): the model is now 4 × 256² WebP, ~90 KB, ~1.3 MiB VRAM,
    1 draw call / 2 723 triangles; note it is fill-bound, not submit-bound.
  - **Visuals → lights** (~lines 2151-2155, right where `?lights=N` is documented): add `?stationmat=` with
    its four rungs, its default, and the sentence that the `basic` rung loses the lit windows.
  - **Tests** (~lines 4684-4695): the new `46-base-station` scenario, `client/src/station-mat.test.js`, and
    `scripts/assets-config.test.mjs` + how the root suite is run.
  - **Deployment & CI/CD** (~line 3481): the added asset-pipeline test step in the `test` job.
- **`docs/plans/ship-model-pipeline.md:15-18`** — the reference brief SUMMARY points at for the pipeline
  still states the combat policy as *"aggressive decimation (`--simplify`) + meshopt geometry compression
  **+ 256px textures**"*. That sentence is exactly the falsehood this feature disproves, and leaving it
  re-arms the trap in the docs. Correct it to say: combat has **no default texture size**; gltf-transform
  performs the resize **inside** its `textureCompress` stage, so `--texture-size` does nothing while
  `--texture-compress` is `false` (which is the combat default); a model that wants smaller textures opts in
  per-model via `PRESET_OVERRIDES` with `textureCompress` *and* `textureSize` together, and `checkPreset`
  now throws on the half-configured case.
- **`docs/ROADMAP.md`**, section **"The station is the frame-rate cliff (opened 2026-08-31)"**
  (lines 364-382) — this is a resolution, not a new entry. Record: the open question "is it fill or submit?"
  is **answered — 1 draw call, 2 723 triangles, so fill/bandwidth-bound, not submit-bound**; the texture fix
  shipped and what it bought; the shading question is *not* closed and is now measurable via `?stationmat`,
  with the two measured reasons (147 boundary edges; 22.8% of normal-map texels carrying real relief) why
  neither cheap move is free. Then add the two deferred follow-ups:
  1. **The remaining ~18 MiB of model VRAM** — `--texture-size` is still a no-op for every combat model
     without a `textureCompress` override; making it work would re-hash ~6 models (enemies, freighter,
     `machine_gun`, `repair_drone`), each needing a catalog edit, an S3 push, a look check and an itch
     republish. A feature of its own. *Audit the neighbouring knob in the same pass:* `simplifyRatio` is read
     only as a boolean switch (`p.simplifyRatio < 1 ? 'true' : 'false'`, `scripts/assets-build.mjs:32`) — its
     numeric value is never passed to the CLI, so every "0.2" in the presets is decorative too. Same class of
     bug, smaller stakes, deliberately out of scope here.
  2. **Superseded hashes accumulate in `client/assets/ships/`** — `assets:pull` syncs the whole
     `ships-combat/` prefix with no `--delete` (`scripts/assets-pull.mjs:16-22`) and `build:itch` copies the
     entire `client/assets` directory (`scripts/build-itch.mjs:35-37`), so every stale build rides along in
     the itch ZIP against its size limit.
- **`docs/DECISIONS.md`** — a new numbered entry. **The number is provisional: the highest today is §141
  (`docs/DECISIONS.md:5788`) and the parallel `2026-08-31-1515-ship-weight-class` run may also claim §142 —
  re-check and renumber at merge.** Title along the lines of *"The base station's textures were 54% of the
  game's model VRAM — and the preset that said 256 did nothing"*. Cover: the gltf-transform stage-ordering
  trap and why the fix is a throw rather than a second resize pass (blast radius); why the texture rebuild
  ships unconditionally even though it is not expected to move fps (memory + download stand on their own,
  and the ALU cliff is a different lever); and why the material is a **flag rather than a choice** — the two
  measured facts (open hull, real relief in the normal map) plus the PMREM-on-High-and-Balance fact that
  makes a Phong swap a re-lighting, not a simplification. Cross-reference §139 (real lights), §140 (Balance
  keeps resolution), §37 (itch republish), §30, §23.
- **`client/assets/CREDITS.md`** — attribution row at line 29 **unchanged** (D6). Update the prose at
  lines 101-104 to say the build shrinks the four 1024² maps to **256px WebP** with `pruneSolidTextures:
  false` protecting the emissive map, → a ~90 KB combat glb. While there: that paragraph says the station
  "sits at the world origin `(0,0)`" — it has been at `(-10,-10)` since the reposition; fix it in the same
  pass. Then run `npm run credits:build` (it regenerates the committed `client/src/credits-data.js`;
  `credits-data.test.js` is the drift guard and will fail if you skip it).

## Step 8 — ship it (order matters)

1. `npm run assets:push` — from **this worktree**, so it uploads only `assets-dist/` (the new combat +
   hangar glbs) and `assets-src/base_station.glb` to `source/`. Confirm the 512 comparison build is not in
   `assets-dist/` (Step 3a).
2. `npm run assets:check` — must list the new `map:...:base-station` key as `ok`. This is the CI deploy
   guard, so it has to be green **before** the merge.
3. Merge / deploy through the normal pipeline. The deploy job runs `assets:check` → `assets:pull` →
   `docker build` → container restart, and the restart reseeds `maps` with the new `modelUrl`.
4. Live-verify on prod: the base station renders with its lit windows, and DevTools shows the ~90 KB glb.
5. **`/publish-itch`** (DECISIONS §37). The itch ZIP bundles the combat glbs but reads the catalog live from
   prod, so until this runs the itch build 404s the new hash and the base station falls back to nothing.
6. **Then, and only then, delete the superseded S3 object**
   `s3://vega-sentinels-assets/ships-combat/base_station_combat.529dee5e.glb`, and delete the local
   `client/assets/ships/base_station_combat.529dee5e.glb` in the main checkout.
   **Reasoning, since this is the one destructive step:** keeping it costs a permanent 1.55 MB in every itch
   ZIP and every Docker image, because `assets:pull` mirrors the whole prefix with no `--delete` and
   `build:itch` copies the directory wholesale — which directly undoes the download win this feature exists
   for. Nothing depends on the object: `rollback.sh` re-tags a **local Docker image** that already has its
   assets baked in, so a rollback never reads S3; and the source is backed up under `source/`. Two honest
   caveats that decide the *sequencing*: a git-revert of `catalog_seed.js` followed by a redeploy would fail
   `assets:check` on the now-missing key, and "exactly reproducible from source" has a shelf life because
   `npx @gltf-transform/cli@^4` floats within a major. Doing the delete last — after prod and itch are both
   verified — keeps the revert window open for the whole risky part.
   **The hangar side, stated rather than left as a silent asymmetry:** the new `base_station.hangar` override
   also produces a new hangar hash, orphaning `ships-hangar/base_station_hangar.<old>.glb`. **Leave both
   hangar objects alone.** Nothing references either one — the `base-station` set-piece has no
   `modelUrlHigh` (`server/src/catalog_seed.js:1093-1096`), the hangar prefix is served from CloudFront and
   is never pulled into the image or the itch ZIP (`assets:pull` syncs `ships-combat/` only,
   `scripts/assets-pull.mjs:22-24`), so an orphan there costs a few hundred KB of S3 and nothing else. Only
   the **combat** object is worth deleting, because only that prefix rides along in every build.

## Step 9 — the measurement the flag exists for (maintainer, on the Redmi 15C)

Not an implementer step; write it into the CHANGELOG/ROADMAP so it is not lost. Same device, same spot
(docked at the base station, zoomed in so it fills the frame), `?dev` fps readout, one reload per run:

`?lights=16` alone → `?lights=16&stationmat=lean` → `&stationmat=phong` → `&stationmat=basic`, then the same
four at `?lights=0` to separate the per-light ALU from the constant per-fragment cost. `basic` is the floor:
whatever it does not recover is not in the station's shading at all.

---

## Tests — what to add and how to run

| What | Where | How |
| --- | --- | --- |
| Preset guard + `base_station` override (new) | `scripts/assets-config.test.mjs` | `npm test` at the repo root (`node --test scripts/`) |
| `?stationmat` parser incl. the warn-on-typo path (new) | `client/src/station-mat.test.js` | `cd client && node --test` |
| Base-station material, texture size ≤ 256², **the emissive map's measured peak + lit fraction**, all four rungs (new) | `client/visual/scenarios/46-base-station.mjs` | `cd client && DATABASE_URL=postgres://localhost:5432/spacegame_station_visual VISUAL_PORT=4183 node visual/run.mjs 46-base-station` |
| Sim did not move | existing `22-trace-replay` | same command, `… node visual/run.mjs 22-trace-replay` |
| Nothing else regressed server-side | existing | `cd server && npm test` — **note its `pretest` drops and recreates the shared `spacegame_test` DB; coordinate with the parallel worktree or expect to break its run** |
| Client logic suite | existing | `cd client && node --test` |

**Do NOT run the 49-scenario visual suite or the A/B perf bench.** Both are the orchestrator's opt-in gates
(DECISIONS §141). Named scenarios only.

## Review-gate artefacts to hand back

1. The 256 vs 512 close-up screenshot pair from Step 3a (D1 is decided in favour of 256, but the maintainer
   sees both) — with the note about which artefact is which: baseColor softness vs normal-map shading noise.
2. The four `?stationmat` rung screenshots from the scenario (D2 — the whole point of the fork), free of the
   intro director's line/card.
3. The `gltf-transform inspect` output and the structure-check output from Step 3b.
4. **The emissive map's measured peak luminance and lit fraction on the build you actually produced**,
   against the 204.4 / 0.375% baseline in Step 3b.3 — this is the "did the windows survive" evidence, and a
   number near the floor rather than near the baseline is a stop-and-report.
5. The before/after numbers: file size, texture count/format/resolution, computed VRAM.

## Out of scope / non-goals (DECISIONS §30)

- **Picking a material.** The plan ships a fork, not a decision. Do not promote a rung to the default, and do
  not tier-gate it.
- **The space factory**, and anything else that renders through `makeStationModel` other than
  `base-station`.
- **Rebuilding the other ~6 textured combat models** / making `--texture-size` work for uncompressed builds.
  ROADMAP follow-up, recorded in Step 7.
- **A general stale-hash cleanup** of `ships-combat/` or the itch ZIP. Only the one superseded base-station
  object is deleted, and only in Step 8.6. ROADMAP follow-up.
- **Splitting the station mesh, LODs, distance-based light dimming, or a `weightClass` field.** All are
  live ROADMAP ideas; none belong here.
- **Touching `engine-lights.js`, the tier table, or `pixelRatioCap`.** §140 just settled the resolution
  question; do not reopen it.
- **`?tune` sliders** for any of this (D7).
