import { Router } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { createExecutionQueue, createRedisConnection, EXECUTION_QUEUE_NAME } from '../queue/queue';
import { QueueEvents } from 'bullmq';
import type { RetryJobData } from '@flowforge/shared-types';

const redisConnection = createRedisConnection();
const executionQueue = createExecutionQueue(redisConnection);
const queueEvents = new QueueEvents(EXECUTION_QUEUE_NAME, { connection: createRedisConnection() });

// Same Redis pub/sub channel the worker publishes execution-status events to
// (see apps/worker/src/pubsub/publisher.ts) — reused here so a cancel is
// reflected on the canvas immediately instead of waiting for the worker's
// once-per-level cancellation poll to notice the DB row changed.
const STATUS_CHANNEL = 'flowforge:execution-status';
const statusPublisher = createRedisConnection();

export const executionsRouter = Router();
executionsRouter.use(requireAuth);

executionsRouter.get('/:id', async (req: AuthedRequest, res) => {
  // Join through Workflow to enforce ownership.
  const execResult = await pool.query(
    `SELECT e.* FROM "Execution" e
     JOIN "Workflow" w ON w.id = e."workflowId"
     WHERE e.id = $1 AND w."userId" = $2`,
    [req.params.id, req.userId!]
  );
  const execution = execResult.rows[0];
  if (!execution) return res.status(404).json({ error: 'Execution not found' });

  const nodeRuns = await pool.query(
    `SELECT * FROM "ExecutionNodeRun" WHERE "executionId" = $1 ORDER BY "startedAt" NULLS LAST`,
    [execution.id]
  );

  res.json({ execution, nodeRuns: nodeRuns.rows });
});

/**
 * POST /executions/:id/cancel — "cancel-from-canvas". Only valid while the
 * execution is still running or paused (waitForWebhook/humanApproval).
 * Flips the Execution row to 'cancelled' directly (rather than trying to
 * kill the BullMQ job in-flight) and publishes to the same status channel
 * the worker uses, so connected canvases update immediately; the worker's
 * own level-by-level poll (see runLevels in engine/executor.ts) picks up
 * the change on its own even if this publish is somehow missed, so a
 * cancel always eventually takes effect even under a dropped pub/sub message.
 */
executionsRouter.post('/:id/cancel', async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `SELECT e.id, e.status, e."workflowId" FROM "Execution" e
     JOIN "Workflow" w ON w.id = e."workflowId"
     WHERE e.id = $1 AND w."userId" = $2`,
    [req.params.id, req.userId!]
  );
  const execution = result.rows[0];
  if (!execution) return res.status(404).json({ error: 'Execution not found' });
  if (execution.status !== 'running' && execution.status !== 'paused') {
    return res.status(409).json({ error: `Execution is already ${execution.status}, nothing to cancel` });
  }

  await pool.query(
    `UPDATE "Execution" SET status = 'cancelled', "finishedAt" = now() WHERE id = $1`,
    [execution.id]
  );

  await statusPublisher
    .publish(
      STATUS_CHANNEL,
      JSON.stringify({ workflowId: execution.workflowId, executionId: execution.id, status: 'cancelled' })
    )
    .catch((err) => console.error('Failed to publish cancellation event', err));

  res.json({ id: execution.id, status: 'cancelled' });
});

/**
 * POST /executions/:id/retry-from/:nodeId — "execution replay". Re-runs
 * the workflow starting at :nodeId, reusing every other node's recorded
 * output from this past execution instead of re-executing it. Creates a
 * brand-new Execution row; returns its id immediately (fire-and-forget —
 * watch its progress the same way you'd watch any run, via the
 * live-execution Socket.IO stream or GET /executions/:id).
 */
executionsRouter.post('/:id/retry-from/:nodeId', async (req: AuthedRequest, res) => {
  const ownsResult = await pool.query(
    `SELECT e.id FROM "Execution" e JOIN "Workflow" w ON w.id = e."workflowId"
     WHERE e.id = $1 AND w."userId" = $2`,
    [req.params.id, req.userId!]
  );
  if (!ownsResult.rows[0]) return res.status(404).json({ error: 'Execution not found' });

  const jobData: RetryJobData = { originalExecutionId: req.params.id, retryNodeId: req.params.nodeId };
  try {
    const job = await executionQueue.add('retryFromNode', jobData);
    // Give it a moment to create the new Execution row synchronously so
    // the UI can jump straight to watching it; if it takes longer than
    // that, the caller can still find it via GET /workflows/:id/executions.
    const result = await job.waitUntilFinished(queueEvents, 60000);
    res.status(202).json(result);
  } catch (err) {
    res.status(502).json({ error: `Retry failed: ${(err as Error).message}` });
  }
});

/**
 * GET /workflows/:workflowId/stats — basic execution dashboard: success
 * rate, average runtime, and the most recent failures. Computed directly
 * from the Execution table (no separate metrics store needed).
 */
executionsRouter.get('/workflow/:workflowId/stats', async (req: AuthedRequest, res) => {
  const ownsResult = await pool.query(
    `SELECT id FROM "Workflow" WHERE id = $1 AND "userId" = $2`,
    [req.params.workflowId, req.userId!]
  );
  if (!ownsResult.rows[0]) return res.status(404).json({ error: 'Workflow not found' });

  const summary = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'success') AS succeeded,
       count(*) FILTER (WHERE status = 'failed') AS failed,
       count(*) FILTER (WHERE status = 'paused') AS paused,
       count(*) FILTER (WHERE status = 'running') AS running,
       count(*) AS total,
       avg(extract(epoch FROM ("finishedAt" - "startedAt"))) FILTER (WHERE "finishedAt" IS NOT NULL) AS avg_runtime_seconds
     FROM "Execution" WHERE "workflowId" = $1`,
    [req.params.workflowId]
  );

  const recentFailures = await pool.query(
    `SELECT e.id, e."startedAt", e."finishedAt",
            (SELECT string_agg(error, ' | ') FROM "ExecutionNodeRun" WHERE "executionId" = e.id AND status = 'failed') AS errors
     FROM "Execution" e
     WHERE e."workflowId" = $1 AND e.status = 'failed'
     ORDER BY e."startedAt" DESC
     LIMIT 10`,
    [req.params.workflowId]
  );

  const row = summary.rows[0];
  const total = Number(row.total);
  res.json({
    total,
    succeeded: Number(row.succeeded),
    failed: Number(row.failed),
    paused: Number(row.paused),
    running: Number(row.running),
    successRate: total > 0 ? Number(row.succeeded) / total : null,
    avgRuntimeSeconds: row.avg_runtime_seconds != null ? Number(row.avg_runtime_seconds) : null,
    recentFailures: recentFailures.rows,
  });
});
