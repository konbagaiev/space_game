// The level-start warm must be COMPLETE: after the veil drops, nothing may compile a shader program.
//
// THREE compiles a material's program on its first DRAW, and `renderer.compile()` only reaches what is in
// the scene at that moment — so every surface that enters the scene later (the first loot crate, its halo,
// the grab pull line, the shield bubbles) used to compile in front of the player. A real phone measured
// that as 204 ms and 66 ms main-thread blocks with the veil already down, live programs climbing 32 -> 42;
// the headless probe that named the culprits measured 33 -> 37 programs, 35 -> 41 geometries, 30 -> 33
// textures on level-0. This scenario is that probe turned into an assertion.
//
// HOW it asserts, and why it is shaped this way:
//   * a program's cache key depends on the render state at COMPILE time (lights, fog, object type), so a
//     warm that ran against a stand-in or before the level's lights existed compiles a DIFFERENT program
//     and the count grows anyway. Counting `compile()` calls would pass while that bug is live. So every
//     live surface is attributed — `renderer.properties.get(mat).currentProgram.cacheKey` must be a member
//     of the baseline key set captured when the veil dropped.
//   * it fails CLOSED: each named surface must be FOUND (>= 1) before any key is inspected. A crate the
//     Grab already collected would otherwise make "for every crate material..." assert over nothing.
//   * the BUFFER half is asserted PER SURFACE, not as a whole-fight total. `compile()` builds programs
//     only; a geometry's buffers upload on the first real draw, so the warm forces one throwaway pass. What
//     that fix owns is "spawning a drop / taking a shield hit uploads nothing", and that is what is asserted
//     — deterministically. A whole-fight total would measure surfaces this change does not own (see the
//     residuals below) AND be run-to-run fragile, because the fight is emergent: whether a kill happens
//     changes the totals. The totals are still PRINTED, as a measurement, never asserted.
//
//   * it also pins that warming a surface does not SHOW it. The player's shield bubble used to be built by
//     the first absorbed hit, so "not built yet" implicitly meant "no idle rim yet"; building it at warm
//     time put a permanent rim on the ship (and, via the bootstrap prewarm, on the menu's idle ship). The
//     invisible-before / visible-after-a-hit pair below is the assertion that catches that class of bug.
//
// COVERAGE LIMITS — a green run here is NOT "nothing compiles late anywhere":
//   * Covered: the level-0 surfaces — loot crate, halo sprite, pull line, player + enemy shield bubbles,
//     and the DECISIONS §83 ship-death FX path (which must stay at +0 PROGRAMS).
//   * NOT covered — the reward drop model. Level-0 carries no `lastKillDrop`, and a committed test must
//     not depend on a live CloudFront fetch. Verified by hand instead (see the plan, Step 7c).
//   * NOT covered — three PRE-EXISTING geometry/texture uploads that still happen during play and are not
//     this change's debt (measured 2026-09-01, before AND after: ship hull buffers, whose template
//     `warmModel` compiles but never DRAWS; `rocketGeo`, projectiles.js; and the explosion FX quads,
//     flipbook-fx.js + projectiles.js). Follow-up brief: docs/plans/warm-geometry-buffer-uploads.md.
//   * NOT covered, and structurally impossible to cover — the ghost battle. `ghostBattlePlan` returns
//     `enabled: false` whenever the URL contains `debug` (ghost-battle-track.js), and this harness always
//     opens the game with `?debug`, so no headless frame can ever contain a ghost. The check for that half
//     is the PHONE: open with `?dev&debug`, snapshot `__game.programKeys()` when the veil drops and again
//     ~10 s into the fight, and diff. It must be the FIRST fight of a fresh page load — ghost programs
//     compile once per session and are never released, so a flat diff on a second level is the fix working,
//     not a broken probe.
export const name = '50-warm-completeness';

export default async function ({ page, assert, shot }) {
  // launch from whichever menu is up (welcome or main window)
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.evaluate(() => window.__game.silenceIntro && window.__game.silenceIntro());

  // Settle to the exact moment the player gets control: the warm request consumed, every essential .glb in,
  // the veil down. Everything after this line is "during play".
  await page.waitForFunction(() => {
    const g = window.__game;
    return !!g && g.needsSceneWarm === false && g.pendingAssets === 0
      && !document.getElementById('levelwarm').classList.contains('on');
  }, null, { timeout: 20000 });

  // --- the warm must not CHANGE anything, only pre-pay for it. The player's shield bubble is the trap:
  // before this warm existed the mesh was built by the first absorbed hit, so "no bubble yet" implicitly
  // meant "no idle rim yet". Creating it at warm time put a permanent faint rim on the ship from level
  // start — and, since the bootstrap prewarm runs while the MENU is up, around the idle ship on the welcome
  // screen too. `armed` (shield-fx.js) restores the old behaviour; this pair of assertions is what would
  // have caught the regression, which 716 unit tests and seven visual scenarios did not.
  //
  // Read FIRST, before any other wait: the rule is about state that live play can legitimately change (a
  // pirate landing a shot arms the bubble for real), so the check is phrased as the invariant rather than as
  // a snapshot — `visible` if and only if an impact has already been registered. `uImpactStart` is the ring
  // buffer registerShieldImpact writes into; every slot is -999 until the shield has absorbed something.
  const bubbleBefore = await page.evaluate(() => {
    const g = window.__game;
    const enemyMeshes = new Set(g.enemyShieldSlots.map((s) => s.mesh));
    let found = null;
    g.scene.traverse((o) => {
      if (!o.isMesh || enemyMeshes.has(o)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.uniforms && m.uniforms.uImpactDir) found = o;
    });
    if (!found) return { exists: false };
    const starts = found.material.uniforms.uImpactStart.value;
    return { exists: true, visible: found.visible, hitYet: starts.some((t) => t > -900) };
  });
  assert.equal(bubbleBefore.exists, true, 'the player shield bubble was built by the warm (that is the fix)');
  assert.equal(bubbleBefore.visible, bubbleBefore.hitYet,
    `the player shield bubble must be visible IF AND ONLY IF the shield has already absorbed something `
    + `(visible=${bubbleBefore.visible}, any impact registered=${bubbleBefore.hitYet}). Warming a surface `
    + `must not make it appear — see \`armed\` in shield-fx.js.`);
  console.log(`      shield bubble at veil-down: exists=true visible=${bubbleBefore.visible} (impacts so far: ${bubbleBefore.hitYet ? 'yes' : 'none'})`);

  // The crate .glb is loaded at module import and is NOT counted in pendingAssets, so give the warm a
  // bounded moment to have parked it (halo + crate template => >= 2 children). Deliberately swallowed: a
  // build where the loot warm is missing must still reach the assertions below and fail THERE, naming the
  // keys, rather than time out here.
  await page.waitForFunction(() => {
    let n = 0;
    window.__game.scene.traverse((o) => { if (o.name === 'dropWarmRig') n = o.children.length; });
    return n >= 2;
  }, null, { timeout: 8000 }).catch(() => {});

  // --- baseline: the program/geometry/texture state at veil-down ---
  const base = await page.evaluate(() => {
    const g = window.__game;
    const draw = () => { g.renderer.clear(); g.renderer.render(g.skyScene, g.camera); g.renderer.clearDepth(); g.renderer.render(g.scene, g.camera); };
    draw();
    return {
      keys: g.renderer.info.programs.map((p) => p.cacheKey),
      geo: g.renderer.info.memory.geometries,
      tex: g.renderer.info.memory.textures,
    };
  });

  // --- drive the fight DETERMINISTICALLY. Waiting on wall-clock combat is not a driver here: the probe ran
  // 53 s of emergent play and produced ZERO kills. Hold thrust + both triggers and step the sim, DRAWING
  // after each chunk — compiles happen on draw, so stepping alone would find nothing. The player's hull is
  // topped up each chunk so a death overlay can't end the run mid-probe; it changes nothing being measured.
  await page.evaluate(async () => {
    const g = window.__game;
    const draw = () => { g.renderer.clear(); g.renderer.render(g.skyScene, g.camera); g.renderer.clearDepth(); g.renderer.render(g.scene, g.camera); };
    for (const code of ['KeyW', 'Space', 'KeyF']) window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    for (let i = 0; i < 120; i++) {
      g.stepSim(10);
      const p = g.player;
      if (p) { p.hp = p.maxHp; if (p.shield) p._shieldValue = p.shield.capacity; }
      draw();
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 25)); // let async .glb loads land
    }
    for (const code of ['KeyW', 'Space', 'KeyF']) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  });

  // --- the one-shots ordinary play produces, each measured on its OWN geometry/texture delta (that is
  // assertion 4 — see below), then settled so the next step and the attribution scan see a live scene.
  //
  // The MEASURED window is deliberately as tight as it can be while still containing a draw — ONE sim tick
  // and one render, because an upload happens on the draw, not on the spawn. That tightness is the point:
  // a wide window would also catch whatever else the emergent fight did in it, and the explosion FX quads
  // (+2g/+2t, the known pre-existing residual) are exactly what an unlucky kill would attribute to the
  // wrong surface. With one tick that cannot happen; if a future pacing change ever puts a kill inside it,
  // this fails loudly with a named surface rather than flaking.
  const marks = await page.evaluate(async () => {
    const g = window.__game;
    const draw = () => { g.renderer.clear(); g.renderer.render(g.skyScene, g.camera); g.renderer.clearDepth(); g.renderer.render(g.scene, g.camera); };
    const out = [];
    const step = (label, fn) => {
      const geo0 = g.renderer.info.memory.geometries, tex0 = g.renderer.info.memory.textures;
      fn();
      g.stepSim(1); draw();                                  // <- the measured window: one tick, one draw
      const geo = g.renderer.info.memory.geometries - geo0, tex = g.renderer.info.memory.textures - tex0;
      for (let i = 0; i < 3; i++) { g.stepSim(6); draw(); }   // settle, OUTSIDE the measurement
      out.push({ label, geo, tex });
    };
    step('drop1', () => g.spawnTestDrop({ kind: 'component', refId: 6 }));  // a crate + its halo, on screen
    step('drop2', () => g.spawnTestDrop({ kind: 'weapon', refId: 9 }));     // a 2nd crate (shared materials)
    step('explosion', () => g.spawnShipExplosion(g.player.pos.clone(), 0xff8030, 1)); // §83 keep-alive path
    step('enemyBubble', () => {
      if (!g.enemies.length) { const e = g.spawnEnemy('fighter'); e.pos.set(0, 0.6, 8); }
      const en = g.enemies[0];
      g.spawnEnemyShieldHit(en, en.pos);
    });
    step('playerBubble', () => g.spawnShieldHit(g.player.pos.clone()));     // (pos, broke = false)
    return out;
  });

  // …and the other half of the "warming must not change what is SHOWN" guard: an absorbed hit ARMS the
  // bubble, so it appears exactly as it did before the warm existed. `visible` is written by
  // updateShieldBubble in the render loop, so this waits for real frames rather than stepping the sim.
  let rimShows = true;
  try {
    await page.waitForFunction(() => {
      const g = window.__game;
      const enemyMeshes = new Set(g.enemyShieldSlots.map((s) => s.mesh));
      let vis = false;
      g.scene.traverse((o) => {
        if (!o.isMesh || enemyMeshes.has(o)) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.uniforms && m.uniforms.uImpactDir && o.visible) vis = true;
      });
      return vis;
    }, null, { timeout: 8000, polling: 200 });
  } catch { rimShows = false; }
  assert.ok(rimShows, 'after an absorbed hit the player bubble DOES show — the armed gate must not suppress the real effect');

  await shot('warm-completeness');

  // --- the attribution snapshot. The starting ship carries the Grab, so a crate spawned next to the player
  // is armed, pulled and COLLECTED within a second of sim — and a scan that then finds no crate would assert
  // over an empty list and pass vacuously. Spawn the attribution crate ~200 u out (far outside the pull
  // reach), step exactly ONE tick, and snapshot immediately.
  const snap = await page.evaluate(() => {
    const g = window.__game;
    const draw = () => { g.renderer.clear(); g.renderer.render(g.skyScene, g.camera); g.renderer.clearDepth(); g.renderer.render(g.scene, g.camera); };
    const far = g.player.pos.clone(); far.x += 200;
    g.spawnDrop(far, { kind: 'component', refId: 6 });
    g.stepSim(1);
    // DO NOT DELETE THIS AS A HACK — it is what makes assertion 3 evaluable for the per-drop halo. The
    // crate has to be spawned out of Grab reach (see above), which also puts it off-camera, so an ordinary
    // draw CULLS it; and `addHalo` builds a FRESH SpriteMaterial per drop, so that material would carry no
    // `currentProgram` at all and the "non-null" half of assertion 3 would fail on a perfectly warm build.
    // Forcing it through the pipeline for this one pass is exactly what happens anyway the moment a real
    // drop is on screen — and if its program were the WRONG one, this draw is what exposes it (assertion 2
    // sees a new key). Restored immediately after.
    const body = g.drops.length ? g.drops[g.drops.length - 1].obj : null;
    const restore = [];
    if (body) body.traverse((o) => { restore.push([o, o.frustumCulled]); o.frustumCulled = false; });
    draw();
    for (const [o, fc] of restore) o.frustumCulled = fc;

    const keyOf = (m) => {
      const cp = g.renderer.properties.get(m).currentProgram;
      return cp ? cp.cacheKey : null;
    };
    const mats = (o) => (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean);
    const surfaces = { crate: [], halo: [], line: [], playerBubble: [], enemyBubble: [] };

    // crate + halo: only LIVE drop bodies (the parked template would satisfy the count without a real drop)
    for (const d of g.drops) {
      if (!d.obj) continue;
      d.obj.traverse((o) => {
        if (o.isMesh) for (const m of mats(o)) surfaces.crate.push(keyOf(m));
        else if (o.isSprite) for (const m of mats(o)) surfaces.halo.push(keyOf(m));
      });
    }
    // ...plus the permanently parked warm halo, whose material is the §83 keep-alive holder
    g.scene.traverse((o) => {
      if (o.name === 'dropWarmRig') o.traverse((c) => { if (c.isSprite) for (const m of mats(c)) surfaces.halo.push(keyOf(m)); });
      if (o.name === 'grabPullLine') for (const m of mats(o)) surfaces.line.push(keyOf(m));
    });
    // shield bubbles: the ShaderMaterial ones. The enemy meshes are the pooled slots; anything else with
    // that material is the player's single bubble.
    const enemyMeshes = new Set(g.enemyShieldSlots.map((s) => s.mesh));
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of mats(o)) {
        if (!m.uniforms || !m.uniforms.uImpactDir) continue;
        (enemyMeshes.has(o) ? surfaces.enemyBubble : surfaces.playerBubble).push(keyOf(m));
      }
    });

    return {
      surfaces,
      keys: g.renderer.info.programs.map((p) => p.cacheKey),
      geo: g.renderer.info.memory.geometries,
      tex: g.renderer.info.memory.textures,
    };
  });

  // 1. FAIL CLOSED: every named surface is actually in the scene before a single key is inspected.
  assert.ok(snap.surfaces.crate.length >= 1, 'a live loot crate is in the scene to attribute (it was collected or never spawned)');
  assert.ok(snap.surfaces.halo.length >= 1, 'a drop halo sprite is in the scene to attribute');
  assert.equal(snap.surfaces.line.length, 1, 'the pooled grab pull line exists exactly once (created by the warm)');
  assert.equal(snap.surfaces.playerBubble.length, 1, "the player's shield bubble exists (built by the warm, not by the first hit)");
  assert.ok(snap.surfaces.enemyBubble.length >= 1, 'at least one pooled enemy shield bubble exists');

  // 2. HARD ZERO: not one shader program compiled after the veil dropped.
  const baseSet = new Set(base.keys);
  const added = snap.keys.filter((k) => !baseSet.has(k));
  if (added.length) {
    const owners = await page.evaluate((wanted) => {
      const g = window.__game;
      const mats = (o) => (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean);
      const hits = [];
      for (const root of [g.scene, g.skyScene]) root.traverse((o) => {
        if (!o.material) return;
        for (const m of mats(o)) {
          const cp = g.renderer.properties.get(m).currentProgram;
          if (cp && wanted.includes(cp.cacheKey)) hits.push(`${o.type}/${m.type}${m.name ? `/${m.name}` : ''}`);
        }
      });
      return [...new Set(hits)];
    }, added);
    assert.fail(`${added.length} shader program(s) compiled DURING PLAY (the level-start warm missed them).\n`
      + `  keys: ${added.map((k) => String(k).slice(0, 200)).join('\n        ')}\n`
      + `  attributed to: ${owners.join(', ') || '(no live material owns them — a disposed/one-shot surface)'}`);
  }
  assert.equal(snap.keys.length, base.keys.length,
    `the live program count is unchanged across the fight (${base.keys.length} -> ${snap.keys.length})`);

  // 3. KEY EQUALITY: the warm compiled the SAME program the live draw asks for. A warm against a stand-in,
  // or one that ran before the level's lights existed, compiles a different key and fails here BY NAME.
  for (const [surface, keys] of Object.entries(snap.surfaces)) {
    keys.forEach((k, i) => {
      assert.ok(k, `${surface}[${i}] has no compiled program at all (it was never drawn)`);
      assert.ok(baseSet.has(k), `${surface}[${i}] draws with a program that did not exist at veil-down — the warm compiled a DIFFERENT key: ${String(k).slice(0, 200)}`);
    });
  }

  // 4. BUFFERS, PER SURFACE. `compile()` builds programs only — a geometry's buffers are uploaded in
  //    `projectObject`, behind the frustum test, and a hidden subtree returns early — so the warm ends with
  //    one throwaway forced draw, and `initTexture()`s the halo's CanvasTexture. What that owns is: the
  //    actions below upload NOTHING. Each is measured on its own delta, so this is deterministic and it
  //    fails if (and only if) this change regresses. `explosion` is deliberately NOT asserted here: its
  //    quads are a pre-existing residual (see the header + docs/plans/warm-geometry-buffer-uploads.md), and
  //    what this scenario does pin for the §83 FX path is its PROGRAM count, in assertion 2 above.
  const OWNED = ['drop1', 'drop2', 'enemyBubble', 'playerBubble'];
  for (const m of marks.filter((x) => OWNED.includes(x.label))) {
    assert.equal(m.geo, 0, `${m.label}: uploaded ${m.geo} geometry buffer(s) — the level-start warm no longer covers this surface`);
    assert.equal(m.tex, 0, `${m.label}: uploaded ${m.tex} texture(s) — the level-start warm no longer covers this surface`);
  }

  // …and the whole-fight totals as a MEASUREMENT, not an assertion: they include surfaces this change does
  // not own (ship hull buffers, rocketGeo, the explosion quads — all pre-existing, measured identically
  // before and after the fix), and the fight is emergent, so a kill happening or not moves them.
  console.log(`      programs ${base.keys.length} (unchanged); geometries ${base.geo} -> ${snap.geo}, textures ${base.tex} -> ${snap.tex}`
    + ` — residual is PRE-EXISTING and out of scope (docs/plans/warm-geometry-buffer-uploads.md)`);
  console.log('      per-surface uploads: ' + marks.map((m) => `${m.label} +${m.geo}g/+${m.tex}t`).join(', '));
}
