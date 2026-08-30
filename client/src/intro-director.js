// The scripted intro director — the words over the playable Level 0.
//
// PURE and DOM-FREE on purpose: it is fed one call per SIM TICK and returns what should be on screen, so it
// can be unit-tested without a browser and it can never fall out of step with the simulation the way a
// wall-clock animation would. main.js owns the single instance, calls tick() from the fixed-step loop, and
// writes `view` to the DOM once per frame.
//
// The SCRIPT is data on the level descriptor (`descriptor.intro`, server/src/catalog_seed.js) — the same
// object whose numbers the SPAWN GATE derives its floors from, so the lines and the fight share one
// timeline. See docs/plans/2026-08-30-1654-playable-intro.md.

export const HELP_STATES = ['idle', 'hold', 'fly', 'done'];

export function makeIntroDirector(script) {
  const beats = script.beats || [];
  const { lineHold = 3, lineFade = 2, helpHold = 3.5, helpFly = 0.45 } = script;
  const helpAt = lineHold + lineFade;      // the card takes the slot the moment the opening line has gone

  let fired, pending, line, lastT, help;
  function reset() {
    fired = new Set();      // beat ids already spoken (once per run)
    pending = [];           // [{ beat, dueAt }] — beats with a `delay`
    line = null;            // { key, at } — what is on screen
    help = 'idle';
    lastT = 0;
  }
  reset();

  // One sim tick. `t` is world.combatElapsed; `spawned` is derived by the caller as kills + enemies alive,
  // which is exact (every enemy that ever spawned is either alive or dead) and needs nothing new in the sim.
  // Returns the one-shot commands fired THIS tick, for the DOM layer + tests: 'line:<id>' | 'help:hold' |
  // 'help:fly' | 'help:done'.
  function tick({ t, kills, alive, cleared }) {
    // A run RESTARTED (death → Restart, or a fresh take-off): the sim clock went backwards. Re-arm
    // everything. This is the whole of the restart contract, and it has a test.
    if (t < lastT) reset();
    lastT = t;
    const out = [];
    const spawned = kills + alive;

    for (const b of beats) {
      if (fired.has(b.id) || pending.some((p) => p.beat.id === b.id)) continue;
      const hit = b.on === 'start'   ? true
                : b.on === 'spawn'   ? spawned >= b.n
                : b.on === 'kill'    ? kills   >= b.n
                : b.on === 'cleared' ? !!cleared
                : false;
      if (!hit) continue;
      if (b.delay > 0) pending.push({ beat: b, dueAt: t + b.delay });
      else { speak(b, t, out); }
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (t >= pending[i].dueAt) { const { beat } = pending.splice(i, 1)[0]; speak(beat, t, out); }
    }

    const nextHelp = t < helpAt ? 'idle'
                   : t < helpAt + helpHold ? 'hold'
                   : t < helpAt + helpHold + helpFly ? 'fly' : 'done';
    if (nextHelp !== help) { help = nextHelp; if (help !== 'idle') out.push(`help:${help}`); }
    return out;
  }
  // A new line REPLACES whatever is up, immediately — no queue, no waiting for a fade.
  function speak(beat, t, out) { fired.add(beat.id); line = { key: beat.textKey, at: t }; out.push(`line:${beat.id}`); }

  return {
    reset, tick,
    get fired() { return [...fired]; },
    get help() { return help; },
    // What the DOM should show right now. alpha 1 while held, then a linear fade; 0 → nothing on screen.
    get view() {
      if (!line) return { lineKey: null, lineAlpha: 0, help };
      const age = lastT - line.at;
      const alpha = age <= lineHold ? 1 : Math.max(0, 1 - (age - lineHold) / lineFade);
      return { lineKey: alpha > 0 ? line.key : null, lineAlpha: alpha, help };
    },
  };
}
