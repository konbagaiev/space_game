// 007 — player language preference: the player's chosen UI/content language. Plain text, no FK
// (so the SQLite ADD COLUMN is safe with a non-NULL default — see DECISIONS §9). The server only
// stores the preference; all message resolution happens on the client (DECISIONS §10). Defaults
// to 'en' (the source language).
export const up = (db) => {
  db.exec(`
    ALTER TABLE players ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
  `);
};
