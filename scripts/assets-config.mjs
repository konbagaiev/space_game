// Shared config for the ship-model asset pipeline (docs/plans/ship-model-pipeline.md).
// Source of truth for the bucket/CDN/prefixes + the local (gitignored) working dirs.
export const BUCKET = process.env.ASSETS_BUCKET || 'vega-sentinels-assets';
export const CDN = (process.env.ASSETS_CDN || 'https://d1843uwjdjg4vs.cloudfront.net').replace(/\/$/, '');
export const REGION = process.env.AWS_REGION || 'us-east-1';
// AWS profile: empty by default → uses the CLI's `default` profile locally (the admin user) OR the
// AWS_ACCESS_KEY_ID/SECRET env-var creds in CI (a scoped read-only key). Set AWS_PROFILE to pick another.
export const AWS_PROFILE = process.env.AWS_PROFILE ?? '';
// → the `--profile X` args for the aws CLI, or [] when none (env-var creds / default profile).
export const awsArgs = () => (AWS_PROFILE ? ['--profile', AWS_PROFILE] : []);

// S3 key prefixes.
export const PREFIX = {
  source: 'source/',        // high-poly originals (off-machine backup; lets the pipeline re-run)
  combat: 'ships-combat/',  // low-poly combat glbs (pulled onto the server at deploy, served same-origin)
  hangar: 'ships-hangar/',  // high-poly hangar glbs (served via CloudFront, lazy-loaded)
  sounds: 'sfx/',           // content-hashed SFX mp3s (pulled at deploy, served same-origin like combat)
};

// Local working dirs — ALL gitignored (no binaries in git). Drop sources in `src` (models or sounds/*),
// build into `dist`; `*Serve` dirs are where the server serves the assets from (pulled there in CI / by
// `assets:pull`). SFX sources live in `assets-src/sounds/`, built mp3s in `assets-dist/sounds/`.
export const DIR = {
  src: 'assets-src',
  dist: 'assets-dist',
  combatServe: 'client/assets/ships',
  soundsServe: 'client/assets/sounds',
};

// Build presets (tunable). Combat is built to be as LIGHT as possible for battle — the ship is tiny on a
// top-down screen, so it is aggressively decimated AND meshopt-compressed. The hangar model keeps full
// detail with meshopt + WebP. Both need the MeshoptDecoder, which the client wires (`setMeshoptDecoder`),
// so both load in-game; inspect either in a web glTF viewer (see the pipeline doc).
export const PRESET = {
  // combat: smallest possible runtime download — heavy decimation + meshopt geometry compression.
  combat: { simplifyRatio: 0.2, simplifyError: 0.04, textureSize: 256, compress: 'meshopt', textureCompress: false, instance: false },
  // hangar: keep detail; meshopt + WebP for the (larger) CloudFront download.
  hangar: { simplifyRatio: 1.0, simplifyError: 0.0, textureSize: 1024, compress: 'meshopt', textureCompress: 'webp', instance: true },
};

// Per-source preset overrides, keyed by the source base name (file minus .glb). Merged over PRESET[kind]
// in assets:build. Use when one model needs different treatment than the default — e.g. the player ship
// is a richly-TEXTURED model (not a flat low-poly pack), so its combat build KEEPS the textures but
// shrinks them hard (128px → WebP) for a ~370 KB textured combat model. See docs/plans/ship-model-pipeline.md.
export const PRESET_OVERRIDES = {
  player: {
    combat: { textureSize: 128, textureCompress: 'webp' }, // keep paint/decals but tiny; geometry meshopt (the default)
    hangar: { textureSize: 512 },                          // showcase detail, ~1.7 MB on CDN
  },
};
// Merge the base preset for `kind` with any override for this source base name.
export const presetFor = (base, kind) => ({ ...PRESET[kind], ...(PRESET_OVERRIDES[base]?.[kind]) });

// A run-on-S3 URL for a combat/hangar object. Combat is served same-origin (relative path); hangar via CDN.
export const combatPath = (file) => `assets/ships/${file}`;
export const hangarUrl = (file) => `${CDN}/${PREFIX.hangar}${file}`;
// SFX are tiny and latency-sensitive → served same-origin (relative path), like combat models.
export const soundPath = (file) => `assets/sounds/${file}`;
