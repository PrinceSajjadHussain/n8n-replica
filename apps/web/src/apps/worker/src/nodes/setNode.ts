import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath, setByPath } from '../engine/jsonPath';

/**
 * Set/Transform node — remaps and/or adds fields from the input into a new
 * output object, per item.
 *
 * ITEM-AWARE: runs once per input item (item-pairing model), so a 3-item
 * input produces 3 output items, each linked back to its source item via
 * `pairedItem`. Binary data on each item passes through untouched unless
 * `params.dropBinary` is set — this node only rewrites `json`.
 *
 * params: { mappings: Array<{ targetPath: string, sourcePath?: string, staticValue?: unknown }>, dropBinary?: boolean }
 * If `sourcePath` is given, the value is read from the item's `json` at that
 * dot path. Otherwise `staticValue` is used verbatim.
 */
export const setNode: NodePlugin = {
  type: 'set',
  async execute({ items, params }) {
    const mappings =
      (params.mappings as Array<{
        targetPath: string;
        sourcePath?: string;
        staticValue?: unknown;
      }>) ?? [];

    // No incoming items (e.g. a Set node as the very first node) still
    // produces exactly one output item, matching pre-item-model behavior.
    const sourceItems = items.length > 0 ? items : [{ json: {} }];

    const outItems = sourceItems.map((item, i) => {
      const outJson: Record<string, unknown> = {};
      for (const mapping of mappings) {
        const value = mapping.sourcePath ? getByPath(item.json, mapping.sourcePath) : mapping.staticValue;
        setByPath(outJson, mapping.targetPath, value);
      }
      return {
        json: outJson,
        binary: params.dropBinary ? undefined : item.binary,
        pairedItem: { item: i },
      };
    });

    return { items: outItems };
  },
};

registerNode(setNode);
