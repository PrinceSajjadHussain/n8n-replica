import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import EmptyState from '../components/EmptyState';
import AgentTraceViewer from '../components/AgentTraceViewer';
import CitationViewer from '../components/CitationViewer';
import Badge from '../components/ui/Badge';
import Card from '../components/ui/Card';
import SegmentedToggle from '../components/ui/SegmentedToggle';

interface Execution {
  id: string;
  status: 'running' | 'success' | 'failed' | 'paused' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  triggerType: string;
}

interface NodeRun {
  id: string;
  nodeId: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

type ViewMode = 'table' | 'json' | 'schema';
const VIEW_MODES: ViewMode[] = ['table', 'json', 'schema'];

/** JS runtime type name used for the schema view, e.g. "string", "array", "null". */
function schemaType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Flattens an object/array one level for the table view: [key, value] pairs. Non-object values render as a single "value" row. */
function tableRows(value: unknown): Array<[string, unknown]> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => [String(i), v] as [string, unknown]);
  }
  return [['value', value]];
}

function cellPreview(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 80 ? json.slice(0, 80) + '…' : json;
  }
  return String(value);
}

/** Builds a shallow schema description: for objects, each key's runtime type; for arrays, the element type inferred from the first item. */
function schemaOf(value: unknown): Array<[string, string]> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, schemaType(v)]);
  }
  if (Array.isArray(value)) {
    return [['[]', value.length > 0 ? schemaType(value[0]) : 'unknown']];
  }
  return [['value', schemaType(value)]];
}

function DataView({ data, mode }: { data: unknown; mode: ViewMode }) {
  if (mode === 'json') {
    return (
      <pre className="text-xs font-display bg-canvas rounded-md p-3 overflow-x-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }
  if (mode === 'schema') {
    const rows = schemaOf(data);
    return (
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th className="font-normal pb-1 pr-3">Field</th>
            <th className="font-normal pb-1">Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, t]) => (
            <tr key={key} className="border-t border-panelBorder">
              <td className="py-1 pr-3 font-display text-ink">{key}</td>
              <td className="py-1 text-signal">{t}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  // table mode
  const rows = tableRows(data);
  if (rows.length === 0) {
    return <p className="text-muted text-xs">Empty.</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted">
          <th className="font-normal pb-1 pr-3">Key</th>
          <th className="font-normal pb-1">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, value]) => (
          <tr key={key} className="border-t border-panelBorder align-top">
            <td className="py-1 pr-3 font-display text-ink whitespace-nowrap">{key}</td>
            <td className="py-1 font-display text-muted break-all">{cellPreview(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <SegmentedToggle
      aria-label="View mode"
      options={VIEW_MODES.map((m) => ({ value: m, label: m }))}
      value={mode}
      onChange={onChange}
    />
  );
}

const STATUS_BADGE_VARIANT: Record<string, 'signal' | 'alert' | 'amber' | 'neutral'> = {
  success: 'signal',
  failed: 'alert',
  running: 'amber',
  paused: 'amber',
  skipped: 'neutral',
  pending: 'neutral',
};

/** True if `output` looks like a `ragQuery` node result (has a `citations` array). */
function hasCitations(output: unknown): boolean {
  return !!output && typeof output === 'object' && Array.isArray((output as Record<string, unknown>).citations);
}

/** True if `output` looks like an `agent`/`agentOrchestrator` node result (has a non-empty `trace` array). */
function hasAgentTrace(output: unknown): boolean {
  return (
    !!output &&
    typeof output === 'object' &&
    Array.isArray((output as Record<string, unknown>).trace) &&
    ((output as Record<string, unknown>).trace as unknown[]).length > 0
  );
}

export default function ExecutionHistoryPage() {
  const { id: workflowId } = useParams<{ id: string }>();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selected, setSelected] = useState<{ execution: Execution; nodeRuns: NodeRun[] } | null>(
    null
  );
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [retryBusyNodeId, setRetryBusyNodeId] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  // nodeId -> { type, params }, fetched once from the workflow's current
  // graph so "Explain failure" can send the AI real node context instead of
  // just the error string. Best-effort: a node deleted/renamed since the
  // run just falls back to a generic explanation (still asks the model,
  // just with less context).
  const [nodeMeta, setNodeMeta] = useState<Record<string, { type: string; params: Record<string, unknown> }>>({});
  const [explainBusyNodeId, setExplainBusyNodeId] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<
    Record<string, { diagnosis: string; likelyCause: string; suggestedFix: string; confidence: string } | { error: string }>
  >({});
  const [stats, setStats] = useState<{
    total: number;
    succeeded: number;
    failed: number;
    paused: number;
    running: number;
    successRate: number | null;
    avgRuntimeSeconds: number | null;
    recentFailures: Array<{ id: string; startedAt: string; errors: string | null }>;
  } | null>(null);

  async function loadStats() {
    const { data } = await api.get(`/executions/workflow/${workflowId}/stats`);
    setStats(data);
  }

  async function retryFromHere(nodeId: string) {
    if (!selected) return;
    setRetryBusyNodeId(nodeId);
    setRetryMessage(null);
    try {
      const { data } = await api.post(`/executions/${selected.execution.id}/retry-from/${nodeId}`);
      setRetryMessage(`Retry started as a new execution: ${data.executionId} (status: ${data.status})`);
      await load();
    } catch (err: any) {
      setRetryMessage(err?.response?.data?.error ?? 'Retry failed');
    } finally {
      setRetryBusyNodeId(null);
    }
  }

  async function load() {
    const { data } = await api.get(`/workflows/${workflowId}/executions`);
    setExecutions(data.executions);
  }

  async function loadNodeMeta() {
    try {
      const { data } = await api.get(`/workflows/${workflowId}`);
      const nodes = (data.workflow?.nodesJson ?? []) as Array<{ id: string; type: string; params?: Record<string, unknown> }>;
      const map: Record<string, { type: string; params: Record<string, unknown> }> = {};
      for (const n of nodes) map[n.id] = { type: n.type, params: n.params ?? {} };
      setNodeMeta(map);
    } catch {
      // Non-critical — "Explain failure" still works with a generic label if this fails.
    }
  }

  async function explainFailure(run: NodeRun) {
    setExplainBusyNodeId(run.id);
    try {
      const meta = nodeMeta[run.nodeId];
      const { data } = await api.post('/ai/explain-failure', {
        nodeType: meta?.type ?? run.nodeId,
        params: meta?.params ?? {},
        error: run.error ?? 'Unknown error',
        input: run.input,
      });
      setExplanations((prev) => ({ ...prev, [run.id]: data.diagnosis }));
    } catch (err: any) {
      setExplanations((prev) => ({
        ...prev,
        [run.id]: { error: err?.response?.data?.error ?? 'Failed to get an explanation' },
      }));
    } finally {
      setExplainBusyNodeId(null);
    }
  }

  useEffect(() => {
    load();
    loadStats();
    loadNodeMeta();
    const interval = setInterval(load, 4000); // light polling for status updates
    return () => clearInterval(interval);
  }, [workflowId]);

  async function viewExecution(exec: Execution) {
    const { data } = await api.get(`/executions/${exec.id}`);
    setSelected({ execution: data.execution, nodeRuns: data.nodeRuns });
    setExpandedNode(null);
  }

  function duration(exec: Execution): string {
    if (!exec.finishedAt) return '—';
    const ms = new Date(exec.finishedAt).getTime() - new Date(exec.startedAt).getTime();
    return `${ms}ms`;
  }

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/workflows/${workflowId}`} className="focus-ring text-muted hover:text-ink text-sm">
          ← Back to canvas
        </Link>
        <Link to={`/workflows/${workflowId}/tests`} className="focus-ring text-muted hover:text-ink text-sm">
          Workflow tests →
        </Link>
      </div>
      <h1 className="text-xl font-semibold mb-6">Execution history</h1>

      {stats && stats.total > 0 && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          <Card>
            <p className="text-[10px] uppercase text-muted">Success rate</p>
            <p className="text-lg font-semibold">
              {stats.successRate != null ? `${Math.round(stats.successRate * 100)}%` : '—'}
            </p>
          </Card>
          <Card>
            <p className="text-[10px] uppercase text-muted">Avg runtime</p>
            <p className="text-lg font-semibold">
              {stats.avgRuntimeSeconds != null ? `${stats.avgRuntimeSeconds.toFixed(1)}s` : '—'}
            </p>
          </Card>
          <Card>
            <p className="text-[10px] uppercase text-muted">Succeeded</p>
            <p className="text-lg font-semibold text-signal">{stats.succeeded}</p>
          </Card>
          <Card>
            <p className="text-[10px] uppercase text-muted">Failed</p>
            <p className="text-lg font-semibold text-alert">{stats.failed}</p>
          </Card>
          <Card>
            <p className="text-[10px] uppercase text-muted">Total runs</p>
            <p className="text-lg font-semibold">{stats.total}</p>
          </Card>
        </div>
      )}
      {retryMessage && (
        <div className="mb-4 text-xs px-3 py-2 rounded-md border border-signal/40 text-signal bg-signal/10">
          {retryMessage}
        </div>
      )}

      <div className="grid grid-cols-[1fr_2fr] gap-6 items-start">
        <div className="space-y-2">
          {executions.length === 0 && (
            <EmptyState
              icon="⏱"
              title="No runs yet"
              description="Once this workflow runs — manually, on a schedule, or from a trigger — every execution will show up here with full input/output detail."
              primaryAction={{ label: 'Open workflow canvas', to: `/workflows/${workflowId}` }}
            />
          )}
          {executions.map((exec) => (
            <button
              key={exec.id}
              onClick={() => viewExecution(exec)}
              className={`focus-ring w-full text-left bg-panel border rounded-lg px-4 py-3 transition ${
                selected?.execution.id === exec.id
                  ? 'border-signal/50'
                  : 'border-panelBorder hover:border-signal/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <Badge variant={STATUS_BADGE_VARIANT[exec.status] ?? 'neutral'}>{exec.status}</Badge>
                <span className="text-xs text-muted">{duration(exec)}</span>
              </div>
              <p className="text-xs text-muted mt-2">{new Date(exec.startedAt).toLocaleString()}</p>
              <p className="text-[11px] text-muted mt-0.5 uppercase tracking-wide">
                {exec.triggerType} trigger
              </p>
            </button>
          ))}
        </div>

        <div>
          {!selected && (
            <div className="border border-dashed border-panelBorder rounded-xl p-10 text-center">
              <p className="text-muted text-sm">Select a run to see its node-by-node timeline.</p>
            </div>
          )}
          {selected && (
            <div className="space-y-2">
              {selected.nodeRuns.map((run) => (
                <div key={run.id} className="bg-panel border border-panelBorder rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedNode(expandedNode === run.id ? null : run.id)}
                    className="focus-ring w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="text-sm font-medium">{run.nodeId}</span>
                    <Badge variant={STATUS_BADGE_VARIANT[run.status] ?? 'neutral'}>{run.status}</Badge>
                  </button>
                  {expandedNode === run.id && (
                    <div className="px-4 pb-4 space-y-3 border-t border-panelBorder pt-3">
                      {run.error && (
                        <div className="text-alert text-xs bg-alert/10 border border-alert/30 rounded-md px-3 py-2 space-y-2">
                          <p>{run.error}</p>
                          <button
                            onClick={() => explainFailure(run)}
                            disabled={explainBusyNodeId === run.id}
                            className="focus-ring text-[11px] px-2 py-1 rounded border border-alert/40 hover:bg-alert/10 transition disabled:opacity-40"
                          >
                            {explainBusyNodeId === run.id ? 'Asking AI…' : '✨ Explain failure'}
                          </button>
                          {explanations[run.id] && (
                            'error' in explanations[run.id] ? (
                              <p className="text-[11px] text-muted">{(explanations[run.id] as { error: string }).error}</p>
                            ) : (
                              (() => {
                                const d = explanations[run.id] as {
                                  diagnosis: string;
                                  likelyCause: string;
                                  suggestedFix: string;
                                  confidence: string;
                                };
                                return (
                                  <div className="text-ink bg-canvas border border-panelBorder rounded-md px-3 py-2 space-y-1">
                                    <p className="text-[10px] uppercase text-muted">
                                      Likely cause: {d.likelyCause} · confidence: {d.confidence}
                                    </p>
                                    <p>{d.diagnosis}</p>
                                    <p className="text-signal">Suggested fix: {d.suggestedFix}</p>
                                  </div>
                                );
                              })()
                            )
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-end">
                        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-muted mb-1">Input</p>
                        <div className="bg-canvas rounded-md p-3 overflow-x-auto">
                          <DataView data={run.input} mode={viewMode} />
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-muted mb-1">Output</p>
                        {hasAgentTrace(run.output) || hasCitations(run.output) ? (
                          <>
                            {hasAgentTrace(run.output) && <AgentTraceViewer data={run.output} />}
                            {hasCitations(run.output) && <CitationViewer data={run.output} />}
                            <details className="mt-1.5">
                              <summary className="text-[10px] uppercase text-muted cursor-pointer select-none">
                                Raw output
                              </summary>
                              <div className="bg-canvas rounded-md p-3 mt-1 overflow-x-auto">
                                <DataView data={run.output} mode={viewMode} />
                              </div>
                            </details>
                          </>
                        ) : (
                          <div className="bg-canvas rounded-md p-3 overflow-x-auto">
                            <DataView data={run.output} mode={viewMode} />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => retryFromHere(run.nodeId)}
                        disabled={retryBusyNodeId === run.nodeId}
                        className="focus-ring text-xs px-3 py-1.5 rounded-md border border-signal/40 text-signal hover:bg-signal/10 disabled:opacity-50"
                      >
                        {retryBusyNodeId === run.nodeId ? 'Starting…' : '↻ Retry from here'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}