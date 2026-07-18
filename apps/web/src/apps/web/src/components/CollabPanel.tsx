import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface VersionRow {
  id: string;
  version: number;
  status: 'draft' | 'published';
  message: string | null;
  createdBy: string;
  createdAt: string;
}

interface CommentRow {
  id: string;
  userEmail: string;
  body: string;
  nodeId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface AlertRow {
  id: string;
  channel: 'email' | 'webhook';
  target: string;
  onFailure: boolean;
  onSuccess: boolean;
  isActive: boolean;
}

interface ActivityRow {
  id: string;
  action: string;
  userEmail: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

type Diff = { added: unknown[]; removed: unknown[]; changed: unknown[] };

const TABS = ['Versions', 'Comments', 'Alerts', 'Activity'] as const;
type Tab = (typeof TABS)[number];

export default function CollabPanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('Versions');

  return (
    <div className="w-96 shrink-0 border-l border-panelBorder bg-panel flex flex-col h-full">
      <div className="h-14 border-b border-panelBorder flex items-center justify-between px-4 shrink-0">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`focus-ring text-xs px-2.5 py-1.5 rounded-md transition ${
                tab === t ? 'bg-signal/15 text-signal' : 'text-muted hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="focus-ring text-muted hover:text-ink text-sm px-2">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'Versions' && <VersionsTab workflowId={workflowId} />}
        {tab === 'Comments' && <CommentsTab workflowId={workflowId} />}
        {tab === 'Alerts' && <AlertsTab workflowId={workflowId} />}
        {tab === 'Activity' && <ActivityTab workflowId={workflowId} />}
      </div>
    </div>
  );
}

function VersionsTab({ workflowId }: { workflowId: string }) {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [diff, setDiff] = useState<Diff & { edges: Diff } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data } = await api.get(`/workflows/${workflowId}/versions`);
    setVersions(data);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  async function loadDiff(from: number, to: number) {
    setSelected([from, to]);
    const { data } = await api.get(`/workflows/${workflowId}/versions/diff`, { params: { from, to } });
    setDiff(data);
  }

  async function publish(version: number) {
    setBusy(`publish-${version}`);
    try {
      await api.post(`/workflows/${workflowId}/versions/${version}/publish`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function rollback(version: number) {
    setBusy(`rollback-${version}`);
    try {
      await api.post(`/workflows/${workflowId}/versions/${version}/rollback`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted mb-2">
        Every save creates a draft version. Publish makes it live; rollback re-publishes an older version.
      </p>
      {versions.map((v, i) => {
        const prev = versions[i + 1];
        return (
          <div key={v.id} className="rounded-md border border-panelBorder p-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">v{v.version}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                  v.status === 'published' ? 'text-signal border-signal/40 bg-signal/10' : 'text-muted border-panelBorder'
                }`}
              >
                {v.status}
              </span>
            </div>
            {v.message && <p className="text-xs text-muted mt-1">{v.message}</p>}
            <p className="text-[11px] text-muted mt-1">{new Date(v.createdAt).toLocaleString()}</p>
            <div className="flex gap-2 mt-2 flex-wrap">
              {v.status !== 'published' && (
                <button
                  disabled={busy === `publish-${v.version}`}
                  onClick={() => publish(v.version)}
                  className="focus-ring text-xs px-2 py-1 rounded border border-signal/40 text-signal hover:bg-signal/10"
                >
                  Publish
                </button>
              )}
              {v.status !== 'published' && (
                <button
                  disabled={busy === `rollback-${v.version}`}
                  onClick={() => rollback(v.version)}
                  className="focus-ring text-xs px-2 py-1 rounded border border-panelBorder hover:border-signal/50"
                >
                  Rollback to this
                </button>
              )}
              {prev && (
                <button
                  onClick={() => loadDiff(prev.version, v.version)}
                  className="focus-ring text-xs px-2 py-1 rounded border border-panelBorder hover:border-signal/50"
                >
                  Diff vs v{prev.version}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {versions.length === 0 && <p className="text-xs text-muted">No saved versions yet — hit Save to create one.</p>}

      {diff && selected && (
        <div className="mt-4 rounded-md border border-panelBorder p-2.5 text-xs space-y-2">
          <p className="font-medium">
            Diff v{selected[0]} → v{selected[1]}
          </p>
          <DiffSection label="Nodes added" items={diff.added} color="text-green-400" />
          <DiffSection label="Nodes removed" items={diff.removed} color="text-red-400" />
          <DiffSection label="Nodes changed" items={diff.changed} color="text-amber" />
        </div>
      )}
    </div>
  );
}

function DiffSection({ label, items, color }: { label: string; items: unknown[]; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className={`font-medium ${color}`}>
        {label} ({items.length})
      </p>
      <ul className="list-disc list-inside text-muted">
        {items.map((item, idx) => (
          <li key={idx}>{(item as { id?: string; label?: string })?.label ?? (item as { id?: string })?.id ?? JSON.stringify(item)}</li>
        ))}
      </ul>
    </div>
  );
}

function CommentsTab({ workflowId }: { workflowId: string }) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [body, setBody] = useState('');

  async function load() {
    const { data } = await api.get(`/workflows/${workflowId}/comments`);
    setComments(data.comments);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  async function submit() {
    if (!body.trim()) return;
    await api.post(`/workflows/${workflowId}/comments`, { body });
    setBody('');
    await load();
  }

  async function toggleResolve(c: CommentRow) {
    await api.patch(`/workflows/${workflowId}/comments/${c.id}/resolve`, { resolved: !c.resolvedAt });
    await load();
  }

  async function remove(c: CommentRow) {
    await api.delete(`/workflows/${workflowId}/comments/${c.id}`);
    await load();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Leave a comment…"
          className="focus-ring flex-1 bg-transparent border border-panelBorder rounded-md px-2 py-1.5 text-sm"
        />
        <button onClick={submit} className="focus-ring text-xs px-3 rounded-md border border-signal/40 text-signal hover:bg-signal/10">
          Post
        </button>
      </div>
      {comments.map((c) => (
        <div key={c.id} className={`rounded-md border border-panelBorder p-2.5 text-sm ${c.resolvedAt ? 'opacity-60' : ''}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{c.userEmail}</span>
            <span className="text-[11px] text-muted">{new Date(c.createdAt).toLocaleString()}</span>
          </div>
          <p className="mt-1">{c.body}</p>
          <div className="flex gap-2 mt-1.5">
            <button onClick={() => toggleResolve(c)} className="focus-ring text-[11px] text-muted hover:text-ink">
              {c.resolvedAt ? 'Reopen' : 'Resolve'}
            </button>
            <button onClick={() => remove(c)} className="focus-ring text-[11px] text-muted hover:text-red-400">
              Delete
            </button>
          </div>
        </div>
      ))}
      {comments.length === 0 && <p className="text-xs text-muted">No comments yet.</p>}
    </div>
  );
}

function AlertsTab({ workflowId }: { workflowId: string }) {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [channel, setChannel] = useState<'email' | 'webhook'>('email');
  const [target, setTarget] = useState('');

  async function load() {
    const { data } = await api.get(`/workflows/${workflowId}/alerts`);
    setAlerts(data.alerts);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  async function add() {
    if (!target.trim()) return;
    await api.post(`/workflows/${workflowId}/alerts`, { channel, target, onFailure: true });
    setTarget('');
    await load();
  }

  async function toggle(a: AlertRow) {
    await api.patch(`/workflows/${workflowId}/alerts/${a.id}`, { isActive: !a.isActive });
    await load();
  }

  async function remove(a: AlertRow) {
    await api.delete(`/workflows/${workflowId}/alerts/${a.id}`);
    await load();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Get notified when this workflow's execution fails.</p>
      <div className="flex gap-2">
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as 'email' | 'webhook')}
          className="focus-ring bg-transparent border border-panelBorder rounded-md px-2 py-1.5 text-xs"
        >
          <option value="email">Email</option>
          <option value="webhook">Webhook</option>
        </select>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={channel === 'email' ? 'you@example.com' : 'https://…'}
          className="focus-ring flex-1 bg-transparent border border-panelBorder rounded-md px-2 py-1.5 text-sm"
        />
        <button onClick={add} className="focus-ring text-xs px-3 rounded-md border border-signal/40 text-signal hover:bg-signal/10">
          Add
        </button>
      </div>
      {alerts.map((a) => (
        <div key={a.id} className="rounded-md border border-panelBorder p-2.5 text-sm flex items-center justify-between">
          <div>
            <p className="font-medium">{a.channel === 'email' ? '✉️' : '🔗'} {a.target}</p>
            <p className="text-[11px] text-muted">
              {a.onFailure ? 'on failure' : ''}
              {a.onFailure && a.onSuccess ? ' · ' : ''}
              {a.onSuccess ? 'on success' : ''}
              {!a.isActive ? ' · paused' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => toggle(a)} className="focus-ring text-[11px] text-muted hover:text-ink">
              {a.isActive ? 'Pause' : 'Resume'}
            </button>
            <button onClick={() => remove(a)} className="focus-ring text-[11px] text-muted hover:text-red-400">
              Delete
            </button>
          </div>
        </div>
      ))}
      {alerts.length === 0 && <p className="text-xs text-muted">No alerts configured.</p>}
    </div>
  );
}

function ActivityTab({ workflowId }: { workflowId: string }) {
  const [activity, setActivity] = useState<ActivityRow[]>([]);

  useEffect(() => {
    api.get(`/workflows/${workflowId}/activity`).then(({ data }) => setActivity(data.activity));
  }, [workflowId]);

  return (
    <div className="space-y-2">
      {activity.map((a) => (
        <div key={a.id} className="text-xs border-b border-panelBorder/60 pb-2">
          <p>
            <span className="text-ink">{a.userEmail ?? 'system'}</span>{' '}
            <span className="text-muted">{a.action.replace(/[._]/g, ' ')}</span>
          </p>
          <p className="text-[11px] text-muted">{new Date(a.createdAt).toLocaleString()}</p>
        </div>
      ))}
      {activity.length === 0 && <p className="text-xs text-muted">No activity yet.</p>}
    </div>
  );
}
