# Plan: Dev color/lighting tuning panel (`?tune`)

**Goal.** A **dev-only** live tuning panel (lil-gui, gated by `?tune`) to dial in the space backdrop +
lighting palette in real time, then **bake** the chosen values into the seed/code. Not shipped to
players.

**Why a dev tool, not a player setting (decided with the user).** It gives **per-element** control and
**exact value export** with **zero combat-readability risk**. A player slider only moves 1–2 global
knobs, can't pick specific colors, can't read off exact hex/intensity, and risks washing out bullets/
exhaust/markers against the carefully-tuned near-black palette (see DECISIONS §5 — the two-pass
lighting invariant). A narrow, clamped *player* "space brightness" slider can be added later, but the
dev panel is a prerequisite for choosing its safe range anyway.

**Scope (decided): "космос + свет"** — space `background` + `fog` + **sky** lighting (ambient/sun, the
terminator) + **combat** lighting (ambient/sun). Planet: halo live (optional), ocean via a rebuild
button (it's a baked texture). No HUD/ship-effect colors in this pass; no player-facing setting.

All edits are in `client/index.html` unless noted. Pure dev tooling — the default build is unchanged.

---

## Library: lil-gui from three addons (no new CDN entry)

The importmap already maps `three/addons/` → `https://unpkg.com/three@0.160.0/examples/jsm/`
(`client/index.html:505`), and lil-gui ships there. Import it **dynamically inside the `?tune` guard**
so players never download it:
```js
const { default: GUI } = await import('three/addons/libs/lil-gui.module.min.js');
```

## Step 1 — Hoist light references to module scope (so the panel can mutate them live)

Today some lights are anonymous/local and can't be reached after creation:

- **Combat ambient** — `client/index.html:551` is anonymous. Name it:
  ```js
  const combatAmbient = new THREE.AmbientLight(0x405070, 1.2);
  scene.add(combatAmbient);
  ```
- **Sky ambient + sky sun** — created locally inside `buildMap` (`client/index.html:1034-1037`). Declare
  module-scope holders near the other sky vars (~`client/index.html:558-560`):
  ```js
  let skyAmbient = null, skySun = null;
  ```
  and assign them in `buildMap` instead of anonymous/`const`:
  ```js
  skyAmbient = new THREE.AmbientLight(d.sky.ambient.color, d.sky.ambient.intensity);
  skyScene.add(skyAmbient);
  skySun = new THREE.DirectionalLight(d.sky.sun.color, d.sky.sun.intensity);
  skySun.position.set(...d.sky.sun.pos);
  skyScene.add(skySun);
  ```
- Already reachable: combat `sun` (`client/index.html:552`, module-scope), `scene.fog`
  (`client/index.html:521`), `skyScene.background`.

## Step 2 — The tune panel (gated by `?tune`)

Build it **after the first `buildMap`** so the refs exist (bootstrap calls `buildMap` at
`client/index.html:3161`). Place the guard near the existing `?debug` hook (`client/index.html:2745`,
same convention) or at the end of bootstrap:
```js
if (location.search.includes('tune')) {
  const { default: GUI } = await import('three/addons/libs/lil-gui.module.min.js');
  buildTunePanel(GUI);
}
```
```js
function buildTunePanel(GUI){
  const gui = new GUI({ title: 'Palette (?tune)' });
  const hx = c => '#' + c.getHexString();

  const bg = gui.addFolder('Space backdrop');
  const bgC = { background: hx(skyScene.background), fog: hx(scene.fog.color) };
  bg.addColor(bgC, 'background').onChange(v => skyScene.background.set(v));
  bg.addColor(bgC, 'fog').onChange(v => scene.fog.color.set(v));
  bg.add(scene.fog, 'near', 0, 600);
  bg.add(scene.fog, 'far', 100, 1200);

  const sl = gui.addFolder('Sky light (terminator)');
  const slC = { ambient: hx(skyAmbient.color), sun: hx(skySun.color) };
  sl.addColor(slC, 'ambient').onChange(v => skyAmbient.color.set(v));
  sl.add(skyAmbient, 'intensity', 0, 3).name('ambient intensity');
  sl.addColor(slC, 'sun').onChange(v => skySun.color.set(v));
  sl.add(skySun, 'intensity', 0, 8).name('sun intensity');
  sl.add(skySun.position, 'x', -300, 300);
  sl.add(skySun.position, 'y', -300, 300);
  sl.add(skySun.position, 'z', -300, 300);

  const cl = gui.addFolder('Combat light (affects ship readability)');
  const clC = { ambient: hx(combatAmbient.color), sun: hx(sun.color) };
  cl.addColor(clC, 'ambient').onChange(v => combatAmbient.color.set(v));
  cl.add(combatAmbient, 'intensity', 0, 3).name('ambient intensity');
  cl.addColor(clC, 'sun').onChange(v => sun.color.set(v));
  cl.add(sun, 'intensity', 0, 4).name('sun intensity');

  gui.add({ dump: dumpPalette }, 'dump').name('⤓ Dump palette → console');
}
```
**Planet (optional):** ocean is a baked texture (`makePlanetTexture(d.planet.ocean)`,
`client/index.html:1049`), so live ocean changes need a re-bake — add a "Rebuild planet" button that
re-runs `buildMap(currentDescriptor)`. Halo (`client/index.html:1056`) is a live `MeshBasicMaterial`;
expose its color if a `halo` ref is hoisted. Keep these optional to stay in scope.

## Step 3 — Export ("Dump palette → console")

Print a labeled snapshot with `0x` hex, saying **where each value goes** (some live in the seed, some
are hardcoded in `index.html`):
```js
function dumpPalette(){
  const H = c => '0x' + c.getHexString();
  console.log('— catalog_seed.js  MAPS home-system.descriptor —', {
    background: H(skyScene.background),                                   // catalog_seed.js:419
    sky: {
      ambient: { color: H(skyAmbient.color), intensity: skyAmbient.intensity },        // :421
      sun: { color: H(skySun.color), intensity: skySun.intensity, pos: skySun.position.toArray() }, // :422
    },
  });
  console.log('— index.html (currently hardcoded) —', {
    fog: { color: H(scene.fog.color), near: scene.fog.near, far: scene.fog.far },       // index.html:521
    combatAmbient: { color: H(combatAmbient.color), intensity: combatAmbient.intensity }, // :551
    combatSun: { color: H(sun.color), intensity: sun.intensity },                        // :552
  });
}
```

## Step 4 — (Optional, recommended) make fog + combat light data-driven

Currently the **fog** (`client/index.html:521`) and **combat lights** (`:551-552`) are hardcoded, while
the sky/background already live in the descriptor. Move them into the map descriptor (`d.fog`,
`d.light`) and read them in `buildMap`, so the **entire palette is authored in one place**
(`catalog_seed.js`) and the dump is a single object to paste. Do this after picking values, or upfront
if you'd rather author everything from the seed.

---

## Gating / safety

- Panel only with `?tune`; lil-gui is **dynamically imported** inside that guard → players never fetch
  it and the default build is byte-for-byte unchanged in behavior.
- Mirrors the existing `?debug` dev-hook convention (`client/index.html:2745`).
- **Map-change caveat:** `buildMap` re-runs on level changes (`client/index.html:1750`, `3061`) and
  reassigns `skyAmbient`/`skySun`. If tuning across a level change, rebuild the panel (call
  `buildTunePanel` again, or `gui.destroy()` first). Single map (`home-system`) today, so minor.

## Docs to update (when implemented)

- **`docs/SUMMARY.md`** — "Tools" (or "Visuals"): note the `?tune` dev palette panel and that it's
  dev-only. Bump `**Updated:**`.
- **`docs/CHANGELOG.md`** — bullet under the date.
- **`docs/DECISIONS.md`** — short entry: chose a dev tuning tool over a player brightness setting
  (per-element control + exact export + zero combat-readability risk; references §5). If Step 4 is
  done, note fog/combat-light became data-driven.

## Verification

- `http://localhost:4000/?tune` → panel appears; sliders live-update background/fog/sky+combat lights;
  "Dump" prints the labeled snapshot.
- `http://localhost:4000/` (no `?tune`) → unchanged; confirm lil-gui isn't requested (Network tab).
- `client/visual` smoke render → no regression in the default scene.

## Open items (defaults chosen above)

1. Include planet **ocean** (rebuild button) + **halo** color now, or defer? (Default: defer — keeps
   scope to background/fog/lights.)
2. Do the **Step 4** data-driven refactor now or after picking values? (Default: after.)
3. Slider ranges (intensities `0–8`/`0–4`, fog `near 0–600`, `far 100–1200`) — tweak to taste.
