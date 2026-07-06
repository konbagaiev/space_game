// Single inventory of the index.html nodes shared across modules (HUD readouts, overlays).
//
// Why one file: each scattered `getElementById('foo')` is a hidden, stringly-typed dependency on
// index.html markup — a renamed/typo'd id fails silently at runtime (null → thrown .classList or a
// no-op). Caching them here behind a FAIL-LOUD accessor surfaces a missing id on boot instead.
//
// Scope (see docs/plans/client-code-structure.md §2.4): nodes read from a hot path or by >1 module
// live here. One-shot boot wiring (a single addEventListener) stays inline in its module beside the
// rest of that module's setup — this is an inventory, not a registry for every listener.
//
// Safe buildless: <script type="module"> runs after the body is parsed (module defer semantics), so
// every node exists when this module evaluates.
const byId = (id) => {
  const n = document.getElementById(id);
  if (!n) throw new Error(`dom.js: missing #${id} in index.html`);
  return n;
};

export const el = {
  // HUD readouts (updated every frame by hud.js)
  credits: byId('credits'),     // single "credits {total}/{earned} earned" line
  kills: byId('kills'),         // destroyed enemies this run
  hpFill: byId('hpfill'),       // health bar fill width
  hpPct: byId('hppct'),         // health bar numeric percent
  rocketBtn: byId('rocket-btn'),   // 🚀 button (gets a .ready class when reloaded)
  rocketFill: byId('rocket-fill'), // radial reload indicator on the rocket button
  perf: byId('perf'),           // fps / ms / draw-calls overlay
  markers: byId('markers'),     // container for off-screen enemy edge arrows
  minimap: byId('minimap'),     // radar canvas
  // result overlay (read by the HUD to hide markers/radar; written by the sim death/win + restart flows)
  overlay: byId('overlay'),
  overlayTitle: byId('overlay-title'),   // "Victory" / "Ship destroyed"
  overlaySub: byId('overlay-sub'),       // result subtitle (cleared line / kills+credits)
  restart: byId('restart'),              // overlay button: "Continue" on a win, "Restart" on a loss
  backHangar: byId('back-hangar'),       // shown on death once the shop is unlocked
  // pause control (written by setPaused; the buttons are wired in the inline boot)
  pauseBtn: byId('pause-btn'),           // ⏸ / ▶ toggle
  pauseOverlay: byId('pause-overlay'),   // centered "Paused" + Play card
  // soft-boundary "left the battlefield" warning + countdown (updateOobWarning)
  oobWarn: byId('oob-warn'),
  // "Sector cleared — return to base" hint shown during return-to-base (updateReturnHint)
  returnHint: byId('return-hint'),
  // bottom-center "Return to base" tap button: engages the dock autopilot (updateReturnHint show/hide)
  returnBtn: byId('return-btn'),
  // transient centered milestone banner ("10 enemies left", "Final Stage") (updateBanner)
  banner: byId('banner'),
};
