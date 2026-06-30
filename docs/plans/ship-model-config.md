# Plan: consolidate per-ship model presentation into a documented `stats.model` block

## Goal
Today the per-ship "how to present this model" knobs are **loose keys scattered in `ships.stats`**
(`modelYaw`, `sizeScale`) with no documented convention, and there's no per-ship hook to nudge the
muzzle/exhaust spawn when the auto-derived bounds aren't ideal. Consolidate them into **one documented
JSON sub-object** `stats.model`, add optional muzzle/exhaust overrides, and write an **"Adding / tuning a
ship model"** convention doc so onboarding a model is "fill this block, no code reading."

This is DB/seed data + client reads + docs. **No gameplay/balance change.** All ship models are
DB-driven already (`/api/ships`), so this is purely a shape/clarity refactor.

## Design — the `stats.model` block
```js
stats.model = {
  yaw: 0,          // radians to rotate so the nose faces +Z   (was stats.modelYaw; default 0)
  scale: 1.1,      // relative size multiplier                 (was stats.sizeScale; default 1)
  scaleMul: 1,     // optional extra normalization multiplier passed to applyShipModel (default 1)
  muzzle: null,    // optional: projectile spawn point, group-local +Z. null → auto from glb bounds (noseZ)
  exhaust: null,   // optional: exhaust spawn point, group-local −Z.  null → auto from glb bounds (tailZ)
}
```
- **`yaw` / `scale`** are the renames of the existing `modelYaw` / `sizeScale`.
- **`muzzle` / `exhaust`** are the new escape hatch: when the auto-derived nose/tail (the glb bounding-box
  extremes — e.g. a long antenna spike or a swept-back fin) puts the spawn slightly off, set a hand value
  in **group-local units** (same units as `userData.noseZ`/`tailZ`; the primitive's are ±1.6). Omit/`null`
  to keep the automatic behavior (the default for every ship today).
- Keep it **flat-ish and optional**: a ship with no special needs can carry just `model: { scale: 1 }` or
  even omit `model` entirely (client falls back to defaults).

## Step 1 — migrate the seed (`server/src/catalog_seed.js`)
Replace the loose `modelYaw` / `sizeScale` keys on **all 8 ships** with a `model` block. Current sites:
- **player** (`~:190` `sizeScale: 1.1`, `~:191` `modelYaw: 0`) → `model: { yaw: 0, scale: 1.1 }`
- **basic enemy ship / fighter** (`~:202` `sizeScale: 1`, `~:203` `modelYaw: Math.PI`) → `model: { yaw: Math.PI, scale: 1 }`
- **basic rocket enemy** (`~:211/212`) → `model: { yaw: Math.PI, scale: 1 }`
- **pirate gunner** (`~:225` `sizeScale: 1`, no modelYaw) → `model: { scale: 1 }` (yaw defaults 0; reuses `fighter.glb`)
- **basic mini boss / medium** (`~:233/234` `sizeScale: 2`, `modelYaw: Math.PI`) → `model: { yaw: Math.PI, scale: 2 }`
- **first boss** (`~:248/249` `sizeScale: 3`, `modelYaw: Math.PI`) → `model: { yaw: Math.PI, scale: 3 }`
- **advanced medium pirate** (`~:267` `sizeScale: 2`, no modelYaw; reuses `heavy.glb`) → `model: { scale: 2 }`
- **second boss / boss2** (`~:282` `sizeScale: 3`, no modelYaw; reuses `boss.glb`) → `model: { scale: 3 }`

Keep the explanatory comments (why `yaw: Math.PI` — the `enemy_*` exports face `-Z`). Update the header
comment at `~:177` ("`stats` carry role/color/sizeScale …") to mention the `model` block.

## Step 2 — client reads (`client/index.html`)
Add one small resolver near the other ship helpers and route all reads through it (back-compat with the
old loose keys so a stale `player_ships`/cache can't break):
```js
// Per-ship model-presentation config (stats.model), with back-compat for the old loose keys.
const shipModelCfg = (s) => {
  const m = s.model || {};
  return {
    yaw: m.yaw ?? s.modelYaw ?? 0,
    scale: m.scale ?? s.sizeScale ?? 1,
    scaleMul: m.scaleMul ?? 1,
    muzzle: m.muzzle ?? null,
    exhaust: m.exhaust ?? null,
  };
};
```
Then update:
- **`modelSpec`** (`~:1349` area) — extend to carry the overrides: `modelSpec(url, { yaw, scaleMul, muzzle, exhaust })`
  → returns `{ url, tint:false, yaw, scaleMul, muzzle, exhaust }`. (Today it's `modelSpec(url, yaw)`.)
- **`buildPlayer`** (`~:1666` `mesh: makeShip(s.color, modelSpec(active.ship.modelUrl, s.modelYaw))`, `~:1669`
  `sizeScale: s.sizeScale || 1`, `~:1680` `p.mesh.scale.multiplyScalar(p.sizeScale)`):
  `const mc = shipModelCfg(s);` then `makeShip(s.color, modelSpec(active.ship.modelUrl, mc))`, `sizeScale: mc.scale`.
- **`spawnEnemyShip`** (`~:1694` `sizeScale: s.sizeScale || 1`, `~:1695` `modelSpec(..., s.modelYaw)`, `~:1701`
  `radius: 2.6 * (s.sizeScale||1)`, `~:1705` `e.mesh.scale.multiplyScalar(s.sizeScale||1)`): same — resolve
  `const mc = shipModelCfg(s)` once, use `mc.scale` / `mc` throughout.
- **`fireMount`** lateral offset (`~:1829` `mount.offset * (ship.sizeScale || 1)`) — unchanged (still reads
  `ship.sizeScale`, which now comes from `mc.scale`).

## Step 3 — wire muzzle/exhaust overrides (`applyShipModel`, `client/src/ship-factory.js`)
`applyShipModel(group, spec, color)` already computes `group.userData.noseZ/tailZ` from the local bounds.
Honor the overrides from the spec:
```js
const { url, yaw = 0, tint = true, scaleMul = 1, muzzle = null, exhaust = null } = cfg;
// … after computing lbox …
group.userData.noseZ = muzzle ?? lbox.max.z;
group.userData.tailZ = exhaust ?? lbox.min.z;
```
`fireMount` / `emitExhaust` already read `userData.noseZ/tailZ × mesh.scale.x` — no change needed there.
(The primitive fallback in `makeShip` keeps its ±1.6 defaults.)

## Step 4 — tests
- `server/src/server.test.js` — the catalog test asserts the player `modelUrl`; if it (or any test) reads
  `stats.modelYaw`/`sizeScale`, update to `stats.model.*`. Grep `modelYaw|sizeScale` under `server/`.
- Optional: add an assertion that the player ship's `stats.model` has `{ yaw: 0, scale: 1.1 }`.
- Run `cd server && npm test` (expect green) and a visual smoke (`cd client && node visual/run.mjs`) to
  confirm ships still load, sized + oriented correctly, and bullets/exhaust spawn on the model.

## Step 5 — docs
1. **New `docs/plans/adding-a-ship-model.md`** (or a SUMMARY subsection) — the **convention**, end to end:
   - Source a `.glb`; **ships face +Z** — if the nose points elsewhere set `model.yaw` (π for a `-Z` export).
   - The **longest axis is normalized** to `SHIP_MODEL_LEN` (3.4); set `model.scale` for relative size.
   - Drop the source in `assets-src/`, add a **`PRESET_OVERRIDES`** entry if it's a textured model
     (see `ship-model-pipeline.md`), run `assets:build` → paste hashes into the seed's `modelUrl`/`modelUrlHigh`.
   - Muzzle/exhaust **auto-derive** from the glb bounds; override with `model.muzzle`/`model.exhaust`
     (group-local units, ±1.6 ≈ the primitive) only if the auto spawn looks off.
   - **Credits**: CC-BY models must be added to `CREDITS.md` (see the `CLAUDE.md` asset-credits rule).
   - Verify orientation/spawn in the visual harness.
2. **`docs/SUMMARY.md`** — in the "Ship model" section, replace mentions of `stats.modelYaw` / `sizeScale`
   with the `stats.model` block; link the new convention doc. Bump `**Updated:**`.
3. **`docs/CHANGELOG.md`** — one bullet: consolidated per-ship model knobs into `stats.model` (+ muzzle/
   exhaust overrides), back-compat reads, new "adding a ship model" doc.
4. **`docs/DECISIONS.md`** — optional short entry: why a grouped `model` block + back-compat fallback over
   loose keys (discoverability + a documented onboarding path; fallback so a cached/legacy row can't break).

## Open decisions (resolved inline)
- **Hard-migrate vs back-compat:** migrate **all 8 seed ships** to `model`, but **keep the fallback read**
  in `shipModelCfg` (costs nothing; protects against a stale client/cache). Don't delete the fallback.
- **Flat keys vs nested:** nested `model` block (groups the related knobs; future model-only knobs land here).
- **Units for muzzle/exhaust:** group-local (same as `userData.noseZ/tailZ`), so they read like the
  primitive's ±1.6 and are independent of `scale` (which is re-applied at spawn via `mesh.scale.x`).
