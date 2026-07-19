import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';

/**
 * Remove Duplicates — keeps the first occurrence of each distinct key,
 * drops the rest.
 *
 * params:
 *   { field?: string }
 *
 * If `field` is given, items are deduped by that field's value (compared
 * via JSON.stringify so objects/arrays work too, not just primitives). If
 * omitted, items are deduped by their entire `json` payload.
 */
export const removeDuplicatesNode: NodePlugin = {
  type: 'removeDuplicates',
  async execute({ items, params }) {
    const field = params.field ? String(params.field) : '';
    const seen = new Set<string>();
    const out = items.filter((item) => {
      const key = JSON.stringify(field ? getByPath(item.json, field) : item.json);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { items: out };
  },
};

registerNode(removeDuplicatesNode);
