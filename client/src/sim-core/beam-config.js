// The Charged beam's loadout swap: what `?beam` does to a ship's mounts.
//
// It lives in host-neutral `sim-core` for one reason — **a netsim ROOM has to apply the same swap.** `?beam`
// was a client-only transform, and in a room that produced a ship the two ends disagreed about: the server
// built the player from the account's real loadout (a machine gun) while the browser built its own copy with
// the beam mounted, so the green aiming sight and the reticle were drawn over a ship that was actually
// firing a kinetic. The sight was not lying about the code; it was lying about what the AUTHORITY thought
// the player was armed with. A server cannot read `location.search`, so the pure half of the swap has to sit
// where both hosts can import it (the client cannot import from `server/` — DECISIONS §136).
//
// NON-MUTATING, and that is load-bearing on both ends: in the browser the caller may be the account's live
// `G.activeShip.loadout`, and in a room it is the row just read out of the database. Returns a NEW loadout.
export const BEAM_WEAPON_ID = 12;

// Swap every GUN mount onto the Charged beam. Unconditional — the FLAG lives in `beam-dev.js`, which is the
// browser's concern; a room is told `beam=1` on the handshake instead. A loadout with no gun mount comes
// back with its mounts unchanged (still a new object).
export function withBeamGun(loadout) {
  if (!loadout) return loadout;
  const mounts = (loadout.mounts || []).map((m) =>
    m.group === 'gun' ? { ...m, weapon: BEAM_WEAPON_ID } : m);
  return { ...loadout, mounts };
}
