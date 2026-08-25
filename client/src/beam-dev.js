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
// IT REACHES A ROOM. `?beam` is forwarded on the netsim handshake (`beam=1`) and the ROOM applies the same
// pure swap to the loadout it builds the player from, so the server and this tab agree about what is
// mounted. Before that, `?beam` was a browser-only transform: in a room the server flew the account's real
// machine gun while the client drew a beam sight over it — the aiming lines were telling the truth about
// the local copy and lying about the authority. Fixed 2026-08-25, after the maintainer hit it flying
// `?beam&netsim=level-4&lancer&level=4`.
//
// NOT STICKY (the §81 rule `dev.js` follows): the URL alone decides and nothing is stored. With BOTH flags
// absent nothing here runs: the player carries no beam, the beam-armed pirate lancer is in no shipped
// level's spawn pool, `isBeamGroup` is false for every group in the fight, and the simulation is
// byte-identical to main (DECISIONS §73).
//
// THE ENEMY HALF LIVES UNDER ITS OWN PARAM, `?lancer`. DECISIONS §135's gate — the hostile SIGHT and the
// `beamCharge` shooter reference must exist before any enemy is armed — has been PASSED, so `?lancer` now
// injects the beam-armed **pirate lancer** into a level's spawn pool (client-side and in a netsim room):
//
//   ?lancer                    the default phase ('wave-1'), on whatever level this tab was going to fly
//   ?lancer=clear-out          that phase instead
//   ?lancer&level=4            the default phase, on Level 4 — regardless of the account's progress
//   ?lancer=0 | false | off    off (and no `lancer` param at all is off)
//
// THE TWO PARAMS COMPOSE, and are read independently: `?beam&lancer&level=4` is the full test flight (your
// beam against theirs). `?beam` never turns enemies on — any unrecognised `beam` value still means only
// "the player carries it", because the enemy half has its own param.
//
// NO TUNING PANEL. The behaviour numbers live in the weapon row and the look values are baked constants;
// both are settled. `lil-gui` must not become a shipped import.
//
// BOTH FLAGS CHANGE THE FIGHT, so — exactly like `?ally` — a campaign session recorded with either on will
// re-simulate into a divergence in `server/tools/verify-sessions.mjs`. Expected for a dev flag, not a bug.
import { withLancersAt, DEV_LANCER_DEFAULT_PHASE } from './sim-core/lancer-config.js';
import { withBeamGun } from './sim-core/beam-config.js';
import { normalizeLevelName } from './replay.js';

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

// The FLAG-GATED half of the swap: the pure transform is `withBeamGun` in `sim-core/beam-config.js`, so a
// netsim ROOM can apply exactly the same one (a server cannot read `location.search`). Returns a NEW loadout
// object — the caller's, which may be the account's live `G.activeShip.loadout`, is never mutated. With the
// flag off the SAME object comes straight back out: a strict no-op for every real player.
export function beamLoadout(loadout) {
  if (!beamDev() || !loadout) return loadout;
  return withBeamGun(loadout);
}

// ---------- ?lancer: the ENEMY half ----------

// `?lancer[=phase]` (+ the shared `level` param). Pure + storage-free: the URL alone decides.
export function evalLancerDev(search) {
  const p = new URLSearchParams(search || '');
  const v = p.get('lancer');
  if (v == null) return null;
  if (v === '0' || v === 'false' || v === 'off') return null;
  const phase = (v === '' || v === 'true' || v === '1') ? DEV_LANCER_DEFAULT_PHASE : v;
  // Only when the param is actually there: normalizeLevelName(null) is 'level-0', which would drag every
  // bare ?lancer run back to the intro level.
  const level = p.has('level') ? normalizeLevelName(p.get('level')) : null;
  return { phase, level };
}

// Read at IMPORT time, like `?ally` — the level descriptor is fetched later than module load, so there is no
// boot-ordering trap here. (`?beam` above resolves lazily because the ship builder asks for it mid-boot.
// Keep the two shapes as they are — do not unify them.)
const LANCER_DEV = evalLancerDev(typeof location !== 'undefined' ? location.search : '');
export function lancerDev() { return LANCER_DEV; }
export function lancerDevLevel() { return LANCER_DEV && LANCER_DEV.level; }
// A strict no-op with the flag off: the SAME descriptor object comes straight back out.
export function applyLancerDev(descriptor) {
  return LANCER_DEV ? withLancersAt(descriptor, LANCER_DEV.phase) : descriptor;
}
