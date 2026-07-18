import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/permissions';
import {
  createLogStreamConfig,
  listLogStreamConfigs,
  updateLogStreamConfig,
  deleteLogStreamConfig,
  getLogStreamConfigWorkspaceId,
} from '../db/logStreams';
import { logActivity } from '../db/activity';

export const logStreamsRouter = Router();
logStreamsRouter.use(requireAuth);

const eventTypeSchema = z.enum(['started', 'completed', 'failed']);

/** GET /workspaces/:workspaceId/log-streams — admin+ can view the operational streaming config. */
logStreamsRouter.get('/:workspaceId/log-streams', requireWorkspaceRole('admin'), async (req, res, next) => {
  try {
    const logStreams = await listLogStreamConfigs(req.params.workspaceId);
    res.json({ logStreams });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  targetUrl: z.string().url().refine((v) => /^https?:\/\//.test(v), 'targetUrl must be an http(s) URL'),
  eventTypes: z.array(eventTypeSchema).min(1).optional(),
  headers: z.record(z.string()).optional(),
  isActive: z.boolean().optional(),
});

/** POST /workspaces/:workspaceId/log-streams — admin+ (org owners included) can register a streaming target. */
logStreamsRouter.post('/:workspaceId/log-streams', requireWorkspaceRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const logStream = await createLogStreamConfig(req.params.workspaceId, req.userId!, parsed.data);
    await logActivity({
      workspaceId: req.params.workspaceId,
      workflowId: null,
      userId: req.userId,
      action: 'logStream.created',
      metadata: { name: parsed.data.name, targetUrl: parsed.data.targetUrl },
    });
    res.status(201).json({ logStream });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  targetUrl: z.string().url().refine((v) => /^https?:\/\//.test(v), 'targetUrl must be an http(s) URL').optional(),
  eventTypes: z.array(eventTypeSchema).min(1).optional(),
  headers: z.record(z.string()).nullable().optional(),
  isActive: z.boolean().optional(),
});

logStreamsRouter.patch('/:workspaceId/log-streams/:logStreamId', requireWorkspaceRole('admin'), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if ((await getLogStreamConfigWorkspaceId(req.params.logStreamId)) !== req.params.workspaceId) {
      return res.status(404).json({ error: 'Log stream not found' });
    }
    const logStream = await updateLogStreamConfig(req.params.logStreamId, parsed.data);
    res.json({ logStream });
  } catch (err) {
    next(err);
  }
});

logStreamsRouter.delete('/:workspaceId/log-streams/:logStreamId', requireWorkspaceRole('admin'), async (req, res, next) => {
  try {
    if ((await getLogStreamConfigWorkspaceId(req.params.logStreamId)) !== req.params.workspaceId) {
      return res.status(404).json({ error: 'Log stream not found' });
    }
    const ok = await deleteLogStreamConfig(req.params.logStreamId);
    if (!ok) return res.status(404).json({ error: 'Log stream not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
