# Hitbox fit — research notes (mesh → collision primitives)

Research for replacing the crude axis-slice sphere fitter (`scripts/assets-hitspheres.mjs`), which
produces "a ball with bulges" because a per-cross-section sphere can't represent a non-convex winged
hull. Deep-research run 2026-07-04 (24/25 claims survived 3-vote adversarial verification).

## Algorithm families (established, "solved" problem)

| Family | Fit on non-convex (wings/gaps) | Sphere count | Node/JS ready? |
|---|---|---|---|
| **Medial-axis sphere-tree** — Bradshaw & O'Sullivan 2004 (canonical) | Good — follows the skeleton | ~order-of-magnitude fewer than naive | **No** — C++ (SphereTree) / Python (Foam) only |
| **Variational sphere-set** — Wang et al. 2006 | Tighter than medial-axis | ~half of medial-axis | **No** — C++ CLI only |
| **ProtoSphere** — Weller & Zachmann 2010 | Good, any representation | dense | **No** — CUDA/GPU |
| **Approx. convex decomposition** — V-HACD / CoACD → bound each part | Good — parts capture wings; CoACD preserves gaps | few parts | **V-HACD: yes** — `vhacd-js` (WASM, headless Node, zero runtime deps). CoACD: no good Node port |
| **Voxel + discrete medial axis (HDMA)** | Loose at coarse levels | many for tight fit | No — needs voxelization + niche tooling |
| `three-mesh-bvh` | — | — | Does NOT generate sphere sets (only BVH queries) — not applicable |

## ROI verdict (the important part for an arcade shooter)

Dense sphere packing is **overkill** for a non-physics arcade game. The textbook practice (Ericson,
*Real-Time Collision Detection*) is **match the primitive to the geometry**:
- **Sphere** — cheapest (~4 scalars), but a poor fit for elongated/winged hulls → many false-positive hits (this is our "big ball" problem).
- **Capsule** (swept sphere) — **fits an elongated hull far better**, still nearly as cheap (a sphere test + point-to-segment distance). Best accuracy-per-effort for a fighter fuselage; a 2nd capsule across the wing span captures wings.
- **OBB** — tighter still, but costlier to test.
- **Convex hull** — for genuinely convex parts.

Runtime note: our narrow phase is a **moving point** (bullet/rocket) vs the ship. Point-vs-capsule =
point-to-segment distance ≤ radius — cheap and THREE-free, same class as our current point-in-sphere.

## Recommendation

The sweet spot is **capsules**, not more/denser spheres. Two ways to author them offline:
1. **`vhacd-js` decomposition → one capsule (or sphere) per near-convex part.** Principled; parts give wings/fuselage separately. Dep is **offline/build-time only** (never shipped to the browser), so the "unmaintained dep" risk is low — it either generates good data or we discard it. Caveat: a bounding *sphere* per flat wing is still loose (wings are thin) → prefer a capsule/OBB per part.
2. **Simple axis-based capsule heuristic** — fit one capsule along the longest axis (fuselage) + one along the wing span, from the mesh vertices directly. No new dep at all; fully in our control (DECISIONS §30).

Either way the **runtime changes** from point-in-sphere-set to point-in-(sphere|capsule)-set — a small, cheap addition to `collision.js`, and the `hitSpheres` data schema gains a capsule variant (segment + radius).

## Open questions to settle before/while planning the rework
- What decomposition quality does `vhacd-js` actually give on OUR low-poly winged `.glb`s? (quick offline spike: decompose one ship, eyeball parts + count.)
- Is per-part **capsule** enough, or do a couple of ships need >1 primitive per part?
- For gaps between wings — does gameplay need the concavity represented at all, or are occasional false-positive hits in the gap fine for an arcade shooter? (If fine, a 2-capsule hand/auto fit is plenty and simplest.)

## Key citations
- Bradshaw & O'Sullivan 2004, *Adaptive Medial-Axis Approximation for Sphere-Tree Construction* — https://dl.acm.org/doi/10.1145/966131.966132
- Wang et al. 2006, *Variational Sphere Set Approximation* — https://doi.org/10.1007/s00371-006-0052-0 · impl https://github.com/111116/sphere-set-approximation
- V-HACD — https://github.com/kmammou/v-hacd · **vhacd-js** — https://www.npmjs.com/package/vhacd-js
- CoACD (SIGGRAPH 2022) — https://colin97.github.io/CoACD/
- Foam (medial-axis, wraps SphereTree) — https://github.com/CoMMALab/foam · https://arxiv.org/abs/2503.13704
- Multi-sphere / glued-sphere collision — https://arxiv.org/pdf/1903.10281
- Primitive selection (Ericson-derived) — https://www.gamedevs.org/uploads/geometric-primitives-proximity-detection.pdf
