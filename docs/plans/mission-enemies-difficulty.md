# Side-mission enemies & difficulty — brief (Vega Sentinels)

> **Done (2026-06-22).** Seeded in `catalog_seed.js`: **Pirate machine gun = weapon id 9**; **Pirate hull
> = component id 22**, **Pirate engine = id 23** (21 was taken by Advanced thrusters — re-verified);
> **pirate gunner** ship (`role: pirate_gunner`); the **"first boss" guns swapped to the Pirate MG** (also
> buffs L3). The wave composition (40/40/20 → 35/35/30 → 2-boss finale) lives in the mission generator
> (`server/src/missions.js`). See DECISIONS §18, CHANGELOG 2026-06-22.

> Defines the **enemy mix + difficulty for the generated side missions** (the 3-choice board,
> `mission-generator.md`) — introduces a new enemy, and buffs the boss. All numbers derive from the
> existing base enemy (fighter = hull id2 Light 30 HP + engine id6 Scout maxSpeed 10.5 + reward 20, color
> `0xff5d5d`). English-only. Planning window — no code here. Suggested ids assume next-free — re-verify.

## New weapon — Pirate machine gun (bullet)
Long-range like the player's machine gun.
- `power: 3`, `fireCooldown: 0.18`, `maxRange: 90`, `projectileSpeed: 50`, `weight: ~6` (≈ Machine Gun).
- Suggested **weapon id 9** (existing weapons go to id 8).

## New components (for the pirate gunner)
HP +20% and max speed +50% over the base enemy require their own hull + engine (data-driven):
- **Pirate hull** — `durability: 36` (30 × 1.2), `weight: ~10` (scaled from Light hull's 8; tune).
  Suggested **component id 21**.
- **Pirate engine** — `maxSpeed: 15.75` (10.5 × 1.5); keep `power: 12.6` (same accel as Scout — only max
  speed changes per spec), `weight: ~6`, exhaust tinted to the ship's off-red. Suggested **component id 22**.

## New enemy — Pirate gunner
- `type: enemy`, `role: 'pirate_gunner'`.
- Components: `{ hull: 21 (Pirate hull, 36 HP), engine: 22 (maxSpeed 15.75), thruster: 9 (Scout) }`.
- Mounts: **1 × Pirate machine gun (id 9)**, in an AI fire group tuned for its **long range (90)** —
  keep distance but engage within ~90 (like the player MG).
- **Color:** slightly different from the base red `0xff5d5d` — propose a deeper crimson, e.g. `0xe53935`
  (tune to taste; just visibly distinct).
- **Reward: 40** (20 × 2).
- Derived stats end up ≈ 36 HP, ~+50% top speed, rapid long-range fire — a tougher, faster skirmisher.

## Side-mission wave composition (all 3 board missions — same difficulty)
1. **Phase 1** — pool **40% pirate gunner / 40% rocketeer / 20% heavy** (heavy = the mini-boss/`medium`),
   `advanceWhen: { kills: 7 }`.
2. **Phase 2** — pool **35% / 35% / 30%** (gunner / rocketeer / heavy), `advanceWhen: { kills: 14 }`
   (cumulative — "another 7").
3. **Clear-out** — `spawn: null`, `advanceWhen: { allCleared: true }`.
4. **Bosses** — spawn **2 × the (upgraded) boss** (`total: 2`), `advanceWhen: { allCleared: true }` → win.
- `maxConcurrent`: not specified — suggest ~4 (tune; this is a hard mission with heavies + a 2-boss finale).
- This is the same composition for all three flavored side missions (mining / research / freighter).

## Boss upgrade (affects the side-mission bosses AND level 3)
- The **"first boss"** ship: replace its **two basic-kinetic guns** with **two Pirate machine guns
  (id 9)**; its two rocket launchers are unchanged.
- ⚠️ Because L3 uses the same "first boss" ship, **this also buffs the level-3 boss** — intended. Worth a
  quick re-playtest of L3 after the change.

## Tunable knobs
Exact off-red color, Pirate hull/engine weights, `maxConcurrent`, the AI engagement range for the
long-range MG, and the 2-boss finale (could feel brutal — adjust per playtest).

## Coordination
`catalog_seed.js` (new weapon id 9, components 21/22, the `pirate_gunner` ship, the boss mount swap),
the side-mission template in the generator (`mission-generator.md`). Re-seed is idempotent. Re-verify
next-free ids before assigning. Cross-ref: `mission-generator.md` (this replaces its "use existing
enemies" note for the side missions).
