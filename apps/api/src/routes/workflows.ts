import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import {
  createWorkflow,
  listWorkflows,
  getWorkflowById,
  updateWorkflow,
  deleteWorkflow,
  listWorkflowShares,
  shareWorkflow,
  unshareWorkflow,
  transferWorkflowOwnership,
} from '../db/workflows';
import { pool } from '../db/pool';
import { createExecutionQueue, createRedisConnection } from '../queue/queue';
import { registerScheduleForWorkflow, unregisterScheduleForWorkflow } from '../utils/scheduler';
import type { ExecutionJobData } from '@flowforge/shared-types';
import { randomUUID } from 'crypto';
import { requireWorkflowRole } from '../middleware/permissions';
import { logActivity } from '../db/activity';
import { listWorkspacesForUser } from '../db/workspaces';
import { listWorkflowIdsForTag } from '../db/tags';
import { findUserPublicByEmail } from '../db/users';

const redisConnection = createRedisConnection();
const executionQueue = createExecutionQueue(redisConnection);

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  params: z.record(z.unknown()).optional(),
  credentialId: z.string().nullable().optional(),
  retry: z.object({ maxAttempts: z.number().min(1).max(10), delayMs: z.number().min(0).max(60000) }).nullable().optional(),
  continueOnFail: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  pinnedOutput: z.unknown().optional(),
  // Per-node freeform note (n8n-style), display-only metadata like `style`/
  // `parentId` below — never read by resolveExpressions() or the worker's
  // executor, which only ever look at `params`. Kept loose/optional so it
  // round-trips through save/reload without affecting execution.
  notes: z.string().nullable().optional(),
  // Canvas-only annotation fields — only meaningful for type: 'stickyNote' /
  // 'group' (see NON_EXECUTABLE_NODE_TYPES in the worker's executor, which
  // strips these node types out of the execution graph entirely). Kept
  // optional/loose here since they don't apply to real workflow nodes.
  style: z.object({ width: z.number().optional(), height: z.number().optional() }).nullable().optional(),
  parentId: z.string().nullable().optional(),
  extent: z.literal('parent').nullable().optional(),
});
const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
});
const workflowCreateSchema = z.object({
  name: z.string().min(1),
  nodes: z.array(nodeSchema).default([]),
  edges: z.array(edgeSchema).default([]),
  workspaceId: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
});
const workflowUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
  folderId: z.string().nullable().optional(),
  errorWorkflowId: z.string().nullable().optional(),
});

/** GET /workflows?workspaceId=... — all workflows the user can see, optionally scoped to one workspace. */
workflowsRouter.get('/', async (req: AuthedRequest, res) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  let workflows = await listWorkflows(req.userId!, workspaceId);
  if (typeof req.query.tag === 'string') {
    const workflowIds = new Set(await listWorkflowIdsForTag(req.query.tag));
    workflows = workflows.filter((w) => workflowIds.has(w.id));
  }
  res.json({ workflows });
});

workflowsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = workflowCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { name, nodes, edges, folderId } = parsed.data;
    let { workspaceId } = parsed.data;

    // Default to the caller's personal (first/owned) workspace if none given.
    if (!workspaceId) {
      const workspaces = await listWorkspacesForUser(req.userId!);
      workspaceId = workspaces.find((w) => w.ownerId === req.userId)?.id ?? workspaces[0]?.id ?? null;
    }

    const workflow = await createWorkflow(req.userId!, name, nodes, edges, workspaceId, folderId);
    await logActivity({
      workspaceId: workflow.workspaceId,
      workflowId: workflow.id,
      userId: req.userId,
      action: 'workflow.created',
      metadata: { name },
    });
    res.status(201).json({ workflow });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.get('/:id', async (req: AuthedRequest, res) => {
  const workflow = await getWorkflowById(req.params.id, req.userId!);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  res.json({ workflow });
});

workflowsRouter.put('/:id', requireWorkflowRole('editor'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = workflowUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { name, nodes, edges, folderId, errorWorkflowId } = parsed.data;
    const workflow = await updateWorkflow(req.params.id, req.userId!, {
      name,
      nodesJson: nodes,
      edgesJson: edges,
      folderId,
      errorWorkflowId,
    });
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    await logActivity({
      workspaceId: workflow.workspaceId,
      workflowId: workflow.id,
      userId: req.userId,
      action: 'workflow.updated',
      metadata: { name },
    });
    res.json({ workflow });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.delete('/:id', requireWorkflowRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const workflow = await getWorkflowById(req.params.id, req.userId!);
    const deleted = await deleteWorkflow(req.params.id, req.userId!);
    if (!deleted) return res.status(404).json({ error: 'Workflow not found' });
    await logActivity({
      workspaceId: workflow?.workspaceId ?? null,
      userId: req.userId,
      action: 'workflow.deleted',
      metadata: { name: workflow?.name },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

workflowsRouter.post('/:id/activate', requireWorkflowRole('editor'), async (req: AuthedRequest, res, next) => {
 try {
  const activeSchema = z.object({ isActive: z.boolean().default(true) });
  const parsed = activeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const workflow = await updateWorkflow(req.params.id, req.userId!, {
    isActive: parsed.data.isActive,
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  await logActivity({
    workspaceId: workflow.workspaceId,
    workflowId: workflow.id,
    userId: req.userId,
    action: parsed.data.isActive ? 'workflow.activated' : 'workflow.deactivated',
  });

  const nodes = workflow.nodesJson as Array<{ type: string; params?: Record<string, unknown> }>;
  const scheduleNode = nodes.find((n) => n.type === 'schedule');

  if (parsed.data.isActive && scheduleNode?.params?.cron) {
    await registerScheduleForWorkflow(
      workflow.id,
      req.userId!,
      String(scheduleNode.params.cron)
    );
  } else {
    await unregisterScheduleForWorkflow(workflow.id);
  }

  res.json({ workflow });
 } catch (err) {
  next(err);
 }
});

/**
 * GET/PUT /:id/test-payload — the manual trigger's persisted test input,
 * mirroring n8n's canvas "test workflow" panel: the last JSON body used to
 * manually run this workflow, saved per-workflow so it survives reopening
 * the editor.
 */
workflowsRouter.get('/:id/test-payload', async (req: AuthedRequest, res) => {
  const workflow = await getWorkflowById(req.params.id, req.userId!);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  res.json({ testPayload: workflow.lastManualTestPayload ?? {} });
});

workflowsRouter.put('/:id/test-payload', requireWorkflowRole('editor'), async (req: AuthedRequest, res, next) => {
  try {
    const workflow = await updateWorkflow(req.params.id, req.userId!, {
      lastManualTestPayload: req.body ?? {},
    });
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    res.json({ testPayload: workflow.lastManualTestPayload ?? {} });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.post('/:id/execute', async (req: AuthedRequest, res) => {
  const workflow = await getWorkflowById(req.params.id, req.userId!);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  // Manual runs with no explicit body fall back to (and re-persist) the
  // workflow's last saved manual test payload, matching n8n's canvas
  // behavior of remembering the last "test workflow" input.
  const hasExplicitBody = req.body != null && typeof req.body === 'object' && Object.keys(req.body).length > 0;
  const triggerPayload = hasExplicitBody ? req.body : workflow.lastManualTestPayload ?? {};
  if (hasExplicitBody) {
    await updateWorkflow(req.params.id, req.userId!, { lastManualTestPayload: triggerPayload });
  }

  const jobData: ExecutionJobData = {
    executionId: randomUUID(), // the worker now uses this as the Execution row's id directly (see executeWorkflow's presetExecutionId param)
    workflowId: workflow.id,
    userId: req.userId!,
    triggerType: 'manual',
    triggerPayload,
  };
  const job = await executionQueue.add('execute', jobData);

  res.status(202).json({ message: 'Execution enqueued', jobId: job.id });
});

workflowsRouter.get('/:id/executions', async (req: AuthedRequest, res) => {
  const workflow = await getWorkflowById(req.params.id, req.userId!);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  const result = await pool.query(
    `SELECT * FROM "Execution" WHERE "workflowId" = $1 ORDER BY "startedAt" DESC`,
    [workflow.id]
  );
  res.json({ executions: result.rows });
});

// ---------------------------------------------------------------------------
// Workflow-level sharing / ownership transfer (independent of workspace
// membership — e.g. sharing one workflow with someone outside the
// workspace, or with a narrower role than their workspace role gives them).
// ---------------------------------------------------------------------------

workflowsRouter.get('/:id/shares', requireWorkflowRole('admin'), async (req: AuthedRequest, res) => {
  res.json({ shares: await listWorkflowShares(req.params.id) });
});

const workflowShareSchema = z.object({
  email: z.string().email(),
  role: z.enum(['viewer', 'editor', 'admin']).default('viewer'),
});

workflowsRouter.post('/:id/shares', requireWorkflowRole('admin'), async (req: AuthedRequest, res) => {
  const parsed = workflowShareSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const targetUser = await findUserPublicByEmail(parsed.data.email);
  if (!targetUser) return res.status(404).json({ error: 'No user found with that email.' });
  if (targetUser.id === req.userId) return res.status(400).json({ error: 'You already have access to this workflow.' });

  const share = await shareWorkflow(req.params.id, targetUser.id, parsed.data.role);
  await logActivity({
    workflowId: req.params.id,
    userId: req.userId,
    action: 'workflow.shared',
    metadata: { withEmail: parsed.data.email, role: parsed.data.role },
  });
  res.status(201).json({ share });
});

workflowsRouter.delete('/:id/shares/:userId', requireWorkflowRole('admin'), async (req: AuthedRequest, res) => {
  const ok = await unshareWorkflow(req.params.id, req.params.userId);
  if (!ok) return res.status(404).json({ error: 'Share not found' });
  res.status(204).send();
});

const transferOwnershipSchema = z.object({ email: z.string().email() });

workflowsRouter.post('/:id/transfer-ownership', requireWorkflowRole('owner'), async (req: AuthedRequest, res) => {
  const parsed = transferOwnershipSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const targetUser = await findUserPublicByEmail(parsed.data.email);
  if (!targetUser) return res.status(404).json({ error: 'No user found with that email.' });
  if (targetUser.id === req.userId) return res.status(400).json({ error: 'You already own this workflow.' });

  const workflow = await transferWorkflowOwnership(req.params.id, req.userId!, targetUser.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found, or you are not its owner.' });

  await logActivity({
    workflowId: req.params.id,
    userId: req.userId,
    action: 'workflow.ownership_transferred',
    metadata: { toEmail: parsed.data.email },
  });
  res.json({ workflow });
});
