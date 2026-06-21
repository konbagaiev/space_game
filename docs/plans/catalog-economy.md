# Catalog expansion + pricing — v1 (APPLIED) (Vega Sentinels)

> **This is the applied v1 economy** (ladder + prices seeded in `catalog_seed.js`). Do NOT add further
> changes here — later revisions live in their own files (e.g. `docs/plans/economy-shop-v2.md`). Feeds
> the hangar shop (`docs/plans/hangar-shop.md`). English-only.

## Principles
- **Upgrades are trade-offs, not power-creep.** Mass drives everything (`massFactor = REFERENCE_MASS/mass`,
  REFERENCE_MASS = 48). A tougher hull is heavier → slower & less agile. Build the ladder around real
  choices (HP ↔ agility, damage ↔ fire-rate ↔ range), plus a few pricey "light-and-strong" premiums.
- **Anchor:** player base stays 100 HP / accel 10 / turn 2.0 at mass 48. New items shift from there.
- **Player ladder ≠ enemy parts.** The existing Boss/Medium/Light/Scout components are enemy-tuned —
  the player shop gets its own set (below). Light hull (id 2) optional as a glass-cannon — not exposed.
- **Pricing anchored to the first-shop budget.** Economy: start **1000** credits; kill rewards fighter
  **20** / rocketeer **40** / medium **100** / boss **200** (banked via `recordGame`).

## First-shop budget (v1 estimate — see v2 for the corrected ×2 figure)
The shop unlocks **after level 3**: budget = starting 1000 + everything earned across L1–L3.
- L1 ≈ 380, L2 ≈ 460, L3 ≈ 840 → earned ≈ ~1680 → **~2700** estimated here.
- ⚠️ **This estimate forgot the ×2 victory bonus** — the real budget is ~5800; the price re-tune lives in
  `docs/plans/economy-shop-v2.md`.

## Components (player ladder)
Component ids continue from 12 (new start at **13**); top-level `weight` + `price`.

### Hulls (HP ↔ weight) — "a new ship = a new hull"
Ship progression is via the **hull**, not buying whole ships (no separate ship-ownership axis for now).
| id | name | durability | weight | price | role |
|----|------|-----------|--------|-------|------|
| 1 | Basic hull (existing) | 100 | 20 | 0 | starter |
| 13 | Heavy hull | 200 | 50 | 3000 | the upgrade "ship" — 2× HP, much heavier → slower/less agile |

Handling with the Heavy hull (mass 48→78, `massFactor` ≈ 0.62): accel 10 → ~6.2, turn 2.0 → ~1.2, HP
100 → 200. Composite (light-and-tough) & other hulls → future/backlog.

### Engines (acceleration / maxSpeed ↔ weight)
| id | name | power | maxSpeed | weight | price | role |
|----|------|-------|----------|--------|-------|------|
| 5 | Basic engine (existing) | 10 | 0 | 10 | 0 | starter |
| 15 | Solid-fuel engine | 14 | 12 | 14 | 700 | T2 — more power, heavier |
| 16 | Ion engine | 16 | 14 | 10 | 3200 | T3 — high accel, light (premium) |

### Thrusters — DEPRIORITIZED
Maneuverability already feels high; turn upgrades kept out of the ladder. (Agile/Gyro listed in history,
no prices.)

### Repair drones (tiers)
| id | name | heal | interval | cap | weight | price |
|----|------|------|----------|-----|--------|-------|
| 12 | Repair drone (existing) | 1 | 3 s | 80% | 4 | 0 (granted) |
| 19 | Repair drone II | 1 | 2 s | 85% | 6 | 900 |
| 20 | Nanobot repair | 2 | 3 s | 90% | 8 | 3500 |

## Weapons
New weapon ids from **6**. Weapons carry `weight` (gun ≈ 6, rocket ≈ 8).
| id | name | type | power | fire rate | range | weight | price | role |
|----|------|------|-------|-----------|-------|--------|-------|------|
| 1 | Basic kinetic (existing) | bullet | 10 | medium | medium | 6 | 400 | in stash; sells ~300 |
| 5 | Machine Gun (existing) | bullet | low | high | short–med | ~6 | 0 | granted L2 |
| 6 | Heavy cannon | bullet | high | slow | long | 10 | 1000 | hard-hitting, sluggish fire |
| 7 | Plasma repeater | bullet | med | high | med | 8 | 3000 | strong all-rounder |
| 8 | Heavy rocket | rocket | high | slow | long | 12 | 1300 | small rocket upgrade |

(Exact bullet `projectileSpeed`/`maxRange`/`fireCooldown` copy the existing weapon stat shape + scale.)

## Resolved (v1)
- Trade-off stance confirmed (mass).
- "New ship" = a new hull; no whole-ship buying.
- Hulls v1: one Heavy hull (200/50/3000); Composite & others → future.
- Thrusters deprioritized. Light hull not exposed. Starting credits 1000.

## Status
- ✅ **Implemented** (2026-06-21): the ladder above + these (v1) prices are seeded in `catalog_seed.js`;
  the hangar shop lists only `price > 0` items.
- ➡️ **Next revisions** (price doubling for the ×2 bonus + shop UI rework): `docs/plans/economy-shop-v2.md`.
