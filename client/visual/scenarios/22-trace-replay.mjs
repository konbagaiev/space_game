// THE CANONICAL LEVEL-0 TRACE MUST STILL RE-SIM TO A CLEARED, WON LEVEL.
//
// This is a DETERMINISM GUARD on a canned recording, not an intro guard — the intro itself is a live fight
// the player flies (docs/plans/2026-08-30-1654-playable-intro.md). The trace is an INPUT replay (recorded
// input + seed re-run through the real sim), so ANY change that shifts the seeded gameplay stream desyncs
// it — that shipped unnoticed three times (shield sphere / asteroid glb / flipbook FX) before this guard
// existed. Runs on its OWN url (the runner's base url has no ?playback), fast-stepped via __replay.step()
// — watching it in real time would take ~50 s.
//
// `&finish=1` is what produces the dock: a trace records keys and touch, never the MOUSE CLICK that ends a
// mission, so without it a cleared replay would orbit a quiet sector forever (replay.js stepReplayTick).
// `&debug` is kept for SPEED: it skips prewarmShaders (main.js — "very slow on the headless visual") and
// takes the procedural asteroid-field branch. Both are RENDER/DECOR only, and after DECISIONS §73 decor draws
// the native RNG, so ?debug is sim-neutral here. (It does NOT suppress playback: bootstrap branches on
// `rs.play` BEFORE the level-0 branch.) If a future change ever makes ?debug affect the SIM, drop the flag
// from this url — fidelity beats speed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'trace-replay';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export default async function ({ page, assert, shot, baseURL }) {
  // 1. Resolve the trace the SEED points at (so a seed/asset mismatch fails here, not in prod).
  const seedSrc = fs.readFileSync(path.join(repoRoot, 'server/src/catalog_seed.js'), 'utf8');
  const m = seedSrc.match(/introTrace:\s*'([^']+)'/);
  assert.ok(m, 'catalog_seed.js level-0 descriptor carries an introTrace');
  const tracePath = path.join(repoRoot, 'client', m[1]);
  assert.ok(fs.existsSync(tracePath),
    `canonical Level-0 trace missing: ${tracePath}\n  It is a gitignored S3 asset — run \`npm run assets:pull\` from the repo root.`);
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));

  // 2. loadTrace() checks localStorage `replay:{id}` first; the server does NOT serve /recordings/{id}.json
  //    (the asset is content-hash-named under /assets/recordings/), so seed it there. Same origin as the
  //    page the runner already opened → the value survives the goto below.
  await page.evaluate(([id, json]) => localStorage.setItem(`replay:${id}`, json),
    [trace.id, JSON.stringify(trace)]);

  const origin = new URL(baseURL).origin;
  await page.goto(`${origin}/?playback&id=${encodeURIComponent(trace.id)}&finish=1&debug`, { waitUntil: 'load' });
  // 3. Wait for the ARM gate: the ship .glb sets noseZ/tailZ (bullet spawn point) → stepping earlier
  //    would change the sim.
  await page.waitForFunction('!!(window.__replay && window.__replay.status().armed)', null, { timeout: 30000 });

  // 4. Fast-step the whole replay. Chunked so no single evaluate runs long.
  //    THREE terminal states, all of which must end the loop:
  //      won      — the healthy one (fight cleared → &finish pressed the button → autopilot docked)
  //      done     — the session ended (the win, or the return-home watchdog bailed out)
  //      playDone — the TRACE RAN OUT with the fight unfinished. This is the DOMINANT desync mode, and
  //                 step() returns instantly forever once it is set (the loop body is unreachable while
  //                 rs.done), so omitting it would hang here until the budget expires and report nothing.
  let out = null;
  for (let i = 0; i < 60 && !out; i++) {
    out = await page.evaluate(() => {
      const r = window.__replay;
      const over = () => { const p = r.play(); return p.won || p.done || r.status().playDone; };
      for (let n = 0; n < 20 && !over(); n++) r.step(60);
      if (!over()) return null;
      const p = r.play(), s = r.status();
      return { kills: r.state.G.kills, enemiesLeft: r.state.enemies.length,
               won: p.won, returning: p.returning, ended: p.done, playDone: s.playDone,
               tick: s.playIndex, total: s.total };
    });
  }
  await shot('final');
  assert.ok(out, 'the replay never reached a terminal state (won / ended / trace exhausted) — scenario or engine bug, not a desync');
  console.log(`      trace re-sim: kills=${out.kills} enemiesLeft=${out.enemiesLeft} returning=${out.returning} `
            + `won=${out.won} ended=${out.ended} playDone=${out.playDone} tick=${out.tick}/${out.total}`);
  assert.equal(out.kills, 4, `the re-sim killed ${out.kills}/4 enemies — the trace desynced from the sim`);
  assert.equal(out.won, true, 'the re-sim cleared the level and docked home (the &finish path)');

  await page.evaluate((id) => localStorage.removeItem(`replay:${id}`), trace.id); // leave no cross-scenario state
}
