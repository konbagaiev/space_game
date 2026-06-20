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
  const { SHIPS, WEAPONS, MAPS, LEVELS, COMPONENTS } = await import('./catalog_seed.js');
  const upC = db.prepare(`INSERT INTO components (id, name, type, weight, stats) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, weight = excluded.weight, stats = excluded.stats`);
  for (const c of COMPONENTS) upC.run(c.id, c.name, c.type, c.weight, JSON.stringify(c.stats));
  const upW = db.prepare(`INSERT INTO weapons (id, name, type, stats) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, stats = excluded.stats`);
  for (const w of WEAPONS) upW.run(w.id, w.name, w.type, JSON.stringify(w.stats));
  const upS = db.prepare(`INSERT INTO ships (name, type, stats, model_url, components) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET type = excluded.type, stats = excluded.stats, model_url = excluded.model_url, components = excluded.components`);
  for (const s of SHIPS) upS.run(s.name, s.type, JSON.stringify(s.stats), s.modelUrl ?? null, JSON.stringify(s.components));
  const upM = db.prepare(`INSERT INTO maps (name, descriptor) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET descriptor = excluded.descriptor`);
  for (const m of MAPS) upM.run(m.name, JSON.stringify(m.descriptor));
  const upL = db.prepare(`INSERT INTO levels (name, descriptor) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET descriptor = excluded.descriptor`);
  for (const l of LEVELS) upL.run(l.name, JSON.stringify(l.descriptor));
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
  const existing = db.prepare('SELECT created_at, games_played, current_progress FROM players WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, id);
    ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: existing.games_played, currentProgress: existing.current_progress, createdAt: existing.created_at };
  }
  db.prepare('INSERT INTO players (id, created_at, last_seen) VALUES (?, ?, ?)').run(id, now, now);
  ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, currentProgress: 1, createdAt: now };
}

// The level a player is currently on (their highest unlocked level). Joins the
// player's current_progress FK to the levels table; null if the player/level is gone.
export function getCurrentLevel(playerId) {
  registerPlayer(playerId); // make sure the player exists (new players default to level-1)
  const row = db.prepare(
    'SELECT l.name, l.descriptor FROM players p JOIN levels l ON l.id = p.current_progress WHERE p.id = ?'
  ).get(playerId);
  if (!row) return null;
  return { name: row.name, descriptor: JSON.parse(row.descriptor) };
}

// Unlock the next level after the player's current one (smallest level id greater than
// the current). No-op (already at the last level) returns advanced:false.
export function advanceProgress(playerId) {
  registerPlayer(playerId);
  const p = db.prepare('SELECT current_progress FROM players WHERE id = ?').get(playerId);
  const next = db.prepare('SELECT MIN(id) AS id FROM levels WHERE id > ?').get(p.current_progress);
  if (next && next.id != null) {
    db.prepare('UPDATE players SET current_progress = ? WHERE id = ?').run(next.id, playerId);
    return { currentProgress: next.id, advanced: true };
  }
  return { currentProgress: p.current_progress, advanced: false };
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

// Catalog: ships (player + enemies), weapons, components. JSON columns parsed on read.
export function getShips() {
  return db.prepare('SELECT id, name, type, stats, model_url, components FROM ships ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, stats: JSON.parse(r.stats), modelUrl: r.model_url,
      components: r.components ? JSON.parse(r.components) : null }));
}

export function getWeapons() {
  return db.prepare('SELECT id, name, type, stats FROM weapons ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, stats: JSON.parse(r.stats) }));
}

export function getComponents() {
  return db.prepare('SELECT id, name, type, weight, stats FROM components ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, weight: r.weight, stats: JSON.parse(r.stats) }));
}

// A map's scene descriptor (the client renders it via buildMap).
export function getMap(name) {
  const row = db.prepare('SELECT name, descriptor FROM maps WHERE name = ?').get(name);
  return row ? { name: row.name, descriptor: JSON.parse(row.descriptor) } : null;
}

// A level's descriptor (map + phase/wave script; the client's level runner plays it).
export function getLevel(name) {
  const row = db.prepare('SELECT name, descriptor FROM levels WHERE name = ?').get(name);
  return row ? { name: row.name, descriptor: JSON.parse(row.descriptor) } : null;
}

// The player's active ship: the ship template + the effective loadout (explicit loadout falls
// back to the ship's default weapon ids). Registers the player (and their default ship) first.
export function getActivePlayerShip(playerId) {
  registerPlayer(playerId);
  const row = db.prepare(`
    SELECT ps.id AS player_ship_id, ps.loadout, ps.components AS ps_components,
           s.id AS ship_id, s.name, s.type, s.stats, s.model_url, s.components AS ship_components
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = ? AND ps.is_active = 1 LIMIT 1`).get(playerId);
  if (!row) return null;
  const stats = JSON.parse(row.stats);
  const loadout = JSON.parse(row.loadout || '{}');
  const shipComponents = row.ship_components ? JSON.parse(row.ship_components) : null;
  const psComponents = row.ps_components ? JSON.parse(row.ps_components) : null;
  return {
    playerShipId: row.player_ship_id,
    ship: { id: row.ship_id, name: row.name, type: row.type, stats, modelUrl: row.model_url, components: shipComponents },
    // effective loadout/components: a player override falls back to the ship's defaults
    loadout: { mounts: loadout.mounts ?? stats.mounts ?? [] },
    components: psComponents ?? shipComponents,
  };
}
