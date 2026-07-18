import { Router } from 'express';
import { randomUUID } from 'crypto';
import { QueueEvents } from 'bullmq';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { createExecutionQueue, createRedisConnection, EXECUTION_QUEUE_NAME } from '../queue/queue';
import type { TestNodeJobData } from '@flowforge/shared-types';

const redisConnection = createRedisConnection();
const executionQueue = createExecutionQueue(redisConnection);
const queueEvents = new QueueEvents(EXECUTION_QUEUE_NAME, { connection: createRedisConnection() });

export const nodeTestRouter = Router();
nodeTestRouter.use(requireAuth);

const testSchema = z.object({
  nodeType: z.string(),
  params: z.record(z.unknown()).default({}),
  input: z.unknown().optional(),
  credentialId: z.string().nullable().optional(),
});

/**
 * POST /nodes/test-run
 * Runs ONE node type in isolation — no workflow, no execution history row
 * — for the "Test node" button in the config panel. Useful for checking a
 * new node's params/credential before wiring it into a real workflow, or
 * for generating a value to Pin.
 *
 * Implementation note: the actual node plugins (and credential
 * decryption) live in the worker process, not here, so this enqueues a
 * `testNode` BullMQ job and waits (up to 25s) for the worker to finish it
 * — same queue as real executions, just a different job name.
 */
nodeTestRouter.post('/test-run', async (req: AuthedRequest, res) => {
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const jobData: TestNodeJobData = {
    requestId: randomUUID(),
    nodeType: parsed.data.nodeType,
    params: parsed.data.params,
    input: parsed.data.input ?? null,
    credentialId: parsed.data.credentialId ?? null,
  };

  try {
    const job = await executionQueue.add('testNode', jobData);
    const result = await job.waitUntilFinished(queueEvents, 25000);
    // Item-aware plugins return `{ items: [{ json, binary? }, ...] }` instead
    // of the legacy `{ output }` — surface both the collapsed json value
    // (for the familiar preview) and the raw items (so binary attachments
    // are visible too) to the "Test node" panel.
    if (result?.items) {
      const items = result.items as Array<{ json: unknown; binary?: unknown }>;
      const output = items.length === 1 ? items[0].json : items.map((i) => i.json);
      res.json({ output, items });
    } else {
      res.json({ output: result.output ?? result });
    }
  } catch (err) {
    res.status(502).json({ error: `Test run failed: ${(err as Error).message}` });
  }
});
