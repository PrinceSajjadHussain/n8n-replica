import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Limit — caps the number of items passed downstream.
 *
 * params:
 *   { maxItems: number, keep?: 'first' | 'last' }
 */
export const limitNode: NodePlugin = {
  type: 'limit',
  async execute({ items, params }) {
    const maxItems = Math.max(0, Number(params.maxItems ?? 1));
    const keep = params.keep === 'last' ? 'last' : 'first';

    const limited = keep === 'last' ? items.slice(Math.max(0, items.length - maxItems)) : items.slice(0, maxItems);

    return { items: limited };
  },
};

registerNode(limitNode);
