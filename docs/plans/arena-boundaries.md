# Arena boundaries rework + mini-map — brief (Vega Sentinels)

> **Status: Implemented 2026-06-22.** All core items (1–4) plus the recommended mini-map (5) shipped in
> `client/index.html` + locales; visual scenario `08-arena-boundaries`. DECISIONS §2 + SUMMARY updated.
> Mini-map **complements** the off-screen arrows (it doesn't replace them). See CHANGELOG 2026-06-22.

> Feedback-driven fix. Today the arena edge (±240) is **invisible** and the ship **stops dead** at the
> wall (velocity zeroed — DECISIONS §2). That reads as a bug. Replace the hard wall with a **soft,
> visible boundary**: you *can* fly out, but you're warned and pulled back. English-only. Planning
> window — no code written here. **Supersedes the boundary behavior in DECISIONS §2** (update it on impl).

## Core (definitely)
1. **Remove the hard clamp.** Stop zeroing velocity at ±240 — the ship flies past the edge freely.
2. **"Left the battlefield" notification.** Show a clear HUD warning, e.g. *"You've left the battlefield —
   return to the combat zone (Ns)"* with a **countdown**, but **only after the ship has been out of
   bounds for 2 s continuously** (a grace delay so brief edge excursions during combat don't flash it).
   Clears the moment the ship is back inside. (i18n keyed.)
3. **Auto-return after 30 s.** If the ship stays out of bounds for **30 s** without returning, warp it
   back to **center (0,0)**, zero its velocity, clear the warning. Reuse the existing **warp-in
   animation** (added for enemy spawns) so the return reads intentionally, not as a glitch.
4. **Make the boundary perceptible.** Today it's invisible — add a subtle in-world edge marker (a faint
   glowing border / grid plane at ±240) so the player *sees* where the battlefield ends, at least when
   approaching/crossing.

Excursions under 2 s show nothing; the warning appears only after 2 s continuously out; only a
continuous 30 s outside triggers the warp-back.

## Optional / recommended (your "возможно")
5. **Mini-map / radar (recommended fast-follow).** A small corner radar showing the **arena boundary**
   (a square at ±240), the **player** (center-ish, with heading), and **enemies** as dots tinted by type
   color (reuse the type colors already used by the off-screen edge arrows, `updateMarkers`). Gives
   spatial awareness now that you can wander off. Note: this overlaps the existing **off-screen enemy
   arrows** — decide whether the mini-map *complements* them (arrows = immediate threat direction,
   mini-map = overview) or *replaces* them. Mobile: place so it doesn't fight the touch controls.

## Design notes / gaps
- **Enemies out of bounds:** simplest is enemies keep their normal AI (turn toward / keep distance); if
  the player flees far, the 30 s return brings them back — no special OOB enemy logic needed for v1.
- **Why keep a boundary at all:** containment + arena feel. The soft boundary + return pressure keeps
  combat centered without the jarring hard wall.
- **Return UX:** consider a short grace/invuln flash on warp-back so the player isn't instantly hit at
  center. Tune.
- **Don't punish harshly:** the warning is a nudge, not damage. (Could add escalating effects later;
  v1 = warn + warp-back only.)

## Tuning knobs
Arena half-size (currently `ARENA = 240`), **warning grace delay (2 s)**, out-of-bounds **return timeout
(30 s)**, warning copy, the boundary visual intensity, mini-map scale/position.

## i18n
New strings: `ui.oob.warning` (EN "You've left the battlefield — return to the combat zone") and a
countdown format (e.g. `ui.oob.countdown` "Returning in {seconds}s"). Add EN + RU.

## Coordination
Mostly `client/index.html` (physics clamp removal at the boundary, the OOB timer + warp-back, the HUD
warning, the boundary visual, the mini-map) + i18n locales. No server/schema change. Update DECISIONS §2
(boundary behavior) once implemented.

## Acceptance criteria
- The ship flies past ±240 without stopping; crossing shows a battlefield-left warning with a countdown.
- Returning inside clears the warning; staying out 30 s warps the ship back to center (velocity zeroed),
  using the warp animation.
- The arena edge is visibly perceptible (in-world marker and/or mini-map).
- (If included) the mini-map shows the boundary, the player, and type-colored enemy dots; works on mobile.
