import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './auth';
import { getWorkspaceRole, getWorkflowRole, roleAtLeast, type WorkspaceRole } from '../db/workspaces';

/** Requires the caller to hold at least `minRole` in the workspace named by `:workspaceId` (or `:id`). */
export function requireWorkspaceRole(minRole: WorkspaceRole) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.params.workspaceId ?? req.params.id;
      const role = await getWorkspaceRole(workspaceId, req.userId!);
      if (!roleAtLeast(role, minRole)) {
        return res.status(role ? 403 : 404).json({ error: role ? 'Insufficient permissions' : 'Workspace not found' });
      }
      (req as AuthedRequest & { workspaceRole?: WorkspaceRole }).workspaceRole = role!;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Requires the caller to hold at least `minRole` on the workflow named by `:id` (via workspace membership, or legacy ownership). */
export function requireWorkflowRole(minRole: WorkspaceRole) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const workflowId = req.params.id ?? req.params.workflowId;
      const role = await getWorkflowRole(workflowId, req.userId!);
      if (!roleAtLeast(role, minRole)) {
        return res.status(role ? 403 : 404).json({ error: role ? 'Insufficient permissions' : 'Workflow not found' });
      }
      (req as AuthedRequest & { workflowRole?: WorkspaceRole }).workflowRole = role!;
      next();
    } catch (err) {
      next(err);
    }
  };
}
