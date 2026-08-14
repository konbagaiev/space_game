// Pure state logic for the gold "(new)" trail (no DOM, no storage — see client/src/shop.js for the I/O).
// TWO independent facts, deliberately: (1) has the player OPENED THE SHOP since these rows unlocked
// (drives the Loadout menu + Shop-button "(new)"), and (2) has the player CLICKED this specific row in the
// shop list (drives the gold type-tab + gold row). Both sets are pruned to what is unlocked NOW on every
// write, so a progress reset re-arms the markers instead of swallowing them forever.

// The stable ref string for a normalized catalog row ("component:16" / "weapon:7").
export const refOf = (n) => `${n.kind}:${n.refId}`;
// EVERY gate kind a catalog row can carry. Adding a kind here IS the version bump that lets an existing
// device absorb rows that just became gated (see absorbRefs) — there is no separate epoch number to
// remember. Order is irrelevant; membership is what matters.
export const GATE_KINDS = ['minLevel', 'minMission'];
// The kinds that existed before the kinds key was introduced — what a device with no stored kinds knew.
export const LEGACY_GATE_KINDS = ['minLevel'];
// A row is trailable when it carries ANY gate — everything else has been on the shelf since the shop
// opened and would make the markers permanent noise.
export const isGatedBy = (n, kinds) => !!(n.s && kinds.some((k) => n.s[k]));
export const isGated = (n) => isGatedBy(n, GATE_KINDS);
export const gatedRefs = (items) => items.filter(isGated).map(refOf);
// Rows that are gated+unlocked NOW but carried NONE of the gate kinds this device's baseline was taken
// under — i.e. rows that were freely buyable here until this release gated them. They must be folded into
// an EXISTING baseline as already-seen, or shipping a new gate kind would tell every player that gear
// they have been buying for weeks is "(new)". Deliberately narrow: a row gated by an ALREADY-KNOWN kind
// is untouched, so a genuine pending marker (e.g. the Level-3 tier unlocked but not yet looked at)
// survives the update. Fully general — it keys off gate KINDS, never off item ids.
export const absorbRefs = (items, knownKinds) =>
  items.filter((n) => isGated(n) && !isGatedBy(n, knownKinds)).map(refOf);
// Which shop type-tab a row lives under (weapons are one tab regardless of their weapon type).
export const sectionOf = (n) => (n.kind === 'weapon' ? 'weapon' : n.type);

// No baseline (null) ⇒ nothing is new: a storage hiccup must never INVENT a marker (see primeShopItemsSeen).
export const hasNew = (gated, seen) => !!seen && gated.some((r) => !seen.has(r));
// Unlocked+gated rows whose row has never been clicked. Same fail-closed rule.
export const unseenItems = (items, clicked) =>
  !clicked ? [] : items.filter((n) => isGated(n) && !clicked.has(refOf(n)));
// The type-tabs that still hold an unseen row — the tab's gold is DERIVED from this, it has no own state.
export const unseenSections = (items, clicked) => new Set(unseenItems(items, clicked).map(sectionOf));
// What to persist for a set: the currently-unlocked gated refs that are in it (prunes stale/relocked refs).
export const prune = (gated, set) => gated.filter((r) => set.has(r));

// The whole bootstrap decision, pure: given what is unlocked+gated now (`refs`), the rows a NEW gate kind
// just gated (`absorb`, see absorbRefs) and the two stored baselines (`Set` or null = never primed), return
// what each baseline should become. shop.js only does the localStorage I/O around this.
//   • no baseline at all → adopt everything unlocked (the first-sight rule: gear unlocked before this device
//     ever saw the player is not "new").
//   • a stored `seen` but no `clicked` (every device from before the key split) → seed `clicked` FROM `seen`,
//     so a pending menu marker always has matching gold in the shop instead of dead-ending on its first step.
//   • an existing baseline → fold in `absorb` and PRUNE to what is unlocked now. Pruning is what re-arms the
//     markers after a progress reset relocks their rows; it must happen for BOTH keys on every prime, not
//     only when a row is clicked, or a reset player who reopens the shop without clicking keeps a stale
//     `clicked` set and re-earning the tier lights the menu marker with no gold behind it.
export function primeSets({ refs, absorb = [], seen = null, clicked = null }) {
  const rebase = (cur) => prune(refs, new Set([...cur, ...absorb]));
  return {
    seen: seen === null ? refs : rebase(seen),
    clicked: clicked === null ? (seen === null ? refs : rebase(seen)) : rebase(clicked),
  };
}
