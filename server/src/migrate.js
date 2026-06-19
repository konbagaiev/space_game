// Minimal migration runner (no dependencies). Schema version is stored in SQLite's
// built-in PRAGMA user_version. Migrations live in ./migrations as NNN_name.js files,
// each exporting `up(db)`. The runner applies, in order, every migration whose numeric
// prefix is greater than the current user_version, each inside a transaction.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

export async function runMigrations(db) {
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter(f => /^\d+_.*\.js$/.test(f)).sort()
    : [];
  const current = db.prepare('PRAGMA user_version').get().user_version;
  let applied = 0;

  for (const file of files) {
    const version = parseInt(file, 10);
    if (version <= current) continue; // already applied
    const mod = await import(pathToFileURL(path.join(migrationsDir, file)).href);
    db.exec('BEGIN');
    try {
      mod.up(db);
      db.exec(`PRAGMA user_version = ${version}`); // version is a parsed integer (safe)
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${e.message}`);
    }
    console.log(`[migrate] applied ${file}`);
    applied++;
  }

  const finalVersion = db.prepare('PRAGMA user_version').get().user_version;
  console.log(`[migrate] schema at version ${finalVersion}${applied ? ` (${applied} new)` : ' (up to date)'}`);
  return finalVersion;
}

// CLI: `node src/migrate.js` applies migrations standalone (useful for deploys).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { db } = await import('./db.js');
  await runMigrations(db);
}
