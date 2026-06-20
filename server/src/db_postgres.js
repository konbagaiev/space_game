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

    CREATE TABLE IF NOT EXISTS components (
      id     BIGINT  PRIMARY KEY,  -- stable explicit ids (referenced from ships/player_ships)
      name   TEXT    NOT NULL UNIQUE,
      type   TEXT    NOT NULL,     -- 'hull' | 'engine'
      weight INTEGER NOT NULL,     -- contributes to ship mass
      stats  JSONB   NOT NULL      -- hull {durability,volume} / engine {power,turnPower,maxSpeed,exhaust}
    );
    CREATE TABLE IF NOT EXISTS ships (
      id         BIGSERIAL PRIMARY KEY,
      name       TEXT  NOT NULL UNIQUE,
      type       TEXT  NOT NULL,   -- 'player' | 'enemy'
      stats      JSONB NOT NULL,   -- role/color/sizeScale, groups + mounts (weapons by id)
      model_url  TEXT,             -- 3D model link (nullable; primitive if null)
      components JSONB             -- { hull: <id>, engine: <id> }
    );
    ALTER TABLE ships ADD COLUMN IF NOT EXISTS components JSONB;
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
      loadout    JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- may override mounts ({} = ship defaults)
      meta       JSONB,                                 -- future data/overrides
      components JSONB,                                 -- override the ship's components (null = ship defaults)
      created_at BIGINT  NOT NULL
    );
    ALTER TABLE player_ships ADD COLUMN IF NOT EXISTS components JSONB;
    CREATE INDEX IF NOT EXISTS idx_player_ships_player ON player_ships(player_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_player_active_ship ON player_ships(player_id) WHERE is_active;

    CREATE TABLE IF NOT EXISTS maps (
      id         BIGSERIAL PRIMARY KEY,
      name       TEXT  NOT NULL UNIQUE,
      descriptor JSONB NOT NULL   -- { generator, ...params } describing the scene
    );
    CREATE TABLE IF NOT EXISTS levels (
      id         BIGSERIAL PRIMARY KEY,
      name       TEXT  NOT NULL UNIQUE,
      descriptor JSONB NOT NULL   -- { title, map, phases:[...] }
    );
    -- player progress: the currently-available level (FK into levels). Added after the
    -- levels table exists; defaults to 1 (level-1). On an existing DB the levels rows
    -- already exist from prior startups, so the FK default validates.
    ALTER TABLE players ADD COLUMN IF NOT EXISTS current_progress INTEGER NOT NULL DEFAULT 1 REFERENCES levels(id);
  `);

  // Upsert the catalog from the shared snapshot on every startup, so editing catalog_seed.js
  // propagates on deploy (ids/foreign keys preserved — weapons keyed by id, ships/maps/levels by name).
  const { SHIPS, WEAPONS, MAPS, LEVELS, COMPONENTS } = await import('./catalog_seed.js');
  for (const c of COMPONENTS) {
    await pool.query(
      `INSERT INTO components (id, name, type, weight, stats) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, weight = EXCLUDED.weight, stats = EXCLUDED.stats`,
      [c.id, c.name, c.type, c.weight, JSON.stringify(c.stats)]);
  }
  for (const w of WEAPONS) {
    await pool.query(
      `INSERT INTO weapons (id, name, type, stats) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, stats = EXCLUDED.stats`,
      [w.id, w.name, w.type, JSON.stringify(w.stats)]);
  }
  for (const s of SHIPS) {
    await pool.query(
      `INSERT INTO ships (name, type, stats, model_url, components) VALUES ($1, $2, $3::jsonb, $4, $5::jsonb)
       ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, stats = EXCLUDED.stats, model_url = EXCLUDED.model_url, components = EXCLUDED.components`,
      [s.name, s.type, JSON.stringify(s.stats), s.modelUrl ?? null, JSON.stringify(s.components)]);
  }
  for (const m of MAPS) {
    await pool.query(
      `INSERT INTO maps (name, descriptor) VALUES ($1, $2::jsonb)
       ON CONFLICT (name) DO UPDATE SET descriptor = EXCLUDED.descriptor`,
      [m.name, JSON.stringify(m.descriptor)]);
  }
  for (const l of LEVELS) {
    await pool.query(
      `INSERT INTO levels (name, descriptor) VALUES ($1, $2::jsonb)
       ON CONFLICT (name) DO UPDATE SET descriptor = EXCLUDED.descriptor`,
      [l.name, JSON.stringify(l.descriptor)]);
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
  const { rows } = await pool.query('SELECT created_at, games_played, current_progress FROM players WHERE id = $1', [id]);
  if (rows[0]) {
    await pool.query('UPDATE players SET last_seen = $1 WHERE id = $2', [now, id]);
    await ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: rows[0].games_played, currentProgress: rows[0].current_progress, createdAt: Number(rows[0].created_at) };
  }
  await pool.query('INSERT INTO players (id, created_at, last_seen) VALUES ($1, $2, $3)', [id, now, now]);
  await ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, currentProgress: 1, createdAt: now };
}

// The level a player is currently on (their highest unlocked level).
export async function getCurrentLevel(playerId) {
  await registerPlayer(playerId); // make sure the player exists (new players default to level-1)
  const { rows } = await pool.query(
    'SELECT l.name, l.descriptor FROM players p JOIN levels l ON l.id = p.current_progress WHERE p.id = $1',
    [playerId]
  );
  if (!rows[0]) return null;
  return { name: rows[0].name, descriptor: rows[0].descriptor };
}

// Unlock the next level after the player's current one. No-op at the last level.
export async function advanceProgress(playerId) {
  await registerPlayer(playerId);
  const cur = await pool.query('SELECT current_progress FROM players WHERE id = $1', [playerId]);
  const next = await pool.query('SELECT MIN(id) AS id FROM levels WHERE id > $1', [cur.rows[0].current_progress]);
  if (next.rows[0] && next.rows[0].id != null) {
    const id = Number(next.rows[0].id);
    await pool.query('UPDATE players SET current_progress = $1 WHERE id = $2', [id, playerId]);
    return { currentProgress: id, advanced: true };
  }
  return { currentProgress: cur.rows[0].current_progress, advanced: false };
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

// Catalog: ships, weapons, components. JSONB columns come back already parsed.
export async function getShips() {
  const { rows } = await pool.query('SELECT id, name, type, stats, model_url, components FROM ships ORDER BY id');
  return rows.map((r) => ({ id: Number(r.id), name: r.name, type: r.type, stats: r.stats, modelUrl: r.model_url, components: r.components }));
}

export async function getWeapons() {
  const { rows } = await pool.query('SELECT id, name, type, stats FROM weapons ORDER BY id');
  return rows.map((r) => ({ id: Number(r.id), name: r.name, type: r.type, stats: r.stats }));
}

export async function getComponents() {
  const { rows } = await pool.query('SELECT id, name, type, weight, stats FROM components ORDER BY id');
  return rows.map((r) => ({ id: Number(r.id), name: r.name, type: r.type, weight: r.weight, stats: r.stats }));
}

export async function getMap(name) {
  const { rows } = await pool.query('SELECT name, descriptor FROM maps WHERE name = $1', [name]);
  return rows[0] ? { name: rows[0].name, descriptor: rows[0].descriptor } : null;
}

export async function getLevel(name) {
  const { rows } = await pool.query('SELECT name, descriptor FROM levels WHERE name = $1', [name]);
  return rows[0] ? { name: rows[0].name, descriptor: rows[0].descriptor } : null;
}

// The player's active ship: ship template + effective loadout (loadout falls back to ship defaults).
export async function getActivePlayerShip(playerId) {
  await registerPlayer(playerId);
  const { rows } = await pool.query(`
    SELECT ps.id AS player_ship_id, ps.loadout, ps.components AS ps_components,
           s.id AS ship_id, s.name, s.type, s.stats, s.model_url, s.components AS ship_components
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = $1 AND ps.is_active LIMIT 1`, [playerId]);
  const row = rows[0];
  if (!row) return null;
  const stats = row.stats, loadout = row.loadout || {};
  return {
    playerShipId: Number(row.player_ship_id),
    ship: { id: Number(row.ship_id), name: row.name, type: row.type, stats, modelUrl: row.model_url, components: row.ship_components },
    loadout: { mounts: loadout.mounts ?? stats.mounts ?? [] },
    components: row.ps_components ?? row.ship_components,
  };
}
