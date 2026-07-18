import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const links = [
    { to: '/workflows', label: 'Workflows' },
    { to: '/workspaces', label: 'Workspaces' },
    { to: '/credentials', label: 'Credentials' },
  ];

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-panelBorder bg-panel flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-panelBorder">
          <div className="inline-flex items-center gap-2 text-signal font-display text-xs tracking-widest uppercase">
            <span className="w-2 h-2 rounded-full bg-signal inline-block" />
            FlowForge
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`focus-ring block px-3 py-2 rounded-md text-sm transition ${
                location.pathname.startsWith(link.to)
                  ? 'bg-signal/10 text-signal'
                  : 'text-muted hover:text-ink hover:bg-canvas'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-panelBorder">
          <p className="text-xs text-muted px-3 truncate">{user?.email}</p>
          <button
            onClick={handleLogout}
            className="focus-ring w-full text-left mt-1 px-3 py-2 rounded-md text-sm text-muted hover:text-alert hover:bg-canvas transition"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-8 py-8 overflow-auto">{children}</main>
    </div>
  );
}
