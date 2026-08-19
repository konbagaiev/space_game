// Every ship that has a 3D model must carry a baked `muzzle` (and `exhaust`) in its `model:{}` block.
//
// WHY THIS GUARD EXISTS, and why it is not optional. Where a bullet is born is simulation input:
// `ship-build.fireMount` spawns the projectile at `noseZ × the ship's world scale`, so that number decides
// what a shot can hit. It used to be MEASURED at runtime off the loaded .glb, which was correct in a
// browser and impossible in Node — so it is now baked into this seed by `npm run assets:muzzle`.
//
// That trade changed the failure mode for the worse if left unguarded. Before, a missing `muzzle` meant
// "measure it" and everything worked. Now it means the entity falls back to 1.6 — the PRIMITIVE ship's cone
// nose — while the visible hull's nose is somewhere else entirely. Bullets would leave from inside or in
// front of the model, and nothing would throw. So: add a ship model, run `npm run assets:muzzle`, or this
// test tells you exactly which ship you forgot.
//
// See docs/plans/server-authoritative-sim.md and docs/plans/ship-model-pipeline.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHIPS } from './catalog_seed.js';

const modelled = SHIPS.filter((s) => s.modelUrl);

test('there are modelled ships to check (a seed rename must not silently empty this guard)', () => {
  assert.ok(modelled.length >= 8, `expected the modelled ships, found ${modelled.length}`);
});

for (const ship of modelled) {
  test(`${ship.name}: muzzle/exhaust are baked into the seed`, () => {
    const m = ship.stats?.model;
    assert.ok(m, `${ship.name} has a modelUrl but no model:{} block`);
    assert.equal(typeof m.muzzle, 'number',
      `${ship.name} has no baked muzzle — run \`npm run assets:muzzle\`. Without it every shot leaves from `
      + `1.6 (the primitive cone's nose) instead of this hull's actual nose, silently.`);
    assert.equal(typeof m.exhaust, 'number', `${ship.name} has no baked exhaust — run \`npm run assets:muzzle\``);
    // The nose is forward (+Z) and the tail is aft (−Z) in the group-local frame every hitbox lives in.
    assert.ok(m.muzzle > 0, `${ship.name}: muzzle must be forward of the hull centre (got ${m.muzzle})`);
    assert.ok(m.exhaust < 0, `${ship.name}: exhaust must be aft of the hull centre (got ${m.exhaust})`);
    // Models are normalized so their longest axis spans SHIP_MODEL_LEN (3.4) → nothing can reach past ±1.7.
    assert.ok(m.muzzle <= 1.7 + 1e-9, `${ship.name}: muzzle ${m.muzzle} is outside the normalized hull`);
    assert.ok(m.exhaust >= -1.7 - 1e-9, `${ship.name}: exhaust ${m.exhaust} is outside the normalized hull`);
  });
}
