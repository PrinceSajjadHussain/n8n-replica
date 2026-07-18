import { useEffect, useMemo, useState } from 'react';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
  placeholder?: string;
}

/** A Cmd/Ctrl+K launcher listing available canvas + navigation actions,
 *  filtered as you type. Purely presentational — the caller (CanvasPage,
 *  AppShell) owns the open/close state and supplies the command list, so
 *  the palette itself has no knowledge of workflow internals. Colors are
 *  theme tokens (canvas/panel/ink/muted/signal) so it matches light/dark
 *  mode instead of a hardcoded white popup. */
export default function CommandPalette({ open, onClose, commands, placeholder }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group?.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[activeIndex];
        if (cmd) {
          cmd.run();
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, filtered, activeIndex, onClose]);

  if (!open) return null;

  // Track group headers so consecutive items in the same group only render one label.
  let lastGroup: string | undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-panel border border-panelBorder rounded-lg shadow-glow overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="focus-ring w-full px-4 py-3 border-b border-panelBorder outline-none text-sm bg-panel text-ink placeholder:text-muted"
          placeholder={placeholder ?? 'Type a command…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
        />
        <ul className="max-h-96 overflow-y-auto py-1">
          {filtered.length === 0 && <li className="px-4 py-3 text-sm text-muted">No matching commands</li>}
          {filtered.map((cmd, i) => {
            const showGroupHeader = cmd.group && cmd.group !== lastGroup;
            lastGroup = cmd.group;
            return (
              <li key={cmd.id}>
                {showGroupHeader && (
                  <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted">{cmd.group}</p>
                )}
                <button
                  className={`focus-ring w-full text-left px-4 py-2 text-sm flex justify-between items-center transition ${
                    i === activeIndex ? 'bg-signal/10 text-signal' : 'text-ink hover:bg-canvas'
                  }`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => {
                    cmd.run();
                    onClose();
                  }}
                >
                  <span>{cmd.label}</span>
                  {cmd.hint && <span className="text-xs text-muted">{cmd.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
