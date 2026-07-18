import { randomBytes, createHash } from 'crypto';

/** Tokens look like `ffk_<24 random b62 chars>`. We only ever store a SHA-256
 *  hash of the full secret plus a short `prefix` (first 10 chars incl. the
 *  `ffk_` marker) so the UI can show "ffk_9gj2...  created 3 days ago"
 *  without ever re-displaying the secret. */
const PREFIX_LEN = 10;

export function generateApiToken(): { token: string; prefix: string; tokenHash: string } {
  const raw = randomBytes(24).toString('base64url');
  const token = `ffk_${raw}`;
  const prefix = token.slice(0, PREFIX_LEN);
  const tokenHash = hashApiToken(token);
  return { token, prefix, tokenHash };
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenPrefix(token: string): string {
  return token.slice(0, PREFIX_LEN);
}
