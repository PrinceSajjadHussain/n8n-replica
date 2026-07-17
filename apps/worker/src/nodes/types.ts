/**
 * FlowForge Node Plugin Interface
 * ================================
 * Every node type (HTTP Request, IF, Code, Slack, etc.) implements this
 * interface and registers itself in the NODE_REGISTRY below. Adding a new
 * integration means: copy this template, implement `execute`, register it.
 * No changes to the execution engine are required.
 *
 * COPY-PASTE TEMPLATE FOR A NEW NODE:
 * ------------------------------------------------------------------
 * export const myNewNode: NodePlugin = {
 *   type: 'myNewNode',
 *   async execute({ input, params, credential }) {
 *     // 1. read params (validated node configuration, e.g. URL, field mappings)
 *     // 2. use `input` (the output of the upstream node(s))
 *     // 3. use `credential` if this node type needs authenticated access
 *     // 4. return { output: <json-serializable result> }
 *     //    OR for branching nodes: { output, branch: 'true' | 'false' | <caseName> }
 *     return { output: { ok: true } };
 *   },
 * };
 * NODE_REGISTRY['myNewNode'] = myNewNode;
 * ------------------------------------------------------------------
 */

export interface NodeExecutionContext {
  /** Merged output(s) of upstream connected node(s). */
  input: unknown;
  /** This node's configured parameters (from the workflow JSON). */
  params: Record<string, unknown>;
  /** Decrypted credential data, if this node has a credentialId configured. */
  credential: Record<string, unknown> | null;
}

export interface NodeExecutionResult {
  /** JSON-serializable output passed to downstream nodes. */
  output: unknown;
  /**
   * For branching nodes (IF/Switch): which outgoing edge handle to follow.
   * Edges whose `sourceHandle` doesn't match are not traversed (and their
   * downstream-only nodes are marked 'skipped').
   */
  branch?: string;
}

export interface NodePlugin {
  type: string;
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>;
}

export const NODE_REGISTRY: Record<string, NodePlugin> = {};

export function registerNode(plugin: NodePlugin): void {
  NODE_REGISTRY[plugin.type] = plugin;
}
