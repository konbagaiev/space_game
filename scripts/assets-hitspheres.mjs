// assets:hitspheres — auto-fit a multi-sphere collision hitbox (~5-10 spheres) to each ship's real combat
// hull and write `hitSpheres`/`broadR` into that ship's `model:{}` block in server/src/catalog_seed.js.
//
// Fit = axial Z-slices (one sphere per slice, radius = the slice's cross-section half-extent) + up to 2
// lateral "wing" spheres for wide slices, capped at 10. Spheres live in the SAME group-local frame as
// userData.noseZ/tailZ — i.e. AFTER the runtime normalization in client/src/ship-factory.js (auto-scale to
// SHIP_MODEL_LEN, recenter, yaw). At collision time each sphere is transformed by mesh.matrixWorld and its
// radius scaled by mesh.scale.x (see client/src/collision.js). Padding HITSPHERE_PAD is baked into radii so
// the runtime stays a plain distance test.
//
// The combat glbs are meshopt-compressed; reading them via NodeIO needs a decoder we don't ship, so we
// first decode each to a plain temp glb with the gltf-transform CLI via npx (same "no hard dep" pattern as
// assets-build.mjs), then read that with NodeIO + ALL_EXTENSIONS. Run after `npm run assets:pull` (combat
// glbs must be present locally). See docs/plans/ship-model-pipeline.md. Run: `npm run assets:hitspheres`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { SHIPS } from '../server/src/catalog_seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SEED = path.join(REPO, 'server/src/catalog_seed.js');
const SHIPS_DIR = path.join(REPO, 'client/assets/ships');

const SHIP_MODEL_LEN = 3.4; // mirror client/src/ship-factory.js:32 (normalize the model's longest axis)
const HITSPHERE_PAD = 1.1;  // global radius inflate (kept close to the old generous single-sphere bubble)
const BANDS = 6;            // axial slices along the ship's longest horizontal axis
const MAX_SPHERES = 10;     // hard cap (axial + wing)
// Cap each axial sphere so its centre-distance-from-origin + radius can't shoot far past the hull's
// half-length: r ≤ (Lhalf − |offset along the long axis|) + AXIAL_MARGIN. This is the fix for the
// "one giant round bubble" — a slice sized to the full wingspan used to bulge radius-far in every
// direction; the cap keeps spheres hull-shaped and bounds broadR to ~Lhalf.
const AXIAL_MARGIN = 0.35;
const DEBUG = !!process.env.HITSPHERES_DEBUG; // print normalized bounds + emitted radii per ship
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---- column-major 4x4 helpers (avoids a `three` install; matches glb node matrices) ----
function mul(a, b) { // a * b
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const xform = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Recurse a glb node tree, accumulating parent matrices, pushing world-space (x,y,z) into `out`.
function gatherVerts(node, parentM, out) {
  const m = mul(parentM, node.getMatrix());
  const mesh = node.getMesh && node.getMesh();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const tmp = [0, 0, 0];
      for (let i = 0, n = pos.getCount(); i < n; i++) {
        pos.getElement(i, tmp);
        const w = xform(m, tmp[0], tmp[1], tmp[2]);
        out.push(w[0], w[1], w[2]);
      }
    }
  }
  for (const c of node.listChildren()) gatherVerts(c, m, out);
}

// Normalize raw verts to the group-local noseZ frame, then fit a chain of spheres along the ship's
// LONGEST horizontal axis (spine) + up to 2 lateral wing spheres. Radii hug the perpendicular hull
// cross-section (never the full span of the long axis) and are capped so no sphere balloons past the
// hull. Returns { spheres, broadR, dbg }. See DECISIONS §45.
function fitSpheres(verts, yaw, scaleMul, name = '') {
  // raw AABB
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const sx = mxx - mnx, sy = mxy - mny, sz = mxz - mnz;
  const s = SHIP_MODEL_LEN / (Math.max(sx, sy, sz) || 1) * scaleMul;
  const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  // normalized verts: (v - center) * s, then rotateY(yaw) — matches ship-factory.js:45-56
  const N = new Array(verts.length);
  let Xh = 0, Yh = 0, Zh = 0;
  for (let i = 0; i < verts.length; i += 3) {
    const x = (verts[i] - cx) * s, y = (verts[i + 1] - cy) * s, z = (verts[i + 2] - cz) * s;
    const rx = x * cos + z * sin;
    const rz = -x * sin + z * cos;
    N[i] = rx; N[i + 1] = y; N[i + 2] = rz;
    if (Math.abs(rx) > Xh) Xh = Math.abs(rx);
    if (Math.abs(y) > Yh) Yh = Math.abs(y);
    if (Math.abs(rz) > Zh) Zh = Math.abs(rz);
  }

  // Slice along whichever horizontal axis is LONGER (X or Z); the OTHER horizontal axis + Y (vertical)
  // set each sphere's radius. Y is deliberately included (via the cross-section circumradius) so the
  // sphere still spans the full hull width in the bullet plane even when its centre sits off y=0.
  const lIsZ = Zh >= Xh;
  const lOf = (i) => (lIsZ ? N[i + 2] : N[i]);          // position along the long (spine) axis
  const pOf = (i) => (lIsZ ? N[i] : N[i + 2]);          // perpendicular horizontal
  const mk = (l, p, v, r) => (lIsZ                       // map (long, perp, vertical) → {x,y,z}
    ? { x: r3(p), y: r3(v), z: r3(l), r: r3(r) }
    : { x: r3(l), y: r3(v), z: r3(p), r: r3(r) });
  const Lhalf = lIsZ ? Zh : Xh;

  let lmin = Infinity, lmax = -Infinity;
  for (let i = 0; i < N.length; i += 3) { const l = lOf(i); if (l < lmin) lmin = l; if (l > lmax) lmax = l; }
  const lc = (lmin + lmax) / 2;
  const bw = (lmax - lmin) / BANDS || 1;

  const spheres = [];
  let widest = null; // widest wide band, for the wing pass
  for (let b = 0; b < BANDS; b++) {
    const lo = lmin + b * bw, hi = (b === BANDS - 1) ? lmax + 1e-6 : lmin + (b + 1) * bw;
    let pmin = Infinity, pmax = -Infinity, vmin = Infinity, vmax = -Infinity, cnt = 0;
    for (let i = 0; i < N.length; i += 3) {
      const l = lOf(i); if (l < lo || l >= hi) continue;
      const p = pOf(i), v = N[i + 1];
      if (p < pmin) pmin = p; if (p > pmax) pmax = p;
      if (v < vmin) vmin = v; if (v > vmax) vmax = v;
      cnt++;
    }
    if (!cnt) continue;
    const lmid = lmin + (b + 0.5) * bw;
    const pc = (pmin + pmax) / 2, vc = (vmin + vmax) / 2;
    const ph = (pmax - pmin) / 2, vh = (vmax - vmin) / 2;
    const rFull = Math.hypot(ph, vh) * HITSPHERE_PAD;      // hug the perpendicular cross-section
    const cap = Math.max(0.2, (Lhalf - Math.abs(lmid - lc)) + AXIAL_MARGIN); // don't bulge past the hull
    const r = Math.min(rFull, cap);
    if (r < 0.15) continue; // drop degenerate tip slivers
    spheres.push(mk(lmid, pc, vc, r));
    // remember the widest band that the capped axial sphere failed to cover laterally (wing candidate)
    if (rFull > cap + 0.15 && ph > 1.4 * vh && (!widest || ph > widest.ph)) {
      widest = { lmid, pc, vc, ph, vh, cap };
    }
  }

  // wing spheres: two thin lateral spheres reaching the wingtips the capped spine can't (radius ≈ wing
  // thickness so they don't inflate broadR). Placed just inside each perpendicular edge.
  if (widest && spheres.length + 2 <= MAX_SPHERES) {
    const wr = Math.min(widest.cap, Math.max(0.2, widest.vh) * HITSPHERE_PAD);
    const off = Math.max(0, widest.ph - wr);
    spheres.push(mk(widest.lmid, widest.pc + off, widest.vc, wr));
    spheres.push(mk(widest.lmid, widest.pc - off, widest.vc, wr));
  }

  let broadR = 0;
  for (const sp of spheres) broadR = Math.max(broadR, Math.hypot(sp.x, sp.y, sp.z) + sp.r);
  const dbg = { name, half: { X: r3(Xh), Y: r3(Yh), Z: r3(Zh) }, lAxis: lIsZ ? 'Z' : 'X', broadR: r3(broadR) };
  if (DEBUG) {
    console.log(`  [dbg] ${name}: normHalf X=${dbg.half.X} Y=${dbg.half.Y} Z=${dbg.half.Z}  long=${dbg.lAxis}  Lhalf=${r3(Lhalf)}`);
    console.log(`        radii ${spheres.map((s) => s.r).join(',')}  broadR=${dbg.broadR} (expect ≲ ${r3(Lhalf + AXIAL_MARGIN)})`);
  }
  return { spheres, broadR: r3(broadR), dbg };
}

// ---- surgical, idempotent seed edit (exported for the unit test) ----
// Insert/replace a marker-delimited span right after the ship's `model: {`. The span is self-delimiting,
// so we never brace-match the model block (which keeps the nested {x,y,z,r} objects safe).
export function upsertHitSpheres(fileText, modelUrl, spheres, broadR) {
  const anchor = fileText.indexOf(`modelUrl: '${modelUrl}'`);
  if (anchor < 0) throw new Error(`modelUrl not found in seed: ${modelUrl}`);
  const re = /model\s*:\s*\{/g; // `model:` (not `modelUrl:`/`modelUrlHigh:` — those have no `:` after `model`)
  re.lastIndex = anchor;
  const mm = re.exec(fileText);
  if (!mm) throw new Error(`model:{} block not found after ${modelUrl}`);
  const braceIdx = fileText.indexOf('{', mm.index);
  const arr = '[' + spheres.map((s) => `{x:${s.x},y:${s.y},z:${s.z},r:${s.r}}`).join(',') + ']';
  const span = `/* hitspheres:auto:start */ hitSpheres: ${arr}, broadR: ${broadR} /* hitspheres:auto:end */,`;
  const before = fileText.slice(0, braceIdx);
  const rest = fileText.slice(braceIdx);
  // consume `{`, any spaces, and any pre-existing span, then re-emit the span
  const replaced = rest.replace(
    /^\{[ \t]*(?:\/\* hitspheres:auto:start \*\/[\s\S]*?\/\* hitspheres:auto:end \*\/,[ \t]*)?/,
    () => `{ ${span} `,
  );
  return before + replaced;
}

// ---- main pipeline ----
async function decodeToPlain(io, srcFile, tmpDir) {
  const out = path.join(tmpDir, path.basename(srcFile));
  // `dedup` reads (decoding meshopt) and writes without re-encoding → a plain glb NodeIO can read.
  execFileSync('npx', ['--yes', '@gltf-transform/cli@^4', 'dedup', srcFile, out], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return io.read(out);
}

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitspheres-'));
  const original = fs.readFileSync(SEED, 'utf8');
  let text = original;
  const generated = []; // { url, spheres, broadR }

  const targets = SHIPS.filter((s) => s.modelUrl);
  for (const ship of targets) {
    const base = path.basename(ship.modelUrl);
    const file = path.join(SHIPS_DIR, base);
    if (!fs.existsSync(file)) {
      console.error(`\nMissing combat glb: ${file}\nRun \`npm run assets:pull\` first (combat glbs are gitignored).`);
      process.exit(1);
    }
    const yaw = ship.stats?.model?.yaw ?? 0;
    const scaleMul = ship.stats?.model?.scaleMul ?? 1;
    const doc = await decodeToPlain(io, file, tmpDir);
    const verts = [];
    for (const root of doc.getRoot().listScenes()[0].listChildren()) gatherVerts(root, IDENT, verts);
    const { spheres, broadR } = fitSpheres(verts, yaw, scaleMul, ship.name);
    text = upsertHitSpheres(text, ship.modelUrl, spheres, broadR);
    generated.push({ url: ship.modelUrl, name: ship.name, spheres, broadR });
    console.log(`  ${ship.name.padEnd(24)} ${String(spheres.length).padStart(2)} spheres  broadR ${broadR}`);
  }

  fs.writeFileSync(SEED, text);

  // round-trip verification: re-import the just-written seed and deep-compare every ship's values
  const mod = await import(`../server/src/catalog_seed.js?ts=${Date.now()}`);
  let ok = true;
  for (const g of generated) {
    const s = mod.SHIPS.find((x) => x.modelUrl === g.url);
    const got = s?.stats?.model;
    const want = { hitSpheres: g.spheres, broadR: g.broadR };
    if (JSON.stringify(got?.hitSpheres) !== JSON.stringify(want.hitSpheres) || got?.broadR !== want.broadR) {
      ok = false;
      console.error(`  MISMATCH ${g.name}: seed=${JSON.stringify({ hitSpheres: got?.hitSpheres, broadR: got?.broadR })}`);
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (!ok) {
    fs.writeFileSync(SEED, original); // restore — the edit produced values that don't round-trip
    console.error('\nRound-trip verification FAILED — seed restored to its original text.');
    process.exit(1);
  }
  console.log(`\nOK: ${generated.length} ships, seed round-trip verified.`);
}

// Run only as a script (not when imported by the unit test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
