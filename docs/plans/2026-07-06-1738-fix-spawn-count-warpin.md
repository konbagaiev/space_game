# Fix spawn-count regression + enemy warp-in animation

**Feature ID:** 2026-07-06-1738-fix-spawn-count-warpin
**Area:** server catalog (deterministic spawn totals) + client level runner / spawn-timing / ship-build
(warp-in). Touches `catalog_seed.js`, `missions.js`, `enemy_total.js` (server) and `sim.js`,
`ship-build.js`, `projectiles.js`, a new `level-sim.js` (client).

## Goal

The just-shipped staggered spawns (DECISIONS §53) broke the last-kill reward drops and the HUD
"destroyed X/Y" counter: the drop fires on `G.kills === G.enemyTotal` (`client/src/sim.js:719`), but
`enemyTotal` was precomputed by `server/src/enemy_total.js` under the **old instant-fill** assumption that a
`kills:`/`killsSincePhase:` threshold phase leaves exactly `maxConcurrent` enemies alive ("carry") when it
advances. Staggering trickles enemies in one at a time, so a threshold phase now advances with far fewer
than `maxConcurrent` alive — actual kills land at a variable 14/15 instead of the precomputed 16, so the
counter stops short and the drop never fires (Machine Gun on L1, Repair drone on L2 stopped appearing).

**Part 1 (fix):** make spawn counts **deterministic** — give every threshold phase an explicit `total`
cap equal to its kill-delta so it leaves **0** enemies alive at advance, and turn the `spawn:null`
clear-out phases (and L1's finale) into real spawning waves that carry the remainder. `enemyTotal` becomes
the exact sum of every phase's `total`, the counter reaches N/N, and the drop fires on the true last kill.
Each level's total is preserved except **L1 (16 → 14)** by design (two fewer finale rocketeers). A new
pure headless client sim proves the counter reaches `enemyTotal` and the drop predicate fires on the last
kill — the coverage gap that let this ship.

**Part 2 (warp-in):** instead of an empty 2–4 s gap then a 1 s pop, the enemy **appears immediately** as a
dot and **materializes over its 2–4 s stagger interval** — the delay *is* the arrival animation. While
warping the enemy is **invulnerable, cannot fire, and is not a valid homing-rocket target**; it still
counts toward `maxConcurrent` (preserving staggering) and shows its off-screen marker so the player sees it
arriving. It becomes a normal combatant the instant it finishes forming. The **player warp-back stays
1.0 s** (`SPAWN_GROW_TIME`) — only enemy spawns use the new per-instance duration.

## Decisions (settled — do not re-open)

1. **Threshold phases get `total = kill-delta.`** A `kills:N`/`killsSincePhase:N` phase's `total` must
   equal the number of kills that happen *inside* that phase, so it leaves 0 alive at advance (a larger cap
   leaves survivors; a smaller cap deadlocks). Threshold phases keep their `kills:`/`killsSincePhase:`
   advance conditions.
2. **The "carry" remainder is spawned in the `allCleared` phases** — clear-out phases become small final
   waves (pool = that level's wave-2 pool); L1 (no clear-out) folds it into the finale. Boss phases keep
   `total:1`/`total:2`. The boss still appears essentially alone (the clear-out wave is spawned + killed
   first; the boss phase then spawns with a reset cooldown → immediate, alone).
3. **Per-level totals (FINAL):** L1 **14** (16→14), L2 **17**, L3 **21**, L4 **22**, side missions **20**.
4. **`enemy_total.js` simplifies to "sum of every phase's `spawn.total`"** — carry logic removed.
5. **Warp-in duration = the enemy's armed stagger delay** (`gate.cooldown`, the 2–4 s just armed), carried
   per-instance on `e.spawnDur`; `SPAWN_GROW_TIME` (1.0 s) stays as the default and the player warp-back.
6. **Warping enemy:** counts toward `maxConcurrent`; no collision (player bullets/ram pass through) and not
   a homing-rocket target; can't fire; shows its normal edge marker; over-enemy health bar is moot (hp stays
   full while invulnerable). Becomes normal the instant `spawnAge >= spawnDur`.
7. **Drop trigger stays the single `kills === enemyTotal` condition** (now deterministic) — no second
   structural trigger (DECISIONS §30). The new full-level test is the regression guard. The decision is
   extracted into a pure predicate `isLastKillDrop({kills, enemyTotal})` so it is unit-testable.
8. **Catalog reseeds only on server restart.** `enemyTotal` is recomputed from the phase script at seed
   time (`catalog_seed.js:534`). After editing the seed, a **local DB reset/server restart** is needed to
   see the new totals locally; **prod reseeds on deploy**.

---

## Steps

### 1. Deterministic spawn totals — `server/src/enemy_total.js` (rewrite the function)

Replace the whole `enemyTotalFromPhases` body + comment block (`server/src/enemy_total.js:1-32`) with the
sum-of-totals model:

```js
// Total enemies destroyed to complete a level/mission — precomputed on the server and stamped onto each
// descriptor (`descriptor.enemyTotal`) so the client HUD can show killed/total. With deterministic
// staggered spawns (DECISIONS §54) EVERY spawning phase carries an explicit `total` cap: a threshold
// (kills/killsSincePhase) phase's total equals its kill-delta so it leaves 0 enemies alive at advance,
// and clear-out/finale (`allCleared`) phases carry the remainder. So the total is simply the sum of every
// phase's spawn.total. Phases with no spawn (event:'win') contribute 0.
export function enemyTotalFromPhases(phases) {
  let total = 0;
  for (const ph of phases || []) {
    if (ph && ph.spawn && ph.spawn.total != null) total += ph.spawn.total;
  }
  return total;
}
```

### 2. Level seeds — `server/src/catalog_seed.js`

Add `total:` to each threshold phase (= its kill-delta) and convert the clear-out / L1-finale phases into
spawning waves drawing from that level's **wave-2 pool**. Keep the existing `advanceWhen` on every phase.

**Level 1** (`server/src/catalog_seed.js:388-406`):
- `wave-1` spawn (line ~390): add `total: 6` →
  `spawn: { maxConcurrent: 3, total: 6, pool: [{ ship: 'Basic pirate ship', chance: 100 }] }`
- `wave-2` spawn (lines ~395-399): add `total: 6` (keep the 75/25 pool).
- `finale` spawn (line ~404): change `total: 1` → **`total: 2`** (keep `maxConcurrent: 4`, rocketeer pool).
  → enemyTotal = 6 + 6 + 2 = **14** (the Machine Gun still drops off the last of the two finale rocketeers).

**Level 2** (`server/src/catalog_seed.js:424-444`):
- `wave-1`: add `total: 5`.
- `wave-2`: add `total: 7`.
- `clear-out` (line 438) — replace `{ name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } }`
  with a spawning wave using wave-2's pool:
  ```js
  { name: 'clear-out', // deterministic final wave before the boss (carries the old "carry" count)
    spawn: { maxConcurrent: 4, total: 4, pool: [
      { ship: 'Basic pirate ship', chance: 75 },
      { ship: 'basic rocket pirate', chance: 25 }] },
    advanceWhen: { allCleared: true } },
  ```
- `boss`: `total: 1` unchanged. → enemyTotal = 5 + 7 + 4 + 1 = **17** (Repair drone drops off the boss).

**Level 3** (`server/src/catalog_seed.js:459-483`):
- `wave-1`: add `total: 8`.
- `wave-2`: add `total: 8`.
- `clear-out` (line 478) — replace with wave-2's pool:
  ```js
  { name: 'clear-out',
    spawn: { maxConcurrent: 4, total: 4, pool: [
      { ship: 'Basic pirate ship', chance: 65 },
      { ship: 'basic rocket pirate', chance: 20 },
      { ship: 'pirate mini boss', chance: 15 }] },
    advanceWhen: { allCleared: true } },
  ```
- `boss`: `total: 1` unchanged. → enemyTotal = 8 + 8 + 4 + 1 = **21**.

**Level 4** (`server/src/catalog_seed.js:500-527`):
- `wave-1`: add `total: 8`.
- `wave-2`: add `total: 8`.
- `clear-out` (line 521) — replace with wave-2's pool (maxConcurrent 5):
  ```js
  { name: 'clear-out',
    spawn: { maxConcurrent: 5, total: 5, pool: [
      { ship: 'pirate gunner', chance: 35 },
      { ship: 'basic rocket pirate', chance: 35 },
      { ship: 'advanced medium pirate', chance: 30 }] },
    advanceWhen: { allCleared: true } },
  ```
- `boss`: `total: 1` unchanged. → enemyTotal = 8 + 8 + 5 + 1 = **22**.

### 3. Side missions — `server/src/missions.js` (`sideMissionPhases`, lines 16-30)

- `wave-1` (line 18): add `total: 7`.
- `wave-2` (line 22): add `total: 7`.
- `clear-out` (line 25) — replace `{ name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } }`
  with a spawning wave using wave-2's pool:
  ```js
  { name: 'clear-out',
    spawn: { maxConcurrent: 4, total: 4, pool: [
      { ship: GUNNER, chance: 35 }, { ship: ROCKETEER, chance: 35 }, { ship: HEAVY, chance: 30 }] },
    advanceWhen: { allCleared: true } },
  ```
- `bosses`: `total: 2` unchanged. → enemyTotal = 7 + 7 + 4 + 2 = **20** (unchanged).

> Sanity check the implementer must run mentally per level: `sum(spawn.total) === target` and each
> threshold phase's `total === (its kills threshold − the previous threshold)`.

### 4. Enemy warp-in duration + invulnerability

**a. `client/src/ship-build.js`** — per-instance warp fields (after line 103,
`e.mesh.scale.setScalar(0.001);` in `spawnEnemyShip`). Add:

```js
  e.spawnDur = SPAWN_GROW_TIME; // warp-in duration; the level runner overrides this to the stagger delay
  e.warping = true;             // invulnerable + can't fire + not homing-targetable until fully formed
```

(`SPAWN_GROW_TIME` is already imported at `client/src/ship-build.js:7`. Direct `spawnEnemy(role)` tool/test
spawns keep the 1.0 s default and become normal after 1 s.)

**b. `client/src/sim.js` — level runner passes the stagger delay as the warp duration.** In `update()`
(`client/src/sim.js:169-172`), change the spawn to capture `gate.cooldown` (the 2–4 s just armed) onto the
enemy:

```js
      if (gate.spawn) {
        const def = CATALOG.shipByName.get(this.pickShip(ph.spawn.pool));
        if (def) { const e = spawnEnemyShip(def); e.spawnDur = gate.cooldown; this.spawnedThisPhase++; }
      }
```

`spawnEnemyShip` already set `e.warping = true`; here we only override `e.spawnDur` to the armed delay. The
next spawn's cooldown drains over exactly this enemy's warp, so the next one appears as this one finishes.

**c. `client/src/sim.js` — grow loop uses the per-instance duration + clears `warping`.** Replace the enemy
warp-grow block (`client/src/sim.js:453-459`):

```js
    // spawn animation: grow from a dot to full size over the enemy's warp duration (ease-out). While
    // warping the enemy is invulnerable + can't fire + isn't homing-targetable (guards below); the
    // duration is its stagger interval so "the delay IS the arrival animation" (DECISIONS §54).
    if (e.spawnAge < e.spawnDur) {
      e.spawnAge = Math.min(e.spawnDur, e.spawnAge + dt);
      const t = e.spawnAge / e.spawnDur;
      const k = 1 - Math.pow(1 - t, 3); // ease-out cubic
      e.mesh.scale.copy(e.spawnScale).multiplyScalar(Math.max(0.001, k));
      if (e.spawnAge >= e.spawnDur) e.warping = false; // fully formed: now a normal combatant
    }
```

**d. `client/src/sim.js` — warping enemies can't fire.** In the enemy AI fire predicate
(`client/src/sim.js:485-486`), add `!e.warping &&`:

```js
    updateGroups(e, ef, false, dt,
      (g) => !e.warping && G.combatElapsed >= ENEMY_FIRE_GRACE && g.ai && dist < g.ai.range && Math.abs(diff) < g.ai.aimTol);
```

**e. `client/src/sim.js` — player bullets pass through warping enemies.** In the player-bullet collision
loop (`client/src/sim.js:500-504`), skip warping enemies:

```js
      for (const e of enemies) {
        if (e.warping) continue; // invulnerable while forming — bullets pass through
        if (segmentHitsShip(e, _bulletP0, b.mesh.position)) {
          e.hp -= b.damage; hit = true; audio.sfx.hit(); break;
        }
      }
```

**f. `client/src/sim.js` — player rockets don't detonate on warping enemies.** In the rocket-vs-enemy
detonation-TRIGGER loop (`client/src/sim.js:593-596`):

```js
    if (r.fromPlayer) {
      for (const e of enemies) {
        if (e.warping) continue; // no detonation on a forming enemy
        if (pointHitsShip(e, r.obj.position, r.detonateR)) { det = true; break; }
      }
    } else if (G.player.alive && pointHitsShip(G.player, r.obj.position, r.detonateR)) {
```

**f2. `client/src/projectiles.js` — rocket BLAST damage skips warping enemies (SEPARATE path).** The
detonation trigger in step f only decides *whether* a rocket detonates; the actual splash damage is dealt
by a **second, independent loop** inside `detonateRocket` (`client/src/projectiles.js:285-288`). A rocket
that legitimately detonates on a formed enemy — or expires at `maxRange` — within `blastR` of a warping
enemy would still splash-damage (and could kill / chip below `maxHp`, then show a health bar on a dot-sized
ship) that warping enemy. Guard the player-side blast loop:

```js
    if (r.fromPlayer) {
      for (const e of enemies) {
        if (e.warping) continue; // invulnerable while forming — no splash damage
        if (pointHitsShip(e, r.obj.position, r.blastR)) e.hp -= r.damage;
      }
    } else if (G.player.alive && pointHitsShip(G.player, r.obj.position, r.blastR)) {
```

This guard sits **inside the `dealDamage && r.fromPlayer` branch**, so the shot-down path
(`detonateRocket(r, false)` from the bullet-interception code in `sim.js:519` — `dealDamage=false`) never
reaches it and is unaffected; place the `continue` only in this player-damage loop, not the `else` player
branch.

**g. `client/src/projectiles.js` — homing rockets don't target warping enemies.** In `findTargetInSector`
(`client/src/projectiles.js:205`), skip warping enemies:

```js
  for (const e of enemies) {
    if (e.warping) continue; // not a valid homing target until fully formed
    const to = e.mesh.position.clone().sub(pos);
```

No `hud.js` change: the off-screen enemy marker already iterates all `enemies` (desired — the player sees
the arrival), and the over-enemy health bar (`hud.js:194`) only shows at `hp < maxHp`. Because **all** three
player→enemy damage paths now skip warping enemies (bullets — step e; rocket detonation trigger — step f;
rocket blast splash — step f2), a warping enemy's hp stays exactly `maxHp`, so no bar ever appears on a
dot-sized ship and no health-bar-while-warping logic is needed. The player warp-back
(`client/src/sim.js:433-438`) keeps `SPAWN_GROW_TIME` — untouched.

### 5. Pure drop-trigger predicate + full-level sim — new `client/src/level-sim.js`

Create a leaf, dependency-light module (only imports the pure `spawn-timing.js`) so it loads under
`node --test` (mirrors why `spawn-timing.js` / `enemy_total.js` exist):

```js
// Deterministic headless replay of the staggered levelRunner (client/src/sim.js update/shouldAdvance),
// plus the last-kill drop predicate — pure + dependency-light so it is unit-testable without the WebGL
// engine graph. Proves the destroyed counter reaches enemyTotal exactly and the reward drop fires on the
// true last kill under staggered spawns (the regression 2026-07-06-1738 fixed).
import { stepSpawnGate } from './spawn-timing.js';

// enemyTotal is the sum of every spawning phase's `total` (mirrors server/src/enemy_total.js).
export function levelEnemyTotal(phases) {
  return (phases || []).reduce((s, ph) => s + ((ph.spawn && ph.spawn.total) || 0), 0);
}

// The last-kill reward drop condition (extracted from sim.js so it is testable).
export function isLastKillDrop({ kills, enemyTotal }) {
  return enemyTotal > 0 && kills === enemyTotal;
}

// Replay a level to completion. Deterministic: fixed dt, mid-range (rand→0.5) stagger delays, the "player"
// destroys one available enemy per step. Returns the total kills to clear and the kill index the drop
// fires on. Warp invulnerability only delays WHEN an enemy is killable, never the final count, so it isn't
// modeled here — the count/drop determinism is what this guards; sim.js guards + the live test cover warp.
export function simulateLevel(phases, { dt = 1 / 60, rand = () => 0.5 } = {}) {
  const enemyTotal = levelEnemyTotal(phases);
  let idx = 0, kills = 0, killsAtPhaseStart = 0, spawnedThisPhase = 0, cooldown = 0, alive = 0;
  let dropKill = null;
  const shouldAdvance = (ph) => {
    const c = ph.advanceWhen;
    if (!c) return false;
    if (c.kills != null) return kills >= c.kills;
    if (c.killsSincePhase != null) return (kills - killsAtPhaseStart) >= c.killsSincePhase;
    if (c.allCleared) {
      const spawnDone = !ph.spawn || (ph.spawn.total != null && spawnedThisPhase >= ph.spawn.total);
      return alive === 0 && spawnDone;
    }
    return false;
  };
  for (let guard = 0; guard < 1e6; guard++) {
    const ph = phases[idx];
    if (!ph || ph.event === 'win') break;
    if (ph.spawn) {
      const cap = ph.spawn.total;
      const capRemaining = cap == null ? null : cap - spawnedThisPhase;
      const g = stepSpawnGate({ cooldown, dt, alive, maxConcurrent: ph.spawn.maxConcurrent, capRemaining }, rand);
      cooldown = g.cooldown;
      if (g.spawn) { alive++; spawnedThisPhase++; }
    }
    if (shouldAdvance(ph) && idx < phases.length - 1) {
      idx++; killsAtPhaseStart = kills; spawnedThisPhase = 0; cooldown = 0; continue;
    }
    if (alive > 0) {
      alive--; kills++;
      if (dropKill == null && isLastKillDrop({ kills, enemyTotal })) dropKill = kills;
    }
  }
  return { enemyTotal, totalKills: kills, dropKill };
}
```

### 6. Wire the extracted predicate into `client/src/sim.js`

Import it (add near the `spawn-timing.js` import, `client/src/sim.js:15` region):

```js
import { isLastKillDrop } from './level-sim.js';
```

Replace the inline condition (`client/src/sim.js:718-719`):

```js
      const lkd = levelRunner.level && levelRunner.level.lastKillDrop;
      if (lkd && isLastKillDrop({ kills: G.kills, enemyTotal: G.enemyTotal }) && !ownsReward(lkd)) {
        spawnSpecialDrop(e.mesh.position, lkd);
```

(Behavior identical to today's `G.kills === G.enemyTotal`; the extraction just makes it testable.)

---

## Tests

### Server — `server/src/enemy_total.test.js` (update)

Run: `cd server && npm test` (**both SQLite and Postgres** — this change is catalog-only, no `db.js`/
`db_postgres.js` edits, but the seed feeds both; keep them un-diverged).

- **`EXPECTED` (line 42):** change `'level-1': 16` → **`'level-1': 14`**. Verify `level-2:17`, `level-3:21`,
  `level-4:22`, side `20` stay green (they should — the totals are preserved by design). The existing
  `simulateKillsToClear` oracle already honors `total` caps, so it returns the same numbers for the new
  seeds.
- **Rewrite the third test `'enemyTotalFromPhases: rule pieces (carry from leftovers)'` (lines 62-81)** — it
  asserts the removed carry semantics and will fail. Replace with the sum-of-totals contract:
  ```js
  test('enemyTotalFromPhases: sums every phase spawn.total (no carry), ignores non-spawning phases', () => {
    assert.equal(enemyTotalFromPhases([]), 0);
    assert.equal(enemyTotalFromPhases([
      { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 6 } },
      { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 12 } },
      { spawn: { maxConcurrent: 4, total: 2 }, advanceWhen: { allCleared: true } },
    ]), 14);
    assert.equal(enemyTotalFromPhases([
      { spawn: null, advanceWhen: { allCleared: true } }, // clear-out with no spawn adds 0
      { event: 'win' },                                    // win phase adds 0
    ]), 0);
  });
  ```

### Client — new `client/src/level-sim.test.js` (create)

Run: `cd client && node --test`. Assert the count + drop determinism over each real level-shaped phase
script (define them inline mirroring `catalog_seed.js`/`missions.js`; keep a comment noting to keep them in
sync — the server test above locks the real seed's totals):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelEnemyTotal, isLastKillDrop, simulateLevel } from './level-sim.js';

test('isLastKillDrop fires only when kills exactly reaches a positive enemyTotal', () => {
  assert.equal(isLastKillDrop({ kills: 13, enemyTotal: 14 }), false);
  assert.equal(isLastKillDrop({ kills: 14, enemyTotal: 14 }), true);
  assert.equal(isLastKillDrop({ kills: 0, enemyTotal: 0 }), false); // no total known → never
});

// Level-shaped phase scripts (mirror catalog_seed.js / missions.js; totals verified by the server test).
const L1 = [
  { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 6 } },
  { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 12 } },
  { spawn: { maxConcurrent: 4, total: 2 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
const L2 = [
  { spawn: { maxConcurrent: 4, total: 5 }, advanceWhen: { kills: 5 } },
  { spawn: { maxConcurrent: 4, total: 7 }, advanceWhen: { kills: 12 } },
  { spawn: { maxConcurrent: 4, total: 4 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 1, total: 1 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
// NOTE: use the REAL maxConcurrent so every threshold phase is the mc < total shape (e.g. 4 < 8) — that's
// the deadlock-risk case the sim must clear (a phase must spawn more than one wave-worth without the gate
// or advance stalling). Keep these arrays mirrored with catalog_seed.js / missions.js.
const L3 = [
  { spawn: { maxConcurrent: 4, total: 8 }, advanceWhen: { kills: 8 } },
  { spawn: { maxConcurrent: 4, total: 8 }, advanceWhen: { kills: 16 } },
  { spawn: { maxConcurrent: 4, total: 4 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 1, total: 1 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
const L4 = [
  { spawn: { maxConcurrent: 5, total: 8 }, advanceWhen: { kills: 8 } },
  { spawn: { maxConcurrent: 5, total: 8 }, advanceWhen: { kills: 16 } },
  { spawn: { maxConcurrent: 5, total: 5 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 1, total: 1 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
const SIDE = [
  { spawn: { maxConcurrent: 4, total: 7 }, advanceWhen: { kills: 7 } },
  { spawn: { maxConcurrent: 4, total: 7 }, advanceWhen: { kills: 14 } },
  { spawn: { maxConcurrent: 4, total: 4 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 4, total: 2 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];

for (const [name, phases, total] of [['L1', L1, 14], ['L2', L2, 17], ['L3', L3, 21], ['L4', L4, 22], ['SIDE', SIDE, 20]]) {
  test(`${name}: staggered runner reaches enemyTotal exactly and the drop fires on the last kill`, () => {
    assert.equal(levelEnemyTotal(phases), total, 'summed enemyTotal');
    const r = simulateLevel(phases);
    assert.equal(r.totalKills, total, 'destroyed counter reaches enemyTotal exactly');   // (a)
    assert.equal(r.dropKill, total, 'last-kill reward drop fires on the final kill');     // (b)
  });
}
```

Existing `spawn-timing.test.js` is unaffected.

### Client — new visual scenario: rocket blast spares a warping enemy (create)

The blast guard (step f2) lives in `projectiles.js`, which imports the WebGL engine and can't load under
`node --test`, so this **outcome** test runs in the visual suite (real projectiles path), driven through
`window.__game` (which exposes `enemies`, `spawnEnemy`, `spawnRocket`, `catalog`, `scene`). Add
`client/visual/scenarios/NN-warp-blast-immunity.mjs` (next free number) that:

1. Starts a level, then clears the seeded wave:
   `g.enemies.slice().forEach((e) => g.scene.remove(e.mesh)); g.enemies.length = 0;`
2. Spawns a **formed** enemy as the legitimate detonation trigger and a **warping** enemy at the *same*
   position (well within `blastR`), both in front of the player:
   ```js
   const formed = g.spawnEnemy('fighter'); formed.warping = false; formed.spawnAge = formed.spawnDur; // fully formed
   const warp   = g.spawnEnemy('fighter'); warp.warping = true; warp.spawnDur = 999; warp.spawnAge = 0; // frozen mid-warp
   // place both at the same spot a short distance ahead of the player (mirror 16-enemy-health-bar's setup)
   ```
   Record `const maxHp = warp.maxHp;`.
3. Fires a player rocket at that spot and lets the sim run until it detonates — mirror the game's own rocket
   fire params (see the rocket group fire in `client/src/ship-build.js` `fireMount` / `spawnRocket` call):
   pick the rocket weapon from `g.catalog.weapons`, call `g.spawnRocket(from, fwd, weapon, accel, true, formed)`
   with `from` just behind the pair and `fwd` toward it; step frames (the harness's advance helper) until
   `g.rockets.length === 0` (detonated).
4. Asserts the outcome:
   ```js
   assert.equal(warp.hp, maxHp, 'warping enemy takes NO rocket blast damage (invulnerable while forming)');
   assert.ok(formed.hp < formed.maxHp, 'the blast actually fired — the formed enemy was damaged');
   ```
   (Assert the formed enemy took damage too, so the test fails loudly if the rocket never detonated rather
   than passing vacuously.)

### Client — visual scenarios (verify, likely no edits)

Run: `cd client && node visual/run.mjs` (known-flaky baseline ~6 scenarios; judge by the reliably-passing
set + zero page errors). The staggering feature already updated `01-smoke`/`04-combat`. Confirm these still
pass under warp-invulnerability — none should need edits because:
- `04-combat.mjs:19` asserts `enemies > 0 || earned > 0` (first-spawn-immediate keeps `enemies > 0`).
- `16-enemy-health-bar.mjs` sets `e.hp` **directly** (line 33/49) — a direct write, not combat damage, so
  invulnerability doesn't block it; the "no bar at full hp" check holds while warping (hp stays max).
- `11-l4-enemies.mjs` / `03-exhaust-trail.mjs` read `e.hp`/exhaust and never combat-damage the spawns.
If any scenario that combat-kills a freshly-spawned enemy within ~1 s appears, add a short settle wait past
`e.spawnDur`.

---

## Docs to update

- **`docs/SUMMARY.md` — `**Updated:**` header (lines 6-8).** Lead with this change (deterministic spawn
  totals + enemy warp-in-as-arrival), and demote the current staggered-spawns note to "Prior:". Keep the
  date 2026-07-06.
- **`docs/SUMMARY.md` — Level flow (lines 771-792).** Fix the per-level line 772-773 (L1): now "…at **12
  kills** two last rocketeers appear, clear the field → **Victory!** (enemyTotal **14**)." Update the
  staggered paragraph (787-792): every spawning phase now carries an explicit `total` (threshold phase
  `total` = its kill-delta → 0 alive at advance; clear-out/finale waves carry the remainder), so
  `enemyTotal` is the exact sum of phase totals and the killed/total counter reaches N/N. Replace the
  "Totals (`enemyTotal`) are unchanged by pacing" sentence (it is no longer true — L1 is 16→14).
- **`docs/SUMMARY.md` — Enemy spawn "warp in" (lines 971-972).** Rewrite: a newly spawned enemy appears
  immediately as a dot and **materializes over its stagger interval** (the armed 2–4 s, `e.spawnDur`;
  `SPAWN_GROW_TIME` 1 s is the default + the player warp-back) — while forming it is **invulnerable, can't
  fire, and isn't a homing-rocket target** (`e.warping`, cleared when `spawnAge >= spawnDur`); it still
  counts toward `maxConcurrent` and shows its edge marker.
- **`docs/SUMMARY.md` — client file map (line 1454).** Append a sibling to the `spawn-timing.js` entry:
  `level-sim.js` (pure headless level replay + the `isLastKillDrop` drop predicate, unit-tested).
- **`docs/CHANGELOG.md`** — add under `## 2026-07-06`:
  *"**[2026-07-06-1738-fix-spawn-count-warpin] Deterministic spawn counts + enemy warp-in.** Fixed a
  staggered-spawns regression where the last-kill reward drops (L1 Machine Gun, L2 Repair drone) stopped
  appearing and the destroyed X/Y counter finished short (14/16, 15/16): the precomputed `enemyTotal`
  assumed the old instant-fill "carry". Every spawning phase now has an explicit `total` (threshold phase =
  its kill-delta, 0 leftovers; clear-out/finale waves carry the remainder), so `enemyTotal` = sum of phase
  totals and the counter reaches N/N and the drop fires on the true last kill. Totals preserved except L1
  (16→14). Enemies now appear immediately and materialize over their 2–4 s stagger interval — invulnerable,
  non-firing, and not homing-targetable until fully formed (player warp-back stays 1 s). New pure
  `client/src/level-sim.js` + test proves counter=enemyTotal and the drop fires on the last kill; server
  `enemy_total` simplified to sum-of-totals. Catalog reseeds on server restart (prod on deploy)."*
- **`docs/DECISIONS.md`** — add **§54** (next free; §53 is the last): *"## 54. Deterministic spawn totals
  (explicit per-phase `total`) + warp-in IS the stagger delay."* Record: staggering broke the
  carry-based `enemyTotal` oracle (the drop + counter depended on a leftover count that no longer exists);
  the fix makes counts deterministic (threshold `total` = kill-delta → 0 leftovers; carry becomes real
  clear-out/finale waves) so `enemyTotal` = sum of totals. L1 intentionally drops 16→14. The enemy warp-in
  now spans the stagger interval (the delay is the arrival animation) with invulnerability so the trickle
  isn't spawn-camped mid-materialize. No second structural drop-trigger (§30) — one deterministic
  `kills === enemyTotal`, guarded by a headless full-level test (the missing coverage that let this ship).

---

## Out of scope / non-goals (do not gold-plate)

- **No change to the 2–4 s stagger window, `maxConcurrent`, `chance` weights, or spawn pools** beyond the
  `total` additions and the clear-out/finale pool reuse specified above.
- **No second/structural drop trigger** — single deterministic `kills === enemyTotal` (§30).
- **No new HUD/banner/telemetry**, no health-bar-while-warping logic, no marker changes.
- **No freezing of warping-enemy movement** — it flies in normally; only firing/damage/targetability are
  gated.
- **No `db.js` / `db_postgres.js` schema or query edits** — the change is catalog data + client sim only.
- **Do not touch** the `winPending` / `returningToBase` / boss-explosion / return-to-base flow, or the
  player warp-back duration.
