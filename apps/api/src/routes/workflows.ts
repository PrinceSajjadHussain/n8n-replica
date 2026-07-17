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
} from '../db/workflows';
import { pool } from '../db/pool';
import { createExecutionQueue, createRedisConnection } from '../queue/queue';
import { registerScheduleForWorkflow, unregisterScheduleForWorkflow } from '../utils/scheduler';
import type { ExecutionJobData } from '@flowforge/shared-types';
import { randomUUID } from 'crypto';

const redisConnection = createRedisConnection();
const executionQueue = createExecutionQueue(redisConnection);

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  params: z.record(z.unknown()).optional(),
  credentialId: z.string().nullable().optional(),
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
});
const workflowUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
});

workflowsRouter.get('/', async (req: AuthedRequest, res) => {
  const workflows = await listWorkflows(req.userId!);
  res.json({ workflows });
});

workflowsRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = workflowCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, nodes, edges } = parsed.data;
  const workflow = await createWorkflow(req.userId!, name, nodes, edges);
  res.status(201).json({ workflow });
});

workflowsRouter.get('/:id', async (req: AuthedRequest, res) => {
  const workflow = await getWorkflowById(req.params.id, req.userId!);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  res.json({ workflow });
});

workflowsRouter.put('/:id', async (req: AuthedRequest, res) => {
  const parsed = workflowUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, nodes, edges } = parsed.data;
  const workflow = await updateWorkflow(req.params.id, req.userId!, {
    name,
    nodesJson: nodes,
    edgesJson: edges,
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  res.json({ workflow });
});

workflowsRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const deleted = await deleteWorkflow(req.params.id, req.userId!);
  if (!deleted) return res.status(404).json({ error: 'Workflow not found' });
  res.status(204).send();
});

workflowsRouter.post('/:id/activate', async (req: AuthedRequest, res) => {
  const activeSchema = z.object({ isActive: z.boolean().default(true) });
  const parsed = activeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const workflow = await updateWorkflow(req.params.id, req.userId!, {
    isActive: parsed.data.isActive,
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

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
});

workflowsRouter.post('/:id/execute', async (req: AuthedRequest, res) => {
  const workflow = await getWorkflowById(req.params.id, req.userId!);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  const jobData: ExecutionJobData = {
    executionId: randomUUID(), // placeholder; the worker creates the authoritative row
    workflowId: workflow.id,
    userId: req.userId!,
    triggerType: 'manual',
    triggerPayload: req.body ?? {},
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
