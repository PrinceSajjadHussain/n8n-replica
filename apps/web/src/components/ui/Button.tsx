import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-signal text-canvas hover:brightness-110 border border-transparent',
  secondary: 'bg-transparent text-ink border border-panelBorder hover:border-ink/30',
  ghost: 'bg-transparent text-muted border border-transparent hover:text-alert',
};

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/**
 * Primary action button — replaces the repeated
 * `bg-signal text-canvas ... rounded-md hover:brightness-110` pattern plus
 * every hand-rolled `disabled={busy} ... {busy ? 'Working…' : 'Do it'}`
 * combination across the app.
 */
export default function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      disabled={disabled || loading}
      className={`focus-ring inline-flex items-center justify-center gap-1.5 text-sm rounded-md px-3 py-1.5 transition-default disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
