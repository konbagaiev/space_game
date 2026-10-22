// CLI: reset player progress. Talks to PostgreSQL via datastore.js (DATABASE_URL, or a local
// Postgres default). The schema is migrated first so it works against a fresh database too.
// Invoked via the `reset-progress` skill, or directly:
//
//   node src/reset.js --player <id>     reset ONE player's progress (account + login kept)
//   node src/reset.js --all --yes       wipe ALL players (fresh DB; catalog kept/re-seeded)
//   node src/reset.js --all --yes --no-s3   same, WITHOUT touching S3 (local dev DB; traces orphaned)
//
// --all is destructive and refuses to run without --yes. It also deletes every gameplay_sessions row's
// S3 trace object BEFORE truncating, and truncates nothing if any delete fails (exit 1; re-running is
// safe). With no S3 creds in the env it REFUSES (exit 1, nothing touched) unless --no-s3 is given — a
// production --all runs inside the app container, which has the creds. See resetAllPlayers (db.js).
import { migrate, resetPlayer, resetAllPlayers, backend } from './datastore.js';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error('usage:\n  node src/reset.js --player <id>\n  node src/reset.js --all --yes [--no-s3]');
  process.exit(message ? 1 : 0);
}

await migrate(); // bring the schema up to date (and seed the catalog ensureDefaultShip relies on)

if (has('--player')) {
  const id = valueOf('--player');
  if (!id) usage('--player needs a player id');
  const { found } = await resetPlayer(id);
  if (!found) { console.error(`error: no such player: ${id}`); process.exit(1); }
  console.log(`[${backend}] reset player ${id}: progress, ships, stash and events cleared; account & login kept.`);
} else if (has('--all')) {
  if (!has('--yes')) usage('--all wipes EVERY player — re-run with --yes to confirm');
  const skipS3 = has('--no-s3');
  if (skipS3) {
    console.warn('WARNING: --no-s3 — S3 is NOT touched. Every session trace object in S3 that belongs to this '
      + 'database stays behind, ORPHANED (no row will point at it again). Use this only on a local dev database.');
  }
  const r = await resetAllPlayers({ skipS3 });
  if (r.refused) {
    console.error('error: refusing --all — S3 is not configured (no AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY), so the '
      + 'session traces in S3 could not be deleted. Nothing was deleted or truncated.\n'
      + '  - production: run it inside the app container, where the server .env supplies the AWS creds;\n'
      + '  - a LOCAL dev database: re-run with --no-s3 to truncate without touching S3.');
    process.exit(1);
  }
  if (!r.ok) {
    console.error(`error: ${r.failed.length} session trace(s) could not be deleted from S3 (${r.deleted} deleted). First keys:`);
    for (const k of r.failed.slice(0, 10)) console.error(`  ${k}`);
    console.error('Nothing truncated — fix S3 access (s3:DeleteObject on recordings/sessions/*) and re-run (deletes are idempotent).');
    process.exit(1);
  }
  const s3note = r.skippedS3 ? `S3 NOT touched (--no-s3) — ${r.keys} session trace(s) orphaned` : `deleted ${r.deleted} session trace(s) from S3`;
  console.log(`[${backend}] reset ALL players: every account and session recording wiped; ${s3note}; catalog kept (re-seeded on next start).`);
} else {
  usage();
}

process.exit(0); // close the Postgres pool and exit cleanly
