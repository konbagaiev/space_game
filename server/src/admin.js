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

// Render the players table page. `data-sort` on each cell holds the raw numeric/string value used by the
// inline column-sort script (so sorting is by real value, not the formatted display text).
function renderPage(players) {
  const rows = players.map((p) => `
    <tr>
      <td title="${esc(p.id)}"><code>${esc(p.id.slice(0, 8))}</code></td>
      <td>${esc(p.username)}</td>
      <td>${esc(p.email)}</td>
      <td data-sort="${p.emailVerified ? 1 : 0}">${p.emailVerified ? 'yes' : ''}</td>
      <td data-sort="${p.createdAt}">${fmtDate(p.createdAt)}</td>
      <td data-sort="${p.lastSeen}">${fmtDate(p.lastSeen)}</td>
      <td data-sort="${p.currentProgress}" class="num">${p.currentProgress}</td>
      <td data-sort="${p.credits}" class="num">${p.credits}</td>
      <td data-sort="${p.gamesPlayed}" class="num">${p.gamesPlayed}</td>
      <td data-sort="${p.totalTimeMs}" class="num">${fmtTime(p.totalTimeMs)}</td>
      <td data-sort="${p.totalKills}" class="num">${p.totalKills}</td>
      <td data-sort="${p.totalEarned}" class="num">${p.totalEarned}</td>
      <td class="ref"><code>${esc(p.referrer)}</code></td>
    </tr>`).join('');
  const headers = ['id', 'username', 'email', 'verified', 'created', 'last seen', 'progress', 'credits',
    'games', 'time played', 'kills', 'earned', 'referrer'];
  const ths = headers.map((h, i) => `<th data-col="${i}">${esc(h)}</th>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Vega Sentinels — admin</title>
    <style>
      body { font: 14px system-ui, sans-serif; margin: 1rem; background: #0e1116; color: #e6e6e6; }
      h1 { font-size: 1.1rem; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #2a2f3a; padding: 4px 8px; text-align: left; vertical-align: top; }
      th { cursor: pointer; background: #171b22; position: sticky; top: 0; user-select: none; }
      th:hover { background: #202632; }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.ref { max-width: 320px; word-break: break-all; color: #9fb3c8; }
      code { color: #cfe3ff; }
      tr:nth-child(even) td { background: #12161d; }
    </style></head><body>
    <h1>Players — ${players.length}${players.length >= 1000 ? ' (capped)' : ''}</h1>
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

// Mount GET /admin on the app. `getAdminPlayers` is injected (datastore fn) so this stays testable.
export function mountAdmin(app, getAdminPlayers) {
  app.get('/admin', async (req, res, next) => {
    try {
      if (!checkAuth(req, res)) return;
      const players = await getAdminPlayers(1000);
      res.type('html').send(renderPage(players));
    } catch (e) { next(e); }
  });
}
