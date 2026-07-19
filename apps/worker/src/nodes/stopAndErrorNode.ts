import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';

/**
 * Stop and Error — deliberately fails the workflow run with a custom
 * message, e.g. after a validation check the built-in operators can't
 * express cleanly. Throws, so it's picked up by the same per-node retry /
 * continueOnFail / Error Workflow machinery every other node failure goes
 * through — no special-casing needed in the executor.
 *
 * params:
 *   { message: string } — static text, or a field path via messageField
 *   { messageField?: string } — read the message from input.json instead
 */
export const stopAndErrorNode: NodePlugin = {
  type: 'stopAndError',
  async execute({ input, params }) {
    const messageField = params.messageField ? String(params.messageField) : '';
    const message = messageField
      ? String(getByPath(input, messageField) ?? 'Stop and Error: field not found')
      : String(params.message ?? 'Stop and Error: workflow stopped');

    throw new Error(message);
  },
};

registerNode(stopAndErrorNode);
