import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimit: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default function ApiTokensPage() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);

  async function refresh() {
    const { data } = await api.get('/admin/api-tokens');
    setTokens(data.tokens);
    setAvailableScopes(data.availableScopes);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createToken() {
    const { data } = await api.post('/admin/api-tokens', { name: name || 'Untitled token', scopes: scopes.length ? scopes : undefined });
    setNewToken(data.token);
    setName('');
    setScopes([]);
    refresh();
  }

  async function revoke(id: string) {
    await api.delete(`/admin/api-tokens/${id}`);
    refresh();
  }

  return (
    <div className="min-h-screen bg-canvas text-ink p-8 max-w-3xl mx-auto">
      <Link to="/workflows" className="text-sm text-muted hover:text-ink">
        ← Workflows
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-6">API tokens</h1>

      {newToken && (
        <div className="mb-6 p-4 rounded-md border border-amber/40 bg-amber/10 text-sm">
          <p className="font-medium mb-1">Copy this token now — it won't be shown again:</p>
          <code className="block bg-black/20 rounded px-2 py-1 break-all">{newToken}</code>
          <button className="text-xs text-muted mt-2 underline" onClick={() => setNewToken(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="border border-panelBorder rounded-lg p-4 bg-panel mb-6">
        <h2 className="text-sm font-medium mb-3">Create a new token</h2>
        <input
          className="w-full mb-2 px-3 py-1.5 text-sm rounded-md border border-panelBorder bg-transparent"
          placeholder="Token name (e.g. CI pipeline)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-wrap gap-2 mb-3">
          {availableScopes.map((s) => (
            <label key={s} className="text-xs flex items-center gap-1 border border-panelBorder rounded px-2 py-1">
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={(e) => setScopes((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))}
              />
              {s}
            </label>
          ))}
        </div>
        <button onClick={createToken} className="focus-ring text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium">
          Create token
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted border-b border-panelBorder">
            <th className="py-2">Name</th>
            <th>Prefix</th>
            <th>Scopes</th>
            <th>Last used</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.id} className="border-b border-panelBorder/50">
              <td className="py-2">{t.name}</td>
              <td>
                <code>{t.prefix}…</code>
              </td>
              <td className="text-xs">{t.scopes.join(', ')}</td>
              <td className="text-xs text-muted">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}</td>
              <td className="text-xs">{t.revokedAt ? 'revoked' : t.expiresAt && new Date(t.expiresAt) < new Date() ? 'expired' : 'active'}</td>
              <td>
                {!t.revokedAt && (
                  <button onClick={() => revoke(t.id)} className="text-xs text-red-400 hover:underline">
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
