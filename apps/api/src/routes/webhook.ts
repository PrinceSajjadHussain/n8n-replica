import { Router } from 'express';
import { pool } from '../db/pool';
import { createExecutionQueue, createRedisConnection } from '../queue/queue';
import type { ExecutionJobData } from '@flowforge/shared-types';
import { randomUUID } from 'crypto';

const redisConnection = createRedisConnection();
const executionQueue = createExecutionQueue(redisConnection);

export const webhookRouter = Router();

/**
 * Public webhook endpoint — no auth required (this IS the trigger).
 * Any active workflow with a "webhook" node whose params.path matches
 * :path under this workflowId will be triggered.
 */
webhookRouter.post('/:workflowId/:path', async (req, res) => {
  const { workflowId, path } = req.params;

  const wfResult = await pool.query(
    `SELECT id, "userId", "isActive", "nodesJson" FROM "Workflow" WHERE id = $1`,
    [workflowId]
  );
  const workflow = wfResult.rows[0];
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  if (!workflow.isActive) {
    return res.status(403).json({ error: 'Workflow is not active' });
  }

  const nodes = workflow.nodesJson as Array<{ type: string; params?: Record<string, unknown> }>;
  const hasMatchingWebhookNode = nodes.some(
    (n) => n.type === 'webhook' && (n.params?.path ?? 'default') === path
  );
  if (!hasMatchingWebhookNode) {
    return res.status(404).json({ error: 'No webhook trigger matches this path' });
  }

  const jobData: ExecutionJobData = {
    executionId: randomUUID(),
    workflowId: workflow.id,
    userId: workflow.userId,
    triggerType: 'webhook',
    triggerPayload: { body: req.body, query: req.query, headers: req.headers },
  };
  const job = await executionQueue.add('execute', jobData);

  res.status(202).json({ message: 'Webhook received, execution enqueued', jobId: job.id });
});
