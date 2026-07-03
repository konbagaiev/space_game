// World building: the arena boundary, the starry sky, the planet + moons + parallax asteroids,
// and the procedural mission set-pieces — assembled from a map descriptor by buildMap(). The
// reassigned per-map handles (sky/stars/skyAmbient/skySun/arenaDrift/…) live on the shared state
// bag G; the arena geometry (ARENA/OOB constants, arenaCenter, arenaBorder) is exported const.
import * as THREE from 'three';
import { scene, skyScene } from './engine.js';
import { G, moons, setPieces } from './state.js';
import { gltfLoader } from './ship-factory.js'; // shared GLTFLoader (meshopt-wired) for the .glb freighter set-piece

// ---------- Arena ----------
// There is no visible floor - ships hover in open space.
// ARENA is the half-size of the square battlefield, used only for the soft-boundary UI (the edge
// marker + the out-of-bounds warning/warp-back; see the OOB logic in update()). NOTHING is hard-clamped
// to it: the player, enemies, bullets and rockets all move and fight freely beyond it. See DECISIONS §2.
export const ARENA = 360; // half-size of the square arena (x4); 1.5x the original 240 -> a bigger combat zone
export const OOB_WARN_DELAY = 2.0;   // seconds continuously out of bounds before the warning shows
export const OOB_RETURN_TIME = 30.0; // seconds continuously out of bounds before the auto warp-back

// The combat zone's CENTER. Usually (0,0), but for a drifting mission (e.g. escort a freighter) the map
// descriptor's `drift` slowly moves it; the soft boundary, warp-back and mini-map all compute relative to
// THIS, not world (0,0). The synced freighter set-piece follows it. See docs/plans/mission-maps.md.
export const arenaCenter = new THREE.Vector3(0, 0, 0);

// A faint glowing square at the arena edge (±ARENA) so the player can SEE where the battlefield
// ends. It sits just above the combat plane; its opacity ramps up as the player nears/crosses it
// (updated in update()), and fog naturally fades the far edge when the player is centered.
export const arenaBorder = (() => {
  const y = 0.4;
  const corners = [[-ARENA, -ARENA], [ARENA, -ARENA], [ARENA, ARENA], [-ARENA, ARENA], [-ARENA, -ARENA]];
  const geo = new THREE.BufferGeometry().setFromPoints(
    corners.map(([x, z]) => new THREE.Vector3(x, y, z))
  );
  const mat = new THREE.LineBasicMaterial({
    color: 0x49e0ff, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = -1;
  scene.add(line);
  return { line, mat };
})();

// ---------- Starry sky ----------
// A soft radial-gradient sprite (white core -> transparent edge), used as the point texture for the
// bright-star layer so those stars bloom into a round halo instead of a hard square. Built once.
let starGlowTexture = null;
function getStarGlowTexture() {
  if (starGlowTexture) return starGlowTexture;
  const s = 64, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)'); // tight bright core
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)'); // soft falloff
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  starGlowTexture = new THREE.CanvasTexture(cv);
  return starGlowTexture;
}

// One random point on a sphere shell (radius * 0.7..1.0), written into `pos` at index i.
function placeStar(pos, i, radius) {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  const dist = radius * (0.7 + Math.random() * 0.3);
  pos[i * 3]     = Math.cos(theta) * r * dist;
  pos[i * 3 + 1] = u * dist; // across the whole sphere, including below the platform
  pos[i * 3 + 2] = Math.sin(theta) * r * dist;
}

// The starfield is TWO point layers: the dim majority (small, opaque) and a bright ~2% that pops via a
// bigger size + a soft additive glow sprite + a near-white, full-luminance color (the three cues that
// actually make a ~1px point read as "brighter"; see DECISIONS §4). Returns a Group so the render loop
// keeps gluing the whole field to the camera (`stars.position.copy(...)`).
function makeStars(count, radius, brightFraction = 0.02) {
  const brightCount = Math.round(count * brightFraction);
  const dimCount = count - brightCount;
  const c = new THREE.Color();
  const group = new THREE.Group();

  // --- dim majority: small opaque points, power-law brightness (many dim, few less-dim) ---
  const dPos = new Float32Array(dimCount * 3), dCol = new Float32Array(dimCount * 3);
  for (let i = 0; i < dimCount; i++) {
    placeStar(dPos, i, radius);
    c.setHSL(0.55 + Math.random() * 0.12, 0.25 + Math.random() * 0.3, 0.7); // bluish <-> warm
    const b = 0.15 + Math.pow(Math.random(), 2.2) * 0.85; // exponent >1 -> mostly dim
    dCol[i * 3] = c.r * b; dCol[i * 3 + 1] = c.g * b; dCol[i * 3 + 2] = c.b * b;
  }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
  const dim = new THREE.Points(dGeo, new THREE.PointsMaterial({
    size: 1.4,
    sizeAttenuation: false, // stars are the same size regardless of distance
    vertexColors: true,
    transparent: false,     // opaque -> drawn in the pass before the planet (so the planet occludes them)
    fog: false,             // fog must not dim the stars
    depthTest: false,       // pure backdrop - planet/moons always occlude them
    depthWrite: false,
  }));
  dim.renderOrder = -1;
  group.add(dim);

  // --- bright ~2%: bigger glowing additive sprites, near-white at full luminance ---
  if (brightCount > 0) {
    const bPos = new Float32Array(brightCount * 3), bCol = new Float32Array(brightCount * 3);
    for (let i = 0; i < brightCount; i++) {
      placeStar(bPos, i, radius);
      // near-white with a faint blue/warm tint, kept at full luminance (no dimming) so they read hot
      c.setHSL(0.55 + Math.random() * 0.12, 0.15 + Math.random() * 0.2, 0.92);
      bCol[i * 3] = c.r; bCol[i * 3 + 1] = c.g; bCol[i * 3 + 2] = c.b;
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
    const bright = new THREE.Points(bGeo, new THREE.PointsMaterial({
      size: 5.0,              // ~3.5x the dim size -> reads as a noticeably brighter star
      map: getStarGlowTexture(),
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending, // bright core blooms over the dark backdrop
      fog: false,
      depthTest: true,        // UNLIKE the dim layer: lets the planet occlude them so the glow can't
      depthWrite: false,      // creep onto the planet disk (the transparency gotcha in DECISIONS §5)
    }));
    bright.renderOrder = -1;
    group.add(bright);
  }
  return group;
}

// ---------- Planet with moons (built by buildMap from the map descriptor) ----------
// The camera looks almost straight down, so the "sky" is visible only near the top edge of the
// screen (the -Z direction). That is where the planet sits as a distant background.

// Minimal procedural surface: an ocean world with depth variation and soft white clouds, tinted to
// the map's ocean color.
// Drawn once onto a canvas (no asset files) and used as the planet's color map. The planet does
// not rotate (to keep the terminator consistent), so a static, baked texture is enough.
function makePlanetTexture(oceanHex = 0x5a82c0) {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // depth variation is derived from the ocean color so any tint works (lighter shallows / darker deeps)
  const br = (oceanHex >> 16) & 255, bg = (oceanHex >> 8) & 255, bb = oceanHex & 255;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const shade = (f) => `rgb(${clamp(br * f)},${clamp(bg * f)},${clamp(bb * f)})`;

  ctx.fillStyle = shade(1); // ocean base
  ctx.fillRect(0, 0, w, h);

  // soft radial blob helper (fades to transparent at the rim)
  const blob = (x, y, r, color, alpha) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  };

  // keep features in the central latitude band: at the poles an equirectangular map pinches
  // into visible streaks, so we avoid the top/bottom edges of the canvas.
  const yBand = () => h * (0.14 + Math.random() * 0.72);

  // ocean depth variation: gentle lighter shallows and slightly darker deeps, close to the base
  // so the planet's overall brightness stays the same (it shouldn't look darker/unlit).
  for (let i = 0; i < 26; i++) {
    blob(Math.random() * w, yBand(), 60 + Math.random() * 140,
      Math.random() < 0.5 ? shade(1.36) : shade(0.82), 0.45);
  }
  // a few faint teal landmasses / reefs for variety
  for (let i = 0; i < 8; i++) {
    blob(Math.random() * w, yBand(), 50 + Math.random() * 90, '#4a8b86', 0.3);
  }
  // clouds: soft white wisps over the oceans
  for (let i = 0; i < 60; i++) {
    blob(Math.random() * w, yBand(), 25 + Math.random() * 70, '#eaf2ff', 0.18 + Math.random() * 0.22);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Simple procedural moon surface: the base rock color with a scatter of craters (a darker floor
// plus a lighter rim ring) and faint maria. Albedo only (no directional shading baked in) so it
// doesn't fight the real sky-scene light. Drawn once onto a canvas, no asset files.
function makeMoonTexture(baseHex) {
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const br = (baseHex >> 16) & 255, bg = (baseHex >> 8) & 255, bb = baseHex & 255;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const shade = (f) => `rgb(${clamp(br * f)},${clamp(bg * f)},${clamp(bb * f)})`;
  // keep features off the poles (equirectangular pinching)
  const yBand = () => h * (0.16 + Math.random() * 0.68);

  ctx.fillStyle = shade(1);
  ctx.fillRect(0, 0, w, h);

  // faint maria (large soft light/dark patches)
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * w, y = yBand(), r = 40 + Math.random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, Math.random() < 0.5 ? shade(0.86) : shade(1.12));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.4; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // craters: darker floor + lighter rim ring
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * w, y = yBand(), r = 5 + Math.random() * 16;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = shade(0.7);
    ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = shade(1.3);
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// One moon: ORBITs the planet (only its position changes). Lit by the same real sky-scene light as
// the planet -> terminators are consistent. Added to the `sky` group; tracked in `moons`.
function makeMoon(radius, color, orbitR, tilt, speed) {
  const geo = new THREE.SphereGeometry(radius, 32, 32);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: makeMoonTexture(color), roughness: 1.0, metalness: 0.0, fog: false }));
  G.sky.add(mesh);
  const m = { mesh, orbitR, tilt, speed, angle: Math.random() * Math.PI * 2 };
  moons.push(m);
  return m;
}

// position of a moon on a tilted orbit around the planet (the body itself does not rotate)
export function updateMoons(dt) {
  for (const m of moons) {
    m.angle += m.speed * dt;
    const px = Math.cos(m.angle) * m.orbitR;
    const pz = Math.sin(m.angle) * m.orbitR;
    m.mesh.position.set(
      planetPos.x + px,
      planetPos.y - pz * Math.sin(m.tilt),
      planetPos.z + pz * Math.cos(m.tilt)
    );
  }
}

// A parallax asteroid layer (one InstancedMesh = one draw call): small rocks BEHIND the combat
// plane in WORLD coordinates (not stuck to the camera). Distributed in a RING (annulus) well OUTSIDE
// the arena — a distant field beyond the battlefield, not clutter inside it. `inner`/`spread` are the
// ring's inner/outer radius; `minSize`/`maxSize`/`depth`/`depthVar` size and sink the rocks (defaults
// keep older descriptors working). Flying toward the edge brings them closer → a sense of speed.
function makeAsteroids({ count, spread, color, inner = 0, minSize = 0.4, maxSize = 1.3, depth = 6, depthVar = 10 }) {
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0), // low-poly rock
    new THREE.MeshStandardMaterial({ color, roughness: 1.0, metalness: 0.05, flatShading: true }),
    count
  );
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  const eul = new THREE.Euler(), scl = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // area-uniform radius in [inner, spread], random angle → an even ring around the arena
    const r = Math.sqrt(inner * inner + Math.random() * (spread * spread - inner * inner));
    const a = Math.random() * Math.PI * 2;
    pos.set(Math.cos(a) * r, -depth - Math.random() * depthVar, Math.sin(a) * r);
    eul.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    quat.setFromEuler(eul);
    const s = minSize + Math.random() * (maxSize - minSize);
    scl.set(s, s, s);
    m4.compose(pos, quat, scl);
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// ---------- Mission set-pieces (procedural decor in the combat scene) ----------
// Generated in code (no .glb), added to the COMBAT scene so they're lit from above by the combat sun
// like the ships — the near "battle environment" we fight around. They sit ~500 below the combat plane
// (real depth, render behind the ships); materials use `fog: false` so they stay readable at that range.
// Decoration only: not in the gameplay arrays, so bullets pass through and the AI ignores them.
// See docs/plans/mission-maps.md.

// Research station: a central hub + a flat ring on spokes, two solar-panel wings, a few modules, and
// emissive windows. Big and readable from the arena; slowly rotates so it reads as "alive".
function makeResearchStation(spec) {
  const g = new THREE.Group();
  const tint = spec.hue ?? 0x9aa7b5;
  const body = new THREE.MeshStandardMaterial({ color: tint, metalness: 0.85, roughness: 0.42, flatShading: true, fog: false });
  const dark = new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.7, roughness: 0.55, flatShading: true, fog: false });
  const panel = new THREE.MeshStandardMaterial({ color: 0x16284c, metalness: 0.35, roughness: 0.5, emissive: 0x0b1c3a, emissiveIntensity: 0.6, flatShading: true, fog: false });
  const glow = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, fog: false }); // emissive windows / running lights

  // central hub (vertical cylinder, axis = camera-facing y)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 70, 18), body);
  g.add(hub);
  // a window band around the hub
  const band = new THREE.Mesh(new THREE.CylinderGeometry(22.6, 22.6, 8, 18, 1, true), glow);
  band.position.y = 6; g.add(band);
  // a capped dome on top
  const dome = new THREE.Mesh(new THREE.SphereGeometry(22, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  dome.position.y = 35; g.add(dome);

  // outer ring lying flat in the XZ plane, on 4 spokes
  const ring = new THREE.Mesh(new THREE.TorusGeometry(92, 7, 12, 56), body);
  ring.rotation.x = Math.PI / 2; g.add(ring);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(86, 5, 8), dark);
    spoke.position.set(Math.cos(i * Math.PI / 2) * 46, 0, Math.sin(i * Math.PI / 2) * 46);
    spoke.rotation.y = -i * Math.PI / 2; g.add(spoke);
  }
  // running lights spaced around the ring
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const led = new THREE.Mesh(new THREE.SphereGeometry(2.2, 6, 6), glow);
    led.position.set(Math.cos(a) * 92, 0, Math.sin(a) * 92); g.add(led);
  }

  // two solar-panel wings extending along x
  for (const dir of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(40, 3, 4), dark);
    arm.position.set(dir * 42, 22, 0); g.add(arm);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(70, 1.5, 46), panel);
    wing.position.set(dir * 96, 22, 0); g.add(wing);
  }
  // a couple of docking modules near the hub
  for (const dz of [-1, 1]) {
    const mod = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 26), body);
    mod.position.set(0, -8, dz * 30); g.add(mod);
    const lite = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 2), glow);
    lite.position.set(0, -2, dz * 42); g.add(lite);
  }

  const spin = spec.spin ?? 0.06;
  g.rotation.x = spec.tilt ?? 0; // a light tilt so the ring/face reads from the top-down camera
  // spin around the station's OWN (tilted) vertical axis so the tilt is preserved as it rotates
  return { obj: g, update: (dt) => { g.rotateY(spin * dt); } };
}

// One irregular asteroid: a subdivided icosahedron whose vertices are pushed in/out by a coherent
// (position-based, seed-varied) noise so it's lumpy, not round — flat-shaded + a cratered moon texture.
function makeIrregularAsteroid(radius, tex, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const p = geo.attributes.position, v = new THREE.Vector3();
  const a = seed * 1.7, b = seed * 2.3, c = seed * 0.9;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.clone().normalize(); // noise on direction → shared verts move together (no cracks)
    const n = 1 + 0.22 * Math.sin(d.x * 3.3 + a) + 0.18 * Math.sin(d.y * 4.1 + b)
                + 0.20 * Math.sin(d.z * 3.7 + c) + 0.12 * Math.sin((d.x + d.z) * 6.2 + seed);
    v.multiplyScalar(n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, metalness: 0.05, flatShading: true, fog: false }));
}

// Asteroid field + mining stations: each station works a host asteroid with a beam = a stream of
// microparticles flowing from the asteroid up to the station's collector. The rigs are TILTED off
// vertical so the beam has horizontal extent and reads well from the top-down camera. Irregular/cratered
// rocks (distinct from the round parallax-backdrop asteroids); decor only (not collidable).
function makeAsteroidField(spec) {
  const g = new THREE.Group();
  const base = spec.color ?? 0x6e6a63;
  const texes = [makeMoonTexture(base), makeMoonTexture(0x5f5a52), makeMoonTexture(0x726a60)];
  const count = spec.count ?? 14, spread = spec.spread ?? 120;
  const minS = spec.minSize ?? 6, maxS = spec.maxSize ?? 26;
  const beamColor = spec.beamColor ?? 0xffcc66;
  const metal = new THREE.MeshStandardMaterial({ color: 0x8b94a0, metalness: 0.8, roughness: 0.4, flatShading: true, fog: false });
  const litMat = new THREE.MeshBasicMaterial({ color: beamColor, fog: false });

  // scattered field rocks (vertical scatter kept shallow so the field stays just below the plane)
  const rocks = [];
  for (let i = 0; i < count; i++) {
    const r = minS + Math.random() * (maxS - minS);
    const m = makeIrregularAsteroid(r, texes[i % 3], i * 1.37 + 1);
    m.position.set((Math.random() * 2 - 1) * spread, (Math.random() * 2 - 1) * spread * 0.22, (Math.random() * 2 - 1) * spread);
    m.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    g.add(m);
    rocks.push({ mesh: m, sx: (Math.random() - 0.5) * 0.2, sy: (Math.random() - 0.5) * 0.2, sz: (Math.random() - 0.5) * 0.2 });
  }

  // mining rigs: a host asteroid + a tilted station + a tilted beam. Two of them, placed apart.
  const hostR = spec.hostSize ?? 26, beamLen = spec.beamLen ?? 34, tilt = spec.beamTilt ?? 0.5; // tilt rad off vertical
  const N = spec.beamCount ?? 50, width = spec.beamWidth ?? 3, speed = spec.beamSpeed ?? 0.5;
  const UP = new THREE.Vector3(0, 1, 0);
  const placements = [
    { pos: new THREE.Vector3(-spread * 0.30, -spread * 0.08, spread * 0.18), az: 0.6 },
    { pos: new THREE.Vector3(spread * 0.32, spread * 0.08, -spread * 0.22), az: 3.6 },
  ];
  const rigs = placements.map((pl, k) => {
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(pl.az), Math.cos(tilt), Math.sin(tilt) * Math.sin(pl.az)).normalize();
    const host = makeIrregularAsteroid(hostR, texes[k % 3], 90 + k);
    host.position.copy(pl.pos); g.add(host);

    const station = new THREE.Group();
    station.add(new THREE.Mesh(new THREE.BoxGeometry(22, 11, 16), metal));
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(5, 9, 13, 12), metal); funnel.position.y = -10; station.add(funnel);
    const slite = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 8), litMat); slite.position.y = 8; station.add(slite);
    const stationPos = pl.pos.clone().addScaledVector(dir, hostR + beamLen);
    station.position.copy(stationPos);
    station.quaternion.setFromUnitVectors(UP, dir); // tilt the station to align with the beam
    g.add(station);

    // beam from the host surface to the collector, along the tilted axis, with perpendicular wobble
    const from = pl.pos.clone().addScaledVector(dir, hostR * 0.7);
    const seg = stationPos.clone().addScaledVector(dir, -12).sub(from);
    const axis = seg.clone().normalize();
    const perp1 = new THREE.Vector3(0, 0, 1);
    if (Math.abs(axis.z) > 0.9) perp1.set(1, 0, 0);
    perp1.crossVectors(axis, perp1).normalize();
    const perp2 = new THREE.Vector3().crossVectors(axis, perp1);
    const bpos = new Float32Array(N * 3), bt = new Float32Array(N), boff = new Float32Array(N);
    for (let i = 0; i < N; i++) { bt[i] = Math.random(); boff[i] = Math.random() * Math.PI * 2; }
    const bgeo = new THREE.BufferGeometry(); bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    const bmat = new THREE.PointsMaterial({ color: beamColor, size: 2.4, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    g.add(new THREE.Points(bgeo, bmat));
    return { host, from, seg, perp1, perp2, bpos, bt, boff, bgeo };
  });

  return { obj: g, update: (dt) => {
    for (const r of rocks) { r.mesh.rotation.x += r.sx * dt; r.mesh.rotation.y += r.sy * dt; r.mesh.rotation.z += r.sz * dt; }
    for (const rig of rigs) {
      rig.host.rotation.y += 0.05 * dt;
      for (let i = 0; i < N; i++) {
        rig.bt[i] += dt * speed; if (rig.bt[i] > 1) rig.bt[i] -= 1;
        const t = rig.bt[i], c = Math.cos(rig.boff[i]), s = Math.sin(rig.boff[i]);
        const wob = Math.sin(rig.boff[i] + t * 6) * width * (1 - t); // taper toward the collector
        rig.bpos[i * 3]     = rig.from.x + rig.seg.x * t + (rig.perp1.x * c + rig.perp2.x * s) * wob;
        rig.bpos[i * 3 + 1] = rig.from.y + rig.seg.y * t + (rig.perp1.y * c + rig.perp2.y * s) * wob;
        rig.bpos[i * 3 + 2] = rig.from.z + rig.seg.z * t + (rig.perp1.z * c + rig.perp2.z * s) * wob;
      }
      rig.bgeo.attributes.position.needsUpdate = true;
    }
  } };
}

// Cargo freighter (for "save the transport"): the first .glb-backed set-piece — it loads a real cargo-ship
// model (auto center/scale/`yaw`-oriented like a ship model) and keeps a fiery exhaust particle stream
// (hot→orange→red) streaming aft from behind the model's real engines. Nose faces +z (travel direction).
// When `spec.sync`, it follows the drifting arena center so it stays "below the battlefield" as the zone pans.
const FREIGHTER_MODEL_LEN = 130; // normalize the glb's longest axis to the old procedural spine length,
                                 // so the existing set-piece pos + scale:0.33 stay visually equivalent
function makeFreighter(spec) {
  const g = new THREE.Group();

  // --- Exhaust effect config: OPTIONAL, delivered from the server via the set-piece spec (map descriptor).
  //     Falls back to the built-in fiery look. Extension point for future server-driven model effects. ---
  const ex = spec.exhaust || {};
  const pal = ex.palette || {};
  const N    = ex.count ?? 90;
  const len  = ex.len   ?? 48;
  const size = ex.size  ?? 5;
  const espd = ex.speed ?? 1.4;
  const cHot = new THREE.Color(pal.hot ?? 0xfff1c0);
  const cMid = new THREE.Color(pal.mid ?? 0xff7a2a);
  const cEnd = new THREE.Color(pal.end ?? 0x7a1208);
  const tmp  = new THREE.Color();

  // Emitter origin + lateral spread are MUTABLE: the exhaust is built now, but the model (whose real rear
  // bounds define where fire should stream from) loads async. The loader overwrites these; the update loop
  // reads them each frame. Sensible pre-load default so a trail shows immediately.
  const emit = new THREE.Vector3(0, 0, -60); // group-local (pre-scale) units
  let spread = 3;                            // lateral jitter half-extent, group-local

  // fiery exhaust: additive points streaming aft from a single rear-center emitter, colored hot→orange→red
  const epos = new Float32Array(N * 3), ecol = new Float32Array(N * 3), et = new Float32Array(N);
  const eoff = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { et[i] = Math.random(); eoff[i * 2] = Math.random() - 0.5; eoff[i * 2 + 1] = Math.random() - 0.5; }
  const egeo = new THREE.BufferGeometry();
  egeo.setAttribute('position', new THREE.BufferAttribute(epos, 3));
  egeo.setAttribute('color', new THREE.BufferAttribute(ecol, 3));
  const emat = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  g.add(new THREE.Points(egeo, emat));

  // load the .glb (exhaust-only during load and on error — no procedural fallback), then re-derive the
  // emitter from the model's real group-local rear bounds so fire streams from behind the actual engines
  if (spec.modelUrl) gltfLoader.load(spec.modelUrl, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size3 = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = FREIGHTER_MODEL_LEN / (Math.max(size3.x, size3.y, size3.z) || 1);
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s); // recenter at group origin
    const pivot = new THREE.Group();
    pivot.rotation.y = spec.yaw ?? 0;               // orient nose to +Z (data-fixed, like ship models)
    pivot.add(model);
    pivot.updateMatrixWorld(true);                  // measure while unparented → local == world
    const lbox = new THREE.Box3().setFromObject(pivot); // group-local bounds after scale+yaw
    // single rear-center emitter: model's tail (-Z), vertical center, spread scaled to the rear width
    emit.set(0, (lbox.min.y + lbox.max.y) / 2, lbox.min.z);
    spread = (lbox.max.x - lbox.min.x) * 0.2;
    g.add(pivot);
  }, undefined, (err) => console.warn('Freighter model failed to load, keeping exhaust only:', spec.modelUrl, err));

  return { obj: g, update: (dt) => {
    for (let i = 0; i < N; i++) {
      et[i] += dt * espd; if (et[i] > 1) et[i] -= 1;
      const t = et[i], sp = 1 + t * 4;
      epos[i * 3]     = emit.x + eoff[i * 2] * spread * sp;
      epos[i * 3 + 1] = emit.y + eoff[i * 2 + 1] * spread * sp;
      epos[i * 3 + 2] = emit.z - t * len;
      if (t < 0.5) tmp.copy(cHot).lerp(cMid, t / 0.5); else tmp.copy(cMid).lerp(cEnd, (t - 0.5) / 0.5);
      ecol[i * 3] = tmp.r; ecol[i * 3 + 1] = tmp.g; ecol[i * 3 + 2] = tmp.b;
    }
    egeo.attributes.position.needsUpdate = true; egeo.attributes.color.needsUpdate = true;
    // a transport in transit: it slowly cruises forward (along its nose, +z) at `speed` units/sec
    if (spec.speed) g.position.z += spec.speed * dt;
    // (escort drift) ride the zone center while the arena is drifting — off unless a mission turns it on
    if (spec.sync && G.arenaDrift) { g.position.x = arenaCenter.x; g.position.z = arenaCenter.z; }
  } };
}

// Base station (return-to-base target): a below-plane, NON-collidable .glb set-piece at the world origin,
// mirroring the freighter's async center/scale/`yaw` normalization but with no exhaust. It is raised closer
// to the combat plane than the freighter so it reads clearly from the top-down camera; after the last kill
// the client makes it clickable → autopilot flies the player home → victory. See DECISIONS §39.
//
// VERTICAL-EXTENT NOTE (§17): the source model is tall (y ≈ 0.78 of its longest axis). BASE_STATION_LEN 100
// normalizes the longest axis, so halfHeight ≈ 39; with the seed's pos.y = -42 the station's TOP sits at
// ~y = -2.9 — safely below the combat plane (ships fly at y ≈ 0.6), so it never pokes through or occludes
// ships. If BASE_STATION_LEN or the seed's y is changed, re-check that pos.y + halfHeight stays below ~0.6.
const BASE_STATION_LEN = 100;

function makeBaseStation(spec) {
  const g = new THREE.Group();
  if (spec.modelUrl) gltfLoader.load(spec.modelUrl, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size3 = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = BASE_STATION_LEN / (Math.max(size3.x, size3.y, size3.z) || 1);
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s); // recenter at group origin
    const pivot = new THREE.Group();
    pivot.rotation.y = spec.yaw ?? 0;
    pivot.add(model);
    g.add(pivot);
  }, undefined, (err) => console.warn('Base station model failed to load:', spec.modelUrl, err));
  const spin = spec.spin ?? 0;
  return { obj: g, update: (dt) => { if (spin) g.rotation.y += spin * dt; } };
}

// Dispatch a set-piece spec to its procedural builder, position it, and add it to the combat scene.
export function buildSetPiece(spec) {
  let entry = null;
  switch (spec.type) {
    case 'research-station': entry = makeResearchStation(spec); break;
    case 'asteroid-field':   entry = makeAsteroidField(spec); break;
    case 'freighter':        entry = makeFreighter(spec); break;
    case 'base-station':     entry = makeBaseStation(spec); break;
    default: return; // unknown type → skip (forward-compatible with new set-pieces)
  }
  if (spec.scale && spec.scale !== 1) entry.obj.scale.setScalar(spec.scale);
  entry.obj.position.set(...spec.pos);
  scene.add(entry.obj);
  setPieces.push(entry);
  // Stash the base station on G so the sim/HUD/click code can find it (the return-to-base target).
  if (spec.type === 'base-station') G.baseStation = { obj: entry.obj, active: false };
}

// ---------- Build the scene from a map descriptor (see server catalog_seed.js MAPS) ----------
// Generic generator: builds the sky backdrop (background, lights, planet, moons, stars), the asteroid
// layer, and any mission set-pieces from `descriptor`. The combat-scene light is constant (readability).
let rocks = null;                       // current parallax asteroid layer (rebuilt per map; not read elsewhere)
const planetPos = new THREE.Vector3();  // planet center (moons orbit it); mutated in place by buildMap
export function buildMap(descriptor) {
  const d = descriptor;
  G.currentMapDescriptor = descriptor; // remembered for the ?tune panel's rebuild button
  // clear set-pieces from a previous map (switching maps between levels)
  for (const sp of setPieces) scene.remove(sp.obj);
  setPieces.length = 0;
  // arena drift: maps with a `drift` (units/sec on x,z) slowly pan the combat zone; default = static
  G.arenaDrift = d.drift ? new THREE.Vector3(d.drift.x || 0, 0, d.drift.z || 0) : null;
  G.baseStation = null; // rebuilt by buildSetPiece below when the map has a base-station set-piece
  arenaCenter.set(0, 0, 0);
  arenaBorder.line.position.set(0, 0, 0);
  skyScene.background = new THREE.Color(d.background);
  G.skyAmbient = new THREE.AmbientLight(d.sky.ambient.color, d.sky.ambient.intensity); // night-side fill
  skyScene.add(G.skyAmbient);
  G.skySun = new THREE.DirectionalLight(d.sky.sun.color, d.sky.sun.intensity);    // side light -> terminator
  G.skySun.position.set(...d.sky.sun.pos);
  skyScene.add(G.skySun);

  G.stars = makeStars(Math.round(d.stars.count * G.gfx.starScale), d.stars.radius); // density scales with quality tier
  G.stars.renderOrder = -1; // draw stars first, before the planet and moons
  skyScene.add(G.stars);

  G.sky = new THREE.Group();
  skyScene.add(G.sky);
  planetPos.set(...d.planet.pos);

  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(d.planet.radius, 64, 64),
    new THREE.MeshStandardMaterial({ map: makePlanetTexture(d.planet.ocean), roughness: 0.9, metalness: 0.0, fog: false })
  );
  planet.position.copy(planetPos);
  G.sky.add(planet);
  if (d.planet.halo) { // atmospheric rim (glow along the edge)
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(d.planet.radius + 4, 48, 48),
      new THREE.MeshBasicMaterial({ color: d.planet.halo.color, transparent: true, opacity: d.planet.halo.opacity, side: THREE.BackSide, fog: false })
    );
    halo.position.copy(planetPos);
    G.sky.add(halo);
  }

  for (const mn of d.moons) makeMoon(mn.radius, mn.color, mn.orbitR, mn.tilt, mn.speed);

  rocks = makeAsteroids(d.asteroids);
  scene.add(rocks);

  // mission set-pieces (decor in the combat scene), fixed in this shared world; remembered so each run
  // rebuilds them fresh (resets the cruising freighter)
  G.mapSetpieces = d.setpieces || [];
  for (const sp of G.mapSetpieces) buildSetPiece(sp);
}
