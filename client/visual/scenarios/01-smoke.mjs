// Smoke test: the game boots, renders a canvas, seeds the arena with enemies — and the CAMERA IS SANE.
export const name = '01-smoke';

export default async function ({ page, assert, shot }) {
  await page.waitForTimeout(200); // let the first frames run (the level runner fills the first wave)
  const info = await page.evaluate(() => {
    const g = window.__game, c = g.camera, q = c.quaternion, p = c.position;
    return {
      enemies: g.enemies.length,
      hasCanvas: !!document.querySelector('canvas'),
      camFinite: [q.x, q.y, q.z, q.w, p.x, p.y, p.z].every(Number.isFinite),
      // the camera follows the ship from above and looks back down at it
      camAboveShip: c.position.y > g.player.pos.y,
    };
  });
  assert.ok(info.hasCanvas, 'a WebGL canvas is present');
  assert.equal(info.enemies, 1, "the arena's first enemy has arrived — level-0 holds it until the intro's "
    + 'opening line has been read (spawn.earliest), and the runner waits for it — then staggers the rest in');
  // GUARD (2026-08-19). The sim owns transforms as plain `Vec3` now, and `THREE.Object3D.lookAt` branches
  // on `x.isVector3`: handing it a Vec3 falls through to `set(v, undefined, undefined)` and NaNs the
  // camera's orientation — nothing renders, nothing throws, and every simulation-state assertion (kills,
  // HP, the whole intro replay down to its tick count) still passes. That is exactly how this shipped
  // broken for an afternoon. A finite camera is the cheapest possible check for the whole class.
  assert.ok(info.camFinite, 'the camera has a finite position AND orientation (no NaN from a sim→THREE handoff)');
  assert.ok(info.camAboveShip, 'the camera sits above the ship it follows');
  await shot('start');
}
