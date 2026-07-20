import { createContext, useContext } from 'react';

export const NodeRetryContext = createContext<(nodeId: string) => void>(() => {});

/** Consumed by FlowNode / NodeInspectPopover's "Retry this node" button — re-runs the
 *  workflow starting at nodeId, reusing every other node's cached output from the
 *  active/most-recent execution (same underlying call as NodeConfigPanel's
 *  "Run workflow from here", just reachable straight from a failed node's popover). */
export function useNodeRetry() {
  return useContext(NodeRetryContext);
}
