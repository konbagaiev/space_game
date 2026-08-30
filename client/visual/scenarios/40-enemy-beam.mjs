// THE HOSTILE TELEGRAPH, in a real browser — the local half of DECISIONS §135's gate.
//
// §135 records the rule this scenario exists to enforce: *an enemy beam is a 1.0 s unanswerable hit unless
// its telegraph is on screen.* A hitscan cannot be dodged after it fires and cannot be shot down in flight,
// so the ONLY counter-play is the second of warning in front of it. If these three lines are not drawn, the
// pirate lancer is an unfair attack and must not ship. That is why this is an assertion and not a screenshot.
//
// It asserts, in order:
//   1. a lancer is really in the fight, carrying weapon 13 — the WEAKENED row (67 u reach), in its own
//      single-mount `gun` group;
//   2. CHARGE-ONLY: with nothing charging, no hostile sight is on screen. Lines from a hostile hull must
//      always mean "a shot is coming right now";
//   3. the three lines appear when it charges, in the hostile hue and NOT the player's green;
//   4. THE LOOK IS THE PLAYER'S, REPRODUCED — one colour, one opacity, all three dashed, the centre
//      distinguished by dash RHYTHM rather than brightness (the maintainer's "change nothing", 2026-08-25);
//   5. THE GEOMETRY. Each line spans the weapon's FULL 67 u from the lancer's own muzzle. This is the
//      assertion that keeps the telegraph readable: from a lancer at its 14-22 u standoff, ~45 u of the
//      corridor runs PAST the player's own ship, and that far half is the part he actually reads. A sight
//      clipped to the shooter's vicinity fails here;
//   6. the sight brightens over the charge and is brightest LATE — the ramp rides the event's `dur`, and
//      the brightening IS the charge readout (there is no HUD bar);
//   7. the release CLEARS it, and the bolt is drawn whoever fired it;
//   8. the damage is the LANCER's 45, not the player weapon's 80.
//
// ASSERT ON GEOMETRY AND COLOUR, NEVER ON `visible === true`. A line drawn with an undefined width renders
// as absolutely nothing while `visible` stays true — that actually happened on this weapon's spike.
export const name = '40-enemy-beam';

const HOSTILE_ORANGE = 0xff6b4a;
const PLAYER_GREEN = 0x5ad17f;
const DISCHARGE_BLUE = 0x3d8bff;   // the shot's hue — the telegraph must NOT be this
const LANCER_RANGE = 67;

export default async function ({ page, assert, shot, baseURL }) {
  // `?lancer` swaps wave-1's spawn pool for 100% pirate lancers (and clamps concurrency to 2); `level=4`
  // pins the level so the flight does not depend on this throwaway account's campaign progress.
  await page.goto(`${baseURL}&lancer&level=4`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  // Launch from whichever menu is up. `&level=4` forces the LEVEL this tab flies regardless of the throwaway
  // account's progress — and a mid-campaign level carries a BRIEFING, so it opens the Main Window rather
  // than the Level-1 welcome card. From there "Take off" is `enterRoam(null)`: the star system, with the
  // campaign's fly-into-it zone armed. So this scenario does what a player does — flies into the zone and
  // lets its 3 s countdown hand over to the fight (`step-player.js checkMissionZone`) — rather than
  // spawning a lancer by hand, because what is under test includes the `?lancer` POOL SWAP itself.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const g = window.__game, z = g.missionZone;
    if (z && g.player) { g.player.pos.x = z.center.x; g.player.pos.z = z.center.z; g.player.vel.x = 0; g.player.vel.z = 0; }
  });
  // STEP THE SIM, never the wall clock — a scenario that sleeps is testing the CPU. The short real waits
  // between batches are for the level's .glb loads (genuinely asynchronous), not for the simulation.
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__game.enemies.length > 0)) break;
    await page.evaluate(() => window.__game.stepSim(30));
    await page.waitForTimeout(60);
  }
  // Wait out the level-warm veil ("Preparing the sector..."): it dims the whole frame.
  await page.waitForFunction(() => {
    const v = document.getElementById('levelwarm');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction('window.__game.enemies.length > 0', null, { timeout: 15000 });

  // 1. A LANCER IS IN THE FIGHT, AND IT IS BEAM-ARMED WITH THE WEAKENED ROW.
  const armed = await page.evaluate(() => {
    const e = window.__game.enemies[0];
    const out = {};
    for (const [n, g] of Object.entries(e.groups || {})) {
      out[n] = (g.mounts || []).map((m) => ({ type: m.weapon.type, id: m.weapon.id, maxRange: m.weapon.maxRange }));
    }
    return { name: e.name, groups: out, all: window.__game.enemies.map((x) => x.name) };
  });
  assert.equal(armed.name, 'pirate lancer', `?lancer swapped the pool (saw ${JSON.stringify(armed.all)})`);
  assert.deepEqual(Object.keys(armed.groups), ['gun'], 'beam-only, in ONE group');
  assert.equal(armed.groups.gun.length, 1,
    'and that group holds EXACTLY one mount — isBeamGroup uses `some`, so any other mount in it goes silent');
  assert.equal(armed.groups.gun[0].type, 'beam');
  assert.equal(armed.groups.gun[0].id, 13, 'the ENEMY beam row, not the player\'s 12');
  assert.equal(armed.groups.gun[0].maxRange, LANCER_RANGE, 'two thirds of the player\'s 100');

  // 2. CHARGE-ONLY. Nothing has charged yet — the enemies are still warping in and `ENEMY_FIRE_GRACE` has
  //    not elapsed — so there must be no hostile corridor anywhere. (The player's own sight is absent too:
  //    he carries a kinetic, not a beam.)
  const idle = await page.evaluate(() => {
    const out = [];
    window.__game.scene.traverse((o) => { if (o.name && o.name.startsWith('beamHostileSight')) out.push(o.visible); });
    return out;
  });
  assert.equal(idle.filter(Boolean).length, 0,
    `no hostile sight before anything charges (found ${idle.length} objects, ${idle.filter(Boolean).length} visible)`);
  await shot('no-telegraph');

  // 3-6. STEP INTO A CHARGE AND TAKE THE READING ON THE FRAME THE SIGHT IS UP.
  //
  //   Two gates sit in front of the first shot (`step-enemies.js wantsFire`): `ENEMY_FIRE_GRACE` is 5
  //   seconds of `world.combatElapsed`, and `e.warping` must have cleared. So the warp is forced complete
  //   and the loop runs ≥400 fixed steps (5 s of grace at 60 Hz is 300).
  //
  //   The lancer is PINNED 25 u dead ahead every iteration — inside its `ai.range` 50 and inside its 67 u
  //   reach — so the geometry is deterministic instead of a live chase. Every OTHER enemy is shoved far out
  //   of its own `ai.range`, so exactly one telegraph is on screen and exactly one shot lands: the damage
  //   assertion below has to be able to attribute the 45.
  //
  //   THE READING IS TAKEN INSIDE THE LOOP, on the tick the sight is visible. `setLine` leaves `position`,
  //   `lineDistance` and the material colour intact on a line that is later HIDDEN, so a reading taken
  //   afterwards would happily pass off a stale buffer with nothing on screen.
  const run = await page.evaluate(({ RANGE }) => {
    const g = window.__game;
    const p = g.player;
    const lancer = g.enemies.find((e) => e.name === 'pirate lancer');
    if (!lancer) return { err: 'no lancer on the field' };
    const grp = lancer.groups.gun;

    const place = () => {
      const fwd = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
      lancer.pos.x = p.pos.x + fwd.x * 25; lancer.pos.z = p.pos.z + fwd.z * 25;
      lancer.vel.x = 0; lancer.vel.z = 0;
      lancer.warping = false; lancer.spawnAge = lancer.spawnDur; lancer.scale = lancer.fullScale;
      // Everyone else out past `ai.range` 50, so only one lancer can ever be charging.
      for (const e of g.enemies) {
        if (e === lancer) continue;
        e.pos.x = p.pos.x + 4000; e.pos.z = p.pos.z + 4000; e.vel.x = 0; e.vel.z = 0;
      }
    };

    // The sight is POOLED (several lancers can charge at once), so the scene holds four centres and eight
    // edges and only the entry belonging to a live charge is shown. Everything below reads the VISIBLE ones
    // — grabbing "the first object with that name" would read an idle pool slot's stale buffer. Exactly one
    // lancer can be charging here, because `place()` holds every other enemy far outside its `ai.range`.
    const named = () => {
      const all = { centres: [], edges: [] };
      g.scene.traverse((o) => {
        if (o.name === 'beamHostileSightCentre') all.centres.push(o);
        else if (o.name === 'beamHostileSightEdge') all.edges.push(o);
      });
      return {
        all,
        centre: all.centres.find((o) => o.visible) || null,
        visibleEdges: all.edges.filter((o) => o.visible),
      };
    };
    const readLine = (o) => {
      const a = o.geometry.attributes.position;
      return {
        visible: o.visible,
        color: o.material.color.getHex(),
        opacity: o.material.opacity,
        dashed: !!o.material.isLineDashedMaterial,
        dashSize: o.material.dashSize,
        ax: a.getX(0), az: a.getZ(0), bx: a.getX(1), bz: a.getZ(1),
      };
    };

    // A clean, known health pool so the damage arithmetic is unambiguous: full hull and a FULL shield, so
    // the 45 lands as 20 absorbed (the Base shield's whole capacity) + 25 hull rather than against whatever
    // a partial recharge happened to leave. Both pools are read back below and the assertion is on their
    // COMBINED loss, so topping the shield up is what makes 20 + 25 the only possible split.
    p.hp = p.maxHp;
    if (p.shield) p._shieldValue = p.shield.capacity;
    const shieldCap = p.shield ? p.shield.capacity : 0;
    const hp0 = p.hp, sh0 = p.shield ? p._shieldValue : 0;

    let reading = null;      // captured ON the visible frame — never after
    let peakOpacity = 0, peakAt = 0, sawCharge = false, firstSightAt = -1;
    let steps = 0;
    for (let i = 0; i < 900; i++) {
      place();
      g.stepSim(1);
      steps++;
      const n = named();
      if (grp.charge) {
        sawCharge = true;
        if (n.centre) {
          if (firstSightAt < 0) firstSightAt = grp.charge.t;
          const op = n.centre.material.opacity;
          if (op > peakOpacity) { peakOpacity = op; peakAt = grp.charge.t; }
          // Capture the full reading roughly HALFWAY through the charge: the lines are unambiguously up,
          // and the frame is far from both the fade-in and the release.
          if (!reading && grp.charge.t > 0.4) {
            reading = {
              t: grp.charge.t,
              centre: readLine(n.centre),
              edges: n.visibleEdges.map(readLine),
              ship: { x: lancer.pos.x, z: lancer.pos.z, heading: lancer.heading,
                      noseZ: lancer.noseZ ?? 1.6, scale: lancer.scale || 1 },
              range: grp.mounts[0].weapon.maxRange,
              // The charge DUST and BEAD, read on this SAME frame. Pooled like the lines, so take the
              // visible entry — an idle slot keeps a stale buffer and would answer for a cloud that is
              // not on screen. Size is reproduced from the vertex shader at the camera's real distance,
              // because `visible === true` has already proved worthless twice on this weapon and a point
              // drawn at a fraction of a pixel is in the scene graph and nowhere else.
              dust: (() => {
                let d = null;
                g.scene.traverse((o) => { if (o.name === 'beamHostileDust' && o.visible) d = o; });
                if (!d) return null;
                const u = d.material.uniforms;
                const c = g.camera.position, o0 = u.uOrigin.value;
                const dist = Math.hypot(c.x - o0.x, c.y - o0.y, c.z - o0.z);
                return {
                  isPoints: !!d.isPoints, count: d.geometry.attributes.position.count,
                  color: u.uColor.value.getHex(), radius: u.uRadius.value,
                  px: u.uSize.value * (0.7 + u.uK.value * 0.6) * (300 / dist),
                  originX: o0.x, originZ: o0.z,
                };
              })(),
              bead: (() => {
                let b = null;
                g.scene.traverse((o) => { if (o.name === 'beamHostileOrb' && o.visible) b = o; });
                return b ? { color: b.material.color.getHex(), scale: b.scale.x,
                             x: b.position.x, z: b.position.z } : null;
              })(),
            };
          }
        }
      }
      if (reading && !grp.charge && sawCharge) break;   // the release has happened: stop
    }

    // Let the discharge settle and confirm the corridor is GONE while it reloads.
    for (let i = 0; i < 6; i++) { place(); g.stepSim(1); }
    const after = named();
    const afterVisible = after.all.centres.concat(after.all.edges).filter((o) => o.visible).length;
    const afterCount = after.all.centres.length + after.all.edges.length;

    // The bolt the LANCER just fired. Take the VISIBLE pooled quad: the pool is round-robin and shared with
    // the player's shots, so an idle slot still carries whatever hue it was last tinted.
    let bolt = null;
    g.scene.traverse((o) => {
      if (o.name === 'beamBolt' && o.visible && !bolt) {
        bolt = { isMesh: !!o.isMesh, width: o.scale.x, len: o.scale.z, color: o.material.color.getHex() };
      }
    });
    if (!bolt) g.scene.traverse((o) => {   // it may already have faded out; fall back to any pooled quad
      if (o.name === 'beamBolt' && !bolt) {
        bolt = { isMesh: !!o.isMesh, width: o.scale.x, len: o.scale.z, color: o.material.color.getHex() };
      }
    });

    return {
      sawCharge, reading, peakOpacity, peakAt, firstSightAt, steps, RANGE,
      afterVisible, afterCount, bolt,
      hp0, sh0, hp1: p.hp, sh1: p.shield ? p._shieldValue : 0, shieldCap, playerAlive: p.alive,
      dur: grp.mounts[0].weapon.chargeTime,
    };
  }, { RANGE: LANCER_RANGE });

  assert.ok(!run.err, `the fight set up (${run.err || 'ok'})`);
  assert.ok(run.sawCharge, `the lancer started a charge within ${run.steps} sim steps`);
  assert.ok(run.reading, 'and the hostile sight was VISIBLE mid-charge, so a reading was captured on that frame');

  // 3. THE HUE. Hostile, and emphatically not the player's green — the two must never be confused.
  const lines = [run.reading.centre, ...run.reading.edges];
  assert.equal(run.reading.edges.length, 2, 'THREE lines: a centre and both corridor edges, not one');
  for (const l of lines) {
    assert.ok(l.visible, 'each of the three is on screen on the captured frame');
    assert.equal(l.color, HOSTILE_ORANGE, 'the hostile sight is #ff6b4a');
    assert.notEqual(l.color, PLAYER_GREEN, 'and never the player\'s green');
  }

  // 4. THE LOOK IS THE PLAYER'S, REPRODUCED. One colour and one opacity across all three (the centre came
  //    DOWN to meet the edges: every WebGL line is 1 px, so a brighter centre just reads as a thicker one),
  //    with the centre distinguished by dash RHYTHM instead.
  for (const l of lines) {
    assert.equal(l.opacity, run.reading.centre.opacity, 'one opacity — the centre is NOT brighter');
    assert.ok(l.dashed, 'all three are LineDashedMaterial');
  }
  assert.ok(run.reading.centre.dashSize > run.reading.edges[0].dashSize,
    `centre = long strokes, edges = short ticks (${run.reading.centre.dashSize} vs ${run.reading.edges[0].dashSize})`);

  // 5. THE GEOMETRY: full reach, from the lancer's own muzzle.
  const s = run.reading.ship;
  const muzzle = {
    x: s.x + Math.sin(s.heading) * s.noseZ * s.scale,
    z: s.z + Math.cos(s.heading) * s.noseZ * s.scale,
  };
  assert.equal(run.reading.range, LANCER_RANGE, 'drawn from the lancer\'s own weapon row');

  // THE CHARGE DUST AND BEAD, in the TELEGRAPH's hue (maintainer, 2026-08-30). Red says "aimed at you, now";
  // the bolt then leaves in the shared blue, so the hue change at release reads on its own as "it has gone".
  // Both are pooled per shooter, and both are asserted on real drawn quantities — a point at a fraction of a
  // pixel and a bead at zero scale are both `visible === true`, which is exactly how this weapon has failed
  // before.
  // AND THE SHOT ITSELF IS RED (maintainer, 2026-08-30) — because THE COLOUR IS THE WEAPON'S, not the
  // shooter's. The lancer's row (id 13) carries `projectileColor` 0xff6b4a and the player's (id 12) blue, so
  // the hue travels on the event and the renderer never asks which side fired. Hand the lancer's row to the
  // wingman and his beam is red too; `sim-core/beam.test.js` pins exactly that.
  assert.ok(run.bolt, 'the lancer\'s discharge was drawn');
  assert.equal(run.bolt.color, HOSTILE_ORANGE,
    `a hostile bolt carries the telegraph's red, not the shot blue (got 0x${(run.bolt.color || 0).toString(16)})`);
  assert.notEqual(run.bolt.color, DISCHARGE_BLUE, 'and is explicitly not the friendly hue');

  const dust = run.reading.dust;
  assert.ok(dust, 'a charging lancer pulls dust into its muzzle, like the player does');
  assert.ok(dust.isPoints && dust.count > 16, `it is a real particle system (${dust.count} points)`);
  assert.equal(dust.color, HOSTILE_ORANGE,
    `the specks burn the lancer WEAPON's colour (got 0x${dust.color.toString(16)})`);
  assert.notEqual(dust.color, DISCHARGE_BLUE, 'and are deliberately NOT the player weapon\'s blue');
  assert.ok(dust.px > 4, `drawn at a size a human can see (${dust.px.toFixed(1)} px)`);
  assert.ok(dust.radius > 1, 'born far enough out that the inward fall reads as travel');

  const bead = run.reading.bead;
  assert.ok(bead, 'and the bead it falls into is drawn too');
  assert.equal(bead.color, HOSTILE_ORANGE, 'the bead burns the weapon\'s colour too');
  assert.ok(bead.scale > 0, `and has a real size (${bead.scale.toFixed(3)})`);
  // Both sit on the LANCER's muzzle, not the player's — the pooled entry belongs to its own shooter.
  assert.ok(Math.hypot(dust.originX - bead.x, dust.originZ - bead.z) < 1e-6,
    'dust and bead share one origin — they are one effect');
  assert.ok(Math.hypot(dust.originX - run.reading.centre.ax, dust.originZ - run.reading.centre.az) < 0.5,
    'and that origin is where the corridor starts: the lancer\'s own muzzle');
  for (const [i, l] of lines.entries()) {
    const len = Math.hypot(l.bx - l.ax, l.bz - l.az);
    assert.ok(Math.abs(len - LANCER_RANGE) < 2,
      `line ${i} spans the weapon's full ${LANCER_RANGE} u, never clipped to the shooter's vicinity `
      + `(drawn ${len.toFixed(1)}) — the half the player reads runs PAST his own ship`);
    assert.ok(Math.hypot(l.ax - muzzle.x, l.az - muzzle.z) < 1.5,
      `line ${i} starts at the LANCER's muzzle (${l.ax.toFixed(1)},${l.az.toFixed(1)}) vs `
      + `(${muzzle.x.toFixed(1)},${muzzle.z.toFixed(1)})`);
  }
  // The corridor is a WEDGE: the two edges end apart from each other and from the centre.
  const edgeGap = Math.hypot(run.reading.edges[0].bx - run.reading.edges[1].bx,
                             run.reading.edges[0].bz - run.reading.edges[1].bz);
  assert.ok(edgeGap > 1, `the two edges diverge over 67 u (${edgeGap.toFixed(2)} u apart at the far end)`);

  // 6. IT BRIGHTENS OVER THE CHARGE, AND IS BRIGHTEST LATE — the ramp rides the event's `dur`.
  assert.ok(run.peakOpacity > 0.22 + 1e-6,
    `the sight rises above its 0.22 idle as the charge fills (peak ${run.peakOpacity.toFixed(3)})`);
  assert.ok(run.peakAt > run.dur * 0.5,
    `and it is brightest LATE in the ${run.dur}s window, at t=${run.peakAt.toFixed(2)}s`);

  // 7. THE RELEASE CLEARS IT, and the bolt is drawn whoever fired it.
  assert.ok(run.afterCount >= 3, 'the pooled objects still exist after the shot');
  assert.equal(run.afterVisible, 0,
    'and every one of them is HIDDEN once the shot is away — the corridor is gone while it reloads');
  assert.ok(run.bolt && run.bolt.isMesh, 'the discharge is drawn for a HOSTILE shooter too');
  assert.ok(Number.isFinite(run.bolt.width) && run.bolt.width > 0,
    `with a finite positive width, not undefined/NaN (got ${run.bolt.width})`);
  assert.ok(Number.isFinite(run.bolt.len) && run.bolt.len > 0, `and a real span (got ${run.bolt.len})`);
  await shot('hostile-discharge');

  // 8. THE DAMAGE IS THE LANCER'S 45, NOT THE PLAYER WEAPON'S 80. The hostile path routes through the
  //    shield first (§76), so the loss is COMBINED: with the Base shield's 20 capacity that is 20 absorbed
  //    plus 25 hull. This is the assertion that would catch a lancer accidentally wired to weapon 12.
  const lost = (run.sh0 - run.sh1) + (run.hp0 - run.hp1);
  assert.equal(lost, 45,
    `the lancer's own row dealt 45 (shield ${run.sh0}→${run.sh1}, hull ${run.hp0}→${run.hp1}); `
    + `capacity ${run.shieldCap}, alive=${run.playerAlive}`);
  assert.notEqual(lost, 80, 'and emphatically not the player beam\'s 80');

  // 9. A FRAME WITH THE TELEGRAPH ACTUALLY ON IT — for a human, not for an assertion.
  //
  //    TWO CLOCKS, and the first one wasted a shot. `stepSim` drives the SIM clock, but the page's own rAF
  //    loop keeps calling `update(realDt)` for the hundreds of milliseconds a screenshot takes — so a 1.0 s
  //    telegraph is long gone by the time the shutter opens, and the first version of this frame
  //    photographed the cyan DISCHARGE instead of the red lines it exists to show. PAUSING stops that loop
  //    (`main.js`: `if (!G.paused && !G.mapOpen) update(dt)`) while `stepSim` still steps `update` directly.
  //    The pause overlay is hidden because it is a panel over the middle of the picture.
  await page.click('#pause-btn');
  await page.evaluate(() => {
    for (const id of ['pause-overlay', 'pause-btn']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';   // presentation only — the freeze is what matters
    }
  });
  const framed = await page.evaluate(() => {
    const g = window.__game, p = g.player;
    const lancer = g.enemies.find((e) => e.name === 'pirate lancer');
    if (!lancer) return { ok: false };
    const grp = lancer.groups.gun;
    const place = () => {
      const fwd = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
      lancer.pos.x = p.pos.x + fwd.x * 25; lancer.pos.z = p.pos.z + fwd.z * 25;
      lancer.vel.x = 0; lancer.vel.z = 0;
      lancer.warping = false; lancer.spawnAge = lancer.spawnDur; lancer.scale = lancer.fullScale;
      for (const e of g.enemies) {
        if (e === lancer) continue;
        e.pos.x = p.pos.x + 4000; e.pos.z = p.pos.z + 4000; e.vel.x = 0; e.vel.z = 0;
      }
    };
    // Stop LATE in the next charge, where the lines are at their brightest — that is the frame worth
    // photographing.
    for (let i = 0; i < 300; i++) {
      place(); g.stepSim(1);
      if (!grp.charge || grp.charge.t <= 0.75) continue;
      // AND MEASURE THE PICTURE, not the world. A corridor can be geometrically perfect and still project
      // to nothing — the camera is near-top-down at (0,110,26), so a world-space check is not a screen-space
      // one. Project the muzzle and the three far ends and report where they actually land in pixels.
      let centre = null;
      g.scene.traverse((o) => { if (o.name === 'beamHostileSightCentre' && o.visible) centre = o; });
      if (!centre) continue;
      const a = centre.geometry.attributes.position;
      const toPx = (x, y, z) => {
        const v = new (Object.getPrototypeOf(g.player.mesh.position).constructor)(x, y, z).project(g.camera);
        return { x: Math.round((v.x + 1) / 2 * window.innerWidth), y: Math.round((1 - v.y) / 2 * window.innerHeight) };
      };
      return {
        ok: true, t: grp.charge.t, hp: p.hp,
        muzzlePx: toPx(a.getX(0), a.getY(0), a.getZ(0)),
        endPx: toPx(a.getX(1), a.getY(1), a.getZ(1)),
        playerPx: toPx(p.pos.x, p.pos.y, p.pos.z),
        screen: { w: window.innerWidth, h: window.innerHeight },
      };
    }
    return { ok: false };
  });
  assert.ok(framed.ok, 'a second charge was reached and frozen mid-telegraph for the frame');
  console.log(`      on screen: muzzle (${framed.muzzlePx.x},${framed.muzzlePx.y}) → far end `
    + `(${framed.endPx.x},${framed.endPx.y}); the player sits at (${framed.playerPx.x},${framed.playerPx.y}) `
    + `on a ${framed.screen.w}x${framed.screen.h} frame`);
  // IT IS A LINE ACROSS THE FRAME, NOT A DOT. A corridor that projected to a couple of pixels would satisfy
  // every world-space assertion above and be invisible in play.
  const px = Math.hypot(framed.endPx.x - framed.muzzlePx.x, framed.endPx.y - framed.muzzlePx.y);
  assert.ok(px > 200, `the telegraph spans ${px.toFixed(0)} px of the frame`);
  // AND IT CROSSES THE PLAYER'S SHIP — the reading that makes it a warning rather than decoration. The far
  // end has to be BEYOND him along the same line, which is what "drawn to the full 67 u" buys.
  const toPlayer = Math.hypot(framed.playerPx.x - framed.muzzlePx.x, framed.playerPx.y - framed.muzzlePx.y);
  assert.ok(px > toPlayer * 1.5,
    `and it runs well PAST him (${px.toFixed(0)} px of corridor against ${toPlayer.toFixed(0)} px to his hull), `
    + 'so the half he reads is the half crossing his own ship');
  await shot('hostile-charging');
}
