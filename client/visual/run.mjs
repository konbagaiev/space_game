// Headless visual test runner (NOT part of CI — run manually, see README.md).
//
// What it does:
//   1. Starts its own game server on an isolated port + a throwaway Postgres DB (`spacegame_test`)
//      (so it never touches your real data; needs a local Postgres with `spacegame_test` — run
//      `cd server && npm test` once, or `createdb spacegame_test`, to create it).
//   2. Launches headless Chromium (software WebGL via swiftshader) and opens the game
//      with `?debug`, which exposes `window.__game` (see the hook in index.html).
//   3. Runs every scenario in scenarios/ (auto-discovered, alphabetical).
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

    // 3. discover scenarios
    const files = (await readdir(path.join(__dirname, 'scenarios')))
      .filter((f) => f.endsWith('.mjs'))
      .sort();

    for (const file of files) {
      const mod = await import(pathToFileURL(path.join(__dirname, 'scenarios', file)).href);
      const name = mod.name || file.replace(/\.mjs$/, '');
      const errBefore = pageErrors.length;
      // clean slate: a full reload resets all game state
      await page.goto(BASE_URL, { waitUntil: 'load' });
      // bootstrap() builds the player asynchronously after fetching the catalog from the API
      await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
      // dismiss the welcome screen and start the game (scenarios test the running game)
      await page.evaluate(() => {
        const w = document.getElementById('welcome');
        if (w && w.style.display !== 'none') document.getElementById('takeoff').click();
      });
      await page.waitForTimeout(150);

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
        console.log(`  ✓ ${name}`);
      } catch (err) {
        results.push({ name, ok: false, err });
        console.log(`  ✗ ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`);
      }
    }
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
