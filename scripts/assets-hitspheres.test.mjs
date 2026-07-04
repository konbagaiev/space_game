// Unit tests for the surgical seed edit in assets-hitspheres.mjs. Exercises upsertHitSpheres on a small
// fixture with two model:{} blocks + inline comments: insert, comment/key preservation, idempotency, and
// that the edited text still parses to the generated values (import a temp .mjs). Run:
//   node --test scripts/assets-hitspheres.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { upsertHitSpheres } from './assets-hitspheres.mjs';

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

const A = [{ x: 0, y: 0.1, z: -0.9, r: 1.2 }, { x: 1.02, y: 0, z: -0.5, r: 0.3 }];
const B = [{ x: 0, y: 0, z: 0, r: 0.8 }];

test('inserts the marker span and preserves surrounding keys + comments', () => {
  let t = upsertHitSpheres(FIXTURE, 'assets/ships/a.glb', A, 2.1);
  assert.match(t, /\/\* hitspheres:auto:start \*\/ hitSpheres: \[\{x:0,y:0.1,z:-0.9,r:1.2\},\{x:1.02,y:0,z:-0.5,r:0.3\}\], broadR: 2.1 \/\* hitspheres:auto:end \*\/,/);
  // the ship's original keys + comments are intact
  assert.match(t, /yaw: 0, scale: 1.1 \}, \/\/ trailing comment stays/);
  assert.match(t, /\/\/ presentation: yaw\/scale, tuned by eye/);
  // only ship A touched — B's block is byte-identical to the fixture
  assert.ok(t.includes(`model: { yaw: Math.PI, scale: 2 },`));
});

test('running twice yields an identical string (idempotent)', () => {
  const once = upsertHitSpheres(FIXTURE, 'assets/ships/a.glb', A, 2.1);
  const twice = upsertHitSpheres(once, 'assets/ships/a.glb', A, 2.1);
  assert.equal(twice, once);
});

test('edited text still parses to the generated values', async () => {
  let t = upsertHitSpheres(FIXTURE, 'assets/ships/a.glb', A, 2.1);
  t = upsertHitSpheres(t, 'assets/ships/b.glb', B, 0.8);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-test-'));
  const file = path.join(dir, 'fixture.mjs');
  fs.writeFileSync(file, t);
  try {
    const mod = await import(pathToFileURL(file).href);
    const a = mod.SHIPS.find((s) => s.modelUrl === 'assets/ships/a.glb');
    const b = mod.SHIPS.find((s) => s.modelUrl === 'assets/ships/b.glb');
    assert.deepEqual(a.stats.model.hitSpheres, A);
    assert.equal(a.stats.model.broadR, 2.1);
    assert.equal(a.stats.model.yaw, 0);
    assert.equal(a.stats.model.scale, 1.1);
    assert.deepEqual(b.stats.model.hitSpheres, B);
    assert.equal(b.stats.model.broadR, 0.8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
