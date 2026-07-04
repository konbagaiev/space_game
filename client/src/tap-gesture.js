// Tap-vs-drag classification for touch input. A single-finger gesture is a TAP until it travels beyond
// TAP_SLOP px from its touchstart point; once it does, it's a DRAG (steering) for the rest of the gesture.
// Matches platform touch-slop conventions (Android ViewConfiguration ~8dp, Hammer.js 9px). Pure (no DOM),
// so it's node-testable.
//
// Invariant: the caller feeds `exceedsSlop` ROTATED GAME-SPACE coordinates (toGame output — the same
// space the stick center lives in), so TAP_SLOP and the stick's ~12px dead zone (DEAD*R) are measured in
// one consistent space and are apples-to-apples. Never mix raw clientX/clientY with game coords here.
export const TAP_SLOP = 10;
export function exceedsSlop(x0, y0, x1, y1, slop = TAP_SLOP) {
  return Math.hypot(x1 - x0, y1 - y0) > slop;
}
