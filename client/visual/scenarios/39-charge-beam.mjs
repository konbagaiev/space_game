// The charged beam, in an actual browser — the half no unit test can see.
//
// `sim-core/beam.test.js` pins the RULES exactly; what it cannot see is whether any of it is DRAWN. This
// weapon is a look-and-feel feature first (maintainer, 2026-08-25) and its look values were settled by
// flying a throwaway spike, so the thing most likely to be silently lost is not the mechanic — it is the
// port of the look. A visual feature can pass every logic assertion and ship invisible.
//
// So it asserts four things, and the third is the one a careless port breaks:
//   1. it MOUNTS (`?beam` puts the real catalog row into the real gun group);
//   2. the sight is VISIBLE while aiming — three named lines and a reticle;
//   3. THE LOOK SURVIVED — one green hue on all three lines, the centre distinguished by DASH RHYTHM and
//      not by brightness, and a discharge in a DIFFERENT (cyan-white) hue. Those are precisely the values
//      that vanish quietly when a look is re-typed from a document;
//   4. it charges, discharges and DAMAGES.
//
// The scenario covers the PLAYER's beam only: no enemy is armed and no hostile sight is asserted, because
// the enemy beam is deferred behind the gate in DECISIONS §135.
//
// Asserted on OBSERVABLE STATE — hull damage, the group's own charge field, and the NAMED scene objects —
// rather than on sim events: `__game` deliberately does not expose the World.
export const name = '39-charge-beam';

const SIGHT_GREEN = 0x5ad17f;
const DISCHARGE_CYAN = 0xbfefff;

export default async function ({ page, assert, shot, baseURL }) {
  // Re-boot this page with the dev flag on: the beam is gated at level-4 and costs 5500, so neither this
  // scenario nor an early playable build can reach it through the shop.
  await page.goto(`${baseURL}&beam`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.evaluate(() => {
    const w = document.getElementById('welcome');
    if (w && w.style.display !== 'none') document.getElementById('takeoff').click();
  });
  // Wait out the level-warm veil ("Preparing the sector..."): it dims the whole frame, so a screenshot
  // taken under it says nothing about whether the sight is legible — which is what shot 1 is for.
  await page.waitForFunction(() => {
    const v = document.getElementById('levelwarm');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);

  // 1. IT MOUNTS — the real catalog row, in the ship's existing `gun` group, on the existing Space trigger.
  //    No new slot and no new key: the beam IS the primary weapon while it is fitted.
  const mounted = await page.evaluate(() => {
    const p = window.__game.player;
    const out = {};
    for (const [name, g] of Object.entries(p.groups || {})) {
      out[name] = (g.mounts || []).map((m) => ({ type: m.weapon.type, id: m.weapon.id, name: m.weapon.name }));
    }
    return { groups: out, key: p.groups.gun && p.groups.gun.key };
  });
  assert.equal(mounted.groups.gun.length, 1, 'the gun group holds exactly one mount — never a mixed group');
  assert.equal(mounted.groups.gun[0].type, 'beam', `the player carries a beam (got ${JSON.stringify(mounted.groups.gun)})`);
  assert.equal(mounted.groups.gun[0].name, 'Charged beam');
  assert.equal(mounted.key, 'Space', 'fired on Space, like the gun it replaced');
  assert.ok(mounted.groups.rocket && mounted.groups.rocket[0].type === 'rocket',
    'and the rocket slot is untouched — only the primary weapon changed');

  // 2. IT IS VISIBLE WHILE AIMING — the frame the player spends the whole fight looking at. Asserted on the
  //    NAMED sight objects, not on "some line in the scene": the arena border and the Grab's pull beam are
  //    Lines too, and counting those would pass with no sight drawn at all.
  const aiming = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const e = g.enemies[0];
    // Park a fully-formed enemy 40 u dead ahead so the reticle has something to paint. (Enemies spawn
    // 70-130 u out and the beam reaches 100, so this is for DETERMINISM, not for reach.)
    const fwd = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
    e.pos.x = p.pos.x + fwd.x * 40; e.pos.z = p.pos.z + fwd.z * 40;
    e.warping = false; e.spawnAge = e.spawnDur; e.scale = e.fullScale;
    g.stepSim(1);
    const named = {};
    g.scene.traverse((o) => { if (o.name && o.name.startsWith('beam')) (named[o.name] ||= []).push(o.visible); });
    return named;
  });
  assert.deepEqual(aiming.beamSightCentre, [true], 'the centre line is drawn while aiming');
  assert.deepEqual(aiming.beamSightEdge, [true, true], 'and BOTH corridor edges with it — three lines, not one');
  assert.deepEqual(aiming.beamReticle, [true], 'the enemy in the corridor is marked with a reticle');
  await shot('aiming');

  // 3. THE LOOK SURVIVED THE PORT (the plan's §2e — settled by flying, so it is reproduced, not improved).
  const look = await page.evaluate(() => {
    const g = window.__game;
    const byName = {};
    g.scene.traverse((o) => { if (o.name && o.name.startsWith('beam')) (byName[o.name] ||= []).push(o); });
    const mat = (o) => ({
      color: o.material.color.getHex(),
      opacity: o.material.opacity,
      dashed: !!o.material.isLineDashedMaterial,
      dashSize: o.material.dashSize, gapSize: o.material.gapSize,
    });
    return {
      centre: mat(byName.beamSightCentre[0]),
      edges: byName.beamSightEdge.map(mat),
      orb: byName.beamOrb ? byName.beamOrb[0].material.color.getHex() : null,
    };
  });
  // ONE hue and ONE opacity for all three: the centre came DOWN to meet the edges, because every WebGL line
  // is 1 px whatever `linewidth` says — so a brighter centre reads as a THICKER one.
  assert.equal(look.centre.color, SIGHT_GREEN, 'the sight is green (#5ad17f)');
  for (const e of look.edges) {
    assert.equal(e.color, SIGHT_GREEN, 'all three lines share one colour');
    assert.equal(e.opacity, look.centre.opacity, 'and one opacity — the centre is NOT brighter');
  }
  // The centre is distinguished by RHYTHM instead: long strokes against the edges' short ticks.
  assert.ok(look.centre.dashed && look.edges.every((e) => e.dashed), 'all three are LineDashedMaterial');
  assert.notEqual(look.centre.dashSize, look.edges[0].dashSize,
    `the centre's dash rhythm differs from an edge's (centre ${look.centre.dashSize}, edge ${look.edges[0].dashSize})`);
  assert.ok(look.centre.dashSize > look.edges[0].dashSize, 'centre = long strokes, edges = short ticks');
  assert.equal(look.orb, DISCHARGE_CYAN, 'the muzzle bead carries the DISCHARGE hue, not the sight\'s');
  // (The bolt itself is pooled on the first shot, so its hue is asserted after the fight below.)

  // 4. IT CHARGES, DISCHARGES AND DAMAGES.
  //
  //    The target is PINNED on the centre line every tick, and that is not a cheat to make the test pass —
  //    it is the only way to make this deterministic. The enemy is a live AI that flies, and at 40 u the
  //    ±2° corridor is only 1.4 u wide against a ~2.6 u hull, so an ordinary pirate steering through the
  //    **1.0 s** charge drifts clean out of it most of the time — a 5 u/s crosser covers 5.0 u against a
  //    ~4.0 u effective window at this range. That escape IS the weapon (`sim-core/beam.test.js` measures it
  //    exactly, at the real numbers); what this scenario is here to see is the browser half — that a held
  //    trigger runs charge → discharge → damage with the FX attached. So: hold the target still, and let
  //    the unit test own the dodging.
  const fight = await page.evaluate(async () => {
    const g = window.__game;
    const p = g.player;
    const e = g.enemies[0];
    const pin = () => {
      const fwd = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
      e.pos.x = p.pos.x + fwd.x * 40; e.pos.z = p.pos.z + fwd.z * 40;
      e.vel.x = 0; e.vel.z = 0;
    };
    // Park it dead ahead (the tick above let it drift) and give it a clean, shieldless hull so the damage
    // reads as hull loss rather than shield absorption.
    pin();
    e.warping = false; e.spawnAge = e.spawnDur; e.scale = e.fullScale;
    e.hp = e.maxHp; if (e.shield) e._shieldValue = 0;
    const hp0 = e.hp;

    const grp = Object.values(p.groups).find((v) => v.mounts[0] && v.mounts[0].weapon.type === 'beam');
    const dur = grp.mounts[0].weapon.chargeTime;

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    let sawCharge = false, peak = 0, orbVisibleMidCharge = false, sightBrightestAt = 0, maxOpacity = 0;
    const orb = (() => { let o = null; g.scene.traverse((x) => { if (x.name === 'beamOrb') o = x; }); return o; })();
    const centre = (() => { let o = null; g.scene.traverse((x) => { if (x.name === 'beamSightCentre') o = x; }); return o; })();
    // 3 s at the fixed sim step: enough for a full 1.0 s charge, its discharge and the 0.5 s lock-out,
    // with room for a second cycle. Sized against chargeTime rather than left at the old 0.5 s figure.
    for (let i = 0; i < 180; i++) {
      pin();                                // hold it on the centre line — see the note above
      g.stepSim(1);
      if (grp.charge) {
        sawCharge = true;
        peak = Math.max(peak, grp.charge.t);
        if (grp.charge.t > dur * 0.5 && orb && orb.visible) orbVisibleMidCharge = true;
        if (centre && centre.material.opacity > maxOpacity) {
          maxOpacity = centre.material.opacity; sightBrightestAt = grp.charge.t;
        }
      }
    }
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
    return { hp0, hp1: e.hp, sawCharge, peak, dur, alive: e.alive, orbVisibleMidCharge, maxOpacity, sightBrightestAt };
  });

  assert.ok(fight.sawCharge, 'holding fire puts the group into a CHARGE state that spans ticks');
  assert.ok(fight.peak > fight.dur * 0.7,
    `the charge builds toward its ${fight.dur}s window (peak t=${fight.peak.toFixed(2)}s)`);
  assert.ok(fight.orbVisibleMidCharge, 'the bead of light gathers at the muzzle while the shot fills');
  // The sight BRIGHTENS over the charge — the brightening IS the charge readout (there is no HUD bar).
  assert.ok(fight.maxOpacity > 0.22 + 1e-6,
    `the sight brightens above its 0.22 idle as the charge fills (peak ${fight.maxOpacity.toFixed(3)})`);
  assert.ok(fight.sightBrightestAt > fight.dur * 0.5,
    `and it is brightest LATE in the charge, at t=${fight.sightBrightestAt.toFixed(2)}s`);
  assert.ok(fight.hp1 < fight.hp0 || !fight.alive,
    `the discharge damages the target in its corridor (hp ${fight.hp0} → ${fight.hp1}, alive=${fight.alive})`);
  await shot('discharge');

  // 4b. A FRAME WITH THE BOLT ACTUALLY ON IT, AND ITS GEOMETRY CHECKED.
  //
  //     THE BOLT IS NOT A LINE — it is two additive quads (a white-hot core inside a wider glow), because a
  //     WebGL line is 1 px wide whatever `linewidth` says and thickness is therefore only expressible as
  //     geometry. That makes `visible === true` a WORTHLESS assertion here: on the spike a patch failed to
  //     apply, the width constant stayed `undefined`, `scale.set(undefined, …)` produced a NaN transform,
  //     and the beam rendered as absolutely nothing while `visible` stayed true the whole time. So the
  //     assertions below are on the TRANSFORM: finite positive widths, core narrower than glow, and a span
  //     that actually reaches from the muzzle to the target. No magic thresholds — the widths are tuned
  //     values and a test that hardcodes them breaks the next time they are.
  //
  //     TWO CLOCKS HAVE TO BE DEALT WITH, and the first one cost a frame that showed nothing. `stepSim`
  //     drives the SIM clock, but the page's own rAF loop keeps calling `update(realDt)` the whole time a
  //     screenshot is being taken — hundreds of milliseconds — so a short transient is already gone by the
  //     time the shutter opens, however carefully the sim was stepped. PAUSING stops that loop
  //     (`main.js`: `if (!G.paused && !G.mapOpen) update(dt)`) while `stepSim` still steps `update` directly,
  //     which gives a still frame that can be aimed exactly. The pause OVERLAY is then hidden, because it
  //     is a centred panel over the middle of the picture — the part this shot is about.
  //
  //     THE HOT CORE IS GONE WITHIN ~0.25 s of the 1.0 s fade, so a frame taken even slightly late shows
  //     only the soft trail: step ONE tick at a time and stop the instant the charge completes. The target
  //     is also given a large hull deliberately — if the shot kills it, the explosion covers the very thing
  //     this frame exists to show.
  await page.click('#pause-btn');
  await page.evaluate(() => {
    for (const id of ['pause-overlay', 'pause-btn']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';   // presentation only — the freeze is what matters
    }
  });
  const bolt = await page.evaluate(async () => {
    const g = window.__game;
    const p = g.player;
    const grp = Object.values(p.groups).find((v) => v.mounts[0] && v.mounts[0].weapon.type === 'beam');

    // A target that SURVIVES the shot, parked on the centre line, so the bolt ends on a hull and no kill
    // explosion covers it. Rebuilt from whatever enemy is left (the fight above may have cleared the field).
    const e = g.enemies.find((x) => x.alive) || g.enemies[0] || null;
    const pin = () => {
      if (!e) return;
      const fwd = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
      e.pos.x = p.pos.x + fwd.x * 40; e.pos.z = p.pos.z + fwd.z * 40;
      e.vel.x = 0; e.vel.z = 0;
    };
    if (e) {
      pin();
      e.warping = false; e.spawnAge = e.spawnDur; e.scale = e.fullScale;
      e.maxHp = 100000; e.hp = e.maxHp; if (e.shield) e._shieldValue = 0;
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    // ONE TICK AT A TIME, stopping the INSTANT the charge completes — the white-hot core is gone within a
    // quarter of the 1.0 s fade, so overshooting even slightly photographs the soft trail instead.
    let fired = false, sawCharge = false;
    for (let i = 0; i < 240 && !fired; i++) {
      const wasCharging = !!grp.charge;
      sawCharge = sawCharge || wasCharging;
      pin();
      g.stepSim(1);
      if (wasCharging && !grp.charge) fired = true;      // this tick WAS the release
    }
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));

    const muzzle = { x: p.pos.x + Math.sin(p.heading) * (p.noseZ ?? 1.6) * (p.scale || 1),
                     z: p.pos.z + Math.cos(p.heading) * (p.noseZ ?? 1.6) * (p.scale || 1) };
    const read = (o) => ({
      isMesh: !!o.isMesh,
      width: o.scale.x, len: o.scale.z, opacity: o.material.opacity,
      color: o.material.color.getHex(),
      x: o.position.x, z: o.position.z, rotY: o.rotation.y,
    });
    let glow = null, core = null, flash = null;
    g.scene.traverse((o) => {
      if (o.name === 'beamBolt' && o.visible) glow = read(o);
      if (o.name === 'beamBoltCore' && o.visible) core = read(o);
      if (o.name === 'beamFlash' && o.visible) flash = read(o);
    });
    return {
      fired, sawCharge, playerAlive: p.alive, enemies: g.enemies.length,
      glow, core, flash, muzzle,
      targetAlive: e ? e.alive : null,
      targetPos: e ? { x: e.pos.x, z: e.pos.z } : null,
    };
  });
  assert.ok(bolt.fired,
    `a shot was charged and released (sawCharge=${bolt.sawCharge}, playerAlive=${bolt.playerAlive}, enemies=${bolt.enemies})`);

  // THE BOLT IS GEOMETRY, AND THE GEOMETRY IS SANE. Each of these fails on the exact defect that shipped an
  // invisible beam on the spike: a bolt drawn with an undefined width is still `visible === true`.
  assert.ok(bolt.glow && bolt.glow.isMesh, 'the discharge glow is a MESH, not a 1px line');
  assert.ok(bolt.core && bolt.core.isMesh, 'and so is the white-hot core');
  for (const [name, q] of [['glow', bolt.glow], ['core', bolt.core]]) {
    assert.ok(Number.isFinite(q.width) && q.width > 0,
      `the ${name}'s width is a finite positive number, not undefined/NaN (got ${q.width})`);
    assert.ok(Number.isFinite(q.len) && q.len > 0, `and its length spans something (got ${q.len})`);
    assert.ok(Number.isFinite(q.x) && Number.isFinite(q.z), `and its position is finite`);
  }
  assert.ok(bolt.core.width < bolt.glow.width,
    `the core is narrower than the glow it sits inside (${bolt.core.width} < ${bolt.glow.width})`);
  assert.ok(bolt.core.opacity > 0, 'the core is still hot on this frame — stepped to the release tick');

  // IT SPANS MUZZLE → TARGET. The quad is centred on the midpoint and scaled by the length, so the span is
  // checked against the two endpoints the simulation actually used rather than against a magic number.
  if (bolt.targetPos) {
    const want = Math.hypot(bolt.targetPos.x - bolt.muzzle.x, bolt.targetPos.z - bolt.muzzle.z);
    assert.ok(Math.abs(bolt.glow.len - want) < 4,
      `the beam runs the muzzle→target distance (drawn ${bolt.glow.len.toFixed(1)}, expected ~${want.toFixed(1)})`);
    const midX = (bolt.muzzle.x + bolt.targetPos.x) / 2, midZ = (bolt.muzzle.z + bolt.targetPos.z) / 2;
    assert.ok(Math.hypot(bolt.glow.x - midX, bolt.glow.z - midZ) < 4,
      'and it is centred on the midpoint between them');
  }
  assert.ok(bolt.flash, 'with the bloom where it landed');
  await shot('bolt');

  // 5. THE SIGHT AND THE SHOT ARE NOT THE SAME HUE. They shared one blue at first, and the aiming aid
  //    competed with the discharge it exists to predict; splitting them is what makes the SHOT the thing the
  //    eye lands on, and it is what lets the sight sit on screen permanently. The bolt pool is built on the
  //    first discharge, so this is asserted here rather than beside the rest of the look.
  const bolts = await page.evaluate(() => {
    const out = [];
    window.__game.scene.traverse((o) => {
      if (o.name === 'beamBolt' || o.name === 'beamFlash') out.push({ name: o.name, color: o.material.color.getHex() });
    });
    return out;
  });
  assert.ok(bolts.length >= 2, `the discharge really pooled its objects (${bolts.length} found)`);
  for (const b of bolts) {
    assert.equal(b.color, DISCHARGE_CYAN, `${b.name} is cyan-white (0xbfefff)`);
    assert.notEqual(b.color, SIGHT_GREEN, 'the shot is a DIFFERENT hue from the green sight that announced it');
  }
  // The core is deliberately WHITE rather than the discharge hue — it is the hot centre of the glow, and
  // giving it the same cyan would flatten the two quads into one colour and lose the "hot core" read.
  const coreColor = await page.evaluate(() => {
    let c = null;
    window.__game.scene.traverse((o) => { if (o.name === 'beamBoltCore') c = o.material.color.getHex(); });
    return c;
  });
  assert.equal(coreColor, 0xffffff, 'the core is white-hot, brighter than the glow around it');
}
