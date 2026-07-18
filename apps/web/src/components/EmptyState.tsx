import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface EmptyStateAction {
  label: string;
  to?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
}

/** Friendly onboarding-style empty state (Make-like tone) reused across
 *  workflows / credentials / executions / any other "nothing here yet"
 *  screen, instead of a bare line of muted text. */
export default function EmptyState({ icon, title, description, primaryAction, secondaryAction }: EmptyStateProps) {
  return (
    <div className="border border-dashed border-panelBorder rounded-xl px-8 py-12 text-center flex flex-col items-center gap-3 bg-panel/40">
      <span
        className="w-12 h-12 rounded-full flex items-center justify-center text-xl bg-signal/10 text-signal border border-signal/20"
        aria-hidden
      >
        {icon}
      </span>
      <h3 className="font-medium text-ink">{title}</h3>
      <p className="text-sm text-muted max-w-sm">{description}</p>
      {(primaryAction || secondaryAction) && (
        <div className="flex items-center gap-2 mt-2">
          {primaryAction &&
            (primaryAction.to ? (
              <Link
                to={primaryAction.to}
                className="focus-ring text-sm px-4 py-2 rounded-md bg-signal text-canvas font-medium hover:brightness-110 transition"
              >
                {primaryAction.label}
              </Link>
            ) : (
              <button
                onClick={primaryAction.onClick}
                className="focus-ring text-sm px-4 py-2 rounded-md bg-signal text-canvas font-medium hover:brightness-110 transition"
              >
                {primaryAction.label}
              </button>
            ))}
          {secondaryAction &&
            (secondaryAction.to ? (
              <Link
                to={secondaryAction.to}
                className="focus-ring text-sm px-4 py-2 rounded-md border border-panelBorder text-muted hover:text-ink hover:border-ink/30 transition"
              >
                {secondaryAction.label}
              </Link>
            ) : (
              <button
                onClick={secondaryAction.onClick}
                className="focus-ring text-sm px-4 py-2 rounded-md border border-panelBorder text-muted hover:text-ink hover:border-ink/30 transition"
              >
                {secondaryAction.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
