# Asset credits & licenses

Every third-party asset in this folder must be listed here with its source and license. Only use
licenses that allow **commercial** use: **CC0** (no attribution needed), **CC-BY** (attribution
required — keep the author + link below), or the **Pixabay Content License** (commercial use OK, no
attribution required; the only relevant restriction is you may not resell/redistribute the asset on a
*standalone* basis — embedding it in the game is fine). Avoid `*-NC` (non-commercial) and `*-SA` unless
you accept share-alike. When you download an asset, save the source URL and license here (a screenshot of the
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
| sounds/music_combat_2.\<hash\>.mp3 (combat background track — "Energetic Synthwave") | ed-musicproductions | https://pixabay.com/music/synthwave-energetic-synthwave-412360/ | Pixabay Content License | 2026-06-30 |
| sounds/beamCharge.\<hash\>.mp3 + sounds/beamFire.\<hash\>.mp3 (Charged beam charge + discharge SFX, cut from one source) | TannerSound | https://freesound.org/s/843729/ | CC-BY 4.0 | 2026-08-25 |
| ships/enemy_1–4 + enemy_1–4_orange (combat + hangar `.glb`, derived from `_source/lowpoly_spaceships.glb`; the `_orange` set is the same models recolored red → #f4741f) — basic enemy, rocketeer, medium, first boss (+ orange variants) | Pedram Ashoori | https://skfb.ly/6pxFX | CC-BY 4.0 | 2026-06-24 |
| ships/player_combat + player_hangar `.glb` (player ship, textures downscaled) | Raven | https://skfb.ly/otR6F | CC-BY 4.0 | 2026-06-24 |
| ships/repair_drone_hangar.\<hash\>.glb (Repair drone item icon — menu only) | Ivan Potupin | https://skfb.ly/pGPyp | CC-BY 4.0 | 2026-06-29 |
| ships/machine_gun_hangar.\<hash\>.glb (Machine Gun item icon — menu only) | suvee10 | https://skfb.ly/oHLZB | CC-BY 4.0 | 2026-06-29 |
| ships/freighter_combat.\<hash\>.glb (Freighter set-piece — cargo transport decor) | Felipe Augusto Vera | https://skfb.ly/oPRwV | CC-BY 4.0 | 2026-07-02 |
| ships/metal_box_combat.\<hash\>.glb (shared equipment-drop model — the loot "crate") | District24 | https://skfb.ly/JwFQ | CC-BY 4.0 | 2026-07-03 |
| ships/base_station_combat.\<hash\>.glb (Base station set-piece — return-to-base target) | MisterH | https://skfb.ly/ozESS | CC-BY 4.0 | 2026-07-03 |
| ships/asteroids_combat.\<hash\>.glb (asteroid pack, 3 rock meshes — the mission `asteroid-field` set-piece rocks/hosts) | ARCTIC WOLVES™ | https://skfb.ly/psECZ | CC-BY 4.0 | 2026-07-16 |
| ships/engine_thruster_hangar.\<hash\>.glb (shared THRUSTER component item icon — menu only) | Yo.Ri | https://skfb.ly/6qEKD | CC-BY 4.0 | 2026-08-09 |
| ships/maneuver_thruster_hangar.\<hash\>.glb (shared ENGINE component item icon, animated flame — menu only) | photon (that one larry) | https://skfb.ly/pyoLw | CC-BY 4.0 | 2026-08-09 |
| ships/space_factory_combat.\<hash\>.glb (Space Factory set-piece — the orbital industrial station up-left of the home planet) | rivetech | https://skfb.ly/oPZKM | CC-BY 4.0 | 2026-08-10 |
| ships/sun_combat.\<hash\>.glb (Vega — the system's central star) | SebastianSosnowski | https://skfb.ly/6yGSx | CC-BY 4.0 | 2026-08-10 |

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

The **item icons** — `repair_drone_hangar` (the Repair drone component) and `machine_gun_hangar` (the
Machine Gun weapon) — are **menu-only** 3D models (shown in the item preview; never rendered in combat).
Both are **CC-BY 4.0** (attribution required, so these entries must stay while in use). They live under
the `ships-hangar/` S3 prefix (reused for all high-poly menu glbs; see
`docs/plans/component-weapon-models.md`).

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Repair Drone - XYZ Homework (Detailing)" (https://skfb.ly/pGPyp) by Ivan Potupin is licensed under
> Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).
>
> "machine gun" (https://skfb.ly/oHLZB) by suvee10 is licensed under Creative Commons Attribution
> (http://creativecommons.org/licenses/by/4.0/).

The **freighter** set-piece (`freighter_combat`) is **"Freighter - Spaceship"** by **Felipe Augusto
Vera** (Sketchfab, **CC-BY 4.0** — attribution required, so this entry must stay while in use). It is the
first `.glb`-backed mission set-piece (the "save the transport" cargo ship that cruises below the
battlefield); `assets:build` decimates/meshopt-compresses it into `freighter_combat`.

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Freighter - Spaceship" (https://skfb.ly/oPRwV) by Felipe Augusto Vera is licensed under Creative
> Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

The **equipment-drop** model (`metal_box_combat`) is **"Metal box"** by **District24** (Sketchfab,
**CC-BY 4.0** — attribution required, so this entry must stay while in use). It is the single shared model
rendered for every loot drop (the slowly-rotating crate a killed enemy leaves behind, pulled in by the
Grab). The 703 KB source is texture-dominated (two 1024² PNGs); `assets:build` (with the `metal_box`
preset override) downscales the textures to 128px WebP + meshopt-compresses the geometry → a ~6 KB combat glb.

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Metal box" (https://skfb.ly/JwFQ) by District24 is licensed under Creative Commons Attribution
> (http://creativecommons.org/licenses/by/4.0/).

The **base station** set-piece (`base_station_combat`) is **"Low Poly space station."** by **MisterH**
(Sketchfab, **CC-BY 4.0** — attribution required, so this entry must stay while in use). It sits at
`(-10,-10)` below the combat plane as the return-to-base target; `assets:build` decimates/meshopt-
compresses it into `base_station_combat` and shrinks its four 1024² PNG maps (baseColor / normal /
metallicRoughness / emissive) to **256px WebP**, with `pruneSolidTextures: false` protecting the emissive
map (it is ~99.5% black — small lit windows — and the solid-texture pruner would flatten it and make the
whole hull glow). Result: a ~270 KB combat glb instead of 1.55 MB, at the SAME 1024² resolution — the
solar-panel detail is untouched.

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Low Poly space station." (https://skfb.ly/ozESS) by MisterH is licensed under Creative Commons
> Attribution (http://creativecommons.org/licenses/by/4.0/).

The **asteroid pack** (`asteroids_combat`) is **"Wandering Asteroids Of Andromeda"** by **ARCTIC WOLVES™**
(Sketchfab, **CC-BY 4.0** — attribution required, so this entry must stay while in use). One `.glb` of 3
rock meshes; the client scatters random variants as the mission `asteroid-field` set-piece's rocks and host
rocks (its only use — the distant parallax backdrop is the procedural point-sprite speed field, no asset).
`assets:build` (via the `asteroids` preset override) converts its legacy
spec-gloss materials to metal-rough, shrinks textures to 256px WebP, and simplifies + meshopt-compresses
the geometry → a ~91 KB combat glb.

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Wandering Asteroids Of Andromeda" (https://skfb.ly/psECZ) by ARCTIC WOLVES™ is licensed under Creative
> Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

The **engine and thruster item icons** — `maneuver_thruster_hangar` (shown for every `engine` component)
and `engine_thruster_hangar` (every `thruster` component) — are **menu-only** 3D models like the two above:
one shared model per component family, spun in the shop/loadout detail panel, never rendered in combat.
(The file names read backwards against the families they serve: they are named after their SOURCE assets,
and the two were swapped between families after seeing them in the preview. The wiring lives in
`catalog_seed.js`, so the names are cosmetic.) Both are **CC-BY 4.0** (attribution required, so these
entries must stay while in use). `assets:build` shrinks both texture sets hard (256px WebP): the animated
source is texture-dominated (2.3 MB of its 2.5 MB) → an ~86 KB hangar glb, and it keeps its skeleton + the
looping "Flame startAction" clip, which the item viewer plays. One model per family is a deliberate placeholder pass — per-tier models are a
future iteration, and swapping one in means replacing only the shared constant in `catalog_seed.js`.

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "LowPoly Sci-Fi Thruster" (https://skfb.ly/6qEKD) by Yo.Ri is licensed under Creative Commons
> Attribution (http://creativecommons.org/licenses/by/4.0/).
>
> "Thruster animation" (https://skfb.ly/pyoLw) by photon (that one larry) is licensed under Creative
> Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

The **space factory** set-piece (`space_factory_combat`) is **"Sci-Fi Space Station: Rotor Nexus"** by
**rivetech** (Sketchfab, **CC-BY 4.0** — attribution required, so this entry must stay while in use). It is
the navigation destination two screens up-left of the home planet, built by the same below-plane spinning
`.glb` set-piece code as the base station. The 6.7 MB source is texture-dominated — 4.6 MB of it is eight
1024² PNGs (baseColor / metallicRoughness / emissive / normal, two materials) costing ~45 MB of VRAM against
~2 MB of geometry — so `assets:build` (via the `space_factory` preset override) shrinks every texture to
256px WebP and meshopt-compresses the geometry → a ~159 KB combat glb with ~2.8 MB of VRAM. The override
also sets `pruneSolidTextures: false`: the emissive maps are mostly black with small lit windows, and
`optimize`'s solid-texture heuristic would flatten them to a factor and make the whole hull glow.

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Sci-Fi Space Station: Rotor Nexus" (https://skfb.ly/oPZKM) by rivetech is licensed under Creative
> Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

The **star** (`sun_combat`) is **"Sun"** by **SebastianSosnowski** (Sketchfab, **CC-BY 4.0** —
attribution required, so this entry must stay while in use). It replaced the procedural emissive sphere
that stood in for Vega. The asset ships TWO concentric spheres — an orange emissive core inside a
slightly larger yellow shell whose material uses `KHR_materials_transmission`; the game draws only the
yellow shell (`system.star.yellowOnly`), so the build must PRESERVE that extension or the star turns
orange. `assets:build` (the `sun` preset) keeps the geometry and shrinks the textures to 512 WebP:
2.1 MB → 167 KB.

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Sun" (https://skfb.ly/6yGSx) by SebastianSosnowski is licensed under Creative Commons Attribution
> (http://creativecommons.org/licenses/by/4.0/).

The old in-git primitive placeholder glbs (`player.glb`, `fighter.glb`, `rocketeer.glb`, `heavy.glb`,
`boss.glb`, `Spaceship*.glb`, plus the pre-pipeline non-hashed `enemy_1`–`enemy_4.glb`) were **removed**
on 2026-07-05 — they were unreferenced by code. The runtime pre-load fallback is a **procedural** placeholder
ship built in `client/src/ship-factory.js` (no binary asset).

**CC-BY housekeeping:** if a model from this pack is ever removed and no longer used by any ship, drop
its row here too (don't keep stale attribution); if a new model from a new source is added, add its row.
When adding/changing/removing any model, confirm with the maintainer whether this file changes (see the
asset-credits rule in `CLAUDE.md`).

## Audio

**Most SFX are procedurally synthesized in code** (native Web Audio API, `client/src/audio.js`) and have
no third-party assets. On top of that sit two sampled layers, each a third-party asset that **must** be
listed in the table above with its source + license before use:
- a **sampled SFX layer** (DECISIONS §22) — curated recordings (gun fire, hits, explosions) where they
  beat the synth. It was entirely CC0 until the Charged beam; **`beamCharge` + `beamFire` are the first
  CC-BY sound in the game**, so their attribution below must stay while they are in use;
- **sampled background-music tracks** per scene (the older generative synth music was removed) — picked
  at random and rotated per battle. Combat currently rotates `music_combat_1` (CC0) and `music_combat_2`
  ("Energetic Synthwave" by ed-musicproductions, **Pixabay Content License** — commercial use OK, no
  attribution required; embedding it as combat music is allowed, only standalone resale is not).

The **Charged beam's two samples** (`beamCharge`, `beamFire`) are both cut from ONE source — **"Scifi Laser
Gun Shooting"** by **TannerSound** (Freesound, **CC-BY 4.0** — attribution required, so this entry must stay
while in use). The maintainer chose both cuts by ear (2026-08-25); neither is a straight excerpt.

**`beamCharge` is THREE pieces of the source concatenated**, 1.400 s in all: a quiet opening burst
(0.600→1.100, pulled down 9 dB), a **lifted** build (2.750→3.250), and a tail that deliberately runs *past*
the shot (3.250→3.650). Three details in that are load-bearing rather than incidental: only the **first
1.0 s is the charge** (the last 0.4 s is meant to ring out over and after the discharge, which is why the
playback rate is computed against 1.0 s and not the file's 1.4 s); the build starts at **2.750, not 2.800**,
which puts the source's own crack onset exactly on the shot instead of 50 ms early, where it reads as a flam
rather than one fuller hit; and the build's lift is **tapered (+19 dB → +4 dB), not flat**, because a flat
lift made the build as loud as the crack and the shot stopped being the payoff of its own build-up.

**`beamFire` is pitch-shifted down and then EQ'd** — the maintainer asked for something lower and less
piercing. The EQ is the part that does the work, and it is counter-intuitive enough to be worth recording:
measured per band, pitch-shifting *alone* barely touches the harsh 2–5 kHz region, because it slides higher
content down to refill it. The shipped chain (0.82× with tempo correction, then −11 dB at 3.5 kHz, a −6 dB
shelf from 6 kHz and a 9 kHz low-pass) takes that band down ~9 dB while leaving the bass essentially intact.

Neither file is loudness-normalised, and neither should be: the **swell must stay audibly quieter than the
crack** (it sits ~4 dB down by mean), which is the whole build-then-crack dynamic. Trim with a `SOUNDS`
`gain` if it is ever needed — a per-file `loudnorm` cannot express "quieter than the other file" and would
silently equalise them.

**Required attribution (use verbatim, e.g. in an in-game credits screen):**

> "Scifi Laser Gun Shooting" (https://freesound.org/s/843729/) by TannerSound is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

Sample bytes are content-hashed and live on S3 (`sfx/`), pulled into `client/assets/sounds/` (gitignored)
— see `docs/plans/audio-sample-pipeline.md`.
