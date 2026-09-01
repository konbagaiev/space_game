// THE BLAST TIERS + THE SINGLE CLASSIFIER — three-free on purpose.
// It lived in engine-lights.js, which imports three, so nothing could unit-test it. Nothing here touches a
// light, a mesh or the scene: it answers "how bright, how far, how long" and engine-lights does the rest.
//
// A detonation is the one place a light should genuinely overpower everything for a moment, so these peak
// far above an engine and fall off fast (the falloff itself lives in engine-lights.js — quadratic-out, not
// linear: a linear fade reads as a lamp being turned down, while a blast should be gone almost before you
// register it).
import { SHIP_CLASSES } from './sim-core/ship-classes.js';

export const BLAST = {
  // POWER IS IN CANDELA AND FALLS OFF AS 1/d^2, so the useful band is much smaller than it looks: at 10
  // units, power 100 already contributes 1.0 — full white. Dialed on the live test range: HEAVY is the
  // anchor at 2400 and the rest keep the ladder tuned with it (the per-class numbers live in SHIP_CLASSES).
  //
  // The ROCKET detonation. NOT a ship class and must never become a pseudo-class row: it is a weapon's
  // blast, sized from the weapon's own `blastVisual` (see spawnRocketBurst).
  rocket: 400, reachRocket: 30,
  dur: 0.44,            // the BASE flash length, shared; every class multiplies it by its `durMul`
  // FALLBACK ONLY, in sizeScale. Used when a ship carries no resolvable weightClass — an old recorded
  // trace, a netsim payload from an older server, or the ?tune test range faking a hull size by hand.
  // No catalog ship reaches these any more; the class table decides (see blastClass).
  medAt: 1.4, bigAt: 2.2,
};

// THE SINGLE CLASSIFIER. Power, reach and duration all read their tier from here, so a hull can never be
// "medium" for one of them and "small" for another — the kind of drift that makes a later re-tune produce a
// result nobody can explain.
//
// RESOLUTION ORDER, and it is the contract:
//   1. a `weightClass` that resolves to a class row WITH a blast block  → that class;
//   2. else `isBoss` (the entity's role) → heavy: a real boss must never be demoted by a modest scale;
//   3. else the sizeScale thresholds above — the pre-weightClass placeholder, kept for data that predates
//      the field (recorded traces, an older server's wire, the ?tune rig).
// An unknown or blockless class NEVER throws: it simply falls through to 2/3.
export function blastClass(sizeScale = 1, isBoss = false, weightClass = null) {
  const row = weightClass ? SHIP_CLASSES[weightClass] : null;
  if (row && row.blast) return weightClass;
  if (isBoss || sizeScale >= BLAST.bigAt) return 'heavy';
  if (sizeScale >= BLAST.medAt) return 'medium';
  return 'light';
}
const profileOf = (c) => SHIP_CLASSES[c].blast;   // total: blastClass only ever returns a class WITH a block
export function blastPower(sizeScale = 1, isBoss = false, weightClass = null) {
  return profileOf(blastClass(sizeScale, isBoss, weightClass)).power;   // × size² at the call site
}
// REACH, in world units — how far the flash can light anything at all (a HARD cutoff, see engine-lights
// update()). This, not power, is what makes a big detonation feel big: it touches hulls a scout's death
// cannot.
export function blastReach(sizeScale = 1, isBoss = false, weightClass = null) {
  return profileOf(blastClass(sizeScale, isBoss, weightClass)).reach;   // × size at the call site
}
// How long the light lingers, by weight class — a bigger ship burns longer, not just brighter.
export function blastDurMul(sizeScale = 1, isBoss = false, weightClass = null) {
  return profileOf(blastClass(sizeScale, isBoss, weightClass)).durMul;  // × BLAST.dur at the call site
}
