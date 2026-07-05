# In-game Credits / Attribution screen

**Feature ID:** `2026-07-05-1340-credits-screen`
**Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-07-05-1340-credits-screen` (branch `feature/2026-07-05-1340-credits-screen`)

## Goal
Every 3D model in Vega Sentinels is **CC-BY 4.0**, which legally requires showing the asset
attributions to **players**. Today they live only in the repo doc `client/assets/CREDITS.md`, which
players never see — so we are formally out of compliance. Add a player-facing **Credits & attributions**
screen, opened from the Settings gear overlay (the one chrome surface reachable on menus **and** in-game),
that lists every asset with author, a link to the original, the license name + link, and a "Modified" tag
for CC-BY derivatives. The content is **generated at build time from `client/assets/CREDITS.md`** (the
single source of truth) into a committed JS module the client imports — so the exact same data ships on
**both** distribution surfaces (vega.tenony.com and the itch.io HTML5 build) from one source, with no raw
markdown shipped to players.

## Decisions (all confirmed with the maintainer — do not re-ask)
1. **Build step + committed module (parse-at-build, NOT runtime fetch).** There is no bundler and no
   build step for the vega/local serve (`docs/DECISIONS.md` §31 — buildless ES modules; files are served
   raw, and `scripts/build-itch.mjs` only *copies* `client/`). A runtime fetch of `CREDITS.md` would need
   the raw md served same-origin in **both** builds and still require filtering out repo-internal prose.
   Instead: a new `npm run credits:build` parses `client/assets/CREDITS.md` → a **committed**
   `client/src/credits-data.js`, guarded by a drift/`--check` mode wired into a unit test (mirrors
   `assets:check`). Both builds consume the committed module.
2. **Parse two STRUCTURED parts of CREDITS.md; ignore the narrative prose.** The 5-column table
   `| Asset | Author | Source URL | License | Date |` is the source of truth for the asset SET plus each
   row's author, source URL, license and group (models vs sounds). The **verbatim CC-BY blockquote
   attribution lines** (`> "TITLE" (URL) by AUTHOR is licensed under Creative Commons Attribution …`)
   supply the proper **work TITLE** for each CC-BY asset (matched to its table row by URL) — the
   TASL-correct title a compliant CC-BY credit must show ("LowPoly Spaceships", "Air & Space Vessel", …).
   Both are structured, authored-for-players content. The repo-internal **narrative prose** (pipeline
   notes, S3 prefixes, "this entry must stay" housekeeping, the HTML-comment example row) is ignored.
   For each row synthesize author + source link + license label/link; CC-BY rows get a per-asset
   "Modified" tag. *(Amended from the original table-only plan: the table has no work-title column, and
   slicing the Asset cell yields a broken file-path label like `sounds/kinetic..mp3` — a non-compliant
   credit. See the label strategy below.)*
3. **Entry point = Settings gear overlay.** A "Credits" button inside `#settings-overlay` opens a
   scrollable, closeable `#credits-overlay` panel (new `client/src/credits.js` leaf module, styled like
   the existing overlays). Reachable on menus and in-game (the gear doubles as pause).
4. **List all, grouped "3D models" + "Music & sound".** CC-BY rows get the full synthesized attribution +
   "CC BY 4.0" license link + a per-asset "Modified" tag + one blanket header note. CC0 / Pixabay-License
   rows are a courtesy list (author + source URL where present, no license link, no "Modified").
5. **Chrome labels via i18n (EN+RU); attribution *content* stays English literal.** Panel title, section
   headings, "Modified", "Source", "Close" etc. are i18n keys. Author names, model names, license names
   and URLs come straight from the generated data and are never translated (they are literal/legal text).

### Display-label strategy (the player-facing headline per credit)
The Asset cell is a repo **file path**, not a human label — e.g.
`sounds/kinetic.\<hash\>.mp3 (kinetic gun SFX)` or `ships/player_combat + player_hangar \`.glb\` (…)`.
Slicing it at a delimiter yields broken headlines (`sounds/kinetic..mp3`, a dangling `.glb`,
`ships/enemy_1–4 + enemy_1–4_orange`), so the compliance screen would render a directory listing. The
readable text lives in the parenthetical and — for CC-BY assets — as the proper **work title** in the
verbatim blockquote. Derive the label (`name`) as:

1. **CC-BY assets → the proper work TITLE from the verbatim blockquote** (the TASL-correct credit). Build
   a `URL → title` map by scanning every md line matching
   `^\s*>\s*"([^"]+)"\s*\((https?://[^)]+)\)\s*by\b` (a plain line scan — no markdown library). Each CC-BY
   table row looks up its title by its Source URL → `Air & Space Vessel`, `LowPoly Spaceships`,
   `Metal box`, `Freighter - Spaceship`, `Low Poly space station.`, `Repair Drone - XYZ Homework
   (Detailing)`, `machine gun`. **If a CC-BY row has no matching blockquote title, THROW**
   (`CC-BY asset <url> has no verbatim attribution block in CREDITS.md — add one`): the verbatim block is
   itself required for compliance, so a missing one is a real error, never a silent path fallback.
2. **Courtesy assets (CC0 / Pixabay) → the parenthetical description.** Take the text between the **first
   `(` and the last `)`** in the Asset cell → `kinetic gun SFX`, `rocket launch SFX`, `combat background
   track — "Energetic Synthwave"`, etc. These rows have no blockquote and need no title for compliance.
3. **Fallback (no blockquote title, no parenthetical) → a cleaned filename:** strip the `ships/`/`sounds/`
   prefix, drop extension fragments (`` `.glb` ``, `.\<hash\>.glb`, `.\<hash\>.mp3`, a trailing
   `.glb`/`.mp3`) and collapse any leftover `..`, then trim. This should not fire on current data, but
   guarantees the label can never be a raw path or a dangling extension.

This **replaces** the earlier `(` / ` — ` / `.` slicing rule entirely (that rule produced the broken
labels above and is dropped, so the ` — ` delimiter no longer exists anywhere in the parser).

---

## Steps

### 1. New parser/codegen script — `scripts/credits-build.mjs`
Create `scripts/credits-build.mjs` (repo root, ESM, sibling of `assets-check.mjs`). It must export **pure
functions** (for the unit test) plus a CLI.

**Exports (pure, no I/O):**
- `parseCreditsMd(md) -> { models: Asset[], sounds: Asset[] }` where
  `Asset = { name, author, url, license, licenseUrl, modified, requiresAttribution }`.
- `generateModuleSource(data) -> string` — returns the exact text of `credits-data.js` (see shape below).
- `buildModuleFromFile(mdPath) -> string` — read file + `parseCreditsMd` + `generateModuleSource`
  (used by the CLI and by `build-itch.mjs`).

**Parsing contract / input assumptions (`client/assets/CREDITS.md`):**
- Find the GFM table whose header row is `| Asset (file) | Author | Source URL | License | Date added |`.
  Parse every subsequent `|`-delimited data row until the first blank line / non-table line. Skip the
  `|---|` separator row and any row inside an HTML comment (`<!-- ... -->`) — i.e. ignore the example row
  in the comment block at `CREDITS.md:30-33`.
- Per row, columns are (1) Asset cell, (2) Author, (3) Source URL, (4) License, (5) Date.
- **Blockquote title scan (independent pass, for CC-BY work titles):** scan every md line for
  `^\s*>\s*"([^"]+)"\s*\((https?://[^)]+)\)\s*by\b` and build a `Map<url, title>`. This picks up all
  verbatim CC-BY attribution lines (one per CC-BY source; the repair+machine-gun block contributes two
  lines). No other narrative prose is read.
- **name** (col 1): derive per the **Display-label strategy** above — CC-BY rows use the work title from
  the `URL → title` map (**throw if absent**); courtesy rows use the parenthetical description; last
  resort = cleaned filename. Never emit a raw path, a `\<hash\>` token, a `..`, or a trailing
  `.glb`/`.mp3`.
- **author** (col 2): trimmed literal (e.g. `Pedram Ashoori`, `serutonin-deprivd`,
  `Freesound (CC0 filter)`).
- **url** (col 3): if the cell contains an `http(s)://…` token, capture it (strip surrounding markdown);
  else `null` (the CC0 sound rows say `_id not retained (renamed …)_` → `url: null`).
- **license** normalization (col 4):
  - `CC-BY 4.0` **or** `CC BY 4.0` → `license: 'CC BY 4.0'`,
    `licenseUrl: 'https://creativecommons.org/licenses/by/4.0/'`, `requiresAttribution: true`.
  - `CC0 1.0` → `license: 'CC0 1.0'`, `licenseUrl: null`, `requiresAttribution: false`.
  - `Pixabay Content License` → `license: 'Pixabay Content License'`, `licenseUrl: null`,
    `requiresAttribution: false`.
  - Any other license string → throw (fail loud so a new license type is handled deliberately).
- **group / `modified`**: if the Asset cell (raw col 1) starts with `ships/` → goes in `models[]` and
  `modified: true`; if it starts with `sounds/` → goes in `sounds[]` and `modified: false`. Any other
  prefix → throw (fail loud). (`modified` is derived from the group: every model we ship is a decimated /
  recolored / texture-downscaled derivative; audio is used as-is.)
- Preserve table order within each group.

**Output — `generateModuleSource(data)` produces exactly this shape** (written to
`client/src/credits-data.js`):
```js
// AUTO-GENERATED by scripts/credits-build.mjs from client/assets/CREDITS.md — DO NOT EDIT BY HAND.
// Regenerate with `npm run credits:build`. The drift check in client/src/credits-data.test.js fails
// CI if this file is out of sync with CREDITS.md. See docs/plans/2026-07-05-1340-credits-screen.md.
export const CREDITS = {
  models: [
    { name: "LowPoly Spaceships", author: "Pedram Ashoori", url: "https://skfb.ly/6pxFX", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", modified: true, requiresAttribution: true },
    { name: "Air & Space Vessel", author: "Raven", url: "https://skfb.ly/otR6F", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", modified: true, requiresAttribution: true },
    // …one entry per ships/ row, in table order (name = the blockquote work title)…
  ],
  sounds: [
    { name: "kinetic gun SFX", author: "serutonin-deprivd", url: "https://freesound.org/s/855652/", license: "CC0 1.0", licenseUrl: null, modified: false, requiresAttribution: false },
    { name: "Heavy cannon SFX", author: "Freesound (CC0 filter)", url: null, license: "CC0 1.0", licenseUrl: null, modified: false, requiresAttribution: false },
    // …one entry per sounds/ row, in table order (name = the parenthetical description)…
  ],
};
```
Use `JSON.stringify` for the field values so the output is deterministic (stable quoting/escaping) — the
drift test compares byte-for-byte. Keep the generator's whitespace/formatting fixed, **and end the output
with exactly one trailing `\n`** so an editor's or git's newline-touch can't desync the drift check.

**CLI behaviour:**
- `node scripts/credits-build.mjs` (no args) → write `client/src/credits-data.js` (resolve paths from
  the script dir, mirroring `build-itch.mjs`'s `root` computation). Print a one-line summary
  (`credits-data.js written: N models, M sounds`).
- `node scripts/credits-build.mjs --check` → generate in memory, compare to the committed
  `client/src/credits-data.js`; if different, print a diff hint and `process.exit(1)`
  (`credits-data.js is out of date — run \`npm run credits:build\``); if identical, exit 0. This mirrors
  the `assets:check` deploy-guard role.

### 2. Wire the npm script — `package.json` (repo root)
In `/Users/kbagaiev/Projects/ag-wt/2026-07-05-1340-credits-screen/package.json`, add to `"scripts"`
(after `"build:itch"`):
```json
"credits:build": "node scripts/credits-build.mjs"
```

### 3. Generate the committed data module
Run `npm run credits:build` to create `client/src/credits-data.js`. **Commit this generated file** — the
vega/local serve reads it raw (there is no build step there), so it must be current in git. The drift
test (step 8) keeps it honest.

### 4. Belt-and-suspenders regen in the itch build — `scripts/build-itch.mjs`
So the itch zip can never ship stale credits regardless of commit state, regenerate into the **staged**
copy only (never touch the committed source tree — exactly like the staged `api-base.js` override at
`build-itch.mjs:40-46`). After the `for (const d of dirs) …` copy loop (`build-itch.mjs:36`) and near the
api-base override, add:
```js
import { buildModuleFromFile } from './credits-build.mjs'; // (add to the imports at top of the file)
// …after the dir copy…
// Regenerate the credits data into the STAGED tree from CREDITS.md, so the itch export always carries
// fresh attributions even if the committed client/src/credits-data.js drifted (the source tree is
// untouched — same pattern as the api-base.js override below). See the credits-screen plan.
fs.writeFileSync(
  path.join(staging, 'src', 'credits-data.js'),
  buildModuleFromFile(path.join(clientDir, 'assets', 'CREDITS.md')),
);
```
`CREDITS.md` already reaches staging via the `assets` dir copy, but that raw md is only build input — the
client imports the generated module, never the md.

### 5. Panel markup — `client/index.html`
**(a) "Credits" button inside the settings box.** Insert immediately **before** the settings Close button
at `client/index.html:165` (`<button id="settings-close" …>`), as a normal settings row so it sits under
the danger zone:
```html
    <button id="credits-open" class="ghost" data-i18n="ui.credits.open">Credits</button>
```
**(b) The credits overlay shell.** Insert immediately **after** the `#settings-overlay` closing `</div>`
at `client/index.html:178` (a sibling top-level overlay, like settings). credits.js fills `#credits-list`
at runtime — the markup is only the shell:
```html
<div id="credits-overlay">
  <div class="credits-box">
    <h1 data-i18n="ui.credits.title">Credits &amp; attributions</h1>
    <p class="credits-intro" data-i18n="ui.credits.intro">Vega Sentinels uses third-party assets under open licenses. Thank you to their authors.</p>
    <div class="credits-note" data-i18n="ui.credits.modified_note">All 3D models are modified — decimated, recolored and/or texture-downscaled — as permitted under CC BY 4.0.</div>
    <div id="credits-list"></div>
    <button id="credits-close" class="ghost" data-i18n="ui.credits.close">Close</button>
  </div>
</div>
```

### 6. New module — `client/src/credits.js`
A leaf module in the settings.js mold (self-inits its own listeners at import; exports one localize hook).
```js
// Credits / attribution panel: data-driven from the build-generated credits-data.js (single source of
// truth = client/assets/CREDITS.md). Opened from the Settings overlay; a scrollable, closeable overlay.
// Chrome labels are i18n; attribution content (authors/titles/URLs/licenses) is literal legal text.
import { CREDITS } from './credits-data.js';
import { t } from './i18n.js';

const overlay = document.getElementById('credits-overlay');
const list = document.getElementById('credits-list');
document.getElementById('credits-open').addEventListener('click', () => { render(); overlay.classList.add('on'); });
document.getElementById('credits-close').addEventListener('click', () => overlay.classList.remove('on'));
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('on'); }); // backdrop closes

function assetRow(a) { /* build a .credit-item: name, "by {author}", Source link (if a.url),
  license link (a.licenseUrl ? <a>CC BY 4.0</a> : text a.license), and a "Modified" chip if a.modified.
  Use textContent for all literal fields (no innerHTML with data) to avoid injection. */ }

function render() {
  list.innerHTML = '';
  // Section "3D models" (CREDITS.models) then "Music & sound" (CREDITS.sounds), each with an i18n heading.
}
export function localizeCredits() { if (overlay.classList.contains('on')) render(); } // re-render on lang switch
```
Implementation notes for the row: use `document.createElement` + `textContent` for every data field
(author, name, license label) and only set `href` on anchors — never interpolate data into `innerHTML`.
The license link, when present, is an `<a target="_blank" rel="noopener">` to `a.licenseUrl` with text
`a.license`; the source link is an `<a target="_blank" rel="noopener">` to `a.url` with text
`t('ui.credits.source')`. The "Modified" chip text is `t('ui.credits.modified')`. Section headings use
`t('ui.credits.models')` / `t('ui.credits.sounds')`.

### 7. Wire the module + localization — `client/src/welcome.js`
`credits.js` self-inits on import (like `settings.js`). Mirror the `settings.js` wiring:
- At `client/src/welcome.js:15` (next to `import { localizeSettings } from './settings.js';`) add:
  `import { localizeCredits } from './credits.js';`
- At `client/src/welcome.js:102` (next to `localizeSettings();` inside the language-switch/apply flow)
  add: `localizeCredits();`

This guarantees `credits.js` is loaded (so its listeners attach) and the open panel re-renders on an
EN↔RU switch. (No change needed in `main.js` — it pulls the module transitively via `welcome.js`.)

### 8. Drift + parse unit test — `client/src/credits-data.test.js`
New `node:test` file (globbed by `cd client && node --test`; runs in CI at `.github/workflows/ci-cd.yml:31`).
- **Drift check (the CI guard):** import `buildModuleFromFile` from `../../scripts/credits-build.mjs`,
  generate from `../assets/CREDITS.md`, read the committed `./credits-data.js` via `fs`, assert byte
  equality (both end in the fixed single trailing `\n`); fail with a message telling the dev to run
  `npm run credits:build`.
- **Exact-label assertions on the REAL file (the anti-regression the critic requires — a broken path
  label must FAIL, not pass):** parse `../assets/CREDITS.md` and assert
  `sounds` contains an entry with `name === 'kinetic gun SFX'` (the `\<hash\>` sound row — proves it is
  NOT `sounds/kinetic..mp3`), and `models` contains entries with `name === 'Air & Space Vessel'` (the
  player-ship row — proves the work title, NOT `ships/player_combat + player_hangar .glb`) and
  `name === 'LowPoly Spaceships'`. Assert **no** entry's `name` contains `/`, `\<hash\>`, `..`, or ends
  in `.glb`/`.mp3`. *(The old "name stops at `(`/` — `" assertion is removed — it passed for the broken
  path output.)*
- **Parse-shape assertions from a fixture** (a small inline md with: the table header; one CC-BY `ships/`
  row `ships/foo.\<hash\>.glb (a foo) | Someone | https://skfb.ly/ZZ | CC-BY 4.0 | 2026-01-01`; a matching
  blockquote line `> "Foo Title" (https://skfb.ly/ZZ) by Someone is licensed under Creative Commons
  Attribution (http://creativecommons.org/licenses/by/4.0/).`; one CC0 `sounds/` row with a real URL and
  a `(courtesy label)`; one CC0 `sounds/` row with `_id not retained (renamed x.wav)_`; and an example row
  inside an HTML comment). Assert: the comment row is ignored; the CC-BY row lands in `models` with
  `name === 'Foo Title'` (from the blockquote — NOT the path or the `a foo` parenthetical),
  `modified:true`, `requiresAttribution:true`, `license:'CC BY 4.0'`, correct `licenseUrl`, `url` set; the
  CC0 rows land in `sounds` with `modified:false`, `requiresAttribution:false`, `name` = their
  parenthetical; the `_id not retained_` row has `url:null`.
- **Compliance invariant on the real file:** every `models` entry has `requiresAttribution:true`,
  non-null `url`, non-null `licenseUrl`, and a `name` that is not a file path.
- **Fail-loud:** a fixture with a CC-BY row whose URL has no matching blockquote makes `parseCreditsMd`
  throw.

---

## Tests
- **Client logic tests:** `cd /Users/kbagaiev/Projects/ag-wt/2026-07-05-1340-credits-screen/client && node --test`
  — runs the new `credits-data.test.js` (drift + parse) alongside the existing suite.
- **No server / DB changes** — this feature touches only `client/` + `scripts/` + docs. `server/src/db.js`
  and `db_postgres.js` are **not** touched, so the SQLite/Postgres parity concern does not apply; server
  tests are unaffected.
- **Regenerate + verify:** `npm run credits:build` then `npm run credits:build -- --check` (exits 0 when
  in sync).
- **Manual acceptance** (matches the acceptance criteria):
  1. Serve the client (`/run-local` skill / the local static server), open the game → gear → **Credits**.
     Confirm every CC-BY model shows name, `by <author>`, a **Source** link, a **CC BY 4.0** license link,
     and a **Modified** tag; the sounds section lists the CC0/Pixabay assets as a courtesy.
  2. Edit a row in `client/assets/CREDITS.md` (e.g. change an author), run `npm run credits:build`, reload
     → the screen reflects the change. (Without the rebuild, `node --test` fails on drift — the guard.)
  3. `npm run build:itch`, unzip `dist/vega-sentinels-itch.zip`, serve it, open Credits → same content
     present (the staged `src/credits-data.js` was regenerated from `CREDITS.md`).

---

## Docs to update
- **`docs/SUMMARY.md`:**
  - Add a **"Credits & attributions"** bullet under the **Tools** section (near Settings, around the
    Settings/Perf-overlay area) describing: opened from the Settings gear overlay via a "Credits" button;
    a scrollable `#credits-overlay` (`client/src/credits.js`) listing 3D models (full CC-BY attribution +
    license link + "Modified") and music/sound (CC0/Pixabay courtesy list); the content is
    **build-generated** from `client/assets/CREDITS.md` by `npm run credits:build` →
    `client/src/credits-data.js` (committed), guarded by the drift test `credits-data.test.js`.
  - In the **asset-pipeline / build** area, add `credits:build` to the list of npm scripts and note
    `build:itch` regenerates the staged `credits-data.js` from `CREDITS.md`.
  - Update the lead **Updated:** line (date 2026-07-05) with a short summary phrase for this change.
- **`docs/CHANGELOG.md`:** add a bullet under the `## 2026-07-05` heading (create nothing new — the
  heading exists): **"In-game Credits screen (CC-BY compliance)"** — a player-facing Credits &
  attributions panel, opened from the Settings gear, generated at build time from
  `client/assets/CREDITS.md` (single source of truth) via `npm run credits:build` → committed
  `client/src/credits-data.js`, drift-guarded by a unit test and re-generated into the itch zip by
  `build:itch`; satisfies the CC-BY 4.0 obligation to show attributions to players on both vega.tenony.com
  and itch.io.
- **`docs/DECISIONS.md`:** add **§48 — In-game credits screen: legal obligation + parse-at-build committed
  module (vs runtime fetch)**. Record: (1) CC-BY 4.0 requires showing author/source/license/modified to
  players, so a repo doc is not enough; (2) chosen parse-at-build into a committed module because the
  client is buildless (§31) and the vega serve has no build step, so a runtime md-fetch would need the raw
  md served + filtered in both builds; (3) two STRUCTURED parts of CREDITS.md are parsed — the 5-column
  table (asset set + author/url/license/group) and the verbatim CC-BY blockquote lines (the work title,
  matched by URL) — while the surrounding narrative prose is ignored, and a CC-BY row with no verbatim
  block is a hard error (the block is required for compliance); (4) drift-guarded by a unit test mirroring
  `assets:check`; (5) chrome i18n, attribution content literal.

---

## Ship to itch (required — this is a two-surface compliance feature)
This feature's whole point is compliance on **both** distribution surfaces. After the normal prod deploy
of the vega build, **re-publish the itch build** so the Credits screen reaches itch players too:
`npm run build:itch` then the `/publish-itch` skill. (This is not the model-hash caveat of DECISIONS §37 —
no catalog/model hash changed — but the itch zip must be rebuilt+published to carry the new
`credits-data.js` and the new panel code.)

---

## i18n keys to add
Add to **`client/locales/source.json`** (English source of truth, with `context`) **and**
**`client/locales/ru.json`** (RU values). Suggested strings:

| key | EN (`source.json`) | RU (`ru.json`) |
|-----|--------------------|----------------|
| `ui.credits.open` | Credits | Титры |
| `ui.credits.title` | Credits & attributions | Титры и авторы |
| `ui.credits.intro` | Vega Sentinels uses third-party assets under open licenses. Thank you to their authors. | Vega Sentinels использует сторонние ассеты под открытыми лицензиями. Спасибо их авторам. |
| `ui.credits.modified_note` | All 3D models are modified — decimated, recolored and/or texture-downscaled — as permitted under CC BY 4.0. | Все 3D-модели изменены — упрощены, перекрашены и/или с уменьшенными текстурами — как разрешено лицензией CC BY 4.0. |
| `ui.credits.models` | 3D models | 3D-модели |
| `ui.credits.sounds` | Music & sound | Музыка и звук |
| `ui.credits.modified` | Modified | Изменено |
| `ui.credits.source` | Source | Источник |
| `ui.credits.close` | Close | Закрыть |

(Give each `source.json` entry a `context` note like the neighbours at `source.json:152+`. The em-dash in
`ui.credits.modified_note` must match the em-dash used in the parser's blanket note / index.html shell.)

---

## Styling — `client/styles.css`
Add a `#credits-overlay` block modelled on the `#settings-overlay` rules (`client/styles.css:453-517`):
- `#credits-overlay { position: fixed; inset: 0; z-index: 21; display: none; align-items: center;
  justify-content: center; background: rgba(5,6,13,.66); color: #e8f1ff; font-family: system-ui;
  padding: 20px; }` and `#credits-overlay.on { display: flex; }` (**z-index 21** so it sits above the
  `#settings-overlay` z-index-20 it opens from).
- `.credits-box` mirrors `.settings-box` (`width: min(560px, 94vw); max-height: 92vh; overflow-y: auto;`
  same background/border/radius/padding) — the **scrollable** panel.
- `.credits-intro` / `.credits-note` small muted text (reuse the `.set-note` look; the note slightly
  emphasized). `.credit-section-title` = a section heading (like `#settings-overlay h1` but smaller).
  `.credit-item` = a row (name bold, author/links muted, spacing). `.credit-modified` = a small pill
  (reuse the `.set-toggle` cyan-chip look). `#credits-close` reuses the `#settings-close` styling.
- Keep it readable on the device-profile form factors: the box is already `min(560px,94vw)` + scrollable,
  which matches how `.settings-box` behaves on phones (`body.rot` rotation applies to it for free).

---

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)
- **No runtime fetch / no shipping raw `CREDITS.md` to the client** — the committed generated module is
  the only data path.
- **No parsing of the repo-internal narrative prose** (pipeline notes, S3 prefixes, "this entry must
  stay" housekeeping, the HTML-comment example row). The parser DOES read two structured parts — the
  5-column table and the verbatim CC-BY blockquote attribution lines (for the work title) — and nothing
  else. No general markdown library.
- **No thumbnails, search, filtering, pagination, or collapsible sections** — a plain scrollable list.
- **No new server endpoint, DB migration, or catalog change.** No `db.js`/`db_postgres.js` edits.
- **No translation of attribution content** (authors, model names, license names, URLs stay literal);
  only the panel chrome is i18n.
- **No second entry point** (e.g. a Main Window menu item or welcome-screen link) — the Settings overlay
  covers both menus and in-game from one insertion.
- **No new visual-test scenario required** (the flaky visual suite, MEMORY note, adds no compliance value
  here); the drift unit test + manual acceptance are sufficient.
