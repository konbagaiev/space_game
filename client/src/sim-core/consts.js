// Simulation constants that both the sim and the renderer need — kept THREE-free so `sim-core/` can own
// them and the client can import the same value instead of repeating a literal.

// Uniform world scale applied to EVERY ship group (ship-factory.makeShip). The arena is viewed from far
// away, so ships are drawn larger than their model units; this factor is folded into the ship's world
// transform, which means it is NOT cosmetic — collision half-extents and the muzzle offset scale with it
// (see collision.js shipMatrix / ship-build.js fireMount). A ship's full world scale is
// SHIP_GROUP_SCALE × its per-model `sizeScale`, and the warp-in animation multiplies that by its growth
// factor (entity.scale carries the current value).
export const SHIP_GROUP_SCALE = 1.8;

// The canonical combat plane. Every ship group sits on it and every bullet flies in it, which is what makes
// the fight effectively 2-D for collision purposes even though the models are 3-D.
export const BULLET_PLANE_Y = 0.6;

// How long a ship takes to grow from a dot to full size on arrival. This is gameplay, not decoration: while
// it is growing a ship is invulnerable, cannot fire and cannot be homed on (DECISIONS §54). The level runner
// overrides it per spawn with that enemy's stagger interval — "the delay IS the arrival animation".
export const SPAWN_GROW_TIME = 1.0;

// The soft boundary (DECISIONS §2). ARENA is the half-size of the square combat zone, measured from the
// (possibly drifting) arena centre. Flying past it is allowed: the player is WARNED after
// OOB_WARN_DELAY seconds continuously outside, and warped back to the centre after OOB_RETURN_TIME.
export const ARENA = 360;            // 1.5× the original 240 — a bigger combat zone
export const OOB_WARN_DELAY = 2.0;   // seconds outside before the HUD warning shows
export const OOB_RETURN_TIME = 30.0; // seconds outside before the auto warp-back
