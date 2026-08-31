// Headless visual test runner (NOT part of CI — run manually, see README.md).
//
// What it does:
//   1. Starts its own game server on an isolated port + a throwaway Postgres DB (`spacegame_test`)
//      (so it never touches your real data; needs a local Postgres with `spacegame_test` — run
//      `cd server && npm test` once, or `createdb spacegame_test`, to create it).
//   2. Launches headless Chromium (software WebGL via swiftshader) and opens the game
//      with `?debug`, which exposes `window.__game` (see the hook in index.html).
//   3. Runs every scenario in scenarios/ (auto-discovered, alphabetical). An optional argv filter runs a
//      single one by (sub)name: `node visual/run.mjs 22-trace-replay`.
//   4. Each scenario asserts on SIMULATION STATE (counts, colors) — stable across machines —
//      and also saves PNG frames to __screenshots__/ for a human to eyeball.
//
// We deliberately do NOT diff pixels: software WebGL differs subtly between machines, so a
// pixel baseline would be flaky. Screenshots are artifacts for review, not pass/fail.
//
// Exit code is non-zero if any scenario fails. Run: `npm run test:visual` (from client/).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdir, mkdir, rm } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..');
const serverDir = path.join(clientDir, '..', 'server');
const shotsDir = path.join(__dirname, '__screenshots__');

const PORT = Number(process.env.VISUAL_PORT || 4173);
const BASE_URL = `http://localhost:${PORT}/?debug`;

// --- tiny helpers ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForHealth(timeoutMs = 15000) {
  const url = `http://localhost:${PORT}/api/health`;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => req.destroy());
    };
    const retry = () => (Date.now() > deadline ? reject(new Error('server health timeout')) : setTimeout(tick, 250));
    tick();
  });
}

async function main() {
  // fresh screenshots dir
  await rm(shotsDir, { recursive: true, force: true });
  await mkdir(shotsDir, { recursive: true });

  // 1. start an isolated server (throwaway Postgres DB `spacegame_test` so real data is untouched)
  const server = spawn(
    process.execPath,
    ['src/server.js'],
    { cwd: serverDir, env: { ...process.env, PORT: String(PORT), DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost:5432/spacegame_test' }, stdio: 'ignore' },
  );
  const stopServer = () => { try { server.kill('SIGTERM'); } catch {} };
  process.on('exit', stopServer);

  let browser;
  const results = [];
  try {
    await waitForHealth();

    // 2. launch headless Chromium with software WebGL
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    // 3. discover scenarios (an optional argv filter runs just one: `node visual/run.mjs 22-trace-replay`)
    const only = process.argv[2] || '';
    const files = (await readdir(path.join(__dirname, 'scenarios')))
      .filter((f) => f.endsWith('.mjs') && f.includes(only))
      .sort();

    // 4. run them across N pages.
    //
    // Scenarios are independent by construction — each one reloads the page for a clean slate — so the only
    // thing that made this sequential was that there was one page. Each worker gets its own page, its own
    // game and its own page-error list; the tab and the server are shared, which is what makes a worker
    // cheap. Concurrency is conservative by default because these scenarios wait on the SIMULATION reaching
    // states, and a machine under load turns those waits into timeouts (the suite has flaked that way all
    // day). `VISUAL_WORKERS=1` puts it back to one page if a failure needs to be read without interleaving.
    const WORKERS = Math.max(1, Number(process.env.VISUAL_WORKERS || 4));
    const queue = files.slice();
    const timings = [];

    const worker = async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
      const lines = [];   // buffered so one scenario's output is not interleaved with another's

      while (queue.length) {
        const file = queue.shift();
        const mod = await import(pathToFileURL(path.join(__dirname, 'scenarios', file)).href);
        const name = mod.name || file.replace(/\.mjs$/, '');
        const errBefore = pageErrors.length;
        const t0 = Date.now();
        // clean slate: a full reload resets all game state
        await page.goto(BASE_URL, { waitUntil: 'load' });
        // bootstrap() builds the player asynchronously after fetching the catalog from the API
        await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
        // dismiss the welcome screen and start the game (scenarios test the running game)
        await page.evaluate(() => {
          const w = document.getElementById('welcome');
          if (w && w.style.display !== 'none') document.getElementById('takeoff').click();
        });
        // The arena may not have an enemy yet. Level-0 — the level the throwaway player boots into for
        // EVERY scenario — now holds its first spawn until combatElapsed >= 3 s so the intro's opening line
        // can be read (spawn.earliest). Scenarios have always been handed a live arena, so reach that STATE
        // before handing the page over.
        //
        // We STEP THE SIM to it rather than waiting for real frames. Waiting works, but it costs ~5 s of
        // wall clock per scenario on the harness's ~6 fps software GL (the accumulator caps at 6 steps per
        // frame, so the sim clock runs BEHIND wall clock) — ~10-20 s each with four workers competing, which
        // pushed the boot past the 8 s gate above. `stepSim` runs the same fixed-dt update() with no
        // rendering, so it arrives at exactly the state the wait would have produced, in milliseconds.
        // A sleep would be wrong twice over: it is both flaky and measured on the wrong clock.
        await page.evaluate(() => {
          const g = window.__game;
          if (!g || !g.player || !g.gameStarted || g.levelRunner.won) return; // a menu or a finished fight
          let guard = 0;
          while (g.enemyCount === 0 && g.combatElapsed < 8 && guard++ < 1000) g.stepSim(1);
        });
        // …and a state wait as the safety net, for a boot slow enough that the fight had not started above.
        await page.waitForFunction(() => {
          const g = window.__game;
          if (!g || !g.player) return false;
          if (!g.gameStarted || g.levelRunner.won) return true; // a menu or a finished fight: nothing to wait for
          return g.enemyCount > 0;
        }, null, { timeout: 20000 }).catch(() => {});           // a scenario that legitimately never spawns proceeds
        // …and hand every scenario the ARENA rather than the intro's chrome (see __game.silenceIntro).
        // 44-playable-intro re-arms the director with its own page.goto.
        await page.evaluate(() => window.__game && window.__game.silenceIntro && window.__game.silenceIntro());
        const booted = Date.now();

        const shot = async (label) => {
          const p = path.join(shotsDir, `${name}__${label}.png`);
          await page.screenshot({ path: p });
          return p;
        };

        try {
          await mod.default({ page, assert, shot, baseURL: BASE_URL });
          const newErrors = pageErrors.slice(errBefore);
          assert.equal(newErrors.length, 0, `page errors during scenario:\n${newErrors.join('\n')}`);
          results.push({ name, ok: true });
          lines.push(`  ✓ ${name}`);
        } catch (err) {
          results.push({ name, ok: false, err });
          lines.push(`  ✗ ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`);
        }
        const done = Date.now();
        timings.push({ name, boot: booted - t0, body: done - booted });
        console.log(lines.pop());
      }
      await page.close();
    };

    const started = Date.now();
    await Promise.all(Array.from({ length: Math.min(WORKERS, files.length) }, worker));

    // Where the time went, so the next person to call this slow has numbers rather than an impression.
    const sum = (k) => timings.reduce((a, t) => a + t[k], 0);
    const slowest = [...timings].sort((a, b) => (b.boot + b.body) - (a.boot + a.body)).slice(0, 5);
    console.log(`\n  ${((Date.now() - started) / 1000).toFixed(0)}s wall on ${WORKERS} worker(s); `
      + `${(sum('boot') / 1000).toFixed(0)}s of it reloading the page, ${(sum('body') / 1000).toFixed(0)}s in scenarios`);
    console.log('  slowest: ' + slowest.map((t) => `${t.name} ${((t.boot + t.body) / 1000).toFixed(1)}s`).join(', '));
  } finally {
    if (browser) await browser.close();
    stopServer();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\nvisual: ${passed} passed, ${failed} failed  (frames in ${path.relative(clientDir, shotsDir)}/)`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
