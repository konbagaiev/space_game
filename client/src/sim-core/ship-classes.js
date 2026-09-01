// SHIP WEIGHT CLASSES — how heavy a hull is, as data.
//
// A ship already carried two class-ish fields and neither could answer "how big is this?":
//   • `stats.class`  is the SOUND class (`sfxFor('ship', class, …)`) — fighter / capital / player.
//   • `stats.role`   is BEHAVIOUR, with size smuggled in (`rocketeer` = what it carries, `medium` = how big).
// `weightClass` is the missing third axis and is orthogonal to both. It is set on the ship row
// (`stats.weightClass`, server/src/catalog_seed.js) and travels with the entity.
//
// EXTENSIBLE BY DATA, and that is a requirement, not a nicety: adding a class — including a later hybrid —
// must mean adding a ROW here and setting the field on a ship. No consumer may switch/if-ladder on the class
// name. Every consumer resolves a row and degrades to its documented fallback when it cannot (see blast.js).
//
// A class row may declare a `blast` block { power, reach, durMul } — the explosion-light profile, the ONE
// consumer wired in this iteration (client/src/blast.js). The numbers are the ones the flash was dialed to
// on the live test range; `power` is candela × size², `reach` is world units × size (a HARD cutoff), and
// `durMul` multiplies the shared base flash length `BLAST.dur`.
//
// A row WITHOUT a `blast` block is legal and means "declared, not tuned yet" — the resolver falls back to the
// old sizeScale thresholds for it. Do not copy another class's numbers in to fill the hole.
//
// ROOM FOR LATER, deliberately NOT stubbed as empty keys (DECISIONS §30 — a null key is not a design):
//   • expected mass band (what a hull of this class should weigh) — would let the shop flag an outlier;
//   • reward/XP curve per class, so payout follows mass instead of a hand-set number per ship;
//   • which weapons/equipment a class may mount (the shop/loadout predicate). NOT wired in this iteration.
export const SHIP_CLASSES = {
  light:      { blast: { power: 800,  reach: 45,  durMul: 2 } }, // scouts/fighters — the 1.0-scale hulls
  medium:     { blast: { power: 1400, reach: 70,  durMul: 3 } }, // the 2.0-scale capitals (mini boss, advanced medium)
  heavy:      { blast: { power: 2400, reach: 110, durMul: 5 } }, // both campaign bosses (3.0 scale)
  ultraHeavy: {},  // declared, nothing wears it yet: the ladder's top rung, reserved for a hull above a boss.
  station:    {},  // declared: an immobile set-piece, not a hull. The Space Factory is a world.js model
                   // (`makeStationModel`, STATION_LEN['space-factory']), NOT a ships row — nothing carries
                   // this class today, and this plan does not invent a row for it.
};
