import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import EmptyState from '../components/EmptyState';
import FilterPillGroup from '../components/ui/FilterPillGroup';
import Badge from '../components/ui/Badge';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import FolderTree from '../components/FolderTree';
import { buildFolderTree, createFolder, deleteFolder, listFolders, moveWorkflowToFolder, renameFolder, type Folder } from '../lib/folders';

interface Workflow {
  id: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
  folderId?: string | null;
  workspaceId?: string | null;
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

  // --- Folder management -------------------------------------------------
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (workflows ?? []).forEach((wf) => {
      if (wf.folderId) counts[wf.folderId] = (counts[wf.folderId] ?? 0) + 1;
    });
    return counts;
  }, [workflows]);

  async function loadFolders(wsId: string) {
    try {
      setFolders(await listFolders(wsId));
    } catch {
      // Folder listing is optional chrome — a failed fetch just hides the sidebar tree.
    }
  }

  useEffect(() => {
    api
      .get('/workspaces')
      .then(({ data }) => {
        const ws = data.workspaces?.[0]?.id ?? null;
        if (ws) {
          setWorkspaceId(ws);
          loadFolders(ws);
        }
      })
      .catch(() => {});
  }, []);

  async function handleCreateFolder(parentId: string | null) {
    if (!workspaceId) return;
    const name = window.prompt(parentId ? 'New subfolder name' : 'New folder name');
    if (!name?.trim()) return;
    const folder = await createFolder(workspaceId, name.trim(), parentId);
    setFolders((prev) => [...prev, folder]);
  }

  async function handleRenameFolder(folderId: string, currentName: string) {
    const name = window.prompt('Rename folder', currentName);
    if (!name?.trim() || name === currentName) return;
    const updated = await renameFolder(folderId, name.trim());
    setFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));
  }

  async function handleDeleteFolder(folderId: string) {
    if (!window.confirm('Delete this folder? Workflows inside it will move back to "All workflows".')) return;
    await deleteFolder(folderId);
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setWorkflows((prev) => prev?.map((wf) => (wf.folderId === folderId ? { ...wf, folderId: null } : wf)) ?? null);
    if (selectedFolderId === folderId) setSelectedFolderId(null);
  }

  async function handleDropWorkflow(workflowId: string, folderId: string | null) {
    setWorkflows((prev) => prev?.map((wf) => (wf.id === workflowId ? { ...wf, folderId } : wf)) ?? null);
    try {
      await moveWorkflowToFolder(workflowId, folderId);
    } catch {
      load(activeTag);
    }
  }

  const visibleWorkflows = (workflows ?? []).filter((wf) => (selectedFolderId === null ? true : wf.folderId === selectedFolderId));

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

      <div className="flex items-start">
        {workspaceId && (
          <FolderTree
            nodes={folderTree}
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onCreateChild={handleCreateFolder}
            onRename={handleRenameFolder}
            onDelete={handleDeleteFolder}
            onDropWorkflow={handleDropWorkflow}
            counts={folderCounts}
          />
        )}

        <div className="flex-1 min-w-0">
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

          {workflows && workflows.length > 0 && visibleWorkflows.length === 0 && (
            <p className="text-muted text-sm">No workflows in this folder yet — drag one here from another folder.</p>
          )}

          <div className="grid gap-3">
            {visibleWorkflows.map((wf) => (
              <Card
                key={wf.id}
                hoverLift
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-flowforge-workflow', wf.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
              >
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
        </div>
      </div>
    </AppShell>
  );
}
