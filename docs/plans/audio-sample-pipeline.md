# Audio sample pipeline — sourced SFX alongside the procedural engine

**Status:** ✅ implemented (2026-06-23). **D1 resolved → (a): S3 + pull, gitignored** (one unified asset
pipeline, no binaries in git); CI/CD extended to pull SFX. First sound (CC0 glock → kinetic guns) shipped.
Current state lives in `docs/SUMMARY.md` (Audio + Asset pipeline); this file is the build brief / recipe.

**Owner decision recap (from the kick-off chat):**
- **Scope now:** write this plan; change no code.
- **Extraction:** *not* a rigid auto-splitter. The real input is **"a source file + a short comment
  from the user"** (e.g. "take the 2nd shot, use it for the basic kinetic and the machine gun"). The
  agent inspects the file and extracts the requested part. So the deliverable is a **documented
  agent workflow + a toolkit of ffmpeg recipes**, not a one-button script.
- **Output format:** **MP3** (smallest, universal, `decodeAudioData` everywhere; fine for short SFX).

## Goal

Stand up a **repeatable process** for turning a downloaded sound file (e.g. a CC0 Freesound clip with
several gunshots) into a **game-ready SFX** that plays in-engine — without abandoning the procedural
audio (DECISIONS §22). First concrete use: turn
`assets-src/sounds/855652__serutonin-deprivd__a-glock-handgun-being-shot-3x-…-w-airy-forest-reverb.wav`
into the **`Basic kinetic` (id 1)** and **`Machine Gun` (ids 5 / 7)** fire sounds.

## Background — how audio works today (read before touching anything)

- **Fully procedural.** `client/src/audio.js` synthesizes every SFX (`audio.sfx.shoot`, `enemyShoot`,
  `hit`, `rocket`, `explosion`, `uiClick`, `jingle`) and generates the music. **No audio files, nothing
  on the CDN** (DECISIONS §22). All sound flows through named buses: `master → {sfxGain, musicGain}`,
  with a `DynamicsCompressor` on master and a **polyphony cap** (`sfxPlayable()` skips new SFX past ~28
  live voices — this is what stops machine-gun fire from clipping).
- **Swap path is already designed.** DECISIONS §22 "Swap path (kept open)": every call site goes through
  `audio.sfx.*`; replacing a synth sound with a real one is "**add a `BufferSource` on `sfxGain`**" with
  no call-site changes. This plan executes exactly that path for SFX.
- **Fire call site:** `client/index.html` → `fireMount(ship, mount, fwd, isPlayer)` (around line 1682).
  The bullet branch calls `audio.sfx.shoot()` for the player and `audio.sfx.enemyShoot(dist)` for
  enemies. The runtime weapon is `const w = mount.weapon;` (line 1686).
- **Weapon data is flat + DB-driven.** `CATALOG.weapons` is `id -> { id, name, type, ...stats }`
  (`client/index.html:1487`), built by `resolveWeapon`. So **any key added under a weapon's `stats` in
  `server/src/catalog_seed.js` shows up directly on `w`** at the fire site. Weapons of interest
  (`server/src/catalog_seed.js`, `WEAPONS`): `id 1 Basic kinetic`, `id 5 Machine Gun`,
  `id 7 Heavy Machine Gun`, `id 9 Pirate machine gun`, `id 10` (boss). This is how we route SFX
  per-weapon **without hardcoding ids in the client**.
- **Asset-pipeline precedent (mirror it).** Ship models already have a clean pipeline we should copy in
  spirit: sources in `assets-src/` (gitignored) → `scripts/assets-build.mjs` (normalize + 8-char
  content-hash) → `assets-dist/` → `scripts/assets-push.mjs` to S3 → served **same-origin** from
  `client/assets/ships/` (pulled in CI, **no binaries in git**). Config in `scripts/assets-config.mjs`
  (`BUCKET`, `PREFIX`, `DIR`, hash via `createHash('sha256').…slice(0,8)`).

### Pre-existing doc drift to fix as part of this work
`client/src/audio.js:6` and `client/index.html:577` both say **"see DECISIONS §21"** for the audio swap
path, but the audio decision is **§22** (§21 is color/lighting tuning). Correct both references when we
touch these files.

---

## The process (repeatable workflow for "file + comment")

This is the loop to follow every time the user drops a sound and a comment. Steps 1–6 are the agent's
job; step 7 is the human ear check.

### 1. Land the source
Source files live in **`assets-src/sounds/`** (already exists, gitignored like the rest of `assets-src/`
— verify the `.gitignore` rule covers `sounds/`; the GLB sources are already ignored there).
Keep the original Freesound filename (it encodes the id + author + license intent).

### 2. Inspect — understand what's in the file
```bash
ffprobe -v error -show_entries format=duration,bit_rate \
  -show_entries stream=sample_rate,channels -of default=noprint_wrappers=1 IN.wav

# Find the discrete hits (gaps between shots). Tune noise floor / min-gap to the clip.
ffmpeg -i IN.wav -af silencedetect=noise=-30dB:d=0.20 -f null - 2>&1 | grep silence_
```
`silencedetect` prints `silence_end` (= a shot starts there) / `silence_start` (= it just ended). Use
these as candidate cut points. **This is guidance, not gospel** — the user's comment ("the 2nd shot",
"the punchiest one") decides which segment to take. When in doubt, export each candidate and listen.

### 3. Extract the requested segment
```bash
# START/END in seconds, from step 2 + the user's comment.
ffmpeg -y -accurate_seek -ss <START> -to <END> -i IN.wav -map 0:a cut.wav
```

### 4. Clean it for a *game* SFX (the part that makes it not suck)
A "punchy w/ airy forest reverb" gunshot has a **long reverb tail**. That tail is fine for a single
shot but **turns to mush under rapid fire** (machine gun). So:
- **Trim the tail** to the dry transient + a touch of body, and **fade out** so there's no click.
- **Mono** (SFX are positional-by-gain here, not stereo-panned) + **high-pass** to kill subsonic rumble.
- **Normalize for a consistent library loudness**, then a **limiter** so peaks are safe in the mix.

```bash
# "dry" transient — good default for BOTH kinetic and machine gun. Tune the 0.22s length by ear.
ffmpeg -y -i cut.wav -ac 1 -af \
  "highpass=f=60,atrim=0:0.22,afade=t=out:st=0.18:d=0.04,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95" \
  dry.wav
```
If the machine gun smears, make **two variants** from the same source: a short `…_mg.mp3` (~0.15 s, hard
fade) and a slightly longer `…_kinetic.mp3` (~0.35 s, keep a little tail). Otherwise **one clip is
enough** — the machine gun reuses it with per-shot pitch variation (see engine, below).

> Note: ffmpeg can't truly *de-reverb*. If a clip's tail is unusable, the fix is to **cut earlier**, not
> to filter — or pick a drier source next time.

### 5. Encode MP3 + content-hash (mirror the GLB hashing)
```bash
ffmpeg -y -i dry.wav -codec:a libmp3lame -q:a 4 out.mp3          # ~128–165kbps VBR, plenty for SFX
HASH=$(shasum -a 256 out.mp3 | cut -c1-8)
mv out.mp3 assets-dist/sounds/kinetic.$HASH.mp3                  # <logical-name>.<hash>.mp3
```
Logical names (stable; the hash is the version): start with **`kinetic`** (and **`machinegun`** only if
we split). Hash filename ⇒ cache-forever, new sound = new URL, no invalidation — same rule as models.

### 6. Distribute + register (see "Distribution" for the chosen mechanism)
- Place the hashed MP3 where the client serves it: **`client/assets/sounds/`** (same-origin, like
  combat glbs).
- **Register the URL** in the client manifest (below) so the engine preloads it.
- **Record the license** in `client/assets/CREDITS.md` (the Audio section currently says "no
  third-party audio assets" — that becomes false; add a table row).

### 7. Verify by ear + headless render
- In-game: open the game, fire the basic kinetic and the machine gun, listen for smear/clicks.
- Headless check that nothing throws on load (per memory `visual-verify-headless`): Playwright-render
  `client/index.html`, confirm the manifest fetch + `decodeAudioData` succeed (no console errors) and
  the Settings → SFX preview still works.

---

## Engine changes — add a sample layer to `client/src/audio.js`

Keep the synth functions as the **fallback**; add a thin buffer layer on the **same `sfxGain` bus** so
the mix safety (compressor + polyphony cap) still applies.

1. **Buffer cache + preloader.** New internal `const buffers = new Map();` and:
   ```js
   async function preloadSamples(map) {            // map: { logicalName: url }
     ensure(); if (!ctx) return;
     await Promise.all(Object.entries(map).map(async ([name, url]) => {
       try {
         const data = await (await fetch(url)).arrayBuffer();
         buffers.set(name, await ctx.decodeAudioData(data));
       } catch { /* leave unset → caller falls back to synth */ }
     }));
   }
   ```
   Expose `preloadSamples` on the returned object; call it from `index.html` after `audio.unlock()`
   (the context exists only after the first gesture). Failure is non-fatal: a missing buffer ⇒ synth.

2. **Generic one-shot player** (counts a voice like `voice()`, respects `sfxPlayable()`):
   ```js
   function playSample(name, { rate = 1, gain = 1 } = {}) {
     if (!sfxPlayable()) return false;
     const buf = buffers.get(name); if (!buf) return false;   // → caller uses synth fallback
     const t = ctx.currentTime;
     const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
     const g = ctx.createGain(); g.gain.value = gain;
     src.connect(g); g.connect(sfxGain); src.start(t);
     activeVoices++; src.onended = () => { activeVoices = Math.max(0, activeVoices - 1); };
     return true;
   }
   ```

3. **Make `shoot` weapon-aware** (back-compatible — no arg ⇒ today's behavior). Accept an optional SFX
   key + options; try the sample, fall back to the existing synth zap:
   ```js
   shoot(kind, opts) {
     if (kind && playSample(kind, opts)) return;   // sampled path
     /* …existing synthesized descending zap… */    // fallback
   }
   ```
   - **Machine gun feel:** call with slight per-shot pitch variation so rapid fire doesn't sound like a
     looped sample, e.g. `audio.sfx.shoot('kinetic', { rate: 0.94 + idx * 0.04, gain: 0.9 })`. Vary by
     mount index / a small rotating counter (note: `Math.random()` is fine in the client; it is only
     banned inside Workflow scripts). The ~28-voice cap already throttles runaway fire.

## Weapon routing — data-driven via `stats.sfx`

In **`server/src/catalog_seed.js`**, add an `sfx` key under the relevant weapons' `stats`:
```js
{ id: 1, name: 'Basic kinetic', type: 'bullet', /*…*/ stats: { /*…*/ sfx: 'kinetic' } },
{ id: 5, name: 'Machine Gun',   type: 'bullet', /*…*/ stats: { /*…*/ sfx: 'kinetic' } },
{ id: 7, name: 'Heavy Machine Gun', /*…*/        stats: { /*…*/ sfx: 'kinetic' } },
```
Then in **`client/index.html` `fireMount`** (line ~1695), pass it through:
```js
if (isPlayer) audio.sfx.shoot(w.sfx);            // w.sfx is undefined for un-mapped weapons → synth
else audio.sfx.enemyShoot(/* dist */);           // (enemy sampling: later, same pattern)
```
`w.sfx` rides along because the runtime weapon flattens `stats` (`client/index.html:1487`). Un-mapped
weapons (and all enemies, for now) keep the procedural sound — incremental, low-risk.

## Distribution — recommended default + the open decision

**Recommended (mirror the GLB pipeline; keeps "no binaries in git"):** extend
`scripts/assets-config.mjs` with a sounds lane and reuse the push/pull machinery:
- `PREFIX.sounds = 'sfx/'`, `DIR.soundsServe = 'client/assets/sounds'`.
- `assets:push` also uploads `assets-dist/sounds/*.mp3 → s3://<bucket>/sfx/` (and the source WAV →
  `source/` as the off-machine backup), with the same immutable cache headers but
  `--content-type audio/mpeg`.
- `assets:pull` also fetches `sfx/ → client/assets/sounds/` (CI does this at deploy). `client/assets/
  sounds/*.mp3` stays **gitignored**.
- The client references sounds by their hashed same-origin path (`assets/sounds/kinetic.<hash>.mp3`),
  exactly like `combatPath()` does for models.

**Manifest (how the client learns the hashed URLs).** Models put the hashed URL in `catalog_seed.js`
(`modelUrl`); SFX have no DB row, so add a tiny client manifest — e.g. **`client/src/sfx_manifest.js`**:
```js
export const SFX_SOURCES = { kinetic: 'assets/sounds/kinetic.<hash>.mp3' };
```
`index.html` imports it and calls `audio.preloadSamples(SFX_SOURCES)` after unlock. Updating a sound =
rebuild → new hash → edit this one line (the manifest is the "paste the URL" step, analogous to
pasting `modelUrl` into the seed). This manifest file **is** committed (it's text, not a binary).

**Open decision (pick before implementing):**
> **D1 — Where do the tiny MP3s live?** (a) **S3 + pull, gitignored** (recommended — one unified asset
> pipeline, honors the no-binaries-in-git ethos, DECISIONS §14/§17), or (b) **commit the MP3s
> directly** (a handful of files at a few KB each; simpler, no S3/pull step, but breaks the
> no-binaries rule). Recommend (a) for consistency; (b) is defensible given how small SFX are. This is
> the only real fork left — everything else above is settled.

*(Optional, later: a thin `scripts/audio-build.mjs` could wrap the deterministic tail of the process —
clean → encode → hash → emit to `assets-dist/sounds/`. Extraction stays manual/agent-driven by design,
so the script would take an already-cut `cut.wav` + target length. Not required for the first sound.)*

---

## First task — concrete commands for the glock file

```bash
IN="assets-src/sounds/855652__serutonin-deprivd__a-glock-handgun-being-shot-3x-punchy-hollywood-esque-sounding-shots-w-airy-forest-reverb.wav"
mkdir -p assets-dist/sounds
# 1. find the 3 shots
ffmpeg -i "$IN" -af silencedetect=noise=-30dB:d=0.20 -f null - 2>&1 | grep silence_
# 2. cut the chosen shot (fill START/END from step 1 + the user's pick), clean, encode
ffmpeg -y -accurate_seek -ss <START> -to <END> -i "$IN" -ac 1 -af \
  "highpass=f=60,atrim=0:0.22,afade=t=out:st=0.18:d=0.04,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95" \
  -codec:a libmp3lame -q:a 4 assets-dist/sounds/kinetic.mp3
# 3. content-hash → final name
HASH=$(shasum -a 256 assets-dist/sounds/kinetic.mp3 | cut -c1-8)
mv assets-dist/sounds/kinetic.mp3 "assets-dist/sounds/kinetic.$HASH.mp3"
echo "manifest URL: assets/sounds/kinetic.$HASH.mp3"
```
Then: wire `SFX_SOURCES`, add `stats.sfx: 'kinetic'` to weapons 1/5/7, pass `w.sfx` in `fireMount`,
distribute per D1, update docs, verify by ear. If the machine gun smears under sustained fire, split
into `kinetic` (~0.35 s) + `machinegun` (~0.15 s) and set weapons 5/7 to `sfx: 'machinegun'`.

## Docs to update when this is implemented (not now)

- **`client/assets/CREDITS.md`** — Audio section: replace "no third-party audio assets" with a table row
  for the glock clip: `serutonin-deprivd`, the Freesound URL, **CC0 1.0**, date. (Required before use.)
- **`client/assets/README.md`** — add an "Audio (`.mp3`)" section mirroring the ship-model section: where
  sources go, the ffmpeg recipe, the manifest, the same-origin path.
- **`docs/SUMMARY.md`** — Audio section (line ~333): note it's now **procedural + sampled SFX**; describe
  `preloadSamples`/`playSample`, the `stats.sfx` routing, and the manifest. Bump `**Updated:**`.
- **`docs/CHANGELOG.md`** — bullet under today's date: sampled-SFX pipeline + first sound (kinetic /
  machine gun), plus any `assets-config`/push/pull/.gitignore changes.
- **`docs/DECISIONS.md`** — amend **§22** (or add a sub-entry): hybrid is now partly realized — sampled
  SFX layer on `sfxGain`, data-driven per-weapon routing, S3-backed same-origin delivery (per D1). Fix
  the stale "§21" refs in `client/src/audio.js:6` and `client/index.html:577` while here.

## Open questions — resolved inline (so the executor doesn't re-ask)

- **Procedural vs sampled?** Keep procedural as the fallback; add a sample layer on `sfxGain`. ✅
- **Extraction method?** Manual/agent-driven from "file + comment"; ffmpeg recipes above, no rigid
  splitter. ✅
- **Format?** MP3 (`libmp3lame -q:a 4`). ✅
- **One clip or two for kinetic vs machine gun?** Start with one (`kinetic`) + per-shot pitch variation;
  split only if the machine gun smears. ✅
- **Per-weapon routing without client hardcoding?** `stats.sfx` in the seed → flows to `w.sfx`. ✅
- **D1 (binaries in git vs S3+pull)** — resolved → **S3 + pull, gitignored**; CI/CD pulls SFX at deploy. ✅
