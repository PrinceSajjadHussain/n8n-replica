import { registerNode } from './types';
import type { NodePlugin } from './types';
import type { NodeItem } from '@flowforge/shared-types';
import { getByPath } from '../engine/jsonPath';

/**
 * Compare Datasets — n8n-style diff between two upstream item lists.
 *
 * FlowForge's executor concatenates every incoming edge's items into a
 * single `items` array before a node runs (see executor.ts `processNode`),
 * tagging each item's `pairedItem.sourceNode` with the id of the upstream
 * node it came from. Compare Datasets relies on that lineage to split the
 * combined input back into "Dataset A" and "Dataset B": the two upstream
 * source node ids are taken in the order their edges were first seen (i.e.
 * whichever of the two branches was connected/created first is A). This
 * node therefore requires exactly two upstream connections — a single
 * connected input can't be compared against anything.
 *
 * Unlike n8n (which routes rows to four separate output branches — "In A
 * only", "In B only", "Different", "Same"), FlowForge's branch mechanism
 * (see `NodeExecutionResult.branch`) picks one branch for the *whole* node
 * execution, not per item — there's no per-item multi-output routing in
 * this engine. So instead this node returns a single item list, each item
 * tagged with a `_compare` field (`'same' | 'different' | 'onlyInA' |
 * 'onlyInB'`) plus `_compareSource` (`'A' | 'B'`) so a downstream `if`/
 * `filter`/`switch` node can branch on `_compare` if the four-way split is
 * needed.
 *
 * params:
 *   {
 *     matchFields?: string,   // comma-separated dot-paths used as the
 *                              // "same record" key, e.g. "id" or "id,email".
 *                              // Leave blank to key on the entire item JSON.
 *     compareFields?: string, // comma-separated dot-paths checked for the
 *                              // 'same' vs 'different' distinction once two
 *                              // records match on matchFields. Leave blank
 *                              // to compare the entire remaining JSON.
 *   }
 */

function buildKey(json: unknown, fields: string[]): string {
  if (fields.length === 0) return JSON.stringify(json);
  return JSON.stringify(fields.map((f) => getByPath(json, f)));
}

export const compareDatasetsNode: NodePlugin = {
  type: 'compareDatasets',
  async execute({ items, params }) {
    const matchFields = String(params.matchFields ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    const compareFields = String(params.compareFields ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);

    const sourceOrder: string[] = [];
    for (const item of items) {
      const pi = Array.isArray(item.pairedItem) ? item.pairedItem[0] : item.pairedItem;
      const src = pi?.sourceNode;
      if (src && !sourceOrder.includes(src)) sourceOrder.push(src);
    }

    if (sourceOrder.length < 2) {
      throw new Error(
        'Compare Datasets node: requires two separate upstream connections (Dataset A and Dataset B). ' +
          `Only found input from ${sourceOrder.length} upstream node(s) — connect two branches into this node.`,
      );
    }
    const [nodeA, nodeB] = sourceOrder;

    const itemsOf = (sourceId: string): NodeItem[] =>
      items.filter((item) => {
        const pi = Array.isArray(item.pairedItem) ? item.pairedItem[0] : item.pairedItem;
        return pi?.sourceNode === sourceId;
      });

    const datasetA = itemsOf(nodeA);
    const datasetB = itemsOf(nodeB);

    const bByKey = new Map<string, NodeItem>();
    for (const item of datasetB) bByKey.set(buildKey(item.json, matchFields), item);

    const matchedBKeys = new Set<string>();
    const out: NodeItem[] = [];

    for (const item of datasetA) {
      const key = buildKey(item.json, matchFields);
      const match = bByKey.get(key);
      if (!match) {
        out.push({ json: { ...item.json, _compare: 'onlyInA', _compareSource: 'A' }, binary: item.binary, pairedItem: item.pairedItem });
        continue;
      }
      matchedBKeys.add(key);
      const same =
        compareFields.length > 0
          ? compareFields.every((f) => JSON.stringify(getByPath(item.json, f)) === JSON.stringify(getByPath(match.json, f)))
          : JSON.stringify(item.json) === JSON.stringify(match.json);
      out.push({
        json: { ...item.json, _compare: same ? 'same' : 'different', _compareSource: 'A' },
        binary: item.binary,
        pairedItem: item.pairedItem,
      });
    }

    for (const item of datasetB) {
      const key = buildKey(item.json, matchFields);
      if (matchedBKeys.has(key)) continue;
      out.push({ json: { ...item.json, _compare: 'onlyInB', _compareSource: 'B' }, binary: item.binary, pairedItem: item.pairedItem });
    }

    return { items: out };
  },
};

registerNode(compareDatasetsNode);
