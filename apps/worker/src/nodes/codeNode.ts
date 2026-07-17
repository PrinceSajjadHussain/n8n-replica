import ivm from 'isolated-vm';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Code node — runs user-supplied JavaScript in a genuinely isolated V8
 * isolate (isolated-vm), NOT Node's `vm` module (which does not sandbox
 * against prototype pollution / global escape) and NOT raw `eval`.
 *
 * The user's code is wrapped as the body of a function that receives
 * `input` and must return a JSON-serializable value.
 *
 * params: { code: string }
 *
 * Security properties:
 * - Separate V8 isolate with its own heap (memory-limited).
 * - No access to Node.js globals (require, process, fs, network, etc.)
 *   unless explicitly bridged in — we bridge in nothing but `input`.
 * - Hard execution timeout to prevent infinite loops from hanging the worker.
 */
export const codeNode: NodePlugin = {
  type: 'code',
  async execute({ input, params }) {
    const userCode = String(params.code ?? '');
    if (!userCode.trim()) throw new Error('code node: "code" param is required');

    const isolate = new ivm.Isolate({ memoryLimit: 64 }); // MB
    try {
      const context = await isolate.createContext();
      const jail = context.global;
      await jail.set('global', jail.derefInto());

      // Bridge in the input as a JSON string; the wrapped script parses it
      // inside the isolate so no live object references cross the boundary.
      const inputJson = JSON.stringify(input ?? null);

      const wrapped = `
        (function() {
          const input = JSON.parse(${JSON.stringify(inputJson)});
          const __userFn = function(input) {
            ${userCode}
          };
          const result = __userFn(input);
          return JSON.stringify(result === undefined ? null : result);
        })()
      `;

      const script = await isolate.compileScript(wrapped);
      const resultJson = await script.run(context, { timeout: 5000 });
      return { output: JSON.parse(resultJson) };
    } finally {
      isolate.dispose();
    }
  },
};

registerNode(codeNode);
