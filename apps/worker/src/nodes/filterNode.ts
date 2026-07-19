import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath } from '../engine/jsonPath';

interface FilterCondition {
  field: string;
  operator: string;
  value?: unknown;
}

function evalCondition(json: unknown, condition: FilterCondition): boolean {
  const actual = condition.field ? getByPath(json, condition.field) : json;
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
      throw new Error(`Filter node: unknown operator "${condition.operator}"`);
  }
}

/**
 * Filter node — evaluates one or more conditions against EACH item and
 * drops items that don't match, passing the rest through unchanged
 * (json + binary + pairedItem preserved). This is the "distinct from IF"
 * item-level filter n8n/Make.com both have: unlike `if`, there's no
 * true/false branching — items either continue down the single output or
 * they don't.
 *
 * params (same shape as `if`'s row-based editor — IfConditionsEditor.tsx
 * is reused for this node too since the condition-row model is identical):
 *   { conditions: Array<{ field: string, operator: string, value?: unknown }>,
 *     combinator?: 'AND' | 'OR' }
 *
 * Legacy single-condition form `{ field, operator, value }` is also
 * honored for consistency with `if`.
 */
export const filterNode: NodePlugin = {
  type: 'filter',
  async execute({ items, params }) {
    const rows: FilterCondition[] = Array.isArray(params.conditions) && params.conditions.length > 0
      ? (params.conditions as FilterCondition[])
      : [{ field: String(params.field ?? ''), operator: String(params.operator ?? 'equals'), value: params.value }];

    const combinator = params.combinator === 'OR' ? 'OR' : 'AND';

    const kept = items.filter((item) => {
      const results = rows.map((c) => evalCondition(item.json, c));
      return combinator === 'OR' ? results.some(Boolean) : results.every(Boolean);
    });

    return { items: kept };
  },
};

registerNode(filterNode);
