import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface AuditEntry {
  id: string;
  action: string;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const { data } = await api.get('/admin/audit-log', { params: actionFilter ? { action: actionFilter } : {} });
      setEntries(data.entries);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.status === 403 ? 'You need admin access to view the audit log.' : 'Failed to load audit log.');
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter]);

  return (
    <div className="min-h-screen bg-canvas text-ink p-8 max-w-5xl mx-auto">
      <Link to="/workflows" className="text-sm text-muted hover:text-ink">
        ← Workflows
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-6">Audit log</h1>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <input
        className="mb-4 px-3 py-1.5 text-sm rounded-md border border-panelBorder bg-transparent w-72"
        placeholder="Filter by action (e.g. sso.connection_created)"
        value={actionFilter}
        onChange={(e) => setActionFilter(e.target.value)}
      />

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted border-b border-panelBorder">
            <th className="py-2">Time</th>
            <th>Action</th>
            <th>User</th>
            <th>IP</th>
            <th>Metadata</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-panelBorder/50 align-top">
              <td className="py-2 whitespace-nowrap text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</td>
              <td className="text-xs font-mono">{e.action}</td>
              <td className="text-xs">{e.userEmail ?? '—'}</td>
              <td className="text-xs">{e.ipAddress ?? '—'}</td>
              <td className="text-xs text-muted max-w-xs truncate">{e.metadata ? JSON.stringify(e.metadata) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
