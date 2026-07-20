import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';
import type { NodeItem } from '@flowforge/shared-types';

/**
 * Split Out — n8n/Make "explode an array field into one item per element".
 *
 * params:
 *   { fieldToSplitOut: string, destinationField?: string }
 *
 * For each input item, reads the array at `fieldToSplitOut`. Every element
 * becomes its own output item: the rest of the source item's json is kept,
 * and the element is written to `destinationField` (default: same path as
 * `fieldToSplitOut`, overwriting the array with the single element). Items
 * whose field isn't an array pass through untouched (matches n8n behavior
 * of not silently dropping non-array data).
 */
export const splitOutNode: NodePlugin = {
  type: 'splitOut',
  async execute({ items, params }) {
    const fieldToSplitOut = String(params.fieldToSplitOut ?? '');
    const destinationField = String(params.destinationField ?? fieldToSplitOut);

    const out: NodeItem[] = [];
    items.forEach((item, i) => {
      const value = fieldToSplitOut ? getByPath(item.json, fieldToSplitOut) : item.json;
      if (!Array.isArray(value)) {
        out.push(item);
        return;
      }
      value.forEach((el) => {
        const json: Record<string, unknown> = { ...item.json };
        const keys = destinationField.split('.');
        let cursor: Record<string, unknown> = json;
        for (let k = 0; k < keys.length - 1; k++) {
          if (typeof cursor[keys[k]] !== 'object' || cursor[keys[k]] === null) cursor[keys[k]] = {};
          cursor = cursor[keys[k]] as Record<string, unknown>;
        }
        cursor[keys[keys.length - 1]] = el;
        const sourceNode = Array.isArray(item.pairedItem) ? undefined : item.pairedItem?.sourceNode;
        out.push({ json, binary: item.binary, pairedItem: { item: i, sourceNode } });
      });
    });

    return { items: out };
  },
};

registerNode(splitOutNode);
