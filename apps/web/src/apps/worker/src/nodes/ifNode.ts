import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';

/**
 * IF node — evaluates a simple condition against `input` and branches.
 * params: { field: string (dot path into input), operator: 'equals'|'notEquals'|'contains'|'greaterThan'|'lessThan'|'exists', value?: unknown }
 * Downstream edges must set sourceHandle to "true" or "false" to be followed
 * conditionally; the engine only traverses the edge matching the branch result.
 */
export const ifNode: NodePlugin = {
  type: 'if',
  async execute({ input, params }) {
    const field = String(params.field ?? '');
    const operator = String(params.operator ?? 'equals');
    const expected = params.value;
    const actual = field ? getByPath(input, field) : input;

    let result: boolean;
    switch (operator) {
      case 'equals':
        result = actual === expected;
        break;
      case 'notEquals':
        result = actual !== expected;
        break;
      case 'contains':
        result = typeof actual === 'string' && actual.includes(String(expected));
        break;
      case 'greaterThan':
        result = Number(actual) > Number(expected);
        break;
      case 'lessThan':
        result = Number(actual) < Number(expected);
        break;
      case 'exists':
        result = actual !== undefined && actual !== null;
        break;
      default:
        throw new Error(`IF node: unknown operator "${operator}"`);
    }

    return {
      output: { condition: result, actual },
      branch: result ? 'true' : 'false',
    };
  },
};

registerNode(ifNode);
