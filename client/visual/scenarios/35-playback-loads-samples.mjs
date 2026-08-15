// A ?playback page must load the SAMPLED sfx even though NO user gesture ever lands on it.
//
// The regression this guards: sample preloading used to fire only from the gesture handler (or from
// bootstrap if a gesture had already happened). `?playback` is reached by NAVIGATION — the record page's
// "Play it ▶" link — so the replay auto-started with zero buffers and every shot fell back to its
// synthesized voice. Production never showed it: the intro cutscene opens on a "tap to begin" card, and
// that tap loaded the samples before the first tick. So the fight sounded right in the shipped cutscene and
// wrong the moment you replayed your own recording — which is exactly how it was reported.
//
// Asserted at the NETWORK layer on purpose: headless Chromium has no audio output, and the buffer cache is
// module-private. "Did the browser fetch the mp3s on a gesture-free playback page?" is the observable that
// actually distinguishes sampled from synth here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'playback-loads-samples';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export default async function ({ page, assert, baseURL }) {
  // Reuse the canonical intro trace the seed points at — same resolution as 22-intro-replay.
  const seedSrc = fs.readFileSync(path.join(repoRoot, 'server/src/catalog_seed.js'), 'utf8');
  const m = seedSrc.match(/introTrace:\s*'([^']+)'/);
  assert.ok(m, 'catalog_seed.js level-0 descriptor carries an introTrace');
  const tracePath = path.join(repoRoot, 'client', m[1]);
  assert.ok(fs.existsSync(tracePath),
    `intro trace missing: ${tracePath}\n  It is a gitignored S3 asset — run \`npm run assets:pull\` from the repo root.`);
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));

  // loadTrace() reads localStorage `replay:{id}` first (the server does not serve /recordings/{id}.json).
  await page.evaluate(([id, json]) => localStorage.setItem(`replay:${id}`, json),
    [trace.id, JSON.stringify(trace)]);

  const mp3 = new Set();
  const onResponse = (r) => { if (r.url().endsWith('.mp3') && r.status() === 200) mp3.add(r.url().split('/').pop()); };
  page.on('response', onResponse);
  try {
    const origin = new URL(baseURL).origin;
    // NO `&cutscene=1` — this is the bare replay page, the one with no tap-to-begin card. And deliberately
    // no click/keypress anywhere below: introducing a gesture would re-hide the bug this pins.
    await page.goto(`${origin}/?playback&id=${encodeURIComponent(trace.id)}&debug`, { waitUntil: 'load' });
    await page.waitForFunction('!!(window.__replay && window.__replay.status().armed)', null, { timeout: 30000 });
    // Step past the opening shots, then let the fetch/decode land.
    await page.evaluate(() => window.__replay.step(600));
    await page.waitForTimeout(3000);
  } finally {
    page.off('response', onResponse);
  }

  // The weapon-fire sounds are the ones the reporter heard as synth; assert those by name rather than a
  // bare count, so dropping a music track can't quietly satisfy this test.
  const loaded = [...mp3].join(', ') || '(none)';
  for (const key of ['kinetic', 'cannon', 'rocket']) {
    assert.ok([...mp3].some((f) => f.startsWith(`${key}.`)),
      `playback loaded no "${key}" sample without a gesture — sfx would fall back to synth. Loaded: ${loaded}`);
  }
}
