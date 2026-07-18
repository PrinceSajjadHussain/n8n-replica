export interface SegmentedToggleOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Connected segmented control for a binary/ternary exclusive choice (e.g. the
 * Compact/Comfortable/Expanded node density toggle) — visually a single
 * bordered strip rather than floating pills, since the options represent one
 * setting rather than independent filters (use FilterPillGroup for those).
 */
export default function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  title,
  'aria-label': ariaLabel,
}: {
  options: SegmentedToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  title?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? title}
      title={title}
      className="flex items-center rounded-md border border-panelBorder overflow-hidden"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`focus-ring text-xs px-2.5 py-1.5 transition-default ${
            value === opt.value ? 'bg-signal/15 text-signal' : 'text-muted hover:text-ink hover:bg-canvas'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
