# Base-menu state leak + the drifted-copy bugs from the duplication audit

**Status:** Phases 1-3 done (`8f9e705`, `2026-10-20-1816-launch-gate`, `2026-10-22-1334-loadout-skill-stats`); 4-5 planned. **Date:** 2026-10-20.
**Source:** a live bug report (below) plus the drifted findings of
[`2026-10-20-duplication-audit.md`](2026-10-20-duplication-audit.md) (ids A1–A6, B1, B2, B5, B6 refer to it).
**Execute** phase by phase; each phase is independently shippable and has its own guard. Offer
`/feature-pipeline` per CLAUDE.md; Phase 1 is the priority.

## Goal

1. **Fix the reported bug at its root:** after "Back to base" the fight keeps running behind the Main
   Window. Make "the base menu is open" mean ONE state, set in ONE place, so no entry path can forget it.
2. Fix the bugs where two hand-kept copies have **already drifted** (audit A1–A6, B1, B2, B5, B6), each by
   collapsing the copies into one source and adding a test that would have caught the drift.

Not a goal: the audit's sync-risk items (C*), the CSS system work (A7, A8, A9, C14, C15), B3 and B4.
They stay in the audit.

---

## Phase 1 — One way into the base menu (the reported bug)

**Done 2026-10-20** — implemented by [`2026-10-20-1659-base-menu-idle.md`](2026-10-20-1659-base-menu-idle.md) (`enterMenu`/`leaveMenu`, guard `53-base-menu-idle`).

### The bug (reproduced 2026-10-20, local, headless Playwright with `?debug`)

Reported from prod: killed inside the zone on the **research-station side mission** → "Back to base" →
on Loadout the HUD shows **"You've left the battlefield — Returning in 23s"** over the menu.

Mechanism, confirmed by an executable repro:

1. The death overlay's "Back to base" is `client/src/mainwindow.js:126`:
   `el.backHangar.addEventListener('click', () => { el.overlay.style.display = 'none'; showMain(null); });`
   It does **not** clear `G.gameStarted` / `G.roam`. The two other ways back to the base do:
   `client/src/main.js:543` (map overlay "Return to hangar") and `client/src/mainwindow.js:583` (dock
   prompt) both run `G.roam = false; G.gameStarted = false; document.body.classList.add('menu')` by hand
   before `showMain(null)`.
2. While the ship is dead, `update()` early-returns (`client/src/sim.js:576`:
   `if (!G.gameStarted || !G.player.alive || levelRunner.won) return;`) so nothing visible happens yet.
3. **Any Loadout action** (equip / unequip / buy / sell) runs `applyShopState` (`client/src/shop.js:478-484`)
   → `buildPlayerFor` → a brand-new, **alive** `G.player`. Now `gameStarted && alive` → the sim ticks
   behind the menu: the side mission's script spawns enemies, and the rebuilt ship sits at the origin while
   `arenaCenter` is the research station `(928,0)`, so `oobTime` climbs, `updateOobWarning`
   (`client/src/sim.js:165-174`) shows the banner, and after `OOB_RETURN_TIME` the ship is warped into the
   fight.
4. Measured: death → Back to base → Loadout → unequip Grab → `stepSim(600)`: `combatElapsed` 2.43 → 12.43,
   `enemyCount` 0 → 1, `gameStarted: true`, `alive: true`. Unequipping the HULL instead made the ship die
   again behind the menu.
5. The victory path has the same leak: Continue → `leaveOverlay` (`mainwindow.js:106-118`) →
   `showMain(brief)` leaves `gameStarted: true, roam: true` (measured). Login (`client/src/account.js:288-290`:
   `buildPlayerFor` + `showMain`) and `finishIntro` (`client/src/main.js:2002-2003`) also call `showMain` /
   `showWelcome` without clearing the flags.

The invariant the code already assumes (bootstrap comment `client/src/main.js:2294`: "update() doesn't run
until take-off"): **while the Main Window or Welcome is up, `G.gameStarted === false` and
`G.roam === false`.** Six entry points, three of them uphold it by hand, three don't. This is audit A6.

### Change

1. **`enterMenu()`** in `client/src/mainwindow.js` (module-private, above `showMain` at `:48`): the single
   "we are at the base, nothing is flying" transition:
   ```js
   // THE one transition into the base menu (Main Window or Welcome). Every way back to the base goes through
   // here, so "a menu is open" can never coexist with a running fight: update() early-returns on
   // !G.gameStarted, so nothing ticks behind the menu even if a Loadout action rebuilds an alive G.player.
   function enterMenu() {
     G.gameStarted = false;
     G.roam = false;
     G.missionZone = null;           // a roam-armed mission zone must not fire from the menu
     cancelAutopilot();              // (import from sim.js) no autopilot survives into the menu
     el.overlay.style.display = 'none';
     el.oobWarn.style.display = 'none'; // the banner is DOM state; don't wait for the next frame to hide it
     document.body.classList.add('menu');
   }
   ```
   Check `cancelAutopilot` / `el.oobWarn` are importable here (`sim.js` exports `cancelAutopilot`, see the
   import list at `client/src/main.js:33`; `el` is `client/src/dom.js`). If `G.returnToBase` /
   `G.roamMission` also leak, clear them here too — compare against what `main.js:540-546` and the dock
   path clear and take the union.
2. **`showMain`** (`mainwindow.js:48`): call `enterMenu()` first; delete its own
   `el.overlay.style.display = 'none'` and `document.body.classList.add('menu')` lines (now in `enterMenu`).
   (Correction: there is no trailing `reset()` in `showMain` — this note described something that doesn't exist; none was added.)
3. **`showWelcome`** (`client/src/welcome.js:56`): it lives in another module; export `enterMenu` from
   `mainwindow.js` and call it at the top of `showWelcome` (replacing its `document.body.classList.add('menu')`).
   Check for an import cycle (`welcome.js` ↔ `mainwindow.js`); if one appears, put `enterMenu` in a small
   new `client/src/menu-state.js` that both import.
4. **Delete the hand copies** now redundant: `main.js:543-544` (`G.roam = false; G.gameStarted = false;
   document.body.classList.add('menu');`) and the same three statements in `mainwindow.js:583`. Leave the
   `showMain(null)` calls.
5. **`showMain` must also hide `#welcome`** (audit A6: a login from Welcome drew the Main Window over a
   still-visible Welcome). Add `document.getElementById('welcome').style.display = 'none';` to `enterMenu`
   only for the Main Window case — simplest: do it in `showMain` right after `enterMenu()`.
6. **`leaveMenu()`** — the mirror, in `mainwindow.js`, for the four copies of the menu-exit steps
   (`launchCampaign` `:91-99`, `launchMission` `:505-518`, `enterRoam` `:524-550`, welcome `takeOff`
   `client/src/welcome.js:168-177`). Shared part:
   ```js
   function leaveMenu() {
     if (Device.hasTouch) requestFullscreen(); // must stay inside the click gesture — callers are click handlers
     mainEl.classList.remove('on');
     document.getElementById('welcome').style.display = 'none';
     stopLoadoutPreview();
     settleBriefingReveal();
     stopViewer(mwItem);
     document.body.classList.remove('menu');
   }
   ```
   Each launcher keeps its own specifics (`G.activeMission`, `G.pendingBriefing`, `G.gameStarted = true`,
   `G.roam`, `beginLiveSession`, `reset(...)`) in its existing order. Export it for `welcome.js`.
   **Welcome's takeOff drift to fix while there:** it never clears `G.activeMission` / `G.pendingBriefing`
   and has no launch gate — give it `if (!canLaunch()) return;` (Phase 2) and the two clears.

**Decision (chosen):** keep the Welcome screen as the fallback for a briefing-less level; only route it
through `enterMenu` / `leaveMenu`. Deleting Welcome is an onboarding-flow call for the maintainer, out of
scope here.

### Guard — new visual scenario `client/visual/scenarios/53-base-menu-idle.mjs`

Pattern: `10-mission-board.mjs` (advance via `POST /api/players/:id/advance`, reload, wait for
`#mainwin.on`). `__game` already exposes `gameStarted`, `roam` (`main.js:1583`), `combatElapsed`,
`enemyCount`, `player`, `stepSim`, `setPaused`, `levelRunner`, `oobWarnVisible`.

1. Advance twice (→ `level-2`: shop unlocked so `#back-hangar` is shown), reload, Take off
   (`#mw-takeoff`), `setPaused(true)`, `stepSim(120)`.
2. Kill: `player.hp = 0; player._shieldValue = 0; stepSim(5)`; assert the overlay is up and `#back-hangar`
   is displayed; click it.
3. Assert `gameStarted === false`, `roam === false`, `oobWarnVisible === false`, body has `menu`.
4. Open Loadout, select the `grab` slot chip (`.slot-chip[data-slot="grab"]`), click `[data-act="unequip"]`,
   wait for the state to apply; assert `player.alive === true` (the rebuild happened).
5. `const t0 = combatElapsed; stepSim(600);` assert `combatElapsed === t0`, `enemyCount === 0`,
   `oobWarnVisible === false`.
6. Second case, victory path: Take off again, `stepSim(60)`, set `levelRunner.won = true`, show the overlay
   and click `#restart` (Continue → `leaveOverlay` win branch); assert `gameStarted === false`,
   `roam === false`.
7. **Negative-test it:** run the scenario on the current code first and record that steps 3 and 5 FAIL
   (they do: the repro above is the same sequence). A guard that never failed proves nothing.

Run only this scenario plus `10-mission-board` and `32-star-system` (both touch the launch/menu flow):
`node visual/run.mjs 53-base-menu-idle 10-mission-board 32-star-system` from `client/`. The full visual
suite and the perf gate are opt-in — ask the maintainer.

---

## Phase 2 — One launch gate (audit A1 + A4)

**Done 2026-10-20** — see `2026-10-20-1816-launch-gate.md` (adds the `#mw-go` handler gate; the guard is
`54-launch-gate`, not an extension of 53).

**Bug A1:** on the Map view, "Autopilot to destination" ignores the launch gate. `renderMapView`
(`client/src/mainwindow.js:165-174`) gates only the Take off action (`disabled: !canTakeOff()`);
`onAutopilot: (obj) => enterRoam(...)` (`:173`) has no check, and `systemmap-ui.js:117` (`canFly`) /
`:263-267` check only selection/lock. With the hull removed (server allows it, `server/src/db.js:1069-1080`;
`launchable: false`, `db.js:1259`, `:1278`) Take off is grey while Autopilot flies a 0-HP ship out.

**Bug A4:** the gate is written in three places (`mainwindow.js:335-338` `canTakeOff`, `shop.js:445`
`updateTakeoffGate`, and `mainwindow.js:328` / `shop.js:454` both set `#mw-mission-nav.disabled`), and
`updateTakeoffGate` writes the same hint into BOTH `#mw-go-note` and `#mw-takeoff-note` (`shop.js:447-452`)
while `updateGoButton` shows `#mw-go-note` whenever a side mission is active (`mainwindow.js:319-320`) → the
red "can't launch" line twice on Missions. The comment at `shop.js:443` claims the Map reads `canTakeOff()`
for its buttons — false for Autopilot.

### Change

1. One pure predicate, exported from `client/src/shop.js` (it already owns the gate rendering):
   `export function canLaunch(active = G.activeShip) { return !active || active.launchable !== false; }`
   `updateTakeoffGate` uses it; `mainwindow.js` imports it and **deletes `canTakeOff`**, replacing every
   call (`:172`, `:328`, `:340`, `:352`).
2. **Every launcher checks it itself**, not only its button's `disabled`: `takeOff` (`:339`), the
   `#mw-mission-nav` handler (`:349-353`), `#mw-go` (find its click handler near `launchMission` callers),
   `renderMapView`'s `onAutopilot` (`:173` → `(obj) => { if (canLaunch()) enterRoam(...); }`), and welcome's
   `takeOff` (Phase 1 step 6). Also pass the gate into the map component so the Autopilot button renders
   disabled: add an `autopilotDisabled` option to `mountSystemNav` (`client/src/systemmap-ui.js`, used in
   `renderActions` `:115-120`), passed `!canLaunch()` from `renderMapView`. The in-flight overlay map
   (`main.js` ~`:530-547`) is out of combat in roam, where the ship already launched — leave it ungated.
3. **One note:** delete the `#mw-go-note` write from `updateTakeoffGate`; the hint lives only in
   `#mw-takeoff-note` under the launch bar, which is visible on every stage except Map (Map shows its own
   note via the action's `note`). Remove `#mw-go-note` from `client/index.html` and its CSS
   (`client/styles.css` `#mw-go-note`) if nothing else writes it — grep first.
4. Fix the `shop.js:443` comment to say what is true.

### Guard

Extend `53-base-menu-idle.mjs` (or a new `54-launch-gate.mjs`): unequip the hull on a `level-2` account
(server allows it), then assert on Missions: `#mw-takeoff.disabled`, exactly ONE visible "can't launch"
line (count non-empty visible elements whose text is `t('ui.shop.cant_launch')`); on Map: the Autopilot
button is disabled AND programmatically clicking it after selecting an object leaves `__game.roam === false`.
Negative-test on current code (the autopilot assertion fails today).

---

## Phase 3 — Shop shows the ship it doesn't fly (audit A3, A5)

> **Shipped 2026-10-22** per [`2026-10-22-1334-loadout-skill-stats.md`](2026-10-22-1334-loadout-skill-stats.md), which supersedes this section: the Loadout calls `makePlayer` itself (no `applySkillsToDrive` helper), adds a Top speed stat, and a skill spend rebuilds the ship.

### A3 — Loadout stats ignore skills

`deriveShipStats` (`client/src/shop.js:89-99`) rebuilds HP / accel / turn / weight by hand and never applies
skills; the real build `makePlayer` (`client/src/sim-core/ship-entity.js:66-118`) multiplies engine and
thruster power by `fx.mobilityMul` (`:73-74`). A player with Mobility sees lower Accel / Turn in Loadout than
the ship flies.

1. In `ship-entity.js`, extract the drive part into one exported pure function used by BOTH:
   ```js
   // Engine/thruster power after skills — the ONE place skills touch the drive. makePlayer and the shop's
   // stats preview both call it, so the Loadout numbers are the numbers the ship flies.
   export function applySkillsToDrive(engine, thruster, fx) {
     if (engine) engine.power *= fx.mobilityMul;
     if (thruster) thruster.power *= fx.mobilityMul;
   }
   ```
   `makePlayer` calls it in place of `:73-74`. `deriveShipStats` gets a third arg `skills`
   (`G.activeShip?.progression?.skills ?? null`), copies `rc.engine` / `rc.thruster` (`{ ...rc.engine }` —
   **never mutate the catalog row**; `resolveComponents` in `ship-build.js` may return shared objects,
   check) and calls `applySkillsToDrive(engine, thruster, skillEffects(skills))` before `deriveDrive`.
   Update every `deriveShipStats` caller (grep `deriveShipStats(`) to pass skills.
2. Drop the engine "max speed" from the shop stat line (`shop.js:53`:
   `add('ui.shop.stat.maxspeed', s.maxSpeed)`): the player's top speed is the flat
   `PLAYER_MAX_SPEED` = 30 (`client/src/sim-core/step-player.js:29`, `:301`), lifted only by Mobility; the
   engine row's `maxSpeed` is enemy-only. **Decision (chosen):** remove the line; keep the catalog field
   (enemies use it, `step-enemies.js:108`). If `ui.shop.stat.maxspeed` is then unreferenced, delete it from
   `client/locales/source.json` + `ru.json`.
3. Guard: a node unit test in `client/src/sim-core/components.test.js` (THREE-free) building a player via
   `makePlayer` with `skills: { mobility: 5 }` and asserting its `acceleration` / `turnRate` equal what
   `deriveDrive` gives after `applySkillsToDrive` on copies of the same components — and that the catalog
   engine's `power` is unchanged afterwards (no mutation). `shop.js` imports THREE-bound modules, so it is
   not node-loadable (see the memory note "THREE modules need a browser boot"); additionally assert in the
   Phase 1/2 scenario that on an account with Mobility points the Loadout Accel number (`#ship-stats`)
   is `≈ 1.05^pts ×` the no-skill value. Spend points via `POST /api/players/:id/skills/spend` after enough
   XP — if XP is impractical to grant in a scenario, keep only the unit test and say so in the PR.

### A5 — "Owned" badge unstyled + dead CSS

`shop.js:388`, `:405` emit `<span class="owned-badge">`; the only rule is `.bay-item .owned-badge`
(`client/styles.css:708`), and `.bay-item` is no longer emitted anywhere → plain text.

1. Retarget the rule to `.lp-name .owned-badge` (check the actual parent of the span in `shop.js:386-414`).
2. Delete the dead selectors the audit lists (grep each in `client/src` + `client/index.html` before
   deleting; delete only zero-hit ones): `.mw-collapse`, `.mw-sub*`, `.mw-row`, `.mw-shop-item`,
   `.bay-tabs`, `.bay-tab`, `.bay-view`, `.shop-pane`, `.shop-types`, the `.bay-item` family,
   `#view-loadout`, `#view-stash`, `#view-shop`, and the `body.dev-phone` variants of these.
3. Guard: in the scenario, buy one item on a `level-2` account and assert the badge's computed
   `background-color` is not transparent.

---

## Phase 4 — Server-side drift (audit A2, B1, B2)

### A2 — side-mission "Est. reward" / "XP" is stale

`server/src/missions.js:36-42` hard-codes per-kill 40/40/100, boss 200, 14 wave kills. Reality
(`server/src/catalog_seed.js`): gunner 50 (`:509`), rocket pirate 50 (`:487`), mini boss 125 (`:518`), first
boss 250 (`:534`); the phases (`missions.js:15-34`) total 7 + 7 + 4 wave kills + 2 bosses. Credits double on
clear (`client/src/sim-core/level-runner.js:168`); per-kill XP is NOT doubled, the mission bonus is added
once (`:169`). Shown at `client/src/mainwindow.js:444-445`.

1. Replace the constants with a function of the descriptor:
   ```js
   // Expected value of a run, computed from the phases and the catalog — never restated by hand.
   function expectedRun(phases) {
     let credits = 0, xp = 0;
     for (const ph of phases) {
       const sp = ph.spawn; if (!sp) continue;
       const sum = sp.pool.reduce((a, p) => a + p.chance, 0);
       for (const p of sp.pool) {
         const s = SHIPS.find((r) => r.name === p.ship).stats;   // check the pool's `ship` key shape
         credits += sp.total * (p.chance / sum) * s.reward;
         xp      += sp.total * (p.chance / sum) * (s.xp ?? s.reward);
       }
     }
     return { credits, xp };
   }
   ```
   `estReward = round10(credits * 2)`, `estXp = round10(xp + MISSION_XP)`. Import `SHIPS` from
   `catalog_seed.js` (check `missions.js` doesn't create an import cycle with `catalog_seed.js`).
2. Fix the stale freighter-centre comment at `missions.js:69-75` (says −450/−400; real is −950).
3. Guard: `server/src/missions.test.js` (create if absent; match the server test style) recomputes the
   expectation from `SHIPS` + the phases and asserts `estReward` / `estXp` equal it; plus a sanity bound
   (today's numbers: ~3500 credits). Negative-test: it fails against the old constants.

### B1 — `buyItem` sells what the shop never offers

The shop's rule `price > 0 && stats.buyable !== false` lives in `client/src/shop.js:169` (`buyableNow`) and
`server/src/catalog_seed.js:347-348` (`classifyRarity`); `server/src/db.js:976-996` (`buyItem`) checks
neither → a direct `POST /api/players/:id/buy` gets price-0 enemy parts free (Boss hull comp 4, Medium hull
3, Boss engine 7).

1. One predicate in a client module both sides import (DECISIONS §136 pattern) — e.g.
   `client/src/sim-core/shop-rules.js`: `export const isShopItem = (row) => (row.price | 0) > 0 &&
   !(row.stats && row.stats.buyable === false);`. `buyItem` returns `{ ok: false, status: 403, error:
   'not for sale' }` when false; `buyableNow` and `classifyRarity` use it.
2. **Decision (chosen):** enforce `buyable: false` too, not only price 0 — §40.6 only left it unenforced
   because "no UI path offers those"; the server must not trust that. Add a DECISIONS entry amending §40.6.
   Fix `server/src/server.test.js:1048`, which relies on buying a non-buyable row: buy a priced, buyable row.
3. Guard: server tests — buying a price-0 row and a `buyable:false` row both return 403 and leave credits
   and stash unchanged.

### B2 — reset lists and new-player defaults

`gameplay_sessions` (has `player_id`, **no FK**, `server/src/db.js:262-264`) is in neither reset list
(`db.js:514` per-player DELETE list, `db.js:526` `--all` TRUNCATE), so `--all` leaves session rows pointing
at deleted players although SUMMARY says it "wipes every player-scoped table". The new-player values are
restated at `db.js:114`, `:120` (column defaults), `:498` (`registerPlayer` return), `:516` (reset UPDATE).

1. `const PLAYER_SCOPED_TABLES = [...]` used by the TRUNCATE; the per-player list is derived from it minus
   an explicit, commented keep-list (`sessions` = auth sessions kept? check today's behaviour and keep it).
2. **Decision (chosen):** `--all` truncates `gameplay_sessions` too (matches SUMMARY's promise). The
   per-player reset keeps it (analytics of a real person replaying are still useful). The S3 trace objects
   are NOT deleted — record that as a known leftover in SUMMARY. *If the maintainer prefers sessions to
   survive `--all`, flip this and fix SUMMARY instead.*
3. `const NEW_PLAYER_DEFAULTS = { credits: 1000, current_progress: 0, … }` used by the reset UPDATE (build
   the SET clause from it) and the `registerPlayer` return. Column DDL defaults stay literal SQL but get a
   comment pointing at the constant, plus a test (below).
4. Guard: a server test that queries `information_schema.columns` for every table with a `player_id`
   column and asserts each is in `PLAYER_SCOPED_TABLES`; a test that a reset player equals a fresh one on
   every `NEW_PLAYER_DEFAULTS` key.

---

## Phase 5 — Replay / netsim drift (audit B5, B6)

### B5 — `?record` drops skills

`beginRecordCapture` (`client/src/main.js:1792-1809`) captures loadout + components but no skills, and
`stopRecordSession` (`:1813-1817`) passes none to `makeTrace`; the live recorder does pass them
(`:1849`, `:1855`). A `?record` made by an account with skill points plays back on a skill-less ship.

1. Capture `recSkills = activeMatches && G.activeShip.progression ? G.activeShip.progression.skills : null`
   next to `recLoadout` and pass `skills: recSkills` into `makeTrace`. Check `makeTrace` already accepts
   `skills` (the live path uses it) and the playback path reads `trace.skills` (`main.js:1914`).
2. Guard: a node test on the pure trace seam (`client/src/replay.js` / its test) that a trace made with
   skills round-trips them; if the capture is DOM-bound, extract the "what was flown" record into a pure
   helper and test that.

### B6 — the netsim room never knows what the player owns

`server/src/netsim/socket.js:150-156` builds `ship = { shipId, loadout, components, skills }` but no
`activeShip`; `createSimWorld` (`server/src/sim-host.js:115+`) sets `world.activeShip = ship.activeShip ||
null`, so `ownsReward` (`client/src/sim-core/drops-sim.js:18`) is always false in a room and the last-kill
reward crate drops even when the player owns it.

1. Add `activeShip: active` to that object.
2. Guard: a server test (netsim room tests live in `server/src/netsim/*.test.js`) creating a room for an
   account that owns the level's reward and asserting no reward drop spawns on the last kill.

---

## Docs to update (per phase, as part of the change)

- `docs/CHANGELOG.md` — one bullet per phase under the date it ships.
- `docs/SUMMARY.md` — Main Window section (menu state invariant; one launch gate; Welcome routes through
  the same helpers), Loadout stats (skills applied; no engine max-speed line), side-mission estimates
  (computed), shop server gate, player reset (`gameplay_sessions`), recording (skills captured), netsim
  (`activeShip`). Bump **Updated:**. Fix the stale line that Level 1 lands on Welcome (every level 1–4 has a
  briefing).
- `docs/DECISIONS.md` — one entry: "the base menu is a state, entered in one place" (why `enterMenu`
  rather than fixing the one handler), and the §40.6 amendment from B1.
- `docs/plans/2026-10-20-duplication-audit.md` — mark A1–A6, B1, B2, B5, B6 as fixed with the commit.

## Order and sizes

| Phase | Items | Size | Risk |
|---|---|---|---|
| 1 | reported bug, A6 | M | menu/launch flow — run the three named scenarios |
| 2 | A1, A4 | S | needs Phase 1's helpers |
| 3 | A3, A5 | S–M | `makePlayer` refactor → also run `node visual/run.mjs 22-trace-replay` (sim build path) |
| 4 | A2, B1, B2 | S each | server tests (`npm test` in `server/`, recreates `spacegame_test`) |
| 5 | B5, B6 | S each | replay / netsim tests |

Per the maintainer's standing preferences: ask before running test suites; the full visual suite and the
perf gate are opt-in; every fix ships with a guard that was seen to FAIL on the old code.
