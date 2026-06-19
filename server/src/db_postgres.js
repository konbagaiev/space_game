// PostgreSQL data layer (used in production when DATABASE_URL is set).
// Same API as the SQLite layer (db.js), but async. Connects to the shared Postgres.
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Idempotent schema bootstrap. (Versioned PG migrations are a TODO; for now this safely
// creates the schema on first run. The SQLite path keeps its versioned runner.)
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id           TEXT PRIMARY KEY,
      created_at   BIGINT  NOT NULL,
      last_seen    BIGINT  NOT NULL,
      games_played INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS games (
      id          BIGSERIAL PRIMARY KEY,
      player_id   TEXT    NOT NULL REFERENCES players(id),
      score       INTEGER NOT NULL DEFAULT 0,
      kills       INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      ended_at    BIGINT  NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_games_player ON games(player_id);
  `);
  console.log('[migrate] postgres schema ready');
}

export async function registerPlayer(id) {
  const now = Date.now();
  const { rows } = await pool.query('SELECT created_at, games_played FROM players WHERE id = $1', [id]);
  if (rows[0]) {
    await pool.query('UPDATE players SET last_seen = $1 WHERE id = $2', [now, id]);
    return { id, isNew: false, gamesPlayed: rows[0].games_played, createdAt: Number(rows[0].created_at) };
  }
  await pool.query('INSERT INTO players (id, created_at, last_seen) VALUES ($1, $2, $3)', [id, now, now]);
  return { id, isNew: true, gamesPlayed: 0, createdAt: now };
}

export async function recordGame(playerId, { score = 0, kills = 0, durationMs = 0 } = {}) {
  const now = Date.now();
  await registerPlayer(playerId); // make sure the player exists
  const { rows } = await pool.query(
    'INSERT INTO games (player_id, score, kills, duration_ms, ended_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [playerId, score | 0, kills | 0, durationMs | 0, now]
  );
  await pool.query('UPDATE players SET games_played = games_played + 1, last_seen = $1 WHERE id = $2', [now, playerId]);
  return { gameId: Number(rows[0].id) };
}

export async function getPlayerGames(playerId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT id, score, kills, duration_ms, ended_at FROM games WHERE player_id = $1 ORDER BY id DESC LIMIT $2',
    [playerId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id), score: r.score, kills: r.kills,
    duration_ms: r.duration_ms, ended_at: Number(r.ended_at),
  }));
}

export async function stats() {
  const p = await pool.query('SELECT COUNT(*)::int AS n FROM players');
  const g = await pool.query('SELECT COUNT(*)::int AS n FROM games');
  return { players: p.rows[0].n, games: g.rows[0].n };
}
