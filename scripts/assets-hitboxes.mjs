// assets:hitboxes — auto-fit an oriented-bounding-box (OBB) collision hitbox to each ship's real combat
// hull and write `hitBoxes`/`broadR` into that ship's `model:{}` block in server/src/catalog_seed.js.
//
// Fit = V-HACD convex decomposition (one near-convex part per wing/fuselage) → one PCA oriented box per
// part. Boxes live in the SAME group-local frame as userData.noseZ/tailZ — i.e. AFTER the runtime
// normalization in client/src/ship-factory.js (auto-scale to SHIP_MODEL_LEN, recenter, yaw). At collision
// time each box is transformed by mesh.matrixWorld and its half-extents scaled by mesh.scale.x (see
// client/src/collision.js). A tiny additive HITBOX_MARGIN is baked into the half-extents for surface-hit
// reliability; the boxes are meant to be TIGHT (bullets miss in the gap beyond a wing). See DECISIONS §45.
//
// MEMORY SAFETY (HARD requirement — a prior spike OOM-froze the maintainer's Mac): the V-HACD options cap
// `voxelResolution: 100000` (≤100k) and `maxHulls: 16`, plus `maxVerticesPerHull: 32`. These caps are
// non-negotiable — do NOT raise them. No unbounded voxel/distance/recursion work.
//
// The combat glbs are meshopt-compressed; reading them via NodeIO needs a decoder we don't ship, so we
// first decode each to a plain temp glb with the gltf-transform CLI via npx (same "no hard dep" pattern as
// assets-build.mjs), then read that with NodeIO + ALL_EXTENSIONS. Run after `npm run assets:pull` (combat
// glbs must be present locally). See docs/plans/ship-model-pipeline.md. Run: `npm run assets:hitboxes`.
//
// vhacd-js is a build-time-only dep (never shipped to the browser). It has no `main`/`exports`, only
// `"module"`, so we import the subpath `vhacd-js/lib/vhacd.js`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { ConvexMeshDecomposition } from 'vhacd-js/lib/vhacd.js';
import { SHIPS } from '../server/src/catalog_seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SEED = path.join(REPO, 'server/src/catalog_seed.js');
const SHIPS_DIR = path.join(REPO, 'client/assets/ships');

const SHIP_MODEL_LEN = 3.4; // mirror client/src/ship-factory.js:34 (normalize the model's longest axis)
const HITBOX_MARGIN = 0.05; // tiny additive half-extent inflate (group-local units, ~1.5% of length) for surface hits
// V-HACD options — the caps here are the MEMORY GUARD (see the header). Do not raise them.
const VHACD_OPTS = {
  maxHulls: 16,             // ≤ 16 parts
  voxelResolution: 100000,  // ≤ 100k voxels
  fillMode: 'raycast',      // combat glbs are non-watertight → raycast interior test (no repair needed)
  maxVerticesPerHull: 32,
  minVolumePercentError: 1,
  messages: 'none',
};
const DEBUG = !!process.env.HITBOXES_DEBUG; // print per-ship box extents/union span
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

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

// Recurse a glb node tree, accumulating parent matrices, pushing world-space positions + triangle indices
// into `out = { pos: [], idx: [] }`. V-HACD needs triangles, so we carry indices (offset by the running
// vertex base per primitive); un-indexed prims emit sequential triples.
function gatherMesh(node, parentM, out) {
  const m = mul(parentM, node.getMatrix());
  const mesh = node.getMesh && node.getMesh();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const base = out.pos.length / 3;
      const tmp = [0, 0, 0];
      const count = pos.getCount();
      for (let i = 0; i < count; i++) {
        pos.getElement(i, tmp);
        const w = xform(m, tmp[0], tmp[1], tmp[2]);
        out.pos.push(w[0], w[1], w[2]);
      }
      const idx = prim.getIndices();
      if (idx) {
        for (let i = 0, n = idx.getCount(); i < n; i++) out.idx.push(base + idx.getScalar(i));
      } else {
        for (let i = 0; i < count; i++) out.idx.push(base + i);
      }
    }
  }
  for (const c of node.listChildren()) gatherMesh(c, m, out);
}

// Normalize raw (pos, idx) to the group-local noseZ frame — mirrors ship-factory.js:44-58 (auto-scale the
// longest axis to SHIP_MODEL_LEN, recenter, rotateY(yaw)). Returns { positions:Float64Array, indices:Uint32Array }.
function normalize(pos, idx, yaw, scaleMul) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const sx = mxx - mnx, sy = mxy - mny, sz = mxz - mnz;
  const s = SHIP_MODEL_LEN / (Math.max(sx, sy, sz) || 1) * scaleMul;
  const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const positions = new Float64Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = (pos[i] - cx) * s, y = (pos[i + 1] - cy) * s, z = (pos[i + 2] - cz) * s;
    positions[i] = x * cos + z * sin;   // rotateY(yaw)
    positions[i + 1] = y;
    positions[i + 2] = -x * sin + z * cos;
  }
  return { positions, indices: Uint32Array.from(idx) };
}

// ---- symmetric 3×3 eigen-decomposition (Jacobi rotation) ----
// Returns { vecs:[[x,y,z],...] (columns), vals:[l0,l1,l2] }. Deterministic → idempotent seed output.
function jacobiEigen(a) {
  // a: symmetric 3×3 as [[a00,a01,a02],[a01,a11,a12],[a02,a12,a22]] (we mutate a copy)
  const A = [a[0].slice(), a[1].slice(), a[2].slice()];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep++) {
    // largest off-diagonal
    let off = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
    if (off < 1e-10) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = A[p][q];
      if (Math.abs(apq) < 1e-14) continue;
      const app = A[p][p], aqq = A[q][q];
      const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
      const c = Math.cos(phi), sn = Math.sin(phi);
      // rotate A: A = Rᵀ A R
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - sn * akq;
        A[k][q] = sn * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - sn * aqk;
        A[q][k] = sn * apk + c * aqk;
      }
      // accumulate V
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - sn * vkq;
        V[k][q] = sn * vkp + c * vkq;
      }
    }
  }
  return {
    vecs: [[V[0][0], V[1][0], V[2][0]], [V[0][1], V[1][1], V[2][1]], [V[0][2], V[1][2], V[2][2]]],
    vals: [A[0][0], A[1][1], A[2][2]],
  };
}

// Fit a PCA oriented bounding box to a hull's vertex cloud (Float64Array xyz triplets).
// Returns { c:{x,y,z}, h:{x,y,z}, u0, u1, u2 }, canonicalized (axes by descending half-extent, sign-fixed).
function fitOBB(hp) {
  const n = hp.length / 3;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < hp.length; i += 3) { mx += hp[i]; my += hp[i + 1]; mz += hp[i + 2]; }
  mx /= n; my /= n; mz /= n;
  // symmetric covariance
  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (let i = 0; i < hp.length; i += 3) {
    const dx = hp[i] - mx, dy = hp[i + 1] - my, dz = hp[i + 2] - mz;
    cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
    cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
  }
  const cov = [[cxx / n, cxy / n, cxz / n], [cxy / n, cyy / n, cyz / n], [cxz / n, cyz / n, czz / n]];
  const { vecs } = jacobiEigen(cov);
  // normalize each axis
  const axes = vecs.map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  });
  // project verts onto each axis → [min,max]
  const proj = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
  for (let i = 0; i < hp.length; i += 3) {
    const dx = hp[i] - mx, dy = hp[i + 1] - my, dz = hp[i + 2] - mz;
    for (let a = 0; a < 3; a++) {
      const d = dx * axes[a][0] + dy * axes[a][1] + dz * axes[a][2];
      if (d < proj[a][0]) proj[a][0] = d;
      if (d > proj[a][1]) proj[a][1] = d;
    }
  }
  // half-extents + center offset along each axis
  const triples = [];
  for (let a = 0; a < 3; a++) {
    const [lo, hi] = proj[a];
    const half = (hi - lo) / 2 + HITBOX_MARGIN;
    const mid = (lo + hi) / 2;
    triples.push({ axis: axes[a], half, mid });
  }
  // canonicalize: sort by descending half-extent, flip each axis so its largest-|component| is ≥ 0
  triples.sort((a, b) => b.half - a.half);
  let cX = mx, cY = my, cZ = mz;
  const out = [];
  for (const t of triples) {
    let ax = t.axis;
    // flip sign so the largest-magnitude component is ≥ 0 (deterministic)
    let mi = 0, mv = Math.abs(ax[0]);
    if (Math.abs(ax[1]) > mv) { mi = 1; mv = Math.abs(ax[1]); }
    if (Math.abs(ax[2]) > mv) { mi = 2; mv = Math.abs(ax[2]); }
    if (ax[mi] < 0) ax = [-ax[0], -ax[1], -ax[2]];
    cX += t.mid * ax[0]; cY += t.mid * ax[1]; cZ += t.mid * ax[2];
    out.push({ axis: ax, half: t.half });
  }
  return {
    c: { x: r3(cX), y: r3(cY), z: r3(cZ) },
    h: { x: r3(out[0].half), y: r3(out[1].half), z: r3(out[2].half) },
    u0: { x: r4(out[0].axis[0]), y: r4(out[0].axis[1]), z: r4(out[0].axis[2]) },
    u1: { x: r4(out[1].axis[0]), y: r4(out[1].axis[1]), z: r4(out[1].axis[2]) },
    u2: { x: r4(out[2].axis[0]), y: r4(out[2].axis[1]), z: r4(out[2].axis[2]) },
  };
}

// Exact enclosing radius: the farthest of every box's 8 corners from the group origin.
function computeBroadR(boxes) {
  let br = 0;
  for (const b of boxes) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const x = b.c.x + sx * b.h.x * b.u0.x + sy * b.h.y * b.u1.x + sz * b.h.z * b.u2.x;
      const y = b.c.y + sx * b.h.x * b.u0.y + sy * b.h.y * b.u1.y + sz * b.h.z * b.u2.y;
      const z = b.c.z + sx * b.h.x * b.u0.z + sy * b.h.y * b.u1.z + sz * b.h.z * b.u2.z;
      br = Math.max(br, Math.hypot(x, y, z));
    }
  }
  return r3(br);
}

// ---- surgical, idempotent seed edit (exported for the unit test) ----
// Insert/replace a marker-delimited span right after the ship's `model: {`. The span is self-delimiting, so
// we never brace-match the model block (which keeps the nested {x,y,z} objects safe). Consumes an optional
// existing hitboxes span OR a legacy hitspheres span → one run migrates the seed off hitSpheres cleanly.
export function upsertHitBoxes(fileText, modelUrl, boxes, broadR) {
  const anchor = fileText.indexOf(`modelUrl: '${modelUrl}'`);
  if (anchor < 0) throw new Error(`modelUrl not found in seed: ${modelUrl}`);
  const re = /model\s*:\s*\{/g; // `model:` (not `modelUrl:`/`modelUrlHigh:` — those have no `:` after `model`)
  re.lastIndex = anchor;
  const mm = re.exec(fileText);
  if (!mm) throw new Error(`model:{} block not found after ${modelUrl}`);
  const braceIdx = fileText.indexOf('{', mm.index);
  const v = (o) => `{x:${o.x},y:${o.y},z:${o.z}}`;
  const arr = '[' + boxes.map((b) =>
    `{c:${v(b.c)},h:${v(b.h)},u0:${v(b.u0)},u1:${v(b.u1)},u2:${v(b.u2)}}`).join(',') + ']';
  const span = `/* hitboxes:auto:start */ hitBoxes: ${arr}, broadR: ${broadR} /* hitboxes:auto:end */,`;
  const before = fileText.slice(0, braceIdx);
  const rest = fileText.slice(braceIdx);
  // consume `{`, any spaces, and any pre-existing hitboxes OR legacy hitspheres span, then re-emit the span
  const replaced = rest.replace(
    /^\{[ \t]*(?:\/\* hit(?:boxes|spheres):auto:start \*\/[\s\S]*?\/\* hit(?:boxes|spheres):auto:end \*\/,[ \t]*)?/,
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitboxes-'));
  const original = fs.readFileSync(SEED, 'utf8');
  let text = original;
  const generated = []; // { url, name, boxes, broadR }

  const dec = await ConvexMeshDecomposition.create(); // create once, reuse across ships

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
    const raw = { pos: [], idx: [] };
    for (const root of doc.getRoot().listScenes()[0].listChildren()) gatherMesh(root, IDENT, raw);
    const { positions, indices } = normalize(raw.pos, raw.idx, yaw, scaleMul);

    const hulls = dec.computeConvexHulls({ positions, indices }, VHACD_OPTS);
    const boxes = hulls.map((hull) => fitOBB(hull.positions));
    const broadR = computeBroadR(boxes);

    text = upsertHitBoxes(text, ship.modelUrl, boxes, broadR);
    generated.push({ url: ship.modelUrl, name: ship.name, boxes, broadR });

    if (DEBUG) {
      // union full span along the longest of the three group axes
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const b of boxes) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const p = [
          b.c.x + sx * b.h.x * b.u0.x + sy * b.h.y * b.u1.x + sz * b.h.z * b.u2.x,
          b.c.y + sx * b.h.x * b.u0.y + sy * b.h.y * b.u1.y + sz * b.h.z * b.u2.y,
          b.c.z + sx * b.h.x * b.u0.z + sy * b.h.y * b.u1.z + sz * b.h.z * b.u2.z,
        ];
        for (let a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; }
      }
      const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
      console.log(`  [dbg] ${ship.name}: ${boxes.length} boxes  broadR ${broadR}  union span ${r3(span)}`);
    }
    console.log(`  ${ship.name.padEnd(24)} ${String(boxes.length).padStart(2)} boxes  broadR ${broadR}`);
  }

  fs.writeFileSync(SEED, text);

  // round-trip verification: re-import the just-written seed and deep-compare every ship's values
  const mod = await import(`../server/src/catalog_seed.js?ts=${Date.now()}`);
  let ok = true;
  for (const g of generated) {
    const s = mod.SHIPS.find((x) => x.modelUrl === g.url);
    const got = s?.stats?.model;
    if (JSON.stringify(got?.hitBoxes) !== JSON.stringify(g.boxes) || got?.broadR !== g.broadR) {
      ok = false;
      console.error(`  MISMATCH ${g.name}: seed=${JSON.stringify({ hitBoxes: got?.hitBoxes, broadR: got?.broadR })}`);
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
