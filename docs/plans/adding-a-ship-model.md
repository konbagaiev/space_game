# Convention: adding / tuning a ship model

How to put a new 3D model on a ship — end to end, fill-this-block style. The per-ship presentation
knobs live in **one documented JSON sub-object**, `stats.model`, in the seed
(`server/src/catalog_seed.js`). You should not need to read client code to onboard a model.

This is the companion to **`docs/plans/ship-model-pipeline.md`** (the `assets:*` build/push pipeline)
and **`client/assets/README.md`** (sourcing + licensing). Read this one for *what the per-ship config
means*; read those for *how to build the hashed `.glb` and where the textures come from*.

## The `stats.model` block

```js
stats: {
  role: 'fighter', color: 0xff5d5d, /* … groups, mounts … */
  model: {
    yaw: Math.PI,    // radians to rotate so the nose faces +Z   (default 0)
    scale: 1,        // relative size multiplier                 (default 1)
    scaleMul: 1,     // optional extra normalization multiplier  (default 1)
    muzzle: null,    // optional projectile spawn point, group-local +Z (null → auto from glb bounds)
    exhaust: null,   // optional exhaust spawn point,   group-local −Z (null → auto from glb bounds)
  },
}
```

A ship with no special needs can carry just `model: { scale: 1 }` (or omit `model` entirely — the
client falls back to defaults). The client reads it through `shipModelCfg(s)` in `client/index.html`,
which also falls back to the **old loose keys** (`stats.modelYaw` / `stats.sizeScale`) so a stale
`player_ships` row or cache can't break — don't author the loose keys for new ships.

### `yaw` — orientation
**Our ships face `+Z`** (nose leads travel). If the model's nose points elsewhere, set `yaw`:
- `-Z` export (most asset packs, e.g. the `enemy_*` ships) → `yaw: Math.PI`
- `+X` / `-X` → `±Math.PI/2`

Orientation is fixed in **data**, not by re-exporting — the asset's own transform isn't trusted (see
DECISIONS §"Model orientation is fixed in DATA"). The combat and hangar `.glb` come from the same
source, so one `yaw` corrects both. **Preview the combat `.glb` in macOS Quick Look** (it's built
uncompressed for exactly this) and confirm the nose direction before you push.

### `scale` — size
`applyShipModel` first auto-normalizes the model's **longest axis to `SHIP_MODEL_LEN` (3.4)** — the
primitive ship's footprint. `scale` then multiplies that (it also scales the hit radius and the lateral
mount offset). `scaleMul` is a rarely-needed extra multiplier applied inside the normalization itself
(use it only if a model's bounding box is dominated by something that shouldn't count toward "length").

### `muzzle` / `exhaust` — spawn-point escape hatch
Projectiles spawn at the model's **nose** and exhaust at its **tail**, auto-derived from the glb's
local bounding-box extremes (`group.userData.noseZ` = `+Z` tip, `tailZ` = `−Z` tip). When a long
antenna spike or a swept-back fin pushes that extreme off, set a hand value in **group-local units** —
the same units as `noseZ`/`tailZ`, where the primitive ship's are **±1.6**. `null` (the default for
every ship today) keeps the automatic behavior. The scale is re-applied at spawn (`× mesh.scale.x`),
so these values are independent of `scale`.

## Steps

1. **Source a `.glb`** — prefer **CC0**, else **CC-BY** (commercial OK, must credit). See
   `client/assets/README.md` for sources and the licensing rules.
2. **Build it** — drop the source in `assets-src/`, add a **`PRESET_OVERRIDES`** entry if it's a
   textured model (see `ship-model-pipeline.md`), run `npm run assets:build`. Paste the resulting
   content-hashed paths into the seed's `modelUrl` (combat, same-origin) and `modelUrlHigh` (hangar,
   CloudFront — optional).
3. **Fill `stats.model`** — `yaw` (from the Quick Look check), `scale` (relative size). Leave
   `muzzle`/`exhaust` out unless step 5 shows the auto spawn is off.
4. **Credits** — a CC-BY model **must** get a row in `client/assets/CREDITS.md` (the `CLAUDE.md`
   asset-credits rule: always confirm CREDITS changes with the maintainer on a model add/replace/remove).
5. **Verify** — `npm run assets:push` (or run the game locally), then eyeball in-game or via the visual
   harness (`node visual/run.mjs` from `client/`): confirm the ship is sized right, flies **nose-first**
   (not engine-first), and that **bullets leave the nose** and **exhaust trails the engines**. If a
   spawn looks off, set `model.muzzle` / `model.exhaust` and re-check.
