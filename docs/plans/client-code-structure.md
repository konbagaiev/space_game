# Client code restructure — split `index.html` into ES modules

**Status:** CORE COMPLETE — the inline `<script>` is fully extracted (slices 0–16 on branch
`refactor/client-esm-split`; **index.html 3736 → 212 lines** = markup + importmap + `import './src/main.js'`).
All game code is buildless ES modules. **Optional follow-up:** peel the UI panels out of `main.js` into
cohesive `mainwindow.js`/`shop.js`/`welcome.js`/`account.js`/`settings.js` (now a mechanical module→module
split — see §0). See **§0 Resume checkpoint** for the current module map; the rest of this brief is the
original plan (kept for reference).

---

## 0. Resume checkpoint (read FIRST if continuing in a fresh context)

**Branch:** `refactor/client-esm-split` (NOT `main` — `main` auto-deploys via CI). `git log --oneline`
shows one commit per slice; CHANGELOG has a matching bullet per slice with the rationale.

**⚠️ The visual suite is FLAKY at baseline — this predates the refactor.** Running
`cd client && npm run test:visual` yields **10 pass / 6 fail** even on a clean checkout. The pre-existing
failures are NOT regressions: `06-pause`, `08-arena-boundaries`, `11-l4-enemies` (test expects boss 450HP,
gets 550 — a real test/balance drift), `12-audio` (music_combat_2 decode), `ship-bank`, `reset-progress`,
and intermittently `10-mission-board` (network/async timing). **The guardrail is: after each slice the
reliably-passing set stays green and failures don't jump to ~all scenarios.** A broken ESM import throws a
`pageerror`, and the runner asserts zero page errors per scenario, so a real break fails *every* scenario at
once — that's the signal, not the 6 steady flakes. Unit suite (`cd client && npm test`) is reliable: 46 pass.

**Per-slice verification loop used so far (keep doing this):**
1. `node --check src/<newfile>.js` — syntax of the new module.
2. Extract + check the inline script:
   `awk '/<script type="module">/{f=1;next} /<\/script>/{if(f)exit} f' client/index.html > /tmp/inline.mjs && node --check /tmp/inline.mjs`
3. `cd client && npm test` (unit) and `npm run test:visual` (compare to the 10/6 baseline above).
4. Re-grep that no stale reference to a moved symbol remains in `index.html`; drop now-unused imports.
5. Commit with a `Client refactor slice N: …` message + a CHANGELOG bullet.

**Done (index.html: 3736 → ~1833 lines, slices 0–15):** `styles.css`, `format.js` (+test), `state.js`,
`engine.js`, `world.js`, `ship-factory.js`, `projectiles.js`, `ship-build.js` (+`buildPlayerFor`),
`sound-routing.js`, `dom.js`, `hud.js` (the four per-frame draws), `net.js` (backend/telemetry), `sim.js`
(the `update` loop + `levelRunner` + wing-bank + warp/OOB + music + pause + `reset`), `tune.js` (the
`?tune` panel), and the G-promotions: `player`/`kills`/`earned`/`balance` (slices 6/9), the back-half
keystone (slice 10) `playerId`/`banked`/`gameStartTime`/`gameStartSent`/`quitSent`/`pendingBriefing`/
`activeShip`/`currentShipName`/`activeMission`, and `gameStarted`/`paused` (slice 13). SUMMARY "Client
module layout" + DECISIONS §31 written.

**UPDATE — slice 16 done: the inline script is fully extracted.** The whole remaining body moved verbatim
into `src/main.js` (paths `./src/x.js`→`./x.js`); `index.html`'s module script is now just
`import './src/main.js';` (212 lines total). Verified: unit 46/46, visual 10/6 baseline, zero page errors.
The mutual-recursion problem below was sidestepped by moving the cluster as ONE file (no module→inline
calls possible when everything is in the same module). **Optional remaining polish:** split `main.js`
(~1620 lines) into `mainwindow.js`/`shop.js`/`welcome.js`/`account.js`/`settings.js` — now mechanical
module→module extraction (ESM runtime cycles are fine), each importing siblings; shared helpers
`deriveShipStats`/`renderShipStatsBar`/`updateTakeoffGate` → `shop.js`. Smoke-test register/login manually
(no visual scenario). The historical analysis below is kept for reference.

**Remaining (historical) = the UI cluster + composition root (the final main.js step).** Still inline: the Main Window
(`showMain`/`selectMenu`/missions/model-viewer/preview/showcase), the hangar shop+stash, the welcome
screen (`showWelcome`/`renderShipCards`/`takeOff`), the account/auth block (+`reloadPlayerWorld`), the
audio-settings modal + i18n UI glue, and the bootstrap/`animate`/`prewarmShaders`/`window.__game` root.
**These are mutually-recursive** (e.g. `mainwindow.selectMenu`→`shop.openBay`; `welcome.renderShipCards`→
`mainwindow.previewShip`; `account.doLogin`→`reloadPlayerWorld`→`mainwindow.showMain`/`welcome.showWelcome`;
the i18n glue re-renders every panel; settings reset reloads the page). A module can't call a function
still in the inline `<script>`, so **they must be extracted together** (one slice), not one-at-a-time —
otherwise the first module that calls a still-inline sibling breaks. ESM tolerates the resulting runtime
import cycles (all calls happen on user actions, never at module-init). Recommended: move the whole
remaining block into modules in one carefully-verified slice — split into `mainwindow.js`/`shop.js`/
`welcome.js`/`account.js`/`settings.js` + `main.js` (bootstrap/animate/`__game`), each importing what it
calls from its siblings — then collapse the inline `<script type="module">` to `import './src/main.js'`
(keep the importmap + the `RoomEnvironment` import in index.html, or move it to the model-viewer module).
Shared helpers `deriveShipStats`/`renderShipStatsBar`/`updateTakeoffGate` are used by both shop + Main
Window (put in `shop.js`, import into `mainwindow.js`). Visual coverage is decent for this cluster
(`05-hangar-shop`, `07-mobile-hangar`, `10-mission-board`, `01-smoke`, `14-reset-progress`,
`97-briefing-showcase`); pure auth register/login has no scenario, so smoke-test those manually.

**⚠️ ORDERING CORRECTION discovered during slice 10 (overrides the original §4 order below):** the back
half is one mutually-recursive blob — `sim` (`update`/`levelRunner`) calls `net` (`bankRun`/`track`/
`unlockNextLevel`), `net` calls `buildPlayerFor` (welcome) + reads `activeShip`, and the UI panels call
`reset()` (sim) + `buildPlayerFor`. So the plan's "sim before net" is wrong: **net must be a module before
sim can import it.** The fix that unblocks everything was promoting the 9 shared scalars to `G` (slice 10,
done) — that removes the *state*-sharing constraint, after which functions can move in any order because
native ESM tolerates runtime import cycles (the only hard rule is: a moved function can't call one still in
the inline `<script>`). Recommended remaining order is now: **`ship-build.js` gets `buildPlayerFor`** (it
already imports `buildPlayer`+`scene`; needs only `G.activeShip`/`G.currentShipName`) → **`net.js`**
(`fetchJson`/`bankRun`/`track`/`currentLevelLabel`/`unlockNextLevel`/`reloadPlayerWorld`) → **`sim.js`**
(`update`/`levelRunner`/`updateBank`/`forwardVec`/`warpPlayerToCenter`/`updateOobWarning` + the pause
cluster + music routing; promote `gameStarted`/`paused` to `G` here) → the UI leaves → `main.js`.

**Slices 11–13 DONE (this carried out the correction above):** `buildPlayerFor`→`ship-build.js` (11);
`net.js` with `fetchJson`/`bankRun`/`track`/`currentLevelLabel`/`unlockNextLevel` (12, `reloadPlayerWorld`
stayed inline — it calls the still-inline `showMain`/`showWelcome`); `sim.js` with `update`/`levelRunner`/
`updateBank`/`forwardVec`/`warpPlayerToCenter`/`updateOobWarning`/`refreshMusic`/`musicForState` + pause
(13), promoting `gameStarted`/`paused` to `G` and moving the overlay/pause/oob nodes into `dom.js`.
**Remaining:** the UI leaves still inline — `reloadPlayerWorld` + funnel listeners, the Main Window /
shop / welcome / account / settings UI, the `?tune` panel — then `main.js` (bootstrap / `animate` /
`prewarmShaders` / `reset` / `window.__game`). These are now mostly mechanical: the shared state is on `G`
and the core fns (`reset` aside) are modules, so each UI module can import what it calls. `reset` is still
inline; extract it (or fold into `main.js`) so the UI flows that call it can become modules, OR move the UI
modules last alongside `main.js`. ESM runtime import cycles are fine — only rule: a moved fn can't call one
still in the inline `<script>`.

**Deviations from the original plan below (intentional, keep following them):**
- **Lazy `G` promotion**, not the upfront 28-var rename in §2.3. A scalar is promoted to `G` only when the
  domain that owns it is split out. **Already on `G`:** `gfx`, `rotated`, `player`, `sky`, `stars`,
  `skyAmbient`, `skySun`, `currentMapDescriptor`, `mapSetpieces`, `arenaDrift`. (`SPAWN_GROW_TIME`,
  `arenaCenter`, `planetPos` are plain exported consts — mutated in place or never reassigned.)
  `kills`, `earned`, `balance` (promoted with the HUD slice — `updateHud` reads them cross-module).
  **Still inline `let`, promote when their slice moves:** `gameStarted`, `paused`, `banked`,
  `gameStartSent`, `quitSent`, `pendingBriefing`, `gameStartTime`, `playerId`,
  `samplesLoaded`, `soundUrls`, `mainBriefing`, `missionOffers`, `activeMission`. (UI-panel-local scalars
  like `shopData`/`bayView`/`accountPlayer` can stay plain `let` and move *with* their single module.)
- **`dom.js` landed with the HUD slice** (slice 9). It holds only the nodes the HUD draws + inline overlay
  flow share: the HUD readouts (`earned`/`credits`/`kills`/`enemies`/`hpFill`/`hpPct`/`rocketBtn`/
  `rocketFill`/`perf`/`markers`/`minimap`) and the result `overlay`. `overlayTitle`/`overlaySub`/`restart`/
  `back-hangar` stayed inline `const`s (written by the death/win/restart flow that moves with sim).
- **HUD slice = the four pure draws only** (`updateHud`/`updateMarkers`/`updateMiniMap`/`updatePerf`).
  `setPaused`/`togglePause`/`autoPauseOnBlur` + `updateOobWarning` stayed inline — they call `refreshMusic`
  and read `levelRunner`, which are inline until the sim slice. Moving them now would force a module→inline
  import (impossible). They move WITH sim.
- `levelRunner` stayed inline in slice 8 (its methods close over loop state) — it moves WITH the sim slice.
- `sound-routing.js` holds only `audio` + `tracksFor`/`sfxFor`; `musicForState`/`refreshMusic`/
  `tryUnlockAudio` stayed inline (they read live loop state — `gameStarted`/`paused`/`levelRunner`).

**Remaining (the coupled back half), recommended order:**
1. ✅ **DONE — `hud.js` + `dom.js`** (slice 9). Only the four pure draws moved; pause/OOB/music stayed
   inline (see deviations above).
2. **`sim.js`** — `update(dt)` (~315 lines) + `forwardVec`/`warpPlayerToCenter`/`updateBank` **and
   `levelRunner`**, **plus the pause cluster** (`setPaused`/`togglePause`/`autoPauseOnBlur`/`updateOobWarning`)
   and the music routing (`musicForState`/`refreshMusic`/`tryUnlockAudio`) that couple to it. Promote
   `gameStarted`/`paused`/`activeMission` to `G` here (`kills`/`earned`/`balance` already on `G`). Move the
   remaining overlay nodes (`overlayTitle`/`overlaySub`/`restart`/`back-hangar`) into `dom.js`'s `el` as the
   death/win flow moves. Imported only by `main`. This unblocks `reset()`, which the UI flows call.
3. **UI leaves** (each fairly self-contained once `reset`/`buildPlayer` are importable): `net.js`,
   `settings.js`, `account.js`, `welcome.js`, `mainwindow.js`, `shop.js`, `tune.js`.
4. **`main.js`** — bootstrap/`animate`/`prewarmShaders` + the `window.__game` assembly (still `?debug`-gated,
   reading live `G`/arrays). Collapse the inline `<script type="module">` to `import './src/main.js'`. Keep
   the importmap + the inline `RoomEnvironment` import → actually move that with the model viewer to
   `mainwindow.js`.

**Test contract (unchanged, never break):** `window.__game` exposes `.player`, `.enemies`,
`.missionOffers`, `.activeMission`, `.levelRunner`, `.spawnEnemy`, `.spawnEnemyShip`, `.spawnShipExplosion`,
`.emitExhaust`, `.reset`, `.arenaCenter`, `.arenaBorder`, `.warpPlayerToCenter`, etc. — keep its getters
reading live `G`/arrays so values stay live.

---

### Original plan (below) — still the spec for the remaining slices

**Status:** plan only (no code changes yet).
**Goal:** Break the ~3500-line inline `<script type="module">` in `client/index.html` into
cohesive, browser-loaded ES modules under `client/src/`, **without a bundler** and **without any
behavior change**. Do it **incrementally**, one safe slice per commit, each verified by the existing
visual + unit suites before the next.

**This is a readability/maintainability refactor, performance-neutral by design** — it is *not* a speed
optimization. No slice should change FPS, load time, or behavior; the visual baselines are the guardrail
(they must match byte-for-byte). Do not "optimize while you're in here" — keep each slice a pure move.

This brief is self-contained: an executing agent can follow it without the planning conversation.

---

## 1. Why / current state

`client/index.html` is 4296 lines, three layers fused into one file:

| Layer | Lines (as of this plan) | Size |
|---|---|---|
| `<style>` CSS | 10–571 | ~560 |
| `<body>` markup | 573–759 | ~185 |
| inline `<script type="module">` | 769–4294 | **~3525** |

Already extracted and unit-tested (the good part): `src/audio.js`, `components.js`, `graphics.js`,
`i18n.js`, `steering.js` (~580 lines of pure logic). **Everything else — ~115 functions — lives in the
one inline closure.**

The inline script is **already sectioned** by stable comment banners
(`// ---------- Ship factory ----------`, `// ---------- Rockets (homing) ----------`, …). These
banners are the natural module seams and the **stable anchors** for this work — prefer grepping for the
banner text over citing line numbers, which shift as slices land.

**Hard constraint — no build step.** The client is served as plain static files
(`server/src/server.js:349` → `express.static(clientDir)`); `three` is resolved by the **importmap**
in `index.html` (lines 760–767); `src/*.js` are native ES modules the browser loads by relative path.
Decision (confirmed with maintainer): **stay buildless** — split into native ESM, no Vite. `three`
keeps coming from the CDN importmap; new modules `import * as THREE from 'three'` and the browser
resolves it through the same importmap.

**Test contract that must never break:** the `window.__game` object (built at index.html:3648, inside
the `?debug` guard) is the surface the Playwright visual suite drives. The consumers (grepped from
`client/visual/`): `__game.player`, `.enemies`, `.itemShowcaseTarget`, `.previewTarget`,
`.missionOffers`, `.audio`, `.spawnEnemy`, `.setPieces`, `.oobWarnVisible`, `.levelRunner`,
`.warpPlayerToCenter`, `.arenaCenter`, `.activeMission`, plus `scene/bullets/rockets/...`. After every
slice, this object must expose the exact same live values.

---

## 2. The core problem: shared mutable state across module boundaries

The functions are easy to group; the hard part is the **module-level state** they all touch. Native
ESM (buildless) has one rule that dictates the whole pattern:

> An exported `const` (array/object) is **shared by reference** across modules — mutating its contents
> works everywhere. An exported `let` (scalar) is a **live read-only view** in importers — you can read
> the latest value but **cannot reassign it** from another module.

So adopt this pattern (the keystone of the whole refactor):

1. **Engine singletons** → `const`, created once in `engine.js`, exported directly:
   `renderer`, `scene`, `skyScene`, `camera`, the lights (`sun`, `combatAmbient`), `gltfLoader`.
2. **Entity collections** → exported `const` arrays/Maps in `state.js`, mutated in place everywhere:
   `bullets`, `enemies`, `rockets`, `explosions`, `sparks`, `shockwaves`, `trail`, `smoke`,
   `setPieces`, `moons`, `CATALOG`, `levelRunner`, `keys`, `touchAim`, `soundMap`.
3. **Reassigned scalars** → a single mutable **state bag** `export const G = { … }`; write `G.player = …`
   instead of `player = …`. These are the values that get reassigned and therefore *cannot* be plain
   exported `let`. From the current top-level scan they are:
   `player`, `rotated`, `gfx`, `sky`, `stars`, `rocks`, `skyAmbient`, `skySun`, `currentMapDescriptor`,
   `mapSetpieces`, `arenaDrift`, `camZoom`, `camZoomTarget`, `banked`, `activeMission`, `gameStartSent`,
   `quitSent`, `pendingBriefing`, `gameStartTime`, `playerId`, `samplesLoaded`, `starGlowTexture`,
   `mainBriefing`, `missionOffers`, `earned`, `balance`, `kills`, plus the viewer handles
   `mwPreview`/`mwItem`.
   (Constants that are never reassigned — `ARENA`, `CAM_OFFSET`, `OOB_WARN_DELAY`, `SHIP_MODEL_LEN`,
   the geometries like `bulletGeo` — stay plain exported `const`.)
4. **DOM refs** → the inline script touches ~88 elements by id, but only **33 are cached** at top level
   (`const elEarned = getElementById('earned')`); the other **55 are inline lookups** scattered inside
   functions and listeners (`getElementById('mw-view-bay').classList.toggle(…)`). This is **not** a perf
   problem (`getElementById` is a cheap hash lookup) — it's a **coupling/fragility** problem that bites
   exactly when splitting into modules:
   - each inline `getElementById('foo')` is a **hidden dependency on `index.html` markup** — once `renderBay`
     moves to `shop.js`, nothing declares that it needs `#mw-view-bay`/`#bay-credits-val`/`#mw-bay-note`;
   - the ids are **stringly-typed with no single inventory** — a typo or a renamed id fails **silently at
     runtime** (`getElementById` → `null` → either a thrown `.classList` or a no-op).

   **Fix — one `dom.js` as the single inventory**, with a **fail-loud** accessor so a missing id surfaces
   on boot instead of silently:
   ```js
   // src/dom.js
   const byId = (id) => {
     const n = document.getElementById(id);
     if (!n) throw new Error(`dom.js: missing #${id} in index.html`);
     return n;
   };
   export const el = { earned: byId('earned'), bayView: byId('mw-view-bay'), /* … */ };
   ```
   Safe buildless: `<script type="module">` runs **after** the body is parsed (module defer semantics),
   so every node exists when `dom.js` evaluates.

   **Scope — don't try to eliminate all 88.** Put in `el` the nodes read from a hot path or from more than
   one module (HUD nodes, overlays, the bay views) — roughly ~40–50 of them. Leave **one-shot boot wiring**
   (`getElementById('takeoff').addEventListener('click', takeOff)`) as-is, moved into its module's `init()`
   beside the rest of that module's wiring. The goal is *one inventory + local wiring*, not a node registry
   for every listener.

`window.__game` is then assembled in the final composition root (`main.js`) by importing the live
`G`, the arrays, and the functions — its getters (`get player(){ return G.player }`, etc.) read the bag
so they stay live.

---

## 3. Target module layout (the destination — reached gradually)

```
client/
  index.html          # <head> + importmap + <link rel="stylesheet" href="styles.css">
                      # + <body> markup + <script type="module">import './src/main.js'</script>
  styles.css          # extracted from <style>
  src/
    # existing pure + tested (unchanged)
    audio.js  components.js  graphics.js  i18n.js  steering.js   (+ *.test.js)

    # new foundation
    engine.js         # renderer, scene, skyScene, camera, CAM_OFFSET, lights, RoomEnvironment PMREM,
                      #   orientation (gameW/gameH/toGame/applyOrientation/rotated), zoom (setZoom/zoomBy/tickZoom),
                      #   resize wiring
    state.js          # entity arrays + Maps + CATALOG + levelRunner + keys/touchAim + the G scalar bag
    dom.js            # cached element refs

    # domains (one banner-group each)
    sound-routing.js  # tracksFor/sfxFor/musicForState/refreshMusic/tryUnlockAudio/preload glue
    world.js          # makeStars/makePlanetTexture/makeMoon(s)/makeAsteroids/setpiece builders/buildMap/arenaBorder
    ship-factory.js   # shipModelCfg/modelSpec/applyShipModel/makeShip
    ship-build.js     # resolveWeapon/Components/buildMounts/buildGroups/buildPlayer/spawnEnemy(Ship)/fireMount/updateGroups
    projectiles.js    # spawnBullet/spawnExplosion/spawnShipExplosion/spawnTrail/emitExhaust/spawnRocket/detonateRocket/spawnSmoke/findTargetInSector
    sim.js            # forwardVec/warpPlayerToCenter/updateOobWarning/updateBank/update(dt)
    hud.js            # updateHud/updateMarkers/updateMiniMap/updatePerf/setPaused/togglePause/autoPauseOnBlur
    mainwindow.js     # showMain/selectMenu/missions/model-viewer helpers/preview/showcase/launchCampaign/launchMission
    shop.js           # bay/loadout/stash/shop/ship-stats panel/shopAction/openBay
    welcome.js        # showWelcome/renderShipCards/buildPlayerFor/takeOff
    net.js            # fetchJson/playerId/track/bankRun/unlockNextLevel/reloadPlayerWorld
    account.js        # auth block (register/login/logout/verify/account bar)
    settings.js       # settings modal + quality + audio change + reset-progress slider + i18n UI glue
    tune.js           # ?tune palette panel (already dynamically imported)
    main.js           # composition root: bootstrap(), event wiring, prewarmShaders, animate, window.__game
```

Dependency direction (must stay acyclic): `main` → domains → (`ship-build`, `projectiles`, `world`,
`hud`, `sim`) → (`ship-factory`, `sound-routing`) → (`engine`, `state`, `dom`) → (`three`, the existing
pure modules). **Leaves never import the loop.** `sim.update` and `hud` touch almost everything, so they
sit *high* (imported by `main`/`loop`), importing the leaves — never the reverse. If a genuine cycle
appears (e.g. `ship-build` needs something from `sim`), pass it as a parameter or lift the shared piece
into `state.js`.

---

## 4. Incremental slice sequence (one commit each)

Each slice: **move code, change nothing behavioral, re-grep that no stale reference remains, run both
suites, commit.** Keep `index.html`'s inline script as the **composition root** until the very last
slice — peel modules off it one at a time and `import` them back in.

### Slice 0 — CSS out (proves the buildless multi-file path; zero JS risk)
- Move `<style>…</style>` (index.html:10–571) verbatim into `client/styles.css`.
- Replace with `<link rel="stylesheet" href="styles.css">` in `<head>`.
- `server/src/server.js` already serves the whole `clientDir` statically, so `styles.css` is served with
  no server change. Confirm the visual baseline is byte-identical (it's the same CSS).
- **Verify:** `npm run test:visual` — all screenshots match. Commit.

### Slice 1 — pure stateless helpers (proves cross-module import in the browser; tiny diff)
- New `src/format.js`: `esc`, `slotLabel`, `priceLabel`, `sellLabel`, `cssColor`, `mountSummary`,
  `shipHullHp` (pure string/number helpers, no shared state).
- New `src/sound-routing.js`: `tracksFor`, `sfxFor`, `musicForState`, `refreshMusic`, `tryUnlockAudio`
  — these read `soundMap`/`soundUrls`/`audio`/`G`, so they take those as imports once `state.js` exists;
  **if doing this before Slice 2**, keep `sound-routing` reading a passed-in object, or defer it to after
  Slice 2. Simplest: do `format.js` here, fold `sound-routing` into Slice 2.
- `import` them at the top of the inline script; delete the inline definitions.
- **Verify:** unit + visual. Commit.

### Slice 2 — foundation: `engine.js` + `state.js` + `dom.js` (the keystone)
This is the highest-leverage slice; once it lands, every later slice is a cheap move.
- `state.js`: declare and `export const` every entity array/Map + `CATALOG` + `levelRunner` +
  `keys`/`touchAim`, and `export const G = { … }` with the reassigned scalars from §2.3 (initialize to
  their current defaults). **Mechanical edit in the inline script:** replace each bare reassignment
  `player = x` → `G.player = x`, `rotated = …` → `G.rotated = …`, etc. (grep each name; there are ~28).
  Reads can stay `G.player` or destructure locally where hot.
- `engine.js`: move the renderer/scene/skyScene/camera/lights/PMREM creation, the orientation block
  (`gameW`/`gameH`/`toGame`/`applyOrientation`/`rotated`→`G.rotated`), and the zoom block
  (`setZoom`/`zoomBy`/`tickZoom`/`camOffset`). Export the singletons + functions. Keep the
  `addEventListener('resize'/'orientationchange', applyOrientation)` wiring either here (runs at import)
  or in `main` — pick one and be consistent.
- `dom.js`: build the `export const el = { … }` inventory via the fail-loud `byId` accessor per §2.4 —
  move the 33 cached refs (the `const elEarned = …` block at ~index.html:1520+) plus the inline-lookup
  nodes read from a hot path or >1 module; leave one-shot boot wiring inline in its module's `init()`.
- Inline script now imports from all three. **Verify carefully** — this slice touches init order. Watch
  for temporal-dead-zone errors (a module used before its top-level init runs): keep side-effectful
  setup (DOM append of `renderer.domElement`, event listeners) in functions called by the existing boot
  flow, not scattered at module top-level, unless the import order already guarantees it.
- **Verify:** full visual suite (esp. `01-smoke`, `15-mobile-landscape` for orientation, zoom in any
  combat scenario). Commit.

### Slices 3–N — peel one domain per commit (leaf-first)
Order by dependency depth (fewest inbound edges first), re-running both suites each time:

3. **`world.js`** — stars/planet/moons/asteroids/setpieces/`buildMap`/`arenaBorder`. Touches
   `scene`/`skyScene` (engine) + `G.sky/stars/rocks/moons/setPieces/mapSetpieces` (state). Visual check:
   `09-mission-setpieces`, `08-arena-boundaries`.
4. **`ship-factory.js`** — `shipModelCfg`/`modelSpec`/`applyShipModel`/`makeShip`. Visual: `01-smoke`,
   `11-l4-enemies`.
5. **`projectiles.js`** — bullets/explosions/trail/exhaust/rockets/smoke + `findTargetInSector`. Visual:
   `02-ship-explosion`, `03-exhaust-trail`, `04-combat`.
6. **`ship-build.js`** — catalog resolution + `buildPlayer`/`spawnEnemy(Ship)`/mounts/groups/`fireMount`/
   `updateGroups`. Visual: `04-combat`, `11-l4-enemies`.
7. **`sim.js`** — `update(dt)` (the ~318-line loop) + OOB/warp/bank/`forwardVec`. Imports many leaves;
   imported only by `main`. Visual: `04-combat`, `08-arena-boundaries`, `13-ship-bank`.
8. **`hud.js`** — HUD/markers/minimap/perf/pause. Visual: `06-pause`, plus HUD asserts in others.
9. **`net.js`** — `fetchJson`/`playerId`/`track`/`bankRun`/`unlockNextLevel`/`reloadPlayerWorld`.
10. **`shop.js`** — bay/loadout/stash/shop/ship-stats. Visual: `05-hangar-shop`.
11. **`mainwindow.js`** — Main Window/menu/missions/viewers/preview/showcase. Visual: `07-mobile-hangar`,
    `10-mission-board`, `97-briefing-showcase`.
12. **`welcome.js`** — welcome screen + ship cards + `takeOff`. Visual: `01-smoke`.
13. **`account.js`** — auth block. (No dedicated visual scenario; smoke-check the account bar renders.)
14. **`settings.js`** — settings/quality/audio/reset-progress slider/i18n glue. Visual: `12-audio`,
    `14-reset-progress`.
15. **`tune.js`** — already dynamically imported under `?tune`; finish moving its body out.

### Final slice — composition root
- What remains of the inline script becomes **`src/main.js`**: `bootstrap()`, the event wiring,
  `prewarmShaders`, `animate`, and the `window.__game = { … }` assembly (still under the `?debug` guard,
  reading `G` + arrays + functions so the test contract holds).
- `index.html`'s `<script type="module">` collapses to a single line: `import './src/main.js';`.
- The importmap stays in `index.html` (it must, so the browser resolves `three` for every module).
- **Verify:** full unit + visual suite. Commit.

---

## 5. Per-slice verification checklist
1. `cd client && npm test` (unit) — and **add/extend unit tests** for any function that became pure and
   importable during the move (e.g. `format.js`, `sound-routing.js`) so coverage grows with the split.
2. `cd client && npm run test:visual` — all baselines match (no behavior change is the whole point).
3. `grep -n "<old-symbol>" index.html` — confirm no stale reference to a moved definition remains in the
   inline script.
4. Manual smoke once (start → fight → die/win → Main Window → shop) since some flows have no dedicated
   visual scenario (account bar, settings).

---

## 6. Risks & how this plan avoids them
- **Circular imports / init-order (TDZ).** Mitigated by the strict dependency direction in §3 (leaves
  never import the loop) and by keeping side-effectful init in boot-called functions, not module-top
  statements. If a cycle is unavoidable, lift the shared piece into `state.js`.
- **Silent breakage of the test hook.** Mitigated by assembling `window.__game` from the live `G` + the
  shared `const` arrays, and by running the visual suite every slice — the suite *is* the contract.
- **`let`-reassignment-across-modules trap.** Pre-empted by the `G` bag (§2.3): never export a reassigned
  scalar as a bare `let`.
- **Many small `<script>`/import requests (no bundler).** Acceptable: it's all same-origin over HTTP/2,
  and the modules are small. `three` is one CDN fetch as today. If startup latency ever regresses
  measurably, revisit Vite then — not now.
- **Big-bang regression.** Avoided by construction: incremental slices, each independently green and
  committed, so a regression is bisectable to one small diff.

---

## 7. Docs to update (per the project docs workflow)
- **CHANGELOG.md** — a bullet per slice under today's date (this is infra/refactor work — exactly the
  kind that slips past the docs, so be explicit). Lead with the bold summary, note "no behavior change".
- **SUMMARY.md** — update the "Visual model" wording at the current "the visual-model rendering lives in
  `client/index.html`" line and any other "lives in `index.html`" references to point at the new module
  (`ship-factory.js`, `world.js`, …) as each slice lands. Keep the file matching reality.
- **DECISIONS.md** — one new entry: *"Client split into native ES modules, no bundler"* — record the
  buildless choice (importmap-resolved `three`, static-served `src/*.js`), the `G`-state-bag pattern, and
  why Vite was declined (no build step in deploy/CI; project ethos of plain static hosting). Reference
  this plan.
- **adding-a-ship-model.md** / **ship-model-config.md** — they point at `index.html` for `applyShipModel`
  / `makeShip` / `stats.model`; repoint to `src/ship-factory.js` after Slice 4.

---

## 8. Resolved decisions (do not re-ask)
- **Bundler?** No. Stay buildless; native ESM resolved by the existing importmap. (Maintainer, this plan.)
- **Rollout?** Incremental, one safe slice per commit, suites green between each. (Maintainer, this plan.)
- **Shared state?** Exported `const` for collections/singletons; a single `G` bag for reassigned scalars;
  `dom.js` for cached element refs. (§2.)
- **Where does `window.__game` end up?** In `main.js`, still `?debug`-gated, reading live `G`/arrays. (§4 final.)

## 9. Open questions (decide during execution, low stakes)
- Split `<body>` markup out of `index.html` too? Probably not worth it (HTML has no logic and no reuse);
  leave it in `index.html`. Revisit only if it gets in the way.
- `format.js` vs folding helpers into their one consumer — start with a shared `format.js`; inline later
  if a helper turns out single-use.
- Keep `loop.js` separate or fold `animate`/`prewarmShaders` into `main.js`? Fold into `main.js` unless it
  grows.
