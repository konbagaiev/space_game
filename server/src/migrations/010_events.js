// 010 — product funnel events (docs/plans/monitoring.md): lightweight per-player gameplay events
// (game_start, level_start, level_clear, player_death, victory, quit) so we can see where players drop
// off. Best-effort telemetry — no FK on player_id (logical FK to players, like games/sessions; kept
// plain so a stray event never fails). `data` is JSON context (e.g. {"level":"Level 3","cause":"rocket"}).
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  TEXT    NOT NULL,   -- the browser/account player id (logical FK to players)
      type       TEXT    NOT NULL,   -- allowlisted event name (validated by the API)
      data       TEXT,               -- optional JSON context
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_player ON events(player_id);
  `);
};
