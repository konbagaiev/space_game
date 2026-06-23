# Assets

Game assets (3D models, etc.). Keep everything here **English-only** and with a clear, commercial-use
license (see `CREDITS.md`).

## Ship models (`.glb`)

Ships use built-in primitive shapes by default. To replace one with a real model:

1. **Get a model** — prefer **CC0** (no attribution, commercial use OK) or **CC-BY** (commercial OK,
   must credit). Good sources: [Kenney Space Kit](https://kenney.nl/assets/space-kit) (CC0),
   [Quaternius](https://quaternius.com/) (CC0), [Poly Pizza](https://poly.pizza/),
   [Sketchfab](https://sketchfab.com/) (filter Downloadable + a CC license).
   Avoid `*-NC` (non-commercial) and trademarked/branded ships.

2. **Format: `.glb`** (binary glTF — one self-contained file). If you have `.obj`/`.fbx`, convert it
   (e.g. in Blender: *File → Export → glTF 2.0 (.glb)*). Prefer **low-poly** (the camera is far and
   ships are small; watch the perf overlay's `draw`/`tris`).

3. **Drop the file** in `assets/ships/`, e.g. `assets/ships/fighter.glb`.

4. **Point to it** from the **seed** (`server/src/catalog_seed.js`), not from `index.html` — ships are
   DB-driven. Set the ship's **`modelUrl`** (combat, same-origin) and optional **`modelUrlHigh`**
   (hangar, CloudFront), and put any orientation/size tuning in the ship's **`stats`**:
   ```js
   {
     name: 'basic enemy ship', type: 'enemy',
     modelUrl: 'assets/ships/enemy_1_combat.<hash>.glb',
     modelUrlHigh: 'https://…/ships-hangar/enemy_1_hangar.<hash>.glb',
     stats: { role: 'fighter', /* … */ modelYaw: Math.PI },
   }
   ```
   The client (`makeShip` → `modelSpec` → `applyShipModel`) reads `modelUrl` + these `stats`:
   - **`modelYaw`** — extra Y-rotation (radians) if the nose doesn't point `+Z`. **Our ships face
     `+Z`; many exported models face `-Z` → use `Math.PI`** (`±Math.PI/2` for `+X`/`-X`). Both the
     combat and hangar models come from the same source, so one `modelYaw` corrects both.
   - **`sizeScale`** — gameplay+visual size multiplier (also scales the hit radius). The model's
     longest axis is auto-normalized to the primitive footprint first; this multiplies that.
   - Enemies are **never tinted** (`modelSpec` loads with `tint: false`) — appearance is the model
     itself (see DECISIONS §14). `applyShipModel` still supports a `tint` knob for the primitive path.

### How it works
`makeShip()` builds the primitive immediately (it shows while the model loads, and stays as a
fallback if loading fails), then `applyShipModel()` loads the `.glb`, **auto-centers, auto-scales, and
re-orients (`yaw`)** it, and swaps it into the same object — so all gameplay logic (movement, hit
radius, exhaust, explosions) is unchanged. Centering/scale/orientation are **runtime normalizations**:
the asset's own transform is not trusted, so a model facing the wrong way is fixed with `modelYaw` in
the seed, **not** by re-exporting.

### Before you push a model to S3 — orientation check (avoids the "flying backwards" bug)
The combat `.glb` is built with no geometry compression specifically so **macOS Quick Look** can
preview it (`scripts/assets-config.mjs`). Before `npm run assets:push`:
1. **Preview the combat `.glb`** (Quick Look / a glTF viewer) and note which way the nose points.
2. **Our convention is nose = `+Z`.** If it faces any other way, set **`stats.modelYaw`** in the seed
   (`-Z` → `Math.PI`); don't re-export just to rotate.
3. After seeding, **eyeball it in-game** (open the game, or `npm run test:visual` from `client/` and
   check the screenshots) — confirm the ship flies nose-first, not engine-first.
