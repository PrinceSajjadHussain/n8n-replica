import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';

/**
 * Sort — reorders items by one field's value.
 *
 * params:
 *   { field: string, order?: 'asc' | 'desc' }
 *
 * Comparison: numbers compare numerically, everything else falls back to
 * string comparison (`localeCompare`) — matches the common case n8n/Make
 * cover without needing a type picker. Stable sort (JS Array.prototype.sort
 * is guaranteed stable since ES2019), so equal-key items keep their
 * relative input order.
 */
export const sortNode: NodePlugin = {
  type: 'sort',
  async execute({ items, params }) {
    const field = String(params.field ?? '');
    const order = params.order === 'desc' ? -1 : 1;

    const sorted = [...items].sort((a, b) => {
      const av = field ? getByPath(a.json, field) : a.json;
      const bv = field ? getByPath(b.json, field) : b.json;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * order;
      }
      return String(av).localeCompare(String(bv)) * order;
    });

    return { items: sorted };
  },
};

registerNode(sortNode);
