// 019 — backfill the base Grab (component 29) onto existing players (DECISIONS §40). The Grab shipped as a
// starter-equipped slot on the default player ship, so NEW players get it from the ship default. Players
// created BEFORE the feature whose active ship has an explicit `components` override (JSON) predating Grab
// have no 'grab' slot — grant them component 29. Players with NULL components inherit the (reseeded) ship
// default, which already includes grab:29, so they need no change. Idempotent: rows that already have a
// grab slot are skipped, so re-running is a no-op.
export const up = (db) => {
  const rows = db.prepare('SELECT id, components FROM player_ships WHERE components IS NOT NULL').all();
  const upd = db.prepare('UPDATE player_ships SET components = ? WHERE id = ?');
  for (const r of rows) {
    let c;
    try { c = JSON.parse(r.components); } catch { continue; } // malformed → leave untouched
    if (c && typeof c === 'object' && c.grab == null) {
      c.grab = 29;
      upd.run(JSON.stringify(c), r.id);
    }
  }
};
