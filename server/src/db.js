// Data layer: SQLite via the built-in node:sqlite module (no native dependencies).
// Stores players (anonymous, identified by a browser-generated id) and their game history.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB path is configurable via DB_PATH (tests use a temp file); defaults to data/game.db.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'game.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Schema is created/updated by the migration runner (see migrate.js + migrations/),
// run at server startup. This module only opens the database and exposes queries.
export const db = new DatabaseSync(dbPath);

// Apply schema migrations, then seed/refresh the catalog (idempotent upsert).
export async function migrate() {
  const { runMigrations } = await import('./migrate.js');
  await runMigrations(db);
  await seedCatalog();
}

// Upsert the ship/weapon catalog from the shared snapshot. Runs on every startup, so editing
// catalog_seed.js updates the rows (ids/foreign keys preserved — weapons keyed by id, ships by name).
async function seedCatalog() {
  const { SHIPS, WEAPONS } = await import('./catalog_seed.js');
  const upW = db.prepare(`INSERT INTO weapons (id, name, type, stats) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, stats = excluded.stats`);
  for (const w of WEAPONS) upW.run(w.id, w.name, w.type, JSON.stringify(w.stats));
  const upS = db.prepare(`INSERT INTO ships (name, type, stats, model_url) VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET type = excluded.type, stats = excluded.stats, model_url = excluded.model_url`);
  for (const s of SHIPS) upS.run(s.name, s.type, JSON.stringify(s.stats), s.modelUrl ?? null);
}

// Give a player their starter ship if they don't own one yet: the default 'player' ship,
// active, with an empty loadout (so it uses the ship's default weapons).
function ensureDefaultShip(playerId) {
  const has = db.prepare('SELECT 1 FROM player_ships WHERE player_id = ? LIMIT 1').get(playerId);
  if (has) return;
  const ship = db.prepare("SELECT id FROM ships WHERE type = 'player' ORDER BY id LIMIT 1").get();
  if (!ship) return; // catalog not seeded yet
  db.prepare('INSERT INTO player_ships (player_id, ship_id, is_active, loadout, created_at) VALUES (?, ?, 1, ?, ?)')
    .run(playerId, ship.id, '{}', Date.now());
}

// Auto-register: create the player if new, otherwise just bump last_seen. Either way they end
// up owning their default active ship.
export function registerPlayer(id) {
  const now = Date.now();
  const existing = db.prepare('SELECT created_at, games_played FROM players WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, id);
    ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: existing.games_played, createdAt: existing.created_at };
  }
  db.prepare('INSERT INTO players (id, created_at, last_seen) VALUES (?, ?, ?)').run(id, now, now);
  ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, createdAt: now };
}

// Record one finished game in the player's history.
export function recordGame(playerId, { score = 0, kills = 0, durationMs = 0 } = {}) {
  const now = Date.now();
  registerPlayer(playerId); // make sure the player exists
  const info = db.prepare(
    'INSERT INTO games (player_id, score, kills, duration_ms, ended_at) VALUES (?, ?, ?, ?, ?)'
  ).run(playerId, score | 0, kills | 0, durationMs | 0, now);
  db.prepare('UPDATE players SET games_played = games_played + 1, last_seen = ? WHERE id = ?').run(now, playerId);
  return { gameId: Number(info.lastInsertRowid) };
}

export function getPlayerGames(playerId, limit = 50) {
  // id is autoincrement, so DESC = newest first (deterministic even within the same ms).
  return db.prepare(
    'SELECT id, score, kills, duration_ms, ended_at FROM games WHERE player_id = ? ORDER BY id DESC LIMIT ?'
  ).all(playerId, limit);
}

export function stats() {
  return {
    players: db.prepare('SELECT COUNT(*) AS n FROM players').get().n,
    games: db.prepare('SELECT COUNT(*) AS n FROM games').get().n,
  };
}

// Catalog: ships (player + enemies) and weapons. stats is stored as JSON text -> parse on read.
export function getShips() {
  return db.prepare('SELECT id, name, type, stats, model_url FROM ships ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, stats: JSON.parse(r.stats), modelUrl: r.model_url }));
}

export function getWeapons() {
  return db.prepare('SELECT id, name, type, stats FROM weapons ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, stats: JSON.parse(r.stats) }));
}

// The player's active ship: the ship template + the effective loadout (explicit loadout falls
// back to the ship's default weapon ids). Registers the player (and their default ship) first.
export function getActivePlayerShip(playerId) {
  registerPlayer(playerId);
  const row = db.prepare(`
    SELECT ps.id AS player_ship_id, ps.loadout, s.id AS ship_id, s.name, s.type, s.stats, s.model_url
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = ? AND ps.is_active = 1 LIMIT 1`).get(playerId);
  if (!row) return null;
  const stats = JSON.parse(row.stats);
  const loadout = JSON.parse(row.loadout || '{}');
  return {
    playerShipId: row.player_ship_id,
    ship: { id: row.ship_id, name: row.name, type: row.type, stats, modelUrl: row.model_url },
    // effective loadout: an explicit loadout may override the mounts, else use the ship's defaults
    loadout: { mounts: loadout.mounts ?? stats.mounts ?? [] },
  };
}
