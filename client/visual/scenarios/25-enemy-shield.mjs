// Enemy shields: every enemy's catalog hull durability is split into a 1/3 shield + 2/3 hull, the floating
// bar gains a blue (purple while recharging) shield strip above the red one, and an absorbed hit plays a
// ~1s ripple on a pooled per-enemy bubble sized snug around the hull.
//
// The bubble half of this guard is deliberately run WITHOUT the player ever being hit: the FX clock lives in
// shield-fx.js and used to only advance once a PLAYER bubble existed, which would freeze an enemy ripple
// on screen forever. Step 6c below is what catches that regression.
export const name = '25-enemy-shield';

export default async function ({ page, assert, shot }) {
  // launch from whichever menu is up (welcome or main window), then clear the wave and spawn one enemy
  // in front of the camera so its bars project on-screen (mirrors 16-enemy-health-bar's setup).
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);

  // --- 1-2. the split: a basic pirate's 30 HP light hull becomes 10 shield + 20 hull ---
  const split = await page.evaluate(() => {
    const g = window.__game;
    g.enemies.slice().forEach((e) => g.scene.remove(e.mesh));
    g.enemies.length = 0;
    const e = g.spawnEnemy('fighter');
    e.pos.set(0, 0.6, 6);   // just ahead of the player/camera
    e.scale = e.fullScale;  // skip the warp-in grow so it's full size (and stable) from here on
    e.spawnAge = e.spawnDur; e.warping = false;
    return { cap: e.shield && e.shield.capacity, rechargeSec: e.shield && e.shield.rechargeSec, hp: e.hp, maxHp: e.maxHp };
  });
  assert.equal(split.cap, 10, 'the basic pirate carves 10 of its 30 HP into a shield');
  assert.equal(split.hp, 20, 'the remaining 20 stays hull');
  assert.equal(split.maxHp, 20, 'maxHp is the HULL max (the shield is a separate pool)');
  assert.equal(split.rechargeSec, 10, 'a broken enemy shield refills 10 s after the breaking hit');

  // --- 3. nothing damaged → neither bar shows ---
  await page.waitForTimeout(120);
  const fresh = await page.evaluate(() => ({
    hp: [...document.querySelectorAll('#markers .enemy-hp')].filter((b) => b.style.display !== 'none').length,
    shield: [...document.querySelectorAll('#markers .enemy-shield')].filter((b) => b.style.display !== 'none').length,
  }));
  assert.equal(fresh.hp, 0, 'no health bar on a fresh enemy');
  assert.equal(fresh.shield, 0, 'no shield strip on a fresh enemy (both pools full)');

  // --- 4. a half-drained shield shows the blue strip while the hull bar stays full ---
  await page.evaluate(() => { window.__game.enemies[0]._shieldValue = 5; });
  await page.waitForTimeout(120);
  await shot('shield-partial');
  const partial = await page.evaluate(() => {
    const s = [...document.querySelectorAll('#markers .enemy-shield')].filter((b) => b.style.display !== 'none');
    const h = [...document.querySelectorAll('#markers .enemy-hp')].filter((b) => b.style.display !== 'none');
    return { count: s.length, fill: s[0] && s[0].firstChild.style.width, recharging: !!(s[0] && s[0].classList.contains('recharging')), hpFill: h[0] && h[0].firstChild.style.width };
  });
  assert.equal(partial.count, 1, 'a damaged shield shows the strip even at full hull');
  assert.equal(partial.fill, '50%', 'the strip tracks the remaining shield fraction');
  assert.equal(partial.recharging, false, 'a partial (unbroken) shield is blue, not recharging');
  assert.equal(partial.hpFill, '100%', 'the hull bar is untouched while the shield absorbs');

  // --- 5. a broken shield turns purple and fills with the recharge progress ---
  await page.evaluate(() => { const e = window.__game.enemies[0]; e._shieldValue = 0; e._shieldRechargeAccum = 5; });
  await page.waitForTimeout(120);
  await shot('shield-recharging');
  const recharging = await page.evaluate(() => {
    const s = [...document.querySelectorAll('#markers .enemy-shield')].filter((b) => b.style.display !== 'none');
    return { fill: s[0] && s[0].firstChild.style.width, recharging: !!(s[0] && s[0].classList.contains('recharging')) };
  });
  assert.equal(recharging.recharging, true, 'a broken shield carries the recharging (purple) class');
  // ~50%: the sim keeps banking recharge time between the write and the HUD frame, so allow the drift.
  const purpleFill = parseFloat(recharging.fill);
  assert.ok(purpleFill >= 50 && purpleFill < 60, `the purple fill is the recharge progress (5 s of 10 s), got ${recharging.fill}`);

  // --- 6. the ripple appears AND expires, with the player never having been hit ---
  const live = await page.evaluate(() => {
    const g = window.__game; const e = g.enemies[0];
    g.spawnEnemyShieldHit(e, e.pos, false);
    const slot = g.enemyShieldSlots.find((s) => s.enemy === e);
    return { scale: slot ? slot.mesh.scale.x : 0, expected: e.broadR * e.scale * 1.05 };
  });
  await page.waitForTimeout(100);
  await shot('shield-bubble');
  const lit = await page.evaluate(() => window.__game.enemyShieldSlots.filter((s) => s.mesh.visible).length);
  assert.ok(lit >= 1, 'an absorbed hit lights up a pooled enemy bubble');

  // 7. the bubble encloses the hull instead of hiding inside it — check on a SCALED archetype (boss2,
  // model scale 3) where the group-local broadR and the world radius differ by 3×, so dropping the scale
  // factor is actually detectable (≈ 6.6 world units, not ≈ 2.2).
  const boss = await page.evaluate(() => {
    const g = window.__game;
    const b = g.spawnEnemy('boss2');
    b.pos.set(24, 0.6, 6);
    b.scale = b.fullScale; // skip the warp-in grow so the bubble is sized at full scale
    b.spawnAge = b.spawnDur; b.warping = false;
    g.spawnEnemyShieldHit(b, b.pos, false);
    const slot = g.enemyShieldSlots.find((s) => s.enemy === b);
    return { scale: slot ? slot.mesh.scale.x : 0, expected: b.broadR * b.scale * 1.05 };
  });
  assert.ok(boss.expected > 6, `the second boss bubble is boss-sized (expected ≈ ${boss.expected.toFixed(2)} world units)`);
  assert.ok(
    Math.abs(boss.scale - boss.expected) <= boss.expected * 0.15,
    `the boss bubble radius (${boss.scale.toFixed(2)}) folds in the model scale (expected ≈ ${boss.expected.toFixed(2)})`
  );
  assert.ok(
    Math.abs(live.scale - live.expected) <= live.expected * 0.15,
    `the small-pirate bubble radius (${live.scale.toFixed(2)}) hugs its hull (expected ≈ ${live.expected.toFixed(2)})`
  );

  // 8. a RECYCLED slot must not replay the previous enemy's ripples. Force the pool down to one slot, fire
  // an impact on the fighter, then immediately steal that slot for the boss: the ring must carry exactly the
  // boss's one fresh impact, not the fighter's still-live one.
  const rebind = await page.evaluate(() => {
    const g = window.__game;
    // Overfill the pool: more distinct enemies taking an absorbed hit than the tier allows bubbles, all
    // within one FX-clock instant, so the last few registrations MUST recycle an oldest, still-live slot.
    for (let i = 0; i < 10; i++) {
      const e = g.spawnEnemy('fighter');
      e.pos.set(-40 + i * 8, 0.6, 20);
      e.scale = e.fullScale; e.spawnAge = e.spawnDur; e.warping = false;
      g.spawnEnemyShieldHit(e, e.pos, false);
    }
    const slots = g.enemyShieldSlots;
    return {
      slotCount: slots.length,
      liveImpacts: slots.map((s) => s.start.filter((t) => t > -900).length),
    };
  });
  assert.ok(rebind.slotCount > 0 && rebind.slotCount <= 6, `the pool respects the tier cap (${rebind.slotCount} slots)`);
  assert.ok(rebind.slotCount < 10, 'the pool recycled slots rather than allocating one per enemy');
  assert.deepEqual(
    rebind.liveImpacts.filter((n) => n !== 1), [],
    'a recycled slot carries ONLY its new enemy\'s impact — the previous ship\'s still-live ripples are retired on rebind'
  );

  // 6c. and it goes away 1 s of FX-clock time after the impact — on a frozen clock it would stay lit forever.
  // We WAIT for the condition instead of sleeping a fixed 1.4 s: the FX clock is driven by the per-frame
  // delta clamped to 0.05 s, and headless software WebGL renders at ~6 fps, so 1 s of clock takes ~4 s of
  // wall time here (at 60 fps in a real browser it is 1 s). A frozen clock never satisfies this and the
  // wait times out — which is exactly the regression this step guards.
  let expired = true;
  try {
    await page.waitForFunction(
      () => window.__game.enemyShieldSlots.every((s) => !s.mesh.visible && !s.enemy),
      null, { timeout: 20000, polling: 200 }
    );
  } catch { expired = false; }
  assert.ok(expired, 'the enemy shield ripple expires ~1s (FX clock) after the impact and releases its slot — the clock advances even when the player has never been hit');
}
