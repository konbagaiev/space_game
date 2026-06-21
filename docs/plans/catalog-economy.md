# Catalog expansion + pricing — design draft (Vega Sentinels)

> **Working draft to tune together** — feeds the hangar shop (`docs/plans/hangar-shop.md`). Defines the
> player-facing item ladder (components + weapons) and a pricing scheme. Numbers are a **strawman**:
> anchored to the existing balance, meant to be playtested/adjusted. English-only. Planning window.

## Principles
- **Upgrades are trade-offs, not power-creep.** Mass drives everything (`massFactor = REFERENCE_MASS/mass`,
  REFERENCE_MASS = 48). A tougher hull is heavier → slower & less agile. Build the ladder around real
  choices (HP ↔ agility, damage ↔ fire-rate ↔ range), plus a few pricey "light-and-strong" premium
  sidegrades.
- **Anchor:** player base stays 100 HP / accel 10 / turn 2.0 at mass 48. New items shift from there.
- **Player ladder ≠ enemy parts.** The existing Boss/Medium/Light/Scout components are enemy-tuned —
  don't expose them as-is; the player shop gets its own set (below). Light hull (id 2) *could* be
  exposed as a glass-cannon option — optional.
- **Pricing tiers** (round numbers; top tier super-linear): T1 ~150–300, T2 ~600–1200, T3 ~2500–5000.
  Absolute values couple to **mission payouts (Phase 2)**: cost ÷ payout = grind length. Target: a T2
  upgrade ≈ a few grind missions (the ~50-sortie / ~5-grind shape). **Tune prices and payouts together.**

## New components (player ladder) — strawman
Continue ids from 12 (so new components start at **id 13**). `weight` + new top-level `price`.

### Hulls (HP ↔ weight)
| id | name | durability | weight | price | role |
|----|------|-----------|--------|-------|------|
| 1 | Basic hull (existing) | 100 | 20 | 0 | starter |
| 13 | Reinforced hull | 160 | 40 | 800 | T2 — tankier, slower |
| 14 | Composite hull | 130 | 24 | 3000 | T3 — tough *and* light (premium) |

### Engines (acceleration / maxSpeed ↔ weight)
| id | name | power | maxSpeed | weight | price | role |
|----|------|-------|----------|--------|-------|------|
| 5 | Basic engine (existing) | 10 | 0 | 10 | 0 | starter |
| 15 | Ion engine | 14 | 12 | 14 | 700 | T2 — faster, heavier |
| 16 | Racing engine | 16 | 14 | 10 | 3200 | T3 — high accel, light (premium) |

### Thrusters (turn rate ↔ weight)
| id | name | power | weight | price | role |
|----|------|-------|--------|-------|------|
| 8 | Basic thrusters (existing) | 2.0 | 4 | 0 | starter |
| 17 | Agile thrusters | 2.6 | 5 | 600 | T2 — sharper turns |
| 18 | Gyro thrusters | 3.2 | 6 | 2800 | T3 — top agility (premium) |

### Repair drones (the "future tiers" from the repair-drone spec)
| id | name | heal | interval | cap | weight | price |
|----|------|------|----------|-----|--------|-------|
| 12 | Repair drone (existing) | 1 | 3 s | 80% | 4 | 0 (granted) |
| 19 | Repair drone II | 1 | 2 s | 85% | 6 | 900 |
| 20 | Nanobot repair | 2 | 3 s | 90% | 8 | 3500 |

## New weapons — strawman
Continue ids from 5 (new weapons start at **id 6**). Weapons carry `weight` (gun ≈ 6, rocket ≈ 8 today).
Trade-offs: damage ↔ fire-rate ↔ range ↔ weight.

| id | name | type | power | fire rate | range | weight | price | role |
|----|------|------|-------|-----------|-------|--------|-------|------|
| 1 | Basic kinetic (existing) | bullet | 10 | medium | medium | 6 | 0 | starter (now in stash) |
| 5 | Machine Gun (existing) | bullet | low | high | short–med | ~6 | 0 | granted L2 |
| 6 | Heavy cannon | bullet | high | slow | long | 10 | 1000 | T2 — hard-hitting, sluggish fire |
| 7 | Plasma repeater | bullet | med | high | med | 8 | 3000 | T3 — strong all-rounder |
| 8 | Heavy rocket | rocket | high | slow | long | 12 | 2600 | T3 — bigger homing punch |

(Exact bullet `projectileSpeed`/`maxRange`/`fireCooldown` to match the existing weapon stat shape — copy
the schema of ids 1/3/5 and scale.)

## Economy coupling (note for Phase 2)
When the mission generator lands, set per-mission payouts so the ladder paces the grind: e.g. if a grind
mission pays ~150–250 cr, a T2 part (~600–1200) ≈ 3–6 missions, a T3 part (~3000) ≈ a meaningful goal.
Keep payouts data-driven (per mission/level) so prices ↔ payouts tune in tandem. Until then, prices can
sit at 0 (plumbing) or get these draft values for early playtest.

## Open design questions
1. **Trade-off vs power-creep** — confirm the trade-off stance (recommended) vs simpler "strictly better, costs more".
2. **Ladder depth** — 2 tiers (T2/T3) per slot as above, or deeper?
3. **Sell whole ships / buy a new ship?** ROADMAP Phase 1 mentioned "upgrade *or buy* ships". Selling/buying
   whole player ships is a bigger axis (player_ships ownership, not just components). Recommend
   components/weapons first; ships as a follow-up. Confirm.
4. **Expose Light hull (glass cannon) to the player?** Optional flavor.
5. **Starting credits** for a freshly-unlocked shop (so the first purchase is reachable)?

## Next steps
- Tune the numbers above with playtests once the shop mechanic (hangar-shop.md) is in.
- Set `price` on each catalog entry in `catalog_seed.js` (idempotent re-seed on startup).
- Revisit alongside Phase 2 mission payouts.
