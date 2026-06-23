// assets:pull — sync the combat (low-poly) models from S3 into the server's same-origin asset dir
// (client/assets/ships/). For LOCAL dev (get the content-hashed models referenced by the seed) and the
// model the CI deploy uses (CI runs the same sync before `docker build`, baking them into the image so
// runtime has no S3/CORS dependency). The in-git primitive glbs are untouched (only hashed files sync in).
// Uses the AWS profile from env (claude_admin locally; a scoped read-only key in CI). Run: `npm run assets:pull`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { BUCKET, awsArgs, PREFIX, DIR } from './assets-config.mjs';

fs.mkdirSync(DIR.combatServe, { recursive: true });
// content-hashed names → only new models download; existing files (incl. the in-git primitives) stay
// (no --delete). Empty prefix ⇒ a clean no-op.
const args = ['s3', 'sync', `s3://${BUCKET}/${PREFIX.combat}`, DIR.combatServe, '--exclude', '*', '--include', '*.glb'];
console.log(`[pull] s3://${BUCKET}/${PREFIX.combat} → ${DIR.combatServe}`);
execFileSync('aws', [...awsArgs(), ...args], { stdio: 'inherit' });
console.log('Done. Combat models are in place (same-origin).');
