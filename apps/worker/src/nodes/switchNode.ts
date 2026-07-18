import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';

/**
 * switch — n8n-style Router: evaluates `field` against a list of named
 * cases and follows only the matching outgoing edge (sourceHandle must
 * equal the matched case's `handle`). Falls back to a "default" branch
 * when nothing matches and `fallbackToDefault` isn't explicitly disabled.
 *
 * params:
 *   field: string                dot-path into input
 *   cases: Array<{ handle: string, value: unknown }>
 *   fallbackToDefault?: boolean  default true — unmatched input follows the edge with sourceHandle "default"
 */
export const switchNode: NodePlugin = {
  type: 'switch',
  async execute({ input, params }) {
    const field = String(params.field ?? '');
    const actual = field ? getByPath(input, field) : input;
    const cases = (params.cases as Array<{ handle: string; value: unknown }>) ?? [];

    const match = cases.find((c) => c.value === actual);
    if (match) {
      return { output: { matched: match.handle, actual }, branch: match.handle };
    }
    if (params.fallbackToDefault !== false) {
      return { output: { matched: 'default', actual }, branch: 'default' };
    }
    throw new Error(`switch node: no case matched value ${JSON.stringify(actual)} and fallbackToDefault is disabled`);
  },
};

registerNode(switchNode);
