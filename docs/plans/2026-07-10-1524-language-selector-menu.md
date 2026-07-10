# Language selector — Settings modal + intro-cutscene toggle

## Goal
A player whose browser defaulted to Russian (common on itch.io) can only change language today via the
EN/RU toggle on the **welcome screen** — which a brand-new player never sees, because the intro drops
them straight into the Level-0 cutscene, and returning players land on the Main Window / a live fight.
Give them two more places to switch language, reusing the **existing** i18n mechanism (no new i18n
framework — DECISIONS §10, §30):
1. An EN/RU toggle in the **Settings modal** (⚙ gear, `#settings-overlay`) — the one place to change
   language once past the intro (reachable anywhere, incl. mid-fight since the gear pauses).
2. An EN/RU toggle on the **intro cutscene screen** (Level-0 cutscene), a persistent top corner control
   next to the existing Skip button, visible for the whole intro. It must **not** advance/skip the
   cutscene when tapped.

Both toggles switch **live** (no reload), re-rendering static chrome + the visible cutscene card + all
mounted toggles, and persist identically to the welcome toggle (`localStorage.lang` + best-effort
`POST /api/players/:id/language`). The switch is never surfaced during the playable-Level-0 fallback or
after take-off into live Level 1 — Settings is the only path there.

## Decisions (answered — do not re-ask)
- **Intro toggle placement/visibility:** a **persistent** element at the top of the cutscene screen,
  alongside the existing Skip control, visible for the entire intro (both while a story card is frozen
  and while the fight replays). Its lifecycle is tied to the cutscene overlay: it is created in
  `buildCutsceneOverlay()` and removed in `cutsceneEnd()`, so it **cannot** appear on the playable-Level-0
  fallback (which never builds the overlay) nor after take-off.
- **CRITICAL — no accidental skip:** `cutOverlayEl` (full-screen, `inset:0`) has a whole-overlay
  click→`cutsceneAdvance` listener. The intro toggle host is a **separate `<body>` sibling** (like the
  Skip button), so its clicks do not bubble through `cutOverlayEl`; **additionally** each toggle button
  calls `e.stopPropagation()` (belt-and-suspenders, and documents intent). It sits at `z-index 99999`
  (same as Skip) so it is clickable above the overlay.
- **Settings placement:** a new labeled **"Language"** row (`.set-row stack`) inserted **after the
  Graphics-quality row, before the "Reset my progress" danger zone**. New i18n key `ui.settings.language`
  (EN "Language" / RU "Язык").
- **Visual style:** all three toggles reuse the welcome toggle's two-button EN/RU look. Factor the button
  styling into a shared `.lang-switch` class (currently `#lang-switch button`); each host gets
  `class="lang-switch"`. Only the welcome host keeps its `#lang-switch` **positioning** rule.
- **Persistence / single code path:** export/generalize `setLanguage()` from `welcome.js` (the module
  already documented as "the i18n UI glue"). It rebuilds **every** mounted toggle host via a small
  registry and re-localizes chrome + credits + the visible cutscene card. Do **not** duplicate i18n logic.
- **Import-cycle avoidance:** `welcome.js` imports `localizeSettings`/`localizeCredits` from
  `settings.js`/`credits.js` (one-directional today). To avoid a back-edge, `settings.js` does **not**
  import from `welcome.js`; instead `welcome.js` (the glue) mounts the static `#settings-lang` host
  itself. The dynamic cutscene host is mounted from `main.js` (which already imports from `welcome.js`).

## Steps

### 1. i18n core — a pure, testable helper (`client/src/i18n.js`)
Add a pure helper that describes the toggle buttons for a given active language (this is the seam the
unit test guards — see Tests):
```js
// Describe the EN/RU switch buttons for the active language: code, label, and which is active.
// Pure (no DOM) so mountLangSwitch renders from it and it's unit-testable.
export function langButtons(current) {
  return SUPPORTED.map((lang) => ({ lang, label: lang.toUpperCase(), active: current === lang }));
}
```
Place it after `getLanguage()` (near `client/src/i18n.js:18`).

### 2. i18n UI glue — generalize the switch to N hosts (`client/src/welcome.js`)
Current state: `buildLangSwitch()` (`welcome.js:87`) targets only `#lang-switch`; `setLanguage()`
(`welcome.js:100`) is private. Change to a host-registry model.

a. Import `langButtons` and **drop the now-unused `SUPPORTED`** from the i18n imports (`welcome.js:7`).
After the replacement in this step, `SUPPORTED` is no longer referenced anywhere in `welcome.js` (its
only use was in the old `buildLangSwitch`), and `langButtons` uses it internally in `i18n.js`:
```js
import { t, loadLanguage, getLanguage, langButtons } from './i18n.js';
```

b. **Declare the host registry near the top of the "Localization (i18n) UI glue" section**, ABOVE
`applyTranslations()` (`welcome.js:64`, just under the section comment), so both `applyTranslations`
(step c) and `mountLangSwitch` reference the same module-scoped set regardless of definition order:
```js
// Every mounted EN/RU toggle host (welcome + settings + intro cutscene). Rebuilt on every language
// re-render (applyTranslations) so each host's active button reflects the active language.
const langHosts = new Set();
```
Then replace `buildLangSwitch()` (`welcome.js:86-98`) with a general mount:
```js
// Render the EN/RU buttons into `host` and register it so a later language re-render refreshes it.
// stopPropagation: the intro cutscene overlay has a whole-overlay click→advance listener; a button
// click must switch language WITHOUT advancing/skipping a card.
export function mountLangSwitch(host) {
  if (!host) return;
  langHosts.add(host);
  host.innerHTML = '';
  for (const { lang, label, active } of langButtons(getLanguage())) {
    const b = document.createElement('button');
    b.textContent = label;
    if (active) b.className = 'active';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (getLanguage() !== lang) setLanguage(lang);
    });
    host.appendChild(b);
  }
}
```

c. **Rebuild the hosts inside `applyTranslations()` — the single re-localize entry point.** This is the
critical fix: bootstrap resolves + loads the real language (`main.js:1233-1235`, server-pref adoption
~1296) and then calls `applyTranslations()` at `main.js:1302` — but it never calls `setLanguage()`. If
the host rebuild lived only in `setLanguage`, the toggles would mount at module-init while
`getLanguage()` is still the default `'en'` and stay stuck on EN even when bootstrap loaded RU (the exact
RU-on-itch target user, and a regression of today's behavior where `showWelcome→buildLangSwitch` ran
AFTER the language loaded). Putting the rebuild in `applyTranslations` makes both bootstrap's initial
localize (1302) **and** `setLanguage` refresh every host. Append this loop to `applyTranslations()`
(`welcome.js:68-85`), after the existing `data-i18n` / `data-i18n-href` / fullscreen-label work and the
`document.documentElement.lang = getLanguage();` line:
```js
  // Re-render every mounted EN/RU toggle so its active button matches the active language. Prune
  // detached hosts (the intro cutscene host is removed on teardown) so the set doesn't leak.
  for (const h of [...langHosts]) { if (h.isConnected) mountLangSwitch(h); else langHosts.delete(h); }
```

d. Change `setLanguage()` (`welcome.js:100-113`) from `async function setLanguage` to
`export async function setLanguage`, and **remove its now-redundant `buildLangSwitch()` call** — the
`applyTranslations()` it already invokes now rebuilds all hosts (step c). Keep everything else
(`loadLanguage`, the `localStorage` write, `setPaused(G.paused)`, `localizeSettings()`,
`localizeCredits()`, the best-effort `POST /api/players/${G.playerId}/language`, and the trailing
`if (welcomeStaged) revealWelcomeNow();`). Resulting body order:
```js
  await loadLanguage(lang, fetchJson);
  try { localStorage.setItem('lang', getLanguage()); } catch {}
  applyTranslations();  // re-localizes static [data-i18n] chrome + the cutscene card + ALL toggle hosts
  setPaused(G.paused);
  localizeSettings();
  localizeCredits();
  if (G.playerId) fetch(API_BASE + `/api/players/${G.playerId}/language`, { /* unchanged */ });
  if (welcomeStaged) revealWelcomeNow();
```

e. Mount the two **static** hosts once at module init (both exist in index.html before this deferred
module runs). Add near the bottom of the i18n-glue section (after `applyTranslations`/`mountLangSwitch`
are defined). Remove the old `buildLangSwitch()` call in `showWelcome()` (`welcome.js:56`) since the
welcome host is now mounted at init and refreshed by every `applyTranslations()` (incl. bootstrap's at
`main.js:1302`, so it shows the loaded language on first paint):
```js
mountLangSwitch(document.getElementById('lang-switch'));   // welcome screen
mountLangSwitch(document.getElementById('settings-lang')); // settings modal
```
Note: `showWelcome` still runs `renderAccountBar()` etc.; only the `buildLangSwitch()` line is dropped.

### 3. Settings modal markup + label (`client/index.html`)
Insert the Language row **after** the Graphics-quality note (`client/index.html:151`, the
`set-quality-note` div) and **before** the danger `set-row stack danger` (`client/index.html:152`):
```html
    <div class="set-row stack">
      <label data-i18n="ui.settings.language">Language</label>
      <div id="settings-lang" class="lang-switch"></div>
    </div>
```
Also add `class="lang-switch"` to the welcome host (`client/index.html:37`):
`<div id="lang-switch" class="lang-switch"></div>` (keep the id — its positioning CSS uses it).

### 4. Shared button styling (`client/styles.css`)
At `client/styles.css:73-79`, keep the `#lang-switch { position: absolute; ... }` positioning rule
(welcome-only), but change the two **button** rules from the `#lang-switch` id selector to the
`.lang-switch` class so all hosts share the look:
- `#lang-switch button {` → `.lang-switch button {`
- `#lang-switch button.active {` → `.lang-switch button.active {`
(The settings host flows inside the modal row — no extra positioning needed; the compact button padding
already fits the mobile modal. Scenario 14 asserts the modal still fits — see Tests.)

### 5. Cutscene screen — the i18n card + a mounted toggle (`client/src/main.js`)
The cutscene text card and its tap/skip labels are JS-set via `t()`; making them `[data-i18n]` lets the
existing `applyTranslations()` (called by `setLanguage`) re-localize them live for free.

a. In `cutsceneShowCard(textKey)` (`main.js:1126`), also stamp the key so a live language switch
re-renders the visible card:
```js
function cutsceneShowCard(textKey) {
  if (!cutOverlayEl) return;
  cutCardEl.setAttribute('data-i18n', textKey);
  cutCardEl.textContent = t(textKey);
  cutOverlayEl.style.display = 'flex';
}
```

b. In `buildCutsceneOverlay()` (`main.js:1128-1154`):
- Mark the tap affordance as i18n: in the `cutOverlayEl.innerHTML` template
  (`main.js:1141`), change `<div id="cutscene-tap">${t('ui.cutscene.tap')}</div>` to
  `<div id="cutscene-tap" data-i18n="ui.cutscene.tap"></div>` and let `applyTranslations` fill it
  (or set textContent once after mount — either is fine; the data-i18n is what enables live re-render).
- Mark the Skip button as i18n: after creating `cutSkipEl` (`main.js:1145-1146`), replace the literal
  `cutSkipEl.textContent = t('ui.cutscene.skip')` with `cutSkipEl.setAttribute('data-i18n', 'ui.cutscene.skip'); cutSkipEl.textContent = t('ui.cutscene.skip');`
- Create + mount the language host (top-left, mirroring Skip top-right), as a **body sibling** (not a
  child of `cutOverlayEl`):
```js
  cutLangEl = document.createElement('div');
  cutLangEl.id = 'cutscene-lang'; cutLangEl.className = 'lang-switch';
  document.body.appendChild(cutLangEl);
  mountLangSwitch(cutLangEl);
```
- Add the CSS for it in the injected `<style>` (`main.js:1130-1136`), next to `#cutscene-skip`:
```css
    #cutscene-lang { position: fixed; top: 14px; left: 16px; z-index: 99999; display: flex; gap: 6px; }
```
  (Button colors/borders come from the shared `.lang-switch button` rule in styles.css.)

c. Declare `cutLangEl` next to the other cutscene element vars (near `cutOverlayEl`/`cutSkipEl`,
around `main.js:87` / wherever `cutOverlayEl`/`cutSkipEl` are declared — grep `let cutSkipEl`):
add `let cutLangEl = null;`.

d. Import `mountLangSwitch` and `setLanguage` from welcome.js. Extend the existing import
(`main.js:29`):
```js
import { showWelcome, applyTranslations, welcomeStaged, mountLangSwitch } from './welcome.js';
```
(`setLanguage` itself isn't called directly from main.js — the buttons wire it internally — so only
`mountLangSwitch` is needed here.)

e. In `cutsceneEnd()` (`main.js:1120-1125`), remove the host next to the Skip button removal:
```js
  if (cutSkipEl) { cutSkipEl.remove(); cutSkipEl = null; }
  if (cutLangEl) { cutLangEl.remove(); cutLangEl = null; }
```
(The registry self-prunes detached hosts on the next `setLanguage`, so no explicit unregister is needed;
removing the node is enough and keeps the DOM clean.)

### 6. i18n catalogs — the new label (both files, keep in sync)
- `client/locales/source.json`: add after `ui.settings.quality.note` (`source.json:176`):
```json
  "ui.settings.language": { "source": "Language", "context": "Label for the EN/RU language selector row in the settings modal. One word." },
```
- `client/locales/ru.json`: add the matching translation after `ui.settings.quality.note`
  (`ru.json:176`):
```json
  "ui.settings.language": "Язык",
```
(`ui.cutscene.skip` / `ui.cutscene.tap` already exist in both catalogs — no new cutscene keys.)

## Tests
Run: `cd client && node --test` (client unit tests), and the visual suite via `client/visual/run.mjs`
(baseline is flaky ~6 scenarios — judge by the reliably-passing set + zero page errors). Server is
untouched (the `POST /language` endpoint already exists) — no `db.js`/`db_postgres.js` change, but run
`cd server && npm test` to confirm nothing regressed.

1. **Unit — `client/src/i18n.test.js`** (extend; import `langButtons`): add
```js
test('langButtons: marks the active language and lists en then ru', () => {
  assert.deepEqual(langButtons('ru'), [
    { lang: 'en', label: 'EN', active: false },
    { lang: 'ru', label: 'RU', active: true },
  ]);
  assert.deepEqual(langButtons('en').map((b) => b.active), [true, false]);
});
```
   This guards the invariant every host renders from — a correct `langButtons` + the `mountLangSwitch`
   loop means every mounted toggle shows the right active button after a switch.

2. **Visual (RU-initial-state guard) — new `client/visual/scenarios/21-language-initial-ru.mjs`.** This
   is the guard for Blocking #1: it exercises a **non-`en` INITIAL** load (which the switch-from-EN test
   below would pass through even with the bug). Seed `localStorage.lang='ru'` and reload so bootstrap
   resolves RU (`resolveLanguage({ explicit: 'ru' })` at `main.js:1235`) and its initial
   `applyTranslations()` (`main.js:1302`) must have rebuilt the toggle hosts to RU — **before any toggle
   click**. Assert both static hosts read RU active:
```js
export const name = 'language-initial-ru';

export default async function ({ page, assert }) {
  // Seed a Russian preference and reload so bootstrap adopts it on first paint.
  await page.evaluate(() => localStorage.setItem('lang', 'ru'));
  await page.reload({ waitUntil: 'networkidle' });
  // Open settings (gear is always visible) WITHOUT touching any language toggle.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(150);
  await page.click('#settings-btn');
  await page.waitForTimeout(100);
  const initial = await page.evaluate(() => ({
    docLang: document.documentElement.lang,
    welcomeActive: document.querySelector('#lang-switch button.active')?.textContent,
    settingsActive: document.querySelector('#settings-lang button.active')?.textContent,
  }));
  assert.equal(initial.docLang, 'ru', 'bootstrap loaded RU');
  assert.equal(initial.welcomeActive, 'RU', 'welcome toggle shows RU active on initial load (not stuck on EN)');
  assert.equal(initial.settingsActive, 'RU', 'settings toggle shows RU active on initial load (not stuck on EN)');
  await page.evaluate(() => localStorage.removeItem('lang')); // clean up so other scenarios start neutral
}
```
   With the bug present (hosts mounted at module-init while `getLanguage()==='en'`, never rebuilt by
   bootstrap), `welcomeActive`/`settingsActive` would read `EN` and this scenario fails — so it directly
   guards the fix in step 2c.

3. **Visual (switch-from-EN) — extend `client/visual/scenarios/14-reset-progress.mjs`** (it already opens
   the settings modal and asserts the modal fits): after `settings-open`, add assertions that (a) the
   language row is present and the modal **still fits** (`fit.boxH <= winH`, `fit.clipped <= 1` — the
   existing checks already cover the added row; keep them passing), and (b) clicking the RU button
   switches language without reloading and updates **both** the welcome and settings hosts' active button:
```js
  const langBefore = await page.evaluate(() => document.documentElement.lang);
  await page.click('#settings-lang button:last-child'); // RU (SUPPORTED = [en, ru])
  await page.waitForTimeout(120);
  const langAfter = await page.evaluate(() => ({
    docLang: document.documentElement.lang,
    settingsActive: document.querySelector('#settings-lang button.active')?.textContent,
    welcomeActive: document.querySelector('#lang-switch button.active')?.textContent,
    title: document.querySelector('#settings-overlay h1')?.textContent,
  }));
  assert.equal(langAfter.docLang, 'ru', 'language switched to RU live (no reload)');
  assert.equal(langAfter.settingsActive, 'RU', 'settings toggle shows RU active');
  assert.equal(langAfter.welcomeActive, 'RU', 'welcome toggle re-rendered to RU active (all hosts updated)');
  assert.equal(langAfter.title, 'Настройки', 'modal chrome re-localized live');
  await page.click('#settings-lang button:first-child'); // restore EN so later shots/state are stable
```
   Note: the `/api/players/:id/language` POST is best-effort (`.catch`), so it's harmless if the harness
   doesn't intercept it. This scenario behaviorally covers "setLanguage updates ALL mounted hosts."

4. **Cutscene toggle (manual + code-structure).** There is no headless cutscene scenario (driving the
   real intro needs the S3 trace asset), so the "tapping the toggle does not advance the card" guarantee
   is enforced structurally — the host is a body sibling of `cutOverlayEl` **and** each button calls
   `e.stopPropagation()` — and **verified in the pipeline live-test**: play the intro, tap EN/RU on a
   frozen card, confirm the card re-localizes in place and the cutscene does **not** advance/skip
   (`window.__replay.cut().fired` count unchanged; `.card` text changes language). Call this out for the
   live-test step; do not add a heavyweight cutscene scenario for it (DECISIONS §30).

## Docs to update
- **`docs/SUMMARY.md`:**
  - *Localization (i18n)* section (~line 1311, the "Language selection" bullet ~line 1328): update to say
    the EN/RU toggle now appears in **three** places — the welcome screen, the **Settings modal**
    (`#settings-lang`, the only path once past the intro), and the **intro cutscene** (a persistent
    top-left toggle beside Skip, gone after take-off) — all fed by one re-localize entry point
    (`applyTranslations()`, called by both bootstrap's initial load and `setLanguage`) that re-renders
    every mounted toggle host from a shared registry, so each host's active button matches the loaded
    language on first paint and after a live switch.
  - *Settings menu* bullet (~line 1260): note the modal now has a **Language (EN/RU)** row between
    Graphics quality and the reset danger zone (`ui.settings.language`, EN+RU).
  - *Level-0 intro cutscene* section (~line 376): note the persistent EN/RU toggle on the cutscene
    screen (top-left, beside Skip), that it re-localizes the visible card live and does not advance the
    cutscene, and that it exists only while the cutscene overlay is up.
  - Bump the `**Updated:**` date/line (top of SUMMARY).
- **`docs/CHANGELOG.md`:** under today's date (`## 2026-07-10`), add: **Language selector in Settings +
  intro cutscene** — EN/RU toggles added to the Settings modal and the intro cutscene screen so a
  Russian-defaulted player (e.g. on itch) can switch language after the welcome screen; both reuse the
  existing `setLanguage()` i18n path (live, no reload) via a shared toggle-host registry; cutscene toggle
  never advances the cutscene.
- **`docs/DECISIONS.md`:** add **§64** (next free number; if taken at merge time, use the next free slot):
  *"Language switching is surfaced only on the welcome screen, the Settings modal, and the intro
  cutscene — no persistent in-combat HUD control; a single re-localize entry point (`applyTranslations`,
  called by both bootstrap and `setLanguage`) drives all hosts via a small registry so a non-`en`
  initial load highlights the right button on first paint (keeps the single i18n path from DECISIONS
  §10/§30 and avoids an import cycle by mounting the
  static settings host from the i18n-glue module rather than importing `setLanguage` into `settings.js`).
  The cutscene toggle's lifecycle is tied to the cutscene overlay so it can't leak into the playable
  fallback or live Level 1."*

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)
- **No new i18n framework, plural rules, or language beyond EN/RU** — pure wiring of the existing
  mechanism into two more hosts.
- **No in-combat HUD language control** and **no language toggle on the Main Window / hangar / shop** —
  Settings is the single post-intro path, as specified.
- **No server changes** — `players.language` + `POST /api/players/:id/language` already exist; do not
  touch `db.js`/`db_postgres.js` or the API.
- **No change to when/whether the intro plays, the cutscene script, or the onboarding flow** — only add
  the toggle to the existing overlay.
- **No model/asset changes**, so **no `publish-itch` step** is required for this feature.
