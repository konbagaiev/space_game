# Level 4 — difficulty & balance — brief (Vega Sentinels)

> **Implemented 2026-06-23.** Seeded in `catalog_seed.js`: **Advanced pirate cannon** (weapon id 10);
> components **24** Pirate heavy hull (300 HP), **25** Pirate medium thruster, **26** Second-boss engine,
> **27** Second-boss thruster, **28** Second-boss hull (450 HP); the **`advanced_medium_pirate`** ship
> (maroon, reward 150) and the **Second Boss** `boss2` (crimson, reward 400, 2 cannons + 3 rockets); and
> the rebuilt **level-4 waves** (40/40/20 → 35/35/30, maxConcurrent 5, 8/16 kills → Second Boss). The
> +30% net turn/speed is approximated by bumping component power above the headline +30% (mass-scaled) —
> all **tunable**. Server tests (50) + visual `11-l4-enemies`. **Next:** L5 "Storm the pirate base".

> Extends `level-4-find-the-pirate-base.md` (L4 is implemented as a first pass) with its real **balance**:
> a new enemy, a new weapon, the **Second Boss**, and the L4 wave composition. English-only. Planning
> window — no code here. Builds on `mission-enemies-difficulty.md` (pirate gunner = enemy; Pirate machine
> gun = weapon id 9). **Assign ids as next-free + re-verify** — seed ids have drifted (e.g. an "Advanced
> thrusters" already took id 21; pirate hull/engine ended up 22/23).

## New weapon — Advanced pirate cannon (bullet)
- `power: 10`, `fireCooldown: 1.0` (one shot/sec), `maxRange: 110`, `projectileSpeed: 60`, `weight: ~10`
  (heavy — tune). New weapon id = next free.

## New enemy — Advanced medium pirate
- **Model:** reuse the `basic mini boss` model (`heavy.glb`), recolored **maroon/bordeaux** instead of
  purple (mini-boss is `0xb267e6`) — propose `0x800020` (tune). The ship is tinted by `color`, so this
  recolors it.
- **HP 300** → new hull component, `durability: 300` (mini-boss is 150).
- **Engine:** same as the mini-boss (Scout, id 6) — speed unchanged.
- **Turns ~30% faster than the basic mini boss.** Simplest: a thruster with **+30% power** vs the mini-
  boss's Medium thruster (0.63 → ~0.82). ⚠️ Its heavier hull adds mass (→ lower `massFactor`), so net
  derived turn will be a touch under +30% — bump the thruster power a bit more if you want exactly +30%
  net. (Check the existing "Advanced thrusters" id 21 — it may already fit.)
- **Weapons:** **1× Pirate machine gun (id 9)** + **2× rocket launchers** (enemy rocket, id 4). 3 mounts.
- **Reward:** TBD — propose **~150** (2× the mini-boss HP + extra guns). Confirm.
- `type: enemy`, `role: 'advanced_medium_pirate'`.

## Second Boss
- **Model:** reuse the first-boss model (`boss.glb`), **recolored** (first boss is orange `0xff8c2a`) —
  propose a deep crimson `0x8b0000` (tune).
- **Speed / acceleration / turn ~+30%** vs the first boss → +30% on the boss engine `power` + `maxSpeed`
  and the boss thruster `power` (new component variants, or scale). Same mass caveat as above — tune for
  the desired net.
- **Weapons:** **3× rocket launchers** (enemy rocket, id 4) + **2× Advanced pirate cannons** (new weapon
  above). 5 mounts.
- **HP: 450** → new hull component, `durability: 450` (first boss is 210).
- `type: enemy`, `role: 'boss'` (or `boss2`).

## L4 wave composition (replaces the L4 skeleton)
Pool = **pirate gunner / basic rocket (rocketeer) / advanced medium pirate**.
1. **wave-1** — **40 / 40 / 20**, **maxConcurrent: 5** (was lower), `advanceWhen: { kills: 8 }`.
2. **wave-2** — **35 / 35 / 30**, `advanceWhen: { kills: 16 }` (cumulative — "next 8").
3. **clear-out** — `spawn: null`, `advanceWhen: { allCleared: true }`.
4. **boss** — **1× Second Boss** (`total: 1`), `advanceWhen: { allCleared: true }`.
5. **victory** — `level.4.victory` (sets up L5; already written).

## Open / TBD (Kostya)
- **Reward** for the advanced medium pirate (~150?). *(HP resolved: advanced medium pirate 300, Second Boss 450.)*
- Exact **+30%** tuning (component-power +30% vs exact net +30% after mass) for the advanced medium
  pirate's turn and the Second Boss's speed/accel/turn.
- Recolor hexes (maroon `0x800020`, Second Boss crimson `0x8b0000`).

## Coordination
`catalog_seed.js`: new weapon (Advanced pirate cannon), new components (300-HP hull, faster thruster;
+30% boss engine/thruster), the `advanced_medium_pirate` ship, the **Second Boss** ship, and the updated
`level-4` wave phases. Re-seed is idempotent; **re-verify next-free ids**. Enemies/weapons render via the
existing tint + mount system. No migration.
