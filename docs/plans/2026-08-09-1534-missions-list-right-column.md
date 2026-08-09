# Missions: the mission list moves into the right column; the ship preview is dropped

**Status:** ready to implement · **Area:** client Main Window (base screen) · **Type:** UI layout

## Goal

In the base **Main Window**, the Missions view currently shows the mission board (campaign + side-mission
cards) stacked **above** the briefing in the center work zone, while the right ~25% column holds a spinning
3D preview of the player's ship plus a ship-characteristics strip. This change **removes the right-column
ship preview and its stats strip from every view except Loadout**, and **moves the mission list into that
right column**. The center work zone in Missions then holds **only the mission body** — title, description
(with the granted-item 3D showcase), reward line, Take off + note — so the briefing gets the full height and
width it deserves, and the mission list is always visible beside it instead of eating 42% of the center.
Character / Map / Craft, which have no right-column content any more, collapse to a **two-column** grid
(menu | work zone). Loadout is untouched: it keeps its centered ship, its 30% right context panel, and the
ship-characteristics strip — which is now the **only** place ship stats are shown.

User-visible effect: Missions reads as "list on the right, briefing in the middle"; the ship model no longer
spins beside the briefing (it still spins in Loadout); Character/Map/Craft get the extra width.

## Decisions (already settled with the maintainer — do NOT re-open)

1. **The right-column ship preview (`#mw-ship` canvas) and the ship-characteristics strip (`#ship-stats`)
   are removed from every view except Loadout.** The `#mw-ship` canvas and its viewer (`mwPreview`) are
   **deleted outright** — no dormant/dead code. `#ship-stats` is **not moved**: it stays exactly where it is
   in the markup (inside the right column, above `#loadout-panel`) and is simply **scoped to
   `#mainwin.bay-open`** — it already survives Loadout today (`client/styles.css:208` only hides `#mw-ship`)
   and `renderBay()` re-renders it with ▲/▼ deltas (`client/src/shop.js:346`). Zero movement, minimal diff.
2. **`#mw-mission-board` moves out of the center work zone (`client/index.html:67`) into the right column
   (`<aside id="mw-ship-col">`, `client/index.html:105-111`).** It is rendered by the unchanged
   `renderMissionsBoard()` and its click handler (`client/src/mainwindow.js:261`) binds by id, so relocating
   the element in the DOM needs no JS change to the board itself.
3. **The center work zone in Missions holds only the mission body:** `#mw-mission-title`,
   `#mw-mission-desc` (incl. the `#mw-item` granted-item showcase + `#mw-item-strut`), `#mw-mission-reward`,
   `#mw-go`, `#mw-go-note`.
4. **Mission cards keep their content and controls** — title, Active/Taken badge, reward/XP sub-line,
   Take / Defer / Set active — but **restack vertically** for the narrow column: line 1 = title (badge
   right-aligned on the same line), line 2 = reward/XP sub-line, line 3 = action buttons right-aligned.
   The column stays **25%**; the existing `body.dev-phone` font shrink (`client/styles.css:272-277`) is kept.
5. **Character / Map / Craft collapse to two columns.** `#mainwin` gets a per-view class (`missions-open`,
   mirroring the existing `bay-open`); base `grid-template-columns` becomes `menu | 1fr` and `#mw-ship-col`
   is `display: none`. Missions → `menu | 1fr | 25%`; Loadout → `menu | 1fr | 30%` (unchanged).
6. **The mission list stays visible during the staged campaign-briefing reveal.** The `.briefing-hide-ship`
   class is **deleted** (CSS + JS). The staged reveal (L1-L3 campaign briefing) keeps only: typewriter ~5 s →
   granted-item showcase in the center at typing-done → **Take off +0.5 s later** (`.briefing-hide-go`
   unchanged). Rationale: on L1-L3 side missions are still locked, so the list holds exactly **one** card
   (the campaign one) — blanking the whole right column for 5 s every landing buys nothing and now looks
   like a broken list. Recorded as DECISIONS §96.
7. **No header/caption above the list** — cards only, top-aligned, `overflow-y: auto` over the full column
   height. The left menu already highlights "Missions". No new i18n strings are added by this change.
8. **The aside keeps its id `#mw-ship-col`.** It no longer holds a ship, but renaming it would churn
   `index.html`, four CSS rules, a visual scenario and several SUMMARY lines for zero behavior. Its HTML/CSS
   comments are updated to say "right column (mission list on Missions, ship stats + context panel on
   Loadout)". If a rename is ever wanted, it is a separate, mechanical change.
9. **Scenarios 18 + 97 must have their `landOn()` gate repointed.** Both wait on
   `window.__game.previewTarget` (`= mwPreview && mwPreview.url`, `client/src/main.js:830`), which **dies
   with the viewer** — they would **hang on a 4 s timeout**, not fail with a useful message. New gate:
   `#mainwin.on` + at least one `.mission-card` rendered.

## Replay / intro impact

None. This is a pure DOM/CSS/menu-UI change: it touches no sim, damage, collision, RNG or input path, so the
deterministic re-sim in `client/src/replay.js` and the recorded Level-0 intro trace are unaffected
(`22-intro-replay` needs no edit). The only intro-adjacent surface is the **landing after the intro**
(`finishIntro` → `showMain` → Level-1 briefing) — covered by the Stage-9 live check below.

## Steps

### 1. Markup — `client/index.html`

**(a)** Delete the mission board from the work zone. Remove lines 65-67:

```html
      <!-- mission board (Slice B): campaign + side-mission cards with take/defer/set-active; clicking a
           card shows its briefing below. Take-off flies the ACTIVE mission. -->
      <div id="mw-mission-board"></div>
```

so `#mw-view-mission` (`client/index.html:64`) starts directly with `<h2 id="mw-mission-title">`.

**(b)** Replace the aside (`client/index.html:105-111`) with:

```html
  <!-- Right column. Its contents are per-view and mutually exclusive (CSS-gated):
       · Missions (#mainwin.missions-open) → the mission list (campaign + side-mission cards).
       · Loadout  (#mainwin.bay-open)      → the ship-characteristics strip + the slot/shop context panel.
       · Character / Map / Craft           → nothing: the column is hidden and the grid drops to 2 columns.
       (The id is historical — this column used to hold the 3D ship preview, now removed everywhere but
       Loadout, where the ship is centered in the work zone instead.) -->
  <aside id="mw-ship-col">
    <div id="mw-mission-board"></div>
    <div id="ship-stats"></div>
    <div id="loadout-panel"></div>
  </aside>
```

Note the `<canvas id="mw-ship">` is gone. Also update the stale grid comment at `client/index.html:48-49`
("this grid is left menu | work zone | ship-model preview") to "left menu | work zone | per-view right
column (mission list / Loadout panel)".

### 2. Layout CSS — `client/styles.css`

**(a) Grid tracks** — replace `#mainwin`'s `grid-template-columns` (`:99`) and the non-phone override
(`:111`), and fold the Loadout override (`:212-213`) into the same block:

```css
  #mainwin {
    position: fixed; inset: 0; z-index: 12; display: none;
    grid-template-columns: minmax(160px, 18%) 1fr;   /* base: 2 columns — Character / Map / Craft */
    ...
  }
  body:not(.dev-phone) #mainwin { grid-template-columns: minmax(240px, 18%) 1fr; }
  /* Missions adds the right column (the mission list, 25%); Loadout adds the context panel (30%). */
  #mainwin.missions-open { grid-template-columns: minmax(160px, 18%) 1fr 25%; }
  #mainwin.bay-open      { grid-template-columns: minmax(160px, 18%) 1fr 30%; }
  body:not(.dev-phone) #mainwin.missions-open { grid-template-columns: minmax(240px, 18%) 1fr 25%; }
  body:not(.dev-phone) #mainwin.bay-open      { grid-template-columns: minmax(240px, 18%) 1fr 30%; }
```

Keep the existing explanatory comment about the `minmax(240px, …)` widening for `#account-bar`.

**(a2) Fix the now-false block comment above it** (`client/styles.css:92-96`) — it currently reads
"below it a 3-column grid — left menu | work zone | ship-model preview". Rewrite that clause to:

```css
     Ships) lives in its own fixed elements; below it a grid — left menu | work zone | a PER-VIEW right
     column (the mission list on Missions, the Loadout context panel on Loadout, absent on
     Character/Map/Craft, where the grid drops to two columns). Only the work zone (mission description /
     shop) and the mission list scroll; the frame stays put.
```

**(b) The column itself** — replace `:320-321`:

```css
  /* right column — hidden unless the open view has content for it (Missions list / Loadout panel) */
  #mw-ship-col { display: none; flex-direction: column; min-width: 0; }
  #mainwin.missions-open #mw-ship-col, #mainwin.bay-open #mw-ship-col { display: flex; }
```

(`#mw-ship`'s rule at `:321` is deleted with the canvas.)

**(c) Delete** `#mainwin.bay-open #mw-ship { display: none; }` (`:208`) — the canvas no longer exists — **and
rewrite the Loadout section comment right above it** (`client/styles.css:205-207`), which still claims the
panel shares the column "with the missions ship preview" and that "the grid keeps its normal three tracks;
only the right column's contents swap (ship preview → panel)":

```css
  /* Loadout screen (Slice C): centered ship + slot chips around it (center work zone) + a right context
     panel in the SAME right column the Missions view uses for the mission list (no box). Loadout widens
     that column from 25% to 30% for the shop's 3D-model card; the column's contents swap per view
     (mission list → ship-stats strip + panel). */
```

**(d) Ship-stats scoped to Loadout** — at `:405`, change the strip to be hidden by default:

```css
  #ship-stats { display: none; flex-wrap: nowrap; gap: 8px; justify-content: center; margin: 0 0 6px; }
  #mainwin.bay-open #ship-stats { display: flex; }   /* ship characteristics live in Loadout only */
```

The `.stat`/`.k`/`.v`/`.d` rules (`:406-411`) and the desktop ×2 sizes (`:462-464`) are unchanged. Update the
stale comment at `:511-512` ("it lives above the model (`#mw-ship-col`)") to "it lives at the top of the
right column, Loadout only".

**(e) The board in the column** — replace `:157`:

```css
  /* mission list — the right column on the Missions view (campaign + side-mission cards, scrolls) */
  #mw-mission-board { display: none; }
  #mainwin.missions-open #mw-mission-board {
    display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; min-height: 0; overflow-y: auto;
  }
```

(The `display:none` default matters: without it the board would render **above** the Loadout context panel
in the same column.)

**(f) Card restack for the narrow column** — replace the `.mission-card` layout rules (`:158-171`; the
button rules `:172-177` stay as they are):

```css
  .mission-card {
    display: grid; grid-template-columns: 1fr auto; align-items: start; gap: 3px 8px;
    padding: 8px 10px; cursor: pointer; flex: none;
    border: 1px solid rgba(140,175,255,.22); border-radius: 8px; background: rgba(20,30,55,.5);
  }
  .mission-card:hover { background: rgba(40,60,100,.5); }
  .mission-card.selected { border-color: #4a7dff; }
  .mission-card.active { border-color: #ffcf5a; background: rgba(90,72,24,.32); } /* active mission = gold accent */
  .mission-card .mc-main { grid-column: 1; grid-row: 1; min-width: 0; }
  /* the title WRAPS in the narrow column (no ellipsis) — side-mission titles are two words too long */
  .mission-card .mc-title { font-size: 15px; line-height: 1.25; color: #dfe9ff; overflow-wrap: anywhere; }
  .mission-card .mc-sub { font-size: 12px; color: #9fb3d6; margin-top: 2px; }
  .mission-card .mc-badge {
    grid-column: 2; grid-row: 1; align-self: start; flex: none;
    font-size: 11px; letter-spacing: .5px; padding: 2px 8px; border-radius: 10px; white-space: nowrap;
  }
  .mission-card .mc-badge.active { background: #ffcf5a; color: #1a1a1a; }
  .mission-card .mc-badge.taken { background: rgba(120,160,255,.28); color: #cfe0ff; }
  .mission-card .mc-actions {
    grid-column: 1 / -1; grid-row: 2; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px;
  }
  .mission-card .mc-actions:empty { display: none; }  /* active campaign card has no buttons → no empty row */
```

`missionCard()` (`client/src/mainwindow.js:205-224`) already emits exactly `.mc-main` (title + sub),
`.mc-badge` and `.mc-actions` in that order — **no JS change is needed** for the restack.

**(g)** Leave `body.dev-phone .mission-card …` (`:273-277`) as-is; it now shrinks the same restacked card.

### 3. `client/src/mainwindow.js` — per-view class, delete the preview, simplify the staged reveal

**(a0) File header comment** (`client/src/mainwindow.js:1-5`) — line `:2` still says "a center work zone +
a 25% ship-model preview" and `:3` calls Missions "a central board". Rewrite the first three lines to:

```js
// Main Window (the between-battles / landing screen; was the "Hangar"): fixed landscape layout — a left
// menu (Character / Missions / Loadout / Map / Craft) + a center work zone + a PER-VIEW right column
// (the mission list on Missions, the Loadout context panel on Loadout, absent elsewhere). Missions is a
// right-column list of cards + the briefing body in the work zone (this file); Loadout is the ship+slots
// screen (shop.js); the spinning-model viewers live in model-viewer.js (work-zone item showcase #mw-item
// and the Loadout ship/item viewers).
```

(Fold the `:4-5` viewer sentence into it as shown — that is the same edit listed in the table below for
`:4`/`:10`.)

**(a) `selectMenu`** (`:111-133`):

- After the existing `mainEl.classList.toggle('bay-open', isBay);` (`:122`) add:
  ```js
  mainEl.classList.toggle('missions-open', isMissions); // Missions shows the mission list in the right column
  ```
  and update the trailing comment on the `bay-open` line (it says "hide the right-column preview").
- Replace the viewer start/stop block (`:123-128`) with:
  ```js
  // Exactly ONE ship viewer runs per view (DECISIONS §92): Loadout owns the centered-ship + item-model
  // viewers; every other view runs none (the right-column ship preview was removed). Stopping the
  // off-view viewers is what keeps the spin smooth.
  if (!isBay) stopLoadoutPreview();
  ```
  (the `stopViewer(mwItem)` calls on the non-mission branches at `:130-132` stay unchanged).

**(b) `showMain`** (`:63-68`): drop the always-on stats render (it belongs to Loadout now — `renderBay()`
does it) and the preview start. Replace lines 61-68 with:

```js
  if (G.activeShip && G.activeShip.components) resetShipStatsDelta(); // Loadout's ▲/▼ baseline starts clean each landing
  if (!stagedActive) applyShowcaseTarget();  // when staging, the reveal defers the granted-item showcase itself
```

Keep the `resetShipStatsDelta` import; **drop** `renderShipStatsBar` and `deriveShipStats` from the import
list at `:22` if nothing else in this file uses them (grep — after this edit they are unused here; they stay
exported from `shop.js`, which calls them at `:346`).

*(Note: that surviving `resetShipStatsDelta()` call is belt-and-braces, not load-bearing — `openBay()`
already sets `lastShipStats = null` on every Main Window open, `client/src/shop.js:453`. Keeping it costs
nothing and keeps the intent explicit; dropping it and the import instead is also acceptable. Do not spend
review time on this either way.)*

**(c) Delete the whole "Main Window ship-model preview (right column)" section** (`:407-437` +
`applyPreviewTarget` at `:450-453`): `mwPreview`, `startShipPreview`, `stopShipPreview`, `setPreviewModel`,
`loadPreviewModel`, `previewShip`, and the section's header comment. Replace `applyPreviewTarget` with:

```js
// Point the work-zone showcase at the item this briefing grants (Machine Gun on L2, Repair drone on L3 —
// the server attaches `showcase {kind,id}`), or hide it when the briefing grants nothing.
function applyShowcaseTarget() { showShowcaseItem(briefingShowcase(mainBriefing)); }
```

Then fix every caller / leftover:

| line (pre-edit) | change |
| --- | --- |
| `:4`, `:10` header comments | drop "right-column preview `#mw-ship`" / `mwPreview` from the file header |
| `:19` `import { shipModelCfg }` | **delete** (only `loadPreviewModel`/`previewShip` used it — grep to confirm) |
| `:76` `stopShipPreview();` in `launchCampaign` | delete |
| `:305` `applyPreviewTarget();` in `revealBriefingNow` | → `applyShowcaseTarget();` |
| `:315` `previewShip();` in `startStagedReveal` | delete (nothing to preload any more) |
| `:318` `applyPreviewTarget();` | → `applyShowcaseTarget();` |
| `:339` `previewShip();` in the side-mission branch | delete (the following `showShowcaseItem(null)` stays) |
| `:354` `applyPreviewTarget();` | → `applyShowcaseTarget();` |
| `:397` `stopShipPreview();` in `launchMission` | delete |
| `:480` `resizeViewers` | → `function resizeViewers() { resizeViewer(mwItem); }` |

**(d) Staged reveal — drop `.briefing-hide-ship`** (decision 6):

- `resetBriefingReveal` (`:279`) and `settleBriefingReveal` (`:286`):
  `mainEl.classList.remove('briefing-hide-ship', 'briefing-hide-go');` → `mainEl.classList.remove('briefing-hide-go');`
- `revealBriefingNow` (`:304`): same one-class removal.
- `startStagedReveal` (`:313`): `mainEl.classList.add('briefing-hide-ship', 'briefing-hide-go');` →
  `mainEl.classList.add('briefing-hide-go'); // hide Take-off while typing (the mission list stays visible)`
- `startStagedReveal`'s `onDone` (`:317-318`): delete the `mainEl.classList.remove('briefing-hide-ship')`
  line; the callback becomes:
  ```js
  stagedCtl = typeText(textEl, stagedFullText, { total: 5000, onDone: () => {
    applyShowcaseTarget();                           // the granted item (L2/L3) fades into the work zone…
    stagedGoTimer = setTimeout(() => {               // …Take-off 0.5s later
      stagedGoTimer = 0;
      mainEl.classList.remove('briefing-hide-go');
      stagedActive = false; briefingRevealDone = true;
    }, 500);
  }});
  ```
- Update the section comment at `:308` ("Staged sequence: typewriter (~5s) → ship window + showcase in →
  +0.5s Take-off in") to "typewriter (~5s) → granted-item showcase in → +0.5s Take-off in (the mission list
  stays visible throughout)".

**(e) CSS side of the same** — `client/styles.css:322-328`: delete
`#mainwin.briefing-hide-ship #mw-ship-col { opacity: 0; visibility: hidden; }`, change the transition rule to
`#mw-go { transition: opacity .25s ease; }`, and rewrite the block comment to describe only the Take-off beat.

### 4. `client/src/main.js` — the `?debug` hook

- `:34` import: drop `mwPreview` from the `./mainwindow.js` import list.
- `:830`: delete `get previewTarget() { … }` entirely (the scenarios are repointed in step 5).
- `:777` comment: `(missionOffers/mainBriefing/mwPreview/mwItem)` → `(missionOffers/mainBriefing/mwItem)`;
  `:774-775` "the ship-preview and briefing-item showcase viewers" → "the briefing-item showcase viewer".

No other module reads these symbols — verified by
`grep -rn "previewTarget\|mwPreview\|briefing-hide-ship\|ShipPreview\|loadPreviewModel\|previewShip\|applyPreviewTarget\|setPreviewModel\|mw-ship" client server docs`.
`client/src/dev.js`, `client/src/welcome.js`, `client/src/shop.js` and every `client/src/*.test.js` are
clean; the only remaining hits after this change must be `#mw-ships` (the unrelated top-bar label,
`index.html:137`, `styles.css:585`, `23-topbar-credits-radar.mjs`) and historical `docs/plans/*` briefs
(left as written — they document what was built at the time).

### 5. Visual scenarios (`client/visual/scenarios/`)

**`10-mission-board.mjs`** — the board still lives at `#mw-mission-board`, so all existing selectors keep
working. Insert the **layout block below immediately after `await shot('board');` (`:31`)** — i.e. before
the "selecting the first side-mission card" step at `:33` — and note that it **must return to the Missions
view** (its last two lines) so the Take / Set-active / Take-off steps that follow still find the cards:

```js
  // the list lives in the RIGHT column now; the work zone holds only the mission body
  const layout = await page.evaluate(() => {
    const col = document.getElementById('mw-ship-col').getBoundingClientRect();
    const board = document.getElementById('mw-mission-board').getBoundingClientRect();
    const work = document.getElementById('mw-work').getBoundingClientRect();
    return {
      inColumn: board.left >= col.left - 1 && board.right <= col.right + 1,
      rightOfWork: board.left >= work.right - 1,
      cardsInWork: document.querySelectorAll('#mw-work .mission-card').length,
      shipCanvas: !!document.getElementById('mw-ship'),
      statsShown: getComputedStyle(document.getElementById('ship-stats')).display !== 'none',
      workW: work.width,
    };
  });
  assert.ok(layout.inColumn, 'the mission list renders inside the right column');
  assert.ok(layout.rightOfWork, 'the mission list sits to the right of the work zone');
  assert.equal(layout.cardsInWork, 0, 'no mission cards are left in the center work zone');
  assert.ok(!layout.shipCanvas, 'the right-column ship preview canvas is gone');
  assert.ok(!layout.statsShown, 'ship characteristics are hidden outside Loadout');

  // Character / Map / Craft have no right-column content → the grid collapses to two columns
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="character"]').click());
  await page.waitForTimeout(80);
  const collapsed = await page.evaluate(() => ({
    col: getComputedStyle(document.getElementById('mw-ship-col')).display,
    workW: document.getElementById('mw-work').getBoundingClientRect().width,
  }));
  assert.equal(collapsed.col, 'none', 'Character hides the right column');
  assert.ok(collapsed.workW > layout.workW + 50, 'the work zone takes over the freed width');
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="missions"]').click());
  await page.waitForFunction('document.querySelectorAll("#mw-mission-board .mission-card").length === 4', null, { timeout: 4000 });
```

**`07-mobile-hangar.mjs`** — retitle the column (comments at `:1-3` and `:16`, the `ship` variable at `:20`
→ `side`, the assertion label at `:30`). Keep `sideQuarter > 0.18 && < 0.32` ("the right column is ~25% of
the width"), and **add** a narrow-column fit check at 760×360 (the campaign card is always present; this
scenario runs after 05 so side missions are unlocked too):

```js
  const fits = await page.evaluate(() => {
    const col = document.getElementById('mw-ship-col').getBoundingClientRect();
    const cards = [...document.querySelectorAll('#mw-mission-board .mission-card')];
    const btns = [...document.querySelectorAll('#mw-mission-board .mc-actions button')];
    return {
      cards: cards.length,
      cardsFit: cards.every((c) => c.getBoundingClientRect().right <= col.right + 1),
      btnsFit: btns.every((b) => b.getBoundingClientRect().right <= col.right + 1),
      scrolls: getComputedStyle(document.getElementById('mw-mission-board')).overflowY === 'auto',
    };
  });
  assert.ok(fits.cards >= 1, 'the mission list renders in the right column on a phone-landscape viewport');
  assert.ok(fits.cardsFit, 'mission cards fit inside the 25% column');
  assert.ok(fits.btnsFit, 'mission-card action buttons fit inside the 25% column');
  assert.ok(fits.scrolls, 'the mission list is its own scroller');
```

**`05-hangar-shop.mjs`** — the `#ship-stats .stat` count (`:30`, `:36`) is read **after** opening Loadout, so
it still passes. **Add**, right after the `#mainwin.on` wait at `:20` (i.e. on the Missions view, before the
Loadout click at `:24`):

```js
  const statsOnMissions = await page.evaluate(() => getComputedStyle(document.getElementById('ship-stats')).display);
  assert.equal(statsOnMissions, 'none', 'ship characteristics are Loadout-only (hidden on Missions)');
```

**`18-briefing-staged-reveal.mjs`**:
- `:1-3` header comment: "…on L2/L3 the Main Window campaign briefing types out then reveals the
  **granted-item showcase + Take-off** (the mission list stays visible throughout)".
- `:17` comment + `:92` comment: the helper is no longer "previewTarget-gated" — say "Main-Window-gated".
- `landOn` (`:100`): replace `await page.waitForFunction('!!(window.__game.previewTarget)', …)` with
  ```js
    await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
    await page.waitForFunction('document.querySelectorAll("#mw-mission-board .mission-card").length >= 1', null, { timeout: 4000 });
  ```
  (`showMain` renders the campaign card synchronously, so this resolves on every Main Window landing —
  including L1, though the L1 half of this scenario keeps using its own `landWelcome`.)
- **Do NOT assert on `visibility` for `#mw-ship-col` anywhere.** `getComputedStyle(el).visibility` returns
  `'visible'` even when the element (or an ancestor) is `display: none`, so a
  `assert.equal(css('#mw-ship-col','visibility'), 'visible', …)` can never fail — it would pass with the
  column hidden **and** with the `missions-open` CSS broken, leaving decision 6 unguarded. Scenarios 10 and
  07 can't cover this either: they run on the cleared campaign (`level-5`), where staging never plays. This
  scenario is the **only** guard for "the list stays visible while a briefing types out", so it must probe
  something that actually renders. Add this helper next to `css`/`textLen` (`:11-15`):
  ```js
  // the mission list is genuinely on screen: not display:none, and laid out with real width + cards
  const listShown = () => page.evaluate(() => {
    const col = document.getElementById('mw-ship-col');
    const board = document.getElementById('mw-mission-board');
    if (!col || !board) return false;
    if (getComputedStyle(col).display === 'none' || getComputedStyle(board).display === 'none') return false;
    return board.getBoundingClientRect().width > 0 && board.querySelectorAll('.mission-card').length >= 1;
  });
  ```
- `:108` mid-type assertion — **replace** the `#mw-ship-col` `visibility === 'hidden'` line with (this is
  the guard for decision 6):
  ```js
    assert.ok(await listShown(), `${label}: the mission list stays on screen while the briefing types`);
    assert.equal(await page.evaluate(() => window.__game.itemShowcaseTarget), null, `${label}: the granted-item showcase is held while typing`);
  ```
  (`#mw-go`'s `visibility === 'hidden'` check at `:109` **stays** — that element is `visibility`-hidden by
  design, `.briefing-hide-go`, and its layout box is never `display:none`, so the check is meaningful.)
- `:116` (after skip) → replace the `#mw-ship-col` line with:
  ```js
    assert.ok(await listShown(), `${label}: the mission list is still on screen after the skip`);
  ```
  The `#mw-go` visible check and the `itemShowcaseTarget` match at `:119-120` are unchanged.
- `:131` (L4 instant) → replace the `#mw-ship-col` line with:
  ```js
  assert.ok(await listShown(), 'L4: the mission list is on screen');
  ```

**`97-briefing-showcase.mjs`**:
- Header (`:1-5`): drop "WITHOUT replacing the ship in the right-column preview" / the `previewTarget`
  sentence; say the showcase renders in the work zone while the **mission list** occupies the right column.
- `landOn` (`:20`): same gate replacement as scenario 18.
- Delete `const ship = …` (`:22`) and `const isShip = …` (`:24`) and the four
  `assert.ok(isShip(await ship()), …)` lines (`:30`, `:37`, `:42`, `:53`). Replace the first of them with a
  single positive check that the column now shows the list:
  ```js
  assert.ok(await page.evaluate(() => document.querySelectorAll('#mw-mission-board .mission-card').length >= 1),
    'L2: the right column shows the mission list (no ship preview)');
  ```
  The rest of the scenario (item showcase per level, side-mission selection hiding it) is unchanged — note
  its `#mw-mission-board .mission-card` clicks at `:47-48` still work, the cards just live elsewhere.

**No new scenario file** is needed — 10 covers the right-column list + the two-column collapse, 07 covers the
narrow-column fit, 18 covers the staged reveal, 05 covers the Loadout-only stats.

### 6. Docs

- **`docs/SUMMARY.md`** (edit in place, bump `**Updated:**` to 2026-08-09 and lead the header note with this
  change):
  - `:1001` — "a **25% live ship-model preview** (`#mw-ship`)" → the per-view right column: the **mission
    list** on Missions (25%), the Loadout context panel (30%), **hidden** on Character/Map/Craft where the
    grid drops to two columns (`#mainwin.missions-open` / `.bay-open`).
  - `:1006-1012` — the board is no longer "central": describe it as the **right-column mission list**, cards
    restacked (title + badge / reward sub-line / action buttons), scrolling; the center work zone holds only
    the mission body.
  - `:1024-1026` — the Loadout paragraph: `#mainwin.bay-open` no longer "hides the ship preview"; it swaps
    the column from the mission list to `#ship-stats` + `#loadout-panel`, and `#ship-stats` is **Loadout-only**.
  - `:1046-1050` (staged reveal) — only **Take off** is hidden while typing; the granted-item showcase fades
    in at typing-done, Take-off +0.5 s; the mission list stays visible.
  - `:1063-1071` — rewrite the "**Model preview**" bullet: the right-column ship preview is **gone**; the
    reusable viewer helpers (`buildModelViewer`/`startViewer`/`stopViewer`/`resizeViewer`/`setViewerModel`)
    now serve the **work-zone item showcase** (`mwItem`) and the **Loadout** viewers (centered ship +
    `#shop-model`) only.
  - `:1084` (inside the **Work-zone item showcase** bullet) — "The ship preview is the column to the right."
    → the column to the right now holds the **mission list** (delete the ship-preview clause).
  - `:610` and `:1287` (ship-stats bullets) — add that the strip is shown **only on the Loadout screen**.
  - `:138` (desktop-polish recap) — "×2 ship-stats on one line" is now a Loadout-only strip.
  - `:2249-2252` (client module map) — `mainwindow.js` no longer owns a ship-preview viewer.
  - `:2354` (visual-suite scenario list) — mission-board scenario now also asserts the right-column layout.
- **`docs/CHANGELOG.md`** — one bullet under `## 2026-08-09` (create nothing; the heading exists), e.g.:
  > **Missions: the mission list moved to the right column; the ship preview is gone.** The Main Window's
  > 25% right column no longer shows a spinning ship + characteristics strip — on **Missions** it holds the
  > **mission list** (campaign + side-mission cards, restacked: title + badge, reward/XP, Take/Defer/Set
  > active), and the center work zone holds **only** the briefing body (title, text + granted-item showcase,
  > reward, Take off). **Character / Map / Craft** now collapse to a two-column grid; **Loadout** is
  > unchanged (centered ship + 30% context panel) and is the only screen showing `#ship-stats`. The
  > `mwPreview` viewer, the `#mw-ship` canvas, the `previewTarget` debug hook and the staged reveal's
  > `.briefing-hide-ship` beat are deleted — the mission list now stays visible while a briefing types out.
  > DECISIONS §96. docs/plans/2026-08-09-1534-missions-list-right-column.md
- **`docs/DECISIONS.md`** — add **§96** (the current highest is §95) after §95, titled e.g.
  *"The Main Window right column is per-view content, not a permanent ship preview"*. Cover: (i) why the ship
  preview was dropped (it was decoration competing with the briefing for the widest screen real estate; the
  ship is already inspectable — full size and interactive — in Loadout, which is also where its stats
  belong); (ii) why the mission list moved there instead of a taller center stack (the board ate up to 42%
  of the center height above the briefing; side by side, list and briefing are both fully visible and the
  list scrolls independently); (iii) why Character/Map/Craft collapse rather than keeping an empty column;
  (iv) why the staged reveal lost its "ship window fades in" beat (on L1-L3 the list holds exactly one card,
  so hiding the column for 5 s only made the list look broken — the reveal keeps typewriter → showcase →
  Take-off).
  Also append a short **"Amendment (§96, 2026-08-09)"** note to **§92** (`docs/DECISIONS.md:3278-3301`) — use
  the same one-line amendment style already used on §91 (`docs/DECISIONS.md:3274`) and §39 (`:45`): the
  "Missions / Character / Map / Craft → only the right-column ship preview" bullet is obsolete — those views
  now run **no** viewer at all (`selectMenu` only stops the Loadout viewers), and the item showcase is the
  sole Missions-view viewer. The one-loop-at-a-time rule itself stands.

  **§27 and §28 stay as written — do not rewrite them.** They are history: §27
  (`docs/DECISIONS.md:932`, body `:950`) records *why the preview got its own `WebGLRenderer` in 2026-06*, and
  §28 (`:979`) records *why it was generalized into a ship-or-item viewer* — both were true decisions at the
  time and the viewer machinery they justify (`model-viewer.js`) is still in use by the item showcase and the
  Loadout viewers. At most, add **one line** under §27's heading in the same amendment style:
  `**Amendment (§96, 2026-08-09).** The dedicated right-column ship preview described here was removed; the
  right column is now per-view content (mission list / Loadout panel). The viewer machinery it introduced
  lives on in the work-zone item showcase and the Loadout viewers.` Nothing else in §27/§28 changes.
- Historical briefs (`docs/plans/main-window-redesign.md`, `briefing-item-showcase.md`,
  `2026-07-05-1641-briefing-staged-reveal.md`, `client-code-structure.md`, `component-weapon-models.md`) are
  **not** edited — they record what was built at the time.

## Tests

- **Client unit:** `cd client && npm test` (`node --test`). No unit test touches the Main Window DOM
  (`grep -L` over `client/src/*.test.js` confirms none reference `mainwindow`/`mw-ship`/`mission-board`), so
  this is a no-regression run, not a new-coverage surface. Do **not** invent a jsdom harness for this
  (DECISIONS §30) — the layout is genuinely a browser concern and the visual suite is its guard.
- **Server:** unchanged, but run `cd server && npm test` once (it drops+recreates `spacegame_test`) to prove
  nothing in the client change leaked into the API contract.
- **Visual (the real guard):** from `client/`, `npx playwright install chromium` if needed, then
  `npm run test:visual` for the full suite, plus targeted reruns:
  `node visual/run.mjs 10-mission-board`, `07-mobile-hangar`, `05-hangar-shop`, `18-briefing-staged-reveal`,
  `97-briefing-showcase`, `12-sell-confirm`, `96-item-models-engine-thruster` (the last two exercise
  `#loadout-panel`, i.e. that Loadout still works end to end). The suite needs the gitignored S3 assets:
  run `npm run assets:pull` from the repo root first.
  **Flaky baseline:** ~6 scenarios fail at baseline on this machine. Judge by (a) the reliably-passing set
  before vs after your change, and (b) **zero page errors** — the runner fails on any uncaught page error, so
  a missing element / dead import would surface there. Record the before/after pass list in the PR notes.
- **Stage-9 live check** (manual, after deploy): reset progress → play the Level-0 intro to its end → confirm
  the Level-1 landing shows the mission list in the right column with the campaign card, the briefing types
  out with the list visible, Take off appears ~0.5 s after typing, and Take off launches. Then: open
  Character (two columns, no empty gutter), Map, Craft, then Loadout (centered ship + stats strip + context
  panel + Shop) and back to Missions. Repeat once at a phone-landscape size.
- **Stage-9 overlap check at phone landscape (eyeball, no code change planned):** `#mw-topright` (credits +
  the muted "Ships" label) is `position: fixed; top: 14px` and **stacks into two ~15px rows below 780px**
  (`client/styles.css:588-590`) → its bottom lands around **54px**, against `#mainwin`'s **52px** top padding.
  It already grazed `#ship-stats` at the top of this column; the first mission card's **Active badge** now
  sits there instead. Look at a phone-landscape viewport and confirm the badge/title is not tucked under the
  credits line. If it does overlap, the fix is a small `padding-top` on `#mainwin.missions-open #mw-ship-col`
  at `@media (max-width: 780px)` — report it at the review gate rather than expanding scope silently.

## Out of scope / non-goals (DECISIONS §30)

- **No rename** of `#mw-ship-col`, `#mw-mission-board` or any other id/class (decision 8).
- **No change** to the Loadout screen, the shop, `shop.js` rendering, or the ship-stats content/format.
- **No change** to mission-card *content*, the take/defer/activate API, mission generation, or Take-off
  semantics — only the card's CSS box layout changes.
- **No new i18n strings**, no column header, no collapse/expand affordance, no drag-to-resize, no filters or
  sorting on the list.
- **No responsive rework** beyond keeping the existing `body.dev-phone` shrink working (device-profiles
  iteration scope stands).
- **Do not** replace the removed ship preview with something else (no ship card, no stats panel, no art) on
  Missions/Character/Map/Craft — the column is simply absent there.
- **No new 3D viewer.** After this change the Missions view runs at most the item-showcase loop.

## Implementer checklist (final gate)

1. `grep -rn "previewTarget\|mwPreview\|briefing-hide-ship\|ShipPreview\|loadPreviewModel\|previewShip\|applyPreviewTarget\|setPreviewModel" client server` → **no hits** outside `docs/plans/*` (historical).
2. `grep -rn "mw-ship\b\|#mw-ship[^-]" client` → only `#mw-ships` (top-bar label) remains; the `#mw-ship`
   canvas and its CSS are gone.
3. **Concept-word sweep** (the hyphenated spelling is the one that hides):
   ```bash
   grep -rni "ship preview\|ship-preview\|ship model preview\|ship-model preview\|3-column grid\|three tracks" \
     client docs/SUMMARY.md docs/DECISIONS.md
   ```
   Expected survivors and nothing else: (a) mentions that describe **Loadout's centered ship**; (b) the
   historical `docs/DECISIONS.md` §27/§28 bodies + §92's amendment (history — see step 6 of this plan; do not
   rewrite them). Any hit in `client/src/*.js`, `client/styles.css`, `client/index.html` or `docs/SUMMARY.md`
   that still describes a right-column ship preview or a fixed 3-column grid is a **miss** — the known ones
   this plan already fixes are `client/src/mainwindow.js:2` (step 3a0), `client/styles.css:92-96` (step 2a2),
   `client/styles.css:205-207` (step 2c), `client/styles.css:511-512` (step 2d),
   `client/index.html:48-49` (step 1b), `client/src/main.js:774-777` (step 4) and the SUMMARY lines in step 6.
4. `#ship-stats` renders only under `#mainwin.bay-open`; `#mw-mission-board` only under
   `#mainwin.missions-open`; `#mw-ship-col` is `display:none` on Character/Map/Craft.
5. No `visibility`-equality assertion on `#mw-ship-col` survives anywhere in `client/visual/scenarios/`
   (`grep -rn "mw-ship-col" client/visual` → only the `display`/rect/card-count probes this plan specifies).
6. SUMMARY `**Updated:**` bumped, CHANGELOG bullet under `## 2026-08-09`, DECISIONS §96 added, §92 amended,
   §27 given at most the one-line amendment (§28 untouched).
