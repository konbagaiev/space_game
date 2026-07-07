// Dev-only `?hitboxes` wireframe overlay: draws every ship's narrow-phase oriented hit boxes (green) plus
// its enclosing broad-phase sphere (faint), so the auto-fit hitbox can be eyeballed against the model
// in-game. Mirrors the ?debug gate in main.js; inert in normal play. Pooled meshes are reused frame to frame.
import * as THREE from 'three';

export const HITBOXES_DEBUG =
  typeof location !== 'undefined' && location.search.includes('hitboxes');

const _v = new THREE.Vector3();
const _wu0 = new THREE.Vector3();
const _wu1 = new THREE.Vector3();
const _wu2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const boxGeo = new THREE.BoxGeometry(1, 1, 1); // unit box; the per-frame matrix sizes/orients it
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const narrowMat = () => new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, depthTest: false });
const broadMat = () => new THREE.MeshBasicMaterial({ color: 0x224466, wireframe: true, depthTest: false });

const pool = [];      // reusable narrow-phase box wireframes
const broadPool = []; // reusable broad-phase sphere wireframes
let scene = null;

function narrowMesh(i) {
  if (!pool[i]) {
    const m = new THREE.Mesh(boxGeo, narrowMat());
    m.renderOrder = 999; m.visible = false; m.matrixAutoUpdate = false;
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

// Position every pooled wireframe at its box's world center/orientation/extents; hide the leftovers each frame.
export function syncHitBoxes(sc, player, enemies) {
  scene = sc;
  const ships = [];
  if (player && player.alive && player.mesh) ships.push(player);
  for (const e of enemies) if (e.mesh) ships.push(e);

  let ni = 0, bi = 0;
  for (const ship of ships) {
    const s = ship.mesh.scale.x || 1;
    ship.mesh.updateMatrixWorld();
    const mw = ship.mesh.matrixWorld;
    // broad-phase enclosing sphere (faint)
    const bR = (ship.broadR && ship.hitBoxes) ? ship.broadR * s : 2.6 * (ship.sizeScale || 1);
    const bm = broadMesh(bi++);
    bm.position.copy(ship.mesh.position);
    bm.scale.setScalar(bR);
    bm.visible = true;
    // narrow-phase oriented boxes (bright) — primitives have none, only the broad sphere shows
    if (ship.hitBoxes) {
      _nm.getNormalMatrix(mw); // upper-3×3 for rotating the (unit) box axes into world
      for (const b of ship.hitBoxes) {
        const nm = narrowMesh(ni++);
        const wc = _v.set(b.c.x, b.c.y, b.c.z).applyMatrix4(mw); // world center
        _wu0.set(b.u0.x, b.u0.y, b.u0.z).applyMatrix3(_nm).normalize();
        _wu1.set(b.u1.x, b.u1.y, b.u1.z).applyMatrix3(_nm).normalize();
        _wu2.set(b.u2.x, b.u2.y, b.u2.z).applyMatrix3(_nm).normalize();
        _m.makeBasis(_wu0, _wu1, _wu2);
        // scale each basis column by the box's full world side length (2·h·sc)
        const e = _m.elements;
        const sx = 2 * b.h.x * s, sy = 2 * b.h.y * s, sz = 2 * b.h.z * s;
        e[0] *= sx; e[1] *= sx; e[2] *= sx;
        e[4] *= sy; e[5] *= sy; e[6] *= sy;
        e[8] *= sz; e[9] *= sz; e[10] *= sz;
        _m.setPosition(wc);
        nm.matrix.copy(_m);
        nm.visible = true;
      }
    }
  }
  for (let i = ni; i < pool.length; i++) pool[i].visible = false;
  for (let i = bi; i < broadPool.length; i++) broadPool[i].visible = false;
}
