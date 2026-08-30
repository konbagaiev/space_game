// THE GLOW LAYER — which objects the additive glow overlay is allowed to see.
//
// The overlay (postfx.js) renders ONLY the objects on this layer into a small offscreen buffer, blurs it,
// and adds the result back over the finished frame. Two things follow from that, and both are the reason
// this exists instead of a full-frame post chain (DECISIONS §138 "the pivot"):
//
//   1. IT IS CHEAP. The glow pass touches a small subset of the geometry (plumes, bolts, beams, muzzle
//      flashes, explosions, rings, the star's corona, a hull while it is being hit) at a FRACTION of the
//      canvas resolution — instead of pushing every pixel of the frame through a chain of full-screen
//      passes.
//   2. "THE DUST MUST NOT GLOW" BECOMES STRUCTURAL, not numeric. The speed field is not on this layer, so
//      no threshold value — and no future re-tint of the dust — can make it bloom. §138(d)'s numeric margin
//      is kept as a second belt, but the layer is the braces.
//
// Deliberately THREE-only (no engine, no state, no graphics import) so any FX module can import it without
// risking a cycle.
import * as THREE from 'three';

// Layer 0 is the default every object renders on; nothing in the game uses 1. Enabling a layer is ADDITIVE —
// a marked object still renders in the normal frame exactly as before.
export const GLOW_LAYER = 2;

// Put `obj` and its whole subtree on the glow layer. Safe to call whether or not an overlay exists (on the
// Performance tier nothing ever renders the layer, and the flag costs a bitmask OR).
export function markGlow(obj) {
  if (obj) obj.traverse((o) => o.layers.enable(GLOW_LAYER));
  return obj;
}

// Take it back off. Used for the transient sources — a hull is on the layer only while its hit flash burns.
export function unmarkGlow(obj) {
  if (obj) obj.traverse((o) => o.layers.disable(GLOW_LAYER));
  return obj;
}

// Diagnostic (visual scenarios / the console): is this object itself on the layer?
const _probe = new THREE.Layers();
_probe.set(GLOW_LAYER);
export const isGlowing = (obj) => !!(obj && obj.layers.test(_probe));
