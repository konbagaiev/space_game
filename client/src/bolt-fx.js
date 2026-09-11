// Kinetic "energy bolt" look for gunfire — replaces the flat opaque bullet sphere with a glowing,
// travel-aligned additive bolt (hot core + soft glow), read face-on by the near-top-down camera.
// One shared glow texture (uploaded once) + one shared unit quad; each bolt is a single Mesh with its
// own tint material (disposed on bullet despawn, like the old sphere). One draw call per shot — no
// costlier than the sphere it replaces, just prettier. Pure factory: the caller adds it to the scene.
import * as THREE from 'three';

// ---- Tunables (edit + reload to retune live) ----
const BOLT_LEN = 2.4;   // world length along the travel direction
const BOLT_WID = 0.7;   // world width across it (narrower = tighter tracer, less "fat oval")

// THE CANNON ROUND IS A TRACER, NOT A CAPSULE (maintainer, 2026-09-06, from a top-down shooter reference:
// a bright round head with a tail that thins and dims behind it). Every `class: 'cannon'` row — the
// player's Heavy cannon and the Second Boss's Advanced pirate cannon — draws it; kinetic rounds keep the
// capsule. Same single quad, same one draw call: only the texture and the proportions differ. The base
// sizes below are multiplied exactly as the capsule's are — `look.len` (the class's `cannonLen` 1.9 ± jitter)
// on the travel axis and the class `BOLT_SCALE` (1.7) across — so a cannon tracer lands at ~10.5 × 1.0 u.
// The projectile's SPEED is the simulation's (`projectileSpeed` on the weapon row) and is not touched here.
const TRACER = { cannon: { len: 5.5, wid: 0.6 } };

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

// ---- Shared tracer texture: the head is a solid disc at the RIGHT end (u → 1, which the basis below maps
// to the travel direction), wrapped in a soft halo; the tail is a wedge that closes to a point at the left
// end while a gradient fades it to nothing. Canvas aspect ≈ the world aspect (10.5 : 1), so the head stays
// ROUND on screen instead of being stretched into a bar. ----
let tracerTex = null;
function tracerTexture() {
  if (tracerTex) return tracerTex;
  const W = 512, H = 48, cy = H / 2, hx = W * 0.90, hr = H * 0.30;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // 1) The tail: a wedge from the head's shoulders to a point near the left edge, fading along its length.
  const tail = ctx.createLinearGradient(W * 0.02, 0, hx, 0);
  tail.addColorStop(0.0, 'rgba(255,255,255,0.0)');
  tail.addColorStop(0.55, 'rgba(255,255,255,0.30)');
  tail.addColorStop(1.0, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(hx, cy - hr * 0.85);
  ctx.lineTo(W * 0.02, cy);
  ctx.lineTo(hx, cy + hr * 0.85);
  ctx.closePath();
  ctx.fill();

  // 2) A soft halo around the head — the fog rim the capsule has, only at the hot end.
  const halo = ctx.createRadialGradient(hx, cy, 0, hx, cy, H / 2);
  halo.addColorStop(0.0, 'rgba(210,230,255,0.45)');
  halo.addColorStop(0.6, 'rgba(200,225,255,0.12)');
  halo.addColorStop(1.0, 'rgba(200,225,255,0.0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(hx, cy, H / 2, 0, Math.PI * 2); ctx.fill();

  // 3) The head: a solid white disc with a crisp edge.
  ctx.fillStyle = 'rgba(255,255,255,1.0)';
  ctx.beginPath(); ctx.arc(hx, cy, hr, 0, Math.PI * 2); ctx.fill();

  tracerTex = new THREE.CanvasTexture(cv);
  tracerTex.name = 'tracer';
  tracerTex.colorSpace = THREE.SRGBColorSpace;
  tracerTex.needsUpdate = true;
  return tracerTex;
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
//
// `weaponClass` picks the SHAPE: a class in `TRACER` gets the head-and-tail tracer texture and proportions
// (the cannon); anything else — or no class — gets the capsule. The mesh is named `tracer:<class>` or
// `bolt` so a scenario can tell them apart in the scene.
export function makeBolt(color, vel, scale = 1, look = null, weaponClass = null) {
  const tr = weaponClass ? TRACER[weaponClass] : null;
  const lenMul = look && look.len != null ? look.len : scale;
  const bright = look && look.bright != null ? look.bright : 1;
  const mat = new THREE.MeshBasicMaterial({
    map: tr ? tracerTexture() : boltTexture(), color, transparent: true,
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
  m.scale.set((tr ? tr.len : BOLT_LEN) * lenMul, (tr ? tr.wid : BOLT_WID) * scale, 1);
  m.name = tr ? `tracer:${weaponClass}` : 'bolt';
  m.renderOrder = 2;                             // draw over opaque ships/hull (additive, no depth write)
  return m;
}
