// 003 — maps: a JSON descriptor per map that the client renders generically (buildMap).
// Rows are seeded/updated by the idempotent upsert on startup (seedCatalog), like the catalog.
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS maps (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      descriptor TEXT NOT NULL   -- JSON: { generator, ...params } describing the scene
    );
  `);
};
