import type { NodeDefinition, NodeContext, NodeItem } from './index';

/** Runs a node definition's execute() with a minimal mocked context, for use
 *  in the custom node's own unit tests (`npx flowforge-node test` also uses
 *  this under the hood). Keeps custom-node authors from having to spin up
 *  the full FlowForge worker just to iterate on node logic. */
export async function testNode(
  node: NodeDefinition,
  input: {
    params?: Record<string, unknown>;
    items?: NodeItem[];
    credential?: Record<string, unknown>;
  } = {}
): Promise<NodeItem[]> {
  const logs: { level: string; msg: string; meta?: unknown }[] = [];
  const ctx: NodeContext = {
    params: input.params ?? {},
    items: input.items ?? [{ json: {} }],
    credential: input.credential,
    logger: {
      info: (msg, meta) => logs.push({ level: 'info', msg, meta }),
      warn: (msg, meta) => logs.push({ level: 'warn', msg, meta }),
      error: (msg, meta) => logs.push({ level: 'error', msg, meta }),
    },
    workflowId: 'test-workflow',
    executionId: 'test-execution',
    nodeId: 'test-node',
  };

  const result = await node.execute(ctx);
  return Array.isArray(result) ? result : [];
}
