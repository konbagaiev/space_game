# Base menu redesign

**Status:** in progress (staged). **Owner:** maintainer + Claude, local iterative work (no pipeline).
**Started:** 2026-08-08.

The between-missions "base" screen (the **Main Window**, `client/index.html:50` `#mainwin`, controller
`client/src/mainwindow.js`, shop/loadout `client/src/shop.js`) is being reworked from its current
three-column shop-centric layout into a proper base hub with five sections. This is a large change with
many iterations expected; it is deliberately **staged** so every step stays playable and testable.

Read `docs/SUMMARY.md` ("Main Window" / "hangar shop") first for the current state, and the map below for
the exact seams. This file is the executable spec — keep it current as slices land.

---

## Target left menu (5 items)

```
Character   → the player/pilot & ship-progression screen         (DEFERRED — spec below)
Missions    → main (campaign) + side missions, take/defer/active  (Slice B)
Loadout     → ship management + hangar/stash + shop               (Slice C)
Map         → the sector/world map                                (DEFERRED — spec below)
Craft (tbd) → crafting                                            (DEFERRED — placeholder only)
```

Replaces today's menu: a "Missions" group (with a collapsible sublist) plus three separately-gated
shop items **Loadout / Stash / Shop** (`client/index.html:51-62`). Stash + Shop collapse **into**
Loadout (Slice C). Character / Map / Craft are new.

---

## Decisions (from the 2026-08-08 discovery Q&A — do not re-ask)

1. **Main missions = one current campaign mission + a list of side missions.** The campaign stays a
   linear counter (`players.current_progress`); the "Main" entry is the next campaign level (as today),
   not a full level-select list. Side missions are the repeatable board.
2. **Take / defer / multiple-taken / one-active is a server-persisted model** (new table + endpoints),
   not client-only. Side missions have stable ids (`side-mining` / `side-research` / `side-freighter`,
   `server/src/missions.js:63`) so they persist cleanly by id.
3. **Side missions unlock after clearing "Level 3"** (reaching the "Level 4" briefing, descriptor
   `level-5`, `current_progress >= 5`) — moved later than the recent DECISIONS §90 change (which opened
   them right after the first flight). **Shipped in Slice 0** (see below).
4. **Shop stays early** — it still unlocks right after the first mission (DECISIONS §90). The shop and
   the side-mission board are **decoupled**: shop keyed off `players.shop_unlocked`, side missions off
   `current_progress >= 5`. **Shipped in Slice 0.**
5. **Delivery is direct + local, short iterations** (no `/feature-pipeline`) — visual/feel-heavy UI
   needs a playable build in the maintainer's hands early (memory: visual-features-need-early-playable-build).

---

## Current-code map (seams the slices touch)

- **Main Window markup** — `client/index.html:50-96` (`#mainwin` = `#mw-menu` | `#mw-work` | `#mw-ship-col`);
  top-right credits/Ships `#mw-topright` `:119-122`.
- **Main Window controller** — `client/src/mainwindow.js`: `showMain()` `:37`, `selectMenu()` `:102`
  (the view state machine), `buildMissionList()` `:127`, `renderMissionView()` `:202`, `launchCampaign()`
  `:64`, `launchMission()` `:254`, `refreshMissions()` `:243`. Reusable 3D viewers: `buildModelViewer()`
  `:276`, `setViewerModel()` `:332` (loads any glb — ship OR item), `mwPreview` (`#mw-ship`) + `mwItem`
  (`#mw-item`).
- **Loadout / stash / shop** — `client/src/shop.js`: `renderLoadout()` `:158`, `renderStash()` `:183`,
  `renderShop()` `:210`, `showBayView()` `:226`, `openBay()` `:296`, item-stat lines `statLine()` `:31`,
  live ship-stats bar `renderShipStatsBar()` `:76`. Actions POST to `/buy /sell /equip /unequip` and
  re-render from the response (`applyShopState()` `:258`).
- **Catalog** — `server/src/catalog_seed.js`: `COMPONENTS` `:21` (typed hull/engine/thruster/repair/grab/
  shield), `WEAPONS` `:96` (bullet/rocket), `SHIPS`, `LEVELS`. Item model URLs on catalog entries
  (`modelUrlHigh`) → reusable in previews.
- **Side missions** — `server/src/missions.js` `generateMissions()` `:59` (3 fixed flavors, stable ids).
  Endpoint `server/src/server.js` `GET /api/players/:id/missions`.
- **Player/ship data** — `server/src/db.js`: `players` (`current_progress`, `credits`, `shop_unlocked`),
  `player_ships` (`loadout` JSONB `{mounts}`, `components` JSONB), `stash` (`kind,ref_id,qty`).
  `getActivePlayerShip()` `:936` returns the active-ship payload the client hydrates from.

---

## Slices

### Slice 0 — Side-mission unlock → after Level 3, decoupled from shop  ✅ (2026-08-08)

- `server/src/db.js`: export `SIDE_MISSIONS_MIN_PROGRESS = 5`; `getActivePlayerShip()` returns
  `sideMissionsUnlocked: reg.currentProgress >= SIDE_MISSIONS_MIN_PROGRESS`.
- `server/src/server.js`: `GET /api/players/:id/missions` gates on `active.sideMissionsUnlocked`
  (was `active.shopUnlocked`); `shopState()` includes `sideMissionsUnlocked`.
- `client/src/mainwindow.js`: `refreshMissions()` gates on `G.activeShip.sideMissionsUnlocked`.
- Briefing copy (EN `client/locales/source.json` + RU `client/locales/ru.json`): drop the "side jobs"
  line from `level.2.briefing`; add the side-jobs-now-open line to `level.4.briefing`.
- Tests: `server/src/server.test.js` — side missions 403 at `current_progress` 3 (shop unlocked) but
  offered at `>= 5`. DECISIONS §91, CHANGELOG, SUMMARY.

### Slice A — Left-menu shell (5 items) + Character/Map/Craft stubs  ✅ (2026-08-08)

- `client/index.html` `#mw-menu`: five `.mw-item`s — Character, Missions (keeps its collapsible
  sublist group), Loadout, Map, Craft. All five always shown (maintainer's choice); a generic stub
  work-zone view `#mw-view-stub` serves the three deferred sections.
- `client/src/mainwindow.js` `selectMenu()`: routes `character|map|craft` → `renderStub()` (section
  title + "Coming soon" copy from `ui.mainwin.*` + `ui.stub.*`); `missions` and the bay unchanged.
- Loadout absorbs Stash + Shop via an in-bay tab row (Ship / Stash / Shop, `#mw-bay-tabs`,
  `data-act="bay-tab"`) driven through `showBayView()`. **Before the shop unlocks** the Loadout is
  **read-only** — `renderLoadout(active, readOnly)` drops the Unequip/Sell buttons + prices, the
  Stash/Shop tabs hide (`.bay-tabs.locked`), and a hint shows (`#mw-loadout-locked`); `openBay()`
  synthesizes a locked state from `G.activeShip` (no `/stash` fetch). Forward-compatible with Slice C.
- i18n (EN `source.json` + RU `ru.json`): `ui.mainwin.character/map/craft`, `ui.shop.tab.ship`,
  `ui.shop.loadout_locked`, `ui.stub.character/map/craft`. CSS in `styles.css` (5-item nav, `.bay-tab`,
  locked state, stub panel). Visual scenario `05-hangar-shop.mjs` updated to the new tab navigation
  (also fixed a stale `types === 6` → `7` assertion — shield is a shop type). Verified headless: 05
  passes, the locked read-only Loadout + stub views render clean, no page errors at load.

### Slice B — Missions central view (take / defer / active)  ✅ (2026-08-08)

- Server model: `taken_missions (player_id, mission_id, taken_at)` + `players.active_mission_id`
  (NULL = campaign) — created idempotently in `migrate()`. db.js: `getMissionState` / `takeMission` /
  `deferMission` / `activateMission` (activate auto-takes + overwrites → one active at a time; defer
  clears active→campaign). `resetPlayer`/`resetAllPlayers` clear both. Endpoints (gated on
  `sideMissionsUnlocked`, ids validated against `generateMissions()`): `POST /missions/take|defer|activate`
  (activate accepts `missionId:null` = campaign); `GET /missions` also returns `taken` + `activeMissionId`.
- Client (`mainwindow.js`): the left mission **sublist/caret is gone** — Missions is a plain menu item.
  A central **board** (`#mw-mission-board`) of cards (campaign + side) with Take/Defer/Set-active +
  Active/Taken badges sits above the briefing detail; clicking a card shows its briefing (staged reveal
  preserved for the campaign — side missions only exist at L≥4 where it never plays). **Take-off flies
  the ACTIVE mission** (`activeMissionId`), and its title shows on the button (`ui.button.take_off_mission`).
  State: `takenIds` + `activeMissionId` (exported for `__game`). i18n `ui.mission.take/defer/set_active/
  active/taken` (EN + RU). CSS `.mission-card`.
- Guard: server tests for take/activate/defer + the one-active invariant + reset-clears; visual `10-mission-board`
  rewritten for the board (take → set active → Take-off flies it); `97-briefing-showcase` updated to the
  board. Full visual suite: same flaky baseline, zero new failures. Intro-replay unaffected (menu-only).

### Slice C — Loadout redesign (ship-in-center + slots + right panel + shop)  🚧 increment 1 done (2026-08-08)

**Increment 1 (done):** the new Loadout layout + slot/stash/shop interactions.
- The reusable Three.js viewer was extracted from `mainwindow.js` into `client/src/model-viewer.js`
  (`buildModelViewer`/`setViewerModel`/`startViewer`/`stopViewer`/`resizeViewer`/`itemModelCfg`), shared by
  the Main Window previews and the Loadout screen (no import cycle).
- `client/index.html` `#mw-view-bay` rebuilt: `#loadout-stage` = `#loadout-center` (centered `#loadout-ship`
  canvas + `#loadout-slots` chips absolutely-positioned around it, `SLOT_LAYOUT` in shop.js) | `#loadout-panel`
  (right context panel). The former Ship/Stash/Shop tabs are gone. The layout keeps the Main Window's
  normal three-column grid: the ship+slots fill the center work zone and the **panel lives in the right
  column** (`#loadout-panel` inside `#mw-ship-col`, same width ratio as the missions ship preview,
  **borderless**); `#mainwin.bay-open` hides the right-column ship preview (`#mw-ship`) and reveals the
  panel, `#ship-stats` stays above it. The slot chips are large blocks (`SLOT_LAYOUT`).
- `client/src/shop.js` rewritten: `renderSlots` (equipped item per slot, empty/required flagged), `renderPanel`
  (selected-slot detail: equipped info + **Remove**; stash replacements → pick → info + **Install/Replace**;
  a **Shop** button pinned bottom-right), `renderShopPanel` (type list → buyable items with price + **Buy** +
  Owned badge + **Back**). Reuses the authoritative `/buy /sell /equip /unequip`. Read-only until the shop
  unlocks. New i18n (EN+RU): `ui.shop.action.remove/replace`, `ui.shop.select_slot/slot_empty/in_stash/
  no_replacement/back`. Visual `05-hangar-shop` rewritten for the new screen (select slot → install from
  storage → open shop → Back). Verified headless; full suite = same flaky baseline, no new failures.

**Increment 2 (done — item 3D models in the panel, 2026-08-08):** the selected slot's item shows its **3D
model** in the right panel (`itemInfo` embeds `#shop-model`; equipped item, or the picked stash part), and
clicking a shop entry (`data-act="shop-item"`) opens a **detail card** — item **stats at top**, the **3D
model** below, **Buy** below, **Back** (`shop-list`) → the list. One shared per-item viewer (`showItemModel`
on `#shop-model`, rebuilt+disposed per item so contexts don't leak; items without a glb show a "No 3D
preview" placeholder).
The Loadout right column is widened a touch (`#mainwin.bay-open` grid → 30%) so the model reads well. New
i18n `ui.shop.no_model` (EN+RU). **Still TODO:** the type navigation is a tab row, not the spec's
*collapsed sections per type with the clicked one expanded* — a later refinement.

Target UX (from the maintainer's spec):

- Clicking **Loadout** puts **the player's ship in the center** of the work zone, with **weapon +
  equipment slots arranged around it**. Reuse `buildModelViewer()`/`setViewerModel()`
  (`mainwindow.js:276/332`) for the centered ship; slot chips positioned around it.
- Clicking a **slot** activates the **right panel**: top = info on the equipped element; below = the
  available replacement(s) in the stash for that slot; below that = a **Shop** button. A **Shop**
  button is **always** present at the bottom-right of the right panel.
- Clicking a **stash part** → top shows its info + an **Install / Replace** button. Before that (having
  clicked an equipped part from the ship) the button is **Remove** (unequip).
- Clicking **Shop** → the right panel becomes the shop: **collapsed sections per equipment type**, with
  the clicked type **expanded**. Clicking a shop entry → a **Back** button appears at the bottom, item
  **stats at the top**, the **3D model** below them, and a **Buy** button below the model.
- Reuses today's authoritative server actions (`/buy /sell /equip /unequip`, `shop.js`) — this is a UI
  restructure over the same data. Live ship-stats bar (`renderShipStatsBar`) stays.

---

## Deferred section specs (write code later — placeholders/stubs now)

### Character (menu item 1)

**Intent:** the pilot/ship identity + progression home. Candidate contents (to refine with the
maintainer before building): callsign / account summary (reuse `account.js` / `renderAccountBar`),
current ship name + hero framing (narrative canon: rookie Vega Sentinel, `docs/narrative/`), lifetime
stats (games played, kills, credits earned — `getPlayerPublic()` / admin already has these), and any
future pilot progression (levels/perks). **Open questions:** is there a pilot XP/level system, or is
progression purely ship gear? Does Character duplicate the account bar or replace it? Decide at build
time. For now: a stub panel titled "Character" with a short "coming soon" line.

### Map (menu item 4)

**Intent:** a sector/world map of the shared `home-system` world (all set-pieces live there at fixed
positions — see `server/src/missions.js` mission `center`s + `catalog_seed.js` `home-system`). Candidate
contents: a top-down schematic of the home system showing the campaign objective + the side-mission
set-pieces (mining / research / freighter) at their real world coordinates, with the active/taken
missions highlighted; selecting a node could set the active mission (ties into Slice B). **Open
questions:** static schematic vs. a live 3D minimap; does the map drive mission selection or is it
informational? Decide at build time. For now: a stub panel titled "Map" with a "coming soon" line.

### Craft (menu item 5, "tbd")

**Intent:** crafting — combine salvaged/bought materials into gear. Entirely undesigned. **Open
questions:** what are the inputs (a new materials inventory? existing stash items?), the recipes, and
the outputs (catalog items? new craftable-only items?); how does it relate to the shop economy
(DECISIONS §-economy)? Nothing to build yet. For now: a stub panel titled "Craft" marked "(tbd)".

---

## Testing / verification per slice

- Server changes: `npm test` in `server/` (drops/recreates `spacegame_test`).
- Client/UI: run locally via the `run-local` skill (`assets:pull` first) at http://localhost:4000,
  and/or a Playwright render of `client/index.html` (memory: visual-verify-headless). Sim-affecting
  changes (none expected here — this is menu-only): `node visual/run.mjs 22-intro-replay`.
- Docs on every slice: CHANGELOG bullet, SUMMARY edit-in-place, DECISIONS entry when a trade-off is made.
