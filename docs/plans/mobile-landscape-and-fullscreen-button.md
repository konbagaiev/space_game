# Mobile: force portrait + rework the Full-screen button

**Goal.** Three mobile UX fixes, all in `client/index.html`:

1. **Phones are always landscape.** When a touch device is held in portrait, the game must not play
   in portrait — show a "rotate to landscape" cover and (best-effort) lock the orientation. Desktop is
   unaffected.
2. **One Full-screen button, fixed in the bottom-right, icon-only (no text), a bit brighter** — instead
   of the four inline "⛶ Full screen" buttons scattered across the menus/overlays.
3. **Hide the Full-screen button when already in fullscreen.**

This is a touch-only feature set (`body.touch`); none of it changes the desktop experience.

---

## Current state (read before editing)

- `isTouch` is computed once: `const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);`
  — `client/index.html:1904`. On boot, `document.body.classList.add('touch')` gates touch-only UI
  (`client/index.html:1906`). CSS: `.touch-only { display: none } body.touch .touch-only { display: inline-flex }`
  (`client/index.html:95-96`).
- **Four** Full-screen buttons exist today, each `<button class="fullscreen-btn touch-only" data-i18n="ui.fullscreen">⛶ Full screen</button>`:
  - welcome screen — `client/index.html:510`
  - hangar — `client/index.html:536`
  - pause overlay — `client/index.html:572`
  - settings overlay — `client/index.html:612`
- Button CSS: `.fullscreen-btn` + `:hover` — `client/index.html:97-102` (semi-transparent, dim
  `#cfe0ff` text, has `margin-top:12px` because it sits inline in flex columns).
- Fullscreen logic: `requestFullscreen()` — `client/index.html:3417-3422` (no-ops if
  `document.fullscreenElement` already set or unsupported, e.g. iPhone Safari). All `.fullscreen-btn`
  get a click→`requestFullscreen` listener — `client/index.html:3425`.
- Resize handler (camera aspect + `renderer.setSize`) — `client/index.html:3295-3299`.
- Pause system: `let paused` (`:2625`), `setPaused(p)` (`:2628`) toggles `body.paused`. Existing
  `autoPauseOnBlur()` (`:2646-2649`) is the pattern to copy: `if (isTouch && gameStarted && player &&
  player.alive && !levelRunner.won && !paused) setPaused(true);`.
- i18n key `ui.fullscreen`: `client/locales/source.json:73` (English source + context) and
  `client/locales/ru.json:73` ("⛶ Во весь экран"). i18n binds via `data-i18n` to element text content.

---

## Decisions (already made — do not re-ask)

- **Consolidate to a single floating button**, not four. "Always bottom-right" means one fixed-position
  element, so delete all four inline buttons and add one at the end of `<body>`.
- **Icon-only**: button content is just the `⛶` glyph. The translated words move to `title` +
  `aria-label` (accessibility/tooltip), so `ui.fullscreen` is no longer bound via `data-i18n` to text —
  it's applied to `aria-label`/`title` in JS.
- **No exit-fullscreen button.** The button only *enters* fullscreen and hides once fullscreen; the
  user exits via the OS/browser gesture. This matches today's enter-only `requestFullscreen()`.
- **Landscape enforcement = cover overlay + best-effort lock.** `screen.orientation.lock('landscape')`
  works on Android in fullscreen but is unsupported on iOS Safari, so it can't be the only mechanism.
  The reliable, cross-browser path is a full-screen "rotate your device" cover shown via CSS media
  query when a touch device is in portrait; the lock is a best-effort enhancement on top.
- **Auto-pause in portrait.** Mirror `autoPauseOnBlur`: when a touch device rotates to portrait
  during a live fight, pause it (so the player isn't dying behind the cover). Do **not** auto-resume on
  return to landscape — the player resumes manually, consistent with the existing mobile auto-pause.

---

## Step 1 — Single floating Full-screen button

**1a. Delete the four inline buttons** at `client/index.html:510`, `:536`, `:572`, `:612`
(the `<button class="fullscreen-btn touch-only" data-i18n="ui.fullscreen">⛶ Full screen</button>` lines).

**1b. Add one floating button** near the other top-level floating controls (e.g. right after the
settings button block, around `client/index.html:575`, or just before `</body>`):

```html
<!-- Floating fullscreen toggle: touch-only, bottom-right, hidden once fullscreen (see CSS + JS). -->
<button id="fullscreen-btn" class="touch-only" aria-label="Full screen" title="Full screen">⛶</button>
```

(Keep `id="fullscreen-btn"` for JS; it no longer needs the old `fullscreen-btn` *class* selector, but
keep `touch-only` so it only shows on touch.)

**1c. Replace the CSS** at `client/index.html:97-102` with a fixed, icon-only, brighter style:

```css
/* Floating full-screen button — touch-only, bottom-right corner, hidden when already fullscreen. */
#fullscreen-btn {
  position: fixed; right: 14px; bottom: 14px; z-index: 60;
  width: 46px; height: 46px; padding: 0; border-radius: 12px;
  display: none; align-items: center; justify-content: center;
  font-size: 22px; line-height: 1; cursor: pointer; pointer-events: auto;
  color: #eaf2ff;                                   /* brighter than the old #cfe0ff */
  background: rgba(40,60,110,.55);                   /* brighter/more solid than the old .06 */
  border: 1px solid rgba(170,200,255,.55);
  box-shadow: 0 2px 10px rgba(0,0,0,.35);
}
body.touch #fullscreen-btn { display: flex; }        /* show on touch … */
body.fs #fullscreen-btn { display: none !important; } /* … but hide once fullscreen (Step 3) */
#fullscreen-btn:active { background: rgba(60,85,150,.7); }
```

Pick a `z-index` above the menus but below the pause/result overlays if you want it click-through-safe;
60 sits above HUD. Verify it doesn't overlap the rocket button (bottom-right) during a fight — if it
does, only show it on menus (`body.menu`) or nudge it up. **Open check:** confirm no clash with the
bottom-right rocket cooldown control during gameplay; if it clashes, gate with `body.menu #fullscreen-btn`.

**1d. Update the click wiring** at `client/index.html:3425`. The old
`document.querySelectorAll('.fullscreen-btn')` now matches nothing — replace with:

```js
document.getElementById('fullscreen-btn').addEventListener('click', requestFullscreen);
```

---

## Step 2 — Icon-only label / i18n

The button text is just `⛶`; the words become the tooltip/aria-label.

- In JS (near the i18n apply step, or right after the button wiring in Step 1d), set the accessible name
  from the existing key, e.g.:
  ```js
  const fsBtn = document.getElementById('fullscreen-btn');
  const fsLabel = (window.t ? window.t('ui.fullscreen') : 'Full screen').replace(/^⛶\s*/, '');
  fsBtn.setAttribute('aria-label', fsLabel);
  fsBtn.setAttribute('title', fsLabel);
  ```
  (Use whatever the project's translate helper is — check how `i18n.js` exposes lookups; strip the
  leading `⛶ ` so the tooltip reads just the words.) Re-apply on language change if the lang switcher
  re-runs i18n.
- **Update `client/locales/source.json:73`** context to note it's now an icon button's aria-label/title
  (glyph lives in markup, translate only the words). The English source can drop the leading glyph
  ("Full screen"); ru.json:73 likewise → "Во весь экран". Keep both keys in sync.

---

## Step 3 — Hide when already fullscreen

Add a `fullscreenchange` listener that toggles `body.fs` (the CSS in Step 1c hides the button when set):

```js
function syncFsClass() {
  document.body.classList.toggle('fs', !!document.fullscreenElement);
}
document.addEventListener('fullscreenchange', syncFsClass);
document.addEventListener('webkitfullscreenchange', syncFsClass);
syncFsClass(); // initial state
```

Place it near `requestFullscreen` (`client/index.html:3417-3425`).

---

## Step 4 — Force landscape on phones

**4a. Rotate-to-landscape cover (markup)** — add before `</body>`:

```html
<!-- Touch-only: shown when the phone is held in portrait (see CSS). Forces landscape play.
     Icon only, no text — the landscape-oriented layout is its own cue, so nothing to explain. -->
<div id="rotate-cover" class="touch-only" aria-hidden="true">
  <div class="rotate-icon">📱↻</div>
</div>
```

No label and **no i18n key** — a rotate glyph is enough (the menus/HUD are laid out for landscape, so a
sideways screen self-explains). If accessibility needs a name later, add an `aria-label` in JS rather
than visible text.

**4b. CSS** — cover the screen only on touch + portrait, above everything:

```css
#rotate-cover {
  position: fixed; inset: 0; z-index: 9999;
  display: none; align-items: center; justify-content: center;
  background: #05080f;
}
#rotate-cover .rotate-icon { font-size: 64px; opacity: .9; }
/* Show only on touch devices held in portrait. */
@media (orientation: portrait) {
  body.touch #rotate-cover { display: flex; }
}
```

(Uses the existing `touch-only`/`body.touch` gate plus an orientation media query — note `.touch-only`
sets `display:none` by default at `:95`, so `#rotate-cover` needs its own `display:flex` in the media
query as above; it overrides because of the more specific `body.touch` + media context. Verify the
cascade in the browser.)

**4c. Best-effort orientation lock + auto-pause (JS)** — add near the resize handler
(`client/index.html:3295`) / fullscreen code:

```js
// Best-effort: lock to landscape where supported (Android in fullscreen). iOS Safari ignores this —
// the #rotate-cover (CSS) is the reliable fallback.
function lockLandscape() {
  const o = screen.orientation;
  if (o && o.lock) { try { const r = o.lock('landscape'); if (r && r.catch) r.catch(() => {}); } catch {} }
}
// Try after entering fullscreen (lock often requires fullscreen): call lockLandscape() at the end of
// requestFullscreen()'s success path.

// Auto-pause a live fight when rotated to portrait (mirrors autoPauseOnBlur at :2646).
function autoPauseOnPortrait() {
  if (isTouch && matchMedia('(orientation: portrait)').matches
      && gameStarted && player && player.alive && !levelRunner.won && !paused) {
    setPaused(true);
  }
}
addEventListener('orientationchange', autoPauseOnPortrait);
matchMedia('(orientation: portrait)').addEventListener?.('change', autoPauseOnPortrait);
```

Wire `lockLandscape()` into the `requestFullscreen()` success path (after `req.call(el)` resolves) so
Android locks once fullscreen. Do not depend on it for iOS.

(No i18n for the cover — it's icon-only by design; see 4a.)

---

## Docs to update (required by project workflow)

- **`docs/CHANGELOG.md`** — bullet under today's date: *"**Mobile landscape + floating fullscreen
  button**: phones are forced to landscape (rotate-to-landscape cover + best-effort
  `screen.orientation.lock`, auto-pause on portrait); the four inline '⛶ Full screen' buttons are
  replaced by one fixed, icon-only, brighter button in the bottom-right that hides once fullscreen."*
- **`docs/SUMMARY.md`** — update the **Controls → "Touch (mobile browsers)"** and **"Full screen"**
  descriptions: single bottom-right icon button, hidden when fullscreen; landscape-only on phones with
  the rotate cover. Bump `**Updated:**`.
- **`docs/DECISIONS.md`** — add an entry only if you want to record *why* landscape is enforced via a
  CSS cover rather than relying on `screen.orientation.lock` (iOS unsupported). Recommended, short.

---

## Verification

Use the project's headless Playwright render (`client/visual/`, see the "Headless visual verify"
memory — `screencapture` is blocked, render `index.html` via Playwright). Capture:

1. **Phone landscape** (e.g. 844×390): floating ⛶ visible bottom-right, no rotate cover.
2. **Phone portrait** (e.g. 390×844): rotate cover fills the screen; the fight is paused.
3. **Desktop** (e.g. 1440×900): no ⛶ button, no cover (not touch).
4. After triggering fullscreen (or simulating `document.fullscreenElement`/`body.fs`): ⛶ button hidden.

Confirm the floating button does not overlap the in-fight rocket button (Step 1c open check).
