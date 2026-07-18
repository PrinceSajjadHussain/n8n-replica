import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { findValidApiToken } from '../db/apiTokens';

export interface AuthedRequest extends Request {
  userId?: string;
  apiTokenId?: string;
  apiTokenScopes?: string[];
  apiTokenRateLimit?: number;
}

/** Accepts either a short-lived JWT session token (from /auth/login) or a
 *  long-lived API token (`ffk_...`, from /admin/api-tokens) in the
 *  Authorization: Bearer header. API-token requests are additionally subject
 *  to per-token rate limiting — see `middleware/rateLimit.ts`. */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  const token = header.slice('Bearer '.length);

  if (token.startsWith('ffk_')) {
    try {
      const tokenRow = await findValidApiToken(token);
      if (!tokenRow) {
        return res.status(401).json({ error: 'Invalid, expired, or revoked API token' });
      }
      req.userId = tokenRow.userId;
      req.apiTokenId = tokenRow.id;
      req.apiTokenScopes = tokenRow.scopes;
      req.apiTokenRateLimit = tokenRow.rateLimit;
      return next();
    } catch (err) {
      return next(err);
    }
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Requires the resolved caller (JWT session or API token) to carry `scope`.
 *  Session/JWT requests always pass (they act with the full authority of the
 *  logged-in user); API-token requests must have been issued that scope. */
export function requireScope(scope: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.apiTokenScopes) return next(); // session auth, not scope-restricted
    if (!req.apiTokenScopes.includes(scope)) {
      return res.status(403).json({ error: `API token is missing required scope: ${scope}` });
    }
    next();
  };
}
