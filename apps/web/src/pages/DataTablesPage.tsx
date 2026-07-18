import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import EmptyState from '../components/EmptyState';

interface Column {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
}

interface DataTable {
  id: string;
  workspaceId: string;
  name: string;
  columns: Column[];
}

interface Row {
  id: string;
  dataTableId: string;
  data: Record<string, unknown>;
}

interface Workspace {
  id: string;
  name: string;
}

/** Browse/edit Data Table rows directly, like a mini spreadsheet — the
 *  Make.com "Data Store" UX. Node types `dataTableRead`/`dataTableWrite`
 *  (apps/worker/src/nodes/dataTableNode.ts) reference a table by
 *  (workspace, name), matching how credentials are referenced by type. */
export default function DataTablesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [tables, setTables] = useState<DataTable[]>([]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [showNewTable, setShowNewTable] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newColumns, setNewColumns] = useState('name, value');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get('/workspaces').then(({ data }) => {
      setWorkspaces(data.workspaces ?? []);
      if (data.workspaces?.[0]) setWorkspaceId(data.workspaces[0].id);
    });
  }, []);

  async function loadTables(wsId: string) {
    const { data } = await api.get('/data-tables', { params: { workspaceId: wsId } });
    setTables(data.dataTables);
    setActiveTableId(data.dataTables[0]?.id ?? null);
  }

  useEffect(() => {
    if (workspaceId) loadTables(workspaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function loadRows(tableId: string) {
    const { data } = await api.get(`/data-tables/${tableId}/rows`);
    setRows(data.rows);
  }

  useEffect(() => {
    if (activeTableId) loadRows(activeTableId);
    else setRows(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTableId]);

  const activeTable = useMemo(() => tables.find((t) => t.id === activeTableId) ?? null, [tables, activeTableId]);

  async function createTable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const columns: Column[] = newColumns
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((name) => ({ name, type: 'string' as const }));
      await api.post('/data-tables', { workspaceId, name: newTableName, columns });
      setShowNewTable(false);
      setNewTableName('');
      await loadTables(workspaceId);
    } catch (err: any) {
      setError(err.response?.data?.error?.formErrors?.[0] ?? err.response?.data?.error ?? 'Could not create table.');
    }
  }

  async function deleteTable(t: DataTable) {
    if (!confirm(`Delete Data Table "${t.name}" and all its rows? This can't be undone.`)) return;
    await api.delete(`/data-tables/${t.id}`);
    await loadTables(workspaceId);
  }

  async function addRow() {
    if (!activeTable) return;
    const data: Record<string, unknown> = {};
    for (const col of activeTable.columns) data[col.name] = '';
    await api.post(`/data-tables/${activeTable.id}/rows`, { data });
    await loadRows(activeTable.id);
  }

  async function updateCell(row: Row, column: string, value: string) {
    const nextData = { ...row.data, [column]: value };
    setRows((prev) => (prev ? prev.map((r) => (r.id === row.id ? { ...r, data: nextData } : r)) : prev));
    await api.patch(`/data-tables/${row.dataTableId}/rows/${row.id}`, { data: nextData });
  }

  async function deleteRow(row: Row) {
    await api.delete(`/data-tables/${row.dataTableId}/rows/${row.id}`);
    await loadRows(row.dataTableId);
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">Data Tables</h1>
          <p className="text-sm text-muted mt-1">
            A built-in key-value/tabular store — read and write rows from a workflow with the{' '}
            <span className="text-signal">Data Table: Get/List</span> and{' '}
            <span className="text-signal">Data Table: Insert/Update/Delete</span> nodes, no external DB credential
            needed.
          </p>
        </div>
        <select
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          className="focus-ring bg-transparent border border-panelBorder rounded-md px-2.5 py-1.5 text-sm shrink-0"
        >
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-6 min-h-0">
        <aside className="w-56 shrink-0 space-y-1">
          {tables.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTableId(t.id)}
              className={`focus-ring w-full text-left px-3 py-2 rounded-md text-sm transition ${
                activeTableId === t.id ? 'bg-signal/10 text-signal' : 'text-muted hover:text-ink hover:bg-panel'
              }`}
            >
              {t.name}
            </button>
          ))}
          <button
            onClick={() => setShowNewTable(true)}
            className="focus-ring w-full text-left px-3 py-2 rounded-md text-sm text-muted hover:text-ink hover:bg-panel transition"
          >
            + New table
          </button>
        </aside>

        <div className="flex-1 min-w-0">
          {tables.length === 0 && !showNewTable && (
            <EmptyState
              icon={<span>▦</span>}
              title="No Data Tables yet"
              description="Create one to give your workflows a simple built-in place to read and write rows — a queue, a dedupe list, a small lookup table."
              primaryAction={{ label: '+ New table', onClick: () => setShowNewTable(true) }}
            />
          )}

          {activeTable && rows && (
            <div className="border border-panelBorder rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-panelBorder bg-panel">
                <p className="text-sm font-medium">{activeTable.name}</p>
                <div className="flex gap-2">
                  <button onClick={addRow} className="focus-ring text-xs px-2.5 py-1 rounded border border-signal/40 text-signal hover:bg-signal/10">
                    + Row
                  </button>
                  <button
                    onClick={() => deleteTable(activeTable)}
                    className="focus-ring text-xs px-2.5 py-1 rounded border border-panelBorder text-muted hover:text-red-400"
                  >
                    Delete table
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-panelBorder text-left text-muted text-xs uppercase tracking-wider">
                      {activeTable.columns.map((c) => (
                        <th key={c.name} className="px-3 py-2 font-medium">
                          {c.name}
                        </th>
                      ))}
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-panelBorder/60 last:border-0">
                        {activeTable.columns.map((c) => (
                          <td key={c.name} className="px-1 py-1">
                            <input
                              defaultValue={String(row.data[c.name] ?? '')}
                              onBlur={(e) => updateCell(row, c.name, e.target.value)}
                              className="focus-ring w-full bg-transparent px-2 py-1.5 text-sm rounded hover:bg-panel"
                            />
                          </td>
                        ))}
                        <td className="px-2">
                          <button
                            onClick={() => deleteRow(row)}
                            className="focus-ring text-[11px] text-muted hover:text-red-400"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <p className="text-xs text-muted px-3 py-4">No rows yet — hit "+ Row" to add one.</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {showNewTable && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-panel border border-panelBorder rounded-xl p-5 w-full max-w-sm">
            <h3 className="font-medium mb-3">New Data Table</h3>
            <form onSubmit={createTable} className="space-y-3">
              <div>
                <label className="text-xs text-muted block mb-1">Table name</label>
                <input
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  required
                  className="focus-ring w-full bg-transparent border border-panelBorder rounded-md px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Columns (comma-separated)</label>
                <input
                  value={newColumns}
                  onChange={(e) => setNewColumns(e.target.value)}
                  className="focus-ring w-full bg-transparent border border-panelBorder rounded-md px-2.5 py-1.5 text-sm font-mono"
                />
              </div>
              {error && <p className="text-xs text-alert">{String(error)}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNewTable(false)}
                  className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="focus-ring text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
