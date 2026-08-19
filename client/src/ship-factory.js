// Ship factory: builds the primitive placeholder ship and swaps in the DB-sourced .glb model.
// A ship's 3D model comes from the DB (ships.model_url): null = the built-in primitive ship.
// makeShip builds the primitive immediately (shown while a model loads, and as a fallback), then
// applyShipModel swaps in the .glb. The exported assets bake the color in, so we load with tint off.
// Our ships face +Z; a model whose nose points elsewhere is corrected at load time by `yaw` (radians),
// authored per-ship in the seed as `stats.model.yaw` (e.g. Math.PI for a model facing -Z). This is a
// runtime normalization, just like the auto center/scale — see docs/plans/adding-a-ship-model.md.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BULLET_PLANE_Y, G } from './state.js'; // the canonical combat plane every ship group sits on
import { scene, renderer, camera } from './engine.js'; // needed to warm a freshly parsed model onto the GPU
import { SHIP_GROUP_SCALE } from './sim-core/consts.js'; // the group's uniform world scale is SIM state (hitboxes + muzzle scale with it)

// Per-ship model-presentation config (stats.model), with back-compat for the old loose keys
// (stats.modelYaw / stats.sizeScale) so a stale player_ships row or cache can't break.
export const shipModelCfg = (s) => {
  const m = s.model || {};
  // `lift` (group-local +Y, pre-scale) raises BOTH the visual model (applyShipModel) and the hitboxes
  // together. Bullets fly in the fixed BULLET_PLANE_Y plane, which is the group origin (group-local y=0).
  // A model whose bounding-box center sits above its hull leaves the nose/deck below that plane, so shots
  // pass over it (see enemy_3). We fix this by moving the MODEL onto the plane, never the bullets: lift
  // slides the hull up into the bullet plane, and visual + hitboxes stay in lockstep by sharing this value.
  const lift = m.lift ?? 0;
  const raw = m.hitBoxes ?? null;
  const hitBoxes = (raw && lift)
    ? raw.map((b) => ({ ...b, c: { x: b.c.x, y: b.c.y + lift, z: b.c.z } }))
    : raw;
  return {
    yaw: m.yaw ?? s.modelYaw ?? 0,
    scale: m.scale ?? s.sizeScale ?? 1,
    scaleMul: m.scaleMul ?? 1,
    lift,                       // group-local +Y offset applied to the visual model + hitboxes (top-down aim fix)
    muzzle: m.muzzle ?? null,   // group-local +Z override for the projectile spawn (null → auto from glb bounds)
    exhaust: m.exhaust ?? null, // group-local −Z override for the exhaust spawn (null → auto from glb bounds)
    hitBoxes,                   // per-part OBB hitbox (group-local noseZ frame, lift-adjusted); null → single-sphere fallback
    broadR: m.broadR == null ? null : m.broadR + Math.abs(lift), // grow the broad sphere so lifted boxes stay enclosed
  };
};

// Build the spec applyShipModel/makeShip consume from a resolved shipModelCfg (mc). null url → primitive.
export const modelSpec = (url, mc = {}) => (url
  ? { url, tint: false, yaw: mc.yaw ?? 0, scaleMul: mc.scaleMul ?? 1, lift: mc.lift ?? 0, muzzle: mc.muzzle ?? null, exhaust: mc.exhaust ?? null }
  : null);

export const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder); // so meshopt-compressed glbs (hangar high-poly) load; combat glbs are uncompressed
export const SHIP_MODEL_LEN = 3.4; // auto-normalize a model's longest axis to ~ the primitive ship's footprint

// ---------- Parsed-model cache: fetch + parse a ship glb ONCE, then every spawn is a clone ----------
// `applyShipModel` used to call gltfLoader.load on EVERY spawn. The bytes came from the browser cache, but
// three.js still re-ran the whole pipeline each time: new BufferGeometry, a fresh texture decode and GPU
// upload, and therefore one VRAM copy per enemy instance. On a weak phone that stalled the frame at each
// spawn (field telemetry: a single 864 ms frame and 242 ms of `js.render` inside one second, with `draws`
// visibly climbing as the scene assembled mid-fight) and the model often arrived so late that an enemy
// lived its whole life as the placeholder primitive. Same fix, same shape as drops.js's rewardModelCache.
//
// `clone(true)` shares geometry AND materials with the template, which is what we want: one GPU copy per
// ship type. Safe because nothing mutates a live ship's materials — the two places that would (the `tint`
// recolor and the ghost-battle darken/fade) clone the material themselves first, and a dead enemy only
// disposes its attached exhaust plume, never the model (sim.js).
// entry = { scene, waiters }. The template `scene` is never added to the scene graph itself.
const shipModelCache = new Map();

// Parsing the glb is only HALF the cost. three.js uploads geometry + textures to the GPU and compiles the
// material's shader program LAZILY — the first time the object is actually drawn. So warming a model at
// level start still left the frame to pay for it the first time that ship TYPE appeared in a fight: field
// telemetry from a weak phone caught **215 ms inside `js.render`** on such a frame, which is what the
// player feels as "the game freezes for a second when a new ship shows up".
//
// So finish the job here: park the template far off-camera in the REAL scene (the program depends on the
// scene's lights/fog, so compiling it in a bare throwaway scene would produce a different program and get
// recompiled anyway), let `renderer.compile` build the programs, and push each texture up explicitly —
// `compile()` handles shaders, not texture uploads. Mirrors `prewarmShaders()` in main.js, which does the
// same for the FX materials at startup but runs long before any ship model exists.
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];
function warmModel(root) {
  try {
    const holder = new THREE.Group();
    holder.position.y = -100000; // compile ignores culling; this only guards against a stray rendered frame
    holder.add(root);
    scene.add(holder);
    renderer.compile(scene, camera);
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        for (const slot of TEX_SLOTS) if (m[slot]) renderer.initTexture(m[slot]);
      }
    });
    holder.remove(root);      // hand the template back unparented — clones are what ever reach the scene
    scene.remove(holder);
  } catch { /* best-effort: a warm failure must never cost us the model itself */ }
}

export function requestShipModel(url, cb) {
  let entry = shipModelCache.get(url);
  if (entry) {                                     // already parsed, or a load is in flight
    if (entry.scene) { if (cb) cb(entry.scene.clone(true)); }
    else if (cb) entry.waiters.push(cb);
    return;
  }
  entry = { scene: null, waiters: cb ? [cb] : [] };
  shipModelCache.set(url, entry);
  G.pendingAssets++; // hold the level-load veil up until this model is here (DECISIONS §84)
  gltfLoader.load(url, (gltf) => {
    entry.scene = gltf.scene;
    warmModel(entry.scene); // compile + upload NOW, not on the first frame this ship type is drawn
    for (const w of entry.waiters) w(entry.scene.clone(true));
    entry.waiters.length = 0;
    G.pendingAssets--;
  }, undefined, (err) => {
    console.warn('Ship model failed to load, keeping primitive:', url, err);
    shipModelCache.delete(url); // drop the entry so a later spawn can retry
    entry.waiters.length = 0;
    G.pendingAssets--; // a failure must not wedge the veil
  });
}

// Warm a model before it is needed (level start) so the FIRST spawn of a type is a clone, not a parse.
export const preloadShipModel = (url) => { if (url) requestShipModel(url, null); };

// Diagnostic for the ?debug hooks / headless guards: how many distinct glbs have been parsed.
export const shipModelCacheSize = () => shipModelCache.size;

// Load a .glb and swap it in for the placeholder primitive, keeping the SAME group object (all
// gameplay logic keeps referencing it). The model is auto-centered, scaled to a consistent size,
// optionally recolored, and oriented. Falls back to the primitive on error.
function applyShipModel(group, spec, color) {
  const cfg = (typeof spec === 'string') ? { url: spec } : spec;
  const { url, yaw = 0, tint = true, scaleMul = 1, lift = 0, muzzle = null, exhaust = null,
    opacity = null, darken = 0 } = cfg; // opacity/darken: ghost-battle readability treatment (real ships pass neither)
  requestShipModel(url, (model) => {
    // `model` is a fresh clone of the cached template — safe to scale/recenter/re-parent per instance.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (SHIP_MODEL_LEN / (Math.max(size.x, size.y, size.z) || 1)) * scaleMul;
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s); // recenter at the group origin
    if (tint) model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.color && m.color.set(color));
      }
    });
    // Ghost-battle readability treatment: darken + fade + fog so the ghost skirmish reads as distant decor.
    // Guarded by truthiness → real ships (which pass neither key) are byte-unaffected. Clones each material
    // so the darken/opacity don't leak onto other instances sharing the glb's cached materials.
    if (opacity != null || darken) model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (darken && m.color) m.color.multiplyScalar(darken);
          if (opacity != null) { m.transparent = true; m.opacity = opacity; }
          m.fog = true;
        });
      }
    });
    const pivot = new THREE.Group(); // rotate the centered model without disturbing its centering
    pivot.rotation.y = yaw;
    pivot.position.y = lift; // top-down aim fix: raise the model (group-local +Y) to match its lifted hitboxes
    pivot.add(model);
    // Cache the model's real forward/back extent (group-LOCAL units) so muzzle flashes + exhaust spawn AT
    // the nose / engines, not at a fixed offset tuned for the old primitive. Measure NOW, while `pivot` has
    // no parent — so its world matrix == its local matrix. Measuring after attaching to the live group
    // would fold in the group's 1.8×sizeScale scale AND the ship's world position (enemies spawn far from
    // origin!) → spawn points drift hundreds of units off the model. fireMount/emitExhaust re-apply the
    // mesh's world scale themselves.
    pivot.updateMatrixWorld(true);
    const lbox = new THREE.Box3().setFromObject(pivot);
    // Spawn points auto-derive from the glb's local bounds; a per-ship muzzle/exhaust override (group-local
    // units, like the primitive's ±1.6) wins when the auto tip is off (e.g. a long antenna or swept-back fin).
    group.userData.noseZ = muzzle ?? lbox.max.z; // forward (+Z) tip, group-local
    group.userData.tailZ = exhaust ?? lbox.min.z; // rear (−Z) tip
    const host = group.userData.bankGroup || group; // primitives + model live in the rolling group
    for (let i = host.children.length - 1; i >= 0; i--) { // drop the placeholder primitive
      const c = host.children[i];
      host.remove(c);
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    host.add(pivot);
  }); // a failed load logs + keeps the placeholder primitive inside requestShipModel
}

export function makeShip(color, model = null) {
  const g = new THREE.Group();
  const bank = new THREE.Group();         // inner group: holds the visual model, rolls about the nose (+Z)
  g.add(bank);
  g.userData.bankGroup = bank;            // gameplay still references g; the bank group is for cosmetics only
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 });
  // hull (nose points in +Z)
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 12), mat);
  body.rotation.x = Math.PI / 2;
  bank.add(body);
  // wings
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 1.0), mat);
  wing.position.z = -0.4;
  bank.add(wing);
  // engine glow
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 10, 10),
    new THREE.MeshBasicMaterial({ color })
  );
  glow.position.z = -1.6;
  bank.add(glow);
  g.position.y = BULLET_PLANE_Y; // sit the group on the canonical combat plane (bullets fly here)
  g.scale.setScalar(SHIP_GROUP_SCALE); // larger - the arena is far away, otherwise ships look tiny
  g.userData.noseZ = 1.6;  // muzzle/forward spawn (group-local: primitive cone nose) — replaced by the
  g.userData.tailZ = -1.6; // exhaust/rear spawn (primitive engine glow) — real glb bounds in applyShipModel
  if (model) applyShipModel(g, model, color); // optionally replace the primitive with a .glb
  return g;
}
