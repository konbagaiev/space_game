# Economy + shop — v2 revisions (Vega Sentinels)

> Changes on top of the **applied v1** (`docs/plans/catalog-economy.md` ladder/prices +
> `docs/plans/hangar-shop.md` shop). Two things: **(1) double all prices** (v1 forgot the ×2 victory
> bonus), and **(2) rework the shop UI** (columns → separate screens; two-column shop). English-only.
> Planning window — no code written here.

## 1. Price doubling (the ×2 victory bonus)

**Why:** v1 priced against a ~2700 first-shop budget, but **each level clear DOUBLES that run's earned
credits** (`earned *= 2` on victory, `client/index.html`). The real budget after clearing L1–L3 is:
- base per-kill rewards L1+L2+L3 ≈ **~2400** → **×2 ≈ ~4800** banked + **1000** start ≈ **~5800**
  (matches observed play).

**Action: double every seeded price in `catalog_seed.js`** (re-seed is idempotent on startup):

| item | v1 price | v2 price |
|------|---------|----------|
| Heavy hull (id 13) | 3000 | **6000** |
| Solid-fuel engine (id 15) | 700 | **1400** |
| Ion engine (id 16) | 3200 | **6400** |
| Repair drone II (id 19) | 900 | **1800** |
| Nanobot repair (id 20) | 3500 | **7000** |
| Heavy cannon (id 6) | 1000 | **2000** |
| Plasma repeater (id 7) | 3000 | **6000** |
| Heavy rocket (id 8) | 1300 | **2600** |
| Basic kinetic gun (id 1) | 400 | **800** (sells ~600) |

**Verify the two intended paths at ~5800:**
- **A — two small upgrades:** Heavy rocket (2600) + Repair drone II (1800) = **4400** ≤ 5800 ✓ (~1400 spare).
- **B — one serious buy:** Heavy hull (**6000**); short ~200 → **sell the basic gun** (800 → ~600) →
  ~6400 ≥ 6000 ✓. Heavy hull stays the aspirational "next big buy."

(If real budgets run lower than ~5800 due to RNG/deaths, path A tightens — tune via playtest.)

**Resolved (budget anchor):** keep the doubling as-is. A *flawless* L1–L3 run banks only ~4280 (1000 +
3280 from the ×2 bonus), so the Heavy hull (6000) is intentionally **out of reach on a no-death run even
after selling the gun** — it's the aspirational buy that wants a retry or two (or early Phase-2 income).
Skilled players spend the ~4280 on mid-upgrades instead. ✅ confirmed; implementing v2.

## 2. Shop UI rework

### Problem with v1
The hangar laid out **Loadout / Stash / Shop as columns** in one view; component-type labels **overlap
the (i) info icon**, and it's cramped.

### Change
- **Stash and Shop become separate screens** (not columns side-by-side). The hangar has clear navigation
  between: the **ship/loadout** view, the **Stash** screen, and the **Shop** screen.
- **Shop = two columns:**
  - **Left:** a list of **component types** — Hull, Engine, Thrusters, Repair, **Weapon** (weapons are
    one of the types).
  - **Right:** on selecting a type, show the **items of that type** (with price, stats, buy action).
- **Fix the (i)-icon overlap:** give the info icon its own fixed cell; let long type/name labels wrap or
  ellipsize instead of running under the icon. (Applies to stash/loadout/shop item cards alike.)

### Keep from v1
- Credits balance shown; item cards as text-in-rectangle (no art yet); mobile (i) icon for stats;
  Sell/Install/Cancel actions; the live ship-stats panel (HP/accel/maneuverability/weight + delta);
  required-slot take-off gating; server-authoritative buy/sell/equip.

## 3. Game-over: "Back to Hangar" button
When the shop is unlocked (post-level-3 / `shop_unlocked`), the **death / game-over overlay** shows
**two** buttons: the existing **Restart** (retry the same mission) **and** a new **Back to Hangar**
(return to the hangar — shop, loadout, pick another mission). Before the shop is unlocked (the L1–L3
campaign), keep just Restart.
- Credits earned that run are already banked on death (non-doubled — `bankRun` runs on death too), so the
  hangar shows the updated balance.
- i18n: add `ui.gameover.back_to_hangar` — EN **"Back to Hangar"**, RU **"В ангар"**.

## Coordination
- Doubling: edits `catalog_seed.js` prices only (data; idempotent re-seed).
- UI: edits `client/index.html` + CSS + i18n strings (new screen labels / type names). Reuses the
  existing shop endpoints/datastore — no server/schema change for the UI rework.

## Acceptance criteria
- After clearing L3 (~5800 credits), the player can do **either** path A (rocket + drone II) **or**, by
  selling the basic gun, path B (Heavy hull). Prices in-game are the doubled values above.
- The hangar presents **Stash** and **Shop** as distinct screens (no cramped columns); the Shop is a
  **type list → items** two-pane; no label overlaps the (i) icon on any device.
- All v1 shop behavior (sell/install, stats panel + delta, take-off gating, server authority) still works.
- Dying on a mission (post-L3) shows **Restart + Back to Hangar**; Back to Hangar returns to the hangar
  with banked credits reflected. During the L1–L3 campaign, only Restart shows.
