import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';

interface Execution {
  id: string;
  status: 'running' | 'success' | 'failed';
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

const STATUS_COLOR: Record<string, string> = {
  success: 'text-signal border-signal/40 bg-signal/10',
  failed: 'text-alert border-alert/40 bg-alert/10',
  running: 'text-amber border-amber/40 bg-amber/10',
  skipped: 'text-muted border-panelBorder',
  pending: 'text-muted border-panelBorder',
};

export default function ExecutionHistoryPage() {
  const { id: workflowId } = useParams<{ id: string }>();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selected, setSelected] = useState<{ execution: Execution; nodeRuns: NodeRun[] } | null>(
    null
  );
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  async function load() {
    const { data } = await api.get(`/workflows/${workflowId}/executions`);
    setExecutions(data.executions);
  }

  useEffect(() => {
    load();
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
      </div>
      <h1 className="text-xl font-semibold mb-6">Execution history</h1>

      <div className="grid grid-cols-[1fr_2fr] gap-6 items-start">
        <div className="space-y-2">
          {executions.length === 0 && (
            <div className="border border-dashed border-panelBorder rounded-xl p-8 text-center">
              <p className="text-muted text-sm">No runs yet. Trigger the workflow to see history here.</p>
            </div>
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
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[exec.status]}`}>
                  {exec.status}
                </span>
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
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[run.status]}`}>
                      {run.status}
                    </span>
                  </button>
                  {expandedNode === run.id && (
                    <div className="px-4 pb-4 space-y-3 border-t border-panelBorder pt-3">
                      {run.error && (
                        <div className="text-alert text-xs bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
                          {run.error}
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] uppercase text-muted mb-1">Input</p>
                        <pre className="text-xs font-display bg-canvas rounded-md p-3 overflow-x-auto">
                          {JSON.stringify(run.input, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-muted mb-1">Output</p>
                        <pre className="text-xs font-display bg-canvas rounded-md p-3 overflow-x-auto">
                          {JSON.stringify(run.output, null, 2)}
                        </pre>
                      </div>
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
