import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Simulate — fabricates output data (or a failure) without calling any
 * real system. Useful for building/testing downstream logic (e.g. an error
 * branch, or a node that expects a specific upstream shape) before the
 * real integration it stands in for is wired up. Same purpose as n8n's
 * Simulate node.
 *
 * params:
 *   { mode: 'data' | 'error' }
 *   { jsonData?: string } — mode "data": JSON text, either a single object
 *     (one output item) or an array (one item per element). Falls back to
 *     passing input through unchanged if left blank.
 *   { errorMessage?: string } — mode "error": throws this message
 *   { simulatedDelayMs?: number } — optional artificial latency, either mode
 */
export const simulateNode: NodePlugin = {
  type: 'simulate',
  async execute({ items, params }) {
    const delay = Number(params.simulatedDelayMs) || 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30000)));

    if (params.mode === 'error') {
      throw new Error(String(params.errorMessage || 'Simulated failure'));
    }

    const raw = params.jsonData ? String(params.jsonData).trim() : '';
    if (!raw) {
      // No fabricated data configured — pass items through unchanged.
      return { items };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Simulate: "Fabricated JSON data" is not valid JSON');
    }

    const values = Array.isArray(parsed) ? parsed : [parsed];
    const outItems = values.map((value, i) => ({
      json: (value && typeof value === 'object' ? value : { value }) as Record<string, unknown>,
      pairedItem: { item: Math.min(i, items.length - 1 >= 0 ? items.length - 1 : 0) },
    }));

    return { items: outItems };
  },
};

registerNode(simulateNode);
