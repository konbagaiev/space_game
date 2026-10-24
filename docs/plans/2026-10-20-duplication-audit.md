# Duplication audit — client + server (2026-10-20)

**Status (2026-10-23):** Phases 1–4 of
[`2026-10-20-base-menu-state-and-drift-fixes.md`](2026-10-20-base-menu-state-and-drift-fixes.md) shipped and
fixed **A1, A2, A3, A4, A5, B1, B2** and the menu entry/exit part of **A6** (plus §0 and the base-menu state
leak found the same day). **Still open:**
- **B5 remainder:** the five-place `resolvePlayerBuild` consolidation (the `?record` skills part was fixed
  2026-10-24 by Phase 5). **B6** fixed 2026-10-24.
- **A6 remainder:** the staged text reveal is written twice; Welcome's Take off still launches straight
  into the fight (kept deliberately).
- **C1, C2, C3, C4, C7** fixed 2026-10-24 by Phase 1 of the close-out plan
  ([`2026-10-24-1836-dedup-shared-contracts.md`](2026-10-24-1836-dedup-shared-contracts.md), DECISIONS §167).
- **B3, C8** fixed 2026-10-24 by Phase 2 of the close-out plan
  ([`2026-10-24-1926-ship-ids-catalog-builder.md`](2026-10-24-1926-ship-ids-catalog-builder.md), DECISIONS §168).
- **Not planned yet:** A7, A8, A9, B4, C5, C6, C9–C17.

**Close-out plan (2026-10-24):** every open item is scheduled in
[`2026-10-24-duplication-audit-closeout.md`](2026-10-24-duplication-audit-closeout.md) (8 phases).

Each open item is a candidate for its own change; pick them up one at a time (offer `/feature-pipeline` per
CLAUDE.md). Line numbers below are as of 2026-10-20 and have drifted — re-read the code before acting.

Fixed-by index: A1 + A4 → `7807850` (merge `ca754bd`, `2026-10-20-1816-launch-gate`); A6 menu part →
`f9a88ad` (merge `8f9e705`, `2026-10-20-1659-base-menu-idle`, DECISIONS §162); A3 + A5 → `74751f4` (merge
`6d0fc57`, `2026-10-22-1334-loadout-skill-stats`, §163); A2 + B1 + B2 → `0fb8416` (merge `384e083`,
`2026-10-22-1953-catalog-economy-guards`, §164, §165); B5 (`?record` skills part) + B6 → `20e9176` (§166)
(`2026-10-23-1823-record-skills-netsim-ship`, §166).

**Why this exists.** "Take off" sat at a different horizontal spot on each base-menu stage (720 / 671 / 635
px at 1440 wide on Character / Missions / Loadout) because it lived inside a column whose width is restated
per stage — and the first fix copied those widths into yet another rule. The maintainer asked for an audit
of the codebase for duplication of this kind: the same rule, constant or layout fact written in several
places that must be kept in sync by hand, and copies that have ALREADY drifted.

**Method.** Three read-only audits (base-menu UI; client sim/render/netsim; server + the client↔server
contract) read the code and cited every copy. No tests were run. Items marked **✔ verified** were re-checked
by hand in the main session against the source on 2026-10-20; the rest are the audits' readings with
file:line evidence — re-read the cited lines before acting (line numbers drift).

**Recurring cure.** Most findings resolve the same way DECISIONS §136 already set up: one pure module under
`client/src/` (usually `sim-core/`) that BOTH sides import — the server already imports `sim-core`,
`ship-classes.js` and `level-sim.js`; the reverse is impossible. Plus a test that recomputes the derived
value from its source instead of asserting a literal.

Sizes: **S** ≤ ½ day, **M** ~1–2 days, **L** more.

---

## 0. Fixed already — Take off position (the trigger)

- `#mw-launch` moved out of `#mw-work` (`client/index.html`) onto its own bottom row of `#mainwin`
  spanning all columns (`client/styles.css` `#mainwin` `grid-template-rows: minmax(0,1fr) auto`); the
  copied-column-width rule was deleted. Measured: screen centre, same height, on all four stages, desktop
  and phone. CHANGELOG 2026-10-20.
- **Residual — fixed 2026-10-20** (`2026-10-20-1816-launch-gate`: `#mw-launch` `padding-bottom: 10px`; measured
  overlap was 6px, note bottom 786 vs bar top 780 at 1280×800; guarded in `54-launch-gate`). Original finding:
  by arithmetic the floating `#xp-bar` (fixed, `bottom: 6px`, 14px tall,
  z-index 13) overlaps the bottom ~6px of `#mw-takeoff-note`. The note is usually empty; it matters when
  "can't launch" shows. Pre-existing, unchanged by the move. See A8.

---

## Summary table

| # | Finding | State | Visible to | Size |
|---|---|---|---|---|
| A1 | Map "Autopilot to destination" ignores the launch gate | **fixed 2026-10-20** (`7807850`) | player | S |
| A2 | Side-mission "Est. reward" / XP estimate is stale (~33 % low) | **fixed 2026-10-22** (`0fb8416`) | player | S |
| A3 | Loadout ship stats ignore skills (Mobility) | **fixed 2026-10-22** (`74751f4`, §163) | player | M |
| A4 | Launch gate in 3 places; "can't launch" note can show twice | **fixed 2026-10-20** (`7807850`) | player | S |
| A5 | Shop "Owned" badge unstyled; ~120 lines of dead CSS | **fixed 2026-10-22** (`74751f4`) | player | S |
| A6 | Welcome screen = a second, drifted launch/menu path | menu entry/exit **fixed** 2026-10-20 (`f9a88ad`, §162); reveal dup + direct launch **open** | player (edge) | M |
| A7 | Three breakpoint systems; vw/vh wrong under forced rotation | drifted (derived) | player (phone) | M |
| A8 | `#mainwin` column widths ×6; xp-bar clearance hand-derived | sync risk (caused §0) | player | S |
| A9 | Money: 3 units, 3 golds, 2 balance readouts on Loadout | drifted | player | S–M |
| B1 | `buyItem` sells price-0 / `buyable:false` items via direct API | **fixed 2026-10-22** (`0fb8416`, §164) | server / economy | S |
| B2 | `gameplay_sessions` missing from `--all` reset; new-player defaults ×3 | **fixed 2026-10-22** (`0fb8416`, §165) | ops | S |
| B3 | Server `buildShip` matches by an id seed ships don't have | **fixed 2026-10-24** (`b1b5727`, §168) | server authority | S–M |
| B4 | Dev fight flags applied in 5 places, already diverged | drifted | dev / netsim | M |
| B5 | "Effective player build" in 5 places; `?record` drops skills | `?record` part **fixed 2026-10-24** (§166); `resolvePlayerBuild` consolidation open | replay | M |
| B6 | Server room never passes `activeShip` → reward crate always drops | **fixed 2026-10-24** (§166) | netsim | S |
| C1 | Skill list ×7 | **fixed 2026-10-24** (`6ad1a1a`) | — | M |
| C2 | Slot lists + weapon-group map, client vs server | **fixed 2026-10-24** (`6ad1a1a`, §167) | — | S |
| C3 | Sell rate ×3, test checks a literal | **fixed 2026-10-24** (`6ad1a1a`) | — | S |
| C4 | Client hand-rebuilds the progression object after a game | **fixed 2026-10-24** (`6ad1a1a`) | — | S |
| C5 | Level reward stated 3 times (drop / briefing grant / owned check) | sync risk | — | S–M |
| C6 | Mission location "four-way invariant" only half tested | sync risk | — | S |
| C7 | Shop-unlock triggers + hard-coded starter ids | **fixed 2026-10-24** (`6ad1a1a`) | — | S |
| C8 | Catalog flattening + DB row mappers duplicated | **fixed 2026-10-24** (`b1b5727`, §168) | — | M |
| C9 | Per-tick warp/repair/shield logic copied per ship kind | drifted (minor) | replay risk | S–M |
| C10 | Hit handling + death events copied ~8× | sync risk + latent crash | — | M |
| C11 | Netsim wire format written 3×; ghost entities hand-built | sync risk (tested) | — | S |
| C12 | Tick/snapshot timing constants across the boundary | sync risk | — | S |
| C13 | Live tick deps written twice in `main.js` | sync risk | — | S |
| C14 | Button styles/colours copied; same control styled two ways | drifted (style) | player | M |
| C15 | Phone vs desktop sizing in opposite directions | sync risk | — | M |
| C16 | Dead i18n keys still translated | waste | translators | S |
| C17 | Small constants: languages, event types, password/username limits, input keys, legacy radius/nose, enemy total, enemy xp=reward, station pos, map drift, cache header | low | — | S each |

---

## A. Base-menu UI

### A1. Map "Autopilot to destination" ignores the launch gate — **drifted ✔**
**Fixed 2026-10-20** (`2026-10-20-1816-launch-gate`).
- Map's Take off reads the gate when rendered (`client/src/mainwindow.js:171-172`); autopilot only checks
  selection/lock (`client/src/systemmap-ui.js:117`, `:263-267`) and its handler calls `enterRoam` unguarded
  (`mainwindow.js:173`). The comment at `client/src/shop.js:443` claims the Map's buttons read
  `canTakeOff()` — only Take off does.
- The gate is reachable: the server lets you unequip the hull (`server/src/db.js:1069-1080`) and then
  reports `launchable: false` (`db.js:1259`, `:1278`).
- Effect: Take off greyed with "can't launch", Autopilot next to it flies a 0-HP ship out.
- Fix: one `canLaunch()` used by every launch control (see A4).

### A2. Side-mission reward estimate is stale — **drifted ✔**
**Fixed 2026-10-22** (`0fb8416`, `2026-10-22-1953-catalog-economy-guards`): `missions.js expectedRun()`
computes the estimate from the phases × ship catalog (card now ≈3510 / ≈2750); freighter comment fixed;
guard `server/src/missions.test.js`.
- `server/src/missions.js:38-39` hard-codes 40/40/100 per kill and 200 per boss and 14 wave kills. Catalog
  (`server/src/catalog_seed.js`): pirate gunner 50 (`:509`), rocket pirate 50 (`:487`), mini boss 125
  (`:518`), first boss 250 (`:534`). The generator's waves total 7+7+4 = 18, not 14. `git log -S` shows the
  rewards changed (9a1f322) after the estimate was written (3d1a134).
- Shown at `client/src/mainwindow.js:444`: card says ~2360, expected ~3500 (×2 on clear,
  `level-runner.js:168`). "XP ≈ 1000" omits per-kill XP (~+1750).
- Also stale: `missions.js:69-71` comment says freighter centre z −450/−400; real is −950.
- Fix: compute from the descriptor (`spawn.pool` odds × `SHIPS[name].stats.reward/xp`, like
  `enemyTotalFromPhases`) + a test that recomputes it from the catalog.

### A3. Loadout ship stats ignore skills — drifted
**Fixed 2026-10-22** (`2026-10-22-1334-loadout-skill-stats`).
- `deriveShipStats` (`client/src/shop.js:89-99`) rebuilds the ship's numbers by hand; the real build
  `makePlayer` (`client/src/sim-core/ship-entity.js:66-118`) applies Mobility to engine/thruster power
  (`:73-74`). Players with Mobility see lower Accel/Turn in Loadout than they fly. `shop.js:92` shows this
  hand copy slipped once before (grab + shield).
- Fix: extract a pure "ship numbers from components + mounts + skills" from `makePlayer`; the shop calls it.
- Related (2026-10-19 finding, not in the audits): the shop shows an engine "max speed" stat
  (`shop.js:53`) that never applies to the player — the player's cap is the flat `PLAYER_MAX_SPEED` 30,
  lifted only by Mobility (`client/src/sim-core/step-player.js:301`). Same root: the shop restates the
  ship model instead of reading it. **Also fixed 2026-10-22** (`74751f4`): the engine line no longer shows
  `maxSpeed`; the Loadout bar gains a real **Top speed** stat (`PLAYER_MAX_SPEED × maxSpeedMul`).

### A4. Launch gate written three times; note can show twice — drifted
**Fixed 2026-10-20** (`2026-10-20-1816-launch-gate`).
- `!active || active.launchable !== false` at `mainwindow.js:335-338` and `shop.js:445`;
  `#mw-mission-nav.disabled` set at `mainwindow.js:328` and `shop.js:454`; `updateTakeoffGate` writes the
  same hint into `#mw-go-note` and `#mw-takeoff-note` (`shop.js:447-452`), and `updateGoButton` shows
  `#mw-go-note` whenever a side mission is active (`mainwindow.js:319-320`) → the red line twice.
- `missionOffers.find(o => o.id === activeMissionId)` repeated at `mainwindow.js:317, 350, 470, 499`.
- Fix: one gate function + one note element under the launch bar; an `activeOffer()` helper.

### A5. "Owned" badge unstyled; dead CSS — drifted
**Fixed 2026-10-22** (`2026-10-22-1334-loadout-skill-stats`).
- `shop.js:388`, `:405` emit `<span class="owned-badge">`; the only rule is `.bay-item .owned-badge`
  (`client/styles.css:708`) and `.bay-item` is no longer emitted anywhere → plain text.
- Unused selectors from earlier shop/menu versions: `.mw-collapse`/`.mw-sub*`/`.mw-row` (`:204-227`),
  `.mw-shop-item` (`:219`, `:660`), `.bay-tabs`/`.bay-tab` (`:231-239`), `.bay-view`/`.shop-pane`/
  `.shop-types` (`:633-649`), `.bay-item` family (`:688-730`), `#view-loadout/#view-stash/#view-shop`
  (`:735-743`). Dead rules that look live are how the badge got stranded.
- Row/detail markup copied: `shop.js:386-394` vs `:404-414`; model-or-placeholder `:325-327` vs `:407-409`.
- Fix: style `.lp-name .owned-badge`, delete dead blocks, share `itemHeader()` / `itemModelSlot()`.

### A6. Welcome screen is a second, drifted launch/menu path — drifted
- Every campaign level 1–4 has a briefing (`catalog_seed.js:754, 791, 846, 910`), so `showWelcome` is a
  fallback only (`main.js:2003`, `:2339`, `account.js:290`, `mainwindow.js:115`). SUMMARY's line that
  Level 1 lands on Welcome is out of date.
- Menu-exit steps copied 4×: `welcome.js:168-177`, `mainwindow.js:91-104`, `:508-518`, `:526-533`. They
  differ: only some hide `#welcome`; welcome's Take off doesn't clear `G.activeMission`/`G.pendingBriefing`
  and has no gate; `showMain` never hides `#welcome` (login from welcome draws the main window over it).
- Menu-entry copied (`mainwindow.js:55-60` vs `welcome.js:58-61`); "return to base" copied
  (`mainwindow.js:583` vs `main.js:542-545`); staged text reveal written twice (`welcome.js:26-54`,
  `mainwindow.js:381-433`, both 5000/500 ms) with CSS `.25s` copies (`styles.css:161-162`, `:538-539`).
- Fix: delete Welcome or route `showWelcome` → `showMain`; one `leaveMenu()` / `enterMenu()`.
  (Onboarding-flow call — ask the maintainer explicitly.)
- **Fixed 2026-10-20 (menu entry/exit part)** — [`2026-10-20-1659-base-menu-idle.md`](2026-10-20-1659-base-menu-idle.md):
  every menu entry goes through `enterMenu()`, every launcher through `leaveMenu()`; `showMain` hides
  `#welcome`; Welcome's Take off has the launch gate (then `canTakeOff()`, since 2026-10-20's launch-gate
  run the shared `canLaunch()` from shop.js) and clears `G.activeMission`/`G.pendingBriefing`;
  SUMMARY's Level-1-lands-on-Welcome line corrected. Welcome itself is kept (DECISIONS §162).
- **Known drift:** Welcome's Take off still launches straight into the fight (`reset()`), while the Main
  Window's goes through roam (`launchCampaign` → `enterRoam`). Kept deliberately (maintainer, 2026-10-20).
  Revisit if Welcome is deleted or a briefing-less level ships.
- Still open: the staged text reveal written twice (bullet above).

### A7. Three breakpoint systems; viewport units under forced rotation — drifted (derived, not device-checked)
- Most sizing keys off `body.dev-phone` (shortest edge < 600, `client/src/device.js:31-35`); briefing +
  welcome switch at `@media (max-width: 760px)` (`styles.css:644-649`); top-right credits at
  `@media (max-width: 780px)` (`:814`); wordmark `4.5vw` (`:834`); intro card `100vw`/`14vh` (`:66-87`).
- Upright phones get `body.rot` (page rotated to landscape, `engine.js:96-102`), but media queries and
  vw/vh still measure the upright screen → briefing font, intro card width (~124px instead of ~578px on a
  390px phone), wordmark and stacking change with how the phone is held.
- Fix: phone layout only from `body.dev-*`; JS sets `--game-w`/`--game-h` from `gameW()`/`gameH()` to
  replace vw/vh in fixed overlays.

### A8. `#mainwin` column widths ×6; hand-derived clearances — sync risk (caused §0)
- `styles.css:172`, `187`, `189-192`: three stage modes × phone/desktop.
- Hand-derived from `#mainwin` padding + `#xp-bar` (`bottom: 6`, height 14, `:1140`):
  `#mw-view-map` `padding-bottom: 16px` (`:450`), `#help` `bottom: 26px` (`:30`), `.brawl-panel` 26
  (`:1303`); see the §0 residual.
- Fix: one `grid-template-columns: minmax(var(--mw-left-min), 18%) 1fr var(--mw-right,)`; stages set only
  `--mw-right`, the form sets `--mw-left-min`; an `--xp-bar-clear` variable.

### A9. Money display — drifted
- Units: top bar "N cr." (`ui.mainwin.credits_unit`, `index.html:169`); prices "N ◈" hard-coded and
  unlocalised (`client/src/format.js:17`, `:22`); Loadout header "Credits: N" (`index.html:102`).
- Golds: `#ffd27a` (`styles.css:810`), `#ffd86b` (`:618`, `:422`), `#ffcf5a` (`:340`).
- Loadout shows the balance twice in different formats/colours (both set in `renderBay`, `shop.js:461-462`).
- Fix: one `formatCredits(n)` with an i18n unit, one `--credit-gold`, drop the header readout.

---

## B. Server, netsim, replay — drifted or latent

### B1. `buyItem` sells items the shop never offers — **drifted ✔**
**Fixed 2026-10-22** (`0fb8416`, DECISIONS §164 amending §40.6): one `isShopItem(price, stats)` in
`client/src/sim-core/shop-rules.js` feeds `buyableNow`, `classifyRarity` and `buyItem`, which returns
`403 { error: 'not for sale' }`.
- Shop rule `price > 0 && stats.buyable !== false` at `client/src/shop.js:169` (`buyableNow`) and
  `server/src/catalog_seed.js:347-348` (`classifyRarity`). `server/src/db.js:976-996` (`buyItem`) checks
  neither. A direct `POST /api/players/:id/buy` gets price-0 enemy parts for free (Boss hull comp 4, Medium
  hull 3, Boss engine 7) — against DECISIONS §40.6 ("a boss hull must never be buyable").
- §40.6 knowingly left `buyable:false` unenforced ("no UI path offers those"; `server.test.js:1048`
  relies on it). The price-0 hole is not covered by that decision.
- Fix: one `isShopItem(row)` in a client module; `buyItem` returns 403 on it; `buyableNow` +
  `classifyRarity` use it; that test buys a priced, buyable row instead.

### B2. Reset lists and new-player defaults — **drifted ✔**
**Fixed 2026-10-22** (`0fb8416`, DECISIONS §165): `PLAYER_SCOPED_TABLES` (incl. `gameplay_sessions`, pinned
against `information_schema`) + an explicit per-player keep-list; `--all` deletes the S3 session traces first
(refuses without S3 creds unless `--no-s3`); `NEW_PLAYER_DEFAULTS` in `db.js`. The IAM `s3:DeleteObject`
grant on `recordings/sessions/*` was added 2026-10-23.
- Per-player delete list `db.js:514`; `resetAllPlayers` TRUNCATE list `db.js:526`; tables `db.js:107-359`.
  `gameplay_sessions` (has `player_id`, **no FK**, `db.js:262-264`) is in neither, so `--all` leaves
  session rows (and S3 traces) pointing at deleted players; SUMMARY says `--all` "wipes every
  player-scoped table".
- Starting values (credits 1000, progress 0, 'en', shop locked, skills 0) at `db.js:114`, `:120`
  (defaults), `:498` (`registerPlayer` return), `:516` (reset UPDATE).
- Fix: `PLAYER_SCOPED_TABLES` (+ note which the per-player reset keeps on purpose), one
  `NEW_PLAYER_DEFAULTS`, a test that every table with `player_id` is in the TRUNCATE list.
- **Answered (maintainer, 2026-10-22):** `--all` wipes `gameplay_sessions` AND deletes their S3 traces; the
  per-player reset keeps them.

### B3. Server `buildShip` matches by an id the seed doesn't have — **fixed 2026-10-24** (`b1b5727`, §168)

_Fixed by [`2026-10-24-1926-ship-ids-catalog-builder.md`](2026-10-24-1926-ship-ids-catalog-builder.md) (explicit seed ship ids = prod's, `ON CONFLICT (id)` + per-boot `reconcileShipIds`, `buildShip` via `shipById`) — the evidence below is as of 2026-10-20._
- `server/src/sim-host.js:65-89` matches `s.id === shipId`; its catalog comes straight from
  `catalog_seed.js:458+`, whose `SHIPS` rows have no `id` (DB assigns sequence ids, `db.js:379-381`). The
  browser builds from DB rows (`client/src/main.js:2259-2262`); traces and the room handshake carry the DB id
  (`main.js:1796`, `:1839`, `server/src/netsim/socket.js:155`).
- So the room, `sim-replay.mjs` and both verifiers always fall back to the first player ship. Fine with
  one flyable hull (`catalog_seed.js:460`); wrong the day a second one ships.
- Fix: fixed ids on seed ships, upsert by id (as weapons/components/levels already are). See C8.

### B4. Dev fight flags applied in five places — drifted (dev only)
- `client/src/main.js:2269` (ally, lancer, duel, trace-room, brawl); `client/src/account.js:283` (no
  lancer); `client/src/net.js:265` (no lancer, no brawl); `server/src/sim-host.js:118-129`.
- Forwarded to the room via `main.js:1067-1072` → `netsim.js:118-137` → `socket.js:136-147`: ally, lancer,
  beam, brawl — **not duel**, so `?duel&netsim=1` fights a different fight in the tab and the room.
- Recorded: only duel (`main.js:1854-1858`); an `?ally`/`?lancer` session records as the plain level.
- Fix: parse the URL once into a fight spec `{ally, lancer, beam, duel, brawl}`; one
  `applyFightSpec(descriptor, spec)` in sim-core used at all four sites; socket + `trace.room` carry it.

### B5. "Effective player build" in five places; `?record` drops skills — drifted (replay)
**`?record` part fixed 2026-10-24** — [`2026-10-23-1823-record-skills-netsim-ship.md`](2026-10-23-1823-record-skills-netsim-ship.md): both recorders call the pure
`flownBuild()` (`replay.js`), skills included. The five-places consolidation (`resolvePlayerBuild`) stays
**open**, not planned. The `main.js` lines below have moved (`beginRecordCapture` is now
`:1789-1806`, `stopRecordSession` `:1809-1814`, live recorder skills `:1846`/`:1852`, playback `:1911`).
- `client/src/ship-build.js:49-63` (beam + duel overrides); `main.js:1797-1802` (`?record` captures
  loadout/components, **no skills**; `stopRecordSession` `:1815-1816` passes none to `makeTrace`);
  `main.js:1839-1856` (live: duel, not beam — known); `main.js:1911-1915` (playback);
  `sim-host.js:84-96` (beam only; the duel kit lives only in `client/src/duel-dev.js:65-69`).
- A `?record` by an account with spent skill points replays on a skill-less ship and diverges — the v4
  bug `replay.js` describes.
- Fix: one pure `resolvePlayerBuild(catalog, active, fightSpec)` in sim-core; both recorders store its
  output; move `DUEL_LOADOUT`/`DUEL_COMPONENTS` into `sim-core/duel-config.js`.

### B6. Server room never passes `activeShip` — drifted (netsim)
**Fixed 2026-10-24** — [`2026-10-23-1823-record-skills-netsim-ship.md`](2026-10-23-1823-record-skills-netsim-ship.md): the socket passes the account record as `ship.activeShip`
(and a stashed reward now counts as owned, DECISIONS §166).
- `server/src/netsim/socket.js:155` → `createSimWorld` gets no `activeShip`, so `ownsReward` is always
  false in a room: the last-kill reward crate drops even when the player owns it. The browser differs.
- Fix: pass the account's active-ship record.

---

## C. Sync risks (still agree, kept in step by hand)

### C1. Skill list ×7 (M) — **fixed 2026-10-24** (`6ad1a1a`)

_Fixed by [`2026-10-24-1836-dedup-shared-contracts.md`](2026-10-24-1836-dedup-shared-contracts.md) (one list in `client/src/sim-core/skills.js`) — the evidence below is as of 2026-10-20._

`server/src/db.js:13` (`SKILLS`), `:331-335` (columns), `:516` (reset UPDATE),
`server/tools/verify-sessions.mjs:74`, `client/src/mainwindow.js:185` (`SKILL_CARDS`),
`client/src/sim-core/components.js:58-61` (`skillEffects`), i18n `ui.skill.<key>`. Nothing guards it.
Fix: `sim-core/skills.js` exporting `SKILLS`; server imports it; generate column adds + reset SQL; test
every key has a `skillEffects` entry and both i18n keys.

### C2. Slot lists + weapon-group map (S) — **fixed 2026-10-24** (`6ad1a1a`)

_Fixed by [`2026-10-24-1836-dedup-shared-contracts.md`](2026-10-24-1836-dedup-shared-contracts.md) (slot lists in `sim-core/shop-rules.js`, `WEAPON_GROUP` derived from `GROUP_WEAPON_TYPE`, unknown type → 409, DECISIONS §167) — the evidence below is as of 2026-10-20._

Required/component slots `client/src/shop.js:29-30` (+ `:32-37`, `:146`, `:92`), `components.js:17`,
`ship-entity.js:34` vs `server/src/db.js:910-911`; `client/src/shop-slots.js:13` (`GROUP_WEAPON_TYPE`)
vs `db.js:915` (`WEAPON_GROUP`). Unknown weapon type: server falls back to `'gun'` (`db.js:1057`), client
to no slot. Fix: `db.js` imports `shop-slots.js` and derives `WEAPON_GROUP`; slot lists move there.

### C3. Sell rate ×3 (S) — **fixed 2026-10-24** (`6ad1a1a`)

_Fixed by [`2026-10-24-1836-dedup-shared-contracts.md`](2026-10-24-1836-dedup-shared-contracts.md) (`SELL_RATE` / `sellPrice` in `sim-core/shop-rules.js`) — the evidence below is as of 2026-10-20._

`client/src/format.js:21-22` (`SELL_RATE`, `sellLabel` unused), `client/src/shop.js:503`,
`server/src/db.js:916` (`sellPrice`); `format.test.js:36` asserts the literal 0.75. Fix: server sends
`sellPrice` per stash row (or one exported rate), delete client copies.

### C4. Client rebuilds progression by hand (S) — **fixed 2026-10-24** (`6ad1a1a`)

_Fixed by [`2026-10-24-1836-dedup-shared-contracts.md`](2026-10-24-1836-dedup-shared-contracts.md) (`POST /api/games` returns `progression`; Character bar uses `liveProgress`) — the evidence below is as of 2026-10-20._

`client/src/net.js:95-103` recomputes level/XP via `levelFromXp` and `skillPoints += gained` because
`POST /api/games` (`db.js:725`) returns a flat `{experience, level, leveledUp}`; other endpoints return a
full `progression`. `mainwindow.js:198` falls back to a literal 1000; a second XP bar on Character
(`mainwindow.js:198-206`) is computed differently from `hud.js:100-111` (`liveProgress`). (The XP-curve
copy itself is intentional, DECISIONS §103, and parity-tested.) Fix: `recordGame` returns
`progression: await getProgression(id)`; client adopts it; Character uses `liveProgress`.

### C5. Level reward stated three times (S–M)
Last-kill drop `catalog_seed.js:750` (weapon 5), `:790` (component 12); the real grant in the next
briefing `:794` (`replaceWeapon 1→5`), `:849` (`installComponent repair 12`); owned check
`client/src/sim-core/drops-config.js:39-50` hard-codes `comps.repair != null`, ignoring `reward.refId`.
Fix: `lastKillDrop` is the source; `advanceProgress` grants it (or the briefing action is generated from
it); `rewardOwned` resolves the slot from the catalog by `refId`.

### C6. Mission-location invariant half tested (S)
`server/src/missions.js:58-62` (centres), `client/src/sim-core/system-map.js:226-252` (`ANCHORS`),
`:285-296` (mission ids typed by hand), set-pieces `catalog_seed.js:1069-1093`.
`system-map.test.js:317` checks anchors vs set-pieces only. Fix: `missions.js` imports `ANCHORS`, or a
test that `objectForMission(m.id).pos` equals `m.descriptor.center` for every generated mission.

### C7. Shop-unlock triggers and starter ids — partly intentional (§90/§95) (S) — **fixed 2026-10-24** (`6ad1a1a`)

_Fixed by [`2026-10-24-1836-dedup-shared-contracts.md`](2026-10-24-1836-dedup-shared-contracts.md) (starter ids read from the starter ship row; the gates pinned by `shared-contracts.test.js`) — the evidence below is as of 2026-10-20._

`unlockShop` on level-2 (`catalog_seed.js:794`), `SHOP_MIN_LEVEL` boot catch-up (`db.js:27`, `:460-464`),
final-level fallback (`db.js:624`); weapon 1 granted at `db.js:463` and `:634`; grab 29 / shield 31 granted
at `db.js:445-451` while the starter ship lists them at `catalog_seed.js:463`. `FACTORY_GATE`
(`catalog_seed.js:49`) and `SIDE_MISSIONS_MIN_LEVEL` (`db.js:28`) both say `'level-4'`; stale `level-5`
comments at `catalog_seed.js:913`. Fix: derive/test `unlockShop` level == `SHOP_MIN_LEVEL`;
`STARTER_WEAPON_ID`; read grab/shield ids from the starter ship.

### C8. Catalog flattening and DB row mappers (M) — **fixed 2026-10-24** (`b1b5727`, §168)

_Fixed by [`2026-10-24-1926-ship-ids-catalog-builder.md`](2026-10-24-1926-ship-ids-catalog-builder.md) (`catalogFromRows` in `client/src/sim-core/catalog.js` used by both hosts; one row mapper per table in `db.js`, so stash rows carry `rarity`/`color`/model URLs; insert column lists left as is) — the evidence below is as of 2026-10-20._
Flattening at `client/src/main.js:2259` and `server/src/sim-host.js:37-44`; row→object at
`db.js:853/858` vs `:920-927` (`catalogItem` already lacks `rarity`, `color`, model URLs → stash rows
poorer than catalog rows); insert column lists `db.js:367`, `:373`. Fix: `catalogFromRows(...)` in
sim-core for both hosts; one column list per table.

### C9. Per-tick warp/repair/shield logic per ship kind (S–M, replay-sensitive)
`client/src/sim-core/step-player.js:236-247`, `:332-336`; `step-enemies.js:58-73`;
`step-ally.js:483-499`. Differences: player ignores its own `spawnDur` (written at `ship-entity.js:99`,
never read) and never sets `warping`; `shieldReady` only for the player; `enemyShieldRefills` not counted
for aces. Warp-in setup copied at `ally.js:69`, `ace.js:99-100`, `brawl.js:88-90`, `ship-entity.js:162-165`.
Fix: `beginWarp` / `stepWarp` / `stepSustain` keeping operation order; verify with `22-trace-replay` and
`36-sim-divergence`.

### C10. Hit handling and death events ~8× (M)
Shield-then-hull + `enemyShieldHit`/`shieldHit`/`hullHit`/`hit` events: `step-projectiles.js:47-93`,
`spawn.js:166-205` (splash emits no `hit`), `beam.js:277-325`. Deaths: `step-enemies.js:145-149`,
`step-ally.js:862-866`, `brawl.js:131-135` — one reads `e.engine.exhaust.color` unguarded (an engine row
without `exhaust` would throw). Fix: `applyHit(world, victim, side, dmg, pos, heading, weaponClass)` and
`emitShipDown(world, e, type)`.

### C11. Netsim wire format ×3 (S, currently test-guarded)
Docs `server/src/netsim/protocol.js:41-47`, encoder `room.js:285-293`, positional decoder
`client/src/netsim-world.js:220-228` (enemy/ally decoders copy-pasted); ghost bullets/rockets/drops
hand-built at `netsim-world.js:141-160` (drop height 0.8 in two places). Guarded by
`netsim-world.test.js:318`. Fix: shared `ROW_SCHEMA` + `encodeRow`/`decodeRow` in sim-core; ghosts from
sim-core constructors.

### C12. Timing constants across the boundary (S)
`INTERP_DELAY_MS = 100` (`client/src/netsim-world.js:51`) "keep in step" with `SNAPSHOT_EVERY = 2`
(`server/src/netsim/room.js:52`); catch-up cap 6 at `main.js:1258`, `netsim.js:167`,
`server/src/netsim/driver.js:16`; 0.1 s clamp `main.js:1237`, `:1249`; 60 Hz hard-coded at
`client/src/brawl-stats.js:33`, `sim-core/level-sim.js:68`, `server/tools/brawl-capacity.mjs:64` —
contradicting `consts.js:28-35` ("one edit HERE"). Fix: constants in `sim-core/consts.js`, derive the rest.

### C13. Live tick deps twice in `main.js` (S)
`liveTickDeps()` `main.js:1105-1118` vs inline in `__replay.step` `:2163-2170` (5 of 7 fields shared; only
`capture` should differ); `live` check at `:1106` and `:1150`; stale `noseZ` comment `:2147`. Fix:
`makeTickDeps({capture})`.

### C14. Button styles and colours copied (M)
Orange launch gradient `styles.css:540-544`, `:490-493`, `:1203-1212`, `:1229`; cyan primary ×5;
`#4a7dff` ×23. "Autopilot to destination" is grey/secondary on Missions (`:547-550`) but cyan/primary on
Map (`:487`). Map gold `#ffd24a` in CSS (`:473-474`) and canvas (`systemmap-ui.js:168, 174, 185`); mission
board uses `#ffcf5a` for the same "active" idea. Arrival prompt styled inline (`systemmap-ui.js:348-355`),
unreachable by phone rules. Fix: `:root` colour tokens + `.btn-launch` / `.btn-primary` / `.btn-secondary`.

### C15. Phone vs desktop sizing conventions (M)
`.lp-*`, `.mission-card`, `.slot-chip` written desktop-size with hand-halved phone copies
(`styles.css:363-387`); `#ship-stats` the reverse (`:684-686`); briefing a third way (`:655-656`);
Character has no phone rules. Fix: one `--ui-scale` per form, or at least one convention.

### C16. Dead i18n keys (S)
Unreferenced but translated: `ui.button.take_off_mission` (SUMMARY still names it), `ui.card.*`,
`ui.mount.*`, `ui.hangar.title`, `ui.briefing.title`, `ui.shop.stash`, `ui.shop.empty_stash`,
`ui.shop.action.unequip`, `ui.shop.filter.all`, `ui.shop.tab.ship`, `ui.mission.slot`,
`ui.stub.character`, `ui.stub.map`. Fix: delete from `source.json` + `ru.json`; test every key is referenced.

### C17. Small constants and leftovers (S each, low risk)
- Languages `server/src/server.js:24` vs `client/src/i18n.js:8` (documented mirror, §10); `EVENT_TYPES`
  `server.js:26` vs client `track('…')` calls (a new event silently 400s); password min 8 `server.js:31` vs
  `client/src/account.js:197, 255`; username max 32 `server.js:33` vs `index.html:151`.
- Input key lists `step-player.js:254-257, 270-271, 289-291, 339` + `steering.js:36-39`; fire keys
  hard-coded though groups get theirs from `catalog_seed.js:420-422`.
- Catalog values copied into code: `ALLY_SNAP_ANGLE`/`ALLY_TURN_EXIT_ANGLE` (`ally-config.js:33-35`) "=
  aimTol" (`catalog_seed.js:420`); duel kit = starter ship + repair (`duel-dev.js:65-69`).
- Enemy-total rule `server/src/enemy_total.js:7` vs `sim-core/level-sim.js:8` (equivalent; re-export).
- Legacy hull radius 2.6 (`collision.js:19` + literals at `ship-entity.js:155`, `ally.js:34`,
  `hitboxes-debug.js:54`, `beam-fx.js:546`); nose 1.6 (`ship-entity.js:83, 145, 206`, `beam.js:92`,
  `ship-factory.js:339`); dead `userData.noseZ` write (`ship-factory.js:275`).
- Enemy `xp` = `reward` by hand on all 9 enemies (`catalog_seed.js:477…624`) — default it.
- Map drift: `world.js:1371` sets `arenaDrift` from the map, `reset-world.js:48-50` overwrites it every
  reset, server never reads it. Station position: browser uses the mesh position after frame conversion
  (`world.js:1336-1355`), server uses `spec.pos` (`sim-host.js:57-63`) — equal only because the base
  station isn't `frame: 'world'`.
- `staticCacheControl` (`server/src/server.js:59-60`) is tested (`server.test.js:48-56`) but the static
  middleware (`server.js:644`) writes the header itself — the test covers a copy.

---

## D. Intentional splits (not findings)

XP curve on both sides (§103, parity-tested); `EVENT_ENTITY_REFS` one table, two readers (§136); netsim
client does no simulation/prediction (§116, §127); room catch-up not bit-identical to a trace replay
(SUMMARY); recording doesn't capture `?beam` (named at `main.js:1835`); pilot's private RNG stream (§73,
§151); server session caps above the client's (documented in `server.js`); `buyable:false` unenforced on
the server (§40.6 — but see B1 for price 0). Checked and fine: shared `enemyTotalFromPhases`,
`verify-run.js` imports client `MAX_SESSION_*`, one `reachedLevel`, snapshot column order is room→client
tested.

---

## E. Suggested order

1. ~~**Player-visible drift, small:** A1 + A4, A2, A5, B1~~ — done (2026-10-20 / 2026-10-22).
2. ~~**A3**~~ — done 2026-10-22.
3. ~~**B2**~~ — done 2026-10-22.
4. **Shared-module pass (§136 pattern):** C1 skills, C2 slots, C3 sell rate, C4 progression, B3 + C8
   catalog ids/flattening — one sim-core module each, server imports.
5. **Replay/netsim integrity:** B5 + B6 (next — Phase 5 of the drift-fix plan), B4 (fight spec), then C9/C10 with the
   determinism guards.
6. **CSS system:** A8 + C14 + C15 + A7 (tokens, one grid rule, one scale convention) — a single
   layout-focused change with a full visual pass on device.
7. Leftovers: C5–C7, C11–C13, C16, C17.
