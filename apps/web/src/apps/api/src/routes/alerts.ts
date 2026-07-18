import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requireWorkflowRole } from '../middleware/permissions';
import {
  createAlertConfig,
  listAlertConfigs,
  updateAlertConfig,
  deleteAlertConfig,
  getAlertConfigWorkflowId,
} from '../db/alerts';
import { logActivity } from '../db/activity';
import { getWorkflowById } from '../db/workflows';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

/** GET /workflows/:id/alerts */
alertsRouter.get('/:id/alerts', requireWorkflowRole('viewer'), async (req, res, next) => {
  try {
    const alerts = await listAlertConfigs(req.params.id);
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  channel: z.enum(['email', 'webhook']),
  target: z.string().min(1), // email address, or webhook URL
  onFailure: z.boolean().optional(),
  onSuccess: z.boolean().optional(),
});

/** POST /workflows/:id/alerts — editors+ can configure who gets notified on execution failure/success. */
alertsRouter.post('/:id/alerts', requireWorkflowRole('editor'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (parsed.data.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.target)) {
      return res.status(400).json({ error: 'target must be a valid email address for the email channel' });
    }
    if (parsed.data.channel === 'webhook' && !/^https?:\/\//.test(parsed.data.target)) {
      return res.status(400).json({ error: 'target must be an http(s) URL for the webhook channel' });
    }
    const alert = await createAlertConfig(req.params.id, req.userId!, parsed.data);
    const workflow = await getWorkflowById(req.params.id, req.userId!).catch(() => null);
    await logActivity({
      workspaceId: workflow?.workspaceId ?? null,
      workflowId: req.params.id,
      userId: req.userId,
      action: 'alert.created',
      metadata: { channel: parsed.data.channel },
    });
    res.status(201).json({ alert });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  target: z.string().min(1).optional(),
  onFailure: z.boolean().optional(),
  onSuccess: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

alertsRouter.patch('/:id/alerts/:alertId', requireWorkflowRole('editor'), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if ((await getAlertConfigWorkflowId(req.params.alertId)) !== req.params.id) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    const alert = await updateAlertConfig(req.params.alertId, parsed.data);
    res.json({ alert });
  } catch (err) {
    next(err);
  }
});

alertsRouter.delete('/:id/alerts/:alertId', requireWorkflowRole('editor'), async (req, res, next) => {
  try {
    if ((await getAlertConfigWorkflowId(req.params.alertId)) !== req.params.id) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    const ok = await deleteAlertConfig(req.params.alertId);
    if (!ok) return res.status(404).json({ error: 'Alert not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
