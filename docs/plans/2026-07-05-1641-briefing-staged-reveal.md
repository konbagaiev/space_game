# Staged briefing reveal (levels 1-3)

## Goal
On the first three campaign levels, make the landing briefing appear **in sequence** instead of all at once.
Two different screens are the "briefing" depending on level (see Landing-flow facts below), and **both** get
the same staged treatment:

- **Level 1 → the welcome / ship-picker screen (`#welcome`).** The greeting `h1` shows immediately; the
  `.intro` paragraph (the "briefing text") **types out** over ~5 s; then the **ship picker** (`.pick` label
  + `#ship-choices`) appears; **+0.5 s** later the **Take off** button (`#takeoff`) appears. The `.intro`
  font is also **enlarged to 26px** to match the L2/L3 mission-briefing size (it currently renders smaller).
- **Levels 2 & 3 → the Main Window mission view (`#mw-view-mission`).** The briefing text (`#mw-mission-text`)
  **types out** over ~5 s; then the right-column **ship-preview window** (`#mw-ship-col`) and the work-zone
  **granted-item showcase** (`#mw-item`, Machine Gun on L2 / Repair drone on L3) fade in together; **+0.5 s**
  later the **Take off** button (`#mw-go`) fades in.

On either screen, **tapping the briefing text skips** the typewriter and reveals everything at once. The
sequence plays **once per landing**. Level 4+ (Main Window) and side missions keep the current instant
behavior.

## Landing-flow facts (verified — read before implementing)
`client/src/main.js:630` decides the landing screen:
`if (CATALOG.level.briefing) showMain(CATALOG.level.briefing); else showWelcome(playerShips);`
- **Level 1** has **no `briefing`** in its `catalog_seed.js` descriptor, so L1 lands on **`showWelcome`**
  (`client/src/welcome.js:50`) — the welcome / ship-picker screen. This IS the "first briefing" the player
  sees, confirmed by the maintainer.
- **Levels 2, 3, 4** have a `briefing`, so they land on **`showMain`** → the Main Window mission view
  (confirmed by the visual harness `client/visual/scenarios/97-briefing-showcase.mjs`: `landOn(1)` → L2,
  `landOn(2)` → L3, `landOn(3)` → L4). So the Main Window staged reveal is player-visible on **L2 and L3**;
  **L4 is excluded** (instant).
- `showWelcome` is only ever reached at **L1** (the only level with a null briefing in the normal flow), so
  the welcome staged reveal needs no extra level gate. The Main Window reveal is gated to campaign levels
  **1-3** (in practice fires on L2/L3; the L1 gate is harmless).

## Decisions (chosen answers, do not re-ask)
- **Timing:** typewriter runs a fixed **~5000 ms** regardless of text length (a `requestAnimationFrame`
  loop keyed to elapsed time — the duration holds for any length or frame rate). After it completes: the
  ship window / ship picker (+ showcase, on the Main Window) reveal immediately; Take-off reveals **+500 ms**
  later.
- **Skip:** a click/tap on the briefing text (`.intro` on welcome, `#mw-mission-desc` on the Main Window)
  while a reveal is animating fills the text and reveals the picker/ship window **and** Take-off
  **immediately** (no 0.5 s delay on skip).
- **Once per landing:** each screen guards its own reveal; re-renders that don't restart the landing (e.g. a
  language switch) **settle to full** rather than re-typing.
- **Level gate (Main Window only):** parse the campaign level number from the descriptor `title`
  (`"Level 1".."Level 4"` — a stable, non-localized field set in `catalog_seed.js`). Apply when the
  selection is the **campaign/primary** row (`mwMission == null`) **and** the level number is **1-3**. No
  server change; no new `CATALOG` state.
- **Hide mechanism:** `visibility:hidden + opacity:0` (not `display:none`) so hidden elements keep their
  layout box — nothing reflows when they appear; a 0.25 s opacity transition fades them in.
- **Welcome `.intro` font:** bump to **26px** (matches the desktop mission-briefing size) with a sane
  **16px** override under the existing `@media (max-width:760px)` block.
- **Shared typewriter:** one tiny module `client/src/typewriter.js` provides the char-by-char reveal; each
  screen keeps its own hide/reveal orchestration (the two differ enough — different elements and reveal
  steps — that sharing only the type loop is the right amount of DRY per DECISIONS §30).
- **Welcome community link:** the `.community-link` at the bottom of `#welcome` (`client/index.html:48`) is
  **not** part of the reveal and stays visible (out of scope; only `.pick`/`#ship-choices`/`#takeoff` are
  staged, per the maintainer's list).

## Steps

Client-only. No server, catalog, or i18n changes.

### 1. New shared module `client/src/typewriter.js`
```js
// Shared ~5s typewriter for the landing briefings (welcome `.intro` + Main Window `#mw-mission-text`).
// Reveals `text` into `el` char-by-char over `total` ms via requestAnimationFrame (elapsed-time based, so
// the duration holds regardless of text length or frame rate). Returns a controller:
//   skip()   — fill the text now and fire onDone (used by tap-to-skip)
//   cancel() — stop WITHOUT firing onDone (used when leaving / settling on re-render)
// onDone fires exactly once, when the type completes or is skipped.
export function typeText(el, text, { total = 5000, onDone } = {}) {
  const n = text.length || 1;
  const t0 = performance.now();
  let raf = 0, finished = false;
  el.textContent = '';
  const done = () => {
    if (finished) return; finished = true;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    el.textContent = text;
    if (onDone) onDone();
  };
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / total);
    el.textContent = text.slice(0, Math.floor(p * n));
    if (p < 1) raf = requestAnimationFrame(frame); else done();
  };
  raf = requestAnimationFrame(frame);
  return { skip: done, cancel() { if (raf) cancelAnimationFrame(raf); raf = 0; finished = true; } };
}
```

### 2. `client/styles.css` — hide/reveal CSS + welcome `.intro` font
**(a) Main Window** — add after `#mw-ship-col` (`client/styles.css:131`):
```css
/* Staged briefing reveal (L2/L3 campaign briefing, docs/plans/2026-07-05-1641-briefing-staged-reveal.md):
   the ship window + Take-off are hidden while the briefing text types out, then fade in (ship window at
   typing-complete, Take-off +0.5s). visibility (not display) keeps their layout box so neither the grid
   nor the mission view reflows when they appear. */
#mw-ship-col, #mw-go { transition: opacity .25s ease; }
#mainwin.briefing-hide-ship #mw-ship-col { opacity: 0; visibility: hidden; }
#mainwin.briefing-hide-go   #mw-go        { opacity: 0; visibility: hidden; }
```

**(b) Welcome screen** — bump the existing `#welcome .intro` rule (`client/styles.css:61`) to add
`font-size: 26px;`:
```css
#welcome .intro { font-size: 26px; opacity: .82; max-width: 560px; line-height: 1.5; margin-bottom: 26px; }
```
Then add the welcome staging rules (place next to the welcome-screen block, e.g. after
`client/styles.css:61`):
```css
/* Staged L1 welcome briefing: the ship picker + Take-off are hidden while `.intro` types out, then fade in
   (picker at typing-complete, Take-off +0.5s). Same visibility technique as the Main Window. */
#welcome .pick, #welcome #ship-choices, #welcome #takeoff { transition: opacity .25s ease; }
#welcome.welcome-hide-pick .pick,
#welcome.welcome-hide-pick #ship-choices { opacity: 0; visibility: hidden; }
#welcome.welcome-hide-go #takeoff        { opacity: 0; visibility: hidden; }
```

**(c) Mobile override** — inside the existing `@media (max-width:760px)` block (`client/styles.css:244-248`),
next to `#mw-mission-desc { font-size: 14px; }` (`client/styles.css:247`), add:
```css
    #welcome .intro { font-size: 16px; }
```

### 3. `client/src/welcome.js` — staged welcome reveal
Add the import (top of file, near `client/src/welcome.js:6-16`):
```js
import { typeText } from './typewriter.js';
```
Add module state near `let selectedShip = null;` (`client/src/welcome.js:22`):
```js
export let welcomeStaged = false; // a staged L1 welcome reveal is animating (read by ?debug __game)
let welcomeCtl = null;            // active typewriter controller
let welcomeGoTimer = 0;           // the +0.5s Take-off reveal timeout handle
```
Add the reveal functions (above `showWelcome`, ~`client/src/welcome.js:49`):
```js
function clearWelcomeReveal() {
  if (welcomeCtl) { welcomeCtl.cancel(); welcomeCtl = null; }
  if (welcomeGoTimer) { clearTimeout(welcomeGoTimer); welcomeGoTimer = 0; }
}
// Show the fully-revealed welcome state at once (skip-on-tap + settle when setLanguage re-renders mid-type).
function revealWelcomeNow() {
  clearWelcomeReveal();
  const intro = welcomeEl.querySelector('.intro');
  if (intro) intro.textContent = t('ui.welcome.intro');
  welcomeEl.classList.remove('welcome-hide-pick', 'welcome-hide-go');
  welcomeStaged = false;
}
// Staged L1 reveal: greeting h1 shows immediately → `.intro` types ~5s → ship picker in → +0.5s Take-off.
function startWelcomeReveal() {
  clearWelcomeReveal();
  welcomeStaged = true;
  const intro = welcomeEl.querySelector('.intro');
  welcomeEl.classList.add('welcome-hide-pick', 'welcome-hide-go');
  welcomeCtl = typeText(intro, t('ui.welcome.intro'), { total: 5000, onDone: () => {
    welcomeEl.classList.remove('welcome-hide-pick');       // ship picker (.pick + #ship-choices) fades in…
    welcomeGoTimer = setTimeout(() => {                    // …Take-off 0.5s later
      welcomeGoTimer = 0;
      welcomeEl.classList.remove('welcome-hide-go');
      welcomeStaged = false;
    }, 500);
  }});
}
// Tap the `.intro` while it's typing → skip to full + reveal picker & Take-off at once. `.intro` is static
// markup (client/index.html:44), never rebuilt (only its textContent changes), so bind once at module load.
welcomeEl.querySelector('.intro').addEventListener('click', () => { if (welcomeStaged) revealWelcomeNow(); });
```
In `showWelcome` (`client/src/welcome.js:50-58`), add `startWelcomeReveal();` as the **last** line (after
`welcomeEl.style.display = 'flex';`).

In `setLanguage` (`client/src/welcome.js:98-111`), add as the **last** statement:
```js
  if (welcomeStaged) revealWelcomeNow(); // a language switch re-renders `.intro` (applyTranslations) — settle to full
```
Rationale: `applyTranslations()` (called by `setLanguage`, `welcome.js:101`) rewrites `.intro`'s
`data-i18n` text to the full translated string mid-type; settling cancels the typewriter so the two don't
fight, and reveals the picker/Take-off with the (now full) text.

### 4. `client/src/mainwindow.js` — Main Window staged reveal (L2/L3)
Add the import (top, near `client/src/mainwindow.js:10-21`):
```js
import { typeText } from './typewriter.js';
```
Add module state near `missionOffers` (~`client/src/mainwindow.js:27`):
```js
export let stagedActive = false; // a staged campaign-briefing reveal is animating (read by ?debug __game)
let briefingRevealDone = false;  // the current landing's campaign briefing is fully revealed (no re-animate)
let stagedFullText = '';         // the briefing text being revealed (also used by skip-to-full)
let stagedCtl = null;            // active typewriter controller
let stagedGoTimer = 0;           // the +0.5s Take-off reveal timeout handle
```
Add helpers just above `renderMissionView` (~`client/src/mainwindow.js:125`):
```js
function clearStagedReveal() {
  if (stagedCtl) { stagedCtl.cancel(); stagedCtl = null; }
  if (stagedGoTimer) { clearTimeout(stagedGoTimer); stagedGoTimer = 0; }
}
// New landing (showMain): allow the staged reveal to play once.
function resetBriefingReveal() {
  clearStagedReveal();
  mainEl.classList.remove('briefing-hide-ship', 'briefing-hide-go');
  stagedActive = false; briefingRevealDone = false;
}
// Leaving the mission view / launching: stop any animation, drop the hide classes, and mark the briefing
// revealed so returning to the mission view shows the full state (no replay).
function settleBriefingReveal() {
  clearStagedReveal();
  mainEl.classList.remove('briefing-hide-ship', 'briefing-hide-go');
  stagedActive = false; briefingRevealDone = true;
}
// The current campaign level number (1..N) from the descriptor title ("Level 1".."Level 4" — a stable,
// non-localized field set in catalog_seed.js). null if unknown.
function campaignLevelIndex() {
  const m = /(\d+)/.exec((CATALOG.level && CATALOG.level.title) || '');
  return m ? parseInt(m[1], 10) : null;
}
// Staged reveal applies only to the CAMPAIGN (primary) briefing on levels 1-3 (not L4+, not side missions).
function stagedBriefingActive() {
  const lvl = campaignLevelIndex();
  return mwMission == null && lvl != null && lvl <= 3;
}
// Show the fully-revealed state at once (skip-on-tap + re-renders after the reveal has played).
function revealBriefingNow() {
  clearStagedReveal();
  document.getElementById('mw-mission-text').textContent = stagedFullText;
  mainEl.classList.remove('briefing-hide-ship', 'briefing-hide-go');
  applyPreviewTarget();          // ship preview + the granted-item showcase (if any)
  stagedActive = false; briefingRevealDone = true;
}
// Staged sequence: typewriter (~5s) → ship window + showcase in → +0.5s Take-off in.
function startStagedReveal() {
  clearStagedReveal();
  stagedActive = true; briefingRevealDone = false;
  const textEl = document.getElementById('mw-mission-text');
  mainEl.classList.add('briefing-hide-ship', 'briefing-hide-go'); // hide ship window + Take-off while typing
  showShowcaseItem(null);        // hold the work-zone granted-item showcase during typing
  previewShip();                 // preload the ship model behind the hidden panel (no hitch at reveal)
  stagedCtl = typeText(textEl, stagedFullText, { total: 5000, onDone: () => {
    mainEl.classList.remove('briefing-hide-ship');  // ship window fades in…
    applyPreviewTarget();                            // …together with the granted-item showcase (L2/L3)
    stagedGoTimer = setTimeout(() => {               // Take-off 0.5s later
      stagedGoTimer = 0;
      mainEl.classList.remove('briefing-hide-go');
      stagedActive = false; briefingRevealDone = true;
    }, 500);
  }});
}
```
(`mainEl` is the module's `document.getElementById('mainwin')`, `client/src/mainwindow.js:23`.)

Replace the campaign branch of `renderMissionView` (`client/src/mainwindow.js:138-146`, the `else`) with:
```js
} else {
  titleEl.textContent = t('ui.mainwin.primary');
  stagedFullText = mainBriefing
    ? (mainBriefing.textKey ? t(mainBriefing.textKey) : (mainBriefing.text || ''))
    : t('ui.hangar.default');
  rewEl.textContent = '';
  rewEl.style.display = 'none';
  if (stagedActive) {
    /* a reveal is already animating this landing — leave it in control of text/preview/showcase */
  } else if (stagedBriefingActive() && !briefingRevealDone) {
    startStagedReveal();
  } else {
    textEl.textContent = stagedFullText;
    applyPreviewTarget();     // primary row → the campaign briefing's showcase item (if any), else the ship
  }
}
```
(`textEl` is the existing `#mw-mission-text` const at `client/src/mainwindow.js:129`.)

In `showMain` (`client/src/mainwindow.js:29-53`):
- After `mainBriefing = ...` (`mainwindow.js:34`) add: `resetBriefingReveal();`
- Change the final `startShipPreview(); applyPreviewTarget();` (`mainwindow.js:51-52`) to:
  ```js
  startShipPreview();                       // spin up the right-column ship model (hidden by CSS while staging)
  if (!stagedActive) applyPreviewTarget();  // when staging, the reveal defers the preview/showcase itself
  ```
  (Without the guard, `showMain`'s `applyPreviewTarget()` would un-hide the showcase item mid-typing, since
  `selectMenu('missions')` earlier in `showMain` already ran `renderMissionView` → `startStagedReveal`.)

In `selectMenu` (`client/src/mainwindow.js:82-90`), the bay-view else branch (`mainwindow.js:89`): change
`else { showBayView(which); stopViewer(mwItem); }` to
`else { settleBriefingReveal(); showBayView(which); stopViewer(mwItem); }`.

Add a skip handler next to the `#mw-go` click listener (`client/src/mainwindow.js:150-153`):
```js
// Tap the briefing text while it's staging → skip to full text + reveal ship window & Take-off at once.
document.getElementById('mw-mission-desc').addEventListener('click', () => {
  if (stagedActive) revealBriefingNow();
});
```

In `launchCampaign` (`client/src/mainwindow.js:54-64`) and `launchMission`
(`client/src/mainwindow.js:168-179`), add `settleBriefingReveal();` right after `stopShipPreview();` (stops a
stray timer/rAF from toggling classes after the Main Window closes into a run).

### 5. `client/src/main.js` — debug getters for the visual tests
- Extend the `welcome.js` import (`client/src/main.js:26`) to add `welcomeStaged`:
  `import { showWelcome, applyTranslations, welcomeStaged } from './welcome.js';`
- Extend the `mainwindow.js` import (`client/src/main.js:25`) to add `stagedActive`:
  `import { showMain, launchMission, refreshMissions, missionOffers, mainBriefing, mwPreview, mwItem, stagedActive } from './mainwindow.js';`
- In the `__game` hook (near `client/src/main.js:527-529`) add:
  ```js
  get briefingStaged() { return stagedActive; },   // Main Window staged reveal animating (L2/L3)
  get welcomeStaged() { return welcomeStaged; },   // welcome-screen staged reveal animating (L1)
  ```

## Tests

- **Server:** no server change. Regression-only: `cd server && npm test` (runs on **both** SQLite and
  Postgres — nothing here touches `db.js`/`db_postgres.js`). Confirm still green.
- **Client unit:** `cd client && node --test` — DOM/timing change, no pure-logic module to unit-test; run
  to confirm no import/parse breakage (the new `typewriter.js` import resolves).
- **Client visual — REQUIRED edit to the existing `client/visual/scenarios/97-briefing-showcase.mjs`.**
  The staged reveal **breaks scenario 97 as-is**: its `landOn(1)`/`landOn(2)` (→ L2/L3) are each followed by
  `await page.waitForFunction('!!(window.__game.itemShowcaseTarget)', null, { timeout: 4000 })`
  (`97-briefing-showcase.mjs:27` and `:33`), but the new `startStagedReveal` calls `showShowcaseItem(null)`,
  so `itemShowcaseTarget` stays **null for the full ~5000 ms typewriter** — longer than the 4000 ms wait —
  and the scenario times out. Fix: **immediately after** each `await landOn(1);` (`:26`) and
  `await landOn(2);` (`:32`), skip the typewriter so the showcase reveals synchronously, by inserting:
  ```js
  await page.click('#mw-mission-desc'); // skip the L2/L3 staged typewriter so the showcase reveals now
  ```
  before the existing `waitForFunction('!!(window.__game.itemShowcaseTarget)', ...)` line. Notes:
  `landOn` itself still resolves on L2/L3 — its `waitForFunction('!!(window.__game.previewTarget)')`
  (`97:20`) passes because `startStagedReveal` calls `previewShip()` (sets `mwPreview.url`) up front; the
  skip's `revealBriefingNow()` → `applyPreviewTarget()` → `showShowcaseItem()` sets `mwItem.url`
  **synchronously** (`setViewerModel` sets `v.url = url` before the async glb load), so
  `itemShowcaseTarget` is truthy right after the click. The `landOn(3)` (L4, not staged) and `landOn(4)`
  (L4 + side-mission selection, `mwMission != null` → not staged) blocks need **no change**.

- **Client visual — new scenario** `client/visual/scenarios/18-briefing-staged-reveal.mjs` (confirmed free:
  no `18-*.mjs` exists in `client/visual/scenarios/`). Covers **both** screens. Reuse a **copy** of 97's
  `pid`/`landOn(n)` setup **only for the L2/L3/L4 (Main Window) half** — that helper is `previewTarget`-gated
  and works there. **Do NOT use `landOn` for the L1/welcome half**: 97's `landOn` awaits
  `previewTarget = mwPreview && mwPreview.url`, which never becomes truthy on the welcome screen
  (`showMain`/`mwPreview` never run at L1), so it would hang. Instead add a welcome-specific setup:
  ```js
  const landWelcome = async () => {
    await page.evaluate(async ({ pid }) => { await fetch(`/api/players/${pid}/reset`, { method: 'POST' }); }, { pid });
    await page.goto(page.url(), { waitUntil: 'load' });
    await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
    await page.waitForSelector('#welcome', { state: 'visible', timeout: 6000 });
    await page.waitForFunction('window.__game.welcomeStaged === true', null, { timeout: 6000 });
  };
  ```
  Assertions (drive SKIP for determinism rather than waiting out the 5 s timer):

  **Welcome screen (L1):** `await landWelcome();`
  1. Assert staging state: `getComputedStyle('#ship-choices').visibility === 'hidden'`,
     `getComputedStyle('#takeoff').visibility === 'hidden'`, and `.intro` text length `< full`
     (`welcomeStaged === true` is already asserted by `landWelcome`).
  2. Assert `getComputedStyle('#welcome .intro').fontSize === '26px'` (the font bump).
  3. Click `.intro` (skip) → assert `window.__game.welcomeStaged === false`, `.intro` is the full text, and
     both `#ship-choices` and `#takeoff` are `visibility: visible`. `await shot('L1-welcome-revealed')`.

  **Main Window (L2/L3/L4):** using the copied `landOn(n)` helper. `await landOn(1);` (→ L2), wait for
  `#mainwin.on`.
  4. Assert `window.__game.briefingStaged === true`,
     `getComputedStyle('#mw-ship-col').visibility === 'hidden'`,
     `getComputedStyle('#mw-go').visibility === 'hidden'`, `#mw-mission-text` length `< full`.
  5. Click `#mw-mission-desc` (skip) → assert `briefingStaged === false`, `#mw-mission-text` full,
     `#mw-ship-col`/`#mw-go` visible, and `window.__game.itemShowcaseTarget` matches `/machine_gun_hangar\./`.
     `await shot('L2-staged-revealed')`.
  6. `await landOn(2);` (→ L3) and repeat 4-5 (showcase → `/repair_drone_hangar\./`).
  7. **Negative:** `await landOn(3);` (→ L4) → assert no staging: `briefingStaged === false`, `#mw-ship-col`
     and `#mw-go` visible immediately, `#mw-mission-text` already full. `await shot('L4-instant')`.

  Run via the existing harness: `cd client && node visual/run.mjs` (see `client/visual/README.md`). Per the
  known **flaky baseline** (~6 scenarios fail at baseline), judge scenario 18 (and the amended 97) by their
  own reliable assertions + **zero page errors**, not the whole-suite pass count.

## Docs to update
- **`docs/SUMMARY.md`**:
  - **Welcome-screen paragraph** (around `SUMMARY.md:565-568`): note that on the **L1 landing** the greeting
    shows immediately, the `.intro` briefing **types out over ~5 s at 26px** (matching the mission-briefing
    size), then the **ship picker** appears, then **Take off +0.5 s**; **tap the intro to skip**.
  - **Main Window section** (`showMain`/preview + Take-off paragraphs, ~`SUMMARY.md:584-612`): note that the
    **campaign briefing on L2/L3** types out over ~5 s, then the ship-preview window + granted-item showcase
    reveal, then **Take-off +0.5 s**; tap the text to skip; plays once per landing; **L4+ and side missions
    are instant**.
  - Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`** — bullet under today's date (`2026-07-05`): **"Staged briefing reveal (L1-3)"** —
  the L1 welcome briefing and the L2/L3 Main Window briefing now type out over ~5 s, then reveal the ship
  picker / ship-preview window (+ item showcase), then the Take-off button 0.5 s later; tap-to-skip; the L1
  welcome `.intro` was enlarged to 26px to match the mission-briefing size; a shared `typewriter.js` drives
  both; L4+/side missions unchanged.
- **`docs/DECISIONS.md`** — no new entry (no material trade-off beyond §30 "keep it simple", already applied).

## Out of scope / non-goals (do not gold-plate)
- **No change to the L1 landing routing** — L1 still lands on the welcome screen; L2/L3/L4 on the Main
  Window. Only the reveal sequencing is added.
- **No server / catalog / i18n changes.**
- **No new easing/animation library, no per-character styling, no sound** — a `requestAnimationFrame`
  substring reveal + CSS opacity fade is sufficient (DECISIONS §30).
- **No staging for L4+ or side missions** — they keep the current instant behavior.
- **Do not hide the welcome `.community-link`** — only `.pick`/`#ship-choices`/`#takeoff` are staged.
- **No model/asset changes** → no `/publish-itch` step needed.
