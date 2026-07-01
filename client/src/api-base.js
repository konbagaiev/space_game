// The base URL every /api call is prefixed with. Empty string = same-origin relative (the normal
// deploy at vega.tenony.com, where the client and API share one origin — see server/src/server.js).
// The itch.io build (scripts/build-itch.mjs) OVERWRITES this file's copy in the ZIP with the absolute
// production origin, because on itch the client runs on itch's CDN and must call the API cross-origin.
// Do NOT sniff the hostname at runtime (itch uses rotating *.itch.zone / *.hwcdn.net subdomains);
// the value is baked at build time. See docs/plans/2026-07-01-1824-itch-html5-export.md.
export const API_BASE = '';
