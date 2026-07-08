// Ghost-battle backdrop track generator — SECONDARY / bootstrap authoring path (the PRIMARY path is the
// in-game ?dev recorder, window.__backdrop; see docs/plans/2026-07-07-1606-backdrop-ghost-battle.md Step 4).
// NOT part of `npm test` — it forks Chromium + a server (exactly like bench/run.mjs). Regenerate with:
//   cd client && node bench/gen-backdrop.mjs   (or: npm run bench:backdrop)
//
// What it does:
//   1. Starts ONE isolated API server (throwaway SQLite) + one static server for THIS client dir, and
//      launches ONE headless Chromium (swiftshader) — reusing run.mjs's harness.
//   2. goto /?bench=replay, waits for window.__bench.ready(), calls window.__bench.bakeBackdrop(...) which
//      runs the REAL sim deterministically (seeded RNG + fixed dt) and dumps RAW per-keyframe ship + bullet
//      transforms (same shape the in-game recorder builds).
//   3. Runs the SHARED recenterAndQuantize() from src/ghost-battle-track.js (one source of truth — NOT a
//      re-implemented re-center/quantize here): re-centers every keyframe to the live-cast centroid so the
//      formation is bounded around origin, then quantizes to ints, then writes client/src/backdrop-battle.js.
//   Its synthetic output IS deterministic (seeded), but the CANONICAL committed track is a real in-game
//   recording; this just guarantees the repo is functional + CI-green before that recording exists.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { recenterAndQuantize } from '../src/ghost-battle-track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..');
const serverDir = path.join(clientDir, '..', 'server');
const OUT = path.join(clientDir, 'src', 'backdrop-battle.js');

const API_PORT = Number(process.env.BACKDROP_API_PORT || 4188);
const SECONDS = Number(process.env.BACKDROP_SECONDS || 15);
const FPS = Number(process.env.BACKDROP_FPS || 20);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };

function waitForHealth(port, timeoutMs = 15000) {
  const url = `http://localhost:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); if (res.statusCode === 200) return resolve(); retry(); });
      req.on('error', retry);
      req.setTimeout(1000, () => req.destroy());
    };
    const retry = () => (Date.now() > deadline ? reject(new Error('server health timeout')) : setTimeout(tick, 250));
    tick();
  });
}

// A tiny static file server for `dir` that proxies /api/* to the shared API server. Returns { port, close }.
function startStatic(dir, apiPort) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      const proxy = http.request({ host: 'localhost', port: apiPort, path: req.url, method: req.method, headers: req.headers },
        (up) => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); });
      proxy.on('error', () => { res.writeHead(502).end('proxy error'); });
      req.pipe(proxy);
      return;
    }
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(dir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    readFile(file).then((buf) => {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    }).catch(() => { res.writeHead(404).end('not found'); });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ port: server.address().port, close: () => server.close() })));
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `backdrop-bake-${process.pid}.db`);
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'],
    { cwd: serverDir, env: { ...process.env, PORT: String(API_PORT), DB_PATH: dbPath }, stdio: 'ignore' });
  const stopServer = () => { try { server.kill('SIGTERM'); } catch {} };
  process.on('exit', stopServer);

  let browser, staticSrv;
  try {
    await waitForHealth(API_PORT);
    staticSrv = await startStatic(clientDir, API_PORT);
    const base = `http://localhost:${staticSrv.port}`;
    browser = await chromium.launch({ headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    // Cache the unpkg CDN (three.js) in memory so a cold load isn't rate-limited.
    const cdnCache = new Map();
    await page.route('**://unpkg.com/**', async (route) => {
      const url = route.request().url();
      if (!cdnCache.has(url)) {
        try { const r = await fetch(url); cdnCache.set(url, { body: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') || 'text/javascript' }); }
        catch { return route.continue(); }
      }
      const c = cdnCache.get(url);
      await route.fulfill({ status: 200, contentType: c.ct, body: c.body });
    });
    await page.goto(`${base}/?bench=replay`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('!!(window.__bench && window.__bench.ready && window.__bench.ready())', null, { timeout: 30000 });
    const raw = await page.evaluate(({ seconds, fps }) => window.__bench.bakeBackdrop({ seconds, fps }), { seconds: SECONDS, fps: FPS });
    if (pageErrors.length) console.log(`(page errors during bake:\n  ${pageErrors.slice(0, 5).join('\n  ')})`);

    const track = recenterAndQuantize(raw); // SHARED helper (same as the in-game recorder) — one source of truth
    const out = `// GENERATED (synthetic bootstrap) by client/bench/gen-backdrop.mjs — do not edit by hand. Regenerate with:\n` +
      `//   cd client && node bench/gen-backdrop.mjs\n` +
      `// SECONDARY authoring path — the CANONICAL track is a real in-game ?dev recording (window.__backdrop).\n` +
      `// A committed transform-replay track for the freighter ghost battle (see\n` +
      `// docs/plans/2026-07-07-1606-backdrop-ghost-battle.md + DECISIONS §59).\n` +
      `export const BACKDROP_BATTLE = ${JSON.stringify(track)};\n`;
    await writeFile(OUT, out);
    const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
    const bulletTotal = track.bullets.x.length;
    console.log(`backdrop track written: ${path.relative(process.cwd(), OUT)}`);
    console.log(`  ships=${track.ships.length}  frames=${track.frames}  fps=${track.fps}  bullets(total)=${bulletTotal}  size=${kb} KB`);
  } finally {
    if (browser) await browser.close();
    if (staticSrv) staticSrv.close();
    stopServer();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
