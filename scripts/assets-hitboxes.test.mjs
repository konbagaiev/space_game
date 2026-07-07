// Unit tests for the surgical seed edit in assets-hitboxes.mjs + scale-sanity guards on the generated OBBs.
// Exercises upsertHitBoxes on a small fixture with two model:{} blocks + inline comments (insert, migration
// off the legacy hitspheres span, idempotency, re-parse), and asserts every modeled ship's fit is hull-scale
// (never a 2×-inflated bubble). Run: node --test scripts/assets-hitboxes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { upsertHitBoxes, decodeToPlain, gatherMesh, normalize, IDENT, planeCoverage, bestLift } from './assets-hitboxes.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIPS_DIR = path.join(REPO, 'client/assets/ships');

const FIXTURE = `export const SHIPS = [
  {
    name: 'A', modelUrl: 'assets/ships/a.glb', modelUrlHigh: 'https://x/a_hangar.glb',
    stats: {
      role: 'player',
      // presentation: yaw/scale, tuned by eye
      model: { yaw: 0, scale: 1.1 }, // trailing comment stays
      groups: {},
    },
  },
  {
    name: 'B', modelUrl: 'assets/ships/b.glb',
    stats: {
      model: { yaw: Math.PI, scale: 2 },
    },
  },
];
`;

const V = (x, y, z) => ({ x, y, z });
const A = [
  { c: V(0, 0.1, -0.9), h: V(0.4, 0.3, 0.6), u0: V(1, 0, 0), u1: V(0, 1, 0), u2: V(0, 0, 1) },
  { c: V(1.02, 0, -0.5), h: V(0.3, 0.2, 0.2), u0: V(0, 0, 1), u1: V(0, 1, 0), u2: V(1, 0, 0) },
];
const B = [{ c: V(0, 0, 0), h: V(0.8, 0.5, 0.5), u0: V(1, 0, 0), u1: V(0, 1, 0), u2: V(0, 0, 1) }];

test('inserts the marker span and preserves surrounding keys + comments', () => {
  const t = upsertHitBoxes(FIXTURE, 'assets/ships/a.glb', A, 2.1);
  assert.match(t, /\/\* hitboxes:auto:start \*\/ hitBoxes: \[.*\], broadR: 2.1 \/\* hitboxes:auto:end \*\/,/);
  assert.match(t, /\{c:\{x:0,y:0.1,z:-0.9\},h:\{x:0.4,y:0.3,z:0.6\},u0:\{x:1,y:0,z:0\},u1:\{x:0,y:1,z:0\},u2:\{x:0,y:0,z:1\}\}/);
  // the ship's original keys + comments are intact
  assert.match(t, /yaw: 0, scale: 1.1 \}, \/\/ trailing comment stays/);
  assert.match(t, /\/\/ presentation: yaw\/scale, tuned by eye/);
  // only ship A touched — B's block is byte-identical to the fixture
  assert.ok(t.includes(`model: { yaw: Math.PI, scale: 2 },`));
});

test('running twice yields an identical string (idempotent)', () => {
  const once = upsertHitBoxes(FIXTURE, 'assets/ships/a.glb', A, 2.1);
  const twice = upsertHitBoxes(once, 'assets/ships/a.glb', A, 2.1);
  assert.equal(twice, once);
});

test('migrates a legacy hitspheres span → only the hitboxes span remains', () => {
  const legacy = FIXTURE.replace(
    `model: { yaw: 0, scale: 1.1 }`,
    `model: { /* hitspheres:auto:start */ hitSpheres: [{x:0,y:0,z:1,r:0.5}], broadR: 1.5 /* hitspheres:auto:end */, yaw: 0, scale: 1.1 }`,
  );
  assert.match(legacy, /hitSpheres/); // sanity: the fixture really has the legacy span
  const t = upsertHitBoxes(legacy, 'assets/ships/a.glb', A, 2.1);
  assert.doesNotMatch(t, /hitspheres/); // legacy comment gone
  assert.doesNotMatch(t, /hitSpheres/); // legacy data gone
  assert.match(t, /\/\* hitboxes:auto:start \*\/ hitBoxes:/);
  assert.match(t, /yaw: 0, scale: 1.1/); // surrounding keys survive the migration
});

test('edited text still parses to the generated values', async () => {
  let t = upsertHitBoxes(FIXTURE, 'assets/ships/a.glb', A, 2.1);
  t = upsertHitBoxes(t, 'assets/ships/b.glb', B, 0.98);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-test-'));
  const file = path.join(dir, 'fixture.mjs');
  fs.writeFileSync(file, t);
  try {
    const mod = await import(pathToFileURL(file).href);
    const a = mod.SHIPS.find((s) => s.modelUrl === 'assets/ships/a.glb');
    const b = mod.SHIPS.find((s) => s.modelUrl === 'assets/ships/b.glb');
    assert.deepEqual(a.stats.model.hitBoxes, A);
    assert.equal(a.stats.model.broadR, 2.1);
    assert.equal(a.stats.model.yaw, 0);
    assert.equal(a.stats.model.scale, 1.1);
    assert.deepEqual(b.stats.model.hitBoxes, B);
    assert.equal(b.stats.model.broadR, 0.98);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Scale-sanity: every modeled ship's fit must be hull-scale, not a 2×-inflated bubble (this FAILS on any
// oversized/undersized result). The fitter normalizes each ship's longest axis to SHIP_MODEL_LEN (3.4), so
// the union of boxes must span ≈3.4 (floor 3.0 trips a ~2× under-fit; ceiling 4.3 trips a ~2× over-fit —
// headroom above LEN for rotated-OBB overhang + the min-thickness clamp), broadR must land near the
// half-length (not ~2.8+), and no single box may exceed the half-length.
// It ALSO guards the "thin feature is transparent to bullets" regression: every box's minimum per-axis
// half-extent must be ≥ MIN_HALF (the fitter's tunneling floor), so a razor-thin wing/nose slab (which a
// discrete ~1-unit/frame bullet tunnels through) fails the suite instead of silently shipping.
const MIN_HALF = 0.1; // must match scripts/assets-hitboxes.mjs MIN_HALF (the bullet-tunneling floor)
test('generated hitboxes are hull-scale, not oversized/undersized, and no razor-thin (transparent) box', async () => {
  const { SHIPS } = await import('../server/src/catalog_seed.js');
  const LEN = 3.4, HALF = 1.7;               // normalized model full length / half-extent
  const modeled = SHIPS.filter((s) => s.modelUrl);
  assert.ok(modeled.length >= 9, 'all modeled ships have hitboxes');
  for (const s of modeled) {
    const m = s.stats.model;
    assert.ok(Array.isArray(m.hitBoxes) && m.hitBoxes.length >= 1, `${s.name}: has hitBoxes`);
    assert.ok(typeof m.broadR === 'number', `${s.name}: has broadR`);
    // broadR near the half-length, with headroom for a diagonal OBB corner — never a ~2.8 round bubble
    assert.ok(m.broadR >= 0.8, `${s.name}: broadR ${m.broadR} is implausibly tiny`);
    assert.ok(m.broadR <= HALF + 0.7, `${s.name}: broadR ${m.broadR} is oversized (> ${HALF + 0.7})`);
    // each box + its axes are well-formed; no single box longer than the hull's half-length
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const b of m.hitBoxes) {
      for (const k of ['c', 'h', 'u0', 'u1', 'u2']) {
        assert.ok(b[k] && ['x', 'y', 'z'].every((c) => typeof b[k][c] === 'number'), `${s.name}: box.${k} well-formed`);
      }
      for (const c of ['x', 'y', 'z']) {
        assert.ok(b.h[c] <= HALF + 0.15, `${s.name}: box half-extent ${b.h[c]} exceeds the half-length`);
      }
      // NO razor-thin (bullet-transparent) box: every axis is at least the tunneling floor
      const minHalf = Math.min(b.h.x, b.h.y, b.h.z);
      assert.ok(minHalf >= MIN_HALF - 1e-9,
        `${s.name}: box min half-extent ${minHalf} is below the tunneling floor ${MIN_HALF} (thin feature would be transparent to bullets)`);
      // accumulate the union AABB (group-local) over all 8 corners of every box
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const p = [
          b.c.x + sx * b.h.x * b.u0.x + sy * b.h.y * b.u1.x + sz * b.h.z * b.u2.x,
          b.c.y + sx * b.h.x * b.u0.y + sy * b.h.y * b.u1.y + sz * b.h.z * b.u2.y,
          b.c.z + sx * b.h.x * b.u0.z + sy * b.h.y * b.u1.z + sz * b.h.z * b.u2.z,
        ];
        for (let a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; }
      }
    }
    // full union span along the longest axis ≈ LEN (3.4); loose bounds reject only a genuine 2× mis-fit
    const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
    assert.ok(span >= 3.0, `${s.name}: union span ${span.toFixed(3)} is under-fit (< 3.0 vs LEN ${LEN})`);
    assert.ok(span <= 4.3, `${s.name}: union span ${span.toFixed(3)} is over-fit (> 4.3 vs LEN ${LEN})`);
  }
});

// group-local point-in-OBB-set (zero tolerance) — the runtime narrow-phase, pre-world-transform.
function insideAnyBox(p, boxes) {
  for (const b of boxes) {
    const dx = p[0] - b.c.x, dy = p[1] - b.c.y, dz = p[2] - b.c.z;
    if (Math.abs(dx * b.u0.x + dy * b.u0.y + dz * b.u0.z) <= b.h.x
      && Math.abs(dx * b.u1.x + dy * b.u1.y + dz * b.u1.z) <= b.h.y
      && Math.abs(dx * b.u2.x + dy * b.u2.y + dz * b.u2.z) <= b.h.z) return true;
  }
  return false;
}

// ALIGNMENT + COVERAGE against the REAL model (the structural guard the synthetic-box tests can't provide):
// decode each ship's actual combat glb, put its vertices into the EXACT frame the runtime renders it in
// (the fitter's gatherMesh+normalize, which mirrors ship-factory.js:44-58), and assert the fitted `hitBoxes`
// actually cover that surface — overall AND per extremity (wingtips / nose / tail). This catches (a) a
// fitter-frame regression (boxes drift off the model → coverage collapses) and (b) a decomposition coverage
// hole like the player's +X wing that was ~16% covered ("transparent") before maxHulls 48 / minVolumeError
// 0.5. Requires the combat glbs locally (`npm run assets:pull`); skips cleanly in a checkout without them
// (they're gitignored) — the same precondition the fitter itself has.
test('fitted hitBoxes cover the real model surface (alignment + no coverage hole)', async (t) => {
  const { SHIPS } = await import('../server/src/catalog_seed.js');
  const modeled = SHIPS.filter((s) => s.modelUrl);
  const haveGlbs = modeled.every((s) => fs.existsSync(path.join(SHIPS_DIR, path.basename(s.modelUrl))));
  if (!haveGlbs) { t.skip('combat glbs not present (run `npm run assets:pull`) — alignment check skipped'); return; }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-align-'));
  try {
    for (const s of modeled) {
      const doc = await decodeToPlain(io, path.join(SHIPS_DIR, path.basename(s.modelUrl)), tmp);
      const raw = { pos: [], idx: [] };
      for (const r of doc.getRoot().listScenes()[0].listChildren()) gatherMesh(r, IDENT, raw);
      const { positions } = normalize(raw.pos, raw.idx, s.stats.model.yaw ?? 0, s.stats.model.scaleMul ?? 1);
      const boxes = s.stats.model.hitBoxes;

      // model extents in the runtime frame (for the extremity regions)
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], z = positions[i + 2];
        if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      }
      const regions = {
        overall: () => true,
        '+X wingtip': (x) => x > 0.75 * mxx,
        '-X wingtip': (x) => x < 0.75 * mnx,
        '+Z nose': (x, y, z) => z > 0.75 * mxz,
        '-Z tail': (x, y, z) => z < 0.75 * mnz,
      };
      const p = [0, 0, 0];
      for (const [name, inRegion] of Object.entries(regions)) {
        let cov = 0, tot = 0;
        for (let i = 0; i < positions.length; i += 3) {
          const x = positions[i], y = positions[i + 1], z = positions[i + 2];
          if (!inRegion(x, y, z)) continue;
          tot++; p[0] = x; p[1] = y; p[2] = z;
          if (insideAnyBox(p, boxes)) cov++;
        }
        if (tot < 20) continue; // ignore a near-empty region
        const pct = 100 * cov / tot;
        // overall ≥ 97%; each extremity ≥ 90% — the +X wing hole was 16.5%, so this trips hard on a regression.
        const floor = name === 'overall' ? 97 : 90;
        assert.ok(pct >= floor,
          `${s.name}: ${name} coverage ${pct.toFixed(1)}% < ${floor}% — boxes misaligned with / not covering the model`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- bullet-plane coverage (top-down aim / model.lift suggestion) ----
// Axis-aligned box: u1 = world Y, so its Y half-extent is exactly h.y (hand-checkable).
const box = (cy, hy) => ({
  c: { x: 0, y: cy, z: 0 }, h: { x: 0.2, y: hy, z: 0.2 },
  u0: { x: 1, y: 0, z: 0 }, u1: { x: 0, y: 1, z: 0 }, u2: { x: 0, y: 0, z: 1 },
});

test('planeCoverage: a box crosses the plane iff |c.y + lift| <= its Y half-extent', () => {
  const b = box(-0.3, 0.1);               // sits 0.3 below, half-extent 0.1 → top at -0.2, misses y=0
  assert.equal(planeCoverage([b], 0), 0);
  assert.equal(planeCoverage([b], 0.3), 1); // lift 0.3 centres it on the plane
  assert.equal(planeCoverage([b], 0.25), 1); // 0.05 off-centre, still within the 0.1 half-extent
  assert.equal(planeCoverage([b], 0.45), 0); // over-lifted past it
});

test('bestLift: seats the most boxes on the plane, at the plateau centre (robust, not tangent)', () => {
  // Three hulls clustered below the plane; only a positive lift puts all three on y=0. They all cross the
  // plane for lift ∈ [0.20, 0.30], so the robust pick is the centre 0.25 (margin on both sides).
  const boxes = [box(-0.25, 0.1), box(-0.20, 0.1), box(-0.30, 0.1)];
  assert.equal(planeCoverage(boxes, 0), 0);         // as-fit: fully see-through from above
  const best = bestLift(boxes);
  assert.equal(best.count, 3);                       // all three recoverable
  assert.equal(best.lift, 0.25);                     // centre of the [0.20,0.30] plateau, not an edge
  assert.equal(planeCoverage(boxes, best.lift), 3);  // suggestion actually delivers the count
});

test('bestLift: lift is SIGNED — a hull sitting above the plane is lowered (negative lift)', () => {
  const boxes = [box(0.4, 0.1), box(0.5, 0.1)]; // both above y=0 → all-covered band is L ∈ [-0.5,-0.4]
  const best = bestLift(boxes);
  assert.equal(best.count, 2);
  assert.ok(best.lift < 0, `expected a negative (lowering) lift, got ${best.lift}`);
  assert.equal(planeCoverage(boxes, best.lift), 2);
});

test('bestLift: a hull already centred on the plane needs no lift', () => {
  const boxes = [box(0, 0.1)]; // symmetric about y=0 → plateau centre is 0
  assert.equal(bestLift(boxes).lift, 0);
});
