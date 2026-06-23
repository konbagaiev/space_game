// assets:check — drift-check / deploy guard: every PIPELINE model URL referenced in catalog_seed.js must
// exist on S3, else exit non-zero (no shipping ghost ships). Doubles as the CI deploy guard.
//
// In-git primitive paths (assets/ships/<ship>.glb, no content hash) are skipped — they live in the repo.
// Content-hashed combat paths (assets/ships/<...>.<hash>.glb) must exist under ships-combat/; CloudFront
// hangar URLs (modelUrlHigh) must exist under ships-hangar/. Because the bytes live on S3 and the
// content-hashed URLs live in git, they can't drift — a URL only resolves if that exact build was pushed.
// Run: `npm run assets:check`. See docs/plans/ship-model-pipeline.md.
import { execFileSync } from 'node:child_process';
import { BUCKET, awsArgs, PREFIX, CDN } from './assets-config.mjs';
import { SHIPS } from '../server/src/catalog_seed.js';

const HASHED = /\.[0-9a-f]{8}\.glb$/; // content-hashed filename → a pipeline (S3) model, not an in-git primitive

// → the S3 key a model URL should resolve to, or null if it's an in-git primitive (skip).
function s3KeyFor(url) {
  if (!url) return null;
  if (url.startsWith(CDN + '/')) return url.slice(CDN.length + 1);       // hangar: CloudFront URL → its key
  if (url.startsWith('assets/ships/') && HASHED.test(url)) {              // combat: content-hashed same-origin path
    return PREFIX.combat + url.slice('assets/ships/'.length);
  }
  return null; // in-git primitive (assets/ships/<ship>.glb) or unknown — not pipeline-managed
}

function existsOnS3(key) {
  try {
    execFileSync('aws', [...awsArgs(), 's3api', 'head-object', '--bucket', BUCKET, '--key', key],
      { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

const targets = [];
for (const s of SHIPS) {
  for (const [field, url] of [['modelUrl', s.modelUrl], ['modelUrlHigh', s.modelUrlHigh]]) {
    const key = s3KeyFor(url);
    if (key) targets.push({ ship: s.name, field, url, key });
  }
}

if (!targets.length) {
  console.log('assets:check — no pipeline-managed models in the seed (all in-git primitives). OK.');
  process.exit(0);
}

const missing = targets.filter((t) => !existsOnS3(t.key));
for (const t of targets) console.log(`  ${missing.includes(t) ? 'MISSING' : 'ok     '}  ${t.ship} ${t.field} → s3://${BUCKET}/${t.key}`);
if (missing.length) {
  console.error(`\nassets:check FAILED: ${missing.length} model(s) referenced in catalog_seed.js are not on S3. Run assets:push (or fix the URL).`);
  process.exit(1);
}
console.log(`\nassets:check OK — all ${targets.length} pipeline model(s) exist on S3.`);
