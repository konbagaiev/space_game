# Main Window redesign (drop "Hangar", landscape main menu)

> **Build brief — self-contained.** Implements a full redesign of the between-battles / landing
> screen, currently called the **Hangar**. The product term becomes **Main Window** (we stop using
> "Hangar" in UI text, docs, and — see §1 — code identifiers). Designed against **mobile landscape**
> (the forced-landscape layout is already in place), but it is a **single unified layout** for mobile
> and desktop; desktop-only extras come later.
>
> Planning-only doc. When implementing, follow the project docs workflow (update SUMMARY / CHANGELOG /
> DECISIONS as part of the change). **Ask the maintainer about `CREDITS.md` only if a new model/sound
> asset is added** — this plan reuses the existing `player_hangar` model, so no new asset is expected.

---

## 1. Goal & terminology

Replace today's centered, vertically-scrolling Hangar column with a **fixed landscape layout**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [⚙]  [Guest / Nick + Login/Signup]      VEGA SENTINELS            Ships(✗) │  ← top bar
├───────────────┬──────────────────────────────────────────┬────────────────┤
│ ▸ Missions ◀  │                                          │                │
│   Loadout     │            WORK ZONE                      │   SHIP MODEL   │
│   Stash       │   (mission description + Take off,        │   (3D, ~25%    │
│   Shop        │    or Loadout / Stash / Shop content;     │    of width)   │
│   (left menu) │    only this area scrolls)                │                │
└───────────────┴──────────────────────────────────────────┴────────────────┘
```

**Terminology rename — "Hangar" → "Main Window".** Drop the word everywhere we author text:
- **UI:** remove the on-screen "Hangar" title entirely (replaced by the centered **Vega Sentinels**
  wordmark, enlarged). i18n: stop using `ui.hangar.title`; the briefing-default key `ui.hangar.default`
  stays (it's a mission-standby line, not the word "Hangar").
- **Docs:** rename "Hangar" → "Main Window" across SUMMARY/CHANGELOG/DECISIONS wording on this change.
- **Code identifiers (decided — do it):** rename the public hangar identifiers to a neutral `main`
  prefix as part of this rework (the DOM is being rebuilt anyway, so the churn rides along, and the
  English-only/clarity rules favor it). Concretely:
  - DOM ids: `#hangar` → `#mainwin`, `#hangar-bay` → `#mw-bay`, `#hangar-go` → `#mw-go`,
    `#hangar-go-note` → `#mw-go-note`, `#hangar-title` → **removed**, `#hangar-text` → `#mw-mission-desc`
    (moves into the work zone, see §5).
  - JS: `hangarEl` → `mainEl`, `showHangar` → `showMain`, `launchFromHangar` → `launchCampaign`,
    `openHangarShop` → `openBay` (or keep `openHangarShop` if churn is a concern — internal only).
  - Keep i18n keys `ui.shop.*` and `ui.hangar.default` as-is (renaming string **keys** ripples through
    `source.json` + every `<lang>.json` for no user benefit; only the displayed strings matter).
  - Grep guard after the rename: `grep -rn "hangar" client/ docs/` should return only `ui.hangar.default`
    and historical CHANGELOG entries.

If the maintainer prefers to minimize diff, the **fallback** is to keep code ids as `#hangar*` and only
change UI text + docs; the layout work below is identical either way. This plan assumes the rename.

---

## 2. Open questions — decided inline

1. **Ship-model preview rendering (right 25%).** Today `#hangar` is an opaque full-screen overlay
   (radial gradient at `client/index.html:53-59`) covering the 3D battlefield scene, so there is **no
   existing ship preview** in the menu.
   **Decision: a dedicated lightweight preview.** Add a `<canvas id="mw-ship">` in the right column with
   its **own small Three.js scene + `PerspectiveCamera` + one directional light + the existing
   `RoomEnvironment` PMREM** (reuse `scene.environment`'s source, see Visuals/env-map in SUMMARY), load
   the player's **`activeShip.model_url_high`** (the `player_hangar` high-poly glb; fall back to
   `model_url`), and slowly auto-rotate it. Gate its rAF loop to **only run while the Main Window is
   visible** (start in `showMain`, stop in `launchCampaign`/`launchMission`) so it costs nothing during
   a fight. Rationale: one extra small GL viewport is far simpler and safer than punching a transparent
   hole in the menu to reveal the battlefield scene, and the hangar glb already exists (no new asset →
   no CREDITS change). **Perf note:** a second `WebGLRenderer` adds a GL context; if profiling on a weak
   phone shows cost, the optimization is a **second scissored viewport pass on the existing `renderer`**
   (same context) rather than a new renderer — but ship the simple version first.

2. **What "Missions" lists (primary vs secondary).** The spec says the Missions item expands to "primary
   missions first, then secondary." Map this onto existing content:
   - **Primary = the campaign mission** (today's briefing in `#hangar-text` + the `#hangar-go` take-off →
     `launchFromHangar`/`launchCampaign`). Exactly one, always present.
   - **Secondary = the 3 side missions** (`missionOffers`, today the top-right `#mission-btns` board →
     `launchMission`). Present only once `shopUnlocked` (unchanged gate).
   So the left **Missions** group renders one primary row + (when unlocked) the secondary rows. The
   old top-right `#mission-btns` board and the `#mission-panel` modal are **removed** — selection now
   happens in the left menu and the description renders in the work zone (§5).

3. **Platforms.** Single unified layout (confirmed with maintainer). Tune against mobile landscape
   first; the same grid serves desktop (which simply has more room). No separate desktop DOM/CSS branch.

4. **"Ships" top-right.** A **disabled/inactive** label for now (future ship-buying). Non-interactive,
   visually muted. New element `#mw-ships` with `aria-disabled="true"`.

5. **Guest vs nickname in the auth block.** Show the **nickname** if the player has one even without a
   full account; only fall back to "Guest" when there's truly no name. See §4.

---

## 3. Top bar

Four anchored regions across the top. Reuse the existing fixed elements where possible; they already
sit above the menu (`z-index` 13) and follow the `body.rot` rotation for free.

- **Settings gear** — keep `#settings-btn` as-is (`client/index.html:329-335`, top-left rounded square).
  No change.
- **Auth block** — keep `#account-bar` (`:249-255`, rendered by `renderAccountBar` at `:3663`). Align
  its **top** with the gear's top: today the gear is `top:11px` and the bar is `top:18px` — set the bar
  to `top:11px` (and keep `left:56px` to clear the gear). See §4 for the Guest/Nick content change.
- **Wordmark** — keep `#gametitle` ("Vega Sentinels", `:292-298`, `ui.title`) but **enlarge it** for the
  menu: it's currently 16px/letter-spacing 4px tuned as a tiny in-game brand. Add a `body.menu`
  override making it the visual centerpiece (e.g. `body.menu #gametitle { font-size: clamp(22px, 4.5vw,
  40px); top: 8px; }`). It stays centered (`left:50%`). **Remove the `#hangar-title` "Hangar" `<h1>`**
  (`:536`) — the wordmark replaces it.
- **Ships (inactive)** — new top-right element:
  ```html
  <div id="mw-ships" data-i18n="ui.mainwin.ships" aria-disabled="true">Ships</div>
  ```
  Styled muted + non-interactive (`pointer-events:none; opacity:.4`), shown only on `body.menu`. New
  i18n key `ui.mainwin.ships` = "Ships". It occupies the slot where `#mission-btns` used to be
  (top-right); since the side-mission board moves into the left menu (§5), that corner is free.

---

## 4. Auth block — Guest → nickname (`renderAccountBar`, `client/index.html:3663-3681`)

A guest who entered a name has it stored (`saveUsername` → `accountPlayer.username`, set via the
post-level-1 prompt at `:3748-3749`). Today `renderAccountBar` only shows the username when
`accountPlayer.email` exists (`:3668-3669`); a named guest still shows "Playing as a guest".

Change the branch so the **display name** is `accountPlayer?.username || (email account ? email) || t('ui.account.anon')`:
- If `accountPlayer.username` is set → show that name (works for named guests **and** accounts).
- Else if `accountPlayer.email` → show the email.
- Else → show `t('ui.account.anon')` ("Playing as a guest" / "Guest").

Keep the **Login/Signup** button (`ui.account.sign_in` → `openAccount('login')`) visible whenever there
is **no real account** (`!accountPlayer?.email`), even for a named guest — so a named guest can still
upgrade. The verify-nudge / log-out controls stay gated to `accountPlayer.email` as today.

(No server change; `saveUsername` already persists the guest name and `/me` returns it as
`accountPlayer.username`.)

---

## 5. Left menu + work zone (the core rework)

### DOM — restructure `#hangar` → `#mainwin` (`client/index.html:535-557`)

Replace the centered column with a top-bar-aware grid holding a **left menu**, a **work zone**, and a
**ship-model column**. Suggested structure (ids per §1 rename):

```html
<div id="mainwin">
  <!-- left menu -->
  <nav id="mw-menu">
    <div class="mw-group" id="mw-missions-group">
      <button class="mw-collapse" id="mw-missions-toggle" aria-expanded="true">▾</button>
      <button class="mw-item active" data-mw="missions" data-i18n="ui.mainwin.missions">Missions</button>
      <div class="mw-sublist" id="mw-mission-list"><!-- primary + secondary rows, built in JS --></div>
    </div>
    <button class="mw-item" data-mw="loadout" data-i18n="ui.shop.loadout">Loadout</button>
    <button class="mw-item" data-mw="stash"   data-i18n="ui.shop.stash">Stash</button>
    <button class="mw-item" data-mw="shop"    data-i18n="ui.shop.shop">Shop</button>
  </nav>

  <!-- work zone (center) -->
  <section id="mw-work">
    <!-- mission view -->
    <div class="mw-view" id="mw-view-mission">
      <h2 id="mw-mission-title"></h2>
      <div id="mw-mission-desc"></div>          <!-- scrollable description (the old #hangar-text) -->
      <div id="mw-mission-reward"></div>
      <button id="mw-go" data-i18n="ui.button.take_off">Take off 🚀</button>
      <div id="mw-go-note"></div>
    </div>
    <!-- shop bay views (moved out of #hangar-bay; same inner markup/ids) -->
    <div class="mw-view" id="mw-view-bay">
      <div class="bay-credits">…</div>
      <div id="ship-stats"></div>
      <div class="bay-view" id="view-loadout"><div id="loadout-list"></div></div>
      <div class="bay-view" id="view-stash"><div id="stash-list"></div></div>
      <div class="bay-view" id="view-shop">
        <div class="shop-pane">
          <div class="shop-types" id="shop-types"></div>
          <div class="shop-items" id="shop-list"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- ship model (right ~25%) -->
  <aside id="mw-ship-col"><canvas id="mw-ship"></canvas></aside>
</div>
```

Notes:
- Keep the **inner shop ids** (`#ship-stats`, `#bay-nav`'s buttons, `#view-loadout/stash/shop`,
  `#shop-types`, `#shop-list`, `#loadout-list`, `#stash-list`, `bay-credits-val`) **unchanged** so the
  existing renderers (`renderBay`/`renderLoadout`/`renderStash`/`renderShop`/`renderNav`/
  `renderShipStatsBar`, `:3039-3246`) keep working with no edits. The old `.bay-nav` (the
  Loadout/Stash/Shop tab strip inside the bay) is now **redundant** — its job moves to the left menu
  (§ JS below). Either delete `#bay-nav` from the DOM and drive `bayView` from the left menu, or keep it
  hidden; deleting is cleaner.
- `#mw-mission-desc` is the relocated `#hangar-text`. It must **scroll independently** — see CSS.

### CSS — replace the centered-column styles

In the `<style>` block, replace `#welcome, #hangar { … }` (`:53-59`) handling so that `#mainwin` is a
**CSS grid** instead of a centered flex column. (Leave `#welcome` on the old centered layout — only the
main window is being redesigned.)

```css
#mainwin {
  position: fixed; inset: 0; z-index: 12; display: none;
  grid-template-columns: minmax(180px, 18%) 1fr 25%;
  grid-template-rows: 1fr;
  padding: 56px 16px 16px;            /* top padding clears the top bar */
  gap: 14px; box-sizing: border-box;
  background: radial-gradient(120% 90% at 50% 20%, rgba(20,32,60,.72), rgba(5,6,13,.92));
  color: #e8f1ff; font-family: system-ui, sans-serif;
}
#mainwin.on { display: grid; }        /* toggle via class, not style.display='flex' */

#mw-menu { display: flex; flex-direction: column; gap: 8px; align-items: stretch; overflow-y: auto; }
.mw-item { /* left-menu buttons; .active = current */ text-align: left; pointer-events: auto; }
.mw-item.active { background: #4a7dff; border-color: #4a7dff; color: #fff; }
.mw-collapse { /* the ▾/▸ expand toggle, left of Missions */ }
.mw-sublist { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 4px 14px; }
#mw-missions-group[data-collapsed="1"] .mw-sublist { display: none; }

#mw-work { overflow: hidden; display: flex; }     /* the views fill it; only the active one shows */
.mw-view { display: none; flex: 1; min-height: 0; }
.mw-view.active { display: flex; flex-direction: column; }
/* ONLY the description scrolls (spec): */
#mw-mission-desc { overflow-y: auto; flex: 1; min-height: 0; }
#mw-view-bay { overflow-y: auto; }                /* shop bay scrolls as a whole, as today */

#mw-ship-col { position: relative; }
#mw-ship { width: 100%; height: 100%; display: block; }
```

Remove/repurpose the now-dead rules: the `body.rot #hangar { justify-content: flex-start }` (`:108`) and
`@media (max-height:600px) #hangar` centering (`:62`) no longer apply to a grid — drop the `#hangar`
parts (keep the `#welcome` parts). The shop-bay zoom/width hacks (`#hangar-bay`, `:127`) are replaced by
the grid; the `.bay-view max-height:46vh` (`:148`) can stay or be relaxed since the work zone now bounds
height. The `@media (max-width:760px)` shop tweaks (`:158-162`) stay (they target `.shop-pane`).

**Mobile-landscape sanity:** because the layout is now a fixed full-height grid (no vertical centering),
the Take-off button lives inside the work zone and is always reachable without the page-scroll hack the
old menu needed. Test at 1280×800 and a small phone-landscape viewport (~740×360).

### JS — selection + work-zone switching

A single state var drives which work-zone view is active, replacing `bayView`-as-screen and the mission
modal. Suggested: `let mwView = 'missions'` and `let mwMission = null` (the selected mission descriptor,
or `null` = campaign primary).

- **`showMain(briefing)`** (was `showHangar`, `:2885-2897`): set `mainEl` visible via `.on`, add
  `body.menu`, `refreshMusic()`, `renderAccountBar()`, `openBay()` (was `openHangarShop`), build the
  **mission list** (below), default-select the **Missions** menu item and the **primary** mission,
  render its description into `#mw-mission-desc`, and **start the ship preview** (`startShipPreview()`).
- **Left-menu click handler** on `#mw-menu` (delegated): `data-mw` ∈ `missions|loadout|stash|shop`.
  - `missions` → show `#mw-view-mission`, keep last-selected mission (default primary).
  - `loadout|stash|shop` → show `#mw-view-bay`, set `bayView = data-mw`, call `renderNav()` +
    `renderBay()` (the existing renderers already key off `bayView`). The Loadout/Stash/Shop items are
    **gated to `shopUnlocked`** exactly like the old `#hangar-bay` visibility (`openHangarShop`,
    `:3246`): when locked, hide or disable those three menu items.
  - Toggle `.active` on the clicked `.mw-item`.
- **Collapse toggle** (`#mw-missions-toggle`): flip `#mw-missions-group[data-collapsed]` and the
  `aria-expanded`/caret glyph (`▾`↔`▸`). Spec: collapsed hides the sublist; the Loadout/Stash/Shop
  buttons sit directly under the (collapsed) Missions item — which they already do in source order, so
  collapsing just hides `.mw-sublist`.
- **Build the mission list** (`buildMissionList()`, replaces `refreshMissions` `:2929-2945` +
  `openMissionPanel` `:2946-2954`):
  - **Primary row** — always: label from the campaign briefing (e.g. `t('ui.mainwin.primary')` or the
    level name); selecting it sets `mwMission = null` and renders the campaign briefing text
    (`pendingBriefing`/`ui.hangar.default`) into `#mw-mission-desc`, with `#mw-go` → `launchCampaign`.
  - **Secondary rows** — when `shopUnlocked`: one per `missionOffers[i]` (still fetched from
    `/api/players/:id/missions`, `:2933`). Selecting one sets `mwMission = m.descriptor`, renders
    `t(m.descKey)` + `t('ui.mission.est_reward', {credits: m.estReward})` into the work zone, and points
    `#mw-go` at `launchMission(m)`.
  - A small visual divider/label between primary and secondary ("Operations" / "Side missions") is
    optional polish.
- **`#mw-go` handler**: dispatch on `mwMission` — `null` → `launchCampaign()` (was `launchFromHangar`,
  `:2898`), else → `launchMission` for the selected offer. Both already `requestFullscreen()` on touch,
  hide the menu, `reset()`. Update them to hide `#mainwin` via `.classList.remove('on')` and to
  **`stopShipPreview()`**.
- **Delete** the `#mission-btns` / `#mission-panel` wiring (`:2956-2962`, the `mp-close`/`mp-launch`
  listeners) and the `missions-on` body-class usage — the board is gone.

### Ship preview (new, per §2.1)

Add `startShipPreview()` / `stopShipPreview()` near the other render setup:
- Lazily create a `WebGLRenderer({canvas:#mw-ship, antialias, alpha:true})`, a `Scene`, a
  `PerspectiveCamera`, a `DirectionalLight` + low ambient, and set `scene.environment` to the shared
  RoomEnvironment PMREM (built once at startup — reuse it).
- Load `activeShip.model_url_high || activeShip.model_url` with the already-wired `GLTFLoader`
  (+ meshopt decoder for same-origin combat glbs; the hangar glb is on CloudFront). Center/normalize
  like `applyShipModel` does. Apply the ship's `model.yaw`.
- rAF loop: rotate the model `~0.4 rad/s`, render. **Only runs while the Main Window is shown** — start
  in `showMain`, cancel in `launchCampaign`/`launchMission`. Resize with the canvas (observe the column
  size or hook the existing `resize`/`orientationchange`).
- Reload the model when the active ship changes (after buy/equip in the shop — call from `renderBay`'s
  post-action refresh, or just rebuild on each `showMain`).

---

## 6. i18n — new/changed keys (`client/locales/source.json` + `ru.json`)

- **Add** `ui.mainwin.missions` = "Missions" (left-menu item; RU: "Миссии").
- **Add** `ui.mainwin.ships` = "Ships" (inactive top-right label; RU: "Корабли").
- **Add** `ui.mainwin.primary` = "Main operation" (primary mission row label; RU: "Основная операция")
  — or reuse the level name; pick one and keep it consistent.
- *(optional)* `ui.mainwin.side` = "Side missions" (secondary divider; RU: "Побочные миссии").
- **Stop displaying** `ui.hangar.title` ("Hangar"). Leave the key in `source.json`/`ru.json` to avoid a
  churny removal, but it is no longer referenced (remove the `data-i18n` from the deleted `<h1>`).
- **Keep** `ui.hangar.default`, `ui.shop.loadout|stash|shop`, `ui.button.take_off`, `ui.mission.slot`
  (now unused — the board is gone; may delete), `ui.mission.est_reward`, `ui.account.*` as-is.

English is the source of truth; every new key needs an RU value in `ru.json` and a `context` note in
`source.json`. (Project rule: all authored text English; RU is the derived layer.)

---

## 7. Files to touch

- **`client/index.html`** — the bulk: DOM (`:525-560` welcome stays; `:535-557` hangar→mainwin; remove
  `:559-569` mission board/panel; `:587` wordmark enlarge via CSS), CSS (`:53-62, 102-162, 248-298,
  329-335`), JS (`showHangar`/`launchFromHangar` `:2885-2920`, missions `:2922-2973`,
  `renderAccountBar` `:3663-3681`, the new ship-preview block). The shop renderers `:3039-3246` are
  reused unchanged.
- **`client/locales/source.json` + `client/locales/ru.json`** — new keys (§6).
- **`docs/SUMMARY.md`** — rewrite the "Landing screen", "Victory → Hangar", "Hangar shop & stash", and
  "Side missions" sections to the Main Window model (left menu + work zone + ship preview); rename
  "Hangar" → "Main Window"; bump `**Updated:**`.
- **`docs/CHANGELOG.md`** — bullet under today's date: "**Main Window redesign** — dropped the 'Hangar'
  name; new landscape main menu (top bar: settings + auth + Vega Sentinels wordmark + inactive Ships;
  left menu Missions/Loadout/Stash/Shop; center work zone; 25% live ship-model preview)."
- **`docs/DECISIONS.md`** — new entry: why a dedicated preview canvas over revealing the battlefield
  scene (§2.1), and why "Missions" unifies the campaign briefing (primary) with side missions
  (secondary) into one left-menu list (§2.2).
- **`docs/plans/`** — this file. Cross-reference from `mission-generator.md` and `hangar-shop.md` that
  their UIs were re-homed into the Main Window.
- **`CREDITS.md`** — **no change expected** (reuses the existing `player_hangar` model). If
  implementation pulls in a *new* model/sound, STOP and ask the maintainer first (project rule).

---

## 8. Verification

- **Visual (headless):** screencapture is blocked on this machine — render `client/index.html` via the
  Playwright harness (see memory: *Headless visual verify*) at desktop (1280×800) **and** a
  phone-landscape viewport (~740×360, and a portrait phone to confirm `body.rot` rotation) to check:
  top bar (gear + auth top-aligned, centered enlarged wordmark, muted Ships), left menu with Missions
  active + collapse working, work zone showing the campaign description with a scrolling-only
  description, Loadout/Stash/Shop switching into the work zone, and the ship model rotating in the right
  25%.
- **Flows:** named-guest shows the nickname (not "Guest"); a true anon shows "Guest" + Login/Signup;
  primary "Take off" launches the campaign; (post-campaign) a secondary mission launches that mission;
  buying/equipping in the shop updates the ship-stats bar and the preview model.
- **Regression:** existing shop renderers untouched and still functional; `?debug` visual suite passes;
  no `hangar`-cased identifiers remain except `ui.hangar.default` and CHANGELOG history (grep guard, §1).
- **Existing tests:** `npm test` (server) is unaffected (this is client-only); run it to confirm green.

---

## 9. Out of scope (later)

- The **Ships** screen (buying/switching ships) — only the inactive label ships now.
- Desktop-specific extras (the maintainer noted desktop will get its own features later).
- Collidable set-pieces, and the scissored-viewport preview optimization (only if profiling demands it).
