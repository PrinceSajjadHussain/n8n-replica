import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './auth';
import { getSystemRole, systemRoleAtLeast, type SystemRole } from '../db/rbac';

/** Requires the caller to hold at least `minRole` instance-wide (e.g. 'admin'
 *  for SSO/API-token/audit-log administration, 'superadmin' for role
 *  assignment itself). Distinct from `requireWorkspaceRole` — this governs
 *  admin surfaces that span the whole FlowForge instance. */
export function requireSystemRole(minRole: SystemRole) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const role = await getSystemRole(req.userId!);
      if (!systemRoleAtLeast(role, minRole)) {
        return res.status(403).json({ error: 'Insufficient system-level permissions' });
      }
      (req as AuthedRequest & { systemRole?: SystemRole }).systemRole = role!;
      next();
    } catch (err) {
      next(err);
    }
  };
}
