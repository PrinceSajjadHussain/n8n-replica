import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import EmptyState from '../components/EmptyState';

interface Variable {
  id: string;
  workspaceId: string | null;
  key: string;
  value: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Workspace {
  id: string;
  name: string;
}

/** Settings page for `{{$vars.KEY}}` expression variables — instance-wide
 *  (workspaceId: null) plus optionally a workspace-scoped set layered on
 *  top. Values are masked by default (like credential secrets) since a
 *  variable is often used to hold things like a base URL + API key that
 *  shouldn't be shoulder-surfable by default. */
export default function VariablesPage() {
  const [variables, setVariables] = useState<Variable[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [scope, setScope] = useState<string>('global');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Variable | null>(null);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(currentScope: string) {
    const workspaceId = currentScope === 'global' ? undefined : currentScope;
    const { data } = await api.get('/variables', { params: workspaceId ? { workspaceId } : undefined });
    setVariables(data.variables);
  }

  useEffect(() => {
    api
      .get('/workspaces')
      .then(({ data }) => setWorkspaces(data.workspaces ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const globalVars = useMemo(() => (variables ?? []).filter((v) => v.workspaceId === null), [variables]);
  const scopedVars = useMemo(() => (variables ?? []).filter((v) => v.workspaceId !== null), [variables]);

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate() {
    setEditing(null);
    setKey('');
    setValue('');
    setError(null);
    setShowForm(true);
  }

  function openEdit(v: Variable) {
    setEditing(v);
    setKey(v.key);
    setValue(v.value);
    setError(null);
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/variables/${editing.id}`, { key, value });
      } else {
        await api.post('/variables', {
          key,
          value,
          workspaceId: scope === 'global' ? null : scope,
        });
      }
      setShowForm(false);
      await load(scope);
    } catch (err: any) {
      setError(err.response?.data?.error?.formErrors?.[0] ?? err.response?.data?.error ?? 'Could not save variable.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: Variable) {
    if (!confirm(`Delete variable "${v.key}"? Any node expression referencing {{$vars.${v.key}}} will break.`)) return;
    await api.delete(`/variables/${v.id}`);
    await load(scope);
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl">Variables</h1>
            <p className="text-sm text-muted mt-1">
              Available in any node expression as <code className="text-signal">{'{{$vars.KEY}}'}</code>. Instance
              variables apply everywhere; workspace variables override an instance variable with the same key for
              workflows in that workspace.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="focus-ring shrink-0 text-sm px-4 py-2 rounded-md bg-signal text-canvas font-medium hover:brightness-110 transition"
          >
            + New variable
          </button>
        </div>

        <div className="flex gap-1 mb-4 border-b border-panelBorder">
          <button
            onClick={() => setScope('global')}
            className={`focus-ring text-sm px-3 py-2 border-b-2 -mb-px transition ${
              scope === 'global' ? 'border-signal text-signal' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            Instance
          </button>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setScope(ws.id)}
              className={`focus-ring text-sm px-3 py-2 border-b-2 -mb-px transition ${
                scope === ws.id ? 'border-signal text-signal' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {ws.name}
            </button>
          ))}
        </div>

        {variables === null && <p className="text-sm text-muted">Loading…</p>}

        {variables !== null && globalVars.length === 0 && scopedVars.length === 0 && (
          <EmptyState
            icon={<span>{'{}'}</span>}
            title="No variables yet"
            description="Store a reusable value — a base URL, a shared API key, a feature flag — once, and reference it from any workflow with {{$vars.KEY}}."
            primaryAction={{ label: '+ New variable', onClick: openCreate }}
          />
        )}

        {scope === 'global' && globalVars.length > 0 && (
          <VariableTable
            variables={globalVars}
            revealed={revealed}
            onToggleReveal={toggleReveal}
            onEdit={openEdit}
            onDelete={remove}
          />
        )}

        {scope !== 'global' && (
          <>
            {scopedVars.length > 0 && (
              <div className="mb-6">
                <p className="text-xs uppercase tracking-wider text-muted mb-2">Workspace-scoped</p>
                <VariableTable
                  variables={scopedVars}
                  revealed={revealed}
                  onToggleReveal={toggleReveal}
                  onEdit={openEdit}
                  onDelete={remove}
                />
              </div>
            )}
            {globalVars.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted mb-2">
                  Instance (inherited — create a workspace variable with the same key to override)
                </p>
                <VariableTable
                  variables={globalVars}
                  revealed={revealed}
                  onToggleReveal={toggleReveal}
                  onEdit={openEdit}
                  onDelete={remove}
                  readOnlyHint
                />
              </div>
            )}
          </>
        )}

        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-panel border border-panelBorder rounded-xl p-5 w-full max-w-sm">
              <h3 className="font-medium mb-3">{editing ? `Edit "${editing.key}"` : 'New variable'}</h3>
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="text-xs text-muted block mb-1">Key</label>
                  <input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="API_BASE_URL"
                    required
                    className="focus-ring w-full bg-transparent border border-panelBorder rounded-md px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Value</label>
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    required
                    className="focus-ring w-full bg-transparent border border-panelBorder rounded-md px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
                {scope !== 'global' && !editing && (
                  <p className="text-[11px] text-muted">
                    Scoped to <strong>{workspaces.find((w) => w.id === scope)?.name}</strong>.
                  </p>
                )}
                {error && <p className="text-xs text-alert">{String(error)}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="focus-ring text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110 disabled:opacity-50"
                  >
                    {editing ? 'Save' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function VariableTable({
  variables,
  revealed,
  onToggleReveal,
  onEdit,
  onDelete,
  readOnlyHint,
}: {
  variables: Variable[];
  revealed: Set<string>;
  onToggleReveal: (id: string) => void;
  onEdit: (v: Variable) => void;
  onDelete: (v: Variable) => void;
  readOnlyHint?: boolean;
}) {
  return (
    <div className="border border-panelBorder rounded-lg divide-y divide-panelBorder overflow-hidden">
      {variables.map((v) => (
        <div key={v.id} className="flex items-center gap-3 px-3 py-2.5">
          <code className="text-sm text-signal shrink-0 w-48 truncate">{v.key}</code>
          <code className="text-sm text-muted flex-1 truncate">
            {revealed.has(v.id) ? v.value : '•'.repeat(Math.min(v.value.length || 8, 24))}
          </code>
          <button
            onClick={() => onToggleReveal(v.id)}
            className="focus-ring text-[11px] text-muted hover:text-ink shrink-0"
          >
            {revealed.has(v.id) ? 'Hide' : 'Reveal'}
          </button>
          {!readOnlyHint && (
            <>
              <button onClick={() => onEdit(v)} className="focus-ring text-[11px] text-muted hover:text-ink shrink-0">
                Edit
              </button>
              <button
                onClick={() => onDelete(v)}
                className="focus-ring text-[11px] text-muted hover:text-red-400 shrink-0"
              >
                Delete
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
