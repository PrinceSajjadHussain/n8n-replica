import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import EmptyState from '../components/EmptyState';
import FilterPillGroup from '../components/ui/FilterPillGroup';
import Badge from '../components/ui/Badge';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

interface Workflow {
  id: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
}

interface Tag {
  id: string;
  name: string;
}

export default function WorkflowsListPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // workflowId -> tag ids currently attached, loaded lazily per workflow.
  const [workflowTags, setWorkflowTags] = useState<Record<string, Tag[]>>({});
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');

  async function load(tagId?: string | null) {
    try {
      const { data } = await api.get('/workflows', tagId ? { params: { tag: tagId } } : undefined);
      setWorkflows(data.workflows);
      data.workflows.forEach((wf: Workflow) => loadWorkflowTags(wf.id));
    } catch {
      setError('Could not load your workflows.');
    }
  }

  async function loadTags() {
    try {
      const { data } = await api.get('/tags');
      setTags(data.tags);
    } catch {
      // Tag list is a nice-to-have — a failed fetch just means no filter/tag chips render.
    }
  }

  async function loadWorkflowTags(workflowId: string) {
    try {
      const { data } = await api.get(`/tags/workflows/${workflowId}`);
      setWorkflowTags((prev) => ({ ...prev, [workflowId]: data.tags }));
    } catch {
      // Ignore — tags are supplementary to the workflow list itself.
    }
  }

  useEffect(() => {
    loadTags();
  }, []);

  useEffect(() => {
    load(activeTag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTag]);

  async function createWorkflow() {
    const { data } = await api.post('/workflows', { name: 'Untitled workflow', nodes: [], edges: [] });
    navigate(`/workflows/${data.workflow.id}`);
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!name) return;
    try {
      const { data } = await api.post('/tags', { name });
      setTags((prev) => [...prev, data.tag].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTagName('');
    } catch {
      // A duplicate tag name (409) or other failure — leave the input as-is so the user can retry.
    }
  }

  async function toggleWorkflowTag(workflowId: string, tagId: string) {
    const current = workflowTags[workflowId] ?? [];
    const currentIds = current.map((t) => t.id);
    const nextIds = currentIds.includes(tagId) ? currentIds.filter((id) => id !== tagId) : [...currentIds, tagId];
    const { data } = await api.put(`/tags/workflows/${workflowId}`, { tagIds: nextIds });
    setWorkflowTags((prev) => ({ ...prev, [workflowId]: data.tags }));
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Workflows</h1>
        <Button onClick={createWorkflow}>+ New workflow</Button>
      </div>

      {tags.length > 0 && (
        <FilterPillGroup
          mode="single"
          options={tags.map((t) => ({ value: t.id, label: t.name }))}
          value={activeTag}
          onChange={setActiveTag}
          aria-label="Filter by tag"
          className="mb-4"
        />
      )}

      {error && <p className="text-alert text-sm">{error}</p>}

      {workflows === null && !error && <p className="text-muted text-sm">Loading…</p>}

      {workflows?.length === 0 && (
        <EmptyState
          icon="🗺"
          title={activeTag ? 'No workflows with this tag' : 'No workflows yet'}
          description={
            activeTag
              ? 'Try a different tag, or clear the filter to see every workflow.'
              : 'Workflows are how you automate anything in FlowForge — connect a trigger to a chain of actions and let it run itself.'
          }
          primaryAction={{ label: '+ New workflow', onClick: createWorkflow }}
          secondaryAction={{ label: 'Browse templates', to: '/templates' }}
        />
      )}

      <div className="grid gap-3">
        {workflows?.map((wf) => (
          <Card key={wf.id} hoverLift>
            <Link to={`/workflows/${wf.id}`} className="focus-ring block">
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
              <p className="text-muted text-xs mt-1">Updated {new Date(wf.updatedAt).toLocaleString()}</p>
            </Link>

            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {(workflowTags[wf.id] ?? []).map((t) => (
                <Badge key={t.id} variant="neutral">
                  {t.name}
                </Badge>
              ))}
              <button
                onClick={() => setEditingWorkflowId((id) => (id === wf.id ? null : wf.id))}
                className="focus-ring text-[11px] text-muted hover:text-signal transition-default"
              >
                {editingWorkflowId === wf.id ? 'Close' : '+ Edit tags'}
              </button>
            </div>

            {editingWorkflowId === wf.id && (
              <div className="mt-2 border-t border-panelBorder pt-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  {tags.map((t) => {
                    const active = (workflowTags[wf.id] ?? []).some((wt) => wt.id === t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => toggleWorkflowTag(wf.id, t.id)}
                        aria-pressed={active}
                        className={`focus-ring text-[11px] px-2 py-1 rounded-full border transition-default ${
                          active
                            ? 'bg-signal text-canvas border-signal font-medium'
                            : 'border-panelBorder text-muted hover:text-ink hover:border-ink/30'
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createTag()}
                    placeholder="New tag name…"
                    className="focus-ring text-xs bg-canvas border border-panelBorder rounded-md px-2 py-1"
                  />
                  <Button variant="secondary" className="text-xs px-2 py-1" onClick={createTag}>
                    Add tag
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
