// Tunables + pure seams for the hit-feel FX (hit-fx.js). Every number here is a PLACEHOLDER: they are
// tuned live in the ?dev "Hit feel" panel and pasted back over this object (Copy JSON). THREE-free so the
// impulse/predicate/tracer invariants are unit-testable under `node --test` (which cannot resolve the
// browser importmap's `three`). Same split pattern as exhaust-config.js <-> exhaust-fx.js.
//
// REPLAY SAFETY: the only randomness is an INJECTED `rand` (Math.random in the browser). This never
// touches the seeded gameplay stream — DECISIONS §73 is opt-in per draw and cosmetics stay out of it.
// See docs/plans/2026-08-30-1505-combat-hit-feel.md.
export const HIT_FX = {
  // Hull flash: an emissive wash on the victim's own (per-instance) materials.
  flash: { color: 0xffffff, intensity: 1.6, dur: 0.12 },
  // Model punch — TWO independent channels, both OFF by default (D5): pick the natural one in flight.
  // `shove` is in GROUP-LOCAL units (the ship group's ~1.8x world scale multiplies it, so bigger ships
  // shove further in world terms — intended). `pop` is a fraction of scale.
  punch: { shove: 0, pop: 0, dur: 0.12, cooldown: 0.15 },
  // Camera shudder — world units of screen-plane translation. ON by default; amplitude is a guess.
  shake: { amp: 1.2, dur: 0.18, cooldown: 0.25 },
  // Tracers. `*Len` multiplies BOLT_LEN (1.0 / 1.7 == today's BOLT_SCALE); `*Bright` multiplies the bolt's
  // additive tint. Jitter is a symmetric per-shot fraction; 0 reproduces the uniform look exactly.
  tracer: { kineticLen: 1.0, kineticBright: 1.0, cannonLen: 1.9, cannonBright: 1.35, jitterLen: 0.25, jitterBright: 0.2 },
};

// THE impulse profile (D6a): INSTANT out, smooth ease back. value(0) = 1 — the displacement is there at
// once, with NO ramp-in — then decays to 0 with a vanishing slope so the model SETTLES instead of wobbling.
// (In practice the first DRAWN frame reads (1 - dt/dur)^2 ~ 0.84 at dur 0.12, because updateHitFx ages
// before it writes. That is the intended "already out" read; it is not a ramp.)
export function impulse01(t) { if (t <= 0) return 1; if (t >= 1) return 0; const u = 1 - t; return u * u; }

export const makeImpulse = () => ({ age: 0, dur: 0, cool: 0, active: false });

// REFRESH, NEVER ACCUMULATE (D6b) + the salvo cooldown (D6c). A hit inside the cooldown is DROPPED; a hit
// after it RESETS the impulse to full — it is never summed with one still in flight, so a burst can never
// compound into a vibration. Returns whether the hit was taken.
export function refreshImpulse(st, dur, cooldown) {
  if (st.cool > 0) return false;
  st.age = 0; st.dur = dur; st.cool = cooldown; st.active = true;
  return true;
}

// Age one impulse by dt and return its current 0..1 value (0 = finished/idle).
export function ageImpulse(st, dt) {
  if (st.cool > 0) st.cool = Math.max(0, st.cool - dt);
  if (!st.active) return 0;
  st.age += dt;
  const v = impulse01(st.dur > 0 ? st.age / st.dur : 1);
  if (v <= 0) { st.active = false; return 0; }
  return v;
}

// One shot's tracer look. `rand` is injected so it is testable and can never reach simRandom.
export function tracerLook(weaponClass, cfg = HIT_FX.tracer, rand = Math.random) {
  const base = weaponClass === 'cannon'
    ? { len: cfg.cannonLen, bright: cfg.cannonBright }
    : { len: cfg.kineticLen, bright: cfg.kineticBright };
  const j = (amt) => 1 + (rand() * 2 - 1) * amt;   // amt 0 -> exactly 1
  return { len: base.len * j(cfg.jitterLen), bright: base.bright * j(cfg.jitterBright) };
}
