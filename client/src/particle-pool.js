// Instanced particle pools — one draw call per particle KIND, not per particle.
//
// WHY. Every FX primitive in the game used to be its own `THREE.Mesh` with its own `MeshBasicMaterial`,
// which means one draw call each. That is the rendering equivalent of an N+1 query: a draw call carries a
// fixed cost almost independent of how much it draws (measured at ~0.25 ms on a weak phone), so hundreds of
// tiny puffs cost hundreds of times the setup and nothing else. A single rocket trail added **25-30 draw
// calls** — reported from the field, and the biggest per-event cost we found.
//
// A pool draws every live particle of one kind in ONE call: the GPU is handed the shape once plus a table
// of per-instance transforms. Cost stops scaling with particle count.
//
// The pattern was set by the first FX primitive and then copied by every later one, so this module exists
// to break that: **new high-volume FX goes through a pool, it does not create meshes per particle**
// (DECISIONS §82). One-off effects that are only ever a handful on screen (the warp flash, a death
// shockwave ring) are fine as plain meshes — instancing them would add machinery for no measurable gain.
//
// PER-INSTANCE ALPHA is the whole trick. Instances share one material, so `material.opacity` is one value
// for all of them — fade it and the entire trail blinks out together instead of the tail dissolving while
// the head is still dense. So alpha travels as an instanced vertex attribute (`aAlpha`) that a tiny shader
// patch multiplies into the fragment's alpha. Colour, when a kind needs it, can ride three.js's built-in
// `instanceColor`.
import * as THREE from 'three';
import { scene } from './engine.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

// `geometry` must be OWNED by this pool — an instanced attribute is stored on the geometry, so a geometry
// shared with non-instanced meshes would leak it. `max` is a hard ceiling: the caller must not push more
// (the gameplay-side `G.gfx.maxParticles` check already bounds it), and pushes beyond it are dropped.
export function makeParticlePool({ geometry, color, opacity = 1, blending = THREE.NormalBlending, max }) {
  const material = new THREE.MeshBasicMaterial({
    color, opacity, blending, transparent: true, depthWrite: false, fog: false,
  });
  // Multiply the shared opacity by each instance's own alpha. Patching MeshBasicMaterial (rather than
  // hand-writing a ShaderMaterial) keeps three.js's lighting/tone-mapping/colour-space handling intact.
  let patched = false; // set once the shader patch actually applied — read via `alphaPatched`
  material.onBeforeCompile = (shader) => {
    const vAnchor = '#include <begin_vertex>';
    const fAnchor = 'vec4 diffuseColor = vec4( diffuse, opacity );';
    // Fail LOUDLY if a three.js upgrade renames these chunks. A silent miss is the nasty case: the alpha
    // attribute would still be written (so a test reading it back still passes) while the shader ignored
    // it — every particle drawn at the material's flat opacity, the exact bug this attribute exists to
    // prevent. `patched` is asserted by the pool's caller-visible flag below.
    if (!shader.vertexShader.includes(vAnchor) || !shader.fragmentShader.includes(fAnchor)) {
      console.error('particle-pool: per-instance alpha NOT applied — three.js shader chunks moved', { vAnchor, fAnchor });
      return;
    }
    shader.vertexShader = 'attribute float aAlpha;\nvarying float vAlpha;\n'
      + shader.vertexShader.replace(vAnchor, vAnchor + '\n\tvAlpha = aAlpha;');
    shader.fragmentShader = 'varying float vAlpha;\n'
      + shader.fragmentShader.replace(fAnchor, 'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );');
    patched = true;
  };

  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  geometry.setAttribute('aAlpha', alpha);

  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.count = 0;                 // nothing live yet
  mesh.frustumCulled = false;     // the bounds cover instance 0 only; particles are scattered across the arena
  mesh.renderOrder = 2;
  scene.add(mesh);

  let n = 0; // write cursor for the frame being built

  return {
    mesh,
    // Rebuild the frame's instance table from scratch: the callers keep their particles in plain arrays
    // that get spliced as they die, so stable slots would need bookkeeping for no benefit.
    begin() { n = 0; },
    // pos: Vector3 (world), size: uniform scale, a: 0..1 alpha for THIS particle.
    push(pos, size, a) {
      if (n >= max) return false;
      _m.compose(pos, _q, _s.setScalar(size));
      mesh.setMatrixAt(n, _m);
      alpha.array[n] = a;
      n++;
      return true;
    },
    end() {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    // Drop everything (run reset): the pooled mesh + material are KEPT, only the live count goes to zero.
    clear() { n = 0; mesh.count = 0; },
    get count() { return n; },
    get capacity() { return max; },
    // True once the material compiled WITH the per-instance alpha patch. Still false after a frame has
    // rendered means the fade is silently broken — asserted by visual/scenarios/27-smoke-instancing.
    get alphaPatched() { return patched; },
  };
}
