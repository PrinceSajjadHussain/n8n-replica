import { Router } from 'express';
import IORedis from 'ioredis';
import { EventEmitter } from 'events';
import { pool } from '../db/pool';
import { createExecutionQueue, createRedisConnection } from '../queue/queue';
import type { ExecutionJobData } from '@flowforge/shared-types';
import { randomUUID } from 'crypto';

const redisConnection = createRedisConnection();
const executionQueue = createExecutionQueue(redisConnection);

export const webhookRouter = Router();

// Same Redis pub/sub channel the worker publishes execution status events
// to for the real-time canvas (see apps/worker/src/pubsub/publisher.ts and
// apps/api/src/realtime/socket.ts). Subscribed here too so this route can
// hold a webhook request open and answer it once the workflow (or a
// "Respond to Webhook" node inside it) produces a result — no polling, no
// second queue.
const STATUS_CHANNEL = 'flowforge:execution-status';
const statusEvents = new EventEmitter();
statusEvents.setMaxListeners(0);

const statusSubscriber = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
statusSubscriber.subscribe(STATUS_CHANNEL);
statusSubscriber.on('message', (_channel, message) => {
  try {
    const event = JSON.parse(message) as {
      executionId: string;
      nodeId?: string;
      status: string;
      output?: unknown;
      error?: string;
    };
    if (event.executionId) statusEvents.emit(event.executionId, event);
  } catch {
    // Ignore malformed pub/sub messages — never let this crash the webhook route.
  }
});

interface WebhookHttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: unknown;
}

const DEFAULT_WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_RESPONSE_TIMEOUT_MS ?? 30000);

/**
 * Waits for the execution to produce a response, per n8n's three webhook
 * response modes:
 *  - 'responseNode' — resolves as soon as a "Respond to Webhook" node fires
 *    anywhere in the run (the workflow keeps running after that in the
 *    background); falls back to the workflow's final leaf output if the
 *    workflow finishes without ever hitting one (e.g. it took a branch that
 *    skipped it).
 *  - 'lastNode'      — resolves once the whole execution finishes, using its
 *    leaf-node output as the response body.
 * Both give up after `timeoutMs` and respond 504 rather than hanging the
 * HTTP connection forever.
 */
function waitForWebhookResponse(
  executionId: string,
  mode: 'lastNode' | 'responseNode',
  timeoutMs: number
): Promise<WebhookHttpResponse> {
  return new Promise((resolve) => {
    const onEvent = (event: { nodeId?: string; status: string; output?: unknown; error?: string }) => {
      if (mode === 'responseNode' && event.status === 'webhook-response') {
        finish();
        const out = (event.output ?? {}) as { statusCode?: number; headers?: Record<string, string>; body?: unknown };
        resolve({ statusCode: out.statusCode ?? 200, headers: out.headers, body: out.body ?? {} });
        return;
      }
      // Top-level execution failure (no nodeId — distinct from a per-node
      // 'failed' event, which always carries one) or normal completion:
      // either ends the wait, in both modes.
      if (event.status === 'failed' && !event.nodeId) {
        finish();
        resolve({ statusCode: 500, body: { error: event.error ?? 'Workflow execution failed' } });
        return;
      }
      if (event.status === 'completed') {
        finish();
        resolve({
          statusCode: event.error ? 500 : 200,
          body: event.error ? { error: event.error } : event.output ?? {},
        });
      }
    };
    const timer = setTimeout(() => {
      finish();
      resolve({ statusCode: 504, body: { error: `Timed out after ${timeoutMs}ms waiting for the workflow to respond` } });
    }, timeoutMs);
    function finish() {
      clearTimeout(timer);
      statusEvents.removeListener(executionId, onEvent);
    }
    statusEvents.on(executionId, onEvent);
  });
}

/**
 * Public webhook endpoint — no auth required (this IS the trigger).
 * Any active workflow with a "webhook" node whose params.path matches
 * :path under this workflowId will be triggered.
 *
 * Response mode comes from the matching webhook node's params.responseMode
 * ('immediately' | 'lastNode' | 'responseNode'), defaulting to 'immediately'
 * to preserve existing behavior for workflows that don't set it:
 *  - 'immediately'  — ack the instant the job is enqueued (original/only
 *                      behavior before this endpoint supported modes).
 *  - 'lastNode'      — hold the connection open, respond with the workflow's
 *                      final output once execution finishes.
 *  - 'responseNode'  — hold the connection open for a "Respond to Webhook"
 *                      node (type: 'respondToWebhook') to answer explicitly.
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
  const webhookNode = nodes.find((n) => n.type === 'webhook' && (n.params?.path ?? 'default') === path);
  if (!webhookNode) {
    return res.status(404).json({ error: 'No webhook trigger matches this path' });
  }

  const responseMode = (webhookNode.params?.responseMode as string | undefined) ?? 'immediately';
  const executionId = randomUUID();
  const jobData: ExecutionJobData = {
    executionId,
    workflowId: workflow.id,
    userId: workflow.userId,
    triggerType: 'webhook',
    triggerPayload: { body: req.body, query: req.query, headers: req.headers },
  };

  if (responseMode !== 'lastNode' && responseMode !== 'responseNode') {
    const job = await executionQueue.add('execute', jobData);
    return res.status(202).json({ message: 'Webhook received, execution enqueued', jobId: job.id });
  }

  // Subscribe BEFORE enqueueing so a very fast worker can't finish (and
  // publish) before we start listening.
  const waiter = waitForWebhookResponse(executionId, responseMode, DEFAULT_WEBHOOK_TIMEOUT_MS);
  await executionQueue.add('execute', jobData);
  const response = await waiter;
  if (response.headers) {
    for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value);
  }
  res.status(response.statusCode).json(response.body);
});
