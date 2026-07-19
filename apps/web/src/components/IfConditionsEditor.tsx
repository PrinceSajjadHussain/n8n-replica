interface IfCondition {
  field: string;
  operator: string;
  value?: unknown;
}

interface Props {
  params: Record<string, unknown>;
  onCommit: (params: Record<string, unknown>) => void;
}

const OPERATORS: { value: string; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'greaterThan', label: 'Greater than' },
  { value: 'lessThan', label: 'Less than' },
  { value: 'exists', label: 'Exists' },
];

/** Reads params into the new multi-row shape, transparently upgrading a
 *  legacy single-condition `{ field, operator, value }` node (the only
 *  shape the worker used to support) into a one-row `conditions` array so
 *  existing saved workflows show up correctly here on first open. */
function readConditions(params: Record<string, unknown>): IfCondition[] {
  if (Array.isArray(params.conditions) && params.conditions.length > 0) {
    return (params.conditions as IfCondition[]).map((c) => ({
      field: String(c.field ?? ''),
      operator: String(c.operator ?? 'equals'),
      value: c.value,
    }));
  }
  return [
    {
      field: String(params.field ?? ''),
      operator: String(params.operator ?? 'equals'),
      value: params.value,
    },
  ];
}

/**
 * Visual editor for the `if` node's params, embedded in NodeConfigPanel in
 * place of the old single field/operator/value form. The worker
 * (ifNode.ts) evaluates each row and combines them with the chosen
 * combinator (AND requires every row to match; OR requires any one row).
 * Backward compatible: a workflow saved before this editor existed still
 * has just `{ field, operator, value }`, which the worker keeps honoring
 * and which `readConditions` upgrades into a single row here.
 */
export default function IfConditionsEditor({ params, onCommit }: Props) {
  const conditions = readConditions(params);
  const combinator: 'AND' | 'OR' = params.combinator === 'OR' ? 'OR' : 'AND';

  function commit(nextConditions: IfCondition[], nextCombinator: 'AND' | 'OR' = combinator) {
    // Drop the legacy top-level field/operator/value once the row-based
    // editor has taken over, so there's exactly one source of truth going
    // forward instead of two shapes that could silently disagree.
    const { field: _f, operator: _o, value: _v, ...rest } = params;
    onCommit({ ...rest, conditions: nextConditions, combinator: nextCombinator });
  }

  function updateRow(index: number, updates: Partial<IfCondition>) {
    commit(conditions.map((c, i) => (i === index ? { ...c, ...updates } : c)));
  }

  function addRow() {
    commit([...conditions, { field: '', operator: 'equals', value: '' }]);
  }

  function removeRow(index: number) {
    const next = conditions.filter((_, i) => i !== index);
    commit(next.length > 0 ? next : [{ field: '', operator: 'equals', value: '' }]);
  }

  return (
    <div className="border border-panelBorder rounded-md p-3 mb-3 bg-canvas">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-muted">
          Conditions <span className="text-muted/70 normal-case">— branches "true" only if they match</span>
        </label>
        {conditions.length > 1 && (
          <div className="flex items-center gap-1 text-[10px]">
            {(['AND', 'OR'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => commit(conditions, c)}
                className={`focus-ring px-2 py-0.5 rounded border ${
                  combinator === c
                    ? 'border-signal/50 text-signal bg-signal/10'
                    : 'border-panelBorder text-muted hover:text-ink'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        {conditions.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[10px] text-muted w-7 text-center shrink-0">{combinator}</span>}
            {i === 0 && <span className="text-[10px] text-muted w-7 text-center shrink-0">if</span>}
            <input
              value={c.field}
              onChange={(e) => updateRow(i, { field: e.target.value })}
              placeholder="field (dot path)"
              className="focus-ring flex-1 min-w-0 bg-panel border border-panelBorder rounded-md px-2 py-1 text-xs font-display"
            />
            <select
              value={c.operator}
              onChange={(e) => updateRow(i, { operator: e.target.value })}
              className="focus-ring bg-panel border border-panelBorder rounded-md px-2 py-1 text-xs shrink-0"
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            {c.operator !== 'exists' && (
              <input
                value={String(c.value ?? '')}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                placeholder="value"
                className="focus-ring flex-1 min-w-0 bg-panel border border-panelBorder rounded-md px-2 py-1 text-xs font-display"
              />
            )}
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={conditions.length === 1}
              className="focus-ring text-xs text-muted hover:text-alert px-1 disabled:opacity-20"
              title="Remove condition"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="focus-ring text-xs mt-2 px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink"
      >
        + Add condition
      </button>
    </div>
  );
}
