# Plan: Performance quality tiers (High / Balance / Performance)

**Goal.** Add a **graphics quality selector** to the existing settings menu with three tiers —
**High** (today's behavior, the default), **Balance**, **Performance** — so weak phones (e.g. Samsung
Galaxy A14) can trade visual fidelity for frame rate. Persisted in `localStorage` like the audio
settings. Default stays **High** so nothing changes for existing/desktop players.

**Why (the actual mobile bottleneck).** The perf overlay shows `draw 74 · tris 66k` — both are trivial
even for an entry mobile GPU. Weak phones bottleneck on **fragment/fill rate**, which the overlay does
*not* show. The dominant cost is `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`
(`client/index.html:606`): on a phone with DPR ≈ 2.6 this renders at **2× resolution**, and the scene is
drawn in **two full-screen passes** (sky + combat, see DECISIONS §5), multiplied by **additive-particle
overdraw** (explosions, sparks, exhaust, shockwaves, the bright-star glow). So the levers, by impact:
1. **Pixel ratio cap** — biggest single win (halving it ≈ ¼ the fragment work).
2. **Antialias (MSAA)** off — extra mobile bandwidth/memory.
3. **Particle density** — fewer/smaller additive quads → less overdraw (helps the combat-time dips).
4. **Star count** — 2500 points × 2 layers in the sky pass.

Draw calls and triangle count are **not** in scope to reduce — they aren't the bottleneck.

All client edits are in `client/index.html` unless noted, plus one new module `client/src/graphics.js`
(mirrors `client/src/audio.js`). Pure dev/runtime tooling; the default build (tier = High) is unchanged.

---

## The model — a `graphics.js` settings module (mirror `audio.js`)

Create **`client/src/graphics.js`**, structured exactly like `client/src/audio.js`
(`AUDIO_STORAGE_KEYS` / `AUDIO_DEFAULTS` / `loadAudioSettings` / `saveAudioSettings` at
`client/src/audio.js:14-48`). Keep it **pure** (no THREE, no DOM) so it's unit-testable.

```js
// client/src/graphics.js
// Graphics quality tiers. Pure data + persistence (no THREE/DOM) so it's testable and can be read
// BEFORE the renderer is constructed (antialias is a constructor arg). See docs/plans/performance-
// quality-tiers.md and DECISIONS §23.
export const GRAPHICS_STORAGE_KEY = 'gfxTier';
export const GRAPHICS_DEFAULT = 'high';

// Each tier's knobs. pixelRatioCap + antialias drive fragment cost (the mobile bottleneck);
// starScale/particleScale thin the additive overdraw. Starting points — tune on a real A14.
export const TIERS = {
  high:        { label: 'High',        pixelRatioCap: 2,   antialias: true,  starScale: 1.0,  particleScale: 1.0 },
  balance:     { label: 'Balance',     pixelRatioCap: 1.5, antialias: false, starScale: 0.6,  particleScale: 0.6 },
  performance: { label: 'Performance', pixelRatioCap: 1,   antialias: false, starScale: 0.35, particleScale: 0.4 },
};
export const TIER_ORDER = ['high', 'balance', 'performance'];

// Resolve a tier name (anything unknown → default) to its knob object, with the name attached.
export function resolveTier(name) {
  const key = TIERS[name] ? name : GRAPHICS_DEFAULT;
  return { name: key, ...TIERS[key] };
}

// Load the saved tier name from a localStorage-like store; default if missing/garbage.
// firstRunTouchDefault: if there is NO saved value yet AND the device is touch, suggest 'balance'
// (so a phone's first run isn't the heaviest mode). Pass isTouch from the caller.
export function loadTier(store, isTouch = false) {
  let saved = null;
  try { saved = store && store.getItem(GRAPHICS_STORAGE_KEY); } catch {}
  if (saved && TIERS[saved]) return saved;
  return isTouch ? 'balance' : GRAPHICS_DEFAULT;
}

export function saveTier(store, name) {
  const key = TIERS[name] ? name : GRAPHICS_DEFAULT;
  try { store && store.setItem(GRAPHICS_STORAGE_KEY, key); } catch {}
  return key;
}
```

**Decision (answered inline, do not re-ask):** default is **High** for desktop, but on a **touch
device's first run** (no saved value) default to **Balance** — phones shouldn't open in the heaviest
mode. Once the player picks a tier it's remembered. This is `loadTier(store, isTouch)`'s behavior.

---

## Step 1 — Load the tier before the renderer; apply pixel ratio + antialias

`antialias` is a **`WebGLRenderer` constructor argument** — it cannot be changed on an existing
renderer. So the tier must be known *before* `client/index.html:605`. The imports are at
`client/index.html:568-574`; add the import and resolve the tier there.

Add after the audio import (`client/index.html:574`):
```js
import { loadTier, resolveTier, saveTier, TIERS, TIER_ORDER } from './src/graphics.js';
```
Add near the audio bootstrap (`client/index.html:578`), and note `isTouch` is defined later
(`client/index.html:1729`) — duplicate the tiny check here so it's available at module top:
```js
const _touchEarly = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
let gfx = resolveTier(loadTier(window.localStorage, _touchEarly)); // current quality knobs (live-mutated on change)
```
Change the renderer creation (`client/index.html:605-606`) to read the tier:
```js
const renderer = new THREE.WebGLRenderer({ antialias: gfx.antialias });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, gfx.pixelRatioCap));
```

**Runtime changes (what applies live vs. on reload) — decision answered inline:**
- **Pixel ratio + star/particle density apply LIVE** (the dominant lever is live → instant feel).
- **Antialias applies on the next page reload** (recreating the GL renderer mid-game is risky:
  re-uploads textures, the two-pass loop holds the `renderer` ref). The settings UI shows a small note
  for the AA part only. This is the standard "some options apply after restart" pattern and keeps the
  change small. Do **not** rebuild the renderer.

Add a live-apply helper (near the resize handler, `client/index.html:2982`). Note `setPixelRatio` alone
does not realloc the drawing buffer — you must call `setSize` after it:
```js
function applyGraphicsLive() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, gfx.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight); // realloc buffers at the new ratio
  if (stars) { skyScene.remove(stars); stars = makeStars(Math.round(currentMapDescriptor.stars.count * gfx.starScale), currentMapDescriptor.stars.radius); stars.renderOrder = -1; skyScene.add(stars); }
}
```
(`currentMapDescriptor` already exists at module scope — added for the `?tune` panel,
`client/index.html` `buildMap`. If rebuilding stars here feels heavy, the simpler version only changes
`setPixelRatio` + `setSize` live and lets the star count update on the next `buildMap`.)

The resize handler (`client/index.html:2982-2986`) already calls `setSize`, which preserves the current
pixel ratio — no change needed there.

---

## Step 2 — Scale the star count in `buildMap`

`makeStars(count, radius, brightFraction)` is defined at `client/index.html:737` and called at
`client/index.html:1197`. Scale the count by the tier:
```js
stars = makeStars(Math.round(d.stars.count * gfx.starScale), d.stars.radius);
```
(2500 → 1500 at Balance → ~875 at Performance.)

---

## Step 3 — Scale particle density (the additive-overdraw lever)

Add one helper near the particle pools (just above `spawnExplosion`, `client/index.html:1323`):
```js
const scaledCount = (n) => Math.max(1, Math.round(n * gfx.particleScale));
```
Apply at the spawn sites:

1. **Ship-explosion sparks** (`client/index.html:1358`): `const N = scaledCount(22);`
2. **Fireball layers** (`client/index.html:1352-1355`) — these four stacked large additive spheres are
   heavy overdraw. On lower tiers drop the two middle layers:
   ```js
   spawnExplosion(pos, 5 * s, 1.05, 0xffffff);          // white-hot core (always)
   if (gfx.particleScale >= 0.7) spawnExplosion(pos, 8 * s, 1.8, exhaustColor);
   if (gfx.particleScale >= 0.7) spawnExplosion(pos, 11 * s, 2.55, 0xffc040);
   spawnExplosion(pos, 14 * s, 3.75, 0xff3a18);          // red outer cloud (always)
   ```
3. **Engine exhaust** (`emitExhaust`, `client/index.html:1409`) — emitted per-frame per thrusting ship;
   throttle probabilistically so lower tiers shed fewer puffs (cheap overdraw cut):
   ```js
   function emitExhaust(shipPos, fwd, shipVel, exhaust, sizeScale = 1) {
     if (gfx.particleScale < 1 && Math.random() > gfx.particleScale) return; // thin the trail on low tiers
     ...
   }
   ```
4. **Shockwave ring** (`client/index.html:1376-1385`) — one big `DoubleSide` additive quad per ship
   death. Optional: skip on Performance — `if (gfx.particleScale >= 0.5) { ...the ring... }`.

These read the live `gfx`, so switching tier mid-game affects subsequent spawns immediately.

---

## Step 4 — Settings UI: a 3-way quality selector

The settings modal markup is `client/index.html:522-541`; the wiring is `client/index.html:3111-3162`.
The audio On/Off toggles (`.set-toggle`) are the styling precedent.

**Markup** — add a row before the Close button (`client/index.html:538`, after the SFX row):
```html
    <div class="set-row">
      <label data-i18n="ui.settings.quality">Graphics quality</label>
      <div id="set-quality" class="seg">
        <button class="seg-btn" data-tier="high"        data-i18n="ui.settings.quality.high">High</button>
        <button class="seg-btn" data-tier="balance"     data-i18n="ui.settings.quality.balance">Balance</button>
        <button class="seg-btn" data-tier="performance" data-i18n="ui.settings.quality.performance">Performance</button>
      </div>
    </div>
    <div class="set-note" id="set-quality-note" data-i18n="ui.settings.quality.note">Antialiasing changes apply after reload.</div>
```
**CSS** — add beside the `.set-toggle` rules (`client/index.html:328-333`):
```css
  #settings-overlay .seg { display: flex; gap: 8px; flex: 0 0 auto; }
  #settings-overlay .seg-btn { padding: 8px 14px; border-radius: 8px; cursor: pointer;
    background: rgba(120,130,150,.18); color: #9aa6bd; border: 1px solid rgba(150,160,180,.35); }
  #settings-overlay .seg-btn.on { background: rgba(91,134,229,.35); color: #eaf1ff; border-color: #5b86e5; }
  #settings-overlay .set-note { font-size: 13px; opacity: .6; margin: -10px 0 8px; }
```
**Wiring** — add near the audio wiring (`client/index.html:3155`), and call it from
`renderSettingsUI`/`localizeSettings`:
```js
const setQuality = document.getElementById('set-quality');
function renderQualityUI() {
  setQuality.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.tier === gfx.name));
}
setQuality.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  gfx = resolveTier(saveTier(window.localStorage, b.dataset.tier)); // persist + adopt new knobs
  applyGraphicsLive();   // pixel ratio + stars now; AA on next reload
  renderQualityUI();
});
```
Call `renderQualityUI()` inside `renderSettingsUI()` (`client/index.html:3118`) so it reflects the
current tier whenever the modal opens.

---

## Step 5 — i18n keys (English source + Russian)

Add to **`client/locales/source.json`** (after the existing `ui.settings.*` block, ~line 140):
```json
  "ui.settings.quality": { "source": "Graphics quality", "context": "Label for the 3-way graphics quality selector (High/Balance/Performance) in the settings modal." },
  "ui.settings.quality.high": { "source": "High", "context": "Graphics quality tier: full resolution + antialiasing + all effects (desktop default). Short, one word if possible." },
  "ui.settings.quality.balance": { "source": "Balance", "context": "Graphics quality tier: middle ground between quality and frame rate. Short." },
  "ui.settings.quality.performance": { "source": "Performance", "context": "Graphics quality tier: lowest resolution + fewest effects for weak phones, highest frame rate. Short." },
  "ui.settings.quality.note": { "source": "Antialiasing changes apply after reload.", "context": "Small hint under the quality selector: most changes are instant, but the antialiasing part takes effect only after the page is reloaded." }
```
Add the matching keys to **`client/locales/ru.json`** (~line 140):
```json
  "ui.settings.quality": "Качество графики",
  "ui.settings.quality.high": "Высокое",
  "ui.settings.quality.balance": "Баланс",
  "ui.settings.quality.performance": "Производительность",
  "ui.settings.quality.note": "Изменения сглаживания применяются после перезагрузки."
```
(Confirm the locale loader picks up new keys automatically — `t()` from `client/src/i18n.js`; the
settings labels are localized via `data-i18n` + the JS `localizeSettings()` at
`client/index.html:3157`.)

---

## Step 6 — (Optional, recommended) show resolution in the perf overlay

The overlay (`client/index.html:2316-2330`) shows fps/ms/draw/tris but not the hidden mobile driver
(pixel ratio / backing-buffer size). Optionally extend `ui.perf` with the effective pixel ratio so the
tier's effect is visible while testing, e.g. append ` · ${renderer.getPixelRatio()}x`. Keep terse.
Defer if it complicates the i18n string; not required for the feature.

---

## Tests

Add **`client/src/graphics.test.js`** (mirror `client/src/audio.test.js`), `node --test`:
- `resolveTier('performance')` → `pixelRatioCap: 1, antialias: false`; `resolveTier('nonsense')` →
  the High default with `name: 'high'`.
- `saveTier` then `loadTier` round-trips; `loadTier` on an empty store → `'high'` (desktop) and
  `'balance'` when `isTouch = true`.
- A fake store whose `getItem`/`setItem` throw must not throw (try/catch, like `audio.js`).

Run `npm run test:visual` from `client/` — all scenarios should still pass at the default High tier
(no behavior change). Optionally add a scenario that flips `window.localStorage.gfxTier` before load and
asserts `renderer.getPixelRatio()` via a `?debug` hook (expose `gfx`/`renderer.getPixelRatio()` on
`window.__game`).

---

## Docs to update (when implemented)

- **`docs/SUMMARY.md`** — "Tools" → settings menu: note the new **Graphics quality** selector
  (High/Balance/Performance, persisted; what each tier changes — pixel ratio, antialias, star/particle
  density). Bump `**Updated:**`.
- **`docs/CHANGELOG.md`** — bullet under the date.
- **`docs/DECISIONS.md`** — **new §23** "Performance quality tiers": record that the mobile bottleneck
  is fill rate (pixel ratio × two passes × additive overdraw), **not** draw calls/triangles; that pixel
  ratio is the primary live lever and antialias is applied on reload (no mid-game renderer rebuild);
  the default is High (Balance on a touch device's first run); and the tier knob table lives in
  `client/src/graphics.js`.

---

## Verification

- Open settings → switch to **Performance**: the scene should visibly drop resolution and thin the
  stars/particles immediately; `renderer.getPixelRatio()` returns `1`. **Reload** → antialias is now
  off. Switch back to **High** → crisp again after reload for AA.
- `http://localhost:4000/` default (High) is byte-for-byte the same behavior as today.
- `npm run test:visual` (from `client/`) — no regression.
- Real-device check: a Galaxy A14 (or Chrome DevTools device emulation + CPU/GPU throttling) — confirm
  Balance/Performance raise the frame rate during combat (the explosion-heavy moments).

## Open items (defaults chosen above)

1. **Default tier** — High everywhere, except **Balance on a touch device's first run** (chosen). Drop
   the touch-default if you'd rather everyone start on High.
2. **Antialias at runtime** — applied **on reload** (chosen; no renderer rebuild). If instant AA is
   wanted later, add a `rebuildRenderer()` that disposes + recreates and re-runs `buildMap`.
3. **Tier numbers** — `pixelRatioCap`/`starScale`/`particleScale` per tier are starting points; tune on
   a real A14 (Performance may want `pixelRatioCap: 1` even on a 1080p panel).
4. **Shockwave on Performance** — kept-but-optional to skip (Step 3.4); decide by eye on-device.
