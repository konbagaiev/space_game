// 001 — initial schema: players and their game history.
// IF NOT EXISTS keeps it safe on databases created before migrations existed.
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id           TEXT PRIMARY KEY,   -- browser-generated UUID
      created_at   INTEGER NOT NULL,
      last_seen    INTEGER NOT NULL,
      games_played INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS games (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id   TEXT NOT NULL,
      score       INTEGER NOT NULL DEFAULT 0,
      kills       INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      ended_at    INTEGER NOT NULL,
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
    CREATE INDEX IF NOT EXISTS idx_games_player ON games(player_id);
  `);
};
