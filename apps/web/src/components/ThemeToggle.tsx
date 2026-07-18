import { useThemeStore, type ThemeName } from '../store/themeStore';

const OPTIONS: { id: ThemeName; label: string; swatch: string }[] = [
  { id: 'black', label: 'Black', swatch: '#0d1117' },
  { id: 'blue', label: 'Blue', swatch: '#3898ff' },
  { id: 'white', label: 'White', swatch: '#f6f8fb' },
];

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useThemeStore();

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex items-center gap-1 rounded-lg border border-panelBorder bg-canvas p-1"
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.label}
            onClick={() => setTheme(opt.id)}
            className={`focus-ring flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              active
                ? 'bg-signal/15 text-signal shadow-glow'
                : 'text-muted hover:text-ink hover:bg-panel'
            }`}
          >
            <span
              className="h-3 w-3 rounded-full border border-panelBorder"
              style={{ backgroundColor: opt.swatch }}
            />
            {!compact && opt.label}
          </button>
        );
      })}
    </div>
  );
}
