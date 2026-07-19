import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface TourStep {
  /** CSS selector for the element to spotlight, e.g. '[data-tour="nav-workflows"]'. */
  target: string;
  title: string;
  body: string;
  /** Where to place the tooltip relative to the target. Defaults to 'bottom'. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional route to navigate to before this step is shown. */
  route?: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;

/**
 * A minimal, dependency-free "spotlight" product tour: dims the page,
 * cuts a highlighted hole around the current step's target element, and
 * shows a small tooltip with Back/Next/Skip controls next to it.
 *
 * Deliberately simple (no positioning library) — recalculates the target's
 * bounding box on scroll/resize and whenever the step changes, which is
 * plenty robust for a handful of sidebar/toolbar targets.
 */
export default function TourGuide({
  steps,
  stepIndex,
  onNext,
  onBack,
  onClose,
  onNavigate,
}: {
  steps: TourStep[];
  stepIndex: number;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  onNavigate?: (route: string) => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const step = steps[stepIndex];

  // Navigate to the step's route first (e.g. jumping from Workflows to
  // Data Tables mid-tour), then let the next effect find + measure it.
  useEffect(() => {
    if (step?.route && onNavigate) onNavigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  useLayoutEffect(() => {
    if (!step) return;
    let raf = 0;
    function measure() {
      const el = document.querySelector(step.target);
      if (!el) {
        // Target not mounted yet (e.g. right after a route change) — retry
        // next frame instead of leaving the tour stuck with no spotlight.
        raf = requestAnimationFrame(measure);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNext();
      if (e.key === 'ArrowLeft') onBack();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  if (!step) return null;

  const isLast = stepIndex === steps.length - 1;
  const placement = step.placement ?? 'bottom';

  const tooltipStyle: React.CSSProperties = rect
    ? (() => {
        const base: React.CSSProperties = { position: 'fixed', maxWidth: 300, zIndex: 10001 };
        switch (placement) {
          case 'right':
            return { ...base, top: rect.top, left: rect.left + rect.width + 16 };
          case 'left':
            return { ...base, top: rect.top, left: Math.max(16, rect.left - 316) };
          case 'top':
            return { ...base, top: Math.max(16, rect.top - 16), left: rect.left, transform: 'translateY(-100%)' };
          default:
            return { ...base, top: rect.top + rect.height + 16, left: rect.left };
        }
      })()
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10001, maxWidth: 300 };

  return (
    <div className="fixed inset-0 z-[10000]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Dim everything, then punch a rounded hole around the target via box-shadow. */}
      <div
        className="fixed inset-0 transition-all duration-200"
        style={
          rect
            ? {
                top: rect.top - PADDING,
                left: rect.left - PADDING,
                width: rect.width + PADDING * 2,
                height: rect.height + PADDING * 2,
                borderRadius: 10,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
                pointerEvents: 'none',
              }
            : { boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)', pointerEvents: 'none' }
        }
      />
      {/* Click-catcher outside the tooltip closes nothing (avoid accidental dismiss); Skip button handles exit explicitly. */}
      <div
        ref={tooltipRef}
        style={tooltipStyle}
        className="bg-panel border border-panelBorder rounded-xl shadow-xl p-4 space-y-2 pointer-events-auto"
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-signal font-medium">
            Step {stepIndex + 1} of {steps.length}
          </span>
          <button onClick={onClose} className="focus-ring text-muted hover:text-ink text-xs" aria-label="Close tour">
            Skip
          </button>
        </div>
        <h3 className="font-medium text-sm">{step.title}</h3>
        <p className="text-xs text-muted leading-relaxed">{step.body}</p>
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={onBack}
            disabled={stepIndex === 0}
            className="focus-ring text-xs px-2.5 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted"
          >
            Back
          </button>
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === stepIndex ? 'bg-signal' : 'bg-panelBorder'}`}
              />
            ))}
          </div>
          <button
            onClick={onNext}
            className="focus-ring text-xs px-3 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110"
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
