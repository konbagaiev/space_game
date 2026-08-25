# Charged beam — a weapon whose shot takes time, has no projectile, and announces itself

> ## ⚠ BUILT AND SHIPPED 2026-08-25 — TWO NUMBERS IN THIS PLAN ARE STALE
>
> The maintainer revised **§0a-bis** in the source brief *after* this plan was written, and the brief wins.
> **What actually shipped: `chargeTime` 1.0 s (not 0.5) and `maxRange` 100 (not 90).** Everything derived
> from that pair is therefore stale WHEREVER IT APPEARS BELOW — §2a's table, the S1 catalog snippet
> (`:211`, `:214`), the S6 stat line and the S12.4 manual-check string (both of which read
> `Charge 0.5s · RoF 1.0/s · Range 90`), and S9's escape case at 90 u.
>
> **The real values:** cycle = `chargeTime + fireCooldown` = **1.5 s** → **53 DPS, deliberately below the
> starter gun** (see DECISIONS §135 — the maintainer declined both offered ways to restore 80 DPS). The
> shop stat line reads exactly **`DMG 80 · Charge 1.0s · Arc ±2° · RoF 0.7/s · Range 100 · Weight 12`**.
> A top-speed crosser escapes by **8.95° at 100 u**, not 5.0° at 90 u. The charge SFX is no longer a 0.39 s
> cut played at `rate = 0.39 / chargeTime`: it is the 0.35 s build **`atempo`-stretched to 0.924 s**
> (pitch-preserving) and played at `rate = 0.924 / chargeTime` ≈ 1.0, because the source has no one-second
> build and replaying a 0.35 s clip that slowly drops it 16 semitones into a growl.
>
>
> **The AUDIO and the DISCHARGE LOOK were also re-settled on the spike (2026-08-25) and ported after this
> plan was written.** S8's charge recipe and its `BEAM_CHARGE_CLIP_SEC = 0.39` are retired: the charge is
> now THREE pieces of the source concatenated (1.400 s) of which only the **first 1.0 s** is the charge, so
> the constant is **1.0, not the file length**; the discharge is pitch-shifted **and EQ'd** (the EQ is what
> removes the shrillness — a pitch shift alone does almost nothing to the harsh band). S5.5's line bolt is
> retired too: §2e is **amended in place** with the two-quad geometry (core 0.3 / glow 1.0 world units,
> 1.0 s split fade), because a WebGL line cannot express thickness at all.
>
> **`docs/SUMMARY.md` describes what the code does now; DECISIONS §135 holds the rationale.** Read those
> two first. This file is kept for its reasoning and its step-by-step structure, not for its numbers.
> (S5.7's "reads against a lit set-piece" criterion is also amended in place — knowingly not met, and
> accepted by the maintainer.)

> **Executable plan.** Source brief: `docs/plans/charge-beam-weapon.md` (read its **§0a-bis "THE NUMBERS"** —
> it is authoritative and supersedes every number the throwaway spike used). Evidence-only spike:
> branch `spike/charge-beam`, worktree `../ag-wt/charge-beam` — **read it for shape, copy nothing blindly**;
> its five behaviour numbers live in a module-level `beamTuning` object, which this plan deletes.
>
> This plan is self-contained. Everything it needs to decide is decided below; the handful of items that
> need the maintainer's eye are gathered in §2 **and are not blockers** — implement the stated value and
> raise them at the review gate.
>
> **SCOPE CUT, 2026-08-25 (brief §0a-ter): the ENEMY beam is OUT until the maintainer asks.** This cuts
> deliberate enemy-facing *work*; it does **not** cut the architecture. "Any weapon on any ship" stays
> exactly as designed because it costs nothing — the weapon is a `WEAPONS` row and the whole mechanic sits
> behind the one **side-agnostic** `updateGroups` branch, so player, ally and enemy run the same code path.
> **No `side === 'player'` special-case may be introduced anywhere, and `beam.js` must not be narrowed to
> the player** — that shortcut is the single change that would make arming pirates later expensive, and it
> would quietly break the maintainer's original hard requirement. What is deferred, and the gate that
> guards it, is §2d.

## 1. Goal

Add **Charged beam** — a third weapon `type` (`'beam'`) alongside `'bullet'` and `'rocket'` — as an
ordinary row in `WEAPONS`, resolved by the one existing side-agnostic fire-group seam so that *any* ship
could carry it. While a beam is mounted, three thin lines run from the hull: the centre line and the two
edges of a **±2° hit corridor**. Pull the trigger and energy builds for **0.5 s**; at release the beam
**hitscans** — it strikes the ship it painted if any part of that ship is still between the two drawn
lines, otherwise it strikes whatever is in the corridor at that instant, otherwise nothing. Half a second
later you can fire again. Turning away breaks the shot; turning *toward* the target tracks it.

**In this change the beam is a weapon the PLAYER buys and flies.** No enemy is armed with one, no enemy
telegraph is drawn, and nothing is tuned for an AI (§2d). The simulation stays side-agnostic throughout, so
arming pirates later is a catalog edit plus the deferred rendering work — which is exactly why the cut is
safe to take. The weapon still **unblocks Level 5**: the mission is built against a weapon that already
exists and is already good on its own terms.

## 2. Decisions

### 2a. The behaviour numbers — SETTLED (brief §0a-bis). They live in the WEAPON ROW, not in a module.

| stat (weapon-row field) | value | source |
|---|---|---|
| `power` | **80** | maintainer 2026-08-25 |
| `maxRange` | **90** | maintainer 2026-08-25 — matches the long guns (`GUN_LONG`) |
| `chargeTime` | **0.5** s | the maintainer's original description |
| `fireCooldown` | **0.5** s | ditto ("half a second later I can do it again") |
| `corridorDeg` | **2** (HALF-angle, degrees) | maintainer 2026-08-25 |
| `price` | **5500** | inside the maintainer's 5000–6000 band; see §2b |
| `minLevel` | **`FACTORY_GATE`** (`'level-4'`) | maintainer 2026-08-25 — the gate Heavy MG carries |
| `weight` | **12** | proposed here; see §2b |
| `class` | **`'beam'`** | its own sound/FX class (new SOUND_MAP rows) |
| `projectileColor` | `0xbfefff` | the DISCHARGE tint (the sight is green — §2e) |

At a 1.0 s cycle, damage = DPS: **80 DPS at range 90**, above Machine Gun (70) and below Heavy MG (100).

**These five behaviour numbers are read off `g.mounts[0].weapon` every time they are used.** There is no
shared tuning object: two ships must be able to carry differently-tuned beams. Deleting `beamTuning` is the
one thing the spike explicitly asks the production build to undo.

### 2b. Decisions taken here — implement as stated, raise at the review gate

1. **`weight: 12`.** The gun ladder orders by sustained damage — Heavy cannon 58 DPS / weight 10, beam 80
   DPS / **12**, Heavy MG 100 DPS / weight 15. Concretely: the player's base mass is exactly
   `REFERENCE_MASS` (50 = hull 20 + engine 10 + thrusters 4 + Grab 2 + shield 0 + Basic kinetic 6 + Rocket
   8; `components.js:12`), so swapping the kinetic for the beam takes mass to 56, `massFactor` 0.893 →
   acceleration 10 → 8.93 and turn 2.0 → 1.79. The beam taxes the exact stat it depends on (turn rate is
   how you track a target through the charge) — but less than the Heavy MG would.
2. **`price: 5500`** — under Heavy MG's 6000, because its sustained DPS is lower; well above Heavy cannon's
   2000, because its burst and its zero flight time are not on that weapon at any price.
3. **The beam occupies the PRIMARY GUN slot and fires on `Space`.** No new slot, no new key (DECISIONS §30).
   The server already routes it: `WEAPON_GROUP[item.type] || 'gun'` (`server/src/db.js:1024`). The only
   blocker is client-side — `GROUP_WEAPON_TYPE = { gun: 'bullet', rocket: 'rocket' }`
   (`client/src/shop.js:30`) maps a slot to exactly one type, so the beam would be invisible in the gun
   slot. The gun slot becomes "primary weapon" and accepts `['bullet', 'beam']`. **Consequence to state in
   the shop-facing copy and at the review gate: buying the beam means giving up your rapid gun.**
4. **`rarity` is left to the default rule** (`price > 0 && buyable !== false` → `'common'`), the same as
   Heavy Machine Gun. Not overridden to `'rare'`; that is a colour decision, not a mechanic.
5. **Paint ≡ corridor — one predicate, one promise.** §0a-bis makes the corridor test hull-aware; this plan
   therefore also makes *painting* (the reticle, and the lock taken at charge start) use the **same**
   hull-aware corridor predicate instead of the spike's bare centre-line test. This **refines §0a's
   wording**: the fallback at release is "whatever is in the corridor now (nearest)", not "whatever the
   centre line crosses". The reason is the one §0a gives for the corridor in the first place — the three
   drawn lines must be exactly the hit test, and a reticle that lights on a ship the corridor will reject
   is precisely the lie §0a-bis identifies. Anything in the brief still saying "centre line" for the
   fallback is superseded by this bullet.
6. **No dodge roll.** Not for the retracted §73 reason (a beam dodge would draw no randomness in any
   archived trace — `dodgeRoll` is consulted only after a geometric connect, `collision.js:208`, and only
   `step-projectiles.js:58` ever passes one). The real reason: **the corridor IS the dodge.** The beam stays
   RNG-free and the drawn lines never lie. Accepted cost: a Maneuver build gets no statistical protection
   from a beam. The plan's DECISIONS entry must record the retraction, not repeat the wrong argument.
7. **Only your own shots are audible — the existing rule, unchanged.** No exception is made for a beam.
   (An earlier draft proposed making a hostile charge audible as its own telegraph; that went out with the
   enemy beam and belongs to the deferred work in §2d, not here.)
8. **The Kinetic skill scales beam damage.** `makePlayer` multiplies `power` by `kineticDmgMul` for every
   non-rocket weapon (`ship-entity.js:102`); the beam inherits that. Left as is — the alternative is a
   top-tier weapon that ignores the damage skill. The skill card text is generic ("+X% damage per point"),
   so no string changes; note it in SUMMARY.
9. **No shop model for the beam.** Weapons may carry `modelUrlHigh` for the item preview (Machine Gun
   does); the beam has none, so the shop shows the "no model" placeholder. Sourcing one is a CC-BY/CREDITS
   conversation with the maintainer (CLAUDE.md) — **out of scope, mention at the review gate.**

### 2d. DEFERRED — the enemy beam, and the gate that must be passed before one is ever armed

Cut by the maintainer on 2026-08-25 ("Don't waste time for enemy beam before I asked", brief §0a-ter).
**Not built, not tuned, not tested here:** an enemy `BEAM` AI preset, a beam on any enemy ship, the drawing
of a *hostile* corridor while it charges, any generalisation of `beam-fx.js` beyond the player, the
`beamCharge` entity reference on the wire, an audible hostile charge, and the `?beam=enemy` half of the dev
flag.

**THE GATE — record it in DECISIONS §135 as well as here.** An enemy beam is a **0.5 s unanswerable hit
unless its telegraph is on screen**. So: *before any enemy is ever armed with a beam, two things must be
built first — (1) the enemy-sight rendering (the three lines drawn from a charging hostile hull, in a
hostile colour, for the duration of its charge) and (2) the wire entity reference that lets a client draw a
**remote** shooter's corridor in a room.* An aiming line the player never sees is not a warning; it is an
unfair attack. Writing this gate down is what makes taking the cut safe now.

**Preserved as INPUT to that future work — not as work to do now:**

- **A hostile's engagement range is a SEPARATE number from the weapon's reach.** `ai.range` (the fire-group
  preset) and `maxRange` (the weapon row) are independent — `GUN_LONG` pairs `ai.range` 90 with weapon 9's
  `maxRange` 90, but they need not match. `maxRange` 90 is right for the player; **90 on an enemy would let
  it charge from off-screen**, because the visible half-extent is ±57 u vertically and only **±32 u
  horizontally on a phone in portrait** — precisely the failure `combat-ally.md` §2c(a) names. When the
  enemy beam is built, give its preset a shorter `ai.range` (≈45–55, on-screen vertically on every device)
  and a tighter `aimTol` than `GUN`'s 0.25 rad, because `aimTol` only gates the *start* of a charge and half
  a second of steering closes a small error against a ±2° corridor.
- **The wire shape that work needs:** `beamCharge` gains the shooter as an `EVENT_ENTITY_REFS` entry (→
  `shipId`, never the entity) plus `range` and `corridorDeg`, so a client can draw a remote corridor from
  the heading it already interpolates — still two events per shot, still no per-tick charge broadcast.
- **What must NOT be done to get there:** no `side === 'player'` branch, and no narrowing of `sim-core/
  beam.js`. Everything in §3 stays side-agnostic, so this deferred work is additive.

### 2e. THE LOOK — settled at the spike (brief §0e). Reproduce these values; they are not suggestions.

Maintainer, 2026-08-25: *"this feature is more about Look and Feel, it must be beautiful and sound good."*
Every value below came out of flying the spike, and **the spike is throwaway — anything not reproduced here
is lost.** All of it is cosmetic and RNG-free, so it is replay-neutral (§73).

- **The sight is GREEN (`#5ad17f`); the shot is CYAN-WHITE (`0xbfefff`).** They shared one blue at first and
  the aiming aid competed with the discharge it exists to predict. Split hues mean a half second of green
  build-up hands over to a cyan-white flash and **the shot is what the eye lands on** — so the sight can sit
  on screen permanently without ever stealing the moment it announces. The bolt, the muzzle bead and the
  impact bloom all keep `0xbfefff`; the reticle stays amber `0xffd24d`.
- **All three lines carry the SAME colour and the SAME opacity — 0.22 idle, rising by 0.38 as the charge
  fills.** The centre first read as "too thick"; every WebGL line is 1 px whatever `linewidth` says
  (ignored on essentially every platform), so what read as thickness was a brighter colour at a higher
  opacity. **The centre came DOWN to meet the edges, not the edges up.**
- **The centre is distinguished by DASH RHYTHM, not brightness:** centre = long strokes (`dashSize` 2.4 /
  `gapSize` 1.6), edges = short ticks (0.7 / 1.5). Rhythm distinguishes without adding visual mass.
  `THREE.LineDashedMaterial` on all three.
- **The dashes ARE the charge animation:** they drift outward at **3 u/s** while aiming and rush to
  **40 u/s** as the shot fills (lerped on the charge fraction `k`). **Implemented by writing the
  `lineDistance` attribute directly** — `computeLineDistances()` restarts the pattern at 0 every frame and
  freezes the flow. Set `lineDistance[0] = phase`, `[1] = phase + segmentLength`, and advance `phase` by
  `-dt * speed`.
- **A bead of light gathers at the MUZZLE while charging** — an additive disc, `scale = 0.3 + k² * 1.3`
  (eased, so the last third is where it visibly blooms), `opacity = 0.3 + k * 0.65`, slowly spinning.
- **The reticle is a DIAMOND, not a circle** (`RingGeometry(2.2, 2.7, 4)` — 4 segments) so it reads as a
  targeting mark rather than a halo; it **tightens** onto the target (`scale ×= 1.25 - k * 0.25`) and
  **spins up** as the charge completes (`spin += dt * (0.6 + k * 6)`).
- **The discharge is a THICK BEAM THAT LEAVES A TRAIL — amended 2026-08-25, and this supersedes the
  0.16 s line bolt this section originally specified.** The maintainer asked for a thicker beam and a trail
  that dims over a second, and **a line cannot express thickness**: a WebGL line is 1 px wide whatever
  `linewidth` says (ignored on essentially every platform), so this is geometry **by necessity, not
  preference**. The bolt is now **two additive quads** — a white-hot **core** inside a wider coloured
  **glow** — each a `PlaneGeometry(1,1)` with `rotateX(-PI/2)` so local +X is width and local +Z is length,
  spanned muzzle→impact by `position` = the midpoint, `rotation.y = atan2(dx, dz)` and
  `scale.set(width, 1, len)`. The core sits a hair higher in Y so it always wins the additive blend.
  - **Widths are in WORLD units**, so the beam keeps its thickness as the camera zooms: core **0.3**,
    glow **1.0** (both thinned by a third from the first pass).
  - **The fade is 1.0 s, and it is SPLIT** so it reads as a strike rather than a dissolve: the glow's
    opacity is `a²` across the whole second (linear read as a cut), while the core is
    `max(0, (a − 0.75) / 0.25)` — it burns out inside the first quarter and only the trail lingers.
  - The impact bloom is **unchanged**: it still expands while fading quadratically over **0.24 s**
    (`scale 0.6 → 5.0`, `opacity = a²`).
  - **Test it on the GEOMETRY, never on `visible === true`.** On the spike a patch silently failed to
    apply, the width constant stayed `undefined`, `scale.set(undefined, …)` produced a NaN transform and
    the beam rendered as nothing at all while `visible === true` held throughout. Scenario 39 therefore
    asserts the bolt is a mesh, that its width is finite and positive, that the core is narrower than the
    glow, and that it spans muzzle→target — no hardcoded widths, which would break the next time they are
    tuned. Mutation-verified against exactly that defect.
- **The charge FX is driven by the `beamCharge` EVENT carrying `dur` — never by reading `g.charge`.** In a
  room the local group is never ticked (the ship keeps its `groups`, but nothing advances `g.charge`), so
  the event is the only thing that arrives; locally the two agree tick-for-tick. One clock, both hosts.
- **Audio timing (see S8):** the charge sample plays at `rate = 0.39 / chargeTime` so it stretches to fill
  the window exactly and a retune of `chargeTime` can never desync the bang. **An explicit `rate` is passed
  for BOTH sounds**, which also suppresses the random per-shot pitch jitter `audio.sfx.shoot` applies by
  default (`audio.js:189`) — a timing cue must sound identical every time.

### 2c. Answers already settled in the brief (do not re-open)

- **Trigger = a TAP THAT COMMITS.** Nothing interrupts a charge — not releasing fire, not damage, not the
  locked target dying (the lock just drops). Touch has a fire *button*, an AI's `wantsFire` flickers, and
  there is no "charge spoiled" state to invent or put on the wire. Brief §0b.
- **Hitscan**, resolved at release; it cannot be shot down. Attribution per §134: `lastHitBy = 'ally' |
  'player'` for credit/XP; the hostile path reuses `resolveHostileBulletHit` so the shield catches it on the
  bubble (§76). A hitscan has no projectile velocity to inherit, so §134's enemy-aim flaw is dissolved for
  this weapon **by construction, without touching the shared firing path** (§134's cancellation holds).
- **The aiming line is a SIM fact** — the geometry lives in `sim-core/`, the renderer only asks.
- **When an enemy beam is eventually built, its sight is charge-only** (maintainer, Q2): a hostile shows
  nothing until it triggers, then the three lines appear and brighten over the 0.5 s, so lines from a
  hostile hull always mean "a shot is coming right now". **Deferred — see §2d;** it is recorded here only so
  the answer is not re-asked later.
- **Name: "Charged beam".** Stat line shows the true cycle rate (§8 below).
- **Sound: the chosen CC-BY clip, split in two** (brief §0d-bis). The railgun candidate stays unwired and
  **must not** get a CREDITS.md row.

## 3. Steps

Anchors are line numbers in **this worktree** at plan time; if a line has moved, match the quoted code.

### S1 — the catalog row, the preset, and the guard test

**`server/src/catalog_seed.js`**

1. Extend the `WEAPONS` header comment (`:154-160`) to name the third type: `'bullet' | 'rocket' | 'beam'`,
   and list a beam's stats — `power`, `maxRange`, `chargeTime`, `corridorDeg` (HALF-angle in degrees),
   `fireCooldown` (the post-discharge lock-out), `weight`, `projectileColor`, `class`.
2. Append weapon **id 12** after Triple spiral rocket (that row runs `:236-245`; the `WEAPONS` array closes
   at `:246`):

```js
// The charged beam (docs/plans/2026-08-25-1056-charge-beam-weapon.md) — a THIRD weapon `type`. No
// projectile: a 0.5 s charge, then a hitscan that strikes the ship it painted if ANY PART of it is still
// inside the ±corridorDeg wedge drawn from the nose. Numbers live HERE, per row, so two ships can carry
// differently-tuned beams. `class: 'beam'` routes its own charge + discharge samples (SOUND_MAP below).
{
  id: 12, name: 'Charged beam', type: 'beam', price: 5500, stats: {
    power: 80, maxRange: 90, fireCooldown: 0.5, weight: 12, projectileColor: 0xbfefff, class: 'beam',
    // projectileColor is the DISCHARGE's cyan-white; the aiming sight is green and its look values are
    // module constants in beam-fx.js (plan §2e) — the two hues are deliberately different.
    chargeTime: 0.5,   // seconds from trigger to discharge
    corridorDeg: 2,    // HALF-angle of the hit corridor, degrees (the two drawn edge lines)
    minLevel: FACTORY_GATE, // gated: sold only after "Level 3", like the Heavy Machine Gun
  }
},
```

3. **No new fire-group preset.** The `GUN`/`GUN_LONG`/`ROCKET` block (`:298-300`) is untouched: a `BEAM`
   preset exists only to give an *enemy* an engagement range and an aim tolerance, and that is deferred
   (§2d). The player mounts the beam into the ship's existing `gun` group, whose `key: 'Space'` is what the
   player's `wantsFire` reads; the group's `ai` block is never consulted for a player. Do not add an unused
   preset "for later" — §2d records the numbers to reason from when the time comes.
4. Add the two `SOUNDS` rows + two `SOUND_MAP` rows — **after** S8 produces the hashed filenames.

**`server/src/db.js:882`** — make the routing explicit: `const WEAPON_GROUP = { bullet: 'gun', rocket:
'rocket', beam: 'gun' };` (behaviour is unchanged — the `|| 'gun'` fallback already did this — but the map
is where a reader looks).

**New `server/src/catalog_beam.test.js`** (model it on `catalog_muzzle.test.js`): every `type: 'beam'` row
carries `power`, `maxRange`, `chargeTime`, `corridorDeg`, `fireCooldown`, `weight`, `class`; **and no seeded
ship puts a beam in a group with any other mount** (walk `SHIPS[].stats.groups` × `mounts`; a group
containing a beam contains exactly that one mount). That second assertion is what keeps `fireMount` from
ever seeing a beam.

### S2 — `client/src/sim-core/beam.js` (new; the rules)

RNG-free, THREE-free, no `../` imports — `sim-core/boundary.test.js` enumerates the folder and will add
three passing guard tests for this file automatically (this is why the client count goes 551 → 554+).

Exports (signatures are load-bearing; the bodies below are **illustrative**, not literal — write real code
and let the unit tests decide it):

- `isBeamGroup(g)` — `(g.mounts || []).some(m => m.weapon && m.weapon.type === 'beam')`. **`some`, not
  `mounts[0]`**, so a mixed group can never fall through to the bullet path; S1's catalog guard makes sure a
  mixed group is never authored in the first place.
- `beamGroupOf(ship)` — the ship's beam group or `null` (the renderer asks this).
- `beamMuzzle(ship, fwd, out)` — `ship.pos + fwd * (ship.noseZ ?? 1.6) * (ship.scale || 1)`, the same
  derivation `fireMount` uses, writing into a caller-owned `Vec3`.
- `corridorEnds(ship, fwd, range, halfRad, outC, outL, outR)` — the three drawn endpoints. **One
  definition, used by the hit test, by the renderer and by the tests**, so the picture cannot drift from the
  rule.
- `inCorridor(ship, fwd, target, range, halfRad)` — **the hull-aware test.** A target is hittable when any
  part of it lies between the two drawn lines, within range. Exact, and built only from existing helpers:

  ```js
  // ILLUSTRATIVE. Reject on range first (muzzle→centre distance minus the target's broad radius),
  // then: the hull meets the centre segment, OR the hull meets either edge segment, OR the hull's
  // centre bearing is inside ±halfRad (the case where the ship sits wholly inside the wedge).
  segmentHitsShip(t, muzzle, endC) || segmentHitsShip(t, muzzle, endL) || segmentHitsShip(t, muzzle, endR)
    || Math.abs(shortestAngleDelta(ship.heading, bearing)) <= halfRad
  ```

  **Measure that fourth clause's `bearing` from the MUZZLE, not from `ship.pos`** — the wedge's apex is the
  muzzle, which is where `corridorEnds` draws all three lines from. The difference is ≤0.2°, but "the drawn
  lines are the hit test" is a promise this plan makes literally, and mixing two apexes breaks it on paper.

  Those three-plus-one cases are exhaustive for a convex wedge, and each one is literally "the drawn line
  touches the hull". Skip `warping` targets (§54) and dead ones.
  **Why this is a correctness requirement, not polish:** a ±2° corridor is *narrower than a ship* at most
  ranges — half-width 0.70 u at 20 u, 1.57 u at 45 u, 3.14 u at 90 u against a hull ~2 u across — so a
  centre-based test paints ships it cannot hit inside ~60 u. It also widens the lag budget from ±2° (only
  2× the 1.0° that §127's 100 ms interpolation delay costs at 90 u) to ~3.3°, which is what makes the
  weapon survivable in a server-run room without a D5 rewind.
- `beamCandidate(world, ship, fwd, side, range, halfRad)` — the **nearest** `inCorridor` hostile, measured
  muzzle→centre, ties broken by list order (deterministic). Hostiles: `world.enemies` for a friendly
  shooter; `[player, ...allies]` (alive) for a hostile one — mirroring `step-projectiles`. This is the one
  function the reticle, the charge-start lock and the release all call.
- `updateBeamGroup(world, ship, g, fwd, side, dt, wantsFire)` — the group's tick:
  - read `const w = g.mounts.find(m => m.weapon.type === 'beam').weapon` once; `range = w.maxRange`,
    `halfRad = (w.corridorDeg ?? 2) * Math.PI / 180`, `chargeTime = w.chargeTime ?? 0.5`,
    `cooldown = g.reload` (which `buildGroups` already set to the mount's `fireCooldown`);
  - `g.cooldown -= dt`; if `g.charge`, advance `g.charge.t`, drop a dead/warping lock, and at
    `t >= chargeTime` fire, clear the charge and set `g.cooldown = cooldown`; **return — a charge is never
    cancelled** (tap commits);
  - else if `g.cooldown <= 0 && wantsFire(g)`, start `g.charge = { t: 0, lock: beamCandidate(...) }` and
    emit `beamCharge` (fields in S4);
  - **never call `simRandom()`** — the player/ally paths must consume zero draws (§73).
- the discharge (module-private): target = `inCorridor(lock)` ? lock : `beamCandidate(...)`; the drawn shot
  runs muzzle → target hull (or muzzle → `fwd * range` into empty space).
  - friendly: `target.lastHitBy = side === 'ally' ? 'ally' : 'player'`, `applyShieldedDamage(target,
    w.power)`, emit `enemyShieldHit` when absorbed, emit `hit`;
  - hostile: `resolveHostileBulletHit(target, from, to, w.power, null)` — **`null` dodge roll on purpose**
    (§2b.6) — then the existing `shieldHit`/`enemyShieldHit` + `hit` emissions, and move the drawn endpoint
    to `res.impact` when the shield caught it.
    **Choose the `to` you hand the resolver so its own geometry re-test cannot disagree with `inCorridor`.**
    That resolver re-tests the segment itself (`collision.js:212` against the shield sphere, `:216` against
    the hull), so a segment that stops *at* the hull centre can miss a modeled ship whose origin happens to
    fall in a gap between OBBs — the corridor would say hit and the damage would silently not land. Pass
    `to = target.pos + normalize(target.pos - muzzle) * broadRadius(target)`, i.e. extend the ray one broad
    radius **past** the centre so it sweeps clean through the hull (and through the shield sphere, whose
    centre it also passes). The **drawn** endpoint stays `res.impact ?? target.pos` — the player sees the
    beam stop on the hull or on the bubble, not out the far side;
  - emit `beamFire` (S4) either way, hit or miss.

The spike's `client/src/sim-core/beam.js` is a good shape reference for the discharge branch — but it reads
`beamTuning`, tests the corridor against the hull centre, and paints with a bare centre line. All three are
wrong here.

### S3 — the one branch in the shared seam, and two `!== 'rocket'` fixes

**`client/src/sim-core/ship-entity.js:237`**, first statement inside `updateGroups`' loop:

```js
// A BEAM group has its own tick: a charge that spans ticks, and a hitscan instead of a projectile. A
// branch here rather than a fourth call site is what makes "any weapon on any ship" keep meaning what it
// means today — player, ally and enemy all get it, and a ship without one never takes this branch.
if (isBeamGroup(g)) { updateBeamGroup(world, ship, g, fwd, side, dt, wantsFire); continue; }
```

Nothing else in `updateGroups`/`fireMount` changes — DECISIONS §134's amendment forbids touching the shared
firing path, and this does not.

**`client/src/sim-core/step-ally.js:177` and `:186`** — narrow both from `type !== 'rocket'` to
`type === 'bullet'`:

```js
if (m.weapon && m.weapon.type === 'bullet' && m.weapon.projectileSpeed > best) best = ...  // gunSpeed
export const isBallistic = (g) => (g.mounts || []).some((m) => m.weapon && m.weapon.type === 'bullet');
```

**Why — and this is NOT enemy-beam scope, so do not delete it with §2d.** These two predicates are the
**ALLY's** aiming rule (`step-ally.js`, the wingman's fire predicate at `:388`), nothing to do with
enemies. **`isBallistic` is the load-bearing half:** an ally carrying a beam *and* a kinetic would otherwise
treat the beam group as ballistic and lead its aim by the *other* gun's projectile speed
(`g.mounts[0].weapon.projectileSpeed || bulletSpeed`, `:393`) — and a hitscan must never lead. The `gunSpeed`
half is **already** a no-op for beams (a beam row has no `projectileSpeed`, and `undefined > best` is
false); narrow it anyway so both read the same intent, but do not claim it fixes a bug. The wingman can be
handed the player's gear, so this is reachable today without arming a single pirate. **Provably neutral for
every shipped row** (every non-rocket weapon in the catalog is currently a bullet, so the two predicates are
identical), which the new test in S9 asserts. Export `isBallistic` so that test can reach it.

### S4 — events and the wire

**`client/src/sim-core/events.js`** — add to the catalogue comment (the parser at `room.test.js:122` reads
these lines, so the format matters — `//   { type: 'name', …`):

```
//   { type: 'beamCharge',      pos, dur, fromPlayer }                    a beam started charging (the
//                                                                       sight brightens over `dur` s)
//   { type: 'beamFire',        from, to, hit, absorbed, weaponClass, fromPlayer } the discharge itself
```

**No entity reference.** An earlier draft put the shooter on `beamCharge` so a client could draw a *remote*
shooter's corridor; that has exactly one consumer — the hostile sight — and it is deferred (§2d). The
queue keeps its single deliberate entity reference (`enemyShieldHit.enemy`). The player's own charge needs
no ref: the local ship is `world.player` on both paths.

**`server/src/netsim/protocol.js`**

```js
beamCharge:       ['pos', 'dur', 'fromPlayer'],
beamFire:         ['from', 'to', 'hit', 'absorbed', 'weaponClass', 'fromPlayer'],
```

- `EVENT_ENTITY_REFS` is **unchanged**.
- **`wireEvent` currently vec-serializes only a field literally named `pos`** (`:91`). Widen it to a set —
  `const VEC_FIELDS = new Set(['pos', 'from', 'to'])`. **Re-checked against the cut, and still needed:**
  the player's own `beamFire` does cross the wire in a room, and without this the two endpoints cross as
  whatever `JSON.stringify` makes of a `Vec3` *instance*. That happens to be `{x,y,z}` today only because
  the constructor assigns three own enumerable fields (`sim-core/vec.js:26`) — an implicit dependency on a
  class's field layout, in the one file whose stated job is to make what crosses the wire **explicit**. Two
  tokens in a `Set` buys that back, and S9 pins it.

**What must NOT go on the wire, and why the shape is this shape:** a charge is per-ship state that changes
every tick and an aiming corridor is per-ship geometry — neither is broadcast, now or when the enemy beam
arrives. **Two events per shot** (the start and the release) is the whole protocol. Nothing is added to
`COLUMNS`, nothing to the digest (`sim-core/digest.js` hashes transforms/counts/draws, not group state — so
hashes are untouched).

**`client/src/netsim-world.js:311` `hydrateEvent`** — rebuild `from`/`to` as real `Vec3`s the same way
`pos` is. The comment there explains why a bare `{x,y,z}` is a live bug rather than a style point: FX call
`.clone()` on positional fields, and the failure mode is a dead frame with a looping sound.

### S5 — the look: `client/src/beam-fx.js` (new) + the adapter

**Implement §2e exactly** — that section is the settled look, and the spike's `client/src/beam-fx.js` is the
working reference for every mechanism in it (dashed lines written through `lineDistance`, the additive-disc
muzzle bead and impact bloom, the diamond reticle, the event-driven charge clock). Keep its named objects —
`beamSightCentre` / `beamSightEdge` / `beamReticle` / `beamBolt` / `beamOrb` / `beamFlash` — so a headless
scenario asserts on *them*, not on "some line in the scene". Production changes on top of the spike:

1. **It draws the LOCAL PLAYER's sight, and nothing else** (§2d). Source: the player's own beam group,
   `beamGroupOf(world.player)` → an **always-on idle sight**, an aiming aid drawn whether or not the trigger
   is down. **This is a rendering scope, not a simulation scope** — no `side === 'player'` test appears
   anywhere in `sim-core`; the renderer simply only asks about one ship today, and the deferred hostile
   sight (§2d) becomes another entry rather than a rewrite.
2. **The charge clock is the event, not the group** (§2e): `startBeamCharge(ev.dur)` on `beamCharge`,
   advanced by `dt` each frame, cleared by `beamFire`. The lines themselves come from `world.player`'s
   transform either way, so single-player and a room draw the same thing.
3. **The five numbers the sight needs come from the weapon row**, read once per frame off
   `beamGroupOf(player).mounts[…].weapon` — `maxRange` and `corridorDeg` for the geometry, `chargeTime` as
   the fallback duration. **No `beamTuning` import exists to fall back on any more**; the spike's
   `beamTuning.range` / `corridorRad()` reads are exactly what dies with it.
4. **Geometry comes from `sim-core`** — `beamMuzzle` + `corridorEnds`, never re-derived here — and the
   reticle marks `beamCandidate(...)` (mid-charge: the committed lock), so what is circled is what will be
   hit.
5. **Pools sized for today, shaped for later.** One line-triple, one orb, one reticle, and ~4 bolt/bloom
   pairs round-robin (the spike's single bolt drops a second discharge that lands inside the 0.16 s fade).
6. **No lil-gui panel in production.** The spike exposed every look value on a slider because a
   look-and-feel feature can only be settled in flight; it has been settled (§2e), so the values are baked
   as module constants. `lil-gui` must not become a shipped import.
7. **Visibility remains an acceptance criterion, judged on the frame, not on `visible === true`.** The
   spike's first headless frame had a sight technically drawn and practically invisible against the
   station; the correction overshot into "too heavy" before landing on §2e's 0.22/0.38. On the screenshots
   from S9 the three lines must read against the dark sky **and** against a lit set-piece, and the green
   sight must be clearly distinct from the cyan-white discharge.

   **AMENDED 2026-08-25 — the "lit set-piece" half is KNOWINGLY NOT MET, and that is the maintainer's
   call.** Measured on `39-charge-beam__aiming.png`: against space the sight reads clearly (ΔG ≈ +19 on a
   `(27,37,49)` sky), but where it crosses Level 0's white station arm it samples `(237,250,241)` on
   `(255,255,255)` — not distinguishable as a line at all. This criterion and §2e's *"reproduce, do not
   improve"* are in direct conflict, because at 0.22 idle opacity nothing but a different TREATMENT can fix
   it. **Put to the maintainer on 2026-08-25, who chose to leave it as-is.** The reasons it is acceptable:
   the beam is a **Level-4 purchase** and Level 0's lit station is the one place in the game it is unlikely
   ever to be flown over, and the sight is an always-on aiming aid whose whole design constraint is that it
   must never compete with the fight. **If it is ever revisited, the fix is a contrast/outline treatment —
   a dark outline pass, or blend/depth so the line reads over bright geometry — NOT more opacity**, which
   would undo the "centre came down to meet the edges" decision §2e exists to record. Do not treat this as
   an open defect; it is a closed trade-off.

**`client/src/sim.js`**

- import `drawBeamSight`, `startBeamCharge`, `spawnBeamBolt`, `hideBeamFx`;
- in `applySimEvent`, beside `case 'fire':` (`:281`):
  - `case 'beamCharge':` → `startBeamCharge(ev.dur)` + audio (S8);
  - `case 'beamFire':` → `spawnBeamBolt(ev.from, ev.to)` + audio (S8);
  - the audio in both cases is gated on `ev.fromPlayer`, exactly as `case 'fire'` already gates it — only
    your own shots are audible (§2b.7). The **bolt** is drawn whoever fired it: a discharge is a visible
    event in the world, and drawing it costs nothing side-specific;
- in `renderTick`, after `drawDrops(grabTarget, dt)` (`:487`): `drawBeamSight(dt)` — a no-op when the player
  has no beam, but it must still age the bolt/bloom/charge transients so a discharge finishes fading even
  if the ship dies in the same instant;
- in `reset(...)`, beside `hideGrabLine()` (`:672`): `hideBeamFx()` — clear the sight, the charge clock and
  the transients so a fresh run never inherits a sight pointing into a fight that is over.

All of this is cosmetic and RNG-free, hence replay-neutral (DECISIONS §73).

### S6 — the shop: the slot, the stat line, the strings

**New `client/src/shop-slots.js` — extract the slot↔type rule into a pure, importable seam.**
`shop.js` imports `three` (`:9`, `:15`), so nothing in it can load under `node --test`; the slot rule is
**the player's only real path to this weapon** and would otherwise be verified by nothing (the `?beam` dev
flag injects weapon 12 straight into the loadout and bypasses the shop entirely — see S12.4). Move two
things out, unchanged in behaviour:

```js
// ILLUSTRATIVE. A weapon fire-group slot accepts one or more catalog weapon `type`s. The gun slot is the
// PRIMARY weapon slot: a bullet or a beam, never both at once (installing one replaces the other).
export const GROUP_WEAPON_TYPE = { gun: ['bullet', 'beam'], rocket: ['rocket'] };
export const isWeaponSlot = (slotKey) => !!GROUP_WEAPON_TYPE[slotKey];
export const slotAcceptsWeaponType = (slotKey, type) =>
  !!GROUP_WEAPON_TYPE[slotKey] && GROUP_WEAPON_TYPE[slotKey].includes(type);
```

`shop.js` imports these; `stashForSlot` (`:284-289`) filters weapons with `slotAcceptsWeaponType(slotKey,
n.type)` and keeps its component branch untouched. **Do NOT "fix" `equippedInSlot` (`:276`)** — it only
tests `GROUP_WEAPON_TYPE[slotKey]` for truthiness, and an array is truthy, so it works unchanged.
Unit test `client/src/shop-slots.test.js`: the gun slot accepts `'bullet'` **and `'beam'`**, rejects
`'rocket'`; the rocket slot accepts only `'rocket'`; a component slot key accepts nothing and
`isWeaponSlot` is false for it. That is the assertion that fails loudly if the beam is un-equippable.

**`client/src/shop.js`**

- `statLine` (`:48`, weapon branch at `:61`): a beam reads exactly

  `DMG 80 · Charge 0.5s · Arc ±2° · RoF 1.0/s · Range 90 · Weight 12`

  (the labels are the shipped source strings — `DMG`, `Range`, `Weight`, `RoF` at `source.json:266` — plus
  the two new ones below)

  — i.e. `s.type === 'beam'` adds `ui.shop.stat.charge` (`${s.chargeTime}s`) and `ui.shop.stat.arc`
  (`±${s.corridorDeg}°`), and the rate line becomes the **true cycle rate**
  `1 / (s.chargeTime + s.fireCooldown)` under the existing `ui.shop.stat.rof` label — **not**
  `1 / fireCooldown`, which would advertise 2.0/s for a weapon that fires once a second. Skip
  `ui.shop.stat.speed` (a hitscan has no projectile speed). The precedent for a type-aware stat line is the
  Triple spiral's `40×3` two lines above; the trap it exists to avoid is exactly this one.
- Check `slotLabel`'s source string for the gun slot — `client/locales/source.json:180` describes it as
  "the primary bullet weapon, fired with Space". Update the **context** note (and the English source if it
  says "bullet"; if the visible label is just "Gun", leave the label and fix only the context).

**`client/locales/source.json` + `client/locales/ru.json`** — two new keys, English source + a Russian
translation, alphabetically beside the other `ui.shop.stat.*` entries:

- `ui.shop.stat.charge` → source `"Charge"`, context "Stat label — the charged beam's charge time in
  seconds (followed by e.g. '0.5s'). Short."; ru `"Заряд"`.
- `ui.shop.stat.arc` → source `"Arc"`, context "Stat label — the charged beam's hit corridor as a
  half-angle (followed by e.g. '±2°'). Short."; ru `"Сектор"`.

The weapon's **name is a plain English DB string** (`WEAPONS[].name`), not an i18n key — no translation
needed, matching every other weapon.

### S7 — `client/src/beam-dev.js` (new): flying it before you can buy it

The beam is gated at `level-4` and costs 5500, so neither the maintainer's early playable build nor the
headless scenario can reach it through the shop. Follow `client/src/ally-dev.js` exactly for shape and for
the §81 rule (**URL only, never sticky, pure and unit-testable, an absent flag changes nothing**):

- `evalBeamDev(search)` → `null` | `true`; `?beam` / `?beam=1` / `?beam=true` = the player carries it,
  `?beam=0|false|off` or no param = off. **No `?beam=enemy`** — the spike's enemy half goes out with §2d.
- `beamLoadout(loadout)` — with the flag on, replace the `gun` mount's weapon id with 12; **returns the
  same object untouched with the flag off** (a strict no-op for every real player).
- Wire `beamLoadout` into `client/src/ship-build.js` `buildPlayerFor`, at the `buildPlayer({ ship, loadout,
  … })` call — the spike shows the call site.
- **No lil-gui panel.** The spike's slider existed only because the numbers lived in a shared object; they
  are per-row now, and §0a-bis settled them.
- Unit test `client/src/beam-dev.test.js` for `evalBeamDev` (mirrors `ally-dev.test.js`).

### S8 — audio: two clips from one CC-BY source, and the CREDITS row

Source (already saved + backed up to S3): `assets-src/sounds/843729__tannersound__scifi-laser-gun-shooting.wav`
— *Scifi Laser Gun Shooting* by **TannerSound**, https://freesound.org/s/843729/, **CC-BY 4.0**.

**The timing problem and the chosen route (brief §0d-bis): SPLIT THE CLIP.** The source is itself a
build-then-crack whose crack lands 0.39 s into the maintainer's chosen 2.86 s cut — 110 ms *before* our
0.5 s charge completes. Playing it whole would bang before the beam leaves the ship. So: two samples, the
second fired by the `beamFire` event, which is the only route that stays correct if `chargeTime` is ever
retuned and the one that matches the two-event wire shape the weapon already has.

**Use these commands verbatim — they are the spike's, already proven by ear in the maintainer's build.**
They deliberately carry **no `loudnorm`**. Normalising the two halves independently would push the quiet
swell (−35 → −18 dB) to the same integrated loudness as the −9 dB crack, destroying the build-then-crack
dynamic the split exists to create — a charge as loud as the shot, 0.5 s long, once a second, on the
player's own gun. The cut boundaries are §0e's (charge 2.860→3.250, crack 3.250→3.750, i.e. the discharge
plus its decay tail):

```bash
SRC=assets-src/sounds/843729__tannersound__scifi-laser-gun-shooting.wav
mkdir -p assets-dist/sounds && cd assets-dist/sounds
ffmpeg -v error -y -ss 2.860 -t 0.390 -i "$SRC" -ac 1 -ar 44100 -b:a 128k \
  -af "afade=t=in:st=0:d=0.006" beamCharge.mp3
ffmpeg -v error -y -ss 3.250 -t 0.500 -i "$SRC" -ac 1 -ar 44100 -b:a 128k \
  -af "afade=t=out:st=0.44:d=0.06" beamFire.mp3
for f in beamCharge beamFire; do
  H=$(shasum -a 256 $f.mp3 | cut -c1-8); mv $f.mp3 $f.$H.mp3
done
cd - && npm run assets:push   # → s3://…/sfx/ (and the wav source → source/)
npm run assets:pull           # brings the hashed mp3s into client/assets/sounds/ (gitignored)
```

**The acceptance check is RELATIVE, not absolute: the swell must be audibly QUIETER than the crack.** If
the charge ever needs trimming, the trim goes on `beamCharge`'s `SOUNDS` **`gain`** (a playback scale
applied per sound), **never** on a per-file `loudnorm` — a per-file normalise cannot express "quieter than
the other file" and silently equalises the two.

**The charge sample fills the charge window, whatever `chargeTime` says** (§2e). `audio.sfx.shoot(kind,
{ rate, gain })` exposes playback rate (`audio.js:187`), so play the charge clip at
`rate = BEAM_CHARGE_CLIP_SEC / chargeTime` with `BEAM_CHARGE_CLIP_SEC = 0.39` (the cut length above,
declared as a named constant beside the adapter case with a comment tying it to that cut). At the shipped
0.5 s that is `rate 0.78`. **Pass an explicit `rate` for the discharge too** (`rate: 1`): `sfx.shoot`
otherwise applies a random per-shot pitch jitter, and a timing cue must sound identical every time.
`beamCharge` carries `dur` for exactly this.

Registration:

- `SOUNDS` rows in `catalog_seed.js`: `{ key: 'beamCharge', url: 'assets/sounds/beamCharge.<hash>.mp3' }`
  and `{ key: 'beamFire', url: 'assets/sounds/beamFire.<hash>.mp3' }` (add a `gain` trim only if they sit
  loud against the existing library).
- `SOUND_MAP` rows: `{ entity: 'weapon', class: 'beam', event: 'charge', sound: 'beamCharge' }` and
  `{ entity: 'weapon', class: 'beam', event: 'fire', sound: 'beamFire' }`. `sound_map.event` is a free-text
  column (`server/src/db.js:329`), so `'charge'` needs no schema change; the table is rebuilt from the seed
  on every startup (`db.js:419-424`).
- Adapter (`sim.js`), both gated on `ev.fromPlayer` like every other weapon sound (§2b.7): `beamCharge` →
  `audio.sfx.shoot(sfxFor('weapon', 'beam', 'charge'), { rate: BEAM_CHARGE_CLIP_SEC / ev.dur })`;
  `beamFire` → `audio.sfx.shoot(sfxFor('weapon', ev.weaponClass, 'fire'), { rate: 1 })`.
- **`client/assets/CREDITS.md` — TWO edits, and the second is not optional.**
  1. the table row (asset cell **must** start with `sounds/`, which is how `credits-build.mjs` files it
     under sounds):
     `| sounds/beamCharge.\<hash\>.mp3 + sounds/beamFire.\<hash\>.mp3 (Charged beam charge + discharge SFX, cut from one source) | TannerSound | https://freesound.org/s/843729/ | CC-BY 4.0 | 2026-08-25 |`
  2. **the verbatim CC-BY attribution blockquote, in the `## Audio` section.** `deriveName()`
     (`scripts/credits-build.mjs:66-71`) **throws** for a `requiresAttribution` row with no blockquote —
     `credits:build` exits 1 and `credits-data.test.js` fails — because it takes the player-facing title
     from that line, matched to the row by **exact Source URL** via
     `TITLE_RE = /^\s*>\s*"([^"]+)"\s*\((https?:\/\/[^)]+)\)\s*by\b/`. Add, byte-for-byte (the URL identical
     to the table cell, no trailing text before `by`):

     ```
     > "Scifi Laser Gun Shooting" (https://freesound.org/s/843729/) by TannerSound is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).
     ```

     Also update the Audio section's prose, which currently says the sampled SFX layer is CC0: this is the
     **first CC-BY sound**, and its attribution must stay while the asset is in use.
  Then `npm run credits:build` to regenerate `client/src/credits-data.js` (`credits-data.test.js` is the
  drift guard; the check invocation is **`npm run credits:build -- --check`** — a bare `--check` is not
  forwarded through npm). The in-game Credits screen is how the CC-BY obligation is discharged to players.
  **Do NOT add a row or a blockquote for the unused railgun candidate.**

### S9 — tests

**`client/src/sim-core/beam.test.js`** (new — the bulk of the guard):

1. **Hull-aware corridor, both halves.** Geometry to build the case from, at **45 u** with a primitive
   target (no `hitBoxes` → `broadRadius` = the legacy 2.6): the corridor's half-width there is 1.57 u, so a
   hull whose centre is **more than 2.6 u** off the centre line does not touch that line, and one whose
   centre is **less than ~4.17 u** (1.57 + 2.6) off still overlaps the wedge. Put the target at **4° off
   the nose** (≈3.14 u lateral): its centre is outside ±2°, its hull misses the centre line, and it crosses
   an edge line → `inCorridor` **true**. Assert in the same test that the centre bearing *is* outside
   `halfRad`, so the test states the difference from a centre-based test rather than re-encoding the
   implementation. Same target at **10° off** (7.9 u lateral, well past 4.17) → **false**.
2. **Escape is real at the settled numbers.** A top-speed crosser (15.75 u/s → 7.9 u during the charge)
   starting on the centre line at 90 u ends ~5.0° off → not `inCorridor` at release.
3. **Paint ≡ corridor.** `beamCandidate` returns exactly the nearest ship `inCorridor` accepts; a ship the
   corridor rejects is never painted.
4. **Tap commits.** `wantsFire` true for one tick then false for the rest still discharges at
   `t >= chargeTime`, and applies `power` damage; the group is then locked out for `fireCooldown`.
5. **A lock that dies or warps mid-charge** drops to the current corridor candidate; with nothing in the
   corridor the shot still fires and damages nothing.
6. **Zero draws.** `simRandomDraws()` is unchanged across a full player-side charge + discharge (§73).
7. **No dodge, and the hostile path exists.** Drive `updateBeamGroup` with `side: 'enemy'` directly in the
   unit test — no enemy ship carries a beam in the catalog, but the code path is side-agnostic and must be
   proven so: a hostile beam against a player with `player.dodge = 100` still applies damage, and with a
   shield up is absorbed on the bubble (§76). **This is the test that keeps §2d cheap** — it is the
   evidence that arming a pirate later is a catalog edit plus rendering, not a simulation change. It is
   also the reason no `side === 'player'` branch may creep in: this test would go green while the feature
   silently became player-only.
8. **Numbers come from the row.** Two ships carrying beams with different `power`/`corridorDeg`/`maxRange`
   behave differently in the same world — the regression test for the deleted `beamTuning`.

**`client/src/sim-core/step-ally.test.js`** — add: `isBallistic`/`gunSpeed` ignore a beam mount (an ally
carrying beam + kinetic does not lead the beam group), **and** are unchanged for every bullet/rocket
combination (the S3 neutrality claim, asserted rather than asserted-in-prose).

**`client/src/beam-dev.test.js`** — `evalBeamDev` parsing (mirrors `ally-dev.test.js`).

**`client/src/shop-slots.test.js`** — the slot↔type rule extracted in S6: the gun slot accepts `'bullet'`
and `'beam'`, rejects `'rocket'`; the rocket slot accepts only `'rocket'`; a component slot accepts
nothing. **This is the only automated proof that the beam is equippable at all** (S12.4 walks the rest of
the path by hand).

**`server/src/catalog_beam.test.js`** — S1's two catalog guards.

**`server/src/netsim/room.test.js`** — beside "an entity reference becomes an id": `wireEvent` on a
`beamFire` emits `from`/`to` as plain `{x,y,z}` (the S4 widening) and leaks no entity graph. (The existing
catalogue-coverage test at `:122` fails loudly if either new type is missing from `EVENT_FIELDS` — do not
weaken it.)

**`client/src/netsim-world.test.js`** — push a wire `beamFire` through the snapshot path used by the
existing `enemyShieldHit` case (`:224`) and assert `from`/`to` come back as real `Vec3`s (not bare objects).

**`client/visual/scenarios/39-charge-beam.mjs`** (new — 38 is the highest live number; the spike's `40` is
throwaway). Boot `${baseURL}&beam`, dismiss the welcome screen, wait out the `#levelwarm` veil, then:

1. **it mounts** — the player's gun group holds a `type: 'beam'` mount;
2. **it is visible while aiming** — park a fully-formed enemy on the nose, `stepSim(1)`, and assert the
   named objects `beamSightCentre` (1) / `beamSightEdge` (2) / `beamReticle` (1) are `visible`;
   `shot('aiming')`;
3. **the look survived the port** (§2e) — assert the three sight lines share one material colour equal to
   `#5ad17f`, that all three are `LineDashedMaterial` with the centre's `dashSize` ≠ an edge's, and that
   the bolt's colour is `0xbfefff` — i.e. the sight and the shot are **not** the same hue. These are the
   values a careless port silently loses;
4. **it charges, discharges and damages** — hold `Space`, step ~120 sim steps, assert the group entered a
   `charge` that spanned ticks, peaked near 0.5 s, that `beamOrb` was visible mid-charge, and that the
   target lost hull. `shot('discharge')`. (Reach matters here: enemies spawn 70–130 u out and the beam
   reaches 90, so unlike the spike a target need not be teleported into range — park one anyway for
   determinism.)

**The scenario covers the player's beam only** (§2d): no enemy is armed, no hostile sight is asserted.
Use `__game.stepSim(n)` for time, never wall-clock waits.

### S10 — the determinism gates (capture the baseline FIRST, then compare)

**Before touching any code**, run both on the clean worktree and write the numbers down:

```
cd client && node visual/run.mjs 22-intro-replay     # expect tick=2474
cd client && node visual/run.mjs 36-sim-divergence   # expect hash=0x2a36f8d9, draws=38
```

The expected values above come from the **spike**, which is a different branch; if this worktree's baseline
differs, that is a pre-existing fact and chasing it as if it were your regression is expensive. Capture,
then re-run both after the change and compare against **your own** capture.
`22-intro-replay` **prints** the tick and does not assert it — read the line. Both must be unchanged, and
the plan expects them to be **by construction**: no shipped ship mounts a beam, so `isBeamGroup` is false
for every group in those runs, the new branch is never taken, `beam.js` never calls `simRandom`, and
`digest.js` gains no field. Verify rather than assume; if either moves, something outside the beam path was
touched.

### S11 — docs (CLAUDE.md docs-workflow: part of the change, not an afterthought)

- **`docs/SUMMARY.md`** (bump `**Updated:**`):
  - the weapons paragraph (~`:995-1012`) — the new row with its full stat block, the ladder placement, the
    stat line's exact text, the gun slot now accepting `bullet | beam`, the Kinetic-skill note, and one
    sentence stating that **no ship in the game carries a beam today: it is a player purchase** (a reader
    must not infer pirates have one);
  - **one sentence on mixed-group safety**, because it is a live trap for whoever adds the next player
    ship: `equipItem` replaces the **first** mount of the target group (`db.js:1025-1027`), so a ship with
    *two* gun mounts would end up with a beam in one and a kinetic in the other — `isBeamGroup`'s `some`
    routes that group down the beam path and the kinetic mount goes silent. Today no ship has two mounts in
    one group and `catalog_beam.test.js` asserts a beam group holds exactly one mount, which is the guard;
  - the look (§2e) belongs in the **Visuals** section, not only in the weapons list: green dashed sight,
    cyan-white discharge, the dash-flow charge animation, the diamond reticle;
  - "Firing is simulation, sound is not" (~`:3063`) — the beam group's own tick and the two events; the
    "only your own shots are audible" rule is **unchanged**, so say so rather than editing it;
  - the netsim/wire section — what crosses (two events, no entity ref, no per-tick charge, no snapshot
    column), plus the known room limitation in §5 below;
  - the client module layout (`:2962`) — `beam-fx.js`, `beam-dev.js`, `sim-core/beam.js`;
  - Audio (`:2273`) — the two new keys, the split clip, the first CC-BY sound;
  - Tests (`:3569`) — the new counts.
- **`docs/CHANGELOG.md`** — one bullet under `## 2026-08-25`, leading with a bold summary phrase, covering
  the weapon, its aiming corridor, the green dashed sight handing over to a cyan-white discharge, the CC-BY
  audio, the shop slot change, and one clause naming the deferred enemy beam plus its gate (so the history
  says why no pirate carries one).
- **`docs/DECISIONS.md` — new `## 135. A charged beam has a visible corridor, and that is why it is not the
  auto-aim §124 deleted`** (next free number; §134 is the last). Record, do not re-derive — the argument is
  the maintainer's, in brief §0a/§0a-bis:
  - a corridor *without* a lock **is** the deleted aim-assist cone; three things make this not that, and all
    three are on screen — the target is **named at charge start**, the **reticle shows which one**, and the
    **corridor is drawn for the whole 0.5 s** so the player watches a target leave it. §124's actual
    complaint was "the player cannot see it working or not working"; here, seeing it work is the mechanic.
    It is also why the weapon survives PvP, where an invisible lock reads as an aimbot;
  - the corridor is attached to the **nose at release**, so the drawn lines are the hit test, not an
    illustration of it — turning away breaks the shot, turning toward it tracks;
  - **the corridor's width is this weapon's lag compensation** (§127's 100 ms delay is 1.0° at 90 u; the
    hull-aware window is ~3.3°), which is why it needs no D5 rewind and why a hard lock would have
    re-created the 2026-08-19 spike's rejected-hit-report problem;
  - **the retraction:** the earlier claim that a beam dodge roll would break the recorded archive under §73
    was **wrong** (`dodgeRoll` is consulted only after a geometric connect and only from
    `step-projectiles.js`; no archived trace mounts a beam). The beam is undodgeable because **the corridor
    is the dodge** — RNG-free, and the drawn lines never lie;
  - **THE GATE (write it in full, it is the load-bearing half of this entry).** The weapon ships as a
    *player* purchase; no enemy carries one (maintainer, 2026-08-25). The simulation is nevertheless
    side-agnostic, with no `side === 'player'` branch anywhere, so arming a pirate stays a catalog edit —
    **but an enemy beam is a 0.5 s unanswerable hit unless its telegraph is on screen. Before any enemy is
    ever armed with one, two things must exist first: the hostile-sight rendering, and the wire entity
    reference that lets a client draw a remote shooter's corridor.** An aiming line the player never sees is
    not a warning, it is an unfair attack. Record with it, as input to that work, that a hostile's
    `ai.range` is a separate number from `maxRange` 90 and must be shorter (≈45–55), because the visible
    frame is ±57 u vertically and only ±32 u horizontally on a phone in portrait (`combat-ally.md` §2c(a)).
- **`docs/plans/charge-beam-weapon.md`** — a status line at the top pointing at this plan as the built
  version, so the request file is not read later as if still open.

### S12 — ship it

1. `cd client && npm test` and `cd server && npm test` green (server needs local Postgres; `npm test` drops
   and recreates `spacegame_test`).
2. Both determinism gates from S10 read the expected values.
3. `npm run assets:check` (the deploy guard — it verifies every `SOUNDS` url exists on S3; it will fail if
   `assets:push` was skipped) and `npm run credits:build -- --check` (note the `--`).
4. **WALK THE REAL PURCHASE PATH ONCE, BY HAND — the dev flag does not exercise it.** `?beam` injects
   weapon 12 into the loadout directly, so scenario 39 and the playable build both skip `shop.js`; the unit
   test in S6 covers the slot rule, and this covers the wiring around it. On the local server (`/run-local`,
   **port 4001** — 4000 is taken), against the local DB:
   `UPDATE players SET credits = 20000, current_progress = <the level-4 progress id> WHERE id = <your test player>;`
   then: open the hangar → **Charged beam is listed in the shop** (it is `minLevel`-gated, so this also
   proves the gate) → buy it → select the **gun** slot → **it appears in that slot's stash list** → install
   → the slot shows "Charged beam" → the stat line reads exactly
   **`DMG 80 · Charge 0.5s · Arc ±2° · RoF 1.0/s · Range 90 · Weight 12`** → launch and fire it.
5. **Playable build to the maintainer EARLY**, before polishing: this feature is almost entirely feel — and
   §2e's look values were settled by flying the spike, so the whole point is confirming they survived the
   port. URL `?beam&debug` (the flag is the only way to fly it before level 4 / 5500 credits).
6. Deploy to prod as usual, then **`/publish-itch`**. This is mandatory, not optional: the itch ZIP bundles
   `client/assets` but reads the catalog live from prod, so the two new content-hashed mp3 urls would 404
   on itch until the build is re-published (DECISIONS §37).

## 4. Tests — how to run

```
cd client && npm test                              # 551 today → 551 + 3 (sim-core boundary auto-guards for
                                                   #   beam.js) + beam/shop-slots/beam-dev/ally/netsim
cd server && npm test                              # 246 today + catalog_beam + the protocol case
npm run credits:build -- --check                   # from the repo ROOT; note the `--` (a bare --check is
                                                   #   not forwarded by npm and the check silently no-ops)
cd client && node visual/run.mjs 22-intro-replay   # READ the log: tick=2474 (vs YOUR pre-change capture)
cd client && node visual/run.mjs 36-sim-divergence # hash=0x2a36f8d9, draws=38 (same caveat)
cd client && node visual/run.mjs 39-charge-beam    # the new scenario
cd client && node visual/run.mjs 12-audio          # iterates SOUNDS and fetches every url — will FAIL
                                                   #   until the two mp3s are in client/assets/sounds/
cd client && node visual/run.mjs 37-netsim         # the room still boots with the new event types
```

Rakes (from the maintainer): `visual/run.mjs` takes **one** argument and the full suite does not finish on
this machine; the suite has a flaky baseline (~6 scenarios fail at baseline — judge by the reliably-passing
set and zero page errors); do not run suites while the maintainer is playing.

## 5. Replay / intro impact

Required check for any change that touches the sim's damage or collision path:

- **The recorded archive is untouched by construction.** The intro cutscene (`level-1` descriptor's
  `introTrace`) and every `?playback` trace re-run through the real `sim.update()`, but no ship in any
  recorded fight mounts a beam, so `isBeamGroup` is false for every group, the new branch never executes,
  and no new `simRandom()` draw exists on any path. `22-intro-replay` (tick=2474) and `36-sim-divergence`
  (hash `0x2a36f8d9`, 38 draws) are the guards — **run them and read the logs** rather than assuming.
- The two edits that touch *existing* code paths are (a) the one-line branch at the top of `updateGroups`'
  loop and (b) narrowing `gunSpeed`/`isBallistic` from `type !== 'rocket'` to `type === 'bullet'`. (b) is
  identical for every catalog row that exists today (every non-rocket weapon is a bullet) and S9 asserts it.
- All FX are cosmetic and RNG-free → replay-neutral (§73).
- **Known room behaviour, stated rather than hidden:** in a server-run room (`?netsim=1`, WIP, never
  deployed) `world.player` is still the locally-built ship — it keeps its `groups` and its transform is
  overwritten from each snapshot (`netsim-world.js:241-247`) — so the player's idle sight draws normally.
  What the client does *not* have is the ticked `g.charge`, because the sim runs server-side; the charge
  brightening therefore rides the `beamCharge` event (S5.1). The reticle's corridor scan runs over ghost
  enemies, which have transforms but not always hitboxes, so it falls back to the broad sphere — accurate
  enough for a sight, and deliberately not "fixed" (§30).

## 6. Docs to update — checklist

- [ ] `docs/SUMMARY.md`: weapons list (incl. "no ship carries one — it is a player purchase") ·
      mixed-group trap · firing/sound paragraph · Visuals (the §2e look) · netsim wire · client module
      layout · Audio · Tests · `**Updated:**` date
- [ ] `docs/CHANGELOG.md`: one bullet under `## 2026-08-25`
- [ ] `docs/DECISIONS.md`: **§135** (per S11, including the §73 retraction)
- [ ] `docs/plans/charge-beam-weapon.md`: status pointer to this plan
- [ ] `client/assets/CREDITS.md`: the TannerSound CC-BY table row **and** the verbatim attribution
      blockquote in `## Audio` (without it `credits:build` throws), then `npm run credits:build`

## 7. Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **THE ENEMY BEAM, ENTIRELY (§2d, maintainer's cut of 2026-08-25).** No `BEAM` AI preset, no beam on any
  enemy ship, no hostile sight, no `beamCharge` entity ref, no audible hostile charge, no `?beam=enemy`, no
  engagement-range tuning. **And the gate on top of it:** the hostile sight + the wire entity ref must be
  built *before* any enemy is ever armed — an aiming line the player never sees is not a warning. Not
  arming anyone is also what keeps the recorded archive provably untouched.
- **Level 5.** Nothing here is shaped around it; it is the next feature, and it must pass §2d's gate before
  its pirates carry a beam.
- **A shop/hangar 3D model for the beam** (needs a sourced asset + a CREDITS conversation) — §2b.9.
- **A charge-interruption mechanic**, a "charge spoiled" state, or a HUD charge bar: the trigger commits and
  the brightening sight *is* the charge readout (§0b).
- **Making the beam dodgeable**, or adding any RNG to it (§2b.6).
- **Rewriting the shared firing path**, touching bullet velocity inheritance, or any enemy-aim "fix" —
  §134's cancellation stands, and a hitscan sidesteps the flaw without it.
- **A per-tick charge broadcast, a snapshot column, or a D5 rewind** — the corridor's width is the lag
  compensation (§S4).
- **A dev tuning GUI / any shipped `lil-gui` import.** The behaviour numbers are settled and live in the
  weapon row (§2a); the look values are settled and baked as constants (§2e). The spike's sliders existed
  to settle them, and they are settled.
- **Re-tuning the look.** §2e is the maintainer's, arrived at by flying it. Reproduce, do not improve.
