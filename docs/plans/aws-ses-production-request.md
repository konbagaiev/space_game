# AWS SES setup for Vega Sentinels — what to submit / do

> **STATUS (2026-06-21): ✅ FULLY SET UP — all of #1, #2, #3 done.** Verified via AWS CLI:
> account `ProductionAccessEnabled: true`, `SendingEnabled: true`, `EnforcementStatus: HEALTHY`; the
> `vega.tenony.com` identity is `Verified: true` with `DkimStatus: SUCCESS` (DKIM signing on); the prod
> server `.env` holds the IAM keys + all `SES_*`/`APP_BASE_URL` vars. Prod sends real, DKIM-signed
> verification email. Sections below are kept for the record.

> **AWS CLI access (for future sessions):** Claude has admin AWS access on this machine — the **default
> profile** is `claude_admin` in account **`140065018525`** (`aws sts get-caller-identity` confirms it),
> the same account/credentials used by `~/Projects/Salesforce`. SES is in **us-east-1**. So AWS checks
> here need no extra setup — e.g.:
> `aws sesv2 get-account --region us-east-1`,
> `aws sesv2 get-email-identity --email-identity vega.tenony.com --region us-east-1`.

Account `140065018525`, region **us-east-1**. SES has **production access** (out of sandbox). For a
public game that emails verification links to arbitrary players, production access was required before
launch — now granted.

Sender domain: **`vega.tenony.com`** (the game's domain). DNS records go in the **`tenony.com` zone**
(at whatever provider hosts `tenony.com` — e.g. GoDaddy if that's where it's managed; confirm).

There are three things. #1 (production access) is what you submit to AWS. #2 (domain verify + DNS) and
#3 (IAM keys) can be done by Claude on the CLI except for the DNS record entry, which is yours.

**Do the setup BEFORE submitting #1.** AWS doesn't strictly require a verified identity to grant
production access, but our request text claims a *DKIM-verified domain* and a *live site at
https://vega.tenony.com* — a reviewer may check both. Submitting before they're true risks a weak or
denied application (slower than just setting up first). So: verify the domain (#2) and have the site
reachable at that URL, then submit #1. The IAM user (#3) is internal and can be created anytime.

---

## 1. SES production access request — ✅ DONE (granted 2026-06-21)

Console: **SES → Account dashboard → "Request production access"** (region **us-east-1**), or open a
Service-limit-increase support case for "SES Sending Limits".

The console modal was streamlined (verified June 2026) — it no longer requires a free-text use case.
Fill these fields:
- **Mail type:** Transactional (one-to-one, user-triggered: verification + password emails)
- **Website URL:** `https://vega.tenony.com`
- **Additional contacts:** an email (up to 4) for account communications
- **Preferred contact language:** EN
- **Acknowledgement:** check the box — "only send to individuals who've explicitly requested it" + "I
  have a process for handling bounce and complaint notifications" (this checkbox replaces the old
  use-case essay; its substance is what we already do)
- **Submit request** — then it's under review; details can't be edited until AWS responds (≤24 h).

CLI equivalent: `aws sesv2 put-account-details --production-access-enabled --mail-type TRANSACTIONAL
--website-url https://vega.tenony.com --contact-language EN`.

> **Use case description — NOT needed for the streamlined form.** Keep this only in case AWS Support
> follows up asking for detail:
>
> Vega Sentinels is a free browser game hosted at https://vega.tenony.com. We send **transactional
> email only** to players who voluntarily create an account by entering their own email address in our
> registration form. The primary message is a **double opt-in email-verification link** the user must
> click to confirm ownership of their address; we also send account-related transactional messages
> (password-related notifications). We do **not** send marketing or bulk email.
>
> Recipients are exclusively people who submitted their own address to register; there is no purchased
> or third-party list. Expected volume is low — well under 200 emails/day initially.
>
> Bounce and complaint handling: we subscribe to SES bounce/complaint notifications and **suppress any
> address that hard-bounces or files a complaint**, and we stop the verification flow for it. Sending
> is from a DKIM-signed, SES-verified domain (`vega.tenony.com`) with SPF aligned. The address is
> `noreply@vega.tenony.com`; account emails identify the game and explain why the user received them.
>
> Region: us-east-1. The AWS account is shared with another of our applications that already uses SES.

Approval is typically within ~24 hours. **Note:** this raises the account out of sandbox for *all*
SES in us-east-1 — it also benefits the other app on this account; no downside.

**Until it's approved**, dev/testing still works: verify a couple of your own test addresses in SES
(`aws ses verify-email-identity --email-address you@example.com`) and the verification flow works
against those.

---

## 2. Sender domain + DKIM (Claude runs the AWS part; YOU add the DNS records) — ✅ DONE

> Verified 2026-06-21 via AWS CLI: `vega.tenony.com` is `Verified: true`, `DkimStatus: SUCCESS`,
> DKIM signing enabled. The DNS records below are live in the `tenony.com` zone.

Claude will run (when you authorize the AWS mutation):
```bash
aws ses verify-domain-identity --domain vega.tenony.com --region us-east-1
aws ses verify-domain-dkim     --domain vega.tenony.com --region us-east-1
```
These return a **verification TXT token** and **3 DKIM CNAME tokens**. Claude hands you the exact
records; **you add them in the `tenony.com` DNS zone**:
- `_amazonses.vega.tenony.com` **TXT** = the verification token
- 3× `<token>._domainkey.vega.tenony.com` **CNAME** = `<token>.dkim.amazonses.com`
- Recommended **SPF**: `vega.tenony.com` **TXT** `v=spf1 include:amazonses.com ~all`

When DNS propagates, SES flips the identity to **verified** (Claude can poll
`aws ses get-identity-verification-attributes`). Outbound-only — **no MX record needed** (the game
doesn't receive email).

---

## 3. IAM sending user (Claude runs this, scoped least-privilege) — ✅ DONE

> Verified 2026-06-21: the prod server `.env` (`/opt/projects/spacegame/.env`) contains
> `AWS_ACCESS_KEY_ID` (20 chars), `AWS_SECRET_ACCESS_KEY` (40 chars), `SES_REGION=us-east-1`,
> `SES_FROM_ADDRESS=noreply@vega.tenony.com`, and `APP_BASE_URL=https://vega.tenony.com`. So the app
> sends via real SES (not the no-op path). Keys are server-only, kept by CI (rsync excludes `.env`).

Modeled on the other project's `TendNookAppPolicy`. Claude will create:
```bash
aws iam create-user --user-name vega-sentinels-mailer
aws iam put-user-policy --user-name vega-sentinels-mailer --policy-name VegaSentinelsMailerPolicy \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
    "Action":["ses:SendEmail","ses:SendRawEmail"],"Resource":"*"}]}'
aws iam create-access-key --user-name vega-sentinels-mailer
```
The access key + secret go into the **server-only `.env`** (kept on the server by CI, like
`DATABASE_URL`), alongside:
```
SES_REGION=us-east-1
SES_FROM_ADDRESS=noreply@vega.tenony.com
APP_BASE_URL=https://vega.tenony.com
AWS_ACCESS_KEY_ID=...        # vega-sentinels-mailer
AWS_SECRET_ACCESS_KEY=...
```
⚠️ The secret access key is shown **once** at creation — store it straight into the server `.env`
(and your password manager). Never commit it.

---

## Order of operations (setup first, submit last)
1. **(Optional but recommended) Make the site reachable at `https://vega.tenony.com`** — point DNS at
   the server + add the Traefik host rule (Phase B of the rename, `docs/plans/rename-vega-sentinels.md`),
   so the URL in the request is live when a reviewer checks it.
2. **Claude (on your go):** create the SES domain identity + DKIM for `vega.tenony.com`; create the IAM
   user `vega-sentinels-mailer`. Hand you the DNS records + the IAM keys.
3. **You:** add the `_amazonses` TXT + 3 DKIM CNAMEs + SPF to the `tenony.com` zone; drop the IAM keys
   into the server `.env`.
4. **Claude:** poll `aws ses get-identity-verification-attributes` until the domain is **Verified** +
   DKIM enabled.
5. **You:** **now submit the production-access request (#1)** — every claim (verified domain, live site)
   is true, so the application is clean.
6. **Claude:** wire `server/src/ses.js` to the env vars; implement the rest per
   `docs/plans/auth-implementation.md`.

> Note: until production access is granted you can still develop/test by verifying a couple of your own
> addresses (`aws ses verify-email-identity`). Production access (~24 h) and DNS propagation overlap, so
> total lead time stays small even doing setup first.

> Note: pointing the game itself at `vega.tenony.com` (Traefik host rule, deploy config, migrating off
> `space.bagaiev.com`) is a **separate infra change** — see the rename/migration follow-up, not part of
> this SES setup.
