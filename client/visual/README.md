# Visual / end-to-end tests (headless browser)

A set of **headless-browser** checks that boot the real game (`index.html`) in Chromium and
verify behaviour that the pure unit tests (`client/src/*.test.js`) can't reach: rendering,
effects, and the simulation wired together.

**These are NOT run in CI.** They're slower, need a browser binary, and software WebGL differs
subtly between machines. We keep them as a stable, growing suite to run by hand — handy before a
larger/rarer release. CI keeps running only the fast unit tests.

## What they assert

Each scenario asserts on **simulation state** read out of the page (particle counts, sizes,
colors via a `window.__game` hook), NOT on pixels. We deliberately don't diff screenshots — a
pixel baseline would be flaky under software rendering. Screenshots ARE saved, but as **artifacts
for a human to eyeball**, not as pass/fail.

The hook lives in `index.html` and is **inert during normal play** — it only attaches
`window.__game` when the page is opened with `?debug`.

## Run

From `client/`:

```bash
npm install                       # once: installs playwright (dev dependency)
npx playwright install chromium   # once: downloads the browser binary
npm run test:visual
node visual/run.mjs 22-trace-replay   # optional argv filter: run just the scenario(s) whose filename matches
```

Some scenarios need the gitignored S3 assets — run `npm run assets:pull` from the repo root first.
`22-trace-replay` (the determinism guard on the canonical Level-0 trace: re-sims it and asserts 4 kills +
a win) hard-fails with that instruction if the recording is missing.

The runner (`visual/run.mjs`) is self-contained: it starts its own game server on an isolated
port with a throwaway Postgres DB `spacegame_test` (your real `spacegame` DB is untouched), runs every scenario in
`visual/scenarios/`, prints a pass/fail summary, and exits non-zero on failure. Frames are written
to `visual/__screenshots__/` (gitignored) — open them to review the look.

## Add a scenario

Drop a file in `visual/scenarios/` (they're auto-discovered, alphabetical — the numeric prefix
just orders them):

```js
export const name = '05-my-check';
export default async function ({ page, assert, shot }) {
  // drive the game: page.keyboard / page.mouse, or page.evaluate(() => window.__game ...)
  const value = await page.evaluate(() => window.__game.enemies.length);
  assert.equal(value, 4, 'why this should hold');
  await shot('label'); // saves __screenshots__/05-my-check__label.png
}
```

The page is freshly reloaded (clean state) before each scenario. The runner already fails a
scenario if the page logs any JS error during it, so you don't need to check for that yourself.

A scenario may also navigate on its own (it receives `baseURL`) when it needs different URL flags than the
runner's `?debug` — see `21-language-initial-ru.mjs` (reload) and `22-trace-replay.mjs` (its own
`?playback&…&finish=1&debug` url). Clean up any `localStorage` you write, so the next scenario starts neutral.

Before handing a scenario the page, the runner **waits for the arena to hold an enemy** and then calls
`__game.silenceIntro()`. Level 0 — the level the throwaway player boots into for every scenario — holds its
first spawn until 3 s of SIM have passed (the intro's opening line), and runs a scripted director over the
fight; the gate gives every scenario the live arena it has always been handed, without the intro's chrome in
its screenshots or its rect measurements. Only `44-playable-intro.mjs` re-arms the director, with its own
`page.goto`. Expect ~5 s of extra wall clock per scenario because of the wait — the sim runs behind wall
clock on software GL.

Keep assertions **state-based and tolerant** (counts, ranges, colors) so they stay stable; use the
screenshots for the subjective "does it look right" part.
