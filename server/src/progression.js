// Character progression: experience -> character level + skill points.
//
// A player earns experience (XP) per enemy killed (= the enemy's credit reward) and a one-shot bonus
// per mission cleared. XP maps to a character LEVEL via an arithmetic cost curve (the classic RPG
// ramp — per-level cost grows linearly, so cumulative XP is quadratic): the cost to advance FROM
// level L to L+1 is BASE + STEP*L. A new player is level 0 with 0 XP; each level gained grants one
// skill point to spend across the skills (kinetic/rocket/shields/maneuver/mobility). See DECISIONS
// (character progression) and docs/plans/2026-08-09-character-progression.md.
//
// LEVEL IS DERIVED, NEVER STORED: the single source of truth is `experience` plus the per-skill
// allocations. level = levelFromXp(experience).level; unspent points = level - (sum of allocations).
// This keeps the DB from ever disagreeing with the curve when the numbers are retuned.
export const XP_BASE = 1000; // cost to reach level 1 from level 0
export const XP_STEP = 500;  // extra cost added per subsequent level

// XP required to advance FROM `level` to `level+1` (level >= 0): 1000, 1500, 2000, 2500, ...
export function levelUpCost(level) {
  return XP_BASE + XP_STEP * Math.max(0, level | 0);
}

// Cumulative XP required to REACH `level` (level 0 => 0, level 1 => 1000, level 2 => 2500, ...).
export function xpForLevel(level) {
  let total = 0;
  for (let l = 0; l < (level | 0); l++) total += levelUpCost(l);
  return total;
}

// Resolve total experience into { level, into, span }: the current level, XP accrued INTO the current
// level, and the SPAN (cost) of the current level toward the next. Total skill points ever granted
// equals `level`.
export function levelFromXp(experience) {
  let level = 0;
  let remaining = Math.max(0, Math.floor(experience || 0));
  while (remaining >= levelUpCost(level)) {
    remaining -= levelUpCost(level);
    level++;
  }
  return { level, into: remaining, span: levelUpCost(level) };
}

// Unspent skill points = points granted by level minus points already allocated. Never negative.
export function unspentSkillPoints(experience, allocatedTotal) {
  return Math.max(0, levelFromXp(experience).level - Math.max(0, allocatedTotal | 0));
}
