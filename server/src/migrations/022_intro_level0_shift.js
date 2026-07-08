// 022 — intro "Level 0": shift every existing player's progress +1. A new gentle intro level is
// prepended (seed name 'level-1', title "Level 0"); the campaign's descriptors moved down one id, so a
// player's OLD content now lives at their current id + 1. Bumping keeps every existing player on their
// exact same content (just relabeled by id); new players keep the DEFAULT 1 = the intro.
// One-shot by construction: the migration runner applies each file at most once (PRAGMA user_version).
// See docs/plans/2026-07-08-2224-intro-first-level.md.
export const up = (db) => {
  db.exec('UPDATE players SET current_progress = current_progress + 1;');
};
