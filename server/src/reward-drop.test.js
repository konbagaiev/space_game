// The last-kill reward crate (the level's `lastKillDrop`) in the HEADLESS sim, through the real death step:
// it appears only when the account does NOT own the reward, and "owned" is equipped OR exactly that item in
// the stash (`activeShip.stashRefs`, DECISIONS §166). A netsim room hands the account record in exactly this
// way (`socket.js` → `ship.activeShip`). Pure — no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimWorld } from './sim-host.js';
import { spawnEnemy } from '../../client/src/sim-core/ship-entity.js';
import { stepEnemyDeaths } from '../../client/src/sim-core/step-enemies.js';

function lastKillSpecials(activeShip) {
  const world = createSimWorld({ levelName: 'level-1', seed: 7, ship: activeShip === undefined ? {} : { activeShip } });
  assert.ok(world.enemyTotal > 0, 'level-1 has a known enemy total (isLastKillDrop needs it)');
  assert.deepEqual(world.levelRunner.level.lastKillDrop, { kind: 'weapon', refId: 5 }, 'level-1 rewards the Machine Gun');
  world.kills = world.enemyTotal - 1;
  const e = spawnEnemy(world, world.catalog.enemyShips.find((s) => s.name === 'pirate gunner'));
  e.hp = 0;
  stepEnemyDeaths(world);
  assert.equal(world.kills, world.enemyTotal, 'this death was the last kill');
  return world.drops.filter((d) => d.special).length;
}

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
