// 023 — backfill the Base shield (component 31) onto existing players. Mirrors 019 (grab). The Base
// shield shipped as a starter-equipped slot on the default player ship, so NEW players get it from the
// reseeded ship default. Players created BEFORE the feature whose active ship has an explicit
// `components` override (JSON) predating shields have no 'shield' slot — grant them component 31.
// Players with NULL components inherit the (reseeded) ship default, which already includes shield:31,
// so they need no change. Idempotent: rows already carrying a 'shield' slot are skipped.
export const up = (db) => {
  const rows = db.prepare('SELECT id, components FROM player_ships WHERE components IS NOT NULL').all();
  const upd = db.prepare('UPDATE player_ships SET components = ? WHERE id = ?');
  for (const r of rows) {
    let c;
    try { c = JSON.parse(r.components); } catch { continue; } // malformed → leave untouched
    if (c && typeof c === 'object' && c.shield == null) {
      c.shield = 31;
      upd.run(JSON.stringify(c), r.id);
    }
  }
};
