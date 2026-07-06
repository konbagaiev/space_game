# Return-to-base button

**Feature ID:** 2026-07-06-2044-return-to-base-button
**Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-07-06-2044-return-to-base-button`

## Goal

After the last enemy of a mission is destroyed, the game enters **return-to-base**: a blue homing arrow
points home, a top-center "Sector cleared — return to base" hint appears, and the base station becomes a
clickable dock target. Today the only way to trigger the auto-fly-home-and-dock is to **click/tap the
station model itself**, which is small, off-origin at `(-60,-60)`, and often off-screen. This feature adds a
clear, always-on-screen **"Return to base" pill button at the bottom-center of the screen** as an explicit
tap target. Clicking it does exactly what clicking the station does — it calls `engageAutopilot()`, so the
ship autopilots home and docks, ending the mission. The button appears only while return-to-base is
available and the ship is still under player control, and hides itself the moment the autopilot engages (so
it doesn't clutter the screen during the flight home). The label is English via i18n (`ui.return.button`),
so it localizes like the rest of the chrome.

## Decisions (already settled — do not re-ask)

1. **Keep the existing top-center hint AND add the bottom button.** Do **not** touch `el.returnHint`,
   `#return-hint` CSS, `updateReturnHint`'s hint logic, or the `ui.return.hint` string. The top hint stays
   ambient guidance; the bottom button is the explicit tap target. They sit on opposite screen edges and
   don't collide.
2. **Visibility = `stationClickable()` is true AND autopilot is NOT active.** Concretely: show the button
   when `G.returnToBase && G.baseStation && G.baseStation.active && G.player && G.player.alive &&
   !levelRunner.won` (same predicate as `stationClickable()` in `main.js`) **and** the result overlay is
   hidden **and** `!G.autopilot.active`. The autopilot flag is `G.autopilot.active` (boolean on the shared
   bag — see `client/src/state.js:62`, `autopilot: { active: false, phase: 'brake0', target: null }`). Once
   `engageAutopilot()` sets `G.autopilot.active = true`, the button hides. If the player cancels autopilot
   mid-flight with a control input (`G.autopilot.active` flips back to false while still in return-to-base),
   the button reappears — **this flicker-back is accepted/intended.**
3. **Show on both desktop and touch.** Position it horizontally centered near the bottom, above the touch
   `#stick-zone` (which is full-screen `pointer-events:auto` at z-5, per DECISIONS §42), and clear of the
   bottom-right rocket button. It must be interactive (`pointer-events: auto`, z-index like `#rocket-btn`).
   This creates a small steering dead-zone at bottom-center **only during the enemy-free return phase** —
   accepted.
4. **Label:** English base text **"Return to base"**, i18n key **`ui.return.button`**.
5. **The activation must not be treated as a "manual control input", and touch must fire on `touchstart`
   (not a synthesized `click`) — DECISIONS §42.** The autopilot-cancel check in `update(dt)`
   (`sim.js:371-375`) only inspects `keys[...]` / `touchAim.active` / `_rocket` — neither a DOM `click` nor a
   `touchstart` on the button sets any of those, so `engageAutopilot()` engages cleanly without
   self-cancelling. **On touch, a bare `click` is broken**: it's suppressed while a second touch point is
   active, so a second-thumb tap on the button while a steering finger is held on `#stick-zone` (very likely,
   since the button shows during manual flight home) would silently no-op — the same bug that killed the
   zoom +/- buttons "during flight". So the wiring is **split** (see Step 4): touch fires on `touchstart`
   (`e.preventDefault()`), and the `click` path is **mouse-only** (`if (!Device.hasTouch)`). Do **not** route
   activation through the canvas raycast; call `engageAutopilot()` directly.

## Steps

### 1. Add the DOM element — `client/index.html`

The return-to-base HUD nodes live together around line 186-189:

```html
<div id="markers"></div>
<div id="oob-warn"></div>
<div id="return-hint"></div>
<div id="banner"></div>
```

Add the button immediately **after** `<div id="return-hint"></div>` (index.html:188). Give it the
`data-i18n` attribute so the existing `applyTranslations()` boot + language-switch path localizes it (see
Step 5):

```html
<div id="return-hint"></div>
<button id="return-btn" data-i18n="ui.return.button">Return to base</button>
<div id="banner"></div>
```

Note: `applyTranslations()` (`client/src/welcome.js:65-73`, called from `main.js:629` and on language
switch) sets `textContent` for every `[data-i18n]` node, so the label is set once at boot + re-set on
EN/RU toggle. We do **not** set the text every frame in `updateReturnHint` — that function only toggles
`display`.

### 2. Register the node — `client/src/dom.js`

In the `el` inventory (`client/src/dom.js:41-42`), right after the `returnHint` entry, add:

```js
  // "Sector cleared — return to base" hint shown during return-to-base (updateReturnHint)
  returnHint: byId('return-hint'),
  // bottom-center "Return to base" tap button: engages the dock autopilot (updateReturnHint show/hide)
  returnBtn: byId('return-btn'),
```

`byId` fails loud if the id is missing, so this also verifies Step 1's markup.

### 3. CSS — `client/styles.css`

Add a rule for `#return-btn` next to the `#return-hint` block (which ends at `styles.css:723`). Insert
after line 723 (after the `#return-hint { ... }` closing brace, before the `#banner` comment at 724):

```css
  /* Bottom-center "Return to base" tap button (return-to-base). Explicit dock target, complements the
     top #return-hint. Interactive (pointer-events auto) and layered above the full-screen touch
     #stick-zone (z-5); horizontally centered, clear of the bottom-right #rocket-btn. Shown/hidden by
     updateReturnHint (display none by default). */
  #return-btn {
    position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); z-index: 6;
    display: none; pointer-events: auto; cursor: pointer;
    font-family: system-ui, sans-serif; font-weight: 700; font-size: 16px; letter-spacing: .5px;
    color: #7ec8ff; background: rgba(8,12,24,.55); border: 1px solid rgba(126,200,255,.55);
    border-radius: 22px; padding: 11px 22px;
    box-shadow: 0 0 14px rgba(90,170,255,.35); text-shadow: 0 0 6px rgba(0,0,0,.8);
    -webkit-tap-highlight-color: transparent;
  }
  #return-btn:hover { background: rgba(18,26,44,.7); border-color: #7ec8ff; }
  #return-btn:active { filter: brightness(1.25); }
```

Also add `#return-btn` to the **menu-hide** list so it never shows on menus/overlays (matches how
`#return-hint` is hidden). At `styles.css:372` the selector reads:

```css
  body.menu #hud, body.menu #help, body.menu #perf, body.menu #rocket-btn, body.menu #event-log, body.menu #markers, body.menu #oob-warn, body.menu #return-hint, body.menu #banner, body.menu #minimap, body.menu #pause-btn, body.menu #pause-overlay, body.menu #zoom { display: none; }
```

Add `body.menu #return-btn` to that list (e.g. right after `body.menu #return-hint`).

**Bottom-position sanity:** `#rocket-btn` is `right:28px; bottom:40px; 84×84` (its left edge ≈ 112px from
the right). The centered `#return-btn` (≈150px wide, `bottom:34px`) stays clear of it on any phone width
≥ ~360px. The joystick has no fixed base (it appears at the touch-down point), so bottom-center is only a
dead-zone during the enemy-free return phase — accepted per Decision 3.

### 4. Show/hide + click wiring

**Show/hide — `client/src/sim.js`, `updateReturnHint()` (sim.js:293-299).** Extend the existing function to
also toggle the button. Do **not** change the hint lines. Replace the function body with:

```js
export function updateReturnHint() {
  const show = G.returnToBase && G.player && G.player.alive && !levelRunner.won
    && el.overlay.style.display === 'none';
  if (!show) { el.returnHint.style.display = 'none'; } else {
    el.returnHint.style.display = 'block';
    el.returnHint.textContent = t('ui.return.hint');
  }
  // Bottom-center "Return to base" tap button: same availability as the hint, but ALSO requires the
  // station to be clickable AND the autopilot NOT already engaged (hide it once the ship is flying home;
  // it re-appears if the player cancels the autopilot mid-flight — accepted). Mirrors stationClickable().
  const btnShow = show && G.baseStation && G.baseStation.active && !G.autopilot.active;
  el.returnBtn.style.display = btnShow ? 'block' : 'none';
}
```

Notes:
- `updateReturnHint()` is already called every frame from `main.js:467`, so no new call site is needed.
- The `show` predicate already covers `G.returnToBase`, `player.alive`, `!levelRunner.won`, and overlay
  hidden. Adding `G.baseStation.active` makes `btnShow` exactly `stationClickable() && overlayHidden &&
  !G.autopilot.active` — matching Decision 2. (`G.baseStation.active` is set true in `beginReturn()`
  (sim.js:105) and false in `win()`/`start()`.)
- `t` and `el` are already imported at the top of `sim.js` (lines 22-23).

**Activation handler — `client/src/main.js` (touch + mouse, split — this is the DECISIONS §42 pattern).**
`engageAutopilot` is already imported (main.js:21); `el` and `audio` are already imported/used (e.g.
main.js:53 `audio.sfx.uiClick()`). A **bare `click` listener is WRONG here** and must not be used: the
button is shown exactly while the player is under manual control during return-to-base — very plausibly
flying home with a steering finger held on the full-screen `#stick-zone`. A synthesized `click` is
**suppressed while a second touch point is active**, so a second-thumb tap on `#return-btn` would produce
no `click` and silently do nothing — the identical bug that killed the zoom +/- buttons "during flight"
(DECISIONS §42; fixed at main.js:213-219). Follow the FIRE/rocket/zoom pattern: fire on `touchstart` for
touch, keep `click` mouse-only.

1. **Touch path — inside the existing `if (Device.hasTouch) { ... }` block**, right after the zoom `touchstart`
   handlers (main.js:218-219, just before the block's closing `} else {` at main.js:220). Add:

   ```js
     // "Return to base" button on touch: fire on touchstart (like FIRE/rocket/zoom), NOT a synthesized
     // `click` — a click is suppressed while a 2nd touch point is down, so a second-thumb tap during flight
     // (steering finger on #stick-zone) would never fire (the DECISIONS §42 bug). preventDefault stops the
     // compat click so a lone tap doesn't double-engage. audio.sfx.uiClick() gives click-sound parity — the
     // global capture-phase click→uiClick (main.js:53) also won't fire during flight for the same reason.
     el.returnBtn.addEventListener('touchstart', e => { engageAutopilot(); audio.sfx.uiClick(); e.preventDefault(); }, { passive: false });
   ```

2. **Mouse path — guarded `if (!Device.hasTouch)`**, so it never double-fires alongside a compat click on
   touch (mirrors the zoom mouse-only guard at main.js:237-240). Add right after the existing
   `if (!Device.hasTouch) { ... }` zoom block (main.js:237-240):

   ```js
   // Mouse-only: on touch the "Return to base" button fires on `touchstart` (in the touch block above).
   if (!Device.hasTouch) {
     el.returnBtn.addEventListener('click', () => { engageAutopilot(); });
   }
   ```

   (The mouse `click` already routes through the global `uiClick` capture listener at main.js:53, so no
   explicit `uiClick()` is needed on this path.)

`engageAutopilot()` (sim.js:258-261) already guards on `G.returnToBase && player.alive && !won`, so an
errant activation is a safe no-op. A `touchstart`/`click` on this DOM button is **not** a "manual control
input" — `update()`'s autopilot-cancel check (sim.js:371-375) only inspects `keys[...]` / `touchAim.active`
/ `_rocket`, none of which this sets — so it engages the autopilot cleanly without self-cancelling.

### 5. i18n key `ui.return.button`

**`client/locales/source.json`** — add after the `ui.return.hint` entry (source.json:10). Keep the trailing
comma correct:

```json
  "ui.return.hint": { "source": "Sector cleared — return to base", "context": "HUD hint shown after the last enemy is destroyed, directing the player to fly back to the base station to complete the mission." },
  "ui.return.button": { "source": "Return to base", "context": "Label on the bottom-center HUD button shown during return-to-base (after the last enemy is destroyed). Clicking it auto-flies the ship home to the base station to complete the mission — the same action as clicking the station model. Short, imperative." },
```

**`client/locales/ru.json`** — add the Russian translation after the `ui.return.hint` line (ru.json:10):

```json
  "ui.return.hint": "Сектор зачищен — вернитесь на базу",
  "ui.return.button": "Вернуться на базу",
```

(English is the source of truth per CLAUDE.md; RU is the only other bundle and must stay in sync — an
untranslated key would fall back to English on the RU build, which is acceptable but here we provide it.)

## Tests

- **Client unit tests:** `cd client && node --test`. No existing unit test covers `updateReturnHint`'s DOM
  toggling (it's DOM/canvas glue). Do **not** invent a brittle jsdom test for it — the visual suite is the
  right layer (DECISIONS §30, keep it simple). Just confirm the existing `node --test` suite still passes
  (the `autopilot-config` / `canDock` tests are unaffected — this change adds no simulation logic).
- **i18n coverage check:** if the repo has a test/lint that asserts every `[data-i18n]` key exists in
  `source.json` (grep for one under `client/test*` or `client/src/*.test.*`), run it — the new
  `ui.return.button` key must resolve. If none exists, no action.
- **Visual smoke (manual, optional):** the client visual suite has a flaky baseline (~6 scenarios fail at
  rest — not regressions; judge by the reliably-passing set + zero page errors). Adding a hidden-by-default
  button should not change any baseline screenshot (it's `display:none` until return-to-base). If a
  return-to-base scenario exists, confirm the button appears bottom-center after the last kill and
  disappears once the ship starts flying home.

No server changes — `server && npm test`, `db.js` / `db_postgres.js` are **not touched** by this feature.

## Docs to update

- **`docs/SUMMARY.md`** — in the **"Return-to-base mission end (all missions)"** bullet (SUMMARY.md:730-745),
  where it describes the hint + arrow + clickable station, add a sentence: a **bottom-center "Return to
  base" pill button** (`#return-btn`, i18n `ui.return.button`, toggled in `updateReturnHint`) is also shown
  as an explicit tap target — same effect as clicking the station (`engageAutopilot()`); it's visible only
  while return-to-base is available and the ship is still under player control (`stationClickable()` &&
  `!G.autopilot.active`), and hides once the autopilot engages. Bump the `**Updated:**` date at the top of
  SUMMARY.
- **`docs/CHANGELOG.md`** — add a bullet under today's date `## 2026-07-06` (create the heading if missing,
  newest on top): **"Return-to-base button"** — a bottom-center "Return to base" pill button now appears
  after the last enemy is destroyed, giving players an obvious on-screen tap target to auto-fly home and
  dock (the base station is small and often off-screen). Shown only while return-to-base is available and
  the ship is under player control; hidden once the autopilot engages. New i18n key `ui.return.button`
  (EN + RU).
- **`docs/DECISIONS.md`** — **no new entry.** This is a small UI affordance with no real trade-off; per
  DECISIONS §30 (keep it simple), don't manufacture one. (The already-settled "hide while autopiloting"
  choice is captured in this plan + SUMMARY, which is enough.)

## Out of scope / non-goals

- Do **not** change, restyle, or reposition the existing top-center `#return-hint` / `ui.return.hint`.
- Do **not** change the station raycast/dock cursor logic, `stationClickable()`, `engageObjectAt`, or the
  autopilot flight/`canDock` behavior — the button reuses `engageAutopilot()` verbatim.
- No animation/pulse/fade-in on the button — a static `display:block`/`none` toggle is enough.
- No new sound effect on click (docking already has its arrival flow).
- No confirmation dialog, no "cancel autopilot" button — cancelling via a control input already exists.
- No server / DB / catalog changes; no model or content-hashed asset changes (so **no `/publish-itch`
  step** — nothing bundled in the itch ZIP changes).
- Don't build a general HUD-button framework — one button, inline, matching existing HUD styling.
