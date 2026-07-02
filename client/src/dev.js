// Dev diagnostics flag (?dev) — governs the on-screen perf/service overlay (#perf) + perf telemetry.
// STICKY: a truthy ?dev (?dev, ?dev=true, ?dev=1) turns it ON and remembers it in localStorage;
// an explicit ?dev=false / ?dev=0 turns it OFF and clears the stored flag; no dev param (or an
// unrecognized value) → the stored flag decides. Evaluated ONCE per page load and cached.
// Reuses the existing ?dev flag (perf telemetry) — no new endpoint, no new flag name.
const KEY = 'devMode';

// Pure decision + storage side effect, so it's unit-testable without a DOM. Returns the on/off boolean.
export function evalDev(search, storage) {
  const params = new URLSearchParams(search || '');
  let url = null; // tri-state: true=force on, false=force off, null=no/ignored override
  if (params.has('dev')) {
    const v = params.get('dev');            // '' for a bare ?dev
    if (v === '' || v === 'true' || v === '1') url = true;
    else if (v === 'false' || v === '0') url = false;
    // any other value → leave url null (fall back to stored flag)
  }
  try {
    if (url === true) { storage && storage.setItem(KEY, '1'); return true; }
    if (url === false) { storage && storage.removeItem(KEY); return false; }
    return !!storage && storage.getItem(KEY) === '1';
  } catch { return url === true; } // localStorage blocked (private mode) → honor the URL only
}

const _search = typeof location !== 'undefined' ? location.search : '';
const _storage = typeof localStorage !== 'undefined' ? localStorage : null;
const DEV = evalDev(_search, _storage);

// True when the dev diagnostics flag is on (URL this load, or sticky from a previous ?dev visit).
export function isDev() { return DEV; }

// Set the body.devmode gate before first paint (idempotent; #perf is display:none until this lands).
if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('devmode', DEV);
