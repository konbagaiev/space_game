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

4. **Point to it** in `client/index.html`, in the `SHIP_MODELS` map:
   ```js
   const SHIP_MODELS = {
     player:    'assets/ships/player.glb',
     fighter:   'assets/ships/fighter.glb',
     rocketeer: null,   // still the primitive
     heavy:     { url: 'assets/ships/heavy.glb', yaw: Math.PI },
   };
   ```
   Each value is `null` (primitive), a path string, or an object with tuning knobs:
   - **`url`** — path to the `.glb`.
   - **`yaw`** — extra Y-rotation (radians) if the nose doesn't point `+Z`. Our ships face `+Z`;
     many models face `-Z` → use `Math.PI`. (`±Math.PI/2` for models facing `+X`/`-X`.)
   - **`tint`** — recolor the model to the ship's color so the color-coding holds (player blue;
     enemies red/yellow/purple). Default `true`. Set `false` to keep the model's own materials.
   - **`scaleMul`** — fine-tune size after auto-normalization (default `1`). The longest axis is
     auto-scaled to match the primitive ship's footprint; this multiplies that.

### How it works
`makeShip()` builds the primitive immediately (it shows while the model loads, and stays as a
fallback if loading fails), then `applyShipModel()` loads the `.glb`, auto-centers and scales it,
optionally tints and rotates it, and swaps it into the same object — so all gameplay logic
(movement, hit radius, exhaust, explosions) is unchanged. The heavy enemy's 2× size still applies on
top via `sizeScale`.

After adding a model, eyeball it with the visual tests (`npm run test:visual` from `client/`) or just
open the game and check the orientation/size, tweaking `yaw`/`scaleMul` as needed.
