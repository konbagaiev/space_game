# Full-screen button available in-game (active + paused), and stale-`body.fs` fix

**Feature ID:** 2026-07-04-1008-fullscreen-btn-on-pause
**Area:** touch / mobile — floating full-screen button + `body.fs` sync
**Files:** `client/styles.css`, `client/src/welcome.js`, `client/visual/scenarios/15-mobile-landscape.mjs`, docs.

---

## Goal

On a phone, when the player backgrounds the browser and returns, the mobile browser silently drops out
of fullscreen and the address-bar/chrome reappears — but the floating **⛶ Full-screen** button
(`#fullscreen-btn`) is unavailable to re-enter fullscreen, so the player is stuck with reduced screen. Two
causes, fixed together: (1) the button is CSS-gated to **menus only** (`body.touch.menu`), so it never
shows during a battle; (2) `body.fs` (which hides the button once fullscreen) is only re-synced on the
`fullscreenchange` event, which mobile browsers frequently **don't deliver while the tab is
backgrounded** — so after restore `document.fullscreenElement` is `null` but `body.fs` stays `true`,
hiding the button even though we're no longer fullscreen. After this change the ⛶ button (on devices with
a working Fullscreen API) is visible **whenever the HUD is up — during active combat and while paused —
as long as we're not already fullscreen**, positioned just left of the rocket button and raised clear of
the phone's bottom chrome; and `body.fs` re-syncs whenever the page returns to the foreground so the
button reliably reappears. On iPhone Safari (no Fullscreen API), the same **"Add to Home Screen" hint
pill** (`#a2hs-hint`) now also shows in-game (not just on menus) whenever not launched standalone.

## Decisions (chosen — do not re-ask)

- **Scope: in-game active AND paused** (not paused-only). Gate the ⛶ button to *touch + working FS API +
  HUD-showing (`body.touch:not(.menu)` and existing `body.touch.menu`) + `body:not(.fs)` +
  `body:not(.no-fs-api)`*. The maintainer broadened this beyond the original paused-only request.
- **`body.menu` is the menu/in-game signal.** It is added on the welcome screen and Main Window
  (`client/src/welcome.js:54`, `client/src/mainwindow.js:37`) and removed when gameplay HUD is up
  (`client/src/welcome.js:136`, `client/src/mainwindow.js:61`,`:176`). No new class is needed — in-game =
  `body.touch:not(.menu)`, menu = `body.touch.menu`.
- **In-game ⛶ placement: bottom-right, LEFT of the rocket, raised.** Rocket is `right:28px; bottom:40px;
  84×84` (left edge ≈ 112px from the right edge; vertical band bottom 40–124). ⛶ is 46×46. Start at
  `right:120px; bottom:58px` (⛶ near-edge at 120px from right vs rocket's left edge at 112px → ~8px gap;
  ⛶ vertical center ≈ bottom 81px, aligned with the rocket's center at bottom 82px; and `bottom:58` is
  well above the ~14px zone that phone chrome/popups cover). **The implementer MUST verify on the touch
  harness** that the ⛶ is (a) visibly clear of the rocket with a real gap and (b) not clipped by the
  bottom safe-area / browser bar, and bump `right` toward ~124px and/or `bottom` if it looks tight. Menu
  placement is unchanged (`right:14px; bottom:14px`).
- **Menu appearance unchanged.** The button keeps its existing look and bottom-right menu position; only
  the *in-game* instance moves left-of-rocket.
- **iPhone / no-FS-API: show the a2hs pill in-game too**, gated `body.touch.no-fs-api:not(.standalone)`
  (both menu and in-game), staying hidden once standalone. It stays **non-interactive**
  (`pointer-events:none`). In-game it can't sit where the 46px ⛶ goes (it's up to 230px wide), so give it
  a distinct in-game position clear of the rocket/pause/zoom controls (below the top-left settings gear).
- **Accidental-tap safety.** Because the ⛶ now shows during ACTIVE combat next to the rocket, enforce a
  real horizontal gap from the rocket hit area (above) so it never sits under the thumb's rocket path.
  Harm from a stray tap is low (it only re-enters fullscreen, a no-op if already fullscreen), but the gap
  keeps it from interfering with firing/boost.
- **`body.fs` re-sync triggers:** `visibilitychange` (only when `!document.hidden`), plus `pageshow` and
  window `focus` as belt-and-suspenders. (Touch auto-pause on blur already exists in
  `client/src/sim.js:670` `autoPauseOnBlur`; these new listeners are independent and live in
  `welcome.js`.)

---

## Steps

### 1. Re-sync `body.fs` on foreground — `client/src/welcome.js`

Current block (around lines 121–128):

```js
document.getElementById('fullscreen-btn').addEventListener('click', requestFullscreen);
// Hide the floating button once we're actually fullscreen (toggles body.fs; CSS hides it).
function syncFsClass() {
  document.body.classList.toggle('fs', !!document.fullscreenElement);
}
document.addEventListener('fullscreenchange', syncFsClass);
document.addEventListener('webkitfullscreenchange', syncFsClass);
syncFsClass(); // initial state
```

Add three foreground re-sync listeners **before** the final `syncFsClass()` call:

```js
document.addEventListener('fullscreenchange', syncFsClass);
document.addEventListener('webkitfullscreenchange', syncFsClass);
// Mobile browsers often DON'T deliver fullscreenchange while the tab is backgrounded, so after a
// minimize→restore `body.fs` can be stale-true (document.fullscreenElement is null but the class stuck),
// which hides the ⛶ button just when the player needs it. Re-sync whenever the page returns to the
// foreground so the button reliably reappears.
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFsClass(); });
window.addEventListener('pageshow', syncFsClass);
window.addEventListener('focus', syncFsClass);
syncFsClass(); // initial state
```

No other JS changes are needed — `#fullscreen-btn` already exists in markup
(`client/index.html:196`) and its click handler already calls `requestFullscreen`.

### 2. CSS — show ⛶ in-game, re-place it, and extend the a2hs pill — `client/styles.css`

The relevant block is ~lines 168–200. Current rules:

```css
  #fullscreen-btn {
    position: fixed; right: 14px; bottom: 14px; z-index: 60;
    ...
  }
  body.touch.menu #fullscreen-btn { display: flex; }   /* show on touch menus … */
  body.fs #fullscreen-btn { display: none !important; } /* … but hide once fullscreen */
  #fullscreen-btn:active { background: rgba(60,85,150,.7); }
  ...
  body.no-fs-api #fullscreen-btn { display: none !important; }
  #a2hs-hint {
    position: fixed; right: 14px; bottom: 14px; z-index: 60;
    max-width: 230px; ...
    pointer-events: none;
  }
  ...
  body.touch.menu.no-fs-api #a2hs-hint { display: flex; }
  body.standalone #a2hs-hint { display: none !important; }
```

**2a.** Change the ⛶ show gate from menus-only to all touch (menu + in-game). Replace:

```css
  body.touch.menu #fullscreen-btn { display: flex; }   /* show on touch menus … */
```

with:

```css
  /* Show on touch whenever the HUD/menu is up — menus AND in-game (active + paused). The body.fs and
     body.no-fs-api rules below still hide it (they win via !important). See DECISIONS §44. */
  body.touch #fullscreen-btn { display: flex; }
  /* In-game (HUD up, i.e. not a menu): move it just LEFT of the bottom-right rocket button and raise it
     clear of the phone's bottom browser bar. Rocket = right:28 bottom:40 84×84 (left edge ~112px from
     right); ⛶ near-edge sits at ~120px from right (≈8px gap), center vertically aligned with the rocket.
     VERIFY on the touch harness and nudge right→~124 / bottom if the gap looks tight or it's clipped. */
  body.touch:not(.menu) #fullscreen-btn { right: 120px; bottom: 58px; }
```

Keep the base `#fullscreen-btn { right:14px; bottom:14px; ... }` rule as-is — it now serves the **menu**
placement (`body.touch.menu` inherits the base position; only `:not(.menu)` overrides it). Leave the
`body.fs #fullscreen-btn { display:none !important }` and `body.no-fs-api #fullscreen-btn { display:none
!important }` rules untouched — they must still win.

**2b.** Extend the a2hs pill to show in-game and reposition it there. Replace:

```css
  body.touch.menu.no-fs-api #a2hs-hint { display: flex; }
  body.standalone #a2hs-hint { display: none !important; }
```

with:

```css
  /* iPhone Safari has no Fullscreen API, so "not in fullscreen" ≈ "not launched standalone" — show the
     Add-to-Home-Screen hint whenever NOT standalone, on menus AND in-game (active + paused). Non-
     interactive (pointer-events:none), so it never blocks controls. See DECISIONS §44. */
  body.touch.no-fs-api:not(.standalone) #a2hs-hint { display: flex; }
  body.standalone #a2hs-hint { display: none !important; }
  /* In-game the wide pill (max-width 230) can't sit where the 46px ⛶ goes; tuck it under the top-left
     settings gear, clear of the rocket (bottom-right), pause button (top-center) and zoom (mid-right).
     VERIFY on the harness it doesn't overlap the gear/minimap and nudge if needed. */
  body.touch:not(.menu).no-fs-api #a2hs-hint { right: auto; bottom: auto; left: 14px; top: 56px; }
```

(The base `#a2hs-hint` rule keeps `right:14px; bottom:14px` for the menu placement; only `:not(.menu)`
overrides it.)

### 3. Sanity-check the menu behavior is unchanged

- On a touch **menu**: ⛶ shows bottom-right (`right:14;bottom:14`) exactly as before; a2hs pill (no-fs-api)
  shows bottom-right as before. No visual regression on menus.
- On a **desktop** (non-touch): `#fullscreen-btn` default is `display:none` and no `body.touch` rule
  applies → stays hidden. Unchanged.

---

## Tests

Server tests are **not** touched by this change (client-only CSS/JS). Client tests:

- `cd client && node --test` — unit/logic tests (unaffected; run to confirm green).
- `cd client && node visual/run.mjs` (or the project's visual-suite command) — the visual suite has a
  **known-flaky baseline (~6 scenarios fail even on clean `main`)**; judge by the reliably-passing set +
  **zero page errors**, not a fully-green run. The two relevant scenarios are `06-pause`,
  `07-mobile-hangar`, and `15-mobile-landscape`.

**Add DOM-level assertions to `client/visual/scenarios/15-mobile-landscape.mjs`** (the mobile/fullscreen
scenario; the runner context is *not* a real touch device, so assert the CSS gating by toggling body
classes and reading computed styles — the same technique the file already uses for `body.rot`). Append a
block after the existing rotation assertions:

```js
  // --- Full-screen button: available in-game (not just menus), hidden when fullscreen, and body.fs
  //     re-syncs on foreground (DECISIONS §44 / this plan). ---
  const fsBtn = await page.evaluate(() => {
    const body = document.body;
    const btn = document.getElementById('fullscreen-btn');
    const rocket = document.getElementById('rocket-btn');
    const disp = () => getComputedStyle(btn).display;
    // simulate an in-game touch device: touch on, not a menu, not fullscreen, FS API present
    body.classList.add('touch');
    body.classList.remove('menu', 'fs', 'no-fs-api', 'standalone');
    const shownInGame = disp() !== 'none';
    const bRect = btn.getBoundingClientRect();
    const rRect = rocket.getBoundingClientRect();
    // ⛶ sits to the LEFT of the rocket with a gap (no overlap)
    const leftOfRocketWithGap = bRect.right < rRect.left;
    // on a menu it still shows (bottom-right)
    body.classList.add('menu');
    const shownOnMenu = disp() !== 'none';
    body.classList.remove('menu');
    // hidden once fullscreen
    body.classList.add('fs');
    const hiddenWhenFs = disp() === 'none';
    // stale-fs fix: with body.fs set but no real fullscreenElement, a foreground visibilitychange must
    // clear body.fs (syncFsClass toggles off since document.fullscreenElement is null in this context)
    document.dispatchEvent(new Event('visibilitychange'));
    const fsClearedOnForeground = !body.classList.contains('fs');
    // no-fs-api (iPhone): ⛶ hidden, a2hs pill shown in-game
    body.classList.remove('fs');
    body.classList.add('no-fs-api');
    const hiddenNoFsApi = disp() === 'none';
    const a2hsShownInGame = getComputedStyle(document.getElementById('a2hs-hint')).display !== 'none';
    // cleanup
    body.classList.remove('touch', 'no-fs-api');
    return { shownInGame, leftOfRocketWithGap, shownOnMenu, hiddenWhenFs, fsClearedOnForeground, hiddenNoFsApi, a2hsShownInGame };
  });
  assert.ok(fsBtn.shownInGame, 'fullscreen button shows in-game on touch (not just menus)');
  assert.ok(fsBtn.leftOfRocketWithGap, 'in-game fullscreen button sits left of the rocket, no overlap');
  assert.ok(fsBtn.shownOnMenu, 'fullscreen button still shows on touch menus');
  assert.ok(fsBtn.hiddenWhenFs, 'fullscreen button hides once fullscreen (body.fs)');
  assert.ok(fsBtn.fsClearedOnForeground, 'body.fs is re-synced (cleared) when the page returns to foreground');
  assert.ok(fsBtn.hiddenNoFsApi, 'no-fs-api hides the ⛶ button');
  assert.ok(fsBtn.a2hsShownInGame, 'no-fs-api shows the Add-to-Home-Screen pill in-game');
```

Notes for the implementer:
- The `fsClearedOnForeground` assertion is the direct DOM-level proof of the stale-`body.fs` fix: in the
  headless runner `document.fullscreenElement` is `null`, so a `visibilitychange` (with `!document.hidden`)
  must run `syncFsClass()` and strip a manually-set `body.fs`. This requires the `visibilitychange`
  listener from Step 1 to be registered at load — it is (module-level in `welcome.js`).
- Restore body classes at the end of the `evaluate` (as above) so later scenarios aren't polluted.
- If `rocket-btn`'s computed layout in the non-touch runner makes `getBoundingClientRect()` unreliable
  (e.g. `display:none` on a menu), first ensure `body.menu` is removed (done above) so the HUD rocket is
  laid out; if it's still zero-sized, fall back to asserting the *CSS offset* (`getComputedStyle(btn).right`
  parses to > 100px in-game vs `14px` on a menu) instead of the geometric overlap.

---

## Docs to update

- **`docs/SUMMARY.md`** — the touch-controls / fullscreen section (~lines 133–159, the "floating
  Full-screen button" paragraph). Update to say the ⛶ button now shows **in-game (active + paused), not
  just on menus**, positioned just left of the rocket and raised clear of the bottom chrome; that it hides
  once fullscreen **and** re-syncs `body.fs` on foreground (`visibilitychange`/`pageshow`/`focus`) so it
  reappears after a mobile minimize→restore; and that the no-fs-api a2hs pill now also shows in-game
  (gated `body.touch.no-fs-api:not(.standalone)`). Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`** — add a bullet under a `## 2026-07-04` heading (create if missing):
  *"**Full-screen button available mid-battle on mobile.** The floating ⛶ button now shows during active
  combat and pause (not just menus) — placed left of the rocket and raised above the phone's bottom
  chrome — so after backgrounding/restoring the browser (which drops fullscreen) the player can re-enter
  without leaving the fight. Fixed a stale-`body.fs` bug where the button stayed hidden after restore
  because `fullscreenchange` isn't delivered to a backgrounded tab: `body.fs` now re-syncs on
  `visibilitychange`/`pageshow`/`focus`. On iPhone (no Fullscreen API) the Add-to-Home-Screen hint pill
  now also shows in-game. See DECISIONS §44."*
- **`docs/DECISIONS.md`** — add **§44** (next free number; §43 is the last). Record the real trade-off:
  showing a fullscreen control (and, on iPhone, a persistent a2hs pill) **over live combat**. Reasoning:
  mobile browsers exit fullscreen and restore chrome on backgrounding without firing `fullscreenchange`
  to the hidden tab, so gating the button to menus left players unable to recover mid-battle; the button
  is low-harm (only re-enters fullscreen, a no-op if already fullscreen) and is kept clear of the rocket
  thumb-path by an explicit gap, so surfacing it in-game is worth the small extra HUD element. Chose
  `body.touch:not(.menu)` (the existing menu/in-game signal) rather than gating on `body.paused` so the
  affordance covers both active and paused play. Noted the alternative (paused-only) was rejected as
  narrower than the actual failure mode.

---

## Out of scope / non-goals (DECISIONS §30 — keep it simple)

- **No new body class or JS state machine.** Reuse the existing `body.menu` (in-game vs menu) and
  `body.fs`/`body.no-fs-api`/`body.standalone` classes; do not invent a `body.paused`-based gate (paused
  is a subset of in-game and already covered).
- **No change to the auto-pause-on-blur behavior** (`autoPauseOnBlur`, `sim.js:670`) — it already pauses
  touch battles on backgrounding; this feature only makes the fullscreen affordance reachable.
- **No redesign of the rocket / pause / zoom / a2hs visuals or the menu placement.** Only add the in-game
  variants and the ⛶ re-position.
- **No attempt to force fullscreen programmatically on restore** (blocked by browsers without a user
  gesture) — the fix is to make the button reappear so the player taps it.
- **No server changes**, no new assets/models (so **no `/publish-itch` step** is needed — no catalog or
  glb hash changes).
