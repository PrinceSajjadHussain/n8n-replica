import type { WorkflowEdge, WorkflowNode } from '@flowforge/shared-types';

/**
 * Returns node ids in topological order (dependencies before dependents).
 * Throws if the graph contains a cycle.
 */
export function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !inDegree.has(edge.target)) {
      // Edge references a node not in the graph — ignore defensively.
      continue;
    }
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  if (order.length !== nodes.length) {
    throw new Error('Workflow graph contains a cycle — cannot execute');
  }

  return order;
}
