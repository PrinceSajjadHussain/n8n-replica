import type { Response, NextFunction } from 'express';
import Redis from 'ioredis';
import type { AuthedRequest } from './auth';

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', (err) => console.error('[rateLimit] redis error', err.message));
  redis.connect().catch((err) => console.error('[rateLimit] redis connect failed', err.message));
  return redis;
}

// Fallback fixed-window counter, used only if Redis is unavailable (e.g. in
// tests) so rate limiting degrades gracefully rather than crashing requests.
const memoryWindows = new Map<string, { count: number; resetAt: number }>();

async function incrementFixedWindow(key: string, windowMs: number): Promise<number> {
  const client = getRedis();
  if (client) {
    const windowKey = `ratelimit:${key}:${Math.floor(Date.now() / windowMs)}`;
    const count = await client.incr(windowKey);
    if (count === 1) await client.pexpire(windowKey, windowMs);
    return count;
  }
  const now = Date.now();
  const entry = memoryWindows.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryWindows.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/** Per-minute fixed-window rate limit. API-token requests are limited by the
 *  token's own `rateLimit` (settable per token, default 600/min); JWT
 *  session requests and anonymous requests fall back to `defaultPerMinute`
 *  keyed by user id or IP, so the public webhook surface can't be hammered. */
export function rateLimit(defaultPerMinute = 300) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const windowMs = 60_000;
      let key: string;
      let limit: number;

      if (req.apiTokenId) {
        key = `token:${req.apiTokenId}`;
        limit = req.apiTokenRateLimit ?? 600;
      } else if (req.userId) {
        key = `user:${req.userId}`;
        limit = defaultPerMinute;
      } else {
        key = `ip:${req.ip}`;
        limit = defaultPerMinute;
      }

      const count = await incrementFixedWindow(key, windowMs);
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - count)));

      if (count > limit) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'Rate limit exceeded', limit, windowSeconds: 60 });
      }
      next();
    } catch (err) {
      // Never let rate-limiting infra failures block real traffic.
      console.error('[rateLimit] failed, allowing request', err);
      next();
    }
  };
}
