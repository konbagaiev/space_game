# Password recovery / reset flow

**Feature ID:** `2026-07-01-1717-password-reset` · **Slug:** `password-reset`

## Goal

We have registration + login + email verification but no way to recover a forgotten password. Add a
self-service **"Forgot password?"** flow modeled exactly on the existing email-verification flow: from the
login form the player requests a reset by email; the server emails a link `/?reset=TOKEN`; opening it shows
a "set a new password" modal; submitting it rotates the password, invalidates the player's other sessions,
marks the email verified (clicking the link proves ownership), logs the player in on this device, and
clears the query param. The forgot-password endpoint is **enumeration-safe** (always HTTP 200 whether or
not the email exists). Reuse existing infra everywhere — SES no-op `outbox`, the token-hash + `sent_at` +
TTL pattern, `crypto.scrypt`, the in-memory per-IP rate limiter, and the `#account` modal.

## Decisions (already made — do not re-ask)

- **After reset: auto-login.** `POST /api/auth/reset-password` calls the existing `startSession` and
  returns the player row; the client adopts the returned `id` exactly like `doLogin` (fresh-device path).
- **Invalidate all other sessions on reset.** New `deleteSessionsForPlayer(playerId)` in **both** `db.js`
  and `db_postgres.js`; the route deletes all of the player's sessions, then `startSession` opens one fresh
  session for this device.
- **On reset, mark email verified.** Consuming the reset token sets `email_verified = 1` and clears
  `email_verify_token_hash` (clicking the emailed link proves ownership).
- **Reset-token TTL = 1 hour.** New `RESET_TTL_MS = 60 * 60 * 1000` in `auth.js`. Reuse the existing
  `RESEND_THROTTLE_MS` (60 s) to throttle repeated forgot-password sends per account (via
  `password_reset_sent_at`).
- **Reset link opens the app** at `${APP_BASE_URL}/?reset=TOKEN` (a client route, like `/?verified=1`) —
  **not** a static HTML page and **not** an `/api/...` route.
- **Enumeration-safe:** forgot-password always returns `200 { ok: true }`; it only emails when the email
  maps to a real account (and isn't throttled).
- **Only accounts with a password can reset.** `setResetToken` requires `password_hash` present (an email
  that's on an anonymous-but-verified row without a password can't reset — but in practice every emailed
  row is a full account; the guard is just belt-and-suspenders).

## Steps

### 1. Schema — new columns (SQLite migration + Postgres bootstrap parity)

Add two columns to `players`, mirroring `email_verify_token_hash` / `email_verify_sent_at`.

**a. New SQLite migration** — create `server/src/migrations/017_password_reset.js` (the runner in
`server/src/migrate.js:12` auto-discovers `NNN_*.js` files in order; `016_item_models.js` is the current
highest):

```js
// 017 — password reset (self-service recovery; DECISIONS §11). Mirrors the email-verify token pattern:
// a hashed, single-use, TTL'd token stored on the players row (raw token lives only in the emailed link).
export const up = (db) => {
  db.exec(`
    ALTER TABLE players ADD COLUMN password_reset_token_hash TEXT;
    ALTER TABLE players ADD COLUMN password_reset_sent_at INTEGER;
  `);
};
```

**b. Postgres bootstrap parity** — in `server/src/db_postgres.js`, right after line 108
(`email_verify_sent_at BIGINT;`) add:

```sql
    ALTER TABLE players ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS password_reset_sent_at BIGINT;
```

(Postgres uses `BIGINT` for epoch-ms columns to match `email_verify_sent_at`.)

### 2. `auth.js` — TTL constant

`server/src/auth.js:9-10`, alongside `VERIFY_TTL_MS` / `RESEND_THROTTLE_MS`, add:

```js
export const RESET_TTL_MS = 60 * 60 * 1000; // password-reset token lifetime: 1 h
```

No new hashing helpers are needed — reuse `newSessionToken()` (raw token) + `hashToken()` (stored hash)
and `hashPassword()`, exactly as the verify/register flow does.

### 3. `ses.js` — reset email + URL builder

`server/src/ses.js`. After `sendVerificationEmail` / `verificationUrl` (ends at line 97) add:

```js
// Send the password-reset message to `toEmail` with a link to `resetUrl`. Same no-creds behavior as
// verification: on missing AWS creds (local dev / tests) it logs the link and records it to `outbox`.
export async function sendPasswordResetEmail(toEmail, resetUrl) {
  const accessKey = env('AWS_ACCESS_KEY_ID');
  const secretKey = env('AWS_SECRET_ACCESS_KEY');
  const subject = 'Reset your Vega Sentinels password';
  const textBody =
    `A password reset was requested for your Vega Sentinels account.\n\n` +
    `Set a new password (this link expires in 1 hour):\n${resetUrl}\n\n` +
    `If you didn't request this, you can safely ignore this message — your password won't change.`;

  if (!accessKey || !secretKey) {
    console.log(`[ses] no AWS credentials — password reset link for ${toEmail}: ${resetUrl}`);
    outbox.push({ to: toEmail, subject, resetUrl });
    return { delivered: false, resetUrl };
  }

  await sesRequest({
    Action: 'SendEmail',
    Source: SES_FROM(),
    'Destination.ToAddresses.member.1': toEmail,
    'Message.Subject.Data': subject,
    'Message.Subject.Charset': 'UTF-8',
    'Message.Body.Text.Data': textBody,
    'Message.Body.Text.Charset': 'UTF-8',
  }, { accessKey, secretKey, region: SES_REGION() });
  return { delivered: true, resetUrl };
}

// Build the app URL the reset email links to (a CLIENT route `/?reset=…`, not an API route).
export function passwordResetUrl(token) {
  return `${APP_BASE_URL().replace(/\/$/, '')}/?reset=${encodeURIComponent(token)}`;
}
```

Note the outbox entry uses field **`resetUrl`** (verification uses `verifyUrl`) so tests can tell them
apart.

### 4. Datastore — three new functions in BOTH backends (keep in sync)

Mirror `setVerifyToken` / `verifyEmailToken` / `deleteSession`. Each new function goes in **both**
`server/src/db.js` and `server/src/db_postgres.js`, and is re-exported from `server/src/datastore.js`.

**a. `server/src/db.js`** — import `RESET_TTL_MS` at the top (line 7 currently imports
`{ SESSION_TTL_MS, VERIFY_TTL_MS }` — add `RESET_TTL_MS`). Add after `verifyEmailToken` (ends line 561):

```js
// Begin a password reset for `email`: if it maps to a real account (has a password) and isn't throttled,
// store the reset token hash + sent_at and return { id, email }; otherwise return null (route stays 200).
export function setResetToken(email, tokenHash, sentAt) {
  const r = db.prepare('SELECT id, email, password_hash, password_reset_sent_at FROM players WHERE email = ?').get(email);
  if (!r || !r.password_hash) return null;                 // no such account (enumeration-safe caller)
  if (r.password_reset_sent_at && sentAt - r.password_reset_sent_at < RESEND_THROTTLE_MS) return null; // throttled
  db.prepare('UPDATE players SET password_reset_token_hash = ?, password_reset_sent_at = ? WHERE id = ?')
    .run(tokenHash, sentAt, r.id);
  return { id: r.id, email: r.email };
}

// Consume a reset token: if it matches an unexpired token, set the new password, mark the email verified
// (the link proves ownership), and clear both reset + verify tokens. Returns the player id, or null.
export function consumeResetToken(tokenHash, passwordHash, passwordSalt) {
  const minSentAt = Date.now() - RESET_TTL_MS;
  const r = db.prepare('SELECT id FROM players WHERE password_reset_token_hash = ? AND password_reset_sent_at >= ?')
    .get(tokenHash, minSentAt);
  if (!r) return null;
  db.prepare(`UPDATE players SET password_hash = ?, password_salt = ?, email_verified = 1,
      email_verify_token_hash = NULL, password_reset_token_hash = NULL, password_reset_sent_at = NULL
      WHERE id = ?`).run(passwordHash, passwordSalt, r.id);
  return r.id;
}

// Invalidate all of a player's sessions (used on password reset). No-op if the player has none.
export function deleteSessionsForPlayer(playerId) {
  db.prepare('DELETE FROM sessions WHERE player_id = ?').run(playerId);
}
```

**b. `server/src/db_postgres.js`** — import `RESET_TTL_MS` (find the `VERIFY_TTL_MS` import and add it).
Add after `verifyEmailToken` (ends line 709), async + `$n` params:

```js
export async function setResetToken(email, tokenHash, sentAt) {
  const { rows } = await pool.query(
    'SELECT id, email, password_hash, password_reset_sent_at FROM players WHERE email = $1', [email]);
  const r = rows[0];
  if (!r || !r.password_hash) return null;
  const prevSent = r.password_reset_sent_at != null ? Number(r.password_reset_sent_at) : 0;
  if (prevSent && sentAt - prevSent < RESEND_THROTTLE_MS) return null;
  await pool.query('UPDATE players SET password_reset_token_hash = $1, password_reset_sent_at = $2 WHERE id = $3',
    [tokenHash, sentAt, r.id]);
  return { id: r.id, email: r.email };
}

export async function consumeResetToken(tokenHash, passwordHash, passwordSalt) {
  const minSentAt = Date.now() - RESET_TTL_MS;
  const { rows } = await pool.query(
    'SELECT id FROM players WHERE password_reset_token_hash = $1 AND password_reset_sent_at >= $2',
    [tokenHash, minSentAt]);
  if (!rows[0]) return null;
  await pool.query(`UPDATE players SET password_hash = $1, password_salt = $2, email_verified = 1,
      email_verify_token_hash = NULL, password_reset_token_hash = NULL, password_reset_sent_at = NULL
      WHERE id = $3`, [passwordHash, passwordSalt, rows[0].id]);
  return rows[0].id;
}

export async function deleteSessionsForPlayer(playerId) {
  await pool.query('DELETE FROM sessions WHERE player_id = $1', [playerId]);
}
```

`RESEND_THROTTLE_MS` must be imported in `db_postgres.js` too — check its top import from `./auth.js` and
add both `RESET_TTL_MS` and `RESEND_THROTTLE_MS` if missing (SQLite `db.js` likewise needs
`RESEND_THROTTLE_MS`).

**c. `server/src/datastore.js`** — after the `deleteSession` re-export (line 44) add:

```js
export const setResetToken = (...a) => impl.setResetToken(...a);
export const consumeResetToken = (...a) => impl.consumeResetToken(...a);
export const deleteSessionsForPlayer = (...a) => impl.deleteSessionsForPlayer(...a);
```

### 5. Server routes — `server/src/server.js`

**a. Imports.** Line 8-9 datastore import: add `setResetToken, consumeResetToken, deleteSessionsForPlayer`.
Line 13 ses import: change to `import { sendVerificationEmail, verificationUrl, sendPasswordResetEmail, passwordResetUrl } from './ses.js';`

**b. Add both routes** immediately after the `resend-verification` route (ends `server/src/server.js:302`):

```js
  // Begin password recovery. Enumeration-safe: ALWAYS 200. If the email maps to a real account (and a
  // send isn't throttled by password_reset_sent_at), store a hashed reset token and email a /?reset=… link.
  app.post('/api/auth/forgot-password', authLimiter, wrap(async (req, res) => {
    const email = normEmail(String((req.body || {}).email || ''));
    if (validEmail(email)) {
      const resetToken = newSessionToken();
      const target = await setResetToken(email, hashToken(resetToken), Date.now());
      if (target) await sendPasswordResetEmail(target.email, passwordResetUrl(resetToken));
    }
    res.json({ ok: true }); // never reveal whether the email exists
  }));

  // Complete password recovery: validate the token, rotate the password, mark the email verified, drop the
  // player's other sessions, and log them in on this device (fresh session cookie). Adopts like login.
  app.post('/api/auth/reset-password', authLimiter, wrap(async (req, res) => {
    const token = (req.body || {}).token;
    const password = (req.body || {}).password;
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token required' });
    if (!validPassword(password)) return res.status(400).json({ error: 'password must be at least 8 characters' });
    const { hash, salt } = hashPassword(password);
    const playerId = await consumeResetToken(hashToken(token), hash, salt);
    if (!playerId) return res.status(400).json({ error: 'invalid or expired reset link' });
    await deleteSessionsForPlayer(playerId); // invalidate every existing session for this account
    await startSession(res, playerId, req);  // …then open one fresh session for this device
    res.json(await getPlayerPublic(playerId));
  }));
```

`newSessionToken`, `hashToken`, `hashPassword` are already imported at `server/src/server.js:11`;
`getPlayerPublic` and `startSession` are already in scope. Import order note: `deleteSessionsForPlayer`
runs before `startSession` so the fresh session survives the purge.

### 6. Client — `#account` modal gains `forgot` + `reset` modes

**a. HTML** — `client/index.html`. Add a "Forgot password?" link inside the account actions and give the
modal a place for it. After `client/index.html:114` (`account-close` button), inside `.account-actions`,
add:

```html
      <button id="account-forgot" class="ghost link" data-i18n="ui.account.forgot_link">Forgot password?</button>
```

(It's toggled by JS per mode; styling can reuse the existing `.ghost` link look — no new CSS required, but
if a distinct link style is wanted reuse an existing anchor-like class rather than inventing one.)

**b. `client/src/account.js` element refs.** In the `acc` object (`client/src/account.js:23-33`) add:

```js
  forgot: document.getElementById('account-forgot'),
```

**c. Mode config.** Extend `setAccountMode` (`client/src/account.js:63-90`). Two new modes:

- Field visibility: show `email` for `login`/`register`/`forgot`; show `password` for
  `login`/`register`/`reset`; hide `username` except `prompt`/`register`; hide `email` for `reset`.
- Show the `#account-forgot` link only in `login` mode; hide the `secondary` button in `forgot`/`reset`.
- `forgot`: title `ui.account.forgot_title`, msg `ui.account.forgot_msg`, primary
  `ui.account.forgot_send`.
- `reset`: title `ui.account.reset_title`, msg `ui.account.reset_msg`, primary `ui.account.reset_submit`,
  `password.autocomplete = 'new-password'`.

Concretely, replace the field-visibility lines and add the two branches, e.g.:

```js
  acc.primary.style.display  = '';   // normalize: doForgot hides it on success (see 6f); reset every switch
  acc.username.style.display = (mode === 'prompt' || mode === 'register') ? 'block' : 'none';
  // #account-creds wraps BOTH email + password. Keep it shown for every credential mode (login/register/
  // forgot/reset) and toggle the individual inputs inside it — forgot needs the email, reset needs only
  // the password.
  acc.creds.style.display    = (mode === 'register' || mode === 'login' || mode === 'forgot' || mode === 'reset') ? 'block' : 'none';
  acc.email.style.display    = (mode === 'reset') ? 'none' : 'block';       // reset: no email field
  acc.password.style.display = (mode === 'forgot') ? 'none' : 'block';      // forgot: no password field
  acc.secondary.style.display = (mode === 'forgot' || mode === 'reset') ? 'none' : '';
  acc.forgot.style.display    = (mode === 'login') ? '' : 'none';
```

**Blocking fix 1:** `forgot` MUST be in the `creds` display condition above — `#account-creds`
(`client/index.html:106`) wraps both inputs, so omitting `forgot` would hide the email the user needs to
type. **Blocking fix 2:** the leading `acc.primary.style.display = ''` line normalizes the primary button
on every mode switch, because `doForgot` (6f) hides it on success on this single persistent `#account`
element; without this reset the next `openAccount('login')` would show an invisible login button.

Add branches to the title/msg/button block:

```js
  } else if (mode === 'forgot') {
    acc.title.textContent = t('ui.account.forgot_title');
    acc.msg.textContent = t('ui.account.forgot_msg');
    acc.primary.textContent = t('ui.account.forgot_send');
  } else if (mode === 'reset') {
    acc.title.textContent = t('ui.account.reset_title');
    acc.msg.textContent = t('ui.account.reset_msg');
    acc.primary.textContent = t('ui.account.reset_submit');
    acc.password.autocomplete = 'new-password';
```

**d. Route the primary button.** In `accountPrimary` (`client/src/account.js:124-134`) add before the
register/login dispatch:

```js
  if (accountMode === 'forgot') return doForgot();
  if (accountMode === 'reset') return doReset();
```

**e. Wire the link + a module-level token holder.** Near the event wiring
(`client/src/account.js:217-222`) add:

```js
let resetToken = null; // raw token from the /?reset=… link, held for the reset submit
acc.forgot.addEventListener('click', () => setAccountMode('forgot'));
```

**f. New handlers** (place beside `doLogin`, ~`client/src/account.js:178`):

```js
async function doForgot() {
  const email = acc.email.value.trim();
  acc.primary.disabled = true;
  try {
    await authFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    // Enumeration-safe: show the same confirmation regardless of whether the email exists.
    acc.err.textContent = '';
    acc.msg.textContent = t('ui.account.forgot_sent');
    acc.email.style.display = 'none';
    acc.primary.style.display = 'none';   // hide the send button on the confirmation screen; setAccountMode
                                          // restores it (leading `acc.primary.style.display=''` in 6c) on the
                                          // next mode switch, so a later openAccount('login') isn't broken.
  } catch { acc.err.textContent = t('ui.account.err_network'); }
  finally { acc.primary.disabled = false; }
}

async function doReset() {
  const password = acc.password.value;
  if (password.length < 8) { acc.err.textContent = t('ui.account.err_password'); return; }
  acc.primary.disabled = true;
  try {
    const r = await authFetch('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { acc.err.textContent = t('ui.account.err_reset_invalid'); return; }
    accountPlayer = j;
    if (j.id && j.id !== G.playerId) {          // adopt the account's player row (fresh-device reset)
      G.playerId = j.id;
      try { localStorage.setItem('playerId', G.playerId); } catch {}
      await reloadPlayerWorld();
    }
    renderAccountBar();
    closeAccount();
  } catch { acc.err.textContent = t('ui.account.err_network'); }
  finally { acc.primary.disabled = false; acc.primary.style.display = ''; }
}
```

**g. Detect the `?reset=` param on boot.** In `restoreSession` (`client/src/account.js:238-242`), extend
the query-param block to also capture the reset token and open the modal:

```js
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('verified') === '1') accountVerifiedJustNow = true;
    const rt = params.get('reset');
    if (rt) { resetToken = rt; openAccount('reset'); }
    if (params.has('verified') || params.has('reset')) {
      params.delete('verified'); params.delete('reset');
      history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
    }
  } catch {}
```

`openAccount` (`client/src/account.js:92`) already shows the modal; when called with `'reset'` it must not
wipe the password prematurely — it only clears email/password when `mode !== 'register'`, which is fine
(the reset field starts empty). The `openAccount` focus line focuses `email` only for `login`; for `reset`
focus should go to `password` — update the focus ternary to
`(mode === 'login' ? acc.email : mode === 'reset' ? acc.password : acc.username)`.

### 7. i18n — EN source + RU bundle

**a. `client/locales/source.json`** — after the account keys block (ends ~line 118, `ui.account.err_generic`)
add (keep the `{ source, context }` shape):

```json
  "ui.account.forgot_link": { "source": "Forgot password?", "context": "Link on the login form that starts password recovery." },
  "ui.account.forgot_title": { "source": "Reset your password", "context": "Title of the forgot-password form." },
  "ui.account.forgot_msg": { "source": "Enter your account email and we'll send you a reset link.", "context": "Subtitle on the forgot-password form." },
  "ui.account.forgot_send": { "source": "Send reset link", "context": "Button that submits the forgot-password email. Short." },
  "ui.account.forgot_sent": { "source": "If that email has an account, a reset link is on its way. Check your inbox.", "context": "Confirmation shown after requesting a reset; deliberately vague so it never reveals whether the email exists." },
  "ui.account.reset_title": { "source": "Set a new password", "context": "Title of the new-password form opened from the emailed reset link." },
  "ui.account.reset_msg": { "source": "Choose a new password for your account.", "context": "Subtitle on the new-password form." },
  "ui.account.reset_submit": { "source": "Save new password", "context": "Button that submits the new password. Short." },
  "ui.account.err_reset_invalid": { "source": "This reset link is invalid or has expired. Request a new one.", "context": "Error shown when a reset link is bad or older than one hour." },
```

**b. `client/locales/ru.json`** — after `ui.account.err_generic` (line 118) add matching RU values:

```json
  "ui.account.forgot_link": "Забыли пароль?",
  "ui.account.forgot_title": "Сброс пароля",
  "ui.account.forgot_msg": "Введите почту аккаунта — мы отправим ссылку для сброса пароля.",
  "ui.account.forgot_send": "Отправить ссылку",
  "ui.account.forgot_sent": "Если аккаунт с такой почтой существует, ссылка для сброса уже в пути. Проверьте почту.",
  "ui.account.reset_title": "Новый пароль",
  "ui.account.reset_msg": "Задайте новый пароль для своего аккаунта.",
  "ui.account.reset_submit": "Сохранить пароль",
  "ui.account.err_reset_invalid": "Ссылка для сброса недействительна или устарела. Запросите новую.",
```

The `i18n.test.js` parity check (keys present in both catalogs) must stay green — add all keys to both
files.

## Tests

### Server (SQLite) — add to `server/src/server.test.js`

Follow the existing `verify:` test pattern (`server/src/server.test.js:510-527`): pull the raw token out of
`outbox.at(-1).resetUrl`. Add:

1. **Happy path + auto-login + rotation.** Register an account; `POST /api/auth/forgot-password` with its
   email → 200 `{ ok: true }`; assert `outbox.at(-1).resetUrl` matches `/\/\?reset=/`. Extract the token,
   `POST /api/auth/reset-password` with `{ token, password: 'newpassword1' }` → 200, a session cookie is
   set, response `id` equals the account's player id. Then: login with the **new** password → 200; login
   with the **old** password → 401. Also assert the row's `emailVerified` is now `true` (was false).

2. **Sessions invalidated on reset.** Register (capture the session cookie/token); confirm `/api/auth/me`
   with that cookie → 200. Run forgot + reset. Re-check `/api/auth/me` with the **old** cookie → 401 (all
   prior sessions dropped); the cookie returned by reset-password → 200.

3. **Enumeration-safe.** Record `outbox.length`; `POST /api/auth/forgot-password` with an email that has no
   account → 200 `{ ok: true }` and `outbox.length` unchanged (nothing emailed).

4. **Invalid / consumed token → 400.** `POST /api/auth/reset-password` with `{ token: 'nope', password:
   'whatever12' }` → 400. After a successful reset, replaying the **same** token → 400 (single-use: it was
   cleared).

5. **Weak new password → 400.** `POST /api/auth/reset-password` with a valid-shaped but <8-char password →
   400 (guards `validPassword`).

6. **Expired token (datastore-level, deterministic).** Import `setResetToken, consumeResetToken` from
   `./datastore.js` at the top of the test file. Register an account, then call
   `setResetToken(email, hashToken('rawtok'), Date.now() - 2 * 60 * 60 * 1000)` (sent_at 2 h ago), then
   `consumeResetToken(hashToken('rawtok'), 'h', 's')` → `null` (older than the 1 h TTL). This uses the
   explicit `sentAt` param on `setResetToken` so expiry is testable without waiting. (Import `hashToken`
   from `./auth.js`.)

Run: `cd server && npm test`. Server tests also run against Postgres (`npm run test:pg`) — the new
datastore functions and bootstrap columns must be present in `db_postgres.js` for that to pass.

### Client — `cd client && node --test`

The i18n parity test (`client/src/i18n.test.js`) covers the new keys existing in both `source.json` and
`ru.json`. No new client unit test is required (the account UI has no existing node:test coverage and
DECISIONS §30 says don't add scaffolding); a manual smoke via the reset link is enough. If the reviewer
wants coverage, a small pure test could assert `passwordResetUrl(token)` shape — optional, not required.

## Docs to update

- **`docs/SUMMARY.md`** —
  - **Accounts/auth section (~lines 750-771):** add `password_reset_token_hash` / `password_reset_sent_at`
    to the "Schema (migration 009 / Postgres bootstrap)" bullet, noting they arrive in **migration 017**.
    After the "Verification flow" bullet (line 765-768) add a **"Password reset flow"** bullet: forgot-
    password is enumeration-safe (always 200), emails a `/?reset=…` link (1 h TTL, throttled by
    `password_reset_sent_at`); reset-password rotates the password, marks the email verified, **drops all
    the player's sessions**, and logs them in on this device. Add `/api/auth/forgot-password` and
    `/api/auth/reset-password` to the auth-routes list at line 682-683.
  - Bump the `**Updated:**` date at the top.
- **`docs/CHANGELOG.md`** — add under today's date (`## 2026-07-01`): **"Password recovery"** — Forgot-
  password → emailed `/?reset=TOKEN` link → new-password modal; enumeration-safe endpoint, 1 h token TTL,
  sessions invalidated + email auto-verified on reset, auto-login after. Migration 017 + Postgres parity;
  EN+RU strings.
- **`docs/DECISIONS.md`** — add a numbered entry (next free number) recording the **enumeration-safety
  trade-off**: forgot-password always returns 200 and shows an identical confirmation whether or not the
  email exists, so the endpoint can't be used to probe which emails have accounts; the cost is that a user
  who mistypes their email gets no "no such account" feedback (accepted — standard practice, DECISIONS §30
  keep-it-simple). Note the reset link marks the email verified because clicking it proves ownership, and
  that reset invalidates all prior sessions (defense against a compromised session being the reason for
  the reset). Also acknowledge the residual **timing side channel**: an existing email awaits the SES
  round-trip before the 200 while a non-existent one returns immediately, so response latency can leak
  existence to a determined observer — accepted, it mirrors the existing verification flow and closing it
  (async-queue the send / constant-time response) isn't worth the complexity per §30.

## Out of scope / non-goals (DECISIONS §30)

- **No separate static reset page** — reuse the `#account` modal (`reset` mode) and the `/?reset=` client
  route, consistent with `/?verified=1`.
- **No new email-sending mechanism** — reuse `ses.js` (SigV4 + `outbox` no-op path); no `@aws-sdk`.
- **No password-strength meter, no "confirm password" second field, no security questions, no account
  lockout** beyond the existing per-IP rate limiter + the per-account `sent_at` throttle.
- **No persistent/rate-limit-store changes** — the in-memory per-IP limiter is reused as-is (off under
  tests).
- **No change to the verification flow, session model, or password hashing** — clone the patterns, don't
  refactor them.
- **No "reset link expired → resend from the modal" convenience** — the error just tells the user to
  request a new link from the login form.
