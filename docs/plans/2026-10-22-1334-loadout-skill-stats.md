# Loadout shows the ship you fly — skills in the stats bar, a real Top speed, the Owned badge styled

**Status:** planned. **Date:** 2026-10-22. **Pipeline id:** `2026-10-22-1334-loadout-skill-stats`.
**Source:** Phase 3 of [`2026-10-20-base-menu-state-and-drift-fixes.md`](2026-10-20-base-menu-state-and-drift-fixes.md)
(audit items **A3** and **A5** of [`2026-10-20-duplication-audit.md`](2026-10-20-duplication-audit.md)). Phases 1–2
shipped (DECISIONS §162). This brief **supersedes** that Phase 3 section where they differ — the maintainer
re-decided several points (see *Decisions*).

## Goal

The Loadout screen's ship-stats bar (`#ship-stats`) re-derives HP / Accel / Turn / Weight by hand in
`deriveShipStats` and never applies skills, so a pilot with Mobility points reads lower Accel/Turn than the
ship flies. The shop's engine stat line also advertises a catalog `maxSpeed` that never applies to the player
(the player's cap is the flat `PLAYER_MAX_SPEED` 30, lifted only by Mobility). Fix both by making the bar read
the **real build** (`makePlayer`) and show a **Top speed** stat computed the way the sim computes it. Spending
a skill point on the base must also rebuild the flown ship — today it does not, so the new numbers would be a
lie for the next run. Separately (A5), the "(owned ×N)" shop badge renders as plain text because its only CSS
rule targets a class nothing emits; restyle it, delete the dead shop/menu CSS, and collapse the three copies
of the item header/model markup in `shop.js` into two shared helpers.

User-visible: Loadout Accel/Turn rise with Mobility and match flight; a fifth stat **Top speed** (30.0, 31.5
with one Mobility point…); the engine's shop line no longer shows a speed; the Owned badge is a small green
pill; a skill spent on the base takes effect on the very next take-off.

## Decisions (chosen — do not re-ask)

1. **The shop calls `makePlayer` itself.** No narrow `applySkillsToDrive` helper (the old Phase 3 idea is
   dropped). `deriveShipStats` builds the player entity from the active-ship record and reads its numbers; the
   hand-kept copy (`shipMass` + `deriveDrive` on a hand-assembled ship) is deleted. Rationale: the copy has
   drifted twice (grab + shield weight once, skills now); reading the real build makes a third drift
   impossible, for any future skill too.
   - **Catalog equivalence — verified.** `client/src/state.js:140` does `world.catalog = CATALOG;` and nothing
     else in `client/src` reassigns `world.catalog` (grep `world.catalog *=` → that line only). So
     `makePlayer(world.catalog, …)` resolves the same rows the shop's `CATALOG` reads. Weapons: the old copy
     used `CATALOG.weapons.get(id)`; `makePlayer`'s `buildMounts` uses `resolveWeapon(catalog,id)` =
     `catalog.weapons.get(id)` (`client/src/sim-core/ship-entity.js:25`) and then shallow-clones each weapon
     (`{...m.weapon}`), keeping `weight`. Components: both go through `resolveComponents`
     (`ship-entity.js:31-35`), which returns **fresh objects per call** — `makePlayer`'s Mobility/Shield
     scaling never mutates the catalog (the unit test below pins this).
   - **`makePlayer` draws no RNG — verified.** `simRandom` in `ship-entity.js` is used only in `makeEnemy`
     (`:175-179`) and the enemy branch of `updateGroups` (`:258`). Calling it from a UI render is safe.
   - `?duel`/`?beam` dev overrides (applied in `buildPlayerFor`, `client/src/ship-build.js:63`) are **not**
     mirrored in the Loadout preview. Dev-only flags; out of scope.
2. **Top speed stat:** `topSpeed = PLAYER_MAX_SPEED * p.maxSpeedMul` (`PLAYER_MAX_SPEED` exported from
   `client/src/sim-core/step-player.js:29`; applied by the sim at `:301` exactly as
   `PLAYER_MAX_SPEED * (player.maxSpeedMul || 1)`). Shown with **1 decimal** (`30.0`, `31.5`) — 0 dp would
   round 31.5 to a misleading 32. New locale key **`ui.shop.stat.topspeed`** (EN "Top speed", RU
   "Макс. скор."); the engine-line key **`ui.shop.stat.maxspeed` is deleted** from both locale files (its only
   reader is the line being removed, `shop.js:53`). The catalog field `engine.maxSpeed` **stays** — enemies use
   it (`step-enemies.js:108`).
3. **Five stats must not overflow.** `#ship-stats` is `flex-wrap: nowrap` today (`client/styles.css:626`) and
   lives in the narrow right column `#mw-ship-col` (`client/index.html:141-145`, ~25% of the width on phones).
   Change it to **`flex-wrap: wrap`** (+ a small `row-gap`) so a fifth stat wraps instead of overflowing, on
   every form factor. No per-device variant (DECISIONS §30). Guarded by containment assertions at desktop
   (scenario 05, 1280×800 → `dev-desktop`) and phone (scenario 07, 760×360 → `dev-phone`, since
   `classifyForm` in `client/src/device.js:30-35` calls shortest edge < 600 a phone).
4. **Skill spend rebuilds the player.** After a successful `POST /skills/spend`, call
   `buildPlayerFor(G.activeShip.ship)` — the same thing `applyShopState` already does after every shop
   mutation (`client/src/shop.js:486`), so a rebuild while the base menu is open is established practice.
   Must be **confirmed failing first** (see Step 4).
5. **Owned badge:** retarget to `.lp-name .owned-badge`, size **relative** (`0.65em`) so it scales with the
   name (22px desktop, 13px under `body.dev-phone` — `styles.css:337`, `:380`). Keep the existing green
   colours.
6. **Markup dedupe (A5):** two helpers in `shop.js` — `itemHeader(n)` (name + optional owned badge + stat
   line) and `itemModelSlot(kind, refId)` (canvas or "no model" placeholder) — used by `itemInfo`, `shopRow`
   and `renderShopDetail`. Output HTML must stay identical apart from the badge now also being possible in
   `itemInfo` (it is not, because `itemInfo` callers never set `n.owned`).
7. **Replay docs — the maintainer's premise does not hold; we correct what is actually stale and leave the
   accurate statements alone.** The maintainer asked to correct docs/comments that "claim a replay
   re-simulates and therefore needs the same skills", on the understanding that "the replay is already a real
   fight, just with pauses". **Verified in code, that is not the current behaviour:**
   - `client/src/replay.js:3-6` — a recording is input + seed; playback **re-runs the real sim**.
   - `client/src/main.js:1744-1752` (`loadTrace`) → `startPlaybackSession` (`:1890-1918`) rebuilds the ship
     with `skills: trace.skills || null` (`:1911`), re-seeds, and steps the recorded input.
   - The admin viewer's **▶ play** link is `/?playback&id=<sessionId>` (`server/src/admin.js:220`), served by
     `GET /api/sessions/:id/trace` (`server/src/server.js:614-622`) — the same re-sim.
   - The duel referee re-simulates headlessly via `buildShip(..., skills)` (`server/src/sim-host.js:67-93`,
     `server/src/seal/verify-run.js:11`).
   - What *is* "a real fight" now is the **Level-0 intro** — played live since 2026-08-30 (DECISIONS §138);
     its old trace survives only as the determinism fixture. That is probably what the maintainer meant.

   So the skills comments are **correct and stay**: `replay.js:22-30`, `ship-build.js:52-58`,
   `sim-host.js:87-90`, `main.js:1899-1911`, `verify-run.js:11`, SUMMARY *Session recordings* ("A trace must
   carry the SKILL allocation…"), DECISIONS §125. Deleting them would invite someone to drop `skills` from the
   trace and silently break every skilled replay and the referee. **What is genuinely stale** in the replay
   docs (all in SUMMARY *Combat record/playback*, `docs/SUMMARY.md:637-764`) is fixed in Step 7. The
   orchestrator should relay this disagreement to the maintainer at the review gate.

## Steps

### Step 1 — `deriveShipStats` reads the real build (`client/src/shop.js`)

Current: `shop.js:87-99` (comment + function), single caller `shop.js:468` in `renderBay`.

1. Imports (`shop.js:8-9`): drop `shipMass, deriveDrive` (line 8 becomes unused — delete it) and
   `resolveComponents` (keep `buildPlayerFor`). Add:
   ```js
   import { makePlayer } from './sim-core/ship-entity.js';
   import { PLAYER_MAX_SPEED } from './sim-core/step-player.js';
   ```
   and add `world` to the `state.js` import (`import { G, CATALOG, world } from './state.js';` — `world` is
   exported at `state.js:107`). Re-grep `shop.js` for `resolveComponents|shipMass|deriveDrive` afterwards: zero
   hits expected.
2. Replace the function (illustrative — adapt, but keep the contract):
   ```js
   // The Loadout stats ARE the flown ship's: build the player entity exactly as a take-off would
   // (makePlayer — skills included) and read its numbers. No hand-kept copy to drift (audit A3).
   // `active` is the active-ship record { ship, loadout, components, progression }.
   export function deriveShipStats(active) {
     const p = makePlayer(world.catalog, {
       ship: active.ship,
       loadout: active.loadout || { mounts: [] },
       components: active.components,
       skills: active.progression ? active.progression.skills : null,
     });
     return { hp: p.maxHp, acceleration: p.acceleration, turnRate: p.turnRate, weight: p.mass,
              topSpeed: PLAYER_MAX_SPEED * p.maxSpeedMul };
   }
   ```
   Notes: `makePlayer` needs `active.ship.stats` (it reads `groups`, `color`, `model`) — the server's
   `activeShip.ship` carries `stats` (`server/src/db.js:1268`). Missing hull/engine are handled inside
   (`hp: hull ? … : 0`, `deriveDrive` reads `engine?.power ?? 0`), so the "HP 0 red" crit path still works.
   `p.mass` is set by `deriveDrive` (`components.js:33`).
   **Where the skills come from:** `renderBay`'s `active` is `shopData.activeShip`. It is the **same object**
   as `G.activeShip` (`openBay` sets both from one response, `shop.js:589` / `:598-599`; `applyShopState`
   `:484-486`), and `skillSpend` mutates `G.activeShip.progression` in place (`mainwindow.js:256`), so the
   preview sees a fresh spend without a refetch.
3. Caller `shop.js:468`: `renderShipStatsBar(deriveShipStats(active));`.
4. Update the stale comment in `main.js:1346` only if it lists a signature (it lists names — leave it).

### Step 2 — Top speed in the bar, engine speed out of the stat line

1. `renderShipStatsBar` defs (`shop.js:105-110`): append
   `{ key: 'topSpeed', label: t('ui.shop.stat.topspeed'), dp: 1 }` **after** weight (keep the existing
   order so scenario indices HP=0, Accel=1, Turn=2, Weight=3, Top speed=4). Higher is better (default).
2. `statLine` (`shop.js:53`): engine branch becomes `add('ui.shop.stat.accel', s.power);` only.
3. `client/locales/source.json:294-297`: replace the `ui.shop.stat.maxspeed` entry with
   ```json
   "ui.shop.stat.topspeed": {
     "source": "Top speed",
     "context": "Stat label — the ship's top speed (the pilot's flat cap, raised only by the Mobility skill). Short."
   },
   ```
   `client/locales/ru.json:75`: replace with `"ui.shop.stat.topspeed": "Макс. скор.",`.
   Concept sweep (gate): `grep -rn "stat.maxspeed\|maxspeed" client/src client/locales client/visual` → zero.
4. `client/styles.css:626`: `#ship-stats { display: none; flex-wrap: wrap; gap: 2px 8px; … }` (row-gap 2px,
   column gap unchanged 8px). Update the B4 comment at `styles.css:684-686` ("fit on ONE line") to say the
   strip wraps to a second line when the five pairs don't fit.

### Step 3 — Node guard for the build the bar now reads (`client/src/sim-core/ship-entity.test.js`, new)

`node --test` cannot load `shop.js` (it imports THREE-bound modules), but `ship-entity.js` is node-loadable
(already imported by `beam.test.js:440`, `step-ally.test.js:19`). Use the real catalog:
`import { buildCatalog } from '../../../server/src/sim-host.js'` (as `step-ally.test.js:20` does);
`const CAT = buildCatalog('level-1');` and pick the player ship row
(`[...CAT.shipByName.values()].find((s) => s.type === 'player')`). Build `active = { ship, loadout: { mounts:
ship.stats.mounts }, components: ship.components, skills }`. Tests:
- `makePlayer` with `skills: { mobility: 5 }` vs `skills: null`: `acceleration` and `turnRate` are exactly
  ×1.25 (`1 + 0.05·5`, `SKILL_RATES.mobilityPct`), `maxSpeedMul === 1.25`, `mass` and `maxHp` unchanged.
- The catalog engine/thruster rows' `stats.power` are unchanged after the skilled build (no mutation —
  read `CAT.components.get(ship.components.engine).stats.power` before and after).
- `PLAYER_MAX_SPEED * p.maxSpeedMul` is `30` with no skills and `37.5` with Mobility 5 (pins the Top speed
  formula the bar uses).
Run: `cd client && node --test`.

### Step 4 — A skill spend rebuilds the flown ship (confirm first, then fix)

**Suspected bug (traced in code, not yet run):** `skillSpend` (`client/src/mainwindow.js:249-259`) only writes
`G.activeShip.progression`. Nothing between the base menu and the fight calls `buildPlayerFor`: `takeOff`
(`mainwindow.js:360-364`) → `enterRoam`; `beginLiveSession` (`main.js:1824-1860`) records
`G.activeShip.progression.skills` but does not rebuild; `reset()` reuses the existing player object. The
player is rebuilt only at login/bootstrap (`account.js:288`, `main.js:2279`), after a landing refresh
(`net.js:271`) and after a shop mutation (`shop.js:486`). So the **first run after a spend flies the old
allocation** while its session trace records the new one — the replay of that run diverges too.

1. **Confirm executably first:** add the Step 6 scenario-11 assertions and run
   `node visual/run.mjs 11-character-progression` **before** the fix. Expected: it fails on
   `__game.player.maxSpeedMul === 1.05` (reads `1`). If it **passes**, the bug is not real — skip the fix,
   keep the assertions as a guard, and say so in the report.
2. Fix (`mainwindow.js`): import `buildPlayerFor` from `./ship-build.js`, and in `skillSpend` after the
   progression write:
   ```js
   if (j.progression && G.activeShip) {
     G.activeShip.progression = j.progression;
     // Skills are baked into the ship at build time (makePlayer) — rebuild so the next take-off flies the
     // points just spent, as applyShopState does after a shop change.
     if (G.activeShip.ship) buildPlayerFor(G.activeShip.ship);
   }
   ```
3. Re-run scenario 11 → green.

### Step 5 — A5: badge style, dead CSS, shared item markup

1. `client/styles.css:711-714`: replace `.bay-item .owned-badge { … }` with
   ```css
   .lp-name .owned-badge {
     font-size: .65em; padding: .1em .55em; border-radius: 1em; white-space: nowrap; vertical-align: middle;
     background: rgba(110,226,154,.15); border: 1px solid rgba(110,226,154,.4); color: #9ff0b8;
   }
   ```
   Move it next to the other `.lp-*` rules (after `.lp-name`, `styles.css:337`) so it doesn't sit inside the
   block being deleted.
2. Delete the dead rules. **Rule:** before deleting each, `grep -rn -- '<selector-word>' client/src
   client/index.html client/visual server/src/admin.js` must return **zero** (all were zero when this plan was
   written; there is no dynamic class-name concatenation for these prefixes). Delete a rule only if **every**
   selector in it is dead. Candidates (line numbers as of this plan):
   - `styles.css:203` `#mw-menu .mw-row`; `:204-208` `.mw-collapse`; `:218-219` `.mw-shop-item` (+ comment);
     `:220-221` `.mw-sublist` / `#mw-missions-group …`; `:222-227` `.mw-sub*`; `:217` `.mw-item.mw-hidden`
     (`mw-hidden` has zero hits).
   - `:230-239` `.bay-tabs` / `.bay-tab*` (+ their comments). **Keep `#mw-loadout-locked` (`:240`) — live.**
   - `:634-646` `.bay-view*`, `.shop-pane`, `.shop-types*` (+ comments); inside the `@media (max-width:760px)`
     block `:647-652` delete only the `.shop-pane` / `.shop-types` lines — **keep `#mw-mission-desc` and
     `#welcome .intro`**.
   - `:661-663` the B2 `body.dev-desktop .mw-shop-item …` rule + its comment.
   - `:690-732` the whole `.bay-item` family (incl. `body.touch #view-shop .bay-item …`) and `:733`
     `.bay-empty-note` (zero hits).
   - `:734-746` the `#view-loadout` / `#view-stash` / `#view-shop` per-screen sizing block + its comment.
   After deleting, re-grep `styles.css` for `bay-item|bay-tab|bay-view|shop-pane|shop-types|mw-sub|mw-row|
   mw-collapse|mw-shop-item|view-loadout|view-stash|view-shop|bay-empty-note|mw-hidden` → zero.
3. Markup helpers in `shop.js` (current copies: `itemInfo` `:321-333`, `shopRow` `:386-394`,
   `renderShopDetail` `:397-417`):
   ```js
   // Name (+ "(owned ×N)" when n.owned > 0) and the stat line — the head of every item block.
   function itemHeader(n) {
     const stats = statLine(n.kind, n.type, n.s, n.weight);
     const owned = n.owned > 0 ? ` <span class="owned-badge">${esc(t('ui.shop.owned', { n: n.owned }))}</span>` : '';
     return `<div class="lp-name">${esc(n.name)}${owned}</div>${stats ? `<div class="lp-stats">${esc(stats)}</div>` : ''}`;
   }
   // The item's 3D model canvas, or a placeholder when it has no glb yet.
   function itemModelSlot(kind, refId) {
     return itemModel(kind, refId)
       ? '<canvas id="shop-model" class="lp-model"></canvas>'
       : `<div class="lp-model lp-model-empty">${esc(t('ui.shop.no_model'))}</div>`;
   }
   ```
   Rewrite the three callers to use them; keep every wrapper/class (`lp-item`, `lp-shop-item`+`new`,
   `lp-detail`, `lp-acts`, `lp-foot`, `data-*` attributes) byte-for-byte.

### Step 6 — Visual scenario guards (run each by name)

- **`client/visual/scenarios/11-character-progression.mjs`** — append after the kinetic spend (`:58-73`; one
  point is left):
  1. Open Loadout (`.mw-item[data-mw="loadout"]`), wait `#ship-stats .stat` count === 5. Read
     `before = { acc: __game.player.acceleration, turn: __game.player.turnRate, msm: __game.player.maxSpeedMul }`.
  2. Open Character, click `.ch-plus[data-skill="mobility"]`, wait
     `__game.activeShip.progression.skills.mobility === 1`.
  3. Open Loadout again, wait 5 stats. Read each stat's **number only** — the `.v` element also contains the
     `▲/▼` delta `<span class="d">`, so read `.v`'s first text node (`v.firstChild.textContent`).
  4. Assert: `__game.player.maxSpeedMul` ≈ 1.05 (|Δ|<1e-9) — **this is the Step 4 regression guard**;
     `__game.player.acceleration` ≈ `before.acc * 1.05` and `turnRate` ≈ `before.turn * 1.05` (rel 1e-9);
     Loadout Accel text === `player.acceleration.toFixed(1)`, Turn === `player.turnRate.toFixed(2)`, Top speed
     === `"31.5"` — i.e. **the Loadout numbers are the flown ship's numbers**. `shot('loadout-mobility')`.
- **`client/visual/scenarios/05-hangar-shop.mjs`**
  - `:50`: `assert.equal(base.stats, 5, 'five live ship-stats are shown (HP / accel / turn / weight / top speed)')`.
  - After `:50`: assert the 5th stat label reads `Top speed` and its value `30.0` (the shared test player has
    no skills spent — verify; if the runner's shared player could carry points, assert
    `=== (30 * __game.player.maxSpeedMul).toFixed(1)` instead).
  - Containment at 1280×800 (`dev-desktop`, ×2 fonts): every `#ship-stats .stat` rect lies inside
    `#ship-stats`'s rect (±1px), and `#ship-stats` lies inside `#mw-ship-col` horizontally.
  - Badge (near `:166`, the Weapon tab already shows an "(owned ×N)" badge): assert its computed
    `background-color` is not `rgba(0, 0, 0, 0)` and its computed `font-size` is smaller than its `.lp-name`
    parent's.
  - Engine tab (`openShopSection('engine')`, `:245`): assert no `.lp-shop-item .lp-stats` text contains
    `Top speed`.
- **`client/visual/scenarios/07-mobile-hangar.mjs`** (already at 760×360 → `dev-phone`): at the **end** of
  the scenario, open Loadout, wait 5 stats, and run the same containment assertion (every stat inside
  `#ship-stats`, `#ship-stats` inside `#mw-ship-col`). `shot('loadout-stats-phone')`.

## Tests

- `cd client && node --test` (new `ship-entity.test.js`; everything else must stay green).
- `cd server && npm test` is **not** needed (no server change).
- Visual, by name only: `cd client && node visual/run.mjs 11-character-progression`, then `05-hangar-shop`,
  `07-mobile-hangar`, and `22-trace-replay` (cheap determinism confirmation — see below). Check
  `lsof -i :4173` first (shared port across worktrees). Needs `npm run assets:pull` for 22. **Do not run the
  full visual suite** — the maintainer's call at the visual gate.

### Replay / intro impact

- `makePlayer` itself is **not modified**; the shop only *calls* it, and it draws no RNG (Decision 1). The sim
  path, `worldDigest` and every recorded trace are untouched → `22-trace-replay` must stay 4 kills + won; it is
  run only as confirmation.
- The skill-spend rebuild changes **live** play only: the first run after a spend now flies the allocation its
  trace records, so those session replays become faithful where they previously diverged. No effect on the
  Level-0 intro (a live fight, DECISIONS §138) or its fixture trace.

## Docs to update

- **`docs/SUMMARY.md`**
  - Hangar shop section, the "live ship-stats panel" sentence (`:2574-2577`): "shows **HP / acceleration /
    maneuverability / weight / top speed** … read from the **real build** (`deriveShipStats(active)` calls
    `makePlayer`, skills included — Mobility raises Accel/Turn/Top speed here exactly as in flight); Top speed
    = `PLAYER_MAX_SPEED × maxSpeedMul`; the strip wraps on narrow columns." Same section `:2559-2561`: the
    owned badge is a green pill (`.lp-name .owned-badge`); engines' stat line shows acceleration only.
  - Device-profiles B4 line (`:2129-2130`): the strip no longer claims "fits on one line" — it wraps.
  - Character progression (`:2216-2222`): add "spending a point rebuilds the ship immediately
    (`skillSpend` → `buildPlayerFor`), and the Loadout stats show the effect".
  - **Combat record/playback (`:637-764`) — genuinely stale, fix in place (verified):**
    (a) `:643-644` "`?record=1&level=1` is the intro four-ship level" → since the 0-based renumbering it is
    `?record=1&level=0` (`replay.js:44-49`); (b) `:655` "**Trace format v3** (`{version:3, …, shipId,
    tickCount, runs}`) … That is the ENTIRE recording" → **v4**: `{version:4, kind, id, level, seed, dt, shipId,
    loadout, components, skills, room, tickCount, runs}` (`replay.js:184-210`), input + seed + the build it was
    flown with (keep the v1/v3 history sentences); (c) the *Storage* bullet (`:740-742`, "Planned: promote
    recordings to an S3 asset") → dev `?record` traces live in `localStorage` + download; **session** traces are
    on S3 and `loadTrace` (`main.js:1744-1752`) falls back to `/recordings/{id}.json` then
    `GET /api/sessions/:id/trace`. Do **not** remove the skills statements (Decision 7).
  - Bump `**Updated:**` (line 6) to 2026-10-22 with a one-line lead.
- **`docs/CHANGELOG.md`** — under `## 2026-10-22` (create it on top): **"Loadout shows the ship you fly"** —
  stats from `makePlayer` (skills included), new Top speed stat, engine speed line removed, skill spend
  rebuilds the ship (first run after a spend used to fly the old allocation and its replay diverged), Owned
  badge styled, ~120 lines of dead CSS removed, shared item header/model markup, replay docs corrected (record
  URL, trace v4 shape, storage).
- **`docs/DECISIONS.md`** — one entry (next free number; §163 at time of writing — re-check for collisions on
  merge): *"The Loadout reads the flown ship, not a re-derivation"* — why `makePlayer` over a narrow
  `applySkillsToDrive` helper (the copy drifted twice; RNG-free; cost is one entity build per render), why Top
  speed shows the pilot cap and not `engine.maxSpeed` (enemy-only), and why the skill spend rebuilds the ship.
- **`docs/plans/2026-10-20-duplication-audit.md`** — mark **A3** and **A5** `**Fixed 2026-10-22**
  (\`2026-10-22-1334-loadout-skill-stats\`)` in the style of A4 (`:117`).
- **`docs/plans/2026-10-20-base-menu-state-and-drift-fixes.md`** — status line (`:3`): Phases 1–3 done; under
  `## Phase 3` add a one-line note that it shipped per this brief (makePlayer, Top speed stat, skill-spend
  rebuild), superseding the `applySkillsToDrive` design.

## Gate (implementer re-runs before handing off)

- `grep -rn "maxspeed\|applySkillsToDrive" client/src client/locales client/visual` → zero.
- `grep -n "resolveComponents\|shipMass\|deriveDrive" client/src/shop.js` → zero.
- Dead-CSS re-grep from Step 5.2 → zero.
- `grep -n "deriveShipStats(" client/src/*.js` → definition + the one `renderBay` call, both with `active`.

## Out of scope / non-goals

- No change to `makePlayer`, the sim, the trace format, or the server.
- No skills in the per-item shop stat line (it describes the item, not the ship); no shield-capacity stat in the
  bar.
- No `?duel`/`?beam` override in the Loadout preview.
- Not removing or softening any "trace must carry skills" statement (Decision 7).
- No restyle of the stats strip beyond `flex-wrap: wrap`; no per-device layout variants.
- SUMMARY's stale "Kinetic +0.5° aim-assist" (`:2218`, gone per DECISIONS §124) is noticed but not part of
  this change unless the implementer is already editing that sentence.
- No full visual suite, no perf gate.
- No CREDITS change (no model/sound touched); no itch re-publish (no content-hashed asset changed).
