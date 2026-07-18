interface SwitchCase {
  handle: string;
  value: unknown;
}

interface Props {
  params: Record<string, unknown>;
  onCommit: (params: Record<string, unknown>) => void;
}

/**
 * Visual editor for the `switch` node's params, embedded in NodeConfigPanel
 * above the raw JSON textarea. The worker (switchNode.ts) matches cases in
 * array order and stops at the first match, so order IS priority — this
 * gives that priority reordering a UI instead of hand-editing JSON, plus a
 * visible toggle for the "default" fallback route.
 */
export default function SwitchCasesEditor({ params, onCommit }: Props) {
  const field = String(params.field ?? '');
  const cases = (Array.isArray(params.cases) ? (params.cases as SwitchCase[]) : []).map((c) => ({
    handle: String(c.handle ?? ''),
    value: c.value,
  }));
  const fallbackToDefault = params.fallbackToDefault !== false;

  function commit(nextCases: SwitchCase[], nextFallback = fallbackToDefault) {
    onCommit({ ...params, field, cases: nextCases, fallbackToDefault: nextFallback });
  }

  function updateCase(index: number, updates: Partial<SwitchCase>) {
    const next = cases.map((c, i) => (i === index ? { ...c, ...updates } : c));
    commit(next);
  }

  function moveCase(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= cases.length) return;
    const next = [...cases];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  }

  function addCase() {
    const n = cases.length + 1;
    commit([...cases, { handle: `case${n}`, value: '' }]);
  }

  function removeCase(index: number) {
    commit(cases.filter((_, i) => i !== index));
  }

  return (
    <div className="border border-panelBorder rounded-md p-3 mb-3 bg-canvas">
      <label className="block text-xs text-muted mb-1">Field to match</label>
      <input
        value={field}
        onChange={(e) => onCommit({ ...params, field: e.target.value, cases, fallbackToDefault })}
        placeholder="e.g. status"
        className="focus-ring w-full bg-panel border border-panelBorder rounded-md px-2 py-1.5 text-xs font-display mb-3"
      />

      <label className="block text-xs text-muted mb-1.5">
        Cases <span className="text-muted/70 normal-case">— evaluated top to bottom, first match wins</span>
      </label>
      <div className="grid gap-1.5">
        {cases.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => moveCase(i, -1)}
                disabled={i === 0}
                className="focus-ring text-[10px] leading-none px-1 text-muted hover:text-ink disabled:opacity-20"
                title="Move up (higher priority)"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => moveCase(i, 1)}
                disabled={i === cases.length - 1}
                className="focus-ring text-[10px] leading-none px-1 text-muted hover:text-ink disabled:opacity-20"
                title="Move down (lower priority)"
              >
                ▼
              </button>
            </div>
            <span className="text-[10px] text-muted w-4 text-center">{i + 1}</span>
            <input
              value={c.handle}
              onChange={(e) => updateCase(i, { handle: e.target.value })}
              placeholder="handle"
              className="focus-ring flex-1 min-w-0 bg-panel border border-panelBorder rounded-md px-2 py-1 text-xs font-display"
            />
            <input
              value={String(c.value ?? '')}
              onChange={(e) => updateCase(i, { value: e.target.value })}
              placeholder="value to match"
              className="focus-ring flex-1 min-w-0 bg-panel border border-panelBorder rounded-md px-2 py-1 text-xs font-display"
            />
            <button
              type="button"
              onClick={() => removeCase(i)}
              className="focus-ring text-xs text-muted hover:text-alert px-1"
              title="Remove case"
            >
              ✕
            </button>
          </div>
        ))}
        {cases.length === 0 && <p className="text-muted text-[11px]">No cases yet — add one below.</p>}
      </div>
      <button
        type="button"
        onClick={addCase}
        className="focus-ring text-xs mt-2 px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink"
      >
        + Add case
      </button>

      <div className="mt-3 pt-3 border-t border-panelBorder flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={fallbackToDefault}
            onChange={(e) => commit(cases, e.target.checked)}
          />
          Expose a "default" fallback route for unmatched values
        </label>
      </div>
      {fallbackToDefault && (
        <p className="text-muted text-[11px] mt-1">
          Connect an edge from this node's <code>default</code> handle to catch anything that doesn't match a case
          above.
        </p>
      )}
      {!fallbackToDefault && (
        <p className="text-muted text-[11px] mt-1">
          Unmatched values will throw an error instead of following a fallback edge.
        </p>
      )}
    </div>
  );
}
