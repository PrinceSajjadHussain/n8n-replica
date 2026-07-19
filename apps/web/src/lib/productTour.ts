import { useEffect } from 'react';
import { create } from 'zustand';
import type { TourStep } from '../components/TourGuide';

const STORAGE_KEY = 'flowforge:tour:completed';

/**
 * The onboarding tour walks a newcomer through the main areas of the app in
 * the order they'd actually need them: build a workflow -> connect
 * credentials -> store shared config in Variables -> persist data in Data
 * Tables -> start faster from Templates -> extend with Marketplace nodes ->
 * understand plan/usage limits in Billing. Each step's `target` matches a
 * `data-tour="..."` attribute added to the corresponding nav link/element.
 */
export const APP_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="tour-welcome"]',
    title: 'Welcome to FlowForge',
    body: "Quick tour of where everything lives — about a minute, skip anytime with Esc. Let's start with Workflows.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="nav-workflows"]',
    title: 'Workflows',
    body: 'This is home base. A workflow is a trigger (webhook, schedule, chat message…) connected to a chain of action nodes. Click one to open the canvas and wire it up.',
    route: '/workflows',
  },
  {
    target: '[data-tour="nav-workspaces"]',
    title: 'Workspaces',
    body: 'Workspaces group workflows, credentials, and teammates together — useful for separating clients, environments, or departments.',
    route: '/workspaces',
  },
  {
    target: '[data-tour="nav-credentials"]',
    title: 'Credentials',
    body: 'Store API keys and OAuth connections once here, then reference them from any node (Slack, Stripe, GitHub, your own APIs...) without re-entering secrets.',
    route: '/credentials',
  },
  {
    target: '[data-tour="nav-variables"]',
    title: 'Variables',
    body: 'A key-value store for things you reuse everywhere — base URLs, timezones, feature flags. Any node expression can read one with {{$vars.KEY}}. FlowForge ships 50+ useful defaults out of the box.',
    route: '/variables',
  },
  {
    target: '[data-tour="nav-dataTables"]',
    title: 'Data Tables',
    body: "A built-in spreadsheet-like store — no external database needed. Good for queues, dedupe lists, or small lookup tables, with 25 column types to choose from (text, currency, date, select, geo point, and more).",
    route: '/data-tables',
  },
  {
    target: '[data-tour="nav-templates"]',
    title: 'Templates',
    body: 'Pre-built workflows you can clone and customize instead of starting from a blank canvas.',
    route: '/templates',
  },
  {
    target: '[data-tour="nav-marketplace"]',
    title: 'Marketplace',
    body: 'Install community nodes for extra integrations. Packages are pulled for real from npm, so only install ones you trust — it runs inside the worker process.',
    route: '/marketplace',
  },
  {
    target: '[data-tour="nav-billing"]',
    title: 'Billing & usage',
    body: "Track this period's executions against your plan limit, and upgrade when you need more headroom.",
    route: '/billing',
  },
  {
    target: '[data-tour="nav-search"]',
    title: 'Jump around fast',
    body: 'Press ⌘K (Ctrl+K on Windows/Linux) anywhere to search workflows, credentials, and pages instantly — faster than clicking through the sidebar.',
    placement: 'top',
  },
];

export function hasCompletedTour(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function markTourCompleted() {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // localStorage unavailable (private browsing, etc.) — tour just re-offers next visit, harmless.
  }
}

/**
 * Tour progress lives in a module-level zustand store rather than
 * component `useState`. `AppShell` — the component that drives the tour —
 * is rendered *inside* every individual page (see `App.tsx`: each `<Route>`
 * renders a page that wraps itself in `<AppShell>`), so it fully unmounts
 * and remounts on every navigation. Any step with a `route` (most of them)
 * triggers a `navigate()` call, which used to blow away local `isOpen`/
 * `stepIndex` state along with the rest of `AppShell` — the tour would
 * silently reset to step 0 (and, since it was never marked complete,
 * immediately auto-reopen) the moment it tried to advance past the first
 * step. Keeping the state in a store outside the component tree makes it
 * survive that remount.
 */
interface TourState {
  isOpen: boolean;
  stepIndex: number;
  /** Guards the auto-offer effect so it only ever fires once per page load, not once per AppShell remount. */
  autoOfferAttempted: boolean;
  start: () => void;
  close: () => void;
  next: () => void;
  back: () => void;
  attemptAutoOffer: () => void;
}

const useTourStore = create<TourState>((set, get) => ({
  isOpen: false,
  stepIndex: 0,
  autoOfferAttempted: false,
  start: () => set({ stepIndex: 0, isOpen: true }),
  close: () => {
    markTourCompleted();
    set({ isOpen: false });
  },
  next: () => {
    const { stepIndex } = get();
    if (stepIndex + 1 >= APP_TOUR_STEPS.length) {
      markTourCompleted();
      set({ isOpen: false });
      return;
    }
    set({ stepIndex: stepIndex + 1 });
  },
  back: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  attemptAutoOffer: () => {
    if (get().autoOfferAttempted) return;
    set({ autoOfferAttempted: true });
    if (hasCompletedTour()) return;
    set({ stepIndex: 0, isOpen: true });
  },
}));

/** Drives the tour's open/step state and offers it once per page load for brand-new users. */
export function useProductTour() {
  const { isOpen, stepIndex, start, close, next, back, attemptAutoOffer } = useTourStore();

  // Auto-offer the tour once per page load for brand-new users, a beat
  // after first paint so the shell has mounted and targets exist in the
  // DOM. `attemptAutoOffer` no-ops on subsequent AppShell remounts (i.e.
  // every navigation) via the `autoOfferAttempted` guard above.
  useEffect(() => {
    const timer = setTimeout(() => attemptAutoOffer(), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOpen, stepIndex, start, close, next, back, steps: APP_TOUR_STEPS };
}