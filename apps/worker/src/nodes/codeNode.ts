import ivm from 'isolated-vm';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import type { NodeItems } from '@flowforge/shared-types';

/**
 * Code node — runs user-supplied JavaScript in a genuinely isolated V8
 * isolate (isolated-vm), NOT Node's `vm` module (which does not sandbox
 * against prototype pollution / global escape) and NOT raw `eval`.
 *
 * ITEM-AWARE: the sandbox receives `items` (this node's full item-paired
 * input: `[{ json, binary }, ...]`) alongside the legacy `input` (single
 * merged json/array, unchanged, for existing scripts). The user's function
 * may return:
 *   - an items array `[{ json, binary? }, ...]`               -> used as-is
 *   - a plain array/object (legacy)                             -> normalized to items
 * Binary content (base64) is passed into the isolate as plain strings, same
 * as any other JSON-serializable data — no live object/Buffer references
 * cross the isolate boundary.
 *
 * params: { code: string }
 *
 * Also bridges n8n-style `$getWorkflowStaticData()` / `$setWorkflowStaticData(data)`
 * helpers into the isolate for lightweight persisted state (e.g. "last
 * processed id") between runs — see docs/data-model-upgrade.md. The setter
 * only records the replacement value inside the isolate; the actual
 * Postgres write happens once, after the script finishes running.
 *
 * Security properties:
 * - Separate V8 isolate with its own heap (memory-limited).
 * - No access to Node.js globals (require, process, fs, network, etc.)
 *   unless explicitly bridged in — we bridge in nothing but `input`/`items`.
 * - Hard execution timeout to prevent infinite loops from hanging the worker.
 */
export const codeNode: NodePlugin = {
  type: 'code',
  async execute({ input, items, params, staticData, setStaticData }) {
    const userCode = String(params.code ?? '');
    if (!userCode.trim()) throw new Error('code node: "code" param is required');

    const isolate = new ivm.Isolate({ memoryLimit: 64 }); // MB
    try {
      const context = await isolate.createContext();
      const jail = context.global;
      await jail.set('global', jail.derefInto());

      // Bridge in input/items as JSON strings; the wrapped script parses
      // them inside the isolate so no live object references cross the
      // boundary.
      const inputJson = JSON.stringify(input ?? null);
      const itemsJson = JSON.stringify(items ?? []);
      const staticDataJson = JSON.stringify(staticData ?? {});

      // $setWorkflowStaticData(data) is bridged as a synchronous native
      // callback: the isolate can't hold a live reference to the outer
      // Postgres write, so the call just records the replacement value in
      // this closure; the actual persist happens once, after the script
      // finishes, so a script that calls it mid-loop doesn't hammer the DB.
      let pendingStaticData: Record<string, unknown> | null = null;
      await jail.set(
        '__setStaticData',
        new ivm.Reference((dataJson: string) => {
          try {
            pendingStaticData = JSON.parse(dataJson);
          } catch {
            // ignore malformed payloads — the workflow's static data is simply left unchanged
          }
        })
      );

      const wrapped = `
        (function() {
          const input = JSON.parse(${JSON.stringify(inputJson)});
          const items = JSON.parse(${JSON.stringify(itemsJson)});
          const __staticData = JSON.parse(${JSON.stringify(staticDataJson)});
          // n8n-style helpers: read the current snapshot, or replace it
          // wholesale (merge yourself first if you only want to change one key).
          const $getWorkflowStaticData = function() { return __staticData; };
          const $setWorkflowStaticData = function(data) {
            __setStaticData.applySync(undefined, [JSON.stringify(data)]);
          };
          const __userFn = function(input, items) {
            ${userCode}
          };
          const result = __userFn(input, items);
          return JSON.stringify(result === undefined ? null : result);
        })()
      `;

      const script = await isolate.compileScript(wrapped);
      const resultJson = await script.run(context, { timeout: 5000 });
      const result = JSON.parse(resultJson);

      if (pendingStaticData) await setStaticData(pendingStaticData);

      // If the script returned something already shaped like items
      // (array of { json, binary? }), pass it through as-is; otherwise
      // fall back to the legacy single-output-value behavior.
      if (Array.isArray(result) && result.every((r) => r && typeof r === 'object' && 'json' in r)) {
        return { items: result as NodeItems };
      }
      return { output: result };
    } finally {
      isolate.dispose();
    }
  },
};

registerNode(codeNode);
