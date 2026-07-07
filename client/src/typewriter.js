// Shared ~5s typewriter for the landing briefings (welcome `.intro` + Main Window `#mw-mission-text`).
// Reveals `text` into `el` char-by-char over `total` ms via requestAnimationFrame (elapsed-time based, so
// the duration holds regardless of text length or frame rate). Returns a controller:
//   skip()   — fill the text now and fire onDone (used by tap-to-skip)
//   cancel() — stop WITHOUT firing onDone (used when leaving / settling on re-render)
// onDone fires exactly once, when the type completes or is skipped.
export function typeText(el, text, { total = 5000, onDone } = {}) {
  const n = text.length || 1;
  const t0 = performance.now();
  let raf = 0, finished = false;
  el.textContent = '';
  const done = () => {
    if (finished) return; finished = true;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    el.textContent = text;
    if (onDone) onDone();
  };
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / total);
    el.textContent = text.slice(0, Math.floor(p * n));
    if (p < 1) raf = requestAnimationFrame(frame); else done();
  };
  raf = requestAnimationFrame(frame);
  return { skip: done, cancel() { if (raf) cancelAnimationFrame(raf); raf = 0; finished = true; } };
}
