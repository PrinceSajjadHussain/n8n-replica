import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface Connection {
  id: string;
  name: string;
  protocol: 'saml' | 'oidc' | 'ldap';
  isActive: boolean;
  createdAt: string;
}

const PROTOCOL_FIELDS: Record<Connection['protocol'], { key: string; label: string }[]> = {
  saml: [
    { key: 'entryPoint', label: 'IdP SSO URL (entryPoint)' },
    { key: 'issuer', label: 'SP issuer / entity ID' },
    { key: 'cert', label: 'IdP signing certificate (PEM)' },
    { key: 'callbackUrl', label: 'ACS callback URL' },
  ],
  oidc: [
    { key: 'issuer', label: 'Issuer URL' },
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret' },
    { key: 'authorizationURL', label: 'Authorization URL' },
    { key: 'tokenURL', label: 'Token URL' },
    { key: 'userInfoURL', label: 'Userinfo URL' },
    { key: 'redirectUri', label: 'Redirect URI' },
  ],
  ldap: [
    { key: 'url', label: 'LDAP URL (ldap://host:389)' },
    { key: 'bindDN', label: 'Service account bind DN' },
    { key: 'bindCredentials', label: 'Service account password' },
    { key: 'searchBase', label: 'Search base' },
    { key: 'searchFilter', label: 'Search filter (use {{username}})' },
  ],
};

export default function SsoSettingsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [protocol, setProtocol] = useState<Connection['protocol']>('saml');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const { data } = await api.get('/auth/sso/connections');
      setConnections(data.connections);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.status === 403 ? 'You need admin access to manage SSO.' : 'Failed to load SSO connections.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function create() {
    try {
      await api.post('/auth/sso/connections', { name: name || `${protocol.toUpperCase()} connection`, protocol, config });
      setName('');
      setConfig({});
      refresh();
    } catch {
      setError('Failed to create connection — check that all fields are filled in correctly.');
    }
  }

  async function toggle(id: string, isActive: boolean) {
    await api.patch(`/auth/sso/connections/${id}`, { isActive: !isActive });
    refresh();
  }

  async function remove(id: string) {
    await api.delete(`/auth/sso/connections/${id}`);
    refresh();
  }

  return (
    <div className="min-h-screen bg-canvas text-ink p-8 max-w-3xl mx-auto">
      <Link to="/workflows" className="text-sm text-muted hover:text-ink">
        ← Workflows
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-6">Single sign-on</h1>
      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="border border-panelBorder rounded-lg p-4 bg-panel mb-6">
        <h2 className="text-sm font-medium mb-3">Add a connection</h2>
        <div className="flex gap-2 mb-3">
          {(['saml', 'oidc', 'ldap'] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                setProtocol(p);
                setConfig({});
              }}
              className={`text-xs px-3 py-1.5 rounded-md border ${
                protocol === p ? 'border-signal text-signal bg-signal/10' : 'border-panelBorder'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
        <input
          className="w-full mb-2 px-3 py-1.5 text-sm rounded-md border border-panelBorder bg-transparent"
          placeholder="Connection name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {PROTOCOL_FIELDS[protocol].map((f) => (
          <input
            key={f.key}
            className="w-full mb-2 px-3 py-1.5 text-sm rounded-md border border-panelBorder bg-transparent"
            placeholder={f.label}
            value={config[f.key] ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
          />
        ))}
        <button onClick={create} className="focus-ring text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium">
          Save connection
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted border-b border-panelBorder">
            <th className="py-2">Name</th>
            <th>Protocol</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => (
            <tr key={c.id} className="border-b border-panelBorder/50">
              <td className="py-2">{c.name}</td>
              <td className="text-xs uppercase">{c.protocol}</td>
              <td className="text-xs">{c.isActive ? 'active' : 'disabled'}</td>
              <td className="flex gap-2 py-2">
                <button onClick={() => toggle(c.id, c.isActive)} className="text-xs text-muted hover:underline">
                  {c.isActive ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => remove(c.id)} className="text-xs text-red-400 hover:underline">
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
