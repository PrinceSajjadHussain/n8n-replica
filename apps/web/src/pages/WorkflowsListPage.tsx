import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import EmptyState from '../components/EmptyState';

interface Workflow {
  id: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
}

export default function WorkflowsListPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { data } = await api.get('/workflows');
      setWorkflows(data.workflows);
    } catch {
      setError('Could not load your workflows.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createWorkflow() {
    const { data } = await api.post('/workflows', { name: 'Untitled workflow', nodes: [], edges: [] });
    navigate(`/workflows/${data.workflow.id}`);
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Workflows</h1>
        <button
          onClick={createWorkflow}
          className="focus-ring bg-signal text-canvas text-sm font-medium px-4 py-2 rounded-md hover:brightness-110 transition"
        >
          + New workflow
        </button>
      </div>

      {error && <p className="text-alert text-sm">{error}</p>}

      {workflows === null && !error && <p className="text-muted text-sm">Loading…</p>}

      {workflows?.length === 0 && (
        <EmptyState
          icon="🗺"
          title="No workflows yet"
          description="Workflows are how you automate anything in FlowForge — connect a trigger to a chain of actions and let it run itself."
          primaryAction={{ label: '+ New workflow', onClick: createWorkflow }}
          secondaryAction={{ label: 'Browse templates', to: '/templates' }}
        />
      )}

      <div className="grid gap-3">
        {workflows?.map((wf) => (
          <Link
            key={wf.id}
            to={`/workflows/${wf.id}`}
            className="focus-ring block bg-panel border border-panelBorder rounded-lg px-4 py-3 hover:border-signal/50 transition"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{wf.name}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  wf.isActive
                    ? 'text-signal border-signal/40 bg-signal/10'
                    : 'text-muted border-panelBorder'
                }`}
              >
                {wf.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="text-muted text-xs mt-1">
              Updated {new Date(wf.updatedAt).toLocaleString()}
            </p>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
