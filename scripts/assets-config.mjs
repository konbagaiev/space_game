// Shared config for the ship-model asset pipeline (docs/plans/ship-model-pipeline.md).
// Source of truth for the bucket/CDN/prefixes + the local (gitignored) working dirs.
export const BUCKET = process.env.ASSETS_BUCKET || 'vega-sentinels-assets';
export const CDN = (process.env.ASSETS_CDN || 'https://d1843uwjdjg4vs.cloudfront.net').replace(/\/$/, '');
export const REGION = process.env.AWS_REGION || 'us-east-1';
// AWS profile: empty by default → uses the CLI's `default` profile locally (the admin user) OR the
// AWS_ACCESS_KEY_ID/SECRET env-var creds in CI (a scoped read-only key). Set AWS_PROFILE to pick another.
export const AWS_PROFILE = process.env.AWS_PROFILE ?? '';
// → the `--profile X` args for the aws CLI, or [] when none (env-var creds / default profile).
export const awsArgs = () => (AWS_PROFILE ? ['--profile', AWS_PROFILE] : []);

// S3 key prefixes.
export const PREFIX = {
  source: 'source/',        // high-poly originals (off-machine backup; lets the pipeline re-run)
  combat: 'ships-combat/',  // low-poly combat glbs (pulled onto the server at deploy, served same-origin)
  hangar: 'ships-hangar/',  // high-poly hangar glbs (served via CloudFront, lazy-loaded)
  sounds: 'sfx/',           // content-hashed SFX mp3s (pulled at deploy, served same-origin like combat)
  recordings: 'recordings/',// content-hashed input-replay traces (intro cutscene) — pulled + served same-origin
};

// Local working dirs — ALL gitignored (no binaries in git). Drop sources in `src` (models or sounds/*),
// build into `dist`; `*Serve` dirs are where the server serves the assets from (pulled there in CI / by
// `assets:pull`). SFX sources live in `assets-src/sounds/`, built mp3s in `assets-dist/sounds/`.
export const DIR = {
  src: 'assets-src',
  dist: 'assets-dist',
  combatServe: 'client/assets/ships',
  soundsServe: 'client/assets/sounds',
  recordingsServe: 'client/assets/recordings',
};

// Build presets (tunable). Combat is built to be as LIGHT as possible for battle — the ship is tiny on a
// top-down screen, so it is aggressively decimated AND meshopt-compressed. The hangar model keeps full
// detail with meshopt + WebP. Both need the MeshoptDecoder, which the client wires (`setMeshoptDecoder`),
// so both load in-game; inspect either in a web glTF viewer (see the pipeline doc).
export const PRESET = {
  // combat: smallest possible runtime download — heavy decimation + meshopt geometry compression.
  combat: { simplifyRatio: 0.2, simplifyError: 0.04, textureSize: 256, compress: 'meshopt', textureCompress: false, instance: false },
  // hangar: keep detail; meshopt + WebP for the (larger) CloudFront download.
  hangar: { simplifyRatio: 1.0, simplifyError: 0.0, textureSize: 1024, compress: 'meshopt', textureCompress: 'webp', instance: true },
};

// Per-source preset overrides, keyed by the source base name (file minus .glb). Merged over PRESET[kind]
// in assets:build. Use when one model needs different treatment than the default — e.g. the player ship
// is a richly-TEXTURED model (not a flat low-poly pack), so its combat build KEEPS the textures but
// shrinks them hard (128px → WebP) for a ~370 KB textured combat model. See docs/plans/ship-model-pipeline.md.
export const PRESET_OVERRIDES = {
  player: {
    // The hero ship is a Sketchfab model split "part x material" — 110 meshes over 36 materials, the same
    // material kind repeated per body part (Body_Chrome / Gun_Chrome / Canopy_Chrome / Thrusters_Chrome),
    // each with its own texture set. `join` can only merge primitives that SHARE a material, so the built
    // combat model was 31 DRAW CALLS and 79 textures — against 3-5 primitives for every other ship — and
    // per-frame draw-call submit is the measured weak-phone bottleneck (DECISIONS §23).
    // `flattenMaterials` replaces each material with its own sampled average colour/metal/rough before
    // `optimize`, so `--palette` can merge them and `--join` can collapse the mesh. `keepTexturedAbove`
    // leaves the base map on the few materials whose texture paints SEVERAL colours (the red engine
    // nacelles live inside an otherwise-grey `Thrusters_Material` atlas; the yellow wing chevrons inside
    // `Wings_Material`) — averaging those would quietly delete the ship's livery. 34 is the measured
    // threshold that keeps every visible marking: 31 draws/79 textures -> 16 draws/16 textures, and the
    // model halves to ~178 KB so a weak phone actually finishes downloading it. See
    // docs/plans/ship-model-pipeline.md.
    combat: { textureSize: 128, textureCompress: 'webp', flattenMaterials: { keepTexturedAbove: 34 } },
    hangar: { textureSize: 512 },                          // showcase detail, ~1.7 MB on CDN — full material set, never flattened
  },
  // Shared equipment-drop model (metal box). The source (703 KB) is texture-dominated, and a drop is tiny on
  // a top-down screen → shrink textures hard (128px → WebP) for a KB-scale combat build. See
  // docs/plans/2026-07-03-1412-grab-tractor-drops.md.
  metal_box: {
    combat: { textureSize: 128, textureCompress: 'webp' },
  },
  // Menu-only item icon shared by every THRUSTER component (ids 8/9/10/11/21/25/27). Hangar build only —
  // components are never rendered in combat (they're part of the ship there), so only the CloudFront glb is
  // wired into the catalog. (The base name says "engine": it is the SOURCE asset's name, and the two item
  // models were swapped between families after a look at the preview. catalog_seed.js is the wiring truth.)
  // The source is a genuinely tiny low-poly model (57 KB, 1.2 k verts) whose two
  // 512² atlases are only ~3 KB on disk, so shrinking them saves almost nothing on the DOWNLOAD — the win
  // is VRAM: two 512² RGBA atlases cost ~2.8 MB of texture memory, 256² costs ~700 KB, which matters on the
  // weak phones that already bottleneck on this game. Kept at 256 for that reason alone.
  engine_thruster: {
    hangar: { textureSize: 256, textureCompress: 'webp' },
  },
  // Menu-only item icon shared by every ENGINE component (ids 5/6/7/15/16/23/26). Hangar build only,
  // same reasoning as engine_thruster (and the same source-vs-family name swap). This source IS worth
  // shrinking: 2.3 MB of its 2.5 MB is textures
  // (a 1024² baseColor + a 1024² normal + two 512²), against ~209 KB of geometry. 256px + WebP cuts it to
  // KB-scale. The model is SKINNED and carries one animation clip ("Flame startAction") that the item
  // viewer plays on loop (client/src/model-viewer.js), so the build must preserve JOINTS_0/WEIGHTS_0 and
  // the clip — verified with `gltf-transform inspect` on the built glb.
  maneuver_thruster: {
    hangar: { textureSize: 256, textureCompress: 'webp' },
  },
  // Space Factory set-piece (a wide, flat ring station). The source is 6.7 MB of which 4.6 MB is TEXTURES:
  // eight 1024² PNGs (baseColor / metallicRoughness / emissive / normal x 2 materials) costing ~45 MB of
  // VRAM. Geometry is trivial by comparison (23 k verts, 33 primitives, ~2 MB). So the whole win is in the
  // texture pass: 256px + WebP cuts the download to KB-scale and VRAM to ~2.8 MB. 256 (not 128, which the
  // metal box uses) because this thing is BIG on screen — normalized to 100 u across it fills half the
  // frame at zoom 1, where 128px panels read as mush. `pruneSolidTextures: false` protects the emissive
  // maps: they are mostly black with small lit windows, exactly the low-contrast shape optimize's
  // solid-texture heuristic likes to flatten — and flattening emissive would make the whole hull glow.
  space_factory: {
    combat: { textureSize: 256, textureCompress: 'webp', pruneSolidTextures: false },
    hangar: { textureSize: 256, textureCompress: 'webp', pruneSolidTextures: false }, // never shown in a menu; keep it small on S3 too
  },
  // The system's central star (Vega). TWO concentric spheres in one .glb: an orange emissive core inside a
  // slightly larger YELLOW shell whose material is transmissive (KHR_materials_transmission) — the shell is
  // what you see, the core is hidden at runtime (world.js `starDraft.yellowOnly`; see SUMMARY). The build
  // must therefore PRESERVE the transmission extension: the yellow comes from it, not from a texture, so a
  // build that drops it silently returns an orange sun. Verified on the built glb, not assumed.
  //
  // Sizing: this is the biggest object in the game — normalized to 192 u across it fills roughly half the
  // frame when you park on its anchor — so textures stay at 512 (not the 256 the space factory uses):
  // solar granulation is fine noise spread over a full sphere, and 256 turns it to mush at that size.
  // Geometry is two spheres and already trivial, so `simplifyRatio: 1.0` — decimating a sphere this large
  // on screen only buys faceting on the silhouette.
  // `pruneSolidTextures: false` protects the emissive map, which is the whole look.
  // NOT dropping the hidden core mesh from the asset, though it is never drawn: its texture is the SAME
  // image the shell uses as its emissive map (556 KB JPEG, shared), so removing the mesh would free only a
  // sphere's worth of geometry — not worth a build pre-pass.
  sun: {
    combat: { simplifyRatio: 1.0, textureSize: 512, textureCompress: 'webp', pruneSolidTextures: false },
    hangar: { textureSize: 512, textureCompress: 'webp', pruneSolidTextures: false }, // never shown in a menu; keep S3 small too
  },
  // Asteroid pack (3 rock meshes in one .glb) used BOTH up-close (the mission asteroid-field rocks/hosts)
  // and far away as the parallax backdrop field (hundreds of INSTANCES). Source is a 4.5 MB textured pack;
  // shrink textures hard (256px → WebP) and simplify geometry to ~half so a big instanced field stays cheap.
  // `instance: false` keeps the 3 meshes as separate nodes so the client can pick a random variant per rock.
  // See docs/plans/asteroid-model-pipeline notes in DECISIONS.
  asteroids: {
    // The source rocks are already low-poly (~700–870 tris); simplifying further shreds their rounded
    // silhouette into angular shards, so KEEP the geometry (ratio 1.0) and only shrink textures (256 WebP)
    // + meshopt-compress. `instance: false` keeps the 3 meshes as separate nodes for random-variant picks.
    // `pruneSolidTextures: false` — the low-contrast rock diffuse maps trip optimize's solid-texture pruner,
    // which would flatten them to a dark baseColorFactor and drop ALL surface detail (see assets-build.mjs).
    // `compress: false` (no meshopt/quantization) — meshopt's KHR_mesh_quantization SHREDS these meshes'
    // geometry+normals into a shattered spiky mess (the raw model coords quantize badly); ships survive it,
    // these don't. Geometry stays raw float32 → a ~190 KB glb (fine for a set-piece). See DECISIONS §71.
    combat: { simplifyRatio: 1.0, textureSize: 256, textureCompress: 'webp', instance: false, pruneSolidTextures: false, compress: false },
  },
};
// Merge the base preset for `kind` with any override for this source base name.
export const presetFor = (base, kind) => ({ ...PRESET[kind], ...(PRESET_OVERRIDES[base]?.[kind]) });

// A run-on-S3 URL for a combat/hangar object. Combat is served same-origin (relative path); hangar via CDN.
export const combatPath = (file) => `assets/ships/${file}`;
export const hangarUrl = (file) => `${CDN}/${PREFIX.hangar}${file}`;
// SFX are tiny and latency-sensitive → served same-origin (relative path), like combat models.
export const soundPath = (file) => `assets/sounds/${file}`;
// Input-replay traces (the intro cutscene) → served same-origin (relative path), pulled like combat/SFX.
export const recordingPath = (file) => `assets/recordings/${file}`;
