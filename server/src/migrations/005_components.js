// 005 — ship components (hull + engine). Ships are assembled from these; weapons stay separate.
// Adds a `components` table and a JSON `components` reference column on `ships` and `player_ships`
// ({ hull: <id>, engine: <id> }; on player_ships it overrides the ship's defaults). Rows are
// upserted on startup by seedCatalog.
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS components (
      id     INTEGER PRIMARY KEY,  -- stable explicit ids (referenced from ships/player_ships)
      name   TEXT    NOT NULL UNIQUE,
      type   TEXT    NOT NULL,     -- 'hull' | 'engine'
      weight INTEGER NOT NULL,     -- contributes to ship mass
      stats  TEXT    NOT NULL      -- JSON: hull {durability,volume} / engine {power,turnPower,maxSpeed,exhaust}
    );
  `);
  // add the components reference column (runs once via the version-gated runner)
  db.exec('ALTER TABLE ships ADD COLUMN components TEXT');
  db.exec('ALTER TABLE player_ships ADD COLUMN components TEXT');
};
