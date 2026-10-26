// The last-kill reward crate (the level's `lastKillDrop`) in the HEADLESS sim, through the real death step:
// it appears only when the account does NOT own the reward, and "owned" is equipped OR exactly that item in
// the stash (`activeShip.stashRefs`, DECISIONS §166). A netsim room hands the account record in exactly this
// way (`socket.js` → `ship.activeShip`). Pure — no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimWorld } from './sim-host.js';
import { spawnEnemy } from '../../client/src/sim-core/ship-entity.js';
import { stepEnemyDeaths } from '../../client/src/sim-core/step-enemies.js';

// Kill the level's last enemy (an enemy from that level's own spawn pool) with `activeShip` as the account
// record, and count the reward crates that dropped.
function lastKillSpecials(activeShip, { levelName = 'level-1', reward = { kind: 'weapon', refId: 5 }, enemy = 'pirate gunner' } = {}) {
  const world = createSimWorld({ levelName, seed: 7, ship: activeShip === undefined ? {} : { activeShip } });
  assert.ok(world.enemyTotal > 0, `${levelName} has a known enemy total (isLastKillDrop needs it)`);
  assert.deepEqual(world.levelRunner.level.lastKillDrop, reward, `${levelName} rewards ${JSON.stringify(reward)}`);
  world.kills = world.enemyTotal - 1;
  const e = spawnEnemy(world, world.catalog.enemyShips.find((s) => s.name === enemy));
  e.hp = 0;
  stepEnemyDeaths(world);
  assert.equal(world.kills, world.enemyTotal, 'this death was the last kill');
  return world.drops.filter((d) => d.special).length;
}

// Level 2: the reward is the Repair drone (component 12); its last kill is the mini boss (its boss wave).
const L2 = { levelName: 'level-2', reward: { kind: 'component', refId: 12 }, enemy: 'pirate mini boss' };

test('last kill: no account record → the reward crate drops (proves the branch is reached)', () => {
  assert.equal(lastKillSpecials(undefined), 1);
});

test('last kill: the reward equipped → no crate', () => {
  assert.equal(lastKillSpecials({ loadout: { mounts: [{ weapon: 5 }] } }), 0);
});

test('last kill: the reward in the stash → no crate; sold (absent from stashRefs) → the crate is back', () => {
  assert.equal(lastKillSpecials({ loadout: { mounts: [{ weapon: 1 }] }, stashRefs: [{ kind: 'weapon', refId: 5 }] }), 0);
  assert.equal(lastKillSpecials({ loadout: { mounts: [{ weapon: 1 }] }, stashRefs: [] }), 1);
});

// DECISIONS §169: a component reward is owned by its exact id, not by "the repair slot is filled".
test('level 2 last kill: Repair drone II (19) equipped, drone 12 not owned → the reward crate drops', () => {
  assert.equal(lastKillSpecials({ components: { repair: 19 }, stashRefs: [] }, L2), 1);
});

test('level 2 last kill: the Repair drone (12) equipped → no crate', () => {
  assert.equal(lastKillSpecials({ components: { repair: 12 }, stashRefs: [] }, L2), 0);
});
