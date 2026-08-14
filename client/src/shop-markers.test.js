import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refOf, sectionOf, isGated, gatedRefs, absorbRefs, hasNew, unseenItems, unseenSections, prune,
  primeSets, GATE_KINDS, LEGACY_GATE_KINDS } from './shop-markers.js';

// The pure state machine behind the gold "(new)" trail (shop.js owns the localStorage/DOM I/O). Its last
// bug — "(new)" on gear the player had owned for weeks — was exactly a state-machine bug, so the live
// rollout shapes below are the point of this file, not an afterthought.

// The real gated rows, normalized the way shop.js's normComponent/normWeapon produce them.
const HEAVY_HULL = { kind: 'component', refId: 13, type: 'hull', s: { minLevel: 'level-4' } };
const HMG = { kind: 'weapon', refId: 7, type: 'bullet', s: { minLevel: 'level-4' } };
const TRIPLE = { kind: 'weapon', refId: 11, type: 'rocket', s: { minLevel: 'level-4' } };
const ION = { kind: 'component', refId: 16, type: 'engine', s: { minMission: 'side-research' } };
const NANOBOT = { kind: 'component', refId: 20, type: 'repair', s: { minMission: 'side-research' } };
const BASIC_HULL = { kind: 'component', refId: 1, type: 'hull', s: { durability: 100 } };   // ungated
const CANNON = { kind: 'weapon', refId: 6, type: 'bullet', s: { power: 40 } };              // ungated
const BOTH = { kind: 'component', refId: 99, type: 'shield', s: { minLevel: 'level-4', minMission: 'side-research' } };

const LEVEL_TIER = [HEAVY_HULL, HMG, TRIPLE];
const MISSION_TIER = [ION, NANOBOT];
const LEVEL_REFS = LEVEL_TIER.map(refOf);
const MISSION_REFS = MISSION_TIER.map(refOf);

test('gatedRefs picks up BOTH gate kinds and ignores ungated rows', () => {
  const items = [BASIC_HULL, ...LEVEL_TIER, ...MISSION_TIER, CANNON, BOTH];
  assert.deepEqual(gatedRefs(items), [...LEVEL_REFS, ...MISSION_REFS, 'component:99']);
  assert.equal(isGated(BASIC_HULL), false, 'an ungated row is never trailable');
  assert.equal(isGated(CANNON), false);
  assert.equal(isGated({ kind: 'component', refId: 5 }), false, 'a row with no stats at all is ungated');
  assert.equal(isGated(ION), true, 'minMission alone is a gate');
  assert.equal(isGated(BOTH), true, 'both gate kinds at once is still one trailable row');
});

test('no baseline (null) ⇒ nothing is new and nothing is unseen — a storage hiccup must not invent a marker', () => {
  assert.equal(hasNew(gatedRefs(LEVEL_TIER), null), false);
  assert.deepEqual(unseenItems(LEVEL_TIER, null), []);
  assert.deepEqual([...unseenSections(LEVEL_TIER, null)], []);
});

test('a baseline holding everything gated ⇒ no marker, no gold (gear owned for weeks)', () => {
  const items = [BASIC_HULL, ...LEVEL_TIER, ...MISSION_TIER];
  const baseline = new Set(gatedRefs(items));
  assert.equal(hasNew(gatedRefs(items), baseline), false);
  assert.deepEqual([...unseenSections(items, baseline)], []);
});

test('an unseen row lights exactly its own section; two sections light two tabs', () => {
  const items = [BASIC_HULL, ...LEVEL_TIER, ...MISSION_TIER];
  // only the Heavy hull is unclicked → just the hull tab
  const allButHull = new Set(gatedRefs(items).filter((r) => r !== refOf(HEAVY_HULL)));
  assert.deepEqual([...unseenSections(items, allButHull)], ['hull']);
  assert.deepEqual(unseenItems(items, allButHull).map(refOf), [refOf(HEAVY_HULL)]);
  // the level tier spans hull + weapon (a weapon is one tab whatever its weapon type)
  const missionOnly = new Set(MISSION_REFS);
  assert.deepEqual([...unseenSections(items, missionOnly)].sort(), ['hull', 'weapon']);
  // the research tier spans engine + repair
  const levelOnly = new Set(LEVEL_REFS);
  assert.deepEqual([...unseenSections(items, levelOnly)].sort(), ['engine', 'repair']);
});

test('sectionOf: every weapon is the one "weapon" tab; a component uses its type', () => {
  assert.equal(sectionOf(HMG), 'weapon');
  assert.equal(sectionOf(TRIPLE), 'weapon', 'a rocket is not its own tab');
  assert.equal(sectionOf(HEAVY_HULL), 'hull');
  assert.equal(sectionOf(ION), 'engine');
  assert.equal(sectionOf(NANOBOT), 'repair');
  assert.equal(refOf(ION), 'component:16');
});

test('prune drops refs that are no longer unlocked and keeps the ones that are', () => {
  const stored = new Set([...LEVEL_REFS, ...MISSION_REFS, 'component:404']);
  // a progress reset re-locks the level tier → only what is gated+unlocked NOW survives
  assert.deepEqual(prune(MISSION_REFS, stored), MISSION_REFS);
  assert.deepEqual(prune([...LEVEL_REFS, ...MISSION_REFS], stored), [...LEVEL_REFS, ...MISSION_REFS]);
  assert.deepEqual(prune(LEVEL_REFS, new Set([refOf(HMG)])), [refOf(HMG)], 'refs not in the set are dropped');
});

// ---------- The live-rollout shape: a PRE-EXISTING baseline + rows that just became gated ----------
// This is what shipping the `minMission` gate looks like on a real device. `absorbRefs` is what keeps the
// release silent for players who could already buy the rows it just gated.
test('rollout — grandfathered: the newly gated rows are absorbed, so no marker and no gold', () => {
  const items = [BASIC_HULL, ...LEVEL_TIER, ...MISSION_TIER]; // all 5 unlocked (backfilled `side-research`)
  const stored = new Set(LEVEL_REFS);                         // the baseline this device already had
  const absorb = absorbRefs(items, LEGACY_GATE_KINDS);
  assert.deepEqual(absorb, MISSION_REFS, 'exactly the two rows whose gate kind the baseline never knew');
  const baseline = new Set([...stored, ...absorb]);
  assert.equal(hasNew(gatedRefs(items), baseline), false, 'no "(new)" for gear that was always buyable here');
  assert.deepEqual([...unseenSections(items, baseline)], [], 'and no gold frames anywhere');
});

test('rollout — short of the gate: nothing is absorbed, and clearing the mission later lights the trail', () => {
  const locked = [BASIC_HULL, ...LEVEL_TIER];                 // buyableNow() omits the still-locked rows
  const stored = new Set(LEVEL_REFS);
  assert.deepEqual(absorbRefs(locked, LEGACY_GATE_KINDS), [], 'a LOCKED row is not in the list to absorb');
  const baseline = new Set([...stored, ...absorbRefs(locked, LEGACY_GATE_KINDS)]);
  assert.deepEqual([...baseline].sort(), [...LEVEL_REFS].sort(), 'the baseline stays at the 3 level refs');
  // …the player clears Research Station → the two rows join buyableNow()
  const afterClear = [BASIC_HULL, ...LEVEL_TIER, ...MISSION_TIER];
  assert.equal(hasNew(gatedRefs(afterClear), baseline), true, 'the menu "(new)" fires when it is earned');
  assert.deepEqual([...unseenSections(afterClear, baseline)].sort(), ['engine', 'repair']);
});

test('rollout — a genuinely pending marker survives the absorb (an already-known kind is untouched)', () => {
  const items = [BASIC_HULL, ...LEVEL_TIER];      // level tier just unlocked; the mission rows are locked
  const stored = new Set();                        // baseline taken BEFORE "Level 3" was cleared
  assert.deepEqual(absorbRefs(items, LEGACY_GATE_KINDS), [], 'minLevel rows are a kind the baseline knew');
  assert.equal(hasNew(gatedRefs(items), stored), true, 'the pending "(new)" is not swallowed');
  assert.deepEqual([...unseenSections(items, stored)].sort(), ['hull', 'weapon']);
});

test('a baseline that already knows every kind absorbs nothing', () => {
  const items = [...LEVEL_TIER, ...MISSION_TIER];
  assert.deepEqual(absorbRefs(items, GATE_KINDS), [], 'no kind is unknown → nothing to fold in');
});

// ---------- primeSets: the whole bootstrap decision (shop.js only does the storage I/O) ----------
test('primeSets — first sight adopts everything unlocked; a `seen` with no `clicked` seeds clicked FROM seen', () => {
  const refs = [...LEVEL_REFS, ...MISSION_REFS];
  const fresh = primeSets({ refs, absorb: [], seen: null, clicked: null });
  assert.deepEqual(fresh.seen, refs, 'a fresh device adopts what is unlocked…');
  assert.deepEqual(fresh.clicked, refs, '…for BOTH keys, so nothing is new and nothing is gold');
  // a device from before the key split whose menu marker is genuinely pending (seen = [])
  const pending = primeSets({ refs: LEVEL_REFS, absorb: [], seen: new Set(), clicked: null });
  assert.deepEqual(pending.seen, [], 'the pending marker survives');
  assert.deepEqual(pending.clicked, [], 'and the shop has matching gold — the trail does not dead-end');
});

test('primeSets — the grandfathered rollout stays silent, and a player short of the gate still earns it', () => {
  const refs = [...LEVEL_REFS, ...MISSION_REFS];                     // all 5 unlocked (backfilled)
  const gf = primeSets({ refs, absorb: MISSION_REFS, seen: new Set(LEVEL_REFS), clicked: new Set(LEVEL_REFS) });
  assert.deepEqual(gf.seen.sort(), refs.slice().sort(), 'the newly gated rows land in the seen baseline');
  assert.deepEqual(gf.clicked.sort(), refs.slice().sort(), 'and in the clicked one → no marker, no gold');
  // short of the research gate: only the 3 level rows are unlocked, so nothing to absorb, baselines hold
  const short = primeSets({ refs: LEVEL_REFS, absorb: [], seen: new Set(LEVEL_REFS), clicked: new Set(LEVEL_REFS) });
  assert.deepEqual(short.seen, LEVEL_REFS);
  assert.deepEqual(short.clicked, LEVEL_REFS);
});

// The reviewer's finding: `markShopItemsSeen` prunes `seen` on every shop-open, but nothing pruned
// `clicked` unless a row was clicked. A reset player who reopened the shop without clicking kept a stale
// `clicked`, so re-earning the tier lit the menu "(new)" with NO gold behind it — the same dead-end the
// clicked-from-seen seeding exists to prevent, for a different cohort. Both baselines prune at prime now.
test('primeSets — a progress reset re-arms BOTH baselines (stale refs are pruned, not carried)', () => {
  const stale = new Set([...LEVEL_REFS, ...MISSION_REFS]); // what the device stored before the reset
  // right after the reset nothing gated is unlocked → both baselines must empty out
  const wiped = primeSets({ refs: [], absorb: [], seen: stale, clicked: stale });
  assert.deepEqual(wiped.seen, [], 'the seen baseline drops the relocked refs');
  assert.deepEqual(wiped.clicked, [], 'and so does the clicked one (this is the fix)');
  // …then the player re-clears "Level 3": the menu marker AND the gold fire together again
  const items = [BASIC_HULL, ...LEVEL_TIER];
  const reEarned = primeSets({ refs: LEVEL_REFS, absorb: [], seen: new Set(wiped.seen), clicked: new Set(wiped.clicked) });
  assert.equal(hasNew(gatedRefs(items), new Set(reEarned.seen)), true, 'the menu "(new)" is back');
  assert.deepEqual([...unseenSections(items, new Set(reEarned.clicked))].sort(), ['hull', 'weapon'],
    'and the shop shows matching gold — the marker never points at a shop with nothing lit');
});

test('primeSets — pruning is idempotent and never invents a marker', () => {
  const refs = [...LEVEL_REFS, ...MISSION_REFS];
  const once = primeSets({ refs, absorb: [], seen: new Set(refs), clicked: new Set(refs) });
  const twice = primeSets({ refs, absorb: [], seen: new Set(once.seen), clicked: new Set(once.clicked) });
  assert.deepEqual(twice, once, 'priming again changes nothing');
  assert.equal(hasNew(refs, new Set(twice.seen)), false, 'and still nothing is new');
});

test('GATE_KINDS / LEGACY_GATE_KINDS are pinned — GATE_KINDS IS the version bump for a new gate kind', () => {
  assert.deepEqual(GATE_KINDS, ['minLevel', 'minMission']);
  assert.deepEqual(LEGACY_GATE_KINDS, ['minLevel']);
});
