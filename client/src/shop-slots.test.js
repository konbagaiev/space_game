// Which weapon types a hangar slot accepts.
//
// THIS IS THE ONLY AUTOMATED PROOF THAT THE CHARGED BEAM IS EQUIPPABLE AT ALL. The `?beam` dev flag and the
// headless scenario both inject weapon 12 straight into the loadout and never touch `shop.js`, so if the
// gun slot silently rejected `'beam'` the beam would be un-buyable and every other test would stay green.
// The rule was extracted out of `shop.js` (which imports three, and therefore cannot load here) for exactly
// this reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_WEAPON_TYPE, isWeaponSlot, slotAcceptsWeaponType } from './shop-slots.js';

test('the GUN slot is the PRIMARY weapon slot: a bullet OR a beam, never a rocket', () => {
  assert.equal(slotAcceptsWeaponType('gun', 'bullet'), true);
  assert.equal(slotAcceptsWeaponType('gun', 'beam'), true, 'the Charged beam installs into the gun slot');
  assert.equal(slotAcceptsWeaponType('gun', 'rocket'), false);
});

test('the ROCKET slot takes rockets and nothing else', () => {
  assert.equal(slotAcceptsWeaponType('rocket', 'rocket'), true);
  assert.equal(slotAcceptsWeaponType('rocket', 'bullet'), false);
  assert.equal(slotAcceptsWeaponType('rocket', 'beam'), false, 'a beam fires on Space, not F');
});

test('a COMPONENT slot key is not a weapon slot and accepts no weapon type', () => {
  for (const slot of ['hull', 'engine', 'thruster', 'repair', 'grab', 'shield']) {
    assert.equal(isWeaponSlot(slot), false, `${slot} is a component slot`);
    for (const type of ['bullet', 'beam', 'rocket']) {
      assert.equal(slotAcceptsWeaponType(slot, type), false, `${slot} must not take a ${type}`);
    }
  }
  assert.equal(isWeaponSlot('nonsense'), false);
  assert.equal(slotAcceptsWeaponType('nonsense', 'beam'), false);
});

test('isWeaponSlot is true for exactly the two fire groups', () => {
  assert.equal(isWeaponSlot('gun'), true);
  assert.equal(isWeaponSlot('rocket'), true);
  assert.deepEqual(Object.keys(GROUP_WEAPON_TYPE).sort(), ['gun', 'rocket']);
});

test('every accepted type is a list, so `equippedInSlot`\'s truthiness test still works unchanged', () => {
  // `shop.js` only asks `if (GROUP_WEAPON_TYPE[slotKey])` there; an array is truthy, so nothing about the
  // equipped-item lookup had to change when the value went from a string to a list.
  for (const v of Object.values(GROUP_WEAPON_TYPE)) {
    assert.ok(Array.isArray(v) && v.length > 0);
  }
});
