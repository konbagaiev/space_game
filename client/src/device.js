// Single source of truth for device capabilities, on TWO independent axes:
//   input: 'touch' | 'mouse'  — capability, ~constant per session (drives interaction-bound behavior)
//   form:  'phone' | 'tablet' | 'desktop' | 'desktop-lg' — recomputed on resize (drives layout/CSS)
// Plus fullscreen/standalone capability flags (moved here from main.js). Dependency-free (imports
// nothing from the app) so both state.js (first-run quality default) and engine.js (rotation) can use
// it without an import cycle. Import-safe under node:test: all globals are guarded and the top-level
// applyDevice() runs only in a real DOM (like audio.js — importing never touches a missing DOM).
const hasWindow = typeof window !== 'undefined';
const mm = (q) => hasWindow && window.matchMedia ? window.matchMedia(q).matches : false;

const hasTouch = mm('(pointer: coarse)')
  || (hasWindow && 'ontouchstart' in window)
  || (hasWindow && (navigator.maxTouchPoints || 0) > 0);
const canHover = mm('(hover: hover)'); // exposed for iteration 2 (not wired to any CSS/behavior yet)

// Fullscreen API present? (iPhone Safari has none — it exists only on iPad/Android.)
const FS_API = hasWindow && !!(document.documentElement.requestFullscreen
  || document.documentElement.webkitRequestFullscreen);
// Launched as an installed PWA (no browser chrome left to hide)?
const STANDALONE = hasWindow && (window.navigator.standalone === true
  || mm('(display-mode: standalone)'));

// PURE: form factor from the viewport dimensions. `phone` is decided by the SHORTEST edge, the larger
// tiers by the LONGEST edge — both are orientation-invariant (min/max are symmetric). The short-edge phone
// test is the fix for the fullscreen flip on large/foldable phones (e.g. Galaxy Fold cover ≈ 369×905 CSS px):
// hiding the browser chrome grows the LONGEST edge past the old 900 threshold and used to flip phone→tablet,
// ballooning the loadout chrome. A handheld's short edge (≤ ~450) never approaches a tablet's (iPad mini 744),
// and chrome-hiding barely moves it, so the classification stays stable across fullscreen. Unit-tested.
// `shortest` defaults to `longest` so single-arg callers/tests still describe a square-ish viewport.
export function classifyForm(longest, shortest = longest) {
  if (shortest < 600) return 'phone';
  if (longest < 1280) return 'tablet';
  if (longest < 1920) return 'desktop';
  return 'desktop-lg';
}

// Classify the current window (longest + shortest edge). Small helper so Device.form and applyDevice agree.
const formOf = (w, h) => classifyForm(Math.max(w, h), Math.min(w, h));

export const Device = {
  hasTouch, canHover, FS_API, STANDALONE,
  input: hasTouch ? 'touch' : 'mouse',  // ~constant per session
  form: hasWindow ? formOf(window.innerWidth, window.innerHeight) : 'desktop',
};

const FORM_CLASSES = ['dev-phone', 'dev-tablet', 'dev-desktop', 'dev-desktop-lg'];

// Recompute the reactive `form` axis and (re)apply the body classes. The input axis + aliases are
// constant, but re-setting them is cheap and keeps this the single place that owns the classes. Called
// at module load AND from engine.applyOrientation() on resize/orientationchange. THIS ITERATION only
// sets the classes on a form change — acting on layout beyond CSS is deferred to iteration 2.
export function applyDevice() {
  if (!hasWindow || !document.body) return;
  Device.form = formOf(window.innerWidth, window.innerHeight);
  const b = document.body, touch = Device.input === 'touch';
  b.classList.toggle('input-touch', touch);
  b.classList.toggle('input-mouse', !touch);
  b.classList.toggle('touch', touch);                 // back-compat alias for existing touch CSS
  for (const c of FORM_CLASSES) b.classList.toggle(c, c === 'dev-' + Device.form);
  // Fullscreen/standalone gates (touch-only UI; unchanged behavior, moved from main.js).
  b.classList.toggle('standalone', touch && STANDALONE);
  b.classList.toggle('no-fs-api', touch && !STANDALONE && !FS_API);
}

applyDevice(); // set classes before first paint (idempotent; engine.applyOrientation re-runs it on resize)
