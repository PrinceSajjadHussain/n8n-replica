import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { createApiToken, listApiTokens, revokeApiToken } from '../db/apiTokens';
import { auditFromRequest } from '../utils/audit';

/** Mounted at /admin/api-tokens. Every authenticated user manages their own
 *  tokens — issuing one grants programmatic access with the issuer's own
 *  workspace/workflow permissions, scoped further by `scopes`. */
export const apiTokensRouter = Router();
apiTokensRouter.use(requireAuth);

const SCOPES = [
  'workflows:read',
  'workflows:write',
  'executions:read',
  'executions:write',
  'credentials:read',
  'webhooks:trigger',
] as const;

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(SCOPES)).min(1).optional(),
  rateLimit: z.number().int().min(1).max(6000).optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

/** GET /admin/api-tokens — list the caller's tokens (secrets never re-shown). */
apiTokensRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const tokens = await listApiTokens(req.userId!);
    res.json({ tokens, availableScopes: SCOPES });
  } catch (err) {
    next(err);
  }
});

/** POST /admin/api-tokens — issue a new token. The plaintext secret is
 *  returned exactly once in this response and never stored or shown again. */
apiTokensRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { name, scopes, rateLimit, expiresInDays } = parsed.data;
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
    const { row, token } = await createApiToken({ userId: req.userId!, name, scopes, rateLimit, expiresAt });
    await auditFromRequest(req, {
      userId: req.userId,
      action: 'api_token.created',
      metadata: { tokenId: row.id, name: row.name, scopes: row.scopes },
    });
    res.status(201).json({
      token, // shown once
      id: row.id,
      prefix: row.prefix,
      name: row.name,
      scopes: row.scopes,
      rateLimit: row.rateLimit,
      expiresAt: row.expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /admin/api-tokens/:id — revoke a token immediately. */
apiTokensRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const ok = await revokeApiToken(req.userId!, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Token not found' });
    await auditFromRequest(req, { userId: req.userId, action: 'api_token.revoked', metadata: { tokenId: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
