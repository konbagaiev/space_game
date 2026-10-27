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
// BOTH FLAGS CHANGE THE FIGHT, so — exactly like `?ally` — a campaign session recorded with either on carries
// the whole fight spec in `trace.room` (`{ kind:'dev', lancer?, beam? }`), and its `loadout` carries the beam
// itself: ▶ play and the headless replay rebuild the fight that was flown, and the row reads `dev:level-N`
// (unverifiable, not "disagree" — DECISIONS §170).
//
// WHERE THE FLAGS ARE APPLIED: nowhere in this file. The parsers below feed the ONE fight spec
// (`fight-spec-dev.js`); the beam swap is `resolvePlayerBuild` and the lancer pool is `applyFightSpec`, both in
// `sim-core/fight-spec.js`, used by the tab, the room and the referee alike.
import { DEV_LANCER_DEFAULT_PHASE } from './sim-core/lancer-config.js';
import { normalizeLevelName } from './replay.js';

// Pure + storage-free, so it is unit-testable without a DOM: the URL alone decides.
// Returns `true` (the player carries it) or `null` (off).
export function evalBeamDev(search) {
  const v = new URLSearchParams(search || '').get('beam');
  if (v == null) return null;
  if (v === '0' || v === 'false' || v === 'off') return null;
  return true;
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
// boot-ordering trap here. (The fight spec itself — `fight-spec-dev.js` — resolves lazily, because the ship
// builder asks for the beam mid-boot; that covers both the import-time and the lazy shape.)
const LANCER_DEV = evalLancerDev(typeof location !== 'undefined' ? location.search : '');
export function lancerDevLevel() { return LANCER_DEV && LANCER_DEV.level; }
