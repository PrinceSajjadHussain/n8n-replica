import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';
import type { NodeItem } from '@flowforge/shared-types';

/**
 * Item Lists — n8n's multi-operation helper for array/list manipulation:
 *   chunk   : split N items into sub-arrays of a fixed size
 *   flatten : unwrap an array-of-arrays field into individual items
 *   dedupe  : remove items whose key field value has already been seen
 *              (in-run dedup, resets each execution — for persistent dedup
 *               use Remove Duplicates or a Data Table node)
 *
 * n8n calls this node "Item Lists" and it lives in the "Data transformation"
 * category. FlowForge already ships Split Out (one array → one item per
 * element), Aggregate (many items → one), Sort, Limit, and Remove
 * Duplicates as standalone nodes — this node adds the three helpers that
 * still had no equivalent.
 */
export const itemListsNode: NodePlugin = {
  type: 'itemLists',
  async execute({ items, params }) {
    const mode = String(params.mode ?? 'chunk');

    // -----------------------------------------------------------------------
    // chunk: [ item1, item2, item3, item4, item5 ] with size=2
    //   → [ {chunk:[item1,item2]}, {chunk:[item3,item4]}, {chunk:[item5]} ]
    //
    // Each output item carries the whole source item JSON objects (not just
    // a scalar field) in an array under `destinationField` (default "chunk").
    // pairedItem points to the first source item of each chunk.
    // -----------------------------------------------------------------------
    if (mode === 'chunk') {
      const size = Math.max(1, Number(params.chunkSize ?? 5));
      const destinationField = String(params.destinationField ?? 'chunk');
      const out: NodeItem[] = [];
      for (let i = 0; i < items.length; i += size) {
        const slice = items.slice(i, i + size);
        out.push({
          json: {
            [destinationField]: slice.map((it) => it.json),
            chunkIndex: Math.floor(i / size),
            chunkSize: slice.length,
          },
          pairedItem: { item: i },
        });
      }
      return { items: out };
    }

    // -----------------------------------------------------------------------
    // flatten: each input item has a field whose value is an array; unwrap
    // it so every element of that array becomes its own output item, keeping
    // the rest of the item's JSON as context (same as Split Out but works one
    // level deeper if the elements are themselves arrays).
    //
    // depth=1 (default) replicates Split Out exactly; depth=Infinity flattens
    // arbitrarily nested arrays — useful when an integration returns
    // [[a,b],[c,[d,e]]] and you want a,b,c,d,e as items.
    // -----------------------------------------------------------------------
    if (mode === 'flatten') {
      const field = String(params.field ?? '');
      const depth = params.depth === 'deep' ? Infinity : 1;
      const out: NodeItem[] = [];
      items.forEach((item, i) => {
        const value = field ? getByPath(item.json, field) : item.json;
        const arr = Array.isArray(value) ? value.flat(depth) : [value];
        arr.forEach((el) => {
          const json: Record<string, unknown> = { ...item.json };
          if (field) {
            // overwrite the field with the single flattened element
            const keys = field.split('.');
            let cursor: Record<string, unknown> = json;
            for (let k = 0; k < keys.length - 1; k++) {
              if (typeof cursor[keys[k]] !== 'object' || cursor[keys[k]] === null)
                cursor[keys[k]] = {};
              cursor = cursor[keys[k]] as Record<string, unknown>;
            }
            cursor[keys[keys.length - 1]] = el;
          }
          out.push({ json, binary: item.binary, pairedItem: { item: i } });
        });
      });
      return { items: out };
    }

    // -----------------------------------------------------------------------
    // dedupe: stateful within one execution, keeps only the FIRST item seen
    // for each unique value of `key` (dot-notation path).  When `key` is
    // empty, the entire json is JSON-stringified as the key (expensive but
    // correct for small item sets).
    //
    // Distinct from the existing removeDuplicates node, which sorts & compares
    // — this one preserves original order and short-circuits on first-seen,
    // matching n8n's "Remove Duplicates" Item Lists operation (the standalone
    // removeDuplicates node covers the same gap from a different angle — both
    // stay because their implementations differ in tie-breaking behavior).
    // -----------------------------------------------------------------------
    if (mode === 'dedupe') {
      const key = String(params.key ?? '');
      const seen = new Set<string>();
      const out: NodeItem[] = [];
      items.forEach((item, i) => {
        const keyVal = key
          ? String(getByPath(item.json, key) ?? '')
          : JSON.stringify(item.json);
        if (!seen.has(keyVal)) {
          seen.add(keyVal);
          out.push({ ...item, pairedItem: { item: i } });
        }
      });
      return { items: out };
    }

    // Unknown mode — pass through rather than silently drop
    return { items };
  },
};

registerNode(itemListsNode);
