import { Router } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { createExecutionQueue, createRedisConnection } from '../queue/queue';

/**
 * Dead-letter queue visibility (Phase 4).
 *
 * Previously a permanently-failed BullMQ job (exhausted its retry attempts)
 * was invisible outside the Redis CLI — no API, no UI, so an operator had
 * no way to see "these N executions never even started" or replay them
 * without shelling into Redis directly. This surfaces BullMQ's own
 * failed-job list and lets an authenticated user manually retry one.
 *
 * Deliberately job-queue-level, not workflow-scoped: a job can fail before
 * `executeWorkflow` ever runs (e.g. Redis hiccup, worker crash mid-job), so
 * there may be no Execution row to hang this off of at all — the queue is
 * the actual source of truth for "did this job get processed."
 */
export const queueAdminRouter = Router();
queueAdminRouter.use(requireAuth);

const connection = createRedisConnection();
const queue = createExecutionQueue(connection);

/**
 * GET /queue/failed?limit=50 — most recent permanently-failed jobs (BullMQ
 * moves a job here once it's exhausted its configured attempts). Every
 * authenticated user can see the full list for now — this repo has no
 * separate "instance admin" role yet, so it's scoped the same as the rest
 * of the API (see the enterprise-hardening notes: a dedicated admin role
 * for instance-wide operational views is a natural next step).
 */
queueAdminRouter.get('/failed', async (req: AuthedRequest, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const jobs = await queue.getFailed(0, limit - 1);
    res.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        finishedOn: job.finishedOn,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /queue/failed/:jobId/retry — re-queues a permanently-failed job for
 * another attempt. Uses BullMQ's own `job.retry()`, which resets the job
 * back to `waiting` in place rather than creating a duplicate — so this is
 * safe to call more than once (a job that's no longer in the failed set
 * just 404s).
 */
queueAdminRouter.post('/failed/:jobId/retry', async (req: AuthedRequest, res, next) => {
  try {
    const job = await queue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const state = await job.getState();
    if (state !== 'failed') {
      return res.status(409).json({ error: `Job is currently "${state}", not "failed" — nothing to retry.` });
    }
    await job.retry();
    res.json({ retried: true, jobId: job.id });
  } catch (err) {
    next(err);
  }
});
