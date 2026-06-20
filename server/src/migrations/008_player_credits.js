// 008 — money: rename the per-game `score` to `credits` (the in-game currency) and give each player
// a persistent `credits` balance. New players start with 1000 credits. No FK on the balance, so the
// SQLite ADD COLUMN with a non-NULL default is safe (see DECISIONS §9). Earned credits are banked into
// players.credits at the end of each run (recordGame).
export const up = (db) => {
  db.exec(`
    ALTER TABLE games RENAME COLUMN score TO credits;
    ALTER TABLE players ADD COLUMN credits INTEGER NOT NULL DEFAULT 1000;
  `);
};
