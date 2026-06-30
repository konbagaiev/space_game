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
  earned: byId('earned'),       // credits earned this run
  credits: byId('credits'),     // persistent account balance
  kills: byId('kills'),         // destroyed enemies this run
  enemies: byId('enemies'),     // enemies currently alive
  hpFill: byId('hpfill'),       // health bar fill width
  hpPct: byId('hppct'),         // health bar numeric percent
  rocketBtn: byId('rocket-btn'),   // 🚀 button (gets a .ready class when reloaded)
  rocketFill: byId('rocket-fill'), // radial reload indicator on the rocket button
  perf: byId('perf'),           // fps / ms / draw-calls overlay
  markers: byId('markers'),     // container for off-screen enemy edge arrows
  minimap: byId('minimap'),     // radar canvas
  // result overlay (read by the HUD to hide markers/radar; written by the death/win/restart flows)
  overlay: byId('overlay'),
};
