// assets:materials — sample every material of a source model down to flat numbers, into
// `assets-src/<base>.materials.json` (the sidecar `assets-flatten.mjs` consumes at build time).
//
// Why a browser: the sidecar needs the AVERAGE colour of each material's maps, and those maps are
// jpeg/png/webp inside the glb. Rather than pull in an image-decoding dependency, this drives the
// headless Chromium that `client/` already has for the visual suite: three.js's GLTFLoader decodes the
// textures exactly the way the game does, and a canvas gives us the pixels.
//
// Per material it records:
//   color    — the base map's mean, averaged in LINEAR light and re-encoded to sRGB (a plain mean of
//              sRGB bytes biases dark; a ship averaged that way comes out muddy).
//   metal    — the metallic-roughness map's mean BLUE channel (glTF packs metalness there). Linear data,
//   rough    — ...and mean GREEN (roughness). Both plain means, no transfer function.
//   emissive — the emissive map's mean, only when it actually lights up. The source sets emissiveFactor
//              1,1,1 on materials whose glow lives entirely in the map, so carrying the factor alone
//              would turn the whole part into a white light.
//   spread   — how much colour variation the base map really carries: the distance from the material's
//              mean colour of its most-deviant 5% of texels (0-255). This is what decides whether
//              averaging is lossless for that material or throws away a paint job — see the
//              `keepTexturedAbove` threshold in assets-flatten.mjs.
//
// Re-run whenever a source model changes. Run: `npm run assets:materials -- <base> [<base>...]`
// (no argument = every source model that a preset asks to flatten).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DIR, presetFor } from './assets-config.mjs';
import { sidecarPath } from './assets-flatten.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE_CDN = 'https://unpkg.com/three@0.160.0'; // keep in step with client/index.html's importmap

const PAGE = (src) => `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_CDN}/build/three.module.js","three/addons/":"${THREE_CDN}/examples/jsm/"}}</script>
</head><body><script type="module">
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const gltf = await new Promise((res, rej) => new GLTFLoader().load('${src}', res, undefined, rej));
const S = 64; // sampling grid; the maps are 512-2k, a 64x64 resample is plenty for a mean
const texels = (img) => {
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S).data, out = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 8) out.push([d[i], d[i + 1], d[i + 2]]);
  return out;
};
const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const srgbMean = (p) => [0, 1, 2].map((k) => +l2s(p.reduce((s, q) => s + s2l(q[k] / 255), 0) / p.length).toFixed(4));
const linMean = (p, k) => +(p.reduce((s, q) => s + q[k], 0) / p.length / 255).toFixed(4);
const spread = (p) => {
  const m = [0, 1, 2].map((k) => p.reduce((s, q) => s + q[k], 0) / p.length);
  const far = p.map((q) => Math.hypot(q[0] - m[0], q[1] - m[1], q[2] - m[2])).sort((a, b) => b - a);
  return +far[Math.floor(far.length * 0.05)].toFixed(1);
};
const out = {};
gltf.scene.traverse((n) => {
  if (!n.isMesh || out[n.material.name]) return;
  const m = n.material;
  const base = m.map?.image ? texels(m.map.image) : null;
  const mr = m.metalnessMap?.image ? texels(m.metalnessMap.image) : null;
  const em = m.emissiveMap?.image ? texels(m.emissiveMap.image) : null;
  const emissive = em ? srgbMean(em) : [m.emissive.r, m.emissive.g, m.emissive.b].map((v) => +v.toFixed(4));
  out[m.name] = {
    color: base ? srgbMean(base) : [m.color.r, m.color.g, m.color.b].map((v) => +v.toFixed(4)),
    metal: mr ? linMean(mr, 2) : +m.metalness.toFixed(4),
    rough: mr ? linMean(mr, 1) : +m.roughness.toFixed(4),
    spread: base ? spread(base) : 0,
    ...(emissive.some((v) => v > 0.01) ? { emissive } : {}),
  };
});
window.__materials = out; document.title = 'ready';
</script></body></html>`;

// Serve ROOT over http so the module importmap + GLTFLoader work (file:// blocks both).
function serve(port) {
  const mime = { '.html': 'text/html', '.glb': 'model/gltf-binary', '.js': 'text/javascript' };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/__sample.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(srv.page); }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  srv.listen(port);
  return srv;
}

async function sample(chromium, srv, base) {
  const src = path.join(DIR.src, `${base}.glb`);
  if (!fs.existsSync(src)) throw new Error(`No source model at ${src}`);
  srv.page = PAGE(`/${DIR.src}/${base}.glb`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${srv.address().port}/__sample.html`);
    await page.waitForFunction(() => window.__materials, null, { timeout: 120000 });
    const materials = await page.evaluate(() => window.__materials);
    if (errors.length) throw new Error(errors[0]);
    const out = sidecarPath(src);
    fs.writeFileSync(out, JSON.stringify(materials, null, 1) + '\n');
    const n = Object.keys(materials).length;
    const varied = Object.values(materials).filter((m) => m.spread >= 34).length;
    console.log(`${base}: sampled ${n} materials -> ${out}  (${varied} carry real colour variation, ${n - varied} flatten losslessly)`);
  } finally {
    await browser.close();
  }
}

async function main() {
  let bases = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (!bases.length) {
    // default: every source a preset asks to flatten
    bases = fs.readdirSync(DIR.src).filter((f) => f.endsWith('.glb'))
      .map((f) => path.basename(f, '.glb'))
      .filter((b) => presetFor(b, 'combat').flattenMaterials);
    if (!bases.length) { console.error('No source model has `flattenMaterials` in its combat preset — pass a base name explicitly.'); process.exit(1); }
  }
  // playwright lives in client/ (the visual suite's dep) — reuse it rather than adding a root dependency.
  const clientModules = path.join(ROOT, 'client', 'node_modules');
  if (!fs.existsSync(path.join(clientModules, 'playwright'))) {
    console.error('playwright not installed — run `npm install` in client/ first.');
    process.exit(1);
  }
  // playwright ships CommonJS, so an absolute-path dynamic import lands the exports on `.default`.
  const pw = await import(pathToFileURL(path.join(clientModules, 'playwright', 'index.js')).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) { console.error('playwright loaded but exposes no chromium export.'); process.exit(1); }
  const srv = serve(0);
  try {
    for (const b of bases) await sample(chromium, srv, b);
  } finally {
    srv.close();
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });