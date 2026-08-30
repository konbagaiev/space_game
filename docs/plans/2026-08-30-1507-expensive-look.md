## 0. RESUME HERE (2026-08-31, paused mid-tuning)

**Branch `feature/2026-08-30-1507-expensive-look`, worktree `../ag-wt/2026-08-30-1507-expensive-look`,
last commit `ea0fdc5` (WIP). The merge of `main` is DONE and committed. Nothing is deployed.**

### Where the feature actually stands

The full-frame `EffectComposer` from the original plan **was built, live-tested, and thrown away**.
Decisions D2/D3/D5 and the ACES/exposure/grade/vignette half of D1 are VOID — see the header of
`client/src/postfx.js` for the measured reasons (MSAA + `UnrealBloomPass` renders black on ANGLE Metal;
routing the frame through a composer discarded the canvas's free MSAA; ACES fought lighting authored for
direct sRGB output and over-exposed everything).

What ships now: the frame draws **straight to the canvas exactly as on `main`**, and glow is an **additive
overlay** — only objects on `GLOW_LAYER` (`client/src/glow-layer.js`) are re-rendered into a small buffer,
thresholded, blurred once H+V, and added back.

### What is GOOD (confirmed by the maintainer on a real GPU)

- Bullets read well as light sources.
- Antialiasing, the original lighting, and the overexposure are all fixed (by removing the composer).
- The hull emissive floor is OFF (`hullEmissive: 0`) — at 0.25 it flattened hulls and killed their glint.
- The hull no longer joins the glow layer during a hit flash; the impact sprite already lights that point.
- Vertical striping is gone at high zoom.

### THE OPEN PROBLEM — and the maintainer's hypothesis, which is probably right

**Stripes still flash during movement, and the glow only looks right at MAXIMUM zoom-in. Zoomed out, the
ship disappears inside its own glow spot.** The maintainer's read: *"у нас что-то искусственное, что надо
заменить на натуральное"* — something artificial that should be replaced by something natural.

That diagnosis fits the mechanism. The current glow is **screen-space**: the blur is a fixed number of
glow-buffer texels, i.e. a fixed size ON SCREEN, while the emitter is sized in WORLD units. So zooming out
shrinks the ship but NOT the halo, and the source shrinks toward the sub-texel size where the 5-tap kernel
combs instead of smearing. Every fix so far has been a different way of compensating for that mismatch.

**Next thing to try: make the engine light a REAL light instead of a faked one** — e.g. an actual
`PointLight` at the nozzle that lights the hull and nearby geometry. That is world-space, so it scales
correctly with zoom by construction, needs no proxy sprite, no threshold, and no blur, and it removes the
whole class of artifact rather than tuning around it. Cost and tier-gating need checking (lights are not
free, and `sim.js`/`world.js` already manage a small fixed set), but this is the direction to explore
BEFORE any more tuning of the overlay.

### Live knobs (`?tune` → "Post (glow overlay)")

`glow strength` (0 = off, whole-frame), `glow radius` (blur texels), `threshold`, `knee`,
`engine light SIZE`, `engine light BRIGHTNESS`, `backdrop amp`, `backdrop follow`.
**Size and brightness are deliberately separate levers** — dimming by shrinking the source is what caused
the stripes twice. Shipped values live in `POST_DEFAULTS` (`client/src/graphics.js`).

### Still owed before this can merge

- Docs are STALE: the plan body, SUMMARY and DECISIONS §138 still describe the composer + ACES.
- Full test run (`node --test`, `npm test`, `22-intro-replay`, `43-expensive-look`, `99-fill`, the suite
  against a `main` baseline). Only `graphics.test.js` / `exhaust-fx.test.js` have been re-run since the pivot.
- `43-expensive-look` asserts against the composed frame and may need re-measuring.
- The A/B perf bench has NOT been run (opt-in).
- Backups of pre-edit files: `<scratchpad>/postfx.js.bak`, `exhaust-fx.js.bak`, `hit-fx.js.bak`.

---

# Plan: Make the game look expensive — post-processing, a layered backdrop, and readable silhouettes

**Feature id:** `2026-08-30-1507-expensive-look`
**Branch:** `feature/2026-08-30-1507-expensive-look`
**Status:** ready to implement. Every open question below is already answered inline — do not re-ask.

---

## Goal

Near-top-down space combat reads by **light, silhouette and glow**, not by polygon count. This change adds
the three things that buy that look, in one pass:

1. **A post-processing chain** — an `EffectComposer` wrapping the existing two-pass (sky → combat) frame:
   HDR linear scene render → **bloom** → a single custom pass doing **exposure + colour grade + ACES
   filmic tonemapping + vignette + sRGB encode**. Emissive ship parts and weapon fire *glow* instead of
   being flat bright patches.
2. **Backdrop depth** — the existing baked procedural nebula cubemap stays as the infinitely-far layer, and
   one new **additive parallax layer** (a second, coarser bake mapped onto a camera-tracking sphere) sits in
   front of it, so space gains structure and depth without becoming a skybox.
3. **Silhouette / emissive** — a per-material **emissive floor** applied once to each cached ship template so
   a hull never goes fully black, plus a **modest exhaust-plume HDR lift** so engines are the intended bloom
   source. Backed by a hard, tested **backdrop brightness ceiling** so the sky can never out-brighten a hull.

Plus two adjacent items the maintainer asked for in the same pass: the **speed-field dust is ~30% larger**,
and three **stale documentation/comment** spots are corrected.

**User-visible effect:** ships and weapon fire have real bloom and a filmic curve; the background has colour,
structure and slow parallax instead of a flat wash; enemy hulls stay readable against it at combat distance.
Players on the **Performance** tier keep today's render path — no composer is built at all there, and every
HDR gain is pinned to 1.0 so nothing clips (D18) — but they do get the two tier-independent changes: the
hull emissive floor and the larger dust.

---

## Decisions (all settled — implement these, do not revisit)

| # | Decision |
|---|---|
| D1 | **Composer wiring:** one `EffectComposer` in a **new** `client/src/postfx.js`. A **custom `SceneRenderPass`** reproduces the current four-line sequence verbatim (`clear()` → `render(skyScene)` → `clearDepth()` → `render(scene)`) into the composer's read buffer. `postfx.js` exports **`renderFrame()`**, used by **both** `main.js` `animate()` and the bench `fullFrame()`, so the two can never drift. |
| D2 | **Do NOT use three's `OutputPass`.** See "The `OutputPass` trap" below — it would recompile a shader **every frame**. Tonemapping/grade/vignette/sRGB live in **one custom `ShaderPass`** (`gradePass`). |
| D3 | **`renderer.toneMapping` on the main renderer stays `NoToneMapping` permanently.** The scene renders **linear HDR**; ACES is applied only in the final pass. Tonemapping before bloom is the classic wrong order and would make the bloom threshold meaningless. |
| D4 | **The composer render target must be `HalfFloatType`.** With an 8-bit target every source clamps at 1.0 and bloom comes out flat and grey. This is a hard requirement, not a nicety. |
| D5 | **Antialias:** the composer bypasses canvas MSAA, so the RT gets `samples: 4` on **High**, `samples: 0` on **Balance**. No FXAA pass. The `WebGLRenderer({ antialias })` constructor arg is left untouched. |
| D6 | **Tiers:** new `post` knob in `client/src/graphics.js`. High `{ bloom: true, bloomScale: 1, samples: 4 }`, Balance `{ bloom: true, bloomScale: 0.5, samples: 0 }`, Performance **`null`** — no composer, no grade, no vignette, no parallax layer, and (D18) every HDR gain pinned to 1.0. Performance therefore keeps today's **render path and FX brightness**; it does still receive the two tier-independent changes, the hull emissive floor and the larger dust. |
| D7 | **Bloom threshold = 0.65 linear** — deliberately **above** the speed-field dust (0.607). Dust stays crisp, non-glowing rock; glow is reserved for weapons, engines and bright stars. Guarded by a unit test. |
| D8 | **The FX retune is NOT "turn everything down".** It separates *source brightness* from *glow area*: intended bloom sources are pushed **above 1.0 in linear HDR**, everything else stays below 0.65. |
| D9 | **Hue lock.** Brightness is only ever changed by a **scalar multiply** on an existing colour (`Color.multiplyScalar`) or by a `uGain` uniform. No hue may change anywhere in the FX. The colour grade ships at **identity** by default (it is a live knob for the maintainer, not a shipped tint). |
| D10 | **Hangar:** the `model-viewer.js` renderers get `toneMapping = ACESFilmicToneMapping` + the same exposure. **No** composer, no bloom there. |
| D11 | **Backdrop:** ONE new layer. A second, coarser nebula bake (its **own** seed and noise scale — D17) mapped onto an **additive**, camera-tracking sphere with fractional parallax. It is built **`transparent: false`** so it lands in the **opaque** render list, `renderOrder:-3` puts it first *within that list*, and `depthTest:false` + `depthWrite:false` + additive blending make it incapable of occluding a system body or hiding the base cube's stars. The `transparent` flag is load-bearing, not cosmetic — see Blocking-1 reasoning in Step 5b. |
| D12 | **Silhouette:** emissive floor on the cached ship template + exhaust HDR lift. **No fresnel/rim shader this pass.** The floor (0.25) is far below the bloom threshold (0.65) on purpose — a hull must **not** be a standing light source. *(Amended at merge time: `main`'s combat-hit-feel landed a **hull flash** that drives the same `emissive` to white at `intensity` 1.6 for 0.12 s, which does clear the threshold. That is not a contradiction — the STATIC floor never glows, a HIT does, and that is the intended read. See "What legitimately changes appearance" below.)* |
| D13 | **Backdrop brightness ceiling — AMENDED 2026-08-30, the original promise is NOT met and never was.** The plan asked that the nebula's peak on-screen luminance stay below the dimmest lit hull facet, asserted numerically on a real rendered frame (`hullP25 >= 1.5 x bgP99`, whole sky). It was implemented in exactly that form and **measures 1.30x**. The measurement is kept; the *threshold* is not. **What ships is a REGRESSION FLOOR at `1.25x`** — just under the observed minimum — so the ratio can never silently get worse, plus the printed diagnostics. Why the ideal is not this feature's debt: the **pre-existing baked nebula cubemap** (shipped 2026-07-04) is **~95% of the sky peak**; this feature's parallax layer is ~4.5% and the stars ~0.1%, and **removing the layer entirely still fails 1.50x (~1.36x)**. No `backdrop.amp` value can meet it (sweep: 0.00 → 1.36x, 0.08 → 1.35x, 0.15 → 1.33x, 0.25 → 1.30x — the whole range is worth 0.05x and 0.19x is missing). Dimming the shipped cube was **rejected** (a look change to already-shipped art), and **raising the hulls was rejected too** — it pushes them toward the 0.65 bloom threshold and breaks **D12**, which requires that a hull never statically glow. `backdrop.amp` remains a live `?tune` knob. Maintainer's call; see DECISIONS §138(k). |
| D14 | **Speed-field dust ~30% larger:** sizes `0.8 / 1.3 / 2.0` → **`1.04 / 1.69 / 2.6`**, in **both** `speed-field.js` defaults and the `home-system` map descriptor. |
| D15 | **No randomness anywhere new.** The second nebula bake is driven by an **authored constant seed** (not `Math.random`, and never `simRandom` — DECISIONS §73). The parallax layer's per-frame update consumes zero randomness, like the speed-field wrap. |
| D16 | **Do NOT run the A/B perf bench.** It is opt-in and takes 25–40 minutes. |
| D17 | **The parallax layer must be a VISIBLY DIFFERENT noise field from the base cube** — its own constant `seed` *and* its own `scale`. Reusing the base palette would composite the same wisps onto themselves (see Step 5a). |
| D18 | **Every `>1.0` HDR gain is gated on the composer.** On Performance there is no composer and no tone mapping, so a value above 1.0 clamps per channel at the sRGB write — which both flattens the FX into white patches and **breaks the hue lock** (`0xffb050 × 1.5` clips R and G but not B → the hue shifts). So `exhaustGain` and every `fxGain` resolve to **exactly 1.0** when `G.gfx.post` is null. Performance *does* still get the emissive floor and the larger dust. |

---

## Background the implementer needs (verified against the source)

### The frame today

`client/src/main.js:1171-1175` (in `animate()`):

```js
renderer.info.reset();
renderer.clear();
renderer.render(skyScene, camera);
renderer.clearDepth();
renderer.render(scene, camera);
```

The **identical** sequence is duplicated in the `?bench` harness at `client/src/main.js:1412-1416`
(`fullFrame`). `renderer.autoClear = false` is set globally at `client/src/engine.js:121` and is
load-bearing for the nebula bake (`client/src/world.js:262-272`). `scene.background` is `null`;
`skyScene.background` is either the baked nebula cube texture or a flat `THREE.Color`.
`scene.fog = Fog(0x0a1624, 240, 600)` (`engine.js:24-25`), pushed out by zoom in `applyZoom()`
(`engine.js:100-105`). This is DECISIONS §5's two-scene lighting invariant — it must survive verbatim.

### The `OutputPass` trap (why D2 exists)

I read three r160's `examples/jsm/postprocessing/OutputPass.js`. Its `render()` does:

```js
if ( this._outputColorSpace !== renderer.outputColorSpace || this._toneMapping !== renderer.toneMapping ) {
    …
    this.material.needsUpdate = true;
}
```

It reads `renderer.toneMapping` **at render time**. Our chain needs `NoToneMapping` during the scene pass
(so the scene stays linear HDR for bloom) and ACES at output — toggling `renderer.toneMapping` between the
two every frame would flip that cache every frame and trigger a **shader recompile on every single frame**.
Leaving `renderer.toneMapping = ACESFilmicToneMapping` permanently is equally wrong: every scene material
would tonemap during the scene pass (the wrong order), and suppressing that would mean setting
`toneMapped = false` on every material in the game. Hence: `renderer.toneMapping` stays `NoToneMapping`,
and we own the ACES step in our own pass.

### Why the bloom threshold is 0.65 and not lower

Three's `LuminosityHighPassShader` (verified at r160) computes
`v = dot(texel.rgb, vec3(0.299, 0.587, 0.114))` — **Rec.601 weights, on the linear HDR input**.

The speed-field dust is `0xd2ccc1` at up to `opacity: 1.0`, `NormalBlending`, unlit, with a crisp opaque
dot sprite (`client/src/speed-field.js:39,44-46`; `client/src/world.js:735-748`). Its linear channels are
`0.6444 / 0.6038 / 0.5334`, so its Rec.601 linear luma is:

```
0.299·0.6444 + 0.587·0.6038 + 0.114·0.5334 = 0.6079
```

(The Rec.709 figure is 0.607 — the two agree to three decimals here, so the weight choice does not move
the decision.) **0.65 sits ~7% above that maximum.** Below it, the dust starts to glow — which directly
re-opens DECISIONS §96's settled "dim rocks, not stars — NOT additive" (`world.js:745`) and the deliberate
choice of the field's **own crisp dot sprite** rather than the star glow (`world.js:738`). Speed reads via
**size** (hence D14), never via glow.

The margin is thin, so it is **asserted by a unit test** that derives the dust luma from the shipped
constants — if anyone re-tints the dust brighter, the test fails instead of the look silently breaking.

### What legitimately changes appearance (expected, not regressions)

- **A hit on a hull blooms.** `main`'s combat-hit-feel (DECISIONS §137) washes the victim's own materials
  with a white emissive at `intensity` 1.6 for 0.12 s. Under this feature's bloom (threshold 0.65 linear)
  that flash is a real, brief glow rather than a flat white patch. **Expected and desirable — do not report
  it as a regression, and do not retune hit-feel's numbers here** (out of scope). The two features compose
  through `ship-factory.js`: the per-instance material clone captures the emissive floor as the value the
  flash restores to, so a flashed hull returns to the floor instead of to black.
- **Bright stars finally glow.** `client/src/world.js:154-165` already builds the bright-star layer with
  `AdditiveBlending` and the comment *"bright core blooms over the dark backdrop"* — it never actually
  bloomed, because there was no bloom. Under a real bloom these will glow for the first time. **Expected
  and desirable.** Do not report it as a regression.
- **`renderer.info.render.calls` jumps by ~14** (1 high-pass + 5×2 blur + 1 composite + 1 blend + 1 grade).
  The `?dev` perf overlay (`client/src/hud.js:168`) will show the higher number. Expected.
- **The A/B perf bench (`client/bench/stats.mjs`) will report `load.draws` GREW** and print
  *"load diverged — treat Δ as approximate"*. That is a report, not an assertion; it fails nothing.
  Noted here so a future bench run is not misread. **Do not run the bench in this change (D16).**

### Replay / intro impact

**None.** Every item here is view-layer: no sim state, no collision/damage/movement change, and **zero**
new randomness of any kind (D15). The dust-size change alters a material `size` only — the point *count*
and therefore even the native `Math.random` draw count in `scatterLayer`/`scatterColors` are unchanged, and
under DECISIONS §73 cosmetic native draws are replay-neutral regardless. The intro cutscene re-sims through
the real `sim.update()`, which none of this touches.

The guard is still mandatory: `node visual/run.mjs 22-intro-replay` must stay green (**4 kills, cards
p0..p4, win, tick 2474**). That scenario fast-steps via `__replay.step()` rather than rendered frames, so
the composer does not slow it.

---

## Steps

### Step 1 — Tier knob + shipped post constants (`client/src/graphics.js`)

`graphics.js` is pure data (no THREE, no DOM) and is unit-tested — that is why the numbers live here and
the THREE wiring lives in `postfx.js`.

1. Add a `post` key to each tier in `TIERS` (`client/src/graphics.js:27-31`):

```js
high:        { …, nebulaBake: { cube: 1024, octaves: 6 }, post: { bloom: true, bloomScale: 1.0, samples: 4 } },
balance:     { …, nebulaBake: { cube: 512,  octaves: 4 }, post: { bloom: true, bloomScale: 0.5, samples: 0 } },
performance: { …, nebulaBake: null,                       post: null },
```

Document above `TIERS`, next to the existing `renderScale` note: **the post chain is tiered by
PASS COUNT, not by resolution** — §23 measured that a 5.5–7× backbuffer-pixel cut moved fps by *nothing*
on real weak phones (the bottleneck is CPU draw-call submit + the GPU/compositor governor, not fragment
fill). So the only lever that actually protects a weak phone is `post: null` on Performance — **no chain at
all, ~14 fewer draw submits per frame**. `bloomScale: 0.5` on Balance saves fill, which §23 says is the
*less* important axis; if a live phone test shows Balance losing frames, the correct follow-up is moving
Balance to `post: null`, not shrinking the bloom further. Say this in the comment so the reasoning
survives.

> **`nMips` is not configurable in r160.** `UnrealBloomPass` hardcodes `this.nMips = 5` in its constructor
> and builds its render targets from it. Only the `resolution` constructor argument is tunable — hence
> `bloomScale`, and hence Balance keeps 5 mips. (This corrects an earlier "fewer mips on Balance" idea.)

2. Add the shipped starting values as pure data in the same file:

```js
// Post-processing look constants (pure data — the THREE wiring is in postfx.js, the live sliders in
// tune.js). These are STARTING POINTS: the maintainer dials them in a real build via ?tune and the dialed
// numbers are pasted back here. See DECISIONS §138.
export const POST_DEFAULTS = {
  exposure: 1.15,        // ACES darkens midtones; >1 compensates
  bloom: { strength: 0.55, radius: 0.4, threshold: 0.65 }, // threshold MUST clear the dust — see BLOOM_DUST_MARGIN
  vignette: { strength: 0.35, softness: 0.6 },             // 0 strength = off
  grade: { gain: [1, 1, 1], saturation: 1.0 },             // IDENTITY by default (D9 hue lock)
  hullEmissive: 0.25,    // ship emissive floor — deliberately far BELOW bloom.threshold: hulls must not glow
  // The two gain blocks below are >1 on purpose: they push a source above 1.0 in LINEAR HDR so it clears
  // bloom.threshold. They are VALID ONLY WITH A COMPOSER — read them through postGain() (D18), never
  // directly, or Performance clips them per channel and the hue shifts.
  exhaustGain: 1.6,      // plume uGain — pushes the engine core above 1.0 so it IS a bloom source
  fxGain: { explosion: 1.5, muzzle: 1.6, ring: 1.2, bolt: 1.4 }, // scalar HDR multipliers (hue-preserving)
  backdrop: { amp: 0.35, follow: 0.94, offsetMax: 250, radius: 900 }, // the new parallax layer
};
export const BLOOM_DUST_MARGIN = 1.05; // threshold must clear the dust's linear luma by at least 5%

// THE ONLY WAY ANY CALLER MAY READ AN HDR GAIN (D18). Without a composer the frame is written straight to
// an 8-bit sRGB canvas with no tone mapping, so a value above 1.0 clamps PER CHANNEL: 0xffb050 x 1.5 clips
// R and G but not B, which is both a flat white patch AND a hue shift — the two things this feature exists
// to avoid. `hasPost` is `!!G.gfx.post`.
export const postGain = (hasPost, gain) => (hasPost ? gain : 1);
```

3. Extend `client/src/graphics.test.js` (append after the `nebulaBake` test at line ~43):

```js
test('post: High/Balance run the composer, Performance runs none', …);          // knob shape per tier
test('the bloom threshold clears the speed-field dust (it must not glow)', …);  // see below
test('the hull emissive floor stays below the bloom threshold (hulls must not glow)', …);
test('postGain pins every HDR gain to 1 without a composer (no clipping, no hue shift)', …);
```

The dust test imports `SPEED_FIELD_DEFAULTS` from `./speed-field.js` (also pure, THREE-free) and asserts
`POST_DEFAULTS.bloom.threshold >= linearLuma601(SPEED_FIELD_DEFAULTS.color) * BLOOM_DUST_MARGIN`, where
`linearLuma601` is added in Step 2. The hull test asserts
`POST_DEFAULTS.hullEmissive < POST_DEFAULTS.bloom.threshold`. The `postGain` test asserts
`postGain(false, 1.6) === 1` and `postGain(true, 1.6) === 1.6`.

> **The hull test is necessary, not sufficient.** `hullEmissive < threshold` proves only that the *emissive
> term alone* cannot reach the bloom threshold; the shaded result is emissive + direct + ambient + env. The
> critic sanity-checked the magnitudes: with `sun` at 1.68 and `combatAmbient` at 1.2 (`engine.js:124-127`)
> a typical Lambert hull lands around **0.2–0.5 linear**, comfortably under 0.65. Two things *will* legitimately
> bloom and should not be filed as bugs: the station's `0x8fe3ff` emissive-window material
> (`world.js:847`) and white bullets. The real proof that hulls do not glow is the rendered frame at the
> review gate, not this unit test.

### Step 2 — The dust luma helper + the ~30% larger dust (`client/src/speed-field.js`)

1. Next to `layerLuma` (`client/src/speed-field.js:66-70`), add and export:

```js
// sRGB 0..1 -> linear, per the sRGB transfer function three uses (ColorManagement).
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// LINEAR Rec.601 luma of a hex colour — the exact quantity three's LuminosityHighPassShader thresholds on
// (`dot(texel.rgb, vec3(0.299,0.587,0.114))` over linear HDR). This is what decides whether the dust glows:
// the bloom threshold must sit ABOVE this value or the field turns into sparks (DECISIONS §96 forbids that).
// NOT interchangeable with layerLuma() above, which is a perceptual sRGB proxy for the CONTRAST floor.
export function linearLuma601(hex) { … }   // 0xd2ccc1 -> 0.6079
```

2. Change the three layer sizes in `SPEED_FIELD_DEFAULTS` (`client/src/speed-field.js:44-46`):
   `0.8 → 1.04`, `1.3 → 1.69`, `2.0 → 2.6`.

3. Change the **same three sizes** in the map descriptor at `server/src/catalog_seed.js:976-978`.
   **This is required** — `buildMap` reads `descriptor.speedField`, and `normalizeSpeedField` only falls
   back to the client defaults for *missing* keys. Changing only the client constant would ship a no-op.
   `db.js:378-382` upserts every map on boot (`ON CONFLICT (name) DO UPDATE`), so no migration is needed.

4. **There is a THIRD override layer above both of the above, and it will bite at the review gate.**
   `client/src/world.js:1242` is
   `makeSpeedField(applySpeedFieldSpec(isDev() ? loadSpeedTune(window.localStorage, base) : base))` — under
   `?dev`, a **stored** speed-field tune *replaces the descriptor wholesale*, and the `?dev` Backdrop →
   "Speed field" folder (`world.js:798-828`) persists **every slider drag** to `localStorage`. The
   maintainer live-tests with `?dev`. So a previously-dragged size can mask the new values and make a
   perfectly correct change look like it did nothing. **Verify the new sizes with the stored tune cleared**
   (`localStorage.removeItem('speedFieldTune')` — the key is `SPEED_TUNE_KEY` in `speed-field.js`) or in a
   clean browser profile, and say so in the review notes.

5. Verify the existing guards still hold (they do; recorded here so the implementer can check the arithmetic
   rather than rediscover it). `contrastRatio(0xd2ccc1, opacity) = 8.02 × opacity`, so the
   `size × contrast` visibility budget in `client/src/speed-field.test.js:216` becomes
   **8.3 / 12.9 / 17.1** (was 6.4 / 9.9 / 13.2), all far above the floor of 5; and 1.04 / 1.69 / 2.6 all sit
   inside `SPEED_FIELD_RANGES.size` `[0.2, 20]`, so `normalizeSpeedField` does not clamp them and the
   `deepEqual` test at `speed-field.test.js:224` still passes. `server/src/maps_speedfield.test.js` only
   asserts `size > 0` and `radius >= 600` — unaffected. **No test edits are needed for the size change**;
   if any of these fail, the arithmetic above is where to look.

### Step 3 — The post-processing chain (new file `client/src/postfx.js`)

New module. Imports: `three`, the addons `EffectComposer`, `ShaderPass`, `UnrealBloomPass`, and
`{ scene, skyScene, camera, renderer, onResize }` from `./engine.js`, and `{ POST_DEFAULTS }` from
`./graphics.js`. It must **not** be imported by `engine.js` (that would be a cycle).

> The importmap already maps `three/addons/` → `https://unpkg.com/three@0.160.0/examples/jsm/`
> (`client/index.html:299`), so no new CDN entry and no build step is needed. The itch build keeps the same
> importmap, so it picks these up too (a handful of extra small module fetches on first load).

**3a. `SceneRenderPass`** — a `Pass` subclass with `needsSwap = false`:

```js
render(renderer, writeBuffer, readBuffer) {
  renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
  renderer.clear();                       // exactly today's renderer.clear()
  renderer.render(skyScene, camera);      // pass 1: sky (its own light) — DECISIONS §5
  renderer.clearDepth();                  // exactly today's clearDepth()
  renderer.render(scene, camera);         // pass 2: combat on top
}
```

Both scenes go into the **same** buffer (`needsSwap = false`), which is why the depth clear between them
behaves identically to today. Do **not** use two stock `RenderPass`es: r160's `RenderPass.render()` calls
`renderer.clearDepth()` *before* `setRenderTarget()`, so a two-`RenderPass` chain only works by accident of
which target happens to still be bound. A 6-line custom pass removes that dependence on addon internals.

**3b. `gradePass`** — one `ShaderPass` with a custom fragment shader doing, in order:
colour grade (per-channel gain + saturation, identity by default) → **ACES filmic, which applies the
exposure itself** → vignette → sRGB encode. Uniforms: `tDiffuse`, `toneMappingExposure` (float — the ONE
exposure knob, and it is declared for you, see below), `uGain` (vec3), `uSat`, `uVigStrength`,
`uVigSoftness`.

Use **three's own ACES chunk** so combat and the hangar (D10, which goes through
`renderer.toneMapping = ACESFilmicToneMapping`) apply a bit-identical curve:

```glsl
#include <tonemapping_pars_fragment>   // declares `uniform float toneMappingExposure;` ITSELF — see below
…
vec3 c = ACESFilmicToneMapping(graded);
```

**Do NOT add your own `uniform float toneMappingExposure;` line.** Verified against the pinned build:
`three.module.js:14032`, the `tonemapping_pars_fragment` chunk, begins with the `saturate` guard and then
`uniform float toneMappingExposure;` — declaring it again is a GLSL redeclaration error and the shader
would not compile at all. Just include the chunk and set `material.uniforms.toneMappingExposure.value =
POST_DEFAULTS.exposure`.

**Exposure is applied exactly once**, inside three's `ACESFilmicToneMapping()` — which multiplies by
`toneMappingExposure / 0.6` internally (same source line). Do **not** add a second exposure multiply earlier
in the shader, and do not introduce a separate `uExposure` uniform. End the shader with
`#include <colorspace_fragment>` for the sRGB encode.

> **Fallback if it still will not compile** (it should — this is a pinned version and the chunk is
> self-contained): inline the Stephen Hill ACES fit (`RRTAndODTFit` + the two matrices, copied from the same
> chunk so the curve stays identical to the hangar's) and encode sRGB manually
> (`mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c))`). Any compile failure
> surfaces immediately as a page error in **every** visual scenario, so it cannot ship unnoticed.

**3c. `createPostFx()`** — build the chain when `G.gfx.post` is truthy:

```js
const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
  type: THREE.HalfFloatType,            // D4 — HARD REQUIREMENT: an 8-bit target clamps every source at
  samples: webgl2 ? post.samples : 0,   // 1.0 and the bloom comes out flat and grey
});
composer = new EffectComposer(renderer, rt);
composer.addPass(new SceneRenderPass());
if (post.bloom) composer.addPass(new UnrealBloomPass(
  new THREE.Vector2(w * post.bloomScale, h * post.bloomScale),
  POST_DEFAULTS.bloom.strength, POST_DEFAULTS.bloom.radius, POST_DEFAULTS.bloom.threshold));
composer.addPass(gradePass);
```

`renderer.toneMapping` is left at its default `NoToneMapping` (D3) — assert/comment this explicitly in the
file so nobody "fixes" it later.

**3d. `export function renderFrame()`** — the single entry point:

```js
export function renderFrame() {
  renderer.info.reset();
  if (composer) { composer.render(); return; }
  // Performance tier (and any composer-less path): today's two-pass frame, unchanged. (The IMAGE is not
  // byte-identical to today there — the hull emissive floor and the larger dust are tier-independent — but
  // the render PATH is, and every HDR gain is pinned to 1.0 by postGain so nothing clips. See D18.)
  renderer.clear();
  renderer.render(skyScene, camera);
  renderer.clearDepth();
  renderer.render(scene, camera);
}
```

**3e. `export function hdrColor(hex, gain)`** — `new THREE.Color(hex).multiplyScalar(gain)`. A scalar
multiply on a linear colour: **hue-preserving by construction** (D9), and values above 1.0 are exactly what
makes a source bloom (D8).

**3f. Resize.** In `client/src/engine.js`, add:

```js
export const onResize = [];   // subscribers run after the renderer is sized (the postfx composer)
```

**Declare it ABOVE `applyOrientation`'s definition** (`engine.js:67`) — the module calls
`applyOrientation()` immediately at `engine.js:76`, so a `const` declared below it would throw a TDZ
`ReferenceError` at boot. Call the subscribers at the end of `applyOrientation()`, after
`renderer.setSize(w, h)`: `for (const fn of onResize) fn(w, h);`. This keeps `applyOrientation` the single
place that sizes anything, with **no import cycle** (`postfx → engine` only).

`postfx.js` pushes a subscriber that must do **two** things:

```js
onResize.push((w, h) => {
  composer.setSize(w, h);
  // MANDATORY second line. EffectComposer.setSize forwards the effective size to every pass, and
  // UnrealBloomPass.setSize(width, height) REBUILDS its bright + 5 mip targets from width/2, height/2 —
  // discarding the scaled `resolution` we passed to the constructor. applyOrientation runs on every
  // resize/orientationchange, which on a PHONE (the exact audience bloomScale exists for) fires routinely,
  // so without this line Balance's only fill saving silently evaporates on the first rotate.
  if (bloomPass) bloomPass.setSize(w * dpr * post.bloomScale, h * dpr * post.bloomScale);
});
```

(`dpr` = the same `renderer.getPixelRatio()` the composer uses. If you prefer, subclass `UnrealBloomPass`
and override `setSize` to apply the scale itself — either is fine, but the scale **must** survive a resize.)

**3g. `?debug` cost cap.** Under `?debug` (the visual harness runs on software WebGL), force
`samples: 0` and `bloomScale: 0.5` regardless of tier. The chain and the look are unchanged; only the fill
cost drops, so the suite does not slow to a crawl. Comment it as a harness-speed measure.

### Step 4 — Wire the frame (`client/src/main.js`)

1. Import `renderFrame` from `./postfx.js` (with the other engine-level imports near `main.js:16`).
2. Replace `main.js:1171-1175` with a single `renderFrame();` (keep the surrounding `t3`/`updatePerf`/
   `devPerf` lines exactly as they are — `renderFrame` does the `renderer.info.reset()` itself).
3. Replace the identical block in the bench `fullFrame` at `main.js:1412-1416` with the same
   `renderFrame();` call. Keep the `t2`/`t3` timing marks and the `renderer.info.render.calls/triangles`
   readback around it — the bench must keep measuring the **real** frame, which is now the composed one.
4. `prewarmShaders()` (`main.js:794-811`) needs no change: the composer's own shaders compile on the first
   `renderFrame()`, which happens on the very first `animate()` frame — long before any fight. Add a
   one-line comment there saying so, so nobody adds a redundant warm.

### Step 5 — The parallax backdrop layer (`client/src/world.js`)

**5a. Bake a second, coarser nebula.** In `buildMap` (`client/src/world.js:1191-1201`), inside the existing
`if (bakeNebula)` branch, after the base bake:

```js
// Layer 1: a coarser, DIMMER, DIFFERENTLY-SHAPED nebula on a camera-tracking sphere — the depth the flat
// cube cannot give (a cubemap background is sampled by view DIRECTION only, so it is INCAPABLE of parallax
// by construction). Half the cube size and one fewer octave: a blurry mid-ground wash, not detail.
//
// `seed` and `scale` MUST differ from the base cube (D17) — see the note below; they are authorable per map
// through `sky.nebula2`, and both defaults here are CONSTANTS, so the layer draws zero randomness (D15).
const NEBULA2_FALLBACK = { seed: 41, scale: 1.15, thLow: 0.42, thHigh: 0.86, glow: 0.5 };
const nb2 = { ...nb, ...NEBULA2_FALLBACK, ...(d.sky.nebula2 || {}), starB: 0, base: [0, 0, 0] };
G.backdropRT = makeNebulaSky(nb2, { cube: Math.max(128, G.gfx.nebulaBake.cube >> 1),
                                    octaves: Math.max(3, G.gfx.nebulaBake.octaves - 1) });
```

`starB: 0` and `base: [0,0,0]` are **required**: the layer is additive, so its own star field would double
the cube's stars and its base colour would lift the whole sky. Only the nebula wisps must survive.

**Why the seed and scale must differ — this is what makes the layer earn its cost.** The obvious
`{ ...nb, octaves: n-1 }` would inherit the descriptor's `seed: 0` and `scale: 3.6`
(`server/src/catalog_seed.js:903-910`), and an fbm truncated to `n-1` octaves is *literally the first n-1
terms of the same sum* — so the coarse wisps would land exactly on top of the base cube's wisps. The
composite would be "the existing nebula × ~1.35 with a slightly softer edge": it would pass every test and
change almost nothing on screen, which is the same failure mode as the invisible first speed field
(DECISIONS §96). **What must visibly distinguish layer 2 AT REST, before any motion:** a *different seed*
puts its clouds in different directions from the cube's, and a much *lower `scale` (1.15 vs 3.6)* makes them
**~3× larger** — so the eye reads big soft masses in front of the cube's fine structure. That is a
different picture standing still; the parallax then makes it a different *depth*. If, on the rendered
frame, the two layers still read as one, the fix is a bigger `scale` separation (or a small hue offset via
`colA`/`colB`) — not more parallax.

**5b. Build the sphere.** A `THREE.SphereGeometry(radius, 32, 16)` with a `ShaderMaterial`:

```js
side: THREE.BackSide, depthTest: false, depthWrite: false,
transparent: false,                    // <-- LOAD-BEARING, see below. NOT a typo, do not "fix" it.
blending: THREE.AdditiveBlending, fog: false,
uniforms: { uCube: { value: G.backdropRT.texture }, uAmp: { value: POST_DEFAULTS.backdrop.amp },
            uLift: { value: 1 } },
// fragment: gl_FragColor = vec4(textureCube(uCube, normalize(vDir)).rgb * uAmp * uLift, 1.0);
```

`mesh.renderOrder = -3;` `mesh.frustumCulled = false;` and `skyScene.add(mesh)`.

**The not-a-skybox guarantee — it rests on the BUCKET, not on `renderOrder`.** `renderOrder` alone is *not*
a guarantee, and anyone who states it as one is wrong. three splits a scene into **separate render lists**
(`WebGLRenderList`: an object goes to the transparent list iff `material.transparent === true`, three r160
`three.module.js:21366-21370`) and draws **all opaque objects first, then all transparent ones**;
`renderOrder` only sorts *within* a list. Every ecliptic body is **opaque**: the star core
(`world.js:436`, `MeshBasicMaterial`), the planets and moons (`world.js:521,528`, `MeshStandardMaterial`),
and the dim star layer (`world.js:134`, explicitly `transparent: false` with the comment
*"opaque -> drawn in the pass before the planet"*). So a `transparent: true` backdrop sphere would be drawn
**after every one of them** and — being full-screen, `depthTest:false` and additive — would wash nebula over
the planet disks and the terminator and slide across them as the player flies. That is exactly the failure
the feature request marks CRITICAL, and it is why the material is built `transparent: false`.

Additive blending still applies with `transparent: false`: three's `WebGLState.setMaterial` forces
`NoBlending` only when `material.blending === NormalBlending && material.transparent === false`
(`three.module.js:23437`) — an explicit `AdditiveBlending` is always honoured. So the layer:

- sits in the **opaque list**, and `renderOrder: -3` puts it first there, ahead of `G.stars`
  (`renderOrder: -1`, `world.js:1224`) and every system body → the star, planets and moons always paint
  **over** it;
- **adds only** (additive blending), so the base cube's dense star field reads straight through it;
- writes no depth and tests none (`depthWrite:false`, `depthTest:false`) → it can never depth-reject a body.

No body moves; no body's frame changes; the system does not become a skybox. **Verify this by eye at the
review gate** (checklist item): fly to the home planet and confirm there is *no nebula wash over the planet
disk or across the terminator*.

**5c. Per-frame parallax — `export function updateBackdropLayer()`** in `world.js`, called from
`settleView` (`client/src/sim.js:660`) immediately after `G.stars.position.copy(camera.position);`:

```js
// Fractional parallax: `follow` = how much of the camera's motion the layer copies.
//   follow 1 -> locked to the camera = a skybox (no parallax);  follow 0 -> world-fixed (full parallax).
// Accumulated from the camera DELTA (not from |camPos|) and clamped, because the star system spans
// ~21 000 u: an absolute-position formula would drift the layer's centre thousands of units off the
// camera, and once that offset exceeds the sphere radius the camera exits the sphere and the backdrop
// vanishes. Level 4 alone fights at 11 000-16 800 u from the origin (DECISIONS §106), so this is not
// hypothetical. Delta-accumulation keeps parallax alive wherever you actually fight, and merely SATURATES
// (the layer stops drifting) after ~4 km of travel in one direction — imperceptible on a far nebula.
// Consumes NO randomness, touches no sim state: replay-neutral by construction (DECISIONS §73).
_bdOffset.add(_camDelta.subVectors(camera.position, _bdLastCam).multiplyScalar(1 - follow));
_bdOffset.clampLength(0, POST_DEFAULTS.backdrop.offsetMax);
_bdLastCam.copy(camera.position);
mesh.position.copy(camera.position).sub(_bdOffset);
```

On every `buildMap`, reset `_bdOffset` to **zero** and `_bdLastCam` to the **current camera position** —
*not* to the origin. Seeding `_bdLastCam` at `(0,0,0)` would make the first frame's "delta" equal the
camera's absolute position, which on Level 4 (11 200–16 800 u from the origin, DECISIONS §106) instantly
saturates `_bdOffset` to `offsetMax` and kills the parallax for the whole level.

**Geometry sanity (checked, keep it true if you retune):** `radius` 900 + `offsetMax` 250 → the sphere is
never more than 1150 u from the camera, inside `camera.far = 1300` (`engine.js:62`), and its near wall sits
at 650 u — well outside the camera-locked star sphere (`stars.radius: 400`,
`server/src/catalog_seed.js:913`). If you raise `radius`, raise it against `camera.far`, not by feel.

**Expected magnitude, so nobody expects too much:** at `follow = 0.94` the layer's on-screen motion is
about `(1-follow)·d_ship/d_layer ≈ 0.06·110/900 ≈ 0.7%` of a ship's screen speed during combat — correctly
imperceptible frame-to-frame, and a slow, readable drift over a minute of cruising. `follow` is a live
`?tune` knob (range `[0.60, 1.00]`); dial it down if the maintainer wants the backdrop nearer.

**5d. The star lift must drive the sphere too.** `applyStarLift` (`client/src/world.js:649-658`) sets
`skyScene.backgroundIntensity` and multiplies `skyScene.background` **only when it is a `Color`** —
**neither of those touches a mesh material**. Without an explicit hook the sphere would keep its brightness
while the cube behind it lifts, and approaching the star would visibly split the backdrop into two layers
at different brightnesses. So inside `applyStarLift`, after `skyScene.backgroundIntensity = f;`, also write
the same factor to the layer: `if (G.backdropMat) G.backdropMat.uniforms.uLift.value = f;`

**5e. Disposal.** `buildMap` re-runs on every level start / map switch. Dispose the new RT, geometry and
material alongside the existing `G.nebulaRT` disposal at `world.js:1190` — same leak class the nebula RT
and the sky lights were both fixed for (`world.js:1202-1206`).

**5f. Gating.** The layer is built **only** inside the existing `bakeNebula` branch, so it inherits both
gates for free: `nebulaBake: null` on Performance → no layer, and `?debug` → no layer (except under the new
`nebula` opt-in flag, Step 8).

### Step 6 — Silhouette: the emissive floor and the exhaust lift

**6a. The emissive floor — the exact insertion point matters.**

Put it in `client/src/ship-factory.js`, inside the `gltfLoader.load` success callback at **lines 85-87**,
**between** `entry.scene = gltf.scene;` and `warmModel(entry.scene);`:

```js
gltfLoader.load(url, (gltf) => {
  entry.scene = gltf.scene;
  applyHullEmissiveFloor(entry.scene);   // <-- HERE, before warmModel and before any clone is served
  warmModel(entry.scene);
  for (const w of entry.waiters) w(entry.scene.clone(true));
  …
```

```js
// Self-lit floor so a hull is never a black hole against the new backdrop. The combat glbs ship with NO
// emissive at all (verified: every enemy material is a flat baseColorFactor with no textures; only the
// player's PaletteMaterial001/002 carry an emissiveFactor + emissiveMap), and their material names
// (`07_-_Default`, `black_mat_for_body`, `body_color_2`, `PaletteMaterial00N`) identify no engine or trim
// to hook — so this is a uniform floor, not a per-part tint. Same trick as drops.js:53-58.
// Hue-safe: the emissive copies the material's OWN base colour, so nothing is recoloured (D9).
// DELIBERATELY 0.25 — far below the 0.65 bloom threshold. Hulls must NOT glow; they must merely stop
// going black. Engines are the bloom source. Do not raise this until hulls bloom.
function applyHullEmissiveFloor(root) {
  root.traverse((o) => { … for each material:
    if (!m.emissive) return;                                   // not a lit material
    if (m.emissiveMap || m.emissive.getHex() !== 0x000000) return;  // the artist already authored a glow — leave it
    m.emissive.copy(m.color);
    m.emissiveIntensity = POST_DEFAULTS.hullEmissive;
  });
}
```

Two things this placement is guarding against, both of which cost nothing to get right:

- **It must not go in `applyShipModel`'s tint traverse (`ship-factory.js:119-125`).** That block is
  `if (tint)`, and **every ship with a real .glb loads with `tint: false`** (`ship-factory.js:4` and
  `modelSpec` at `:22`, because the exported assets bake colour in). Putting the floor there — the
  natural-looking spot, "by analogy with the tint" — would ship a **silent no-op that passes every test**.
- **It must run before `warmModel()`,** which parks the template in the real scene and calls
  `renderer.compile()` + `renderer.initTexture()` on each texture slot. In honesty: for
  `MeshStandardMaterial`, `emissive` is a plain uniform and the standard fragment shader always includes
  `totalEmissiveRadiance` — so setting it black→coloured does **not** change any `#define` and would not,
  by itself, force a recompile. (The grill's stronger claim that "adding emissive changes the shader
  program" holds for `emissiveMap`, which we deliberately never add.) The ordering is still mandatory,
  because clones are served to waiters on the very next line and any material change made after that would
  miss them — and it is defence-in-depth against exactly the class of first-draw recompile hitch
  (215 ms of `js.render` on a weak phone) that `warmModel` exists to prevent.

This is **§79-safe**: it is a one-time static mutation of the shared **template**, applied before any clone
exists, exactly like `drops.js`'s `normalizeGreen`. It is per ship **type**, not per instance. It draws no
randomness.

*(Amended at merge time.* §79's original premise — "never mutate a live ship's material" — was itself amended
by DECISIONS §137: `applyShipModel` now **clones every material per instance** so the hit flash can light one
ship alone. The template placement is unchanged and is still the right one, but the reason has shifted from
"nothing may be mutated later" to **ordering**: the floor must exist on the template *before* the per-instance
clone, because that clone is what `flashMats` captures as the value the flash restores to. Put the floor after
the clone and a flashed hull would return to black.*)*

**One knock-on to fix in the same file: the ghost-battle darken.** *(Amended after implementation: this
mitigation is real but **INERT** — no caller passes `darken` any more. `ghost-battle.js` builds its spec with
`opacity: 0.9` only; the 0.45 darken was dropped when the battle was found over-dimmed into invisibility. So
the ghost skirmish carries the 0.25 floor uncompensated, which suits its current "watchable distant battle"
intent, and it cannot be checked headlessly because `ghostBattlePlan` disables ghosts under `?debug` on every
tier. The line is kept and labelled defensive-only. **Also added, which this step missed:** the floor must be
re-copied after the tint/accent passes re-assign `material.color`, or the wingman's repainted wings self-light
in the pre-accent hue — see DECISIONS §138(j).)* `applyShipModel`'s readability treatment
(`ship-factory.js:152-160`) clones each material and multiplies **`m.color` only**. With an emissive floor
in place, a ghost would keep its emissive at full strength while its albedo is scaled by `darken` (0.45) —
brighter and flatter than the "distant decor" treatment intends, and the ghosts would fight the real ships
for attention against the new backdrop. One line, inside that same `mats.forEach`:

```js
if (darken && m.emissive) m.emissive.multiplyScalar(darken);   // the floor must dim with the albedo
```

**6b. The exhaust lift.** In `client/src/exhaust-fx.js`, add one `uGain` uniform (default
`postGain(!!G.gfx.post, POST_DEFAULTS.exhaustGain)` — **never the raw constant**, D18: without a composer it
must resolve to 1.0) to the shared plume uniforms (`exhaust-fx.js:156-166`) and multiply the final
colour by it in **both** fragment shaders — `FLAME_FRAG` (`exhaust-fx.js:137`,
`gl_FragColor = vec4(col * uGain, max(0.0, a));`) and `POINTS_FRAG` (`exhaust-fx.js:98`). `uColHot/Mid/End`
are already **linear** (`colVec` goes through `THREE.Color.set`, i.e. `ColorManagement`), so a gain of 1.6
pushes the white-hot core above 1.0 and makes the engine an actual bloom source. **One scalar on all three
palette stops = no hue change** (D9). Expose `uGain` in the `?tune` panel.

**6c. FX HDR retune (`POST_DEFAULTS.fxGain`).** Apply `hdrColor(hex, gain)` from `postfx.js` — never a new
hex — at these sites. **Every gain goes through `postGain` first (D18)**, so give `postfx.js` one wrapper
and use only that:

```js
// postfx.js — the ONLY way FX code reads a gain. On Performance (no composer, no tone mapping) this
// returns the plain colour: a >1 value would clamp per channel at the 8-bit sRGB write, flattening the FX
// AND shifting its hue (0xffb050 x 1.5 clips R and G but not B) — the two things this feature removes.
export const fxColor = (hex, key) => hdrColor(hex, postGain(!!G.gfx.post, POST_DEFAULTS.fxGain[key]));
```

- `client/src/projectiles.js:96` — muzzle flash material `color` (`fxGain.muzzle`).
- `client/src/projectiles.js:118-123` — `spawnExplosion` sprite `color` (`fxGain.explosion`).
- `client/src/projectiles.js:169,177` — shock-ring materials (`fxGain.ring`).
- `client/src/projectiles.js:253,282` — rocket burst / spiral warhead tints (`fxGain.explosion`).
- `client/src/flipbook-fx.js:140` — the `uTint` uniform (`fxGain.explosion`).
- `client/src/bolt-fx.js` — bullet/bolt colours (`fxGain.bolt`).
- `client/src/beam-fx.js` — the **discharge** colour only (`fxGain.bolt`). **Leave the green sight and the
  cyan-white shot hues alone** — that split is a settled look (SUMMARY "Visuals", first bullet). If the
  sight lines bloom (they are thin lines, 1 px), pull their *opacity*, never their colour.
- `client/src/shield-fx.js` — leave alone unless it visibly blows out; it is a faint rim by design.

**The retune goal is NOT "turn everything down" (D8).** The threshold is 0.65 and anything pushed below it
stops blooming *entirely*, which would kill the feature. What changes is the split between **source
brightness** (up, above 1.0, via these gains) and **glow area** (down, via `opacity`/`scale`/particle counts
if the frame reads as a white wash). If something is too bright on screen, reduce its **alpha or size**
first; only reduce a gain if the source itself is wrong.

**On Performance every gain is 1.0 (D18), so the FX there are byte-identical to today** — which is the
correct outcome: with no composer and no tone mapping there is no headroom above 1.0 to spend, and spending
it anyway would clip channels unevenly and break the hue lock. Any `opacity`/`scale` change you make to
tame the glow area, however, applies on **every** tier — so make those changes only if the frame genuinely
needs them, and re-check Performance afterwards.

### Step 7 — Hangar tonemapping (`client/src/model-viewer.js`)

In `buildModelViewer` (`client/src/model-viewer.js:14-15`), after `r.setPixelRatio(…)`:

```js
r.toneMapping = THREE.ACESFilmicToneMapping;          // match the in-game grade (postfx.js) so a ship reads
r.toneMappingExposure = POST_DEFAULTS.exposure;       // the same in the hangar and in the fight
```

No composer, no bloom here (the canvas is `alpha: true` and the loop is menus-only).

**Be precise about what this buys — two things stay different, on purpose, and neither is a bug:**
(1) hangar emissives do **not** glow, because there is no bloom there; (2) the hangar ships do **not** get
the emissive floor either — `setViewerModel` calls `gltfLoader.load` directly
(`client/src/model-viewer.js:115`), a separate parse with its own materials that never passes through
`ship-factory.js`'s template cache. (No §79 collision, and no fix is in scope: the hangar has its own key
light at 2.4 and its own ambient at 1.4, `model-viewer.js:20-21`, so nothing there is going black.) What
Step 7 actually delivers is **the same tone curve** in both places — not a pixel-identical ship.

### Step 8 — Live tuning (`client/src/tune.js`) and the `nebula` test flag

**8a.** Add a `Post` folder to `buildTunePanel` (`client/src/tune.js:28`), writing straight to the live
uniforms so a drag is instant: exposure, bloom strength / radius / **threshold**, vignette strength /
softness, grade gain (r,g,b) + saturation, exhaust `uGain`, and backdrop `amp` / `follow`.
Extend `dumpPalette` (`tune.js:9-26`) with a `POST_DEFAULTS` block so the dialed numbers can be pasted back
into `graphics.js`.

**Do NOT add dust `size` sliders here.** Size sliders for all three layers already exist in the `?dev`
Backdrop → "Speed field" folder (`world.js:811-813`), they write the live `material.size` **and persist to
localStorage**, and they are the panel whose values `buildMap` re-applies (Step 2.4). A second set of size
sliders in `?tune` writing the same value on a different, non-persisted path would be two panels with two
behaviours for one number — exactly what DECISIONS §30 forbids. Tune the dust where the dust already lives.

Label the **bloom threshold** slider with the dust line: range `[0.40, 1.20]`, and a `.name('threshold
(dust glows below 0.61)')`. Note in the folder's comment that the shipped value is guarded by a unit test
(Step 1.3) — dialing below the dust is a live experiment, not something that can ship.

**8b.** While in this file, guard the **two** pre-existing latent crashes on the same cause — with the
nebula baked, `skyScene.background` is a **cube texture**, not a `Color`:
- `tune.js:34` — `bg.addColor(bgC, 'background').onChange(v => skyScene.background.set(v))` throws
  (`Texture.set` does not exist);
- `tune.js:12` — `dumpPalette`'s `background: H(skyScene.background)` throws the same way
  (`H = c => '0x' + c.getHexString()`).

One `isColor` guard at each site (and a `'(baked nebula cube)'` string in the dump when it is not a Color).

**8c. The `nebula` opt-in flag.** In `client/src/world.js:1194`, widen the bake gate:

```js
const bakeNebula = G.gfx.nebulaBake &&
  (!location.search.includes('debug') || location.search.includes('nebula'));
```

**Why this instead of a scenario that drops `?debug` entirely** (a deliberate, reasoned deviation from the
brief): without `?debug` the game does not expose `window.__game` (`main.js:1273`), and the
backdrop-brightness assertion in Step 9 needs the player's world→screen projection (`__game.player`,
`__game.camera`) to find the hull pixels. Dropping `?debug` would therefore make the very measurement the
brief asks for impossible. `?debug&nebula` gives the **same** coverage — real bake, real parallax layer,
real composer — while keeping the hooks, and it leaves every existing scenario byte-identical (they never
pass `nebula`). Document the flag in the `?debug` tools list in SUMMARY.

### Step 9 — Tests

**9a. Unit (`cd client && node --test`).**
- `client/src/graphics.test.js` — the three new tests from Step 1.3.
- `client/src/speed-field.test.js` — one test for `linearLuma601` (`0xd2ccc1 → 0.6079 ± 0.001`, and
  `linearLuma601(0x000000) === 0`, `linearLuma601(0xffffff) === 1`). The existing contrast / budget /
  `deepEqual` tests need **no** edits (Step 2.4).
- **No test may import `postfx.js`, `world.js` or `ship-factory.js`** — `node --test` cannot resolve the
  browser importmap's `three`. That is exactly why the constants live in `graphics.js`.

**9b. New visual scenario `client/visual/scenarios/43-expensive-look.mjs`.**
*(Numbered 42 when this plan was written; `main` took 42 for `42-hit-feel.mjs` in the meantime, so the
scenario ships as **43**. Every reference in this file has been updated.)*

**Contents.****

Opens its own URL `${origin}/?debug&nebula` (the pattern `22-intro-replay.mjs:35` already uses), starts the
fight, clears enemies, waits for a settled frame, then does one `page.evaluate` with `gl.readPixels` inside
a `requestAnimationFrame` (same technique as `99-fill.mjs:12-13`, which must read *within* the frame because
the drawing buffer is not preserved). Note the buffer read is the **final, tonemapped sRGB image** — i.e.
what the player actually sees — so all luminances below are sRGB 0..1, matching `speed-field.js`'s
`BG_LUMA` convention.

It asserts four things (1–4 below) and needs one prerequisite hook (0). Two of the four are written
carefully because the *obvious* formulations are **true on a broken frame** — they would be decoration
rather than tests:

0. **Prerequisite — `postfx.js` must expose its own state**, and `main.js` must publish it on the `?debug`
   hook next to the existing getters (`main.js:1273`+):

   ```js
   // postfx.js — the chain's own state (composer/bloomPass are module-local)
   export const postStatus = () => ({ active: !!composer, bloom: !!bloomPass });
   // world.js — the backdrop material is built there (Step 5b), so its knobs live there too
   export const backdropAmp = () => (G.backdropMat ? G.backdropMat.uniforms.uAmp.value : null);
   export function setBackdropAmp(v) { if (G.backdropMat) G.backdropMat.uniforms.uAmp.value = v; }
   // main.js __game (next to the existing getters)
   get postfx() { return { ...postStatus(), amp: backdropAmp() }; },
   setBackdropAmp,
   ```

1. **The composer is really live.** Assert `__game.postfx.active === true` **and**
   `__game.postfx.bloom === true`, plus `renderer.toneMapping === THREE.NoToneMapping` (the D3 guard) and
   zero page errors. *Do not* use "zero page errors + NoToneMapping" on its own as the liveness check: that
   pair is **equally true when `createPostFx()` threw or `G.gfx.post` resolved null** and the frame silently
   fell back to the raw two-pass path — i.e. it asserts the opposite of what it claims to guard.
2. **The new parallax layer is really contributing** (the perception check — a visual change can pass
   everything and ship invisible). Measure it **differentially, in the same frame sequence**: read the
   background rectangle once with `__game.setBackdropAmp(0)`, then again at the shipped amp, and assert a
   real luminance delta — start at `meanLuma(amp) - meanLuma(0) >= 0.01`, and restore the amp afterwards.
   *Do not* assert an absolute floor like `bgP99 >= 0.02`: the baked cube and the star field already satisfy
   that today, so it would say nothing whatsoever about the layer this feature adds.
3. **The backdrop brightness ceiling (D13).** Project `__game.player.pos` through `__game.camera` to a
   screen box (~60×60 px), then:
   - `bgP99` = 99th-percentile luminance of the **whole sky** (every pixel outside the ship box);
   - `hullLit` = the ship-box pixels whose luminance **exceeds** `bgP99`; assert there are at least ~200 of
     them (fewer means the silhouette has already failed);
   - `hullP25` = 25th percentile of `hullLit` — "the dimmer end of the lit hull";
   - **assert `hullP25 >= FLOOR × bgP99`.**
   Print all four numbers so the maintainer can retune the margin at the review gate.

   > **AMENDED AFTER MEASUREMENT (2026-08-30).** `FLOOR` was specified as **1.5**; the real frame measures
   > **1.30x**, and it did so *before this feature too* — the pre-existing baked nebula cubemap is ~95% of
   > `bgP99`, and with this feature's parallax layer switched fully off the ratio is still only ~1.36x. The
   > **measurement is unchanged** (whole-sky p99 vs hull p25 — deliberately not the weaker ring/median form),
   > but the shipped `FLOOR` is **1.25**, a *regression floor* just under the observed minimum rather than an
   > absolute ceiling. Observed spread across five runs: 1.2981 / 1.3040 / 1.3040 / 1.3040 / 1.3048 (~0.5%),
   > plus 1.2988 and 1.2996 in-suite. Mutation-checked: raising `backdrop.amp` to 0.45 trips it (1.213x),
   > 0.35 does not (1.270x), so it bites at ~amp 0.40. See DECISIONS §138(k).

4. **Nothing is blown out at rest:** the share of pixels with all channels ≥ 250 is under ~0.5% on a frame
   with no explosion.

Save a screenshot (`shot()`), which is the human perception check the automated numbers cannot replace.

**9c. Extend `client/visual/scenarios/99-fill.mjs`** (do not write a new probe — it already measures
explosion screen coverage per frame):
- add a **blown-out ceiling**: over the 14 sampled frames, the peak share of pixels with all channels ≥ 250
  must stay **under 2%** of the frame;
- add a **wash floor**: at that same peak frame, at least **60%** of pixels must still be below luminance
  0.25 (the frame must not turn into a white sheet);
- **translate the two Russian `console.log` lines at `99-fill.mjs:23-24` into English** (project rule).

Both thresholds are **starting points** — print the measured numbers and confirm/adjust them against a real
frame at the review gate before merge.

**9d. Mandatory guard.** `cd client && node visual/run.mjs 22-intro-replay` — must stay green:
**4 kills, cards p0..p4, win, tick 2474.**

**9e. Wider suite.** `cd client && npm run test:visual`, judged against a **main baseline**: roughly 6
scenarios are flaky at baseline, so the signal is *"the reliably-passing set still passes and there are zero
page errors"*, not *"everything is green"*. Run the same suite on `main` first if anything looks off.

**Watch WALL TIME on that baseline comparison, not only pass/fail.** Under `?debug` every scenario now pays
~14 extra full-screen passes on SwiftShader, and several scenarios settle on wall-clock waits — so a
composer that is too expensive shows up first as *timeouts that look like flakes*, not as a clean failure.
The runner already prints per-scenario timings; compare them against the `main` run. If the suite is
materially slower, tighten Step 3g's `?debug` cost cap (e.g. `bloomScale: 0.25` under `?debug`) rather than
loosening the scenarios' timeouts.
Pay particular attention to `31-speed-field`, `32-star-system`, `27-smoke-instancing`, `39-charge-beam`,
`40-enemy-beam` and `02-ship-explosion` — those touch surfaces this change moves.

**9f. Server.** `cd server && npm test` (the descriptor change in Step 2.3 is covered by
`server/src/maps_speedfield.test.js`).

**9g. Do NOT run the A/B perf bench** (D16, opt-in, 25–40 min).

### Step 10 — Stale documentation and comments to fix in this pass

- **`docs/DECISIONS.md:773-790`** — §23's "Follow-up (2026-06-25)" still documents `renderScale` as a live
  tier knob. It was **removed on 2026-06-27** (measured useless on two real GPUs). Rewrite that bullet in
  the past tense as a *finding* ("tried and removed — resolution levers are a dead end here"), matching the
  note that already exists in `client/src/graphics.js:22-26` and the assertion at
  `client/src/graphics.test.js:37`.
- **`client/src/hud.js:161-163`** — the perf-overlay comment still describes `renderScale` as live
  ("CSS size × pixelRatio × renderScale"). Correct it, and add that `calls` now includes the composer's
  full-screen passes.
- **`client/visual/scenarios/99-fill.mjs:23-24`** — Russian console text → English (Step 9c).

### Step 11 — Docs

- **`docs/CHANGELOG.md`** — one bullet under a `## 2026-08-30` heading (create it), newest on top. Lead with
  a bold summary phrase, then what changed and the user-visible effect. Cover all of it: the post chain and
  its tier gating, the parallax backdrop layer, the emissive floor (+ the matching ghost-battle darken) and
  the exhaust lift, the FX HDR retune **and the fact that Performance keeps its FX unchanged**, the larger
  dust, the new `?debug&nebula` flag, the two `?tune` cube-texture crash guards, and the doc/comment
  corrections.
- **`docs/SUMMARY.md`** — bump `**Updated:**` (line 6) and edit **in place**:
  - `## Visuals` (line 1957) — a new lead bullet for the post-processing chain (pass order, HDR linear →
    bloom → ACES, the 0.65-vs-0.607 dust rule, tier gating, `postfx.js`, `renderFrame()` shared with the
    bench, and **`postGain`: HDR gains exist only where a composer does**, so Performance's FX are
    unchanged). A second bullet for the emissive floor + exhaust gain (and that ghosts dim both).
  - The **"Sky backdrop is a baked procedural nebula cubemap"** bullet (line 2016) — extend it with the new
    additive parallax layer: how it is built (its **own** seed + noise scale, D17), the
    `follow`/`offsetMax`/`radius` mechanics, the star-lift hook, and the not-a-skybox guarantee stated in
    terms of the **opaque render list**, not `renderOrder`.
  - The **"parallax layer is a PLAYER-LOCKED WRAPPING SPEED FIELD"** bullet (line 2038) — the new sizes
    (1.04 / 1.69 / 2.6) and the fact that the bloom threshold is set above the dust on purpose.
  - The **"Dev palette tuning panel (`?tune`)"** bullet (line 2194) — the new `Post` folder.
  - **"Graphics quality tiers"** (line 2590) — the new `post` knob and what each tier gets.
  - `## Client module layout` (line 3186) — add `postfx.js`.
  - `## Tests` (line 3880) — the new unit tests, `43-expensive-look`, and the extended `99-fill`.
  - The `?debug` tools list — the new `nebula` opt-in flag.
- **`docs/DECISIONS.md`** — add **§137** (verified free; §136 is currently the last). Suggested title:
  *"The post chain renders LINEAR, blooms, THEN tonemaps — and the bloom threshold sits above the dust"*.
  It must record: (a) the HDR-linear → bloom → ACES-in-the-final-pass order and why the reverse is wrong;
  (b) why `OutputPass` is not used (the per-frame `needsUpdate` recompile); (c) the `HalfFloatType`
  requirement; (d) the 0.607 dust luma forcing a 0.65 threshold, and that this preserves §96's "dust, not
  sparks"; (e) tier gating by **pass count**, not resolution, citing §23's finding that weak phones are
  CPU-submit-bound rather than fill-bound; (f) the emissive floor at 0.25 being deliberately below the
  threshold so hulls never glow — and that the unit test for it is necessary, not sufficient;
  (g) **HDR gains are a property of the composer, not of the FX** — without one, a >1 colour clips per
  channel and shifts hue, so `postGain` pins every gain to 1.0 on Performance (D18); (h) the not-a-skybox
  guarantee resting on the **opaque render list** (`transparent: false` + additive + `depthTest:false`),
  with the explicit note that `renderOrder` alone would NOT have been a guarantee because three draws the
  whole transparent list after the whole opaque one; (i) the parallax layer needing its **own seed and
  noise scale**, since an `octaves-1` truncation of the same fbm is the same picture (D17).
  **Re-check the number is still free before writing** — parallel sessions collide on §-numbers.

---

## Acceptance checklist

- [ ] `cd client && node --test` — green, including the three new `graphics.test.js` tests and the
      `linearLuma601` test.
- [ ] `cd server && npm test` — green (Postgres; `npm test` drops+recreates `spacegame_test`).
- [ ] `cd client && node visual/run.mjs 22-intro-replay` — green: **4 kills, cards p0..p4, win, tick 2474**.
- [ ] `cd client && node visual/run.mjs 43-expensive-look` — green, and its four printed numbers are sane.
      Note the D13 line reads `ceiling ratio 1.30x (D13 ideal 1.50x, shipped regression floor 1.25x)` — the
      ideal is knowingly not met and is not this feature's to fix (amended D13 row above; DECISIONS §138(k)).
- [ ] `cd client && node visual/run.mjs 99-fill` — green; the blow-out and wash numbers printed and sane.
- [ ] `cd client && npm run test:visual` — judged against a `main` baseline: the reliably-passing set still
      passes, **zero page errors**.
- [ ] **Look at a real frame** (`client/visual/__screenshots__/`, plus a live build). Confirm by eye:
      bloom on weapons/engines and *not* on the dust; the backdrop reads as depth, not as a bright wall;
      enemy hulls read against it at combat distance; **the two nebula layers read as two** (different cloud
      shapes/scales, not one wash) even standing still; and — the Blocking-1 guarantee — fly to the home
      planet and confirm there is **no nebula wash over the planet disk or across the terminator**.
- [ ] Confirm the **larger dust** actually appears — with the `?dev` stored speed-field tune cleared or in a
      clean profile (Step 2.4), since a stored tune replaces the descriptor wholesale.
- [ ] Set the tier to **Performance** and confirm: no composer is built (`__game.postfx.active === false`),
      the render path is today's, and **no FX is clipped or hue-shifted** — muzzle flashes, explosions,
      rings and bolts must look exactly as they do on `main` (D18). The emissive floor and the larger dust
      *are* expected to be visible there; the FX brightness is not expected to change at all.
- [ ] Open the hangar and a briefing model viewer — the ship's **tone curve** matches the fight (it will not
      glow and will not carry the emissive floor; see Step 7).
- [ ] Grep sweep before finishing: `grep -rn "renderScale" client/ docs/` (only the "tried and removed"
      notes + the guard test may remain) and `grep -rn "OutputPass\|toneMapping" client/src/` — the only
      legitimate `toneMapping` assignment in the whole client is `model-viewer.js` (D10); the **main**
      renderer must never be assigned one (D3), and `OutputPass` must not appear at all (D2).
- [ ] CHANGELOG bullet, SUMMARY sections updated to the end state, DECISIONS §138 added.

---

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **No fresnel / rim-light shader** on ships, and no `onBeforeCompile` material injection. The emissive
  floor plus bloom is the whole silhouette pass.
- **No per-ship emissive authoring** in `catalog_seed.js`, no material-name allowlists, no re-exported glbs.
  No model/asset file changes at all — therefore **no `CREDITS.md` change and no `/publish-itch` step** is
  required by this feature (no content-hashed asset URL moves).
- **No second parallax layer**, no volumetric/god-ray pass, no depth-of-field, no motion blur, no SSAO,
  no colour LUT texture.
- **No FXAA/SMAA/TAA pass** — MSAA on the composer RT is the whole AA story (D5).
- **No live graphics-tier switching.** Picking a tier still reloads (`client/src/settings.js:40-45`); that
  is what makes the composer's construction-time knobs safe.
- **No player-facing post-processing toggle** separate from the quality tier.
- **No hue changes anywhere** (D9), and no re-authoring of the beam's green-sight / cyan-shot split.
- **No sim, balance, economy, HUD-layout or audio changes.** Nothing in `sim-core/`.
- **Do not run the A/B perf bench** (D16).
