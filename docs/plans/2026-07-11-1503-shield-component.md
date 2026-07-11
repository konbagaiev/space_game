# Base shield component — implementation brief (Vega Sentinels)

> Self-contained handoff for the implementation session. Adds a new **shield** component type (a real
> catalog component, "Base shield", equipped on the starter ship) that absorbs incoming damage before the
> hull, breaks when fully depleted, and recharges over time. Plus a HUD shield bar above a recolored (red)
> health bar. **This session is mechanics + HUD math only — NO shield ship-visual / FX.** File:line refs
> were accurate at planning time — re-verify. English per the project's English-only rule.

## Goal
Give the player a regenerating damage buffer. The starter ship carries a **Base shield** (capacity **20**,
recharge **10 s**). Incoming damage from **every source** (enemy bullets + rocket blast) is absorbed by the
shield first; only the **excess spills to the hull**. The shield holds its remaining value **indefinitely**
until a hit **fully depletes** it; only then does it go inactive and recharge over `rechargeSec`, refilling
to **full** and reactivating (partial damage never triggers recharge). The HUD gains a **shield bar
directly above the health bar** (same width, touching): **blue** while active, a **purple fill that grows
over the recharge time** while broken, turning blue again when full. The **health bar becomes red**. Stats
are per-component so bigger/faster shield tiers are a pure data drop-in later (mirrors the repair-drone
pattern, component id 12).

## Decisions (settled — do not re-ask)
1. **Damage sources:** shield absorbs **all** player damage (bullets + rocket blast) via one shared
   `applyPlayerDamage(dmg)` helper doing shield-first absorption + overflow-to-hull.
2. **Overflow:** a hit exceeding the remaining shield breaks it to 0 and **spills the excess to hull**.
3. **Recharge:** fires **only after full depletion**; a partial shield persists until broken. On break it
   recharges over `rechargeSec`, refills to **full capacity**, and reactivates. Dt-driven off the sim tick
   (freezes on pause, refills to full at each run reset) — mirrors `repairTick`.
4. **Real catalog component** in a new **optional** `shield` slot; base shield equipped on the starter ship
   + **buyable** in the shop (small price, mirrors repair drone id 12). Only the base tier is seeded now.
5. **No ship visual/FX** this session — HUD bar state changes only (blue active / purple recharging).
6. **Base shield `weight: 0`** (DESIGN CALL — flagged for review). The shield sits on the *starter* ship, so
   any nonzero weight silently nerfs the starter's accel/turn (mass 50 → 54) **and** would force a
   `REFERENCE_MASS` bump (50 → 54) that also buffs every enemy's `massFactor`. Weight 0 keeps starter
   handling and all enemy balance byte-for-byte unchanged with no `REFERENCE_MASS` change and no mass-test
   churn — thematically "the base emitter is negligible; heavier capacitor tiers add mass later." `'shield'`
   is still added to the mass loop so future tiers *can* carry weight. **If you'd rather it weigh like the
   repair drone (4):** set `weight: 4`, bump `REFERENCE_MASS` 50 → 54 in `client/src/components.js:12`, and
   update the mass assertions in `client/src/components.test.js:26-28` (include a shield in `playerShip()`).

## Data model — `server/src/catalog_seed.js`
New component in `COMPONENTS` (max id today is 30 → use **id 31**). Add it right after the Grab rows
(after `catalog_seed.js:79`, `{ id: 30, name: 'Advanced grab', ... }`):
```js
// shield (new component type): absorbs incoming damage before the hull; breaks when fully depleted,
// then recharges over `rechargeSec` and refills to full. Equipped on the starter ship; buyable. Tiers
// (bigger capacity / faster recharge) drop in later as more `{ capacity, rechargeSec }` rows.
{ id: 31, name: 'Base shield', type: 'shield', weight: 0, price: 500,
  stats: { capacity: 20, rechargeSec: 10 } },
```
Add `shield: 31` to the **starter loadout** at `catalog_seed.js:248`:
```js
components: { hull: 1, engine: 5, thruster: 8, grab: 29, shield: 31 },
```

## Server — slot registry + back-fill (SQLite + Postgres parity)
`shield` is an **optional** component slot (not required for take-off). Add it to `COMPONENT_SLOTS` in
**both** backends; leave `REQUIRED_SLOTS` unchanged:
- `server/src/db.js:369` — `const COMPONENT_SLOTS = new Set(['hull', 'engine', 'thruster', 'repair', 'grab', 'shield']);`
- `server/src/db_postgres.js:549` — same edit.

**Back-fill existing players** (mirror the Grab back-fill, DECISIONS §40). Players with a NULL
`player_ships.components` inherit the re-seeded ship default (now includes `shield:31`) and need nothing;
players whose active ship has an explicit `components` override predating shields lack the slot → grant 31.

1. **SQLite** — new migration `server/src/migrations/023_backfill_shield.js` (migrations auto-discover by
   filename order via `migrate.js`; 022 is the latest). Copy `019_backfill_grab.js` exactly, swapping
   `grab`/`29` → `shield`/`31`:
   ```js
   // 023 — backfill the Base shield (component 31) onto existing players. Mirrors 019 (grab). NEW players
   // get it from the reseeded ship default; players with an explicit pre-shield components override don't.
   // Idempotent: rows already carrying a 'shield' slot are skipped.
   export const up = (db) => {
     const rows = db.prepare('SELECT id, components FROM player_ships WHERE components IS NOT NULL').all();
     const upd = db.prepare('UPDATE player_ships SET components = ? WHERE id = ?');
     for (const r of rows) {
       let c; try { c = JSON.parse(r.components); } catch { continue; }
       if (c && typeof c === 'object' && c.shield == null) { c.shield = 31; upd.run(JSON.stringify(c), r.id); }
     }
   };
   ```
2. **Postgres** — add an idempotent `UPDATE` in `db_postgres.js` `migrate()` immediately after the Grab
   back-fill block (`db_postgres.js:263-268`):
   ```js
   // Backfill the Base shield (component 31) onto existing players (mirrors SQLite migration 023).
   await pool.query(`UPDATE player_ships SET components = jsonb_set(components, '{shield}', '31'::jsonb)
     WHERE components IS NOT NULL AND NOT (components ? 'shield')`);
   ```

## Client — pure logic (`client/src/components.js`, unit-tested in Node)
Add `'shield'` to the mass loop at `components.js:17` (so future weighted tiers count toward mass):
```js
for (const slot of ['hull', 'engine', 'thruster', 'repair', 'grab', 'shield']) {
```
Add two pure, stateless functions (caller holds the runtime state, exactly like `repairTick`):
```js
// Absorb incoming damage with the shield first. Returns the new shield value, the damage that spills to
// the hull, and whether this hit FULLY depleted the shield. A partial hit (dmg < shieldValue) leaves the
// shield reduced with nothing reaching the hull; a hit >= shieldValue breaks it to 0 and spills the excess.
// Assumes shieldValue > 0 (the caller routes to the hull directly when the shield is already depleted).
export function absorbDamage(shieldValue, dmg) {
  if (dmg < shieldValue) return { shieldValue: shieldValue - dmg, toHull: 0, broke: false };
  return { shieldValue: 0, toHull: dmg - shieldValue, broke: true };
}

// Recharge a BROKEN shield. Only runs once fully depleted (shieldValue <= 0): a partial shield holds
// indefinitely (returns accum 0 = not recharging). While broken, banks dt; on reaching rechargeSec the
// shield refills to full capacity and reactivates. Pure: the caller passes the accumulator in/out.
export function shieldRecharge(shieldValue, capacity, rechargeSec, dt, accum) {
  if (shieldValue > 0 || !(capacity > 0) || !(rechargeSec > 0)) return { shieldValue, accum: 0 };
  accum += dt;
  if (accum >= rechargeSec) return { shieldValue: capacity, accum: 0 }; // refilled → active again
  return { shieldValue, accum };
}
```

## Client — wiring
### Resolve + init the shield on the player (`client/src/ship-build.js`)
- `resolveComponents` (`ship-build.js:16-20`) — add `shield` to the destructured slots and the returned
  object: `return { hull: get(r.hull), engine: get(r.engine), thruster: get(r.thruster), repair: get(r.repair), grab: get(r.grab), shield: get(r.shield) };`
- `buildPlayer` (`ship-build.js:43,51-52`) — destructure `shield`, attach it, and seed the runtime state:
  ```js
  const { hull, engine, thruster, repair, grab, shield } = resolveComponents(active.components);
  // ...in the player object literal, alongside `repair, grab,` and `_repairAccum: 0,`:
  hull, engine, thruster, repair, grab, shield, // `shield` = base-shield stats { capacity, rechargeSec } or null
  _repairAccum: 0,
  _shieldValue: shield ? shield.capacity : 0,   // current absorption remaining (starts full & active)
  _shieldRechargeAccum: 0,                       // seconds banked while broken → drives recharge + HUD purple fill
  ```
  (`shield` resolves to `{ id, name, weight, capacity, rechargeSec }` or `null`.)

### Single damage router (`client/src/projectiles.js`)
Define `applyPlayerDamage` here (projectiles.js has no import cycle with sim.js — sim.js already imports
*from* projectiles.js). Add `import { absorbDamage } from './components.js';` at the top, then:
```js
// Route ALL incoming player damage through the shield first (bullets + rocket blast). The shield absorbs
// until fully depleted, spilling only the excess to the hull; once broken it stays at 0 and recharges in
// sim.update (shieldRecharge). No shield, or already depleted → full damage hits the hull.
export function applyPlayerDamage(dmg) {
  const p = G.player;
  if (p.shield && p._shieldValue > 0) {
    const r = absorbDamage(p._shieldValue, dmg);
    p._shieldValue = r.shieldValue;
    if (r.broke) p._shieldRechargeAccum = 0; // start the recharge timer fresh on the breaking hit
    if (r.toHull > 0) p.hp -= r.toHull;
  } else {
    p.hp -= dmg;
  }
}
```
Replace the raw rocket-blast damage at `projectiles.js:292` (`G.player.hp -= r.damage;`) with
`applyPlayerDamage(r.damage);`.

### Bullet damage site (`client/src/sim.js`)
- Extend the existing projectiles import (`sim.js:14`) to also import `applyPlayerDamage`.
- Replace the bullet hit at `sim.js:525`: `G.player.hp -= b.damage;` → `applyPlayerDamage(b.damage);`
  (keep the rest of the line: `hit = true; audio.sfx.hit(sfxFor('ship', G.player.class, 'hit'));`).
- Import `shieldRecharge` from `./components.js` (sim.js already imports `repairTick` from there).
- Add a recharge block in `update(dt)` right after the repair-drone block (`sim.js:372-375`):
  ```js
  // --- shield: recharge only once fully depleted, then refill to full (no-op without a shield) ---
  if (G.player.shield) {
    const s = shieldRecharge(G.player._shieldValue, G.player.shield.capacity, G.player.shield.rechargeSec, dt, G.player._shieldRechargeAccum);
    G.player._shieldValue = s.shieldValue; G.player._shieldRechargeAccum = s.accum;
  }
  ```
- Per-run reset — after `G.player._repairAccum = 0;` (`sim.js:868`):
  ```js
  G.player._shieldValue = G.player.shield ? G.player.shield.capacity : 0; // fresh run: shield full & active
  G.player._shieldRechargeAccum = 0;
  ```

### HUD (`client/index.html`, `client/styles.css`, `client/src/dom.js`, `client/src/hud.js`)
**DOM** — replace the health block at `client/index.html:14-18`. Drop the standalone `Health` label (a
single label can't correctly name both bars; the color-coded bars are self-descriptive — see Docs
decision), add the shield bar above the health bar:
```html
<div style="padding-left:44px"><!-- clear the settings gear (top-left corner) so the bars sit beside it -->
  <div id="shieldbar"><div id="shieldfill"></div></div>
  <div id="hpbar" class="with-shield"><div id="hpfill"></div></div>
  <div id="hppct">100.0%</div>
</div>
```
**CSS** (`client/styles.css:15-17`) — recolor health red, add the shield bar touching above it:
```css
#shieldbar { width: 220px; height: 10px; border: 1px solid #3a6ea5; border-bottom: 0;
             border-radius: 7px 7px 0 0; overflow: hidden; margin-top: 4px; background: rgba(0,0,0,.4); }
#shieldfill { height: 100%; width: 100%; background: linear-gradient(90deg,#36d1dc,#5b86e5); transition: width .15s; } /* blue = active */
#shieldbar.recharging #shieldfill { background: linear-gradient(90deg,#7b2ff7,#b06bff); } /* purple = recharging */
#hpbar { width: 220px; height: 14px; border: 1px solid #3a6ea5; border-radius: 7px; overflow: hidden; margin-top: 4px; background: rgba(0,0,0,.4); }
#hpbar.with-shield { border-radius: 0 0 7px 7px; border-top: 0; margin-top: 0; } /* touch the shield bar above */
#hpfill { height: 100%; width: 100%; background: linear-gradient(90deg,#ff5a5a,#c81e1e); transition: width .15s; } /* health = red */
#hppct { margin-top: 4px; font: 700 14px system-ui, sans-serif; color: #cfe6ff; }
```
**Refs** (`client/src/dom.js:23-24`) — add:
```js
hpBar: byId('hpbar'),          // health bar container (toggles .with-shield for the stacked layout)
shieldBar: byId('shieldbar'),  // shield bar container (toggles .recharging → purple)
shieldFill: byId('shieldfill'),// shield bar fill (width = current fraction)
```
**Update** (`client/src/hud.js`, in `updateHud`, after the existing `el.hpFill`/`el.hpPct` writes):
```js
const sh = G.player.shield;
if (sh && sh.capacity > 0) {
  el.shieldBar.style.display = 'block';
  el.hpBar.classList.add('with-shield');
  const val = G.player._shieldValue;
  if (val > 0) { // active → blue, width = remaining fraction
    el.shieldBar.classList.remove('recharging');
    el.shieldFill.style.width = Math.max(0, Math.min(1, val / sh.capacity)) * 100 + '%';
  } else {       // broken → purple, width grows over the recharge time
    el.shieldBar.classList.add('recharging');
    const frac = sh.rechargeSec > 0 ? Math.min(1, G.player._shieldRechargeAccum / sh.rechargeSec) : 0;
    el.shieldFill.style.width = frac * 100 + '%';
  }
} else { // no shield component → hide the bar, health bar reverts to full rounded corners
  el.shieldBar.style.display = 'none';
  el.hpBar.classList.remove('with-shield');
}
```

### Shop (buyable component — wire every surface it appears on)
The base shield is buyable, so it must show correctly in the two-pane shop and the loadout, mirroring
`repair`/`grab` exactly (an optional slot: empty slots are hidden). In `client/src/shop.js`:
- `SHOP_TYPES` (`shop.js:197`) — add `'shield'` (e.g. after `'repair'`): `['hull', 'engine', 'thruster', 'repair', 'shield', 'weapon', 'grab']`.
- `statLine` (`shop.js:31-56`) — add a `shield` case beside the `repair`/`grab` cases:
  ```js
  else if (type === 'shield') { add('ui.shop.stat.shield', s.capacity); parts.push(`${t('ui.shop.stat.recharge')} ${s.rechargeSec}s`); }
  ```
- `deriveShipStats` (`shop.js:63`) — spread `shield` into the ship object so it weighs into mass:
  `hull: rc.hull, engine: rc.engine, thruster: rc.thruster, repair: rc.repair, grab: rc.grab, shield: rc.shield,`
- `ownedCount` slot list (`shop.js:141`) and `renderLoadout` slot list (`shop.js:161`) — add `'shield'` to
  both `['hull', 'engine', 'thruster', 'repair', 'grab']` arrays.
- `renderLoadout` empty-slot hide (`shop.js:164`) — extend the optional check so an empty shield slot is
  hidden like repair/grab: `if (slot !== 'repair' && slot !== 'grab' && slot !== 'shield')`.
- `slotLabel` (`client/src/format.js:14`) already resolves `ui.shop.slot.${slot}` → just add the i18n key.

### i18n (`client/locales/source.json` + `client/locales/ru.json`)
Add these keys to **both** files (source = EN truth; ru mirrors), following the existing grab entries:
- `ui.shop.slot.shield` — EN "Shield" / RU "Щит" (context: equipment slot label for the damage-absorbing shield).
- `ui.shop.filter.shield` — EN "Shield" / RU "Щит" (context: shop type-tab label).
- `ui.shop.stat.shield` — EN "Shield" / RU "Щит" (context: stat label — shield capacity, followed by e.g. "20").
- `ui.shop.stat.recharge` — EN "Recharge" / RU "Перезарядка" (context: stat label — shield recharge time, followed by e.g. "10s").
The `ui.hud.health` key stays defined (harmless, now unused since the HUD `Health` label is removed).

## Tests
**`client/src/components.test.js`** — import `absorbDamage, shieldRecharge` and add cases:
- `absorbDamage`: partial hit (`absorbDamage(20, 5)` → `{ shieldValue: 15, toHull: 0, broke: false }`);
  exact-break (`absorbDamage(20, 20)` → `{ shieldValue: 0, toHull: 0, broke: true }`); overflow spill
  (`absorbDamage(20, 30)` → `{ shieldValue: 0, toHull: 10, broke: true }`).
- `shieldRecharge`: no-op while active/partial (`shieldRecharge(15, 20, 10, 5, 0)` → `{ shieldValue: 15, accum: 0 }`);
  banks dt while broken but not yet full (`shieldRecharge(0, 20, 10, 4, 0)` → `{ shieldValue: 0, accum: 4 }`);
  refills to full capacity at rechargeSec (`shieldRecharge(0, 20, 10, 6, 4)` → `{ shieldValue: 20, accum: 0 }`);
  a large dt still refills to exactly capacity (`shieldRecharge(0, 20, 10, 100, 0)` → `{ shieldValue: 20, accum: 0 }`).
- Mass loop is unchanged for the base (weight 0) — no fixture edit needed. (Only add a shield-with-weight
  mass case here **if** you take the `weight: 4` option in Decision 6.)

**`server/src/server.test.js`** — the starter-loadout assertions must include the new slot; the component
catalog count grows by one:
- `:346` — `assert.deepEqual(player.components, { hull: 1, engine: 5, thruster: 8, grab: 29, shield: 31 });`
- `:729` — `assert.deepEqual(active.components, { hull: 1, engine: 5, thruster: 8, grab: 29, shield: 31 });`
- `:385` — `assert.equal(comps.length, 28);` (was 27; update the tallying comment at `:382-384` to note "+ 1 base shield (31)").
- Add a shield-seeded assertion in that same test:
  ```js
  const shield = comps.find((c) => c.name === 'Base shield');
  assert.equal(shield.id, 31); assert.equal(shield.type, 'shield');
  assert.deepEqual(shield.stats, { capacity: 20, rechargeSec: 10 });
  ```
- Grep the file for any other `grab: 29` / `hull: 1, engine: 5, thruster: 8` starter-loadout assertions and
  add `shield: 31` to each (only `:346` and `:729` exist at planning time). The L3 repair-install test
  (`:202`) only checks `components.repair` and is unaffected.

**Run:** `cd client && node --test` and `cd server && npm test`. Server tests run on **both** SQLite and
Postgres — the `COMPONENT_SLOTS` edit and the back-fill live in `db.js` **and** `db_postgres.js`; keep them
in sync (there is no automated Postgres test locally, so verify the two by inspection).

## Docs to update
- **`docs/SUMMARY.md`** — (1) *Data model / components* section: add the `shield` component type + the Base
  shield row (id 31, capacity 20, recharge 10 s, optional slot, buyable) and note the starter loadout now
  carries `shield:31`; (2) *HUD* section: shield bar above the health bar (blue active / purple recharging),
  health bar recolored red; (3) *Combat/damage* section: all player damage routes through `applyPlayerDamage`
  (shield-first absorption, overflow spills to hull, recharge only after full depletion). Bump `**Updated:**`.
- **`docs/CHANGELOG.md`** — a bullet under today's date (`2026-07-11`): **"Base shield component"** — new
  `shield` component type, Base shield (cap 20 / recharge 10 s) on the starter ship + buyable; absorbs all
  incoming damage before the hull with excess spilling through, recharges to full only after a full break;
  HUD shield bar (blue/purple) above a now-red health bar; SQLite migration `023_backfill_shield.js` +
  Postgres back-fill for existing players.
- **`docs/DECISIONS.md`** — add **§66** (next free): shield mechanic = *break-then-recharge* (partial holds
  indefinitely, recharge only on full depletion, refill to full), routed through a single `applyPlayerDamage`
  helper; base shield `weight: 0` to avoid a `REFERENCE_MASS` bump / enemy `massFactor` drift; HUD `Health`
  label dropped because one label can't name both stacked bars. Cross-ref §30 (keep it simple), §40 (grab
  back-fill precedent this mirrors).

## Out of scope / non-goals (do not gold-plate — DECISIONS §30)
- **No** shield ship-visual / bubble / hit-flash FX — HUD bar states only.
- **No** advanced shield tiers this session (the `{ capacity, rechargeSec }` shape makes them a later data
  drop-in; do not seed them now).
- **No** enemy shields, no shield-piercing weapons, no per-damage-type shield modifiers.
- **No** numeric/percent readout on the shield bar (bar-only); health keeps its existing `#hppct`.
- **No** gradual/continuous recharge and **no** recharge-on-partial-damage — recharge triggers *only* on a
  full break, and refills to full.
- **No** `REFERENCE_MASS` change (base shield weight 0) unless you deliberately choose the `weight: 4`
  option in Decision 6.
```
