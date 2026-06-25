// 015 — client performance samples (docs/plans/perf-low-end-phones.md). Diagnostic telemetry from the
// `?dev` perf monitor: one row per ~1-second aggregated sample (fps + frame-time percentiles + the JS
// frame-cost breakdown + device/GPU passport), sent so we can tell whether a weak phone is CPU-bound,
// GPU/fill-rate-bound, or governed externally (thermal/vsync) — a single fps number can't. Best-effort,
// no FK on player_id (logical FK, like events). `sample` is the full JSON payload. NOT wiped by a player
// reset (it's our diagnostics, not the player's progress). `session_id` groups one page load.
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS perf_samples (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  TEXT    NOT NULL,   -- the browser/account player id (logical FK to players)
      session_id TEXT    NOT NULL,   -- random per page load, groups a session's samples
      sample     TEXT    NOT NULL,   -- the aggregated 1s sample, JSON
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_perf_session ON perf_samples(session_id);
    CREATE INDEX IF NOT EXISTS idx_perf_time ON perf_samples(created_at);
    CREATE INDEX IF NOT EXISTS idx_perf_player ON perf_samples(player_id);
  `);
};
