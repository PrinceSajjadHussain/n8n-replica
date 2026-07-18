import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface FailedJob {
  id: string;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
  finishedOn: number | null;
}

/**
 * Dead-letter queue admin view (Phase 4). Surfaces BullMQ jobs that
 * exhausted their retry attempts — previously invisible outside a direct
 * Redis CLI session — with a one-click manual replay per job.
 */
export default function FailedJobsPage() {
  const [jobs, setJobs] = useState<FailedJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const { data } = await api.get('/queue/failed');
      setJobs(data.jobs);
      setError(null);
    } catch {
      setError('Failed to load the dead-letter queue.');
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, []);

  async function retry(jobId: string) {
    setRetryingId(jobId);
    setRetryMessage(null);
    try {
      await api.post(`/queue/failed/${jobId}/retry`);
      setRetryMessage(`Job ${jobId} re-queued.`);
      await refresh();
    } catch (err: any) {
      setRetryMessage(err?.response?.data?.error ?? `Failed to retry job ${jobId}.`);
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink p-8 max-w-5xl mx-auto">
      <Link to="/workflows" className="text-sm text-muted hover:text-ink">
        ← Workflows
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">Dead-letter queue</h1>
      <p className="text-sm text-muted mb-6">
        Jobs that exhausted their retry attempts before ever completing — an infrastructure-level failure (e.g. a
        Redis hiccup, a crashed worker, a missing workflow), not the same as a workflow that ran and a node inside
        it failed (see that workflow's own Execution History for those).
      </p>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
      {retryMessage && <p className="text-sm text-signal mb-4">{retryMessage}</p>}

      {jobs.length === 0 && !error && (
        <div className="border border-dashed border-panelBorder rounded-xl p-10 text-center">
          <p className="text-muted text-sm">Nothing in the dead-letter queue right now.</p>
        </div>
      )}

      {jobs.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-panelBorder">
              <th className="py-2">Job</th>
              <th>Type</th>
              <th>Attempts</th>
              <th>Failed reason</th>
              <th>Failed at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-panelBorder/60 align-top">
                <td className="py-2 font-mono text-xs text-muted">{job.id}</td>
                <td className="text-xs">{job.name}</td>
                <td className="text-xs">{job.attemptsMade}</td>
                <td className="text-xs text-alert max-w-md truncate" title={job.failedReason}>
                  {job.failedReason}
                </td>
                <td className="text-xs text-muted">
                  {job.finishedOn ? new Date(job.finishedOn).toLocaleString() : '—'}
                </td>
                <td>
                  <button
                    onClick={() => retry(job.id)}
                    disabled={retryingId === job.id}
                    className="focus-ring text-xs px-2 py-1 rounded border border-panelBorder hover:border-signal/50 transition disabled:opacity-40"
                  >
                    {retryingId === job.id ? 'Retrying…' : 'Retry'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
