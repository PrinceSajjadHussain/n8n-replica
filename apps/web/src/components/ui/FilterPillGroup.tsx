import { useRef } from 'react';

export interface FilterPillOption {
  value: string;
  label: string;
}

interface BaseProps {
  options: FilterPillOption[];
  /** Extra label shown after the pills, e.g. "3 categories selected". */
  hint?: string;
  'aria-label'?: string;
  className?: string;
}

interface SingleSelectProps extends BaseProps {
  mode?: 'single';
  /** null = "All" selected. */
  value: string | null;
  onChange: (value: string | null) => void;
  allLabel?: string;
}

interface MultiSelectProps extends BaseProps {
  mode: 'multi';
  /** Empty array = "All" selected. */
  value: string[];
  onChange: (value: string[]) => void;
  allLabel?: string;
}

type Props = SingleSelectProps | MultiSelectProps;

const PILL_BASE =
  'focus-ring text-xs px-3 py-1.5 rounded-full border transition-default whitespace-nowrap';
const PILL_ACTIVE = 'bg-signal text-canvas border-signal font-medium';
const PILL_INACTIVE = 'border-panelBorder text-muted hover:text-ink hover:border-ink/30';

/**
 * Single- or multi-select pill/chip group — replaces the four independently
 * evolved `rounded-full` filter implementations across TemplateGalleryPage,
 * MarketplacePage, etc. Renders as `role="radiogroup"` (single-select) or
 * `role="group"` with `aria-checked` per pill (multi-select), with left/right
 * arrow-key roving-tabindex navigation between pills.
 */
export default function FilterPillGroup(props: Props) {
  const { options, hint, className } = props;
  const isMulti = props.mode === 'multi';
  const allLabel = props.allLabel ?? 'All';
  const containerRef = useRef<HTMLDivElement>(null);

  const isAllActive = isMulti ? (props.value as string[]).length === 0 : props.value === null;
  const isActive = (v: string) => (isMulti ? (props.value as string[]).includes(v) : props.value === v);

  function selectAll() {
    if (isMulti) (props as MultiSelectProps).onChange([]);
    else (props as SingleSelectProps).onChange(null);
  }

  function selectOne(v: string) {
    if (isMulti) {
      const current = props.value as string[];
      const next = current.includes(v) ? current.filter((c) => c !== v) : [...current, v];
      (props as MultiSelectProps).onChange(next);
    } else {
      const current = props.value as string | null;
      (props as SingleSelectProps).onChange(current === v ? null : v);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const buttons = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('button[role]') ?? []);
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  const role = isMulti ? 'group' : 'radiogroup';

  return (
    <div
      ref={containerRef}
      role={role}
      aria-label={props['aria-label']}
      onKeyDown={onKeyDown}
      className={`flex items-center gap-2 flex-wrap ${className ?? ''}`}
    >
      <button
        type="button"
        role={isMulti ? undefined : 'radio'}
        aria-checked={isMulti ? undefined : isAllActive}
        aria-pressed={isMulti ? isAllActive : undefined}
        onClick={selectAll}
        className={`${PILL_BASE} ${isAllActive ? PILL_ACTIVE : PILL_INACTIVE}`}
      >
        {allLabel}
      </button>
      {options.map((opt) => {
        const active = isActive(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            role={isMulti ? undefined : 'radio'}
            aria-checked={isMulti ? active : active}
            aria-pressed={isMulti ? active : undefined}
            onClick={() => selectOne(opt.value)}
            className={`${PILL_BASE} ${active ? PILL_ACTIVE : PILL_INACTIVE}`}
          >
            {opt.label}
          </button>
        );
      })}
      {hint && <span className="text-[11px] text-muted ml-1">{hint}</span>}
    </div>
  );
}
