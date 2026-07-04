// Dev-only `?hitspheres` wireframe overlay: draws every ship's narrow-phase hit spheres (green) plus its
// enclosing broad-phase sphere (faint), so the auto-fit hitbox can be eyeballed against the model in-game.
// Mirrors the ?debug gate in main.js; inert in normal play. Pooled meshes are reused frame to frame.
import * as THREE from 'three';

export const HITSPHERES_DEBUG =
  typeof location !== 'undefined' && location.search.includes('hitspheres');

const _v = new THREE.Vector3();
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const narrowMat = () => new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, depthTest: false });
const broadMat = () => new THREE.MeshBasicMaterial({ color: 0x224466, wireframe: true, depthTest: false });

const pool = [];      // reusable narrow-phase wireframes
const broadPool = []; // reusable broad-phase wireframes
let scene = null;

function narrowMesh(i) {
  if (!pool[i]) {
    const m = new THREE.Mesh(sphereGeo, narrowMat());
    m.renderOrder = 999; m.visible = false;
    pool[i] = m; scene.add(m);
  }
  return pool[i];
}
function broadMesh(i) {
  if (!broadPool[i]) {
    const m = new THREE.Mesh(sphereGeo, broadMat());
    m.renderOrder = 998; m.visible = false;
    broadPool[i] = m; scene.add(m);
  }
  return broadPool[i];
}

// Position every pooled wireframe at its sphere's world center/radius; hide the leftovers each frame.
export function syncHitSpheres(sc, player, enemies) {
  scene = sc;
  const ships = [];
  if (player && player.alive && player.mesh) ships.push(player);
  for (const e of enemies) if (e.mesh) ships.push(e);

  let ni = 0, bi = 0;
  for (const ship of ships) {
    const s = ship.mesh.scale.x || 1;
    ship.mesh.updateMatrixWorld();
    const m = ship.mesh.matrixWorld;
    // broad-phase enclosing sphere (faint)
    const bR = (ship.broadR && ship.hitSpheres) ? ship.broadR * s : 2.6 * (ship.sizeScale || 1);
    const bm = broadMesh(bi++);
    bm.position.copy(ship.mesh.position);
    bm.scale.setScalar(bR);
    bm.visible = true;
    // narrow-phase spheres (bright) — primitives have none, only the broad sphere shows
    if (ship.hitSpheres) {
      for (const hs of ship.hitSpheres) {
        const nm = narrowMesh(ni++);
        _v.set(hs.x, hs.y, hs.z).applyMatrix4(m);
        nm.position.copy(_v);
        nm.scale.setScalar(hs.r * s);
        nm.visible = true;
      }
    }
  }
  for (let i = ni; i < pool.length; i++) pool[i].visible = false;
  for (let i = bi; i < broadPool.length; i++) broadPool[i].visible = false;
}
