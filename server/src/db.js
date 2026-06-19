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

// Auto-register: create the player if new, otherwise just bump last_seen.
export function registerPlayer(id) {
  const now = Date.now();
  const existing = db.prepare('SELECT created_at, games_played FROM players WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, id);
    return { id, isNew: false, gamesPlayed: existing.games_played, createdAt: existing.created_at };
  }
  db.prepare('INSERT INTO players (id, created_at, last_seen) VALUES (?, ?, ?)').run(id, now, now);
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
