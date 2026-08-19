// Simulation constants that both the sim and the renderer need — kept THREE-free so `sim-core/` can own
// them and the client can import the same value instead of repeating a literal.

// Uniform world scale applied to EVERY ship group (ship-factory.makeShip). The arena is viewed from far
// away, so ships are drawn larger than their model units; this factor is folded into the ship's world
// transform, which means it is NOT cosmetic — collision half-extents and the muzzle offset scale with it
// (see collision.js shipMatrix / ship-build.js fireMount). A ship's full world scale is
// SHIP_GROUP_SCALE × its per-model `sizeScale`, and the warp-in animation multiplies that by its growth
// factor (entity.scale carries the current value).
export const SHIP_GROUP_SCALE = 1.8;
