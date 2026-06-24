// SFX manifest — logical sound name → its content-hashed, same-origin URL.
//
// This is the audio analog of a ship's `modelUrl` in catalog_seed.js: the bytes live on S3 (pulled into
// client/assets/sounds/ at deploy, gitignored), and this file — committed text — pins the exact hashed
// build the client loads. To update a sound: rebuild it (docs/plans/audio-sample-pipeline.md), push to
// S3, then change the one URL here (the new hash). `assets:check` verifies every URL here exists on S3.
//
// index.html passes this map to `audio.preloadSamples(SFX_SOURCES)` after the first user gesture; a
// missing/failed buffer is non-fatal — the engine falls back to its procedural synth (DECISIONS §22).
// Weapons opt into a sample via `stats.sfx: '<key>'` in catalog_seed.js (read as `w.sfx` at the fire site).
export const SFX_SOURCES = {
  kinetic: 'assets/sounds/kinetic.6d8dda6a.mp3', // glock shot (Freesound CC0), level baked ≈−10 dB — Basic kinetic + Machine Guns
  rocket: 'assets/sounds/rocket.0e10b34a.mp3',   // rocket launch (Freesound CC0), trimmed to 2.3 s — player rockets
  cannon: 'assets/sounds/cannon.689d2b52.mp3',   // cannon shot — Heavy cannon weapon (stats.sfx: 'cannon')
  shipHit: 'assets/sounds/shipHit.8b58950e.mp3', // kinetic impact on the PLAYER's ship — audio.sfx.hit('shipHit')
  shipBoom: 'assets/sounds/shipBoom.dcd028da.mp3', // medium/large ship destroyed, trimmed to 2 s — audio.sfx.explosion(size>=2, 'shipBoom')
  blast: 'assets/sounds/blast.fcd21671.mp3',     // rocket detonation + small ship death (first 0.7 s of blast.flac) — audio.sfx.explosion(size<2, 'blast')
};
