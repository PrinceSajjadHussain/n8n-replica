import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';

interface Credential {
  id: string;
  type: string;
  createdAt: string;
}

const CREDENTIAL_TYPES = ['slack', 'httpBearer', 'email', 'googleSheets'] as const;

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<(typeof CREDENTIAL_TYPES)[number]>('slack');
  const [secretJson, setSecretJson] = useState('{\n  "webhookUrl": ""\n}');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await api.get('/credentials');
    setCredentials(data.credentials);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(secretJson);
    } catch {
      setError('Secret data must be valid JSON.');
      return;
    }
    try {
      await api.post('/credentials', { type, data: parsed });
      setShowForm(false);
      setSecretJson('{\n  "webhookUrl": ""\n}');
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

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-panel border border-panelBorder rounded-xl p-5 mb-6 space-y-4"
        >
          {error && (
            <div className="text-alert text-sm bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="block text-xs text-muted mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
            >
              {CREDENTIAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">
              Secret data (JSON — e.g. {`{ "apiKey": "..." }`})
            </label>
            <textarea
              value={secretJson}
              onChange={(e) => setSecretJson(e.target.value)}
              rows={5}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm font-display"
            />
          </div>
          <button
            type="submit"
            className="focus-ring bg-signal text-canvas text-sm font-medium px-4 py-2 rounded-md hover:brightness-110 transition"
          >
            Save credential
          </button>
        </form>
      )}

      <div className="grid gap-2">
        {credentials?.map((cred) => (
          <div
            key={cred.id}
            className="flex items-center justify-between bg-panel border border-panelBorder rounded-lg px-4 py-3"
          >
            <div>
              <span className="font-medium text-sm">{cred.type}</span>
              <p className="text-muted text-xs mt-0.5">
                Added {new Date(cred.createdAt).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => handleDelete(cred.id)}
              className="focus-ring text-xs text-muted hover:text-alert transition"
            >
              Delete
            </button>
          </div>
        ))}
        {credentials?.length === 0 && (
          <div className="border border-dashed border-panelBorder rounded-xl p-10 text-center">
            <p className="text-muted">No credentials saved yet.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
