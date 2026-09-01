// The JS engine that ran a simulation — family + version, nothing else.
//
// Not the User-Agent: this is a technical fact about the MACHINE that produced a trace, and it is the only
// interpretation left for an honest `disagree` once build drift is gated
// (docs/plans/2026-09-01-1845-duel-referee.md §3.2). `Math.sin`, `Math.atan2`, `Math.hypot` and `Math.pow`
// are implementation-defined in ECMAScript, and `36-sim-divergence` only ever proved Chromium ↔ Node —
// nothing in this project has ever compared WebKit or Gecko against Node. Without the engine recorded, the
// first `disagree` is uninterpretable: a cheat, a sim bug, or just Safari?
//
// Pure and DOM-free so it is unit-testable from a UA table; `jsEngine()` is the one line that touches the
// browser.

const MAX_LEN = 64;   // it is a label on an admin page and a TEXT column, not a document

// 'Chromium/140.0.0.0' | 'WebKit/18.2' | 'Gecko/133.0' | null
export function parseEngine(ua) {
  const s = String(ua || '');
  if (!s) return null;
  const out = (family, m) => (m ? `${family}/${m[1]}`.slice(0, MAX_LEN) : null);
  // iOS/iPadOS FIRST: every browser there is WebKit by App Store rule, including Chrome (`CriOS`) and
  // Firefox (`FxiOS`), so matching Chrome/Firefox before this would record an engine that never ran.
  if (/iPhone|iPad|iPod/.test(s)) {
    return out('WebKit', /Version\/([\d.]+)/.exec(s)) || out('WebKit', /AppleWebKit\/([\d.]+)/.exec(s));
  }
  const gecko = /Firefox\/([\d.]+)/.exec(s);
  if (gecko) return out('Gecko', gecko);
  // Edge reports `Edg/` AND `Chrome/`; both are Chromium, and the `Chrome/` token comes first in the UA,
  // so that is the version recorded — which is the right one anyway: it names the ENGINE, not the shell.
  const chromium = /(?:Edg|Chrome|Chromium)\/([\d.]+)/.exec(s);
  if (chromium) return out('Chromium', chromium);
  const webkit = /Version\/([\d.]+).*Safari/.exec(s);
  if (webkit) return out('WebKit', webkit);
  return null;
}

export const jsEngine = () => (typeof navigator === 'undefined' ? null : parseEngine(navigator.userAgent));
