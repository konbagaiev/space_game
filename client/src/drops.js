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
import { DROP_MODEL_URL, DROP_CHANCE, MAX_DROPS, ARM_DELAY, ROTATE_PERIOD, COLLECT_DIST, WEIGHT_FALLBACK,
         REWARD_TINT, REWARD_HALO_SIZE, pullSpeed, pickLoot, shouldDeposit, rewardOwned } from './drops-config.js';

export const drops = [];            // { obj, item:{kind,refId}, weight, inRange (sec), special? }
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
  // Silver crate: a bright brushed-silver so it reads against dark space (a pure chrome mirror went black
  // when the environment behind it was dark). We give it a light silver albedo (not a full mirror), a soft
  // metallic glint off scene.environment (RoomEnvironment env-map, engine.js) + the combat sun, and a faint
  // emissive floor so the crate is never fully black even where the scene is unlit. Static one-time tweak on
  // the shared template (every drop clones it) — no per-frame cost, no sparkle animation.
  obj.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map = null;                     // drop the dark placeholder texture so the silver shows cleanly
        if (m.color) m.color.setHex(0xd2d6de);       // bright silver base — reads light, not black
        if ('metalness' in m) m.metalness = 0.55;    // metallic sheen, but low enough to keep a visible silver albedo
        if ('roughness' in m) m.roughness = 0.4;     // brushed silver — soft glint, not a dark mirror
        if (m.emissive) { m.emissive.setHex(0x3a3e46); m.emissiveIntensity = 0.55; } // self-lit floor → never fully black
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
  const mat = new THREE.MeshStandardMaterial({ color: 0xd2d6de, metalness: 0.55, roughness: 0.4, emissive: 0x3a3e46, emissiveIntensity: 0.55 }); // bright silver, visible against dark space (matches the glb tweak)
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

// ---------- Special (L1/L2 reward) drops: green model + halo, cosmetic (no stash deposit) ----------
// A green variant of normalize(): keep the center + scale-longest-axis logic, but give the model a GREEN
// emissive tint (no silver albedo override) so it reads as a glowing reward, not a metal crate.
function normalizeGreen(obj, targetLen = 2.5) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  obj.scale.multiplyScalar(targetLen / longest);
  obj.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.emissive) { m.emissive.setHex(REWARD_TINT); m.emissiveIntensity = 0.9; } // glowing green tint
        m.needsUpdate = true;
      }
    }
  });
  const wrap = new THREE.Group(); // wrap so the per-drop rotation.y spins about the center
  wrap.add(obj);
  return wrap;
}

// An immediate green glowing stand-in shown until the (lazy CloudFront) reward glb loads / if it fails.
function greenFallbackBox() {
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const mat = new THREE.MeshStandardMaterial({ color: REWARD_TINT, emissive: REWARD_TINT, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.__fallback = true;   // so spawnSpecialDrop can find + remove it once the model arrives
  return mesh;
}

// One shared additive green halo texture (a radial gradient on a small canvas) — reads as a soft glow
// behind the reward model. Sprites always face the camera, so it glows regardless of the drop's spin.
let haloTexture = null;
function ensureHaloTexture() {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  haloTexture = new THREE.CanvasTexture(c);
  return haloTexture;
}
function addHalo(wrap) {
  const mat = new THREE.SpriteMaterial({ map: ensureHaloTexture(), color: REWARD_TINT, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(REWARD_HALO_SIZE);
  wrap.add(sprite);
}

// Resolve a reward { kind, refId } to its catalog row + hangar url + drop target size (longest axis,
// world units). The Machine Gun (weapon 5) reads thin at the shared 2.5, so its drop is enlarged 1.5×.
function rewardModelSpec(reward) {
  const cat = reward.kind === 'component' ? CATALOG.components.get(reward.refId) : CATALOG.weapons.get(reward.refId);
  if (!cat) return null;
  const targetLen = 2.5 * (reward.kind === 'weapon' && reward.refId === 5 ? 1.5 : 1);
  return { cat, url: cat.modelUrlHigh, targetLen };
}

// Cache of NORMALIZED reward templates keyed by url, so the (high-poly CloudFront hangar) glb is fetched +
// parsed ONCE — warmed at level start (preloadRewardModel) — and every drop is an instant clone. Without
// this the glb loaded on the last-enemy kill, hitching that exact frame. entry = { model, waiters }.
const rewardModelCache = new Map();
function requestRewardModel(url, targetLen, cb) {
  let entry = rewardModelCache.get(url);
  if (entry) {                                   // already loaded or in flight
    if (entry.model) { if (cb) cb(entry.model.clone(true)); }
    else if (cb) entry.waiters.push(cb);
    return;
  }
  entry = { model: null, waiters: cb ? [cb] : [] };
  rewardModelCache.set(url, entry);
  gltfLoader.load(url, (g) => {
    entry.model = normalizeGreen(g.scene, targetLen);   // GREEN emissive + scaled, kept as a template (never in-scene)
    for (const w of entry.waiters) w(entry.model.clone(true));
    entry.waiters.length = 0;
  }, undefined, () => { rewardModelCache.delete(url); entry.waiters.length = 0; }); // let a later attempt retry
}

// Warm the reward model at level start so the last-kill spawn is hitch-free (no CloudFront fetch/parse mid-frame).
export function preloadRewardModel(reward) {
  if (!reward) return;
  const spec = rewardModelSpec(reward);
  if (spec && spec.url) requestRewardModel(spec.url, spec.targetLen, null);
}

// Spawn the cosmetic reward drop (reward = { kind, refId } from the level's lastKillDrop). It reuses the
// normal drops[] lifecycle (rotate, arm, pull, off-screen marker) but is GREEN + haloed and, being
// `special: true`, deposits NOTHING when collected (see collect() / DECISIONS: exactly one copy). The
// model is cloned instantly from the warm cache (preloadRewardModel); if it isn't ready yet a green
// fallback box shows and the model swaps in on load (same wrap group, so an in-flight pull continues).
export function spawnSpecialDrop(pos, reward) {
  if (!reward) return;
  if (drops.length >= MAX_DROPS) { console.warn('drops: cap reached, skipping reward drop'); return; }
  const spec = rewardModelSpec(reward);
  if (!spec) return;
  const weight = spec.cat.weight || WEIGHT_FALLBACK;
  const wrap = new THREE.Group();
  addHalo(wrap);                         // additive green halo sprite behind the model
  wrap.position.copy(pos); wrap.position.y = 0.8;
  scene.add(wrap);
  const cached = spec.url && rewardModelCache.get(spec.url);
  if (cached && cached.model) {
    wrap.add(cached.model.clone(true));  // warm cache → instant clone, no hitch
  } else {
    wrap.add(greenFallbackBox());        // not preloaded yet: glowing green stand-in until the glb arrives
    if (spec.url) requestRewardModel(spec.url, spec.targetLen, (model) => {
      const box = wrap.children.find((c) => c.userData.__fallback);
      if (box) { wrap.remove(box); box.geometry.dispose(); box.material.dispose(); }
      wrap.add(model);
    });
  }
  drops.push({ obj: wrap, item: reward, weight, inRange: 0, special: true });
}

// Ownership gate off G.activeShip: has the player already got this reward? Delegates to the pure
// rewardOwned() (drops-config.js) so the logic stays node-testable; here we just supply G.activeShip.
export function ownsReward(reward) { return rewardOwned(G.activeShip, reward); }

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
  if (shouldDeposit(d)) pendingLoot.push(d.item); // cosmetic reward drops deposit NOTHING (DECISIONS: exactly one copy)
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
