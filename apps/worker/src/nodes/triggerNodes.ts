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

registerNode(webhookNode);
registerNode(scheduleNode);
