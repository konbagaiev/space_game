# Triple spiral rocket + fading-line rocket trail

**Feature ID:** 2026-07-04-1740-triple-spiral-rocket

## Goal
Add a new **purchasable** shop weapon, **"Triple spiral rocket"** (top of the rocket price ladder), and
rework the standard rocket smoke trail. When fired, an **invisible leading homing rocket** seeks the
nearest enemy in a forward cone (exactly like the existing homing rocket) and defines the flight path;
**three visible rockets** ride that leader, orbiting its flight axis in a rotating corkscrew. Each visible
rocket is a **real** rocket — it deals its own damage, has its own HP, detonates on its own proximity, and
can be individually shot down by gunfire (three connect = 3× damage). The visible rockets look distinct
from the standard rocket (a slimmer, brighter procedural cone) and leave a **corkscrew smoky trail** (three
intertwined smoke helices). Separately, the **standard** rocket trail (all rockets, player + enemy) changes
from an expanding cone of spheres into a **thin, fading haze line** — small fixed-size puffs that only fade
(no growth), so it reads as a dissipating vapor line instead of a widening cone. User-visible effect: a
flashy spiral triple-warhead rocket to buy, and cleaner, more missile-like smoke on every rocket.

## Decisions (answered inline — do not re-ask)
- **Damage model = PER-ROCKET.** The invisible leader deals **no** damage and is **not** shootable; it is
  purely a moving trajectory frame (homing steer + position reference). Each of the **3 visible** rockets
  deals its own `power` and has its own `health`, detonates independently on proximity, and is
  independently shot down by bullets. All three connecting = 3 × power.
- **Lifecycle (explicit):** The leader lives until **all three** visible rockets are gone **or** it exceeds
  `maxRange`. A visible rocket that detonates (proximity) or is shot down (HP ≤ 0) is removed on its own;
  the others keep flying around the still-living leader. When the **last** visible rocket is removed (or the
  leader hits maxRange), the leader frame is removed too. The leader itself never spawns a detonation burst
  and never damages anything.
  - **maxRange edge (intended):** because a warhead shares the leader's range accounting (`r.traveled =
    L.traveled`, step 4), when the leader reaches `maxRange` with warheads still alive, those warheads see
    `traveled >= maxRange` and **detonate** (dealing damage + a burst) on the next frame rather than silently
    vanishing — identical to how a normal rocket ends its life at max range. This is the desired behavior,
    not a leak; the leader's own `r.children <= 0` / `traveled >= maxRange` self-removal then cleans up the
    empty frame.
- **Stats (id 11, "Triple spiral rocket", price 4000):** each visible rocket `power 40`, `health 10`,
  `fireCooldown 7`. Flight = standard homing rocket ×1.2, rounded: `launchSpeed 14` (12×1.2), `accel 12`
  (10×1.2), `turnRate 1.0` (leader steering unchanged). Reuse standard homing rocket blast/seek values:
  `maxRange 150`, `seekHalfAngle 60°`, `detonateRadius 3.2`, `blastRadius 5`, `blastVisual 4.5`,
  `blastTimeScale 0.8`, `blastTint 0xffb050`, `weight 13`, `class 'rocket'`,
  `projectileColor 0x66ddff` (bright cyan — distinct from the standard 0xffaa44 so the visible rockets read
  differently). New optional stat `spiral: true` flags this weapon as a triple-spiral in `spawnRocket`.
- **Spiral geometry:** 3 visible rockets, phase **120° apart** (`i * 2π/3`), orbit **radius 1.4 u**, angular
  speed **6 rad/s**, spinning around the leader's flight axis. Offsets are computed in the plane
  perpendicular to the leader's velocity (see math below).
- **Standard trail = puffs-without-growth**, reusing the existing `smoke` pool. No true Line-mesh ribbon.
  Applies to **all** rockets (player homing, Heavy rocket, enemy rockets) via the shared `spawnSmoke`.
- **Procedural only — NO new .glb.** Visible rockets are a code-built primitive. Therefore **no CREDITS.md
  change and NO `/publish-itch` step** (nothing content-hashed changed; the itch bundle is unaffected).
- **No migration.** `weapons` rows are upserted by id from the shared `WEAPONS` array on every boot in both
  `server/src/db.js` (`seedCatalog`, line ~27) and `server/src/db_postgres.js` (line ~187) — adding a row
  is seed-only, both backends stay in sync automatically. No `model_url`/`model_url_high` (no hangar 3D
  showcase for this weapon — keep it simple, §30).

## Steps

### 1. Seed the new weapon — `server/src/catalog_seed.js`
Insert a new row in the `WEAPONS` array **after** id 10 (`Advanced pirate cannon`), at
`server/src/catalog_seed.js:151` (right before the closing `];` on line 152). Next-free id is **11**
(verify: current max weapon id is 10).

```js
  // Player shop ladder — top of the rocket ladder (above Heavy rocket 2600). A triple-warhead homing
  // rocket: an INVISIBLE leading rocket homes (findTargetInSector) and defines the path; three VISIBLE
  // rockets spiral around its flight axis, each a real rocket (own power + HP, own proximity detonation,
  // individually shootable-down). `spiral:true` triggers the leader+3-orbiter spawn in projectiles.js.
  {
    id: 11, name: 'Triple spiral rocket', type: 'rocket', price: 4000, stats: {
      power: 40, accel: 12, turnRate: 1.0, launchSpeed: 14, maxRange: 150, health: 10, // per visible rocket
      seekHalfAngle: 60 * Math.PI / 180, detonateRadius: 3.2, blastRadius: 5,
      blastVisual: 4.5, blastTimeScale: 0.8, blastTint: 0xffb050,
      fireCooldown: 7, weight: 13, projectileColor: 0x66ddff, class: 'rocket',
      spiral: true // spawn as an invisible leader + 3 visible spiraling rockets (see spawnRocket)
    }
  },
```

It appears in the shop automatically: `client/src/shop.js:209` (`renderShop`) lists weapons with
`(n.price ?? 0) > 0 && n.s?.buyable !== false` — price 4000 and no `buyable:false` qualifies. It slots into
the existing "rocket" weapon type list, sorted by id, above nothing (highest rocket id). Sell price is
`floor(4000 * 0.75) = 3000` (computed server-side, no change needed).

### 1b. Fix the weapon-count assertion — `server/src/server.test.js`
Adding id 11 raises the seeded weapon count from 10 to **11**, which breaks the assertion at
`server/src/server.test.js:408` (`assert.equal(weapons.length, 10)`) on **both** the SQLite and Postgres
test runs. This is a guaranteed failure — make the edit:
- `server/src/server.test.js:408`: change `assert.equal(weapons.length, 10);` → `assert.equal(weapons.length, 11);`
- `server/src/server.test.js:407` (the count comment): update it to account for id 11, e.g.:
  `// 5 base (ids 1–5) + 3 player-shop ladder weapons (Heavy cannon 6, Heavy Machine Gun 7, Heavy rocket 8) + Triple spiral rocket (11)`
  (ids 9–10 are enemy weapons already covered by the base tally in the original comment; keep the wording
  consistent with what's there — the key change is the total now includes the triple spiral rocket).

### 2. Distinct procedural rocket mesh — `client/src/projectiles.js`
Near the existing `rocketGeo` (`client/src/projectiles.js:196`), add a slimmer/sharper geometry for the
visible spiral rockets:

```js
const rocketGeo = new THREE.ConeGeometry(0.6, 2.4, 8); // nose in +Z (like the ship)
// Spiral-rocket warhead: slimmer + sharper than the standard rocket, brighter emissive tint so the
// three visible rockets read as a distinct weapon. Built procedurally (no .glb).
const spiralRocketGeo = new THREE.ConeGeometry(0.34, 2.0, 6);
```

### 3. Spawn: leader + 3 orbiters — `client/src/projectiles.js` `spawnRocket`
`spawnRocket` (`client/src/projectiles.js:211`) currently pushes one entry into `rockets`. Extend it so
that when `weapon.spiral` is set it spawns an **invisible leader** entry plus 3 **child** rocket entries,
all pushed into the **same `rockets` pool** (so `sim.js`'s existing loop and the bullet-interception loop
keep working with minimal special-casing). Keep the non-spiral path exactly as-is.

Replace the body of `spawnRocket` with a branch. Factor the current single-rocket construction into the
default branch; add the spiral branch:

```js
export function spawnRocket(from, fwd, weapon, accel, fromPlayer, target) {
  if (weapon.spiral) return spawnSpiralRocket(from, fwd, weapon, accel, fromPlayer, target);
  // ...existing single-rocket body unchanged...
}

// Triple spiral rocket: an invisible leader (homing, no damage, not shootable) + 3 visible rockets that
// orbit its flight axis in a corkscrew. Each visible rocket deals damage, has HP, detonates on its own
// proximity, and can be shot down. All entries share the `rockets` pool.
function spawnSpiralRocket(from, fwd, weapon, accel, fromPlayer, target) {
  // Leader: invisible frame. Reuses the rocket steering fields; `lead:true` marks it non-damaging /
  // non-shootable; `children` counts live orbiters so the leader expires when the last one is gone.
  const leadObj = new THREE.Group();
  leadObj.position.copy(from);
  scene.add(leadObj); // no mesh child → invisible; still moved/steered by sim.js
  const leadVel = fwd.clone().multiplyScalar(weapon.launchSpeed);
  const leader = {
    obj: leadObj, vel: leadVel, accel, turnRate: weapon.turnRate,
    target, fromPlayer, lead: true, children: 3, spiralPhase: 0,
    traveled: 0, maxRange: weapon.maxRange ?? 150,
  };
  rockets.push(leader);
  // Three visible rockets, 120° apart, each a real rocket that rides the leader.
  const sfxExplode = sfxFor('weapon', weapon.class, 'explode');
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: weapon.projectileColor });
    const m = new THREE.Mesh(spiralRocketGeo, mat);
    m.rotation.x = Math.PI / 2; // cone points +Z
    const holder = new THREE.Group();
    holder.add(m);
    holder.position.copy(from);
    scene.add(holder);
    rockets.push({
      obj: holder, vel: leadVel.clone(), fromPlayer,
      spiralOf: leader, spiralPhaseOffset: i * (Math.PI * 2 / 3),
      damage: weapon.power, detonateR: weapon.detonateRadius,
      blastR: weapon.blastRadius, blastVis: weapon.blastVisual,
      blastTime: weapon.blastTimeScale, blastTint: weapon.blastTint,
      sfxExplode, hp: weapon.health ?? 1,
      traveled: 0, maxRange: weapon.maxRange ?? 150,
    });
  }
}
```

**Notes for the implementer:**
- The leader has **no** `damage`/`detonateR`/`blastR`/`hp` and carries `lead:true` — `sim.js` must skip it
  in the bullet-interception loop and the detonation-proximity loop (see step 5).
- The visible rockets have **no** `target`, `accel`, or `turnRate` — they don't steer themselves; their
  position is derived each frame from `spiralOf` (the leader). They **do** have detonation/HP fields, so
  `detonateRocket` works on them unchanged.
- `spiralOf` links a child to its leader; `spiralPhaseOffset` is its 120° slot.

### 3b. Expose the spiral fire entry to the headless test hook — `client/src/main.js`
The visual scenario (see Tests) needs to fire a spiral rocket and watch the `rockets` pool. `spawnRocket`
is **not** currently on the `?debug` `__game` hook. Add it:
- Import it in `main.js:14`: that projectiles import currently is
  `import { spawnShipExplosion, emitExhaust, liveParticles, bulletGeo, explosionGeo } from './projectiles.js';`
  — add `spawnRocket` to the list.
- In the `window.__game = { ... }` object (opens at `main.js:502`), add `spawnRocket,` on the entity/helper
  line at `main.js:505` (`spawnEnemy, spawnEnemyShip, spawnShipExplosion, emitExhaust, reset, levelRunner,`).
  It's inert during normal play (only attached under `?debug`).

### 4. Spiral math + per-frame update — `client/src/sim.js` rocket loop
The rocket loop is at `client/src/sim.js:478-506`. Currently every rocket homes and detonates uniformly.
Split the loop's per-rocket handling into three cases: **leader**, **spiral child**, **normal rocket**.

Add a small **pure, THREE-free** helper (exported for unit testing — see Tests) to
`client/src/steering.js`, computing the orbit offset in the plane perpendicular to the leader velocity. It
operates on and returns plain `{x,y,z}` objects (matching steering.js's "No Three.js, no DOM" contract at
`steering.js:1-2`); `sim.js` wraps the result in a `THREE.Vector3`.

```js
// Corkscrew offset for a spiral-rocket warhead around its leader's flight axis.
// axis = leader forward direction (UNIT {x,y,z}); phase = leader.spiralPhase + the warhead's 120° offset.
// Returns a plain {x,y,z} offset of length `radius` in the plane perpendicular to axis. No Three.js.
export function spiralOffset(axis, phase, radius) {
  // Pick a reference not parallel to axis, then build an orthonormal basis (u, w) spanning axis's plane.
  const up = Math.abs(axis.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const u = norm(cross(axis, up));
  const w = norm(cross(axis, u));
  const c = Math.cos(phase) * radius, s = Math.sin(phase) * radius;
  return { x: u.x * c + w.x * s, y: u.y * c + w.y * s, z: u.z * c + w.z * s };
}
```

Constants at the top of the rocket section in `sim.js`:
```js
const SPIRAL_RADIUS = 1.4;      // orbit radius around the leader axis (world units)
const SPIRAL_ANGULAR = 6;       // rad/s — how fast the warheads corkscrew
```

Rocket-loop handling (replace the homing/move block at `sim.js:480-494`, keep the detonation block per
step 5). Pseudocode for the three cases inside `for (let i = rockets.length - 1; i >= 0; i--)`:

```js
const r = rockets[i];

if (r.lead) {
  // Invisible leader: home + move exactly like a normal rocket, but no smoke, no detonation.
  if (r.target && (r.fromPlayer ? !enemies.includes(r.target) : !G.player.alive)) r.target = null;
  if (r.target) { /* same steerToward + accelerate block as normal rockets */ }
  r.traveled += r.vel.length() * dt;
  r.obj.position.addScaledVector(r.vel, dt);
  r.spiralPhase += SPIRAL_ANGULAR * dt;
  // Expire when out of range OR all children gone (children decremented in the detonation block).
  if (r.traveled >= r.maxRange || r.children <= 0) { scene.remove(r.obj); rockets.splice(i, 1); }
  continue;
}

if (r.spiralOf) {
  // Visible warhead: position = leader.pos + corkscrew offset; velocity tracked for orientation + smoke.
  const L = r.spiralOf;
  const axisV = L.vel.lengthSq() > 1e-4 ? L.vel.clone().normalize() : new THREE.Vector3(0, 0, 1);
  const o = spiralOffset({ x: axisV.x, y: axisV.y, z: axisV.z }, L.spiralPhase + r.spiralPhaseOffset, SPIRAL_RADIUS);
  const off = new THREE.Vector3(o.x, o.y, o.z);
  const prev = r.obj.position.clone();
  r.obj.position.copy(L.obj.position).add(off);
  const moved = r.obj.position.clone().sub(prev);
  r.vel.copy(moved).multiplyScalar(1 / Math.max(dt, 1e-4)); // for orientation + smoke direction
  r.traveled = L.traveled; // share the leader's range accounting
  if (r.vel.lengthSq() > 0.01) r.obj.rotation.y = Math.atan2(r.vel.x, r.vel.z);
  spawnSmoke(r.obj.position); // corkscrew trail: three offset helices (same fading-line puffs)
  // ...detonation/shoot-down handled in the shared block below (step 5)...
}
else {
  // Normal rocket: existing homing + move + spawnSmoke block, unchanged.
}
```

**Important:** `THREE` is **already imported** in `sim.js` (`sim.js:6`, `import * as THREE from 'three';`),
so the `new THREE.Vector3(...)` wrapping above needs no new import. Import `spiralOffset` by adding it to the
existing `steering.js` import at `sim.js:12`. `spiralOffset` itself is THREE-free (plain `{x,y,z}`), keeping
`steering.js` and its unit test dependency-free.

### 5. Per-rocket detonation + shoot-down — `client/src/sim.js`
Keep the existing detonation block (`sim.js:496-505`) but make it **skip the leader** and **decrement the
leader's child count** when a spiral child is removed. The bullet-interception loop
(`sim.js:456-467`) must also **skip leaders** (they have no `hp`).

- In the bullet-interception loop (`sim.js:458`), add `if (r.lead) continue;` at the top of the inner
  `for` over rockets, so bullets can't shoot down the invisible leader (they still shoot down the visible
  children — those have `hp`, `obj.position`, and `fromPlayer`, so the existing code works untouched). When
  a child is destroyed there, **also** `if (r.spiralOf) r.spiralOf.children--;` right before/after its
  `detonateRocket(r,false); rockets.splice(j,1);`.
- In the detonation block, guard the leader: it has no `detonateR`, so proximity check must not run for it.
  Because the leader is handled in its own `if (r.lead) { ... continue; }` branch (step 4), it never reaches
  the detonation block — good. For a spiral **child**, run the same proximity detonation as a normal rocket;
  on `detonateRocket(r); rockets.splice(i,1);` **also** `r.spiralOf.children--;`. On child `traveled >=
  maxRange` removal, same decrement.

Concretely, wherever a rocket entry is removed from `rockets` in the loop, if it has `spiralOf`, decrement
`spiralOf.children`. Factor this into a tiny local helper to avoid missing a path:

```js
const removeRocket = (idx, r) => { if (r.spiralOf) r.spiralOf.children--; rockets.splice(idx, 1); };
```
and use it for the spiral-child removals (detonation + out-of-range). The leader self-removes in its own
branch.

### 6. Fading-line standard trail — `client/src/projectiles.js` `spawnSmoke`
Replace the expanding-puff smoke (`client/src/projectiles.js:250-262`) with small **fixed-size** puffs that
only fade. Smaller start scale, no growth; keep the same soft-gray, no-glow look:

```js
// Rocket smoke trail: a thin, dissipating haze LINE — small fixed-size gray puffs that only fade out
// (no expansion), emitted densely along the flight path so the trail reads as a vapor line, not a cone.
const smokeGeo = new THREE.SphereGeometry(1, 6, 6);
export function spawnSmoke(pos) {
  if (liveParticles() >= G.gfx.maxParticles) return;                 // respect the hard ceiling (weak phones)
  if (G.gfx.particleScale < 1 && Math.random() > G.gfx.particleScale) return; // thin on lower tiers
  const mat = new THREE.MeshBasicMaterial({
    color: 0x9aa6b4, transparent: true, opacity: 0.4, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(smokeGeo, mat);
  m.position.copy(pos);
  const size = 0.32 + Math.random() * 0.12; // small, fixed — no growth
  m.scale.setScalar(size);
  scene.add(m);
  smoke.push({ mesh: m, life: 0.5, maxLife: 0.5, baseSize: size });
}
```

**Budget note:** `spawnSmoke` did NOT previously honor the particle ceiling. Adding the `liveParticles()` /
`particleScale` gates (mirroring `emitExhaust`, `projectiles.js:184-185`) is what keeps the extra spiral
emitters (3 helices instead of 1 trail) within budget on weak phones. **But** `liveParticles()`
(`projectiles.js:34`) currently counts only `trail.length + sparks.length`. Update it to include smoke so
the cap actually accounts for the denser trails:

```js
export const liveParticles = () => trail.length + sparks.length + smoke.length;
```
Import `smoke` is already present in `projectiles.js:7`.

**Accepted trade-off:** `liveParticles()` is also read by `spawnShipExplosion` (`projectiles.js:81`) and
`spawnRocketBurst` (`projectiles.js:129`) to clamp their spark counts against `G.gfx.maxParticles`. Now that
smoke counts toward the budget, on **capped low tiers** dense rocket smoke will slightly reduce burst sparks
game-wide (a burst mid-heavy-smoke gets a few fewer sparks). This is intentional and correct — smoke is now
real overdraw that should be budgeted; off the capped tiers (`maxParticles = Infinity`) there is no effect.

### 7. Smoke update loop — `client/src/sim.js`
The smoke update (`sim.js:537-548`) currently **grows** each puff (`s.mesh.scale.setScalar(0.4 + t*1.2)`).
Change it to keep the fixed size and only fade (the line should dissipate, not swell):

```js
for (let i = smoke.length - 1; i >= 0; i--) {
  const s = smoke[i];
  s.life -= dt;
  const t = 1 - Math.max(0, s.life) / s.maxLife; // 0 → 1
  s.mesh.material.opacity = (1 - t) * 0.4;        // fade out only
  // no scale change — fixed-size puffs form a thin dissipating line
  if (s.life <= 0) {
    scene.remove(s.mesh);
    s.mesh.material.dispose();
    smoke.splice(i, 1);
  }
}
```
(`baseSize` is stored for symmetry with `trail`; scale is set once at spawn, left untouched here.)

### 8. Cleanup path — `client/src/sim.js` end-of-run reset
The reset (`sim.js:685-688`) disposes rockets via `r.obj.children[0].material.dispose()`. The **leader**
has **no children** (invisible Group) → `r.obj.children[0]` is `undefined` and would throw. Guard it:

```js
for (const r of rockets) {
  scene.remove(r.obj);
  const mesh = r.obj.children[0];
  if (mesh?.material) mesh.material.dispose();
}
rockets.length = 0;
```
Smoke cleanup (`sim.js:687-688`) is unchanged.

Also confirm `detonateRocket` (`projectiles.js:246-247`) is only ever called on visible rockets (it does
`r.obj.children[0].material.dispose()`); the leader is never passed to `detonateRocket` (it self-removes in
its own branch, step 4), so no guard is needed there — but leave a code comment stating that invariant.

## Tests

### Client (`cd client && node --test`)
- **Add tests to `client/src/steering.test.js`** (where `spiralOffset` lives): import `spiralOffset` and
  assert on plain `{x,y,z}` inputs/outputs (no `three` import needed — the helper is THREE-free). Using a
  unit `axis` and `radius = 1.4`:
  - Offset length ≈ `radius` for several axes (e.g. `(0,0,1)`, `(1,0,0)`, a diagonal) and phases.
  - Offset is **perpendicular** to the axis (`axis·offset ≈ 0`).
  - Three phases 120° apart (`0, 2π/3, 4π/3`) sum to ≈ the zero vector (balanced around the axis).
  - Axis aligned with world-up (`(0,1,0)`) still yields a valid basis (the `abs(axis.y)<0.99` fallback
    branch) — offset length ≈ radius, `axis·offset ≈ 0`.
- These are pure-math unit tests (no scene/DOM), matching the existing `steering.test.js` style (`close`
  helper, `1e-9`/loosened eps).

### Headless visual suite — lifecycle scenario (`client/visual/`)
The math test doesn't cover the real silent-failure surface: the **leader + 3-children bookkeeping** (4
entries per fire, the `spiralOf.children--` decrement across **every** removal path — proximity detonation,
bullet shoot-down, out-of-range — the leader's self-removal, and no leaked invisible `Group` per volley).
Add **`client/visual/scenarios/17-triple-spiral-rocket.mjs`**, matching the existing scenario harness
(`export const name`, `export default async function ({ page, assert, shot })`, `page.evaluate` against
`window.__game`; see `client/visual/scenarios/02-ship-explosion.mjs` for the exact shape). It is picked up
automatically by `client/visual/run.mjs` (globs the `scenarios/` dir). Run with the suite's usual command
(see `client/visual/README.md`).

Scenario logic:
```js
export const name = '17-triple-spiral-rocket';

export default async function ({ page, assert, shot }) {
  // 1) Fire one spiral rocket at an enemy placed just ahead; assert the pool spawns exactly 4 (1 leader + 3).
  const fired = await page.evaluate(() => {
    const g = window.__game;
    g.reset();                                   // clear any leftover entities → deterministic pool counts
    const V = g.player.mesh.position.constructor; // THREE.Vector3
    const base = g.player.mesh.position.clone();
    const fwd = new V(0, 0, 1);
    const enemy = g.spawnEnemyShip(g.catalog.enemyShips.find((s) => s.stats.role === 'fighter'));
    enemy.mesh.position.set(base.x, 0, base.z + 24); // ~24u ahead, within the seek cone & reachable
    const w = g.catalog.weapons.get(11);          // resolved Triple spiral rocket (spiral:true)
    const muzzle = base.clone().add(new V(0, 0, 2));
    g.spawnRocket(muzzle, fwd, w, w.accel, true, enemy);
    return {
      total: g.rockets.length,
      leaders: g.rockets.filter((r) => r.lead).length,
      warheads: g.rockets.filter((r) => r.spiralOf).length,
    };
  });
  assert.equal(fired.total, 4, 'one spiral fire spawns 4 rocket entries (1 leader + 3 warheads)');
  assert.equal(fired.leaders, 1, 'exactly one invisible leader');
  assert.equal(fired.warheads, 3, 'exactly three visible warheads');

  await shot('inflight'); // three cyan warheads spiraling toward the enemy

  // 2) Let them home + detonate; the whole volley must drain to 0 (leader self-removes when children gone).
  await page.waitForTimeout(4000); // 24u at speed ~14 → homing + detonation well within 4s
  const drained = await page.evaluate(() => ({
    total: window.__game.rockets.length,
    leaders: window.__game.rockets.filter((r) => r.lead).length,
  }));
  assert.equal(drained.leaders, 0, 'no immortal invisible leader left behind');
  assert.equal(drained.total, 0, 'the whole spiral volley drains from the pool (no leaked entries)');
}
```
This exercises the proximity-detonation + child-count path and the leader self-removal. (The out-of-range
path shares the same `removeRocket`/decrement helper from step 5, so it's covered by construction; a
separate no-target run isn't needed — keep the suite lean, §30.) If the game loop needs a beat to build the
player before `g.player` exists, mirror how neighboring scenarios wait for `__game.player` (the harness
already boots a ready game before the first scenario; `04-combat.mjs` spawns enemies the same way).

### Server (`cd server && npm test` — runs on **both** SQLite and Postgres)
- Adding id 11 **breaks** the weapon-count assertion in `server/src/server.test.js:408` on both backends —
  fix it per **step 1b** (10 → 11 + comment). That is the only required server-test edit; run the suite to
  confirm it passes on SQLite and Postgres. No other server test snapshots the weapon list (checked
  `enemy_total.test.js` — it counts enemies from phase scripts, not weapons).
- Verify no migration is needed: both `db.js seedCatalog` and `db_postgres.js` upsert by id from the shared
  array; run `npm test` to confirm parity (both backends seed the same `WEAPONS`).

### Manual / live smoke check (not automated)
- Buy "Triple spiral rocket" (4000) in the shop, equip it in the rocket slot, fire (`F`/🚀): confirm three
  bright cyan rockets spiral around an invisible path toward the nearest enemy, each leaving a smoke helix;
  confirm 1–3 detonations land depending on how many warheads connect; confirm gunfire can shoot one down
  and the other two keep flying. Confirm the standard rocket now trails a thin fading line, not a cone.

## Docs to update
- **`docs/SUMMARY.md`:**
  - Weapons section (around `SUMMARY.md:341-357`): add **Triple spiral rocket** (id 11, price 4000) to the
    player shop ladder list — note it's a homing rocket whose invisible leader steers while three visible
    warheads (power 40 / health 10 each) spiral around the flight axis, each detonating and shootable
    independently (3× on a full hit); fireCooldown 7, top of the rocket ladder.
  - Projectiles/FX section (around `SUMMARY.md:777` rocket detonation + the smoke description near
    `SUMMARY.md:346`): update the rocket-smoke description from "trails smoke (expanding sphere cone)" to
    "trails a **thin fading haze line** (small fixed-size puffs that only fade); the triple spiral rocket
    trails **three intertwined smoke helices**." Note `spawnSmoke` now honors the particle ceiling and
    `liveParticles()` counts smoke.
  - If the visual-suite scenarios are enumerated anywhere in SUMMARY's testing/visual section, add
    `17-triple-spiral-rocket` to the list.
  - Bump the `**Updated:**` line/date at the top with a one-line summary of this change.
- **`docs/CHANGELOG.md`:** add a bullet under today's date (`## 2026-07-04`), lead with a bold summary:
  **"Triple spiral rocket + fading-line rocket trail"** — the new 4000-credit shop rocket (invisible
  homing leader + 3 visible spiraling warheads, each a real rocket: own damage/HP, independent
  detonation + shoot-down) and the reworked standard rocket smoke (expanding cone → thin dissipating haze
  line, now particle-budget-capped).
- **`docs/DECISIONS.md`:** add one numbered entry — **why the triple spiral is modeled as an invisible
  leader + 3 real child rockets** (vs. a single leader-detonation): keeps homing logic in one place while
  letting each warhead deal/absorb damage and be intercepted independently, reusing the existing
  rocket-vs-bullet and detonation code paths (§30 simplicity — no new pool, no per-warhead guidance).

## Out of scope / non-goals (do not gold-plate — DECISIONS §30)
- **No new .glb / no bespoke rocket model**, no CREDITS.md change, **no `/publish-itch` step** (nothing
  content-hashed changed).
- No new fire group, button, or key — the triple spiral uses the existing **rocket** group (`F` / 🚀) when
  equipped in the rocket mount. No loadout-UI changes beyond the weapon appearing in the shop list.
- No new sound — reuse the existing `rocket` fire SFX + `blast` detonation via the `class: 'rocket'` map.
- No enemy variant of the triple spiral (player-only shop weapon).
- No true Line-mesh / ribbon trail geometry — the fading-puff approach is the whole trail rework.
- No leader detonation/damage, no per-warhead independent guidance, no configurable warhead count
  (fixed at 3).
- No hangar 3D showcase model for the weapon (no `model_url_high`).
