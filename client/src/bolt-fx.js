// Kinetic "energy bolt" look for gunfire — replaces the flat opaque bullet sphere with a glowing,
// travel-aligned additive bolt (hot core + soft glow), read face-on by the near-top-down camera.
// One shared glow texture (uploaded once) + one shared unit quad; each bolt is a single Mesh with its
// own tint material (disposed on bullet despawn, like the old sphere). One draw call per shot — no
// costlier than the sphere it replaces, just prettier. Pure factory: the caller adds it to the scene.
import * as THREE from 'three';

// ---- Tunables (edit + reload to retune live) ----
const BOLT_LEN = 2.4;   // world length along the travel direction
const BOLT_WID = 0.7;   // world width across it (narrower = tighter tracer, less "fat oval")

// ---- Shared texture: a crisp bright capsule core with a hard-ish edge, wrapped in a faint soft halo.
// Two layers on additive blend → a clearly outlined bolt body + a thin fog rim (tinted per bolt). ----
let tex = null;
function boltTexture() {
  if (tex) return tex;
  const W = 200, H = 64, cx = W / 2, cy = H / 2;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // 1) Soft halo — a faint wide glow squashed into an ellipse (the "fog rim" around the body).
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, H / W);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, W / 2);
  halo.addColorStop(0.0, 'rgba(210,230,255,0.42)');
  halo.addColorStop(0.5, 'rgba(200,225,255,0.14)');
  halo.addColorStop(1.0, 'rgba(200,225,255,0.0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, W / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2) Crisp bright core — a near-opaque white capsule with rounded ends and a sharp contour.
  const coreLen = W * 0.60, coreH = H * 0.44, r = coreH / 2;
  ctx.fillStyle = 'rgba(255,255,255,1.0)';
  ctx.beginPath();
  ctx.roundRect(cx - coreLen / 2, cy - coreH / 2, coreLen, coreH, r);
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
