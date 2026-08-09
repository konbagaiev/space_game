// Map-descriptor guard for the player-locked speed field (the parallax backdrop the client builds in
// world.js from `descriptor.speedField`). Pure import of MAPS — no DB, same shape as enemy_total.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from './catalog_seed.js';

// The shipped no-pop-in floor. This is NOT scene.fog.far: THREE.Fog fogs on VIEW DEPTH, and under this
// near-top-down camera (CAM_OFFSET 0,110,26, ZOOM_MAX 3.5) the SHALLOW layers never even reach fogNear —
// what hides a recycled point is the FRUSTUM (the near layer's visible patch tops out at |dx| ~ 459 at
// 16:9). The DEEP layer out-reaches the frustum but is past fogFar there, so fog covers that end. Below 600
// the wrap edge starts entering the frame at max zoom-out. See client/src/speed-field.js WRAP_SAFE_RADIUS.
const WRAP_SAFE_RADIUS = 600;

test('every map descriptor ships a speedField with usable layers', () => {
  assert.ok(MAPS.length > 0, 'there is at least one map');
  for (const m of MAPS) {
    const sf = m.descriptor.speedField;
    assert.ok(sf, `${m.name}: has a speedField block`);
    assert.equal(typeof sf.color, 'number', `${m.name}: speedField.color is a colour number`);
    assert.ok(Array.isArray(sf.layers) && sf.layers.length >= 1, `${m.name}: at least one depth layer`);
    for (const [i, l] of sf.layers.entries()) {
      assert.ok(l.count > 0, `${m.name} layer ${i}: count > 0`);
      assert.ok(l.size > 0, `${m.name} layer ${i}: size > 0`);
      assert.ok(l.opacity > 0, `${m.name} layer ${i}: opacity > 0`);
      assert.ok(l.radius >= WRAP_SAFE_RADIUS,
        `${m.name} layer ${i}: radius ${l.radius} >= ${WRAP_SAFE_RADIUS} (else the wrap edge is visible at max zoom-out)`);
    }
  }
});

// DELETE THIS TEST TOGETHER WITH THE SHIM. The dead `asteroids` block is a deliberate one-release
// compatibility key: db.js upserts every map descriptor on each server start, so the already-published itch
// bundle and the /v2 sandbox (older clients reading the LIVE catalog) would throw in buildMap() without it.
// It goes away in the first change after /publish-itch + a /v2 redeploy from a main containing `speedField`
// — and this assertion makes that removal a conscious edit rather than an accident. See DECISIONS §95.
test('the dead `asteroids` compatibility shim is still present (one release only)', () => {
  for (const m of MAPS) {
    assert.ok(m.descriptor.asteroids, `${m.name}: keeps the legacy asteroids block for older published clients`);
  }
});
