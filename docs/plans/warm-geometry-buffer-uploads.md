# Finish the buffer half of the warm — the geometry/texture uploads that still land during play

**Status: UNBUILT, NOT SCHEDULED.** Written down so the residual is a known, measured quantity rather than a
rediscovery. It is the leftover of `docs/plans/2026-09-01-1911-warm-late-shader-programs.md` (shipped
2026-09-01), which closed the **program** half of the level-start warm — after the veil drops, zero new
shader programs compile, asserted by `client/visual/scenarios/50-warm-completeness.mjs`. The **buffer** half
is closed only for the surfaces that plan owned (loot crate, halo, pull line, both shield bubbles, the reward
drop model). Three others still upload their geometry — and some textures — on their first live draw.

Everything below was measured, not inferred; the numbers are reproducible with the probe in §4.

---

## 1. Why this is worth doing at all

Resource creation is the stall signature on a weak phone. Field telemetry (source brief
`docs/plans/level-start-warm-incomplete.md` §2): a second in which a new program, geometry or texture is
created carries **25× the long-task rate** on a Mali-G52 (0.50/s vs 0.02/s). A geometry upload is cheaper than
a shader compile, so this is the smaller half — but it is the same defect, on the same frames, and it lands at
moments the player is looking at: the first rocket fired, the first ship that blows up, the first time a ship
type appears.

It is **not** an fps problem. Do not measure or report one; the frame is GPU-bound in steady state.

---

## 2. The three residuals, named

Measured on `level-0`, graphics tier `high`, headless (software WebGL), 2026-09-01. Identical before and
after the program fix, i.e. none of this is that change's debt.

| residual | where | when it uploads |
|---|---|---|
| **Ship hull buffers** (3 geometries per hull, plus its textures) | `client/src/ship-factory.js:113` `warmModel` | the first frame a ship TYPE is actually drawn |
| **`rocketGeo`** — `ConeGeometry(0.6, 2.4, 8)` | `client/src/projectiles.js:296` (and `spiralRocketGeo`, `:299`) | the first rocket fired, by anyone |
| **The explosion FX quads** — the flipbook fireball quad and the shockwave ring quad | `client/src/flipbook-fx.js:144` (`quadGeo`), `client/src/projectiles.js:150` (`ringQuadGeo`; `flashQuadGeo` at `:79` is the same shape of problem) | the first ship death (+2 geometries, +2 textures, measured) |

All three are **shared** module-level or cached-template geometries. Nothing here is a per-spawn allocation,
so all of it is warmable in principle — this is not a pooling refactor.

**Why `warmModel` misses the ship hulls, precisely.** It parks the template in the real `scene`, runs
`renderer.compile(scene, camera)` and `renderer.initTexture()`s each material's texture slots — then
**unparents the template** (`ship-factory.js:126-127`, "hand the template back unparented — clones are what
ever reach the scene"). It never DRAWS it. In r160 a geometry's buffers are uploaded in `projectObject` →
`objects.update(object)`, which sits **behind** the per-object frustum test, and `object.visible === false`
returns early for the whole subtree. So a compiled-but-never-drawn template has no GPU buffers, and the first
clone of it to reach the screen pays for them. (The `initTexture` calls do cover the hull's own textures; the
+2 textures measured in the fight window are the FX ones, not the hull's.)

---

## 3. The trap — read this before touching the FX warm rig

The obvious fix for residuals 2 and 3 looks like "add `warmRig` to `warmRoots` in `prewarmShaders()` so the
existing forced-draw pass covers it too". **That would upload the wrong buffers and change nothing.**

The FX warm rig (`client/src/main.js:791-805`) exists to hold MATERIALS alive (DECISIONS §83) — its meshes
carry **stand-in geometries**, not the ones the real effects draw:

```js
warmRig.add(new THREE.Mesh(explosionGeo, addMat), new THREE.Mesh(bulletGeo, fogMat),
  new THREE.Mesh(quadGeoForWarm, flipbookKeepAliveMaterial()),
  new THREE.Mesh(quadGeoForWarm, ringKeepAliveMaterial()));
```

`quadGeoForWarm` (`main.js:786`) is a private `PlaneGeometry(1, 1)` that exists only for this rig. The real
flipbook fireball draws `flipbook-fx.js`'s own `quadGeo`, and the real shockwave draws `ringQuadGeo`. Same
program key (the key comes from the MATERIAL), completely different GPU buffers. Drawing the rig would upload
`quadGeoForWarm` — a geometry nothing else ever draws — and leave the real two untouched.

So the fix has to **re-point the rig at the real shared geometries** (export them, or export a
`keepAliveMesh()` per module alongside the existing `keepAliveMaterial()`), which is a change to the rig's
composition — and `client/visual/scenarios/28-scene-warm.mjs` currently pins that shape (`rig.children >= 2`,
`!rig.disposed`, explosion compiles `+0` programs). Expect to edit that scenario as part of this, and keep
every one of its assertions meaningful rather than loosening them.

---

## 4. How to measure it (the probe, so the next person does not rebuild it)

Two techniques, both used to produce the table above:

1. **Attribute every upload event.** `renderer.info.memory.geometries` / `.textures` are plain numbers on a
   plain object, so they can be wrapped:

   ```js
   const mem = window.__game.renderer.info.memory;
   for (const key of ['geometries', 'textures']) {
     let v = mem[key];
     Object.defineProperty(mem, key, { configurable: true, get: () => v,
       set(nv) { if (nv > v) console.log(key, v, '->', nv, new Error().stack); v = nv; } });
   }
   ```

   The stack lands inside three (`projectObject` → `objects.update` → `geometries.get`), which confirms
   *when* but not *what*.

2. **Name the owner.** `WebGLGeometries.get()` registers a `dispose` listener on every geometry the renderer
   has taken ownership of, so `!!(geo._listeners && geo._listeners.dispose && geo._listeners.dispose.length)`
   is a reliable "this geometry is uploaded" marker. Walk `scene` + `skyScene` before and after, diff the
   ids, and print `object.type / object.name / geometry.type / material.type / parent.name`. That is how the
   three residuals were named. (`renderer.attributes` is **not** public in r160 — do not reach for it.)

Drive the fight with `__game.stepSim(n)` **plus an explicit draw after each chunk** — uploads happen on
draw, so stepping alone finds nothing.

---

## 5. Measured numbers (2026-09-01, level-0, tier `high`, headless)

Same probe, same sequence, run with the loot/shield warm disabled and enabled:

| | at veil-down | end of probe | Δ during play |
|---|---|---|---|
| before the program fix | 35 geo / 30 tex | 41 / 33 | **+6 geo, +3 tex** — crate, halo, pull line, shield sphere, `rocketGeo`, one FX quad |
| after the program fix | 33 geo / 29 tex | 41 / 33 | **+8 geo, +4 tex** — 3× ship hull meshes, `rocketGeo`, 2 FX quads |

Per-surface, after the fix (this is what `50-warm-completeness` asserts today):
`drop1 +0g/+0t, drop2 +0g/+0t, explosion +2g/+2t, enemyBubble +0g/+0t, playerBubble +0g/+0t`.

The two runs differ in composition because **the fight is emergent**: the second one happened to produce
kills, which spawned the level's other enemy type and its explosion. Which is the point of §6.

---

## 6. The assertion shape this must NOT use

The original plan asked for `geometries === geo0 && textures === tex0` across the whole probe window. That is
the wrong instrument twice over, and the maintainer replaced it (2026-09-01):

- it measures surfaces the change under test does not own — a red bar for someone else's residual;
- it is **run-to-run fragile**, because whether the emergent fight produces a kill changes the totals.

The shape that works, and the one any follow-up here should extend: **assert per surface, on its own delta**
— "spawning a drop uploads 0 geometries and 0 textures", "an absorbed hit uploads 0" — and print the
whole-fight totals as a logged measurement, never as an assertion. When this brief is built, the new zeros to
add are `explosion +0g/+0t`, a first rocket `+0`, and a first-appearance of a ship type `+0`.

---

## 7. Scope notes

- **Do not** change `WARM_MAX_WAIT_MS`, the veil's fade timing, or the veil gate's position relative to
  `update(dt)` — the sim ticks under the veil, so veil LENGTH is game state (source brief §3). This work is
  "more work per veil frame", never "more veil frames".
- A forced draw inside `warmModel` runs per parsed .glb, i.e. several times per level load, and each one is a
  full-scene render. Measure the added veil cost before assuming it is free; parking the templates and
  letting ONE forced pass at the end of `prewarmShaders()` cover them all is the cheaper shape and is what
  `warmDropAssets()` already does for the crate and the reward model.
- `22-trace-replay` (4 kills, checkpoints p0..p4, a win) must pass unchanged, as for any sim-adjacent change.
- The 49-scenario visual suite and the A/B perf bench are opt-in (DECISIONS §141) — ask first.

## 8. Docs to update when it is built

- `docs/CHANGELOG.md` — one bullet, leading with the user-visible effect (the first rocket / the first ship
  death / a new enemy type appearing stop hitching).
- `docs/SUMMARY.md` — the **Shader/GPU warm** bullet: what the forced-draw pass now covers, and the fact that
  the FX rig carries the REAL geometries.
- `docs/DECISIONS.md` — **amend §83** (it already owns the warm), do not open a new entry.


---

## Addendum 2026-09-02 — what the FIELD found after this brief was written

The `?dev` perf telemetry was extended twice (`gpu.late`) to name, not just count, every program that
compiles after the warm, attributed to the object that draws it. Four sessions on a Redmi 15C across all
three tiers then produced the same list every time, in ROAM, with **zero enemies**:

| attributed to | what it is |
|---|---|
| `Points/ShaderMaterial/transparent` (`22,23,…`) | **the engine exhaust plume, points mode** — `pointsMat`, `client/src/exhaust-fx.js:176` |
| `Mesh/ShaderMaterial/transparent` (`20,21,…`) | **the engine exhaust plume, flame mode** — `flameMat`, `client/src/exhaust-fx.js:185` |
| `? :: physical,STANDARD,…,false,false,…` | unattributed: no live object drew with it at sample time |
| `? :: physical,STANDARD,…,uv,uv,…` | unattributed, textured variant |

**The exhaust is the actionable one.** `prewarmShaders`'s rig holds explosion, bullet, flipbook and ring
materials — *not* the exhaust. Both plume programs therefore compile the first time a ship applies thrust,
which is an EVENT mid-play rather than a level boundary, and is the best current match for the
maintainer's field report of a freeze that was "a reaction to something" rather than a steady cost.
Warming it is the same shape as the loot/shield fix: build the real plume material early and let
`prewarmShaders`' compile reach it. Note both modes must be warmed — `setGlobalExhaustMode` can switch
between them — and the material is per-plume while the *program* is shared, so one held instance suffices
(DECISIONS §83 keep-alive).

**Not chased further, deliberately.** In the four sessions above the compile landed on frames of 3.3 ms and
5.1 ms — it did NOT reproduce the freeze, and the maintainer confirmed three further sessions with no
freeze. So this is a named, measured, non-urgent residual, not a live incident.

**Explicitly NOT a bug (do not "fix" it):** fps dropping while the station fills the screen on the `high`
tier is accepted behaviour — the frame is fill-bound and the 16-light tier is the known lever
(DECISIONS §139 and the station GPU-cost run). Do not confuse it with the event-triggered stalls above.
