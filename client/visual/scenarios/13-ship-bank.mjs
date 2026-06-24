// Ship wing-bank on turn (docs/plans/ship-bank-on-turn.md): every ship rolls its wings into a turn,
// capped at 20°, eases back to level when straight — cosmetic only (no effect on heading/physics).
// We assert on the bank group's roll (window.__game.player.mesh.userData.bankGroup.rotation.z) rather
// than diffing pixels; screenshots are saved for a human to eyeball the lean direction.
export const name = 'ship-bank';

const BANK_MAX = 20 * Math.PI / 180; // 0.349 rad — the documented hard cap

const rollOf = (page) => page.evaluate(() => ({
  z: window.__game.player.mesh.userData.bankGroup.rotation.z,
  roll: window.__game.player.roll ?? 0,
  headingMatches: Math.abs(window.__game.player.mesh.rotation.y - window.__game.player.heading) < 1e-6,
}));

export default async function ({ page, assert, shot }) {
  // Launch from whichever menu is up (by scenario order the throwaway player may land on the Hangar,
  // not the welcome screen), then focus the canvas so keyboard turning reaches the game.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    if (vis('hangar')) document.getElementById('hangar-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(200);
  await page.mouse.click(640, 400);

  // starts level
  const start = await rollOf(page);
  assert.ok(Math.abs(start.z) < 0.02, `starts ~level (roll=${start.z})`);

  // hold a right turn (KeyD: heading -= turn*dt) for a beat
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  const right = await rollOf(page);
  await shot('bank-right');
  assert.ok(Math.abs(right.z) > 0.15, `banks while turning (roll=${right.z})`);
  assert.ok(Math.abs(right.z) <= BANK_MAX + 1e-3, `never exceeds the 20° cap (roll=${right.z}, cap=${BANK_MAX})`);
  assert.ok(Math.abs(right.z - right.roll) < 1e-6, 'bankGroup.rotation.z mirrors ship.roll');
  assert.ok(right.headingMatches, 'heading (mesh.rotation.y) is independent of the bank');

  // the opposite turn banks the opposite way
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(600);
  const left = await rollOf(page);
  await shot('bank-left');
  assert.ok(Math.abs(left.z) > 0.15 && Math.sign(left.z) === -Math.sign(right.z),
    `opposite turn banks the opposite way (right=${right.z}, left=${left.z})`);
  assert.ok(Math.abs(left.z) <= BANK_MAX + 1e-3, `left turn also within the cap (roll=${left.z})`);

  // release → eases back to level
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(800);
  const leveled = await rollOf(page);
  await shot('leveled');
  assert.ok(Math.abs(leveled.z) < 0.05, `levels out when released (roll=${leveled.z})`);

  // enemies bank too: they steer toward the player, so circling makes them turn. Enemies use a .glb
  // model, so this also exercises Step 2 (the model loads into the bank group).
  await page.evaluate(() => { window.__game.spawnEnemy(); window.__game.spawnEnemy('rocketeer'); });
  await page.keyboard.down('KeyD'); // keep circling so chasing enemies must turn
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyD');
  const enemies = await page.evaluate(() => window.__game.enemies.map((e) => {
    const b = e.mesh.userData.bankGroup;
    return { hasBank: !!b, z: b ? b.rotation.z : null };
  }));
  await shot('enemies');
  assert.ok(enemies.length > 0, 'enemies present');
  for (const e of enemies) {
    assert.ok(e.hasBank, 'each enemy has a bank group (Step 1/2 path)');
    assert.ok(Math.abs(e.z) <= BANK_MAX + 1e-3, `enemy bank within the cap (roll=${e.z})`);
  }
}
