import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Webhook trigger node — the node itself is a no-op at execution time;
 * the actual HTTP payload that started the run is passed in as `input`
 * (the engine seeds the trigger node's input with the webhook body).
 */
export const webhookNode: NodePlugin = {
  type: 'webhook',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

/**
 * Schedule trigger node — no-op at execution time; the engine seeds a
 * timestamp as input when a BullMQ repeatable job fires.
 */
export const scheduleNode: NodePlugin = {
  type: 'schedule',
  async execute({ input }) {
    return { output: input ?? { firedAt: new Date().toISOString() } };
  },
};

/**
 * Email trigger — no-op at execution time. The engine seeds `input` with
 * the parsed message ({ from, subject, body, attachments }) when the IMAP
 * poller (apps/api/src/utils/emailPoller.ts) detects a new matching message.
 */
export const emailTriggerNode: NodePlugin = {
  type: 'emailTrigger',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

/**
 * File-watcher trigger — no-op at execution time. The engine seeds `input`
 * with { event: 'add'|'change'|'unlink', path } when the chokidar watcher
 * (apps/api/src/utils/fileWatcher.ts) fires for the configured path/glob.
 */
export const fileWatcherNode: NodePlugin = {
  type: 'fileWatcher',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

/**
 * Database-change trigger — no-op at execution time. The engine seeds
 * `input` with the row payload when a Postgres LISTEN/NOTIFY channel
 * (apps/api/src/utils/dbChangeListener.ts) fires for the configured table.
 */
export const databaseChangeNode: NodePlugin = {
  type: 'databaseChange',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

/**
 * Stream trigger — no-op at execution time. Covers Kafka / RabbitMQ /
 * Redis Streams: the engine seeds `input` with the consumed message when
 * the matching consumer (apps/api/src/utils/streamConsumer.ts) reads a new
 * record from the configured topic/queue/stream.
 */
export const streamTriggerNode: NodePlugin = {
  type: 'streamTrigger',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

/**
 * Chat trigger — no-op at execution time, same pattern as `webhook`. The
 * engine seeds `input` with `{ sessionId, message, attachments }` when a
 * request hits `POST /chat/:workflowId/:path` (apps/api/src/routes/chat.ts).
 * That route holds the HTTP connection open and always waits for the run to
 * finish (chat needs a reply), returning the workflow's final output — or a
 * "Respond to Webhook" node's payload if one is used to shape the reply —
 * as `{ reply }`.
 *
 * This is the standard way to wire a PDF-RAG chatbot: chatTrigger ->
 * ragQuery (namespace matching a prior ragIngest run, answerWithModel:
 * true) -> the query's `answer`/`citations` become the reply. Add an
 * `agentMemory` node beforehand (action: "read", sessionId: {{input.sessionId}})
 * to give the same conversation short-term recall across turns.
 */
export const chatTriggerNode: NodePlugin = {
  type: 'chatTrigger',
  async execute({ input }) {
    return { output: input ?? { sessionId: null, message: '', attachments: [] } };
  },
};

registerNode(webhookNode);
registerNode(scheduleNode);
registerNode(emailTriggerNode);
registerNode(fileWatcherNode);
registerNode(databaseChangeNode);
registerNode(streamTriggerNode);
registerNode(chatTriggerNode);
