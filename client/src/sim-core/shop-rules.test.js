import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShopItem, sellPrice, SELL_RATE } from './shop-rules.js';

test('isShopItem: priced row with no stats is for sale', () => {
  assert.equal(isShopItem(300, undefined), true);
  assert.equal(isShopItem(300, null), true);
  assert.equal(isShopItem(300, {}), true);
});
test('isShopItem: price 0 or missing price is not for sale', () => {
  assert.equal(isShopItem(0, {}), false);
  assert.equal(isShopItem(undefined, {}), false);
  assert.equal(isShopItem(null, null), false);
});
test('isShopItem: buyable:false is not for sale, buyable:true is', () => {
  assert.equal(isShopItem(120, { buyable: false }), false);
  assert.equal(isShopItem(120, { buyable: true }), true);
});
test('isShopItem: a flattened client weapon object passed as stats is honoured', () => {
  const flatWeapon = { id: 2, name: 'Kinetic pirate', price: 120, damage: 5, buyable: false };
  assert.equal(isShopItem(flatWeapon.price, flatWeapon), false);
  const flatShopWeapon = { id: 1, name: 'Kinetic', price: 100, damage: 5 };
  assert.equal(isShopItem(flatShopWeapon.price, flatShopWeapon), true);
});

// The one resale rule, shared with the server's /sell (db.js). Recomputed from SELL_RATE, never a restated rate.
test('sellPrice: floor(price × SELL_RATE); a missing price sells for nothing', () => {
  assert.equal(sellPrice(300), Math.floor(300 * SELL_RATE));
  assert.equal(sellPrice(150), Math.floor(150 * SELL_RATE));
  assert.equal(sellPrice(0), 0);
  assert.equal(sellPrice(undefined), 0);
});
