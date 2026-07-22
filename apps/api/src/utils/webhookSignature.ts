import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of two HMAC digests (hex or base64 strings of the
 * same expected length). Falls back to `false` (never throws) on any length
 * mismatch, malformed input, etc. — a verification helper must never let a
 * parsing edge case turn into an uncaught 500 on a public webhook endpoint.
 */
function safeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Verifies Calendly's webhook signature.
 *
 * Calendly sends `Calendly-Webhook-Signature: t=<unix_ts>,v1=<hex_hmac>`
 * where the signed payload is `${t}.${rawBody}` and the digest is
 * HMAC-SHA256 hex, keyed by the webhook subscription's signing secret.
 * See: https://developer.calendly.com/api-docs/ZG9jOjM2MzE2MDM5-webhook-signatures
 */
export function verifyCalendlySignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  signingSecret: string
): { ok: boolean; reason?: string } {
  if (!rawBody) return { ok: false, reason: 'missing raw body' };
  if (!header) return { ok: false, reason: 'missing Calendly-Webhook-Signature header' };

  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k?.trim(), v?.trim()];
    })
  ) as { t?: string; v1?: string };

  if (!parts.t || !parts.v1) return { ok: false, reason: 'malformed signature header' };

  const expected = createHmac('sha256', signingSecret)
    .update(`${parts.t}.${rawBody.toString('utf8')}`)
    .digest('hex');

  return safeEqual(expected, parts.v1) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/**
 * Verifies a DocuSign Connect HMAC signature.
 *
 * DocuSign Connect sends one or more `X-DocuSign-Signature-1`,
 * `X-DocuSign-Signature-2`, ... headers (one per configured HMAC key,
 * supporting key rotation) — each a base64 HMAC-SHA256 of the raw request
 * body. A match against any configured key is a valid signature.
 * See: https://developer.docusign.com/platform/webhooks/connect/connect-hmac/
 */
export function verifyDocusignSignature(
  rawBody: Buffer | undefined,
  headers: Record<string, string | string[] | undefined>,
  signingSecret: string
): { ok: boolean; reason?: string } {
  if (!rawBody) return { ok: false, reason: 'missing raw body' };

  const signatureHeaders = Object.entries(headers)
    .filter(([key]) => /^x-docusign-signature-\d+$/i.test(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : value ? [value] : []));

  if (signatureHeaders.length === 0) {
    return { ok: false, reason: 'missing X-DocuSign-Signature-* header' };
  }

  const expected = createHmac('sha256', signingSecret).update(rawBody).digest('base64');
  const matched = signatureHeaders.some((sig) => safeEqual(expected, sig));

  return matched ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}
