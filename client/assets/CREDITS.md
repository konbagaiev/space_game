# Asset credits & licenses

Every third-party asset in this folder must be listed here with its source and license. Only use
licenses that allow **commercial** use: **CC0** (no attribution needed) or **CC-BY** (attribution
required — keep the author + link below). Avoid `*-NC` (non-commercial) and `*-SA` unless you accept
share-alike. When you download an asset, save the source URL and license here (a screenshot of the
asset page is also handy, in case the author later changes the terms).

| Asset (file) | Author | Source URL | License | Date added |
|--------------|--------|------------|---------|------------|
| sounds/kinetic.\<hash\>.mp3 (kinetic gun SFX) | serutonin-deprivd | https://freesound.org/s/855652/ | CC0 1.0 | 2026-06-23 |
| sounds/rocket.\<hash\>.mp3 (rocket launch SFX) | smokey9977 | https://freesound.org/s/569563/ | CC0 1.0 | 2026-06-23 |
| sounds/cannon.\<hash\>.mp3 (Heavy cannon SFX) | Freesound (CC0 filter) | _id not retained (renamed cannon.wav)_ | CC0 1.0 | 2026-06-23 |
| sounds/shipHit.\<hash\>.mp3 (kinetic hit on player ship) | Freesound (CC0 filter) | _id not retained (renamed my_ship_hit_by_kinetic.wav)_ | CC0 1.0 | 2026-06-23 |
| sounds/shipBoom.\<hash\>.mp3 (medium/large ship explosion) | Freesound (CC0 filter) | _id not retained (renamed "medium_ship destroyed.mp3")_ | CC0 1.0 | 2026-06-23 |
| sounds/blast.\<hash\>.mp3 (rocket + small ship explosion, from blast.flac) | Freesound (CC0 filter) | _id not retained (renamed blast.flac)_ | CC0 1.0 | 2026-06-24 |
| sounds/music_hangar_1.\<hash\>.mp3 (hangar background loop) | Freesound (CC0 filter) | _id not retained (renamed menu-background-sound-1.wav)_ | CC0 1.0 | 2026-06-24 |
| sounds/music_combat_1.\<hash\>.mp3 (combat background loop) | Freesound (CC0 filter) | _id not retained (renamed game-background-dragons-breath.wav)_ | CC0 1.0 | 2026-06-24 |
| ships/enemy_1–4 + enemy_1–4_orange (combat + hangar `.glb`, derived from `_source/lowpoly_spaceships.glb`; the `_orange` set is the same models recolored red → #f4741f) — basic enemy, rocketeer, medium, first boss (+ orange variants) | Pedram Ashoori | https://skfb.ly/6pxFX | CC-BY 4.0 | 2026-06-24 |
| ships/player_combat + player_hangar `.glb` (player ship, textures downscaled) | Raven | https://skfb.ly/otR6F | CC-BY 4.0 | 2026-06-24 |

<!--
Example row:
| ships/fighter.glb | Kenney | https://kenney.nl/assets/space-kit | CC0 1.0 | 2026-06-20 |
-->

## Models

The **`enemy_1`–`enemy_4`** ship models are cut from the **"LowPoly Spaceships"** pack by **Pedram
Ashoori** (Sketchfab, **CC-BY 4.0** — attribution required, so this entry must stay). The in-game
combat/hangar `.glb`s are decimated/compressed derivatives of that source (`assets-src/enemy_*.glb` →
`assets:build`). The **`enemy_*_orange`** ships are the same models with the red material colors
recolored to **#f4741f** (orange) — still derivatives of the same pack, same attribution. The tint is
produced reproducibly by `npm run assets:recolor` (`scripts/assets-recolor.mjs`, target hex in the script).

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "LowPoly Spaceships" (https://skfb.ly/6pxFX) by Pedram Ashoori is licensed under Creative Commons
> Attribution (http://creativecommons.org/licenses/by/4.0/).

The **player ship** (`player_combat`/`player_hangar`) is **"Air & Space Vessel"** by **Raven** (Sketchfab,
**CC-BY 4.0** — attribution required, so this entry must stay). The source was 48 MB (~89 high-res PBR
textures); `assets:build` (with the `player` preset override) **downscales the textures** (128px combat /
512px hangar) + meshopt-compresses the geometry → ~370 KB combat / ~1.7 MB hangar, keeping the real
paint/decals.

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Air & Space Vessel" (https://skfb.ly/otR6F) by Raven is licensed under Creative Commons
> Attribution (http://creativecommons.org/licenses/by/4.0/).

The older primitive fallbacks (`player.glb`, `fighter.glb`, `rocketeer.glb`,
`heavy.glb`, `boss.glb`, `Spaceship*.glb`) are placeholder geometry, not from either pack.

**CC-BY housekeeping:** if a model from this pack is ever removed and no longer used by any ship, drop
its row here too (don't keep stale attribution); if a new model from a new source is added, add its row.
When adding/changing/removing any model, confirm with the maintainer whether this file changes (see the
asset-credits rule in `CLAUDE.md`).

## Audio

**Most game audio is procedurally synthesized in code** (native Web Audio API, `client/src/audio.js`) —
the generative background music and most SFX have no third-party assets. A **sampled SFX layer** (DECISIONS
§22) adds curated recordings where they help; each sampled sound is a third-party asset and **must** be
listed in the table above with its source + license before use. Sample bytes are content-hashed and live on
S3 (`sfx/`), pulled into `client/assets/sounds/` (gitignored) — see `docs/plans/audio-sample-pipeline.md`.
