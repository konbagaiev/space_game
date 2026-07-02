// 018 — referrer capture (docs/plans/2026-07-02-1352-admin-panel-player-stats.md): where a player came
// from, captured once at row creation (write-once; never overwritten on later visits). Nullable TEXT; a
// compact JSON string of document.referrer + ?ref=/UTM params, truncated to 512 chars server-side.
export const up = (db) => {
  db.exec(`ALTER TABLE players ADD COLUMN referrer TEXT;`);
};
