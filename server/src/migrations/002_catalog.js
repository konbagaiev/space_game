// 002 — ship & weapon catalog + per-player owned ships, seeded from the shared snapshot.
//   ships        : templates for the player AND enemies (type 'player' | 'enemy'); stats JSON
//                  (references weapons by id); optional model_url (3D model, null = primitive).
//   weapons      : bullets and rockets (type 'bullet' | 'rocket'); stats JSON. Stable explicit ids.
//   player_ships : ships a player owns; exactly one is_active goes into battle. loadout JSON holds
//                  weapon ids by slot ({} = use the ship's default weapons). meta JSON for the future.
import { SHIPS, WEAPONS } from '../catalog_seed.js';

export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ships (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      type      TEXT NOT NULL,   -- 'player' | 'enemy'
      stats     TEXT NOT NULL,   -- JSON: hull/engine/thrusters, weapon ids, color, sizeScale, spawn rules
      model_url TEXT             -- link to a 3D model (nullable; a built-in primitive if null)
    );
    CREATE TABLE IF NOT EXISTS weapons (
      id    INTEGER PRIMARY KEY,  -- stable explicit ids (referenced from ships/loadout)
      name  TEXT NOT NULL UNIQUE,
      type  TEXT NOT NULL,        -- 'bullet' | 'rocket'
      stats TEXT NOT NULL         -- JSON: damage/speed/cooldown/...
    );
    CREATE TABLE IF NOT EXISTS player_ships (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  TEXT    NOT NULL REFERENCES players(id),
      ship_id    INTEGER NOT NULL REFERENCES ships(id),
      is_active  INTEGER NOT NULL DEFAULT 0,
      loadout    TEXT    NOT NULL DEFAULT '{}',  -- JSON: weapon ids by slot ({} = ship defaults)
      meta       TEXT,                           -- JSON: future data/overrides
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_player_ships_player ON player_ships(player_id);
    -- at most one active ship per player
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_player_active_ship ON player_ships(player_id) WHERE is_active = 1;
  `);

  const insW = db.prepare('INSERT OR IGNORE INTO weapons (id, name, type, stats) VALUES (?, ?, ?, ?)');
  for (const w of WEAPONS) insW.run(w.id, w.name, w.type, JSON.stringify(w.stats));

  const insS = db.prepare('INSERT OR IGNORE INTO ships (name, type, stats, model_url) VALUES (?, ?, ?, ?)');
  for (const s of SHIPS) insS.run(s.name, s.type, JSON.stringify(s.stats), s.modelUrl ?? null);
};
