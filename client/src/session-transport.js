// Pure transport for a session-recording upload (docs/plans/2026-08-03-1246-record-all-sessions.md).
// Extracted from net.js so the beacon-vs-fetch routing — and the load-bearing NO-keepalive choice on the
// win/death path — is unit-testable without net.js's DOM/three-bound imports. The primitives (fetch/
// sendBeacon/Blob) are injected so a test can stub them.
//
// Win/death flush → plain `fetch` while the page STAYS OPEN (the overlay is up): NO `keepalive`, so there is
// NO ~64KB request-body cap. A `keepalive` fetch caps the body at ~64KB in Chrome, which silently threw and
// dropped every completed-level (minutes-of-ticks) win trace — only tiny death/quit traces slipped under.
// Unload (`beacon:true`) → `navigator.sendBeacon`, which has the same ~64KB body cap and silently refuses
// anything larger. That cap was documented as harmless ("tab-closers' traces are small") and it was not: at
// the old ~32 bytes/tick it dropped every quit longer than ~34 SECONDS, including a full hour of play. Two
// changes demoted it to a genuine last resort — the tab-hidden flush now goes out over a plain fetch while
// the page is still alive (main.js visibilitychange), and traces are run-length packed ~24× (replay.js), so
// even the unload path usually fits. Returns 'beacon' | 'fetch' | null (no transport).
export function sendSession(url, body, beacon, { fetch, sendBeacon, Blob } = {}) {
  if (beacon && sendBeacon) {
    sendBeacon(url, new Blob([body], { type: 'application/json' }));
    return 'beacon';
  }
  if (fetch) {
    // IMPORTANT: no `keepalive` here — the page is open on win/death, so a large trace must not be body-capped.
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
    return 'fetch';
  }
  return null;
}
