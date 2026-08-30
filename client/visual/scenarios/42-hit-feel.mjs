// Hit feel: the TARGET reacts (docs/plans/2026-08-30-1505-combat-hit-feel.md).
//
// A visual feature can pass every logic test and still ship invisible, so the load-bearing assertion here
// is a PIXEL one: two identical fighters are parked side by side at the same camera distance, ONE of them
// is shot, and the framebuffer is read once — A minus B *is* the flash. That single measurement also proves
// the per-instance material clone: with a shared material B would brighten too.
//
// The crop is derived from the ship's own PROJECTED radius rather than being a magic pixel count, so it
// self-adapts to whatever camera zoom the tab restored from localStorage. Everything is stepped with
// __game.stepSim — the harness runs on software WebGL, where a wall-clock wait tests the CPU, not the game.
export const name = '42-hit-feel';

export default async function ({ page, assert, shot }) {
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);

  // --- 1. park two identical fighters, side by side, at EQUAL camera distance -------------------------
  const placed = await page.evaluate(() => {
    const g = window.__game;
    const clear = () => { g.enemies.slice().forEach((e) => g.scene.remove(e.mesh)); g.enemies.length = 0; };
    clear();
    const parsedBefore = g.shipModelsParsed;
    // Fly out to EMPTY SPACE first. The run starts at the home station, a big bright set-piece: parked over
    // it, one of the two control ships sits on white hull plating and the other on black sky, and the crops
    // differ by ~25 levels before anything has been shot. The arena is 360 u, so (200, 200) is inside it,
    // ~280 u from the station at the origin and far from the ghost battle at (-100, -450) — plain starfield.
    g.player.pos.set(200, g.player.pos.y, 200);
    g.player.vel.set(0, 0, 0);
    g.stepSim(1);                  // let the camera settle onto the new spot before anything is measured
    const base = g.player.pos.clone();
    const spec = g.catalog.enemyShips.find((s) => s.stats.role === 'fighter');
    // FREEZE the pair. Left to their own AI they turn to face the player from opposite sides, which under a
    // DIRECTIONAL sun lights the two hulls differently — a 25-level baseline gap that has nothing to do with
    // any flash. Zeroing the turn rate + acceleration and emptying the mounts makes A and B genuinely
    // identical: same pose, same lighting, no muzzle flash of their own inside a crop.
    const put = (e, dx) => {
      // Same z for both: their camera distance is then equal BY CONSTRUCTION, which is what the "they look
      // identical before the hit" baseline rests on. dx = 14 u apart >> one crop (~7 u), so the flash on A
      // cannot bleed into the control crop on B.
      e.pos.set(base.x + dx, 0.6, base.z - 14);
      e.heading = 0;
      e.scale = e.fullScale; e.spawnAge = e.spawnDur; e.warping = false;
      e._shieldValue = 0;            // shields down: a hit reaches the HULL, which is what flashes
      e.hp = e.maxHp = 99999;        // survive every shot in this scenario
      e.turnRate = 0; e.acceleration = 0; e.vel.set(0, 0, 0); // hold the pose
      e.groups = {};                 // …and hold fire
      return e;
    };
    const A = put(g.spawnEnemyShip(spec), -14);
    const B = put(g.spawnEnemyShip(spec), +14);
    g.hitFx.HIT_FX.flash.dur = 5;    // hold the flash still for the pixel read (0.12 s would age out)
    return { parsedBefore, parsedAfter: g.shipModelsParsed, sameSpec: A.name === B.name };
  });
  assert.ok(placed.sameSpec, 'both control ships are the same enemy type');
  assert.ok(placed.parsedAfter <= placed.parsedBefore + 1,
    `spawning two ships did not re-parse a glb per spawn (${placed.parsedBefore} → ${placed.parsedAfter})`);

  // both must have swapped the placeholder primitive for the real model before anything is measured
  await page.waitForFunction(() => {
    const g = window.__game;
    if (!g || g.enemies.length < 2) return false;
    return g.enemies.slice(0, 2).every((e) => (e.mesh.userData.flashMats || []).length > 0);
  }, null, { timeout: 30000 });

  // --- D11: per-instance materials (the uuid half of the proof) --------------------------------------
  const mats = await page.evaluate(() => {
    const g = window.__game;
    const [A, B] = g.enemies;
    const uuids = (e) => (e.mesh.userData.flashMats || []).map((f) => f.mat.uuid);
    const ua = uuids(A), ub = uuids(B);
    return { na: ua.length, nb: ub.length, shared: ua.filter((u) => ub.includes(u)).length };
  });
  assert.ok(mats.na > 0 && mats.nb > 0, 'both hulls registered flashable materials');
  assert.equal(mats.shared, 0, 'two ships of the same type share NO material instance (per-instance clone)');

  // --- the measurement seams (crop derived from the projected hull radius) ---------------------------
  await page.evaluate(() => {
    const g = window.__game;
    // World broad-phase radius — the same rule as sim-core/collision.js broadRadius: `broadR` is GROUP-LOCAL,
    // so the WORLD radius folds in ship.scale. Projecting the raw broadR would undersize the crop ~1.7x.
    const broadRadius = (s) => ((s.hitBoxes && s.broadR) ? s.broadR * (s.scale || 1) : 2.6 * (s.sizeScale || 1));
    const gl = g.renderer.getContext();
    window.__hf = {
      W: gl.drawingBufferWidth, H: gl.drawingBufferHeight,
      grab() { const b = new Uint8Array(this.W * this.H * 4); gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; },
      // pixel centre + half-size of a ship's square crop, in DEVICE pixels
      box(ship) {
        const cam = g.camera;
        const v = g.player.mesh.position.clone();      // a real THREE.Vector3 to project with
        v.set(ship.pos.x, ship.pos.y, ship.pos.z).project(cam);
        const cx = (v.x * 0.5 + 0.5) * this.W, cy = (v.y * 0.5 + 0.5) * this.H; // readPixels is BOTTOM-UP in y
        const m = cam.matrixWorld.elements;            // column 0 = the camera's world RIGHT axis
        const r = broadRadius(ship);
        v.set(ship.pos.x + m[0] * r, ship.pos.y + m[1] * r, ship.pos.z + m[2] * r).project(cam);
        const ex = (v.x * 0.5 + 0.5) * this.W, ey = (v.y * 0.5 + 0.5) * this.H;
        const rad = Math.hypot(ex - cx, ey - cy);
        return { cx, cy, half: Math.max(12, Math.min(60, rad)) };
      },
      // Mean luminance (0..255) and the count of genuinely bright pixels in a ship's crop, from ONE buffer.
      stats(buf, ship, thr = 160) {
        const { cx, cy, half } = this.box(ship);
        const x0 = Math.max(0, Math.round(cx - half)), x1 = Math.min(this.W - 1, Math.round(cx + half));
        const y0 = Math.max(0, Math.round(cy - half)), y1 = Math.min(this.H - 1, Math.round(cy + half));
        let sum = 0, n = 0, bright = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = (y * this.W + x) * 4;
          const l = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
          sum += l; n++; if (l >= thr) bright++;
        }
        return { mean: n ? sum / n : 0, bright, n, half };
      },
    };
  });

  // --- 3. baseline: on ONE frame, the two ships are indistinguishable --------------------------------
  const base = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    const g = window.__game, hf = window.__hf, buf = hf.grab();
    const [A, B] = g.enemies;
    resolve({ a: hf.stats(buf, A), b: hf.stats(buf, B) });
  })));
  await shot('before');
  assert.ok(base.a.n > 400 && base.b.n > 400, `both crops are real crops (${base.a.n} / ${base.b.n} px)`);
  assert.ok(Math.abs(base.a.mean - base.b.mean) < 3,
    `before any hit the two hulls are indistinguishable (${base.a.mean.toFixed(1)} vs ${base.b.mean.toFixed(1)})`);

  // --- 4. a REAL kinetic bullet reaches A's hull -----------------------------------------------------
  const kinetic = await page.evaluate(() => {
    const g = window.__game;
    const V = g.player.pos.constructor;
    const A = g.enemies[0];
    const w = g.catalog.weapons.get(1);            // Basic kinetic (class 'kinetic', power 10)
    const from = new V(A.pos.x, A.pos.y, A.pos.z - 10);
    const hp0 = A.hp;
    g.spawnBullet(from, new V(0, 0, 1), w, true);
    for (let i = 0; i < 120 && A.hp === hp0; i++) g.stepSim(1);
    const fl = g.hitFx.flashOf(A);
    const bank = A.mesh.userData.bankGroup;
    return {
      damaged: A.hp < hp0,
      flashActive: !!(fl && fl.active),
      emissive: A.mesh.userData.flashMats[0].mat.emissiveIntensity,
      bankMoved: bank.position.lengthSq(),
      bMoved: g.enemies[1].mesh.userData.bankGroup.position.lengthSq(),
      bFlash: !!g.hitFx.flashOf(g.enemies[1]),
    };
  });
  assert.ok(kinetic.damaged, 'the kinetic bullet reached A\'s hull');
  assert.equal(kinetic.flashActive, true, 'a hull hit starts the flash on the ship that was hit');
  assert.ok(kinetic.emissive > 0, `A's own material is lit (emissiveIntensity ${kinetic.emissive})`);
  assert.equal(kinetic.bFlash, false, 'the untouched control ship has no flash state at all');
  // --- 6. scope item 2: a PLAIN BULLET never moves the model ----------------------------------------
  assert.equal(kinetic.bankMoved, 0, 'a plain bullet flashes but does NOT punch the model');
  assert.equal(kinetic.bMoved, 0, 'and it certainly does not move the other ship');

  // --- 5. THE PERCEPTION ASSERTION: the flash reaches the SCREEN ------------------------------------
  const lit = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    const g = window.__game, hf = window.__hf, buf = hf.grab();
    const [A, B] = g.enemies;
    resolve({ a: hf.stats(buf, A), b: hf.stats(buf, B), emissive: A.mesh.userData.flashMats[0].mat.emissiveIntensity });
  })));
  await shot('flash');
  const dMean = lit.a.mean - lit.b.mean;
  const dBright = lit.a.bright - lit.b.bright;
  const dBrightFrac = dBright / lit.a.n;   // as a FRACTION of the crop — see the note on the assertion below
  console.log(`      flash: crop ${Math.round(lit.a.half * 2)}px · mean A ${lit.a.mean.toFixed(1)} vs B ${lit.b.mean.toFixed(1)}`
    + ` (Δ ${dMean.toFixed(1)}) · bright A ${lit.a.bright} vs B ${lit.b.bright}`
    + ` (Δ ${dBright} = ${(dBrightFrac * 100).toFixed(1)}% of the crop)`);
  // Of 255. The hull covers ~35-45 % of a radius-derived crop, so +8 on the crop mean is ~20 levels on the
  // hull itself — visible. If the maintainer ever tunes `flash.intensity` down past this, retune the number
  // WITH it, deliberately: this assertion is the record of "the flash must stay visible".
  assert.ok(dMean >= 8, `the flashed hull is measurably brighter on screen (Δmean ${dMean.toFixed(1)}, need >= 8)`);
  // Second measure, as a FRACTION of the crop rather than a raw pixel count — that is what makes it
  // genuinely area-independent. It has to be: the crop is derived from the ship's projected radius and
  // `camZoom` is restored from localStorage, so a scenario that ran earlier in the same browser can halve
  // it (observed: a 55 px crop in isolation, 27 px inside the full suite). The FRACTION held steady at
  // ~12 % across both, while a raw ">= 100 px" gate passed at 55 px and failed at 27 px for no reason that
  // has anything to do with the flash. The hull fills ~35-45 % of the crop, so 6 % of the crop is ~15 % of
  // the silhouette — far above the control's 1-1.5 % readPixels floor, and half of what a working flash
  // actually produces.
  assert.ok(dBrightFrac >= 0.06,
    `genuinely bright pixels appeared on A and not on B (Δ ${dBright} = ${(dBrightFrac * 100).toFixed(1)}% of the crop, need >= 6%)`);
  // Both together also prove B did NOT brighten — the shared-material bug caught ON SCREEN, not just by uuid.
  assert.ok(Math.abs(lit.b.mean - base.b.mean) < 3,
    `the control ship did not brighten with it (${base.b.mean.toFixed(1)} → ${lit.b.mean.toFixed(1)})`);

  // --- 7. a ROCKET punches the model — and a salvo REFRESHES instead of accumulating -----------------
  const punch = await page.evaluate(() => {
    const g = window.__game;
    const V = g.player.pos.constructor;
    const A = g.enemies[0];
    const HIT = g.hitFx.HIT_FX;
    HIT.punch.shove = 0.5; HIT.punch.dur = 5; HIT.punch.cooldown = 0.15;
    const bank = A.mesh.userData.bankGroup;
    const fire = (weaponId) => {
      const w = g.catalog.weapons.get(weaponId);
      const from = new V(A.pos.x, A.pos.y, A.pos.z - 12);
      g.spawnRocket(from, new V(0, 0, 1), w, w.accel, true, A);
    };
    // one plain homing rocket
    fire(3);
    let single = 0;
    for (let i = 0; i < 240 && g.rockets.length; i++) { g.stepSim(1); single = Math.max(single, bank.position.length()); }
    // …then the three-warhead spiral volley, whose whole point is that it must NOT stack.
    const salvo = { max: 0, accepted: 0 };
    let prevAge = g.hitFx.punchOf(A).age;
    fire(11);
    for (let i = 0; i < 400 && g.rockets.length; i++) {
      g.stepSim(1);
      salvo.max = Math.max(salvo.max, bank.position.length());
      const age = g.hitFx.punchOf(A).age;
      if (age < prevAge) salvo.accepted++;   // the impulse was RESET → a hit was taken
      prevAge = age;
    }
    return { single, salvo, shove: HIT.punch.shove, cooldown: HIT.punch.cooldown };
  });
  assert.ok(punch.single > 0, 'a rocket hit displaces the model on the cosmetic child group');
  assert.ok(punch.single <= punch.shove * 1.0001,
    `one hit never exceeds the configured shove (${punch.single.toFixed(4)} of ${punch.shove})`);
  assert.ok(punch.salvo.max <= punch.shove * 1.0001,
    `a THREE-warhead salvo still never exceeds one shove — it refreshes, it does not accumulate `
    + `(peak ${punch.salvo.max.toFixed(4)} of ${punch.shove})`);
  assert.ok(punch.salvo.accepted <= 2,
    `the cooldown collapses the salvo into ~one punch instead of a vibration (${punch.salvo.accepted} accepted)`);

  // --- 8. the camera shudder: a ROCKET into the PLAYER's HULL ---------------------------------------
  const shake = await page.evaluate(() => {
    const g = window.__game;
    const V = g.player.pos.constructor;
    const HIT = g.hitFx.HIT_FX;
    const clear = () => { g.enemies.slice().forEach((e) => g.scene.remove(e.mesh)); g.enemies.length = 0; };
    // The camera is rigidly player.pos + camOffset, so the OFFSET VECTOR is constant at rest whatever the
    // player is doing — which is why this needs no access to camOffset itself.
    const offset = () => g.camera.position.clone().sub(g.player.pos);
    g.player.hp = 99999;
    const bombard = () => {
      const w = g.catalog.weapons.get(4);          // Rocket pirate (class 'rocket')
      // Launch it ON the player so the very next step detonates it against his hull. Homing it in from a
      // distance is not the thing under test and a pirate rocket's turn rate makes it circle for seconds;
      // everything downstream (detonateRocket → applyShieldedDamage → hullHit) is the real code path.
      const from = new V(g.player.pos.x, g.player.pos.y, g.player.pos.z);
      g.spawnRocket(from, new V(0, 0, 1), w, w.accel, false, g.player);
      let moved = 0;
      const rest = window.__hfRest;
      for (let i = 0; i < 240 && g.rockets.length; i++) { clear(); g.stepSim(1); moved = Math.max(moved, offset().distanceTo(rest)); }
      for (let i = 0; i < 30; i++) { clear(); g.stepSim(1); moved = Math.max(moved, offset().distanceTo(rest)); }
      return moved;
    };
    clear();
    g.stepSim(2);
    window.__hfRest = offset();                    // a quiet frame: no shudder in flight
    HIT.shake.amp = 4; HIT.shake.dur = 0.5; HIT.shake.cooldown = 0.25;

    // (a) shield DOWN → the rocket reaches the hull → the camera moves
    g.player.shield = { capacity: 20, rechargeSec: 10 };
    g.player._shieldValue = 0;
    const hullBefore = g.player.hp;
    const hit = bombard();
    const hullTaken = hullBefore - g.player.hp;
    // let it settle: 0.5 s of impulse + the 0.25 s cooldown, at 1/60 per step
    for (let i = 0; i < 60; i++) { clear(); g.stepSim(1); }
    const settled = offset().distanceTo(window.__hfRest);

    // (b) the NEGATIVE: a shield that absorbs everything (toHull === 0) must NOT shudder. Recorded with the
    // hull + shield deltas so this can never pass VACUOUSLY on a rocket that simply failed to go off.
    g.player._shieldValue = 1e6;
    const hpBefore = g.player.hp, shieldBefore = g.player._shieldValue;
    const absorbed = bombard();
    const shieldTaken = shieldBefore - g.player._shieldValue;
    const hullTakenWhileShielded = hpBefore - g.player.hp;
    // let the shudder + its cooldown expire again before the case that matters most
    for (let i = 0; i < 60; i++) { clear(); g.stepSim(1); }

    // (c) THE CASE THIS FEATURE EXISTS FOR (D2 / DECISIONS §137): a shield that BREAKS and spills. A pirate
    // rocket is power 20 into a PARTIAL 10-point shield, so `applyShieldedDamage` returns
    // `{ absorbed: TRUE, broke: true, toHull: 10 }` — the shield reports it took the hit, and 10 points
    // reach the hull in the same tick. Rewriting the emit sites to the naive `if (!dr.absorbed)` — the exact
    // regression §137 warns about — leaves every other test in this repo green and is caught only here.
    g.player._shieldValue = 10;
    const spillHpBefore = g.player.hp;
    const spill = bombard();
    const spillHullTaken = spillHpBefore - g.player.hp;
    const spillShieldAfter = g.player._shieldValue;

    g.player.shield = null; g.player._shieldValue = 0;
    return { hit, settled, absorbed, hullTaken, shieldTaken, hullTakenWhileShielded,
             spill, spillHullTaken, spillShieldAfter };
  });
  console.log(`      shudder: peak ${shake.hit.toFixed(2)} u on a hull hit (${shake.hullTaken} dmg),`
    + ` ${shake.absorbed.toFixed(4)} u when the shield ate it (${shake.shieldTaken} absorbed)`);
  assert.ok(shake.hullTaken > 0, 'the first rocket really reached the hull (the shudder has something to fire on)');
  assert.ok(shake.hit > 1, `a rocket through a DOWN shield shudders the camera (peak offset ${shake.hit.toFixed(2)} u)`);
  assert.ok(shake.settled < 0.05, `and the camera returns to rest afterwards (residual ${shake.settled.toFixed(4)} u)`);
  // Non-vacuous: the second rocket DID go off on the player — the shield simply ate all of it.
  assert.ok(shake.shieldTaken > 0, 'the second rocket really detonated on the player too (the shield took it)');
  assert.equal(shake.hullTakenWhileShielded, 0, 'and nothing reached the hull that time (toHull === 0)');
  assert.ok(shake.absorbed < 0.05,
    `a rocket FULLY ABSORBED by the shield (toHull 0) does not shudder the camera (got ${shake.absorbed.toFixed(4)} u)`);
  // The break-with-spill case — `absorbed: true` AND `toHull > 0` at the same time.
  console.log(`      break-with-spill: shield 10 vs a 20-power rocket → shield ${shake.spillShieldAfter},`
    + ` hull took ${shake.spillHullTaken}, camera peak ${shake.spill.toFixed(2)} u`);
  assert.equal(shake.spillShieldAfter, 0, 'the 10-point shield BROKE under the 20-power rocket');
  assert.equal(shake.spillHullTaken, 10, 'and spilled its excess to the hull in the same tick (toHull 10)');
  assert.ok(shake.spill > 1,
    'a rocket that BREAKS the shield and spills to the hull still shudders the camera — `absorbed` is true '
    + `here, so a naive \`if (!absorbed)\` would silently skip the biggest hit in the game (got ${shake.spill.toFixed(2)} u)`);

  // --- 9. restore the module-level tunables this scenario changed ------------------------------------
  await page.evaluate(() => {
    const HIT = window.__game.hitFx.HIT_FX;
    HIT.flash.dur = 0.12;
    HIT.punch.shove = 0; HIT.punch.dur = 0.12; HIT.punch.cooldown = 0.15;
    HIT.shake.amp = 1.2; HIT.shake.dur = 0.18; HIT.shake.cooldown = 0.25;
    delete window.__hf; delete window.__hfRest;
  });
}
