import ivm from 'isolated-vm';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * forEach — n8n-style "Loop Over Items" / batch node, implemented as a
 * real map over an array using the same isolated-vm sandbox as the `code`
 * node (see codeNode.ts for the security rationale).
 *
 * Honest limitation: this is a single-node loop (no re-entry into
 * upstream/downstream graph nodes per iteration — FlowForge's executor is
 * a single-pass DAG walker, not a re-entrant graph interpreter). For "run
 * these 3 nodes per item" semantics, put the per-item logic inside this
 * node's `code`. The sandbox has no network access, so per-item HTTP/AI
 * calls aren't possible from inside forEach today — true per-item
 * multi-node branching would need the executor to support subgraph
 * re-entry, which is on the roadmap (see SETUP_GUIDE.md).
 *
 * params:
 *   itemsPath?: string   dot-path into `input` for the array (default: input itself)
 *   code: string         JS function body, receives (item, index, allItems), returns a value
 *   batchSize?: number   if set, output.batches is items chunked into groups of this size
 */
export const forEachNode: NodePlugin = {
  type: 'forEach',
  async execute({ input, params }) {
    const itemsPath = params.itemsPath ? String(params.itemsPath) : '';
    const source = itemsPath
      ? itemsPath.split('.').reduce<unknown>((acc, k) => (acc as any)?.[k], input)
      : input;
    const items = Array.isArray(source) ? source : source == null ? [] : [source];

    const userCode = String(params.code ?? 'return item;');
    const isolate = new ivm.Isolate({ memoryLimit: 64 });
    try {
      const context = await isolate.createContext();
      const jail = context.global;
      await jail.set('global', jail.derefInto());

      const results: unknown[] = [];
      const allItemsJson = JSON.stringify(items);
      for (let i = 0; i < items.length; i++) {
        const itemJson = JSON.stringify(items[i] ?? null);
        const wrapped = `
          (function() {
            const item = JSON.parse(${JSON.stringify(itemJson)});
            const index = ${i};
            const allItems = JSON.parse(${JSON.stringify(allItemsJson)});
            const __userFn = function(item, index, allItems) {
              ${userCode}
            };
            const result = __userFn(item, index, allItems);
            return JSON.stringify(result === undefined ? null : result);
          })()
        `;
        const script = await isolate.compileScript(wrapped);
        const resultJson = await script.run(context, { timeout: 5000 });
        results.push(JSON.parse(resultJson));
      }

      const batchSize = params.batchSize ? Number(params.batchSize) : null;
      const batches = batchSize
        ? Array.from({ length: Math.ceil(results.length / batchSize) }, (_, b) =>
            results.slice(b * batchSize, (b + 1) * batchSize)
          )
        : null;

      return { output: { items: results, count: results.length, ...(batches ? { batches } : {}) } };
    } finally {
      isolate.dispose();
    }
  },
};

registerNode(forEachNode);
