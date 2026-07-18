import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceRole, requireWorkflowRole } from '../middleware/permissions';
import { listActivityForWorkspace, listActivityForWorkflow } from '../db/activity';

/** Mounted at /workspaces — GET /workspaces/:workspaceId/activity */
export const workspaceActivityRouter = Router();
workspaceActivityRouter.use(requireAuth);
workspaceActivityRouter.get('/:workspaceId/activity', requireWorkspaceRole('viewer'), async (req, res, next) => {
  try {
    const activity = await listActivityForWorkspace(req.params.workspaceId, Number(req.query.limit) || 100);
    res.json({ activity });
  } catch (err) {
    next(err);
  }
});

/** Mounted at /workflows — GET /workflows/:id/activity */
export const workflowActivityRouter = Router();
workflowActivityRouter.use(requireAuth);
workflowActivityRouter.get('/:id/activity', requireWorkflowRole('viewer'), async (req, res, next) => {
  try {
    const activity = await listActivityForWorkflow(req.params.id, Number(req.query.limit) || 100);
    res.json({ activity });
  } catch (err) {
    next(err);
  }
});
