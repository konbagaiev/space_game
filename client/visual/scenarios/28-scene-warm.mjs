// A freshly built level must be compiled + uploaded BEFORE it is played, not while it is played.
//
// THREE compiles a material's program and uploads its textures on the first frame the object is DRAWN.
// Field telemetry from a weak phone measured the result: over the first 15 s of combat the main thread was
// blocked for 10+ seconds (one frame took 2082 ms) while the live program count climbed 14 -> 33. The warm
// used to run once at page bootstrap — before any level exists — so it warmed an empty scene and everything
// real compiled during play. `sim.reset()` now raises `G.needsSceneWarm` and the render loop consumes it at
// the top of the next frame, ahead of that frame's draw.
//
// The perf effect itself can't be asserted headlessly (software WebGL doesn't reproduce the stall, and
// compiles almost everything at bootstrap anyway) — the proof of that is field telemetry. What IS pinned
// here is the wiring, which is the part that can break silently.
export const name = '28-scene-warm';

export default async function ({ page, assert }) {
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(500);

  // A rebuild raises the request — read synchronously, before any frame can run.
  const raised = await page.evaluate(() => { window.__game.reset(); return window.__game.needsSceneWarm; });
  assert.equal(raised, true, 'sim.reset() asks the render loop to warm the freshly built level');

  // ...and the render loop consumes it, so the warm happens BEFORE that content is drawn. Poll rather than
  // sleep a fixed time: late async arrivals (set-piece .glbs) legitimately raise the flag again, each
  // consumed on the following frame, so the state oscillates for a moment after a level build.
  await page.waitForFunction(() => window.__game.needsSceneWarm === false, null, { timeout: 8000 });

  // The veil must be RAISED while the blocking compile runs, and taken down after. Reading it right after
  // reset (before any frame) proves the ORDER: the veil goes up first, the work happens a frame later. If
  // the compile ran in the same frame the browser could never paint the veil and the player would just see
  // the game frozen at 1 fps — the bug this exists to prevent.
  await page.waitForFunction(() => !document.getElementById('levelwarm').classList.contains('on'),
    null, { timeout: 8000 }); // settle: no warm pending
  const veilDuring = await page.evaluate(() => new Promise((res) => {
    window.__game.reset();
    requestAnimationFrame(() => res(document.getElementById('levelwarm').classList.contains('on')));
  }));
  assert.equal(veilDuring, true, 'the frame that takes the warm request raises the veil BEFORE doing the work');
  await page.waitForFunction(() => !document.getElementById('levelwarm').classList.contains('on'),
    null, { timeout: 8000 });

  // And the warm rig is permanent: disposing its materials would hand the compiled programs straight back,
  // which is what made programs recompile mid-fight (live count sawing 37<->40).
  const rig = await page.evaluate(() => {
    let found = null;
    window.__game.scene.traverse((o) => { if (o.isGroup && o.position.y === -100000) found = o; });
    return found ? { children: found.children.length, disposed: found.children.some((c) => !c.material) } : null;
  });
  assert.ok(rig && rig.children >= 2, 'the FX warm rig stays in the scene for the session');

  // The load-bearing one: a ship death must not COMPILE anything. Its flipbook fireball and shockwave ring
  // each dispose their material when they finish, and THREE frees a program with its last material — so
  // without a held instance every explosion after a lull recompiles, blocking the main thread mid-fight.
  // Field telemetry caught freeze frames creating 7 programs in one second; this measured +3 locally before
  // the rig held these two materials, and 0 after.
  const compiled = await page.evaluate(() => {
    const g = window.__game;
    const draw = () => { g.renderer.clear(); g.renderer.render(g.skyScene, g.camera); g.renderer.clearDepth(); g.renderer.render(g.scene, g.camera); };
    draw();
    const before = g.renderer.info.programs.length;
    g.spawnShipExplosion(g.player.mesh.position.clone(), 0xff8030, 1);
    draw();
    return g.renderer.info.programs.length - before;
  });
  // The veil must also outlast the .glb loads, or the fight starts on procedural placeholder cones while
  // the real models trickle in — reported on the itch build, whose first load fetches ~20 MB. Counted in
  // `G.pendingAssets`, with a hard cap so a wedged download can never lock the player out.
  const assets = await page.evaluate(() => ({
    pending: window.__game.pendingAssets,
    veil: document.getElementById('levelwarm').classList.contains('on'),
  }));
  assert.equal(assets.pending, 0, 'every essential .glb load has settled (the counter returns to zero)');
  assert.equal(assets.veil, false, 'and the veil is down once nothing is in flight');

  assert.equal(compiled, 0,
    `a ship explosion compiles no new shader programs (got +${compiled} — an FX material config is not held alive)`);
  assert.ok(!rig.disposed, 'its materials are never disposed — a freed material frees its compiled program');
}
