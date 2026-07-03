// Loot drops + the Grab (tractor) sim (docs/plans/2026-07-03-1412-grab-tractor-drops.md).
// On an enemy kill the death loop rolls DROP_CHANCE; on success it spawns ONE metal-box drop carrying a
// real looted item (a non-hull component or a mounted weapon). A drop within the player's grab RANGE is
// pulled toward the ship (range = grab.strength; speed = (strength/2)*(10/itemWeight)), and collected
// drops accumulate in `pendingLoot` — deposited into the stash on mission VICTORY only (see sim.js).
//
// Pure math (pullSpeed, pickLoot) lives here / in drops-config.js so it's node-testable without THREE.
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, CATALOG } from './state.js';
import { gltfLoader } from './ship-factory.js';          // meshopt-wired GLTFLoader
import { audio } from './sound-routing.js';
import { DROP_MODEL_URL, DROP_CHANCE, MAX_DROPS, ARM_DELAY, ROTATE_PERIOD, COLLECT_DIST, WEIGHT_FALLBACK, pullSpeed, pickLoot } from './drops-config.js';

export const drops = [];            // { obj, item:{kind,refId}, weight, inRange (sec) }
export const pendingLoot = [];      // { kind, refId } collected this run — deposited on VICTORY only
export { DROP_CHANCE, pickLoot };   // re-export so sim.js/main.js read one source (pickLoot is pure, in drops-config.js)

let template = null;                // cloned per drop once the glb loads
let line = null;                    // single shared blue pull line (pooled)
const tmp = new THREE.Vector3();    // scratch — no per-frame allocation
let warned = false;

// load the shared model once (fallback: a small metallic box until it arrives / if it fails)
gltfLoader.load(DROP_MODEL_URL, (g) => { template = normalize(g.scene); }, undefined, () => {});

// Center a model on its bounding-box center and scale its longest axis to ~2.5 world units (a drop reads
// as a small crate on the top-down screen). Returns the object ready to clone per drop.
function normalize(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);                 // recenter around the origin
  const longest = Math.max(size.x, size.y, size.z) || 1;
  obj.scale.multiplyScalar(2.5 / longest);
  // Glint: make the crate near-chrome so it catches scene.environment (RoomEnvironment env-map, engine.js)
  // + the combat sun and reads as a shiny loot box. Static one-time material tweak on the shared template
  // (every drop clones it) — no per-frame cost, no sparkle animation.
  obj.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if ('metalness' in m) m.metalness = 1.0;   // catch the env-map + sun
        if ('roughness' in m) m.roughness = 0.25;  // low roughness → a crisp specular glint
        m.needsUpdate = true;
      }
    }
  });
  const wrap = new THREE.Group();           // wrap so the per-drop rotation.y spins about the center
  wrap.add(obj);
  return wrap;
}

// A small metallic box used until the glb loads (or if it fails to load) — env-map lit like the ships.
function fallbackBox() {
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1.0, roughness: 0.25 }); // near-chrome glint (matches the glb tweak)
  return new THREE.Mesh(geo, mat);
}

function warnMissing() {
  if (!warned) { warned = true; console.warn('drops: item has no weight — using WEIGHT_FALLBACK'); }
}

// item = { kind:'component'|'weapon', refId } — its weight is looked up + cached at spawn.
export function spawnDrop(pos, item) {
  if (!item) return;
  if (drops.length >= MAX_DROPS) { console.warn('drops: cap reached, skipping'); return; } // perf guard
  const cat = item.kind === 'component' ? CATALOG.components.get(item.refId) : CATALOG.weapons.get(item.refId);
  const weight = (cat && cat.weight) || (warnMissing(), WEIGHT_FALLBACK);
  const obj = template ? template.clone(true) : fallbackBox();
  obj.position.copy(pos); obj.position.y = 0.8;
  scene.add(obj);
  drops.push({ obj, item, weight, inRange: 0 });
}

export function updateDrops(dt) {
  // 1) rotate every drop (cosmetic) — one turn / ROTATE_PERIOD
  for (const d of drops) d.obj.rotation.y += dt * (Math.PI * 2 / ROTATE_PERIOD);
  const p = G.player, grab = p && p.grab;
  // feature inert with no grab / dead player: hide the line and stop pulling
  if (!p || !p.alive || !grab) { hideLine(); return; }
  const range = grab.strength;                 // units
  const ppos = p.mesh.position;
  // 2) arm timers + find the nearest ARMED in-range drop
  let target = null, best = Infinity;
  for (const d of drops) {
    const dist = tmp.copy(d.obj.position).sub(ppos).length();
    if (dist <= range) { d.inRange += dt; if (d.inRange >= ARM_DELAY && dist < best) { best = dist; target = d; } }
    else d.inRange = 0;
  }
  if (!target) { hideLine(); return; }
  // 3) pull the target toward the ship at the weight-scaled speed
  const speed = pullSpeed(grab.strength, target.weight);
  tmp.copy(ppos).sub(target.obj.position); const d = tmp.length();
  if (d <= COLLECT_DIST) return collect(target);         // arrived → collect + re-target next frame
  target.obj.position.addScaledVector(tmp.normalize(), Math.min(speed * dt, d));
  drawLine(ppos, target.obj.position);                   // thin blue activity indicator
}

function collect(d) {
  scene.remove(d.obj);
  drops.splice(drops.indexOf(d), 1);
  pendingLoot.push(d.item);
  audio.sfx.pickup?.(); // small feedback blip
  hideLine();
}

// Remove every drop mesh + the line and DISCARD any uncollected/un-deposited loot (called by reset()).
export function clearDrops() { for (const d of drops) scene.remove(d.obj); drops.length = 0; pendingLoot.length = 0; hideLine(); }
// Hand the run's collected loot to the caller (the victory deposit), clearing it.
export function takeLoot() { const l = pendingLoot.slice(); pendingLoot.length = 0; return l; }

// One pooled blue THREE.Line (2-vertex BufferGeometry), created lazily; only its two positions change.
function ensureLine() {
  if (line) return line;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x4db6ff }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return line;
}
function drawLine(a, b) {
  const l = ensureLine();
  const pos = l.geometry.attributes.position;
  pos.setXYZ(0, a.x, a.y, a.z);
  pos.setXYZ(1, b.x, b.y, b.z);
  pos.needsUpdate = true;
  l.visible = true;
}
function hideLine() { if (line) line.visible = false; }
