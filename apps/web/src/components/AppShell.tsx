import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';
import ThemeToggle from './ThemeToggle';
import LanguageSwitcher from './LanguageSwitcher';
import CommandPalette, { type CommandItem } from './CommandPalette';
import TourGuide from './TourGuide';
import { useProductTour } from '../lib/productTour';
import { useIsMobile } from '../lib/useMediaQuery';
import ToastViewport from './ToastViewport';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [credentials, setCredentials] = useState<{ id: string; name?: string; type: string }[]>([]);
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tour = useProductTour();

  const links = [
    { to: '/workflows', label: t('nav.workflows'), tour: 'nav-workflows' },
    { to: '/workspaces', label: t('nav.workspaces'), tour: 'nav-workspaces' },
    { to: '/credentials', label: t('nav.credentials'), tour: 'nav-credentials' },
    { to: '/variables', label: t('nav.variables'), tour: 'nav-variables' },
    { to: '/data-tables', label: t('nav.dataTables'), tour: 'nav-dataTables' },
    { to: '/templates', label: t('nav.templates'), tour: 'nav-templates' },
    { to: '/marketplace', label: t('nav.marketplace'), tour: 'nav-marketplace' },
    { to: '/billing', label: t('nav.billing'), tour: 'nav-billing' },
  ];

  function handleLogout() {
    logout();
    navigate('/login');
  }

  // Close the mobile drawer whenever the route changes so it doesn't stay
  // open over the next page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

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
      { id: 'start-tour', label: 'Take a tour of FlowForge', group: 'Help', run: () => tour.start() },
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

  const sidebarContent = (
    <>
      <div className="px-5 py-5 border-b border-panelBorder flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-signal font-display text-xs tracking-widest uppercase">
          <span className="w-2 h-2 rounded-full bg-signal inline-block" />
          FlowForge
        </div>
        {isMobile && (
          <button onClick={() => setDrawerOpen(false)} className="focus-ring text-muted hover:text-ink text-lg leading-none" aria-label="Close menu">
            ✕
          </button>
        )}
      </div>
      <nav className="flex-1 min-h-0 px-3 py-4 space-y-1 overflow-y-auto">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            data-tour={link.tour}
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
          data-tour="nav-search"
          className="focus-ring w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-muted hover:text-ink hover:bg-canvas transition mt-1"
        >
          <span>{t('nav.search')}</span>
          <span className="text-[10px] border border-panelBorder rounded px-1.5 py-0.5">⌘K</span>
        </button>
        <button
          onClick={tour.start}
          data-tour="tour-welcome"
          className="focus-ring w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-muted hover:text-ink hover:bg-canvas transition"
        >
          <span>{t('nav.tour', 'Take a tour')}</span>
          <span aria-hidden>✨</span>
        </button>
      </nav>
      <div className="px-3 py-4 border-t border-panelBorder space-y-3">
        <div className="px-1">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-2">{t('nav.theme')}</p>
          <ThemeToggle />
        </div>
        <div className="px-1">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-2">{t('nav.language')}</p>
          <LanguageSwitcher />
        </div>
        <div className="pt-2 border-t border-panelBorder">
          <p className="text-xs text-muted px-3 truncate">{user?.email}</p>
          <button
            onClick={handleLogout}
            className="focus-ring w-full text-left mt-1 px-3 py-2 rounded-md text-sm text-muted hover:text-alert hover:bg-canvas transition"
          >
            {t('nav.signOut')}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="h-screen flex flex-col sm:flex-row overflow-hidden">
      <ToastViewport />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        placeholder="Jump to a page, workflow, or credential…"
      />

      {tour.isOpen && (
        <TourGuide
          steps={tour.steps}
          stepIndex={tour.stepIndex}
          onNext={tour.next}
          onBack={tour.back}
          onClose={tour.close}
          onNavigate={(route) => navigate(route)}
        />
      )}

      {isMobile ? (
        <>
          <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-panelBorder bg-panel">
            <button onClick={() => setDrawerOpen(true)} className="focus-ring text-lg leading-none" aria-label="Open menu">
              ☰
            </button>
            <div className="inline-flex items-center gap-2 text-signal font-display text-xs tracking-widest uppercase">
              <span className="w-2 h-2 rounded-full bg-signal inline-block" />
              FlowForge
            </div>
            <div className="w-6" />
          </header>
          {drawerOpen && (
            <div className="fixed inset-0 z-30 flex">
              <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
              <aside className="relative w-72 max-w-[85vw] bg-panel border-r border-panelBorder flex flex-col h-full">{sidebarContent}</aside>
            </div>
          )}
        </>
      ) : (
        <aside className="w-56 border-r border-panelBorder bg-panel flex flex-col shrink-0">{sidebarContent}</aside>
      )}

      <main className="flex-1 min-w-0 min-h-0 px-4 py-4 sm:px-8 sm:py-8 overflow-auto">{children}</main>
    </div>
  );
}
