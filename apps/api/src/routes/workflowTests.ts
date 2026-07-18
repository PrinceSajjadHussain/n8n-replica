import { Router, type Response, type NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { QueueEvents } from 'bullmq';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import {
  listWorkflowTestCases,
  getWorkflowTestCase,
  createWorkflowTestCase,
  updateWorkflowTestCase,
  deleteWorkflowTestCase,
} from '../db/workflowTests';
import { scoreOutput } from '../utils/testScoring';
import { createExecutionQueue, createRedisConnection, EXECUTION_QUEUE_NAME } from '../queue/queue';
import type { ExecutionJobData } from '@flowforge/shared-types';

const redisConnection = createRedisConnection();
const executionQueue = createExecutionQueue(redisConnection);
const queueEvents = new QueueEvents(EXECUTION_QUEUE_NAME, { connection: createRedisConnection() });

/**
 * Workflow-level test cases + the "Run tests" action (Phase 9).
 *
 * A test case is a saved { input, expectedOutput, scorer } triple. Running
 * it enqueues a real workflow execution (same queue/worker as a manual
 * run, `triggerType: 'test'` so it's distinguishable in Execution History)
 * with the case's `input` as the trigger payload, waits for it to finish,
 * then scores the workflow's final leaf output against `expectedOutput`
 * using the case's scorer (see utils/testScoring.ts — "similarity" is the
 * lightweight AI-evaluation-mode scorer for agent/openai/RAG workflows).
 */
export const workflowTestsRouter = Router();
workflowTestsRouter.use(requireAuth);

async function assertOwnership(workflowId: string, userId: string) {
  const result = await pool.query(`SELECT id FROM "Workflow" WHERE id = $1 AND "userId" = $2`, [workflowId, userId]);
  if (result.rows.length === 0) {
    const err = new Error('workflow not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
}

const testCaseSchema = z.object({
  name: z.string().min(1).max(120),
  input: z.unknown().optional().default({}),
  expectedOutput: z.unknown().optional().default({}),
  scorer: z.enum(['jsonDiff', 'exactString', 'contains', 'similarity']).default('jsonDiff'),
  passThreshold: z.number().min(0).max(1).default(0.7),
});

/** GET /workflows/:id/tests — list saved test cases. */
workflowTestsRouter.get('/:id/tests', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    await assertOwnership(req.params.id, req.userId!);
    res.json({ testCases: await listWorkflowTestCases(req.params.id) });
  } catch (err) {
    next(err);
  }
});

/** POST /workflows/:id/tests — save a new test case. */
workflowTestsRouter.post('/:id/tests', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    await assertOwnership(req.params.id, req.userId!);
    const parsed = testCaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const testCase = await createWorkflowTestCase(req.params.id, parsed.data);
    res.status(201).json({ testCase });
  } catch (err) {
    next(err);
  }
});

/** PATCH /workflows/:id/tests/:testId — edit a test case. */
workflowTestsRouter.patch('/:id/tests/:testId', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    await assertOwnership(req.params.id, req.userId!);
    const existing = await getWorkflowTestCase(req.params.testId);
    if (!existing || existing.workflowId !== req.params.id) return res.status(404).json({ error: 'Test case not found' });
    const parsed = testCaseSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const testCase = await updateWorkflowTestCase(req.params.testId, parsed.data);
    res.json({ testCase });
  } catch (err) {
    next(err);
  }
});

/** DELETE /workflows/:id/tests/:testId — remove a test case. */
workflowTestsRouter.delete('/:id/tests/:testId', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    await assertOwnership(req.params.id, req.userId!);
    const existing = await getWorkflowTestCase(req.params.testId);
    if (!existing || existing.workflowId !== req.params.id) return res.status(404).json({ error: 'Test case not found' });
    await deleteWorkflowTestCase(req.params.testId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const MAX_TEST_RUN_WAIT_MS = 60_000;

/**
 * POST /workflows/:id/tests/run — runs every saved test case (or just
 * `testCaseIds` if given) against the live workflow graph, scores each
 * result, and returns pass/fail + diff per case. Cases run sequentially
 * to keep worker load predictable; each becomes its own real Execution
 * row (triggerType 'test') visible in Execution History for debugging a
 * failing case.
 */
const runSchema = z.object({ testCaseIds: z.array(z.string()).optional() });

workflowTestsRouter.post('/:id/tests/run', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const workflowId = req.params.id;
    await assertOwnership(workflowId, req.userId!);
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let cases = await listWorkflowTestCases(workflowId);
    if (parsed.data.testCaseIds?.length) {
      const wanted = new Set(parsed.data.testCaseIds);
      cases = cases.filter((c) => wanted.has(c.id));
    }
    if (cases.length === 0) return res.json({ results: [] });

    const results = [];
    for (const testCase of cases) {
      const executionId = randomUUID();
      const jobData: ExecutionJobData = {
        executionId,
        workflowId,
        userId: req.userId!,
        triggerType: 'test',
        triggerPayload: testCase.input,
      };
      try {
        const job = await executionQueue.add('execute', jobData);
        const jobResult = (await job.waitUntilFinished(queueEvents, MAX_TEST_RUN_WAIT_MS)) as {
          status: 'success' | 'failed' | 'paused';
          output?: unknown;
        };

        if (jobResult.status !== 'success') {
          results.push({
            testCaseId: testCase.id,
            name: testCase.name,
            executionId,
            pass: false,
            message: `Workflow execution ${jobResult.status === 'paused' ? 'paused (needs a human step) — cannot score' : 'failed'} before producing output.`,
            actualOutput: null,
          });
          continue;
        }

        const score = scoreOutput(testCase.scorer, jobResult.output, testCase.expectedOutput, testCase.passThreshold);
        results.push({
          testCaseId: testCase.id,
          name: testCase.name,
          executionId,
          pass: score.pass,
          score: score.score,
          message: score.message,
          diff: score.diff,
          actualOutput: jobResult.output,
        });
      } catch (err) {
        results.push({
          testCaseId: testCase.id,
          name: testCase.name,
          executionId,
          pass: false,
          message: `Run failed: ${(err as Error).message}`,
          actualOutput: null,
        });
      }
    }

    res.json({ results });
  } catch (err) {
    next(err);
  }
});
