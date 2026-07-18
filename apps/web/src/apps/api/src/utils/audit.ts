import type { Request } from 'express';
import { logActivity, type LogActivityInput } from '../db/activity';
import type { AuthedRequest } from '../middleware/auth';

/** Thin wrapper over `logActivity` that fills ipAddress/userAgent from the
 *  originating request — use this (instead of calling logActivity directly)
 *  for anything that should show up in the enterprise audit log: admin
 *  actions, SSO config changes, API token issuance/revocation, RBAC role
 *  changes, credential access. */
export async function auditFromRequest(
  req: Request | AuthedRequest,
  input: Omit<LogActivityInput, 'ipAddress' | 'userAgent'>
): Promise<void> {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ipAddress = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]) || req.ip || null;
  await logActivity({
    ...input,
    ipAddress,
    userAgent: req.headers['user-agent'] ?? null,
  });
}
