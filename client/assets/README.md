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
   (hangar, CloudFront), and put any orientation/size tuning in the ship's **`stats.model`** block:
   ```js
   {
     name: 'Basic pirate ship', type: 'enemy',
     modelUrl: 'assets/ships/enemy_1_combat.<hash>.glb',
     modelUrlHigh: 'https://…/ships-hangar/enemy_1_hangar.<hash>.glb',
     stats: { role: 'fighter', /* … */ model: { yaw: Math.PI, scale: 1 } },
   }
   ```
   The full convention (every key, when to use `muzzle`/`exhaust`, the build steps) is documented in
   **`docs/plans/adding-a-ship-model.md`**. The client (`makeShip` → `modelSpec` → `applyShipModel`,
   via `shipModelCfg`) reads `modelUrl` + `stats.model`:
   - **`model.yaw`** — extra Y-rotation (radians) if the nose doesn't point `+Z`. **Our ships face
     `+Z`; many exported models face `-Z` → use `Math.PI`** (`±Math.PI/2` for `+X`/`-X`). Both the
     combat and hangar models come from the same source, so one `yaw` corrects both.
   - **`model.scale`** — gameplay+visual size multiplier (also scales the hit radius). The model's
     longest axis is auto-normalized to the primitive footprint first; this multiplies that.
   - **`model.muzzle` / `model.exhaust`** — optional group-local overrides for the projectile / exhaust
     spawn (default `null` → auto from the glb bounds). See the convention doc.
   - Enemies are **never tinted** (`modelSpec` loads with `tint: false`) — appearance is the model
     itself (see DECISIONS §14). `applyShipModel` still supports a `tint` knob for the primitive path.

### How it works
`makeShip()` builds the primitive immediately (it shows while the model loads, and stays as a
fallback if loading fails), then `applyShipModel()` loads the `.glb`, **auto-centers, auto-scales, and
re-orients (`yaw`)** it, and swaps it into the same object — so all gameplay logic (movement, hit
radius, exhaust, explosions) is unchanged. Centering/scale/orientation are **runtime normalizations**:
the asset's own transform is not trusted, so a model facing the wrong way is fixed with `model.yaw` in
the seed, **not** by re-exporting.

### Before you push a model to S3 — orientation check (avoids the "flying backwards" bug)
Combat `.glb`s are built light for battle (decimated + meshopt-compressed, `scripts/assets-config.mjs`),
so preview them in a **web glTF viewer** (e.g. `gltf-viewer.donmccurdy.com`), not macOS Quick Look. Before
`npm run assets:push`:
1. **Preview the combat `.glb`** in a web glTF viewer and note which way the nose points.
2. **Our convention is nose = `+Z`.** If it faces any other way, set **`stats.model.yaw`** in the seed
   (`-Z` → `Math.PI`); don't re-export just to rotate.
3. After seeding, **eyeball it in-game** (open the game, or `npm run test:visual` from `client/` and
   check the screenshots) — confirm the ship flies nose-first, not engine-first.

## Audio SFX (`.mp3`)

Full process + ffmpeg recipes: **`docs/plans/audio-sample-pipeline.md`**. The short version:

1. **Get a sound** — prefer **CC0** (e.g. [Freesound](https://freesound.org), filter license = Creative
   Commons 0; also [Kenney](https://kenney.nl/assets?q=audio), [Sonniss GDC](https://sonniss.com/gameaudiogdc)).
   Drop the original in **`assets-src/sounds/`** (gitignored). Avoid `*-NC`.
2. **Extract + clean one shot** (by hand — judging the take + reverb tail needs an ear). Inspect with
   `ffmpeg -i IN.wav -af silencedetect=noise=-30dB:d=0.2 -f null -`, cut the segment, then trim the tail +
   normalize, e.g.:
   ```bash
   ffmpeg -y -accurate_seek -ss <START> -to <END> -i IN.wav -ac 1 -af \
     "highpass=f=60,atrim=0:0.22,afade=t=out:st=0.17:d=0.05,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95" \
     -codec:a libmp3lame -q:a 4 assets-dist/sounds/<name>.mp3
   ```
   Long reverb tails smear under rapid (machine-gun) fire — keep the clip short and dry.
3. **Content-hash** → `mv … "<name>.$(shasum -a 256 <name>.mp3 | cut -c1-8).mp3"` (cache-forever; new
   sound = new url).
4. **Push** (`npm run assets:push` → `sfx/` on S3) and **register** the hashed url in
   **`client/src/sfx_manifest.js`** (`SFX_SOURCES`).
5. **Route it to a weapon** — set **`stats.sfx: '<name>'`** on the weapon in `server/src/catalog_seed.js`
   (it flows to the client as `w.sfx` and plays via `audio.sfx.shoot(w.sfx)`; un-routed weapons keep the
   synth sound). **Record the license** in `CREDITS.md`.
6. **Verify** — `npm run test:visual` from `client/` (the `12-audio` scenario checks each manifest sound is
   served same-origin + decodes), and listen in-game.
