import type { Edge } from '@xyflow/react';
import { getNodePorts, CONNECTION_TYPE_META, NodeConnectionTypes } from './connectionTypes';

/** Shape persisted in a workflow's `edgesJson` — what the API/DB actually store. */
export interface SavedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}

/**
 * Turns live React Flow edges into the JSON shape saved to the workflow.
 * Used by `handleSave`. Keeping this separate from the setEdges/setState
 * call is what makes it testable outside a React tree.
 */
export function serializeEdgesForSave(edges: Edge[]): SavedEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  }));
}

/**
 * Reconstructs live React Flow edges (with connection-type-derived style and
 * `data.connectionType`) from a workflow's saved nodes/edges. Used by
 * `loadWorkflow`, and by the AI-generate-workflow path.
 *
 * `nodeTypeById` deliberately takes the *type* (not the full node object) so
 * callers can build it straight off freshly-fetched `nodesJson` without
 * needing the reconstructed React Flow node list to exist yet — avoids the
 * state-timing trap of reading from React state that may not have committed.
 */
export function deriveEdgesFromSaved(savedEdges: SavedEdge[], nodeTypeById: Map<string, string | undefined>): Edge[] {
  return savedEdges.map((e) => {
    const sourcePorts = getNodePorts(nodeTypeById.get(e.source)).outputs;
    const sourcePort = e.sourceHandle ? sourcePorts.find((p) => p.id === e.sourceHandle) : sourcePorts[0];
    const connectionType = sourcePort?.type ?? NodeConnectionTypes.Main;
    const isMain = connectionType === NodeConnectionTypes.Main;
    const meta = CONNECTION_TYPE_META[connectionType];
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      animated: false,
      style: isMain ? undefined : { stroke: meta.color, strokeDasharray: '4 3', strokeWidth: 1.5 },
      data: { connectionType },
    } satisfies Edge;
  });
}
