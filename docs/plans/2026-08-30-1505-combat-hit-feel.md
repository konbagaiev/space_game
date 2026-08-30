# Combat hit feel, first pass — the target reacts

**Status:** ready to build · **Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-08-30-1505-combat-hit-feel`

## Goal

Right now a hit is announced entirely by the *shooter's* side of the exchange — a muzzle flash, a bolt, a
little flipbook spark where the bullet died. **Nothing on the ship you shot changes.** Combat reads limp
because the target never acknowledges being hit. This change gives the hit a receiver:

1. **A hull flash on the target** whenever a projectile's damage reaches its hull — enemies, the wingman
   and the player's own ship alike. This is the readability win.
2. **A short model punch** on the target from **rockets and the heavy cannon only** — never from plain
   bullets.
3. **A light camera shudder** when a **rocket** damages the **player's hull** (shield down, or broken
   through in the same tick).
4. **Tracers that vary** in length and brightness instead of every bolt being a clone of the last.
5. **A `?dev` tuning panel** for every number above, because none of these magnitudes can be guessed — the
   maintainer tunes them in flight and the tuned values become the shipped defaults.

**Everything here is RENDER-ONLY.** The simulation is a fixed `TICK_HZ = 60` step and the shipped Level-0
intro is an input replay; not one byte of ship state, RNG draw or timing may move. See
[§ Replay / intro impact](#replay--intro-impact), which is a hard gate on this change.

---

## Decisions (settled — do not re-ask)

| # | Decision |
|---|---|
| D1 | **Flash trigger: hull damage from PROJECTILES only.** Bullets and rockets. **Beams are excluded** — the Charged beam (`client/src/sim-core/beam.js`) and the pirate lancer keep their current look, untouched. Do not wire `beam.js` into any of this. |
| D2 | **The predicate is `toHull > 0`, NOT `absorbed === false`.** `applyShieldedDamage` returns `absorbed: true` even when the shield **broke and spilled the excess to the hull in the same tick**. A Heavy rocket (power 80) into the player's Base shield (capacity 20) returns `{ absorbed: true, broke: true, toHull: 60 }` — the single biggest hit in the game. A naive `if (!absorbed)` would silently skip it. `applyShieldedDamage` does not currently return `toHull`; step 1 threads it out. **ONE predicate drives BOTH the flash and the shudder** — do not build two. |
| D3 | **Shield-absorbed hits with `toHull === 0` get nothing new — and there is NO shield-flash slider.** The existing cyan bubble ripple (`spawnShieldHit` / `spawnEnemyShieldHit`) stays the whole acknowledgement. An earlier draft carried a `flash.shieldIntensity` knob at 0; it is **deleted**, because `hullHit` is emitted only when `toHull > 0`, so the knob could never do anything without inventing a second trigger off `shieldHit`/`enemyShieldHit` — which is not in the feature request, and which the player's own `shieldHit` could not even serve (it carries no entity ref, so the renderer cannot resolve the victim). Dead UI is worse than no UI (DECISIONS §30). |
| D4 | **All ships flash:** enemies, allies (the wingman) and the player's own ship. One code path. |
| D5 | **The punch has TWO independent channels — a directional shove AND a scale pop — both defaulting to `0`.** The maintainer's live concern was that a shove could read as unnatural jitter, so both ship and the live build picks the winner; whichever is tuned up becomes the committed default. **No rotation/yaw kick** — it would fight the cosmetic wing-bank that already lives on the neighbouring child group. |
| D6 | **Three punch rules are HARD REQUIREMENTS, not tunables** (they are the difference between "impact" and "jitter" — per-shot camera recoil was cut from scope for exactly this failure mode): (a) **instant displacement out, smooth ease back** — easing out *and* back reads as jelly; (b) **refresh, never accumulate** — a new hit *resets* the impulse, it never sums with one in flight; (c) **a cooldown**, so a multi-warhead salvo (the Triple spiral rocket detonates three real warheads) cannot stack into a vibration. |
| D7 | **Camera shudder: on during the Level-0 intro too.** It is render-only and cannot move the replay. The recorded pilot will now shake when a rocket gets through — that is accepted and expected. |
| D8 | **Panel: no persistence.** Exactly like `buildExhaustPanel` — throwaway values for the page load + `Copy JSON`, pasted back into the new `client/src/hit-fx-config.js` (mirroring `client/src/exhaust-config.js`). |
| D9 | **Tracers: per-class base AND per-shot jitter.** Each weapon class gets its own base length + brightness as sliders (spread further apart than today's `BOLT_SCALE`), plus a `Math.random()` jitter on top, applied to **all** bolts including enemy fire. Setting the jitter sliders to `0` (and the class bases back to 1.0 / 1.7) must reproduce today's uniform look exactly. |
| D10 | **The punch lives on the ship's cosmetic child group**, never on `ship.pos` / `ship.heading` / `ship.scale`. There is an exact precedent: the wing bank already rides that child and "never affected hits" (`client/src/sim-core/collision.js:9`). `ship.scale` in particular feeds both the hitboxes and the muzzle offset (`client/src/sim-core/ship-entity.js:81`). |
| D11 | **Per-instance material clone.** Catalog ships load with `tint: false` and `clone(true)` **shares materials across every instance of a ship type** (`client/src/ship-factory.js:35-45`, `attachShipBody` in `client/src/ship-build.js:82`). A naive emissive flash would flash *every ship of that type at once*. Materials are cloned per instance; geometry + textures stay shared. **This deliberately flips one assertion in `client/visual/scenarios/26-ship-model-cache.mjs` (step 5b) and falsifies three lines of settled prose (see Docs to update)** — DECISIONS §79 already anticipated it: *"anything new that wants a per-ship visual state (a damage flash…) must clone the material for that instance too"*. |
| D12 | **All randomness is plain `Math.random()`, never `simRandom()`.** The seeded stream is opt-in per draw (DECISIONS §73) precisely because cosmetic draws desynced the intro trace three times. Nothing in this change may consume it. |
| D13 | **No `dt` scaling of magnitudes anywhere.** Impulses age by `dt`; their amplitudes are constants. |

### Expected in-game behaviour — do NOT "fix" this later

Verified against the shipped balance: the player's **Base shield** is `capacity 20, rechargeSec 10`; the
`Rocket pirate` weapon is `power 20, fireCooldown 4`. So a pirate rocket into a **full** shield breaks it
with **exactly 0 spilling to the hull** — **no shudder on that hit, and that is correct**. The shield then
stays down for 10 s while rockets keep arriving every 4 s, so the *next* rocket shudders. First rocket
strips the shield, second one hits you. That escalation is intended and reads well; the silent first hit
is not a bug.

---

## How it hangs together

```
sim-core                                     render (client)
────────                                     ───────────────
applyShieldedDamage → { absorbed, broke, toHull }
        │
        ├─ step-projectiles.js (bullet → enemy / player / ally)
        └─ spawn.js detonateRocket (blast → enemy / player / ally)
                │  toHull > 0 ?
                └──► world.events.emit({ type: 'hullHit', ship, target, pos,
                                         dirHeading, weaponClass, toHull })
                                                 │
                                    sim.js applySimEvent ──► hit-fx.js
                                                              ├ hullFlash(ship)          (every hullHit)
                                                              ├ punch(ship, dirHeading)  (rocket | cannon)
                                                              └ cameraShudder()          (rocket + target==='player')
```

`hullHit` is a **new** event type. It is the only sim-side addition, and it carries no new state: it is a
description of something that already happened, emitted from the sites that already call
`applyShieldedDamage`.

**Rocket splash hits several ships from one detonation** (`spawn.js` enemy / player / ally loops). Flash
and punch are **per victim** — one `hullHit` each. The camera shudder fires **once per detonation**, which
falls out for free: only the **player's** `hullHit` triggers it, and `detonateRocket` applies damage to the
player at most once per blast. The shudder's own cooldown is the second belt.

---

## Steps

### 1. `applyShieldedDamage` returns `toHull` — `client/src/sim-core/components.js:123`

Add the field, change nothing else. No ship state moves, no RNG is drawn, so this is replay-safe.

```js
export function applyShieldedDamage(ship, dmg) {
  if (ship.shield && ship._shieldValue > 0) {
    const r = absorbDamage(ship._shieldValue, dmg);
    ship._shieldValue = r.shieldValue;
    if (r.broke) ship._shieldRechargeAccum = 0;
    if (r.toHull > 0) ship.hp -= r.toHull;
    return { absorbed: true, broke: r.broke, toHull: r.toHull };  // toHull > 0 on a break-with-spill
  }
  ship.hp -= dmg;
  return { absorbed: false, broke: false, toHull: dmg };
}
```

Update the doc comment above it (lines ~113-122): the returned contract is now
`{ absorbed, broke, toHull }`, and spell out that **`absorbed: true` does not mean nothing reached the
hull** — that is the whole reason `toHull` exists.

Also update the same contract description in `client/src/sim-core/collision.js`'s
`resolveHostileBulletHit` header comment (~line 200: "the `{ absorbed, broke }` contract").

> ⚠️ **This breaks six existing assertions** in `client/src/sim-core/components.test.js` — they use
> `assert.deepEqual(applyShieldedDamage(...), { absorbed, broke })`. See step 10.

### 2. The `hullHit` event — `client/src/sim-core/events.js`

**2a.** Add a line to the event catalogue comment block (keep the exact `//   { type: '…'` shape — the
guard test in `server/src/netsim/room.test.js:122` parses these lines with
`/^\/\/\s+\{\s*type:\s*'([a-zA-Z]+)'/gm`). Put it directly after the `bulletImpact` line:

```js
//   { type: 'hullHit',  ship, target, pos, dirHeading, weaponClass, toHull }   a PROJECTILE's damage
//                                                                       reached this ship's HULL. Emitted
//                                                                       only when toHull > 0 (a shield that
//                                                                       broke and spilled counts); beams
//                                                                       deliberately do not emit it.
//                                                                       `ship` is an entity ref (the victim);
//                                                                       `dirHeading` is the world yaw the
//                                                                       impact pushes toward.
```

**2b.** Register the entity ref in `EVENT_ENTITY_REFS` (~line 66), next to `enemyShieldHit`:

```js
  hullHit: ['ship'],   // the VICTIM — the renderer flashes/punches THAT hull, so it needs its identity
```

**2c.** Add an emit helper at the bottom of the file, beside the banner helpers, so the six call sites do
not each retype the payload:

```js
// A projectile reached a ship's HULL. `pos` must already be a copy (events carry values, never live refs);
// `dirHeading` is a world yaw (radians, `atan2(x, z)` like everything else here), so the payload stays
// plain numbers and needs no vector serialization on the wire.
export function emitHullHit(world, ship, target, pos, dirHeading, weaponClass, toHull) {
  world.events.emit({ type: 'hullHit', ship, target, pos, dirHeading, weaponClass, toHull });
}
```

**2d.** Wire it for the network — `server/src/netsim/protocol.js`, `EVENT_FIELDS` (line 45+), after
`bulletImpact` (line 46):

```js
  hullHit:          ['target', 'dirHeading', 'weaponClass', 'toHull', 'pos'],
```

`pos` is already in `VEC_FIELDS` (line 100) and the `ship` ref is handled generically by `wireEvent`'s
second loop (line 113) off `EVENT_ENTITY_REFS`, and mirrored back by `hydrateEvent`
(`client/src/netsim-world.js:313`). **No code change is needed in either function** — this is exactly what
DECISIONS §136's one-table design bought. Note for the implementer: in a netsim room the *local player* has
no network id (`idOf` returns null for him), so `ev.ship` arrives `undefined` for a hit on your own ship
there and the flash simply does not draw; `target === 'player'` still crosses, so the shudder still works.
`?netsim` is a dev sandbox — this asymmetry is acceptable and must not grow a workaround.

### 3. Emit `hullHit` at the six damage sites

Add `import { emitHullHit } from './events.js';` to **both** `client/src/sim-core/step-projectiles.js`
(after line 22) and `client/src/sim-core/spawn.js` (after line 17). `events.js` imports nothing, so there
is no cycle.

**3a. `client/src/sim-core/step-projectiles.js:47`** — a player/ally bullet reaching an enemy:

```js
const dr = applyShieldedDamage(e, b.damage);
if (dr.absorbed) { absorbed = true; world.events.emit({ type: 'enemyShieldHit', … }); }
if (dr.toHull > 0) emitHullHit(world, e, 'enemy', b.pos.clone(), Math.atan2(b.vel.x, b.vel.z), b.class, dr.toHull);
hit = true; world.events.emit({ type: 'hit', target: 'enemy' }); break;
```

**3b.** Hostile bullet → **player** (same file, inside `if (res.hit) { … } else {` branch, right after the
`shieldHit` emit): `res.damageResult.toHull > 0` →
`emitHullHit(world, world.player, 'player', b.pos.clone(), Math.atan2(b.vel.x, b.vel.z), b.class, res.damageResult.toHull)`.

**3c.** Hostile bullet → **ally** (same file, the `world.allies` loop): identical with `a` / `'ally'` /
`ra.damageResult`.

> The shield-interception rule already moved `b.pos` onto the bubble sphere before these lines
> (`if (res.impact) b.pos.copy(res.impact)`), so on a break-with-spill the reported `pos` is on the bubble
> rather than the hull. That is fine: the flash is a whole-hull effect and the punch uses only `dirHeading`.

**3d. `client/src/sim-core/spawn.js`, `detonateRocket` (lines 160-192)** — three call sites (enemy 167,
player 173, ally 183). A blast pushes its victims **away from the blast centre**, so derive the heading
from the blast to the ship, falling back to the rocket's own heading when they coincide. Add a tiny local
helper above `detonateRocket` rather than repeating it three times:

```js
// Which way a blast shoves its victim: from the detonation point toward the ship. Degenerate (the ship is
// exactly on the blast point) falls back to the rocket's flight heading. Pure math — no state, no RNG.
function blastHeading(r, ship) {
  const dx = ship.pos.x - r.pos.x, dz = ship.pos.z - r.pos.z;
  return (dx * dx + dz * dz) > 1e-6 ? Math.atan2(dx, dz) : (r.heading || 0);
}
```

and at each site, after the existing `enemyShieldHit` / `shieldHit` emit:

```js
if (dr.toHull > 0) emitHullHit(world, e, 'enemy', r.pos.clone(), blastHeading(r, e), r.weaponClass, dr.toHull);
```

(`'player'` with `world.player`, `'ally'` with `a`, same shape.) `r.weaponClass` is the field the existing
`detonate` event already carries, so the punch gate sees `'rocket'`.

**3e. Do NOT touch `client/src/sim-core/beam.js`** (D1). Leave line 239 exactly as it is.

### 4. New tunables module — `client/src/hit-fx-config.js`

THREE-free, so `node --test` can import it (the client has no `three` install for node — pure modules are
the only testable surface). Mirrors `client/src/exhaust-config.js`.

```js
// Tunables + pure seams for the hit-feel FX (hit-fx.js). Every number here is a PLACEHOLDER: they are
// tuned live in the ?dev "Hit feel" panel and pasted back over this object (Copy JSON). THREE-free so the
// impulse/predicate/tracer invariants are unit-testable under `node --test`.
//
// REPLAY SAFETY: the only randomness is an INJECTED `rand` (Math.random in the browser). This never
// touches the seeded gameplay stream — DECISIONS §73 is opt-in per draw and cosmetics stay out of it.
export const HIT_FX = {
  // Hull flash: an emissive wash on the victim's own (per-instance) materials.
  flash: { color: 0xffffff, intensity: 1.6, dur: 0.12 },
  // Model punch — TWO independent channels, both OFF by default (D5): pick the natural one in flight.
  // `shove` is in GROUP-LOCAL units (the ship group's ~1.8x world scale multiplies it, so bigger ships
  // shove further in world terms — intended). `pop` is a fraction of scale.
  punch: { shove: 0, pop: 0, dur: 0.12, cooldown: 0.15 },
  // Camera shudder — world units of screen-plane translation. ON by default; amplitude is a guess.
  shake: { amp: 1.2, dur: 0.18, cooldown: 0.25 },
  // Tracers. `*Len` multiplies BOLT_LEN (1.0 / 1.7 == today's BOLT_SCALE); `*Bright` multiplies the bolt's
  // additive tint. Jitter is a symmetric per-shot fraction; 0 reproduces the uniform look exactly.
  tracer: { kineticLen: 1.0, kineticBright: 1.0, cannonLen: 1.9, cannonBright: 1.35, jitterLen: 0.25, jitterBright: 0.2 },
};
```

Pure seams in the same file:

```js
// THE impulse profile (D6a): INSTANT out, smooth ease back. value(0) = 1 — the displacement is there at
// once, with NO ramp-in — then decays to 0 with a vanishing slope so the model SETTLES instead of wobbling.
// (In practice the first DRAWN frame reads (1 - dt/dur)^2 ≈ 0.84 at dur 0.12, because updateHitFx ages
// before it writes. That is the intended "already out" read; it is not a ramp.)
export function impulse01(t) { if (t <= 0) return 1; if (t >= 1) return 0; const u = 1 - t; return u * u; }

export const makeImpulse = () => ({ age: 0, dur: 0, cool: 0, active: false });

// REFRESH, NEVER ACCUMULATE (D6b) + the salvo cooldown (D6c). A hit inside the cooldown is DROPPED; a hit
// after it RESETS the impulse to full — it is never summed with one still in flight, so a burst can never
// compound into a vibration. Returns whether the hit was taken.
export function refreshImpulse(st, dur, cooldown) {
  if (st.cool > 0) return false;
  st.age = 0; st.dur = dur; st.cool = cooldown; st.active = true;
  return true;
}

// Age one impulse by dt and return its current 0..1 value (0 = finished/idle).
export function ageImpulse(st, dt) {
  if (st.cool > 0) st.cool = Math.max(0, st.cool - dt);
  if (!st.active) return 0;
  st.age += dt;
  const v = impulse01(st.dur > 0 ? st.age / st.dur : 1);
  if (v <= 0) { st.active = false; return 0; }
  return v;
}

// THE predicate (D2): did this hit reach the HULL? `absorbed` is NOT the question — a shield that broke
// spills the excess to the hull in the same tick. One predicate for the flash AND the shudder.
export const reachedHull = (dmg) => !!dmg && dmg.toHull > 0;

// One shot's tracer look. `rand` is injected so it is testable and can never reach simRandom.
export function tracerLook(weaponClass, cfg = HIT_FX.tracer, rand = Math.random) {
  const base = weaponClass === 'cannon'
    ? { len: cfg.cannonLen, bright: cfg.cannonBright }
    : { len: cfg.kineticLen, bright: cfg.kineticBright };
  const j = (amt) => 1 + (rand() * 2 - 1) * amt;   // amt 0 → exactly 1
  return { len: base.len * j(cfg.jitterLen), bright: base.bright * j(cfg.jitterBright) };
}
```

### 5. Per-instance materials for the flash — `client/src/ship-factory.js`

Catalog ships pass `tint: false`, so none of the existing traverses run for them and their materials come
straight from the shared cache (D11). Add an **always-on** per-instance clone at the end of
`applyShipModel`'s callback, immediately **before** `host.add(pivot)` (line 186), and record the baked
values the flash has to restore:

```js
    // PER-INSTANCE MATERIALS (docs/plans/2026-08-30-1505-combat-hit-feel.md). `clone(true)` shares
    // materials with the cached template, so setting `emissive` on one enemy would flash EVERY enemy of
    // that type. Cloning here keeps geometry + textures shared (no re-upload, no shader recompile — a
    // clone has identical parameters, so THREE reuses the same compiled program) and gives each hull its
    // own uniform set. `flashMats` is the list hit-fx.js writes to, with the baked values it restores.
    // NOTHING DISPOSES THESE. `detachEnemyBody` frees only the ship's exhaust plume (DECISIONS §79), so the
    // clones are simply garbage-collected with the mesh. Do NOT add a dispose pass here: a compiled program
    // dies with its last material, and freeing it would recompile on the next spawn — the §83 freeze.
    const flashMats = [];
    model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m && m.emissive) flashMats.push({ mat: m, emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
      }
    });
    group.userData.flashMats = flashMats;
```

Also register the **primitive placeholder** in `makeShip` (line 190+): its `MeshStandardMaterial` is
already created fresh per ship, so it only needs recording. After `bank.add(glow)` (~line 210) add:

```js
  g.userData.flashMats = [{ mat, emissive: mat.emissive.clone(), intensity: mat.emissiveIntensity }];
```

(`applyShipModel` overwrites `flashMats` when the model lands, which is correct — the placeholder's meshes
are disposed in the same block.)

Update the stale claim in the cache comment at `client/src/ship-factory.js:35-45` ("clone(true) shares
geometry AND materials … nothing mutates a live ship's materials"): materials are now cloned per instance
for every modelled ship, and the hit flash mutates them. Geometry and textures are still one GPU copy per
type — say that.

> ⚠️ **This deterministically breaks an existing guard.** `client/visual/scenarios/26-ship-model-cache.mjs:52`
> asserts `assert.ok(r.sameTypeMat, 'two ships of the same type share their materials (one GPU copy per
> type)')` — it collects `x.material.uuid` per mesh and requires two same-type enemies to match. Per-instance
> clones make that false **by design**. See step 5b; it is not optional and it is not a regression.

**Known limitation, state it in the code comment:** where a material carries an `emissiveMap`, three.js
multiplies emissive by that map, so those materials glow only where the map is non-black. Measured on the
shipped glbs: `enemy_1_combat`, `enemy_2_combat` — 0 of their materials have one; `player_combat.9188c820`
— 2 of 15. So the flash reaches the overwhelming majority of every hull. **Do not** null the `emissiveMap`
to "fix" this: changing a map slot forces a shader recompile, which is the mid-fight freeze DECISIONS §83
exists to prevent. If the player ship reads weak in play, raise `flash.intensity` in the panel.

### 5b. Invert the material half of `26-ship-model-cache.mjs` (REQUIRED — it fails otherwise)

The scenario's **load-bearing** assertion is geometry identity, and that is unchanged: two same-type enemies
must still share the very same `BufferGeometry` instances. Only the material half flips.

- Line 52 — replace:
  ```js
  assert.ok(r.sameTypeMat, 'two ships of the same type share their materials (one GPU copy per type)');
  ```
  with:
  ```js
  // Materials are cloned PER INSTANCE since the hit flash (docs/plans/2026-08-30-1505-combat-hit-feel.md):
  // a shared material would flash every ship of the type at once. Geometry + textures stay one GPU copy per
  // type — the clone shares them — so the cache's whole point is intact. DECISIONS §79 anticipated this
  // exactly ("anything new that wants a per-ship visual state must clone the material for that instance").
  assert.ok(!r.sameTypeMat, 'two ships of the same type get their OWN materials (per-instance clone for the hit flash)');
  ```
- Update the scenario's header comment (lines 1-7): keep "the load-bearing assertion is GEOMETRY IDENTITY",
  and add that materials are deliberately **not** shared any more.
- Leave `sameTypeGeo`, `distinctObjects`, `otherTypeGeo` and the `parsed` bound untouched — the clone shares
  geometry, so a per-spawn re-parse still fails the scenario, which is the regression it exists to catch.

### 6. The FX module — `client/src/hit-fx.js` (new)

Imports: `three`, `{ camera }` from `./engine.js`, `{ G, enemies, allies }` from `./state.js`,
and everything from `./hit-fx-config.js`. It must **not** import `sim.js` or `ship-factory.js` (cycle).

Public surface:

- **`hullFlash(ship)`** — start/refresh the flash on `ship.mesh.userData.flashMats`. State lives on
  `ship.mesh.userData.hitFlash` (a `makeImpulse()`), so it dies with the mesh; no registry to leak.
- **`punchShip(ship, dirHeading)`** — refresh the punch impulse on `ship.mesh.userData.hitPunch`, storing
  `dirHeading`. Gated by `refreshImpulse` (drops a hit inside the cooldown → a spiral volley's three
  warheads punch once).
- **`cameraShudder()`** — refresh the module-level shake impulse and pick a **fresh random screen-plane
  angle** with `Math.random()` (D12: never `simRandom`).
- **`updateHitFx(dt)`** — ages everything and writes the scene graph. Iterate `G.player`, `enemies`,
  `allies` (bounded, tiny); no separate registry.
- **`applyCameraShake(camera)`** — adds the current offset to `camera.position`.
- **`resetHitFx()`** — clear the shake and restore any live flash/punch (called from `reset()`).
- **`buildHitFxPanel(GUI)`** — the `?dev` panel (step 9).

Writing the flash (per ship, per frame):

```js
const v = ageImpulse(st, dt);
const mats = ship.mesh.userData.flashMats || [];
if (v > 0) { for (const f of mats) { f.mat.emissive.setHex(HIT_FX.flash.color); f.mat.emissiveIntensity = HIT_FX.flash.intensity * v; } st.dirty = true; }
else if (st.dirty) { for (const f of mats) { f.mat.emissive.copy(f.emissive); f.mat.emissiveIntensity = f.intensity; } st.dirty = false; }
```

Writing the punch — **on the cosmetic child group, never on the parent** (D10). `syncShipMesh`
(`client/src/sim.js:222`) overwrites the parent group's position/rotation/scale every tick;
`updateBank` (`sim.js:196`) writes only `bank.rotation.z`, so `bank.position` and `bank.scale` are free:

```js
const bank = ship.mesh.userData.bankGroup; if (!bank) return;
const v = ageImpulse(st, dt);
if (v > 0) {
  // The shove is a WORLD direction; `bank` inherits the parent group's rotation.y = ship.heading, so
  // rotate it into the group's local frame. Recomputed each frame, so a ship that turns mid-punch keeps
  // being shoved the way the shot was travelling.
  const a = st.dirHeading - ship.heading;
  bank.position.set(Math.sin(a) * HIT_FX.punch.shove * v, 0, Math.cos(a) * HIT_FX.punch.shove * v);
  bank.scale.setScalar(1 + HIT_FX.punch.pop * v);
  st.dirty = true;
} else if (st.dirty) { bank.position.set(0, 0, 0); bank.scale.setScalar(1); st.dirty = false; }
```

Note for the implementer: the engine plume is scene-parented and tracked from the **parent** group
(`syncShipPlume` in `client/src/exhaust-fx.js`), so it does not follow the punch. Over a ~0.12 s impulse
that is invisible; leave it.

The camera shake:

```js
const _right = new THREE.Vector3(), _up = new THREE.Vector3();
export function applyCameraShake(cam) {
  if (shakeV <= 0) return;
  const amp = HIT_FX.shake.amp * shakeV;
  // The camera is near-top-down (CAM_OFFSET 0,110,26), so world +Y is almost straight at the lens: an
  // offset along it would read as "closer", not as a shake. Offset along the CAMERA's own screen basis.
  _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
  _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
  cam.position.addScaledVector(_right, Math.cos(shakeAngle) * amp)
              .addScaledVector(_up,    Math.sin(shakeAngle) * amp);
}
```

`shakeV` is produced by `updateHitFx` (`ageImpulse`), `shakeAngle` is drawn once per shudder in
`cameraShudder()`.

### 7. Wire the render side — `client/src/sim.js`

**7a.** Import (beside the other FX imports, lines 25-28):

```js
import { hullFlash, punchShip, cameraShudder, updateHitFx, applyCameraShake, resetHitFx } from './hit-fx.js';
```

**7b.** Handle the event in `applySimEvent` (line 271+), right after the `bulletImpact` case (line 278):

```js
    // THE TARGET REACTS. One event, three consequences, all render-only (docs/plans/2026-08-30-1505-combat-hit-feel.md):
    // every hull hit flashes; rockets + the heavy cannon also punch the model; a ROCKET into the PLAYER's
    // hull also shudders the camera. `ev.ship` is undefined for the local player in a netsim room (he has
    // no network id) — the flash then simply does not draw, which is fine for a dev sandbox.
    case 'hullHit': {
      if (ev.ship && ev.ship.mesh) {
        hullFlash(ev.ship);
        if (ev.weaponClass === 'rocket' || ev.weaponClass === 'cannon') punchShip(ev.ship, ev.dirHeading);
      }
      if (ev.weaponClass === 'rocket' && ev.target === 'player') cameraShudder();
      break;
    }
```

**7c.** Age it in `renderTick` (line 527) — **after** `simEvents.drain` (line 530), so a hit taken this
tick displaces on this frame, and **before** `settleView` (line 551), so the shake value the camera reads
is current. Put it beside `updateShipExhaust(dt)`:

```js
  updateHitFx(dt);                // hull flash + model punch + the camera-shudder impulse (render-only)
```

**7d.** Apply the shake in `settleView` (line 652). It must go **after** `camera.lookAt(...)` so the
orientation is computed unshaken and the shudder is a pure screen-plane translation (shaking the
orientation would swing the whole world and read as nausea), and **before** the
`G.stars.position.copy(camera.position)` line so the star dome rides along instead of jittering:

```js
  camera.lookAt(G.player.pos.x, G.player.pos.y, G.player.pos.z);
  applyCameraShake(camera);       // render-only shudder; AFTER lookAt = pure translation, no view swing
  G.stars.position.copy(camera.position);
```

**7e.** Clear on reset — in `reset()` (line 705), beside `hideBeamFx()` (line 721):

```js
  resetHitFx();              // no flash/punch/shudder may survive into the next run
```

### 8. Tracers — `client/src/bolt-fx.js` + `client/src/projectiles.js`

**8a.** `makeBolt` (`bolt-fx.js:56`) takes an optional per-shot look. `len` **replaces** the class scale on
the travel axis (it must not multiply it, or a cannon bolt becomes `1.7 × 1.9` long); width keeps riding
`scale`, so a cannon slug stays as chunky as it is today:

```js
export function makeBolt(color, vel, scale = 1, look = null) {
  const lenMul = look && look.len != null ? look.len : scale;   // no look → exactly today's behaviour
  const bright = look && look.bright != null ? look.bright : 1;
  const mat = new THREE.MeshBasicMaterial({ … });
  if (bright !== 1) mat.color.multiplyScalar(bright);           // additive blend: a linear brightness scale
  …
  m.scale.set(BOLT_LEN * lenMul, BOLT_WID * scale, 1);          // was BOLT_LEN * scale
```

**8b.** `attachBulletBody` (`projectiles.js:49`):

```js
const look = tracerLook(b.class);   // Math.random per shot — RENDER-ONLY, never simRandom (DECISIONS §73)
m = makeBolt(b.projectileColor, b.vel, boltScale, look);
spawnMuzzleFlash(b.pos, b.projectileColor, boltScale);   // unchanged — the flash keeps the class heft
```

Import `tracerLook` from `./hit-fx-config.js`. Leave `BOLT_SCALE` (line 41) alone: it still drives bolt
width and the muzzle flash. Update its comment to say length now comes from `HIT_FX.tracer`.

### 9. The `?dev` panel — `buildHitFxPanel(GUI)` in `client/src/hit-fx.js`

Model it on `buildExhaustPanel` (`client/src/exhaust-fx.js:359`). The panel mutates the exported `HIT_FX`
object **in place** — every consumer reads it live at hit/spawn time, so there is no apply step (this is
the one deliberate difference from the exhaust panel's `EXHAUST_TUNE` clone; say so in a comment).

```js
export function buildHitFxPanel(GUI) {
  const gui = new GUI({ title: 'Hit feel (?dev)' });

  const fl = gui.addFolder('Hull flash');
  fl.addColor({ get color() { return HIT_FX.flash.color; }, set color(v) { HIT_FX.flash.color = v; } }, 'color').name('Color');
  fl.add(HIT_FX.flash, 'intensity', 0, 6, 0.05).name('Intensity');
  fl.add(HIT_FX.flash, 'dur', 0.02, 0.6, 0.01).name('Duration (s)');

  const pu = gui.addFolder('Model punch (rocket + cannon)');
  pu.add(HIT_FX.punch, 'shove', 0, 0.8, 0.005).name('Shove (group units)');
  pu.add(HIT_FX.punch, 'pop', 0, 0.5, 0.005).name('Scale pop');
  pu.add(HIT_FX.punch, 'dur', 0.02, 0.5, 0.01).name('Duration (s)');
  pu.add(HIT_FX.punch, 'cooldown', 0, 1, 0.01).name('Cooldown (s)');

  const sk = gui.addFolder('Camera shudder (rocket → player hull)');
  sk.add(HIT_FX.shake, 'amp', 0, 8, 0.05).name('Amplitude (world u)');
  sk.add(HIT_FX.shake, 'dur', 0.02, 0.6, 0.01).name('Duration (s)');
  sk.add(HIT_FX.shake, 'cooldown', 0, 1, 0.01).name('Cooldown (s)');

  const tr = gui.addFolder('Tracers');
  tr.add(HIT_FX.tracer, 'kineticLen', 0.3, 4, 0.05).name('Kinetic length');
  tr.add(HIT_FX.tracer, 'kineticBright', 0.3, 2.5, 0.05).name('Kinetic brightness');
  tr.add(HIT_FX.tracer, 'cannonLen', 0.3, 4, 0.05).name('Cannon length');
  tr.add(HIT_FX.tracer, 'cannonBright', 0.3, 2.5, 0.05).name('Cannon brightness');
  tr.add(HIT_FX.tracer, 'jitterLen', 0, 1, 0.01).name('Length jitter (0 = uniform)');
  tr.add(HIT_FX.tracer, 'jitterBright', 0, 1, 0.01).name('Brightness jitter');

  gui.add({ copy() {
    const json = JSON.stringify(HIT_FX, null, 2);
    navigator.clipboard?.writeText(json);
    console.log('[hit-fx tune]', json);   // fallback when the clipboard is blocked
  } }, 'copy').name('Copy JSON');
}
```

**Wiring** — `client/src/main.js:2133-2135`, inside the existing `if (isDev() && Device.input !== 'touch')`
block, right after `buildExhaustPanel(GUI)`:

```js
      // Hit-feel panel: hull flash / model punch / camera shudder / tracer variation + Copy JSON.
      const { buildHitFxPanel } = await import('./hit-fx.js');
      buildHitFxPanel(GUI);
```

**Test hooks** — `window.__game` (`client/src/main.js:1274+`), so the visual scenario can drive real hits
and read the FX state instead of guessing:

```js
    // Bullet spawn bound to this tab's World — mirrors the existing spawnRocket shim two lines up.
    spawnBullet: (from, dir, weapon, fromPlayer) => spawnBulletInto(world, from, dir, weapon, fromPlayer, null),
    hitFx: { HIT_FX, flashOf: (ship) => ship?.mesh?.userData?.hitFlash || null,
             punchOf: (ship) => ship?.mesh?.userData?.hitPunch || null },
```

(import `spawnBullet as spawnBulletInto` from `./sim-core/spawn.js` beside the existing `spawnRocketInto`
import at `main.js:22`, and `HIT_FX` from `./hit-fx-config.js`.)

---

## Replay / intro impact

**Required subsection — this change touches the damage path, so the deterministic re-sim must be reasoned
about explicitly, not assumed.**

- The Level-0 intro cutscene is a recorded **input** trace re-run through the real `sim.update()`
  (`client/src/replay.js` + the `level-1` descriptor's `introTrace`). Anything that changes ship state,
  ordering or RNG consumption would break it.
- **What this change does to the sim:** adds a field to a returned object (`toHull`), emits an extra
  describing event, and computes two `Math.atan2` values. It writes **no** entity state, consumes **zero**
  `simRandom()` draws, adds no branch that depends on new state, and changes no timing. `worldDigest`
  (`client/src/sim-core/digest.js`) hashes entity state + `simRandomDraws()` — neither moves. The event
  queue is not digested.
- **All new randomness is `Math.random()` on the render side** (per-shot tracer look, the shudder angle),
  called from `attachBulletBody` / `applySimEvent`, which a headless referee never reaches (`noopHost`).
  `36-sim-divergence` compares the browser and Node digests **including draw counts** — it must stay green.
- **What the player will see change in the intro:** hull flashes on both sides, and — once the maintainer
  tunes the amplitudes up — a camera shudder when the recorded pilot takes a rocket through a downed
  shield. This is expected and accepted (D7). It cannot alter the trace: the input is fixed and the FX is
  downstream of the tick.
- **The gate:** `cd client && node visual/run.mjs 22-intro-replay` must stay green. Its **assertions** are
  4 kills, cutscene cards p0..p4 and `won === true`. The tick count is **logged, not asserted** — the
  scenario prints `intro re-sim: … tick=<n>/<total>`; **read that line** and confirm it still says **2474**.
  A moved tick means the change leaked into the simulation: find it, do not re-record the trace.

---

## Tests

Run: `cd client && node --test` · `cd server && npm test` (drops + recreates the local `spacegame_test`
Postgres DB via `pretest`; the single data layer is `db.js`) · `cd client && node visual/run.mjs <name>`.

**Before ANY visual scenario: `npm run assets:pull`.** This worktree has no `client/assets/ships/` — the
`.glb` models are gitignored — and every scenario here depends on real ship models (the material clone, the
projected radius, the intro trace).

### T1 — `client/src/hit-fx-config.test.js` (new, `node --test`)

Covers the rules that are *requirements*, not tunables:

- **`impulse01` is instant-out / smooth-back (D6a):** `impulse01(0) === 1` (no ramp-in — the impulse starts
  at full; the first *drawn* frame reads ≈0.84 because `updateHitFx` ages before it writes, which is fine),
  `impulse01(1) === 0`, `impulse01(2) === 0`, strictly decreasing across a sweep, and
  it decelerates into rest: `impulse01(0.9) - impulse01(1.0)` **<** `impulse01(0.0) - impulse01(0.1)`.
- **Refresh, never accumulate (D6b):** refresh → age halfway → refresh again → the value returns to ~1 and
  **never exceeds 1**; `st.age` is reset rather than summed.
- **The salvo cooldown (D6c):** with `cooldown = 0.15`, three refreshes 10 ms apart accept **exactly one**
  (`refreshImpulse` returns `true, false, false`); after ageing past the cooldown a refresh is accepted
  again.
- **`reachedHull` (D2) — the whole point:** `{ absorbed: true, broke: true, toHull: 60 }` → **true**
  (the break-with-spill case a naive `!absorbed` would drop); `{ absorbed: true, broke: false, toHull: 0 }`
  → false; `{ absorbed: false, broke: false, toHull: 10 }` → true; `null` → false.
- **`tracerLook`:** with `jitterLen = jitterBright = 0` the result is **exactly** the class base for both
  classes (no floating-point drift), and with the bases set to `kineticLen 1.0 / cannonLen 1.7` and both
  brightnesses `1` it reproduces today's `BOLT_SCALE` numbers exactly — the "0 restores the old look"
  contract. With `jitter 0.25` and an injected `rand`, `() => 0` → `base × 0.75` and `() => 1` →
  `base × 1.25` (the bounds).

### T2 — `client/src/sim-core/components.test.js` (EDIT — this file will FAIL otherwise)

Six existing assertions use `assert.deepEqual(applyShieldedDamage(…), { absorbed, broke })` and break the
moment `toHull` is added. Update **all** of them (currently lines ~155, 162, 170, 177, 183, 242) to the
three-field contract, and **add** the case this whole feature turns on:

```js
test('a shield that BREAKS still spills to the hull — absorbed is not "nothing got through"', () => {
  const p = { shield: { capacity: 20 }, _shieldValue: 20, hp: 100 };
  assert.deepEqual(applyShieldedDamage(p, 80), { absorbed: true, broke: true, toHull: 60 });
  assert.equal(p.hp, 40);
});
```

Plus: no shield → `toHull === dmg`; a partial absorb → `toHull === 0`.

### T3 — `server/src/netsim/room.test.js` (no edit, but it MUST be run)

`test('every event in the sim-core catalogue is wired for the network')` (line 122) parses the catalogue
comment in `events.js` and asserts every type has an `EVENT_FIELDS` entry. Adding `hullHit` to the
catalogue **without** step 2d fails this test — that is the guard working. Run `cd server && npm test`.

### T4 — `client/visual/scenarios/42-hit-feel.mjs` (new)

A visual feature can pass every logic test and ship **invisible** — so this scenario asserts the flash
reaches the **screen**, not merely that a variable was assigned. Follow `25-enemy-shield.mjs` for the
take-off/spawn setup and `99-fill.mjs` for the `gl.readPixels` technique. Step the sim with
`__game.stepSim(n)` — never wall-clock waits (the harness runs on software WebGL; a `waitForTimeout` tests
the CPU, not the game).

**The measurement is PINNED — read this before writing the assertions.** "Mean luminance of a crop" is
meaningless until the crop size is fixed: at 1280×800 (`client/visual/run.mjs:98`), fov 55
(`client/src/engine.js:62`) and a camera ~113 u from the ship, the scene shows ~118 world units across 800 px
→ **≈6.8 px per world unit**. A **modelled** fighter's world radius is `broadR × ship.scale` ≈ 2.0 × 1.7
≈ **3.4 u**, i.e. ≈**46 px across** (the 2.6 in `collision.js:26-28` is the *primitive* fallback and does not
apply to a modelled ship). A 60 px crop would pass trivially; a 200 px one dilutes a perfectly working flash
below any threshold and fails. So the scenario **derives the crop from the ship's own projected radius** and
**compares two identical crops on the same frame**:

```js
// Half-size of a ship's crop, in device pixels, derived from its projected radius — so it self-adapts to
// whatever camera zoom is in effect (camZoom is restored from localStorage and must not decide a pass).
// NOTE: `ship.broadR` is GROUP-LOCAL (see the comment at shield-fx.js:181) — the WORLD radius is
// `broadR * ship.scale`, which is exactly what `broadRadius(ship)` (collision.js:26) returns, primitive
// fallback included. Project the SCALED value; projecting the raw broadR undersizes the crop by ~1.7x.
const radiusPx = (ship) => { /* camera.project(ship.pos) vs camera.project(ship.pos + right * broadRadius(ship)) */ };
const cropOf = (ship, buf) => { /* square, half-size clamp(radiusPx(ship), 12, 60), centred on the ship's
                                   projected pixel; remember gl.readPixels is BOTTOM-UP in Y */ };
const mean  = (crop) => /* mean of (R+G+B)/3 over the crop, 0..255 */;
const bright = (crop, thr) => /* count of pixels with (R+G+B)/3 >= thr */;
```

Both enemies are the **same type, same heading, same distance from the camera**, so their crops are the same
size and their lighting is identical (the combat sun is directional) — A minus B *is* the flash, and the
shared-material negative comes free in the same measurement.

1. **Take off**, clear `__game.enemies`, spawn **two** fighters of the same type and park **both**
   ahead of the player, side by side, same `heading`, fully in frame (enemy **B** is the untouched control).
   Place them at `player.x ± d` with the **same z** — that makes their camera distance exactly equal *by
   construction*, which is what the `< 3` baseline in step 3 rests on. `d` must exceed the crop width in
   world units (the crop is ~1 ship diameter ≈ 7 u, so **d ≥ 10 u**) or the two crops overlap and the
   flash bleeds into the control.
   **Assert the per-instance material clone (D11):** their `mesh.userData.flashMats[0].mat.uuid` differ,
   and `__game.shipModelsParsed` has not grown per spawn (the shared template is still one parse).
2. Both: `_shieldValue = 0`, `warping = false`, `scale = fullScale`.
   **Set `__game.hitFx.HIT_FX.flash.dur = 5`** so the flash holds still for the pixel check (the live loop
   would otherwise age it out in 0.12 s of wall time).
3. **Baseline, same frame:** grab the framebuffer once (`gl.readPixels` over the whole buffer, as
   `99-fill.mjs` does) and assert `Math.abs(mean(cropOf(A)) - mean(cropOf(B))) < 3` — the two are
   indistinguishable before anything is hit. This is what makes step 5's delta attributable to the flash.
4. Fire a **real** kinetic bullet at **A** with `__game.spawnBullet(...)` and `stepSim` until `A.hp` drops.
   Assert `flashOf(A).active === true` and `A.mesh.userData.flashMats[0].mat.emissiveIntensity > 0`.
5. **PERCEPTION assertion** — one `requestAnimationFrame`, grab the framebuffer once, two crops:
   - `mean(cropOf(A)) - mean(cropOf(B)) >= 8` (of 255). Justification for the 8: the hull covers ~35-45 % of
     a radius-derived crop, so a crop-mean rise of 8 is ≈20 levels **on the hull itself** — a visible
     brightening, and well under what the shipped `intensity 1.6` produces (a crop-mean delta in the
     mid-20s). If the maintainer later tunes `intensity` *down* past this, retune the threshold **with**
     it, deliberately: this assertion is the record of "the flash must stay visible".
   - **Crop-area-independent second measure**, so no future crop change can dilute the result away:
     `bright(cropOf(A), 160) - bright(cropOf(B), 160) >= 100` — at least ~100 genuinely bright pixels
     appeared on A and not on B. Scale check: a 46 px-wide fighter fills a ~46×46 crop to ~35-45 %, i.e. a
     hull silhouette of ~700-900 px, so 100 is ~12 % of it — comfortably reachable by a working flash and
     far above readPixels noise.
   - Both together also prove B did **not** brighten → the shared-material bug caught **on screen**, not
     only by uuid.
6. **No punch from plain bullets (scope item 2):** after the kinetic hit, `bank.position.lengthSq() === 0`.
7. **Punch from a rocket:** set `HIT_FX.punch.shove = 0.5`, `dur = 5`; force a rocket hit
   (`__game.spawnRocket(...)` aimed at enemy A, or place it inside `blastR` and step); assert
   `bank.position.lengthSq() > 0` on the following frame, and that a second hit inside the cooldown does
   **not** increase it beyond the single-hit displacement (**refresh, not accumulate** — observed on the
   scene graph, not just in the unit test).
8. **Camera shudder.** `camOffset` is **not** exposed on `__game` (it lives on `__replay.state`), and it does
   not need to be: the camera is rigidly `player.pos + camOffset`, so the **offset vector** is constant at
   rest whatever the player is doing. Capture `rest = camera.position.clone().sub(player.pos)` on a quiet
   frame, then set `HIT_FX.shake.amp = 4`, `dur = 5`, drop the player's shield
   (`__game.player._shieldValue = 0`) and detonate a rocket on him. Assert
   `camera.position.clone().sub(player.pos).distanceTo(rest) > 1` (the shudder reached the camera), and that
   it returns to ~0 after ageing past the duration. Then the negative: with the shield **up and absorbing
   everything** (`toHull === 0`) the offset vector does **not** move.
9. Restore the `HIT_FX` values it changed at the end (the object is module state shared with the rest of
   the run).

### T5 — the replay guard (blocking)

`cd client && node visual/run.mjs 22-intro-replay` — asserts 4 kills, cards p0..p4, a win; and the logged
`tick=` line must still read **2474** (logged, not asserted — you have to look at it).

### T6 — the neighbours

`cd client && node visual/run.mjs 26-ship-model-cache` (**edited in step 5b — it FAILS without that edit**),
`36-sim-divergence` (browser↔Node digest + draw counts),
`04-combat`, `25-enemy-shield`, `17-triple-spiral-rocket` (the salvo the punch cooldown exists for),
`39-charge-beam` + `40-enemy-beam` (**must be unchanged** — beams emit no `hullHit`, D1).
Note the known baseline: the full visual suite has ~6 scenarios that fail before this change; judge by the
reliably-passing set and **zero page errors**, and diff against a `main` baseline rather than an absolute
pass count.

---

## Docs to update

- **`docs/CHANGELOG.md`** — a bullet under a new `## 2026-08-30` heading (newest on top), leading with a
  bold summary phrase: **"The target reacts — hull flash, model punch and a camera shudder."** Cover: the
  new `hullHit` event and the `toHull` contract; the flash on every ship; the punch on rocket + cannon
  only, shipping at 0 pending live tuning; the shudder on rocket-into-player-hull; variable tracers; and
  the `?dev` "Hit feel" panel.
- **`docs/SUMMARY.md`** (edit in place, no history; bump `**Updated:**`):
  - **Visuals**, after the "Gun fire visual" bullet (line 2418): a new bullet describing the hull flash,
    the punch (both channels, both shipping at their tuned defaults) and the camera shudder, naming
    `client/src/hit-fx.js` + `client/src/hit-fx-config.js` and the `toHull > 0` rule.
  - **Edit** the "Gun fire visual" bullet itself (line 2418) — bolts now vary in length and brightness per
    class and per shot; `BOLT_SCALE` drives width + muzzle flash, `HIT_FX.tracer` drives length/brightness.
  - The `?dev` panel list near the "Dev palette tuning panel" bullet (line 2194) — add the "Hit feel" panel.
  - **Client module layout** (line 3186+) — add `hit-fx.js` and `hit-fx-config.js`.
  - The sim-core **event catalogue** description: `grep -n "bulletImpact" docs/SUMMARY.md` and add
    `hullHit` wherever the event list is enumerated.
  - The shield section's `applyShieldedDamage` contract (`grep -n "absorbed, broke" docs/SUMMARY.md`) →
    `{ absorbed, broke, toHull }`.
  - **Tests** (line 3880+) — the new `hit-fx-config.test.js` cases and visual scenario `42-hit-feel`.
  - **`docs/SUMMARY.md:828-831`** — *"Cloning **shares geometry and materials** (one GPU copy per ship TYPE,
    not per instance), which means **a live ship's material must never be mutated in place** — the `tint`
    recolour and the ghost-battle `darken`/`opacity` treatment clone their materials first, and anything new
    that wants a per-ship visual state must too"* is now false end to end.
    Rewrite: cloning shares **geometry and textures** per type; **materials are cloned per instance** at
    attach so a per-ship visual state (the hit flash) can mutate them safely. Keep the surrounding warning
    that the shared *template's* materials must not be touched.
  - **`docs/SUMMARY.md:4108`** — the `26-ship-model-cache` description (*"the pair must share a geometry set
    AND a material set"*) → the pair shares a **geometry** set and now has **distinct materials**, while
    staying distinct scene objects.
- **`docs/DECISIONS.md` §79 — THREE anchors, not one.** Amending only the Guard leaves the section
  self-contradictory: two other parts of §79 state the opposite of what ships. Write all three as an
  **amendment, not a reversal** — §79 already blesses this move ("anything new that wants a per-ship visual
  state (a damage flash, a cloak, a team colour) must clone the material for that instance too"); the hit
  flash is that thing, and the clone simply moved from case-by-case to always-on. Cross-reference §137.
  - **line 2820 — the section HEADING:** *"## 79. Ship models are parsed ONCE and cloned per spawn — so a
    live ship's materials must never be mutated"*. `hit-fx.js` mutates a live ship's materials on every
    frame of a flash. Reword to e.g. *"— so a live ship's materials are CLONED PER INSTANCE"*.
  - **lines 2837-2841 — "The constraint this creates":** *"`Object3D.clone(true)` shares **geometry and
    materials** … one GPU copy per ship *type* … mutating a live ship's material would leak to every other
    ship of that type. Two existing paths deliberately mutate materials and must therefore keep cloning
    first…"*. After step 5 the live clone path **shares no materials at all**, and the per-path `tint` /
    ghost-battle clones are redundant rather than load-bearing (harmless — leave the code, note the status).
    Record that the case-by-case clone became **always-on at attach**, and that what is still one copy per
    ship TYPE is **geometry + textures + the compiled program**.
  - **lines 2859-2861 — the Guard paragraph:** the scenario now asserts the pair shares a geometry set and
    has **per-instance materials**; the mutation-verification (bypass the cache → it fails) still holds, on
    `sameTypeGeo` **and** on the `parsed >= 2` cache-size floor.
  - The **"Safe on teardown"** paragraph (`docs/DECISIONS.md:2844`) stays TRUE as written and needs no edit — a dead enemy
    still disposes only its exhaust plume. Optionally add the clause that this is also why per-instance
    clones cost nothing: they are GC'd with the mesh, and nothing frees the shared program (§83).
  - **`docs/CHANGELOG.md:2345/2349` say the same thing and must NOT be touched** — the changelog is
    append-only history, and history is allowed to describe how things were.

**Concept sweep (already run for you — this is the COMPLETE set).** Grepping the plain-English phrasing
across `docs/` (`one GPU copy per`, `share.*material`, `material set`, `per ship TYPE`,
`must never be mutated`, `shares geometry`) returns exactly: `DECISIONS.md:2820`, `:2838` (the 2837-2841
paragraph), `:2860` (the 2859-2861 Guard), `SUMMARY.md:828-831`, `SUMMARY.md:4108` — plus the untouchable
CHANGELOG entries. `SUMMARY.md:978` and `DECISIONS.md:2753` also match on "material set" but are about the
HANGAR model's texture budget and are unrelated; leave them. Three further hits under a BROADER grep are
also unrelated and still true after this change — leave them too: `DECISIONS.md:2953` (§82 `particle-pool.js`
InstancedMesh rocket smoke, "instances share one material"), `SUMMARY.md:1332` (`drops.js` / `rewardModelCache`
drop-halo SpriteMaterial) and `SUMMARY.md:481` (particle draw-call-per-KIND). **Re-run that grep at the end** (it is in the
final gate) — a stale sentence contradicting shipped behaviour is the failure mode this sweep exists for.
- **`docs/DECISIONS.md`** — one new numbered entry (**§137**, the next free number after §136 — if a
  parallel session has taken it by merge time, use the next free one) titled roughly *"A hit is felt on the
  RECEIVER — and `toHull > 0`, not `absorbed`, is what 'felt' means"*, recording: (a) why the predicate is
  `toHull > 0` and what breaks with `absorbed` (the 80-power rocket into a 20-point shield); (b)
  refresh-not-accumulate + cooldown + instant-out/ease-back, and why (per-shot recoil was cut from scope
  for the jitter failure mode); (c) why the punch rides the cosmetic child group and never `ship.scale`
  (hitboxes + muzzle offset); (d) per-instance material clones — why the §79 case-by-case
  clone became **always-on at attach**, what that costs (nothing on the GPU: geometry, textures and the
  compiled program are still shared per type, and nothing disposes them) and the `emissiveMap` limitation we
  chose to live with rather than force a shader recompile (§83).
- **No `publish-itch` step is needed:** this change touches no asset and no content-hashed URL in
  `server/src/catalog_seed.js`, so the itch bundle is unaffected.

---

## Out of scope / non-goals (DECISIONS §30 — build the smallest thing that delivers this)

- **No per-shot weapon or camera recoil.** There is no barrel model and a per-shot kick becomes constant
  jitter. This was cut deliberately; do not add it "for symmetry".
- **No hit-stop / time dilation.**
- **No sound changes** of any kind.
- **No ship-explosion overhaul.**
- **No beam involvement** — `beam.js` is not edited, and no beam hit flashes or punches (D1).
- **No damage-scaled magnitudes.** The shudder is a flat amplitude; the flash does not brighten with a
  bigger hit. If that turns out to be wanted, it is a second pass.
- **No new shield/impact FX** beyond the existing cyan bubble, and **no shield-flash knob** (D3 — it would be a control that cannot fire).
- **No persistence** for the panel, and **no localStorage** anywhere in this change (D8).
- **Do not re-record the intro trace.** If `22-intro-replay` moves, the fix is in the code.
- **Do not defend the shipped magnitudes.** Every number in `HIT_FX` is a placeholder; the panel exists so
  the maintainer replaces them from a real fight.

---

## Final gate (run all of these before calling it done)

1. `cd client && node --test` — green (includes the edited `components.test.js` and the new
   `hit-fx-config.test.js`).
2. `cd server && npm test` — green (the event-catalogue wiring guard).
3. `cd client && node visual/run.mjs 22-intro-replay` — green (4 kills, p0..p4, win) **and** the logged
   `tick=` line still reads **2474**.
4. `cd client && node visual/run.mjs 42-hit-feel` — green, including the pixel-contrast assertion.
4b. `cd client && node visual/run.mjs 26-ship-model-cache` — green **with the step-5b edit** (geometry still
   shared, materials now per-instance).
5. `cd client && node visual/run.mjs 36-sim-divergence` — green (no new RNG draws).
6. `grep -rn "simRandom" client/src/hit-fx.js client/src/hit-fx-config.js client/src/bolt-fx.js` —
   **must return nothing.**
7. `grep -rn "absorbed, broke\|{ absorbed, broke }" client/ server/ docs/` — every description of the
   damage contract mentions `toHull` (the concept sweep: code comments, docs and tests, not just symbols).
7b. **The shared-materials concept sweep** —
   `grep -rn "one GPU copy per\|share.*material\|material set\|per ship TYPE\|must never be mutated" docs/DECISIONS.md docs/SUMMARY.md docs/plans/*.md`
   — every remaining hit either describes per-instance materials, or is one of the PRE-CLEARED unrelated
   lines: `SUMMARY.md:978` + `DECISIONS.md:2753` (hangar texture budget), `DECISIONS.md:2953` (particle-pool
   InstancedMesh), `SUMMARY.md:1332` (drop-halo SpriteMaterial), `SUMMARY.md:481` (particle draw-call-per-KIND).
   All five are still TRUE — do not "fix" correct prose while closing out this gate. CHANGELOG hits are
   history: leave them.
8. Load the game with `?dev`, confirm the "Hit feel" panel appears with all four folders and `Copy JSON`
   produces valid JSON matching `HIT_FX`.
9. Play a level: a plain bullet flashes the enemy and does **not** move its model; a cannon/rocket hit
   flashes **and** punches (once the sliders are raised); a rocket into your own down shield shudders the
   camera; a rocket absorbed by a full shield does not.
