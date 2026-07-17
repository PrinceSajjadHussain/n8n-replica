import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from '@flowforge/shared-types';
import { topologicalSort } from './topoSort';
import { NODE_REGISTRY } from '../nodes';
import {
  createExecution,
  finishExecution,
  upsertNodeRunStart,
  finishNodeRunSuccess,
  finishNodeRunFailure,
  markNodeSkipped,
  getDecryptedCredentialById,
} from '../db/executions';

export type StatusEmitter = (event: {
  executionId: string;
  nodeId?: string;
  status: 'running' | 'success' | 'failed' | 'skipped' | 'started' | 'completed';
  output?: unknown;
  error?: string;
}) => void;

/**
 * Executes a workflow graph:
 * 1. Topologically sorts nodes.
 * 2. Runs each node using its registered plugin, feeding it the merged
 *    output(s) of its upstream connected node(s).
 * 3. For branching nodes (IF/Switch), only the matching outgoing edge is
 *    followed — nodes reachable ONLY via the non-taken branch are marked
 *    'skipped' rather than executed.
 * 4. A node's failure marks it (and everything reachable only through it)
 *    as failed/skipped, but does NOT crash the worker process or abort
 *    sibling branches that don't depend on the failed node.
 * 5. Persists every node's input/output/status/timing.
 */
export async function executeWorkflow(
  workflowId: string,
  graph: WorkflowGraph,
  triggerType: 'manual' | 'webhook' | 'schedule',
  triggerPayload: unknown,
  emit: StatusEmitter = () => {}
): Promise<{ executionId: string; status: 'success' | 'failed' }> {
  const { nodes, edges } = graph;
  const nodeMap = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));
  const incomingEdges = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (!incomingEdges.has(edge.target)) incomingEdges.set(edge.target, []);
    incomingEdges.get(edge.target)!.push(edge);
  }

  const executionId = await createExecution(workflowId, triggerType);
  emit({ executionId, status: 'started' });

  const outputs = new Map<string, unknown>();
  const nodeStatus = new Map<string, 'success' | 'failed' | 'skipped'>();
  const branchTaken = new Map<string, string>();
  let order: string[];
  try {
    order = topologicalSort(nodes, edges);
  } catch (err) {
    await finishExecution(executionId, 'failed');
    emit({ executionId, status: 'failed', error: (err as Error).message });
    return { executionId, status: 'failed' };
  }

  let anyFailure = false;

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId)!;
    const incoming = incomingEdges.get(nodeId) ?? [];

    // Determine if this node should be skipped because every incoming edge
    // comes from a branching node that did not select this path, or from
    // an upstream node that failed/was itself skipped.
    let shouldSkip = false;
    if (incoming.length > 0) {
      shouldSkip = incoming.every((edge) => {
        const upstreamStatus = nodeStatus.get(edge.source);
        if (upstreamStatus === 'failed' || upstreamStatus === 'skipped') return true;
        // branch mismatch: edge has a sourceHandle but upstream branch differs
        const upstreamBranch = branchTaken.get(edge.source);
        if (edge.sourceHandle != null && upstreamBranch != null) {
          return edge.sourceHandle !== upstreamBranch;
        }
        return false;
      });
    }

    if (shouldSkip) {
      nodeStatus.set(nodeId, 'skipped');
      await markNodeSkipped(executionId, nodeId);
      emit({ executionId, nodeId, status: 'skipped' });
      continue;
    }

    // Resolve this node's input from upstream output(s).
    const upstreamOutputs = incoming
      .filter((e) => nodeStatus.get(e.source) === 'success')
      .map((e) => outputs.get(e.source));
    const input =
      triggerPayload !== undefined && incoming.length === 0
        ? triggerPayload
        : upstreamOutputs.length === 1
          ? upstreamOutputs[0]
          : upstreamOutputs.length === 0
            ? null
            : upstreamOutputs;

    const nodeRunId = await upsertNodeRunStart(executionId, nodeId, input);
    emit({ executionId, nodeId, status: 'running' });

    const plugin = NODE_REGISTRY[node.type];
    if (!plugin) {
      const errorMsg = `No node plugin registered for type "${node.type}"`;
      await finishNodeRunFailure(nodeRunId, errorMsg);
      nodeStatus.set(nodeId, 'failed');
      anyFailure = true;
      emit({ executionId, nodeId, status: 'failed', error: errorMsg });
      continue;
    }

    try {
      const credential = node.credentialId
        ? await getDecryptedCredentialById(node.credentialId)
        : null;
      const result = await plugin.execute({ input, params: node.params ?? {}, credential });
      outputs.set(nodeId, result.output);
      if (result.branch) branchTaken.set(nodeId, result.branch);
      nodeStatus.set(nodeId, 'success');
      await finishNodeRunSuccess(nodeRunId, result.output);
      emit({ executionId, nodeId, status: 'success', output: result.output });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      nodeStatus.set(nodeId, 'failed');
      anyFailure = true;
      await finishNodeRunFailure(nodeRunId, message);
      emit({ executionId, nodeId, status: 'failed', error: message });
      // Do NOT rethrow — continue processing remaining nodes/branches.
    }
  }

  const finalStatus = anyFailure ? 'failed' : 'success';
  await finishExecution(executionId, finalStatus);
  emit({ executionId, status: 'completed' });
  return { executionId, status: finalStatus };
}
