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
import { fxColor } from './postfx.js'; // the DISCHARGE's HDR lift — hue-preserving, pinned to 1.0 with no composer (D18)
import { world } from './state.js';
import { Vec3 } from './sim-core/vec.js';
import { beamMuzzle, corridorEnds, beamGroupOf, beamWeaponOf, beamCandidate, corridorRadOf, chargeTimeOf } from './sim-core/beam.js';

// THE SIGHT IS GREEN, THE SHOT IS CYAN-WHITE. They shared one blue at first, so the aiming aid competed
// with the discharge it exists to predict. Splitting the hues means a full second of green build-up hands
// over to a cyan-white flash and THE SHOT is what the eye lands on — the sight can sit on screen
// permanently without ever stealing the moment it announces.
const SIGHT_COLOR = 0x5ad17f;
const RETICLE_COLOR = 0xffd24d;
const CHARGE_COLOR = 0xbfefff;   // bolt + muzzle bead + impact bloom — deliberately NOT the sight's hue
// THE DISCHARGE IS GEOMETRY, NOT A LINE — by necessity, not preference. A WebGL line is 1 px wide whatever
// `linewidth` says (ignored on essentially every platform), so a "thicker beam" is simply not expressible
// as a Line and the bolt is built from two additive QUADS instead: a white-hot CORE inside a wider
// coloured GLOW. Widths are in WORLD units so the beam keeps its thickness as the camera zooms.
const BOLT_LIFE = 1.0;              // the trail dims over a full second (maintainer, 2026-08-25)
const FLASH_LIFE = 0.24;            // the impact bloom is unchanged
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
    });
  }
  return hostiles;
}

function clearHostile(e) {
  e.ship = null; e.t = 0; e.dur = 0;
  e.centre.visible = e.left.visible = e.right.visible = false;
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
      // THE DISCHARGE ONLY is lifted into HDR (fxGain.bolt) so the strike clears the bloom threshold and
      // glows. A scalar multiply, so the cyan-white shot keeps its exact HUE — the green sight and the
      // cyan shot stay two different hues (DECISIONS §135), which is the whole point of the split. The
      // SIGHT and the charge bead are deliberately NOT lifted: they are thin 1 px lines and a permanent
      // on-screen aid, and a glowing aiming aid would compete with the shot it exists to predict.
      glow: makeQuad(fxColor(CHARGE_COLOR, 'bolt'), 'beamBolt'),   // the wide coloured halo
      core: makeQuad(fxColor(0xffffff, 'bolt'), 'beamBoltCore'),   // the white-hot centre, a hair above it in Y
      flash: makeDisc(fxColor(CHARGE_COLOR, 'bolt'), 'beamFlash'),
      boltLife: 0, flashLife: 0,
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
export function startHostileBeamCharge(ship, dur) {
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
    o.scale.setScalar(0.3 + k * k * 1.3);   // eased: the last third is where it visibly blooms
    o.rotation.y = spin;
    o.material.opacity = 0.3 + k * 0.65;
    o.visible = true;
  } else {
    o.visible = false;
  }

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
export function startBeamCharge(dur) {
  chargeFx.t = 0;
  chargeFx.dur = dur > 0 ? dur : 0.5;
  chargeFx.active = true;
}

// THE DISCHARGE: a thick beam muzzle→impact — a white-hot core inside a coloured glow, both additive quads
// — plus a bloom where it lands. The core burns out fast and the glow dims over a full second, so it reads
// as a strike that leaves a trail. Round-robin over the pool so a second shot never cuts the first short.
//
// The bolt is drawn WHOEVER fired it — a discharge is a visible event in the world. `ownShot` says whether
// it was the local player's, and only then does it stop the PLAYER's charge clock: a hostile telegraph ends
// on its own entry's `dur`, which is the sim's `chargeTime`, so another shooter's release must not blank
// this one.
export function spawnBeamBolt(from, to, ownShot = false) {
  if (ownShot) chargeFx.active = false;
  const pool = ensureBolts();
  const b = pool[boltNext];
  boltNext = (boltNext + 1) % pool.length;

  spanQuad(b.glow, from, to, BOLT_GLOW_WIDTH, from.y + 0.02);
  spanQuad(b.core, from, to, BOLT_CORE_WIDTH, from.y + 0.04);  // a hair higher: it must win the blend
  b.glow.material.opacity = 1;
  b.core.material.opacity = 1;
  b.boltLife = BOLT_LIFE;

  b.flash.position.set(to.x, from.y + 0.05, to.z);
  b.flash.scale.setScalar(0.6);
  b.flash.material.opacity = 1;
  b.flash.visible = true;
  b.flashLife = FLASH_LIFE;
}

// Age the charge clock, every bolt and every bloom.
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
    if (b.flashLife > 0) {
      b.flashLife -= dt;
      if (b.flashLife <= 0) b.flash.visible = false;
      else {
        const a = b.flashLife / FLASH_LIFE;            // 1 → 0
        b.flash.scale.setScalar(0.6 + (1 - a) * 4.4);  // expands as it fades (0.6 → 5.0)
        b.flash.material.opacity = a * a;              // quadratic: a sharp pop, then gone
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
    b.flash.visible = false; b.flashLife = 0;
  }
}
