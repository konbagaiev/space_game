// Admin dashboard (docs/plans/2026-07-02-1352-admin-panel-player-stats.md): a private, server-rendered
// /admin page listing players + per-player game aggregates. Guarded by HTTP Basic Auth from the env
// (ADMIN_USER / ADMIN_PASSWORD); when either is unset the route 404s (disabled — never open on prod).
import crypto from 'node:crypto';

// Constant-time compare of two strings that never short-circuits on length (hash both sides to a fixed
// width first, so timing can't leak the credential length either).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function adminEnabled() {
  return !!(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD);
}

// Returns true if the request carries valid Basic Auth. On failure it writes the response (401 with a
// WWW-Authenticate challenge, or 404 when admin is disabled) and returns false.
function checkAuth(req, res) {
  if (!adminEnabled()) { res.status(404).end(); return false; }   // disabled → indistinguishable from "no such route"
  const header = req.headers.authorization || '';
  const m = /^Basic (.+)$/.exec(header);
  if (m) {
    const [user, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
    const pass = rest.join(':'); // passwords may contain ':'
    if (safeEqual(user, process.env.ADMIN_USER) && safeEqual(pass, process.env.ADMIN_PASSWORD)) return true;
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Vega Sentinels admin"');
  res.status(401).end('Authentication required');
  return false;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (ms) => { const s = Math.round((ms || 0) / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}h ${m}m`; };
const fmtDate = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '');

// Curated device-code → marketing-name lookup for the Sec-CH-UA-Model client hint (which returns a device
// CODE, e.g. "SM-A037F", not "Galaxy A03s"). Best-effort convenience — extend as new devices appear;
// unknown codes fall through to the raw code. No dependency (DECISIONS §56).
const DEVICE_NAMES = {
  // Samsung Galaxy (SM-*)
  'SM-A037F': 'Galaxy A03s', 'SM-A125F': 'Galaxy A12', 'SM-A155F': 'Galaxy A15',
  'SM-A515F': 'Galaxy A51', 'SM-A536B': 'Galaxy A53', 'SM-A546B': 'Galaxy A54',
  'SM-G991B': 'Galaxy S21', 'SM-S911B': 'Galaxy S23', 'SM-S918B': 'Galaxy S23 Ultra',
  // Xiaomi / Redmi
  '2201117TY': 'Redmi Note 11', '23021RAAEG': 'Redmi Note 12',
  // Apple (rarely populated — Safari/iOS don't send this hint; here for completeness)
  'iPhone14,5': 'iPhone 13', 'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
  // (Google Pixel already returns its marketing name as the "code", e.g. "Pixel 8" — no mapping needed.)
};

// Best-effort UA → browser name. Order matters: Edge/Opera/Samsung masquerade as Chrome, and Chrome
// masquerades as Safari. Returns null on empty/junk.
export function parseBrowser(ua) {
  if (!ua) return null;
  if (/EdgA?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  return null;
}

// Best-effort UA → OS/platform label (with version where the UA exposes it). Returns null on empty/junk.
export function parseOS(ua) {
  if (!ua) return null;
  let m;
  if ((m = /Android \d+(?:\.\d+)?/.exec(ua))) return m[0];                                  // "Android 10"
  if ((m = /(?:iPhone|iPad); CPU (?:iPhone )?OS (\d+)[._](\d+)/.exec(ua))) return `iOS ${m[1]}.${m[2]}`;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

// Compose the fullest label we can: "Browser · Model" (best), "Browser · OS", "Browser", "OS", the raw UA
// (truncated), or '' — never throws. `model` is the raw Sec-CH-UA-Model code (may be null/empty).
export function deviceLabel(userAgent, model) {
  const ua = userAgent || '';
  const browser = parseBrowser(ua);
  const name = model ? (DEVICE_NAMES[model] || model) : null;   // marketing name or raw code
  const right = name || parseOS(ua);
  if (browser && right) return `${browser} · ${right}`;
  if (browser) return browser;
  if (right) return right;
  return ua.slice(0, 200);   // unparseable → raw UA (may be '')
}

const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}m ${s % 60}s`; };

// The shared page shell (style + sortable table + the inline column-sort script), used by both admin
// views. `title`/`heading` are page chrome, `ths`/`rows` the pre-rendered table HTML, `nav` optional
// cross-link markup under the heading.
function pageShell({ title, heading, ths, rows, nav = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <style>
      body { font: 14px system-ui, sans-serif; margin: 1rem; background: #0e1116; color: #e6e6e6; }
      h1 { font-size: 1.1rem; }
      a { color: #7fb2ff; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #2a2f3a; padding: 4px 8px; text-align: left; vertical-align: top; }
      th { cursor: pointer; background: #171b22; position: sticky; top: 0; user-select: none; }
      th:hover { background: #202632; }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.ref { max-width: 320px; word-break: break-all; color: #9fb3c8; }
      td.device { max-width: 260px; word-break: break-word; color: #cbd5e1; }
      /* progress cell: level title (+ ✔ on the last level) · bar · n/N. Colors reuse the dark-theme
         palette above so the bar stays legible on #0e1116 / the #12161d even-row background. */
      td.prog { white-space: nowrap; }
      td.prog .lvl { display: inline-block; min-width: 5.6em; }
      td.prog .done { color: #4ade80; }
      td.prog .bar { display: inline-block; width: 60px; height: 8px; margin: 0 8px; vertical-align: middle;
                     background: #2a2f3a; border-radius: 4px; overflow: hidden; }
      td.prog .bar i { display: block; height: 100%; background: #7fb2ff; }
      td.prog .frac { color: #9fb3c8; font-variant-numeric: tabular-nums; }
      code { color: #cfe3ff; }
      tr:nth-child(even) td { background: #12161d; }
    </style></head><body>
    <h1>${esc(heading)}</h1>
    ${nav}
    <table id="t"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>
    <script>
      // Click a header to sort by that column (numeric when every cell parses as a number, else string).
      const table = document.getElementById('t');
      let sortCol = -1, asc = true;
      const cellVal = (tr, i) => { const td = tr.children[i]; return td.dataset.sort ?? td.textContent; };
      table.querySelectorAll('th').forEach((th, i) => th.addEventListener('click', () => {
        asc = sortCol === i ? !asc : true; sortCol = i;
        const rows = [...table.tBodies[0].rows];
        const numeric = rows.every((r) => cellVal(r, i) === '' || !isNaN(parseFloat(cellVal(r, i))));
        rows.sort((a, b) => {
          const x = cellVal(a, i), y = cellVal(b, i);
          const c = numeric ? (parseFloat(x || 0) - parseFloat(y || 0)) : String(x).localeCompare(String(y));
          return asc ? c : -c;
        });
        rows.forEach((r) => table.tBodies[0].appendChild(r));
      }));
    </script></body></html>`;
}

// The players-table "progress" cell. `current_progress` is a level id (an FK into the levels table) and
// since the 0-based renumbering it IS the campaign level number — but render the TITLE + a bar + n/N
// anyway, so the column reads as progress rather than as a bare id.
// `levels` is the id-ordered [{ id, title }] list from getLevels(); both N (levels.length) and the
// ordinal n are derived from it — never hardcoded. A ✔ marks the LAST level. Exported for unit tests.
// Unknown/unresolvable progress (id not in the list, or no levels) → the raw number, as before.
export function progressCell(currentProgress, levels = []) {
  const total = levels.length;
  const idx = levels.findIndex((l) => Number(l.id) === Number(currentProgress));
  if (idx < 0) return `<td data-sort="${esc(currentProgress)}" class="num">${esc(currentProgress)}</td>`;
  const n = idx + 1;
  const pct = Math.round((n / total) * 100);
  const check = n === total ? ' <span class="done">✔</span>' : '';
  return `<td data-sort="${esc(currentProgress)}" class="prog">` +
    `<span class="lvl">${esc(levels[idx].title)}${check}</span>` +
    `<span class="bar"><i style="width:${pct}%"></i></span>` +
    `<span class="frac">${n}/${total}</span></td>`;
}

// Render the players table page. `data-sort` on each cell holds the raw numeric/string value used by the
// inline column-sort script (so sorting is by real value, not the formatted display text).
function renderPage(players, levels) {
  const rows = players.map((p) => `
    <tr>
      <td title="${esc(p.id)}"><code>${esc(p.id.slice(0, 8))}</code></td>
      <td>${esc(p.username)}</td>
      <td>${esc(p.email)}</td>
      <td data-sort="${p.emailVerified ? 1 : 0}">${p.emailVerified ? 'yes' : ''}</td>
      <td data-sort="${p.createdAt}">${fmtDate(p.createdAt)}</td>
      <td data-sort="${p.lastSeen}">${fmtDate(p.lastSeen)}</td>
      ${progressCell(p.currentProgress, levels)}
      <td data-sort="${p.credits}" class="num">${p.credits}</td>
      <td data-sort="${p.gamesPlayed}" class="num">${p.gamesPlayed}</td>
      <td data-sort="${p.totalTimeMs}" class="num">${fmtTime(p.totalTimeMs)}</td>
      <td data-sort="${p.totalKills}" class="num">${p.totalKills}</td>
      <td data-sort="${p.totalEarned}" class="num">${p.totalEarned}</td>
      <td class="ref"><code>${esc(p.referrer)}</code></td>
      <td class="device" title="${esc(p.userAgent)}">${esc(deviceLabel(p.userAgent, p.deviceModel))}</td>
    </tr>`).join('');
  const headers = ['id', 'username', 'email', 'verified', 'created', 'last seen', 'progress', 'credits',
    'games', 'time played', 'kills', 'earned', 'referrer', 'device'];
  const ths = headers.map((h, i) => `<th data-col="${i}">${esc(h)}</th>`).join('');
  return pageShell({
    title: 'Vega Sentinels — admin',
    heading: `Players — ${players.length}${players.length >= 1000 ? ' (capped)' : ''}`,
    nav: '<p><a href="/admin/sessions">→ session recordings</a></p>',
    ths, rows,
  });
}

// Render the /admin/sessions page: every recorded gameplay session (newest first) with a ▶ play link
// (/?playback&id=…) and a ✓/✗ marker on whether the recorded game_version matches the current deploy.
function renderSessionsPage(sessions, currentVersion) {
  const rows = sessions.map((s) => {
    const v = s.gameVersion || '';
    const match = v && currentVersion ? (v === currentVersion ? ' ✓' : ' ✗') : '';
    return `
    <tr>
      <td data-sort="${s.createdAt}">${fmtDate(s.createdAt)}</td>
      <td title="${esc(s.playerId || '')}"><code>${s.playerId ? esc(s.playerId.slice(0, 8)) : 'anon'}</code></td>
      <td>${esc(s.level)}</td>
      <td>${esc(s.outcome)}</td>
      <td data-sort="${s.durationMs}" class="num">${fmtDur(s.durationMs)}</td>
      <td data-sort="${s.kills}" class="num">${s.kills}</td>
      <td title="${esc(v)}"><code>${esc(v.slice(0, 8))}</code>${match}</td>
      <td><a href="/?playback&id=${esc(s.id)}" target="_blank" rel="noopener">▶ play</a></td>
    </tr>`;
  }).join('');
  const headers = ['created', 'player', 'level', 'outcome', 'duration', 'kills', 'version', 'watch'];
  const ths = headers.map((h, i) => `<th data-col="${i}">${esc(h)}</th>`).join('');
  return pageShell({
    title: 'Vega Sentinels — sessions',
    heading: `Sessions — ${sessions.length}`,
    nav: '<p><a href="/admin">← players</a></p>',
    ths, rows,
  });
}

// Mount the admin views. `getAdminPlayers`/`getAdminSessions`/`getLevels` are injected (datastore fns) so
// this stays testable; `currentVersion` is the deploy commit for the ✓/✗ version-match marker.
export function mountAdmin(app, getAdminPlayers, getAdminSessions, currentVersion, getLevels = async () => []) {
  app.get('/admin', async (req, res, next) => {
    try {
      if (!checkAuth(req, res)) return;
      const [players, levels] = await Promise.all([getAdminPlayers(1000), getLevels()]);
      res.type('html').send(renderPage(players, levels));
    } catch (e) { next(e); }
  });
  app.get('/admin/sessions', async (req, res, next) => {
    try {
      if (!checkAuth(req, res)) return;
      const sessions = await getAdminSessions(500);
      res.type('html').send(renderSessionsPage(sessions, currentVersion));
    } catch (e) { next(e); }
  });
}
