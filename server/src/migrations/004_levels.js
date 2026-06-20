// 004 — levels: a JSON descriptor per level (a map + an ordered phase/wave script) the client's
// level runner plays. Rows are seeded/updated by the idempotent upsert on startup (seedCatalog).
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS levels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      descriptor TEXT NOT NULL   -- JSON: { title, map, phases:[...] }
    );
  `);
};
