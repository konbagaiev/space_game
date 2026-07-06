// 021 — device capture (docs/plans/2026-07-06-2154-admin-device-column.md): the raw User-Agent plus the
// Sec-CH-UA-Model client-hint (device CODE, e.g. "SM-A037F") captured at the boot register call,
// latest-wins. Both nullable TEXT; admin.js parses them into a "Browser · Device/OS" label at render time
// (no backfill — existing rows stay NULL until the player next boots).
export const up = (db) => {
  db.exec(`ALTER TABLE players ADD COLUMN user_agent TEXT;`);
  db.exec(`ALTER TABLE players ADD COLUMN device_model TEXT;`);
};
