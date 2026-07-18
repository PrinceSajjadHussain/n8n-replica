import { Router } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { createExecutionQueue, createRedisConnection } from '../queue/queue';
import type { ResumeJobData } from '@flowforge/shared-types';

const redisConnection = createRedisConnection();
const executionQueue = createExecutionQueue(redisConnection);

async function enqueueResume(executionId: string, resumeInput: unknown) {
  const jobData: ResumeJobData = { executionId, resumeInput };
  await executionQueue.add('resume', jobData);
}

/**
 * Authenticated resume/approve/reject — for use from the FlowForge UI
 * (execution history view, or a "pending approvals" inbox).
 */
export const resumeRouter = Router();
resumeRouter.use(requireAuth);

async function assertOwnsExecution(executionId: string, userId: string) {
  const result = await pool.query(
    `SELECT e.id FROM "Execution" e
     JOIN "Workflow" w ON w.id = e."workflowId"
     WHERE e.id = $1 AND w."userId" = $2 AND e.status = 'paused'`,
    [executionId, userId]
  );
  return Boolean(result.rows[0]);
}

/** POST /executions/:id/resume  body: any JSON — becomes the paused node's output */
resumeRouter.post('/:id/resume', async (req: AuthedRequest, res) => {
  const ok = await assertOwnsExecution(req.params.id, req.userId!);
  if (!ok) return res.status(404).json({ error: 'Paused execution not found' });
  await enqueueResume(req.params.id, req.body ?? {});
  res.status(202).json({ message: 'Resume enqueued' });
});

/** POST /executions/:id/approve  body: { comment?: string } */
resumeRouter.post('/:id/approve', async (req: AuthedRequest, res) => {
  const ok = await assertOwnsExecution(req.params.id, req.userId!);
  if (!ok) return res.status(404).json({ error: 'Paused execution not found' });
  await enqueueResume(req.params.id, { approved: true, comment: req.body?.comment, approvedBy: req.userId, approvedAt: new Date().toISOString() });
  res.status(202).json({ message: 'Approved — execution resuming' });
});

/** POST /executions/:id/reject  body: { comment?: string } */
resumeRouter.post('/:id/reject', async (req: AuthedRequest, res) => {
  const ok = await assertOwnsExecution(req.params.id, req.userId!);
  if (!ok) return res.status(404).json({ error: 'Paused execution not found' });
  await enqueueResume(req.params.id, { approved: false, comment: req.body?.comment, rejectedBy: req.userId, rejectedAt: new Date().toISOString() });
  res.status(202).json({ message: 'Rejected — execution resuming down the false branch' });
});

/** GET /executions/pending/approvals — list this user's paused executions across all workflows */
resumeRouter.get('/pending/approvals', async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `SELECT e.id, e."workflowId", e."resumeNodeId", e."pausedAt", w.name as "workflowName"
     FROM "Execution" e
     JOIN "Workflow" w ON w.id = e."workflowId"
     WHERE w."userId" = $1 AND e.status = 'paused'
     ORDER BY e."pausedAt" DESC`,
    [req.userId!]
  );
  res.json({ pending: result.rows });
});

/**
 * Public "Wait for Webhook" resume endpoint — no auth, gated by the
 * unguessable resumeToken the paused node emitted (visible in the
 * execution's live status stream / node output). Mirrors the pattern of
 * the trigger webhook route: the token IS the credential.
 */
export const publicResumeRouter = Router();
publicResumeRouter.post('/:token', async (req, res) => {
  const result = await pool.query(
    `SELECT id FROM "Execution" WHERE "resumeToken" = $1 AND status = 'paused'`,
    [req.params.token]
  );
  const execution = result.rows[0];
  if (!execution) return res.status(404).json({ error: 'No paused execution matches this resume token' });
  await enqueueResume(execution.id, { body: req.body, query: req.query, resumedVia: 'webhook', resumedAt: new Date().toISOString() });
  res.status(202).json({ message: 'Resume enqueued', executionId: execution.id });
});
