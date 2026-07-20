import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Debug Helper — deliberately throws a specific, chosen error type so
 * downstream error-handling (per-node retry/continueOnFail, Error
 * Workflow) can be exercised on demand rather than waiting for a real
 * failure to happen. Distinct from Stop and Error: Stop and Error is a
 * workflow-authoring tool for custom validation failures with a
 * user-written message, Debug Helper is a test fixture for verifying the
 * *platform's* error handling reacts correctly to known failure shapes.
 * Same purpose as n8n's Debug Helper node.
 *
 * params:
 *   { errorType: 'generic' | 'timeout' | 'invalidJson' | 'largePayload' | 'none' }
 *   { message?: string } — override text for the 'generic' type
 */
export const debugHelperNode: NodePlugin = {
  type: 'debugHelper',
  async execute({ items, params }) {
    const errorType = String(params.errorType || 'generic');

    switch (errorType) {
      case 'none':
        return { items };
      case 'timeout': {
        // Simulate a hung call long enough to exercise a node-level timeout,
        // then still fail so the run doesn't silently hang forever.
        await new Promise((resolve) => setTimeout(resolve, 5000));
        throw new Error('Debug Helper: simulated timeout (request took too long)');
      }
      case 'invalidJson':
        throw new SyntaxError('Debug Helper: simulated invalid JSON response from upstream');
      case 'largePayload': {
        const big = { payload: 'x'.repeat(5_000_000) };
        return { items: [{ json: big, pairedItem: { item: 0 } }] };
      }
      case 'generic':
      default:
        throw new Error(String(params.message || 'Debug Helper: simulated generic failure'));
    }
  },
};

registerNode(debugHelperNode);
