// The player build the Loadout stats bar reads (shop.js deriveShipStats → makePlayer). The bar used to
// re-derive HP / Accel / Turn / Weight by hand and never applied skills, so a pilot with Mobility points
// read lower numbers than the ship flew (duplication audit A3). These pin the numbers the bar now shows:
// Mobility scales acceleration + turn rate + top speed, leaves mass + HP alone, never mutates the shared
// catalog, and Top speed = PLAYER_MAX_SPEED × maxSpeedMul (the sim's own clamp in step-player.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlayer } from './ship-entity.js';
import { PLAYER_MAX_SPEED } from './step-player.js';
import { SKILL_RATES } from './components.js';
import { buildCatalog } from '../../../server/src/sim-host.js';

const CAT = buildCatalog('level-1');
const SHIP = [...CAT.shipByName.values()].find((s) => s.type === 'player');
const active = (skills) => ({ ship: SHIP, loadout: { mounts: SHIP.stats.mounts }, components: SHIP.components, skills });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

test('the real player ship row is there and drives', () => {
  assert.ok(SHIP, 'a player ship in the seed catalog');
  const p = makePlayer(CAT, active(null));
  assert.ok(p.acceleration > 0 && p.turnRate > 0 && p.mass > 0 && p.maxHp > 0);
});

test('Mobility 5 scales acceleration + turn rate + max speed by 1.25; mass and HP unchanged', () => {
  const base = makePlayer(CAT, active(null));
  const mob = makePlayer(CAT, active({ mobility: 5 }));
  const mul = 1 + SKILL_RATES.mobilityPct * 5;
  assert.equal(mul, 1.25);
  near(mob.acceleration, base.acceleration * mul, 'acceleration');
  near(mob.turnRate, base.turnRate * mul, 'turnRate');
  assert.equal(base.maxSpeedMul, 1);
  assert.equal(mob.maxSpeedMul, 1.25);
  assert.equal(mob.mass, base.mass);
  assert.equal(mob.maxHp, base.maxHp);
});

test('a skilled build never mutates the shared catalog rows', () => {
  const eng = CAT.components.get(SHIP.components.engine);
  const thr = CAT.components.get(SHIP.components.thruster);
  const before = [eng.stats.power, thr.stats.power];
  makePlayer(CAT, active({ mobility: 5 }));
  makePlayer(CAT, active({ mobility: 5 }));
  assert.deepEqual([eng.stats.power, thr.stats.power], before);
  // and a fresh unskilled build still reads the catalog numbers (nothing compounded)
  near(makePlayer(CAT, active(null)).acceleration, makePlayer(CAT, active({})).acceleration, 'unskilled stable');
});

test('Top speed = PLAYER_MAX_SPEED × maxSpeedMul: 30 unskilled, 37.5 at Mobility 5', () => {
  assert.equal(PLAYER_MAX_SPEED * makePlayer(CAT, active(null)).maxSpeedMul, 30);
  assert.equal(PLAYER_MAX_SPEED * makePlayer(CAT, active({ mobility: 5 })).maxSpeedMul, 37.5);
});
