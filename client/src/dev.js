// Dev diagnostics flag (?dev) — governs the on-screen perf/service overlay (#perf), the lil-gui authoring
// panels, the `window.__backdrop` hooks and the per-second perf telemetry POSTed to /api/perf.
//
// NOT STICKY, ANYWHERE. A truthy `?dev` (`?dev`, `?dev=true`, `?dev=1`) turns diagnostics on for THIS PAGE
// LOAD ONLY; anything else — including no param at all — is off. Nothing is written to or read from
// localStorage. Evaluated once per load and cached.
//
// It used to persist the flag, which meant one `?dev` visit left the FPS/tris overlay, the right-docked
// tuning panels and the telemetry running on **the live site forever** — for the maintainer and for any
// playtester handed a `?dev` link. That is service information leaking into the game. A dev typing
// `?dev` into the URL (or bookmarking it) is a trivially small cost next to a diagnostics overlay stuck on
// vega.tenony.com, so the flag simply does not persist. See DECISIONS §81.
//
// A `devMode` key left over from the sticky era is ignored, and cleared opportunistically below so it does
// not linger in players' storage.
const LEGACY_KEY = 'devMode';

// Pure + storage-free, so it is unit-testable without a DOM: the URL alone decides.
export function evalDev(search) {
  const v = new URLSearchParams(search || '').get('dev');
  return v === '' || v === 'true' || v === '1'; // bare ?dev, ?dev=true, ?dev=1 — everything else is off
}

const DEV = evalDev(typeof location !== 'undefined' ? location.search : '');

// Drop the retired sticky key so an old visit can't keep haunting a browser's storage.
try { if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_KEY); } catch { /* private mode */ }

// True when the dev diagnostics flag is on for this page load.
export function isDev() { return DEV; }

// Set the body.devmode gate before first paint (idempotent; #perf is display:none until this lands).
if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('devmode', DEV);
