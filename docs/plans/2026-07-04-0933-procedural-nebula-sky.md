# Procedural nebula skybox (bake-once cubemap)

## Goal

Replace the flat `skyScene.background` slate-blue color with a **procedurally generated nebula +
starfield**, baked **once** at `buildMap` time into a `WebGLCubeRenderTarget` and assigned as the
sky-scene background. The look is the maintainer-approved "Ice blue sparse" palette: deep-black space
with faint blue wisps and a dense static star field, tuned so the backdrop never competes with
ships/bullets/FX (combat readability first). Because the nebula is baked to a cubemap, the per-frame
cost is identical to today's flat-color background (one full-screen background draw) — the shader runs
6 times total (once per cube face) at map-build, not per frame. Params live in the `home-system` map
descriptor (`sky.nebula`) so the sky is data-driven; the bake is **tier-gated** (High bakes at
1024/6-octave fbm, Balance at 512/4-octave, Performance keeps the old flat color) and **skipped under
the `?debug` test hook** so the headless visual suite's backdrop is unchanged.

## Decisions (final — do not re-ask)

1. **Tiered bake.** `graphics.js` `TIERS` gains a `nebulaBake` knob: High `{ cube: 1024, octaves: 6 }`,
   Balance `{ cube: 512, octaves: 4 }`, Performance `null` (means "flat `d.background` color, no bake").
2. **`?debug` skips the bake.** When `location.search.includes('debug')`, `buildMap` sets
   `skyScene.background = new THREE.Color(d.background)` and does **not** call `makeNebulaSky` — mirrors
   exactly how `prewarmShaders` guards itself (`client/src/main.js:638`). The visual suite's rendered
   backdrop is therefore **unchanged by this feature — do NOT regenerate visual baselines.**
3. **Reduced parallax stars.** When a nebula is baked, `makeStars` count is multiplied by **0.4** (still
   honoring `gfx.starScale`) — the moving point layer supplies parallax/depth, the baked nebula supplies
   the dense static field. On Performance (flat color, no nebula) `makeStars` keeps full count so the sky
   isn't empty.
4. **No `?tune` panel work.** Params are edited in the descriptor + reload. The plan notes where a future
   Nebula tune folder would hook, but `client/src/tune.js` is **not touched**.
5. **Color management.** The baked cube goes through THREE's sRGB output path (`rt.texture.colorSpace =
   THREE.SRGBColorSpace`), so it renders slightly brighter/greyer than a raw-canvas shader preview. The
   maintainer accepted the in-engine baked result as the baseline — **preserve it, do not "correct" it
   back to the darker preview.**
6. **No CREDITS.md change.** The shipped sky is fully procedural (GLSL, no third-party asset) → no new
   `CREDITS.md` row. (Confirmed against the project's "always check credits on asset changes" rule: there
   is no shipped asset.)
7. **Prototype leftovers are removed by the orchestrator at merge**, not in this worktree:
   `client/assets/skybox/{blue,lightblue,coolblue}/` (CC0 StumpyStrust evaluation PNGs, never shipped) and
   `client/_nebula_explore.html` (standalone palette explorer). Implementer task: **do not recreate them
   and ensure no code references them** (they are absent from this worktree already — verify with a grep,
   step 9).

## Files touched

- `client/src/graphics.js` — add the `nebulaBake` tier knob.
- `client/src/graphics.test.js` — assert the new knob per tier.
- `client/src/state.js` — add `G.nebulaRT` (cube render target handle, disposed on rebuild).
- `client/src/world.js` — import `renderer`; add shader consts + `NEBULA_ICEBLUE` fallback +
  `makeNebulaSky`; branch the background + reduce `makeStars` in `buildMap`.
- `server/src/catalog_seed.js` — add `sky.nebula` to the `home-system` descriptor.
- Docs: `docs/SUMMARY.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md`.

---

## Step 1 — Add the `nebulaBake` tier knob (`client/src/graphics.js`)

In `TIERS` (`client/src/graphics.js:16-20`), add a `nebulaBake` field to each tier. Keep every existing
field. Result:

```js
export const TIERS = {
  high:        { label: 'High',        pixelRatioCap: 2,   antialias: true,  starScale: 1.0,  particleScale: 1.0, envMap: true,  maxParticles: Infinity, nebulaBake: { cube: 1024, octaves: 6 } },
  balance:     { label: 'Balance',     pixelRatioCap: 1.5, antialias: false, starScale: 0.6,  particleScale: 0.6, envMap: true,  maxParticles: Infinity, nebulaBake: { cube: 512,  octaves: 4 } },
  performance: { label: 'Performance', pixelRatioCap: 1,   antialias: false, starScale: 0.35, particleScale: 0.4, envMap: false, maxParticles: 300,      nebulaBake: null },
};
```

Update the doc comment above `TIERS` (`client/src/graphics.js:8-16`) to mention the new knob:
> `nebulaBake` = the one-time procedural-nebula skybox bake (cube-map size + fbm octaves); `null` on
> Performance means "keep the flat background color, no bake" so the weakest phones skip a 6-face shader
> bake hitch.

`resolveTier` (`client/src/graphics.js:25-28`) already spreads all fields, so `G.gfx.nebulaBake` is
available with no other change.

## Step 2 — Add the render-target handle to state (`client/src/state.js`)

In the world block of `G` (after `currentMapDescriptor`, `client/src/state.js:26`), add:

```js
  nebulaRT: null,             // WebGLCubeRenderTarget of the baked nebula sky (disposed + rebuilt by buildMap); null on the flat-color (Performance/?debug) path
```

## Step 3 — Import `renderer` in world.js (`client/src/world.js:6`)

Change:

```js
import { scene, skyScene } from './engine.js';
```
to:
```js
import { scene, skyScene, renderer } from './engine.js';
```

## Step 4 — Add the nebula shader + `makeNebulaSky` (`client/src/world.js`)

Insert this block just **after** `makeStars` ends (`client/src/world.js:134`, before the
`// ---------- Planet with moons` banner at line 136). The octave count is injected as a compile-time
`#define` (GLSL ES 1.00 requires a constant loop bound), so each tier compiles its own fbm depth.

```js
// ---------- Procedural nebula sky (baked ONCE to a cubemap; see DECISIONS §43) ----------
// A GLSL fragment shader generates a multi-octave value-noise nebula (2-3 color layers) + a sparse
// power-law star field over the view DIRECTION. It is rendered ONCE into a WebGLCubeRenderTarget via a
// CubeCamera at buildMap time and assigned to skyScene.background, so the per-frame cost is just a flat
// background draw (same as a static cubemap) while the look stays fully procedural + palette-driven.
// Palette lives in the map descriptor (sky.nebula); NEBULA_ICEBLUE is the safe fallback.
const NEBULA_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// OCTAVES is prepended as a #define per tier (fbm loop bound must be a compile-time constant).
const NEBULA_FRAG = `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uBase, uColA, uColB, uColC;
  uniform float uThLow, uThHigh, uGlow, uStarD, uStarB, uSat, uSeed;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3) + uSeed);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i + vec3(0,0,0)), n100 = hash(i + vec3(1,0,0));
    float n010 = hash(i + vec3(0,1,0)), n110 = hash(i + vec3(1,1,0));
    float n001 = hash(i + vec3(0,0,1)), n101 = hash(i + vec3(1,0,1));
    float n011 = hash(i + vec3(0,1,1)), n111 = hash(i + vec3(1,1,1));
    return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
               mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return s;
  }
  // jittered-cell stars over the view direction: sparse (threshold 0.982), power-law-ish, soft falloff.
  float starField(vec3 dir, float density) {
    vec3 g = floor(dir * density);
    float h = hash(g + 7.0);
    if (h <= 0.982) return 0.0;
    vec3 jit = (vec3(hash(g + 1.0), hash(g + 2.0), hash(g + 3.0)) - 0.5) * 0.8;
    vec3 cellDir = normalize((g + 0.5 + jit) / density);
    float dist = length(dir - cellDir) * density;
    return smoothstep(0.18, 0.0, dist) * (0.4 + (h - 0.982) / 0.018 * 0.6); // brighter for rarer cells
  }
  void main() {
    vec3 dir = normalize(vDir);
    float d = smoothstep(uThLow, uThHigh, fbm(dir * 2.2));
    float t = fbm(dir * 2.2 * 0.55 + 11.0);
    vec3 neb = mix(uColA, uColB, clamp(t, 0.0, 1.0)) * d + uColC * pow(d, 2.5) * uGlow;
    vec3 star = vec3(starField(dir, uStarD) * uStarB);
    vec3 col = uBase + neb + star;
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, uSat); // desaturate toward uSat (keeps it readable, not garish)
    gl_FragColor = vec4(col, 1.0);
  }`;

// Ice-blue sparse fallback palette (used when the descriptor omits sky.nebula). Matches the approved
// in-engine baseline. Arrays are linear RGB triples; the whole cube goes through the sRGB output path.
const NEBULA_ICEBLUE = {
  base:  [0.01, 0.015, 0.025],
  colA:  [0.12, 0.22, 0.40],
  colB:  [0.20, 0.35, 0.55],
  colC:  [0.10, 0.20, 0.40],
  thLow: 0.55, thHigh: 0.90, glow: 0.30,
  starD: 75, starB: 1.10, sat: 0.90, seed: 0,
};

// Bake the nebula into a cubemap and return the WebGLCubeRenderTarget (caller reads .texture and owns
// disposal). `bake` = { cube, octaves } from the active tier's gfx.nebulaBake (never null here — the
// caller only bakes when nebulaBake is truthy). The ShaderMaterial + geometry are throwaway (disposed).
function makeNebulaSky(prm, bake) {
  const uniforms = {
    uBase:  { value: new THREE.Vector3(...prm.base) },
    uColA:  { value: new THREE.Vector3(...prm.colA) },
    uColB:  { value: new THREE.Vector3(...prm.colB) },
    uColC:  { value: new THREE.Vector3(...prm.colC) },
    uThLow: { value: prm.thLow }, uThHigh: { value: prm.thHigh },
    uGlow:  { value: prm.glow },  uStarD:  { value: prm.starD },
    uStarB: { value: prm.starB }, uSat:    { value: prm.sat },
    uSeed:  { value: prm.seed || 0 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    // depthTest/depthWrite MUST be false — this is load-bearing, not incidental. The bake runs under the
    // engine's global `renderer.autoClear = false` (engine.js:94), and CubeCamera.update (three@0.160)
    // does NOT clear between the 6 faces — each face is a plain renderer.render() whose per-render clear
    // is gated on autoClear. So the shared cube DEPTH buffer is never cleared between faces; face 0's
    // wall depths would persist and, since every face is the same box only rotated, coincide with later
    // faces' depths and get REJECTED by the default depthTest:LESS — baking stale face-0 color into faces
    // 1-5 (wrong nebula direction). A full-cover inside-out skybox needs neither depth test nor write, so
    // with both off no stale depth can ever reject a fragment, regardless of the global autoClear state.
    depthTest: false,
    depthWrite: false,
    uniforms,
    vertexShader: NEBULA_VERT,
    fragmentShader: `#define OCTAVES ${bake.octaves}\n` + NEBULA_FRAG,
  });
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const bakeScene = new THREE.Scene();
  bakeScene.add(new THREE.Mesh(geo, mat));

  const rt = new THREE.WebGLCubeRenderTarget(bake.cube);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  new THREE.CubeCamera(0.1, 10, rt).update(renderer, bakeScene); // renders all 6 faces once

  mat.dispose();
  geo.dispose();
  return rt;
}
```

**Note (renderer.info):** `engine.js` sets `renderer.info.autoReset = false` for two-pass draw counting;
the 6 face draws add a one-time bump to `renderer.info` that the main loop's per-frame reset clears next
frame. This is a build-time one-shot — no change needed.

**Note (no explicit color clear needed):** the inside-out `BackSide` box fully covers every cube face, so
`gl_FragColor` overwrites all pixels — no manual `renderer.clear()`/`clearColor` call is required despite
the global `autoClear = false`. Only the DEPTH hazard matters, and it's handled by `depthTest/depthWrite:
false` on the bake material (see the comment in `makeNebulaSky` above).

## Step 5 — Branch the background + reduce stars in `buildMap` (`client/src/world.js`)

In `buildMap`, replace the current flat-color assignment and the stars line.

**5a — background.** Replace `client/src/world.js:598`:

```js
  skyScene.background = new THREE.Color(d.background);
```
with:
```js
  // Baked procedural nebula sky (DECISIONS §43): tier-gated (gfx.nebulaBake null on Performance → flat
  // color) and SKIPPED under the ?debug test hook (mirrors prewarmShaders; keeps the visual suite's
  // backdrop unchanged — do not regen baselines). Dispose the previous bake before rebuilding (buildMap
  // re-runs on every level start / map switch, so a leaked cube RT would accumulate).
  if (G.nebulaRT) { G.nebulaRT.dispose(); G.nebulaRT = null; }
  const bakeNebula = G.gfx.nebulaBake && !location.search.includes('debug');
  if (bakeNebula) {
    const nb = { ...NEBULA_ICEBLUE, ...(d.sky.nebula || {}) }; // descriptor overrides fall back per-key
    G.nebulaRT = makeNebulaSky(nb, G.gfx.nebulaBake);
    skyScene.background = G.nebulaRT.texture;
  } else {
    skyScene.background = new THREE.Color(d.background);
  }
```

**5b — reduced parallax stars.** Replace `client/src/world.js:605`:

```js
  G.stars = makeStars(Math.round(d.stars.count * G.gfx.starScale), d.stars.radius); // density scales with quality tier
```
with:
```js
  // When the nebula is baked it supplies the dense STATIC star field, so thin the MOVING parallax layer
  // to ~0.4× (it now only sells depth, not density). On the flat-color path keep full count. Still scales
  // with the quality tier (gfx.starScale). See DECISIONS §43.
  const starMul = bakeNebula ? 0.4 : 1.0;
  G.stars = makeStars(Math.round(d.stars.count * G.gfx.starScale * starMul), d.stars.radius);
```

No other change to `buildMap`; `G.stars.renderOrder = -1` and the `skyScene.add(G.stars)` lines below stay.

**`?tune` future hook (implement nothing):** a future Nebula tune folder would edit `d.sky.nebula` on
`G.currentMapDescriptor` then call `buildMap(G.currentMapDescriptor)` (the existing "Rebuild" pattern at
`client/src/tune.js:54`), since nebula params require a re-bake and can't live-mutate a color ref. Not
built now.

## Step 6 — Add `sky.nebula` to the descriptor (`server/src/catalog_seed.js`)

In the `home-system` descriptor's `sky` block (`server/src/catalog_seed.js:516-519`), add a `nebula`
key alongside `ambient`/`sun`:

```js
      sky: {
        ambient: { color: 0x3a506e, intensity: 0.7 },           // night-side fill
        sun: { color: 0xfff2e0, intensity: 3.4, pos: [170, -80, 40] }, // side light -> terminator
        // Procedural nebula skybox palette (baked once to a cubemap by buildMap; see DECISIONS §43).
        // "Ice blue sparse": deep-black space + faint blue wisps + a dense static star field, tuned so
        // the backdrop never competes with ships/bullets/FX. Linear-RGB triples; omit any key to use the
        // client's NEBULA_ICEBLUE fallback. Performance tier + ?debug ignore this (flat `background`).
        nebula: {
          base:  [0.01, 0.015, 0.025],
          colA:  [0.12, 0.22, 0.40],
          colB:  [0.20, 0.35, 0.55],
          colC:  [0.10, 0.20, 0.40],
          thLow: 0.55, thHigh: 0.90, glow: 0.30,
          starD: 75, starB: 1.10, sat: 0.90, seed: 0,
        },
      },
```

Keep the existing `background: 0x1b2531` line above `sky` — it is still the Performance-tier / `?debug`
flat-color fallback and the fog match, so it must remain.

**Backend parity:** `catalog_seed.js` is the single shared seed source imported by **both** `db.js`
(SQLite) and `db_postgres.js` (Postgres), and `maps.descriptor` is stored as opaque JSON — adding a
nested field needs no schema/SQL change and stays in sync automatically. No `db.js` / `db_postgres.js`
edit.

---

## Tests

### Client (`cd client && node --test`)

Extend `client/src/graphics.test.js` (it already asserts tier knob shapes, e.g. `renderScale` undefined,
`maxParticles` finite). Add a test:

```js
test('nebulaBake: High/Balance bake, Performance keeps the flat color', () => {
  const hi = resolveTier('high').nebulaBake;
  const ba = resolveTier('balance').nebulaBake;
  assert.deepEqual(hi, { cube: 1024, octaves: 6 });
  assert.deepEqual(ba, { cube: 512, octaves: 4 });
  assert.equal(resolveTier('performance').nebulaBake, null);
});
```

`world.js` is browser-only (imports `engine.js` → WebGL/DOM) and is not covered by `node --test`, so the
shader/bake path is verified by the manual VERIFY run below, not a unit test. This matches how the rest
of `world.js` (planet/stars/set-pieces) is already exercised.

### Server (`cd server && npm test` — runs on **both** SQLite and Postgres)

No new server test. The descriptor change is opaque JSON passed through the existing maps seed +
`GET /api/maps/:name`; the existing map/seed tests continue to pass unchanged. Run the suite to confirm
the added `nebula` object doesn't break seeding on either backend.

### Visual suite (`client/visual/`, not in CI)

**Do not regenerate baselines.** Under the `?debug` hook the background stays the flat `d.background`
color (Decision 2), so the suite's rendered backdrop is identical to `main`. Judge by the
reliably-passing set + zero page errors (baseline is known-flaky on ~6 scenarios).

---

## Docs to update

1. **`docs/SUMMARY.md` — Visuals section** (around `docs/SUMMARY.md:620-633`). Update the opening
   "Background in 3 layers" bullet to state the sky is now a **baked procedural nebula cubemap** (not only
   point stars): a GLSL fbm nebula + sparse star field rendered **once** into a `WebGLCubeRenderTarget` at
   `buildMap` time and set as `skyScene.background` (per-frame cost = a flat background draw). Note: params
   live in the descriptor `sky.nebula` (fallback `NEBULA_ICEBLUE` in `world.js`); **tier-gated** — High
   bakes 1024/6-octave, Balance 512/4-octave, **Performance keeps the old flat `background` color**;
   **skipped under `?debug`** (visual-suite backdrop unchanged); the moving `makeStars` parallax layer is
   thinned to **0.4×** when the nebula is baked (baked field = density, point layer = parallax). Bump the
   `**Updated:**` date. Also touch the top-of-file one-line feature list (`docs/SUMMARY.md:1` area) if it
   enumerates visual features.
2. **`docs/CHANGELOG.md`** — add a bullet under the existing `## 2026-07-04` heading (`docs/CHANGELOG.md:6`),
   newest on top:
   > **Procedural nebula skybox (baked cubemap).** Replaced the flat slate-blue `skyScene.background` with
   > a procedurally generated ice-blue nebula + star field (GLSL fbm), baked **once** into a
   > `WebGLCubeRenderTarget` at `buildMap` time → per-frame cost unchanged (flat background draw). Palette
   > is data-driven in the `home-system` descriptor (`sky.nebula`). Tier-gated (High 1024/6-octave, Balance
   > 512/4-octave, **Performance keeps the flat color**), skipped under `?debug` (visual suite unchanged).
   > Parallax `makeStars` thinned to 0.4× when the nebula is baked. Fully procedural — no third-party
   > asset, no `CREDITS.md` change.
3. **`docs/DECISIONS.md`** — add **§43** (next number; current max is §42):
   > **43. Nebula sky: bake procedural GLSL once to a cubemap (vs live per-frame shader-sphere vs
   > third-party cubemap assets).** We wanted a real nebula backdrop without a per-frame cost or a shipped
   > binary asset. **Live shader-sphere** (a fbm fragment shader drawn every frame behind the fight) was
   > rejected: the two-pass sky/combat split (§5) already pays a full sky pass each frame, and a 6-octave
   > fbm over every background fragment is exactly the fill-rate work weak phones can't spare. **Third-party
   > cubemap PNGs** (the CC0 StumpyStrust evaluation set we trialed) were rejected: they add shipped binary
   > weight, a `CREDITS.md` attribution obligation, and can't be re-tinted per-map. **Chosen:** render the
   > procedural shader **once** into a `WebGLCubeRenderTarget` at `buildMap` time and use it as
   > `skyScene.background` — per-frame cost collapses to a flat background draw (identical to today), the
   > look stays fully procedural + palette-driven from the descriptor, and nothing ships as an asset. The
   > one-time bake is **tier-gated** (Performance keeps the flat color — a 6-face shader bake can hitch the
   > weakest phones, matching the "Performance strips premium visuals" line from §23) and **skipped under
   > `?debug`** (software-GL bake is slow/flaky and would churn visual baselines — same reasoning as the
   > `prewarmShaders` skip). The sRGB output path makes the baked cube read slightly brighter/greyer than a
   > raw-canvas preview; the maintainer accepted the baked in-engine result as the baseline.

---

## VERIFY (manual)

1. `/run-local` (pulls gitignored assets first, then starts the server) and open the game.
2. **Take off** into a level: the ice-blue nebula + stars render behind the fight; FPS stays healthy
   (target ~100 on High as prototyped); ships/bullets/FX read clearly against the backdrop.
3. Switch **Settings → Graphics** to **Performance**, reload, take off: backdrop is the flat slate-blue
   `background` color (no bake), sky still has the full moving star field.
4. Open with **`?debug`**: backdrop is the flat color (bake skipped) — confirms the visual suite is
   unaffected.

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **No `?tune` panel work** — `client/src/tune.js` is untouched (Decision 4). Tune via descriptor + reload.
- **No animated/twinkling nebula, no per-frame shader, no time uniform** — it's a static bake by design.
- **No multi-map nebula variety** — only the `home-system` descriptor gets a `nebula` block; other maps
  don't exist yet. The fallback (`NEBULA_ICEBLUE`) already covers a descriptor that omits it.
- **No changes to fog, combat lighting, or the two-pass structure** (§5 invariant preserved — the nebula
  is a sky-scene background only).
- **No CREDITS.md entry** (Decision 6) and **no new binary assets.**
- **Do not recreate** `client/assets/skybox/*` or `client/_nebula_explore.html` — the orchestrator removes
  the originals at merge; just confirm nothing references them (step below).

## Final checks

- **Step 9 — grep for stale references** (must return nothing):
  `grep -rn "skybox\|_nebula_explore" client/ docs/ server/` — confirms no code/doc points at the removed
  prototype PNGs or the explorer HTML.
- Run `cd client && node --test` and `cd server && npm test` (both backends) — all green.
