// ?beam — DEV ONLY: fly the Charged beam before you can afford one.
//
// The weapon is gated at `level-4` and costs 5500 credits, so neither an early playable build nor the
// headless scenario (`visual/scenarios/39-charge-beam.mjs`) can reach it through the shop. This flag mounts
// it on the PLAYER in place of whatever is in the gun slot — nothing more.
//
//   ?beam / ?beam=1 / ?beam=true   the player carries the beam (trigger: Space, as the gun was)
//   ?beam=0 | false | off          off (and no `beam` param at all is off)
//
// Compose it with the existing `level` param the same way `?ally` does — `?beam&level=4` flies Level 4.
//
// NOT STICKY (the §81 rule `dev.js` follows): the URL alone decides and nothing is stored. With the flag
// absent nothing here runs, no ship carries a beam, `isBeamGroup` is false for every group in the game and
// the simulation is byte-identical to main (DECISIONS §73).
//
// NO ENEMY HALF. The spike had `?beam=enemy`; arming a hostile is deferred behind the gate in DECISIONS
// §135 (the hostile SIGHT has to exist first — an aiming line the player never sees is not a warning, it is
// an unfair attack), so there is deliberately nothing here to turn it on with.
//
// NO TUNING PANEL. The behaviour numbers live in the weapon row and the look values are baked constants;
// both are settled. `lil-gui` must not become a shipped import.
//
// IT CHANGES THE FIGHT, so — exactly like `?ally` — a campaign session recorded with it on will re-simulate
// into a divergence in `server/tools/verify-sessions.mjs`. Expected for a dev flag, not a bug.

const BEAM_WEAPON_ID = 12;

// Pure + storage-free, so it is unit-testable without a DOM: the URL alone decides.
// Returns `true` (the player carries it) or `null` (off).
export function evalBeamDev(search) {
  const v = new URLSearchParams(search || '').get('beam');
  if (v == null) return null;
  if (v === '0' || v === 'false' || v === 'off') return null;
  return true;
}

// Resolved LAZILY on first ask, not at import time: the flag is read from the ship builder, which runs at a
// point in the boot this module must not have to be ordered against.
let CFG;
export function beamDev() {
  if (CFG === undefined) CFG = evalBeamDev(typeof location === 'undefined' ? '' : location.search);
  return CFG;
}
// Test seam: force the parsed config (pass null for "flag off").
export function setBeamDev(cfg) { CFG = cfg; }

// Swap a loadout's GUN mount onto the beam. Returns a NEW loadout object — the caller's (which may be the
// account's live `G.activeShip.loadout`) is never mutated, so turning the flag off restores the real ship
// without a reload having to undo anything. With the flag off the SAME object comes straight back out: a
// strict no-op for every real player.
export function beamLoadout(loadout) {
  if (!beamDev() || !loadout) return loadout;
  const mounts = (loadout.mounts || []).map((m) =>
    m.group === 'gun' ? { ...m, weapon: BEAM_WEAPON_ID } : m);
  return { ...loadout, mounts };
}
