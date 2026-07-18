import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type LogStreamEventType = 'started' | 'completed' | 'failed';

interface LogStreamConfig {
  id: string;
  workspaceId: string;
  name: string;
  targetUrl: string;
  eventTypes: LogStreamEventType[];
  isActive: boolean;
  createdAt: string;
}

const EVENT_TYPES: LogStreamEventType[] = ['started', 'completed', 'failed'];

/**
 * Workspace-wide operational log streaming, gated to admins/owners. Distinct
 * from the per-workflow "Alerts" panel: this forwards every execution's
 * started/completed/failed events across the whole workspace to an
 * external collector (Datadog, Sentry, Slack, a custom endpoint, ...).
 */
export default function LogStreamsPanel({ workspaceId }: { workspaceId: string }) {
  const [streams, setStreams] = useState<LogStreamConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [eventTypes, setEventTypes] = useState<LogStreamEventType[]>([...EVENT_TYPES]);

  async function load() {
    try {
      const { data } = await api.get(`/workspaces/${workspaceId}/log-streams`);
      setStreams(data.logStreams);
    } catch {
      setError('Could not load log streams.');
    }
  }

  useEffect(() => {
    setStreams(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  function toggleEventType(type: LogStreamEventType) {
    setEventTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !targetUrl.trim() || eventTypes.length === 0) return;
    try {
      await api.post(`/workspaces/${workspaceId}/log-streams`, { name: name.trim(), targetUrl: targetUrl.trim(), eventTypes });
      setName('');
      setTargetUrl('');
      setEventTypes([...EVENT_TYPES]);
      setShowNew(false);
      load();
    } catch (err: any) {
      setError(err.response?.data?.error?.formErrors?.[0] ?? err.response?.data?.error ?? 'Could not create log stream.');
    }
  }

  async function handleToggleActive(stream: LogStreamConfig) {
    await api.patch(`/workspaces/${workspaceId}/log-streams/${stream.id}`, { isActive: !stream.isActive });
    load();
  }

  async function handleDelete(stream: LogStreamConfig) {
    await api.delete(`/workspaces/${workspaceId}/log-streams/${stream.id}`);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-medium">Log streaming</h3>
          <p className="text-muted text-xs mt-0.5">
            Forward every workflow execution's start/finish/error events across this workspace to an external
            endpoint (Datadog, Sentry, Slack, or your own collector).
          </p>
        </div>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="focus-ring text-xs font-medium px-3 py-1.5 rounded-md border border-panelBorder hover:bg-panel transition"
        >
          {showNew ? 'Cancel' : 'Add target'}
        </button>
      </div>

      {error && <p className="text-alert text-xs mb-2">{error}</p>}

      {showNew && (
        <form onSubmit={handleCreate} className="bg-panel border border-panelBorder rounded-lg p-4 mb-3 grid gap-3">
          <div>
            <label className="text-xs text-muted block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Datadog logs"
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Target URL</label>
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://http-intake.logs.example.com/api/v2/logs"
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Events</label>
            <div className="flex gap-3">
              {EVENT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-xs capitalize">
                  <input type="checkbox" checked={eventTypes.includes(t)} onChange={() => toggleEventType(t)} />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <button
            type="submit"
            className="focus-ring bg-signal text-canvas text-sm font-medium px-4 py-2 rounded-md hover:brightness-110 transition justify-self-start"
          >
            Save target
          </button>
        </form>
      )}

      <div className="grid gap-2">
        {streams?.map((s) => (
          <div key={s.id} className="bg-panel border border-panelBorder rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm">{s.name}</p>
              <p className="text-muted text-xs mt-0.5">{s.targetUrl}</p>
              <p className="text-muted text-[10px] mt-0.5 uppercase tracking-wide">{s.eventTypes.join(' · ')}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleToggleActive(s)}
                className={`focus-ring text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${
                  s.isActive ? 'border-signal text-signal' : 'border-panelBorder text-muted'
                }`}
              >
                {s.isActive ? 'active' : 'paused'}
              </button>
              <button onClick={() => handleDelete(s)} className="focus-ring text-xs text-muted hover:text-alert transition">
                Remove
              </button>
            </div>
          </div>
        ))}
        {streams?.length === 0 && (
          <div className="border border-dashed border-panelBorder rounded-xl p-6 text-center">
            <p className="text-muted text-sm">No log streaming targets configured.</p>
          </div>
        )}
      </div>
    </div>
  );
}
