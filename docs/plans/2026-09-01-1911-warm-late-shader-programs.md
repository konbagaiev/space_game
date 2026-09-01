# Finish the level-start warm — nothing may compile after the veil drops

**Status: BUILT 2026-09-01.** Investigation was done first (headless) — the late programs are **named**
below, so this was a fix, not a search. Source brief: `docs/plans/level-start-warm-incomplete.md`.

**One deviation from the plan as written, decided by the maintainer during the build — Step 7a's assertion 4.**
The plan asked for whole-fight `geometries`/`textures` equality. Measured, that assertion cannot pass, for a
cause that is **pre-existing and outside this change**: three surfaces still upload buffers during play — ship
hull geometry (`warmModel` compiles and `initTexture`s a template but never DRAWS it, and unparents it on the
way out), `rocketGeo` (`projectiles.js:296`), and the explosion FX quads (`flipbook-fx.js:144`,
`projectiles.js:150`). Identical before and after this change: **+6 geo / +3 tex before, +8 geo / +4 tex after**
(the composition differs only because the emergent fight produced kills in one run and not the other). Per the
hard-zero rule the implementer stopped and reported rather than widening; the maintainer's ruling was to
replace the whole-fight total with a **per-surface, deterministic** assertion — "spawning a drop uploads 0
geometries and 0 textures", "an absorbed hit uploads 0" — and to PRINT the whole-fight totals as a logged
measurement, never asserted. A whole-fight total measures surfaces this change does not own and is run-to-run
fragile for exactly that reason. Assertions 1-3 shipped exactly as specified. The residual has its own brief:
**`docs/plans/warm-geometry-buffer-uploads.md`** (unbuilt, not scheduled) — read its §3 before touching the FX
warm rig, which carries **stand-in** geometries rather than the ones the real effects draw.

---

## Goal

At level start the game raises a veil ("Preparing the sector...") and compiles the level's shaders behind
it. The warm is incomplete: `renderer.compile()` only reaches what is in the scene *at that moment*, so a
handful of materials still compile **after the veil drops, in front of the player** — measured on a real
phone as 204 ms and 66 ms main-thread blocks while the live program count climbed 32 → 42 (see the source
brief §2; those numbers are given, do not try to re-derive them). This change warms the surfaces that were
missing — the **loot crate, its halo sprite, the grab pull-line, and the player/enemy shield bubbles** —
plus the level's **reward drop model** and the **ghost battle's transparent hull variant**, so that after
the veil drops the program count stops growing. The player-visible effect: the first loot drop, the first
absorbed hit, the last kill of a level and the distant ghost skirmish appearing all stop hitching. No
gameplay, balance or visual change of any kind.

The headless probe below names four of the phone's ten late programs. The ghost battle (Step 5b) is the
likeliest source of much of the rest, and it is **invisible to the visual suite by construction** — `?debug`
disables ghosts — so it is fixed by the same mechanism and verified on the phone, not by a test. Say that
plainly wherever this change is reported; do not let a green suite stand in for the phone's number.

---

## What was measured (do not re-derive; do re-verify with the guard)

Method (this is also what the new guard scenario does): boot with `?debug`, take off, wait until
`needsSceneWarm === false && pendingAssets === 0 && !#levelwarm.on`, snapshot the set of
`renderer.info.programs[].cacheKey`, then drive the sim with `__game.stepSim(n)` **plus an explicit
`renderer.render(skyScene)/render(scene)` after each chunk** — compiles happen on **draw**, so stepping
alone finds nothing — and diff the key set. Each new key is attributed back to a live material with
`renderer.properties.get(material).currentProgram`.

Result, `level-0`, graphics tier `high` (the headless default — the same tier the phone was on, so the
16-light `NUM_POINT_LIGHTS` baked into every lit shader matches): **programs 33 → 37, geometries 35 → 41,
textures 30 → 33.** Every late program was a loot-drop or shield surface:

| late program | material | where it comes from |
|---|---|---|
| `physical,STANDARD,…` | `MeshStandardMaterial` on `Cube` | the shared **loot-crate template** — `client/src/drops.js:34` loads `DROP_MODEL_URL` at module import, never puts it in the scene and never compiles it; the first drop is its first draw |
| `sprite,…` | `SpriteMaterial` | the drop **halo** (`addHalo` / `ensureHaloTexture`, `client/src/drops.js:126-144`) |
| `basic,…131075` | `LineBasicMaterial` | the **grab pull line** (`ensureLine`, `client/src/drops.js:254-264`), created on the first Grab |
| `8,9,…` (`ShaderMaterial`) | shield bubble | `client/src/shield-fx.js` — the player bubble (`ensureBubble`, built on the first absorbed hit) and the pooled enemy bubbles (`makeEnemySlot`) share **one** program (identical shader source, `shield-fx.js:71-72`) |

**Why a headless diff works at all**, given DECISIONS §83's "software WebGL … compiles almost everything at
bootstrap": the visual suite runs with `?debug`, and the **bootstrap** prewarm is explicitly skipped under
that flag (`client/src/main.js:2134`), so nothing is pre-compiled at boot. The **per-level** warm at
`main.js:1148-1166` is not skipped and is what produces the 33-key baseline. And a program cache key is
decided by three.js from **material parameters**, so which keys appear after the veil that were not there
before is backend-independent — even though the wall-clock stall those compiles cause is not reproducible
here. Be precise about the scope of that claim: `getProgramCacheKeyParameters` also pushes `precision` and
`outputColorSpace`, which are capability-derived, so the absolute key *strings* are not portable between
backends. **The diff is portable; the set is not.** (§83's sentence about this is wrong as written and is
corrected in the docs list below.)

Ruled out **by measurement, not assumption**: `spawnShipExplosion` compiled **+0** (DECISIONS §83's
keep-alive rig still holds) and enemy hulls compiled **+0** (`preloadLevelShipModels` → `warmModel` already
covers them). The point-light pool is fixed at module load (`client/src/engine-lights.js:63-78`), so this is
**not** a `NUM_POINT_LIGHTS` mass-recompile.

Found by reading, not yet measured: `preloadRewardModel` (`client/src/drops.js:176`) fetches and parses the
level's last-kill reward `.glb` at level start but — unlike `requestShipModel`, which calls `warmModel` —
never compiles or uploads it. Its materials therefore compile on their first draw, i.e. **on the final kill
of the level**.

---

## Decisions (already made — do not re-open)

1. **The reward `.glb` joins `G.pendingAssets`** (the veil waits for it), consistent with DECISIONS §84. If
   it has not landed by `WARM_MAX_WAIT_MS`, it is compiled best-effort **when it arrives** and never blocks
   past the cap. `WARM_MAX_WAIT_MS = 9000` stays exactly as it is.
2. **The guard threshold is HARD ZERO** — zero new shader programs after the veil drops, and stable
   geometry/texture counts, across the probed window. **If something turns out to be genuinely un-warmable,
   the implementer REPORTS it to the maintainer with the exact counts and the cause and waits for a
   decision. The implementer does not widen the assertion on its own, and does not add a tolerance
   constant.** This rule is not negotiable and is the reason the scenario prints the offending `cacheKey`
   on failure. It is reserved for genuine **surprises**: the residuals this plan already understands are
   named and closed in Step 5, so "stop and ask the maintainer" should not be reached for anything the plan
   has already accounted for.
3. **The committed guard covers `level-0` only.** Do not build a level-4 scenario, and do not add one for
   any other level. (A by-hand sanity check on another level is fine; it is not a deliverable.)
4. **Ship on the headless evidence**, and add a one-line `?debug` helper (`__game.programKeys()`) so the
   maintainer can dump the phone's real list in seconds if a gap remains.
5. **Warm the REAL object, not a look-alike.** Wherever the surface is a singleton that already lives in
   `scene` (the pull line, both shield bubbles), the fix simply **creates it earlier** instead of building a
   stand-in. This is what guarantees the warm compiles the same program key the live draw will use (see
   "Failure mode (a)" below), and it satisfies §83's keep-alive rule for free.

### Caveat the maintainer should see (does not change decision 1)

`modelUrlHigh` — the reward drop's model — is a **cross-origin CloudFront** URL
(`https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/…`, `server/src/catalog_seed.js:32-33, 88, 231`), not a
same-origin `assets/` file like the ship models. So the marginal veil cost is not automatically ~0 on a cold
load: it carries its own DNS/TLS on first contact. It is still bounded by the existing 9 s cap, it is 0 on a
warm cache (`immutable`, §78), and it is not fetched at all when the player already owns the reward
(`ownsReward` gate, `client/src/sim.js:476`). This is the same trade §84 already accepted for set-pieces —
noted here only because it is new information relative to the "it is concurrent with the ship preloads"
rationale.

---

## The four failure modes this plan must close

### (a) The warm must compile the SAME program key the live draw will use

A program key depends on the render state at compile time — lights, fog, `scene.environment`, tone mapping,
the object type. Warming a material in a throwaway scene or before the level's lights exist compiles a
**different** program; the count still grows and every test that merely counts `compile()` calls passes.

How this plan guarantees key equality:

- **Verified in the three.js source** (r160, pinned in `client/index.html:308`): `renderer.compile(scene,
  camera)` gathers lights with `targetScene.traverseVisible` but walks materials with **`scene.traverse`** —
  *not* `traverseVisible`. **An object with `visible === false` in the scene IS compiled.** That is what makes
  "create the real singleton early and leave it invisible" a correct warm.
- Every new warm runs **inside `prewarmShaders()`**, i.e. in the level-warm frame, when the level's lights,
  fog and set-pieces are already in `scene` — never at page load and never from a `.glb` callback that could
  fire while the menu scene is up.
- The halo sprite is built by calling **`addHalo()` itself**, the same constructor a live drop uses, so
  `map`/`fog`/`transparent` are identical. The per-drop `color` is a uniform and does not enter the key.
- The crate and reward templates go through the **existing `warmModel()`** (`client/src/ship-factory.js:110`),
  which parks the object in the **real** `scene` before compiling — the mechanism DECISIONS §79/§83 already
  rely on for ship hulls. Step 2b then leaves them parked, because `warmModel` unparents on the way out
  (`ship-factory.js:123-124`) and an unparented template can never be drawn — which is what Step 5 needs.
- **The acceptance step is an attribution check, not a call count.** The guard scenario reads
  `renderer.properties.get(material).currentProgram.cacheKey` for every live drop / halo / line / bubble
  material and asserts it is a member of the **baseline** key set captured at veil-down, after first
  asserting that each of those surfaces was actually **found** (Step 7a). A warm that compiled the wrong key
  fails there, by name; a scene that lost the object fails before that, instead of passing vacuously.

### (b) The warmed programs must never be freed again (DECISIONS §83)

THREE frees a program when its **last** material is disposed. Per surface:

| surface | lifetime | verdict |
|---|---|---|
| crate template materials (`normalize`, `drops.js:38-66`) | module-level `template`, never disposed; every drop is `template.clone(true)` and clones **share** the materials | safe — the template is the permanent holder |
| drop halo `SpriteMaterial` (`addHalo`) | a **fresh** material per drop; `detachDropBody` (`drops.js:221-225`) only does `scene.remove` — **no `dispose()`** | safe today, but nothing *guarantees* it. Step 2 adds one permanently-parked halo sprite whose material is never disposed → an explicit keep-alive holder, exactly the `warmRig` pattern at `main.js:791-808` |
| pull line `LineBasicMaterial` (`ensureLine`) | one pooled `THREE.Line`, `visible=false` when idle, never disposed | safe — and Step 2 makes it exist from the warm on |
| shield bubble `ShaderMaterial` (player + pooled enemy slots) | created once, added to `scene`, hidden by `visible=false`; `clearEnemyShieldBubbles` (`shield-fx.js:209-216`) explicitly **keeps** the meshes on reset | safe — the module comment already states pooling is deliberate |
| reward template materials (`normalizeGreen`) | held by `rewardModelCache` (`drops.js:158`), never disposed | safe |
| `greenFallbackBox()` material (`drops.js:114-121`) | **is** disposed at `drops.js:240` when the real model arrives | **deliberately NOT warmed.** It only appears on the "reward glb has not landed yet" path; warming it would *add* a program that otherwise never exists, and it is disposed by design. Same for `fallbackBox()` (`drops.js:136-140`), which is the "crate glb failed" path. Do not warm either. |

Net: no new dispose call is introduced anywhere, and every newly warmed program has a permanent holder.
Step 2b strengthens two of these rows further by parenting the crate and reward **templates** into the
permanent `dropWarmRig` — they were already safe by virtue of the module-level caches that reference them,
but a parked object is a holder you can see in the scene graph (and, per Step 5, one that can be drawn).

### (c) Be honest about the veil-length cost, and bound it

The veil gate is the bare `return` at `client/src/main.js:1162`, which sits **below** `update(dt)` at
`client/src/main.js:1110` — so every frame the veil holds is still a **simulated** frame. Holding it longer
changes the number of sim ticks before the player gets control. Verified facts:

- **The two preloads are concurrent, not sequential.** `world.host.onWarmLevel(level)` (`client/src/sim.js:472-478`)
  calls `preloadLevelShipModels(level)` and, on the very next line, `preloadRewardModel(lkd)`. It is invoked
  from `sim-core/level-runner.js:85` inside `startRun()`, i.e. in the **same synchronous `reset()`** that sets
  `G.needsSceneWarm = true` (`client/src/sim.js:750`), before any frame runs. **No ordering fix is needed** —
  both fetches start in the same tick, so the marginal veil extension is only the amount by which the reward
  glb is slower than the slowest ship model (modulo the cross-origin caveat above), and is zero on a warm
  cache.
- **The scripted Level-0 intro is not affected at all.** The intro cutscene runs `level-0`, and `level-0`
  carries **no `lastKillDrop`** (`server/src/catalog_seed.js` — only `level-1` at :750 and `level-2` at :790
  have one). `preloadRewardModel` is therefore never called on level-0, `pendingAssets` is unchanged there,
  the veil is not one frame longer, and **no extra trace ticks are consumed unrendered**. The concern that
  a longer veil would make the player join the cutscene partway in (`stepReplayTick`, `main.js:1101`, runs
  *above* the veil gate, and `22-trace-replay` only asserts final outcomes) is real in principle and simply
  does not arise for this change. This must stay true: **if a future change gives level-0 a `lastKillDrop`,
  re-open this paragraph.**
- **Recorded sessions are unaffected.** Playback drives ticks from the trace, not from the veil, so a trace
  recorded before this change replays identically after it.
- **The cap is untouched.** `WARM_MAX_WAIT_MS = 9000`, still anchored to the *first* raise
  (`main.js:1154`). Past the cap the player starts with the green fallback box — exactly today's behaviour.
- **The error path must decrement.** A failed reward fetch must not wedge the counter, mirroring
  `ship-factory.js:147-150`.

### (d) More work per veil frame, never more veil frames

Every warm added by Steps 2-5 runs **inside the existing `prewarmShaders()` call**, in the frame that
already does the compile behind the veil. No new veil frames on the normal path. The exceptions are the two
**late-arrival** cases — a crate `.glb` that lands after the warm ran (Step 2d) and the asynchronous ghost
build (Step 5b) — which both reuse the existing pattern at `client/src/world.js:626`, raise the flag **once**
rather than per object, and are gated on `G.gameStarted` so they cannot fire while the menu is up. Each
costs the same one raise/lower cycle a late set-piece already costs today, behind a veil that fades in only
after 90 ms.

Be honest about what that frame now costs. `warmDropAssets()` calls `warmModel()`, which does a **full
`renderer.compile(scene, camera)` of its own** (`ship-factory.js:116`), so a level with a reward model runs
up to **four** full-scene compile traversals instead of two, plus the one extra `renderer.render()` of Step
5. A traversal over already-compiled materials is a `Map` lookup per material — cheap next to the compiles
themselves, which is why this is acceptable — but it is a real addition to the frame the phone measured at
1073 ms, and it is the deliberate trade: a longer *hidden* pause in exchange for no stutter in play. If the
implementer wants to collapse it, the only sanctioned simplification is to park the templates first and let
the single existing `renderer.compile(scene, camera)` cover them (dropping `warmModel`'s own compile for
this caller) — do **not** change `warmModel` for the ship path.

---

## Steps

### Step 1 — export the GPU warm helper

`client/src/ship-factory.js:110`: change `function warmModel(root)` to **`export function warmModel(root)`**
and extend its comment to say it is now shared (the loot crate and the reward model use it too). No
behaviour change. `client/src/drops.js:12` already imports `gltfLoader` from this module, so there is no new
edge in the import graph and no cycle.

### Step 2 — `client/src/drops.js`: warm the loot surfaces

**2a. Imports.** `client/src/drops.js:10` and `:12` become:

```js
import { scene, renderer } from './engine.js';               // renderer: initTexture for the halo's CanvasTexture
...
import { gltfLoader, warmModel } from './ship-factory.js';   // meshopt-wired GLTFLoader + the shared GPU warm
```

(`ship-factory.js:12` already imports `scene, renderer, camera` from `engine.js`, so this adds no cycle.
The critic's review put the `gltfLoader` import at `drops.js:11`; it is **line 12** — line 11 is the
`./state.js` import. Verified in the worktree.)

**2b. A permanent parked rig for the loot surfaces.** Add next to the other module state (near
`drops.js:28-30`). The **templates live in it too, permanently** — `warmModel` unparents what it warms
(`ship-factory.js:123-124`), so a template it compiled is never drawn again and its geometry buffers are
never uploaded; keeping it parked is what lets the Step 5 pass upload them, and it doubles as an explicit
§83 keep-alive holder:

```js
let dropWarmRig = null;             // permanent, parked off-camera: the halo sprite + the crate/reward templates
function ensureDropWarmRig() {
  if (dropWarmRig) return dropWarmRig;
  dropWarmRig = new THREE.Group();
  dropWarmRig.name = 'dropWarmRig'; // named so a test can find it without guessing at coordinates
  dropWarmRig.position.y = -100000; // off-camera and frustum-culled; costs nothing per frame
  scene.add(dropWarmRig);           // never removed: a disposed last material frees the program (§83)
  addHalo(dropWarmRig, 0xffffff, DROP_HALO_SIZE); // the SAME constructor a live drop uses -> the same program key
  return dropWarmRig;
}
```

Parking a template is safe for cloning: `normalize()`/`normalizeGreen()` return a wrap `Group` at the
origin, so parenting it under the rig leaves `template.position` at 0 and every `template.clone(true)` is
unaffected — and `attachDropBody` (`drops.js:212`) sets the clone's position explicitly anyway.

**2c. The warm entry point.** Add an exported function (place it just after `preloadRewardModel`,
`drops.js:176-180`), returning the roots it holds so the caller can force their buffer uploads (Step 5):

```js
// Compile + upload everything the loot system can put on screen BEFORE the fight, not on the first drop.
// Measured 2026-09-01 (headless program-key diff, docs/plans/2026-09-01-1911-warm-late-shader-programs.md):
// the first crate compiled THREE programs during live play — the crate's MeshStandardMaterial, the halo
// SpriteMaterial and the pull line's LineBasicMaterial. Called from prewarmShaders(), i.e. with the level's
// lights and fog already in `scene`, which is what makes the compiled key the one the live draw will use.
export function warmDropAssets() {
  const rig = ensureDropWarmRig();
  renderer.initTexture(ensureHaloTexture());   // compile() covers shaders only; the halo's CanvasTexture needs this
  if (template && template.parent !== rig) { warmModel(template); rig.add(template); }   // the crate .glb
  for (const e of rewardModelCache.values()) {                                           // this level's reward .glb
    if (e.model && e.model.parent !== rig) { warmModel(e.model); rig.add(e.model); }
  }
  return [ensureLine(), rig];   // roots for the Step 5 upload pass
}
```

`ensureLine()` (`drops.js:255`) already returns the line and already adds it to `scene` with
`visible = false`; calling it here just moves its creation earlier. Every call is idempotent (the
`parent !== rig` guards), so running `warmDropAssets()` on every level build is free after the first.

**2d. Late crate arrival.** In the crate loader callback at `client/src/drops.js:34`:

```js
gltfLoader.load(DROP_MODEL_URL, (g) => {
  template = normalize(g.scene);
  // If a fight is already running, the level warm has been and gone — ask for another one so the crate is
  // compiled behind a veil rather than on the first drop. Gated on gameStarted on purpose: warming against
  // the menu scene would compile a DIFFERENT program key (different lights) and buy us nothing.
  if (G.gameStarted) G.needsSceneWarm = true;
}, undefined, () => {});
```

**2e. The reward model joins `pendingAssets` and gets warmed.** Rewrite `requestRewardModel`
(`client/src/drops.js:159-173`) to mirror `requestShipModel` (`client/src/ship-factory.js:128-151`)
line-for-line:

```js
  entry = { model: null, waiters: cb ? [cb] : [] };
  rewardModelCache.set(url, entry);
  G.pendingAssets++; // hold the level-load veil until the reward model is here (DECISIONS §84)
  gltfLoader.load(url, (g) => {
    entry.model = normalizeGreen(g.scene, targetLen);
    warmModel(entry.model);        // compile + upload NOW, not on the last kill of the level
    for (const w of entry.waiters) w(entry.model.clone(true));
    entry.waiters.length = 0;
    G.pendingAssets--;
  }, undefined, () => {
    rewardModelCache.delete(url);  // let a later attempt retry
    entry.waiters.length = 0;
    G.pendingAssets--;             // a failure must not wedge the veil
  });
```

`warmModel` here compiles against the already-built level scene, because `preloadRewardModel` is only
reached from `onWarmLevel` during `reset()`, after `buildMap`/set-pieces — the same guarantee ship models
have.

**2f. Let the by-hand check spawn a reward crate.** `client/src/drops.js:81` — widen the wrapper (purely
additive, `false` is today's behaviour). This is what makes the Step 7c verification a ten-second action
instead of a full level playthrough; the committed guard does not use it:

```js
export function spawnDrop(pos, item, special = false) {
  ...
  if (!spawnDropIn(world, pos, item, weight, special)) console.warn('drops: cap reached, skipping');
```

### Step 3 — `client/src/shield-fx.js`: build both bubbles at warm time

Add at the end of the file (it needs no new imports; `G` is already imported at `shield-fx.js:9`):

```js
// Build the bubble meshes BEFORE the fight so prewarmShaders' renderer.compile(scene) reaches them:
// measured 2026-09-01 as one ShaderMaterial program compiling mid-fight, on the first absorbed hit. The
// player and enemy bubbles share ONE program (identical shader source, see makeBubbleMaterial), so warming
// either would cover the compile; both are built because each mesh also carries its own one-shot geometry
// upload. Both are permanent and never disposed, so the program can never be freed again (DECISIONS §83).
// `visible === false` is fine: renderer.compile() walks the scene with traverse(), not traverseVisible().
export function warmShieldBubbles() {
  ensureBubble();
  const cap = (G.gfx && G.gfx.enemyShieldBubbles) || 0;   // Performance tier: 0 -> allocate nothing, as today
  if (cap > 0 && enemySlots.length === 0) makeEnemySlot();
  return cap > 0 ? [bubble, enemySlots[0].mesh] : [bubble];
}
```

**As built, plus one thing this plan missed (caught at review).** Creating the bubble early also made it
*show*: `updateShieldBubble` sets `visible = !!(pl && pl.alive && pl.shield)` and an idle rim `uBase = 0.12`,
and the only reason no rim appeared before the first hit was that the MESH DID NOT EXIST YET. So the shipped
version adds an `armed` flag in `shield-fx.js`, set by `registerShieldImpact` and `spawnShieldReady` — the
two functions that used to call `ensureBubble()` — with `updateShieldBubble` holding `visible = false` until
then. That reproduces the old behaviour exactly (rim from the first absorbed hit of the session onward) and
matters most on the non-`?debug` path, where the **bootstrap** prewarm runs while the menu is up and the idle
ship is `alive` with a shield. `50-warm-completeness` now asserts invisible-before / visible-after-a-hit.

The tier gate is load-bearing: on **Performance** the enemy bubble effect does not exist at all
(`graphics.js` `enemyShieldBubbles: 0`), so creating one there would *add* a program that tier never uses.

Compatibility with the existing guard: `client/visual/scenarios/25-enemy-shield.mjs` asserts
`slotCount > 0 && <= 6` (line 126) and `slotCount < 10` (line 127) after overfilling the pool with 10
enemies — pre-creating one slot keeps both true, and the "every slot is released" wait at line 141 is
satisfied by a fresh slot (`visible=false`, `enemy=null`). No edit needed there.

### Step 4 — `client/src/main.js`: call the new warms from `prewarmShaders()`

**4a. Imports.**
- `client/src/main.js:21` — add `spawnShieldHit` to the `./projectiles.js` import (it is already exported;
  `sim.js:24` imports it). Used only by the `?debug` hook in Step 6.
- `client/src/main.js:24` — add `warmShieldBubbles` to the `./shield-fx.js` import.
- `client/src/main.js:28` — add `warmDropAssets` to the `./drops.js` import.

**4b. Name the FX rig.** At `client/src/main.js:794`, right after `warmRig = new THREE.Group();`, add:

```js
      warmRig.name = 'fxWarmRig';   // named so a test can find it without matching on a parked y coordinate
```

This is required, not cosmetic: `client/visual/scenarios/28-scene-warm.mjs:50` currently finds the rig with
`if (o.isGroup && o.position.y === -100000) found = o;` and keeps the **last** match. Step 2b adds a second
group at that same parked y, which would make 28 pick `dropWarmRig` and fail its `rig.children >= 2`
assertion. See Step 7b for the matching test edit.

**4c. Warm the new surfaces, inside the existing call.** In `prewarmShaders()`
(`client/src/main.js:791-808`), immediately **before** the two `renderer.compile(...)` lines:

```js
    // Surfaces that used to compile DURING PLAY, on their first appearance (measured 2026-09-01): the loot
    // crate + its halo + the grab line, and the shield bubbles. They are created here — as the REAL
    // singletons, invisible or parked — so the compile below sees them with this level's lights and fog and
    // produces the exact program key the live draw will ask for.
    const warmRoots = [...warmShieldBubbles(), ...warmDropAssets()];
```

then the existing `renderer.compile(skyScene, camera); renderer.compile(scene, camera);`, then Step 5.

### Step 5 — the buffer-upload pass (REQUIRED, not conditional)

`renderer.compile()` builds **programs** and nothing else. In r160, a geometry's buffers are uploaded in
`projectObject` → `objects.update(object)`, and that call sits **behind** the per-object frustum test, while
`object.visible === false` returns early for the **whole subtree**. So every surface warmed above — parked
at y = -100000, or hidden — is compiled but never uploaded, and the buffers would land on the first live
crate, the first ripple and the last kill. That is exactly the hitch this change exists to remove, so this
pass is part of the fix, not a contingency. Three details it must get right:

1. **Traverse each root.** `warmRoots` holds *roots* (`dropWarmRig`, the pull line, the bubble meshes); the
   cull test runs on each **descendant** — the halo `Sprite`, the crate template's `Mesh`es — whose own
   `frustumCulled` is still `true`. Forcing the flags on the root alone changes nothing.
2. **Include the templates.** They are inside `dropWarmRig` now (Step 2b), precisely because `warmModel`
   unparents what it compiles and would otherwise leave them undrawable.
3. **Restore both flags per object**, so nothing costs a draw call for the rest of the session.

Add at the end of the `try` in `prewarmShaders()`, after the two compiles:

```js
    // compile() makes programs; three uploads a geometry's buffers only when the object is actually DRAWN,
    // and everything warmed above is hidden or parked off-camera, so it would be culled out of every frame.
    // Draw ONE throwaway pass with those objects forced on — the veil is up and the real clear+render
    // follows immediately, so nothing reaches the player — then restore. More work in the veil frame, not
    // more veil frames (source brief §3.4).
    const forced = [];
    try {
      for (const root of warmRoots) root.traverse((o) => {
        if (!o.isMesh && !o.isLine && !o.isSprite && !o.isPoints) return;
        forced.push([o, o.frustumCulled, o.visible]);
        o.frustumCulled = false; o.visible = true;
      });
      if (forced.length) renderer.render(scene, camera);
    } finally {  // a throw here must not leave the rig permanently visible + unculled for the session
      for (const [o, fc, vis] of forced) { o.frustumCulled = fc; o.visible = vis; }
    }
```

The `finally` is load-bearing, not style: this block sits inside `prewarmShaders()`'s own
`try { } catch { }`, so without it a throwing `renderer.render` would leave the crate template and the halo
`visible = true, frustumCulled = false` — permanent off-screen draw calls for the rest of the session, and
the catch would swallow the evidence.

`root.traverse` visits the root itself as well, so a bare `Mesh` root (a shield bubble) is covered by the
same loop. The pull line's geometry starts as an all-zero `Float32Array(6)`, so this pass draws a degenerate
line at the origin for one frame — behind the veil, and overwritten by `renderer.clear()` +
the two real passes at `client/src/main.js:1168-1172` before anything is presented.

**Residuals that are knowingly out of reach** (name them here rather than discovering them at the gate):

- **The two fallback boxes** (`fallbackBox`, `greenFallbackBox`) are deliberately not warmed — they only
  exist when a `.glb` failed or has not landed, and `greenFallbackBox`'s material is *disposed* by design
  (`drops.js:240`). In a healthy run they never appear, so they contribute no growth to the guard.
Decision 2's "stop and report, never widen" applies to anything *else* that still moves after this pass —
with the ghost battle, below, handled explicitly rather than left as a residual.

### Step 5b — close the ghost-battle race (the likeliest part of the phone-vs-headless gap)

**An earlier draft of this plan dismissed the ghost battle on a false claim** — that `transparent`/`opacity`
do not enter a program cache key. They do. Verified in the pinned r160 source: `WebGLPrograms` computes
`opaque: material.transparent === false && material.blending === NormalBlending` (three r160, `getParameters`)
and `getProgramCacheKeyBooleans` pushes it as **bit 17**. A material flipped to `transparent = true` is a
**different program** from the one `warmModel` compiled for the cached hull template. The same block also
sets `m.fog = true`, another key input.

The path is not the `?dev` slider (`applyOpacity`, `ghost-battle.js:74`, wired only to lil-gui at :143) — it
is the build-time branch in **`applyShipModel` (`client/src/ship-factory.js:215-234`)**, which clones each
material and sets `m.transparent = true; m.opacity = opacity; m.fog = true` for every ghost hull, because
`ghost-battle.js:64` passes `opacity: GHOST_TUNE.opacity` (0.9).

**Why this matters and why the guard cannot see it.** The ghost group is added to the **combat `scene`**
(`ghost-battle.js:49`) and built asynchronously from `client/src/sim.js:745`
(`import('./ghost-battle.js').then(m => m.buildGhostBattle())`, which itself `await`s
`import('./backdrop-battle.js')`). `ghostBattlePlan` returns `enabled: false` under `?debug`
(`ghost-battle-track.js:15-16`), so **no headless frame can ever contain a ghost** — `50-warm-completeness`
is blind to this by construction, on a `high`-tier phone that runs 8 concurrent ghosts. The phone measured
**+10** programs during play; the headless probe attributes only **+4**. This is very plausibly much of that
gap.

**The actual timing analysis** (this is the part that decides the fix):

- **Cold path** — the ghost's ship glb is not cached. `requestShipModel` bumps `G.pendingAssets`
  (`ship-factory.js:137`) and its waiter callbacks — which create the transparent clone — run **before**
  `G.pendingAssets--` (`ship-factory.js:141-144`). So the clone is in the scene while the veil is still up,
  and the existing `renderer.compile(scene)` covers it. Safe by accident, but safe.
- **Warm path — the common case, and the hole.** The reason the ghost glbs are usually already cached is
  **not** `preloadLevelShipModels`: the ghost cast comes from the recorded track, so it can name a ship the
  current level never spawns and therefore never preloads (and `CATALOG.shipByName.get()` can miss
  altogether — `ghost-battle.js:61` — leaving `spec = null` and a primitive ghost). It is that
  `buildGhostBattle` runs on **every non-freighter `reset()`** (`client/src/sim.js:745`), so the *previous
  level's* ghost build already parsed and cached them. `requestShipModel` then returns through its
  `if (entry.scene)` fast path (`ship-factory.js:130-134`) with **no `pendingAssets` bump at all** and
  invokes the callback synchronously — so a ghost clone created after the veil dropped is warmed by nothing
  and compiles on its first draw, in front of the player.

**The fix — one line, in `client/src/ghost-battle.js`, immediately after the `slots` map that builds every
ghost mesh** (`ghost-battle.js:59-72`). `G` is already imported at `ghost-battle.js:15`:

```js
  // The ghost hulls are a DIFFERENT program from the combat hulls they clone: applyShipModel sets
  // transparent/opacity/fog on them, and `opaque` is part of three's program cache key. They arrive
  // asynchronously — usually through requestShipModel's cache fast path, which does NOT hold the veil — so
  // ask for a warm now rather than let them compile on their first draw, mid-fight. Same late-arrival
  // pattern as the set-piece loaders (world.js:626) and the crate (drops.js, Step 2d).
  if (G.gameStarted) G.needsSceneWarm = true;
```

**One raise covers every case** — cached, cold, and the `spec = null` primitive ghost — precisely because of
the ordering above: on the warm path the clones already exist when the loop ends, so the next frame's warm
compiles them; on the cold path the veil this raises **holds** while `G.pendingAssets > 0`
(`main.js:1162`), and the waiters run before the decrement, so the clones exist by the time the warm runs.
Raise it **once, after the loop** — not per mesh, which would buy a veil raise/lower cycle (and a full
`prewarmShaders()`) per model that lands on its own frame.

**One cold-path shape to know about before it is met on a phone.** If this raise lands while ghost `.glb`s
are still in flight *and* the initial veil has already dropped, then `warmDeferred` is false at that moment
(`main.js:1155-1157`), so the raise **starts a fresh 9 s deadline** and a mid-fight veil holds for the whole
download — with the sim ticking underneath it, as always. It is narrow (it needs an uncached ghost model
arriving after the level's own veil came down), it is capped by `WARM_MAX_WAIT_MS`, and it is identical in
shape to what a late set-piece already does today (`world.js:626`). Written down so it reads as known
behaviour rather than a new bug.

**Not a per-level sawtooth, and no §83 dispose risk:** the ghost entry pushed to `setPieces`
(`ghost-battle.js:51-52`) carries **no `dispose`**, so `sim.js`'s teardown (`sp.dispose?.(); scene.remove(...)`)
only detaches the group and the materials are garbage-collected rather than disposed. The program therefore
survives the session and this compiles once, at the first ghost build — which is still a level start, and
still in front of the player if it lands late. That is what this step removes.

**Expectation for the phone probe (Step 7a's header instruction):** because those programs compile once per
session and are never released, the Step 5b win is a **single** first-ghost-build compile. Diffing
`__game.programKeys()` across a *second* level on the device will show no ghost delta **with or without this
fix** — that is the fix working, not the probe failing. The measurement that shows it is the **first** fight
of a fresh page load.

### Step 6 — `?debug` hooks

In the `window.__game` block (`client/src/main.js:1271-1400`), next to the existing `renderer` entry
(`main.js:1274`):

```js
    // Field probe for the level-start warm: dump the live shader-program cache keys. Snapshot once when the
    // veil drops and again a few seconds into the fight — anything in the second list that is not in the
    // first compiled DURING PLAY. Needs `debug` in the URL; on a phone that means `?dev&debug`.
    programKeys: () => renderer.info.programs.map((p) => p.cacheKey),
    spawnShieldHit,   // test hook: PLAYER shield ripple — signature is (pos, broke = false)
    spawnDrop,        // test hook: place a crate at an EXACT position (spawnTestDrop jitters near the ship,
                      // which puts it inside Grab range and lets stepDrops collect it mid-assertion)
```

(`spawnDrop` is already imported at `client/src/main.js:28`; `spawnShieldHit` is added to the
`./projectiles.js` import in Step 4a.)

and widen the existing stress hook at `client/src/main.js:1327-1334`:

```js
    spawnTestDrop(item, special = false) {
      ...
      spawnDrop(pos, chosen, special);
      return chosen;
    },
```

### Step 7 — tests

**7a. New guard: `client/visual/scenarios/50-warm-completeness.mjs`.** (Numbered **50** as built: 48 was the next
free slot when this plan was written, but the two parallel worktrees landed `48-hud-viewport-cache` and
`49-duel-referee` on `main` first.) It is the probe from the investigation, turned into an assertion. Shape:

```js
export const name = '50-warm-completeness';

export default async function ({ page, assert }) {
  // take off (mainwin -> #mw-takeoff, else welcome -> #takeoff), then __game.silenceIntro()
  // wait: needsSceneWarm === false && pendingAssets === 0 && !#levelwarm.classList.contains('on')
  // draw once, then snapshot:
  //   baseline = new Set(renderer.info.programs.map(p => p.cacheKey))
  //   geo0 = renderer.info.memory.geometries, tex0 = renderer.info.memory.textures
  //
  // drive the fight DETERMINISTICALLY (do not wait on wall-clock combat — 53 s of sim in the probe produced
  // ZERO kills, so emergent play is not a reliable driver here):
  //   dispatch keydown KeyW / Space / KeyF on window, then 120 x { stepSim(10); draw(); }
  //   with a `await new Promise(r => setTimeout(r, 25))` every 8 chunks so async .glb loads can land
  //
  // then the one-shots that ordinary play produces, each followed by several { stepSim(6); draw(); }:
  //   spawnTestDrop({ kind: 'component', refId: 6 })   -> crate + halo
  //   spawnTestDrop({ kind: 'weapon',    refId: 9 })   -> a second crate (same shared materials)
  //   spawnShipExplosion(player.pos.clone(), 0xff8030, 1)   -> the §83 keep-alive path, must stay +0
  //   spawnEnemyShieldHit(enemies[0], enemies[0].pos)  -> enemy bubble
  //   spawnShieldHit(player.pos.clone())               -> player bubble; signature is (pos, broke = false)
  //
  // THEN, and only then, the attribution snapshot — see the ordering note below.
}
```

**Ordering that keeps assertion 2 honest.** The starting ship carries the Grab
(`components: { … grab: 29 … }`, `server/src/catalog_seed.js:463`), so a crate spawned next to the player is
armed, pulled and **collected** by `stepDrops`, after which `detachDropBody` (`client/src/drops.js:221-225`)
removes it from the scene. Step the sim for long enough and the traverse finds no crate at all — and an
assertion phrased as "for every crate material, check the key" would then check nothing and pass. Two rules,
both mandatory:

- **Spawn the attribution crate out of Grab range.** `spawnTestDrop` places the crate within ±15 u of the
  player; instead spawn the final crate directly through `__game.spawnDrop(pos, item)` at the player's
  position **plus ~200 u** (well outside the pull radius and outside the arm/pull logic), then run exactly
  **one** `stepSim(1)` + `draw()` and take the attribution snapshot immediately. The crate cannot have been
  collected in one tick at that distance.
- **Count before you compare.** The snapshot returns a per-surface **found count**, and the scenario asserts
  each count is `>= 1` *before* it looks at a single `cacheKey`.

Assertions, in this order:

1. **Every named surface was found.** `crate >= 1`, `halo >= 1`, `line === 1`, `playerBubble === 1`,
   `enemyBubble >= 1` — each with its own message naming the surface. This is the fail-closed gate: if the
   scene does not contain the thing, the test fails instead of silently asserting over an empty list.
   (`halo` counts `isSprite` objects, which includes the parked `dropWarmRig` one, so it can never be zero —
   that is fine; the crate and bubble counts are the ones that could legitimately vanish.)
2. **Programs — hard zero.** `renderer.info.programs.length === baseline.size`, and the key set is
   unchanged. On failure the message **must list the new `cacheKey`s (first ~200 chars each) plus the
   attribution** from `renderer.properties.get(mat).currentProgram` — that is what makes the failure
   diagnosable instead of a bare number.
3. **Key equality (failure mode (a)).** For every material found in step 1, read
   `renderer.properties.get(m).currentProgram?.cacheKey` and assert it is **non-null and a member of
   `baseline`**, reporting the surface name and the offending key on failure. A warm that compiled the wrong
   key fails here, by name. This assertion is the point of the scenario — a `compile()` call count would
   pass while the bug is live.
4. **Buffers, PER SURFACE** — *as shipped; see the status note at the top of this file for why the original
   whole-fight `geo0`/`tex0` equality was replaced.* Each one-shot is measured on its **own**
   geometry/texture delta and asserted at hard zero: `drop1 +0`, `drop2 +0`, `enemyBubble +0`,
   `playerBubble +0`. `explosion` is deliberately excluded — its quads are a pre-existing residual
   (`docs/plans/warm-geometry-buffer-uploads.md`); what this scenario pins for the §83 FX path is its
   PROGRAM count, in assertion 2. The whole-fight totals are printed, not asserted, with the log line saying
   the residual is pre-existing and out of scope.
5. Keep a `shot('warm-completeness')` frame for the human artifact directory, as the other scenarios do.

**One addition to the scenario that the plan did not anticipate, and that must not be deleted as a hack.**
The attribution crate has to be spawned out of Grab reach, which also puts it off-camera — so an ordinary
draw culls it, and because `addHalo` builds a **fresh** `SpriteMaterial` per drop, that material would carry
no `currentProgram` at all and assertion 3's "non-null" half would fail on a perfectly warm build. The
scenario therefore forces `frustumCulled = false` on that one crate's subtree for the single attribution
draw and restores it immediately. This is what happens anyway the moment a real drop is on screen, and if the
halo's program were the wrong one, that draw is exactly what exposes it (assertion 2 sees a new key).

**Mutation check before calling it done:** comment out the `warmDropAssets()` call in `prewarmShaders()` and
confirm the scenario **fails** on assertion 2 with the crate/halo/line keys listed. A guard that passes both
with and without the fix is not a guard.

*Run 2026-09-01, both mutations fail closed:* (A) `warmRoots = [...warmShieldBubbles()]` → *"3 shader
program(s) compiled DURING PLAY … attributed to: Mesh/MeshStandardMaterial/Material, Sprite/SpriteMaterial,
Line/LineBasicMaterial"*. (B) the Step 5 forced draw disabled (`if (false && forced.length)`) → *"drop1:
uploaded 2 geometry buffer(s) — the level-start warm no longer covers this surface"*, which is the
negative test for the reshaped assertion 4.

**The header comment must state the coverage limits explicitly** — this scenario is narrower than the fix,
and a reader must not mistake a green run for "nothing compiles late anywhere":

- **Covered:** the `level-0` surfaces — loot crate, halo sprite, pull line, player and enemy shield bubbles,
  and the §83 ship-death FX path.
- **NOT covered — the reward drop model.** `level-0` carries no `lastKillDrop`, and a committed test must
  not depend on a live CloudFront fetch. Verified by hand in 7c.
- **NOT covered, and structurally impossible to cover — the ghost battle (Step 5b).** `ghostBattlePlan`
  returns `enabled: false` whenever the URL contains `debug` (`ghost-battle-track.js:15-16`), and the visual
  harness always opens the game with `?debug` — so **no headless frame can ever contain a ghost**. This is
  not a gap the implementer can close by writing a better scenario; it is a property of the feature's own
  dev-flag gating. The check is the phone: with `?dev&debug`, snapshot `__game.programKeys()` when the veil
  drops and again ~10 s into the fight, and diff — **on the first fight of a fresh page load**, since ghost
  programs compile once per session and are never released (Step 5b). Write that instruction, including the
  fresh-load caveat, into the header comment so the next person does not assume the guard covers it or
  mistake a flat second-level diff for a broken probe.

**7b. Edit `client/visual/scenarios/28-scene-warm.mjs:48-53`.** Replace the coordinate match with the name
introduced in Step 4b:

```js
    window.__game.scene.traverse((o) => { if (o.name === 'fxWarmRig') found = o; });
```

Leave every assertion in that file as it is — `rig.children >= 2`, `!rig.disposed`, `compiled === 0`,
`assets.pending === 0`, `assets.veil === false` all still hold and are exactly the wiring this change must
not break.

**7c. Reward-model warm — verified by hand, not by a committed test.** Level-0 has no `lastKillDrop`, so the
harness cannot exercise it, and pointing a committed scenario at CloudFront would make the suite depend on
the CDN. The implementer verifies it once, locally, and writes the result into the PR/report: run the game
with `?debug` on a level that has a reward (`level-1`, whose `lastKillDrop` is weapon 5 —
`server/src/catalog_seed.js:750`), take off, and once the veil drops run in the console

```js
const before = __game.programKeys();
__game.spawnTestDrop({ kind: 'weapon', refId: 5 }, true);   // the reward crate, via the Step 2f hook
// ...let a few frames render, then:
__game.programKeys().filter((k) => !before.includes(k));    // must be []
```

If that array is not empty, report the difference rather than patching around it.

**Use an account that does NOT already own weapon 5.** `preloadRewardModel` is behind an `ownsReward` gate
(`client/src/sim.js:476`) and `step-enemies.js:171` skips the reward drop entirely for an owner — on an
account that already has the Machine Gun this check measures nothing and passes vacuously. Reset progress
(Settings → reset, or a fresh account) before running it.

**7d. Unit tests.** None are added, deliberately: every surface here is GPU/renderer state behind
`import * as THREE from 'three'`, which `node --test` cannot load in this project (there is no jsdom and no
WebGL). The regression guard for this fix is 7a, which is a real executable guard in a real browser — not a
"cannot be tested" excuse. Run `cd client && node --test` anyway to prove nothing else regressed.

### Step 8 — the acceptance run (this is the measurement, not a formality)

Before any visual run: **`lsof -i :4173`**. Two other worktrees are live
(`2026-09-01-1845-duel-referee`, `2026-09-01-1848-hud-viewport-cache`) and `client/visual/run.mjs` hardcodes
port 4173 and the shared `spacegame_test` database, so two concurrent runs silently test each other's code.
If the port is busy, **wait or report — do not run anyway** (a `VISUAL_PORT` override exists but the
Postgres database is still shared).

Worktree setup, if not already done: `cd client && npm install`, `cd server && npm install`, and
`npm run assets:pull` from the repo root (the combat `.glb`s are gitignored; without them the crate model
never loads and the probe measures the wrong thing).

Then, from `client/`, run these **named** scenarios — one at a time, never the whole suite:

1. `node visual/run.mjs 50-warm-completeness` — the new guard, including the mutation check in 7a.
2. `node visual/run.mjs 28-scene-warm` — the §83 wiring guard (rig found by name, explosion still +0).
3. `node visual/run.mjs 22-trace-replay` — **mandatory.** The intro/sim guard: 4 kills, checkpoints p0..p4,
   a win. Must pass **unchanged**. (The source brief calls this `22-intro-replay`; the file is
   `22-trace-replay.mjs`.)
4. `node visual/run.mjs 25-enemy-shield` — the shield pool now starts with one slot.
5. `node visual/run.mjs 26-ship-model-cache` — `ship-factory.js` gained an `export`.
6. `node visual/run.mjs 29-intro-live-handoff` and `node visual/run.mjs 01-smoke` — cheap boot/handoff sanity.

Also `cd client && node --test` (unit suite). `cd server && npm test` is **not** required — no server file
changes.

**The 49-scenario visual suite and the A/B perf bench are opt-in (DECISIONS §141) and are not yours to
start.** If you believe one is needed, say so and stop; the maintainer decides. A stuck run is reported, not
ground through.

Success is **not** an fps delta. The frame is GPU-bound in steady state; this change targets stutter at
level start.

---

## Docs to update

- **`docs/CHANGELOG.md`** — one bullet under `## 2026-09-01` (the heading exists), leading with the
  user-visible effect: the first loot drop, the first absorbed hit, a level's last kill and the ghost-battle
  backdrop no longer hitch, because the level-start warm now covers the loot crate, its halo, the grab line,
  both shield bubbles, the reward drop model and the ghost hulls' transparent material variant. **Word the
  measurement precisely — do not write a bare "now 0".** The honest claim is: *"the four late programs the
  headless probe could name (33 → 37 during play) are now warmed and asserted at zero by
  `50-warm-completeness`; the ghost-battle path is fixed by the same mechanism but is invisible to the suite
  (`?debug` disables ghosts), so it is verified on the phone via `__game.programKeys()`."* The phone's
  32 → 42 is not claimed as closed by a test that structurally cannot see part of it.
- **`docs/SUMMARY.md`** — two edits, and the second is a correction:
  1. **`docs/SUMMARY.md:577`** (the `**Shader/GPU warm (prewarmShaders…)**` bullet) — add the newly warmed
     surfaces and the rule that makes them correct: warm the **real singleton** in the **real scene**, from
     `prewarmShaders()`, because `renderer.compile()` walks `scene.traverse()` (so an invisible object is
     compiled) but a program key depends on the level's lights/fog. Mention that the reward drop model now
     counts into `G.pendingAssets` and is compiled by `warmModel` on arrival.
  2. **`docs/SUMMARY.md:2628-2633`** — the second `**Shader pre-warm (prewarmShaders)**` bullet in the
     Visuals section describes only the **bootstrap one-shot** and omits the per-level warm, so a reader who
     lands there gets half the system and the :577 bullet appears to contradict it. **Its facts are true and
     must be kept.** There really are two callers, and I originally mis-read this as stale — the critic was
     right:
     - the bootstrap one-shot, `client/src/main.js:2134` —
       `if (!location.search.includes('debug')) requestAnimationFrame(() => requestAnimationFrame(prewarmShaders));`
       i.e. **deferred two frames, during the menu, and genuinely skipped under `?debug`**;
     - the per-level warm, `client/src/main.js:1148-1166`, driven by `G.needsSceneWarm` behind the veil,
       which is **not** skipped under `?debug`.

     Fold :2628-2633 **into** the :577 bullet, keeping the `?debug`-skip sentence and adding "…the bootstrap
     one-shot only; the per-level warm behind the veil always runs", then leave a one-line pointer (or
     nothing) at :2628. That `?debug` skip is load-bearing for this change: it is exactly why the headless
     harness has no bootstrap pre-compile, which is what makes `50-warm-completeness` discriminative at all
     — say so in the SUMMARY text.
  3. Bump `**Updated:**` (`docs/SUMMARY.md:6`).
- **`docs/DECISIONS.md`** — **amend §83** (`docs/DECISIONS.md:2995-3046`); do **not** open a new numbered
  entry. Add a dated amendment recording: (i) the warm was incomplete because `renderer.compile()` only
  reaches what is in the scene at that moment, and the gap was found by **diffing `renderer.info.programs`
  cacheKeys across the veil** rather than by guessing; (ii) the rule that closes it — *if a surface can
  appear during a fight, its real singleton must exist in the real scene before the warm; warm the object,
  not a stand-in*; (iii) that `renderer.compile()` uses `scene.traverse`, so `visible === false` is not an
  obstacle, while compiling before the level's lights exist silently produces the wrong key — **and that
  `compile()` covers programs only**, so geometry buffers need one forced draw and textures need
  `initTexture`; (iv) the reward model joining `pendingAssets` as a §84-consistent choice, with the
  CloudFront caveat; (v) the guard: `50-warm-completeness` asserts **hard zero** new programs after the veil
  and pins each surface's program to the baseline key set by attribution.
- **`docs/DECISIONS.md` §83, the "Verification" paragraph (`docs/DECISIONS.md:3042-3046`) must be
  CORRECTED, not just extended.** It currently reads *"Software WebGL does not reproduce the stall and
  compiles almost everything at bootstrap, so the same probe reports '1 program compiled during play' on
  both the old and the new code"* — which is the exact opposite of this change's premise and would leave
  DECISIONS carrying two contradictory claims. The correction: the visual suite runs `?debug`, so the
  **bootstrap prewarm never runs there** (`main.js:2134`) and nothing is pre-compiled at boot; a
  **cacheKey DIFF across the veil does discriminate** in software WebGL — measured 2026-09-01 as
  33 → 37 programs (plus 35 → 41 geometries, 30 → 33 textures) during play, all attributable to named loot
  and shield materials. What remains true is the narrower claim the sentence was reaching for: the software
  renderer does not reproduce the *stall*, i.e. the wall-clock cost, so **timing** is still field-only.
  Phrase the new claim as **"the diff", not "the set"**: `getProgramCacheKeyParameters` also pushes
  `precision` and `outputColorSpace`, which are capability/backend-derived, so the absolute key *strings*
  are not portable between backends — but every material on a given backend carries the same values for
  those, so *which keys appear after the veil that were not there before* is backend-independent and
  assertable headlessly. Keep `28-scene-warm`'s role (wiring) alongside `50-warm-completeness`'s
  (completeness), and note the latter's blind spot (`?debug` disables the ghost battle).

---

## Out of scope — do not fold these in

- **The HUD viewport read (`gameW`/`gameH`).** Separate brief, `docs/plans/hud-viewport-layout-thrash.md`,
  being built in a parallel worktree right now. Touching it will conflict.
- **The fairness question that the sim runs while the player watches the veil.** Real, in ROADMAP, and it
  lives in the same few lines — but it is a design change with its own replay implications. This plan only
  guarantees it does not make tick counts *worse*.
- **A level-4 (or any non-level-0) guard scenario.** Explicitly excluded by the maintainer.
- **Any change to `WARM_MAX_WAIT_MS`, to the veil's fade timing, or to the veil gate's position relative to
  `update(dt)`.**
- **Warming the fallback boxes** (`fallbackBox`, `greenFallbackBox`) — they exist only on failure paths and
  warming them would add programs that otherwise never compile.
- **Chasing an fps number.** Do not report one as evidence.
- Any refactor of `drops.js`, `shield-fx.js` or `prewarmShaders()` beyond the lines named above
  (DECISIONS §30).
