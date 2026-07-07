# Touch/HUD overhaul + item rarity/color model

**Feature id:** 2026-07-05-1844-touch-hud-log-item-colors
**Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-07-05-1844-touch-hud-log-item-colors`

## Goal
Three related HUD/data changes:
1. **Touch-only** — move the zoom (`+`/`−`) buttons from the right edge to the **bottom-center**, laid
   out horizontally as `−  +` (minus LEFT, plus RIGHT). Desktop layout unchanged.
2. **All devices** — reformat the credits readout to a single line `credits {total}/{earned} earned`
   (total credits owned / credits earned this run) and **remove the "Enemies" live counter entirely**.
3. **All devices** — add a small **event log** above the rocket button that shows the last **4** lines,
   each **fading out over 5 s**: on a kill `{shipname} killed +{amount}`, on a pickup `picked up {name}`
   (the pickup line **tinted by the item's color**).
4. **Data model** — add a `rarity` (`trash`/`common`/`rare`) column and a `color` (hex text) column to
   **both** the `components` and `weapons` tables (migration + Postgres parity), seeded in
   `catalog_seed.js`, exposed through the client CATALOG.
5. **World highlight** — dropped items in the world are given a soft glow in **their own color** (trash =
   white, common = green, rare = blue). Off-screen loot edge pointers stay their fixed green (unchanged).

No 3D-model/asset changes → **no `/publish-itch` step needed** (this feature touches no content-hashed
model URL in `catalog_seed.js`).

## Decisions (settled — do not re-ask)
- New columns are named **`rarity`** (values `trash`/`common`/`rare`) and **`color`** (hex string), on
  **both** `components` and `weapons` tables. Migration in `db.js` (SQLite) + bootstrap parity in
  `db_postgres.js` (Postgres). Keep both backends in sync (server tests run SQLite only — MEMORY note
  "Backend parity SQLite/Postgres").
- Spelling is **`trash`** (not "thrash").
- Colors (hex strings, the single source for BOTH the pickup-log tint AND the world-drop glow):
  - **common = `#59e0a0`** (the existing `REWARD_TINT` green — loot glow / off-screen pointer green),
  - **trash = `#ffffff`** (white),
  - **rare = `#0000ff`** (pure blue, RGB 0,0,255).
- **Rarity assignment rule** (derived, so all rows stay consistent):
  `rarity = explicit override ?? ((price > 0 && stats.buyable !== false) ? 'common' : 'trash')`.
  The **only** explicit override is **Triple spiral rocket (weapon id 11) → `rare`**.
  - This yields: every **shop-available** player/starter/ladder item → **common/green**; every
    **pirate/enemy** part (`buyable:false`) and every price-0 boss/mini-boss part → **trash/white**;
    Triple spiral rocket → **rare/blue**. See the full enumeration table below.
- Credits line: `credits {G.balance}/{G.earned} earned` — total owned / **this run** (reuse existing
  `G.earned`; NO new persistent state).
- Event log: keep last **4** lines; each line **fades over 5 s** via a CSS animation (wall-clock; it is
  cosmetic, so it is acceptable that it keeps fading while the game is paused — DECISIONS §30, no
  per-frame integration needed). Pickup line is tinted by the item `color`; the kill line uses the
  default text color.
- Kill line uses the enemy ship's **DB name** (English, e.g. "Basic pirate ship"); pickup line uses the
  item's **DB name**. Both templates get EN + RU i18n keys.
- **Pickup log fires for every grab pickup**, including the L1/L2 cosmetic reward drops (they route
  through the same `collect()`).
- **Shop UI is OUT OF SCOPE for rarity/color display.** The feature request only asks for the world-drop
  glow and the pickup-log tint. `rarity`/`color` are added to the data model + client CATALOG now; the
  shop cards are NOT changed to show them. (State this in SUMMARY so a later iteration knows it's data
  that exists but isn't surfaced in the shop yet.)

---

## Steps

### A. Data model — `rarity` + `color` columns (server)

**A1. SQLite migration.** Create `server/src/migrations/020_item_rarity_color.js` (mirror
`016_item_models.js`):
```js
// 020 — item rarity + color: components/weapons gain a rarity tier (trash|common|rare) and a hex color.
// Drives the in-world drop glow + the pickup-log line tint (client). See
// docs/plans/2026-07-05-1844-touch-hud-log-item-colors.md.
export const up = (db) => {
  db.exec('ALTER TABLE components ADD COLUMN rarity TEXT;');
  db.exec('ALTER TABLE components ADD COLUMN color TEXT;');
  db.exec('ALTER TABLE weapons ADD COLUMN rarity TEXT;');
  db.exec('ALTER TABLE weapons ADD COLUMN color TEXT;');
};
```
(The migration runner auto-applies files whose numeric prefix > `PRAGMA user_version`; no other wiring.)

**A2. Postgres bootstrap parity** — `server/src/db_postgres.js`, in the schema block (near lines 48–50
and 69–71 where the item `model_url*` columns are added), add:
```sql
ALTER TABLE components ADD COLUMN IF NOT EXISTS rarity TEXT;
ALTER TABLE components ADD COLUMN IF NOT EXISTS color  TEXT;
```
and under the `weapons` table:
```sql
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS rarity TEXT;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS color  TEXT;
```

**A3. Seed the values in `catalog_seed.js`.** After the `WEAPONS` array literal (i.e. after line ~165),
add the classifier + stamp loop:
```js
// --- item rarity + color (drives the in-world drop glow + the pickup-log tint on the client).
// Rule: a shop-available item (price>0 AND not buyable:false) is 'common'; everything else (pirate/enemy
// gear + price-0 boss parts) is 'trash'; a row may set `rarity` explicitly to override (Triple spiral → 'rare').
const RARITY_COLOR = { trash: '#ffffff', common: '#59e0a0', rare: '#0000ff' };
const classifyRarity = (row) =>
  row.rarity || (((row.price ?? 0) > 0 && row.stats?.buyable !== false) ? 'common' : 'trash');
for (const row of [...COMPONENTS, ...WEAPONS]) {
  row.rarity = classifyRarity(row);
  row.color = RARITY_COLOR[row.rarity];
}
```
Then set the single explicit override: on **weapon id 11 (Triple spiral rocket)** add `rarity: 'rare'`
to its object literal (line ~157, e.g. `id: 11, name: 'Triple spiral rocket', type: 'rocket', price: 4000,
rarity: 'rare', stats: { ... }`). Do NOT hand-edit the other rows — the loop stamps them.

Resulting assignment (verify with the server test in E1):

| kind | ids → rarity/color |
|---|---|
| components common/green | 1 (Basic hull), 5 (Basic engine), 8 (Basic thrusters), 12 (Repair drone), 13 (Heavy hull), 15 (Solid-fuel engine), 16 (Ion engine), 19 (Repair drone II), 20 (Nanobot repair), 21 (Advanced thrusters), 29 (Grab), 30 (Advanced grab) |
| components trash/white | 2, 3, 4, 6, 7, 9, 10, 11, 22, 23, 24, 25, 26, 27, 28 |
| weapons common/green | 1 (Basic kinetic), 3 (Rocket homing), 5 (Machine Gun), 6 (Heavy cannon), 7 (Heavy Machine Gun), 8 (Heavy rocket) |
| weapons trash/white | 2, 4, 9, 10 |
| weapons rare/blue | **11 (Triple spiral rocket)** |

(Spot-check: Machine Gun 5 and Repair drone 12 = green ✓ matches the request; every `buyable:false`
pirate part = white ✓; Triple spiral 11 = blue ✓.)

**A4. Persist the new columns in the seed upsert.**
- `server/src/db.js` `seedCatalog()` (lines 29–34): add `rarity, color` to both the components and
  weapons `INSERT ... VALUES` + `ON CONFLICT DO UPDATE SET` clauses and pass `c.rarity, c.color` /
  `w.rarity, w.color` in the `.run(...)` calls.
- `server/src/db_postgres.js` seed upserts (lines ~190–197): same additions with `$N::` placeholders
  (append two params to each of the components/weapons upserts + the `EXCLUDED.rarity`,
  `EXCLUDED.color` set clauses).

**A5. Return the columns from the catalog getters.**
- `server/src/db.js` `getComponents()` and `getWeapons()` (lines ~332–338): add `rarity, color` to the
  `SELECT` list and to the mapped object (`rarity: r.rarity, color: r.color`).
- `server/src/db_postgres.js` `getComponents()`/`getWeapons()` (lines ~493–500): same.

### B. Expose `color`/`rarity` in the client CATALOG
`client/src/main.js` line 600–601:
- Weapons are mapped field-by-field — add `rarity: w.rarity, color: w.color` to the object built in
  `CATALOG.weapons.set(...)`. (`w.stats` has `projectileColor`, not `color`, so no clash.)
- Components store the whole row (`CATALOG.components.set(c.id, c)`), so `c.color`/`c.rarity` already flow
  through — no change needed there.

### C. HUD — credits reformat + remove Enemies counter
**C1. Markup** — `client/index.html` lines 19–28 (`<div class="right">`). Replace the Credits + Earned +
Enemies blocks with a single credits line and keep Destroyed:
```html
<div class="right">
  <div class="bigval" id="credits">credits 0/0 earned</div>
  <div class="label" style="margin-top:6px" data-i18n="ui.hud.destroyed">Destroyed</div>
  <div id="kills" style="font-size:18px">0</div>
</div>
```
(Delete the `ui.hud.credits` label div, the old `#credits` number div, the `ui.hud.earned` label,
`#earned`, the `ui.hud.enemies` label, and `#enemies`.)

**C2. `client/src/hud.js` `updateHud()`** (lines 20–24): replace
```js
el.earned.textContent = G.earned;
el.credits.textContent = G.balance;
...
el.enemies.textContent = enemies.length;
```
with
```js
el.credits.textContent = t('ui.hud.credits_line', { total: G.balance, earned: G.earned });
```
Remove the `el.earned` and `el.enemies` writes. The `enemies` import in hud.js is still used later
(`updateMarkers`, `updateMiniMap`, `updateEnemyHealthBars`) — keep it.

**C3. `client/src/dom.js`** — remove the now-dead `earned:` (line 21) and `enemies:` (line 24) entries.
Keep `credits:` and `kills:`.

**C4. i18n.** In `client/locales/source.json`: delete the now-unused `ui.hud.credits`, `ui.hud.earned`,
`ui.hud.enemies` entries (lines 3, 4, 6) and add:
```json
"ui.hud.credits_line": { "source": "credits {total}/{earned} earned", "context": "In-game HUD money readout. {total} = total credits owned; {earned} = credits earned this run. Lowercase 'credits' and 'earned' are labels around the two numbers." },
```
Keep `ui.hud.destroyed`. In `client/locales/ru.json`: remove the matching `ui.hud.credits`/`earned`/
`enemies` lines and add a `ui.hud.credits_line` translation, e.g.
`"ui.hud.credits_line": "кредиты {total}/{earned} заработано"`.

### D. Event log (all devices)
**D1. Markup** — `client/index.html` after `#rocket-btn` (line 201), add:
```html
<div id="event-log" aria-live="polite"></div>
```

**D2. CSS** — `client/styles.css`. Add near the rocket-button rules (after line 629). The rocket button
is `position: fixed; right: 28px; bottom: 40px; 84×84` on **both** desktop and touch, so anchoring the
log at `bottom: 132px` (≈8px above the rocket's top edge) places it directly above the rocket button on
**both** layouts:
```css
/* Event log: last 4 lines above the rocket button (both desktop + touch), each fading over 5s. */
#event-log {
  position: fixed; right: 22px; bottom: 132px; z-index: 6;
  width: 240px; pointer-events: none;
  display: flex; flex-direction: column; align-items: flex-end; /* newest appended at the bottom */
  gap: 2px; text-align: right;
}
.event-line {
  color: #dfe8ff; font: 600 14px system-ui, sans-serif;
  text-shadow: 0 0 4px #000, 0 1px 2px #000;
  animation: eventfade 5s linear forwards;
}
@keyframes eventfade { 0%,60% { opacity: 1; } 100% { opacity: 0; } }
```
Add `#event-log` to the `body.menu ... { display: none; }` hide list at line 363 (so it's hidden on
menus like the rest of the HUD).

**D3. Module** — new `client/src/eventlog.js`:
```js
// In-game event log: a short stack of fading lines above the rocket button (kills + pickups).
// DOM-only; pure cosmetic. Keeps the last MAX lines; each line fades over 5s via CSS then removes itself.
const MAX = 4;
let box = null;
const host = () => (box ||= document.getElementById('event-log'));

// text: the line to show. color: optional CSS color (pickup lines are tinted by the item's color).
export function logEvent(text, color) {
  const el = host(); if (!el) return;
  const line = document.createElement('div');
  line.className = 'event-line';
  line.textContent = text;
  if (color) line.style.color = color;
  el.appendChild(line);                              // newest at the bottom
  while (el.children.length > MAX) el.removeChild(el.firstChild); // drop the oldest
  line.addEventListener('animationend', () => line.remove());     // self-remove after the 5s fade
}

export function clearEventLog() { const el = host(); if (el) el.replaceChildren(); }
```

**D4. Kill line** — `client/src/sim.js` in the enemy-death block (after line 693, near the credit popup):
```js
logEvent(t('ui.log.killed', { name: e.name, amount: reward }));
```
Add the import at the top of sim.js: `import { logEvent, clearEventLog } from './eventlog.js';`
(`t` is already imported in sim.js).
The enemy entity must carry its name: in `client/src/ship-build.js` `spawnEnemyShip()` (the `const e = {`
at line 85), add `name: shipDef.name,` to the object.

**D5. Pickup line** — `client/src/drops.js` `collect(d)` (line 231), after the `audio.sfx.pickup?.()`
call, add:
```js
const cat = d.item.kind === 'component' ? CATALOG.components.get(d.item.refId) : CATALOG.weapons.get(d.item.refId);
if (cat) logEvent(t('ui.log.picked_up', { name: cat.name }), cat.color);
```
Add imports at the top of drops.js: `import { logEvent } from './eventlog.js';` and `import { t } from './i18n.js';`
(CATALOG is already imported). Note: `d.item` uses `{kind, refId}` for grab drops and `{kind, refId}` for
the special reward drops (they use the same shape via `lastKillDrop`), so this one path logs both.

**D6. Reset** — `client/src/sim.js` `reset()` (near line 796–797, beside `clearDrops()`): add
`clearEventLog();` so a fresh run starts with an empty log.

**D7. i18n** — add to `client/locales/source.json`:
```json
"ui.log.killed": { "source": "{name} killed +{amount}", "context": "In-game event-log line when the player destroys an enemy ship. {name} = the enemy ship's name (English, from the catalog, may be left as-is if untranslated); {amount} = credits earned from the kill (integer, shown after a plus sign)." },
"ui.log.picked_up": { "source": "picked up {name}", "context": "In-game event-log line when the player's tractor beam collects a dropped item. {name} = the item's name (English, from the catalog)." }
```
and RU equivalents to `client/locales/ru.json`, e.g.
`"ui.log.killed": "{name} уничтожен +{amount}"`, `"ui.log.picked_up": "подобрано: {name}"`.

### E. World-drop highlight in the item's color
The regular grab drops (`spawnDrop`) currently render a plain silver crate with no glow; give each drop a
soft halo tinted by its item color. Do this per-drop with a fresh `SpriteMaterial` (do NOT re-tint the
shared crate template — `Object3D.clone(true)` shares materials, so mutating a clone's material would
cross-contaminate every drop).

**E1. `client/src/drops-config.js`** — add a drop-halo size constant next to `REWARD_HALO_SIZE`:
```js
export const DROP_HALO_SIZE = 4.5; // soft rarity-color glow behind a normal loot drop (smaller than the reward halo)
```

**E2. `client/src/drops.js`** — generalize `addHalo` to take a color + size, then call it from
`spawnDrop`:
- Change the signature and body of `addHalo` (line 131) to
  `function addHalo(wrap, color = REWARD_TINT, size = REWARD_HALO_SIZE) { ... color: color ... sprite.scale.setScalar(size); ... }`.
- `spawnSpecialDrop` (line 186) keeps calling `addHalo(wrap)` (defaults → the green reward glow; the
  reward items are common/green, so this stays consistent).
- In `spawnDrop` (line 72), after `scene.add(obj);`, resolve the item color and add the halo:
  ```js
  const colorInt = cat && cat.color ? new THREE.Color(cat.color).getHex() : 0xffffff;
  addHalo(obj, colorInt, DROP_HALO_SIZE);
  ```
  (`cat` is already looked up at line 75 for weight; reuse it.) Import `DROP_HALO_SIZE` from
  `drops-config.js` in the existing import block (line 13). `THREE` and `CATALOG` are already imported.
- Sprites are children of the drop `obj`, which `collect()`/`clearDrops()` already remove from the scene
  wholesale, so no extra disposal wiring is needed (matches how the reward halo is handled today).

Result: trash pirate drops glow white (subtle), any common drop glows green, a rare drop glows blue.
The **off-screen edge pointers (`.drop-marker`) stay their fixed green** — unchanged (per the request).

### F. Touch-only zoom relocation (bottom-center, `−  +`)
DOM order in `client/index.html` is `#zoom-in` (`＋`) then `#zoom-out` (`−`) — keep it (desktop stays a
vertical `＋` over `−` on the right edge). Add touch overrides in `client/styles.css` after the `#zoom`
rules (line 642):
```css
/* Touch: move the zoom pair to the bottom-center, laid out horizontally as "−  +" (minus left, plus right). */
body.touch #zoom {
  right: auto; left: 50%; top: auto; bottom: 40px;
  transform: translateX(-50%);
  flex-direction: row-reverse; /* DOM is [＋, −]; row-reverse renders − (left) then ＋ (right) */
  gap: 14px;
}
```
This changes only touch (`body.touch`, the compat alias set with `input-touch`). Desktop is untouched.
Bottom-center clears the bottom-right rocket/fire buttons and the bottom-right event log.

---

## Tests

Run `client && node --test` and `server && npm test` (server tests exercise **SQLite only**, so the
Postgres edits in A2/A4/A5 must be kept in sync by inspection — see MEMORY "Backend parity").

**E1 — server catalog test.** In `server/src/server.test.js`, extend the existing catalog tests (the
`/api/components` test at ~line 358 and `/api/weapons` at ~line 412) or add a new test asserting rarity +
color come through the API:
- every returned component and weapon has a non-null `rarity` ∈ {`trash`,`common`,`rare`} and a `color`
  matching `RARITY_COLOR[rarity]`;
- spot cases: weapon 5 → `{rarity:'common', color:'#59e0a0'}`, weapon 11 → `{rarity:'rare',
  color:'#0000ff'}`, weapon 9 → `{rarity:'trash', color:'#ffffff'}`, component 12 → common/green,
  component 22 → trash/white.

**Client unit tests.** No new pure logic is added client-side that isn't DOM/THREE-bound (the classifier
lives server-side; `eventlog.js` and the drop halo are DOM/THREE). Rely on the visual scenario below +
the existing `client/src/drops.test.js` (unchanged — it imports only the pure `drops-config.js` pieces;
`DROP_HALO_SIZE` is an added export, not a changed one).

**Visual scenario.** Add `client/visual/scenarios/19-hud-log.mjs` (headless Playwright, harness like
`13-ship-bank.mjs`): launch into a fight and assert
1. `document.getElementById('enemies')` is **null** (counter removed),
2. `#credits` textContent matches `/^credits \d+\/\d+ earned$/`,
3. after killing an enemy (or evaluating `window.__game`/firing), an `.event-line` exists in `#event-log`,
4. with the page in a touch profile (the suite already has a mobile scenario pattern — reuse
   `15-mobile-landscape.mjs`'s emulation, or set `body.touch`), `#zoom` computed style has
   `left ≈ 50%`/`bottom` set (bottom-center) rather than the right-edge default.
Save a screenshot for eyeballing. NOTE the visual suite has a flaky ~6-scenario baseline (MEMORY "Visual
suite flaky baseline") — judge by the new scenario passing + **zero page errors**, not the whole set.

**Existing-test collateral check (done):** grepped the suite — no scenario asserts on the `#enemies`
counter, the `#credits`/`#earned` text, or the `#zoom` position. `13-ship-bank.mjs` reads
`window.__game.enemies` (the array) and takes a screenshot labelled `enemies` — that is the entity array,
NOT the HUD counter, so removing the counter does not affect it. No edits required to existing scenarios.

---

## Docs to update
- **`docs/SUMMARY.md`** — update the top "Updated:" dated blurb; the **HUD / Tools** section (credits
  readout now `credits {total}/{earned} earned`; the Enemies counter is removed; new **Event log** entry
  above the rocket button, last 4 lines fading over 5 s, pickup lines tinted by item color); the
  **Controls → Zoom** bullet (touch zoom pair now bottom-center `−  +`, desktop unchanged); the **Ship
  model → Components / Weapons** section (new `rarity`/`color` columns + the classification rule and the
  three colors; note the drop glow reads the color and that **the shop UI does not surface rarity/color
  yet — it's data only**); the **Grab & loot drops** section (drops now glow in their item's color; edge
  pointers stay green).
- **`docs/CHANGELOG.md`** — one dated bullet summarizing: touch zoom moved to bottom-center `−  +`;
  HUD credits reformatted + Enemies counter removed; new fading event log (kills + color-tinted
  pickups); `rarity`/`color` added to components/weapons (migration 020 + Postgres parity) driving the
  in-world drop glow.
- **`docs/DECISIONS.md`** — add ONE entry only if you consider the "rarity is derived from
  price/buyable, not hand-authored per row (single explicit override: Triple spiral → rare)" a real
  trade-off worth recording; otherwise skip (DECISIONS §30).

## Out of scope / non-goals
- **Shop UI does not display rarity/color** (no card borders/badges). Data only, for the drop glow +
  pickup-log tint.
- **Off-screen loot edge pointers stay fixed green** — do not recolor them by rarity.
- **No new persistent "session credits" state** — reuse the existing per-run `G.earned`.
- **No changes to the special L1/L2 reward-drop visuals** beyond what already exists (they already glow
  green, which equals their common color) — do not rework `spawnSpecialDrop`'s halo/tint.
- **No model/asset changes**, so **no `assets:*` run and no `/publish-itch`**.
- Do not gold-plate the event log (no icons, no scroll, no click-through, no per-frame dt integration) —
  4 lines, CSS fade, done.
