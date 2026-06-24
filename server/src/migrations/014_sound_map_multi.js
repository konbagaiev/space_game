// 014 — allow MULTIPLE sounds per (entity, class, event) in sound_map (e.g. several music tracks per
// scene, played at random). Widens the primary key to include sound_key. sound_map is pure reference
// data (re-seeded from catalog_seed every startup), so dropping + recreating it loses nothing.
export const up = (db) => {
  db.exec(`
    DROP TABLE IF EXISTS sound_map;
    CREATE TABLE sound_map (
      entity    TEXT NOT NULL,      -- 'ship' | 'weapon' | 'scene'
      class     TEXT NOT NULL,      -- entity's stats.class, or the scene name for music
      event     TEXT NOT NULL,      -- ship 'explode'/'hit'; weapon 'fire'/'explode'; scene 'music'
      sound_key TEXT NOT NULL REFERENCES sounds(key),
      PRIMARY KEY (entity, class, event, sound_key)
    );
  `);
};
