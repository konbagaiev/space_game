// assets:push — upload built models + sounds + their sources to S3 (canonical store; no binaries in git).
//   assets-dist/<ship>_combat.<hash>.glb → s3://<bucket>/ships-combat/   (served same-origin)
//   assets-dist/<ship>_hangar.<hash>.glb → s3://<bucket>/ships-hangar/   (served via CloudFront)
//   assets-dist/sounds/<name>.<hash>.mp3 → s3://<bucket>/sfx/            (served same-origin)
//   assets-src/<ship>.glb                → s3://<bucket>/source/         (off-machine backup)
//   assets-src/sounds/<file>             → s3://<bucket>/source/         (off-machine backup)
// Content-hashed filenames + long cache headers → caches forever, new asset = new URL, no invalidation.
// Uses the local AWS profile (the `default` / claude_admin profile by default). Run: `npm run assets:push`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BUCKET, awsArgs, PREFIX, DIR } from './assets-config.mjs';

const aws = (args) => execFileSync('aws', [...awsArgs(), ...args], { stdio: 'inherit' });
const cache = (contentType) =>
  ['--cache-control', 'public, max-age=31536000, immutable', '--content-type', contentType];

// content-type by extension for source backups (a mixed bag of glb / wav / mp3 / ...).
const MIME = { '.glb': 'model/gltf-binary', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

// Upload every file in localDir matching `predicate` to s3://bucket/prefix. contentType is either a
// fixed string (built artifacts share one) or a function f→string (sources are a mixed bag).
function cp(localDir, predicate, prefix, contentType) {
  if (!fs.existsSync(localDir)) return 0;
  const files = fs.readdirSync(localDir).filter(predicate);
  for (const f of files) {
    const ct = typeof contentType === 'function' ? contentType(f) : contentType;
    console.log(`[push] ${f} → s3://${BUCKET}/${prefix}`);
    aws(['s3', 'cp', path.join(localDir, f), `s3://${BUCKET}/${prefix}${f}`, ...cache(ct)]);
  }
  return files.length;
}

const soundsDist = path.join(DIR.dist, 'sounds');
const soundsSrc = path.join(DIR.src, 'sounds');

const combat = cp(DIR.dist, (f) => /_combat\.[0-9a-f]{8}\.glb$/.test(f), PREFIX.combat, MIME['.glb']);
const hangar = cp(DIR.dist, (f) => /_hangar\.[0-9a-f]{8}\.glb$/.test(f), PREFIX.hangar, MIME['.glb']);
const sounds = cp(soundsDist, (f) => /\.[0-9a-f]{8}\.mp3$/.test(f), PREFIX.sounds, MIME['.mp3']);
// Sources (off-machine backups): glb models + every sound source file (wav/mp3/ogg/...).
const srcGlb = cp(DIR.src, (f) => f.toLowerCase().endsWith('.glb'), PREFIX.source, mimeOf);
const srcSnd = cp(soundsSrc, (f) => !f.startsWith('.'), PREFIX.source, mimeOf);

console.log(`\nUploaded ${combat} combat + ${hangar} hangar + ${sounds} sound mp3(s) + ${srcGlb + srcSnd} source file(s).`);
console.log('Now paste the URLs into catalog_seed.js / client/src/sfx_manifest.js (printed by the build) and commit (no binaries).');
