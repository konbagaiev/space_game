# Player-locked wrapping speed field (parallax backdrop, Points)

**Feature id:** `2026-08-09-1410-player-locked-speed-field`
**Status:** ready to implement (all open questions answered — see *Decisions*, do not re-ask)

## Goal

Replace the static, world-anchored parallax **asteroid ring** (`makeAsteroids`, an `InstancedMesh` of 2000
low-poly rocks scattered once in an annulus around world origin) with a **player-locked, wrapping
point-sprite field** (`THREE.Points`) whose only job is to sell motion — so the ship never reads as
floating in place. The ring is anchored to the origin, so once the player roams (the star-system travel /
uncapped out-of-combat cruise of DECISIONS §94) they simply fly *out* of it into empty space, and 2000
instanced rocks is heavy for an effect that only needs to exist within ~one screen of the player. The new
field is a **fixed pool of ~900 points in 3 depth layers**, re-wrapped every frame into a box centred on
the player, so the same specks surround the player **everywhere in the system at constant cost** (3 draw
calls, no growth, no rebuild). User-visible effect: flying anywhere — inside the arena or 10 km out —
looks and feels the same as flying through the ring does today, and fast travel finally *reads* as fast.

This is **100% client-side render decor**. It changes no gameplay, no sim state, and no network payload.

## Hard constraints (a reviewer will check these verbatim)

1. **100% client-side visual FX.** The field is **not** registered in any sim update array, has **no**
   collision, and **nothing** about it is sent to or read back from the server. It must stay client-only so
   multiplayer is unaffected.
2. **The per-frame wrap is driven from the VIEW layer** — `settleView` in `client/src/sim.js:834`, where the
   camera/sky/planet parallax already updates — **never** from the deterministic tick.
3. **Replay-neutral (DECISIONS §73): the field consumes ZERO sim RNG.** Its one-time scatter draws the
   **native `Math.random`** (injected as a parameter, defaulting to `Math.random`), never `simRandom()`. The
   per-frame wrap is pure arithmetic and draws no randomness at all. §73 exists because decor built inside
   `reset()` — i.e. *before tick 0* — would displace the whole fight's seeded stream if it touched the
   seeded generator; that is exactly how the `.glb` asteroid field once desynced the intro. (The field is
   in fact built in `buildMap`, not `reset()`, but the native-RNG rule holds regardless.)
   `node visual/run.mjs 22-intro-replay` must pass **unchanged** (4 kills + `p0..p4` + win).
4. **No image asset for the point sprite.** The dot texture is a **procedurally generated canvas texture**
   (we reuse the existing one — see Step 2c). Importing a `.png` would trigger a `CREDITS.md` question per
   `CLAUDE.md`; do not add one.
5. **Warp / velocity-stretch streaking is OUT OF SCOPE.** Leave a *hook*, defined precisely in Step 3.

## Decisions (answered by the maintainer — inline so nobody re-asks)

1. **The old ring is deleted outright.** `makeAsteroids` (`client/src/world.js:423-450`), the module-level
   `rocks` handle (`world.js:761`) and its `buildMap` wiring (`world.js:822-823`) all go. **No flag, no
   second code path** — git history is the fallback (DECISIONS §30).
   The **mission `asteroid-field` set-piece** (`makeAsteroidField`, `world.js:536+`) and its `.glb` rock
   pack + `loadAsteroidPack` are **UNTOUCHED**. Only the *distant backdrop* layer changes; the up-close
   mission field keeps its model (that half of DECISIONS §71 still stands).
2. **Descriptor key renamed `asteroids` → `speedField`** (`{ color, layers: [{count,size,radius,depth,depthVar,opacity}] }`).
   **The now-dead `asteroids: {…}` block STAYS in each map descriptor for exactly one release** as a
   deliberate **compatibility shim**: `server/src/db.js:289` upserts every map descriptor on **every server
   start**, so the moment we deploy, the *already-published itch bundle* and the `/v2` sandbox — older
   clients reading the **live prod descriptor** — would call `makeAsteroids(undefined)` and throw inside
   `buildMap` (black scene, not a graceful degrade). Keeping the dead block costs one line and keeps them
   rendering their ring. **Removal condition (must not become permanent cruft):** delete the `asteroids`
   block from `catalog_seed.js` in the first change *after* the itch build has been re-published
   (`/publish-itch`) and `/v2` redeployed from a `main` that contains `speedField` — the next server start
   propagates the removal. This condition is repeated in DECISIONS §96 so it is discoverable.
3. **Menus:** the field is built **centred on the world origin** by `buildMap` and wraps **only during
   play**. It lives in the combat `scene`, so it still renders behind the welcome/base/briefing backdrops,
   but `update()` returns early there (`sim.js:381`) so `settleView` — and therefore the wrap — never runs
   on menus. **No menu-only code path, no extra hook.**
   Two precisions so nobody "fixes" this later on a wrong premise: (a) origin is *not* always the spawn —
   `reset()` (`sim.js:901-902,921`) spawns the player at `G.activeMission.center` for side missions
   ((−550,0), (400,0), (−100,−450)), so on a side-mission launch the field is briefly off-centre by up to
   550 units until the **first `settleView` re-centres it — one frame**, and even that wedge is only
   reachable at max zoom-out. Harmless; do not add an eager re-centre. (b) the menu look is stable not
   because the camera sits at the origin but because `main.js:1520` places the camera **once at boot** —
   on a *post-run* menu the camera is wherever the player left it, and the field was last wrapped around
   that same point, so it is still centred on screen.
4. **A `?dev` "Speed field" folder** is added to the existing Backdrop panel
   (`buildBackdropPanel`, `client/src/ghost-battle.js:128`): per-layer count / point size / radius R /
   depth / opacity sliders + a shared colour + a **"Dump speed field → console"** button that prints a
   paste-ready `speedField` block for `catalog_seed.js`. This is the **anti-churn measure** — the maintainer
   will dial N / R / depths / sizes live and hand back numbers. **The starting constants in this plan are
   explicitly PROVISIONAL; do not agonise over them, just make them trivially tunable.**
5. **Layers sit below the combat plane only** for the shipped look (distant, fog-faded specks). `depth`
   stays an ordinary per-layer param, so a layer can be pulled above the plane from the dev panel and
   judged live without a code change. Do **not** ship a foreground layer.

Two findings from discovery, both accepted and folded in:

- **There are no pixel baselines to regenerate.** `client/visual/run.mjs:12-15` — screenshots are saved to
  `__screenshots__/` as *review artifacts*; assertions are logic/DOM/`window`-hook based ("a pixel baseline
  would be flaky under software rendering"). So "regenerate backdrop baselines" is a no-op; see *Tests*
  for the eyeball step that replaces it.
- **The prose sweep is wider than the code symbol.** Grep the plain concept words, not just
  `makeAsteroids`; the exact sites are enumerated in Step 7 / Step 9.

## Design

### Where things live

| Piece | File | Why |
| --- | --- | --- |
| Pure math + defaults + tune persistence | **new** `client/src/speed-field.js` | No THREE, no DOM → unit-testable under `node --test` (there is no jsdom; pure modules are the testable surface, cf. `ghost-battle-track.js` next to the THREE-bound `ghost-battle.js`). |
| THREE build + per-frame update + dev folder | `client/src/world.js` (replaces `makeAsteroids`) | Keeps the `buildMap` wiring local, mirrors `makeStars`. |
| Per-frame call site | `client/src/sim.js` `settleView` | Constraint 2. |
| Dev panel host | `client/src/ghost-battle.js` `buildBackdropPanel` | The existing `?dev` Backdrop panel. |
| Data | `server/src/catalog_seed.js` MAPS | Per-map theming (colour + density) as today. |

### The wrap ("treadmill")

Points are **static in world space**; they move only when they fall outside the box, at which point they
are translated by an exact multiple of the box span. That gives *true perspective parallax* (deeper layers
sweep slower because they are farther from the camera) and keeps the field consistent with the world.

```
p.x = cx + wrapDelta(p.x - cx, half)     // cx,cz = player position; half = layer radius R
p.z = cz + wrapDelta(p.z - cz, half)
```

Only points that actually wrapped are written, and the position attribute's `needsUpdate` is set **only if
at least one point moved** — a stationary player uploads nothing.

### No pop-in: the rule is the FRUSTUM, with fog as a backup for the deep layers only

**Do not derive this from fog distance.** `THREE.Fog` fogs on **view-space depth**, not radial distance
from the player: r160's `fog_vertex.glsl.js` sets `vFogDepth = -mvPosition.z` and `fog_fragment` does
`smoothstep(fogNear, fogFar, vFogDepth)`. With this near-top-down camera the two are wildly different, so
"a point 620 units away is past `fog.far` (600)" is **false**.

The camera is `PerspectiveCamera(55, aspect, 0.1, 900)` (`client/src/engine.js:50`) at
`player + CAM_OFFSET(0,110,26) × zoom`, `ZOOM_MAX = 3.5` (`engine.js:51,68`). Its forward is
`-normalize(0,110,26) = (0, -0.9732, -0.2300)`; right `= (1,0,0)`; up `= (0, 0.2300, -0.9732)`.
Worked at **ZOOM_MAX** (offset `(0,385,91)`), the worst case, with `tan(27.5°) = 0.5206` vertical and
`× 16:9 → 0.9255` horizontal:

- **A near-layer point (y ≈ −18) at Δx = 620** sits at view depth
  `403·0.9732 + 91·0.2300 ≈ 413` — `fogNear` is **240**, so `smoothstep(240,600,413) ≈ 0.47`: it is only
  about half faded, **clearly visible**. At default zoom the same point is at view depth ≈ **131** — *not
  fogged at all*. **Fog does nothing for the shallow layers.**
- What actually hides them is the **frustum**. Solving the near layer's visible patch at ZOOM_MAX
  (y ∈ [−38,−18]): it reaches `|Δz| ≈ 274` on the far side, and at that far corner (view depth ≈ 496)
  `|Δx| ≈ 459`. So **R = 620 clears the near layer by ~1.35×** — the recycled point reappears *off-screen*,
  not fogged. At default zoom the visible patch is only ≈ `|Δx| ≤ 139`, `|Δz| ≤ 85`.
- **The deep layer is the opposite case.** At ZOOM_MAX a far-layer point (y ≈ −220..−280) is visible out to
  `|Δx| ≈ 620-720` at the far corner — i.e. its wrap boundary **can** be inside the frustum. It is saved by
  **fog**: its view depth there is ≥ 668 > `fogFar` 600, so it is fully fogged; in fact at ZOOM_MAX the far
  layer is invisible in its entirety. (`camera.far = 900` clips anything beyond that anyway.)

**The rule, therefore:** `radius` must exceed the layer's own **frustum reach at ZOOM_MAX** *unless* the
layer is deep enough that its view depth there already exceeds `fogFar`. `600` clears both ends with margin
and is the shipped floor (`WRAP_SAFE_RADIUS`). **It is aspect-ratio dependent:** the near layer's horizontal
reach scales with the aspect, so 620 runs out around **aspect ≈ 2.4** (ultra-wide); a 20:9 phone in
landscape (2.22) needs ≈ 573 — inside the margin, but not by much. If we ever ship an ultra-wide layout,
grow the shallow layers' `radius`, not the fog.

This is **documented and unit-asserted against the defaults, not silently clamped** — the dev panel must
stay free to explore smaller R (the folder label says so).

### Density baseline (implementer sanity check, not a target)

At default zoom the three layers put roughly **55-65 specks on screen** (vs ~23 rocks in today's ring),
at ~3.1 / 3.6 / 3.6 px. At ZOOM_MAX the near layer shrinks to ~1 px and the far layer is fully fogged.
Whole-field density is ~6.0e-4 points/unit² against the ring's 6.4e-4 — i.e. deliberately *comparable* to
what ships today. If your build looks dramatically emptier or busier than that, something is wired wrong;
otherwise leave it and let the maintainer tune.

### Provisional look (tune later via the panel — do not agonise)

`SPEED_FIELD_DEFAULTS`, mirrored by the seeded `speedField` block:

| layer | count | size | radius R | depth | depthVar | opacity |
| --- | --- | --- | --- | --- | --- | --- |
| near | 420 | 0.9 | 620 | 18 | 20 | 0.90 |
| mid | 300 | 1.6 | 620 | 90 | 40 | 0.75 |
| far | 200 | 2.6 | 620 | 220 | 60 | 0.55 |

~920 points, **3 draw calls**, ~920 cheap wrap iterations/frame (vs 2000 instanced rocks ≈ 40k tris today).
Point `y` = `-(depth + rng()*depthVar)`. Sizes are **world units** (`sizeAttenuation: true`); as a rough
sanity check three.js gives roughly `size * (canvasHeight/2) / distance` pixels, i.e. ~3-4 px each at
default zoom. Colour `0x6b6f78` (the old ring's grey) with a per-point brightness jitter (`vertexColors`,
factor `0.55 + rnd*0.45`) so the field doesn't read as a uniform stipple.

## Steps

### Step 1 — new pure module `client/src/speed-field.js`

Create it with a header comment stating: *pure (no THREE/DOM) so it is unit-testable; the scatter takes an
injected `rng` and production passes the **native `Math.random`** — never `simRandom` (DECISIONS §73).*

Export:

```js
// Minimum wrap half-box: a recycled point must reappear where the player CANNOT SEE IT. Two DIFFERENT
// mechanisms cover the two ends of the depth stack (both worked at ZOOM_MAX = 3.5 x CAM_OFFSET; see the
// plan's "No pop-in" section). NOTE: THREE.Fog fogs on VIEW DEPTH (-mvPosition.z), NOT radial distance —
// with this near-top-down camera the two are very different, so do NOT re-derive this from fog.far.
//  - SHALLOW layers (y ~ -18..-90) never even reach fogNear (240): a point 620 out is only ~413 deep in
//    view space at max zoom-out. They are hidden by the FRUSTUM — the near layer's visible patch tops out
//    at |dx| ~ 459 / |dz| ~ 274 (fov 55 -> tan 0.5206 vertical, x 16:9 -> 0.9255 horizontal).
//  - DEEP layers (y ~ -220..-280) DO out-reach the frustum horizontally, but their view depth there is
//    >= 668 > fogFar (600), so they are fully fogged (at ZOOM_MAX the far layer vanishes entirely).
// 600 clears both with margin at aspect <= ~2.4; beyond that (ultra-wide) the SHALLOW layers' radius must
// grow. Asserted against the defaults in speed-field.test.js.
export const WRAP_SAFE_RADIUS = 600;

export const SPEED_FIELD_DEFAULTS = {
  color: 0x6b6f78,
  layers: [
    { count: 420, size: 0.9, radius: 620, depth: 18,  depthVar: 20, opacity: 0.90 },
    { count: 300, size: 1.6, radius: 620, depth: 90,  depthVar: 40, opacity: 0.75 },
    { count: 200, size: 2.6, radius: 620, depth: 220, depthVar: 60, opacity: 0.55 },
  ],
};

export const SPEED_FIELD_RANGES = {
  count: [0, 1200], size: [0.2, 8], radius: [200, 1200],
  depth: [-40, 400], depthVar: [0, 160], opacity: [0.05, 1],
};

// Wrap a delta into [-half, half). Handles arbitrarily large deltas in one step (a teleport/warp-back
// must not need many frames to settle).
export function wrapDelta(d, half) {
  const span = 2 * half;
  let m = (d + half) % span;
  if (m < 0) m += span;
  return m - half;
}

// Re-centre a layer's positions on (cx,cz). Writes ONLY the points that fell outside the box; returns how
// many coordinates moved so the caller can skip the GPU upload when nothing did.
export function wrapField(pos, cx, cz, half) {
  let moved = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const dx = pos[i] - cx;
    if (dx >= half || dx < -half) { pos[i] = cx + wrapDelta(dx, half); moved++; }
    const dz = pos[i + 2] - cz;
    if (dz >= half || dz < -half) { pos[i + 2] = cz + wrapDelta(dz, half); moved++; }
  }
  return moved;
}

// One layer's one-time scatter, centred on the ORIGIN (buildMap runs before the player exists; the first
// settleView wraps everything into place on frame 1 — see Step 3). rng is injected for tests; production
// passes the NATIVE Math.random.
export function scatterLayer(layer, rng = Math.random) { /* Float32Array(count*3), x,z in [-R,R), y = -(depth + rng()*depthVar) */ }

// Per-point brightness jitter (vertexColors), same rng contract.
export function scatterColors(layer, rgb, rng = Math.random) { /* Float32Array(count*3) */ }

// Tolerate a descriptor with no/partial speedField (an old DB row, or a map that omits it): fill from
// SPEED_FIELD_DEFAULTS per key, clamp every number into SPEED_FIELD_RANGES.
export function normalizeSpeedField(spec) { /* -> { color, layers: [...] } */ }

// ?dev live-tune persistence — mirrors ghost-battle-track.js loadGhostTune/saveGhostTune (injected store,
// try/catch, clamped on read). Returns `fallback` when nothing is stored.
export const SPEED_TUNE_KEY = 'speedFieldTune';
export function loadSpeedTune(store, fallback) { /* normalizeSpeedField(JSON.parse(...)) or fallback */ }
export function saveSpeedTune(store, spec) { /* clamped write */ }
```

### Step 2 — `client/src/world.js`: delete the ring, add the field

**2a. Delete** `makeAsteroids` entirely — the comment block **and** the function, `world.js:423-450`.

**2b. Delete** the `rocks` handle (`world.js:761`) and its build in `buildMap` (`world.js:822-823`).

**2c. Point sprite (constraint 4).** Reuse the existing procedural canvas dot,
`getStarGlowTexture()` (`world.js:47-62`) — a 64px radial gradient, white core → transparent edge, built
once and cached. Update its comment to say it is now **shared by the bright-star layer and the speed
field**. Do **not** add an image asset and do **not** write a second near-identical canvas.

**2d. Add `makeSpeedField` + `updateSpeedField`** where `makeAsteroids` was (keep the file's ordering).
Import at the top of `world.js`:

```js
import { SPEED_FIELD_DEFAULTS, SPEED_FIELD_RANGES, normalizeSpeedField, scatterLayer, scatterColors,
         wrapField, loadSpeedTune, saveSpeedTune, WRAP_SAFE_RADIUS } from './speed-field.js';
import { isDev } from './dev.js';
```

Module-level handle replacing `rocks`:

```js
// The player-locked wrapping speed field (replaces the old origin-anchored asteroid ring). Pure render
// decor in the COMBAT scene: never in a gameplay array, never collidable, never sent to the server.
let speedField = null; // { spec, layers: [{ points, pos, col, half }] }
```

`makeSpeedField(spec)` — for each layer:

- `BufferGeometry` with `position` (from `scatterLayer(layer, Math.random)`) and `color` (from
  `scatterColors`) as `BufferAttribute`s, `position` marked `setUsage(THREE.DynamicDrawUsage)`.
- `PointsMaterial({ size: layer.size, sizeAttenuation: true, map: getStarGlowTexture(), vertexColors: true,
  transparent: true, opacity: layer.opacity, depthWrite: false, blending: THREE.NormalBlending, fog: true })`.
  **Keep `depthTest` at its default `true`** so the planet/set-pieces/ships occlude the field correctly;
  `depthWrite: false` keeps the sprites from cutting into each other. **Normal** blending, not additive —
  these are dim rocks, not stars.
- `scene.add(points)` (the **combat** scene, like the old ring, so the combat sun/fog apply).

`buildMap` (`world.js:822`, where `rocks` was) becomes:

```js
  // Player-locked wrapping speed field (was: an origin-anchored asteroid ring — DECISIONS §96).
  // `d.asteroids` is a dead compatibility shim for older clients; this client reads `d.speedField` only.
  disposeSpeedField();                       // buildMap re-runs per level/map switch — the old ring LEAKED here
  const base = normalizeSpeedField(d.speedField);
  speedField = makeSpeedField(isDev() ? loadSpeedTune(window.localStorage, base) : base);
```

`disposeSpeedField()` removes each layer's `Points` from the scene and disposes its geometry + material.
**Note this fixes a real pre-existing leak:** `buildMap` re-runs on every level start / map switch
(`main.js:1500`, `account.js:278`, `net.js:156`, the `?tune` rebuild button) and never removed the previous
`rocks` mesh.

`updateSpeedField(x, z)` — the per-frame entry point:

```js
// Re-centre the field on the player. VIEW-LAYER ONLY: called from settleView(), never from the tick.
// Consumes NO randomness at all, so it is replay-neutral by construction (DECISIONS §73).
//
// WARP-STREAK HOOK (deliberately not built — out of scope): this is the single per-frame place that
// already holds the player transform and every layer's material. A future velocity-stretch pass hangs
// off HERE (read G.player.vel, feed a uStretch uniform after swapping PointsMaterial for a ShaderMaterial).
// Do not add it now.
export function updateSpeedField(x, z) {
  if (!speedField) return;
  for (const L of speedField.layers) {
    if (wrapField(L.pos, x, z, L.half)) L.points.geometry.attributes.position.needsUpdate = true;
  }
}

// Headless-test hook (see the 31-speed-field scenario): the live layers, [] before the first buildMap.
export function speedFieldLayers() { return speedField ? speedField.layers : []; }
```

**2e. `buildSpeedFieldFolder(gui)`** (exported from `world.js`, called by the Backdrop panel in Step 4):

- A folder titled `Speed field` containing a colour control bound to `spec.color` and one sub-folder per
  layer (`Layer 0 (near)` / `1 (mid)` / `2 (far)`) with `count`, `size`, `radius`, `depth`, `depthVar`,
  `opacity` sliders using `SPEED_FIELD_RANGES`.
- **`size` / `opacity` / `color` → `onChange`**: write straight to the live material (no re-scatter, so a
  slider drag doesn't make the field jump).
- **`count` / `radius` / `depth` / `depthVar` → `onFinishChange`**: rebuild the field from the spec
  (`disposeSpeedField()` + `makeSpeedField(spec)`); re-randomising there is expected.
- Both paths call `saveSpeedTune(window.localStorage, spec)` so a reload keeps the dialled-in look
  (dev-only: `buildMap` applies the stored tune **only under `isDev()`** — players always get the
  descriptor).
- A **`Dump speed field → console`** button printing a paste-ready block, e.g.
  `console.log('speedField:', JSON.stringify(spec, (k, v) => k === 'color' ? '0x' + v.toString(16) : v, 2))`,
  with a one-line reminder that `radius` below `WRAP_SAFE_RADIUS` (600) puts the wrap boundary inside the
  frustum at max zoom-out.
- Add a disabled `note` row: `R < 600 → wrap edge enters the frustum at max zoom-out (pop-in)`.
  **Do not word it as "fog far"** — fog only covers the deep layers (see the "No pop-in" section).

### Step 3 — `client/src/sim.js`: drive the wrap from `settleView`

Extend the existing import at `sim.js:10` with `updateSpeedField`, and add one line to `settleView`
(`sim.js:834-842`), **after** the camera has been placed:

```js
  updateSpeedField(G.player.mesh.position.x, G.player.mesh.position.z); // player-locked backdrop (view-only, no RNG)
```

Update `settleView`'s doc comment (`sim.js:830-833`) to mention the speed field alongside stars/planet/moons.
This is the only call site, and it is correct for free in three places: live play, the deterministic
accumulator, and the pre-fight frozen frame (`main.js:1077`, `main.js:1158` call `settleView()` right after
`reset()` — so the Level-0 opening card is already framed with the field centred, no jump on play).

**Step 3b — expose the layers on the `?debug` hook.** Add `speedFieldLayers` to the `world.js` import at
`main.js:15`, and a getter to the `window.__game` object next to `smokePool` / `drops` (`main.js:811-812`):

```js
    get speedFieldLayers() { return speedFieldLayers(); }, // diagnostic: the wrapping backdrop layers (31-speed-field)
```

Each entry exposes `{ points, pos, half }` — enough for the outcome scenario in *Tests* to assert the
field really is centred on the player. `__game` is only attached under `?debug` (`main.js:790`), so this
is inert in the shipped build.

### Step 4 — `client/src/ghost-battle.js`: host the dev folder

In `buildBackdropPanel(GUI)` (`ghost-battle.js:128`), after the `Appearance` folder and before `Record`:

```js
  buildSpeedFieldFolder(gui); // ?dev live tuning for the player-locked speed field (world.js)
```

with `import { buildSpeedFieldFolder } from './world.js';` at the top (no import cycle: `world.js` does not
import `ghost-battle.js`). The panel is already dev-only, mouse-only and behind a dynamic `lil-gui` import,
so this costs players nothing. Update the panel's header comment to say it now hosts three groups
(ghost-battle appearance, speed field, record).

### Step 5 — `server/src/catalog_seed.js`: descriptor

In the `home-system` descriptor (the `asteroids:` line is `catalog_seed.js:676`), **replace the ring
comment above it (`:673-675`) and keep the key as a shim**:

```js
      // Parallax speed field: a fixed pool of point sprites that WRAPS around the player every frame, so
      // the same specks surround you everywhere in the system at constant cost (DECISIONS §96). Layers are
      // ordered near → far; `radius` is the wrap half-box and MUST stay >= 600 so a recycled point
      // reappears OUTSIDE THE FRUSTUM at max zoom-out (fog only hides the deep layers — THREE.Fog works on
      // view depth, not radial distance). Values are tuned live via the ?dev "Speed field" panel.
      speedField: {
        color: 0x6b6f78,
        layers: [
          { count: 420, size: 0.9, radius: 620, depth: 18,  depthVar: 20, opacity: 0.90 },
          { count: 300, size: 1.6, radius: 620, depth: 90,  depthVar: 40, opacity: 0.75 },
          { count: 200, size: 2.6, radius: 620, depth: 220, depthVar: 60, opacity: 0.55 },
        ],
      },
      // DEAD KEY — one-release COMPATIBILITY SHIM, not read by this client. db.js upserts this descriptor
      // on every server start, so the already-published itch bundle and the /v2 sandbox (older clients on
      // the live catalog) would throw in buildMap() if it vanished. DELETE THIS LINE in the first change
      // after the itch build has been re-published (/publish-itch) and /v2 redeployed from a main that
      // contains `speedField`. See DECISIONS §96.
      asteroids: { count: 2000, inner: 0, spread: 1000, color: 0x6b6f78, minSize: 0.18, maxSize: 0.5, depth: 10, depthVar: 24 },
```

`home-system` is the **only** entry in `MAPS`, so that is the whole "update ALL MAPS" task — but grep
`asteroids:` across `server/src/` to confirm before finishing.

Also fix the stale prose at `catalog_seed.js:677-684`: the set-pieces comment says "strong parallax like
the background asteroids" (→ "like the background speed field") and the `asteroid-field` note says "the
distant backdrop `asteroids` layer stays procedural" (→ "the distant backdrop is now the Points speed
field; only this up-close field uses the model — DECISIONS §71 + §96").

### Step 6 — no other code changes

`client/index.html`, `net.js`, `account.js`, `tune.js`, `hud.js` need no edits. Do **not** touch
`makeAsteroidField` / `loadAsteroidPack` / `asteroidMat` — the mission set-piece keeps its `.glb` pack.

### Step 7 — concept-word sweep (code comments)

Grep the plain concept words, not just the symbol, and **include `client/assets/` and `client/locales/`**
(a past retro flagged exactly this class of miss — the code-symbol grep is not the sweep):

```
grep -rniE "makeAsteroids|parallax ring|parallax backdrop|backdrop asteroid|background asteroid|distant rocks|asteroid" \
  client/src client/visual client/assets client/locales client/index.html server/src docs
```

Reconcile **every live site**:

- `client/src/world.js:1-2` — header ("the planet + moons + parallax asteroids") → speed field.
- `client/src/world.js:386-392` — the `.glb` pack rationale still explains why the *backdrop* isn't the
  model. Rewrite: the backdrop is now a wrapping **Points** field (cheaper still), the pack is for the
  mission field only.
- `client/src/world.js:423-427` — the ring comment: deleted with the function (Step 2a), replaced by the
  speed-field comment.
- `client/src/world.js:733` — the **RNG contract** comment lists "the parallax ring" as a native-`Math.random`
  decor site. It must now name **the speed field** (and note that the field's per-frame wrap draws no
  randomness at all).
- `client/src/main.js:128` and `main.js:1500` — both say "asteroids" when describing what `buildMap` builds.
- `client/src/engine.js:17` — the fog line's comment ends "so distant rocks fade into the backdrop".
  Reword to the speed field (and, given BLOCKING 1, do **not** imply fog is what hides the wrap edge).
- **`client/assets/CREDITS.md:29`** — the row for `ships/asteroids_combat.<hash>.glb` describes the usage as
  "asteroid pack, 3 rock meshes — **the parallax backdrop field** + the mission asteroid-field rocks". That
  first use no longer exists. Change the usage text to name **only** the mission `asteroid-field`
  set-piece.
  **This is a PROSE/USAGE fix, not an attribution change:** the CC-BY 4.0 row, its author/source/licence
  columns and the `§CREDITS` block **STAY** — the asset is still in use, so per `CLAUDE.md` its attribution
  must remain. Do not remove the row, and do not raise a credits question: nothing is added, replaced or
  removed here.
- **`client/locales/source.json:655`** — the mining side-mission copy ("The mining stations in our
  **asteroid belt** …") is a **FALSE POSITIVE**: player-facing narrative about the mission's location, not
  about the backdrop layer. **Do not touch it** (and do not touch any translated locale file).
- `client/visual/scenarios/22-intro-replay.mjs:7` mentions the *procedural `asteroid-field` branch* — that
  is the **mission set-piece**, still accurate. **Leave it.**

### Step 8 — tests: three new files (full detail + commands in *Tests* below)

`client/src/speed-field.test.js` (pure mechanism), **`client/visual/scenarios/31-speed-field.mjs` (the
outcome test — the field still surrounds the player after roaming 4000 units out; this one is not
optional)**, and `server/src/maps_speedfield.test.js` (descriptor shape + the shim).

### Step 9 — docs (see *Docs to update*)

## Tests

### New: `client/src/speed-field.test.js` (`cd client && node --test`)

Mirrors `ghost-battle-track.test.js` in spirit. Cover:

1. `wrapDelta` — `0 → 0`; a value inside `(-half, half)` is returned unchanged; `+half → -half`;
   `-half - 1` and `+half + 1` land inside the range; a delta of `7.3 * span` lands inside in ONE call.
2. `wrapField` — every point inside the box → returns `0` (**the no-upload path**), and the array is
   byte-identical afterwards.
3. `wrapField` — a point beyond `+half` on x is brought into `[cx-half, cx+half)` **and the displacement is
   an exact multiple of `2*half`** (the treadmill must not drift the pattern).
4. **Idempotence** — calling `wrapField` twice with the same centre returns `0` the second time.
5. **Teleport** — centre jumps 10 spans away; one call brings *all* points into range.
6. x and z wrap independently; **`y` is never written**.
7. `scatterLayer` — length `count*3`; all x,z within `[-radius, radius)`; all y within
   `[-(depth+depthVar), -depth]`; **the RNG contract**: with an injected counting stub it uses *only* the
   injected rng (assert the call count equals the number of draws), which is what lets production pass the
   native `Math.random`.
8. `normalizeSpeedField(undefined)` and `normalizeSpeedField({ layers: [{ count: 5 }] })` → complete,
   clamped specs (guards an old/partial DB row).
9. **The no-pop-in invariant:** every layer in `SPEED_FIELD_DEFAULTS` has `radius >= WRAP_SAFE_RADIUS`
   (comment the assertion with *why* 600 — frustum reach at ZOOM_MAX for the shallow layers, fog for the
   deep ones — so the next reader doesn't "simplify" it back to `fog.far`).
10. `loadSpeedTune`/`saveSpeedTune` round-trip against a fake `{getItem,setItem}`; a throwing store and
    malformed JSON both fall back to the passed default (no crash).

### New (THE OUTCOME TEST): `client/visual/scenarios/31-speed-field.mjs`

**Why this is mandatory:** tests 1-10 above are *mechanism* tests on pure helpers — they prove
`wrapField`/`scatterLayer` are self-consistent. **None of them proves the feature.** Wiring
`updateSpeedField` to the camera instead of `G.player.mesh.position`, wrapping only x, calling it before
the camera is placed, or **forgetting the `settleView` line entirely** would leave all ten green. This
scenario asserts the thing the feature exists for: *after roaming far, the field still surrounds you.*

Model it on `08-arena-boundaries.mjs`, which already launches from whichever menu is up and teleports the
player (`__game.player.mesh.position.set(...)` + `vel.set(0,0,0)`). Scenarios are auto-discovered from the
directory (`run.mjs:83-90`), so no registration is needed. Steps + **exact assertions**:

1. Launch a fight the way `08` does (click `#mw-go` or `#takeoff`), `waitForTimeout(300)`.
2. Read `const L = __game.speedFieldLayers` → assert `L.length >= 1`, and for each layer
   `half > 0` && `pos.length > 0` && `pos.length % 3 === 0`.
3. Snapshot the y column of every layer (`Array.from(pos).filter((_, i) => i % 3 === 1)`) and each layer's
   `pos.length`.
4. Teleport: `__game.player.mesh.position.set(4000, 0.6, -4000); __game.player.vel.set(0, 0, 0);`
   then `waitForTimeout(200)` (the live loop steps at 60 Hz; one tick is enough, this is slack).
5. For **every** layer assert:
   - `max |x_i − player.x| <= half` **and** `max |z_i − player.z| <= half` — the field followed the player
     4000 units out. The **z** bound is what catches a camera-centred mis-wire (the camera sits +26 z from
     the player at default zoom, so a camera-centred box would push points up to `half + 26` away and with
     ~900 points that band is reliably populated); the **x** bound catches "wrapped z only", and either
     bound catches a missing `settleView` call (points would be ~4000 away).
   - `pos.length` is unchanged — a **fixed pool**, nothing allocated or destroyed by roaming.
   - the y column is **identical** to the snapshot — the wrap is XZ-only and never disturbs layer depth.
6. `await shot('speed-field-far')` for the artifact folder.

Run it alone with `cd client && node visual/run.mjs 31-speed-field`.

### New: `server/src/maps_speedfield.test.js` (`cd server && npm test`)

Pure import of `MAPS` (no DB — same shape as `enemy_total.test.js`): every map descriptor has a
`speedField` with ≥1 layer, every layer's `radius >= 600` (assert against the *reason*, in a comment: the
shallow layers' frustum reach at ZOOM_MAX — **not** `fog.far`), `count > 0`, and the shim `asteroids` key is
still present (so the compat decision is pinned and its later removal is a conscious edit that updates
this test). Note in a comment that this last assertion is deleted together with the shim.

`server && npm test` drops+recreates the local `spacegame_test` DB via `pretest`; `db.js` is the single
data layer. No server source changes in this feature — run it to prove the seed still loads.

### Visual suite

```
cd client && node --test                              # unit tests (incl. the new speed-field.test.js)
cd client && node visual/run.mjs 31-speed-field       # THE OUTCOME TEST (new, see above)
cd client && node visual/run.mjs 22-intro-replay      # the guard — must pass UNCHANGED (4 kills, p0..p4, win)
cd client && node visual/run.mjs                      # full suite
cd server && npm test                                 # drops+recreates spacegame_test; incl. maps_speedfield.test.js
```

**There are no pixel baselines** (`client/visual/run.mjs:12-15`: screenshots are review artifacts,
assertions are logic/DOM/`window` hooks). So instead of regenerating anything:

- judge by the **reliably-passing set + zero page errors**; ~6 scenarios flake at baseline and that is
  **not** a regression signal (re-run a suspicious failure before calling it real);
- then **eyeball** `client/visual/__screenshots__/` for **`01-smoke`, `04-combat`, `09-mission-setpieces`,
  `22-intro-replay`** (+ the new `31-speed-field`) — those frames show the backdrop. Expected difference: the chunky grey rocks are
  replaced by finer fog-faded specks; expected to be **unchanged**: ship/HUD framing, the mission
  set-pieces (including the up-close `asteroid-field` rocks), the nebula/star sky.

### Replay / intro impact

The change touches **no sim code**: `settleView` runs at the very end of `update()` after all sim work, the
field is not in any update array, and it draws zero randomness (one-time scatter uses the native
`Math.random`, the wrap uses none). The recorded intro trace's deterministic re-sim is therefore bit-identical.
Still, run the guard (above) **and** the manual pass in *Live test*.

### Live test (after deploy)

1. Reset progress → play the **Level-0 intro** end-to-end → it must reach victory + the Level 1 briefing.
2. Fly a normal level: the field surrounds the ship, the parallax reads (near specks sweep faster), and
   **no points pop in/out at the screen edge** — including while zoomed fully out.
3. Fly *far* out of the arena past the OOB warning (this is the whole point): the field is still there,
   still the same density, no empty space.
4. Open with `?dev`, dial the "Speed field" folder, hit **Dump speed field → console**, and hand the block
   back for `catalog_seed.js`.

## Docs to update (part of the change, per CLAUDE.md)

**`docs/SUMMARY.md`** — bump `**Updated:**` (line 6) and lead with this change; then edit **in place**:

- **1339-1355** — the "Background in 3 layers" bullet: rewrite the middle layer as the **player-locked
  wrapping speed field** (fixed pool of ~920 `THREE.Points` in 3 depth layers, one draw call each,
  re-wrapped each frame into a ±R box around the player from `settleView`, per-map `color`/density from the
  descriptor's `speedField`, sprite = the shared procedural canvas dot). State the no-pop-in rule
  **correctly**: `radius ≥ 600` keeps the wrap edge **outside the frustum** at max zoom-out for the shallow
  layers, while the deep layer is covered by fog (its view depth there exceeds `fog.far`) — and note that
  `THREE.Fog` works on view depth, not radial distance, so the margin is aspect-ratio dependent
  (tight past ~2.4). Delete the `makeAsteroids`/InstancedMesh/40k-tris/annulus wording. Point at
  `client/src/speed-field.js` (pure math/defaults) + `world.js` (`makeSpeedField`/`updateSpeedField`) +
  `sim.js settleView` (the per-frame call site) — the file-map pointer matters.
- **1319-1320** and **1391** — "strong parallax like the background asteroids" → "like the background speed
  field".
- **1404** — "the distant backdrop `asteroids` layer stays procedural" → the backdrop is now the Points
  speed field; only the up-close mission field uses the `.glb` pack.
- **408** — the §73 note "asteroid/decor layout now varies between two playbacks" → "backdrop/decor layout".
- **278-281** — the `?dev` Backdrop panel now also hosts the **"Speed field"** folder (per-layer sliders +
  dump-to-console).
- **1836** — the `maps` descriptor key list: `stars, asteroids` → `stars, speedField` (+ a note that the
  dead `asteroids` key is a one-release shim).
- **2223** — the `world.js` domain line: "arena + sky/planet/moons/asteroids/set-pieces" → "…/speed
  field/set-pieces"; add `speed-field.js` to the pure-module list in the same section.
- **~2355-2368** — the visual-suite scenario roll-call: add **speed-field** (`31-speed-field.mjs`:
  teleports the player 4000 units out and asserts every layer's points are still inside `±half` of the
  player on both x and z, with the y column untouched and the pool size unchanged — the guard that the
  backdrop is player-locked and not camera-locked/origin-anchored), in the same one-sentence style as the
  neighbouring entries.

**`docs/CHANGELOG.md`** — one bullet under `## 2026-08-09`:
> **Parallax backdrop is now a player-locked wrapping speed field** — the origin-anchored 2000-rock
> asteroid ring is gone; a fixed pool of ~920 point sprites in 3 depth layers wraps around the player every
> frame (view-layer only, from `settleView`), so the same sense of speed surrounds you everywhere in the
> system at constant cost — the ring left you in empty space once you roamed. Per-map colour/density moved
> to the descriptor's `speedField`; the old `asteroids` key is kept for one release so already-published
> itch/`/v2` clients don't break. New `?dev` "Speed field" tuning folder, new pure `speed-field.js` +
> unit tests + a `31-speed-field` headless scenario (teleport 4000 units out, the field is still centred on
> the ship); intro-replay guard green. DECISIONS §96, docs/plans/2026-08-09-1410-player-locked-speed-field.md.

**`docs/DECISIONS.md`** — new **§96** (next free number; §94 is the just-committed cruise assist), placed
after §94 and before `## Future ideas`. It must record: the origin-ring problem and why a player-locked
wrapping field beats it for roaming travel (cite **§94** as the motivation); why **Points** over instanced
rock meshes at this camera (near-top-down, sub-pixel specks — the silhouette detail was never visible;
~920 points / 3 draw calls vs 2000 instances / ~40k tris); the **no-pop-in rule and its real mechanism** —
`radius ≥ 600` puts the wrap edge outside the **frustum** at `ZOOM_MAX` for the shallow layers (which never
even reach `fogNear`), with **fog as the backup for the deep layers only**, because `THREE.Fog` fogs on
view depth and this camera is near-top-down (record this explicitly: it is the exact trap the plan's first
draft fell into, and the margin is aspect-dependent past ~2.4); that it is
**client-only render decor, driven from `settleView` (not the tick), and
consumes zero sim RNG (§73)**; that **it supersedes the *backdrop* half of §71** while §71's mission-field
half (real `.glb` rocks up close) still stands; and the **`asteroids` compatibility shim + its explicit
removal condition** (delete after the next `/publish-itch` + `/v2` redeploy from a `main` containing
`speedField`; `db.js` upserts descriptors on every server start, so an old client on the live catalog would
throw in `buildMap` without it). Also add a one-line pointer at the top of **§71**: *"Superseded for the
distant BACKDROP half by §96 (the backdrop is now a player-locked wrapping Points speed field); the mission
`asteroid-field` half below still stands."* — a pointer, not a rewrite.

**`client/assets/CREDITS.md`** — a **usage-prose fix only** (Step 7): line 29's usage text must stop
claiming the rock pack feeds "the parallax backdrop field". **No attribution change**: nothing is added,
replaced or removed, the asset is still in use in the mission `asteroid-field` set-piece, so the CC-BY 4.0
row and the in-game `§CREDITS` screen entry **stay** (per `CLAUDE.md`). No credits question to raise —
the new point sprite is the existing procedural canvas texture, not an asset.

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **Warp / velocity-stretch streaking.** Ship the wrapping + parallax field only. The hook is the
  documented single per-frame call site in `updateSpeedField` (Step 2d) — comment only, no uniforms, no
  shader, no unused parameters.
- Collidable/shootable backdrop rocks, any sim registration, any server field.
- Touching the mission `asteroid-field` set-piece, `loadAsteroidPack`, the star layers, the nebula bake, or
  the ghost battle.
- Quality-tier gating of the field (points are cheap; add it only if a device actually shows a cost).
- A menu-only wrap path, a foreground (above-plane) layer in the shipped values, or the cruise-assist
  travel mode itself (§94, still unbuilt).
- Removing the `asteroids` shim in this change — that is a deliberate *next* release chore (Decision 2).
