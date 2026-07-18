import type { Node, Edge } from '@xyflow/react';

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 140;

/** Simple layered (Sugiyama-style) auto-layout: each node's column is its
 *  longest-path distance from a root (a node with no incoming edges), and
 *  nodes within a column are stacked top-to-bottom in a stable order. No
 *  external layout library dependency — the graphs FlowForge deals with
 *  (tens of nodes, not thousands) don't need anything fancier, and this
 *  keeps the bundle small. Nodes with no edges at all are placed in a
 *  trailing row so they don't collapse onto column 0 with real roots. */
export function autoLayout<T extends Record<string, unknown> = Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[]
): Node<T>[] {
  if (nodes.length === 0) return nodes;

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!incoming.has(e.target) || !outgoing.has(e.source)) continue;
    incoming.get(e.target)!.push(e.source);
    outgoing.get(e.source)!.push(e.target);
  }

  const column = new Map<string, number>();
  const roots = nodes.filter((n) => (incoming.get(n.id) ?? []).length === 0);
  const queue: string[] = roots.map((n) => n.id);
  for (const id of queue) column.set(id, 0);

  // BFS assigning column = max(predecessor columns) + 1, so a node never
  // sits to the left of anything that feeds into it.
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const col = column.get(id) ?? 0;
    for (const nextId of outgoing.get(id) ?? []) {
      const candidate = col + 1;
      if ((column.get(nextId) ?? -1) < candidate) {
        column.set(nextId, candidate);
      }
      queue.push(nextId);
    }
  }

  // Any node untouched by BFS (isolated, or part of a cycle no root reaches) gets its own trailing column.
  let maxCol = Math.max(0, ...Array.from(column.values()));
  for (const n of nodes) {
    if (!column.has(n.id)) column.set(n.id, ++maxCol);
  }

  const rowByColumn = new Map<number, number>();
  return nodes.map((n) => {
    const col = column.get(n.id) ?? 0;
    const row = rowByColumn.get(col) ?? 0;
    rowByColumn.set(col, row + 1);
    return { ...n, position: { x: col * COLUMN_WIDTH, y: row * ROW_HEIGHT } };
  });
}
