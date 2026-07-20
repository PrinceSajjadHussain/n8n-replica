import './loadEnv';
import { Worker } from 'bullmq';
import type { QueueJobData, ExecutionJobData, ResumeJobData, TestNodeJobData, RetryJobData } from '@flowforge/shared-types';
import { createRedisConnection, EXECUTION_QUEUE_NAME } from './queue';
import { getWorkflow, getPausedExecution, getDecryptedCredentialById, getExecutionForRetry } from './db/executions';
import { executeWorkflow, resumeExecution, retryFromNode } from './engine/executor';
import { NODE_REGISTRY } from './nodes';
import { normalizeToItems, decodeBinary, makeBinary } from './nodes/types';
import { publishStatus } from './pubsub/publisher';
import './nodes'; // registers all node plugins as a side effect
import { reloadCommunityNodes } from './nodes/communityLoader';
import { acquireSlot, releaseSlot } from './engine/concurrency';
import { DelayedError } from 'bullmq';
import { startRetentionSweeper } from './utils/retention';
import { pool } from './db/pool';

const connection = createRedisConnection();

// Listen for marketplace installs/uninstalls (published by apps/api/src/routes/marketplace.ts)
// and hot-reload community nodes without restarting this worker process.
const reloadSubscriber = createRedisConnection();
void reloadSubscriber.subscribe('flowforge:community-nodes:reload', () => {});
reloadSubscriber.on('message', (channel) => {
  if (channel !== 'flowforge:community-nodes:reload') return;
  const loaded = reloadCommunityNodes();
  console.log(`[community-nodes] reloaded ${loaded.length} package(s) after marketplace change`);
});

/** How long a job waits before retrying when it loses the concurrency-slot race. */
const CONCURRENCY_RETRY_DELAY_MS = Number(process.env.CONCURRENCY_RETRY_DELAY_MS ?? 3000);

const worker = new Worker<QueueJobData>(
  EXECUTION_QUEUE_NAME,
  async (job, token) => {
    if (job.name === 'testNode') {
      const { nodeType, params, input, credentialId } = job.data as TestNodeJobData;
      const plugin = NODE_REGISTRY[nodeType];
      if (!plugin) throw new Error(`No node plugin registered for type "${nodeType}"`);
      const credential = credentialId ? await getDecryptedCredentialById(credentialId) : null;
      const result = await plugin.execute({
        input,
        items: normalizeToItems(input),
        params,
        credential,
        getBinary: (item, key) => decodeBinary(item, key),
        toBinary: (buffer, mimeType, fileName) => makeBinary(buffer, mimeType, fileName),
        // Single-node "test" runs happen outside any real workflow execution,
        // so there's no workflow/workspace to scope Data Table lookups or
        // static data to. Safe no-op defaults — plugins that need real
        // static-data persistence should be run as part of a workflow.
        workflowId: '',
        workspaceId: null,
        staticData: {},
        setStaticData: async () => {},
      });
      return result;
    }

    if (job.name === 'retryFromNode') {
      const { originalExecutionId, retryNodeId } = job.data as RetryJobData;
      const original = await getExecutionForRetry(originalExecutionId);
      const workflowId = original?.workflowId ?? '';
      const result = await retryFromNode(originalExecutionId, retryNodeId, (event) => {
        publishStatus({ workflowId, ...event }).catch((err) =>
          console.error('Failed to publish status event', err)
        );
      });
      return result;
    }

    if (job.name === 'resume') {
      const { executionId, resumeInput } = job.data as ResumeJobData;
      const paused = await getPausedExecution(executionId);
      const workflowId = paused?.workflowId ?? '';
      const result = await resumeExecution(executionId, resumeInput, (event) => {
        publishStatus({ workflowId, ...event }).catch((err) =>
          console.error('Failed to publish status event', err)
        );
      });
      return result;
    }

    const { workflowId, triggerType, triggerPayload, executionId } = job.data as ExecutionJobData;
    const workflow = await getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // Per-workflow concurrency gate (Workflow.maxConcurrency, null =
    // unlimited). If this workflow is already at its limit, don't run —
    // reschedule this same job a few seconds out via BullMQ's manual
    // rate-limiting mechanism (moveToDelayed + DelayedError) rather than
    // failing it or busy-polling. The job keeps its original attempt count
    // and retry history untouched; this is a deferral, not a failure.
    const maxConcurrency = (workflow as { maxConcurrency?: number | null }).maxConcurrency ?? null;
    const gotSlot = await acquireSlot(workflowId, maxConcurrency);
    if (!gotSlot) {
      await job.moveToDelayed(Date.now() + CONCURRENCY_RETRY_DELAY_MS, token);
      throw new DelayedError();
    }

    const graph = {
      nodes: workflow.nodesJson as never,
      edges: workflow.edgesJson as never,
    };

    try {
      const result = await executeWorkflow(
        workflowId,
        graph,
        triggerType,
        triggerPayload,
        (event) => {
          publishStatus({ workflowId, ...event }).catch((err) =>
            console.error('Failed to publish status event', err)
          );
        },
        0,
        executionId
      );

      return result;
    } finally {
      await releaseSlot(workflowId, maxConcurrency).catch((err) =>
        console.error('Failed to release concurrency slot', err)
      );
    }
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
    autorun: false, // held off until waitForDependencies() confirms DB/Redis are reachable
  }
);

worker.on('completed', (job, result) => {
  console.log(`[worker] job ${job.id} completed:`, result);
});

worker.on('failed', (job, err) => {
  // A job-level failure here means an infrastructure error (e.g. workflow
  // not found), NOT a node-level failure — those are caught inside
  // executeWorkflow and recorded as 'failed' node runs without throwing.
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

// Periodically prunes old Execution/ExecutionNodeRun rows per
// EXECUTION_RETENTION_DAYS (unset/0 = retention disabled, keep everything —
// see apps/worker/src/utils/retention.ts for the query and scheduling).
// Started only after the health check below confirms Postgres is reachable.

/**
 * Confirms Postgres and Redis are actually reachable before the worker
 * starts pulling jobs off the queue. Without this, a misconfigured
 * DATABASE_URL/REDIS_URL (e.g. env not loaded — see ./loadEnv) surfaces
 * only when the first job fails deep inside a query, with a cryptic
 * driver-level error (e.g. pg's SASL "password must be a string")
 * instead of a clear, early, actionable message.
 */
async function waitForDependencies(maxAttempts = 10, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let dbOk = false;
    let redisOk = false;
    try {
      await pool.query('SELECT 1');
      dbOk = true;
    } catch (err) {
      console.error(
        `[worker] Postgres health check failed (attempt ${attempt}/${maxAttempts}): ${(err as Error).message}` +
          (process.env.DATABASE_URL ? '' : ' — DATABASE_URL is not set at all, check your .env loading.')
      );
    }
    try {
      const pong = await connection.ping();
      redisOk = pong === 'PONG';
    } catch (err) {
      console.error(`[worker] Redis health check failed (attempt ${attempt}/${maxAttempts}): ${(err as Error).message}`);
    }
    if (dbOk && redisOk) {
      console.log('[worker] Postgres + Redis health checks passed.');
      return;
    }
    if (attempt < maxAttempts) {
      console.log(`[worker] Retrying health checks in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(
    'FlowForge worker could not reach Postgres and/or Redis after multiple attempts — refusing to start job processing. Check DATABASE_URL/REDIS_URL and that both services are running.'
  );
}

waitForDependencies()
  .then(() => {
    worker.run().catch((err) => console.error('[worker] Worker run loop crashed:', err));
    startRetentionSweeper();
    console.log('FlowForge worker started, waiting for jobs...');
  })
  .catch((err) => {
    console.error('[worker] Fatal startup error:', err.message);
    process.exit(1);
  });
