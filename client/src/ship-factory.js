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

// Per-ship model-presentation config (stats.model), with back-compat for the old loose keys
// (stats.modelYaw / stats.sizeScale) so a stale player_ships row or cache can't break.
export const shipModelCfg = (s) => {
  const m = s.model || {};
  return {
    yaw: m.yaw ?? s.modelYaw ?? 0,
    scale: m.scale ?? s.sizeScale ?? 1,
    scaleMul: m.scaleMul ?? 1,
    muzzle: m.muzzle ?? null,   // group-local +Z override for the projectile spawn (null → auto from glb bounds)
    exhaust: m.exhaust ?? null, // group-local −Z override for the exhaust spawn (null → auto from glb bounds)
    hitSpheres: m.hitSpheres ?? null, // auto-fit multi-sphere hitbox (group-local noseZ frame); null → primitive single-sphere fallback
    broadR: m.broadR ?? null,   // enclosing broad-phase radius (group-local); null → legacy 2.6×sizeScale
  };
};

// Build the spec applyShipModel/makeShip consume from a resolved shipModelCfg (mc). null url → primitive.
export const modelSpec = (url, mc = {}) => (url
  ? { url, tint: false, yaw: mc.yaw ?? 0, scaleMul: mc.scaleMul ?? 1, muzzle: mc.muzzle ?? null, exhaust: mc.exhaust ?? null }
  : null);

export const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder); // so meshopt-compressed glbs (hangar high-poly) load; combat glbs are uncompressed
export const SHIP_MODEL_LEN = 3.4; // auto-normalize a model's longest axis to ~ the primitive ship's footprint

// Load a .glb and swap it in for the placeholder primitive, keeping the SAME group object (all
// gameplay logic keeps referencing it). The model is auto-centered, scaled to a consistent size,
// optionally recolored, and oriented. Falls back to the primitive on error.
function applyShipModel(group, spec, color) {
  const cfg = (typeof spec === 'string') ? { url: spec } : spec;
  const { url, yaw = 0, tint = true, scaleMul = 1, muzzle = null, exhaust = null } = cfg;
  gltfLoader.load(url, (gltf) => {
    const model = gltf.scene;
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
    const pivot = new THREE.Group(); // rotate the centered model without disturbing its centering
    pivot.rotation.y = yaw;
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
  }, undefined, (err) => console.warn('Ship model failed to load, keeping primitive:', url, err));
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
  g.position.y = 0.6;
  g.scale.setScalar(1.8); // larger - the arena is far away, otherwise ships look tiny
  g.userData.noseZ = 1.6;  // muzzle/forward spawn (group-local: primitive cone nose) — replaced by the
  g.userData.tailZ = -1.6; // exhaust/rear spawn (primitive engine glow) — real glb bounds in applyShipModel
  if (model) applyShipModel(g, model, color); // optionally replace the primitive with a .glb
  return g;
}
