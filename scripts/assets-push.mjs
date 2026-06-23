// assets:push — upload built models + their high-poly sources to S3 (canonical store; no binaries in git).
//   assets-dist/<ship>_combat.<hash>.glb → s3://<bucket>/ships-combat/
//   assets-dist/<ship>_hangar.<hash>.glb → s3://<bucket>/ships-hangar/   (served via CloudFront)
//   assets-src/<ship>.glb                → s3://<bucket>/source/         (off-machine backup)
// Content-hashed filenames + long cache headers → caches forever, new model = new URL, no invalidation.
// Uses the local AWS profile (claude_admin by default). Run: `npm run assets:push`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BUCKET, awsArgs, PREFIX, DIR } from './assets-config.mjs';

const aws = (args) => execFileSync('aws', [...awsArgs(), ...args], { stdio: 'inherit' });
const CACHE = ['--cache-control', 'public, max-age=31536000, immutable', '--content-type', 'model/gltf-binary'];

function cp(localDir, predicate, prefix) {
  if (!fs.existsSync(localDir)) return 0;
  const files = fs.readdirSync(localDir).filter(predicate);
  for (const f of files) {
    console.log(`[push] ${f} → s3://${BUCKET}/${prefix}`);
    aws(['s3', 'cp', path.join(localDir, f), `s3://${BUCKET}/${prefix}${f}`, ...CACHE]);
  }
  return files.length;
}

const combat = cp(DIR.dist, (f) => /_combat\.[0-9a-f]{8}\.glb$/.test(f), PREFIX.combat);
const hangar = cp(DIR.dist, (f) => /_hangar\.[0-9a-f]{8}\.glb$/.test(f), PREFIX.hangar);
const source = cp(DIR.src, (f) => f.toLowerCase().endsWith('.glb'), PREFIX.source);
console.log(`\nUploaded ${combat} combat + ${hangar} hangar + ${source} source file(s).`);
console.log('Now paste the URLs into catalog_seed.js (printed by assets:build) and commit it (no binaries).');
