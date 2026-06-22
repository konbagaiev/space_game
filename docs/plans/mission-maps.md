# Mission maps & set-pieces — brief (Vega Sentinels)

> **Progress:** **All phases done (2026-06-22).** The data-driven set-piece system (`setpieces` array →
> `buildSetPiece` → per-type builder; combat-scene decor, ~500 below the plane, not collidable; render-loop
> `update(dt)` hook) plus all three builders — **research-station**, **asteroid-field** (irregular/cratered
> rocks + mining station + particle mining beam) and **freighter** (fiery exhaust) — are implemented and
> seeded into `home-system`. The **drifting-arena** mechanic is wired (movable `arenaCenter`; descriptor
> `drift`; the soft boundary/warp/mini-map are relative to it; a `sync` set-piece follows), ready for a
> future escort mission (no campaign map drifts yet). See DECISIONS §17, CHANGELOG 2026-06-22, visual
> `09-mission-setpieces`. **Remaining (future):** per-mission location anchoring + wiring drift to an actual
> level/mission (mission-generator), and collidable cover (scope B).

> **One giant world map** based on the current `home-system`: the planet stays; set-pieces sit at
> different points around it, and **missions happen at different locations within this one map** (the
> combat zone is positioned — or slowly drifts — past the relevant set-piece). Set-pieces are
> **procedurally generated in code** for now (like the planet/moons/primitive ships), **not** sourced
> `.glb`. English-only. Planning window — no code here; this specs the procedural generation for the
> work session.

## Concept: one map, many locations
- Keep a single scene; **enlarge the world** and place set-pieces around the planet.
- Each mission anchors the **combat zone** (the ±240 arena) at a point in the world, with the relevant
  set-piece visible as a **backdrop ~500 m "below" the combat plane** — decorative, enemies ignore it
  (they react to the player only).
- Per-mission framing, e.g. **research-station mission:** arena to the **right of the planet** at
  distance, the **station ~500 m below**, the **planet visible at the left edge** of the zone.

## Set-pieces (procedural — generate in code for now)
1. **Research station** (large) — right of the planet, at distance; combat on its backdrop, ~500 m below.
   - *Procedural recipe (starting point):* a central cylinder/hub + a ring or torus, solar-panel planes,
     a few docking arms/modules; metallic material + emissive windows. Big and readable from the arena.
2. **Asteroid field + mining station** (below the planet) — **real irregular asteroids**, NOT the round
   parallax ones we use for motion reference: non-spherical geometry (noise-deformed mesh), **cratered
   textures** (reuse the `makeMoonTexture` crater approach), **varied sizes**. Plus a **small mining
   station** working an asteroid, shown as a **beam / stream of microparticles** from the asteroid to the
   station (reuse the existing particle system).
3. **Transport / freighter** (large, with a **fiery exhaust trail**) — for "save the transport". Moves
   slowly **below the battlefield**, in sync with a **slowly drifting combat zone** that pans past the
   station and planet. Enemies react to the player only, not the transport.

## Mission ↔ location
- **Research-station side mission:** static arena right of the planet; station below.
- **Mining side mission:** arena near the asteroid field below the planet; mining station + beam in view.
- **Freighter-distress side mission:** **drifting** arena panning past station/planet; transport below, in sync.
- **Story L4/L5:** reuse points of this map (or a far "new sector" anchor) — TBD.

## Technical decisions (RESOLVED — implement autonomously)
- **Render layer → the combat `scene`, lit by the combat light (from above), same as the ships.** The
  mission set-pieces are the *local battle environment* — the things we fight around — so we must see them
  **the same way as the fight**: in the combat scene, lit from above by the combat sun. (Contrast,
  DECISIONS §5: the **planet & moons** stay in `skyScene`, lit by a distant sun with a day/night
  terminator; **stars** are unlit. Those are the far cosmic backdrop; the set-pieces are the near
  environment.)
- **Decoration ≠ collidable — the key point.** Being in the combat `scene` does NOT make a mesh a target:
  hit/collision and AI iterate the **gameplay entity arrays** (enemies / bullets / rockets / player), not
  "everything in the scene". Add set-pieces as plain visual meshes **not registered in those arrays** →
  bullets pass through, AI ignores them, no collision. (Scope B later: to make an element collidable —
  asteroid cover, destructible base — register THAT element in the relevant gameplay array.)
- **Placement/depth:** set-pieces sit ~500 m **below the combat plane** in the same scene/camera, so they
  render below/behind the ships by real depth — no compositing trick needed.
- **Drifting arena ↔ boundaries (transport mission).** The arena's **center drifts**; the soft boundary +
  30 s warp-back + mini-map compute **relative to the current (moving) arena center**, not world (0,0).
  The transport is a decor mesh **in the combat scene, synced with the arena**; the rest of the
  environment scrolls past. Enemies stay arena-local and ignore the transport.
- **Procedural, not sourced.** Set-pieces are **code-generated** (no CDN/`.glb`, no license) for now; swap
  to real `.glb` via the CDN (DECISIONS §14) later.
- **Asteroids = decor meshes in the combat `scene`, not obstacles** for now (real irregular/cratered,
  distinct from the round parallax backdrop asteroids). Collidable cover = later (register them as
  gameplay entities; DECISIONS §4 "solid asteroids", scope B).

## Phasing
- 2a side missions can still run on plain `home-system` — set-pieces are polish, **not a 2a blocker**.
- Build the world + set-pieces as missions need them: **research station first** (static, simplest),
  then asteroid field + mining beam, then the drifting transport (most involved).

## Coordination
`catalog_seed.js` (MAPS / world layout + per-mission location anchor), `buildMap` + new procedural
builders (station / asteroids / mining beam / transport) in `client/index.html`, the render-pass choice,
and the arena-boundaries interaction for the drifting mission.
