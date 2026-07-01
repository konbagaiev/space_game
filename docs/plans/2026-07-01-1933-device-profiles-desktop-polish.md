# Client device-support architecture (iteration 1 of 2) + desktop Main Window polish

**Feature ID:** 2026-07-01-1933-device-profiles-desktop-polish
**Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-07-01-1933-device-profiles-desktop-polish`
**Status:** ready to implement

## Goal

Replace the single `isTouch` boolean with a proper, extensible **two-axis device model** in one new
module `client/src/device.js` — an **input** capability axis (`touch | mouse`, ~constant per session)
and a **form** factor axis (`phone | tablet | desktop | desktop-lg`, recomputed on resize) — each with a
single source of truth, projecting onto mutually-exclusive body classes so CSS can key off them. In the
**same** change, apply a set of desktop-browser (PC) polish fixes to the campaign-briefing **Main Window**
(`#mainwin`): larger mission title/text, non-stretched Loadout/Stash/Shop buttons, the granted-item 3D
icon centered below the text, doubled ship-characteristics fonts, and a Take-off button that follows the
content instead of pinning to the page bottom. User-visible effect: the desktop Main Window reads cleanly
(sized for a monitor, item + Take-off flow under the text); mobile/touch is unchanged.

**This is iteration 1 of 2.** It introduces the architecture + the listed desktop CSS fixes ONLY. It does
**NOT** implement full resize-driven adaptation of every screen — that is a separate next iteration. The
architecture is built so iteration 2 can add resize adaptation cleanly (the `form` axis already recomputes
on resize/orientationchange; layout keys off `body.dev-*`, never raw `isTouch`). See DECISIONS entry added
by this plan.

## Decisions (settled — do not re-ask)

- **Form breakpoints** (classified off the viewport's **longest edge** `max(innerWidth, innerHeight)`, so
  orientation never flips the form): `phone < 900 ≤ tablet < 1280 ≤ desktop < 1920 ≤ desktop-lg`.
- **Axes are independent.** `input` (mouse can still be `phone`/`tablet` form in a narrow window; a touch
  device on a big screen can still be `desktop`). `input` is ~constant per session; `form` is reactive.
- **Body classes:** mutually-exclusive `dev-phone | dev-tablet | dev-desktop | dev-desktop-lg` +
  `input-touch | input-mouse`. Keep **`body.touch`** as a compatibility alias (set when `input-touch`) so
  the existing touch CSS/rotation/fullscreen rules are NOT rewritten.
- **`FS_API` / `STANDALONE` move into `device.js`** (were `main.js:60-61`) — consolidated with the other
  capability flags; `device.js` sets the `standalone` / `no-fs-api` body classes (touch-only, same behavior
  as today).
- **Single source of truth = `Device`.** All consumers migrate to import from `device.js`; engine.js uses
  `Device.hasTouch` internally. We do **NOT** keep an `isTouch` re-export from `engine.js` — every consumer
  is migrated, so a re-export would be dead code (DECISIONS §30). (The brief allowed a re-export "for
  back-compat"; it's unnecessary here since the migration is complete.)
- **Part B desktop polish scope:** applies to **both** `body.dev-desktop` **and** `body.dev-desktop-lg`
  (the non-phone/non-tablet forms). `phone`/`tablet` and the existing `@media (max-width:760px)` mobile
  override are left untouched. `desktop-lg`-specific tuning is deferred to iteration 2.
- **`canHover`** (`matchMedia('(hover: hover)')`) is exposed on `Device` for iteration 2 but the shop
  (i)/hover reveal is **left as-is** (still driven by the `body.touch` alias). Do NOT rewire the shop now.
- **Ship-stats strip:** try **one line at ×2** first; add a borderless key/value **grid fallback ONLY IF**
  it doesn't fit in the ~25% column — settled by Playwright (concrete steps below).

## Background — where things are today

- Detection: `client/src/engine.js:25` (`export const isTouch = matchMedia('(pointer: coarse)').matches
  || ('ontouchstart' in window)`), plus an early duplicate `_touchEarly` at `client/src/state.js:13` used
  for the first-run quality default (`state.js:20`, `loadTier(store, _touchEarly)`).
- `isTouch` consumers: `graphics.js:32` (param), `sim.js:511` (auto-pause on blur), `mainwindow.js:57` &
  `:171` (fullscreen-on-tap), `welcome.js:133` (fullscreen-on-tap), `main.js:99` (touch-controls +
  `body.touch` gate), `engine.js:56` (portrait→landscape rotation).
- `FS_API` / `STANDALONE`: `main.js:60-61`; used at `main.js:101-102` to set `body.standalone` /
  `body.no-fs-api`.
- Resize path: `engine.js:55 applyOrientation()` (the single renderer-sizing point) is wired at
  `main.js:432-433` to `resize` + `orientationchange`, and called once at import (`engine.js:63`).
- Main Window CSS: `client/styles.css` (mission view lines 111-129; `.mw-item` / `.mw-shop-item` 88-98;
  `#ship-stats` 210-216; welcome/`#mw-go` shared rule 145-151; the mobile override `@media (max-width:760px)`
  230-234). Main Window HTML: `client/index.html:53-99`.
- Item-viewer JS: `client/src/mainwindow.js` — `showShowcaseItem` (304-320), `resizeViewer` (217-224),
  `resizeViewers` (322-324). The `#mw-item` canvas + `#mw-item-strut` live inside `#mw-mission-desc`
  (`index.html:72-76`, source order strut → canvas → text span).

---

## Part A — Device architecture

### Step A1 — new module `client/src/device.js`

Create `client/src/device.js`. It must be **import-safe under `node --test`** (no crash when `window` /
`document` are absent — mirror the `audio.js` convention), so guard every global and expose a **pure**
`classifyForm(longest)` for unit testing.

```js
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

// PURE: form factor from the viewport's LONGEST edge (so orientation never flips the form). Unit-tested.
export function classifyForm(longest) {
  if (longest < 900) return 'phone';
  if (longest < 1280) return 'tablet';
  if (longest < 1920) return 'desktop';
  return 'desktop-lg';
}

export const Device = {
  hasTouch, canHover, FS_API, STANDALONE,
  input: hasTouch ? 'touch' : 'mouse',  // ~constant per session
  form: hasWindow ? classifyForm(Math.max(window.innerWidth, window.innerHeight)) : 'desktop',
};

const FORM_CLASSES = ['dev-phone', 'dev-tablet', 'dev-desktop', 'dev-desktop-lg'];

// Recompute the reactive `form` axis and (re)apply the body classes. The input axis + aliases are
// constant, but re-setting them is cheap and keeps this the single place that owns the classes. Called
// at module load AND from engine.applyOrientation() on resize/orientationchange. THIS ITERATION only
// sets the classes on a form change — acting on layout beyond CSS is deferred to iteration 2.
export function applyDevice() {
  if (!hasWindow || !document.body) return;
  Device.form = classifyForm(Math.max(window.innerWidth, window.innerHeight));
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
```

### Step A2 — `client/src/engine.js`

1. Add near the top imports (after `import { G } from './state.js';`, `engine.js:11`):
   ```js
   import { Device, applyDevice } from './device.js';
   ```
2. Delete the old detection line `engine.js:25`
   (`export const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);`).
   Do **not** re-export `isTouch`.
3. In `applyOrientation()` (`engine.js:55-62`): call `applyDevice();` as the **first** line (so the form
   axis + classes recompute on every resize/orientationchange), and change the rotation test at
   `engine.js:56` to read `Device.hasTouch`:
   ```js
   export function applyOrientation() {
     applyDevice();                                                  // recompute form axis + body classes
     G.rotated = Device.hasTouch && window.innerHeight > window.innerWidth; // touch device held in portrait
     document.body.classList.toggle('rot', G.rotated);
     const w = gameW(), h = gameH();
     camera.aspect = w / h;
     camera.updateProjectionMatrix();
     renderer.setSize(w, h);
   }
   ```
   (`engine.js:63 applyOrientation();` at import stays — it now also does the initial `applyDevice()`.)

### Step A3 — `client/src/state.js`

1. Add `import { Device } from './device.js';` next to the existing `import { loadTier, resolveTier } from
   './graphics.js';` (`state.js:10`). (No cycle: `device.js` imports nothing from the app.)
2. Delete the `_touchEarly` comment + const (`state.js:12-13`).
3. Change `state.js:20` to use `Device.hasTouch`:
   ```js
   gfx: resolveTier(loadTier(window.localStorage, Device.hasTouch)),
   ```

### Step A4 — migrate the remaining consumers

- `client/src/sim.js`: keep the engine import for `scene/camera/camOffset` at `sim.js:8` but remove
  `isTouch` from it; add `import { Device } from './device.js';`. Change `sim.js:511`'s `isTouch` →
  `Device.hasTouch`.
- `client/src/mainwindow.js`: replace the import at `:18` (`import { isTouch } from './engine.js';`) with
  `import { Device } from './device.js';`; change `:57` and `:171` `if (isTouch)` → `if (Device.hasTouch)`.
- `client/src/welcome.js`: replace the import at `:13` (`import { isTouch } from './engine.js';`) with
  `import { Device } from './device.js';`; change `:133` `if (isTouch)` → `if (Device.hasTouch)`.
- `client/src/main.js`:
  - Import line `:10`: remove `isTouch` from the engine import; add `import { Device } from './device.js';`
    (keep the rest of the engine import — `scene, skyScene, camera, renderer, camOffset, toGame,
    applyOrientation, zoomBy, tickZoom`).
  - Delete the `FS_API` / `STANDALONE` consts + their comment (`main.js:55-62`) — now on `Device`.
  - In the touch-controls block (`main.js:99-104`), change `if (isTouch) {` → `if (Device.hasTouch) {`
    and **delete** the three body-class lines that moved to `device.js`:
    - `document.body.classList.add('touch');` (`:100`)
    - `if (STANDALONE) document.body.classList.add('standalone');` (`:101`)
    - `else if (!FS_API) document.body.classList.add('no-fs-api');` (`:102`)
    Keep the touch-control DOM wiring (`#touch`.classList.add('on'), hide `#help`, the stick/fire setup)
    inside the `if (Device.hasTouch)` block unchanged. Update the stale comment at `main.js:52` that
    mentions `isTouch` living in engine.js (point it at `device.js`).
- `graphics.js`: **no change** (`loadTier(store, isTouch = false)` is just a param name; the caller now
  passes `Device.hasTouch`).

After A2-A4, verify no file still imports `isTouch` (there should be zero matches for
`import { ... isTouch ... }`).

---

## Part B — Desktop (PC browser) Main Window fixes

All Part B rules are **new, additively scoped** to `body.dev-desktop` and `body.dev-desktop-lg` so mobile/
touch (and the `@media (max-width:760px)` override) are untouched. Do **not** edit the shared base
declarations. Add one dedicated, commented block in `client/styles.css` **immediately after** the
`@media (max-width: 760px) { … }` block (after line 234). Use the doubled selector
`body.dev-desktop X, body.dev-desktop-lg X` for each rule (a helper reference: `body.dev-desktop` +
an id selector has specificity that beats the base id-only rules — see the notes at the end).

```css
/* ---- Desktop (mouse / large-screen) Main Window polish (device-profiles iteration 1) ----
   Scoped to the desktop + desktop-lg FORM classes only; phone/tablet + the mobile @media override are
   untouched. See docs/plans/2026-07-01-1933-device-profiles-desktop-polish.md. */

/* B1 — larger briefing title + body text on desktop */
body.dev-desktop #mw-mission-title, body.dev-desktop-lg #mw-mission-title { font-size: 32px; }
body.dev-desktop #mw-mission-desc,  body.dev-desktop-lg #mw-mission-desc  { font-size: 26px; }

/* B2 — Loadout/Stash/Shop buttons: don't stretch to fill the column; fixed height slightly > Missions row.
   Cause: the shared .mw-item base has `flex: 1 1 auto`, which grows in a column flex. */
body.dev-desktop .mw-shop-item, body.dev-desktop-lg .mw-shop-item { flex: 0 0 auto; height: 56px; }
/* NOTE: B2 assumes #mw-menu is a COLUMN flex (`#mw-menu { display: flex; flex-direction: column }`,
   styles.css:81 — the `flex: 1 1 auto` stretch is on the vertical/main axis there). Confirm that before
   finalizing, and settle the exact 56px height (Missions row ≈ 48px) under Playwright so the shop buttons
   read as "a bit larger than the Missions row" without over-tall gaps. */

/* B3 — granted-item icon centered directly BELOW the mission text (drop the bottom-right float + strut).
   #mw-mission-desc becomes a flex column; the text keeps order 1, the item canvas takes order 2 and
   centers; the strut is hidden. (Take-off, a sibling AFTER #mw-mission-desc, then sits under the item.) */
body.dev-desktop #mw-mission-desc, body.dev-desktop-lg #mw-mission-desc { display: flex; flex-direction: column; }
body.dev-desktop #mw-mission-text, body.dev-desktop-lg #mw-mission-text { order: 1; }
body.dev-desktop #mw-mission-desc.show-item #mw-item,
body.dev-desktop-lg #mw-mission-desc.show-item #mw-item {
  order: 2; float: none; clear: none; align-self: center;
  width: 55%; height: var(--gun-h); margin: 12px 0 6px;
}
body.dev-desktop #mw-mission-desc.show-item #mw-item-strut,
body.dev-desktop-lg #mw-mission-desc.show-item #mw-item-strut { display: none; }

/* B4 — ship characteristics (#ship-stats: P/Accel/Turn/Weight) fonts ×2 on desktop.
   (Grid FALLBACK below is COMMENTED OUT — enable ONLY if the one-line strip doesn't fit at ×2; see plan.) */
body.dev-desktop #ship-stats .stat .k, body.dev-desktop-lg #ship-stats .stat .k { font-size: 16px; }
body.dev-desktop #ship-stats .stat .v, body.dev-desktop-lg #ship-stats .stat .v { font-size: 20px; }
body.dev-desktop #ship-stats .stat .d, body.dev-desktop-lg #ship-stats .stat .d { font-size: 12px; }

/* B5 — Take-off follows the content: don't let the description grow to fill the column (it stays
   scrollable when genuinely long via its own overflow-y + min-height). Only the desc flex changes —
   #mw-go / #takeoff shared rule is untouched, so the welcome Take off is unaffected. */
body.dev-desktop #mw-mission-desc, body.dev-desktop-lg #mw-mission-desc { flex: 0 1 auto; }
```

Notes:
- B3 + B5 both target `#mw-mission-desc`; merge the `display/flex-direction` (B3) and `flex: 0 1 auto`
  (B5) into one rule if you prefer, or keep them separate as written (both apply).
- **B5 keeps scroll-when-long:** `#mw-mission-desc` already has `overflow-y: auto` + `min-height: 3.5em`
  (base `styles.css:113`). With `flex: 0 1 auto` in the height-bounded `#mw-view-mission` flex column, the
  description takes its content height for short text (Take-off right under it) and shrinks + scrolls for
  long text (Take-off stays visible). No welcome regression — `#takeoff` (`styles.css:145`) shares only
  the button-look rule, which is not touched.

### Step B-viewer — keep the moved `#mw-item` viewer correctly sized

No JS change is required: `showShowcaseItem` already calls `resizeViewer(mwItem)` right after adding
`.show-item` (`mainwindow.js:313-314`), and `resizeViewers` re-runs on resize (`:322-324`).
`resizeViewer` reads the canvas `clientWidth/clientHeight` (`:220`), so once the desktop CSS lays the
canvas out centered (width 55% of the desc, height `var(--gun-h)`), the viewer sizes to the new box.
**Verify** in the Playwright check (below) that the L2/L3 item renders crisp and correctly aspect-ratioed
in its new centered position (not stretched/squished).

### Step B4-fallback — ship-stats: one line first, grid only if it doesn't fit

After applying the ×2 fonts (B4), decide the final layout **by measurement**, not by guessing:

1. Playwright-render the desktop Main Window (see verification) at a representative desktop width
   (e.g. **1440×900**) on **L1** (no item) so the ship-stats strip is visible in the ~25% right column.
2. In the rendered page, measure the strip:
   ```js
   const s = document.getElementById('ship-stats');
   ({ overflow: s.scrollWidth - s.clientWidth, scrollWidth: s.scrollWidth, clientWidth: s.clientWidth })
   ```
   Also eyeball the saved PNG: the four `k/v` pairs (P/Accel/Turn/Weight) must sit on **one line** without
   clipping/overlap.
3. **If it fits** (`overflow <= 0` and visually clean): done — leave the grid fallback commented out.
4. **If it does NOT fit:** enable a borderless key/value grid fallback (no boxes/separators — `.stat`
   already has `background:none; border:0`, `styles.css:211`) by adding, in the same desktop block:
   ```css
   body.dev-desktop #ship-stats, body.dev-desktop-lg #ship-stats {
     display: grid; grid-template-columns: auto auto; gap: 4px 14px; justify-content: center;
   }
   ```
   (Four `.stat` items → a 2×2 grid of key/value pairs.) Re-render and confirm it fits + reads cleanly.
5. **Record which case shipped** in the CHANGELOG bullet + SUMMARY (one line: "fit on one line" vs "2×2
   borderless grid fallback").

---

## Tests

- **Unit (client):** add `client/src/device.test.js` (node:test), asserting `classifyForm` boundaries:
  ```js
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { classifyForm } from './device.js';
  test('classifyForm — form-factor breakpoints (longest edge)', () => {
    assert.equal(classifyForm(320), 'phone');
    assert.equal(classifyForm(899), 'phone');
    assert.equal(classifyForm(900), 'tablet');
    assert.equal(classifyForm(1279), 'tablet');
    assert.equal(classifyForm(1280), 'desktop');
    assert.equal(classifyForm(1919), 'desktop');
    assert.equal(classifyForm(1920), 'desktop-lg');
    assert.equal(classifyForm(3840), 'desktop-lg');
  });
  ```
  Run: `cd client && node --test`. This must pass; importing `device.js` under node must not throw (the
  guards make it DOM-free — confirm the whole unit suite stays green).
- **No server changes** in this feature → no server test changes. (`server && npm test`, SQLite + Postgres,
  is unaffected; do not touch `db.js` / `db_postgres.js`.)
- **Visual suite (client):** `cd client && npm run test:visual`. It is **flaky at baseline** (~10 pass / 6
  fail — `06-pause`, `08-arena-boundaries`, `11-l4-enemies`, `12-audio`, `ship-bank`, `reset-progress`,
  intermittently `10-mission-board`). Judge by: the **reliably-passing set stays green**
  (`01-smoke`, `02-ship-explosion`, `03-exhaust-trail`, `04-combat`, `05-hangar-shop`, `07-mobile-hangar`,
  `09-mission-setpieces`, `10-mission-board`, `15-mobile-landscape`, `97-briefing-showcase`) and **zero
  page errors per scenario** (a real JS/import break fails *every* scenario — the true regression signal).
  Pay special attention to `07-mobile-hangar` / `15-mobile-landscape` / `97-briefing-showcase` (they cover
  the touch/mobile Main Window + the briefing item showcase that Part B touches on desktop).
- **Manual/Playwright desktop visual check** (headless Playwright render of `index.html`, per the
  `visual-verify-headless` memory — system screencapture is blocked). For each case below, load the game
  at a desktop viewport (e.g. 1440×900 → classifies `desktop`; also spot-check ≥1920 → `desktop-lg`),
  confirm `document.body.classList` contains `input-mouse` + the expected `dev-*` class, and save a PNG:
  1. **L1 (no granted item):** Main Window / campaign briefing — verify title 32px / text 26px, the
     Loadout/Stash/Shop buttons are fixed-height (not stretched — once the shop is unlocked so they show;
     otherwise verify with `shop_unlocked`), ship-stats strip at ×2 (run the B4-fallback measurement),
     Take-off sits directly under the mission text, `#mw-item` hidden.
  2. **L2 or L3 briefing (with granted item — MG on L2 / repair drone on L3):** verify the item 3D icon is
     **centered below** the mission text (not floated bottom-right), the strut is gone, the item renders
     crisp (not stretched), and Take-off sits **under the item**.
  3. **Mobile/touch unchanged:** render a phone-sized touch viewport (as the visual suite does for
     `07-mobile-hangar` / `15-mobile-landscape`) and confirm the item is still floated bottom-right, the
     buttons/fonts/Take-off match the pre-change mobile layout, and `body` carries `input-touch` + `touch`
     + `dev-phone` (+ `rot` when portrait).

---

## Docs to update

- **`docs/SUMMARY.md`:**
  - Update the **`**Updated:**`** date + prepend a short parenthetical describing the device abstraction +
    desktop Main Window polish.
  - In the **Controls → "Mobile menus & Full screen"** paragraph, replace the "Two detection consts set
    body classes: `FS_API` … `STANDALONE`" wording to say these + the touch detection now live in
    `client/src/device.js`, projected onto `input-touch`/`input-mouse` + `dev-phone|dev-tablet|dev-desktop|
    dev-desktop-lg` body classes, with `body.touch` kept as a compatibility alias.
  - In the **Controls → "Landscape on phones"** paragraph, note `applyOrientation()` now calls
    `applyDevice()` first so the `form` axis recomputes on resize/orientationchange (classes only this
    iteration; full resize adaptation is iteration 2).
  - In the **Main Window** section, add that on the **desktop/`dev-desktop(-lg)` form** the briefing title/
    text are larger, the granted-item icon centers below the text (float dropped), the ship-stats strip
    uses ×2 fonts (record: one line, or 2×2 borderless grid fallback), Loadout/Stash/Shop are fixed-height,
    and Take-off follows the content — mobile/touch unchanged.
- **`docs/CHANGELOG.md`:** add a bullet under today's date (`## 2026-07-01`): bold summary
  ("**Device-support architecture (iteration 1) + desktop Main Window polish**"), what changed
  (new `client/src/device.js` two-axis model replacing `isTouch`; body classes; desktop CSS fixes), the
  user-visible effect, and which ship-stats layout shipped. Note the iteration split (resize adaptation
  deferred to iteration 2).
- **`docs/DECISIONS.md`:** add a new numbered entry. The file currently goes up to **§33** (§31 client ESM
  split, §32 password reset, §33 itch.io export), so add **§34** — see below.

### DECISIONS entry to add (§34)

> ## 34. Client device support — two independent axes (`input` / `form`), phased over two iterations
>
> **Decision.** Replace the single `isTouch` boolean with a two-axis device model in one module
> (`client/src/device.js`): **`input` = `touch | mouse`** (capability, ~constant per session — drives
> interaction-bound behavior: touch controls, auto-pause on blur, fullscreen-on-tap, hover-vs-tap reveal)
> and **`form` = `phone | tablet | desktop | desktop-lg`** (derived from the viewport's longest edge,
> recomputed on resize — drives layout/CSS + forced rotation). Each axis has a single source of truth and
> projects onto mutually-exclusive body classes (`input-touch|input-mouse`, `dev-phone|dev-tablet|
> dev-desktop|dev-desktop-lg`); `body.touch` is kept as a compatibility alias so existing touch CSS isn't
> rewritten. Breakpoints (longest edge): `phone < 900 ≤ tablet < 1280 ≤ desktop < 1920 ≤ desktop-lg`.
>
> **Why two axes.** `isTouch` conflated capability with size. New profiles (tablet, foldable, big monitor)
> are almost entirely a *form* concern, not an *input* one. Separating them means a resize recomputes only
> `form` (it never re-inits touch controls), and adding a profile = one `classify()` rule + its CSS.
>
> **Why two iterations.** Iteration 1 (this change) builds the architecture + a set of desktop-browser CSS
> fixes to the Main Window ONLY. It deliberately does **NOT** implement full resize-driven adaptation of
> every screen — that is iteration 2. The structure is built so iteration 2 drops in cleanly: `form`
> already recomputes on resize/orientationchange (via `applyDevice()` inside `applyOrientation`), and
> layout keys off `body.dev-*`, never raw `isTouch`. Guard rail: right structure now, full adaptation
> deferred — not over-built, not under-built.

---

## Out of scope / non-goals (DECISIONS §30 — keep it simple)

- **No full resize-driven adaptation** of every screen (welcome, HUD, shop, viewers) — that is iteration 2.
  This iteration only sets body classes on a form change + applies the listed desktop CSS.
- **Do NOT touch mobile/touch layout** — no changes to phone/tablet Main Window, the
  `@media (max-width:760px)` override, `body.rot` rotation, the floating fullscreen button, or the A2HS
  hint (beyond relocating where the `standalone`/`no-fs-api` classes are *set*).
- **Do NOT rewire** the shop (i)/hover reveal onto `canHover`/`input-*` (leave it on `body.touch`).
- **No server / DB / migration changes.** No new endpoints, no `db.js`/`db_postgres.js` edits.
- **No new dependencies.** Native `matchMedia`/DOM only, consistent with the project's built-in-only ethos.
- **Do NOT fix the button-stretch / item-float / take-off-pin on touch** even though they may also be
  slightly off there — desktop only this iteration (the brief flags this explicitly).
- **No `desktop-lg`-specific tuning** beyond applying the same desktop polish to it.

## CSS specificity note (for the implementer)

The base Main Window rules are id-only (e.g. `#mw-mission-desc { font-size: 18px }` = specificity 1,0,0).
Each desktop rule prefixes a body class (`body.dev-desktop #mw-mission-desc` = 1,1,1), so it wins without
`!important`. For the item-float override, base `#mw-mission-desc.show-item #mw-item` is (2,1,0); the
desktop `body.dev-desktop #mw-mission-desc.show-item #mw-item` is (2,2,0) — also wins. The
`@media (max-width:760px)` override only applies below 760px, i.e. in the phone/tablet form range where the
`dev-desktop*` classes are never set, so there is no conflict at desktop widths.
