// 020 — item rarity + color: components/weapons gain a rarity tier (trash|common|rare) and a hex color.
// Drives the in-world drop glow + the pickup-log line tint (client). See
// docs/plans/2026-07-05-1844-touch-hud-log-item-colors.md.
export const up = (db) => {
  db.exec('ALTER TABLE components ADD COLUMN rarity TEXT;');
  db.exec('ALTER TABLE components ADD COLUMN color TEXT;');
  db.exec('ALTER TABLE weapons ADD COLUMN rarity TEXT;');
  db.exec('ALTER TABLE weapons ADD COLUMN color TEXT;');
};
