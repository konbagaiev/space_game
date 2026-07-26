# Freighter + engine exhaust → shared GPU/baked-texture FX (Vega Sentinels)

**Feature ID:** 2026-07-26-2114-freighter-exhaust-fx
**Status:** ready to implement
**Scope discipline:** DECISIONS §30 — build the smallest thing that fully delivers; push the big
"general tuning system" to ROADMAP (docs only).

---

## Goal

Convert **both** engine-exhaust systems in the game — the cargo-freighter set-piece plume
(`client/src/world.js` `makeFreighter`) **and** every ship's engine trail (player + enemies,
`emitExhaust`/`spawnTrail` in `client/src/projectiles.js`) — from the current per-frame CPU-simulated
particle clouds to a single, shared, **additive, baked-texture-once, shader-driven** exhaust plume, in
the same visual family as the recent `bolt-fx.js` and `flipbook-fx.js` FX pass. Priority is **beauty +
one unified FX style**; perf is explicitly secondary (both are already cheap in absolute terms). The
plume is **axis-aligned** (streams along the model's aft `-Z` axis), not a camera-facing billboard,
because a billboard fights the stream direction under the near-top-down camera. A new
`client/src/exhaust-fx.js` module owns the shared glow texture, the plume factory, and a `?dev` tuning
panel; `world.js` and `projectiles.js` become thin callers.

Every plume (freighter + player + enemies) ships with **two selectable looks** so the maintainer can pick
the final one by eye on a live build: **(a)** a silhouette-preserving baked-glow *point* plume (the
default), and **(b)** a bolder continuous **noise-scroll flame** plume. The `?dev` mode dropdown switches
**all** plumes at once. The panel also tunes the freighter's palette/count/len/size/speed (plus new
softness/turbulence knobs) and has a **Copy JSON** button to export the tuned numbers for pasting back
into the module defaults.

**Deliberate, accepted visual trade-off (maintainer-approved):** the per-ship engine trail currently
*curves* because it is a history of past emit positions. The converted trail is a **rigid, always-straight
axis-aligned plume attached to the ship** (same primitive as the freighter). We intentionally drop the
curved position-history — it is simpler, cheaper, and reads as one FX style with the freighter. Recorded
in DECISIONS §74.

---

## Decisions (all resolved — do not re-ask)

1. **Both looks, toggled live, default (a).** Build (a) point-glow plume (silhouette-preserving) AND (b)
   noise-scroll flame; the `?dev` mode dropdown switches ALL plumes (freighter + every ship) between them
   at once; default `mode: 'points'`. Do not over-polish (b) — a solid single noise-scroll flame is
   enough; live tuning refines it.
2. **Primitive: axis-aligned plume** (bolt-fx family), aligned to the aft `-Z` axis. NOT a camera-facing
   flipbook billboard.
3. **Scope = both systems.** Freighter set-piece exhaust + per-ship engine trails, both onto the shared
   `exhaust-fx.js` plume. Per-ship trail becomes a **straight** attached plume (see trade-off above).
4. **The A/B look toggle is GLOBAL — ships AND freighter honor the current mode.** Every plume (freighter
   set-piece + player + all enemies) builds BOTH mode meshes and renders whichever the shared
   `currentMode` selects (default `'points'`). The `?dev` mode dropdown switches ALL live plumes at once
   (freighter + every attached ship plume), and any plume that attaches later picks up `currentMode`. Per-
   ship cost stays sane: one Points mesh + one **shared-geometry** flame quad per ship (only the active one
   `visible`) — the flame quad geometry is a module singleton, so N ships do not multiply geometry.
5. **`spec.exhaust` stays back-compatible.** No `server/src/catalog_seed.js` change. Existing keys
   (`palette{hot,mid,end}`, `count`, `len`, `size`, `speed`) keep working; new knobs
   (`turbulence`, `softness`) are optional-with-defaults.
6. **Tuning surface (now):** a `?dev` lil-gui panel (mirrors the `?dev` Backdrop panel in
   `ghost-battle.js`) that live-edits an in-memory `EXHAUST_TUNE` (seeded from the module defaults) and a
   **Copy JSON** button. **No localStorage persistence** — Copy JSON is the "save" path (paste back into
   module constants). This keeps prod behavior driven only by `spec.exhaust` + defaults, never by a
   dev-session tune.
7. **Replay-safe by construction.** `exhaust-fx.js` uses NO `simRandom()` and NO `Math.random` at all —
   per-particle seeds are a deterministic `hash(i)` (like `flipbook-fx.js`). Nothing touches
   sim/damage/collision/economy or the seeded stream (`sim-random.js`). The intro re-sim is bit-identical.
   See "Replay/intro impact" below and the mandatory Stage gate in Tests.

---

## Background the implementer needs (current state, with anchors)

- **Freighter plume** — `client/src/world.js` `makeFreighter(spec)` (~646–715). A persistent
  `THREE.Points` cloud of `N ≈ 90` particles, CPU-recomputed every frame (both `position` **and**
  `color` buffers re-uploaded: `egeo.attributes.position.needsUpdate` + `.color.needsUpdate`, lines
  709). Config from `spec.exhaust` (`palette.hot/mid/end`, `count`, `len`, `size`, `speed`). Emitter
  origin `emit` (Vector3) and lateral `spread` are **mutable** and set **async** from the loaded glb's
  real group-local rear bounds (lines 693–695: `emit.set(0, midY, lbox.min.z)`,
  `spread = (width) * 0.2`). Per-particle phase `et[i]` + offset `eoff[i]` are seeded once with
  `Math.random()` at build (line 671). The per-frame update math is
  `t = et[i]`; `sp = 1 + t*4`; `pos = emit + (offset * spread * sp)` laterally and `emit.z - t*len`
  along aft; color = 2-segment lerp `hot→mid→end` across `t` (lines 699–708). **Preserve this exact
  math** for mode (a).
- **Per-ship trail** — `client/src/projectiles.js`:
  - `emitExhaust(mesh, fwd, shipVel, exhaust)` (214–225): tier-gated (`liveParticles() >= maxParticles`
    ceiling; `Math.random() > particleScale` thinning), spawns a puff at the model tail
    (`mesh.userData.tailZ`) with lateral `Math.random()` jitter.
  - `spawnTrail(pos, fwd, shipVel, exhaust)` (199–212): one additive `SphereGeometry` puff
    (`trailGeo`, 197) with a per-puff `MeshBasicMaterial` tinted `exhaust.color`, pushed into the `trail`
    pool with a velocity `shipVel + (-fwd*exhaust.speed)`.
  - The **RNG CONTRACT** comment (projectiles.js 6–9) is explicit: FX here use **native `Math.random`**,
    never `simRandom`, so replays survive FX changes (DECISIONS §73).
  - Call sites in `client/src/sim.js`: player idle (258), player thrust (470), enemy thrust (510).
  - Pool drain in `sim.js` `updateTrail`-style loop (655–668): move by `vel`, fade opacity + shrink,
    dispose at `life<=0`.
  - `trail` pool lives in `client/src/state.js:77`; counted by `liveParticles()`
    (projectiles.js 69 = `trail.length + sparks.length + smoke.length`); cleared in `sim.js` `reset()`
    (838–839); exposed on `window.__game` (main.js 11 import, 684 export).
- **Engine catalog** — `server/src/catalog_seed.js` engine `stats.exhaust` blocks
  (`{ color, speed, life, size, spread }`, e.g. ids 5/6/7/15/16/23/26). **Unchanged** by this feature.
- **`?dev` panel pattern** — `client/src/ghost-battle.js` `buildBackdropPanel(GUI)` (124–157): builds a
  lil-gui panel, dynamic-imported + called under `isDev()` in `client/src/main.js` bootstrap
  (1370–1374). `isDev()` from `client/src/dev.js`.
- **Reference FX** — `client/src/bolt-fx.js` (bake-once radial glow texture; shared geometry; per-instance
  tinted material; flat-in-plane) and `client/src/flipbook-fx.js` (bake-once canvas texture; ONE shared
  shader source → one compiled program; per-instance ShaderMaterial with uniforms; deterministic
  variety via a module counter/`hash`, no `Math.random`). **Match these patterns exactly** (no
  per-frame allocations; reuse temporaries; bake textures once).

---

## Steps

### 1. New module: `client/src/exhaust-fx.js`

Create the module modeled on `bolt-fx.js` + `flipbook-fx.js`. It exports the shared texture, the plume
factory, freighter + ship helpers, the update pass, and the `?dev` panel builder.

**1a. Shared baked glow texture (once).** A soft round glow (white core → transparent rim), built lazily
on a `<canvas>` like `boltTexture()` but circular (not elongated). `SRGBColorSpace`, `needsUpdate`.
`let glowTex = null; function glowTexture() {…}`. Used by mode (a) point sprites and, if convenient, as a
soft-edge mask for (b).

**1b. Deterministic hash (no RNG).** Copy the `hash(a,b,c)` helper from `flipbook-fx.js` (sin-based, in
`[0,1)`). Use it to seed per-particle attributes so the plume is byte-identical run-to-run and
replay-neutral. **Never** call `Math.random` or `simRandom`.

**1c. Module defaults + tune object.**
```js
// Shipped defaults (paste tuned values here after ?dev tuning). Freighter reads spec.exhaust ?? these.
export const EXHAUST_DEFAULTS = {
  mode: 'points',            // 'points' (a, silhouette-preserving) | 'flame' (b, noise-scroll)
  count: 90, len: 48, size: 5, speed: 1.4, spread: 3,
  palette: { hot: 0xfff1c0, mid: 0xff7a2a, end: 0x7a1208 },
  turbulence: 0.4,           // NEW: lateral wobble amount (0 = laminar)
  softness: 1.0,             // NEW: glow edge falloff multiplier
};
// Live-editable copy the ?dev panel mutates (never used by prod; dev session only).
const EXHAUST_TUNE = structuredClone(EXHAUST_DEFAULTS);

// GLOBAL active look, shared by ALL plumes (freighter + every ship). Seeded from the shipped default;
// the ?dev mode dropdown flips it and fans it out to every live plume (Step 1g). New plumes that attach
// later read this at build time so they come up in the current look.
let currentMode = EXHAUST_DEFAULTS.mode;   // 'points' | 'flame'
```

**1d. Plume factory `makePlume(cfg)`.** Returns `{ obj, setMode(m), setThrottle(v), applyCfg(cfg),
update(dt), dispose() }`. `cfg` = `{ count, len, size, speed, spread, palette{hot,mid,end}, turbulence,
softness, singleColor? }`. **Every plume (freighter AND ship) builds BOTH mode meshes** and calls
`setMode(currentMode)` at the end of construction so it comes up in the global look. Internals:

- **Mode (a) — point-glow plume (default).** A `THREE.Points` whose geometry carries the per-particle
  seed data ONCE (no per-frame re-upload). Pack into a single `position` attribute:
  `position[i] = (lateralX, lateralY, seed)` where `lateralX = hash(i,1,0)-0.5`,
  `lateralY = hash(i,2,0)-0.5`, `seed = hash(i,3,0)`. `ShaderMaterial` (AdditiveBlending,
  `depthWrite:false`, `transparent`, `fog:false`) with uniforms:
  `uTime, uLen, uSize, uSpeed, uSpread, uTurb, uThrottle, uOrigin(vec3), uColHot/uColMid/uColEnd(vec3),
  map(glowTexture())`. Vertex shader reproduces the CURRENT freighter math so mode (a) preserves the
  silhouette:
  ```glsl
  float seed = position.z;
  float t = fract(seed + uTime * uSpeed);       // life fraction 0..1
  float sp = 1.0 + t * 4.0;                      // spread grows downstream (matches world.js)
  float wob = sin((seed + t) * 6.2831) * uTurb;  // deterministic lateral wobble (turbulence)
  vec3 p = uOrigin + vec3((position.x + wob) * uSpread * sp,
                          (position.y) * uSpread * sp,
                          -t * uLen);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * uThrottle * (300.0 / -mv.z);   // perspective-scaled world-ish size
  gl_Position = projectionMatrix * mv;
  vT = t;                                          // varying → fragment
  ```
  Fragment: palette lerp `hot→mid→end` across `vT` (2 segments, matching world.js), sample
  `texture2D(map, gl_PointCoord)`, output `vec4(col, tex.a * uThrottle * softness * tailFade(vT))`
  additive. (`uThrottle` = 1 for the always-on freighter; ships fade it with thrust — see 3c.)
- **Mode (b) — noise-scroll flame quad.** A shared unit `PlaneGeometry(1,1)` (reused across all flame
  plumes, like `flipbook-fx` `quadGeo`), oriented flat and extended along `-Z`: scale `(spread*2, 1,
  len)` and rotate so the plane lies in the model's local XZ plane with its long axis down `-Z`,
  positioned at `uOrigin`. `ShaderMaterial` (same additive settings) with `uTime` scrolling procedural
  fbm-ish noise (a couple of `sin`-based octaves in the fragment — no texture fetch loop needed) **along
  the length**, tapering width toward the tip and fading the tail, colored by the palette along the
  length. Keep it one draw call, deterministic (time-driven only). This is the "bolder flame"; a solid
  first version is enough.
- **Both meshes** are created but only the active `mode`'s mesh is `visible`. `setMode` toggles
  visibility. Geometry: mode-(a) Points geometry is per-plume (count-sized, baked once); the flame quad
  geometry is a shared module-level singleton. Per-plume `ShaderMaterial`s reuse the shared vertex/frag
  **source strings** (one compiled program each per mode, like flipbook).
- `update(dt)`: `uTime.value += dt` on the active material (and advance throttle decay for ships, see
  3c). **No buffer re-uploads.** No allocations.
- `dispose()`: dispose both `ShaderMaterial`s; remove `obj` from its parent. Do **not** dispose the
  shared glow texture or shared flame quad geometry (kept alive for the session, like bolt/flipbook).

**1e. Freighter helper `makeFreighterExhaust(spec)`.** Reads `cfg` from `spec.exhaust` merged over
`EXHAUST_DEFAULTS` (missing keys fall to defaults; `spec.exhaust` absent → all defaults). Builds a plume
via `makePlume(cfg)` at full throttle. Returns `{ obj, setOrigin(vec3, spread), update(dt), plume }` so
`world.js` can push the async-derived emitter origin + spread into the plume's `uOrigin`/`uSpread`
uniforms. Register this as the module's `activeFreighterPlume` (weakly — clear it in `dispose`) so the
`?dev` panel can retarget it live. Under `?debug`/headless (`location.search.includes('debug')`) the
plume still builds (mode a) — the visual suite needs it; do NOT gate it off like nebula bakes.

**1f. Ship helper + registry.**
- `const shipPlumes = new Set();`
- `export function attachShipExhaust(mesh, exhaust)`: if `mesh.userData.exhaustPlume` exists, return it.
  Else build a plume via `makePlume({ ... , singleColor: exhaust.color, count: tierScaledCount, ... })` —
  the SAME factory as the freighter, so it builds **both** mode meshes (points + flame) and comes up in
  the global `currentMode` (no ship-only mode restriction). Derive a 3-stop palette from the single engine
  color (hot = brightened, mid = `exhaust.color`, end = darkened) so the shared shader path works
  unchanged, set `uOrigin` to the ship tail `(0,0, (mesh.userData.tailZ ?? -1.6))` in the ship's local
  space, parent `plume.obj` to `mesh` (so it is rigidly straight along the ship's nose and follows
  position + yaw for free), cache on `mesh.userData.exhaustPlume`, add to `shipPlumes`, `throttle = 0`.
  `count` scaled by the live tier (`Math.max(1, Math.round(exhaust.count?? DEFAULT * G.gfx.particleScale))`
  — reuse the ship trail's tier intent; a smaller default count than the freighter, e.g. 24, since it is
  per-ship). The per-ship **flame quad reuses the shared module-singleton geometry** (Step 1d), so N ships
  do NOT multiply flame geometry — only per-ship `ShaderMaterial`s (as with the points mesh).
- `export function disposeShipExhaust(mesh)`: if a cached plume exists, `plume.dispose()`, delete
  `mesh.userData.exhaustPlume`, remove from `shipPlumes`.
- `export function updateShipExhaust(dt)`: for each plume in `shipPlumes`, advance `uTime` and decay
  throttle toward its per-frame target then reset the target to 0 (so a ship that stops thrusting fades
  out): `throttle += (throttleTarget - throttle) * min(1, dt*8); throttleTarget = 0`.
  **Field-name contract — use exactly these two names everywhere (do NOT introduce `target`):**
  `emitExhaust` (Step 3a/3c) sets `plume.throttleTarget` (the "thrusting this frame" flag);
  `updateShipExhaust` reads `plume.throttleTarget`, updates `plume.throttle` (the smoothed value the
  shader's `uThrottle` uniform reads), then zeroes `plume.throttleTarget`.

**1g. `?dev` panel `buildExhaustPanel(GUI)`.** Mirror `buildBackdropPanel`. **Two distinct scopes — make
this split explicit so the maintainer isn't surprised:** the **Mode toggle is GLOBAL** (retargets every
plume); the **Palette + Shape sliders are freighter-only** (`activeFreighterPlume`). Ships derive their
own palette from each engine's color (Step 1f `derivePalette`), so recoloring/resizing the freighter does
NOT recolor/resize ships — only the mode toggle is shared. Folders:
- **Mode (global):** dropdown `mode` ∈ `['points','flame']` → set the module-level `currentMode = v`, then
  fan it out: `activeFreighterPlume?.setMode(v)` **AND** `for (const p of shipPlumes) p.setMode(v)`. Expose
  a tiny module helper `export function setGlobalExhaustMode(v)` that does exactly this, so the panel wires
  it once and future callers reuse it. (New plumes attaching afterward already read `currentMode` at build
  — Step 1d/1f.)
- **Palette (freighter-only):** `addColor` for `hot/mid/end` → `activeFreighterPlume?.applyCfg`.
- **Shape (freighter-only):** `count` (rebuilds the plume — count is baked into geometry; call
  `activeFreighterPlume?.rebuild(EXHAUST_TUNE)`), `len`, `size`, `speed`, `spread`, `turbulence`,
  `softness` → live uniform writes via `activeFreighterPlume?.applyCfg`.
- **Export:** a `Copy JSON` button →
  `navigator.clipboard?.writeText(JSON.stringify(EXHAUST_TUNE, null, 2))` + `console.log(EXHAUST_TUNE)`
  fallback.
- **status** hint (`.listen().disable()`): "freighter plume live" vs "no freighter (play the freighter
  mission)" — poll `activeFreighterPlume` like the backdrop panel's REC poll. (The Mode toggle still works
  with no freighter present — it retargets the ship plumes.)
  Palette/Shape edits mutate `EXHAUST_TUNE` (a copy) and apply to `activeFreighterPlume` only — **never**
  persisted, **never** touches prod defaults. The Mode toggle also sets the runtime `currentMode` only
  (not persisted).

### 2. Freighter: use the shared plume — `client/src/world.js`

In `makeFreighter(spec)` (646–715):
- Delete the inline exhaust: the `ex/pal/N/len/size/espd/cHot/cMid/cEnd/tmp` locals (651–660), the
  `epos/ecol/et/eoff` buffers + seeding loop (669–671), `egeo`/`emat`/`g.add(new THREE.Points…)`
  (672–676), and the per-frame exhaust block inside `update` (700–709). Keep `FREIGHTER_MODEL_LEN`, the
  glb loader, `spec.speed` cruise, and `spec.sync` drift.
- Import `makeFreighterExhaust` from `./exhaust-fx.js`. Build it from `spec` and `g.add(fx.obj)` where the
  old Points was added.
- Keep the mutable `emit`/`spread` **local** semantics: after the async glb bounds are computed
  (694–695), call `fx.setOrigin(emit, spread)` (push into the plume uniforms) instead of letting a
  per-frame loop read them. Set an initial pre-load origin (`emit(0,0,-60)`, `spread 3`) once at build so
  a plume shows immediately (matches the current "trail shows during load").
- In the returned `update(dt)`: call `fx.update(dt)` (advances `uTime`), keep the `spec.speed` cruise and
  `spec.sync` drift blocks unchanged.
- The freighter set-piece is torn down via the universal `setPieces` loop in `reset()`
  (`scene.remove(sp.obj)`, sim.js 870) — that removes the group but not the plume's materials. Add a
  `sp.dispose?.()` call to that teardown loop (see Step 4e) and have the freighter's set-piece object
  expose `dispose() { fx.dispose(); }`.

### 3. Per-ship trail: attached straight plume — `client/src/projectiles.js` + `client/src/sim.js`

**3a. `projectiles.js` — replace `spawnTrail`/`emitExhaust` internals.**
- Delete `trailGeo` (197) and the whole `spawnTrail` function (199–212).
- Import `attachShipExhaust` from `./exhaust-fx.js`.
- Rewrite `emitExhaust(mesh, fwd, shipVel, exhaust)` to **not spawn particles** — just mark thrust on the
  ship's attached plume:
  ```js
  export function emitExhaust(mesh, fwd, shipVel, exhaust) {
    const plume = attachShipExhaust(mesh, exhaust); // lazily builds + caches on mesh.userData
    plume.throttleTarget = 1;                        // decayed each frame in updateShipExhaust
  }
  ```
  Remove the `liveParticles()`/`maxParticles` early-out and the `Math.random` thinning/jitter (no longer
  spawning per-frame particles — the plume is a fixed-cost attached object). `fwd`/`shipVel` are now
  unused here (orientation comes from the parent mesh; keep the signature so sim.js call sites are
  unchanged). Tier scaling now happens once at attach (particle count), per Step 1f.
- `liveParticles()` (69): remove `trail.length` (the pool is gone) → `sparks.length + smoke.length`.
  Update the comment on 65–68 accordingly (trail no longer counted; the attached plumes are fixed-cost).
- Remove `trail` from the `state.js` import on projectiles.js line 12.

**3b. `sim.js` — swap the trail pool loop for the plume update.**
- Replace the `updateTrail` loop (655–668) with a single `updateShipExhaust(dt)` call (import from
  `./exhaust-fx.js`). Keep the comment describing engine exhaust.
- **Remove `trail` from the `state.js` import on sim.js line 7** (the import list also brings in
  `disposeShipExhaust`/`updateShipExhaust` from `./exhaust-fx.js` — add those). This is REQUIRED: with
  the `trail` export deleted in Step 4a, a leftover `import { … trail … }` is a link-time ESM error →
  total boot failure.
- The call sites at 258/470/510 stay as-is (`emitExhaust(...)` — now just sets throttle).

**3c. Throttle → visible fade.** `emitExhaust` sets `plume.throttleTarget = 1` on thrusting frames;
`updateShipExhaust` lerps `plume.throttle` toward `plume.throttleTarget` and zeroes `throttleTarget` each
frame, so a ship that stops thrusting fades its plume out smoothly (the shader multiplies alpha + point
size by `uThrottle`, which reads `plume.throttle`). The player-idle call at sim.js 258 keeps a faint idle
plume exactly where the old code shed idle exhaust. (Use the exact field names from the Step 1f contract —
`throttleTarget` and `throttle` — not `target`.)

### 4. Remove the dead `trail` pool + wire disposal

**Exhaustive `trail`-consumer edit list (every site — verified by grep; nothing here may be skipped).**
Deleting the pool breaks *every* importer, so all of these must change in the same pass:
| Site | What | Handled in |
| --- | --- | --- |
| `state.js:77` | `export const trail = []` — **delete** | 4a |
| `sim.js:7` | `import { … trail … }` — **remove `trail`** (add `updateShipExhaust`/`disposeShipExhaust`) | 3b |
| `projectiles.js:12` | `import { … trail … }` — **remove `trail`** | 3a |
| `main.js:11` | `import { … trail … }` — **remove `trail`** | 4b |
| `main.js:684` | `window.__game` export object lists `trail` — **remove** | 4b |
| `projectiles.js:69` | `liveParticles()` reads `trail.length` — drop it | 3a |
| `projectiles.js:211` | `trail.push(...)` in `spawnTrail` — **whole function deleted** | 3a |
| `sim.js:656–666` | `updateTrail` pool loop — **replaced** by `updateShipExhaust(dt)` | 3b |
| `sim.js:838–839` | reset teardown of the pool — **deleted** | 4c |
| `03-exhaust-trail.mjs:25/26/32/34` | reads `g.trail` — **rewritten** to read attached plumes | Test 2 |

After all edits, the only surviving `trail` hits are **rocket-smoke** trails + prose comments
(`graphics.js:9`, `world.js:664`, `projectiles.js:335`) — enforced by the Step 4f sweep gate.

**4a. `state.js`:** delete `export const trail = [];` (77).
**4b. `main.js`:** remove `trail` from the `state.js` import (11) and from the `window.__game` export
object (684). (Nothing else uses it after Step 3.)
**4c. `sim.js` reset:** delete the trail teardown (838–839). Add plume disposal at the two ship-removal
sites:
- Enemy death loop (734): before `scene.remove(enemies[i].mesh)`, call
  `disposeShipExhaust(enemies[i].mesh)`.
- Enemy reset clear (859): `for (const e of enemies) { disposeShipExhaust(e.mesh); scene.remove(e.mesh); }`.
  (The **player** mesh persists across `reset()` — its plume is attached once and kept; no disposal needed
  here. The ship-**swap** case is handled in 4d.)
**4d. `ship-build.js` player ship swap (GPU-leak guard).** `buildPlayerFor(ship, override)`
(`ship-build.js:73`) rebuilds the player and, at line 74, does `if (G.player) scene.remove(G.player.mesh);`
before creating a fresh mesh. The retired mesh carries a parented plume whose `ShaderMaterial`s would leak.
Import `disposeShipExhaust` from `./exhaust-fx.js` and dispose the retired mesh's plume on that line:
```js
if (G.player) { disposeShipExhaust(G.player.mesh); scene.remove(G.player.mesh); }
```
(This covers hangar ship changes, `?playback` exact-build swaps at main.js 790/840/959, and the bootstrap
build — every path that replaces `G.player.mesh`.)
**4e. `sim.js` set-piece teardown (870):** change to
`for (const sp of setPieces) { sp.dispose?.(); scene.remove(sp.obj); }` so the freighter plume's
materials are disposed (Step 2). Confirm no other set-piece defines `dispose` yet — the optional chaining
makes it a no-op for the others.
**4f. Sweep gate:** run `grep -rn "\btrail\b" client/src client/visual client/index.html` and confirm the
only remaining hits are **rocket-smoke** trails and unrelated prose (e.g. `graphics.js:9` comment,
`world.js:664` comment, `projectiles.js:335` smoke comment). No live reference to the deleted `trail`
pool may remain.

### 5. `?dev` panel wiring — `client/src/main.js`

In bootstrap, alongside the Backdrop panel (1370–1374), under the same `isDev()` block, dynamic-import and
call the exhaust panel:
```js
if (isDev()) {
  const { default: GUI } = await import('three/addons/libs/lil-gui.module.min.js');
  const { buildBackdropPanel } = await import('./ghost-battle.js');
  buildBackdropPanel(GUI);
  const { buildExhaustPanel } = await import('./exhaust-fx.js');
  buildExhaustPanel(GUI);
}
```
(Two lil-gui panels can coexist; each `new GUI({title})` docks separately, like `?tune` + Backdrop.)

---

## Replay / intro impact (mandatory analysis — DECISIONS §73)

- **Neither system touches the seeded sim stream.** `exhaust-fx.js` uses **no** `simRandom()` and **no**
  `Math.random` (deterministic `hash(i)` seeds only). The removed per-ship `Math.random` jitter/thinning
  was **native** `Math.random`, never `simRandom` (projectiles.js RNG CONTRACT) — so the seeded stream in
  `sim-random.js` is byte-identical before/after. No draw counts change in the seeded stream.
- **No sim/damage/collision/economy change.** This is pure render: geometry/material/texture swaps + a
  throttle uniform. Bullet/rocket/hitbox/reward code is untouched.
- **Intro (Level 0) re-sim is unaffected.** The intro mission has no freighter set-piece; ship engine
  plumes are pure render and the `22-intro-replay` guard asserts **sim state** (4 kills, cards p0..p4,
  win), not pixels. Cosmetic FX are replay-neutral since §73. Still, run the guard (Tests, Stage gate).
- **Draw order:** keep the freighter plume at default `renderOrder` on its below-plane group (as today)
  and ship plumes at default `renderOrder` (as the old trail puffs). Do not introduce a `renderOrder`
  that draws exhaust over ships in the combat plane.

---

## Tests

Run all from the stated dir. Client unit tests: `cd client && node --test`. Visual suite:
`cd client && node visual/run.mjs <scenario>` (baseline is flaky on ~6 scenarios — judge by the
reliably-passing set + zero page errors, per the visual-suite note).

1. **New unit test `client/src/exhaust-fx.test.js`** (`node --test`, no DOM/WebGL — test the pure,
   importable seams only; do not construct GL materials in the test). Cover:
   - `hash(i)` determinism: same inputs → same output; range `[0,1)`.
   - A pure `plumeCfg(spec, defaults)` merge helper (factor the `spec.exhaust ?? defaults` merge into a
     pure exported function): missing keys fall back to defaults; provided keys override; nested
     `palette` merges per-key.
   - A pure throttle-decay helper `decayThrottle(cur, target, dt)` (factor the lerp out of
     `updateShipExhaust`): reaches ~1 while `target=1`, decays toward 0 when `target=0`, never negative.
   - A pure `derivePalette(color)` (single engine color → `{hot,mid,end}`): mid === input; hot brighter;
     end darker.
   These are the testable seams that guard the config + fade invariants without WebGL.
2. **Update `client/visual/scenarios/03-exhaust-trail.mjs`.** The `g.trail` pool no longer exists.
   Rewrite the assertions to read the attached plumes: after seeding two thrusting enemies and waiting,
   assert each enemy has `e.mesh.userData.exhaustPlume` with `throttle > 0` and a plume whose stored
   `colorHex` (expose `plume.colorHex` = the engine `exhaust.color`) is in the set of enemy engine
   exhaust colors. Keep the `shot('thrusting')`. Update the file's header comment to describe the
   attached-plume model.
3. **New visual scenario (optional but recommended) `client/visual/scenarios/NN-freighter-exhaust.mjs`.**
   Seed the freighter mission (or directly `buildSetPiece` a freighter spec), wait for the glb + plume,
   assert `activeFreighterPlume` exists and `currentMode==='points'` by default, then call the
   `window.__game`-exposed **global** mode setter to `'flame'` and assert the flame mesh becomes visible
   on the freighter plume. Snapshot both. Because the toggle is GLOBAL, also assert it flips a ship plume:
   seed a thrusting enemy first, then after the global switch assert its `mesh.userData.exhaustPlume` is in
   flame mode too. (Expose a tiny hook, e.g.
   `window.__game.exhaust = { setGlobalExhaustMode, currentMode, activeFreighterPlume }`, gated like other
   `__game` debug hooks — reuse the existing `window.__game` object in main.js 684.)
4. **Mandatory intro guard (Stage gate — do not skip):**
   `cd client && node visual/run.mjs 22-intro-replay` MUST pass (asserts 4 kills / cards p0..p4 / win).
   This proves the FX conversion did not desync the recorded Level-0 re-sim.
5. **Full client unit suite** `cd client && node --test` green (verify `dev.test.js` and others unaffected
   by the `state.js`/`main.js` edits).
6. **Live look-tuning build (the point of the feature).** Get a playable build in the maintainer's hands
   EARLY: `?dev` on the freighter mission → open the Exhaust panel → toggle points/flame, twist
   palette/len/size/speed/turbulence/softness, Copy JSON. The maintainer picks the final look and defaults
   by eye before any further polish (visual-features-need-early-playable-build).
7. **Server suite** unaffected (no server change) — no run needed, but note it in the PR.

---

## Docs to update

- **`docs/SUMMARY.md`:**
  - Freighter set-piece subsection (~1189–1206): the exhaust is now a **shared GPU/baked-texture,
    shader-driven axis-aligned plume** (`client/src/exhaust-fx.js`), built once (no per-frame buffer
    re-upload), with **two selectable looks** — (a) point-glow (default) / (b) noise-scroll flame —
    switchable globally from a `?dev` tuning panel. `spec.exhaust` keys unchanged (+ optional
    `turbulence`/`softness`).
  - Engine-trail / FX subsection (~1301–1319, and the muzzle/exhaust bounds note ~1308): ship engine
    exhaust is now the **same shared plume, rigidly attached to each ship and always straight** (the old
    curved position-history trail is gone; deliberate trade-off, DECISIONS §74), and **honors the same
    global (a)/(b) look toggle as the freighter**. The `trail` particle pool is removed; plumes attach
    lazily on first thrust and are disposed on ship death/reset/ship-swap.
  - `?dev`/tools subsection: add the **Exhaust tuning panel** — a **global** mode toggle that flips every
    plume (freighter + ships) between point-glow / flame, plus **freighter-only** palette/shape sliders +
    Copy JSON — next to the Backdrop panel.
  - Visual-scenarios list: note `03-exhaust-trail` now checks attached plumes; add the new
    freighter-exhaust scenario if added.
  - Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`:** new bullet under today's date — **"Exhaust FX unified onto a shared
  GPU/baked-texture plume"** — freighter plume + per-ship engine trails converted from per-frame CPU
  particle clouds to one additive, baked-once, shader-driven axis-aligned plume (`exhaust-fx.js`), two
  selectable looks (point-glow default / noise-scroll flame) with a `?dev` tuning panel + Copy-JSON; the
  (a)/(b) mode toggle is **global** — it flips every plume (freighter + all ships) at once; ship trails
  are now rigidly straight (curved history dropped, DECISIONS §74); `trail` pool removed; replay-neutral
  (no seeded-stream change, intro guard passes).
- **`docs/DECISIONS.md`:** add **§74 — Exhaust FX: shared shader plume + straight ship trails.** Record
  (1) the choice to ship **both** looks behind a **global** `?dev` mode toggle covering the freighter AND
  every ship plume (decide the final look on a live build, default the safe silhouette-preserving one),
  (2) the **curved → straight** ship-trail trade-off (simpler/cheaper/one FX style; accepted loss of the
  turn-curve), and (3) the tuning approach (live `?dev` edit + Copy-JSON export, no persistence — the
  general tuning system is deferred to ROADMAP). Cross-ref §73 (replay-neutral FX), §23 (tier gating),
  §30 (keep it simple).
- **`docs/ROADMAP.md`** (backlog / parking lot): add **"General visual/UX live-tuning panel"** — a unified
  in-game panel to live-tune background color, starfield, asteroid/parallax "sense of flight", lighting,
  camera position, effects, and other exposed params, with **save-tuned-config-to-file** so it becomes the
  new default. Frame as a future phase; note the exhaust `?dev` panel is the first small instance.

---

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **No server/catalog change.** `spec.exhaust` + engine `stats.exhaust` schemas are untouched; new knobs
  are optional-with-defaults on the client.
- **No general tuning system.** Only the exhaust `?dev` panel now; the unified visual/UX tuning panel +
  save-to-file is ROADMAP-only.
- **No localStorage persistence** of exhaust tune / mode (Copy-JSON is the save path; the mode toggle is a
  runtime-only global).
- **No PER-ship mode dropdown.** The mode toggle is one GLOBAL control (freighter + all ships together);
  do not build a separate per-ship mode picker.
- **Do not touch** sim/damage/collision/economy, `sim-random.js`, the recorded intro trace, the rocket
  smoke trail, sparks/shockwave/flipbook/bolt FX, or the muzzle-flash.
- **Do not over-polish mode (b).** One solid noise-scroll flame; the maintainer refines it live.
- **No model/asset/`.glb` change** → no `CREDITS.md` change and **no `/publish-itch` step** (this feature
  ships no new content-hashed asset; the freighter glb hash is unchanged).
```
