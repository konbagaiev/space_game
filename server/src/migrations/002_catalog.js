// 002 — ship & weapon catalog + per-player owned ships (table structure only).
//   ships        : templates for the player AND enemies (type 'player' | 'enemy'); stats JSON
//                  (groups + mounts referencing weapons by id); optional model_url.
//   weapons      : bullets and rockets (type 'bullet' | 'rocket'); stats JSON. Stable explicit ids.
//   player_ships : ships a player owns; exactly one is_active goes into battle. loadout JSON may
//                  override `mounts` ({} = the ship's default mounts). meta JSON for the future.
// The catalog ROWS are seeded/updated by an idempotent upsert on every startup (seedCatalog in
// db.js / db_postgres.js), so evolving catalog_seed.js propagates without a data migration.
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ships (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      type      TEXT NOT NULL,   -- 'player' | 'enemy'
      stats     TEXT NOT NULL,   -- JSON: hull/engine/thrusters, groups + mounts, color, spawn rules
      model_url TEXT             -- link to a 3D model (nullable; a built-in primitive if null)
    );
    CREATE TABLE IF NOT EXISTS weapons (
      id    INTEGER PRIMARY KEY,  -- stable explicit ids (referenced from ship mounts / loadout)
      name  TEXT NOT NULL UNIQUE,
      type  TEXT NOT NULL,        -- 'bullet' | 'rocket'
      stats TEXT NOT NULL         -- JSON: damage/speed/range/cooldown/...
    );
    CREATE TABLE IF NOT EXISTS player_ships (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  TEXT    NOT NULL REFERENCES players(id),
      ship_id    INTEGER NOT NULL REFERENCES ships(id),
      is_active  INTEGER NOT NULL DEFAULT 0,
      loadout    TEXT    NOT NULL DEFAULT '{}',  -- JSON: may override mounts ({} = ship defaults)
      meta       TEXT,                           -- JSON: future data/overrides
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_player_ships_player ON player_ships(player_id);
    -- at most one active ship per player
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_player_active_ship ON player_ships(player_id) WHERE is_active = 1;
  `);
};
