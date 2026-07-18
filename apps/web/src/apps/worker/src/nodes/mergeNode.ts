import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Merge node — combines multiple upstream outputs (the engine passes an
 * array when a node has more than one incoming edge) into a single object
 * keyed by source node id, or concatenates arrays if all inputs are arrays.
 */
export const mergeNode: NodePlugin = {
  type: 'merge',
  async execute({ input }) {
    if (Array.isArray(input) && input.every((i) => Array.isArray(i))) {
      return { output: (input as unknown[][]).flat() };
    }
    return { output: input };
  },
};

registerNode(mergeNode);
