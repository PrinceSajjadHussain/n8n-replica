import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';
import ThemeToggle from './ThemeToggle';
import CommandPalette, { type CommandItem } from './CommandPalette';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [credentials, setCredentials] = useState<{ id: string; name?: string; type: string }[]>([]);

  const links = [
    { to: '/workflows', label: 'Workflows' },
    { to: '/workspaces', label: 'Workspaces' },
    { to: '/credentials', label: 'Credentials' },
    { to: '/variables', label: 'Variables' },
    { to: '/data-tables', label: 'Data Tables' },
    { to: '/templates', label: 'Templates' },
    { to: '/marketplace', label: 'Marketplace' },
  ];

  function handleLogout() {
    logout();
    navigate('/login');
  }

  // Cmd/Ctrl+K opens a global palette from anywhere in the app (outside the
  // canvas, which has its own richer palette with canvas-specific actions).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Data for the palette's search is fetched lazily the first time it's opened,
  // rather than on every page load, since most visits never touch Cmd+K.
  useEffect(() => {
    if (!paletteOpen) return;
    api
      .get('/workflows')
      .then(({ data }) => setWorkflows(data.workflows ?? []))
      .catch(() => {});
    api
      .get('/credentials')
      .then(({ data }) => setCredentials(data.credentials ?? []))
      .catch(() => {});
  }, [paletteOpen]);

  const commands = useMemo<CommandItem[]>(
    () => [
      ...links.map((link) => ({
        id: `nav-${link.to}`,
        label: link.label,
        group: 'Navigate',
        run: () => navigate(link.to),
      })),
      { id: 'nav-new-workflow', label: 'New workflow', group: 'Navigate', run: () => navigate('/workflows') },
      ...workflows.map((wf) => ({
        id: `workflow-${wf.id}`,
        label: wf.name,
        hint: 'Workflow',
        group: 'Workflows',
        run: () => navigate(`/workflows/${wf.id}`),
      })),
      ...credentials.map((c) => ({
        id: `credential-${c.id}`,
        label: c.name ?? c.type,
        hint: 'Credential',
        group: 'Credentials',
        run: () => navigate('/credentials'),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflows, credentials]
  );

  return (
    <div className="min-h-screen flex">
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        placeholder="Jump to a page, workflow, or credential…"
      />
      <aside className="w-56 border-r border-panelBorder bg-panel flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-panelBorder flex items-center justify-between">
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
          <button
            onClick={() => setPaletteOpen(true)}
            className="focus-ring w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-muted hover:text-ink hover:bg-canvas transition mt-1"
          >
            <span>Search…</span>
            <span className="text-[10px] border border-panelBorder rounded px-1.5 py-0.5">⌘K</span>
          </button>
        </nav>
        <div className="px-3 py-4 border-t border-panelBorder space-y-3">
          <div className="px-1">
            <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Theme</p>
            <ThemeToggle />
          </div>
          <div className="pt-2 border-t border-panelBorder">
            <p className="text-xs text-muted px-3 truncate">{user?.email}</p>
            <button
              onClick={handleLogout}
              className="focus-ring w-full text-left mt-1 px-3 py-2 rounded-md text-sm text-muted hover:text-alert hover:bg-canvas transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-8 py-8 overflow-auto">{children}</main>
    </div>
  );
}
