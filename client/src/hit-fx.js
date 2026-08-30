// Hit feel: what happens on the RECEIVING end of a shot.
//
// Combat used to be announced entirely by the shooter's side — a muzzle flash, a bolt, a spark where the
// bullet died — and nothing on the ship you shot ever changed. This module is the target's answer:
//
//   • a HULL FLASH on any ship a projectile's damage actually reaches (enemies, the wingman, you);
//   • a short MODEL PUNCH from rockets and the heavy cannon only, never from plain bullets;
//   • a light CAMERA SHUDDER when a rocket reaches the PLAYER's hull.
//
// EVERYTHING HERE IS RENDER-ONLY. It is driven by the `hullHit` event (sim-core/events.js), which merely
// describes damage the simulation already applied; nothing in this file writes entity state, and the only
// randomness is `Math.random()` — never `simRandom()`, whose seeded stream the recorded intro depends on
// (DECISIONS §73). The punch rides the ship's COSMETIC child group (`bankGroup`), the same place the wing
// bank lives, so it can never touch `ship.pos` / `ship.heading` / `ship.scale` — the last of which feeds
// both the hitboxes and the muzzle offset (sim-core/ship-entity.js).
//
// Tunables + the pure impulse/tracer seams live in hit-fx-config.js (THREE-free, unit-tested).
// See docs/plans/2026-08-30-1505-combat-hit-feel.md and DECISIONS §137.
import * as THREE from 'three';
import { G, enemies, allies } from './state.js';
import { HIT_FX, makeImpulse, refreshImpulse, ageImpulse } from './hit-fx-config.js';
// NOTE: no glow-layer import. The hull is never a glow source — see updateFlash for why.

// ---------- the camera shudder (module state: there is exactly one camera) ----------
const shakeSt = makeImpulse();
let shakeV = 0;        // current 0..1 impulse value, written by updateHitFx
let shakeAngle = 0;    // screen-plane direction of this shudder, drawn once when it starts

// ---------- per-ship impulses ----------
// State lives on the ship's own mesh (`userData.hitFlash` / `userData.hitPunch`), so it dies with the mesh
// and there is no registry to leak or to sweep on death.
const flashState = (ship) => (ship.mesh.userData.hitFlash ||= makeImpulse());
const punchState = (ship) => (ship.mesh.userData.hitPunch ||= makeImpulse());

// Start (or refresh) the emissive wash on this ship's own materials. `flashMats` is recorded per instance
// by ship-factory.js — the materials are cloned at attach precisely so one enemy can flash alone.
export function hullFlash(ship) {
  if (!ship || !ship.mesh) return;
  refreshImpulse(flashState(ship), HIT_FX.flash.dur, 0); // no cooldown: the flash is the readability win
}

// Shove/pop the model. `dirHeading` is the world yaw the impact pushes toward. Gated by the impulse's own
// cooldown, so a Triple spiral rocket's three warheads punch ONCE instead of vibrating the hull.
export function punchShip(ship, dirHeading) {
  if (!ship || !ship.mesh) return;
  const st = punchState(ship);
  if (refreshImpulse(st, HIT_FX.punch.dur, HIT_FX.punch.cooldown)) st.dirHeading = dirHeading || 0;
}

// Kick the camera. A fresh screen-plane angle per shudder so repeated hits do not shake along one line.
export function cameraShudder() {
  if (refreshImpulse(shakeSt, HIT_FX.shake.dur, HIT_FX.shake.cooldown)) {
    shakeAngle = Math.random() * Math.PI * 2; // RENDER-ONLY randomness — never simRandom (DECISIONS §73)
  }
}

// ---------- per-frame ----------
function updateFlash(ship, dt) {
  const st = ship.mesh.userData.hitFlash;
  if (!st) return;
  const v = ageImpulse(st, dt);
  const mats = ship.mesh.userData.flashMats || [];
  if (v > 0) {
    for (const f of mats) { f.mat.emissive.setHex(HIT_FX.flash.color); f.mat.emissiveIntensity = HIT_FX.flash.intensity * v; }
    // THE HULL DELIBERATELY DOES *NOT* JOIN THE GLOW LAYER. It did at first, and on a real screen the whole
    // silhouette lit up — the ship read as a lamp rather than as a ship being hit ("корабль сильно ярко
    // мигает", live test 2026-08-31). The light of an impact is already there and is already compact: the
    // `bulletImpact` hit sprite (flipbook-fx.js spawnHitSprite) is on the glow layer and sits exactly AT the
    // point of impact, which is the same small, round, camera-facing shape that makes bullets read well.
    // Lighting the hull on top of it was redundant, and a whole silhouette is the one shape the glow buffer
    // handles worst.
    //
    // So the split is: the EMISSIVE FLASH below stays exactly as hit-feel authored it (white, intensity 1.6,
    // 0.12 s) and does the "the target reacted" job on the model, at full canvas resolution. The LIGHT comes
    // from the impact point. Do not re-add markGlow here — and note hit-feel's own numbers are untouched.
    st.dirty = true;
  } else if (st.dirty) {
    // Put back exactly what the artist baked, not a guess at "off".
    for (const f of mats) { f.mat.emissive.copy(f.emissive); f.mat.emissiveIntensity = f.intensity; }
    st.dirty = false;
  }
}

function updatePunch(ship, dt) {
  const st = ship.mesh.userData.hitPunch;
  if (!st) return;
  const bank = ship.mesh.userData.bankGroup;
  if (!bank) return;
  const v = ageImpulse(st, dt);
  if (v > 0) {
    // The shove is a WORLD direction; `bank` inherits the parent group's rotation.y = ship.heading, so
    // rotate it into the group's local frame. Recomputed each frame, so a ship that turns mid-punch keeps
    // being shoved the way the shot was travelling.
    const a = (st.dirHeading || 0) - ship.heading;
    bank.position.set(Math.sin(a) * HIT_FX.punch.shove * v, 0, Math.cos(a) * HIT_FX.punch.shove * v);
    bank.scale.setScalar(1 + HIT_FX.punch.pop * v);
    st.dirty = true;
  } else if (st.dirty) {
    bank.position.set(0, 0, 0);
    bank.scale.setScalar(1);
    st.dirty = false;
  }
}

function updateShip(ship, dt) {
  if (!ship || !ship.mesh) return;
  updateFlash(ship, dt);
  updatePunch(ship, dt);
}

// Age every live impulse and write the result into the scene graph. Called once per render tick, AFTER the
// event drain (so a hit taken this tick is already displaced on this frame) and BEFORE the camera settles
// (so the shake value the camera reads is this frame's). The ship lists are bounded and tiny — no registry.
export function updateHitFx(dt) {
  shakeV = ageImpulse(shakeSt, dt);
  updateShip(G.player, dt);
  for (const e of enemies) updateShip(e, dt);
  for (const a of allies) updateShip(a, dt);
}

const _right = new THREE.Vector3(), _up = new THREE.Vector3();

// Translate the camera by the current shudder. Call AFTER `camera.lookAt(...)`: shaking the ORIENTATION
// would swing the whole world and read as nausea, so this stays a pure screen-plane translation.
export function applyCameraShake(cam) {
  if (shakeV <= 0) return;
  const amp = HIT_FX.shake.amp * shakeV;
  // The camera is near-top-down (CAM_OFFSET 0,110,26), so world +Y is almost straight at the lens: an
  // offset along it would read as "closer", not as a shake. Offset along the CAMERA's own screen basis.
  _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
  _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
  cam.position.addScaledVector(_right, Math.cos(shakeAngle) * amp)
              .addScaledVector(_up,    Math.sin(shakeAngle) * amp);
}

// A new run starts clean: no flash may survive on a recycled hull, no punch on a bank group, no shudder on
// the camera. Called from sim.js reset().
export function resetHitFx() {
  shakeSt.age = 0; shakeSt.dur = 0; shakeSt.cool = 0; shakeSt.active = false;
  shakeV = 0;
  const settle = (ship) => {
    if (!ship || !ship.mesh) return;
    const fl = ship.mesh.userData.hitFlash;
    if (fl) { fl.active = false; fl.cool = 0; }
    const pu = ship.mesh.userData.hitPunch;
    if (pu) { pu.active = false; pu.cool = 0; }
    updateShip(ship, 0); // one zero-length step restores the baked materials + parks the bank group
  };
  settle(G.player);
  for (const e of enemies) settle(e);
  for (const a of allies) settle(a);
}

// ---------- the ?dev tuning panel ----------
// Modelled on buildExhaustPanel (exhaust-fx.js). ONE deliberate difference: this panel mutates the exported
// HIT_FX object IN PLACE rather than a clone, because every consumer reads it live at hit/spawn time — so
// there is no apply step and a slider is felt on the very next shot. `Copy JSON` prints the tuned object to
// paste back over the defaults in hit-fx-config.js (no persistence, exactly like the exhaust panel).
export function buildHitFxPanel(GUI) {
  const gui = new GUI({ title: 'Hit feel (?dev)' });

  const fl = gui.addFolder('Hull flash');
  fl.addColor({ get color() { return HIT_FX.flash.color; }, set color(v) { HIT_FX.flash.color = v; } }, 'color').name('Color');
  fl.add(HIT_FX.flash, 'intensity', 0, 6, 0.05).name('Intensity');
  fl.add(HIT_FX.flash, 'dur', 0.02, 0.6, 0.01).name('Duration (s)');

  const pu = gui.addFolder('Model punch (rocket + cannon)');
  pu.add(HIT_FX.punch, 'shove', 0, 0.8, 0.005).name('Shove (group units)');
  pu.add(HIT_FX.punch, 'pop', 0, 0.5, 0.005).name('Scale pop');
  pu.add(HIT_FX.punch, 'dur', 0.02, 0.5, 0.01).name('Duration (s)');
  pu.add(HIT_FX.punch, 'cooldown', 0, 1, 0.01).name('Cooldown (s)');

  const sk = gui.addFolder('Camera shudder (rocket → player hull)');
  sk.add(HIT_FX.shake, 'amp', 0, 8, 0.05).name('Amplitude (world u)');
  sk.add(HIT_FX.shake, 'dur', 0.02, 0.6, 0.01).name('Duration (s)');
  sk.add(HIT_FX.shake, 'cooldown', 0, 1, 0.01).name('Cooldown (s)');

  const tr = gui.addFolder('Tracers');
  tr.add(HIT_FX.tracer, 'kineticLen', 0.3, 4, 0.05).name('Kinetic length');
  tr.add(HIT_FX.tracer, 'kineticBright', 0.3, 2.5, 0.05).name('Kinetic brightness');
  tr.add(HIT_FX.tracer, 'cannonLen', 0.3, 4, 0.05).name('Cannon length');
  tr.add(HIT_FX.tracer, 'cannonBright', 0.3, 2.5, 0.05).name('Cannon brightness');
  tr.add(HIT_FX.tracer, 'jitterLen', 0, 1, 0.01).name('Length jitter (0 = uniform)');
  tr.add(HIT_FX.tracer, 'jitterBright', 0, 1, 0.01).name('Brightness jitter');

  gui.add({ copy() {
    const json = JSON.stringify(HIT_FX, null, 2);
    // `.catch` because a clipboard write REJECTS when the page lacks permission/focus (headless, or an
    // unfocused tab) and an unhandled rejection is a page error the visual harness counts.
    navigator.clipboard?.writeText(json).catch(() => {});
    console.log('[hit-fx tune]', json);   // fallback when the clipboard is blocked
  } }, 'copy').name('Copy JSON');
}
