import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';

/**
 * Aggregate — n8n/Make "collapse many items into a single item". Inverse
 * of Split Out.
 *
 * params:
 *   { mode?: 'field' | 'allItems', field?: string, destinationField?: string }
 *
 *   mode 'field' (default when `field` set): collects the value at `field`
 *     from every input item into an array on `destinationField` (default
 *     "<field>s" if not given... actually defaults to `field` itself so the
 *     shape is predictable: { [destinationField]: [...] }).
 *   mode 'allItems': collects each item's whole `json` into an array on
 *     `destinationField` (default "items").
 *
 * Always returns exactly one output item. Binary data isn't carried
 * through (aggregation doesn't have a single sensible pairedItem for it).
 */
export const aggregateNode: NodePlugin = {
  type: 'aggregate',
  async execute({ items, params }) {
    const mode = params.mode === 'allItems' ? 'allItems' : 'field';

    if (mode === 'allItems') {
      const destinationField = String(params.destinationField ?? 'items');
      return {
        items: [{ json: { [destinationField]: items.map((i) => i.json) }, pairedItem: { item: 0 } }],
      };
    }

    const field = String(params.field ?? '');
    const destinationField = String(params.destinationField ?? field ?? 'items');
    const values = items.map((i) => (field ? getByPath(i.json, field) : i.json));

    return {
      items: [{ json: { [destinationField]: values }, pairedItem: { item: 0 } }],
    };
  },
};

registerNode(aggregateNode);
