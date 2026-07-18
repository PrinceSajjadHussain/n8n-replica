import path from 'path';
import { testNode } from '@flowforge/node-sdk';
import type { NodeDefinition } from '@flowforge/node-sdk';

/** `flowforge-node test <entry-file> [--params '{"key":"value"}']` — loads
 *  the node definition and runs it through the SDK's test harness, printing
 *  the resulting items. Useful for a fast inner loop while authoring a node,
 *  without needing the worker or a real workflow. */
export async function runTest(args: string[]) {
  const entry = args[0];
  if (!entry) throw new Error('Usage: flowforge-node test <entry-file> [--params \'{"key":"value"}\']');

  const paramsFlagIndex = args.indexOf('--params');
  const params = paramsFlagIndex >= 0 && args[paramsFlagIndex + 1] ? JSON.parse(args[paramsFlagIndex + 1]) : {};

  const resolved = path.resolve(process.cwd(), entry);
  const mod = await import(resolved);
  const node: NodeDefinition | undefined = (mod.default ?? Object.values(mod)[0]) as NodeDefinition | undefined;
  if (!node || !node.execute) throw new Error(`No NodeDefinition export found in ${entry}`);

  const output = await testNode(node, { params, items: [{ json: {} }] });
  console.log(JSON.stringify(output, null, 2));
}
