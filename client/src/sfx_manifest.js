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
  kinetic: 'assets/sounds/kinetic.e177a4ae.mp3', // glock shot (Freesound CC0) — Basic kinetic + Machine Guns
};
