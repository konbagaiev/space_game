// Pure math helpers for movement / steering / AI decisions.
// No Three.js, no DOM — unit-testable in Node.
//
// Heading convention matches the game: forward(heading) = (sin h, cos h),
// i.e. heading is measured from +Z toward +X.

// Unit forward direction for a heading, in the XZ plane.
export function headingToDir(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

// Shortest signed angular difference (to - from), normalized to [-PI, PI].
export function shortestAngleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Rotate `current` heading toward `target` by at most `maxStep` (rad), shortest way.
export function steerToward(current, target, maxStep) {
  const d = shortestAngleDelta(current, target);
  return current + Math.sign(d) * Math.min(Math.abs(d), maxStep);
}

// Enemy thrust factor by distance to the player: approach from afar, hold a band,
// back off if too close. Returns a multiplier for thrust (1 / 0.15 / -0.6).
export function enemyThrustFactor(dist, near = 14, far = 22) {
  return dist > far ? 1 : (dist < near ? -0.6 : 0.15);
}

// Is `target` within a forward cone of half-angle `halfAngle`?
// fwd and toTarget are {x,z}; toTarget need not be normalized.
export function inForwardSector(fwd, toTarget, halfAngle) {
  const len = Math.hypot(toTarget.x, toTarget.z);
  if (len < 1e-6) return false;
  const dot = (fwd.x * toTarget.x + fwd.z * toTarget.z) / len;
  return dot >= Math.cos(halfAngle);
}

// Index of the NEAREST target within a forward cone (half-angle, radians), or -1 if none.
// All args are plain XZ: `from` {x,z} (muzzle), `fwd` {x,z} UNIT nose direction, `targets` array of
// {x,z} positions. Ties broken by distance (nearest wins). Deterministic — no RNG. Used by
// projectiles.js findBulletAimTarget to pick a bullet's auto-aim target.
export function nearestInConeIndex(from, fwd, targets, halfAngle) {
  const cos = Math.cos(halfAngle);
  let best = -1, bestD = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const dx = targets[i].x - from.x, dz = targets[i].z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;                       // co-located → skip (matches findTargetInSector)
    const dot = (fwd.x * dx + fwd.z * dz) / d;    // fwd assumed unit; toTarget normalized by /d
    if (dot >= cos && d < bestD) { best = i; bestD = d; }
  }
  return best;
}

// Corkscrew offset for a spiral-rocket warhead around its leader's flight axis.
// axis = leader forward direction (UNIT {x,y,z}); phase = leader.spiralPhase + the warhead's 120° offset.
// Returns a plain {x,y,z} offset of length `radius` in the plane perpendicular to axis. No Three.js.
export function spiralOffset(axis, phase, radius) {
  // Pick a reference not parallel to axis, then build an orthonormal basis (u, w) spanning axis's plane.
  const up = Math.abs(axis.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const u = norm(cross(axis, up));
  const w = norm(cross(axis, u));
  const c = Math.cos(phase) * radius, s = Math.sin(phase) * radius;
  return { x: u.x * c + w.x * s, y: u.y * c + w.y * s, z: u.z * c + w.z * s };
}
