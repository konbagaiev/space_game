// Audio for Vega Sentinels — built on the native Web Audio API (no library). SFX are SYNTHESIZED by default
// (oscillators + filtered noise + envelopes), with an optional SAMPLE layer (preloadSamples/playSample): a
// weapon/ship can opt into a real recorded sound, played as a BufferSource on the SAME sfx bus, with the
// synth as the fallback when the sample is missing. Background MUSIC is sampled too — per-scene looping
// tracks on the music bus (setMusicTracks/setScene), picked at random; there is no generative music. All
// routing is DB-driven (sound classes + sound_map; DECISIONS §22). Sample bytes live on S3 (content-hashed,
// pulled same-origin), never in git.
//
// Two layers live here:
//   1) Pure settings helpers (clamp / load / save / effective gain) — Three.js- AND browser-free, unit-tested.
//   2) createAudio() — the engine; lazily builds an AudioContext on the first user gesture (autoplay policy),
//      so importing this module never touches the DOM/AudioContext (safe under node:test).

// ---------- Settings (pure, testable) ----------
export const AUDIO_STORAGE_KEYS = {
  master: 'audioMaster', music: 'audioMusic', sfx: 'audioSfx',
  musicOn: 'audioMusicOn', sfxOn: 'audioSfxOn',
};
export const AUDIO_DEFAULTS = { master: 0.7, music: 0.45, sfx: 0.8, musicOn: true, sfxOn: true };

export function clamp01(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Load persisted settings from a key/value store (localStorage-like: getItem(k) → string|null).
// Missing/garbage values fall back to AUDIO_DEFAULTS, so a fresh player gets sane audio.
export function loadAudioSettings(store) {
  const get = (k) => { try { return store && store.getItem(k); } catch { return null; } };
  const num = (k, d) => { const v = get(k); return v == null || v === '' ? d : clamp01(v); };
  const bool = (k, d) => { const v = get(k); return v == null ? d : v === '1' || v === 'true'; };
  return {
    master: num(AUDIO_STORAGE_KEYS.master, AUDIO_DEFAULTS.master),
    music: num(AUDIO_STORAGE_KEYS.music, AUDIO_DEFAULTS.music),
    sfx: num(AUDIO_STORAGE_KEYS.sfx, AUDIO_DEFAULTS.sfx),
    musicOn: bool(AUDIO_STORAGE_KEYS.musicOn, AUDIO_DEFAULTS.musicOn),
    sfxOn: bool(AUDIO_STORAGE_KEYS.sfxOn, AUDIO_DEFAULTS.sfxOn),
  };
}

// Persist settings to the store (volumes as fixed strings, toggles as '1'/'0'). Returns what it stored.
export function saveAudioSettings(store, s) {
  const set = (k, v) => { try { store && store.setItem(k, v); } catch {} };
  set(AUDIO_STORAGE_KEYS.master, clamp01(s.master).toFixed(3));
  set(AUDIO_STORAGE_KEYS.music, clamp01(s.music).toFixed(3));
  set(AUDIO_STORAGE_KEYS.sfx, clamp01(s.sfx).toFixed(3));
  set(AUDIO_STORAGE_KEYS.musicOn, s.musicOn ? '1' : '0');
  set(AUDIO_STORAGE_KEYS.sfxOn, s.sfxOn ? '1' : '0');
  return s;
}

// Effective linear gain for a channel = master × channel × on-toggle. Pure (mirrors the audio graph; tested).
export function effectiveGain(s, channel) {
  const on = channel === 'music' ? s.musicOn : channel === 'sfx' ? s.sfxOn : true;
  if (!on) return 0;
  const ch = channel === 'music' ? s.music : channel === 'sfx' ? s.sfx : 1;
  return clamp01(s.master) * clamp01(ch);
}

// ---------- Engine (browser-only; lazy) ----------
export function createAudio(initialSettings) {
  let settings = { ...AUDIO_DEFAULTS, ...(initialSettings || {}) };
  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let scene = null;              // 'combat' | 'hangar' | null (which scene's music is playing)
  let musicTracks = {};          // scene → [sound keys] (set via setMusicTracks; a random one is played)
  let curMusic = null;           // the playing track { src, gain, key } (or null)
  let lastMusicKey = null;       // avoid repeating a track back-to-back when a scene has several
  let activeVoices = 0;          // crude polyphony cap so machine-gun fire / swarms can't run away
  let noiseBuf = null;
  const buffers = new Map();     // logical SFX name → decoded AudioBuffer (sample layer; empty ⇒ all-synth)
  let unlockKicked = false;      // Safari needs a node played inside the gesture, not just resume()

  const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);

  function ensure() {
    if (ctx || !AC) return ctx;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();   // tame stacked explosions / clipping
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.connect(comp);
    sfxGain = ctx.createGain(); sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.connect(master);
    applyVolumes(0.01);
    return ctx;
  }

  // Push the user volumes into the graph. master × channel mirrors effectiveGain(); on-toggle ⇒ channel 0.
  function applyVolumes(ramp = 0.05) {
    if (!ctx) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(clamp01(settings.master), now, ramp);
    musicGain.gain.setTargetAtTime(settings.musicOn ? clamp01(settings.music) : 0, now, ramp);
    sfxGain.gain.setTargetAtTime(settings.sfxOn ? clamp01(settings.sfx) : 0, now, ramp);
  }

  // A short looping white-noise buffer (cached) — the source for hits, explosions, rocket whoosh.
  function noise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s;
  }

  // A percussive gain envelope: silence → peak (attack) → silence (release). Returns the node + end time.
  function env(dest, peak, attack, release, startAt) {
    const g = ctx.createGain();
    const t0 = startAt ?? ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release);
    g.connect(dest);
    return { g, end: t0 + attack + release };
  }

  // Count a one-shot voice and free it on stop (keeps activeVoices honest for the polyphony cap).
  function voice(node, end) {
    activeVoices++;
    node.onended = () => { activeVoices = Math.max(0, activeVoices - 1); };
    node.stop(end + 0.02);
  }

  function sfxPlayable() {
    return ctx && ctx.state === 'running' && settings.sfxOn && settings.sfx > 0 && activeVoices < 28;
  }

  // Sample layer. Fetch + decode each URL into the buffer cache. Call AFTER unlock() (needs a live ctx).
  // Failures are swallowed per-sound: a missing buffer just means the caller falls back to its synth voice.
  // `map`: { logicalName: url }. Idempotent — already-loaded names are skipped.
  async function preloadSamples(map) {
    ensure();
    if (!ctx || !map) return;
    await Promise.all(Object.entries(map).map(async ([name, url]) => {
      if (buffers.has(name) || !url) return;
      try {
        const data = await (await fetch(url)).arrayBuffer();
        buffers.set(name, await ctx.decodeAudioData(data));
      } catch { /* leave unset → synth fallback */ }
    }));
    if (scene && !curMusic) startMusic(scene); // a scene was set before its track decoded → start it now
  }

  // Play a preloaded sample on the sfx bus as a one-shot. Returns false if it couldn't (no buffer / capped),
  // so a caller can fall back to a synth voice. `rate` pitches it (machine-gun variation); `gain` scales it.
  function playSample(name, { rate = 1, gain = 1 } = {}) {
    if (!sfxPlayable()) return false;
    const buf = buffers.get(name);
    if (!buf) return false;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(sfxGain); src.start(t);
    activeVoices++; src.onended = () => { activeVoices = Math.max(0, activeVoices - 1); };
    return true;
  }

  const sfx = {
    // Player primary fire. With a `kind` (a weapon's stats.sfx, e.g. 'kinetic') it plays that preloaded
    // sample with a subtle per-shot pitch jitter — so rapid machine-gun fire reusing one clip doesn't sound
    // like a robotic loop. No kind (or the sample isn't loaded) → the synthesized descending zap below.
    shoot(kind, opts) {
      if (kind) {
        const rate = opts && opts.rate != null ? opts.rate : 0.96 + Math.random() * 0.08;
        if (playSample(kind, { rate, gain: (opts && opts.gain) ?? 1 })) return;
      }
      if (!sfxPlayable()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.09);
      const e = env(sfxGain, 0.18, 0.005, 0.09, t);
      o.connect(e.g); o.start(t); voice(o, e.end);
    },
    // Enemy fire: softer, lower, low-passed, and distance-attenuated so a swarm doesn't drown the player.
    enemyShoot(dist = 0) {
      if (!sfxPlayable()) return;
      const atten = dist > 0 ? Math.max(0.12, 1 - dist / 140) : 1;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(360, t);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.1);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
      const e = env(sfxGain, 0.09 * atten, 0.005, 0.1, t);
      o.connect(lp); lp.connect(e.g); o.start(t); voice(o, e.end);
    },
    // A bullet connects: a short metallic tick. With a `kind` (e.g. 'shipHit' when the PLAYER's ship is
    // struck) it plays that preloaded sample with a tiny pitch jitter; no kind / not loaded → the synth tick.
    hit(kind) {
      if (kind && playSample(kind, { rate: 0.97 + Math.random() * 0.06 })) return;
      if (!sfxPlayable()) return;
      const t = ctx.currentTime;
      const n = noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
      const e = env(sfxGain, 0.11, 0.002, 0.05, t);
      n.connect(bp); bp.connect(e.g); n.start(t); voice(n, e.end);
    },
    // Rocket launch. With a `kind` (a rocket weapon's stats.sfx) it plays that preloaded sample (tiny pitch
    // jitter); otherwise — or if the sample isn't loaded — the synthesized rising whoosh + low body below.
    rocket(kind) {
      if (kind && playSample(kind, { rate: 0.98 + Math.random() * 0.04 })) return;
      if (!sfxPlayable()) return;
      const t = ctx.currentTime;
      const n = noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(1600, t + 0.3);
      const e = env(sfxGain, 0.14, 0.02, 0.32, t);
      n.connect(bp); bp.connect(e.g); n.start(t); voice(n, e.end);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.3);
      const e2 = env(sfxGain, 0.12, 0.01, 0.3, t);
      o.connect(e2.g); o.start(t); voice(o, e2.end);
    },
    // A ship dies: a filtered noise boom sized to the ship + a low thump. With a `kind` (e.g. 'shipBoom'
    // for medium/large ships) it plays that preloaded sample — pitched down a touch for bigger ships so one
    // clip covers the range; no kind / not loaded → the synth boom below.
    explosion(size = 1, kind) {
      if (kind && playSample(kind, { rate: size >= 3 ? 0.9 : 1 })) return;
      if (!sfxPlayable()) return;
      size = Math.max(0.5, Math.min(3, size));
      const t = ctx.currentTime;
      const dur = 0.35 + 0.25 * size;
      const n = noise();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1800, t);
      lp.frequency.exponentialRampToValueAtTime(150, t + dur);
      const e = env(sfxGain, 0.28, 0.01, dur, t);
      n.connect(lp); lp.connect(e.g); n.start(t); voice(n, e.end);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + dur * 0.7);
      const e2 = env(sfxGain, 0.3 * size, 0.005, dur * 0.7, t);
      o.connect(e2.g); o.start(t); voice(o, e2.end);
    },
    // UI button feedback.
    uiClick() {
      if (!sfxPlayable()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(660, t);
      const e = env(sfxGain, 0.1, 0.003, 0.06, t);
      o.connect(e.g); o.start(t); voice(o, e.end);
    },
    // Run end: a short ascending major (win) or descending minor (loss) arpeggio. Bypasses the voice cap
    // (only a few notes) but still respects the sfx on-toggle.
    jingle(win = true) {
      if (!ctx || ctx.state !== 'running' || !settings.sfxOn || settings.sfx <= 0) return;
      const t0 = ctx.currentTime;
      const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [440, 415.3, 349.23, 261.63];
      notes.forEach((f, i) => {
        const t = t0 + i * 0.13;
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const e = env(sfxGain, 0.16, 0.01, 0.24, t);
        o.connect(e.g); o.start(t); o.stop(t + 0.32);
      });
    },
  };

  // ---------- Background music: looping sampled tracks per scene (no more generative; DECISIONS §22) ----------
  // The client feeds the scene→tracks lists (from the DB sound_map) via setMusicTracks. A scene with one
  // track loops it seamlessly; with several, a random one plays and a fresh random track chains on end.
  function setMusicTracks(map) { musicTracks = { ...musicTracks, ...(map || {}) }; }

  function pickTrack(sc) {
    const list = (musicTracks[sc] || []).filter((k) => buffers.has(k)); // only what's decoded so far
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const fresh = list.filter((k) => k !== lastMusicKey);              // avoid an immediate repeat
    const pool = fresh.length ? fresh : list;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Start a scene's music (a random track), fading it in. No-op if the buffer isn't decoded yet — the
  // preload-completion hook starts it once it is. Multi-track scenes chain a new random track on `ended`.
  function startMusic(sc, fadeIn = 0.8) {
    if (!ctx) return;
    const key = pickTrack(sc);
    if (!key) return;
    const single = (musicTracks[sc] || []).length <= 1;
    const src = ctx.createBufferSource(); src.buffer = buffers.get(key); src.loop = single;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(1, now + fadeIn);
    src.connect(g); g.connect(musicGain); src.start(now);
    lastMusicKey = key;
    const mine = { src, gain: g, key };
    curMusic = mine;
    if (!single) src.onended = () => { if (curMusic === mine && scene === sc) { curMusic = null; startMusic(sc, 0.05); } };
  }

  // Fade a playing track out and stop it.
  function stopMusic(m, fadeOut = 0.8) {
    if (!m || !ctx) return;
    const now = ctx.currentTime;
    try {
      m.src.onended = null;
      m.gain.gain.cancelScheduledValues(now);
      m.gain.gain.setValueAtTime(Math.max(0.0001, m.gain.gain.value), now);
      m.gain.gain.linearRampToValueAtTime(0.0001, now + fadeOut);
      m.src.stop(now + fadeOut + 0.05);
    } catch {}
  }

  // Switch scenes: crossfade the current track out and a random track of the new scene in. null = silence.
  function setScene(next) {
    if (next === scene) return;
    ensure();
    if (!ctx) { scene = next; return; }
    scene = next;
    const prev = curMusic; curMusic = null;
    stopMusic(prev, 0.8);
    if (next) startMusic(next, 0.8);
  }

  return {
    // Create/resume the AudioContext — call inside a user gesture (autoplay policy). Returns true if running.
    unlock() {
      ensure();
      if (!ctx) return false;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      // Safari (esp. iOS) keeps the context suspended until a node actually plays inside the gesture —
      // a one-sample silent buffer is the standard, inaudible "kick" that wakes it.
      if (!unlockKicked) {
        unlockKicked = true;
        try {
          const s = ctx.createBufferSource();
          s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          s.connect(ctx.destination); s.start(0);
        } catch {}
      }
      return ctx.state === 'running';
    },
    setSettings(next) { settings = { ...settings, ...next }; applyVolumes(); return { ...settings }; },
    getSettings() { return { ...settings }; },
    setScene,
    setMusicTracks,   // scene → [sound keys] for the looping background music (from the DB sound_map)
    sfx,
    preloadSamples,   // load SFX + music samples (call after unlock); missing buffers fall back to synth
    isReady() { return !!ctx && ctx.state === 'running'; },
  };
}
