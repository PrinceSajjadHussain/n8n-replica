import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';

interface IfCondition {
  field: string;
  operator: string;
  value?: unknown;
}

function evalCondition(input: unknown, condition: IfCondition): boolean {
  const actual = condition.field ? getByPath(input, condition.field) : input;
  const expected = condition.value;
  switch (condition.operator) {
    case 'equals':
      return actual === expected;
    case 'notEquals':
      return actual !== expected;
    case 'contains':
      return typeof actual === 'string' && actual.includes(String(expected));
    case 'greaterThan':
      return Number(actual) > Number(expected);
    case 'lessThan':
      return Number(actual) < Number(expected);
    case 'exists':
      return actual !== undefined && actual !== null;
    default:
      throw new Error(`IF node: unknown operator "${condition.operator}"`);
  }
}

/**
 * IF node — evaluates one or more conditions against `input` and branches.
 *
 * params (new, multi-row form — see IfConditionsEditor.tsx):
 *   { conditions: Array<{ field: string, operator: string, value?: unknown }>,
 *     combinator?: 'AND' | 'OR' }
 *
 * params (legacy single-condition form, still honored so previously saved
 * workflows keep working unchanged):
 *   { field: string, operator: string, value?: unknown }
 *
 * Downstream edges must set sourceHandle to "true" or "false" to be
 * followed conditionally; the engine only traverses the edge matching the
 * branch result.
 */
export const ifNode: NodePlugin = {
  type: 'if',
  async execute({ input, params }) {
    const rows: IfCondition[] = Array.isArray(params.conditions) && params.conditions.length > 0
      ? (params.conditions as IfCondition[])
      : [{ field: String(params.field ?? ''), operator: String(params.operator ?? 'equals'), value: params.value }];

    const combinator = params.combinator === 'OR' ? 'OR' : 'AND';
    const results = rows.map((c) => evalCondition(input, c));
    const result = combinator === 'OR' ? results.some(Boolean) : results.every(Boolean);

    return {
      output: { condition: result, results },
      branch: result ? 'true' : 'false',
    };
  },
};

registerNode(ifNode);
