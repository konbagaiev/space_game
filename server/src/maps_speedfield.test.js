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

// The `asteroids` compatibility shim was REMOVED on 2026-08-09, once both of its conditions were met:
// the itch build was re-published (butler build #1868869, v52) and the /v2 sandbox was redeployed from a
// main containing `speedField`. No published client reads `descriptor.asteroids` any more. This assertion
// replaces the old "the shim is still present" one — it now guards the opposite, so the dead key cannot
// quietly reappear via a copy-paste of an old descriptor. See DECISIONS §96.
test('the legacy `asteroids` key is gone from every descriptor', () => {
  for (const m of MAPS) {
    assert.equal(m.descriptor.asteroids, undefined,
      `${m.name}: the dead asteroids block was removed with the shim — do not reintroduce it`);
  }
});
