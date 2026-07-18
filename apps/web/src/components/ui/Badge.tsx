import type { ReactNode } from 'react';

type Variant = 'neutral' | 'signal' | 'alert' | 'amber';

const VARIANT_CLASSES: Record<Variant, string> = {
  neutral: 'text-muted bg-canvas border-panelBorder',
  signal: 'text-signal bg-signal/10 border-signal/40',
  alert: 'text-alert bg-alert/10 border-alert/40',
  amber: 'text-amber bg-amber/10 border-amber/40',
};

/**
 * Small uppercase status/meta badge — replaces the inline
 * `text-[10px] uppercase tracking-wide ... rounded px-1.5 py-0.5` pattern
 * repeated across MarketplacePage, TemplateGalleryPage, CredentialsPage, and
 * ExecutionHistoryPage.
 */
export default function Badge({
  children,
  variant = 'neutral',
  className = '',
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center text-[10px] uppercase tracking-wide font-medium rounded px-1.5 py-0.5 border ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
