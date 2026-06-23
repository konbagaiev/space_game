// assets:pull — sync the same-origin assets from S3 into the server's serve dirs: combat (low-poly)
// models into client/assets/ships/, and SFX mp3s into client/assets/sounds/. For LOCAL dev (get the
// content-hashed assets referenced by the seed / sfx manifest) and the deploy the CI uses (CI runs the
// same sync before `docker build`, baking them into the image so runtime has no S3/CORS dependency). The
// in-git primitive glbs are untouched (only hashed files sync in).
// Uses the AWS profile from env (the default/claude_admin profile locally; a scoped read-only key in CI).
// Run: `npm run assets:pull`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { BUCKET, awsArgs, PREFIX, DIR } from './assets-config.mjs';

const aws = (args) => execFileSync('aws', [...awsArgs(), ...args], { stdio: 'inherit' });

// content-hashed names → only new files download; existing files (incl. the in-git primitives) stay
// (no --delete). Empty prefix ⇒ a clean no-op.
function pull(prefix, dest, ext) {
  fs.mkdirSync(dest, { recursive: true });
  console.log(`[pull] s3://${BUCKET}/${prefix} → ${dest}`);
  aws(['s3', 'sync', `s3://${BUCKET}/${prefix}`, dest, '--exclude', '*', '--include', `*.${ext}`]);
}

pull(PREFIX.combat, DIR.combatServe, 'glb');   // combat models → client/assets/ships/
pull(PREFIX.sounds, DIR.soundsServe, 'mp3');    // SFX mp3s → client/assets/sounds/
console.log('Done. Combat models + SFX are in place (same-origin).');
