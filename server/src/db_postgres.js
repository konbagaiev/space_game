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

    CREATE TABLE IF NOT EXISTS ships (
      id        BIGSERIAL PRIMARY KEY,
      name      TEXT  NOT NULL UNIQUE,
      type      TEXT  NOT NULL,   -- 'player' | 'enemy'
      stats     JSONB NOT NULL,   -- hull/engine/thrusters, weapon refs, color, sizeScale, ...
      model_url TEXT              -- 3D model link (nullable; primitive if null)
    );
    CREATE TABLE IF NOT EXISTS weapons (
      id    BIGINT PRIMARY KEY,   -- stable explicit ids (referenced from ships/loadout)
      name  TEXT  NOT NULL UNIQUE,
      type  TEXT  NOT NULL,       -- 'bullet' | 'rocket'
      stats JSONB NOT NULL        -- damage/speed/cooldown/...
    );
    CREATE TABLE IF NOT EXISTS player_ships (
      id         BIGSERIAL PRIMARY KEY,
      player_id  TEXT    NOT NULL REFERENCES players(id),
      ship_id    BIGINT  NOT NULL REFERENCES ships(id),
      is_active  BOOLEAN NOT NULL DEFAULT false,
      loadout    JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- weapon ids by slot ({} = ship defaults)
      meta       JSONB,                                 -- future data/overrides
      created_at BIGINT  NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_player_ships_player ON player_ships(player_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_player_active_ship ON player_ships(player_id) WHERE is_active;
  `);

  // Seed the catalog from the shared snapshot if the tables are empty (idempotent).
  const { SHIPS, WEAPONS } = await import('./catalog_seed.js');
  const wc = await pool.query('SELECT COUNT(*)::int AS n FROM weapons');
  if (wc.rows[0].n === 0) {
    for (const w of WEAPONS) {
      await pool.query(
        'INSERT INTO weapons (id, name, type, stats) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (id) DO NOTHING',
        [w.id, w.name, w.type, JSON.stringify(w.stats)]);
    }
  }
  const sc = await pool.query('SELECT COUNT(*)::int AS n FROM ships');
  if (sc.rows[0].n === 0) {
    for (const s of SHIPS) {
      await pool.query(
        'INSERT INTO ships (name, type, stats, model_url) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (name) DO NOTHING',
        [s.name, s.type, JSON.stringify(s.stats), s.modelUrl ?? null]);
    }
  }
  console.log('[migrate] postgres schema ready');
}

// Give a player their starter ship if they don't own one yet (default 'player' ship, active).
async function ensureDefaultShip(playerId) {
  const has = await pool.query('SELECT 1 FROM player_ships WHERE player_id = $1 LIMIT 1', [playerId]);
  if (has.rows[0]) return;
  const ship = await pool.query("SELECT id FROM ships WHERE type = 'player' ORDER BY id LIMIT 1");
  if (!ship.rows[0]) return;
  await pool.query(
    'INSERT INTO player_ships (player_id, ship_id, is_active, loadout, created_at) VALUES ($1, $2, true, $3::jsonb, $4)',
    [playerId, ship.rows[0].id, '{}', Date.now()]);
}

export async function registerPlayer(id) {
  const now = Date.now();
  const { rows } = await pool.query('SELECT created_at, games_played FROM players WHERE id = $1', [id]);
  if (rows[0]) {
    await pool.query('UPDATE players SET last_seen = $1 WHERE id = $2', [now, id]);
    await ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: rows[0].games_played, createdAt: Number(rows[0].created_at) };
  }
  await pool.query('INSERT INTO players (id, created_at, last_seen) VALUES ($1, $2, $3)', [id, now, now]);
  await ensureDefaultShip(id);
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

// Catalog: ships (player + enemies) and weapons. stats is JSONB -> pg returns it already parsed.
export async function getShips() {
  const { rows } = await pool.query('SELECT id, name, type, stats, model_url FROM ships ORDER BY id');
  return rows.map((r) => ({ id: Number(r.id), name: r.name, type: r.type, stats: r.stats, modelUrl: r.model_url }));
}

export async function getWeapons() {
  const { rows } = await pool.query('SELECT id, name, type, stats FROM weapons ORDER BY id');
  return rows.map((r) => ({ id: Number(r.id), name: r.name, type: r.type, stats: r.stats }));
}

// The player's active ship: ship template + effective loadout (loadout falls back to ship defaults).
export async function getActivePlayerShip(playerId) {
  await registerPlayer(playerId);
  const { rows } = await pool.query(`
    SELECT ps.id AS player_ship_id, ps.loadout, s.id AS ship_id, s.name, s.type, s.stats, s.model_url
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = $1 AND ps.is_active LIMIT 1`, [playerId]);
  const row = rows[0];
  if (!row) return null;
  const stats = row.stats, loadout = row.loadout || {};
  return {
    playerShipId: Number(row.player_ship_id),
    ship: { id: Number(row.ship_id), name: row.name, type: row.type, stats, modelUrl: row.model_url },
    loadout: {
      weapon: loadout.weapon ?? stats.weapon ?? null,
      secondary: loadout.secondary ?? stats.secondary ?? null,
    },
  };
}
