// Mission set-pieces: ONE shared world holds all three procedural set-pieces (research station / asteroid
// field + mining beam / freighter) at fixed positions. They exist on every level/mission; a mission only
// changes WHERE you fight — its `center` spawns the player + arena over the matching structure, the others
// sit at a distance. Asserts all three are always present and the mission's own one is at the arena center,
// screenshots each, and checks the freighter cruises (without the zone drifting).
export const name = '09-mission-setpieces';

const near = (a, b) => Math.abs(a - b) < 1.5;

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  // ensure the campaign is cleared so missions are offered, then land on the Hangar
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
  }, pid);
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForFunction('window.__game.missionOffers.length === 3', null, { timeout: 6000 });

  // the shared world holds all three set-pieces (built from the map descriptor)
  const worldPieces = await page.evaluate(() => window.__game.setPieces.length);
  assert.equal(worldPieces, 3, 'all three set-pieces exist in the shared world');

  // launch each mission; all three are present, and the mission's own structure is at the arena center
  for (const type of ['mining', 'research', 'freighter']) {
    const info = await page.evaluate((type) => {
      const g = window.__game;
      g.launchMission(g.missionOffers.find((o) => o.type === type));
      const c = g.arenaCenter;
      const here = g.setPieces.find((sp) => Math.abs(sp.obj.position.x - c.x) < 1.5 && Math.abs(sp.obj.position.z - c.z) < 1.5);
      return {
        count: g.setPieces.length,
        center: [c.x, c.z],
        atCenterY: here ? here.obj.position.y : null,
        belowPlane: g.setPieces.every((sp) => sp.obj.position.y < -10),
      };
    }, type);
    assert.equal(info.count, 3, `${type}: all three world set-pieces are present`);
    assert.ok(info.atCenterY !== null && info.atCenterY < -10, `${type}: the mission's own structure is at the combat center, below the plane`);
    assert.ok(info.belowPlane, `${type}: every set-piece sits below the combat plane`);
    await page.waitForTimeout(500);
    await shot(type);
  }

  // the freighter is a transport in transit: it cruises forward (+z) ~1 unit/sec while the arena center
  // itself stays put (no zone drift)
  const fAt = await page.evaluate(() => {
    const g = window.__game;
    g.launchMission(g.missionOffers.find((o) => o.type === 'freighter'));
    // the freighter is the set-piece at the freighter mission's center
    const c = g.arenaCenter;
    const f = g.setPieces.find((sp) => Math.abs(sp.obj.position.x - c.x) < 1.5 && Math.abs(sp.obj.position.z - c.z) < 1.5);
    return { cz: c.z, fz: f.obj.position.z, idx: g.setPieces.indexOf(f) };
  });
  await page.waitForTimeout(900);
  const after = await page.evaluate((idx) => ({ cz: window.__game.arenaCenter.z, fz: window.__game.setPieces[idx].obj.position.z }), fAt.idx);
  assert.equal(fAt.cz, after.cz, 'the combat zone does not drift (arena center stays put)');
  assert.ok(after.fz - fAt.fz > 0.3, 'the freighter slowly cruises forward');
}
