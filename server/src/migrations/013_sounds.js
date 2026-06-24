// 013 — SFX sound registry + class-based routing (docs/plans/sound-classes-and-mapping.md).
//   sounds    : asset registry, key -> same-origin content-hashed url (+ optional playback gain).
//   sound_map : routing, (entity, class, event) -> sound key. entity 'ship' | 'weapon';
//               class = the entity's stats.class; event ship 'explode'/'hit' or weapon 'fire'/'explode'.
// Both tables' ROWS are seeded/updated by the idempotent upsert on every startup (seedCatalog in
// db.js / db_postgres.js), so evolving SOUNDS/SOUND_MAP in catalog_seed.js needs no data migration.
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sounds (
      key  TEXT PRIMARY KEY,        -- logical name (e.g. 'kinetic', 'shipBoom')
      url  TEXT NOT NULL,           -- same-origin content-hashed path (assets/sounds/<name>.<hash>.mp3)
      gain REAL NOT NULL DEFAULT 1  -- playback gain (volume baked into files today, so 1)
    );
    CREATE TABLE IF NOT EXISTS sound_map (
      entity    TEXT NOT NULL,      -- 'ship' | 'weapon'
      class     TEXT NOT NULL,      -- the entity's stats.class
      event     TEXT NOT NULL,      -- ship: 'explode' | 'hit'; weapon: 'fire' | 'explode'
      sound_key TEXT NOT NULL REFERENCES sounds(key),
      PRIMARY KEY (entity, class, event)
    );
  `);
};
