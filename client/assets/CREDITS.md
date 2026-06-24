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

<!--
Example row:
| ships/fighter.glb | Kenney | https://kenney.nl/assets/space-kit | CC0 1.0 | 2026-06-20 |
-->

## Audio

**Most game audio is procedurally synthesized in code** (native Web Audio API, `client/src/audio.js`) —
the generative background music and most SFX have no third-party assets. A **sampled SFX layer** (DECISIONS
§22) adds curated recordings where they help; each sampled sound is a third-party asset and **must** be
listed in the table above with its source + license before use. Sample bytes are content-hashed and live on
S3 (`sfx/`), pulled into `client/assets/sounds/` (gitignored) — see `docs/plans/audio-sample-pipeline.md`.
