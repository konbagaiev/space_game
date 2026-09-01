# Ship weight class — a first-class data axis, with ONE consumer (the explosion light)

**Feature id:** `2026-08-31-1515-ship-weight-class` · **Opened:** 2026-08-31
**Roadmap:** `docs/ROADMAP.md:383-402` ("Ship CLASS as a first-class axis")

## Goal

A ship's *mass tier* is currently unaskable. `stats.class` is the **sound** class (`fighter`/`capital`/
`player`, the `sfxFor('ship', class, …)` key) and `stats.role` mixes behaviour with size (`rocketeer`
describes what a hull carries, `medium` describes how big it is). So when the explosion-light work needed to
know how big a death was, it had nothing to ask and guessed from **`sizeScale` thresholds**
(`medAt: 1.4` / `bigAt: 2.2` in `client/src/engine-lights.js:185`) — numbers tuned against today's catalog
hull scales that will silently misclassify the first ship authored at 1.35.

This adds **`stats.weightClass`** to every ship row (`light` / `medium` / `heavy` / `ultraHeavy` / `station`),
a **`SHIP_CLASSES` table** that owns each class's blast profile, and rewires **exactly one consumer**: the
blast flash. Player-visible effect: **none, deliberately** — every one of the 10 catalog ships must produce a
byte-identical explosion light after the change. What changes is that the classification is now *stated by
data* instead of inferred from a scale number, and adding a class (including a hybrid one later) is a new row
in one table, never an edit to an `if`/`switch` in consumer code.

Scope is **data field + one consumer**. Everything else on the roadmap ladder (migrating `role`, reward/XP
curves, equipment restrictions) is a later iteration and is listed under Non-goals.

---

## Verified facts this plan rests on

Checked against the source in this worktree — do not re-derive, but do not silently contradict either.

1. **`sizeScale` = `stats.model.scale`**, resolved by `shipModelCfg` (`client/src/sim-core/ship-config.js:31`).
   The 10 catalog ships and their classification **today**:

   | ship (SHIPS row) | `role` | `model.scale` | today's tier | new `weightClass` |
   |---|---|---|---|---|
   | Basic player ship | `player` | 1.1 | small (`ship`) | **light** |
   | Basic pirate ship | `fighter` | 1.0 | small | **light** |
   | basic rocket pirate | `rocketeer` | 1.0 | small | **light** |
   | pirate gunner | `pirate_gunner` | 1.0 | small | **light** |
   | advanced rocket pirate | `advanced_rocket_pirate` | 1.0 | small | **light** |
   | pirate lancer | `pirate_lancer` | 1.0 | small | **light** |
   | pirate mini boss | `medium` | 2.0 | medium (`med`) | **medium** |
   | advanced medium pirate | `advanced_medium_pirate` | 2.0 | medium | **medium** |
   | first pirate boss | `boss` | 3.0 | boss | **heavy** |
   | second pirate boss | `boss2` | 3.0 | boss | **heavy** |

   No ship sits near a threshold (nearest gap: 1.1 vs `medAt` 1.4), so this mapping reproduces today exactly.
2. **Only two call sites consume the blast tiers**: `client/src/projectiles.js:197` (`spawnShipExplosion`) and
   `:223` (`spawnBossExplosion`). Both receive a bare `sizeScale` today, so the class has to be *plumbed to
   them*. `projectiles.js:264` (`spawnRocketBurst`) uses `BLAST.rocket`/`BLAST.reachRocket`, which are **not**
   a ship class (R1).
3. **`engine-lights.js` imports `three` and `./engine.js`** (`:32-34`) → `node --test` cannot import it. The
   classifier must move to a three-free module or the required regression guard cannot exist.
4. **The netsim wire drops unknown event fields.** `wireEvent` (`server/src/netsim/protocol.js:109`) copies
   only the fields whitelisted in `EVENT_FIELDS` (`kill` at `:71`, `allyDown` at `:74`). A new `weightClass`
   on the event is **silently dropped in a room** unless it is added there.
5. **The catalog reaches the client whole**: `db.js:818` selects `stats` as-is, and ships upsert
   `ON CONFLICT (name) DO UPDATE SET stats = EXCLUDED.stats` (`db.js:365`) — so prod picks the field up on
   deploy, **no migration, no DB change**.
6. **Server may import client code at runtime.** `server/src/sim-host.js:21-28` and
   `server/src/netsim/protocol.js:96` already do, and the Dockerfile copies `client/` into the image
   (`Dockerfile`, `COPY client ./client`). A `catalog_seed.js` → `client/src/sim-core/ship-classes.js` import
   is safe in the container.
7. **The divergence digest is an explicit field list** (`client/src/sim-core/digest.js` `worldDigest`) — it
   hashes `pos/vel/heading/hp/_shieldValue/spawnAge/…`, not "every property". Adding `weightClass` to an
   entity changes no digest.
8. **The Space Factory is not a ship.** It is a `.glb` set-piece (`makeStationModel` at
   `client/src/world.js:1236`, its length table `STATION_LEN` at `:1234`, the `space-factory` case at
   `:1276`) plus a map anchor (`sim-core/system-map.js:246`). There is no `station` SHIPS row and
   this plan does not invent one.

---

## Decisions (settled — do not re-ask)

- **D1 — the class table (maintainer, overruling the planner's first draft).** Both bosses are **`heavy`**.
  `ultraHeavy` is **declared but unused**; `station` is **declared but unused**. Table above is final.
- **D2 — where the table lives.** New three-free module **`client/src/sim-core/ship-classes.js`**, imported by
  `server/src/catalog_seed.js` and by the client blast code. It cannot live in `server/` because the browser
  bundle never imports from `server/` (DECISIONS §136).
- **D3 — the class row OWNS its blast numbers** (maintainer, overruling the planner's "class names a tier"
  default). `power` / `reach` / `durMul` move out of the flat `BLAST` object into the class rows.
- **D4 — the testable seam.** `BLAST` + the blast functions move to a pure **`client/src/blast.js`**, which
  `engine-lights.js` re-exports so `projectiles.js:20` and `tune.js:11` keep working unchanged. New unit test
  `client/src/blast.test.js` reads the real `server/src/catalog_seed.js` SHIPS (verified: `node -e "import(…)"`
  from `client/` loads it fine — it only pulls in `enemy_total.js`).
- **D5 — `station` is declared with a documenting comment**; future fields (expected mass band, reward/XP
  curve, allowed mounts) are a **comment block, not empty/null keys** (DECISIONS §30).
- **R1 — the rocket tier is not a class.** `BLAST.rocket`, `BLAST.reachRocket` and the shared base
  `BLAST.dur` stay in `BLAST`. Only per-tier `power`/`reach`/`durMul` move into class rows.
- **R2 — the `?tune` "Blast flashes" folder is GENERATED by iterating `SHIP_CLASSES`.** Adding a class row
  must make its sliders appear with no edit to `tune.js`. One slider range per field, reused for every class:
  power `0–6000` step `50`, reach `5–400` step `1`, duration multiplier `1–12` step `0.25`.
- **R3 — an unused class carries NO blast block.** Only `light`/`medium`/`heavy` have one. `ultraHeavy` and
  `station` are declared **without** one; the resolver falls through to the documented fallback for them and
  never throws or reads `undefined` into a light. Do not duplicate the heavy numbers into three rows. The
  generated tuner folder skips blockless classes.
- **R4 — `medAt`/`bigAt` stay in the tuner but are relabelled as fallback-only.** After this change they
  affect no catalog ship; an unlabelled slider that does nothing is a trap.
- **R5 — the `?tune` test range clears `weightClass`** on the frozen targets it spawns (the `e.sizeScale`
  line is `tune.js:183`), so
  the rig keeps faking hull sizes through `sizeScale` and keeps exercising the fallback path by hand.
- **R6 — resolution order, stated in the plan AND in a code comment:**
  **resolvable `weightClass` with a blast block → else `isBoss` → else the `sizeScale` thresholds.**
  Note `projectiles.js:223` passes `isBoss = true` unconditionally from the call site, so the two paths must
  be *verified* to agree for the two bosses, not assumed (they do: at scale 3.0 the fallback returns `heavy`
  with `isBoss` either way — the test asserts it).
- **R7 — the size multiplication stays at the call site.** `blastPower(...) * s * s` and `blastReach(...) * s`
  in `projectiles.js:197/223` are unchanged: **the class chooses the base, size still scales it.** Asserted
  explicitly in the test.

---

## Steps

### Step 1 — new module `client/src/sim-core/ship-classes.js`

Three-free, pure data. Exact content (header comment matters — it is the documentation for the axis):

```js
// SHIP WEIGHT CLASSES — how heavy a hull is, as data.
//
// A ship already carried two class-ish fields and neither could answer "how big is this?":
//   • `stats.class`  is the SOUND class (`sfxFor('ship', class, …)`) — fighter / capital / player.
//   • `stats.role`   is BEHAVIOUR, with size smuggled in (`rocketeer` = what it carries, `medium` = how big).
// `weightClass` is the missing third axis and is orthogonal to both. It is set on the ship row
// (`stats.weightClass`, server/src/catalog_seed.js) and travels with the entity.
//
// EXTENSIBLE BY DATA, and that is a requirement, not a nicety: adding a class — including a later hybrid —
// must mean adding a ROW here and setting the field on a ship. No consumer may switch/if-ladder on the class
// name. Every consumer resolves a row and degrades to its documented fallback when it cannot (see blast.js).
//
// A class row may declare a `blast` block { power, reach, durMul } — the explosion-light profile, the ONE
// consumer wired in this iteration (client/src/blast.js). The numbers are the ones the flash was dialed to
// on the live test range; `power` is candela × size², `reach` is world units × size (a HARD cutoff), and
// `durMul` multiplies the shared base flash length `BLAST.dur`.
//
// A row WITHOUT a `blast` block is legal and means "declared, not tuned yet" — the resolver falls back to the
// old sizeScale thresholds for it. Do not copy another class's numbers in to fill the hole.
//
// ROOM FOR LATER, deliberately NOT stubbed as empty keys (DECISIONS §30 — a null key is not a design):
//   • expected mass band (what a hull of this class should weigh) — would let the shop flag an outlier;
//   • reward/XP curve per class, so payout follows mass instead of a hand-set number per ship;
//   • which weapons/equipment a class may mount (the shop/loadout predicate). NOT wired in this iteration.
export const SHIP_CLASSES = {
  light:      { blast: { power: 800,  reach: 45,  durMul: 2 } }, // scouts/fighters — the 1.0-scale hulls
  medium:     { blast: { power: 1400, reach: 70,  durMul: 3 } }, // the 2.0-scale capitals (mini boss, advanced medium)
  heavy:      { blast: { power: 2400, reach: 110, durMul: 5 } }, // both campaign bosses (3.0 scale)
  ultraHeavy: {},  // declared, nothing wears it yet: the ladder's top rung, reserved for a hull above a boss.
  station:    {},  // declared: an immobile set-piece, not a hull. The Space Factory is a world.js model
                   // (`makeStationModel`, STATION_LEN['space-factory']), NOT a ships row — nothing carries
                   // this class today, and this plan does not invent a row for it.
};
```

### Step 2 — new module `client/src/blast.js` (the pure seam)

Move `BLAST` and the four blast functions out of `client/src/engine-lights.js:174-208` **verbatim in
behaviour**, minus the per-tier numbers which now live in `SHIP_CLASSES`. Keep the existing explanatory
comments (they are load-bearing: candela/1-over-d², "reach is what makes it feel big", the single-classifier
rule). Add the resolution order (R6).

```js
// THE BLAST TIERS + THE SINGLE CLASSIFIER — three-free on purpose.
// It lived in engine-lights.js, which imports three, so nothing could unit-test it. Nothing here touches a
// light, a mesh or the scene: it answers "how bright, how far, how long" and engine-lights does the rest.
import { SHIP_CLASSES } from './sim-core/ship-classes.js';

export const BLAST = {
  // The ROCKET detonation. NOT a ship class and must never become a pseudo-class row: it is a weapon's
  // blast, sized from the weapon's own `blastVisual` (see spawnRocketBurst).
  rocket: 400, reachRocket: 30,
  dur: 0.44,            // the BASE flash length, shared; every class multiplies it by its `durMul`
  // FALLBACK ONLY, in sizeScale. Used when a ship carries no resolvable weightClass — an old recorded
  // trace, a netsim payload from an older server, or the ?tune test range faking a hull size by hand.
  // No catalog ship reaches these any more; the class table decides (see blastClass).
  medAt: 1.4, bigAt: 2.2,
};

// THE SINGLE CLASSIFIER. Power, reach and duration all read their tier from here, so a hull can never be
// "medium" for one of them and "small" for another — the kind of drift that makes a later re-tune produce a
// result nobody can explain.
//
// RESOLUTION ORDER, and it is the contract:
//   1. a `weightClass` that resolves to a class row WITH a blast block  → that class;
//   2. else `isBoss` (the entity's role) → heavy: a real boss must never be demoted by a modest scale;
//   3. else the sizeScale thresholds above — the pre-weightClass placeholder, kept for data that predates
//      the field (recorded traces, an older server's wire, the ?tune rig).
// An unknown or blockless class NEVER throws: it simply falls through to 2/3.
export function blastClass(sizeScale = 1, isBoss = false, weightClass = null) {
  const row = weightClass ? SHIP_CLASSES[weightClass] : null;
  if (row && row.blast) return weightClass;
  if (isBoss || sizeScale >= BLAST.bigAt) return 'heavy';
  if (sizeScale >= BLAST.medAt) return 'medium';
  return 'light';
}
const profileOf = (c) => SHIP_CLASSES[c].blast;   // total: blastClass only ever returns a class WITH a block
export function blastPower(sizeScale = 1, isBoss = false, weightClass = null) {
  return profileOf(blastClass(sizeScale, isBoss, weightClass)).power;   // × size² at the call site (R7)
}
export function blastReach(sizeScale = 1, isBoss = false, weightClass = null) {
  return profileOf(blastClass(sizeScale, isBoss, weightClass)).reach;   // × size at the call site (R7)
}
export function blastDurMul(sizeScale = 1, isBoss = false, weightClass = null) {
  return profileOf(blastClass(sizeScale, isBoss, weightClass)).durMul;  // × BLAST.dur at the call site
}
```

Note the returned tokens change from `'ship' | 'med' | 'boss'` to the class names `'light' | 'medium' |
'heavy'`. Nothing consumes the return value today (grep confirms: `blastClass` is called only inside these
functions), but SUMMARY prose does — see Docs.

### Step 3 — `client/src/engine-lights.js`: delete the moved block, re-export, fix one default

1. Delete `export const BLAST = {…}` (`:174-186`) and the four functions (`:192-208`).
2. Add near the other imports (`:32-35`):
   ```js
   // The blast tiers + classifier live in a three-free module so they can be unit-tested (blast.js).
   // Re-exported here because this is the import path every consumer already uses.
   export { BLAST, blastClass, blastPower, blastReach, blastDurMul } from './blast.js';
   import { BLAST, blastReach } from './blast.js';
   ```
3. **`addFlash`'s default reach breaks** — `:213` currently reads
   `reach = BLAST.reachShip`, and `reachShip` no longer exists (it is `SHIP_CLASSES.light.blast.reach` now).
   Change the default to `reach = blastReach()` (no args → light's base, 45 — identical to today) and keep a
   short comment saying so. The default is in fact **unreachable today** — all three callers
   (`projectiles.js:197`, `:223`, `:264`) pass `reach` explicitly — so this is a correctness fix on a
   dormant path, not a live regression. Make it anyway: leaving `BLAST.reachShip` there would be a dangling
   reference to a constant that no longer exists, and the first caller to omit `reach` would light nothing.

### Step 4 — `server/src/catalog_seed.js`: the field on all 10 rows + a load-time guard

Add `weightClass` to each ship's `stats`, on the same line as `role`/`class` so the three axes read together.
Exact anchors (the `role:` line of each row):

| line | edit |
|---|---|
| `:458` | `role: 'player', class: 'player', weightClass: 'light',` … (keep `color`/`nameKey` as-is) |
| `:471` | `role: 'fighter', class: 'fighter', weightClass: 'light',` … |
| `:481` | `role: 'rocketeer', class: 'fighter', weightClass: 'light',` … |
| `:503` | `role: 'pirate_gunner', class: 'fighter', weightClass: 'light',` … |
| `:512` | `role: 'medium', class: 'capital', weightClass: 'medium',` … |
| `:528` | `role: 'boss', class: 'capital', weightClass: 'heavy',` … |
| `:548` | `role: 'advanced_medium_pirate', class: 'capital', weightClass: 'medium',` … |
| `:564` | `role: 'boss2', class: 'capital', weightClass: 'heavy',` … |
| `:587` | `role: 'advanced_rocket_pirate', class: 'fighter', weightClass: 'light',` … |
| `:618` | `role: 'pirate_lancer', class: 'fighter', weightClass: 'light',` … |

Extend the SHIPS header comment (`:442-451`, the "`stats` carry role/color + groups + mounts" paragraph — the array itself opens at `:452`) with
one sentence: *"`weightClass` is the ship's MASS tier (`client/src/sim-core/ship-classes.js`) — a third axis,
orthogonal to `role` (behaviour) and `class` (sound)."*

Then, immediately after the `SHIPS` array closes (`:624`), add the guard that makes the import load-bearing (the import itself goes at the top of the file, next to `import { enemyTotalFromPhases } from './enemy_total.js';` at `:1`):

```js
import { SHIP_CLASSES } from '../../client/src/sim-core/ship-classes.js';
…
// Every ship states its mass tier, and it must be a DECLARED class — a typo here would otherwise degrade
// silently to the sizeScale fallback and nobody would see it. Fails at module load, i.e. at server boot and
// in every test that touches the seed.
for (const s of SHIPS) {
  if (!SHIP_CLASSES[s.stats.weightClass]) {
    throw new Error(`ship "${s.name}": unknown stats.weightClass ${JSON.stringify(s.stats.weightClass)}`);
  }
}
```

(The import path `../../client/src/sim-core/…` from `server/src/` is the one `sim-host.js:21` already uses,
and the Dockerfile copies `client/` into the image, so this is safe in production.)

### Step 5 — carry `weightClass` through the entity pipeline

Same shape as `role`/`class` travel today. Do **not** touch `stats.class` or `role` anywhere (Non-goals).

1. `client/src/sim-core/ship-entity.js:88` (`makePlayer`) — next to the sound-class line:
   ```js
   class: s.class,                   // sound class (DB) → drives explode/hit SFX via sfxFor('ship', class, …)
   weightClass: s.weightClass,       // MASS tier (ship-classes.js) → picks the death-blast profile
   ```
2. `client/src/sim-core/ship-entity.js:136` (`makeEnemyShell`) — add to the same line as `role`/`class`.
   (Re-verified against the source: `const e = {` is `:134`, `name: shipDef.name,` is `:135`, and
   `role: s.role, class: s.class, color: s.color, sizeScale: mc.scale, …` is `:136` — a review note put it at
   `:135`; it is `:136`. Anchor on the `role: s.role` text, not the number, if they ever disagree again.)
   ```js
   role: s.role, class: s.class, weightClass: s.weightClass, color: s.color, sizeScale: mc.scale, …
   ```
   The ally inherits it for free: `makeAlly` (`sim-core/ally.js:19`) builds through `makePlayer` from the
   player ship row.
3. `client/src/sim-core/step-enemies.js:136` — add to the `kill` event payload (the emit opens at `:134`,
   `type: 'kill'` is `:135`, and `sizeScale … shipClass: e.class,` is `:136`)
   (`weightClass: e.weightClass ?? null,` after `shipClass: e.class,`). `?? null` matters: the `?tune` rig
   nulls the field on purpose (R5), and an old DB row simply has none.
4. `client/src/sim-core/step-ally.js:436` — same field on the `allyDown` payload.
5. `client/src/sim-core/events.js:48-49` — update the two event docs lines to list `weightClass`.
6. `server/src/netsim/protocol.js:71` and `:74` — **add `'weightClass'` to `EVENT_FIELDS.kill` and
   `EVENT_FIELDS.allyDown`.** Without this the field is stripped by `wireEvent` (`:109`) and a ghost death in
   a server-run room silently classifies by the fallback. (`room.test.js:127` only checks that every event
   *type* is present, so it will not catch a missing field.)
7. `server/src/netsim/room.js:124` — add `weightClass: e.weightClass` to the **enemy** `describe()` payload,
   next to `role`/`sizeScale`. **For wire symmetry, unread today**, and say so in the comment: the client
   never reads `desc.role`/`desc.sizeScale`/`desc.shipClass` either — `spawnGhost`
   (`client/src/netsim-world.js:118-135`) rebuilds the enemy through `makeEnemyShell` from the client's own
   catalog, so the ghost already gets `weightClass` for free. It is the *event* fields in 5.6 that are
   load-bearing, not this. The maintainer scoped this line in, so keep it — but do not justify it as
   something the client depends on. The ally branch (`:129`) needs nothing (same reason: `makeAlly` +
   catalog). `room.test.js` asserts only that `hitBoxes` never appears — no descriptor key-set assertion —
   so this is additive and safe.

### Step 6 — plumb it into the two explosion entry points (`client/src/projectiles.js`)

**Hazard: this is a positional-argument change.** `spawnShipExplosion` currently ends with
`ringY = BULLET_PLANE_Y`, and `client/src/ghost-battle.js:107` passes `_wp.y` in that 4th slot. Insert
`weightClass` **before** `ringY` and fix that one call, rather than appending a 5th parameter and sprinkling
`undefined` at three call sites.

1. `:193`:
   ```js
   export function spawnShipExplosion(pos, exhaustColor = 0xff8030, sizeScale = 1, weightClass = null, ringY = BULLET_PLANE_Y) {
   ```
   `:197` becomes (note `false` for `isBoss` — this is the non-boss path; and R7's `* s * s` / `* s` are
   untouched):
   ```js
   const w = weightClass;
   addFlash(pos, blastPower(s, false, w) * s * s, exhaustColor, BLAST.dur * blastDurMul(s, false, w), blastReach(s, false, w) * s);
   ```
2. `:221`:
   ```js
   export function spawnBossExplosion(pos, exhaustColor = 0xff8030, sizeScale = 1, weightClass = null) {
   ```
   `:223`:
   ```js
   addFlash(pos, blastPower(s, true, weightClass) * s * s, exhaustColor, BLAST.dur * blastDurMul(s, true, weightClass), blastReach(s, true, weightClass) * s);
   ```
3. `client/src/ghost-battle.js:107` — insert the new slot:
   ```js
   s.mesh.getWorldPosition(_wp); spawnShipExplosion(_wp, GHOST_EXHAUST, GHOST_TUNE.scale, null, _wp.y);
   ```
   (The base-scene ghosts are decorative and carry no catalog identity → `null` → fallback, as today.)
4. `client/src/projectiles.js:264` (`spawnRocketBurst`) — **unchanged** (R1).

### Step 7 — the FX call sites (`client/src/sim.js`)

- `:359` (`allyDown`): `spawnShipExplosion(ev.pos, ev.exhaustColor, ev.sizeScale, ev.weightClass);`
- `:374` (`kill`, boss): `spawnBossExplosion(ev.pos, ev.exhaustColor, ev.sizeScale, ev.weightClass);`
- `:375` (`kill`, non-boss): `spawnShipExplosion(ev.pos, ev.exhaustColor, ev.sizeScale, ev.weightClass);`
- `:456` (player `death`): `spawnShipExplosion(G.player.pos, G.player.engine.exhaust.color, 1, G.player.weightClass);`
  — the hardcoded `1` stays (it is what ships today); the player is `light`, and even at its real 1.1 scale
  the fallback also says light, so the flash is unchanged either way.

Do **not** touch the `louderBoom` role list at `:377` — audio is out of scope.

### Step 8 — `client/src/tune.js`: generate the folder from the table (R2/R4/R5)

1. Imports (`:11`): keep `BLAST` from `./engine-lights.js` and add
   `import { SHIP_CLASSES } from './sim-core/ship-classes.js';`
2. Replace the nine hardcoded per-tier sliders (`:120-133`) with the generated loop, keeping the rocket tier,
   the shared base duration and the two fallback thresholds as explicit `BLAST` sliders:
   ```js
   // POWER: the useful band is small — at 10 units, 100 candela is already full white. Past ~1000 you are
   // only clipping harder, which is why 8000 and 60000 looked identical.
   b.add(BLAST, 'rocket', 0, 1500, 10).name('power: rocket');
   b.add(BLAST, 'reachRocket', 5, 120, 1).name('reach: rocket');
   b.add(BLAST, 'dur', 0.05, 2.0, 0.01).name('duration BASE (s)');
   // PER WEIGHT CLASS, GENERATED FROM THE TABLE (sim-core/ship-classes.js). Adding a class row there makes
   // its three sliders appear here with no edit — that is what "extensible by data" has to mean at the one
   // place the maintainer would feel it. A class with no blast block is not tuned yet and gets no sliders.
   // REACH is the knob that makes a boss detonation feel big: it decides how far a hull can be and still be
   // lit at all (a hard cutoff). Power cannot buy reach.
   for (const [id, cls] of Object.entries(SHIP_CLASSES)) {
     if (!cls.blast) continue;
     b.add(cls.blast, 'power', 0, 6000, 50).name(`power: ${id} (× size²)`);
     b.add(cls.blast, 'reach', 5, 400, 1).name(`reach: ${id} (× size)`);
     b.add(cls.blast, 'durMul', 1, 12, 0.25).name(`× duration: ${id}`);
   }
   // FALLBACK ONLY: no catalog ship reaches these any more (every ship states its weightClass). They still
   // decide the tier for data that predates the field — old traces, an older server's wire, and the frozen
   // test range below, which nulls the class on purpose.
   b.add(BLAST, 'medAt', 1.0, 3.0, 0.1).name('fallback only: size ≥ this = medium');
   b.add(BLAST, 'bigAt', 1.0, 4.0, 0.1).name('fallback only: size ≥ this = heavy');
   ```
   Live dragging still works because the sliders mutate the same `cls.blast` object the resolver reads.
   Layout note: sliders are now grouped per class (power/reach/duration together) instead of all-powers-then-
   all-reaches. That is a deliberate consequence of generating them.
3. Test range — right after `e.sizeScale = (e.sizeScale || 1) * k;` at `:183`:
   ```js
   // The rig fakes hull SIZE. Keeping the ship's real weightClass would pin every rank to its catalog tier
   // and the three rows would flash alike; nulling it routes them through the sizeScale fallback, which is
   // exactly the path this rig exists to eyeball.
   e.weightClass = null;
   ```
   Extend the "THREE fields, and each one does a different job" comment block (`:174-180`) to say four.
4. The three `▶ test … blast` buttons (`:197-199`) stay as they are: 3 positional args, `weightClass`
   defaults to `null` → the fallback, i.e. exactly what they show today (1.0 → light, 1.8 → medium,
   2.4 + `isBoss` → heavy).

### Step 9 — the regression guard: `client/src/blast.test.js` (new)

Runs under `cd client && node --test` (no Postgres, no browser). Imports the **real** seed.

```js
// The weight-class axis is only worth having if it cannot rot: this fails if a ship loses its class, if a
// class row loses its blast block, or if the data-driven classification stops agreeing with the numbers the
// flash was dialed to. See docs/plans/2026-08-31-1515-ship-weight-class.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SHIPS } from '../../server/src/catalog_seed.js';
import { SHIP_CLASSES } from './sim-core/ship-classes.js';
import { shipModelCfg } from './sim-core/ship-config.js';
import { BLAST, blastClass, blastPower, blastReach, blastDurMul } from './blast.js';
```

Cases:

1. **Every ship states a declared class.** For each `SHIPS` row: `stats.weightClass` is a string and a key of
   `SHIP_CLASSES`. (Belt-and-braces with the seed-load guard from Step 4 — this one names the ship in the
   failure.)
2. **Every ship's class is actually TUNED.** `SHIP_CLASSES[stats.weightClass].blast` exists — otherwise the
   ship would silently fall back to the thresholds, which is precisely the trap this feature removes.
3. **A class row is all-or-nothing.** For each row: either no `blast`, or a `blast` with all three of
   `power`/`reach`/`durMul` as finite numbers. (Deliberately does *not* assert that `ultraHeavy`/`station`
   stay empty — tuning them later must not require editing this test.)
4. **THE BYTE-IDENTICAL GUARD — the golden table.** For each ship, with `s = shipModelCfg(stats).scale` and
   `isBoss = stats.role === 'boss' || stats.role === 'boss2'`, compute the three numbers exactly as
   `projectiles.js` does — `peak = blastPower(s, isBoss, w) * s * s`, `reach = blastReach(s, isBoss, w) * s`,
   `dur = BLAST.dur * blastDurMul(s, isBoss, w)` — and compare against this frozen table (today's values):

   | ship | s | peak | reach | dur |
   |---|---|---|---|---|
   | Basic player ship (call site passes s = 1) | 1 | 800 | 45 | 0.88 |
   | Basic pirate ship / basic rocket pirate / pirate gunner / advanced rocket pirate / pirate lancer | 1.0 | 800 | 45 | 0.88 |
   | pirate mini boss / advanced medium pirate | 2.0 | 5600 | 140 | 1.32 |
   | first pirate boss / second pirate boss | 3.0 | 21600 | 330 | 2.2 |

   Compare with a small epsilon on `dur` (0.44 × 2 is exact in binary, 0.44 × 3 is not).
5. **The class-driven answer equals the OLD sizeScale answer, per ship, on both paths (R6).** For each ship:
   `blastClass(s, isBoss, w) === blastClass(s, isBoss, null)` **and** `blastClass(s, false, w) ===
   blastClass(s, false, null)`. The second is what proves the two bosses agree whether or not the call site
   forces `isBoss` — `spawnBossExplosion` passes `true` unconditionally, `spawnShipExplosion` passes `false`.
6. **The fallback degrades, never throws.** `blastClass(3, false, 'ultraHeavy') === 'heavy'`,
   `blastClass(1, false, 'station') === 'light'`, `blastClass(2, false, 'someHybridNobodyDeclared') ===
   'medium'`, `blastClass(1, true, 'station') === 'heavy'`, and `blastClass()` (no args) `=== 'light'`.
   Each also returns finite `power`/`reach`/`durMul`.
7. **The class chooses the BASE; size scales it at the call site (R7).** Two assertions:
   - the base is size-independent — `blastPower(1, false, 'heavy') === blastPower(3, false, 'heavy')`, same
     for reach and durMul (so nobody "helpfully" folds `* s * s` into `blast.js` and double-scales it);
   - a source check that the call sites still scale: read the source via
     `fs.readFileSync(new URL('./projectiles.js', import.meta.url), 'utf8')` — **not** a cwd-relative path,
     which would only resolve when the suite is launched from `client/` — and assert the
     `addFlash(` line inside `spawnShipExplosion` still contains `* s * s` and `blastReach(` … `) * s`, and
     the same inside `spawnBossExplosion`. Crude on purpose and commented as such: byte-identical output
     depends on arithmetic that lives in another file, and this is the cheapest thing that notices it moving.
8. **The rocket tier is not a class (R1).** `BLAST.rocket` and `BLAST.reachRocket` are finite numbers and
   `SHIP_CLASSES.rocket` is `undefined`.

### Step 10 — docs

- **`docs/SUMMARY.md`**
  - *Ship model (DB-driven)*, `:765` — the sentence listing what `stats` carry: add `weightClass` as the
    **mass tier** (`light`/`medium`/`heavy`; `ultraHeavy` and `station` declared but unused), state that it
    is a third axis orthogonal to `role` (behaviour) and `class` (sound), and point at
    `client/src/sim-core/ship-classes.js`.
  - *Visuals → blast flashes*, `:2145-2151` — rewrite the parenthetical. It currently reads
    "`blastClass`: `sizeScale >= 2.2` or `role: 'boss'` → boss, `>= 1.4` → medium, else small". It must now
    say: the tier comes from the ship's **`weightClass`** via `SHIP_CLASSES` (`light 800 / 45 u / ×2`,
    `medium 1400 / 70 / ×3`, `heavy 2400 / 110 / ×5`, rocket `400 / 30` separately), with the sizeScale
    thresholds kept as the **fallback** for data that predates the field, and `isBoss` between the two.
    Keep the "power × size², reach × size, base duration 0.44 s" framing — those are unchanged.
  - *Client module layout*, `:4171` — the `engine-lights.js` bullet says it owns "the `BLAST` tiers and the
    `blastClass` classifier". Move that to a new mention of **`blast.js`** (three-free: the tiers +
    classifier, unit-tested) and note `engine-lights.js` re-exports it.
  - *What lives in `sim-core/`*, `:3740` — add `ship-classes.js`.
  - *`?tune` — the Engine lights folder*, `:2510-2513` — it describes the **`Blast flashes`** sub-folder as
    having "every power/reach/duration tier plus buttons … and a **frozen test range**". Add one clause: the
    per-class sliders are now **generated from `SHIP_CLASSES`** (a new class row grows its own three sliders,
    a class with no blast block gets none), the rocket tier + base duration stay on `BLAST`, `medAt`/`bigAt`
    are labelled **fallback-only**, and the frozen test range **clears `weightClass`** so it keeps exercising
    that fallback (R2/R4/R5).
  - *Tests*, the client-logic list around `:4276` — one clause for `blast.test.js` (every ship states a
    tuned weight class; the class-driven blast reproduces the sizeScale one; the fallback degrades).
  - Bump `**Updated:**`.
- **`docs/CHANGELOG.md`** — under `## 2026-08-31`, one bullet:
  **"Ship weight class as a first-class data axis"** — every ship row now states `stats.weightClass`
  (`light`/`medium`/`heavy`; `ultraHeavy`/`station` declared for later), described by `SHIP_CLASSES`
  (`client/src/sim-core/ship-classes.js`) which owns each class's explosion-blast profile. The blast flash
  reads the class instead of guessing from `sizeScale` thresholds (those remain as the fallback for older
  traces and wire payloads); the `?tune` blast folder is now generated from the class table, so adding a
  class needs no code edit. **No visible change** — all 10 ships classify exactly as before, asserted by
  `client/src/blast.test.js`.
- **`docs/DECISIONS.md`** — new entry **§142**, "A new `weightClass` axis alongside `class`/`role`, and the
  class row owns its blast numbers". Record: (a) why not rename `class` (it is the SFX key and is in recorded
  traces) and why not migrate `role` yet (behaviour and mass are genuinely different questions; one consumer
  at a time); (b) why both bosses are `heavy` and `ultraHeavy`/`station` are declared-but-unused (the ladder
  is documented in one place, and an unused class costs one line — a class with *invented* numbers would be
  a lie); (c) why the class row owns the literal `power`/`reach`/`durMul` rather than naming a shared tier —
  a weight class that cannot be re-tuned on its own is not an axis, and the `?tune` folder now generates
  itself from the table; (d) the fallback chain (`weightClass` → `isBoss` → `sizeScale`) and why it stays
  forever: recorded traces and older netsim payloads carry no class.
- **`docs/ROADMAP.md:383-402`** — mark this iteration done (field + `SHIP_CLASSES` + the blast consumer) and
  leave the rest of the ladder (migrating `role`, reward/XP by class, equipment restrictions) as the open
  next steps.

---

## Replay / intro impact

**No simulation change.** No RNG draw is added, moved or reordered (`ship-entity.js`'s three-draw contract is
untouched); no damage, collision, movement or spawn logic is touched. `weightClass` is a copied string that
reaches the **view layer** through an event, and `worldDigest` (`sim-core/digest.js`) hashes an explicit field
list that does not include it — so recorded traces, both oracles and the Level-0 intro re-sim are unaffected.
The blast flash is a `settleView` FX (replay-neutral by construction, DECISIONS §73), and its numbers are
asserted unchanged.

Still run the intro guard `node visual/run.mjs 22-trace-replay` (below — note the scenario file is
`client/visual/scenarios/22-trace-replay.mjs`; **there is no `22-intro-replay`**, and naming a scenario that
does not exist makes the runner pass green having executed nothing). The intro drives real deaths through
`spawnShipExplosion`/`spawnBossExplosion`, which is where the positional-argument change of Step 6 would show
up as a page error.

---

## Tests

**Precondition for every visual scenario below — do this first, it is not optional in a fresh worktree.**
`client/assets/ships/` is **empty** here and `client/assets/recordings/` does not exist: the models and the
canonical Level-0 trace are gitignored S3 assets. Run **`npm run assets:pull` from the repo root** before any
`visual/run.mjs`, or `22-trace-replay` dies on *"canonical Level-0 trace missing … run `npm run assets:pull`
from the repo root"* (`22-trace-replay.mjs:31`) and the ship scenarios render nothing. That failure is a
missing asset, **not** a regression in this change — do not go debugging the plan over it.

**And a standing rule for every visual guard: confirm the scenario ACTUALLY RAN.** `visual/run.mjs:81` selects
files with `f.includes(only)`, and the runner ends in `process.exit(failed ? 1 : 0)` over the results array —
so a misspelt name matches nothing, prints `0 passed, 0 failed` and **exits 0**. A guard is only green if its
own per-scenario line appears in the output (e.g. `22-trace-replay … ok`) with a non-zero scenario count.

Run, in this order:

1. `cd client && node --test` — includes the new `blast.test.js`. Fast, no DB.
2. `cd server && npm test` — the seed guard from Step 4 runs at module load, so any server test that imports
   `catalog_seed.js` exercises it; `netsim/room.test.js` covers the wire changes. (`npm test` drops and
   recreates a local `spacegame_test`; the single data layer is `db.js`.)
3. `cd client && node visual/run.mjs 22-trace-replay` — the sim/FX guard. It re-sims the shipped Level-0 trace
   and asserts **`kills === 4`** and **`won === true`** (`22-trace-replay.mjs:70-71`) and fails on any page
   error — which is what catches a broken `addFlash` default or a bad positional argument. (It does **not**
   assert `p0..p4`; do not claim that it does.) **Check `lsof -i :4173` first** — a second worktree running
   the visual harness silently tests the wrong code.
4. `cd client && node visual/run.mjs 02-ship-explosion` — the cheapest direct check of the Step 6 hazard: the
   scenario calls the changed `g.spawnShipExplosion(pos, color, 1)` / `(pos, color, 2)` through `__game` with
   **three** positional args (`02-ship-explosion.mjs:17-18`) and asserts the surviving construction (no
   sparks, the ring scale ratio, textured rings). If `weightClass` were inserted in the wrong slot, this is
   where it shows.
5. `cd client && node visual/run.mjs 11-l4-enemies` — the Level-4 scene builds the medium/boss hulls whose
   classes changed representation; cheap, and it renders the ships this change classifies.

**Do NOT run the full 49-scenario visual suite or the perf bench** — both are opt-in and the maintainer's call
(DECISIONS §141). This change alters no geometry, no material and no draw call, so neither is warranted; say
so and let the orchestrator ask if you disagree.

**Manual check (2 minutes, optional but cheap; needs `npm run assets:pull` first, same as above — see the
`/run-local` skill):** open the local client with `?tune&lights=16`, open
*Engine lights → Blast flashes*, confirm the folder lists `light`/`medium`/`heavy` sliders plus the rocket and
fallback rows, then `▶ spawn 3+3+3 FROZEN targets` and shoot one of each rank — the three ranks must still
flash at visibly different strengths (this is the R5 fallback path).

---

## Final gate — re-run before declaring done

1. **Concept-word sweep**, not just symbols: `grep -rn "reachShip\|reachMed\|reachBoss\|durShip\|durMed\|durBoss\|BLAST\.ship\|BLAST\.med\|BLAST\.boss" client server docs --include='*.js' --include='*.mjs' --include='*.md'`
   must return nothing outside `docs/CHANGELOG.md` history. Then `grep -rn "blastClass" client server docs`
   and confirm every prose description of it matches the new resolution order (SUMMARY `:2147` especially).
2. `grep -rn "spawnShipExplosion\|spawnBossExplosion" client` — every call site accounted for
   (`sim.js:359/374/375/456`, `ghost-battle.js:107`, `tune.js:197-199`, visual scenarios `02`, `28`, `99`
   which pass 3 args and are fine).
3. `grep -rn "weightClass" client server` — the field appears in: `ship-classes.js`, `blast.js`,
   `catalog_seed.js` (×10 + guard), `ship-entity.js` (×2), `step-enemies.js`, `step-ally.js`, `events.js`,
   `protocol.js` (×2), `room.js`, `projectiles.js` (×2), `sim.js` (×4), `tune.js`, `blast.test.js`.
4. `git log --oneline` for this branch has a matching CHANGELOG bullet, and SUMMARY describes the end state.

---

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **Do not touch or rename `stats.class`.** It stays the SOUND class (`sound_map` key, `db.js:331`,
  `sfxFor('ship', class, …)`) and also keys scene music. `weightClass` lives alongside it.
- **Do not migrate `role`.** `isBoss` in `step-enemies.js:125`, the `louderBoom` role list in `sim.js:377` and
  the role-keyed ship lookup in `ship-build.js:107` stay exactly as they are. That is a later iteration.
- **No equipment/weapon restrictions.** `SHIP_CLASSES` documents the intent in a comment; there is no
  predicate in `shop-slots.js` and no server-side validation change.
- **No reward/XP or mass rules from the class.** Those numbers stay per-ship in the catalog.
- **No second consumer.** Marker colours (`MARKER` in `catalog_seed.js:440`), audio loudness, the minimap and
  the flipbook fireball size all keep classifying exactly as they do today, even where a weight class would
  obviously fit. One consumer was the agreed scope.
- **No new class rows beyond the five named**, no `station` ships row, and no invented blast numbers for
  `ultraHeavy`/`station`.
- **No DB migration** — `stats` is JSONB and ships upsert their `stats` wholesale on boot.
