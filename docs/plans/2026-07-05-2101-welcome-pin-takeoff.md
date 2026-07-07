# Welcome screen: drop the L1 ship picker + pin "Take off"

**Feature ID:** 2026-07-05-2101-welcome-pin-takeoff
**Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-07-05-2101-welcome-pin-takeoff`
**Area:** client welcome screen (`client/index.html`, `client/styles.css`, `client/src/welcome.js`), one visual scenario.

## Goal

The Level-1 welcome screen has two problems. First, `#welcome` is a centered flex column with
`overflow-y:auto`, and the **flex `justify-content:center` + overflow trap clips the *unreachable top*** of
the content (the `h1`/`.intro`) on short viewports — the classic centering-in-a-scroll-container bug where
the overflowed top can't be scrolled into reach. Second, with everything in one scrolling column the
**Take off button's on-screen position depends on content height** rather than being structurally
guaranteed. This change (1) **removes the decorative L1 ship-picker block** entirely (the `.pick` label and
the `#ship-choices` card grid — at L1 the player owns exactly one ship, so the picker offers no real
choice; removing it alone already relieves the *visible symptom* by shrinking the content), and (2)
**restructures `#welcome` into a fixed grid** (`1fr` scroll region on top / `auto` pinned footer at the
bottom) so **only the greeting + intro text scrolls** and the **Take off button + community link are pinned
to the bottom — always on-screen regardless of content height**, mirroring how the Main Window already pins
its Take off. User-visible effect: a cleaner L1 intro, the greeting/intro reliably scroll into reach on
short viewports, and a Take off button whose on-screen presence is a **structural invariant**, not a
content-dependent side effect.

## Decisions (all settled — do not reopen)

- **Ship picker removed with NO replacement.** Delete `.pick` + `#ship-choices` from markup, all their CSS,
  and the JS that builds them. **Do NOT add any stat/HP hint line** in their place.
- **`selectedShip` still needed for take-off.** `takeOff()` early-returns when `selectedShip` is null
  (`welcome.js:178`). It used to be set inside `renderShipCards`; now `showWelcome` sets it directly to
  `playerShips[0]`.
- **New `#welcome` layout = CSS grid `grid-template-rows: 1fr auto`.** Top cell `#welcome-scroll` scrolls
  (greeting `h1` + `.intro`); bottom cell `#welcome-footer` is pinned (Take off + community link).
- **Tall-screen behavior: centered when it fits, top-aligned + scrolls when it overflows.** Achieved with
  the flexbox auto-margin trick (`:first-child{margin-top:auto}` / `:last-child{margin-bottom:auto}`) — this
  avoids the well-known "flex `justify-content:center` in a scroll container clips the top and can't scroll
  to it" trap. Exact CSS below.
- **Staged L1 reveal simplified.** Old: intro types (~5 s) → ship picker fades in → +0.5 s Take off. New:
  intro types (~5 s) → +0.5 s Take off. Drop the `welcome-hide-pick` class entirely; **keep**
  `welcome-hide-go`. Tap-`.intro`-to-skip still reveals the full intro + Take off at once.
- **i18n keys stay.** `ui.welcome.pick` (in `client/locales/*.json` + `source.json`) becomes unused — leave
  it (harmless; also referenced only as a synthetic fixture in `client/src/i18n.test.js`). `ui.card.*` /
  `ui.mount.*` stay (used by the Main Window ship preview, not the welcome screen).
- **Regression guard is committed**, not one-off: `client/visual/scenarios/18-briefing-staged-reveal.mjs`
  gains a 900×500 step asserting Take off is fully on-screen.

## Steps

### 1. HTML — restructure `#welcome` (`client/index.html:36–45`)

Replace the current block:

```html
<div id="welcome">
  <div id="lang-switch"></div>
  <h1 data-i18n="ui.welcome.greeting">Welcome, Sentinel</h1>
  <p class="intro" data-i18n="ui.welcome.intro">Pirates are raiding our home system — we need you to push them back. Good news: you've got a fast, nimble ship. Use that agility — keep moving, out-turn them, and don't let them pin you down.</p>
  <div class="pick" data-i18n="ui.welcome.pick">Pick your ship</div>
  <div id="ship-choices"></div>
  <button id="takeoff" data-i18n="ui.button.take_off">Take off 🚀</button>
  <a class="community-link" data-i18n="ui.community.label" data-i18n-href="ui.community.url"
     target="_blank" rel="noopener">💬 Feedback &amp; community on Telegram</a>
</div>
```

with (picker rows deleted; content wrapped in a scroll cell; button + link wrapped in a pinned footer;
`#lang-switch` stays as the first, `position:absolute` child):

```html
<div id="welcome">
  <div id="lang-switch"></div>
  <div id="welcome-scroll">
    <h1 data-i18n="ui.welcome.greeting">Welcome, Sentinel</h1>
    <p class="intro" data-i18n="ui.welcome.intro">Pirates are raiding our home system — we need you to push them back. Good news: you've got a fast, nimble ship. Use that agility — keep moving, out-turn them, and don't let them pin you down.</p>
  </div>
  <div id="welcome-footer">
    <button id="takeoff" data-i18n="ui.button.take_off">Take off 🚀</button>
    <a class="community-link" data-i18n="ui.community.label" data-i18n-href="ui.community.url"
       target="_blank" rel="noopener">💬 Feedback &amp; community on Telegram</a>
  </div>
</div>
```

Note: `.intro` stays in the DOM (its tap-to-skip handler in `welcome.js` binds once via
`welcomeEl.querySelector('.intro')`), and `#takeoff`, `#lang-switch`, `.community-link` keep their ids/classes.

### 2. CSS — `client/styles.css`

**2a. `#welcome` block (lines 42–52).** Replace the centered-flex-column + `overflow` rules and the
`@media (max-height:600px)` override with a grid:

```css
/* Welcome / start screen: a fixed grid — scrollable greeting/intro on top, pinned Take-off footer at the
   bottom (only the text scrolls; Take off is always on-screen, like the Main Window). */
#welcome {
  position: fixed; inset: 0; z-index: 12; display: none;
  grid-template-columns: 100%;
  grid-template-rows: 1fr auto;
  box-sizing: border-box;
  background: radial-gradient(120% 90% at 50% 20%, rgba(20,32,60,.72), rgba(5,6,13,.92));
  color: #e8f1ff; font-family: system-ui, sans-serif; text-align: center; padding: 24px;
}
/* Scroll region: centers the greeting+intro when they fit, and (via auto margins, NOT
   justify-content:center — which would clip the top in a scroll container) top-aligns + scrolls fully
   into reach when the text overflows a short viewport. */
#welcome-scroll {
  overflow-y: auto; min-height: 0;
  display: flex; flex-direction: column; align-items: center;
}
#welcome-scroll > :first-child { margin-top: auto; }
#welcome-scroll > :last-child  { margin-bottom: auto; }
/* Pinned footer: Take off + community link, always visible. */
#welcome-footer {
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  padding-top: 16px;
}
#welcome-footer .community-link { margin-top: 0; } /* footer gap handles spacing (override the default 20px) */
```

The old `@media (max-height: 600px) { #welcome { justify-content: flex-start; } }` (line 52) is now
obsolete — **delete it**. (The grid pins the footer at every height.)

**2b. Staged-reveal transition rules (lines 62–67).** Replace:

```css
  #welcome .pick, #welcome #ship-choices, #welcome #takeoff { transition: opacity .25s ease; }
  #welcome.welcome-hide-pick .pick,
  #welcome.welcome-hide-pick #ship-choices { opacity: 0; visibility: hidden; }
  #welcome.welcome-hide-go #takeoff        { opacity: 0; visibility: hidden; }
```

with (drop `welcome-hide-pick`; keep `welcome-hide-go`; keep the comment accurate):

```css
  /* Staged L1 welcome briefing: Take-off is hidden while `.intro` types out, then fades in +0.5s after
     typing completes. Same visibility technique as the Main Window (visibility, not display → no reflow). */
  #welcome #takeoff { transition: opacity .25s ease; }
  #welcome.welcome-hide-go #takeoff { opacity: 0; visibility: hidden; }
```

**2c. Dead picker/card CSS (lines 146–157).** Delete the whole run of now-unused rules:
`#welcome .pick`, `#ship-choices`, `.ship-card`, `.ship-card:hover`, `.ship-card.selected`,
`.ship-card .ship-name`, `.ship-card .ship-dot`, `.ship-card .ship-stat`. (Confirmed welcome-only: the
Main Window ship preview uses `#mw-*` classes, not `.ship-card`.)

**2d. Rotated-phone override (`body.rot #welcome`, line 180).** Delete the rule
`body.rot #welcome { justify-content: flex-start; }` and its preceding comment (lines 178–180) — the grid
already pins the footer, so no top-align hack is needed. (Leaving `justify-content` on a grid would risk
shifting the tracks.)

**2e. Leave line 261** (`#welcome .intro { font-size: 16px; }` in the `≤760px` mobile media query) — still
valid, `.intro` is unchanged.

### 3. JS — `client/src/welcome.js`

**3a. Imports.** After removing the card code, `CATALOG`, `cssColor`, and `shipName` become unused.
- Line 6: `import { G, CATALOG } from './state.js';` → `import { G } from './state.js';`
- Line 7: delete `import { cssColor } from './format.js';`

**3b. Delete dead code:**
- `shipHullHp` (lines 19–20).
- `mountSummary` (lines 28–34).
- `lastPlayerShips` declaration (line 35).
- `renderShipCards` (lines 36–53).
- `shipName` (line 98) — only referenced from the deleted card markup.

**3c. `revealWelcomeNow` (lines 59–65).** Line 63:
`welcomeEl.classList.remove('welcome-hide-pick', 'welcome-hide-go');` →
`welcomeEl.classList.remove('welcome-hide-go');`

**3d. `startWelcomeReveal` (lines 66–80).** Update to the two-step sequence:

```js
// Staged L1 reveal: greeting h1 shows immediately → `.intro` types ~5s → +0.5s Take-off fades in.
function startWelcomeReveal() {
  clearWelcomeReveal();
  welcomeStaged = true;
  const intro = welcomeEl.querySelector('.intro');
  welcomeEl.classList.add('welcome-hide-go');
  welcomeCtl = typeText(intro, t('ui.welcome.intro'), { total: 5000, onDone: () => {
    welcomeGoTimer = setTimeout(() => {                    // Take-off 0.5s after the intro finishes
      welcomeGoTimer = 0;
      welcomeEl.classList.remove('welcome-hide-go');
      welcomeStaged = false;
    }, 500);
  }});
}
```

**3e. `showWelcome` (lines 85–94).** Remove the `lastPlayerShips` assignment and the `renderShipCards`
call; default `selectedShip` directly; show as a **grid**:

```js
export function showWelcome(playerShips) {
  selectedShip = playerShips[0] || null; // L1 owns exactly one ship; take-off needs a non-null selection
  buildLangSwitch();
  renderAccountBar();
  document.body.classList.add('menu'); // hide the in-game HUD behind the welcome screen
  refreshMusic(); // menu → calmer hangar music
  welcomeEl.style.display = 'grid';
  startWelcomeReveal();
}
```

(Line 92 `welcomeEl.style.display = 'flex';` → `'grid';` is part of the above.)

**3f. `setLanguage` (line 142).** Delete `if (lastPlayerShips.length) renderShipCards(lastPlayerShips); //
re-render DB-sourced ship names` — nothing to re-render now. The `revealWelcomeNow()` settle on line 147
stays (a language switch still re-renders `.intro` mid-type).

**3g. Module header comment (lines 1–5).** Update the prose that mentions "pick a ship" / "re-renders the
ship cards" / "showWelcome renders the account bar … and re-renders the ship cards". Replace the relevant
clauses so they describe: `showWelcome` renders the account bar + starts the staged L1 intro reveal;
`setLanguage` re-localizes chrome; take-off starts a run via `reset`. Drop all "ship card" references.

### 4. `client/src/main.js` comments (no logic change)

- Line 561 header comment: `// showWelcome/renderShipCards/take-off + …` → drop `renderShipCards`
  (`// showWelcome/take-off + applyTranslations/the EN-RU lang switch + requestFullscreen`).
- Line 631 comment: `… show the welcome screen with the ship picker + intro.` → `… show the welcome screen
  (greeting + intro).` (Logic at 632–633 is unchanged: `showWelcome(playerShips)` still receives the ships;
  `playerShips[0]` becomes the default selection inside `showWelcome`.)

### 5. Visual scenario — `client/visual/scenarios/18-briefing-staged-reveal.mjs`

**5a. Header comment (lines 1–4).** Update the L1 sentence: the welcome briefing types out then reveals
**Take-off** (no ship picker). Leave the L2/L3/L4 description unchanged.

**5b. L1 assertions (lines 27–41).** Remove the two `#ship-choices` assertions (old lines 29 and 39) and
keep the `#takeoff` ones. Then append the **structural pin regression step** described below and restore
the viewport. Result:

```js
  await landWelcome();
  // 1. mid-type: Take-off hidden, intro not yet full.
  assert.equal(await css('#takeoff', 'visibility'), 'hidden', 'L1: Take-off hidden while intro types');
  const introMid = await textLen('#welcome .intro');
  // 2. the .intro font bump (26px desktop).
  assert.equal(await css('#welcome .intro', 'fontSize'), '26px', 'L1: welcome .intro is 26px');
  // 3. skip → intro full + Take-off revealed at once.
  await page.click('#welcome .intro');
  await page.waitForFunction('window.__game.welcomeStaged === false', null, { timeout: 2000 });
  const introFull = await textLen('#welcome .intro');
  assert.ok(introMid < introFull, 'L1: intro was mid-type (shorter) before the skip');
  assert.equal(await css('#takeoff', 'visibility'), 'visible', 'L1: Take-off visible after skip');
  await shot('L1-welcome-revealed');

  // 4. Regression guard (welcome-pin-takeoff): the grid pins the footer to the viewport bottom while the
  // greeting/intro scroll INDEPENDENTLY. At 900×360 the intro overflows its scroll cell, so we assert BOTH
  // (a) the scroll region genuinely scrolls AND (b) the footer is flush to the content bottom. This FAILS
  // if #welcome is reverted to the centered-flex column — there is no #welcome-scroll, and the footer
  // (last children) is vertically centered, not pinned. (A "takeoff.bottom <= innerHeight" check would NOT
  // catch a revert: the bottom-anchored button stays on-screen in the flex layout too — the flex trap
  // clips the unreachable TOP, not the button. This is why we assert the pin, not mere visibility.)
  await page.setViewportSize({ width: 900, height: 360 });
  const pin = await page.evaluate(() => {
    const scroll = document.getElementById('welcome-scroll');
    const foot = document.getElementById('welcome-footer'); // null on a centered-flex revert → assertion fails
    const wel = document.getElementById('welcome');
    const padBottom = parseFloat(getComputedStyle(wel).paddingBottom); // 24px
    return {
      overflows: scroll.scrollHeight > scroll.clientHeight,
      scrollH: scroll.scrollHeight, clientH: scroll.clientHeight,
      footBottom: foot.getBoundingClientRect().bottom,
      contentBottom: window.innerHeight - padBottom, // 360 − 24 = 336
    };
  });
  // (a) the text region actually overflows (measured: scrollHeight 239 > clientHeight 203 at 900×360).
  assert.ok(pin.overflows, `L1: intro region scrolls at 900×360 (scrollH ${pin.scrollH} > clientH ${pin.clientH})`);
  // (b) the footer is pinned flush to the bottom (measured: footBottom 336 === innerHeight−24). ≤2px tolerance.
  assert.ok(Math.abs(pin.footBottom - pin.contentBottom) <= 2,
    `L1: footer pinned to bottom at 900×360 (footBottom ${Math.round(pin.footBottom)} ≈ contentBottom ${pin.contentBottom})`);
  await page.setViewportSize({ width: 1280, height: 800 }); // restore for the L2/L3/L4 Main Window section
```

**Measured, not guessed** — a Playwright render of the exact planned grid markup/CSS gave, at **900×360**:
`#welcome-scroll` scrollHeight **239** vs clientHeight **203** (overflow margin ~36px, so the intro reliably
scrolls), and `#welcome-footer.getBoundingClientRect().bottom` = **336** = `innerHeight − 24` (the
`#welcome` bottom padding) to the pixel. The same render of a centered-flex layout with the picker removed
put the last child's bottom at **362** (past the 336 content bottom, i.e. *not* pinned) and has no
`#welcome-scroll` — so both assertions fail on a revert, which is the point. If the implementer changes the
footer's height (padding/font), re-confirm `#welcome-scroll` still overflows at 900×360 (assertion (a) is
self-checking: if it doesn't overflow, the test fails loudly — lower the height until it does).

Leave the entire L2/L3/L4 section (lines 43–84) unchanged.

## Tests

- **Client visual suite** (from `client/`): `node visual/run.mjs` (or the project's usual visual runner).
  Scenario `18-briefing-staged-reveal` must pass its L1 assertions including the new 900×360 structural
  pin guard (scroll-region overflows + footer flush to bottom).
  Per the "visual suite flaky baseline" note, judge by the reliably-passing set + zero page errors, not by
  the ~6 known-flaky scenarios.
- **Client unit tests** (from `client/`): `node --test`. `client/src/i18n.test.js` is unaffected (it uses
  `ui.welcome.pick` only as an in-file fixture, not the real screen) — confirm it still passes.
- **No server changes** — `db.js` / `db_postgres.js` untouched; server tests not required for this feature.
- **Headless render check** (per `visual-verify-headless`): render `client/index.html` in Playwright at
  ~900×360, drive the L1 welcome (reset + reload as scenario 18 does), skip the intro, and confirm the
  greeting/intro region scrolls (`#welcome-scroll.scrollHeight > clientHeight`) while `#welcome-footer`
  stays pinned flush to the bottom. (This is the same condition the committed scenario now guards.)

## Docs to update

- **`docs/SUMMARY.md`**
  - **Top `**Updated:**` line (line 6):** bump the date to `2026-07-05` and note the welcome-screen change.
  - **"Mobile menus & Full screen" (lines 173–175):** the welcome screen no longer "scrolls (top-aligned +
    overflow-y:auto on short/landscape viewports)". Rewrite to: the **welcome** screen is now a **fixed grid**
    (scrollable greeting/intro on top, pinned Take-off footer at the bottom) — only the text scrolls and the
    **Take off** button is always on-screen, like the Main Window.
  - **Welcome-screen description (lines 604–615):**
    - Line 606: remove "lets them **pick a ship** (cards with HP + weapon summary)"; the welcome screen now
      just greets the player, frames the pirate raid, and offers **Take off**.
    - Staged-reveal bullet (608–615): the sequence is now greeting `h1` immediately → `.intro` types ~5 s at
      26px → **Take off +0.5 s** later. Remove the "ship picker (`.pick` + `#ship-choices`) fades in" step.
      Keep the tap-to-skip, `visibility:hidden`, once-per-landing, and language-switch-settles notes. Add that
      the layout is a `1fr` scroll region over a pinned `auto` footer.
- **`docs/CHANGELOG.md`** — add a bullet under `## 2026-07-05`:
  `- **Welcome screen: dropped the L1 ship picker, pinned Take off structurally.** The Level-1 welcome is
  now a fixed grid (scrollable greeting/intro over a pinned footer) so the Take off button is on-screen
  regardless of content height — replacing a centered-flex column whose `justify-content:center` + overflow
  clipped the unreachable *top* of the intro on short/wide viewports. The decorative single-ship picker
  (`.pick` + `#ship-choices` cards) was removed (L1 owns exactly one ship). Staged L1 reveal simplified to
  intro-types → Take off.`
- **`docs/DECISIONS.md`** — add entry **§51** (next free number):
  `## 51. L1 welcome drops the ship picker (single-ship level) + pins Take off via grid` — record that at
  L1 the player owns exactly one ship (extras are bought in the Main Window shop at L2+), so the picker was
  decorative and removing it loses no choice (and already relieved the *visible* symptom by shrinking the
  content). Separately, `#welcome` moved from a centered-flex column (`overflow-y:auto`, whose
  `justify-content:center` + overflow clips the *unreachable top* of the greeting/intro on short viewports)
  to a `1fr/auto` grid that **pins the footer so the Take-off on-screen invariant holds structurally,
  regardless of content height** — mirroring the Main Window's already-pinned Take off. This is a minimal
  robustness fix (a structural invariant instead of a content-dependent side effect), **not** §30
  over-engineering: it removes a whole class of "button moved off-screen" fragility for a few lines of CSS.

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **No replacement stat/HP line** where the picker was (explicitly decided).
- **Do not remove** the `ui.welcome.pick`, `ui.card.*`, or `ui.mount.*` i18n keys — leave them in place.
- **Do not touch** the Main Window (`#mainwin`) ship preview, its `#mw-*` briefing staging, or its Take off.
- **No new assets/models** — no `catalog_seed.js` or model changes, so **no `/publish-itch` step** is needed.
- **No server / DB changes.**
- Don't redesign the greeting/intro typography, the lang switch, or the community link beyond the footer
  restructure.
