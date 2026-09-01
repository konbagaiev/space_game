// Ship factory: builds the primitive placeholder ship and swaps in the DB-sourced .glb model.
// A ship's 3D model comes from the DB (ships.model_url): null = the built-in primitive ship.
// makeShip builds the primitive immediately (shown while a model loads, and as a fallback), then
// applyShipModel swaps in the .glb. The exported assets bake the color in, so we load with tint off.
// Our ships face +Z; a model whose nose points elsewhere is corrected at load time by `yaw` (radians),
// authored per-ship in the seed as `stats.model.yaw` (e.g. Math.PI for a model facing -Z). This is a
// runtime normalization, just like the auto center/scale — see docs/plans/adding-a-ship-model.md.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BULLET_PLANE_Y, G } from './state.js'; // the canonical combat plane every ship group sits on
import { scene, renderer, camera } from './engine.js'; // needed to warm a freshly parsed model onto the GPU
import { SHIP_GROUP_SCALE } from './sim-core/consts.js'; // the group's uniform world scale is SIM state (hitboxes + muzzle scale with it)
import { shipModelCfg } from './sim-core/ship-config.js';
import { LOOK_DEFAULTS } from './graphics.js'; // the hull emissive floor (pure data; the THREE wiring is here)
export { shipModelCfg }; // moved to sim-core (it is catalog data, not rendering); re-exported for existing importers

// Build the spec applyShipModel/makeShip consume from a resolved shipModelCfg (mc). null url → primitive.
//
// `accent` is OPTIONAL and defaults to null, which is a strict no-op: every existing caller — every player
// ship, every enemy — passes nothing and comes out byte-identical. See `applyShipModel` for what it does.
export const modelSpec = (url, mc = {}, accent = null) => (url
  ? { url, tint: false, yaw: mc.yaw ?? 0, scaleMul: mc.scaleMul ?? 1, lift: mc.lift ?? 0, muzzle: mc.muzzle ?? null, exhaust: mc.exhaust ?? null, accent }
  : null);

export const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder); // so meshopt-compressed glbs (hangar high-poly) load; combat glbs are uncompressed
export const SHIP_MODEL_LEN = 3.4; // auto-normalize a model's longest axis to ~ the primitive ship's footprint

// ---------- Parsed-model cache: fetch + parse a ship glb ONCE, then every spawn is a clone ----------
// `applyShipModel` used to call gltfLoader.load on EVERY spawn. The bytes came from the browser cache, but
// three.js still re-ran the whole pipeline each time: new BufferGeometry, a fresh texture decode and GPU
// upload, and therefore one VRAM copy per enemy instance. On a weak phone that stalled the frame at each
// spawn (field telemetry: a single 864 ms frame and 242 ms of `js.render` inside one second, with `draws`
// visibly climbing as the scene assembled mid-fight) and the model often arrived so late that an enemy
// lived its whole life as the placeholder primitive. Same fix, same shape as drops.js's rewardModelCache.
//
// `clone(true)` shares geometry AND materials with the template. The geometry sharing is the whole point —
// one GPU copy of the mesh + its textures per ship TYPE, and the compiled shader program with them. The
// MATERIAL sharing is not: a material is per-instance visual state, and `applyShipModel` now clones every
// one of them at attach so a single ship can flash when it is hit without lighting up every other ship of
// its type (hit-fx.js; DECISIONS §79/§137). Clones cost nothing on the GPU — they carry the same geometry,
// the same textures and identical parameters, so three.js reuses the same program — and nothing disposes
// them: a dead enemy frees only its attached exhaust plume, never the model (sim.js).
// entry = { scene, waiters }. The template `scene` is never added to the scene graph itself.
const shipModelCache = new Map();

// Parsing the glb is only HALF the cost. three.js uploads geometry + textures to the GPU and compiles the
// material's shader program LAZILY — the first time the object is actually drawn. So warming a model at
// level start still left the frame to pay for it the first time that ship TYPE appeared in a fight: field
// telemetry from a weak phone caught **215 ms inside `js.render`** on such a frame, which is what the
// player feels as "the game freezes for a second when a new ship shows up".
//
// So finish the job here: park the template far off-camera in the REAL scene (the program depends on the
// scene's lights/fog, so compiling it in a bare throwaway scene would produce a different program and get
// recompiled anyway), let `renderer.compile` build the programs, and push each texture up explicitly —
// `compile()` handles shaders, not texture uploads. Mirrors `prewarmShaders()` in main.js, which does the
// same for the FX materials at startup but runs long before any ship model exists.
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];
// Self-lit floor so a hull is never a black hole against the backdrop. The combat glbs ship with NO emissive
// at all (verified: every enemy material is a flat baseColorFactor with no textures; only the player's
// PaletteMaterial001/002 carry an emissiveFactor + emissiveMap), and their material names (`07_-_Default`,
// `black_mat_for_body`, `body_color_2`, `PaletteMaterial00N`) identify no engine or trim to hook — so this is
// a UNIFORM floor, not a per-part tint. Same trick as drops.js's normalizeGreen.
// Hue-safe: the emissive copies the material's OWN base colour, so nothing is recoloured.
// IT SHIPS AT 0, i.e. wired but OFF: at 0.25 the floor flattened the hulls and killed their glint on a real
// screen. The mechanism stays because it is the value hit-fx's hull flash RESTORES TO (see below), and
// because turning it back on is a one-line experiment. Whatever it is set to it must stay a FLOOR: a hull
// must never be a standing light source — engines and weapons are the light in this game.
//
// It is applied ONCE to the shared TEMPLATE, before warmModel and before any clone is served, and it draws
// no randomness. THE ORDERING IS THE POINT, and it is not (any longer) about §79's "never mutate a live
// ship's material": §137 amended that, and applyShipModel now clones every material PER INSTANCE so the hit
// flash can light one ship alone. What matters is that the floor must be on the template BEFORE that clone,
// because the clone is what `flashMats` captures as the baked value the flash RESTORES TO — put the floor
// after it and every flashed hull would settle back to black.
// It must also NOT live in applyShipModel's tint traverse: that block is `if (tint)` and EVERY ship with a
// real .glb loads with `tint: false`, so the natural-looking spot would ship a silent no-op that passes
// every test.
// (A hull therefore does light up while it is being hit — the flash is white at intensity 1.6. That is
// hit-fx's effect, by design; the STATIC floor below is what must never reach it.)
function applyHullEmissiveFloor(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m || !m.emissive) continue;                                 // not a lit material
      if (m.emissiveMap || m.emissive.getHex() !== 0x000000) continue; // the artist already authored a glow — leave it
      m.emissive.copy(m.color);   // emissive === color IS the floor's signature — see floorMark/reFloor below
      m.emissiveIntensity = LOOK_DEFAULTS.hullEmissive;
    }
  });
}

// Re-point a material's emissive FLOOR at its (just re-assigned) base colour.
//
// applyHullEmissiveFloor copies `emissive` from `color` on the shared TEMPLATE; any per-instance pass that
// RE-ASSIGNS `color` afterwards would therefore leave the hull self-lighting in the hue it used to be. On the
// wingman that is not academic: his whole visual identity is the accent repaint of the `Wings_` materials, so
// with the floor turned up the repainted wings would glow in the PLAYER's hull colour and wash the accent out
// of the one thing that tells the two ships apart. (The ally's colour identity has been an escaped defect in
// this project before — it does not get to be implicit, even while the floor ships at 0.)
//
// `emissive.equals(color)` BEFORE the re-assignment is the floor's own signature: applyHullEmissiveFloor is
// the only thing that sets them equal, and it deliberately skips any material whose artist authored a glow.
// Testing the state directly rather than tagging `userData` keeps this independent of what three's
// Material.clone() copies. Call it as `const f = floorMark(m); m.color.set(x); reFloor(m, f);`
const floorMark = (m) => !!(m && m.emissive && m.color && m.emissive.equals(m.color));
const reFloor = (m, hadFloor) => { if (hadFloor) m.emissive.copy(m.color); };

// Shared GPU warm, exported: the loot crate and the level's reward drop model go through this same helper
// (drops.js → warmDropAssets / requestRewardModel), so every parsed .glb is compiled + uploaded against the
// REAL scene once, not on the frame it first appears.
export function warmModel(root) {
  try {
    const holder = new THREE.Group();
    holder.position.y = -100000; // compile ignores culling; this only guards against a stray rendered frame
    holder.add(root);
    scene.add(holder);
    renderer.compile(scene, camera);
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        for (const slot of TEX_SLOTS) if (m[slot]) renderer.initTexture(m[slot]);
      }
    });
    holder.remove(root);      // hand the template back unparented — clones are what ever reach the scene
    scene.remove(holder);
  } catch { /* best-effort: a warm failure must never cost us the model itself */ }
}

export function requestShipModel(url, cb) {
  let entry = shipModelCache.get(url);
  if (entry) {                                     // already parsed, or a load is in flight
    if (entry.scene) { if (cb) cb(entry.scene.clone(true)); }
    else if (cb) entry.waiters.push(cb);
    return;
  }
  entry = { scene: null, waiters: cb ? [cb] : [] };
  shipModelCache.set(url, entry);
  G.pendingAssets++; // hold the level-load veil up until this model is here (DECISIONS §84)
  gltfLoader.load(url, (gltf) => {
    entry.scene = gltf.scene;
    applyHullEmissiveFloor(entry.scene); // BEFORE warmModel and before any clone is served to a waiter
    warmModel(entry.scene); // compile + upload NOW, not on the first frame this ship type is drawn
    for (const w of entry.waiters) w(entry.scene.clone(true));
    entry.waiters.length = 0;
    G.pendingAssets--;
  }, undefined, (err) => {
    console.warn('Ship model failed to load, keeping primitive:', url, err);
    shipModelCache.delete(url); // drop the entry so a later spawn can retry
    entry.waiters.length = 0;
    G.pendingAssets--; // a failure must not wedge the veil
  });
}

// Warm a model before it is needed (level start) so the FIRST spawn of a type is a clone, not a parse.
export const preloadShipModel = (url) => { if (url) requestShipModel(url, null); };

// Diagnostic for the ?debug hooks / headless guards: how many distinct glbs have been parsed.
export const shipModelCacheSize = () => shipModelCache.size;

// Load a .glb and swap it in for the placeholder primitive, keeping the SAME group object (all
// gameplay logic keeps referencing it). The model is auto-centered, scaled to a consistent size,
// optionally recolored, and oriented. Falls back to the primitive on error.
function applyShipModel(group, spec, color) {
  const cfg = (typeof spec === 'string') ? { url: spec } : spec;
  const { url, yaw = 0, tint = true, scaleMul = 1, lift = 0, muzzle = null, exhaust = null,
    opacity = null, darken = 0, accent = null } = cfg; // opacity/darken: ghost-battle readability treatment (real ships pass neither)
  requestShipModel(url, (model) => {
    // `model` is a fresh clone of the cached template — safe to scale/recenter/re-parent per instance.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (SHIP_MODEL_LEN / (Math.max(size.x, size.y, size.z) || 1)) * scaleMul;
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s); // recenter at the group origin
    if (tint) model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (!m.color) return;
          const hadFloor = floorMark(m);   // the emissive floor must follow the recolour, not the old hue
          m.color.set(color);
          reFloor(m, hadFloor);
        });
      }
    });
    // ACCENT TINT: recolour only the materials whose NAME starts with `accent.prefix`, leaving the rest of
    // the model exactly as the artist baked it. It exists so one .glb can wear two liveries — the Sentinel
    // wingman flies the player's own hull and is otherwise indistinguishable from it (real ships pass
    // `tint: false`, so the block above never runs for them and a ship's `color` reaches only the primitive
    // placeholder and the minimap dot). Painting his WINGS is what separates the two silhouettes without a
    // second asset. `Wings_Material` is the one wing-prefixed material in `player_combat.9188c820.glb`.
    //
    // A prefix STRING rather than a predicate function, so the whole thing is plain data that can live in a
    // config module. `null` (every existing ship) skips the traverse entirely, which is why this is
    // replay-neutral and cannot move a recorded trace (DECISIONS §73 — cosmetics never touch the sim).
    // Materials are cloned per instance, or the tint would leak onto every ship sharing the cached glb.
    // The wing material carries a baseColorTexture, so `m.color` MULTIPLIES it: the tint reads as a wash
    // over the artwork rather than as flat paint. That is intended; brighten the constant if it reads dull.
    if (accent && accent.prefix) model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (!mats.some((m) => m && typeof m.name === 'string' && m.name.startsWith(accent.prefix))) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      const cloned = Array.isArray(o.material) ? o.material : [o.material];
      cloned.forEach((m) => {
        if (!(m && typeof m.name === 'string' && m.name.startsWith(accent.prefix) && m.color)) return;
        const hadFloor = floorMark(m);   // …so the wingman's wings self-light in the ACCENT green, not the
        m.color.set(accent.color);       //    player hull's colour they were cloned from
        reFloor(m, hadFloor);
      });
    });
    // Ghost-battle readability treatment: darken + fade + fog so the ghost skirmish reads as distant decor.
    // Guarded by truthiness → real ships (which pass neither key) are byte-unaffected. Clones each material
    // so the darken/opacity don't leak onto other instances sharing the glb's cached materials.
    if (opacity != null || darken) model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (darken && m.color) m.color.multiplyScalar(darken);
          // DEFENSIVE ONLY — `darken` HAS NO CALLER TODAY, and neither does the line above it. The ghost
          // battle used to pass 0.45 here, but it was over-dimmed into invisibility and now ships at
          // `opacity: 0.9` with no darken at all (ghost-battle.js builds its spec with `opacity` only; the
          // 0.45 survives as history in ghost-battle-track.js's GHOST_TUNE comment).
          // The line stays because `darken` is still a supported applyShipModel option: if anyone re-enables
          // it WITH the emissive floor turned up, dimming the albedo while leaving the emissive at full
          // strength is exactly the flat, too-bright result they would not be expecting. Keeping only the
          // colour half would leave that trap armed.
          // NOTE it cannot be verified by the visual suite: ghostBattlePlan disables the ghost battle under
          // `?debug` on every tier, so no headless frame can ever contain a ghost.
          if (darken && m.emissive) m.emissive.multiplyScalar(darken);
          if (opacity != null) { m.transparent = true; m.opacity = opacity; }
          m.fog = true;
        });
      }
    });
    const pivot = new THREE.Group(); // rotate the centered model without disturbing its centering
    pivot.rotation.y = yaw;
    pivot.position.y = lift; // top-down aim fix: raise the model (group-local +Y) to match its lifted hitboxes
    pivot.add(model);
    // Cache the model's real forward/back extent (group-LOCAL units) so muzzle flashes + exhaust spawn AT
    // the nose / engines, not at a fixed offset tuned for the old primitive. Measure NOW, while `pivot` has
    // no parent — so its world matrix == its local matrix. Measuring after attaching to the live group
    // would fold in the group's 1.8×sizeScale scale AND the ship's world position (enemies spawn far from
    // origin!) → spawn points drift hundreds of units off the model. fireMount/emitExhaust re-apply the
    // mesh's world scale themselves.
    pivot.updateMatrixWorld(true);
    const lbox = new THREE.Box3().setFromObject(pivot);
    // Spawn points auto-derive from the glb's local bounds; a per-ship muzzle/exhaust override (group-local
    // units, like the primitive's ±1.6) wins when the auto tip is off (e.g. a long antenna or swept-back fin).
    group.userData.noseZ = muzzle ?? lbox.max.z; // forward (+Z) tip, group-local
    group.userData.tailZ = exhaust ?? lbox.min.z; // rear (−Z) tip
    const host = group.userData.bankGroup || group; // primitives + model live in the rolling group
    for (let i = host.children.length - 1; i >= 0; i--) { // drop the placeholder primitive
      const c = host.children[i];
      host.remove(c);
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    // PER-INSTANCE MATERIALS (docs/plans/2026-08-30-1505-combat-hit-feel.md). `clone(true)` shares
    // materials with the cached template, so setting `emissive` on one enemy would flash EVERY enemy of
    // that type. Cloning here keeps geometry + textures shared (no re-upload, no shader recompile — a
    // clone has identical parameters, so THREE reuses the same compiled program) and gives each hull its
    // own uniform set. `flashMats` is the list hit-fx.js writes to, with the baked values it restores.
    // NOTHING DISPOSES THESE. `detachEnemyBody` frees only the ship's exhaust plume (DECISIONS §79), so the
    // clones are simply garbage-collected with the mesh. Do NOT add a dispose pass here: a compiled program
    // dies with its last material, and freeing it would recompile on the next spawn — the §83 freeze.
    //
    // KNOWN LIMITATION: where a material carries an `emissiveMap`, three.js MULTIPLIES emissive by that
    // map, so such a material glows only where the map is non-black. Measured on the shipped glbs:
    // enemy_1_combat and enemy_2_combat have none at all; player_combat has 2 of 15. The flash therefore
    // reaches the overwhelming majority of every hull. Do NOT null the map to "fix" it — changing a map
    // slot forces a shader recompile, which is the mid-fight freeze DECISIONS §83 exists to prevent. If the
    // player ship reads weak in play, raise `flash.intensity` in the ?dev panel.
    const flashMats = [];
    model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m && m.emissive) flashMats.push({ mat: m, emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
      }
    });
    group.userData.flashMats = flashMats;
    host.add(pivot);
  }); // a failed load logs + keeps the placeholder primitive inside requestShipModel
}

export function makeShip(color, model = null) {
  const g = new THREE.Group();
  const bank = new THREE.Group();         // inner group: holds the visual model, rolls about the nose (+Z)
  g.add(bank);
  g.userData.bankGroup = bank;            // gameplay still references g; the bank group is for cosmetics only
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 });
  // hull (nose points in +Z)
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 12), mat);
  body.rotation.x = Math.PI / 2;
  bank.add(body);
  // wings
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 1.0), mat);
  wing.position.z = -0.4;
  bank.add(wing);
  // engine glow
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 10, 10),
    new THREE.MeshBasicMaterial({ color })
  );
  glow.position.z = -1.6;
  bank.add(glow);
  // The hull flash's material list (hit-fx.js). The placeholder's MeshStandardMaterial is already built
  // fresh per ship, so it only needs recording — no clone. `applyShipModel` overwrites this when the glb
  // lands, which is correct: it disposes these meshes in the same block.
  g.userData.flashMats = [{ mat, emissive: mat.emissive.clone(), intensity: mat.emissiveIntensity }];
  g.position.y = BULLET_PLANE_Y; // sit the group on the canonical combat plane (bullets fly here)
  g.scale.setScalar(SHIP_GROUP_SCALE); // larger - the arena is far away, otherwise ships look tiny
  g.userData.noseZ = 1.6;  // muzzle/forward spawn (group-local: primitive cone nose) — replaced by the
  g.userData.tailZ = -1.6; // exhaust/rear spawn (primitive engine glow) — real glb bounds in applyShipModel
  if (model) applyShipModel(g, model, color); // optionally replace the primitive with a .glb
  return g;
}
