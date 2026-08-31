// Scroll affordance for clipped text panels — the chevrons that say "there is more text this way".
//
// A plain `overflow-y: auto` panel gives no hint on a phone: the mobile browser hides the scrollbar until
// you drag, so a briefing that doesn't fit simply ends mid-sentence at the panel edge and the player takes
// off having read half of it. This module drops two chevrons — one pointing UP at the top edge, one
// pointing DOWN at the bottom — into the panel's HOST (its positioned parent, so they don't scroll away
// with the content) and toggles them from the scroll position.
//
// The state decision is a pure function (`hintState`) so it is unit-testable without a DOM; `attachScrollHint`
// is the thin DOM/observer wiring around it. Styling lives in `styles.css` (`.scroll-host` / `.scroll-hint`).

// Slack in px before an edge counts as "there is more that way". Sub-pixel layout and fractional
// devicePixelRatio leave `scrollTop` a hair off 0 / off the maximum, which would otherwise light a chevron
// pointing at nothing.
export const HINT_TOL = 2;

// Pure: given a scroller's metrics, which chevrons should show.
// A panel that isn't overflowing (or isn't laid out yet — clientHeight 0 while its view is display:none)
// shows neither.
export function hintState(m, tol = HINT_TOL) {
  const scrollTop = (m && m.scrollTop) || 0;
  const scrollHeight = (m && m.scrollHeight) || 0;
  const clientHeight = (m && m.clientHeight) || 0;
  const max = scrollHeight - clientHeight;      // the largest reachable scrollTop
  if (!(clientHeight > 0) || max <= tol) return { up: false, down: false };
  return { up: scrollTop > tol, down: scrollTop < max - tol };
}

// Attach chevrons to `el` (the scroller). `host` must be a positioned ancestor that does NOT scroll —
// by default the parent element, which is what the markup provides (e.g. #mw-mission-scroll wrapping
// #mw-mission-desc). Idempotent: attaching twice reuses the same two chevrons.
// Returns { update, detach } — `update()` is also safe to call by hand after changing the content.
export function attachScrollHint(el, host = el && el.parentElement) {
  if (!el || !host) return { update() {}, detach() {} };

  host.classList.add('scroll-host');
  let up = host.querySelector(':scope > .scroll-hint.up');
  let down = host.querySelector(':scope > .scroll-hint.down');
  if (!up || !down) {
    const make = (dir) => {
      const d = document.createElement('div');
      d.className = `scroll-hint ${dir}`;
      d.setAttribute('aria-hidden', 'true'); // decoration: the text itself is already in the a11y tree
      host.appendChild(d);
      return d;
    };
    up = up || make('up');
    down = down || make('down');
  }

  // Coalesce every trigger into one read per frame: the staged briefing typewriter rewrites the text on
  // EVERY frame, so the mutation observer below fires ~60x/s while a briefing types itself out.
  let raf = 0;
  const apply = () => {
    raf = 0;
    const s = hintState(el);
    host.classList.toggle('has-more-up', s.up);
    host.classList.toggle('has-more-down', s.down);
  };
  const update = () => { if (!raf) raf = requestAnimationFrame(apply); };

  el.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  // Panel resized (device rotate, the view being shown at all) and content changed (typewriter, a new
  // briefing, the granted-item showcase floating in) — both change whether the text is clipped.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
  if (ro) ro.observe(el);
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(update) : null;
  if (mo) mo.observe(el, { childList: true, subtree: true, characterData: true });

  apply();
  return {
    update,
    detach() {
      if (raf) cancelAnimationFrame(raf); raf = 0;
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
      host.classList.remove('has-more-up', 'has-more-down');
    },
  };
}
