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

// Build presets (tunable). Combat is aggressively decimated (the ship is tiny top-down) and uses NO
// geometry compression so it loads in a plain GLTFLoader AND previews in macOS Quick Look. The hangar
// model keeps detail + meshopt geometry compression (needs the MeshoptDecoder, wired in the client) — too
// big for Quick Look, inspect it in a web glTF viewer (see the pipeline doc).
export const PRESET = {
  // combat: plain glb (no geometry compression, no GPU-instancing extension, textures kept in their
  // original format) so macOS Quick Look shows it; size comes from decimation + small textures.
  combat: { simplifyRatio: 0.2, simplifyError: 0.04, textureSize: 256, compress: false, textureCompress: false, instance: false },
  // hangar: optimize hard for download size (meshopt + WebP); inspect in a web glTF viewer, not Quick Look.
  hangar: { simplifyRatio: 1.0, simplifyError: 0.0, textureSize: 1024, compress: 'meshopt', textureCompress: 'webp', instance: true },
};

// Per-source preset overrides, keyed by the source base name (file minus .glb). Merged over PRESET[kind]
// in assets:build. Use when one model needs different treatment than the default — e.g. the player ship
// is a richly-TEXTURED model (not a flat low-poly pack), so its combat build KEEPS the textures but
// shrinks them hard (128px) and meshopt-compresses the geometry (the combat loader has MeshoptDecoder
// wired). That trades the macOS Quick Look preview (meshopt isn't QL-readable) for a ~370 KB textured
// combat model — worth it here. See docs/plans/ship-model-pipeline.md.
export const PRESET_OVERRIDES = {
  player: {
    combat: { textureSize: 128, compress: 'meshopt', textureCompress: 'webp' }, // keep paint/decals, ~370 KB
    hangar: { textureSize: 512 },                                               // showcase detail, ~1.7 MB on CDN
  },
};
// Merge the base preset for `kind` with any override for this source base name.
export const presetFor = (base, kind) => ({ ...PRESET[kind], ...(PRESET_OVERRIDES[base]?.[kind]) });

// A run-on-S3 URL for a combat/hangar object. Combat is served same-origin (relative path); hangar via CDN.
export const combatPath = (file) => `assets/ships/${file}`;
export const hangarUrl = (file) => `${CDN}/${PREFIX.hangar}${file}`;
// SFX are tiny and latency-sensitive → served same-origin (relative path), like combat models.
export const soundPath = (file) => `assets/sounds/${file}`;
