// The Level-0 intro cutscene must still re-sim the canonical trace to a WIN. The intro is an INPUT replay
// (input + seed re-run through the real sim), so ANY change that shifts the seeded gameplay stream desyncs
// it — that shipped unnoticed three times (shield sphere / asteroid glb / flipbook FX) before this guard
// existed. Runs on its OWN url (the runner's base url has no ?playback), fast-stepped via __replay.step()
// — watching it in real time would take ~50 s.
// `&debug` is kept for SPEED: it skips prewarmShaders (main.js — "very slow on the headless visual") and
// takes the procedural asteroid-field branch. Both are RENDER/DECOR only, and after DECISIONS §73 decor draws
// the native RNG, so ?debug is sim-neutral here. (It does NOT suppress playback: bootstrap branches on
// `rs.play` BEFORE the `shouldPlayIntro` headless gate.) If a future change ever makes ?debug affect the SIM,
// drop the flag from this url — fidelity beats speed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'intro-replay';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export default async function ({ page, assert, shot, baseURL }) {
  // 1. Resolve the trace the SEED points at (so a seed/asset mismatch fails here, not in prod).
  const seedSrc = fs.readFileSync(path.join(repoRoot, 'server/src/catalog_seed.js'), 'utf8');
  const m = seedSrc.match(/introTrace:\s*'([^']+)'/);
  assert.ok(m, 'catalog_seed.js level-0 descriptor carries an introTrace');
  const tracePath = path.join(repoRoot, 'client', m[1]);
  assert.ok(fs.existsSync(tracePath),
    `intro trace missing: ${tracePath}\n  It is a gitignored S3 asset — run \`npm run assets:pull\` from the repo root.`);
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));

  // 2. loadTrace() checks localStorage `replay:{id}` first; the server does NOT serve /recordings/{id}.json
  //    (the asset is content-hash-named under /assets/recordings/), so seed it there. Same origin as the
  //    page the runner already opened → the value survives the goto below.
  await page.evaluate(([id, json]) => localStorage.setItem(`replay:${id}`, json),
    [trace.id, JSON.stringify(trace)]);

  const origin = new URL(baseURL).origin;
  await page.goto(`${origin}/?playback&id=${encodeURIComponent(trace.id)}&cutscene=1&debug`, { waitUntil: 'load' });
  // 3. Wait for the ARM gate: the ship .glb sets noseZ/tailZ (bullet spawn point) → stepping earlier
  //    would change the sim.
  await page.waitForFunction('!!(window.__replay && window.__replay.status().armed)', null, { timeout: 30000 });

  // 4. Fast-step the whole cutscene, auto-tapping each card. Chunked so no single evaluate runs long.
  //    THREE terminal states, all of which must end the loop:
  //      won      — the healthy one (fight cleared → autopilot docked → victory)
  //      done     — cutscene ended (win, Skip, or the return-home watchdog bailed out)
  //      playDone — the TRACE RAN OUT with the fight unfinished. This is the DOMINANT desync mode, and
  //                 step() returns instantly forever once it is set (the loop body is unreachable while
  //                 rs.done), so omitting it would hang here until the budget expires and report nothing.
  let out = null;
  for (let i = 0; i < 60 && !out; i++) {
    out = await page.evaluate(() => {
      const r = window.__replay;
      const over = () => { const c = r.cut(); return c.won || c.done || r.status().playDone; };
      for (let n = 0; n < 20 && !over(); n++) {
        if (r.cut().frozen) { r.advance(); continue; }   // dismiss the lower-third card
        r.step(60);
      }
      if (!over()) return null;
      const c = r.cut(), s = r.status();
      return { kills: r.state.G.kills, enemiesLeft: r.state.enemies.length, cards: c.fired,
               won: c.won, ended: c.done, playDone: s.playDone, tick: s.playIndex, total: s.total };
    });
  }
  await shot('final');
  assert.ok(out, 'the cutscene never reached a terminal state (won / ended / trace exhausted) — scenario or engine bug, not a desync');
  console.log(`      intro re-sim: kills=${out.kills} enemiesLeft=${out.enemiesLeft} cards=${out.cards.join('|')} `
            + `won=${out.won} ended=${out.ended} playDone=${out.playDone} tick=${out.tick}/${out.total}`);
  assert.equal(out.kills, 4, `intro re-sim killed ${out.kills}/4 enemies — the trace desynced from the sim`);
  assert.deepEqual(out.cards, ['p0', 'p1', 'p2', 'p3', 'p4'], 'all five cutscene cards fired in order');
  assert.equal(out.won, true, 'the intro re-sim cleared the level and docked home (finishIntro path)');

  await page.evaluate((id) => localStorage.removeItem(`replay:${id}`), trace.id); // leave no cross-scenario state
}
