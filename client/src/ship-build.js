// Ship building & weapons: resolve a DB ship's components/weapons/fire-groups into a live entity,
// build the player and spawn enemies, and drive the fire-group cooldown/volley logic. Bridges the
// catalog (state.CATALOG) + the pure derivation (components.js) + the ship factory + projectiles.
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, CATALOG, enemies } from './state.js';
import { modelSpec, makeShip, preloadShipModel } from './ship-factory.js';
import { resolveWeapon as resolveWeaponIn, resolveComponents as resolveComponentsIn,
         buildMounts as buildMountsIn, makePlayer, spawnEnemy as spawnEnemyIn,
         updateGroups as updateGroupsIn } from './sim-core/ship-entity.js';

// Advance a ship's fire groups in THIS tab's World. The firing logic itself is sim-core's (it decides what
// is spawned and emits `fire`); this only binds the World so the two call sites in sim.js are unchanged.
// The historical 5-argument shape kept a BOOLEAN `isPlayer`; sim-core now takes a three-valued `side`
// ('player' | 'ally' | 'enemy'), so the boolean is mapped here rather than in every caller. An ally is
// never fired through this shim — `stepAlly` calls sim-core directly.
export const updateGroups = (ship, fwd, isPlayer, dt, wantsFire) =>
  updateGroupsIn(world, ship, fwd, isPlayer ? 'player' : 'enemy', dt, wantsFire);
import { world } from './state.js';                             // the World these shots are fired into
import { disposeShipExhaust } from './exhaust-fx.js'; // free the retired player mesh's attached plume on a ship swap
import { ALLY_ACCENT_COLOR, ALLY_ACCENT_MATERIAL_PREFIX } from './sim-core/ally-config.js'; // the wingman's wing livery
import { beamLoadout } from './beam-dev.js';         // ?beam: mount the Charged beam (a strict no-op when off)

// Catalog resolution lives in sim-core/ship-entity.js (a server has to do it too). These wrappers bind
// THIS tab's World so the long-standing call signatures — `resolveComponents(refs)` and friends — keep
// working for the shop and the player builder.
const resolveWeapon = (id) => resolveWeaponIn(world.catalog, id);
export const resolveComponents = (refs) => resolveComponentsIn(world.catalog, refs);
const buildMounts = (defs) => buildMountsIn(world.catalog, defs);

export function buildPlayer(active) {
  // The numbers are sim-core's (a server builds the same ship without a renderer); the mesh is this tab's.
  const p = makePlayer(world.catalog, active);
  p.mesh = makeShip(p.color, modelSpec(p.modelUrl, p.modelCfg));
  p.mesh.scale.setScalar(p.scale); // seed the render copy so the first frame is right (syncMeshes owns it after)
  return p;
}

// (Re)build the player ship from a catalog ship row and swap it into the scene. For the player's
// *active* ship we use its persisted loadout/components (so a DB weapon swap from a level briefing
// actually takes effect); other (preview) ships fall back to their catalog defaults. G.currentShipName
// + G.activeShip live on the shared bag — written by the welcome/shop/account/net flows.
export function buildPlayerFor(ship, override = null) {
  if (G.player) { disposeShipExhaust(G.player.mesh); scene.remove(G.player.mesh); } // the retired mesh carries a parented plume → dispose its ShaderMaterials (GPU-leak guard)
  // `override` ({ loadout, components }) forces an EXACT build independent of the current account — used by
  // ?playback so a recording reproduces the ship+weapons it was MADE with, not whatever the player has equipped
  // now (e.g. a machine gun unlocked on a later level would otherwise leak into an intro-level playback).
  const useActive = !override && G.activeShip && G.activeShip.ship && G.activeShip.ship.name === ship.name;
  const loadout = override ? override.loadout : (useActive ? G.activeShip.loadout : { mounts: ship.stats.mounts });
  const components = override ? override.components : (useActive ? G.activeShip.components : ship.components);
  // Skills come from the OVERRIDE when there is one — a ?playback/admin replay must rebuild the ship the
  // recording was made with, points included. This used to force `null` for every override, which was the
  // opposite of faithful: skills change engine power, weapon damage, shield capacity and (via Maneuver's
  // dodge) whether the hostile-hit roll draws from the seeded stream, so a skilled player's run replayed on
  // a skill-less ship diverged within seconds. Previews still get none. See the v4 note in replay.js.
  const skills = override ? (override.skills || null)
    : ((useActive && G.activeShip.progression) ? G.activeShip.progression.skills : null);
  // `?beam` swaps the gun mount for the Charged beam on the way in. With the flag off `beamLoadout`
  // returns the very same object, so a normal build is untouched.
  G.player = buildPlayer({ ship, loadout: beamLoadout(loadout), components, skills });
  G.currentShipName = ship.name;
  scene.add(G.player.mesh);
}

// Build one enemy from a DB ship row (type 'enemy') into this tab's World. The entity's numbers come from
// sim-core; its Three.js body is attached by the host (see sim.js). Kept here under its historical name so
// the debug hooks and visual scenarios that call it are unchanged.
export function spawnEnemyShip(shipDef) {
  return spawnEnemyIn(world, shipDef);
}

// Give an enemy entity its Three.js body — the browser half of world.host.onSpawn('enemy', e). The entity
// already carries everything needed: which model, how it is oriented and scaled, and where it is. The mesh
// transform is seeded here rather than left to syncMeshes because an enemy can spawn AFTER syncMeshes has
// already run this tick (levelRunner.update() is late in update()), and it must be drawn in the right place
// on the very frame it appears.
export function attachEnemyBody(e) { attachShipBody(e, null); }

// The shared body-attach. `accent` is an optional { color, prefix } livery repaint applied to the model's
// matching materials (ship-factory `applyShipModel`); null — every enemy — is a strict no-op.
function attachShipBody(e, accent) {
  e.mesh = makeShip(e.color, modelSpec(e.modelUrl, e.modelCfg, accent));
  e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
  e.mesh.rotation.y = e.heading;
  e.mesh.scale.setScalar(e.scale);
  scene.add(e.mesh);
}

export function detachEnemyBody(e) {
  if (!e.mesh) return;
  disposeShipExhaust(e.mesh); // free the dead ship's attached exhaust plume (ShaderMaterials)
  scene.remove(e.mesh);
  e.mesh = null;
}

// An ally's body is built exactly like an enemy's, with ONE difference: his WINGS are repainted
// (`ALLY_ACCENT_COLOR` over the model's `Wings_`-prefixed materials). That repaint is the only thing that
// separates him from the player on screen — he flies the player's own `player_combat` .glb, and catalog
// ships are built with `tint: false`, so a ship's `color` reaches the minimap dot and the primitive
// placeholder but never the model. No new asset: one tint constant against the same glb.
export const ALLY_ACCENT = { color: ALLY_ACCENT_COLOR, prefix: ALLY_ACCENT_MATERIAL_PREFIX };
export function attachAllyBody(a) { attachShipBody(a, ALLY_ACCENT); }
export const detachAllyBody = detachEnemyBody;

// Spawn a specific enemy by role name (used by tests/tools), falling back to the first kind.
export function spawnEnemy(role) {
  const def = CATALOG.enemyShips.find((s) => s.stats.role === role) || CATALOG.enemyShips[0];
  return def ? spawnEnemyShip(def) : null;
}

// Warm the .glb of every enemy this level can spawn, so the FIRST spawn of each type is an instant clone
// of a cached template instead of a mid-fight fetch/parse/texture-upload (the stall that had weak phones
// dropping to single-digit fps for the first seconds of a fight, and left enemies flying as the
// placeholder primitive until their model finally landed). Same idea as preloadRewardModel, which already
// warms the last-kill drop for exactly this reason. Names come from the descriptor's spawn pools; a name
// the catalog doesn't carry is simply skipped.
export function preloadLevelShipModels(level) {
  const names = new Set();
  for (const ph of level?.phases || []) for (const p of ph.spawn?.pool || []) if (p.ship) names.add(p.ship);
  for (const name of names) {
    const def = (CATALOG.enemyShips || []).find((s) => s.name === name);
    if (def?.modelUrl) preloadShipModel(def.modelUrl);
  }
}
