// assets:check — drift-check / deploy guard: every PIPELINE asset URL referenced in the codebase must
// exist on S3, else exit non-zero (no shipping ghost ships / silent SFX). Doubles as the CI deploy guard.
// Covers two lanes:
//  - Ship models in catalog_seed.js — content-hashed combat paths (assets/ships/<...>.<hash>.glb) under
//    ships-combat/; CloudFront hangar URLs (modelUrlHigh) under ships-hangar/. In-git primitive paths
//    (assets/ships/<ship>.glb, no hash) are skipped — they live in the repo.
//  - SFX in catalog_seed.js SOUNDS — content-hashed same-origin paths (assets/sounds/<name>.<hash>.mp3)
//    under sfx/.
// Because the bytes live on S3 and the content-hashed URLs live in git, they can't drift — a URL only
// resolves if that exact build was pushed. Run: `npm run assets:check`. See docs/plans/ship-model-pipeline.md
// and docs/plans/audio-sample-pipeline.md.
import { execFileSync } from 'node:child_process';
import { BUCKET, awsArgs, PREFIX, CDN } from './assets-config.mjs';
import { SHIPS, SOUNDS, COMPONENTS, WEAPONS } from '../server/src/catalog_seed.js';
import { DROP_MODEL_URL } from '../client/src/drops-config.js'; // shared loot-drop model (single source of truth)

const HASHED_GLB = /\.[0-9a-f]{8}\.glb$/; // content-hashed → a pipeline (S3) model, not an in-git primitive
const HASHED_MP3 = /\.[0-9a-f]{8}\.mp3$/; // content-hashed SFX → must be on S3

// → the S3 key a model URL should resolve to, or null if it's an in-git primitive (skip).
function modelKey(url) {
  if (!url) return null;
  if (url.startsWith(CDN + '/')) return url.slice(CDN.length + 1);       // hangar: CloudFront URL → its key
  if (url.startsWith('assets/ships/') && HASHED_GLB.test(url)) {          // combat: content-hashed same-origin path
    return PREFIX.combat + url.slice('assets/ships/'.length);
  }
  return null; // in-git primitive (assets/ships/<ship>.glb) or unknown — not pipeline-managed
}
// → the S3 key a sfx URL should resolve to, or null if not a content-hashed sound.
function soundKey(url) {
  if (url && url.startsWith('assets/sounds/') && HASHED_MP3.test(url)) {
    return PREFIX.sounds + url.slice('assets/sounds/'.length);
  }
  return null;
}

function existsOnS3(key) {
  try {
    execFileSync('aws', [...awsArgs(), 's3api', 'head-object', '--bucket', BUCKET, '--key', key],
      { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

const targets = [];
// Ships AND items (components/weapons) carry the same model URL shape; an item only wires modelUrlHigh
// (menu-only icon), but check both fields the same way a ship does.
for (const [label, rows] of [['', SHIPS], ['component:', COMPONENTS], ['weapon:', WEAPONS]]) {
  for (const s of rows) {
    for (const [field, url] of [['modelUrl', s.modelUrl], ['modelUrlHigh', s.modelUrlHigh]]) {
      const key = modelKey(url);
      if (key) targets.push({ name: `${label}${s.name}`, field, url, key });
    }
  }
}
for (const s of SOUNDS) {
  const key = soundKey(s.url);
  if (key) targets.push({ name: `sfx:${s.key}`, field: 'url', url: s.url, key });
}
// Shared equipment-drop model (client renders it from DROP_MODEL_URL; there is no modelUrl-on-component copy).
{ const key = modelKey(DROP_MODEL_URL); if (key) targets.push({ name: 'drop:metal_box', field: 'DROP_MODEL_URL', url: DROP_MODEL_URL, key }); }

if (!targets.length) {
  console.log('assets:check — no pipeline-managed assets referenced (all in-git primitives). OK.');
  process.exit(0);
}

const missing = targets.filter((t) => !existsOnS3(t.key));
for (const t of targets) console.log(`  ${missing.includes(t) ? 'MISSING' : 'ok     '}  ${t.name} ${t.field} → s3://${BUCKET}/${t.key}`);
if (missing.length) {
  console.error(`\nassets:check FAILED: ${missing.length} asset(s) referenced in code are not on S3. Run assets:push (or fix the URL).`);
  process.exit(1);
}
console.log(`\nassets:check OK — all ${targets.length} pipeline asset(s) exist on S3.`);
