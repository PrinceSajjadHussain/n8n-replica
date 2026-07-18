import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import LogStreamsPanel from '../components/LogStreamsPanel';
import { useAuthStore } from '../store/authStore';

type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  role: WorkspaceRole;
  createdAt: string;
}

interface Member {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
}

const ROLE_OPTIONS: Exclude<WorkspaceRole, 'owner'>[] = ['admin', 'editor', 'viewer'];

const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: 'Full control, including deleting the workspace. Cannot be reassigned here.',
  admin: 'Manage members, folders, and all workflows.',
  editor: 'Create and edit workflows and folders.',
  viewer: 'Read-only access to workflows and activity.',
};

export default function WorkspacesPage() {
  const { user } = useAuthStore();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, 'owner'>>('editor');

  async function loadWorkspaces() {
    const { data } = await api.get('/workspaces');
    const list: Workspace[] = data.workspaces;
    setWorkspaces(list);
    if (!activeId && list.length > 0) {
      setActiveId(list.find((w) => w.role === 'owner')?.id ?? list[0].id);
    }
  }

  async function loadMembers(workspaceId: string) {
    try {
      const { data } = await api.get(`/workspaces/${workspaceId}/members`);
      setMembers(data.members);
    } catch (err: any) {
      setMembers([]);
      setError(err.response?.data?.error ?? 'Could not load members.');
    }
  }

  useEffect(() => {
    loadWorkspaces();
  }, []);

  useEffect(() => {
    if (activeId) loadMembers(activeId);
  }, [activeId]);

  const active = useMemo(() => workspaces?.find((w) => w.id === activeId) ?? null, [workspaces, activeId]);
  const canManage = active?.role === 'owner' || active?.role === 'admin';

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    setError(null);
    try {
      const { data } = await api.post('/workspaces', { name: newWorkspaceName.trim() });
      setNewWorkspaceName('');
      setShowNewWorkspace(false);
      await loadWorkspaces();
      setActiveId(data.workspace.id);
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Could not create workspace.');
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !renameValue.trim()) return;
    setError(null);
    try {
      await api.patch(`/workspaces/${active.id}`, { name: renameValue.trim() });
      setRenaming(false);
      await loadWorkspaces();
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Could not rename workspace.');
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !inviteEmail.trim()) return;
    setError(null);
    setNotice(null);
    try {
      await api.post(`/workspaces/${active.id}/members`, { email: inviteEmail.trim(), role: inviteRole });
      setInviteEmail('');
      setNotice(`Added ${inviteEmail.trim()} as ${inviteRole}.`);
      await loadMembers(active.id);
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Could not add member. Make sure they already have a FlowForge account.');
    }
  }

  async function handleRoleChange(member: Member, role: Exclude<WorkspaceRole, 'owner'>) {
    if (!active) return;
    setError(null);
    try {
      await api.patch(`/workspaces/${active.id}/members/${member.userId}`, { role });
      await loadMembers(active.id);
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Could not update role.');
    }
  }

  async function handleRemove(member: Member) {
    if (!active) return;
    if (!confirm(`Remove ${member.email} from "${active.name}"?`)) return;
    setError(null);
    try {
      await api.delete(`/workspaces/${active.id}/members/${member.userId}`);
      await loadMembers(active.id);
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Could not remove member.');
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Workspaces</h1>
          <p className="text-muted text-sm mt-1">
            Group workflows and folders together and control who can view, edit, or manage them.
          </p>
        </div>
        <button
          onClick={() => setShowNewWorkspace((v) => !v)}
          className="focus-ring bg-signal text-canvas text-sm font-medium px-4 py-2 rounded-md hover:brightness-110 transition"
        >
          {showNewWorkspace ? 'Cancel' : '+ New workspace'}
        </button>
      </div>

      {notice && (
        <div className="text-sm bg-signal/10 border border-signal/30 rounded-md px-3 py-2 mb-4">{notice}</div>
      )}
      {error && (
        <div className="text-alert text-sm bg-alert/10 border border-alert/30 rounded-md px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {showNewWorkspace && (
        <form
          onSubmit={handleCreateWorkspace}
          className="bg-panel border border-panelBorder rounded-xl p-5 mb-6 flex items-end gap-3"
        >
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Workspace name</label>
            <input
              autoFocus
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder="e.g. Marketing Automations"
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="focus-ring bg-signal text-canvas text-sm font-medium px-4 py-2 rounded-md hover:brightness-110 transition"
          >
            Create
          </button>
        </form>
      )}

      <div className="grid grid-cols-[240px_1fr] gap-6">
        {/* Workspace list */}
        <div className="space-y-1">
          {workspaces?.map((w) => (
            <button
              key={w.id}
              onClick={() => {
                setActiveId(w.id);
                setRenaming(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-md transition ${
                activeId === w.id ? 'bg-signal/10 text-signal' : 'hover:bg-panel'
              }`}
            >
              <div className="text-sm font-medium truncate">{w.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted">{w.role}</div>
            </button>
          ))}
          {workspaces?.length === 0 && (
            <p className="text-muted text-xs px-3 py-2">No workspaces yet — create one to get started.</p>
          )}
        </div>

        {/* Active workspace detail */}
        <div>
          {!active ? (
            <div className="border border-dashed border-panelBorder rounded-xl p-10 text-center">
              <p className="text-muted">Select a workspace to manage its members.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-panel border border-panelBorder rounded-xl p-5">
                {renaming ? (
                  <form onSubmit={handleRename} className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="focus-ring bg-signal text-canvas text-xs font-medium px-3 py-2 rounded-md hover:brightness-110 transition"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(false)}
                      className="focus-ring text-xs text-muted hover:text-ink transition px-2"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-medium">{active.name}</h2>
                      <p className="text-muted text-xs mt-0.5">
                        Created {new Date(active.createdAt).toLocaleDateString()} · your role:{' '}
                        <span className="capitalize">{active.role}</span>
                      </p>
                    </div>
                    {canManage && (
                      <button
                        onClick={() => {
                          setRenameValue(active.name);
                          setRenaming(true);
                        }}
                        className="focus-ring text-xs text-muted hover:text-signal transition"
                      >
                        Rename
                      </button>
                    )}
                  </div>
                )}
              </div>

              {canManage && (
                <form
                  onSubmit={handleInvite}
                  className="bg-panel border border-panelBorder rounded-xl p-5 flex items-end gap-2"
                >
                  <div className="flex-1">
                    <label className="block text-xs text-muted mb-1">Invite by email</label>
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="teammate@company.com"
                      className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
                    />
                    <p className="text-muted text-[11px] mt-1">They must already have a FlowForge account.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Role</label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Exclude<WorkspaceRole, 'owner'>)}
                      className="focus-ring bg-canvas border border-panelBorder rounded-md px-2 py-2 text-sm"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="focus-ring bg-signal text-canvas text-sm font-medium px-4 py-2 rounded-md hover:brightness-110 transition"
                  >
                    Add member
                  </button>
                </form>
              )}

              <div>
                <h3 className="text-sm font-medium mb-2">Members</h3>
                <div className="grid gap-2">
                  {members?.map((m) => (
                    <div
                      key={m.id}
                      className="bg-panel border border-panelBorder rounded-lg px-4 py-3 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm">
                          {m.email}
                          {m.userId === user?.id && <span className="text-muted text-xs"> (you)</span>}
                        </p>
                        <p className="text-muted text-xs mt-0.5">{ROLE_DESCRIPTIONS[m.role]}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {canManage && m.role !== 'owner' ? (
                          <select
                            value={m.role}
                            onChange={(e) => handleRoleChange(m, e.target.value as Exclude<WorkspaceRole, 'owner'>)}
                            className="focus-ring bg-canvas border border-panelBorder rounded-md px-2 py-1.5 text-xs capitalize"
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wide text-muted border border-panelBorder rounded px-1.5 py-0.5">
                            {m.role}
                          </span>
                        )}
                        {canManage && m.role !== 'owner' && (
                          <button
                            onClick={() => handleRemove(m)}
                            className="focus-ring text-xs text-muted hover:text-alert transition"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {members?.length === 0 && (
                    <div className="border border-dashed border-panelBorder rounded-xl p-8 text-center">
                      <p className="text-muted text-sm">No members yet.</p>
                    </div>
                  )}
                </div>
              </div>

              {canManage && (
                <div className="pt-2 border-t border-panelBorder">
                  <LogStreamsPanel workspaceId={active.id} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
