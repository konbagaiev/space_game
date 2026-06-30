// Audio engine singleton + DB-driven SFX routing. The engine (synth SFX + sampled layer + generative
// music) is created once here; tracksFor/sfxFor resolve an (entity, class, event) tuple to sound keys
// via the soundMap registry (filled in bootstrap from /api/sounds). Music *state* selection
// (musicForState/refreshMusic) stays with the game loop in index.html — it reads live loop state.
import { createAudio, loadAudioSettings } from './audio.js';
import { soundMap } from './state.js';

// Audio engine: synthesized SFX + generative music (procedural), plus an optional sampled SFX layer
// (preloadSamples). The AudioContext is created lazily on the first user gesture (autoplay) via
// audio.unlock(); samples are fetched once the context is live. See DECISIONS §22.
export const audio = createAudio(loadAudioSettings(window.localStorage));

// All sound keys mapped to an event (weapon fire, ship explode, scene music, …).
export function tracksFor(entity, cls, event) { return (cls && soundMap.get(`${entity}|${cls}|${event}`)) || []; }
// One sound key for an event (the first mapped), or undefined → the engine uses its synth fallback.
export function sfxFor(entity, cls, event) { return tracksFor(entity, cls, event)[0]; }
