// 006 — player progress: the currently-available level for each player (their highest
// unlocked level). Logically a foreign key into levels(id); defaults to 1 (level-1, the
// first seeded level). SQLite's ALTER TABLE can't ADD a column with both a REFERENCES
// clause and a non-NULL default, so the column is a plain integer here (FK enforcement is
// off in SQLite anyway). The Postgres bootstrap declares it as a real, enforced FK.
export const up = (db) => {
  db.exec(`
    ALTER TABLE players ADD COLUMN current_progress INTEGER NOT NULL DEFAULT 1;
  `);
};
