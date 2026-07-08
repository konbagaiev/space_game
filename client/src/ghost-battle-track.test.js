// Pure unit tests for the ghost-battle transform-track helpers + a shape/bounds guard over the committed
// backdrop-battle.js (baked by client/bench/gen-backdrop.mjs). No THREE/DOM → runs under bare `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ghostBattlePlan, sampleShip, frameIndex, deq, slotAlive, MAX_GHOST_SHIPS,
  GHOST_TUNE_DEFAULTS, clampGhostTune, loadGhostTune, saveGhostTune, recenterAndQuantize } from './ghost-battle-track.js';
import { BACKDROP_BATTLE } from './backdrop-battle.js';

// A Map-backed fake localStorage (mirrors graphics.test.js's makeStore) for the tune persistence tests.
const makeStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('ghostBattlePlan: performance tier is off', () => {
  assert.deepEqual(ghostBattlePlan('performance', false), { enabled: false, maxConcurrent: 0, bullets: false });
});

test('ghostBattlePlan: ?debug disables every tier', () => {
  for (const tier of ['high', 'balance', 'performance', 'unknown']) {
    assert.equal(ghostBattlePlan(tier, true).enabled, false);
  }
});

test('ghostBattlePlan: balance = 4 concurrent, no bullets', () => {
  assert.deepEqual(ghostBattlePlan('balance', false), { enabled: true, maxConcurrent: 4, bullets: false });
});

test('ghostBattlePlan: high and unknown = 8 concurrent + bullets', () => {
  assert.deepEqual(ghostBattlePlan('high', false), { enabled: true, maxConcurrent: 8, bullets: true });
  assert.deepEqual(ghostBattlePlan('unknown', false), { enabled: true, maxConcurrent: 8, bullets: true });
});

test('slotAlive: born-and-alive window (pre-birth + post-death excluded)', () => {
  const frames = 12;
  // player slot: birth 0, death -1 → alive at every keyframe
  const player = { birth: 0, death: -1 };
  for (let kf = 0; kf < frames; kf++) assert.equal(slotAlive(player, kf, frames), true, `player alive @${kf}`);
  // a wave that is born at 5 and dies at 10 → alive 5..9 only
  const wave = { birth: 5, death: 10 };
  assert.equal(slotAlive(wave, 4, frames), false, 'pre-birth');
  assert.equal(slotAlive(wave, 5, frames), true, 'birth frame');
  assert.equal(slotAlive(wave, 9, frames), true, 'last alive frame');
  assert.equal(slotAlive(wave, 10, frames), false, 'death frame excluded');
  assert.equal(slotAlive(wave, 11, frames), false, 'post-death');
  // a survivor born at 5, death -1 → alive for all kf >= 5
  const survivor = { birth: 5, death: -1 };
  assert.equal(slotAlive(survivor, 4, frames), false);
  for (let kf = 5; kf < frames; kf++) assert.equal(slotAlive(survivor, kf, frames), true, `survivor alive @${kf}`);
  // birth defaults to 0 when absent
  assert.equal(slotAlive({ death: -1 }, 0, frames), true);
});

test('sampleShip: lerps position at the midpoint', () => {
  const ship = { x: [0, 100, 200], z: [0, 0, 0], yaw: [0, 0, 0] };
  const fps = 20, frames = 3, qPos = 10, qYaw = 100;
  const p = sampleShip(ship, (0.5 / fps), fps, frames, qPos, qYaw); // halfway between frame 0 and 1
  assert.ok(Math.abs(p.x - 5) < 1e-9, `x=${p.x}`); // midpoint of deq(0)=0 and deq(100)=10 → 5
  assert.equal(p.z, 0);
});

test('sampleShip: yaw takes the shortest arc across the ±π seam', () => {
  // +3.0 rad → -3.0 rad: the shortest arc crosses π (≈ ±3.14), NOT 0. Midpoint should be near ±π, not ~0.
  const ship = { x: [0, 0], z: [0, 0], yaw: [300, -300] }; // qYaw=100 → 3.0 rad → -3.0 rad
  const fps = 20, frames = 2, qPos = 10, qYaw = 100;
  const p = sampleShip(ship, (0.5 / fps), fps, frames, qPos, qYaw);
  assert.ok(Math.abs(Math.abs(p.yaw) - Math.PI) < 0.2, `yaw=${p.yaw} should be near ±π`);
  assert.ok(Math.abs(p.yaw) > 3.0, `yaw=${p.yaw} must not have crossed through 0`);
});

test('sampleShip: last frame clamps (does not lerp into the wrap)', () => {
  const ship = { x: [0, 100, 200], z: [0, 0, 0], yaw: [0, 0, 0] };
  const fps = 20, frames = 3, qPos = 10, qYaw = 100;
  // t past the last keyframe within the loop: floor(f)%frames = 2 (last), i1 clamps to i0 → returns frame 2.
  const p = sampleShip(ship, (2.5 / fps), fps, frames, qPos, qYaw);
  assert.equal(p.x, 20); // frame 2 = 200 dequantized → 20, NOT interpolated toward frame 0 (wrap)
});

test('frameIndex: wraps within [0, frames)', () => {
  assert.equal(frameIndex(0, 20, 3), 0);
  assert.equal(frameIndex(3 / 20, 20, 3), 0); // 3 % 3
  assert.equal(frameIndex(2.9 / 20, 20, 3), 2);
});

test('deq: quantize round-trip within ±0.05', () => {
  for (const v of [0.03, -1.27, 12.5, -48.31]) {
    assert.ok(Math.abs(deq(Math.round(v * 10), 10) - v) <= 0.05, `v=${v}`);
  }
});

// ---- Live appearance tune helpers (?dev panel, pure) — 5 keys incl. the absolute anchor ax/az ----
test('clampGhostTune: clamps out-of-range + NaN to ranges / defaults (all 5 keys)', () => {
  assert.equal(clampGhostTune({ y: 5 }).y, 0);        // y range [-80,0] → 5 clamps to 0
  assert.equal(clampGhostTune({ y: -99 }).y, -80);    // → clamps to -80
  assert.equal(clampGhostTune({ scale: 'x' }).scale, GHOST_TUNE_DEFAULTS.scale); // NaN → default 0.8
  assert.equal(clampGhostTune({ opacity: 2 }).opacity, 1.0);   // opacity range [0.1,1] → 2 clamps to 1
  assert.equal(clampGhostTune({ az: -999 }).az, -600);         // az range [-600,600] → -999 clamps to -600
  assert.equal(clampGhostTune({ ax: 999 }).ax, 600);           // ax → 600
  assert.equal(clampGhostTune({ ax: 'q' }).ax, GHOST_TUNE_DEFAULTS.ax); // NaN → default -100
  assert.deepEqual(clampGhostTune({}), GHOST_TUNE_DEFAULTS);   // empty → all defaults (incl. ax:-100, az:-450)
});

test('loadGhostTune: defaults on empty/garbage, clamped object on valid JSON', () => {
  assert.deepEqual(loadGhostTune(makeStore()), GHOST_TUNE_DEFAULTS);       // empty store → defaults (incl. ax/az)
  const bad = makeStore(); bad.setItem('ghostTune', '{not json');
  assert.deepEqual(loadGhostTune(bad), GHOST_TUNE_DEFAULTS);               // garbage → defaults
  const ok = makeStore(); ok.setItem('ghostTune', JSON.stringify({ y: -20, scale: 1.2, opacity: 0.5, ax: -200, az: 100 }));
  assert.deepEqual(loadGhostTune(ok), { y: -20, scale: 1.2, opacity: 0.5, ax: -200, az: 100 });
  const oob = makeStore(); oob.setItem('ghostTune', JSON.stringify({ y: 999, scale: 0.05, opacity: -1, ax: -999, az: 999 }));
  assert.deepEqual(loadGhostTune(oob), { y: 0, scale: 0.3, opacity: 0.1, ax: -600, az: 600 }); // clamped on load
  // a partial stored object fills missing keys (ax/az) from defaults
  const partial = makeStore(); partial.setItem('ghostTune', JSON.stringify({ y: -40 }));
  assert.deepEqual(loadGhostTune(partial), { ...GHOST_TUNE_DEFAULTS, y: -40 });
  assert.deepEqual(loadGhostTune(null), GHOST_TUNE_DEFAULTS);              // no store → defaults
});

test('saveGhostTune: round-trips a clamped object (5 keys) through a fake store', () => {
  const store = makeStore();
  const saved = saveGhostTune(store, { y: -20, scale: 1.0, opacity: 0.8, ax: -150, az: -300 });
  assert.deepEqual(saved, { y: -20, scale: 1.0, opacity: 0.8, ax: -150, az: -300 });
  assert.deepEqual(loadGhostTune(store), { y: -20, scale: 1.0, opacity: 0.8, ax: -150, az: -300 });
  // out-of-range values are clamped before persisting
  saveGhostTune(store, { y: 50, scale: 9, opacity: 0, ax: 5000, az: -5000 });
  assert.deepEqual(loadGhostTune(store), { y: 0, scale: 1.5, opacity: 0.1, ax: 600, az: -600 });
});

// ---- recenterAndQuantize: ONE FIXED offset (= the mean of the player's path) — the player flies FREELY ----
test('recenterAndQuantize: subtracts a single mean offset — slot 0 still MOVES (not pinned), its mean ≈ 0', () => {
  const frames = 5;
  // slot 0 (player) TRANSLATES x = kf*5 (mean = 10 over kf 0..4); other slots have their own motion + offsets.
  const ships = [
    { shipName: 'p', scale: 1, birth: 0, death: -1, x: Array.from({ length: frames }, (_, kf) => kf * 5),      z: Array.from({ length: frames }, (_, kf) => kf * 2),      yaw: Array(frames).fill(0) },
    { shipName: 'a', scale: 1, birth: 0, death: -1, x: Array.from({ length: frames }, (_, kf) => kf * 5 + 10), z: Array.from({ length: frames }, (_, kf) => kf * 2 - 3),  yaw: Array(frames).fill(0) },
  ];
  // a bullet co-located with slot 1 every frame → stays co-located with slot 1 after re-centering
  const bullets = { counts: Array(frames).fill(1),
    x: Array.from({ length: frames }, (_, kf) => kf * 5 + 10), z: Array.from({ length: frames }, (_, kf) => kf * 2 - 3) };
  const T = recenterAndQuantize({ fps: 20, frames, ships, bullets });
  const p0 = T.ships[0].x.map((v) => v / T.qPos);
  // slot 0 is NOT constant — its motion is preserved (guards against a regression to per-keyframe slot-0 pinning)
  assert.ok(new Set(p0).size > 1, 'slot 0 x varies frame-to-frame (player flies freely, not pinned)');
  const meanX = p0.reduce((a, b) => a + b, 0) / frames;
  const meanZ = T.ships[0].z.reduce((a, b) => a + b / T.qPos, 0) / frames;
  assert.ok(Math.abs(meanX) < 1e-9, `slot 0 mean x ≈ 0 (got ${meanX})`);
  assert.ok(Math.abs(meanZ) < 1e-9, `slot 0 mean z ≈ 0 (got ${meanZ})`);
  // the SAME constant (player mean = (10, 4)) was subtracted from everyone: slot 1 x = kf*5+10-10 = kf*5
  for (let kf = 0; kf < frames; kf++) {
    assert.ok(Math.abs(T.ships[1].x[kf] / T.qPos - kf * 5) < 1e-9, `kf ${kf}: slot 1 x == kf*5 (same offset)`);
    // bullet stays co-located with slot 1
    assert.equal(T.bullets.x[kf], T.ships[1].x[kf], `kf ${kf}: bullet aligned with slot 1`);
    assert.equal(T.bullets.z[kf], T.ships[1].z[kf], `kf ${kf}: bullet z aligned with slot 1`);
  }
  for (const sh of T.ships) assert.equal(sh.birth, 0, 'birth preserved on output');
  for (const sh of T.ships) for (const v of [...sh.x, ...sh.z, ...sh.yaw]) assert.ok(Number.isInteger(v));
  for (const v of [...T.bullets.x, ...T.bullets.z]) assert.ok(Number.isInteger(v));
});

test('recenterAndQuantize: the single offset is computed from slot 0 ONLY — a born-late slot cannot shift it', () => {
  const frames = 8, bornAt = 4, FAR = 100000; // huge pre-birth placeholder (hidden at playback)
  // slot 0 = player (mean of x = mean(kf*7+3)); slot 1 born at 4 with a FAR pre-birth placeholder, then +8 in x.
  const px = (kf) => kf * 7 + 3;
  const ships = [
    { shipName: 'p', scale: 1, birth: 0, death: -1, x: Array.from({ length: frames }, (_, kf) => px(kf)), z: Array(frames).fill(0), yaw: Array(frames).fill(0) },
    { shipName: 'c', scale: 1, birth: bornAt, death: -1,
      x: Array.from({ length: frames }, (_, kf) => (kf < bornAt ? FAR : px(kf) + 8)), z: Array(frames).fill(0), yaw: Array(frames).fill(0) },
  ];
  const bullets = { counts: Array(frames).fill(0), x: [], z: [] };
  // The offset must equal ONLY slot 0's mean (independent of slot 1's FAR placeholder):
  let meanX = 0; for (let kf = 0; kf < frames; kf++) meanX += px(kf); meanX /= frames;
  const T = recenterAndQuantize({ fps: 20, frames, ships, bullets });
  for (let kf = 0; kf < frames; kf++) {
    assert.ok(Math.abs(T.ships[0].x[kf] / T.qPos - (px(kf) - meanX)) < 1e-9, `kf ${kf}: slot 0 = px - slot0mean`);
  }
  // from birth on, slot 1 got the SAME slot-0-mean offset as everyone (px+8-meanX); pre-birth stays FAR-ish (hidden)
  for (let kf = bornAt; kf < frames; kf++) {
    assert.ok(Math.abs(T.ships[1].x[kf] / T.qPos - (px(kf) + 8 - meanX)) < 1e-9, `kf ${kf}: slot 1 = px+8 - slot0mean`);
  }
  assert.equal(T.ships[1].birth, bornAt, 'born-late birth preserved');
});

// ---- Committed artifact guards (catch a bad regeneration) ----
test('backdrop-battle.js: shape guard (birth/death invariants + ≤16 slots)', () => {
  const T = BACKDROP_BATTLE;
  assert.equal(T.version, 1);
  assert.ok(T.frames > 0, 'frames > 0');
  assert.ok(T.ships.length >= 1 && T.ships.length <= MAX_GHOST_SHIPS, `1 <= ships <= ${MAX_GHOST_SHIPS}`);
  for (const sh of T.ships) {
    assert.equal(sh.x.length, T.frames, 'ship x length == frames');
    assert.equal(sh.z.length, T.frames, 'ship z length == frames');
    assert.equal(sh.yaw.length, T.frames, 'ship yaw length == frames');
    assert.ok(typeof sh.shipName === 'string', 'shipName is a string');
    // birth is an int in 0..frames; death is -1 or an int in birth..frames (so birth <= deathOrEnd)
    assert.ok(Number.isInteger(sh.birth) && sh.birth >= 0 && sh.birth <= T.frames, `birth ${sh.birth} in 0..frames`);
    assert.ok(sh.death === -1 || (Number.isInteger(sh.death) && sh.death >= sh.birth && sh.death <= T.frames),
      `death ${sh.death} is -1 or in birth..frames`);
  }
  assert.equal(T.bullets.counts.length, T.frames, 'bullets.counts length == frames');
  const total = T.bullets.counts.reduce((a, b) => a + b, 0);
  assert.equal(T.bullets.x.length, total, 'bullets.x length == sum(counts)');
  assert.equal(T.bullets.z.length, total, 'bullets.z length == sum(counts)');
});

test('backdrop-battle.js: player flies freely (slot 0 not pinned) + no runaway (< 600 u)', () => {
  const T = BACKDROP_BATTLE;
  // Slot 0 (the player) is re-centered by a FIXED mean offset → it MOVES frame-to-frame (its motion is
  // preserved, NOT pinned to origin) and its mean is ≈ 0. A regression to per-keyframe slot-0 pinning (slot 0 ≡
  // (0,0)) fails the "varies" assertion; a stale (old slot-0-pinned) committed track fails here too.
  const x0 = T.ships[0].x, z0 = T.ships[0].z;
  assert.ok(new Set(x0).size > 1 || new Set(z0).size > 1, 'slot 0 varies frame-to-frame (player flies freely)');
  const meanX = x0.reduce((a, b) => a + b, 0) / (T.frames * T.qPos);
  const meanZ = z0.reduce((a, b) => a + b, 0) / (T.frames * T.qPos);
  assert.ok(Math.abs(meanX) < 0.2 && Math.abs(meanZ) < 0.2, `slot 0 mean ≈ 0 (got ${meanX.toFixed(2)},${meanZ.toFixed(2)})`);
  // No runaway bake: each born-and-alive slot stays within hypot < 600 u of origin OVER ITS LIVE FRAMES ONLY (a
  // far-off pre-birth/post-death placeholder must not trip this). With a fixed offset both player AND enemies
  // move, so the spread is larger than a player-relative bound — 600 u is a loose sanity ceiling against a
  // not-re-centered/runaway track (thousands of u); "fits on screen at the chosen scale" is a manual playtest item.
  for (const sh of T.ships) {
    for (let kf = 0; kf < T.frames; kf++) {
      if (!slotAlive(sh, kf, T.frames)) continue;
      assert.ok(Math.hypot(sh.x[kf] / T.qPos, sh.z[kf] / T.qPos) < 600,
        `ship '${sh.shipName}' kf ${kf} within 600 u of origin`);
    }
  }
});
