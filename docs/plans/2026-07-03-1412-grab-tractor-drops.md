# Grab (tractor) component + enemy equipment drops

**Status:** implemented (2026-07-03) · **Feature id:** `2026-07-03-1412-grab-tractor-drops`

## Goal
Give the player a new ship component — the **Grab** (tractor beam) — and make enemy kills sometimes
**drop a piece of their equipment** as a physical, slowly-rotating metallic box in the arena. When a drop
comes within the Grab's range it is pulled toward the ship (a thin blue line shows the active pull), and on
**mission victory** every drop the player actually collected is dumped into the **Stash** so it can be sold
(or equipped). This adds a light loot loop on top of the existing kill→credits economy. It also finally
**prices pirate parts** so looted gear has real resale value, ships the reused **metal-box** model through the
existing asset pipeline, and adds a simple way to measure the per-frame cost on weak phones (Samsung A03s).

## Decisions (all resolved — do not re-ask)
- **No "cell" concept — use world units directly.**
  - Grab **RANGE (units)** = `grab.strength × 1` (strength 10 → 10-unit radius).
  - Grab **PULL SPEED (units/sec)** = `(grab.strength / 2) × (10 / pulledItemWeight)`. Anchor: strength 10,
    weight 10 → 5 u/s; light parts pull faster (weight 2 → 25 u/s), heavy parts slower. **Guard against a
    zero/missing weight** with a fallback of `10` and a one-time `console.warn` (the audit below confirms no
    item is actually missing a weight, so the warn should never fire — it's defensive only).
- **Activation delay 0.3 s:** the Grab engages a drop only after it has been within range for a continuous
  0.3 s. A single **thin blue line** is drawn from the ship's nose to the item **only while actively pulling**.
- **One item at a time:** pull the **nearest** in-range armed drop; re-target the next-nearest after collecting.
  At most one blue line.
- **New component `type: 'grab'`** — a single slot like `repair` (optional, nullable, no stacking).
  - **Base Grab** (component id **29**): `strength 10`, `weight 2`, `price 500`. The **player owns/starts with
    one** (added to the default player-ship `components`). Flying with **no** grab is allowed (feature inert).
  - **Advanced Grab** (component id **30**): `strength 20`, `weight 3`, `price 2000`. Buyable in the shop under
    a new **"Grab"** type tab.
- **Drops:** on each enemy kill, **one** `Math.random() < 0.2` roll. On success, drop **one** item chosen
  uniformly at random from the enemy's **non-hull** component ids (**engine, thruster only**) **+** its mounted
  weapon ids (the **real** item id + kind, not a generic token). **Hulls are NEVER dropped** — a looted boss
  hull (550 HP) would be equippable and wreck progression, so `e.hull` is excluded from the loot pool. Drop is
  rendered with the shared **metal-box** glb, rotating one full turn per **5 s**.
- **Base grab's short range is intentional.** The base grab (range 10 units) is a short **"vacuum assist"** —
  enemies die ~14–25 units away, so the player still flies most of the way onto the loot and the grab only
  snaps it in over the last few units; the **Advanced grab** (range 20) is the real tractor and the upgrade
  incentive. Heavy items pulling slowly (mass cost) is likewise by design. Do **not** "fix" either as a bug.
- **Deposit only on VICTORY.** Collected drops deposit into the Stash **only when the mission is won**
  (`levelRunner.win`). On player death the haul is **lost**; un-grabbed drops are lost. **No despawn timer**,
  **no mid-mission persistence** (nothing about a run persists until it ends — drops specifically require a
  win; consistent with how credits bank). Deposit reuses `depositStash` (keep `db.js` / `db_postgres.js` in
  parity).
- **Price pirate parts** (below) so `sell = floor(price*0.75)` is nonzero. Enemy parts stay **out of the
  shop** via a `stats.buyable: false` flag (a boss hull must not be buyable) — they only gain resale value.
- **Client-authoritative**, matching today's sim (server only banks at run end). The 20 % roll + pull run
  client-side; the victory deposit is a trusted client call. **Known limitation:** a modified client could
  forge loot — same posture as unsealed rewards (DECISIONS §18); server sealing is deferred.

## Weight audit (state in the plan, nothing to report)
Every enemy component and weapon already carries a `weight`, so the pull-speed formula never divides by a
missing value: components **2**(8) **6**(6) **9**(3) **22**(10) **23**(6) **24**(100) **25**(8) **26**(50)
**27**(20) **28**(140); weapons **2**(4) **4**(6) **9**(6) **10**(10). No item is missing a weight — the
`10` fallback is defensive only.

---

## Steps

### 1. Catalog: new Grab components, pirate pricing, drop model (`server/src/catalog_seed.js`)
Anchors: components array ends ~line 67 (before the `// ---` weapons comment); enemy component rows 22–28 at
lines 56–67; enemy weapons at 84–99 (ids 2,4) and 131–139 (ids 9,10); player ship `components` at line 209.

1a. **Drop-model URL lives in ONE place: `client/src/drops-config.js`** (step 4). The client loads the model
from that `DROP_MODEL_URL` constant, and `scripts/assets-check.mjs` imports the **same** constant to validate
it on S3 (step 7). Do **NOT** duplicate the URL onto a component's `modelUrl` — there is no second transport
needed (the client owns rendering; nothing else consumes it), so a single source of truth keeps them from
drifting (§30).

1b. **Add the two Grab components** to the `COMPONENTS` array (new `type: 'grab'`; no `modelUrl` — the drop
model is not a component model):
```js
{ id: 29, name: 'Grab', type: 'grab', weight: 2, price: 500,
  stats: { strength: 10 } },                       // range = strength; pull speed = (strength/2)*(10/itemWeight)
{ id: 30, name: 'Advanced grab', type: 'grab', weight: 3, price: 2000,
  stats: { strength: 20 } },
```

1c. **Player starts with the base Grab** — line 209, add `grab: 29`:
```js
components: { hull: 1, engine: 5, thruster: 8, grab: 29 }, stats: {
```

1d. **Price the pirate parts + hide them from the shop.** Add a top-level `price` and a `stats.buyable: false`
to each enemy component/weapon row (leave every `weight` and existing stat untouched):

| id | item | price | id | item | price |
|----|------|-------|----|------|-------|
| 2  | Light hull        | 150  | 22 | Pirate hull            | 200  |
| 6  | Scout engine      | 250  | 23 | Pirate engine          | 400  |
| 9  | Scout thrusters   | 200  | 24 | Pirate heavy hull      | 1200 |
| 26 | Second-boss engine| 1500 | 25 | Pirate medium thruster | 350  |
| 27 | Second-boss thruster| 900| 28 | Second-boss hull       | 2000 |

Weapons: **2** Kinetic (enemy) `price 120`; **4** Rocket (enemy) `price 200`; **9** Pirate machine gun
`price 300`; **10** Advanced pirate cannon `price 600`.

> **Hull prices (ids 2, 22, 24, 28) are unreachable via loot** — hulls can never drop (step 4 `pickLoot`
> excludes `e.hull`), and nothing else deposits enemy parts, so these resale values are inert today. They're
> priced anyway for consistency + future-proofing (harmless: `buyable:false` keeps them out of the shop, and
> no code path puts an enemy hull in the stash). If you prefer, leaving hull `price` at 0 is equally correct —
> either way **no player ever obtains an enemy hull**.

Each of these rows also gets `buyable: false` inside its `stats` object, e.g.
`{ id: 2, name: 'Light hull', type: 'hull', weight: 8, price: 150, stats: { durability: 30, volume: 40, buyable: false } }`.
(The player-ladder + starter items are **not** touched — no `buyable` key → treated as buyable.)

> **Note (component ids 6 & 9 are ALSO the player's Scout parts)** — those are only ever on enemy ships in the
> catalog and are already priced 0/hidden today; pricing them makes their *looted* copies sellable. They stay
> hidden from the shop via `buyable: false`. Fine.

### 2. Pure derivation: count Grab weight + expose ids (`client/src/components.js`)
- `shipMass` (line 16): add `'grab'` to the slot list so its weight counts toward mass:
  `for (const slot of ['hull', 'engine', 'thruster', 'repair', 'grab'])`.
- No change to `deriveDrive` (grab has no power; its weight already flows through `shipMass`).
- **Bump `REFERENCE_MASS` 48 → 50** (line 11) — a **deliberate** neutralization, not a silent nerf.
  Auto-equipping the base grab (weight 2) raises the player's starter loadout mass 48 → 50; leaving
  `REFERENCE_MASS` at 48 would knock accel/turn down ~4 % from the documented anchor (accel 10 / turn 2.0).
  Setting it to 50 (the new starter loadout: hull 20 + engine 10 + thrusters 4 + gun 6 + rocket 8 + **grab 2**)
  keeps `massFactor = 1` at the baseline, so the player's feel is **unchanged**. Update the comment on that
  line to include the grab in the sum, and update the SUMMARY "Mass" paragraph accordingly.
- Add/adjust a unit test (see Tests) for `shipMass` including a grab slot, and confirm the player baseline
  still derives accel 10 / turn 2.0 with `REFERENCE_MASS = 50`.

### 3. Resolve + build the Grab onto the player (`client/src/ship-build.js`)
- `resolveComponents` (line 14): include `id` in each resolved component and resolve the `grab` slot:
  ```js
  const get = (id) => { const c = CATALOG.components.get(id); return c ? { id: c.id, name: c.name, weight: c.weight, ...c.stats } : null; };
  return { hull: get(r.hull), engine: get(r.engine), thruster: get(r.thruster), repair: get(r.repair), grab: get(r.grab) };
  ```
  (Adding `id` is additive/safe; drop loot-picking reads `hull.id`/`engine.id`/`thruster.id`.)
- `buildPlayer` (line 41 + line 48): destructure `grab` and store it on the player entity:
  ```js
  const { hull, engine, thruster, repair, grab } = resolveComponents(active.components);
  ...
  hull, engine, thruster, repair, grab,   // grab: tractor stats (or null) — feeds mass + the grab pull sim
  ```
- `spawnEnemyShip` (line 82): attach the raw ids used for loot so the drop can name the exact looted item
  without a reverse lookup:
  ```js
  const e = { role: s.role, ..., hull, engine, thruster, mounts: buildMounts(s.mounts), ... };
  ```
  `hull/engine/thruster` now carry `.id` (from step 3's `resolveComponents`), and each `mount.weapon` already
  has `.id`, so no extra field is needed — the drop picker reads them off `e` directly.

### 4. New drops module (`client/src/drops.js`) + config leaf (`client/src/drops-config.js`)
Keep the URL in a **pure, import-free** leaf so the node `assets:check` script can import it without pulling
in THREE:

`client/src/drops-config.js`:
```js
// Pure constants for the loot-drop system (no imports → importable by scripts/assets-check.mjs under node).
// SINGLE source of truth for the shared drop model URL (client renders it; assets:check validates it).
export const DROP_MODEL_URL = 'assets/ships/metal_box_combat.<HASH>.glb'; // <HASH> filled by assets:build (step 7)
export const DROP_CHANCE   = 0.2;   // per-kill chance to drop one item
export const MAX_DROPS     = 40;    // hard cap on simultaneous drops in the arena (perf guard)
export const ARM_DELAY     = 0.3;   // seconds in range before the grab engages an item
export const ROTATE_PERIOD = 5.0;   // seconds per full drop revolution
export const COLLECT_DIST  = 3.0;   // world units: within this of the ship → collected
export const WEIGHT_FALLBACK = 10;  // defensive: used only if an item somehow has no weight
```
> `DROP_MODEL_URL` lives ONLY in this leaf (`drops-config.js`) — it is the single source of truth. The
> client renders from it and `assets:check` (step 7) imports the same constant to validate it.

`client/src/drops.js` — owns the `drops` array, the shared blue line, and the run's collected loot:
```js
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, CATALOG } from './state.js';
import { gltfLoader } from './ship-factory.js';          // meshopt-wired GLTFLoader
import { audio, sfxFor } from './sound-routing.js';
import { DROP_MODEL_URL, DROP_CHANCE, MAX_DROPS, ARM_DELAY, ROTATE_PERIOD, COLLECT_DIST, WEIGHT_FALLBACK } from './drops-config.js';

export const drops = [];            // { obj, item:{kind,refId}, weight, inRange (sec) }
export const pendingLoot = [];      // { kind, refId } collected this run — deposited on VICTORY only
export { DROP_CHANCE };             // re-export so sim.js reads one source

let template = null;                // cloned per drop once the glb loads
let line = null;                    // single shared blue pull line (pooled)
const tmp = new THREE.Vector3();    // scratch — no per-frame allocation
let warned = false;

// load the shared model once (fallback: a small metallic box until it arrives)
gltfLoader.load(DROP_MODEL_URL, (g) => { template = normalize(g.scene); }, undefined, () => {});

function normalize(obj) { /* center via bounding box + scale longest axis to ~2.5 units */ }
function fallbackBox() { /* BoxGeometry + MeshStandardMetalness material (env-map lit) */ }

// item = { kind:'component'|'weapon', refId } — weight looked up + cached at spawn
export function spawnDrop(pos, item) {
  if (!item) return;
  if (drops.length >= MAX_DROPS) { console.warn('drops: cap reached, skipping'); return; } // perf guard
  const cat = item.kind === 'component' ? CATALOG.components.get(item.refId) : CATALOG.weapons.get(item.refId);
  const weight = (cat && cat.weight) || (warnMissing(), WEIGHT_FALLBACK);
  const obj = template ? template.clone(true) : fallbackBox();
  obj.position.copy(pos); obj.position.y = 0.8;
  scene.add(obj);
  drops.push({ obj, item, weight, inRange: 0 });
}

// pick one looted item uniformly among the enemy's NON-HULL parts (engine, thruster) + mounted weapons.
// HULLS ARE NEVER DROPPABLE (progression guard — a looted 550-HP boss hull would be equippable and break
// balance; see DECISIONS). e.hull is deliberately excluded from the pool.
export function pickLoot(e) {
  const pool = [];
  for (const c of [e.engine, e.thruster]) if (c && c.id != null) pool.push({ kind: 'component', refId: c.id }); // NO e.hull
  for (const m of (e.mounts || [])) if (m.weapon && m.weapon.id != null) pool.push({ kind: 'weapon', refId: m.weapon.id });
  return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
}

export function updateDrops(dt) {
  // 1) rotate every drop (cosmetic) — one turn / ROTATE_PERIOD
  for (const d of drops) d.obj.rotation.y += dt * (Math.PI * 2 / ROTATE_PERIOD);
  const p = G.player, grab = p && p.grab;
  // feature inert with no grab / dead player: hide the line and stop pulling
  if (!p || !p.alive || !grab) { hideLine(); return; }
  const range = grab.strength;                 // units
  const ppos = p.mesh.position;
  // 2) arm timers + find the nearest ARMED in-range drop
  let target = null, best = Infinity;
  for (const d of drops) {
    const dist = tmp.copy(d.obj.position).sub(ppos).length();
    if (dist <= range) { d.inRange += dt; if (d.inRange >= ARM_DELAY && dist < best) { best = dist; target = d; } }
    else d.inRange = 0;
  }
  if (!target) { hideLine(); return; }
  // 3) pull the target toward the ship at the weight-scaled speed
  const speed = (grab.strength / 2) * (10 / (target.weight || WEIGHT_FALLBACK));
  tmp.copy(ppos).sub(target.obj.position); const d = tmp.length();
  if (d <= COLLECT_DIST) return collect(target);         // arrived → collect + re-target next frame
  target.obj.position.addScaledVector(tmp.normalize(), Math.min(speed * dt, d));
  drawLine(ppos, target.obj.position);                   // thin blue activity indicator
}

function collect(d) {
  scene.remove(d.obj);
  drops.splice(drops.indexOf(d), 1);
  pendingLoot.push(d.item);
  audio.sfx.pickup?.(); // small feedback blip (reuse an existing sfx if no dedicated one — see Tests/Docs)
  hideLine();
}

export function clearDrops() { for (const d of drops) scene.remove(d.obj); drops.length = 0; pendingLoot.length = 0; hideLine(); }
export function takeLoot() { const l = pendingLoot.slice(); pendingLoot.length = 0; return l; } // for the victory deposit
// drawLine/hideLine: lazily create ONE THREE.Line (LineBasicMaterial blue, e.g. 0x4db6ff), update its 2 positions.
```
- **Blue line pooling:** create the `THREE.Line` once (2-vertex `BufferGeometry`, `LineBasicMaterial`
  `{ color: 0x4db6ff }`), add to `scene`, set `.visible = false` when not pulling; update the two positions in
  place each frame (no new geometry).
- **Ship moving while pulling:** the line + the pull direction both read `G.player.mesh.position` live, so the
  item chases the moving ship for free.
- **Two drops the same frame / multiple kills:** each is an independent `drops[]` entry; the cap + pooling
  bound the cost. The 20 % roll is once per kill in the death loop, so two deaths in a frame roll
  independently.

### 5. Wire drops into the sim + loop
- **`client/src/sim.js` imports** (line 7-ish): add
  `import { drops, pendingLoot, updateDrops, spawnDrop, pickLoot, clearDrops, takeLoot, DROP_CHANCE } from './drops.js';`
- **Enemy-death loop** (lines 444-463): after `G.kills++` / reward handling, add the drop roll:
  ```js
  if (Math.random() < DROP_CHANCE) { const loot = pickLoot(e); if (loot) spawnDrop(e.mesh.position, loot); }
  ```
  (Read `e.hull/engine/thruster/mounts` **before** `enemies.splice` — the loop already holds `const e = enemies[i]`.)
- **Call `updateDrops(dt)`** once per frame inside `update(dt)`, right after the enemy-death loop / before
  `levelRunner.update(dt)` (~line 464). It's inside `update(dt)`, which `animate()` already gates on
  `!G.paused`, so drops freeze on pause for free.
- **Victory deposit** in `levelRunner.win()` (lines 55-71): after `bankRun();`, deposit the collected loot,
  then it will be cleared by the next `reset()`:
  ```js
  const loot = takeLoot(); if (loot.length) depositLoot(loot); // dump the run's collected drops into the stash (victory only)
  ```
  Import `depositLoot` from `./net.js` (step 8). (Do **not** deposit on death — the player-death branch at
  line 468 leaves `pendingLoot` untouched; `reset()` discards it.)
- **`reset()`** (lines 530-559): add `clearDrops();` alongside the other pool clears (e.g. after
  `creditPopups.length = 0;`). This removes drop meshes + the line and **discards** any uncollected/un-deposited
  loot when a new run starts.

### 6. Perf: measurement + cap
- **Cap** is enforced in `spawnDrop` (`MAX_DROPS = 40`, skip + `console.warn` when full).
- **Per-frame cost is small** (one nearest-in-range scan over ≤40 drops, one integrate, one 2-vertex line
  update, no allocation — the `tmp` scratch + pooled line + cloned template avoid GC). Rotation is one
  `rotation.y +=` per drop.
- **Measurement mechanism (reuse what exists — no new framework):**
  - The `?dev` **perf overlay** already shows FPS / frame-ms / draw calls / triangles (`hud.js updatePerf`).
  - The `?dev` **perf sampler** in `client/src/main.js` posts a per-second `load` object to `/api/perf`
    (line ~314: `load: { enemies, particles, draws, tris }`). **Add `drops: drops.length`** to that object
    (import `drops` from `./drops.js` in `main.js`) so drop count is captured next to fps on a real device.
  - **Add a stress hook** to the `?debug` `window.__game` object (`main.js`, ~line 411): expose
    `spawnTestDrop()` (spawns a metal-box drop at a random point near the player with a random real item) and
    `drops` (the array). **How to measure on a phone:** open the game with `?dev`, start a fight, then in the
    console run `for (let i=0;i<40;i++) __game.spawnTestDrop()` and watch the perf overlay's FPS / frame-ms.
    Document this in the plan's Docs section + `docs/plans/perf-low-end-phones.md` (one line).

### 7. Asset pipeline: optimize + ship the metal-box (`assets-src/`, `scripts/`, S3)
The source lives in the **main checkout** at
`/Users/kbagaiev/Projects/another_game_attempt/assets-src/items/metal_box/metal_box.glb` (703 KB, CC-BY
"Metal box" by District24; `credits.txt` alongside). It is **not** in the worktree and the working dirs are
gitignored.

1. **Analyze the bloat:** `npx @gltf-transform/cli@^4 inspect <source>` — the 703 KB is almost certainly
   **texture-dominated**; note the split in the CHANGELOG. Downscale hard (a drop is tiny on a top-down
   screen).
2. **Place the source where `assets:build` looks.** `scripts/assets-build.mjs` reads **top-level**
   `assets-src/*.glb` (not subdirs), so copy the file to `assets-src/metal_box.glb` in the worktree.
3. **Add a per-source override** in `scripts/assets-config.mjs` `PRESET_OVERRIDES` so the combat build shrinks
   textures aggressively:
   ```js
   metal_box: { combat: { textureSize: 128, textureCompress: 'webp' } },
   ```
4. **Build:** `npm run assets:build metal_box` → prints `metal_box_combat.<hash>.glb` (+ a hangar build we
   don't use). Target combat ≈ **30–90 KB** (record before/after: 703 KB → ~NN KB).
5. **Paste the combat URL** (`assets/ships/metal_box_combat.<hash>.glb`) into the single `DROP_MODEL_URL`
   constant in `client/src/drops-config.js` (step 4).
6. **Push + verify:** `npm run assets:push` (uploads combat/hangar + source to S3), then
   `npm run assets:pull` (into `client/assets/ships/`, gitignored — CI does this at deploy).
7. **`scripts/assets-check.mjs`:** extend it to validate the drop model. Import the pure constant and add it as
   a target:
   ```js
   import { DROP_MODEL_URL } from '../client/src/drops-config.js';
   ...
   { const key = modelKey(DROP_MODEL_URL); if (key) targets.push({ name: 'drop:metal_box', field: 'DROP_MODEL_URL', url: DROP_MODEL_URL, key }); }
   ```
   This is the **only** validation of the drop model (there is no `modelUrl`-on-component copy). `modelKey`
   already matches the content-hashed `assets/ships/<name>.<hash>.glb` shape, so it resolves to
   `ships-combat/metal_box_combat.<hash>.glb` on S3. Confirm the node import works (`drops-config.js` is
   import-free — no THREE), then verify `npm run assets:check` passes.
8. **CREDITS:** add a row to `client/assets/CREDITS.md` (see step 10). Attribution is **required** while in use.

### 8. Server: victory loot deposit endpoint (parity across both backends)
- **`server/src/db.js`** — add near `depositStash` (line 158):
  ```js
  export function depositLoot(playerId, items) {
    registerPlayer(playerId);
    return tx(() => { for (const it of (items || [])) {
      if (it && (it.kind === 'component' || it.kind === 'weapon') && it.refId != null) depositStash(playerId, it.kind, it.refId, 1);
    } return { ok: true }; });
  }
  ```
  Also **add `'grab'` to `COMPONENT_SLOTS`** (line 352): `new Set(['hull', 'engine', 'thruster', 'repair', 'grab'])`
  so a looted/owned grab can be equipped/unequipped/sold. (`equipItem` already slots a component by
  `item.type`, so `grab` equips correctly with no other change; it's **not** in `REQUIRED_SLOTS`, so it's
  optional and sellable-while-equipped.)
- **`server/src/db_postgres.js`** — mirror the behavior but with the **Postgres transaction API** (there is
  **no `tx`** here; it uses `withTx(async (client) => …)` ~line 563, and `depositStash(playerId, kind, refId,
  qty, client)` ~line 330 **requires** the `client` arg to run in-transaction — omitting it breaks atomicity).
  Add `'grab'` to its `COMPONENT_SLOTS` (line 516) and:
  ```js
  export async function depositLoot(playerId, items) {
    await registerPlayer(playerId);
    await withTx(async (client) => {
      for (const it of (items || [])) {
        if (it && (it.kind === 'component' || it.kind === 'weapon') && it.refId != null) {
          await depositStash(playerId, it.kind, it.refId, 1, client); // pass `client` → runs inside the tx
        }
      }
    });
    return { ok: true };
  }
  ```
- **`server/src/datastore.js`** — export `depositLoot` delegating to the active backend (follow the existing
  `buyItem`/`equipItem` pattern).
- **`server/src/server.js`** — import `depositLoot` (line 8-ish alongside `buyItem`) and add a route near the
  stash routes (line ~174):
  ```js
  // Dump a mission's collected loot into the stash (client-authoritative, victory only — see DECISIONS).
  app.post('/api/players/:id/loot', wrap(async (req, res) => {
    const r = await depositLoot(req.params.id, (req.body && req.body.items) || []);
    res.status(r.ok ? 200 : (r.status || 400)).json(r);
  }));
  ```

### 9. Client net + shop wiring
- **`client/src/net.js`** — add (best-effort, like `bankRun`):
  ```js
  export function depositLoot(items) {
    if (!G.playerId || !items || !items.length) return;
    fetch(API_BASE + `/api/players/${G.playerId}/loot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }).catch(() => {}); // best-effort: the Main Window re-fetches the stash when opened
  }
  ```
- **`client/src/shop.js`:**
  - `SHOP_TYPES` (line 194): append `'grab'` → `['hull', 'engine', 'thruster', 'repair', 'weapon', 'grab']`.
  - `renderLoadout` slot list (line 158): add `'grab'` → `['hull', 'engine', 'thruster', 'repair', 'grab']`;
    and hide an empty **optional** grab slot like repair (line 161):
    `if (slot !== 'repair' && slot !== 'grab') rows.push(emptySlotCard(...));`.
  - `statLine` (lines 34-50): add a grab branch so its card shows strength:
    `else if (type === 'grab') parts.push(`${t('ui.shop.stat.grab')} ${s.strength}`);`.
  - **Shop buy-list filter** (line 207): exclude non-buyable (enemy) parts:
    `.filter((n) => (n.price ?? 0) > 0 && n.s?.buyable !== false && (shopType === 'weapon' ? n.kind === 'weapon' : n.type === shopType))`.
    (Player/starter/ladder items have no `buyable` key → shown; enemy parts set `stats.buyable:false` → hidden.
    `normWeapon.s` is the spread weapon object and `normComponent.s` is `c.stats`, so `n.s.buyable` reads both.)
  - `deriveShipStats` (lines 57-67) **must be fixed** — it builds its own ship literal that does NOT spread
    `rc`, so `rc.grab` is silently dropped and `shipMass(ship)` never sees the grab weight (the shop preview
    would understate mass by 2–3 and overstate accel/turn, since the player always has a grab equipped). Add
    `grab: rc.grab,` to that object (line 60):
    ```js
    const ship = {
      hull: rc.hull, engine: rc.engine, thruster: rc.thruster, repair: rc.repair, grab: rc.grab,
      mounts: (mounts || []).map((m) => ({ weapon: CATALOG.weapons.get(m.weapon) })).filter((m) => m.weapon),
    };
    ```
  - `ownedCount` (lines 132-138): add `'grab'` to the component-slot loop so an equipped Advanced grab counts
    toward the shop "Owned ×N" badge → `for (const slot of ['hull', 'engine', 'thruster', 'repair', 'grab'])`.

### 10. Docs, i18n, credits
- **i18n** (`client/locales/source.json`, `en.json`, `ru.json`): add
  `ui.shop.filter.grab` ("Grab" / "Захват"), `ui.shop.slot.grab` (if `slotLabel` keys per slot — match the
  existing `ui.shop.slot.*` pattern; label "Grab" / "Захват"), and `ui.shop.stat.grab` ("Grab" / "Захват").
  Component **names** stay English catalog strings (not keyed — consistent with other components).
- **`client/assets/CREDITS.md`:** add a row for **"Metal box"** by **District24**, CC-BY 4.0, source
  `https://skfb.ly/JwFQ`, used as the shared equipment-drop model. Match the existing table format.

---

## Tests
- **`client/src/components.test.js`** — extend `shipMass` coverage: a ship with a `grab` slot adds its weight;
  `deriveDrive` unchanged by grab (only mass changes). Run: `cd client && node --test`.
- **New `client/src/drops.test.js`** — unit-test the **pure** pieces without THREE by factoring the maths into
  testable helpers (keep the THREE/scene code thin): pull-speed `(strength/2)*(10/weight)` (anchor cases:
  s10/w10→5, s10/w2→25), range = strength, the `WEIGHT_FALLBACK` guard for weight 0/undefined, and `pickLoot`
  returning one of the enemy's component/weapon ids (uniform, only from the given parts). If a helper import
  pulls THREE, move the formula into `drops-config.js` or a small pure export so the test stays node-safe
  (the visual/DOM behavior is covered by the headless suite, not `node:test`).
- **Server `server/src/server.test.js`** — a `POST /api/players/:id/loot` with
  `{ items:[{kind:'component',refId:6},{kind:'weapon',refId:9}] }` deposits those into the stash (assert via
  `GET /api/players/:id/stash`); an empty/absent list is a no-op 200; equipping/unequipping/selling a `grab`
  component round-trips through the stash (grab is an optional slot). **Run on BOTH backends** — the default
  `cd server && npm test` is **SQLite-only** (our known parity gap), so the loot/tx path MUST also be verified
  with `cd server && npm run test:pg` (Postgres, `DATABASE_URL` defaults to
  `postgres://localhost:5432/spacegame_test`). This is exactly the `withTx`/`client` case that slips past
  SQLite-only runs, so `test:pg` is required for this feature, not optional.
- **Manual / headless:** with `?dev`, spawn drops via `__game.spawnTestDrop()` and confirm the blue line
  appears only while pulling, the item chases a moving ship, collection removes the mesh, and a **win** dumps
  the collected items into the Stash while a **death** does not. The client visual suite has a flaky baseline
  (~6 scenarios) — judge by the reliably-passing set + zero page errors.

## Docs to update
- **`docs/SUMMARY.md`** — bump `**Updated:**`; update **"Ship model (DB-driven) → Components"** (add the
  `grab` component type + the two Grab items + that the player starts with the base grab), update the **"Mass"**
  paragraph (`REFERENCE_MASS` 48 → 50, new baseline sum incl. grab 2, player accel/turn unchanged), add a
  **"Grab & loot drops"** paragraph under **Gameplay** (range = strength / speed = `(strength/2)*(10/weight)`
  in world units, 0.3 s arm, blue line, 20 % drop, **hulls never drop**, victory-only deposit, `MAX_DROPS`
  cap), note pirate parts are now **priced (buyable:false → resale only, hidden from the shop)** in the
  **Shop & stash** + **Weapons/Components** sections, and add the drop-count line to the **Perf overlay**
  tool note.
- **`docs/CHANGELOG.md`** — a bullet under **`## 2026-07-03`**: **Grab component + enemy equipment drops** —
  the new tractor component (base owned, advanced buyable), the 20 %-per-kill metal-box drops (engines/
  thrusters/weapons — **hulls never drop**) pulled by range = strength / speed = `(strength/2)*(10/weight)`
  with a blue pull line, victory-only stash deposit, `REFERENCE_MASS` 48→50 so the base grab is mass-neutral,
  pirate parts now priced for resale (hidden from the shop via `buyable:false`), the optimized metal-box model
  (703 KB → ~NN KB) + CREDITS row, and the `?dev` drop-count perf readout + `__game.spawnTestDrop()` stress
  hook.
- **`docs/DECISIONS.md`** — one new numbered entry covering: **units, not "cells"** (range/speed formulas);
  **base grab range 10 is a short "vacuum assist"; Advanced grab range 20 is the real tractor** (the upgrade
  incentive — short base range is intended, not a bug); **`REFERENCE_MASS` bumped 48→50** to absorb the base
  grab's weight so the player's baseline accel/turn is unchanged (deliberate, not a silent nerf); **hulls are
  excluded from loot** to protect progression (a looted 550-HP boss hull would be equippable and break
  balance — so `pickLoot` never draws `e.hull`; engines/thrusters/weapons remain droppable **and**
  equippable-from-stash, accepted under infinite inventory + §30); **drops deposit on victory only** (haul
  lost on death — parallels credit banking but stricter); **pirate parts priced with `buyable:false`** (resale
  value without making enemy gear buyable in the shop); and the **client-authoritative loot** limitation
  (forgeable like unsealed rewards, §18).

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)
- **No per-component drop models** — one shared metal-box for every drop this iteration.
- **No contested-loot / multiplayer authority** — single-player only; the "stronger grab wins / first-puller
  wins" tie-break is moot with one ship and is **not** built.
- **No inventory cap / overflow** — inventory is infinite (drops just accumulate in the stash).
- **No despawn timer, no mid-mission save** of in-flight drops.
- **Hulls never drop** (progression guard). Beyond that, **no restriction on equipping looted engines/
  thrusters/weapons** — allowed under infinite inventory; do **not** add a further equip gate.
- **No server-side roll/sealing** — the roll + deposit stay client-trusted (note the limitation, don't fix it).
- **No new dedicated pickup SFX asset** — reuse an existing `audio.sfx.*` blip (or a tiny synth), no S3 audio
  work; if none fits cleanly, a silent collect is acceptable.
