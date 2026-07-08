---
name: record-backdrop-clip
description: Record a short gameplay clip in-game and install it as the committed backdrop "ghost battle" track — start the local server, guide the maintainer to record via the ?dev "Backdrop" panel, then trim/re-center/validate/install the downloaded clip and run the guard tests. Use whenever the maintainer wants to record a new backdrop battle clip, re-record the distant ghost battle, "record a level/background element", or replace the looping backdrop with a fresh recorded fight. Produces the canonical client/src/backdrop-battle.js. Builds on the run-local skill + docs/plans/2026-07-07-1606-backdrop-ghost-battle.md (DECISIONS §59).
---

# Record a backdrop clip

Capture a short live-played fight and turn it into the committed backdrop "ghost battle" track — the
distant recorded skirmish that plays at a fixed world point (default `(−100,−450)`) in every mission
**except** the freighter escort. This automates the manual record→trim→re-center→validate→install dance.

**What this records:** a real gameplay clip (player + enemies via births/deaths + bullets), NOT a whole
level playthrough. Playback reuses the existing ghost-battle runtime (`client/src/ghost-battle.js`); the
deliverable is the committed track file. (Placing *multiple* distinct backdrop elements is a runtime
extension not built yet — today there is ONE canonical track.)

## The one fact this skill exists to keep straight

The in-game `?dev` "Backdrop" recorder already **re-centers (single fixed offset = the player's mean path,
so the player flies freely) and quantizes**, then downloads `backdrop-battle.js`. Two things still need
doing by hand, and this skill does them: **trim the low-action tail** (a clip that winds down plays as a
2–4 s "lag" before the loop restarts) and **re-validate** against the runtime guards. Never hand-edit the
track — always regenerate through the recorder + `process-recording.mjs`.

## Steps

### 1. Get the local server running (the clip records from live play)
Reuse the **`run-local`** skill (pull the gitignored S3 assets, then start `server/src/server.js` on
`http://localhost:4000`). **Note (learned):** a server started as a Claude background process tends to get
reaped — if it keeps dying, ask the maintainer to run it in **their own terminal**:
`cd <checkout>/server && PORT=4000 node --disable-warning=ExperimentalWarning src/server.js`.
The maintainer needs the shop unlocked to reach side missions, but a backdrop clip can be recorded in ANY
dense fight (campaign works) — the clip is replayed at the anchor regardless of where it was recorded.

### 2. Guide the maintainer to record
Tell them, precisely:
- Open **`http://localhost:4000/?dev`** and hard-refresh (**Cmd+Shift+R**) so the new client loads.
- Start any mission with a **dense fight**. In the `?dev` **"Backdrop"** panel (right side, lil-gui) →
  **Record → Start**. The readout shows `REC 12s/60s`.
- Fight **~30–60 s**, staying engaged so enemies are present the whole time (later waves auto-join via
  births). **Keep the action going right up to Stop** — a lull at the end becomes a dead tail (the helper
  trims it, but a lively end loops best).
- **Do NOT warp / return-to-base mid-record** — that steps the slot-0 anchor and jerks the whole clip.
- **Stop** (or it auto-stops at 60 s). It downloads `backdrop-battle.js` to `~/Downloads`.

### 3. Process + install the clip
```
node client/bench/process-recording.mjs
```
Auto-finds the newest `~/Downloads/backdrop-battle*.js`, **trims the dead tail**, **re-centers** (trimming
shifts the player's mean; the runtime guard wants slot 0's mean ≈ 0), **validates** against the guards, and
installs to `client/src/backdrop-battle.js`. Flags: `[inputFile]` explicit path · `--out <path>` different
target · `--keep-tail` install as-is (no trim) · `--name <name>`. It **fails loudly** if the clip isn't a
fly-free recording (e.g. an old slot-0-pinned/centroid track → "slot 0 is CONSTANT") or runs away (`≥600 u`).

### 4. Validate
```
cd client && node --test
```
Confirms the shape guard (birth/death invariants, ≤16 slots, array lengths) + the bounded-formation guard
(slot 0 flies with mean ≈ 0, every born-and-alive slot `< 600 u`) over the freshly-installed track. Must be
green before shipping.

### 5. Let the maintainer eyeball it + tune
- Hard-refresh, play a **non-freighter** mission, **fly toward the anchor** (default `(−100,−450)`) — the
  clip fades in through the fog. Check: lively the whole loop (no dead-tail lag), player flies, no jumps.
- Tune live in the `?dev` panel: **Anchor X/Z** (absolute world coords), **Depth / Scale / Opacity**. Values
  persist to `localStorage['ghostTune']` but **do NOT ship** — if the maintainer wants the tuned look for all
  players, bake the final numbers into **`GHOST_TUNE_DEFAULTS`** in `client/src/ghost-battle-track.js`.

### 6. Commit only when asked
Per CLAUDE.md, commit the new `client/src/backdrop-battle.js` (+ any `GHOST_TUNE_DEFAULTS` tweak) only when
the maintainer asks. If the maintainer wants it live, deploy via the normal merge-to-main flow (the track is
client-side; no DB reseed needed for the clip itself).

## Notes
- **No new assets** — ghost ships reuse the already-credited `player_combat` + `enemy_*_combat` glbs.
- Tier-gated at runtime: **High** shows 8 concurrent ghosts + bullets, **Balance** 4 / no bullets,
  **Performance** off; skipped under `?debug` / `?bench`.
- Keep it simple (DECISIONS §30): one recorder, one helper, one canonical track. Don't build a multi-element
  placement system until the maintainer actually needs a second element.
