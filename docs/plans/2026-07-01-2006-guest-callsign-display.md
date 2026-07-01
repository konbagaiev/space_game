# Guest callsign display

**Status:** planned · **Area:** client account bar / i18n · **Server change:** none

## Goal

A guest who sets a callsign at the level-1 "Name yourself, Sentinel" prompt (then picks *Continue as
guest*) currently still sees **"Playing as a guest"** in the menu account bar — the name they typed is
never shown. The POST to `/api/players/:id/username` succeeds server-side (the row *does* get the
username), but the client only records it when a signed-in account exists, so for a guest it's dropped
and never rendered. This change makes the bar immediately show **"Playing as <name>"** after the guest
names themselves, persists that callsign across reloads (client-side, in `localStorage`), keeps offering
*Log in / Sign up*, and ensures a later guest→register keeps the callsign instead of wiping it. Registered
(email) account behaviour is unchanged.

## Decisions (settled — do not re-open)

1. **Persistence = client-only `localStorage` mirror (option a), no server/DB change.** A guest is
   already a `localStorage`-scoped identity (`G.playerId` lives there), so there is no cross-device
   expectation to satisfy; mirroring the callsign next to it is the smallest fix (DECISIONS §30). We do
   **not** add `username` to the `/active-ship` response (that would touch `server.js` + **both** `db.js`
   and `db_postgres.js` for no user-visible gain here).
2. **Guest→register keeps the callsign via client-side prefill.** When the account dialog opens with an
   empty username field, seed it from the stored guest callsign so an empty-field register can't overwrite
   the saved name with `null`. The server keeps its existing "typed username wins" behaviour
   (`server.js:245` / `registerAccount`); we change nothing server-side.
3. **New i18n key `ui.account.guest_named` = `"Playing as {who}"`**, mirroring the `{who}` convention of
   `ui.account.signed_in_as`. `ui.account.anon` has no name slot, so a new key is required.
4. **`guestName` is not cleared on register/login.** After a successful register/login `accountPlayer` is
   set and takes precedence in the bar, so the stale-vs-fresh distinction never shows while signed in. On
   the same device a later logout then correctly falls back to "Playing as <that callsign>". A fresh-device
   login that adopts a *different* player is a tolerated edge case (the local device's old guest name could
   reappear only after logging out again) — not worth extra state per §30.

## Steps

All paths under the worktree
`/Users/kbagaiev/Projects/ag-wt/2026-07-01-2006-guest-callsign-display`.

### 1. `client/src/account.js` — add `guestName` state (near the `authToken` helpers, ~line 40)

After the `AUTH_TOKEN_KEY` / `getAuthToken` / `setAuthToken` block (`account.js:40-42`), add a parallel
guest-callsign store:

```js
// Guest callsign: a guest who names themselves at the level-1 prompt has no account row we track
// client-side (accountPlayer stays null), so mirror the name here + in localStorage. Lets the account
// bar show "Playing as <name>" and survives a reload (the guest identity itself lives in localStorage).
const GUEST_NAME_KEY = 'guestName';
let guestName = (() => { try { return localStorage.getItem(GUEST_NAME_KEY) || null; } catch { return null; } })();
const setGuestName = (name) => {
  guestName = name || null;
  try { name ? localStorage.setItem(GUEST_NAME_KEY, name) : localStorage.removeItem(GUEST_NAME_KEY); } catch {}
};
```

The `let guestName = (…)()` IIFE runs at module-import time (before `bootstrap()` runs), so the value is
already loaded by the time the boot path renders the bar (see step 5).

### 2. `client/src/account.js` — `renderAccountBar` else-branch (`account.js:70-73`)

Current:

```js
  } else {
    add('div', null, t('ui.account.anon'));
    add('button', null, t('ui.account.sign_in')).addEventListener('click', () => openAccount('login'));
  }
```

Replace the label line so a named guest gets the new string; the *Log in / Sign up* CTA stays either way:

```js
  } else {
    add('div', null, guestName ? t('ui.account.guest_named', { who: guestName }) : t('ui.account.anon'));
    add('button', null, t('ui.account.sign_in')).addEventListener('click', () => openAccount('login'));
  }
```

Leave the `if (accountPlayer && accountPlayer.email)` branch (`account.js:61-69`) untouched — a signed-in
account still shows `signed_in_as`, taking precedence over any guest name.

### 3. `client/src/account.js` — `saveUsername` (`account.js:146-152`)

Current gate `if (r.ok && accountPlayer)` is exactly the bug: a guest has `accountPlayer === null`, so the
successful save is dropped. Rewrite to record the server-returned name for a guest too and always
re-render on success:

```js
async function saveUsername(username) {
  if (!G.playerId) return;
  try {
    const r = await authFetch(`/api/players/${G.playerId}/username`, { method: 'POST', body: JSON.stringify({ username }) });
    if (r.ok) {
      const saved = (await r.json()).username; // server-normalized (cleanUsername) name
      if (accountPlayer) accountPlayer.username = saved;
      else setGuestName(saved);                // guest: remember the callsign locally + persist it
      renderAccountBar();
    }
  } catch {}
}
```

`saveUsername` is called from `accountPrimary()` in the `prompt` mode (`account.js:156-159`) with the
trimmed input; no change needed there.

### 4. `client/src/account.js` — `openAccount` prefill (`account.js:122-129`)

Current:

```js
export function openAccount(mode, opts = {}) {
  afterAccount = opts.after || null;
  if (opts.username != null) acc.username.value = opts.username;
  if (mode !== 'register') { acc.email.value = ''; acc.password.value = ''; }
  setAccountMode(mode);
  …
```

Add an `else if` so an explicit `opts.username` still wins, but an otherwise-empty field is seeded from the
stored callsign:

```js
export function openAccount(mode, opts = {}) {
  afterAccount = opts.after || null;
  if (opts.username != null) acc.username.value = opts.username;
  else if (!acc.username.value && guestName) acc.username.value = guestName; // keep the guest callsign on a later register
  if (mode !== 'register') { acc.email.value = ''; acc.password.value = ''; }
  setAccountMode(mode);
  …
```

This means: guest names themselves → *Continue as guest* → later clicks *Log in / Sign up*
(`openAccount('login')`) → switches to Register (`accountSecondary` → `setAccountMode('register')`, which
does **not** clear the username input) → the field already holds the callsign → `doRegister`
(`account.js:173-176`) sends it as `username` → `registerAccount` persists it. Empty-field wipe avoided.

### 5. Boot path — no new call needed, but verify

`guestName` loads at module import (step 1). The boot render happens via `showMain`/`showWelcome`
(`client/src/main.js:513-514`), and **both** call `renderAccountBar()` already:
`client/src/mainwindow.js:36` and `client/src/welcome.js:53`. So the first paint of the bar reflects the
loaded `guestName` with no change to `main.js`/`bootstrap()`. No edit required in `main.js`; do **not** add
a redundant `renderAccountBar()` call there.

### 6. `client/locales/source.json` — new key

Insert immediately after `ui.account.anon` (`source.json:107`):

```json
  "ui.account.guest_named": { "source": "Playing as {who}", "context": "Account status line shown in the menu account bar when a guest has set a callsign at the level-1 prompt but has no account. {who} is the guest's chosen callsign. Mirrors ui.account.signed_in_as." },
```

### 7. `client/locales/ru.json` — new key

Insert immediately after `ui.account.anon` (`ru.json:107`), matching the tone of the existing
`ui.account.*` values (`signed_in_as` → "Вы вошли как {who}", `anon` → "Игра в режиме гостя"):

```json
  "ui.account.guest_named": "Играю как {who}",
```

Keep the `{who}` placeholder verbatim (the i18n interpolator matches on the literal `{who}`).

## Tests

- **No new client unit test for `account.js`.** `account.js` is **not** importable under `node --test`:
  it touches the DOM at import time (`document.getElementById(...)` at `account.js:24-36`, `addEventListener`
  at `account.js:293-299`) *and* its import graph pulls in `world.js` / `ship-build.js` → three.js, none of
  which load headless. There is no cheap pure seam for the 3-way label branch, and extracting a one-module
  helper for three lines would over-engineer per DECISIONS §30. The label logic is a direct
  `guestName ? t(...) : t(...)` ternary that the i18n interpolation path already covers.
- **Existing i18n interpolation is already covered** by `client/src/i18n.test.js:31-39` (the `{named}`
  placeholder + translated-value interpolation tests), which is the only non-trivial logic the new key
  relies on. Do not add a near-duplicate test.
- **Run the full client suite and keep it green:** `cd client && node --test`.
- **Server unchanged → server suite must stay green untouched:** `cd server && npm test` (runs on both
  SQLite and Postgres). No `db.js` / `db_postgres.js` / `server.js` edits in this change, so parity is
  preserved by construction — do **not** modify them.
- **Manual verification (the DOM/render path the unit tests can't reach):**
  1. Fresh browser profile (or clear `localStorage`). Play, clear level 1, at the prompt type a callsign
     (e.g. `Ace`) and click **Continue as guest**. → Account bar shows **"Playing as Ace"** with a
     **Log in / Sign up** button still present.
  2. Reload the page. → Bar still shows **"Playing as Ace"** (loaded from `localStorage.guestName`).
  3. Click **Log in / Sign up**, switch to **Create account** (via "Create a new account"). → The callsign
     field is pre-filled with `Ace`. Complete registration. → Bar switches to **"Signed in as Ace"**.
  4. Log out. → Bar returns to **"Playing as Ace"** (guest fallback on the same device).
  5. A brand-new guest who skips naming (empty field → Continue as guest) → bar shows the old
     **"Playing as a guest"** (`ui.account.anon`) — unchanged.

## Docs to update

- **`docs/SUMMARY.md`** — in the auth / account section (the account-bar description), note that a guest
  who sets a callsign at the level-1 prompt now sees "Playing as <name>" (key `ui.account.guest_named`),
  persisted client-side in `localStorage['guestName']` and mirrored back onto register via the dialog
  prefill; registered accounts still show "Signed in as …". Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`** — bullet under `## 2026-07-01`:
  *"**Guest callsign now shown.** A guest who names themselves at the level-1 prompt sees 'Playing as
  <name>' in the account bar (was always 'Playing as a guest'); the callsign persists across reloads via
  `localStorage['guestName']` and pre-fills the register form so a later sign-up keeps it. Client-only —
  no server/DB change. New i18n key `ui.account.guest_named`."*
- **`docs/DECISIONS.md`** — **optional / your call.** The localStorage-vs-server choice is minor and fully
  explained by §30 (keep it simple) + the fact that a guest is already a localStorage identity. A one-line
  note is acceptable but not required; if added, reference §30 and the "guest identity already lives in
  localStorage, no cross-device expectation" reasoning rather than opening a new numbered trade-off.

## Out of scope / non-goals (do not gold-plate — DECISIONS §30)

- **No** `username` in the `/api/players/:id/active-ship` response; **no** `server.js`, `db.js`, or
  `db_postgres.js` changes at all.
- **No** editing of the callsign after it's set (no rename UI), no validation/UX beyond what the existing
  prompt already does — the server already normalizes via `cleanUsername`.
- **No** cross-device guest-name sync (guests are single-device by definition).
- **No** clearing of `guestName` on register/login (see Decision 4) and **no** new DOM test harness for
  `account.js`.
- **No** changes to the itch/`API_BASE`/bearer-token auth paths — leave `authFetch`, `restoreSession`, and
  the token handling exactly as they are.
