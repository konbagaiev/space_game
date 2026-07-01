// 017 — password reset (self-service recovery; DECISIONS §11). Mirrors the email-verify token pattern:
// a hashed, single-use, TTL'd token stored on the players row (raw token lives only in the emailed link).
export const up = (db) => {
  db.exec(`
    ALTER TABLE players ADD COLUMN password_reset_token_hash TEXT;
    ALTER TABLE players ADD COLUMN password_reset_sent_at INTEGER;
  `);
};
