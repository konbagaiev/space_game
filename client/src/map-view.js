// Pan/zoom transform for the star-system map — PURE (no DOM, no THREE; node-testable, see map-view.test.js).
//
// The map draws a slice of the XZ world plane onto a canvas. The whole camera state is three numbers:
//   view = { zoom, cx, cz }   — the WORLD point sitting at the canvas centre, and a zoom multiplier.
// `frame = { width, height, worldRadius }` describes the canvas and how much world "1× zoom" shows: at
// zoom 1 a disc of `worldRadius` fits the smaller canvas half-dimension (minus PAD), i.e. the whole system.
//
// Every gesture is expressed as a pure view → view function, so the UI layer only has to feed it pointer
// numbers and redraw. That is also what makes the clamping testable: zoom is bounded, and the centre can
// never wander further than `worldRadius` from the origin, so the system can never be panned off-screen and
// lost (the failure mode of a naive drag-to-pan).

export const ZOOM_MIN = 0.75;  // slightly wider than the whole system — you can always see everything
export const ZOOM_MAX = 40;    // close enough to separate the base / science / mining anchors near planet 2
const PAD = 26;                // canvas-edge padding (px) kept clear at zoom 1

export const DEFAULT_VIEW = { zoom: 1, cx: 0, cz: 0 };

// World units → pixels at this view.
export function scaleOf(view, frame) {
  const fit = (Math.min(frame.width, frame.height) / 2 - PAD) / (frame.worldRadius || 1);
  return fit * view.zoom;
}

// Clamp a candidate view: zoom into range, and the centre inside the system disc so it can't be lost.
export function clampView(view, frame) {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom || 1));
  const r = frame.worldRadius || 1;
  const d = Math.hypot(view.cx || 0, view.cz || 0);
  if (d <= r) return { zoom, cx: view.cx || 0, cz: view.cz || 0 };
  return { zoom, cx: (view.cx / d) * r, cz: (view.cz / d) * r };
}

// World (x,z) → canvas pixel (x,y).
export function toScreen(view, frame, wx, wz) {
  const s = scaleOf(view, frame);
  return { x: frame.width / 2 + (wx - view.cx) * s, y: frame.height / 2 + (wz - view.cz) * s };
}

// Canvas pixel (x,y) → world (x,z). Exact inverse of toScreen.
export function toWorld(view, frame, sx, sy) {
  const s = scaleOf(view, frame);
  return { x: view.cx + (sx - frame.width / 2) / s, z: view.cz + (sy - frame.height / 2) / s };
}

// Drag: move the content with the pointer (content follows the finger), so the centre moves the other way.
export function panByScreen(view, frame, dxPx, dyPx) {
  const s = scaleOf(view, frame);
  return clampView({ zoom: view.zoom, cx: view.cx - dxPx / s, cz: view.cz - dyPx / s }, frame);
}

// Zoom by `factor` about a canvas point, keeping the world point under that pixel pinned (wheel + pinch).
export function zoomAtScreen(view, frame, factor, sx, sy) {
  const anchor = toWorld(view, frame, sx, sy);
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
  const after = { zoom, cx: view.cx, cz: view.cz };
  const s = scaleOf(after, frame);
  // solve for the centre that puts `anchor` back under (sx,sy)
  return clampView({
    zoom,
    cx: anchor.x - (sx - frame.width / 2) / s,
    cz: anchor.z - (sy - frame.height / 2) / s,
  }, frame);
}

// Re-centre on a world point without changing zoom (used when a list row selects an off-screen object).
export function centerOn(view, frame, wx, wz) {
  return clampView({ zoom: view.zoom, cx: wx, cz: wz }, frame);
}

// The nearest object to a canvas point within `rPx`, or null. `objects` are {id, pos:{x,z}}; ties go to the
// closest. Pure so marker picking is testable without a canvas.
export function pickAt(objects, view, frame, sx, sy, rPx = 14) {
  let best = null, bestD = rPx;
  for (const o of objects) {
    const p = toScreen(view, frame, o.pos.x, o.pos.z);
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d <= bestD) { bestD = d; best = o; }
  }
  return best;
}
