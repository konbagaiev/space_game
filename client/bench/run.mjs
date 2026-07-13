// A/B perf-regression runner (docs/plans/2026-07-04-0949-perf-benchmark-replay.md, Component 5). NOT part of
// `npm test` — it forks Chromium + a server. Run: `cd client && npm run bench` (or `node bench/run.mjs`).
//
// What it does:
//   1. Starts ONE isolated API server (throwaway Postgres `spacegame_test`) — the game sim is client-side, so /api is only the
//      branch-agnostic catalog/accounts backend. Reuses visual/run.mjs's isolated-server pattern.
//   2. Serves TWO client builds over their own tiny static+proxy HTTP routes: A = merge-base build
//      (BENCH_A_DIR), B = worktree build (BENCH_B_DIR). Both proxy /api to the one API server. If neither env
//      var is set, A === B === this client (self-comparison noise-floor mode).
//   3. Launches ONE headless Chromium (swiftshader). If EITHER build lacks window.__bench, prints
//      "gate inactive (baseline predates bench harness)" and exits 0 (decision 3 — the expected path until the
//      first feature merges after the bench harness itself).
//   4. Replays every trace in traces/ on both builds, interleaved A,B,A,B,… (cancels thermal drift), under an
//      optional CDP CPU throttle, and compares the js.* buckets A vs B via stats.mjs. Exits non-zero on any
//      REGRESSION verdict.
//
// This is a CPU-only gate. GPU/fill-rate is out of scope (browsers don't expose it on mobile) — real-device
// ?dev telemetry covers that half. See the plan's "GPU blind spot" section + client/bench/README.md.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { analyzeMode, median, mean } from './stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..');
const serverDir = path.join(clientDir, '..', 'server');
const tracesDir = path.join(__dirname, 'traces');

const API_PORT = Number(process.env.BENCH_API_PORT || 4187);
const A_DIR = path.resolve(process.env.BENCH_A_DIR || clientDir); // merge-base build (defaults to this client)
const B_DIR = path.resolve(process.env.BENCH_B_DIR || clientDir); // worktree build
const REPS = Number(process.env.BENCH_REPS || 15);
const THROTTLE = Number(process.env.BENCH_THROTTLE || 4); // CDP CPU throttle multiplier (0 = off)

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
    if (req.url.startsWith('/api')) { // proxy to the branch-agnostic API server
      const proxy = http.request({ host: 'localhost', port: apiPort, path: req.url, method: req.method, headers: req.headers },
        (up) => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); });
      proxy.on('error', () => { res.writeHead(502).end('proxy error'); });
      req.pipe(proxy);
      return;
    }
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(dir, path.normalize(rel).replace(/^(\.\.[/\\])+/, '')); // strip traversal
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    readFile(file).then((buf) => {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    }).catch(() => { res.writeHead(404).end('not found'); });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ port: server.address().port, close: () => server.close() })));
}

// Load a build's page ONCE and get it ready. replay() is self-contained (re-seeds + reset()s + respawns), so
// each rep re-runs it on the SAME page — no reload. This is essential: navigating away right after a heavy
// replay wedges the software-GL context and stalls the next goto (see the plan's runner notes). Returns the
// ready page, or null when the build has no window.__bench (decision 3 → gate inactive).
async function loadBuild(browser, base, cdnCache, pageErrors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  // Cache the unpkg CDN modules (three.js) in memory so the two builds don't get rate-limited on load.
  await page.route('**://unpkg.com/**', async (route) => {
    const url = route.request().url();
    if (!cdnCache.has(url)) {
      try { const r = await fetch(url); cdnCache.set(url, { body: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') || 'text/javascript' }); }
      catch { return route.continue(); } // network hiccup → let the browser try directly
    }
    const c = cdnCache.get(url);
    await route.fulfill({ status: 200, contentType: c.ct, body: c.body });
  });
  await page.goto(`${base}/?bench=replay`, { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction('!!window.__bench', null, { timeout: 8000 }); } // decision 3 presence check
  catch { await page.close(); return null; }
  await page.waitForFunction('!!(window.__bench.ready && window.__bench.ready())', null, { timeout: 30000 }); // catalog + player built
  if (THROTTLE > 1) { try { const s = await page.context().newCDPSession(page); await s.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); } catch {} }
  return page;
}

const replay = (page, trace, mode) => page.evaluate(({ t, m }) => window.__bench.replay(t, { mode: m }), { t: trace, m: mode });

// Per-build accumulator: for each rep push the per-rep MEAN of each per-tick timing array (mean beats the
// 100µs performance.now() quantization; bucketVerdict takes the MEDIAN across reps for GC robustness — see
// stats.mjs) + the per-rep MEDIAN of each integer-ish load array.
function pushRep(acc, r) {
  for (const b of ['update', 'dom', 'render', 'total']) acc[b].push(mean(r.ticks[b]));
  for (const k of ['draws', 'tris', 'particles', 'enemies']) acc.load[k].push(median(r.loadTicks[k]));
  acc.hash.push(r.finalHash);
}
const emptyAcc = () => ({ update: [], dom: [], render: [], total: [], load: { draws: [], tris: [], particles: [], enemies: [] }, hash: [] });

async function main() {
  const server = spawn(process.execPath, ['src/server.js'],
    { cwd: serverDir, env: { ...process.env, PORT: String(API_PORT), DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost:5432/spacegame_test' }, stdio: 'ignore' });
  const stopServer = () => { try { server.kill('SIGTERM'); } catch {} };
  process.on('exit', stopServer);

  let browser, staticA, staticB;
  let exitCode = 0;
  try {
    await waitForHealth(API_PORT);
    staticA = await startStatic(A_DIR, API_PORT);
    staticB = await startStatic(B_DIR, API_PORT);
    const baseA = `http://localhost:${staticA.port}`;
    const baseB = `http://localhost:${staticB.port}`;
    console.log(`bench: A=${path.relative(process.cwd(), A_DIR) || '.'}  B=${path.relative(process.cwd(), B_DIR) || '.'}  (${REPS}×2 reps${THROTTLE > 1 ? `, ${THROTTLE}× throttle` : ''})`);

    browser = await chromium.launch({ headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const pageErrors = [];
    const cdnCache = new Map(); // shared unpkg (three.js) cache across both pages

    // Decision 3 — load BOTH builds once; missing __bench on either → gate inactive, exit 0.
    const pageA = await loadBuild(browser, baseA, cdnCache, pageErrors);
    const pageB = pageA ? await loadBuild(browser, baseB, cdnCache, pageErrors) : null;
    if (!pageA || !pageB) {
      console.log(`\ngate inactive (baseline predates bench harness) — build ${!pageA ? 'A' : 'B'} has no window.__bench; nothing to compare.`);
      return; // exitCode stays 0
    }

    const traceFiles = (await readdir(tracesDir)).filter((f) => f.endsWith('.json')).sort();
    if (!traceFiles.length) { console.log('no traces in bench/traces/ — run: node bench/gen-trace.mjs'); return; }

    let anyRegression = false;
    for (const file of traceFiles) {
      const trace = JSON.parse(await readFile(path.join(tracesDir, file), 'utf8'));
      for (const mode of ['full', 'sim']) {
        const A = emptyAcc(), B = emptyAcc();
        for (let rep = 0; rep < REPS; rep++) { // interleaved per round; A[i]/B[i] are a back-to-back PAIR (see stats.mjs paired CI)
          if (rep % 2 === 0) { pushRep(A, await replay(pageA, trace, mode)); pushRep(B, await replay(pageB, trace, mode)); }
          else { pushRep(B, await replay(pageB, trace, mode)); pushRep(A, await replay(pageA, trace, mode)); } // flip order → cancels within-pair ordering bias
        }
        // determinism self-check: every rep of a build must yield the same final state hash (seeded RNG +
        // fixed dt + identical inputs). Divergence = a hidden random source — a real bug. Fail loudly.
        for (const [label, acc] of [['A', A], ['B', B]]) {
          if (new Set(acc.hash).size > 1) { console.error(`NONDETERMINISM: build ${label} produced divergent state hashes across reps on ${trace.name} [${mode}] — a hidden random source is not seeded.`); anyRegression = true; }
        }
        const res = analyzeMode(trace.name, mode, A, B, { throttle: THROTTLE > 1 ? THROTTLE : 0 });
        console.log('\n' + res.report);
        if (res.regression) anyRegression = true;
      }
    }
    const newErrors = pageErrors.filter(Boolean);
    if (newErrors.length) console.log(`\n(page errors during bench:\n  ${newErrors.slice(0, 5).join('\n  ')})`);
    exitCode = anyRegression ? 1 : 0;
    console.log(`\nbench: ${anyRegression ? 'REGRESSION — see the per-bucket table above' : 'all traces FLAT/IMPROVED'} (exit ${exitCode})`);
  } finally {
    if (browser) await browser.close();
    if (staticA) staticA.close();
    if (staticB) staticB.close();
    stopServer();
  }
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
