// CLI: reset player progress. Talks to PostgreSQL via datastore.js (DATABASE_URL, or a local
// Postgres default). The schema is migrated first so it works against a fresh database too.
// Invoked via the `reset-progress` skill, or directly:
//
//   node src/reset.js --player <id>     reset ONE player's progress (account + login kept)
//   node src/reset.js --all --yes       wipe ALL players (fresh DB; catalog kept/re-seeded)
//
// --all is destructive and refuses to run without --yes.
import { migrate, resetPlayer, resetAllPlayers, backend } from './datastore.js';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error('usage:\n  node src/reset.js --player <id>\n  node src/reset.js --all --yes');
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
  await resetAllPlayers();
  console.log(`[${backend}] reset ALL players: every account wiped; catalog kept (re-seeded on next start).`);
} else {
  usage();
}

process.exit(0); // close the Postgres pool and exit cleanly
