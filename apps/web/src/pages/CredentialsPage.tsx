import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import EmptyState from '../components/EmptyState';
import Badge from '../components/ui/Badge';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import CredentialFieldsForm from '../components/CredentialFieldsForm';
import {
  CREDENTIAL_TYPES,
  CREDENTIAL_FIELDS,
  CREDENTIAL_TYPE_META,
  defaultFieldValues,
  type CredentialType,
} from '../lib/credentialSchemas';

interface Credential {
  id: string;
  name: string;
  type: string;
  authType: 'apiKey' | 'oauth2';
  folderId: string | null;
  oauthProvider: string | null;
  oauthExpiresAt: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  createdAt: string;
  owner?: { id: string; email: string };
  access: 'owner' | 'manage' | 'use';
}

interface Folder {
  id: string;
  name: string;
}

interface OAuthProviderInfo {
  id: string;
  displayName: string;
  configured: boolean;
}

interface Share {
  id: string;
  sharedWithUserId: string;
  sharedWithEmail: string;
  permission: 'use' | 'manage';
}

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>('all');
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<CredentialType>('slack');
  const [name, setName] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(defaultFieldValues('slack'));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedJson, setAdvancedJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [sharingCredential, setSharingCredential] = useState<Credential | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);

  async function load() {
    const [{ data: credData }, { data: folderData }, { data: providerData }] = await Promise.all([
      api.get('/credentials'),
      api.get('/credentials/folders'),
      api.get('/credentials/oauth/providers'),
    ]);
    setCredentials(credData.credentials);
    setFolders(folderData.folders);
    setOauthProviders(providerData.providers);
  }

  useEffect(() => {
    load();
    // Handle redirect back from an OAuth provider callback.
    const params = new URLSearchParams(window.location.search);
    const success = params.get('oauth_success');
    const oauthError = params.get('oauth_error');
    if (success) setNotice(`Connected to ${success} successfully.`);
    if (oauthError) setError(`OAuth connection failed: ${oauthError.replace(/_/g, ' ')}`);
    if (success || oauthError) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function handleConnect(providerId: string) {
    setError(null);
    try {
      const { data } = await api.get(`/credentials/oauth/${providerId}/authorize`);
      window.location.href = data.authorizeUrl;
    } catch (err: any) {
      setError(err.response?.data?.error ?? `Could not start ${providerId} connection.`);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let data: Record<string, unknown>;
    if (showAdvanced) {
      try {
        data = JSON.parse(advancedJson || '{}');
      } catch {
        setError('Secret data must be valid JSON.');
        return;
      }
    } else {
      const fields = CREDENTIAL_FIELDS[type];
      for (const field of fields) {
        if (field.fieldType === 'info') continue;
        if (field.required && !fieldValues[field.key]?.trim()) {
          setError(`"${field.label}" is required.`);
          return;
        }
      }
      data = {};
      for (const field of fields) {
        if (field.fieldType === 'info') continue;
        const value = fieldValues[field.key]?.trim();
        if (value) data[field.key] = value;
      }
    }

    try {
      await api.post('/credentials', {
        type,
        name: name || undefined,
        data,
        folderId: activeFolderId && activeFolderId !== 'all' ? activeFolderId : null,
      });
      setShowForm(false);
      setName('');
      setFieldValues(defaultFieldValues(type));
      setShowAdvanced(false);
      setAdvancedJson('');
      load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Could not save credential.');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this credential? Workflows using it will fail until reconfigured.')) return;
    await api.delete(`/credentials/${id}`);
    load();
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      await api.post(`/credentials/${id}/test`);
      load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Test connection failed.');
    } finally {
      setTestingId(null);
    }
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await api.post('/credentials/folders', { name: newFolderName.trim() });
    setNewFolderName('');
    setShowNewFolder(false);
    load();
  }

  async function handleDeleteFolder(id: string) {
    if (!confirm('Delete this folder? Credentials inside it will become unfiled, not deleted.')) return;
    await api.delete(`/credentials/folders/${id}`);
    if (activeFolderId === id) setActiveFolderId('all');
    load();
  }

  const visibleCredentials = useMemo(() => {
    if (!credentials) return null;
    if (activeFolderId === 'all') return credentials;
    if (activeFolderId === 'shared') return credentials.filter((c) => c.access !== 'owner');
    return credentials.filter((c) => c.folderId === activeFolderId);
  }, [credentials, activeFolderId]);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Credentials</h1>
          <p className="text-muted text-sm mt-1">
            Secret values are encrypted at rest and never shown again after saving.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="focus-ring bg-signal text-canvas text-sm font-medium px-4 py-2 rounded-md hover:brightness-110 transition"
        >
          {showForm ? 'Cancel' : '+ Add credential'}
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

      {/* OAuth connect buttons */}
      <div className="bg-panel border border-panelBorder rounded-xl p-5 mb-6">
        <h2 className="text-sm font-medium mb-3">Connect an account</h2>
        <div className="flex flex-wrap gap-2">
          {oauthProviders.map((p) => {
            const oauthColors: Record<string, string> = { google: '#4285F4', slack: '#4A154B', github: '#24292F' };
            return (
              <button
                key={p.id}
                onClick={() => handleConnect(p.id)}
                disabled={!p.configured}
                title={p.configured ? undefined : `Set ${p.id.toUpperCase()}_OAUTH_CLIENT_ID / SECRET on the server to enable this.`}
                className="focus-ring flex items-center gap-2 border border-panelBorder rounded-md px-4 py-2 text-sm font-medium hover:bg-canvas transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span
                  className="w-4 h-4 rounded-full inline-block shrink-0"
                  style={{ background: oauthColors[p.id] ?? '#6B7280' }}
                />
                Connect with {p.displayName}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-6">
        {/* Folder sidebar */}
        <div className="space-y-1">
          <button
            onClick={() => setActiveFolderId('all')}
            className={`w-full text-left text-sm px-3 py-2 rounded-md transition ${
              activeFolderId === 'all' ? 'bg-signal/10 text-signal' : 'hover:bg-panel'
            }`}
          >
            All credentials
          </button>
          <button
            onClick={() => setActiveFolderId('shared')}
            className={`w-full text-left text-sm px-3 py-2 rounded-md transition ${
              activeFolderId === 'shared' ? 'bg-signal/10 text-signal' : 'hover:bg-panel'
            }`}
          >
            Shared with me
          </button>
          <div className="pt-2 pb-1 px-3 text-xs uppercase tracking-wide text-muted">Folders</div>
          {folders.map((f) => (
            <div key={f.id} className="group flex items-center">
              <button
                onClick={() => setActiveFolderId(f.id)}
                className={`flex-1 text-left text-sm px-3 py-2 rounded-md transition truncate ${
                  activeFolderId === f.id ? 'bg-signal/10 text-signal' : 'hover:bg-panel'
                }`}
              >
                {f.name}
              </button>
              <button
                onClick={() => handleDeleteFolder(f.id)}
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-alert text-xs px-2 transition"
              >
                ✕
              </button>
            </div>
          ))}
          {showNewFolder ? (
            <form onSubmit={handleCreateFolder} className="px-3 pt-1">
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={() => !newFolderName && setShowNewFolder(false)}
                placeholder="Folder name"
                className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs"
              />
            </form>
          ) : (
            <button
              onClick={() => setShowNewFolder(true)}
              className="w-full text-left text-xs text-muted hover:text-signal px-3 py-2 transition"
            >
              + New folder
            </button>
          )}
        </div>

        <div>
          {showForm && (
            <form
              onSubmit={handleCreate}
              className="bg-panel border border-panelBorder rounded-xl p-5 mb-6 space-y-4"
            >
              <div>
                <label className="block text-xs text-muted mb-1">Name (optional)</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Team Slack webhook"
                  className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Type</label>
                <select
                  value={type}
                  onChange={(e) => {
                    const next = e.target.value as CredentialType;
                    setType(next);
                    setFieldValues(defaultFieldValues(next));
                    setShowAdvanced(false);
                    setAdvancedJson('');
                  }}
                  className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
                >
                  {CREDENTIAL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CREDENTIAL_TYPE_META[t].label}
                    </option>
                  ))}
                </select>
              </div>

              {!showAdvanced ? (
                <div className="space-y-3">
                  <CredentialFieldsForm type={type} values={fieldValues} onChange={setFieldValues} />
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdvanced(true);
                      setAdvancedJson(JSON.stringify(fieldValues, null, 2));
                    }}
                    className="focus-ring text-xs text-muted hover:text-signal transition"
                  >
                    Edit as raw JSON instead
                  </button>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-muted mb-1">Secret data (JSON)</label>
                  <textarea
                    value={advancedJson}
                    onChange={(e) => setAdvancedJson(e.target.value)}
                    rows={5}
                    className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm font-display"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(false)}
                    className="focus-ring text-xs text-muted hover:text-signal transition mt-2"
                  >
                    ← Back to form fields
                  </button>
                </div>
              )}

              <button
                type="submit"
                className="focus-ring bg-signal text-canvas text-sm font-medium px-4 py-2 rounded-md hover:brightness-110 transition"
              >
                Save credential
              </button>
            </form>
          )}

          <div className="grid gap-2">
            {visibleCredentials?.map((cred) => (
              <Card key={cred.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ background: CREDENTIAL_TYPE_META[cred.type as CredentialType]?.color ?? '#6B7280' }}
                        title={cred.type}
                      >
                        {CREDENTIAL_TYPE_META[cred.type as CredentialType]?.letter ?? '?'}
                      </span>
                      <span className="font-medium text-sm">{cred.name}</span>
                      <Badge variant="neutral">
                        {CREDENTIAL_TYPE_META[cred.type as CredentialType]?.label ?? cred.type}
                      </Badge>
                      {cred.authType === 'oauth2' && <Badge variant="signal">OAuth2</Badge>}
                      {cred.access !== 'owner' && (
                        <Badge variant="neutral">
                          Shared by {cred.owner?.email} · {cred.access}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted text-xs mt-0.5">
                      Added {new Date(cred.createdAt).toLocaleDateString()}
                      {cred.lastTestedAt && (
                        <>
                          {' · '}
                          <span className={cred.lastTestOk ? 'text-signal' : 'text-alert'}>
                            {cred.lastTestOk ? 'Connected' : 'Failed'}
                          </span>{' '}
                          ({new Date(cred.lastTestedAt).toLocaleString()})
                        </>
                      )}
                    </p>
                    {cred.lastTestMessage && (
                      <p className="text-muted text-xs mt-1 max-w-lg">{cred.lastTestMessage}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={() => handleTest(cred.id)} loading={testingId === cred.id}>
                      {testingId === cred.id ? 'Testing…' : 'Test connection'}
                    </Button>
                    {cred.access === 'owner' && (
                      <button
                        onClick={() => setSharingCredential(cred)}
                        className="focus-ring text-xs text-muted hover:text-signal transition-default"
                      >
                        Share
                      </button>
                    )}
                    {cred.access === 'owner' && (
                      <button
                        onClick={() => handleDelete(cred.id)}
                        className="focus-ring text-xs text-muted hover:text-alert transition-default"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
            {visibleCredentials?.length === 0 && (
              <EmptyState
                icon="🔑"
                title="No credentials here yet"
                description="Credentials securely store the API keys and tokens your workflows need to talk to Slack, GitHub, Postgres, and more."
                primaryAction={{ label: '+ Add credential', onClick: () => setShowForm(true) }}
              />
            )}
          </div>
        </div>
      </div>

      {sharingCredential && (
        <ShareModal credential={sharingCredential} onClose={() => setSharingCredential(null)} />
      )}
    </AppShell>
  );
}

function ShareModal({ credential, onClose }: { credential: Credential; onClose: () => void }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'use' | 'manage'>('use');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await api.get(`/credentials/${credential.id}/shares`);
    setShares(data.shares);
  }

  useEffect(() => {
    load();
  }, [credential.id]);

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/credentials/${credential.id}/shares`, { email, permission });
      setEmail('');
      load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Could not share credential.');
    }
  }

  async function handleUnshare(userId: string) {
    await api.delete(`/credentials/${credential.id}/shares/${userId}`);
    load();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-panel border border-panelBorder rounded-xl p-6 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Share "{credential.name}"</h3>
          <button onClick={onClose} className="text-muted hover:text-alert text-sm">
            ✕
          </button>
        </div>
        <p className="text-muted text-xs">
          Teammates you share with can use this credential in their workflows without ever seeing the
          secret value. "Manage" also lets them rename, move, or re-share it.
        </p>

        {error && (
          <div className="text-alert text-sm bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={handleShare} className="flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
          />
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value as any)}
            className="focus-ring bg-canvas border border-panelBorder rounded-md px-2 py-2 text-sm"
          >
            <option value="use">Use</option>
            <option value="manage">Manage</option>
          </select>
          <button
            type="submit"
            className="focus-ring bg-signal text-canvas text-sm font-medium px-3 py-2 rounded-md hover:brightness-110 transition"
          >
            Share
          </button>
        </form>

        <div className="space-y-2 max-h-56 overflow-y-auto">
          {shares?.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between bg-canvas border border-panelBorder rounded-md px-3 py-2"
            >
              <div>
                <p className="text-sm">{s.sharedWithEmail}</p>
                <p className="text-muted text-xs capitalize">{s.permission} access</p>
              </div>
              <button
                onClick={() => handleUnshare(s.sharedWithUserId)}
                className="text-xs text-muted hover:text-alert transition"
              >
                Remove
              </button>
            </div>
          ))}
          {shares?.length === 0 && <p className="text-muted text-xs text-center py-4">Not shared with anyone yet.</p>}
        </div>
      </div>
    </div>
  );
}
