// Kinetic "energy bolt" look for gunfire — replaces the flat opaque bullet sphere with a glowing,
// travel-aligned additive bolt (hot core + soft glow), read face-on by the near-top-down camera.
// One shared glow texture (uploaded once) + one shared unit quad; each bolt is a single Mesh with its
// own tint material (disposed on bullet despawn, like the old sphere). One draw call per shot — no
// costlier than the sphere it replaces, just prettier. Pure factory: the caller adds it to the scene.
import * as THREE from 'three';

// ---- Tunables (edit + reload to retune live) ----
const BOLT_LEN = 3.4;   // world length along the travel direction
const BOLT_WID = 1.15;  // world width across it

// ---- Shared glow texture: an elongated hot-white core fading to a soft rim (tinted per bolt) ----
let tex = null;
function boltTexture() {
  if (tex) return tex;
  const W = 160, H = 48;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, H / W);                 // squash a circular gradient into a W:H ellipse
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, W / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)'); // hot white core (kept white so tint reads as a colored glow)
  g.addColorStop(0.16, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.42, 'rgba(230,240,255,0.55)');
  g.addColorStop(0.75, 'rgba(200,225,255,0.16)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, W / 2, 0, Math.PI * 2);
  ctx.fill();
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const boltGeo = new THREE.PlaneGeometry(1, 1);
const _dir = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _basis = new THREE.Matrix4();

// Build a kinetic bolt mesh tinted by `color`, laid flat on the combat plane with its long axis along
// `vel`. Caller sets position + adds to the scene; velocity is constant so orientation is set once.
export function makeBolt(color, vel) {
  const mat = new THREE.MeshBasicMaterial({
    map: boltTexture(), color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(boltGeo, mat);
  _dir.copy(vel); _dir.y = 0;
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
  _dir.normalize();
  _side.crossVectors(_up, _dir);                 // in-plane perpendicular
  _basis.makeBasis(_dir, _side, _up);            // X=travel, Y=across, Z=up (quad faces the camera)
  m.quaternion.setFromRotationMatrix(_basis);
  m.scale.set(BOLT_LEN, BOLT_WID, 1);
  m.renderOrder = 2;                             // draw over opaque ships/hull (additive, no depth write)
  return m;
}
