# Shield-hit ripple FX (variant B — shader bubble)

**Feature ID:** 2026-07-13-1844-shield-hit-ripple
**Status:** implemented + live-approved by the maintainer (built directly with live tuning, then run
through the pipeline's review/measure stages). This doc is the retroactive spec the reviewer checks against.

## Goal

Give the player shield a visual. The shield was mechanically complete (DECISIONS §66) but invisible except
for the HUD bar. Add a cosmetic **shield bubble** around the player ship that:
1. shows a faint idle rim while a shield is equipped and holding;
2. **flashes + ripples outward from the impact point** on every hit the shield absorbs (brighter/near-white
   on the hit that breaks the shield);
3. **flashes the whole sphere once** when the shield finishes recharging (broken → full).

Chosen approach = **variant B** (a `ShaderMaterial` sphere), over variant A (flat additive ring) and variant
C (bought flipbook sprite). Rationale recorded in **DECISIONS §68**.

## Hard constraints

- **Pure render / replay-safe.** The FX may read sim state but must **never write sim state** and must use
  **no seeded RNG** (`Math.random` is swapped to the sim PRNG during `update()`; consuming it would desync
  record/playback + the intro cutscene). All randomness-free; time comes from the render loop.
- **English-only**, matches surrounding code style/comment density (CLAUDE.md).
- **No new assets** — procedural shader, so **no `CREDITS.md` change** (verified).

## What was built (files + anchors)

- **`client/src/shield-fx.js`** (new) — the bubble. A `ShaderMaterial` sphere (radius 4, ~ SHIP_MODEL_LEN
  3.4) added to the combat `scene`, lazily created on first use.
  - `registerShieldImpact(worldPos, broke)` — records an impact into a 6-slot round-robin ring buffer
    (direction from ship center to the hit, start-time, broke flag). No RNG.
  - `spawnShieldReady()` — kicks the whole-sphere `uReady` flash (broken→full cue).
  - `updateShieldBubble(dtSec)` — per rendered frame: advance the shader clock, track the ship position, set
    the idle rim (`uBase` faint while `_shieldValue > 0`, 0 while broken), decay `uReady`.
  - Shader: vertex passes world normal + view dir + object-space direction; fragment sums a Fresnel rim
    (×`uBase`), per-impact **gaussian ripple ring** expanding from the impact and a localized **flash**, both
    multiplied by `reach = smoothstep(π/2, 0, d)` so they live only on the **near hemisphere** and fade to the
    mid-latitude; plus a `uReady` whole-sphere fill. Additive, `depthWrite:false`, `discard` on near-zero.
- **`client/src/components.js`** — `applyPlayerDamage(player, dmg)` **moved here** from `projectiles.js`
  (alongside `absorbDamage`/`shieldRecharge`; it's pure shield logic). Now **returns `{ absorbed, broke }`**
  — the FX trigger contract.
- **`client/src/projectiles.js`** — imports `applyPlayerDamage` from `components.js`; adds `spawnShieldHit(pos,
  broke)`, a thin wrapper → `registerShieldImpact`. Rocket blast site (`detonateRocket`) fires it when the hit
  was absorbed.
- **`client/src/sim.js`** — bullet-hit site fires `spawnShieldHit(b.mesh.position, broke)` when absorbed; the
  shield-recharge block detects the **broken → full** transition and calls `spawnShieldReady()`.
- **`client/src/main.js`** — imports + calls `updateShieldBubble(G.paused ? 0 : min(rawSec,0.05))` once per
  frame in `animate()` (before the render passes).

## Tests

`client/src/components.test.js` — **+5** cases for `applyPlayerDamage` covering the `{ absorbed, broke }`
contract + state mutation: partial absorb (no hull), exact break (timer reset, no spill), over-capacity
(spill to hull), no shield (full to hull), already-broken (full to hull). The shader/bubble module itself is
engine-coupled render code and is left to human visual verification (the maintainer live-approved all three
effects); the load-bearing *data* contract is what's unit-guarded.

Run: `cd client && node --test` (expect 174 pass). Syntax: `node --check` on the 4 changed `.js`.

## Docs updated

- `docs/CHANGELOG.md` — 2026-07-13 entry.
- `docs/SUMMARY.md` — Shield section (3 pure fns + `applyPlayerDamage` new home), new **Shield-hit FX**
  bullet, damage-routing paragraph, `Updated:` bumped.
- `docs/DECISIONS.md` — **§68** (why B over A/C).

## Out of scope / follow-ups

- Only the **base/starter shield**; higher shield tiers can get distinct looks later.
- No tier-gating of the bubble yet (one transparent sphere; cheap). If it shows on weak-phone `?dev`, gate on
  `G.gfx.particleScale` like the other bursts.
