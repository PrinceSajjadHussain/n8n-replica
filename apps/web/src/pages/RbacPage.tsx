import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface UserRow {
  id: string;
  email: string;
  systemRole: 'superadmin' | 'admin' | 'member';
  createdAt: string;
}

const ROLES: UserRow['systemRole'][] = ['member', 'admin', 'superadmin'];

export default function RbacPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const { data } = await api.get('/admin/users');
      setUsers(data.users);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.status === 403 ? 'You need admin access to view this page.' : 'Failed to load users.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function setRole(id: string, role: UserRow['systemRole']) {
    try {
      await api.put(`/admin/users/${id}/role`, { role });
      refresh();
    } catch {
      setError('Only a superadmin can change roles.');
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink p-8 max-w-3xl mx-auto">
      <Link to="/workflows" className="text-sm text-muted hover:text-ink">
        ← Workflows
      </Link>
      <h1 className="text-xl font-semibold mt-2 mb-6">Roles & permissions</h1>
      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted border-b border-panelBorder">
            <th className="py-2">Email</th>
            <th>Joined</th>
            <th>System role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-panelBorder/50">
              <td className="py-2">{u.email}</td>
              <td className="text-xs text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
              <td>
                <select
                  className="bg-transparent border border-panelBorder rounded px-2 py-1 text-sm"
                  value={u.systemRole}
                  onChange={(e) => setRole(u.id, e.target.value as UserRow['systemRole'])}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
