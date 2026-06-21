// 009 — player authentication (anonymous-first, optional email/password account; DECISIONS §11).
// Credentials attach to the existing players row (in-place upgrade preserves progress). Login is by
// email; username is a non-unique display name. Passwords are scrypt-hashed (auth.js). Sessions are
// server-side tokens whose SHA-256 hash is stored here; the raw token lives only in the cookie.
//
// SQLite's ALTER TABLE can't add a UNIQUE column, so email uniqueness is a partial unique index
// (NULLs excluded). No FK on session.player_id (logical FK; SQLite FK enforcement is off — see §9);
// Postgres declares the real FK in its bootstrap.
export const up = (db) => {
  db.exec(`
    ALTER TABLE players ADD COLUMN username TEXT;
    ALTER TABLE players ADD COLUMN email TEXT;
    ALTER TABLE players ADD COLUMN password_hash TEXT;
    ALTER TABLE players ADD COLUMN password_salt TEXT;
    ALTER TABLE players ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN email_verify_token_hash TEXT;
    ALTER TABLE players ADD COLUMN email_verify_sent_at INTEGER;

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_players_email ON players(email) WHERE email IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,        -- SHA-256 hex of the raw cookie token
      player_id  TEXT    NOT NULL,        -- logical FK into players(id)
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
  `);
};
