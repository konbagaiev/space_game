// THE DIVERGENCE ORACLE: the browser and Node must simulate the same fight identically.
//
// Single-player runs the simulation in the tab and multiplayer will run it on the server, from ONE module
// (docs/plans/server-authoritative-sim.md D1). That is a claim, and a claim nobody checks becomes a slogan
// within months — the browser path atrophies, or a rule quietly grows a browser-only branch. So: replay the
// canonical Level-0 input trace in a real browser, replay it headlessly in Node through
// server/tools/sim-replay.mjs, and require the two to agree on
//   • a full-precision digest of the final World (sim-core/digest.js), and
//   • the number of seeded `simRandom()` draws consumed.
//
// The draw count is the one that names the culprit. A cosmetic path reaching into the gameplay stream
// (DECISIONS §73) shifts the browser's stream and not Node's; a state hash would just say "different",
// while a draw-count mismatch says "something drew from the seeded stream that should not have".
//
// This runs PLAIN `?playback` — no `&finish`. The auto-finish is browser-only machinery (it presses a button
// and fakes a "Return to base" click that the trace cannot carry, since a trace records keys and touch, not
// mouse), so it is not something a headless referee can or should reproduce. 22-trace-replay is the guard
// for the browser's end-to-end replay path; this one is the guard for the SIMULATION.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrace } from '../../../server/tools/sim-replay.mjs';

export const name = 'sim-divergence';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export default async function ({ page, assert, baseURL }) {
  const seedSrc = fs.readFileSync(path.join(repoRoot, 'server/src/catalog_seed.js'), 'utf8');
  const m = seedSrc.match(/introTrace:\s*'([^']+)'/);
  assert.ok(m, 'catalog_seed.js level-0 descriptor carries an introTrace');
  const tracePath = path.join(repoRoot, 'client', m[1]);
  assert.ok(fs.existsSync(tracePath),
    `intro trace missing: ${tracePath}\n  It is a gitignored S3 asset — run \`npm run assets:pull\` from the repo root.`);
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));

  // --- Node side ---
  const node = runTrace(trace);
  assert.ok(node.ticksRun > 0, 'the headless referee ran at least one tick');

  // --- Browser side: the same trace, same ticks, through the real engine ---
  await page.evaluate(([id, json]) => localStorage.setItem(`replay:${id}`, json),
    [trace.id, JSON.stringify(trace)]);
  const origin = new URL(baseURL).origin;
  await page.goto(`${origin}/?playback&id=${encodeURIComponent(trace.id)}&debug`, { waitUntil: 'load' });
  // The arm gate: the ship model must be resolved before the first tick, or the sim starts from a different
  // ship than the one the trace recorded.
  await page.waitForFunction('!!(window.__replay && window.__replay.status().armed)', null, { timeout: 30000 });

  // Step exactly as many ticks as Node did, in chunks so no single evaluate runs long. Node stops early on a
  // win or a death; the browser must reach the same tick with the same state.
  const browser = await page.evaluate(async (want) => {
    const r = window.__replay;
    while (r.status().playIndex < want && !r.status().playDone) r.step(Math.min(120, want - r.status().playIndex));
    return { ...r.digest(), index: r.status().playIndex, playDone: r.status().playDone };
  }, node.ticksRun);
  await page.evaluate((id) => localStorage.removeItem(`replay:${id}`), trace.id); // leave no cross-scenario state

  const fmt = (s) => Object.entries(s).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`      node   : ticks=${node.ticksRun}/${node.ticksTotal} hash=0x${node.hash.toString(16)} ${fmt(node.summary)}`);
  console.log(`      browser: ticks=${browser.index} hash=0x${browser.hash.toString(16)} ${fmt(browser.summary)}`);

  assert.equal(browser.index, node.ticksRun, 'both hosts stepped the same number of ticks');
  assert.equal(browser.draws, node.draws,
    `seeded RNG draws differ (browser ${browser.draws}, node ${node.draws}) — something drew from the gameplay stream on one host only (DECISIONS §73)`);
  assert.deepEqual(browser.summary, node.summary, 'the two hosts agree on the run summary');
  assert.equal(browser.hash, node.hash,
    `world digests differ (browser 0x${browser.hash.toString(16)}, node 0x${node.hash.toString(16)}) — the browser and the headless referee simulated different fights`);
}
