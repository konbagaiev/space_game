// Minimal S3 PutObject/GetObject over hand-rolled SigV4 (no @aws-sdk dep — same approach as ses.js).
// Used to store/serve gameplay session recordings (docs/plans/2026-08-03-1246-record-all-sessions.md).
import crypto from 'node:crypto';

const REGION = () => process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const BUCKET = () => process.env.ASSETS_BUCKET || 'vega-sentinels-assets';
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, date), region), service), 'aws4_request');
}
const haveCreds = () => !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
// Encode each key segment but keep the '/' separators.
const encKey = (key) => key.split('/').map(encodeURIComponent).join('/');

// Sign + send one S3 request (virtual-hosted style). body is a Buffer (PUT) or null (GET). Returns the fetch Response.
async function s3Request(method, key, body) {
  const region = REGION(), bucket = BUCKET(), service = 's3';
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const now = new Date();
  const amzdate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');       // YYYYMMDDTHHMMSSZ
  const dateStamp = amzdate.slice(0, 8);
  const payloadHash = body ? crypto.createHash('sha256').update(body).digest('hex') : sha256hex('');
  const canonicalUri = '/' + encKey(key);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzdate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzdate}\n${scope}\n${sha256hex(canonicalRequest)}`;
  const signature = hmac(signingKey(process.env.AWS_SECRET_ACCESS_KEY, dateStamp, region, service), stringToSign).toString('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers = { 'X-Amz-Date': amzdate, 'X-Amz-Content-Sha256': payloadHash, Authorization: authorization };
  if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(body.length); }
  return fetch(`https://${host}${canonicalUri}`, { method, headers, body: body || undefined });
}

// Upload a JSON trace. Returns { ok, key }. No-op (ok:false) when creds/bucket are absent.
export async function putTrace(key, jsonString) {
  if (!haveCreds()) return { ok: false, key };
  try {
    const res = await s3Request('PUT', key, Buffer.from(jsonString, 'utf8'));
    return { ok: res.ok, key };
  } catch (e) { console.warn('[s3] putTrace failed:', e?.message); return { ok: false, key }; }
}

// Fetch a JSON trace by key. Returns the parsed object or null.
export async function getTrace(key) {
  if (!haveCreds()) return null;
  try {
    const res = await s3Request('GET', key, null);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { console.warn('[s3] getTrace failed:', e?.message); return null; }
}
