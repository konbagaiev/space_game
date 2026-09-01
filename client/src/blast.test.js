// The weight-class axis is only worth having if it cannot rot: this fails if a ship loses its class, if a
// class row loses its blast block, or if the data-driven classification stops agreeing with the numbers the
// flash was dialed to. See docs/plans/2026-08-31-1515-ship-weight-class.md.
//
// It imports the REAL seed (server/src/catalog_seed.js — three-free, it only pulls in enemy_total.js), so
// there is no second copy of the catalog to drift from.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SHIPS } from '../../server/src/catalog_seed.js';
import { SHIP_CLASSES } from './sim-core/ship-classes.js';
import { shipModelCfg } from './sim-core/ship-config.js';
import { BLAST, blastClass, blastPower, blastReach, blastDurMul } from './blast.js';

const isBossOf = (s) => s.role === 'boss' || s.role === 'boss2';
// Epsilon compare: 0.44 × 2 is exact in binary, 0.44 × 3 and 800 × 1.1² are not.
function near0(got, want) { assert.ok(Math.abs(got - want) < 1e-9, `${got} vs ${want}`); }

test('every ship states a DECLARED weight class', () => {
  for (const ship of SHIPS) {
    const w = ship.stats.weightClass;
    assert.equal(typeof w, 'string', `ship "${ship.name}" has no stats.weightClass`);
    assert.ok(SHIP_CLASSES[w], `ship "${ship.name}": undeclared weightClass ${JSON.stringify(w)}`);
  }
});

test('every ship\'s weight class is actually TUNED (has a blast block)', () => {
  // A ship pointing at a blockless class would silently fall back to the sizeScale thresholds — precisely
  // the trap this feature removes.
  for (const ship of SHIPS) {
    const w = ship.stats.weightClass;
    assert.ok(SHIP_CLASSES[w].blast, `ship "${ship.name}": class "${w}" has no blast profile`);
  }
});

test('the FALLBACK LADDER\'s three anchors always carry a blast block', () => {
  // `light`/`medium`/`heavy` are load-bearing in a way the other rows are not: blastClass names them as
  // LITERALS on the fallback path (unknown/blockless class → isBoss → sizeScale), and `profileOf` reads
  // `.blast` off whatever comes back with no guard. Test 2 above only covers classes a ship points at, so
  // without this a retune that stripped one of these three would make the documented "never throws"
  // fallback throw on `.power` — for an old trace or an older server's wire payload, i.e. never in a suite.
  // Deliberately NOT fixed by making `profileOf` defensive: silently substituting another class's numbers
  // would hide the misconfiguration instead of surfacing it.
  for (const id of ['light', 'medium', 'heavy']) {
    assert.ok(SHIP_CLASSES[id] && SHIP_CLASSES[id].blast, `class "${id}" anchors the fallback ladder and MUST keep its blast block`);
  }
});

test('a class row is all-or-nothing: no blast, or a complete one', () => {
  // Deliberately does NOT assert that ultraHeavy/station stay empty — tuning them later must not require
  // editing this test.
  for (const [id, cls] of Object.entries(SHIP_CLASSES)) {
    if (!cls.blast) continue;
    for (const k of ['power', 'reach', 'durMul']) {
      assert.equal(typeof cls.blast[k], 'number', `class "${id}": blast.${k} is not a number`);
      assert.ok(Number.isFinite(cls.blast[k]), `class "${id}": blast.${k} is not finite`);
    }
  }
});

test('THE GOLDEN TABLE: every ship still produces byte-identical blast numbers', () => {
  // The whole point of the change is that NOTHING moves on screen. These are the values the pre-weightClass
  // sizeScale thresholds produced, computed exactly as projectiles.js does it.
  const GOLDEN = {
    'Basic player ship':         { s: 1.1, peak: 968,  reach: 49.5, dur: 0.88 },
    'Basic pirate ship':         { s: 1,   peak: 800,  reach: 45,  dur: 0.88 },
    'basic rocket pirate':       { s: 1,   peak: 800,  reach: 45,  dur: 0.88 },
    'pirate gunner':             { s: 1,   peak: 800,  reach: 45,  dur: 0.88 },
    'advanced rocket pirate':    { s: 1,   peak: 800,  reach: 45,  dur: 0.88 },
    'pirate lancer':             { s: 1,   peak: 800,  reach: 45,  dur: 0.88 },
    'pirate mini boss':          { s: 2,   peak: 5600, reach: 140, dur: 1.32 },
    'advanced medium pirate':    { s: 2,   peak: 5600, reach: 140, dur: 1.32 },
    'first pirate boss':         { s: 3,   peak: 21600, reach: 330, dur: 2.2 },
    'second pirate boss':        { s: 3,   peak: 21600, reach: 330, dur: 2.2 },
  };
  assert.equal(SHIPS.length, Object.keys(GOLDEN).length, 'a ship was added/removed — extend the golden table');
  for (const ship of SHIPS) {
    const g = GOLDEN[ship.name];
    assert.ok(g, `ship "${ship.name}" is not in the golden table`);
    const st = ship.stats;
    const s = shipModelCfg(st).scale;
    const w = st.weightClass;
    const boss = isBossOf(st);
    assert.equal(s, g.s, `${ship.name}: model scale moved`);
    // Epsilon, not ===: 0.44 × 2 is exact in binary but 0.44 × 3 and 800 × 1.1² are not.
    const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-9, `${ship.name}: blast ${what} changed — ${got} vs ${want}`);
    near(blastPower(s, boss, w) * s * s, g.peak, 'peak');
    near(blastReach(s, boss, w) * s, g.reach, 'reach');
    near(BLAST.dur * blastDurMul(s, boss, w), g.dur, 'duration');
  }
  // The PLAYER's death call site (sim.js) hardcodes sizeScale 1 rather than his catalog 1.1, so the number
  // he actually flashes at is this one — and it is unchanged too.
  near0(blastPower(1, false, 'light') * 1 * 1, 800);
  near0(blastReach(1, false, 'light') * 1, 45);
  near0(BLAST.dur * blastDurMul(1, false, 'light'), 0.88);
});
test('the class-driven answer equals the OLD sizeScale answer, on BOTH call paths', () => {
  // spawnBossExplosion passes isBoss = true unconditionally, spawnShipExplosion passes false — so the two
  // must be checked separately rather than assumed to agree.
  for (const ship of SHIPS) {
    const st = ship.stats;
    const s = shipModelCfg(st).scale;
    const w = st.weightClass;
    assert.equal(blastClass(s, isBossOf(st), w), blastClass(s, isBossOf(st), null), `${ship.name}: boss path disagrees`);
    assert.equal(blastClass(s, false, w), blastClass(s, false, null), `${ship.name}: ship path disagrees`);
  }
});

test('the fallback degrades, never throws', () => {
  assert.equal(blastClass(3, false, 'ultraHeavy'), 'heavy');    // declared but untuned → thresholds
  assert.equal(blastClass(1, false, 'station'), 'light');
  assert.equal(blastClass(2, false, 'someHybridNobodyDeclared'), 'medium');
  assert.equal(blastClass(1, true, 'station'), 'heavy');        // isBoss still wins over size
  assert.equal(blastClass(), 'light');                          // no args at all
  for (const args of [[3, false, 'ultraHeavy'], [1, false, 'station'], [2, false, 'nope'], [], [1, true, 'station']]) {
    assert.ok(Number.isFinite(blastPower(...args)));
    assert.ok(Number.isFinite(blastReach(...args)));
    assert.ok(Number.isFinite(blastDurMul(...args)));
  }
});

test('the class chooses the BASE; the SIZE scaling stays at the call site', () => {
  // Nobody may "helpfully" fold `* s * s` into blast.js — that would double-scale every explosion.
  assert.equal(blastPower(1, false, 'heavy'), blastPower(3, false, 'heavy'));
  assert.equal(blastReach(1, false, 'heavy'), blastReach(3, false, 'heavy'));
  assert.equal(blastDurMul(1, false, 'heavy'), blastDurMul(3, false, 'heavy'));
  // …and the other half of that contract lives in another file, so check the source. Crude on purpose:
  // byte-identical output depends on arithmetic in projectiles.js, and this is the cheapest thing that
  // notices it moving. The URL is resolved against this module, not the cwd — the suite may be launched
  // from anywhere.
  const src = fs.readFileSync(new URL('./projectiles.js', import.meta.url), 'utf8');
  const fnBody = (name) => {
    const i = src.indexOf(`export function ${name}(`);
    assert.ok(i >= 0, `${name} not found in projectiles.js`);
    return src.slice(i, i + 1200);
  };
  for (const name of ['spawnShipExplosion', 'spawnBossExplosion']) {
    const body = fnBody(name);
    const line = body.split('\n').find((l) => l.includes('addFlash('));
    assert.ok(line, `${name}: no addFlash call found`);
    assert.match(line, /blastPower\([^)]*\) \* s \* s/, `${name}: power is no longer scaled by size²`);
    assert.match(line, /blastReach\([^)]*\) \* s/, `${name}: reach is no longer scaled by size`);
    assert.match(line, /BLAST\.dur \* blastDurMul\(/, `${name}: duration is no longer BLAST.dur × the class multiplier`);
  }
});

test('the rocket tier is a WEAPON blast, not a ship class', () => {
  assert.ok(Number.isFinite(BLAST.rocket));
  assert.ok(Number.isFinite(BLAST.reachRocket));
  assert.equal(SHIP_CLASSES.rocket, undefined);
});
