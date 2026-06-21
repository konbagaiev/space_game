// Amazon SES sender — ISOLATED single swap point (DECISIONS §11). Sends transactional email via the
// classic SES Query API, signed with hand-rolled AWS SigV4 over the built-in `fetch`. No @aws-sdk dep.
// If credentials are absent (local dev / tests), it no-ops: logs the link and records it to `outbox`
// so flows work without SES (and tests can assert what would have been sent).
import crypto from 'node:crypto';

const env = (k, d) => process.env[k] || d;
const SES_REGION = () => env('SES_REGION', 'us-east-1');
const SES_FROM = () => env('SES_FROM_ADDRESS', 'noreply@vega.tenony.com');
const APP_BASE_URL = () => env('APP_BASE_URL', 'http://localhost:4000');

// Recorded sends on the no-creds dev/test path: { to, subject, verifyUrl }. Cleared by tests as needed.
export const outbox = [];

const sha256hex = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

// AWS SigV4: derive the signing key for (date, region, service).
function signingKey(secret, date, region, service) {
  const kDate = hmac('AWS4' + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

// POST a form-urlencoded SES Query-API request, signed with SigV4. Returns the response text.
async function sesRequest(params, { accessKey, secretKey, region }) {
  const host = `email.${region}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  const body = new URLSearchParams(params).toString();

  // amzdate = YYYYMMDDTHHMMSSZ ; dateStamp = YYYYMMDD (UTC)
  const now = new Date();
  const amzdate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzdate.slice(0, 8);

  const service = 'ses';
  const contentType = 'application/x-www-form-urlencoded';
  const payloadHash = sha256hex(body);

  const canonicalHeaders =
    `content-type:${contentType}\nhost:${host}\nx-amz-date:${amzdate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest =
    `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzdate}\n${scope}\n${sha256hex(canonicalRequest)}`;
  const signature = hmac(signingKey(secretKey, dateStamp, region, service), stringToSign).toString('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'X-Amz-Date': amzdate, Authorization: authorization },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SES ${res.status}: ${text}`);
  return text;
}

// Send the email-verification message to `toEmail` with a link to `verifyUrl`. On missing creds
// (local dev / tests) this is a no-op that logs the link and records it to `outbox`.
export async function sendVerificationEmail(toEmail, verifyUrl) {
  const accessKey = env('AWS_ACCESS_KEY_ID');
  const secretKey = env('AWS_SECRET_ACCESS_KEY');
  const subject = 'Verify your Vega Sentinels account';
  const textBody =
    `Welcome, Sentinel!\n\nConfirm your email to sync your progress across devices:\n${verifyUrl}\n\n` +
    `If you didn't create this account, you can ignore this message.`;

  if (!accessKey || !secretKey) {
    console.log(`[ses] no AWS credentials — verification link for ${toEmail}: ${verifyUrl}`);
    outbox.push({ to: toEmail, subject, verifyUrl });
    return { delivered: false, verifyUrl };
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
  return { delivered: true, verifyUrl };
}

// Build the verify URL the email links to (server uses this so the link matches the route).
export function verificationUrl(token) {
  return `${APP_BASE_URL().replace(/\/$/, '')}/api/auth/verify?token=${encodeURIComponent(token)}`;
}
