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

/**
 * RSS/Atom feed trigger — no-op at execution time. The engine seeds `input`
 * with `{ id, title, link, pubDate }` when the feed poller
 * (apps/api/src/utils/triggerPollers.ts registerRssTrigger) sees a new item
 * on the configured feed URL.
 */
export const rssTriggerNode: NodePlugin = {
  type: 'rssTrigger',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

/**
 * MQTT trigger — no-op at execution time. The engine seeds `input` with
 * `{ topic, value }` when the MQTT subscriber (triggerPollers.ts
 * registerMqttTrigger) receives a message on the configured topic.
 */
export const mqttTriggerNode: NodePlugin = {
  type: 'mqttTrigger',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

/**
 * Public form trigger — no-op at execution time, same pattern as
 * `webhook`/`chatTrigger`. The engine seeds `input` with the submitted
 * field values when a request hits `POST /form/:workflowId/:path`
 * (apps/api/src/routes/form.ts). `GET /form/:workflowId/:path` serves a
 * plain hosted HTML form built from this node's `fields` param, so no
 * separate frontend build is needed to collect the submission.
 *
 * Unlike n8n's Form node, this round doesn't support pausing mid-workflow
 * for a second form page — the trigger starts the run and the run doesn't
 * pause for more form input partway through. See README "Public form
 * trigger (this round)" for what a follow-up "Form" mid-workflow node
 * would need.
 */
export const formTriggerNode: NodePlugin = {
  type: 'formTrigger',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

/**
 * Execute-Workflow trigger — the typed callee-side entry point n8n calls
 * "When Executed by Another Workflow". Functionally a no-op like the other
 * triggers (any root node already receives the trigger payload — see
 * executor.ts's `processNode`), but this one additionally *declares and
 * validates* the shape of input it expects via `params.inputSchema`, so a
 * workflow meant to be called as a sub-workflow (via the `subWorkflow`
 * node on the caller's side) can fail fast with a clear error instead of
 * a confusing downstream `undefined`/type error when called wrong.
 *
 * params:
 *   inputSchema?: Array<{ name: string, type?: 'string'|'number'|'boolean'|'object'|'array', required?: boolean }>
 *
 * Validation is intentionally shallow (top-level field presence + typeof
 * check) — this isn't a full JSON-Schema engine, just enough to catch the
 * common "caller forgot a field" / "caller sent a string where a number
 * was expected" mistakes.
 */
interface InputSchemaField {
  name: string;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
}

function typeMatches(value: unknown, type: InputSchemaField['type']): boolean {
  if (!type) return true;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === type;
}

export const executeWorkflowTriggerNode: NodePlugin = {
  type: 'executeWorkflowTrigger',
  async execute({ input, params }) {
    const schema = (params.inputSchema as InputSchemaField[]) ?? [];
    if (schema.length > 0) {
      const payload = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      const errors: string[] = [];
      for (const field of schema) {
        const value = payload[field.name];
        const present = value !== undefined && value !== null;
        if (field.required && !present) {
          errors.push(`missing required field "${field.name}"`);
          continue;
        }
        if (present && !typeMatches(value, field.type)) {
          errors.push(`field "${field.name}" expected type "${field.type}" but got "${typeof value}"`);
        }
      }
      if (errors.length > 0) {
        throw new Error(`executeWorkflowTrigger: input validation failed — ${errors.join('; ')}`);
      }
    }
    return { output: input ?? {} };
  },
};

/**
 * Calendly trigger — dedicated webhook-family trigger, no-op at execution
 * time (same pattern as `webhook`/`chatTrigger`). Unlike the generic
 * `webhook` node, the route that seeds this node's input
 * (apps/api/src/routes/webhook.ts) verifies Calendly's
 * `Calendly-Webhook-Signature` HMAC header itself (using the node's
 * `signingSecret` param) and rejects bad/missing signatures with a 401
 * before a job is ever enqueued — so a workflow author no longer has to
 * hand-roll that check in a Code/If node. `input` is seeded with
 * Calendly's raw event payload (`{ event, payload: {...} }`), matching
 * what Calendly's webhook actually sends.
 */
export const calendlyTriggerNode: NodePlugin = {
  type: 'calendlyTrigger',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

/**
 * DocuSign Connect trigger — dedicated webhook-family trigger, no-op at
 * execution time. Same signature-verification treatment as
 * `calendlyTrigger`: the route verifies DocuSign Connect's HMAC
 * (`X-DocuSign-Signature-1`, base64 HMAC-SHA256) using the node's
 * `signingSecret` param before enqueueing. `input` is seeded with
 * DocuSign Connect's raw XML-derived/JSON envelope-status payload.
 */
export const docusignTriggerNode: NodePlugin = {
  type: 'docusignTrigger',
  async execute({ input }) {
    return { output: input ?? {} };
  },
};

registerNode(webhookNode);
registerNode(scheduleNode);
registerNode(emailTriggerNode);
registerNode(fileWatcherNode);
registerNode(databaseChangeNode);
registerNode(streamTriggerNode);
registerNode(chatTriggerNode);
registerNode(rssTriggerNode);
registerNode(mqttTriggerNode);
registerNode(formTriggerNode);
registerNode(executeWorkflowTriggerNode);
registerNode(calendlyTriggerNode);
registerNode(docusignTriggerNode);
