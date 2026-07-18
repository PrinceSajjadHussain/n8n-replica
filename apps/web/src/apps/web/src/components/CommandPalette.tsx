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
}

/** A Cmd/Ctrl+K launcher listing available canvas + navigation actions,
 *  filtered as you type. Purely presentational — the caller (CanvasPage)
 *  owns the open/close state and supplies the command list, so the palette
 *  itself has no knowledge of workflow internals. */
export default function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-lg shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="w-full px-4 py-3 border-b outline-none text-sm"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No matching commands</li>}
          {filtered.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                className={`w-full text-left px-4 py-2 text-sm flex justify-between items-center ${
                  i === activeIndex ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50'
                }`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
              >
                <span>{cmd.label}</span>
                {cmd.hint && <span className="text-xs text-gray-400">{cmd.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
