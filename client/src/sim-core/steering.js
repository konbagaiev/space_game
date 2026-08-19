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

// Keyboard thrust resolution for the PLAYER: forward-only. Returns
//   { thrust, brake } — `thrust` a NON-NEGATIVE multiplier of the ship's acceleration, `brake` a flag
// asking for the kinematic decel that bleeds speed toward 0.
//
// There is deliberately no reverse (DECISIONS §113): touch steering can only push forward
// (`touchAim.thrust` is 0..1), so a keyboard reverse thruster was a platform-exclusive ability — and it let
// a player kite backwards while firing forward, which is the combat balance it broke. S/↓ brakes instead.
//
// Forward wins over brake when both are held, so W+S is a plain accelerate rather than a self-cancelling
// tug-of-war whose outcome depends on the tick order.
export function keyboardThrust(keys) {
  const forward = !!(keys['KeyW'] || keys['ArrowUp']);
  return { thrust: forward ? 1 : 0, brake: !forward && !!(keys['KeyS'] || keys['ArrowDown']) };
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

// Index of the BEST-AIMED target whose HULL overlaps a forward cone (half-angle, radians), or -1 if none.
// All args are plain XZ: `from` {x,z} (muzzle), `fwd` {x,z} UNIT nose direction, `targets` array of
// {x,z,r} — `r` is the target's world hull radius (its enclosing sphere; omitted/0 = a bare point).
//
// Targets are SPHERES, not points: a target counts as in-cone when any part of its hull is, so a wing
// clipping the cone edge engages the assist even though the ship's CENTRE sits outside it. The old
// centre-only test treated every ship as a zero-size dot, which is why shots could graze a wing with no
// correction at all — the bullet only ever hit because the wing wandered into the line of fire.
//
// Exact sphere-vs-cone, trig-free in the loop: at axial distance `along` the cone's radius is
// `along·tan(half)`, and a sphere of radius r reaches `r/cos(half)` further out laterally, so the hull
// overlaps iff the centre's lateral offset is within their sum. tan/cos are hoisted out of the loop, so
// this costs LESS per candidate than the old normalize-and-dot. Half-angle is clamped below 90° (every
// real caller passes a few degrees) to keep tan finite.
//
// The winner is the BEST-AIMED candidate, not the nearest: `score` is the angular gap between the aim axis
// and the hull's near EDGE (negative once the axis is inside the hull), so a ship you are pointing straight
// at outranks a nearer one that merely clips the cone with a wingtip. Distance only breaks a score tie.
// Nearest-wins was safe while the cone was a 2° needle that at most one ship could occupy; with hull radii
// several ships qualify at once, and ranking by distance would let a closer bystander STEAL fire from the
// ship the player is actually aiming at.
//
// Deterministic — no RNG. Used by projectiles.js findBulletAimTarget to pick a bullet's auto-aim target.
export function nearestInConeIndex(from, fwd, targets, halfAngle) {
  const half = Math.min(halfAngle, Math.PI / 2 - 1e-3);
  const tan = Math.tan(half), invCos = 1 / Math.cos(half);
  let best = -1, bestScore = Infinity, bestD = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const dx = targets[i].x - from.x, dz = targets[i].z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;                       // co-located → skip (matches findTargetInSector)
    const along = fwd.x * dx + fwd.z * dz;        // axial distance (fwd assumed unit)
    if (along <= 0) continue;                     // hull centre sits beside or behind the muzzle
    const perp = Math.sqrt(Math.max(0, d * d - along * along)); // lateral offset from the cone axis
    const reach = (targets[i].r || 0) * invCos;   // how far the hull sphere reaches off its own centre
    if (perp > along * tan + reach) continue;     // hull clears the cone entirely
    const score = (perp - reach) / along;         // ≈ angle from the axis to the hull's near edge
    if (score < bestScore || (score === bestScore && d < bestD)) { best = i; bestScore = score; bestD = d; }
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
