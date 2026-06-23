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
};

// Local working dirs — ALL gitignored (no binaries in git). Drop sources in `src`, build into `dist`;
// `combatServe` is where the server serves combat glbs from (pulled there in CI / by `assets:pull`).
export const DIR = {
  src: 'assets-src',
  dist: 'assets-dist',
  combatServe: 'client/assets/ships',
};

// Build presets (tunable). Combat is aggressively decimated (the ship is tiny top-down); hangar keeps detail.
export const PRESET = {
  combat: { simplifyRatio: 0.2, simplifyError: 0.02, textureSize: 256, compress: 'meshopt' },
  hangar: { simplifyRatio: 1.0, simplifyError: 0.0, textureSize: 1024, compress: 'meshopt' },
};

// A run-on-S3 URL for a combat/hangar object. Combat is served same-origin (relative path); hangar via CDN.
export const combatPath = (file) => `assets/ships/${file}`;
export const hangarUrl = (file) => `${CDN}/${PREFIX.hangar}${file}`;
