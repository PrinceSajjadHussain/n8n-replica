import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Bordered list-item card shell — replaces the
 * `bg-panel border border-panelBorder rounded-lg px-4 py-3` pattern repeated
 * across MarketplacePage, TemplateGalleryPage, CredentialsPage, and
 * ExecutionHistoryPage. Reuses the same hover-lift treatment already
 * established on canvas nodes (FlowNode.tsx) so cards and canvas nodes read
 * as one visual language.
 */
export default function Card({
  children,
  hoverLift = false,
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode; hoverLift?: boolean }) {
  return (
    <div
      className={`bg-panel elevation-card rounded-lg px-4 py-3 transition-default ${
        hoverLift ? 'hover:-translate-y-px' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
