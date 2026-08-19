// Plain 3-component vector for SIMULATION state — the THREE-free replacement for THREE.Vector3.
//
// Why this exists: entity transforms used to live inside Three.js objects (`entity.mesh.position`,
// `new THREE.Vector3()` velocities), which meant nothing could step the sim without a WebGL scene graph.
// `sim-core/` is the one implementation of the game's rules and must import no `three`, no DOM, no fetch —
// so it needs its own vector. See docs/plans/server-authoritative-sim.md (Slice A).
//
// The method NAMES and semantics deliberately mirror the subset of THREE.Vector3 the sim actually used, so
// the sim code reads the same after the move and a Vec3 can be handed to a THREE call that only reads
// x/y/z (e.g. `camera.position.copy(player.pos)`, `mesh.position.copy(v)`). The reverse also works: every
// method here reads only `.x/.y/.z` off its argument, so passing a real THREE.Vector3 in is fine. That
// two-way duck-typing is what lets the renderer and the sim meet without either importing the other.
//
// **The limit of that duck-typing — read this before handing a Vec3 to a THREE API.** It works for anything
// that only READS `.x/.y/.z` (`Vector3.copy`, `Matrix4.compose`, `BufferAttribute.setXYZ`, …). It does NOT
// work for THREE APIs that TYPE-TEST or call Vector3 methods we don't have:
//   • `Object3D.lookAt(v)` branches on `v.isVector3` and otherwise falls through to
//     `set(v, undefined, undefined)` → a NaN quaternion, nothing rendered, and NO error thrown. Pass
//     components: `camera.lookAt(p.x, p.y, p.z)`.
//   • `.project(camera)` / `.applyMatrix4()` / `Object3D.worldToLocal()` need a real `THREE.Vector3`.
// We deliberately do NOT set `isVector3 = true` here: that would claim the whole Vector3 API and turn this
// loud, findable boundary into a silent one somewhere further out.
//
// Mutating methods return `this` (chainable), matching THREE.
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }

  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }

  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / s); }

  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }

  // Zero-safe, like THREE: normalizing a zero vector leaves it at zero instead of producing NaN.
  normalize() { return this.divideScalar(this.length() || 1); }
  // Zero-safe too: a zero vector has no direction, so there is nothing to stretch to `l`.
  setLength(l) { return this.normalize().multiplyScalar(l); }

  distanceTo(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

// Convenience constructor so call sites read `vec3(x, y, z)` where a literal is clearer than `new`.
export const vec3 = (x, y, z) => new Vec3(x, y, z);
