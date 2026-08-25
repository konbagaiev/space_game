// Which catalog weapon TYPES a hangar weapon slot accepts.
//
// Extracted out of `shop.js` so it can be unit-tested: `shop.js` imports three, so nothing in it loads
// under `node --test`, and this rule is the PLAYER'S ONLY REAL PATH to a weapon. The `?beam` dev flag
// injects a weapon id straight into the loadout and bypasses the shop entirely, so without this seam the
// question "can the beam actually be equipped?" would be answered by nothing at all.
//
// The `gun` group is the PRIMARY WEAPON slot: a bullet OR a beam, never both at once — installing one
// replaces the other, which is what makes buying the Charged beam a real trade (you give up your rapid
// gun). The server routes the same way (`WEAPON_GROUP` in `server/src/db.js`).
//
// Pure data + three predicates: no DOM, no THREE, no state.
export const GROUP_WEAPON_TYPE = { gun: ['bullet', 'beam'], rocket: ['rocket'] };

// Is this loadout slot key a WEAPON fire group (rather than a component slot like `hull`)?
export const isWeaponSlot = (slotKey) => !!GROUP_WEAPON_TYPE[slotKey];

// Does this slot take a weapon of this catalog `type`?
export const slotAcceptsWeaponType = (slotKey, type) =>
  !!GROUP_WEAPON_TYPE[slotKey] && GROUP_WEAPON_TYPE[slotKey].includes(type);
