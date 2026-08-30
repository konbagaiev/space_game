// Kinetic "energy bolt" look for gunfire — replaces the flat opaque bullet sphere with a glowing,
// travel-aligned additive bolt (hot core + soft glow), read face-on by the near-top-down camera.
// One shared glow texture (uploaded once) + one shared unit quad; each bolt is a single Mesh with its
// own tint material (disposed on bullet despawn, like the old sphere). One draw call per shot — no
// costlier than the sphere it replaces, just prettier. Pure factory: the caller adds it to the scene.
import * as THREE from 'three';
import { fxColor } from './postfx.js'; // HDR bolt tint: a hue-preserving scalar lift, pinned to 1.0 with no composer (D18)
import { markGlow } from './glow-layer.js'; // a tracer is an intended glow source (the additive overlay in postfx.js)

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

// Build a bolt mesh tinted by `color`, laid flat on the combat plane with its long axis along `vel`.
// `scale` sizes the bolt by weapon class — a heavier class (cannon) fires the SAME bolt, just chunkier.
// Caller sets position + adds to the scene; velocity is constant so orientation is set once.
//
// `look` is ONE SHOT's tracer variation (`tracerLook` in hit-fx-config.js: a per-class base plus a
// Math.random jitter, so no two bolts are clones). `look.len` REPLACES the class scale on the travel axis —
// multiplying them would make a cannon bolt 1.7 x 1.9 long — while the WIDTH keeps riding `scale`, so a
// cannon slug stays as chunky as it is today. `look.bright` scales the additive tint. No `look` (the
// default) is byte-identical to the uniform bolt this replaced.
export function makeBolt(color, vel, scale = 1, look = null) {
  const lenMul = look && look.len != null ? look.len : scale;
  const bright = look && look.bright != null ? look.bright : 1;
  const mat = new THREE.MeshBasicMaterial({
    // Pushed above 1.0 in linear HDR so the bolt clears the bloom threshold and reads as an energy bolt
    // with a real glow rather than a flat bright quad. Scalar → hue preserved (D9).
    map: boltTexture(), color: fxColor(color, 'bolt'), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  if (bright !== 1) mat.color.multiplyScalar(bright); // additive blend: a linear brightness scale
  const m = new THREE.Mesh(boltGeo, mat);
  _dir.copy(vel); _dir.y = 0;
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
  _dir.normalize();
  _side.crossVectors(_up, _dir);                 // in-plane perpendicular
  _basis.makeBasis(_dir, _side, _up);            // X=travel, Y=across, Z=up (quad faces the camera)
  m.quaternion.setFromRotationMatrix(_basis);
  m.scale.set(BOLT_LEN * lenMul, BOLT_WID * scale, 1);
  m.renderOrder = 2;                             // draw over opaque ships/hull (additive, no depth write)
  markGlow(m);                                   // an intended glow source: the overlay re-renders it small + blurred
  return m;
}
