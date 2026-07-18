import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requireSystemRole } from '../middleware/rbac';
import { listAuditLog } from '../db/activity';
import { listUsersWithRoles, setSystemRole } from '../db/rbac';
import { auditFromRequest } from '../utils/audit';

/** Mounted at /admin. Instance-wide administration: audit log review and
 *  RBAC role assignment. All routes require at least `admin` system role;
 *  changing roles themselves requires `superadmin`. */
export const adminRouter = Router();
adminRouter.use(requireAuth);

/** GET /admin/audit-log?action=&userId=&sinceHours=&limit= */
adminRouter.get('/audit-log', requireSystemRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const sinceHours = Number(req.query.sinceHours);
    const since = Number.isFinite(sinceHours) && sinceHours > 0 ? new Date(Date.now() - sinceHours * 3_600_000) : undefined;
    const entries = await listAuditLog({
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
      userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
      since,
      limit: Number(req.query.limit) || 200,
    });
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

/** GET /admin/users — every user with their current system role. */
adminRouter.get('/users', requireSystemRole('admin'), async (_req, res, next) => {
  try {
    const users = await listUsersWithRoles();
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

const roleSchema = z.object({ role: z.enum(['superadmin', 'admin', 'member']) });

/** PUT /admin/users/:id/role — assign an instance-wide role. Superadmin only,
 *  so a plain admin can't escalate themselves or others. */
adminRouter.put('/users/:id/role', requireSystemRole('superadmin'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await setSystemRole(req.params.id, parsed.data.role);
    await auditFromRequest(req, {
      userId: req.userId,
      action: 'rbac.role_changed',
      metadata: { targetUserId: req.params.id, newRole: parsed.data.role },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
