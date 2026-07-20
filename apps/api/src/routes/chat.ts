import { Router } from 'express';
import { pool } from '../db/pool';
import { executionQueue, waitForWebhookResponse } from './webhook';
import type { ExecutionJobData } from '@flowforge/shared-types';
import { randomUUID } from 'crypto';
import { incrementUsage } from '../db/billing';

/**
 * Public chat endpoint — no auth required (this IS the trigger), same
 * shape/security posture as `webhook.ts`. Any active workflow with a
 * `chatTrigger` node whose `params.path` matches `:path` under this
 * `workflowId` will be triggered.
 *
 * Unlike a plain webhook, chat always waits for the run to finish (there's
 * no point sending a chat message if you don't get a reply): the response
 * body is `{ reply, executionId }` where `reply` is either whatever a
 * "Respond to Webhook" node inside the workflow produced, or — the common
 * case for a PDF-RAG chatbot — the workflow's final node output (typically
 * a `ragQuery` node's `{ answer, citations, matches }`).
 *
 * Request body: `{ sessionId?: string, message: string, attachments?: [{
 * fileName, mimeType, data (base64) }] }`. `sessionId` defaults to a fresh
 * UUID per request if omitted (so a caller who wants multi-turn memory
 * should generate one client-side and keep sending it) and is threaded
 * straight through to `agentMemory`/`agent` nodes downstream so a session's
 * conversation history and long-term vector recall stay scoped correctly.
 */
export const chatRouter = Router();

const DEFAULT_CHAT_TIMEOUT_MS = Number(process.env.CHAT_RESPONSE_TIMEOUT_MS ?? 60000);

/**
 * Test chat endpoint — n8n-style test/production split (see
 * `webhook.ts`'s `/test/:workflowId/:path`): runs against the workflow's
 * current DRAFT graph (`nodesJson`) and does NOT require `isActive`.
 * Lets someone iterate on a chat-triggered workflow from the canvas
 * before publishing. Otherwise identical to the production route below.
 */
chatRouter.post('/test/:workflowId/:path', async (req, res) => {
  const { workflowId, path } = req.params;
  const { sessionId, message, attachments } = req.body ?? {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Request body requires a non-empty "message" string.' });
  }

  const wfResult = await pool.query(
    `SELECT id, "userId", "workspaceId", "nodesJson" FROM "Workflow" WHERE id = $1`,
    [workflowId]
  );
  const workflow = wfResult.rows[0];
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  const nodes = workflow.nodesJson as Array<{ type: string; params?: Record<string, unknown> }>;
  const chatNode = nodes.find((n) => n.type === 'chatTrigger' && (n.params?.path ?? 'default') === path);
  if (!chatNode) return res.status(404).json({ error: 'No chat trigger matches this path in the current draft' });

  const resolvedSessionId = String(sessionId ?? randomUUID());
  const executionId = randomUUID();
  const jobData: ExecutionJobData = {
    executionId,
    workflowId: workflow.id,
    userId: workflow.userId,
    triggerType: 'chatTrigger',
    triggerPayload: {
      sessionId: resolvedSessionId,
      message,
      attachments: Array.isArray(attachments) ? attachments : [],
    },
  };

  const responseMode = (chatNode.params?.responseMode as string | undefined) === 'responseNode' ? 'responseNode' : 'lastNode';
  const waiter = waitForWebhookResponse(executionId, responseMode, DEFAULT_CHAT_TIMEOUT_MS);
  await executionQueue.add('execute', jobData);

  const response = await waiter;
  res.status(response.statusCode === 200 ? 200 : response.statusCode).json({
    reply: response.body,
    sessionId: resolvedSessionId,
    executionId,
  });
});

chatRouter.post('/:workflowId/:path', async (req, res) => {
  const { workflowId, path } = req.params;
  const { sessionId, message, attachments } = req.body ?? {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Request body requires a non-empty "message" string.' });
  }

  const wfResult = await pool.query(
    `SELECT id, "userId", "workspaceId", "isActive", "nodesJson" FROM "Workflow" WHERE id = $1`,
    [workflowId]
  );
  const workflow = wfResult.rows[0];
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  if (!workflow.isActive) return res.status(403).json({ error: 'Workflow is not active' });

  const nodes = workflow.nodesJson as Array<{ type: string; params?: Record<string, unknown> }>;
  const chatNode = nodes.find((n) => n.type === 'chatTrigger' && (n.params?.path ?? 'default') === path);
  if (!chatNode) return res.status(404).json({ error: 'No chat trigger matches this path' });

  const resolvedSessionId = String(sessionId ?? randomUUID());
  const executionId = randomUUID();
  const jobData: ExecutionJobData = {
    executionId,
    workflowId: workflow.id,
    userId: workflow.userId,
    triggerType: 'chatTrigger',
    triggerPayload: {
      sessionId: resolvedSessionId,
      message,
      attachments: Array.isArray(attachments) ? attachments : [],
    },
  };

  // Chat always holds the connection open, using the same 'lastNode' /
  // 'responseNode' semantics as webhook — 'lastNode' unless the workflow
  // author explicitly wired a "Respond to Webhook" node for custom shaping.
  const responseMode = (chatNode.params?.responseMode as string | undefined) === 'responseNode' ? 'responseNode' : 'lastNode';
  const waiter = waitForWebhookResponse(executionId, responseMode, DEFAULT_CHAT_TIMEOUT_MS);
  await executionQueue.add('execute', jobData);
  if (workflow.workspaceId) incrementUsage(workflow.workspaceId).catch(() => {});

  const response = await waiter;
  res.status(response.statusCode === 200 ? 200 : response.statusCode).json({
    reply: response.body,
    sessionId: resolvedSessionId,
    executionId,
  });
});
