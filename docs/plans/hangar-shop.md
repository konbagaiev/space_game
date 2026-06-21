# Hangar shop + stash — implementation brief (Vega Sentinels)

> Self-contained handoff. The "spend" side of the economy (ROADMAP Phase 1): a **stash** (player
> inventory), **equip/unequip**, **buy/sell** in the hangar. Built incrementally. Server-authoritative.
> English-only. Planning-window note: no code written here. Builds on: economy/credits (done, DECISIONS
> §11), components/weapons catalog, `player_ships.components` + mounts/loadout, repair-drone component.

## Vision (target UX)
The hangar shows the player ship with **icons for each equipped slot around the model**. Click a slot →
menu: **unequip** (→ stash) or **buy a different one** (shop, filtered to that slot type). A **stash
panel** lists owned items (text-in-rectangle for now, no art); hover shows stats (mobile: an **(i)**
icon); click/tap opens a dropdown: **Sell / Install / Cancel**. Credits balance shown prominently.

Phasing note: the around-model slot icons are the nice end-state. To get a working economy loop fast,
build the **stash panel + a simple shop list** first, then evolve to the around-model interaction.

## Core rules / decisions (lock these)
- **Server-authoritative.** Buy/sell/equip/unequip change credits + persistent loadout → all via server
  endpoints, **transactionally** (no double-spend / item dupe). Never trust the client. (Precedent:
  `replaceWeapon`/`installComponent` server-side mutation in `db.js applyBriefingActions`.)
- **Stash = qty model.** Table keyed by `(player_id, kind, ref_id)` with a `qty`. `kind ∈ {component,
  weapon}` (two separate catalogs / id-spaces). One-row-per-instance only later, if items gain
  individual state (upgrades/wear) — note it, don't build it now.
- **Required slots can't be empty at take-off.** `hull`, `engine`, `thruster` are required; `repair`
  and weapons are optional. Unequipping into the stash is allowed, but **take-off is blocked while a
  required slot is empty** (validate server-side on launch + grey out the button client-side).
- **Sell:** stash items are sellable; **optional equipped** items (weapons, repair drone) are sellable
  **directly from the hangar** (no separate unequip step). **Required equipped** items
  (hull/engine/thrusters) can't be sold while equipped (would break the ship — unequip needs a
  replacement first). Sell price = `floor(price * 0.75)`, computed **on the server**.
- **Gated: the hangar shop/stash unlocks only after the player has completed level 3.** Enforce
  server-side (e.g. `current_progress` past level 3 / a campaign-cleared flag); client hides/locks the
  shop until then. (Today level 3 is the last level — clearing it = the victory.)
- **Seed the basic gun into the stash.** The level-2 briefing swapped the basic kinetic gun (id 1) for
  the Machine Gun (id 5) — the removed gun should be **owned**, sitting in the stash. Going forward, make
  the `replaceWeapon` swap deposit the replaced weapon into the stash; for players who already passed
  that swap, **backfill id 1 on first stash unlock** (everyone reaching the shop has done the swap), so
  it's uniform.
- **Buy → stash** (not auto-equip), matching the stash-centric flow: buy → it appears in stash →
  install separately.
- **Prices** = a new top-level `price` field on each catalog entry (components already have top-level
  `weight`; add `price` there and on weapons). **Seed 0 for now**; the economy is inert until real
  prices are set — fine for plumbing.

## Build order (incremental — matches "stash first")

### Phase A — data + server (no UI yet)
1. **Migration `0NN_stash.js`** (next free number — events took 010, so **011; re-check**), mirrored in
   `db_postgres.js`. Table `stash`: `player_id TEXT NOT NULL`, `kind TEXT NOT NULL` (component|weapon),
   `ref_id INTEGER NOT NULL` (→ components.id / weapons.id), `qty INTEGER NOT NULL DEFAULT 1`,
   unique `(player_id, kind, ref_id)`. Index `(player_id)`.
2. **`price`** top-level field on components + weapons (`catalog_seed.js`, seed 0; re-seed is idempotent
   on startup). Add the column/field in both backends if stored as a column.
3. **Datastore methods** (in `datastore.js` → `db.js` + `db_postgres.js`), all server-authoritative:
   - `getStash(playerId)` → list with joined catalog name/type/stats/price.
   - `buyItem(playerId, kind, refId)` — transaction: check price ≤ balance → deduct credits → stash qty++.
   - `sellItem(playerId, kind, refId)` — transaction: stash has qty>0 → qty-- → credit `floor(price*0.75)`.
   - `equipItem(playerId, kind, refId, slot?)` — move from stash → active ship (`components[slot]` for a
     component, mounts/loadout for a weapon); the previously-equipped item, if any, goes back to stash.
   - `unequipItem(playerId, slot|mount)` — move equipped → stash; reject if it empties a required slot…
     actually allow it but block take-off (see rules). Decide which; recommend allow + block-on-launch.
4. **Endpoints** (`server.js`): `GET /api/players/:id/stash`, `POST .../buy`, `.../sell`, `.../equip`,
   `.../unequip`. Validate inputs; 400/402(insufficient credits)/409 as appropriate. Return updated
   balance + stash so the client re-renders.
5. **Take-off validation:** the active-ship/launch path rejects launching with an empty required slot.

### Phase B — stash UI (read + sell/install)
6. **Stash panel** in the hangar: each item a labeled rectangle (large text, no art). Show the **credits
   balance**. Hover → tooltip with stats; **mobile: an (i) icon** opens the same stats.
7. **Dropdown on click/tap:** Sell / Install / Cancel (Cancel = just close). Sell/Install call the
   endpoints; UI updates from the response.
8. **Live ship-stats panel (persistent in the hangar):** always show the resulting **HP, acceleration,
   maneuverability (turn rate), weight**, recalculated on **every config change** (equip / unequip /
   buy-install / sell). Show the **delta vs the previous configuration** (e.g. ▲/▼ + number next to each
   stat). Derived client-side from the new loadout via `deriveDrive` + hull `durability` + `shipMass`
   (server stays authoritative on the actual saved config).

### Phase C — shop + equipped-slot interaction
9. **Shop list:** catalog items with `price > 0` (a `buyable` flag optional), filterable by slot/type;
   Buy → stash. Then author **item/weapon variants + real prices**.
10. **Around-model slot icons** (the target UX): each equipped slot rendered as an icon near the ship;
    click → unequip / buy-replacement filtered to that slot type. (Polish over the list-based shop.)

## i18n
All new UI strings (panel labels, actions Sell/Install/Cancel, stat names, "insufficient credits",
"can't launch — empty slot") go through the existing i18n catalog (`source.json` + `ru.json`), keyed.

## Coordination & dependencies
- Touches `catalog_seed.js`, `db.js`, `db_postgres.js`, `datastore.js`, a new migration, `server.js`,
  `client/index.html`, locales. Coordinate the **migration number** (events = 010 → stash = 011).
- Independent of the hi-poly hangar model (DECISIONS §14) — the shop works with the current model;
  detailed model can land separately.
- This is where the **integrity/anti-cheat** concern first bites (real credits) — hence
  server-authoritative + transactional from the start.

## Acceptance criteria
- The shop/stash is **locked until level 3 is cleared**, then available.
- On unlock, the player's stash contains the **basic gun (id 1)** that was swapped out after level 2.
- A player can unequip (→ stash), install from stash, buy (credits down, item in stash), and sell
  (credits up by 75% of price) — all persisted, server-validated.
- **Optional** equipped items (weapons, repair drone) sell directly from the hangar; **required**
  equipped items (hull/engine/thrusters) can't be sold while equipped. Take-off is blocked while a
  required slot is empty.
- Can't overspend; no item dupe / double-spend under repeated/parallel calls.
- The hangar shows **HP, acceleration, maneuverability, weight**, updated on every change with a
  **delta vs the previous config**; stash stats viewable on desktop (hover) and mobile (i).
- With all prices 0 the flows work (buy free, sell for 0) — then real prices/variants slot in.
