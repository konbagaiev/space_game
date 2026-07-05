# L1/L2 reward drops — Machine Gun + Repair drone on the battlefield

**Status:** planned · **Feature id:** `2026-07-05-1244-l1-machine-gun-drop`

## Goal
Turn the "you got a new item" moment for the first two campaign levels into a **visible battlefield
reward**. When the player kills the **last enemy of Level 1**, a **Machine Gun** (the real weapon-5 model)
drops on the field with a **green glow + green halo** and a **pulsing green off-screen pointer**; the last
enemy of **Level 2** drops the **Repair drone** the same way. The drop is a **cosmetic collectible** — the
player may grab it or ignore it, it changes nothing. The **one guaranteed copy of the reward is still
delivered by the existing server-side install** that already runs on victory (unchanged): clearing L1
force-equips the Machine Gun (moving the basic kinetic to the stash), clearing L2 installs the Repair
drone. The two Hangar briefings are kept (item still spins in the showcase) but their wording is reworded
from "command installed it" to "you recovered it". Net user-visible effect: the reward reveal happens as a
glowing drop at the end of the fight instead of only as a line of briefing text before the next one — with
a **hard guarantee the player never ends up with two Machine Guns or two Repair drones**.

## Decisions (all resolved — do NOT re-ask, do NOT re-open)
- **A. Server reward path is UNCHANGED.** The existing idempotent briefing actions already deliver exactly
  one copy at the right time: clearing L1 runs L2's briefing action `replaceActiveShipWeapon(1→5)`
  (`server/src/db.js:142`), which force-equips the Machine Gun and moves the displaced basic kinetic (id 1)
  to the stash — a **no-op if id 1 isn't mounted**, so replays don't duplicate. Clearing L2 runs L3's
  briefing action `installActiveShipComponent('repair', 12)` (`db.js:178`), idempotent (re-sets the same
  slot). **Do NOT add a `reward.actions` block, do NOT move/rekey grants, do NOT touch `advanceProgress`,
  `applyBriefingActions`, the briefing `actions`, or the `showcase` derivation.** This is the single source
  of the one guaranteed copy.
- **B. The new work is a client-side battlefield drop.** On the **last** enemy of L1 spawn a special drop
  rendered from the Machine Gun's existing `modelUrlHigh`
  (`https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/machine_gun_hangar.aabc98c9.glb`); on the last enemy
  of L2, the Repair drone's `modelUrlHigh` (`.../repair_drone_hangar.b9d0fa33.glb`). **Reuse those
  CloudFront glbs directly** — no asset-pipeline run, no new content hash, no `CREDITS.md` change (both are
  already CC-BY credited), **and no `/publish-itch` step** (nothing is re-hashed; the itch build reads these
  hangar URLs live from CloudFront, it does not bundle them).
- **C. Ownership gate — spawn the special drop ONLY if the reward isn't already owned.** Read `G.activeShip`
  during combat: L1 → no mount with `weapon === 5`; L2 → `components.repair` empty. On a first playthrough
  the reward is granted only *after* victory (on advance), so during the fight it's not yet owned → the drop
  spawns. On a replay after the reward is owned → **no special drop**; the last enemy falls back to the
  normal 20 % metal-box roll. The eligible levels are marked **declaratively** with a new descriptor field
  `lastKillDrop` (present only on L1 and L2).
- **D. The special drop is COSMETIC — collecting it deposits NOTHING to the stash.** It can still be pulled
  by the grab for feel, but `collect()` must **skip the `pendingLoot`/`depositLoot` path** for a special
  drop (it just despawns, small feedback blip). **Why:** the one guaranteed copy comes solely from the
  server force-install (decision A); if the cosmetic drop also deposited, a player who grabbed it would end
  with two Machine Guns / two Repair drones. Cosmetic-only is what makes "grab it or not — doesn't matter"
  literally true.
- **E. Green glow — both surfaces (option b).**
  - **3D model on the field:** a green **emissive tint** on the model's materials **+** one small **additive
    green halo sprite** behind it (a pooled radial-gradient `THREE.Sprite`, additive blending, `depthWrite:
    false`; **no post-processing / bloom** — the scene has none). A special drop must **not** get the silver
    material override normal drops use.
  - **Off-screen pointer:** the special drop's edge arrow (drawn by `updateDropMarkers`) gets a **pulsing
    green glow** — a `.drop-marker.special` CSS class with an animated green `drop-shadow`. Thread a per-drop
    `special` flag through the distance-sorted marker assignment so the correct arrow is tagged.
- **F. Briefings kept, only reworded (English is source of truth; RU updated to match).** Keep both
  briefings, keep their `actions` (decision A) and therefore keep the spinning showcase (it's derived from
  the actions — no code change). **Only rewrite the text** from "command installed it" to a
  "you recovered / picked it up" framing. Do **not** set `showcase: null`, do **not** remove actions.

## Detection facts (verified — state them, don't re-derive)
- **`G.kills === G.enemyTotal` (right after `G.kills++`) uniquely marks the last kill.** `enemyTotal` is
  precomputed on the server per level (`enemyTotalFromPhases`, stamped onto `descriptor.enemyTotal`) and is
  exposed as `G.enemyTotal` (`sim.js:52`). For **L1** it is **16** (wave-1 kills:6 + carry 3, wave-2 to 12 +
  carry 3, finale clears field: +1 +3); the last kill is the finale rocketeer or a carried fighter,
  whichever dies last — type doesn't matter, the count does. For **L2** it is **17**; the last kill is the
  lone mini-boss (boss phase, spawned alone after `clear-out`). Both are deterministic.
- **Descriptor field flows through with no migration.** Levels are upserted on every boot
  (`db.js:49-51` and the Postgres mirror `db_postgres.js`, `ON CONFLICT(name) DO UPDATE SET descriptor =
  excluded.descriptor`). Adding `lastKillDrop` to the seed re-seeds automatically; the client reads it via
  `GET /api/players/:id/level` → `CATALOG.level.descriptor` → `levelRunner.level.lastKillDrop`.
- **Both reward models exist** (`catalog_seed.js`: weapon id 5 `modelUrlHigh` line 114; component id 12
  `modelUrlHigh` line 36) and are the same lazy-loaded CloudFront hangar glbs the item preview already uses.
- **`G.activeShip = { ship, loadout, components }`** (`state.js:51`) is populated in combat, so the
  ownership gate is a pure read (no fetch).

---

## Steps

### 1. Level descriptors: mark L1 + L2 with a `lastKillDrop` (`server/src/catalog_seed.js`)
- **L1** — add the field to the `level-1` descriptor, next to `title`/`map` (anchor: the object opened at
  `catalog_seed.js:373`, `title: 'Level 1', map: 'home-system',`):
  ```js
  title: 'Level 1', map: 'home-system',
  lastKillDrop: { kind: 'weapon', refId: 5 },   // cosmetic reward drop on the last enemy (Machine Gun); server force-installs the real copy on victory
  ```
- **L2** — same on the `level-2` descriptor (anchor: `catalog_seed.js:404`, `title: 'Level 2', map:
  'home-system',`):
  ```js
  title: 'Level 2', map: 'home-system',
  lastKillDrop: { kind: 'component', refId: 12 }, // cosmetic reward drop on the last enemy (Repair drone)
  ```
- Do **not** add it to L3/L4 or any side mission. Leave every `briefing`/`actions`/`phases` untouched.

### 2. drops-config.js: green tint + halo constants (`client/src/drops-config.js`)
Add pure constants (this file is import-free so `scripts/assets-check.mjs` can still import it under node —
keep it import-free; do NOT import THREE here):
```js
export const REWARD_TINT      = 0x59e0a0; // green — emissive tint + halo + off-screen pointer glow
export const REWARD_HALO_SIZE = 5.0;      // world-units diameter of the additive halo sprite behind a reward drop
```
Do **not** add a model-URL constant — the special-drop model comes from the catalog
(`CATALOG.weapons/components.get(refId).modelUrlHigh`), not a fixed URL.

### 3. drops.js: special (reward) drops (`client/src/drops.js`)
The special drop reuses the existing `drops[]` lifecycle (rotate, arm, pull, off-screen marker) but with a
green model + halo and **no stash deposit**. Changes:

3a. **Imports** — add the two new constants and (for the ownership gate + halo) whatever's needed:
```js
import { DROP_MODEL_URL, DROP_CHANCE, MAX_DROPS, ARM_DELAY, ROTATE_PERIOD, COLLECT_DIST, WEIGHT_FALLBACK,
         REWARD_TINT, REWARD_HALO_SIZE, pullSpeed, pickLoot } from './drops-config.js';
```

3b. **`spawnSpecialDrop(pos, reward)`** — `reward = { kind, refId }` (from `lastKillDrop`). Resolve the
catalog item, look up its `modelUrlHigh`, weight; build the drop entry with `special: true`; render green;
attach the halo. Because the hangar glb is lazy-loaded from CloudFront, spawn a **green fallback box
immediately** so the reward appears at once, then swap in the model on load (same wrap group, so the
in-flight pull continues):
```js
export function spawnSpecialDrop(pos, reward) {
  if (!reward) return;
  if (drops.length >= MAX_DROPS) { console.warn('drops: cap reached, skipping reward drop'); return; }
  const cat = reward.kind === 'component' ? CATALOG.components.get(reward.refId) : CATALOG.weapons.get(reward.refId);
  if (!cat) return;
  const weight = cat.weight || WEIGHT_FALLBACK;
  const wrap = new THREE.Group();
  wrap.add(greenFallbackBox());          // immediate stand-in (green, glowing) until the glb loads
  addHalo(wrap);                          // additive green halo sprite behind the model
  wrap.position.copy(pos); wrap.position.y = 0.8;
  scene.add(wrap);
  const url = cat.modelUrlHigh;
  if (url) gltfLoader.load(url, (g) => {
    const model = normalizeGreen(g.scene);   // center+scale like normalize(), but GREEN emissive (no silver)
    // swap the fallback box for the real model, keep the halo:
    const box = wrap.children.find((c) => c.userData.__fallback);
    if (box) { wrap.remove(box); box.geometry.dispose(); box.material.dispose(); }
    wrap.add(model);
  }, undefined, () => {}); // on error the green fallback box stays — still reads as a reward
  drops.push({ obj: wrap, item: reward, weight, inRange: 0, special: true });
}
```
- **`greenFallbackBox()`** — like `fallbackBox()` (line 60) but green: `color` `REWARD_TINT`, `emissive`
  `REWARD_TINT`, `emissiveIntensity ~0.9`; set `mesh.userData.__fallback = true` so it can be found/removed.
- **`normalizeGreen(obj)`** — a variant of `normalize()` (line 29): keep the center + scale-longest-axis-to
  2.5 logic, but in the material pass set `emissive = REWARD_TINT`, `emissiveIntensity ~0.9`, and a light
  base color; do **not** apply the silver albedo/metalness the normal `normalize()` uses. Wrap in a
  `THREE.Group` like `normalize()` so rotation spins about center.
- **`addHalo(wrap)`** — build once a shared additive halo material/texture (radial green gradient on a small
  canvas → `THREE.CanvasTexture`), `SpriteMaterial { map, color: REWARD_TINT, blending: THREE.AdditiveBlending,
  transparent: true, depthWrite: false }`. Add a `THREE.Sprite` scaled to `REWARD_HALO_SIZE` as a child of
  `wrap`. (Sprites always face the camera, so it reads as a glow regardless of the drop's spin.) Only one
  special drop ever exists at a time, so no sprite pooling is needed; it's removed with the wrap in
  `clearDrops()`/`collect()`.

3c. **`collect()`** (line 106) — skip the stash deposit for special drops:
```js
function collect(d) {
  scene.remove(d.obj);
  drops.splice(drops.indexOf(d), 1);
  if (!d.special) pendingLoot.push(d.item);   // cosmetic reward drops deposit NOTHING (see DECISIONS: exactly one copy)
  audio.sfx.pickup?.();
  hideLine();
}
```

3d. **`ownsReward(reward)`** — pure ownership gate read off `G.activeShip` (export it so `sim.js` uses it):
```js
export function ownsReward(reward) {
  const as = G.activeShip; if (!as || !reward) return false;
  if (reward.kind === 'weapon') {
    const mounts = (as.loadout && as.loadout.mounts) || (as.ship && as.ship.stats && as.ship.stats.mounts) || [];
    return mounts.some((m) => m.weapon === reward.refId);
  }
  if (reward.kind === 'component') {
    const comps = as.components || (as.ship && as.ship.components) || {};
    return comps.repair != null; // L2 reward is the repair slot; refId 12 lands here
  }
  return false;
}
```
- `clearDrops()` (line 115) already removes every `d.obj` from the scene and empties `pendingLoot` — the
  special drop's wrap (with its halo child) is a normal scene child, so it's cleared for free. No change.

### 4. sim.js: spawn the reward drop on the last kill (`client/src/sim.js`)
- **Imports** (line 17) — add `spawnSpecialDrop, ownsReward`:
  ```js
  import { updateDrops, spawnDrop, spawnSpecialDrop, pickLoot, ownsReward, clearDrops, takeLoot, DROP_CHANCE, drops } from './drops.js';
  ```
- **Enemy-death loop** — replace the single drop-roll line (`sim.js:657`) so the last eligible kill spawns
  the special drop **instead of** the normal roll:
  ```js
  // reward drop: the LAST enemy of a level that carries a lastKillDrop drops the reward model (cosmetic —
  // no stash deposit; the real copy is server-installed on victory), but only if the player doesn't already
  // own it. Otherwise fall back to the usual 20% metal-box loot roll.
  const lkd = levelRunner.level && levelRunner.level.lastKillDrop;
  if (lkd && G.kills === G.enemyTotal && !ownsReward(lkd)) {
    spawnSpecialDrop(e.mesh.position, lkd);
  } else if (Math.random() < DROP_CHANCE) {
    const loot = pickLoot(e); if (loot) spawnDrop(e.mesh.position, loot);
  }
  ```
  (`G.kills` was already `++`'d at line 649; `e` is captured at line 641 before the splice, so its position
  is valid. `levelRunner` is defined in this module.)
- No other sim change: `updateDrops(dt)` already rotates/pulls the special drop (it's a normal `drops[]`
  entry); `reset()`'s `clearDrops()` already removes it.

### 5. hud.js: tag the special drop's off-screen arrow (`client/src/hud.js`)
In `updateDropMarkers` (line 109):
- When building `offs` (line 122), carry the flag: `offs.push({ cx: x * k, cy: y * k, d2: ..., special: !!d.special });`
- When assigning a pooled marker (loop at line 126), toggle the glow class:
  ```js
  m.classList.toggle('special', !!offs[i].special);
  ```
- In the hide loop (line 134), also clear the class so a recycled arrow doesn't keep glowing:
  ```js
  for (let i = n; i < dropMarkerPool.length; i++) { dropMarkerPool[i].style.display = 'none'; dropMarkerPool[i].classList.remove('special'); }
  ```

### 6. styles.css: pulsing green glow for the special pointer (`client/styles.css`)
After `.drop-marker` (line 602) add the glow + keyframes (the arrow is a CSS triangle, so glow via
`drop-shadow`, layering onto the existing shadow):
```css
  /* Reward (L1/L2 last-kill) loot arrow: brighter green + a pulsing green glow so it stands out */
  .drop-marker.special { border-left-color: #7dffbf; animation: dropMarkerGlow 1.1s ease-in-out infinite; }
  @keyframes dropMarkerGlow {
    0%,100% { filter: drop-shadow(0 0 3px rgba(0,0,0,.85)) drop-shadow(0 0 4px rgba(89,224,160,.6)); }
    50%     { filter: drop-shadow(0 0 3px rgba(0,0,0,.85)) drop-shadow(0 0 10px rgba(89,224,160,1)); }
  }
```

### 7. Reword the two briefings (English source + RU) — keep actions + showcase
Only the display text changes; `actions` (and thus the derived showcase) stay per decision A.
- **`server/src/catalog_seed.js`** — update the fallback English `text` on both briefings:
  - `level-2` briefing (line 407) → e.g.
    `"You pulled a Machine Gun out of the wreckage back there, Sentinel — lighter on the trigger and a real help for shooting down incoming rockets. Now push the pirates off our weapons factory before they arm their fleet."`
    (Keep `textKey: 'level.2.briefing'`, keep `actions: [{ type: 'replaceWeapon', from: 1, to: 5 }]`.)
  - `level-3` briefing (line 442) → e.g.
    `"I see you salvaged a repair drone from that last fight, Sentinel — good. It's fitted and will patch your hull mid-battle, a little at a time. If you take heavy damage, peel off to a quiet corner and let it work."`
    (Keep `textKey: 'level.3.briefing'`, keep `actions: [{ type: 'installComponent', slot: 'repair', component: 12 }]`.)
- **`client/locales/source.json`** — update the `source` (and refresh the `context`) for
  `level.2.briefing` (line 136) and `level.3.briefing` (line 139) to match the new English above. English is
  the source of truth (CLAUDE.md).
- **`client/locales/ru.json`** — update the RU strings for `level.2.briefing` (line 136) and
  `level.3.briefing` (line 139) to a matching "ты подобрал / ты нашёл" framing (keep "Страж"; keep the
  weapon/component wording consistent with the rest of the RU file). RU is the separate localization layer,
  not authored English — but keep it in sync.

---

## Tests
- **Client `cd client && node --test`:**
  - New `client/src/drops.test.js` cases (or extend it if it already exists) around the **pure** pieces:
    `ownsReward` returns true when a mount has `weapon === refId` (L1) / when `components.repair != null`
    (L2), false otherwise and when `G.activeShip` is null. Keep it THREE-free (only reads `G` — set
    `G.activeShip` in the test). Do **not** unit-test the glb/scene rendering (covered by the headless
    suite + live-test).
  - Existing `drops`/`components` tests must still pass unchanged.
- **Server `cd server && npm test` AND `cd server && npm run test:pg`:** no server logic changed, but the
  seed gained a descriptor field — run both so the level upsert (SQLite + Postgres) and existing
  advance/briefing tests stay green. (Keep `db.js`/`db_postgres.js` in parity; nothing here edits either,
  but verify the Postgres path re-seeds the new field.)
- **Headless / visual:** the client visual suite has a flaky ~6-scenario baseline — judge by the
  reliably-passing set + **zero page errors**. No new required scenario; the glow is verified in live-test.

## Acceptance criteria → live-test checklist
Deploy, then on prod (fresh account for the first-time paths):
1. **L1 first clear — drop appears.** Start L1, fight to the last enemy. When the final enemy dies, a
   **Machine-Gun model** appears at its position with a **green glow + halo**, and while it's off-screen a
   **pulsing green edge arrow** points to it (distinct from the plain green loot arrows).
2. **Grab is optional.** Whether you grab the MG drop **or fly past it to the base**: after docking, the L2
   briefing shows the **Machine Gun equipped as the primary weapon**, the **basic kinetic is in the stash**,
   and there is **exactly ONE** Machine Gun (none spare in the stash) — identical in both cases.
3. **Briefing reworded, item still spins.** The L2 briefing text reads as "you recovered a Machine Gun"
   (not "command installed it"), and the MG model still spins in the showcase.
4. **L1 replay — no drop.** Replay L1 with the MG already equipped: the last enemy does **not** spawn a
   special drop (at most a normal 20 % metal box); no double MG anywhere.
5. **L2 first clear — repair drone.** Same as (1)–(2) for L2's last enemy (the mini-boss): a glowing
   **Repair-drone** drop + pulsing arrow; after victory the repair drone is installed (repair slot filled),
   exactly one; L3 briefing reworded to "you picked up a repair drone", drone still spins.
6. **L2 replay — no drop** once the repair slot is filled.
7. **No regressions:** normal 20 % metal-box drops, grab pull/blue line, and the plain green off-screen loot
   arrows still work on all levels; pausing still freezes drops.

## Docs to update
- **`docs/SUMMARY.md`** (bump `**Updated:**`): in **Gameplay → Grab & loot drops**, add that the **last
  enemy of L1/L2 drops a cosmetic reward model** (Machine Gun / Repair drone, from each item's
  `modelUrlHigh`) with a **green emissive+halo** render and a **pulsing green off-screen pointer**, gated to
  when the player doesn't already own it (`lastKillDrop` on the L1/L2 descriptors), and that this drop
  **deposits nothing** — the one guaranteed copy comes from the **unchanged** server force-install on
  victory (L1 replaceWeapon 1→5 / L2 installComponent repair 12). In the **HUD → Off-screen drops** note,
  mention the `.drop-marker.special` pulsing-green variant. In the briefing/showcase note (the
  "mission briefings showcase the granted item" paragraph in **Ship model → Component & weapon models**),
  update that the L2/L3 briefings are now worded as "you recovered/picked it up" while still showcasing the
  spinning item and still running the same grant actions.
- **`docs/CHANGELOG.md`** — a bullet under **`## 2026-07-05`**: **L1/L2 reward drops** — the last enemy of
  L1 drops the Machine Gun (and L2 the Repair drone) as a green-glowing, green-haloed battlefield model with
  a pulsing green off-screen arrow, shown only when the reward isn't already owned; the drop is **cosmetic**
  (grabbing deposits nothing) — the single guaranteed copy still comes from the unchanged server install on
  victory, so a player never ends with two; the L2/L3 briefings reworded to a "you recovered it" framing
  (EN source + RU), item still spinning; no asset/hash/itch changes (reuses existing hangar glbs).
- **`docs/DECISIONS.md`** — one short numbered entry: **the L1/L2 reward is server-installed (unchanged,
  idempotent); the battlefield drop is COSMETIC to guarantee exactly one copy.** Record why: making the drop
  deposit would double the item for anyone who grabs it; leaving the guaranteed copy solely with the
  idempotent server install keeps "grab it or not — doesn't matter" true and dupe-proof on replays. Note we
  deliberately did **not** refactor the reward path (§30 — smallest change).

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)
- **No server refactor.** Do not add a `reward.actions` block, a new `/claim-reward` endpoint, or any change
  to `advanceProgress`/`applyBriefingActions`/the briefing `actions`/`showcase`.
- **No new assets / pipeline / hash / CREDITS / itch republish** — reuse the existing `modelUrlHigh` glbs.
- **No post-processing / bloom** — the glow is emissive + an additive sprite only.
- **No reward-drop persistence or stash deposit** — the special drop is cosmetic and vanishes on
  collect/reset; it never enters `pendingLoot`.
- **No extra reward drops** beyond L1 (weapon 5) and L2 (component 12); do not add them to L3/L4 or side
  missions.
- **No new pickup SFX asset** — reuse the existing `audio.sfx.pickup?.()` blip (or silent), no S3 audio work.
