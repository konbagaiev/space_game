// The charged beam's LOOK: the aiming sight, the reticle, the charge build-up and the discharge.
//
// This weapon is a LOOK-AND-FEEL feature first (maintainer, 2026-08-25) — it has to be beautiful and it has
// to sound good. Every value in this file was settled by FLYING it (see the plan's §2e); they are the
// maintainer's, arrived at in the air, and are to be reproduced rather than improved.
//
// The sight is THREE lines from the hull: the centre (what the beam fires down) and the two corridor edges
// (the boundary of what a charge can still hit). They are drawn from the ship's CURRENT nose every frame,
// from `sim-core/beam.js corridorEnds` — the SAME three endpoints the hit test uses — so the picture on
// screen IS the hit test, not an illustration of it. That honesty is the whole reason the corridor is
// nose-attached rather than frozen at charge start, and it is why nothing here re-derives geometry.
//
// THE LINES ARE DASHED. A WebGL line is 1 px wide whatever `linewidth` says — it is ignored on essentially
// every platform — so "thinner" is not available and a solid bright line simply reads as HEAVY. Dash
// pattern is the only lever, and it doubles as the charge animation: the dashes FLOW outward as the shot
// builds, so the charge has direction and rhythm instead of only a brightness ramp.
//
// SCOPE: it draws the LOCAL PLAYER's sight AND a pooled HOSTILE sight — the corridor of any enemy that is
// currently charging, in a hostile hue, for exactly the length of its charge (DECISIONS §135's gate). That
// is a RENDERING scope, not a simulation one: `sim-core/beam.js` has no `side === 'player'` test anywhere,
// and the hostile/friendly decision is made HERE, by asking whether the shooter is in `world.enemies`.
//
// All of it is cosmetic and RNG-free, hence replay-neutral (DECISIONS §73).
import * as THREE from 'three';
import { scene } from './engine.js';
import { world } from './state.js';
import { Vec3 } from './sim-core/vec.js';
import { beamMuzzle, corridorEnds, beamGroupOf, beamWeaponOf, beamCandidate, corridorRadOf, chargeTimeOf } from './sim-core/beam.js';

// THE SIGHT IS GREEN, THE SHOT IS BLUE. They shared one blue at first, so the aiming aid competed with the
// discharge it exists to predict. Splitting the hues means a full second of green build-up hands over to a
// blue flash and THE SHOT is what the eye lands on — the sight can sit on screen permanently without ever
// stealing the moment it announces. (The shot was a near-white cyan until 2026-08-26; what matters to the
// split is that the two hues stay far apart, not which blue the shot is.)
const SIGHT_COLOR = 0x5ad17f;
const RETICLE_COLOR = 0xffd24d;
// Bolt glow + muzzle bead — deliberately NOT the sight's hue. Was `0xbfefff`, a near-white cyan; taken
// bluer TWICE on 2026-08-26 at the maintainer's ask (`0x5fb0ff`, then this), so the shot reads as a blue
// laser rather than a white flash. The CORE stays white (§0e: the hot centre is what stops the two
// quads flattening into one patch), and green-vs-blue keeps the sight and the shot distinct, which is the
// split §0e exists to protect.
const CHARGE_COLOR = 0x3d8bff;
// THE DISCHARGE IS GEOMETRY, NOT A LINE — by necessity, not preference. A WebGL line is 1 px wide whatever
// `linewidth` says (ignored on essentially every platform), so a "thicker beam" is simply not expressible
// as a Line and the bolt is built from two additive QUADS instead: a white-hot CORE inside a wider
// coloured GLOW. Widths are in WORLD units so the beam keeps its thickness as the camera zooms.
const BOLT_LIFE = 1.0;              // the trail dims over a full second (maintainer, 2026-08-25)
// THE IMPACT BLOOM IS NOT DRAWN HERE ANY MORE. It used to be a third pooled object — an additive disc
// expanding 0.6 → 5.0 over 0.24 s — which made the beam the one weapon in the game whose hit looked like
// nothing else's. It now rides the `bulletImpact` event like every other weapon, so `sim.js` draws the same
// flipbook mini-blast a bullet does, at the same point, and gets the CYAN shield tint for free (the old
// disc had no way to say "the field stopped it"). Maintainer, 2026-08-26: take the kinetic one for now.
const BOLT_CORE_WIDTH = 0.3;        // world units — the white-hot centre
const BOLT_GLOW_WIDTH = 1.0;        // world units — the coloured halo around it
// The core burns out in the FIRST QUARTER of the fade and only the trail lingers; the glow fades a²
// across the whole second. Split this way it reads as a strike that leaves a trail — a linear fade read
// as a cut, and a core that lasted the full second read as a dissolve.
const BOLT_CORE_FRAC = 0.25;

// ALL THREE LINES CARRY THE SAME COLOUR AND THE SAME OPACITY. The centre first read as "too thick" while
// the edges read correctly — but every WebGL line is the same 1 px, so what read as thickness was a
// brighter colour at a higher opacity. THE CENTRE CAME DOWN TO MEET THE EDGES, not the edges up. The centre
// is still identifiable, by its DASH RHYTHM (long strokes vs the edges' short ticks) — rhythm distinguishes
// without adding visual mass.
const SIGHT_IDLE = 0.22, SIGHT_GAIN = 0.38;   // opacity while aiming, and how much it rises over the charge
const CENTRE_DASH = 2.4, CENTRE_GAP = 1.6;    // centre: long strokes
const EDGE_DASH = 0.7, EDGE_GAP = 1.5;        // edges: short ticks — same weight, different rhythm
const FLOW_IDLE = 3, FLOW_CHARGING = 40;      // dash travel (u/s): a drift while aiming, a rush while charging

// THE HOSTILE SIGHT IS THE PLAYER'S SIGHT IN RED, AND NOTHING ELSE. Maintainer, 2026-08-25: "Change
// nothing. As soon as they start shooting at me, I see all the lines." Same three lines, same dash rhythms,
// same 0.22 + 0.38 opacity ramp — it differs in the hue, and in being CHARGE-ONLY (lines from a hostile hull
// must always mean "a shot is coming right now" — brief §0b Q2). No muzzle bead, no reticle, no marker on
// your ship, no brighter ramp: all proposed, all declined. He will judge it in flight.
//
// KNOWN AND DEFERRED (maintainer, 2026-08-25; it is on the ROADMAP): the dashes do not FLOW while the player
// carries no beam, because `dashPhase` is advanced inside the player's pass, which returns early for a ship
// with no beam group. The pattern is right, it just holds still. One line moved fixes it — but it retimes
// the player's own sight too, so it waits for the live-tuning pass. Do not "fix" it in passing.
const HOSTILE_SIGHT_COLOR = 0xff6b4a;
const HOSTILE_POOL = 4;   // several lancers can charge at once

const BOLT_POOL = 4; // round-robin: a second discharge inside the 1.0 s fade must not cut the first short

// sim-core Vec3, not THREE.Vector3: `beamMuzzle`/`corridorEnds` write into these with sim-core's own vector
// methods, and the point is that the renderer ASKS the simulation where the sight goes.
const _fwd = new Vec3();
const _muzzle = new Vec3();
const _endC = new Vec3();
const _endL = new Vec3();
const _endR = new Vec3();

let sight = null;        // 3 lines (centre + 2 edges)
let reticle = null;      // a diamond around the painted ship
let orb = null;          // energy gathering at the muzzle while charging
let bolts = null;        // pooled discharges: { core, glow, flash, boltLife, flashLife }
let boltNext = 0;
let hostiles = null;     // pooled hostile sights: [{ ship, t, dur, centre, left, right }]
let dashPhase = 0, spin = 0;

// The charge, as the FX knows it. Driven by the `beamCharge` EVENT rather than read off the fire group,
// because in a netsim room the local World's group is never ticked — the event is the only thing that
// arrives (the ship keeps its `groups`, but nothing advances `g.charge`). Locally the two agree tick-for-tick.
const chargeFx = { t: 0, dur: 0, active: false };

// ---------- pooled objects ----------
function makeLine(color, opacity, name, dashed, dashSize, gapSize) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  geo.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(2), 1));
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize, gapSize })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.visible = false;
  line.name = name; // so a headless scenario can assert on THESE objects, not on "some line in the scene"
  scene.add(line);
  return line;
}

// A flat additive disc in the combat plane. The charge bead and the impact bloom are the same shape at
// different sizes — no texture needed: additive blending on a disc reads as a glow against space.
function makeDisc(color, name) {
  const geo = new THREE.CircleGeometry(1, 24);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.frustumCulled = false;
  m.visible = false;
  m.name = name;
  scene.add(m);
  return m;
}

function ensureSight() {
  if (sight) return sight;
  sight = {
    centre: makeLine(SIGHT_COLOR, SIGHT_IDLE, 'beamSightCentre', true, CENTRE_DASH, CENTRE_GAP),
    left: makeLine(SIGHT_COLOR, SIGHT_IDLE, 'beamSightEdge', true, EDGE_DASH, EDGE_GAP),
    right: makeLine(SIGHT_COLOR, SIGHT_IDLE, 'beamSightEdge', true, EDGE_DASH, EDGE_GAP),
  };
  return sight;
}

// One entry per SHOOTER, not per shot: several lancers can be charging at once and each owns three lines.
// Their object names are their OWN (`beamHostileSight*`), so a headless scenario asserts on these and never
// confuses them with the player's `beamSight*`.
function ensureHostiles() {
  if (hostiles) return hostiles;
  hostiles = [];
  for (let i = 0; i < HOSTILE_POOL; i++) {
    hostiles.push({
      ship: null, t: 0, dur: 0,
      centre: makeLine(HOSTILE_SIGHT_COLOR, SIGHT_IDLE, 'beamHostileSightCentre', true, CENTRE_DASH, CENTRE_GAP),
      left: makeLine(HOSTILE_SIGHT_COLOR, SIGHT_IDLE, 'beamHostileSightEdge', true, EDGE_DASH, EDGE_GAP),
      right: makeLine(HOSTILE_SIGHT_COLOR, SIGHT_IDLE, 'beamHostileSightEdge', true, EDGE_DASH, EDGE_GAP),
      // A hostile charges with the SAME dust and bead the player does — in the TELEGRAPH's hue, not the
      // shot's (maintainer, 2026-08-30). Red says "this is aimed at you and it is coming now"; the bolt
      // then leaves in the shared blue, so the hue change at release reads on its own as "it has gone".
      // One per pool entry, because two lancers can charge at once from two different noses.
      dust: makeDust(HOSTILE_SIGHT_COLOR, 'beamHostileDust'),
      orb: makeDisc(HOSTILE_SIGHT_COLOR, 'beamHostileOrb'),
    });
  }
  return hostiles;
}

function clearHostile(e) {
  e.ship = null; e.t = 0; e.dur = 0;
  e.centre.visible = e.left.visible = e.right.visible = false;
  e.dust.visible = false; e.orb.visible = false;
}

// A DIAMOND, not a circle (4 segments), so it reads as a targeting mark rather than a halo.
function ensureReticle() {
  if (reticle) return reticle;
  const geo = new THREE.RingGeometry(2.2, 2.7, 4, 1, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: RETICLE_COLOR, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
  }));
  reticle.frustumCulled = false;
  reticle.visible = false;
  reticle.name = 'beamReticle';
  scene.add(reticle);
  return reticle;
}

function ensureOrb() { return orb || (orb = makeDisc(CHARGE_COLOR, 'beamOrb')); }

// ---------- the charge DUST: particles pulled into the growing bead ----------
//
// Maintainer, 2026-08-27: "for the charge animation I want a sprite — particles (dots) of this colour being
// drawn into that growing sphere." The sphere is `beamOrb`, unchanged; this is what feeds it.
//
// SHAPE, chosen by the maintainer over a single gathering sweep and over a plain constant stream: a STREAM
// that COLLAPSES. Particles fall inward for the whole charge, faster and brighter as it fills, and in the
// last quarter their birth radius closes in — so the second has movement all the way through AND an
// unmistakable "now" at the end. It rhymes with the two beats already there: the sight's dashes rush from
// 3 to 40 u/s, and the bead itself grows on k².
//
// Built on `exhaust-fx.js`'s idiom, which is the one this codebase already trusts for particles: ONE
// `THREE.Points`, the per-particle seed packed into the position buffer once, and every particle's motion
// computed in the vertex shader from a `uTime`/`uK` uniform. Nothing is stepped on the CPU and nothing draws
// randomness — `hash` below is deterministic, so this stays replay-neutral like every other FX here (§73).
//
// Its TEXTURE is its own, and deliberately not borrowed: a plume glow is soft by design (it exists to bloom
// a point into a halo) and reads as fog at this size. These are meant to read as DISCRETE SPECKS being
// pulled in, so the disc is solid to 45% of its radius and falls off fast.
const DUST_COUNT = 96;
const DUST_RADIUS = 2.8;    // world units — where a particle is born, before the collapse
// Every radius in the charge effect came down 2.5x on 2026-08-27 (maintainer, having flown it): the ring
// was 7.0 and the bead 0.3->1.6. The POINT SIZE came down with them, and that is not a separate taste
// call — at this camera a world unit is ~7 px, so a 2.8 u ring is ~40 px across, and 15-28 px specks
// would have merged into one patch. Scaling both keeps "particles falling in" legible at the new size.
// PERSPECTIVE-SCALED THE SAME WAY THE PLUME IS, and the `300.0` in the shader is load-bearing, not
// decoration: the combat camera sits ~110 u up, so `uSize / -mv.z` alone would render a 0.24 px speck —
// drawn, and invisible. That is the third time in this feature a value has failed to reach the screen; the
// scenario asserts a real pixel size for exactly that reason.
const DUST_SIZE = 3.2;
const DUST_SWIRL = 1.15;    // radians of curl over one particle's fall — a spiral, not a straight drop

// Deterministic per-particle values. No Math.random anywhere in this module.
const hash = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

let dustTex = null;
function dustTexture() {
  if (dustTex) return dustTex;
  const S = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,1)');    // a solid core: a SPECK, not a halo
  g.addColorStop(0.75, 'rgba(255,255,255,0.35)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.fill();
  dustTex = new THREE.CanvasTexture(cv);
  dustTex.colorSpace = THREE.SRGBColorSpace;
  dustTex.needsUpdate = true;
  return dustTex;
}

const DUST_VERT = /* glsl */`
  uniform float uTime, uK, uRadius, uSize, uSwirl;
  uniform vec3 uOrigin;
  varying float vT;
  void main() {
    float seed = position.z;                       // 0..1, packed at build
    float ang0 = position.x * 6.2831853;           // its lane around the muzzle
    float speed = 0.9 + uK * 2.6;                  // the fall quickens as the shot fills
    float t = fract(seed + uTime * speed);         // 0 = just born on the ring, 1 = arrived at the bead
    // THE COLLAPSE: in the last quarter the birth radius closes in, so the stream visibly tightens.
    float collapse = 1.0 - smoothstep(0.75, 1.0, uK) * 0.72;
    float r = uRadius * collapse * (1.0 - t);
    float a = ang0 + t * uSwirl;                   // curls inward rather than falling straight
    vec3 p = uOrigin + vec3(sin(a) * r, position.y * 0.28, cos(a) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.7 + uK * 0.6) * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
    vT = t;
  }
`;
const DUST_FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3 uColor;
  uniform float uK;
  varying float vT;
  void main() {
    float tex = texture2D(map, gl_PointCoord).a;
    // Fade in at birth so nothing pops at the ring, and brighten as it dives into the bead.
    float life = smoothstep(0.0, 0.18, vT) * (0.35 + vT * 0.65);
    gl_FragColor = vec4(uColor, tex * life * (0.25 + uK * 0.75));
  }
`;

// ONE seed buffer for every dust cloud in the scene — the player's and up to HOSTILE_POOL hostiles'. Sharing
// it is safe and deliberate: the seeds are constants, and each cloud still animates independently because
// `uTime` and `uK` are per-material and each starts at its own shooter's charge.
let dustGeo = null;
function dustGeometry() {
  if (dustGeo) return dustGeo;
  const pos = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    pos[i * 3] = hash(i, 1);              // lane around the muzzle (× 2π in the shader)
    pos[i * 3 + 1] = hash(i, 2) - 0.5;    // a little scatter off the combat plane
    pos[i * 3 + 2] = hash(i, 3);          // life phase, so they do not arrive in lockstep
  }
  dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return dustGeo;
}

function makeDust(color, name) {
  const geo = dustGeometry();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: dustTexture() },
      uColor: { value: new THREE.Color(color) },
      uOrigin: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uK: { value: 0 },
      uRadius: { value: DUST_RADIUS }, uSize: { value: DUST_SIZE }, uSwirl: { value: DUST_SWIRL },
    },
    vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.visible = false;
  p.name = name;
  scene.add(p);
  return p;
}

// Point one dust cloud at a muzzle for this frame. Shared by the player's pass and every hostile's, so the
// two can never drift into two different animations — only the colour and the origin differ.
function driveDust(d, mx, my, mz, k, dt) {
  d.material.uniforms.uOrigin.value.set(mx, my, mz);
  d.material.uniforms.uTime.value += dt;
  d.material.uniforms.uK.value = k;
  d.visible = true;
}

let dust = null;
function ensureDust() { return dust || (dust = makeDust(CHARGE_COLOR, 'beamChargeDust')); }

// One span of the beam: a flat additive quad in the combat plane. `PlaneGeometry(1,1).rotateX(-PI/2)`
// puts local +X across the beam (its WIDTH) and local +Z along it (its LENGTH), so `scale.set(w, 1, len)`
// and a `rotation.y` are all that is needed to stretch it from the muzzle to the impact point.
function makeQuad(color, name) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide,
  }));
  m.frustumCulled = false;
  m.visible = false;
  m.name = name;
  scene.add(m);
  return m;
}

function ensureBolts() {
  if (bolts) return bolts;
  bolts = [];
  for (let i = 0; i < BOLT_POOL; i++) {
    bolts.push({
      glow: makeQuad(CHARGE_COLOR, 'beamBolt'),   // the wide coloured halo
      core: makeQuad(0xffffff, 'beamBoltCore'),   // the white-hot centre, a hair above it in Y
      boltLife: 0,
    });
  }
  return bolts;
}

// Stretch one quad from `from` to `to` at width `w`. `y` lifts it off the plane — the core sits a hair
// higher than the glow so it always wins the additive blend rather than fighting it for z-order.
function spanQuad(q, from, to, w, y) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 0.001;
  q.position.set((from.x + to.x) / 2, y, (from.z + to.z) / 2);
  q.rotation.y = Math.atan2(dx, dz);
  q.scale.set(w, 1, len);
  q.visible = true;
}

// Set a 2-point line. `phase` shifts the dash pattern along it — animating that is what makes the dashes
// travel. Written directly rather than via computeLineDistances(), which would restart the pattern at 0
// every frame and freeze the flow.
function setLine(line, ax, az, bx, bz, y, phase = 0) {
  const pos = line.geometry.attributes.position;
  pos.setXYZ(0, ax, y, az);
  pos.setXYZ(1, bx, y, bz);
  pos.needsUpdate = true;
  const ld = line.geometry.attributes.lineDistance;
  ld.setX(0, phase);
  ld.setX(1, phase + Math.hypot(bx - ax, bz - az));
  ld.needsUpdate = true;
  line.visible = true;
}

function hideSight() {
  if (dust) dust.visible = false;   // before the early-out: the dust exists even when the sight never did
  if (!sight) return;
  sight.centre.visible = sight.left.visible = sight.right.visible = false;
  if (reticle) reticle.visible = false;
  if (orb) orb.visible = false;
}

// ---------- per-frame ----------

// The per-frame entry point. THE ORDER MATTERS AND IS NOT AN ACCIDENT: the hostile pass runs FIRST and
// UNCONDITIONALLY, because the player's pass returns early for a ship with no beam group — which is the
// usual case (the PLAYER carries no beam until one is bought, or `?beam` mounts one). A hostile pass placed
// after those returns would simply never run. The transients are aged first and unconditionally too, so a
// discharge still finishes fading if the ship dies in the same instant.
export function drawBeamSight(dt) {
  stepTransients(dt);
  drawHostileSights(dt);
  drawPlayerSight(dt);
}

// The `beamCharge` event's HOSTILE branch: start (or restart) a shooter's telegraph for exactly `dur`.
//
// It accepts ONLY a ship that is in `world.enemies`. That is the whole hostile/friendly decision, made in
// RENDERING scope: the event carries `fromPlayer`, not `side`, so an ALLY carrying a beam would otherwise
// take this branch and draw a red corridor on a friendly. Asking the world which list the shooter is in
// introduces no `side === 'player'` test into `sim-core` (DECISIONS §135's standing constraint).
export function startHostileBeamCharge(ship, dur, color = 0) {
  if (!ship || !(world.enemies || []).includes(ship)) return;
  const pool = ensureHostiles();
  // Reuse the entry already keyed to this shooter (a second charge resets it), else a free one, else evict
  // the entry with the least charge left — the one whose telegraph is nearest to being over anyway.
  let e = pool.find((x) => x.ship === ship) || pool.find((x) => !x.ship);
  if (!e) {
    e = pool[0];
    for (const x of pool) if ((x.dur - x.t) < (e.dur - e.t)) e = x;
  }
  e.ship = ship; e.t = 0; e.dur = dur > 0 ? dur : 1;
  // Its energy is the WEAPON's colour, not "hostile red" — the pool entry is retinted per charge, because
  // the same slot may serve a pirate beam now and something else later. Only the three SIGHT lines stay
  // side-coloured: they are a warning about who is aiming, not the gun's own light.
  const c = color || HOSTILE_SIGHT_COLOR;
  e.dust.material.uniforms.uColor.value.setHex(c);
  e.orb.material.color.setHex(c);
}

// Redraw every live hostile corridor from its shooter's CURRENT pose. Never from the event's `pos`: that is
// the muzzle at charge START, and the shooter turns for the whole second — the corridor is nose-attached at
// RELEASE by design, so a sight frozen at charge start would be a lie of exactly the kind the three lines
// promise not to tell. In a room `ship.heading` is the INTERPOLATED heading (§127's one clock), and the
// event is released when the render clock reaches its tick, so sight and picture stay in step.
function drawHostileSights(dt) {
  if (!hostiles) return;   // nothing has ever charged: no pool, nothing to draw
  for (const e of hostiles) {
    if (!e.ship) continue;
    e.t += dt;
    // The four ways a telegraph ends (the shooter fired is the FIRST of them — `dur` IS the sim's
    // chargeTime, so there is no second entity ref on `beamFire` and none is needed). `!alive` covers both a
    // local death and a room despawn: `despawnGhost` sets `alive = false` before it drops the ghost.
    if (!e.ship.alive || e.ship.warping || e.t >= e.dur) { clearHostile(e); continue; }

    // The weapon row comes off the SHOOTER's own catalog groups — the ghost carries them, built by the same
    // constructor the simulation uses — so this corridor is THIS weapon's 67 u and ±2°, never the player's.
    const w = beamWeaponOf(beamGroupOf(e.ship));
    if (!w) { clearHostile(e); continue; }

    const ship = e.ship;
    _fwd.set(Math.sin(ship.heading), 0, Math.cos(ship.heading));
    beamMuzzle(ship, _fwd, _muzzle);
    // The FULL maxRange, never clipped to the shooter's vicinity: from a lancer at its 14-22 u standoff the
    // half of the telegraph the player actually reads is the ~45 u running PAST his own ship.
    corridorEnds(ship, _fwd, w.maxRange, corridorRadOf(w), _endC, _endL, _endR);
    const y = ship.pos.y;

    const k = Math.min(1, e.t / e.dur);
    setLine(e.centre, _muzzle.x, _muzzle.z, _endC.x, _endC.z, y, dashPhase);
    setLine(e.left, _muzzle.x, _muzzle.z, _endL.x, _endL.z, y, dashPhase);
    setLine(e.right, _muzzle.x, _muzzle.z, _endR.x, _endR.z, y, dashPhase);
    const op = SIGHT_IDLE + k * SIGHT_GAIN;   // the player's exact ramp
    e.centre.material.opacity = e.left.material.opacity = e.right.material.opacity = op;

    // The bead and the dust falling into it — the player's numbers exactly, only the hue differs.
    e.orb.position.set(_muzzle.x, y + 0.05, _muzzle.z);
    e.orb.scale.setScalar(0.12 + k * k * 0.52);
    // No `rotation.y = spin` here, deliberately: `spin` is advanced in the PLAYER's pass, which returns
    // early for a ship with no beam — the usual case — so it would sit frozen. On a 24-segment circle the
    // rotation is invisible anyway, so this depends on nothing rather than depending on a stale value.
    e.orb.material.opacity = 0.3 + k * 0.65;
    e.orb.visible = true;
    driveDust(e.dust, _muzzle.x, y + 0.05, _muzzle.z, k, dt);
  }
}

// Draw the local player's beam sight. A no-op for a ship with no beam mounted, which is every ship until one
// is bought (or the `?beam` dev flag mounts one).
function drawPlayerSight(dt) {
  const ship = world.player;
  if (!ship || !ship.alive) { hideSight(); return; }
  const g = beamGroupOf(ship);
  if (!g) { hideSight(); return; }

  // THE FIVE NUMBERS COME OFF THE WEAPON ROW, once per frame. There is no shared tuning object to fall back
  // on — two ships may carry differently-tuned beams, and the sight must draw whichever one THIS ship has.
  const w = beamWeaponOf(g);
  if (!w) { hideSight(); return; }
  const range = w.maxRange;
  const halfRad = corridorRadOf(w);

  const s = ensureSight();
  _fwd.set(Math.sin(ship.heading), 0, Math.cos(ship.heading));
  beamMuzzle(ship, _fwd, _muzzle);
  corridorEnds(ship, _fwd, range, halfRad, _endC, _endL, _endR); // the SIM's three endpoints, not our own
  const y = ship.pos.y;

  // How far through the charge we are: the event-driven clock, falling back to the live fire group (which
  // is what exists in a single-player tab before the event's frame drains, and never in a room).
  const charging = chargeFx.active || !!g.charge;
  const k = chargeFx.active && chargeFx.dur > 0
    ? Math.min(1, chargeFx.t / chargeFx.dur)
    : (g.charge ? Math.min(1, g.charge.t / chargeTimeOf(w)) : 0);

  // CHARGE ANIMATION 1 — the dashes rush outward along the sight as energy builds.
  dashPhase -= dt * (charging ? FLOW_IDLE + (FLOW_CHARGING - FLOW_IDLE) * k : FLOW_IDLE);
  spin += dt * (0.6 + k * 6);

  setLine(s.centre, _muzzle.x, _muzzle.z, _endC.x, _endC.z, y, dashPhase);
  setLine(s.left, _muzzle.x, _muzzle.z, _endL.x, _endL.z, y, dashPhase);
  setLine(s.right, _muzzle.x, _muzzle.z, _endR.x, _endR.z, y, dashPhase);
  const op = SIGHT_IDLE + k * SIGHT_GAIN;
  s.centre.material.opacity = s.left.material.opacity = s.right.material.opacity = op;

  // CHARGE ANIMATION 2 — a bead of light gathering at the muzzle, swelling as the shot fills.
  const o = ensureOrb();
  if (charging) {
    o.position.set(_muzzle.x, y + 0.05, _muzzle.z);
    o.scale.setScalar(0.12 + k * k * 0.52); // eased: the last third is where it visibly blooms (2.5x down 2026-08-27)
    o.rotation.y = spin;
    o.material.opacity = 0.3 + k * 0.65;
    o.visible = true;
  } else {
    o.visible = false;
  }

  // …and the dust being pulled into it. Same gate as the bead, so the two are always one effect: specks
  // falling inward, quicker and brighter as the shot fills, their birth ring closing in at the end.
  // `uTime` advances only while charging — a paused charge leaves the stream still rather than spinning on.
  const d = ensureDust();
  if (charging) driveDust(d, _muzzle.x, y + 0.05, _muzzle.z, k, dt);
  else d.visible = false;

  // The reticle marks what the corridor can currently hit — or, mid-charge, the ship this shot is committed
  // to. Same predicate as the hit, so what is circled is what will be struck.
  const painted = g.charge ? g.charge.lock : beamCandidate(world, ship, _fwd, 'player', range, halfRad);
  const r = ensureReticle();
  if (painted && painted.alive) {
    r.position.set(painted.pos.x, painted.pos.y + 0.05, painted.pos.z);
    r.scale.setScalar(((painted.radius || 2.6) / 2.6) * (1.25 - k * 0.25)); // tightens onto the target
    r.rotation.y = spin;                                                    // and spins up with the charge
    r.material.opacity = 0.5 + k * 0.5;
    r.visible = true;
  } else {
    r.visible = false;
  }
}

// The `beamCharge` event: start the FX clock. `dur` comes from the simulation, so the animation always fills
// exactly the window the weapon actually charges for — retuning `chargeTime` cannot desync it.
export function startBeamCharge(dur, color = 0) {
  chargeFx.t = 0;
  chargeFx.dur = dur > 0 ? dur : 0.5;
  chargeFx.active = true;
  // The dust and the bead burn the WEAPON's colour, like the bolt — so a player who somehow carries the
  // pirates' row charges red, and the look never has to ask which side is shooting.
  const c = color || CHARGE_COLOR;
  ensureDust().material.uniforms.uColor.value.setHex(c);
  ensureOrb().material.color.setHex(c);
}

// THE DISCHARGE: a thick beam muzzle→impact — a white-hot core inside a coloured glow, both additive quads
// — plus a bloom where it lands. The core burns out fast and the glow dims over a full second, so it reads
// as a strike that leaves a trail. Round-robin over the pool so a second shot never cuts the first short.
//
// The bolt is drawn WHOEVER fired it — a discharge is a visible event in the world. `ownShot` says whether
// it was the local player's, and only then does it stop the PLAYER's charge clock: a hostile telegraph ends
// on its own entry's `dur`, which is the sim's `chargeTime`, so another shooter's release must not blank
// this one.
export function spawnBeamBolt(from, to, ownShot = false, color = 0) {
  if (ownShot) chargeFx.active = false;
  const pool = ensureBolts();
  const b = pool[boltNext];
  boltNext = (boltNext + 1) % pool.length;

  // THE COLOUR IS THE WEAPON'S, not the shooter's (maintainer, 2026-08-30): it arrives on the event, off
  // the row's `projectileColor`. So the pirates' beam burns red and the player's blue — and an ALLY handed
  // the pirates' row fires red, because it is the same gun. The pool is round-robin and shared, so the tint
  // is set PER SHOT: the same quad draws a lancer's bolt now and yours a second later. The CORE stays white
  // either way — it is the hot centre, not a hue (§0e).
  b.glow.material.color.setHex(color || CHARGE_COLOR);

  spanQuad(b.glow, from, to, BOLT_GLOW_WIDTH, from.y + 0.02);
  spanQuad(b.core, from, to, BOLT_CORE_WIDTH, from.y + 0.04);  // a hair higher: it must win the blend
  b.glow.material.opacity = 1;
  b.core.material.opacity = 1;
  b.boltLife = BOLT_LIFE;
  // No bloom here: the impact flash arrives as `bulletImpact` and is drawn by the shared hit-sprite path.
}

// Age the charge clock and every bolt.
function stepTransients(dt) {
  if (chargeFx.active) chargeFx.t += dt;
  if (!bolts) return;
  for (const b of bolts) {
    if (b.boltLife > 0) {
      b.boltLife -= dt;
      if (b.boltLife <= 0) {
        b.glow.visible = b.core.visible = false;
      } else {
        const a = b.boltLife / BOLT_LIFE;                          // 1 → 0 over the full second
        b.glow.material.opacity = a * a;                           // quadratic: a strike, not a cut
        // The core burns out inside the first quarter, so what lingers is the trail alone.
        b.core.material.opacity = Math.max(0, (a - (1 - BOLT_CORE_FRAC)) / BOLT_CORE_FRAC);
        b.core.visible = b.core.material.opacity > 0;
      }
    }
  }
}

// A fresh run must not inherit a sight, a bolt or a half-finished charge pointing into a fight that is over
// — a RED corridor left over from a dead lancer included.
export function hideBeamFx() {
  hideSight();
  for (const e of hostiles || []) clearHostile(e);
  chargeFx.active = false; chargeFx.t = 0;
  for (const b of bolts || []) {
    b.glow.visible = false; b.core.visible = false; b.boltLife = 0;
  }
}
