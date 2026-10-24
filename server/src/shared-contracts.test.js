// Facts the client and the server both hold — tied together here so a change on one side fails a test instead
// of drifting (duplication audit C2 + C7, docs/plans/2026-10-24-1836-dedup-shared-contracts.md).
//
// PURE: it imports db.js only to read its exports and never queries, so it needs no database and cannot race
// the other server test files that `node --test` runs concurrently against spacegame_test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as db from './db.js';
import * as seed from './catalog_seed.js';
import * as slots from '../../client/src/shop-slots.js';

// ---------- C2: weapon type → fire group (one map: client/src/shop-slots.js GROUP_WEAPON_TYPE) ----------
test('WEAPON_GROUP (server /equip routing) is exactly GROUP_WEAPON_TYPE (client slots) inverted', () => {
  const inverted = {};
  for (const [group, types] of Object.entries(slots.GROUP_WEAPON_TYPE)) for (const t of types) inverted[t] = group;
  assert.deepEqual(db.WEAPON_GROUP, inverted);
});

test('every weapon type in the seed has a fire group — a new type without a slot fails HERE, not in the shop', () => {
  // Without a group the server now refuses the weapon at /equip (409, DECISIONS §167), so a seed weapon whose
  // type no slot takes would be a buyable-but-unequippable shop item.
  for (const type of new Set(seed.WEAPONS.map((w) => w.type))) {
    assert.notEqual(slots.weaponGroupOf(type), null, `weapon type "${type}" has no slot in GROUP_WEAPON_TYPE`);
    assert.ok(db.WEAPON_GROUP[type], `WEAPON_GROUP has no route for "${type}"`);
  }
});

// ---------- C7: shop-unlock triggers and the starter ship's ids ----------
const unlockShopLevels = () => seed.LEVELS
  .filter((l) => ((l.descriptor.briefing && l.descriptor.briefing.actions) || []).some((a) => a.type === 'unlockShop'))
  .map((l) => l.name);

test('the unlockShop briefing action sits on exactly the SHOP_MIN_LEVEL level (its boot catch-up gate)', () => {
  assert.deepEqual(unlockShopLevels(), [db.SHOP_MIN_LEVEL]);
});

test('FACTORY_GATE (catalog) and SIDE_MISSIONS_MIN_LEVEL (db) name the same level', () => {
  assert.equal(seed.FACTORY_GATE, db.SIDE_MISSIONS_MIN_LEVEL,
    'the factory-boss gate and the side-mission board share a level TODAY (DECISIONS §91). They are separate '
    + 'concepts kept as two constants (the seed cannot import db.js — cycle). If a design change separates '
    + 'them, edit this test deliberately.');
});

test('STARTER_WEAPON_ID is the starter ship\'s gun and the weapon the shop-unlock briefing replaces', () => {
  assert.equal(seed.STARTER_SHIP.type, 'player');
  assert.equal(seed.STARTER_SHIP, seed.SHIPS.find((s) => s.type === 'player'), 'the first player ship (= ensureDefaultShip)');
  const gun = seed.STARTER_SHIP.stats.mounts.find((m) => m.group === 'gun');
  assert.equal(seed.STARTER_WEAPON_ID, gun.weapon);
  assert.ok(seed.WEAPONS.some((w) => w.id === seed.STARTER_WEAPON_ID), 'the starter gun is a catalog weapon');
  const lvl = seed.LEVELS.find((l) => l.name === db.SHOP_MIN_LEVEL);
  const swap = lvl.descriptor.briefing.actions.find((a) => a.type === 'replaceWeapon');
  assert.equal(swap.from, seed.STARTER_WEAPON_ID);
});

test('the starter ship\'s grab and shield (the boot backfills\' ids) are real grab/shield components', () => {
  for (const type of ['grab', 'shield']) {
    const id = seed.STARTER_SHIP.components[type];
    assert.ok(Number.isInteger(id), `starter ship lists a ${type}`);
    const row = seed.COMPONENTS.find((c) => c.id === id);
    assert.ok(row, `component ${id} exists`);
    assert.equal(row.type, type);
  }
});
