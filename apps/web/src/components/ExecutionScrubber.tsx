import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface ExecutionSummary {
  id: string;
  status: 'running' | 'success' | 'failed' | 'paused' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  triggerType: string;
}

export interface HistoryNodeRun {
  nodeId: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const STATUS_DOT: Record<string, string> = {
  success: 'bg-signal',
  failed: 'bg-alert',
  running: 'bg-amber',
  paused: 'bg-muted',
  cancelled: 'bg-muted',
};

/**
 * Canvas-embedded execution history scrubber (section A's "persistent run
 * history scrubber"). Fetches the workflow's past executions, and on
 * selection fetches that execution's node runs and hands them up to
 * CanvasPage via `onReplay` so the canvas can render that run's per-node
 * status/timing/input/output — a read-only overlay on top of the live
 * canvas, without leaving the page.
 */
export default function ExecutionScrubber({
  workflowId,
  onReplay,
  onExit,
}: {
  workflowId: string;
  onReplay: (execution: ExecutionSummary, nodeRuns: HistoryNodeRun[]) => void;
  onExit: () => void;
}) {
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/workflows/${workflowId}/executions`)
      .then(({ data }) => {
        if (cancelled) return;
        const list: ExecutionSummary[] = data.executions ?? [];
        setExecutions(list);
        if (list.length === 0) setError('No past executions yet.');
      })
      .catch(() => !cancelled && setError('Failed to load execution history.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  useEffect(() => {
    const exec = executions[index];
    if (!exec) return;
    let cancelled = false;
    api
      .get(`/executions/${exec.id}`)
      .then(({ data }) => {
        if (cancelled) return;
        onReplay(exec, data.nodeRuns ?? []);
      })
      .catch(() => !cancelled && setError('Failed to load that execution.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executions, index]);

  const current = executions[index];

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-lg border border-panelBorder bg-panel/95 backdrop-blur-sm px-3 py-1.5 shadow-lg text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-muted uppercase tracking-wide text-[10px]">Replay</span>

      {loading && <span className="text-muted">Loading…</span>}
      {error && !loading && <span className="text-alert">{error}</span>}

      {!loading && current && (
        <>
          <button
            onClick={() => setIndex((i) => Math.min(executions.length - 1, i + 1))}
            disabled={index >= executions.length - 1}
            className="focus-ring px-1.5 py-0.5 rounded border border-panelBorder disabled:opacity-30"
            title="Older execution"
          >
            ‹
          </button>
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[current.status] ?? 'bg-muted'}`} />
          <span className="text-ink whitespace-nowrap">
            {current.triggerType} · {relativeTime(current.startedAt)}
          </span>
          <span className="text-muted">
            {index + 1}/{executions.length}
          </span>
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index <= 0}
            className="focus-ring px-1.5 py-0.5 rounded border border-panelBorder disabled:opacity-30"
            title="Newer execution"
          >
            ›
          </button>
        </>
      )}

      <button
        onClick={onExit}
        className="focus-ring ml-1 px-2 py-0.5 rounded border border-panelBorder text-muted hover:text-ink"
      >
        Exit replay
      </button>
    </div>
  );
}
