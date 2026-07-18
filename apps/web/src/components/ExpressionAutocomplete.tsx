import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * ExpressionAutocomplete — a drop-in replacement for a plain <textarea>
 * that adds IntelliSense-style suggestions while typing `{{ ... }}`
 * expressions (FlowForge's expression syntax — see engine/expressions.ts).
 *
 * No external editor dependency (no CodeMirror/Monaco): it's a real
 * <textarea> with a positioned suggestion popup, driven by cursor
 * position + a lightweight mirror-div technique to compute caret pixel
 * coordinates. Works inside any JSON/string param field.
 *
 * Triggers on the two characters `{{`, then narrows suggestions as you
 * keep typing (e.g. `{{$js` -> `$json`). Accepts a suggestion with
 * Tab/Enter, dismisses with Escape, navigates with Up/Down.
 */

export interface ExpressionSuggestion {
  /** Text shown in the dropdown, e.g. "$json.field" */
  label: string;
  /** Text inserted at the caret (defaults to `label`) */
  insertText?: string;
  /** Short right-aligned hint, e.g. "this node's input" */
  detail?: string;
  /** Category badge, e.g. "variable" | "helper" | "node" */
  kind?: 'variable' | 'helper' | 'node' | 'binary';
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  rows?: number;
  className?: string;
  /** Extra suggestions beyond the built-in $json/$env/$now/etc — typically upstream node labels and their known fields. */
  extraSuggestions?: ExpressionSuggestion[];
  placeholder?: string;
}

const BASE_SUGGESTIONS: ExpressionSuggestion[] = [
  { label: '$json', detail: "this node's resolved input", kind: 'variable' },
  { label: '$binary', detail: 'binary/file metadata on the input item(s)', kind: 'binary' },
  { label: '$item', detail: 'current loop item (inside forEach)', kind: 'variable' },
  { label: '$env', detail: 'process.env.NAME', kind: 'variable' },
  { label: '$workflow.id', detail: 'current workflow id', kind: 'variable' },
  { label: '$execution.id', detail: 'current execution id', kind: 'variable' },
  { label: '$now', detail: 'ISO timestamp', kind: 'variable' },
  { label: '$today', detail: 'YYYY-MM-DD', kind: 'variable' },
  { label: '$fn.date.format(', insertText: '$fn.date.format($json.', detail: 'date, "YYYY-MM-DD")', kind: 'helper' },
  { label: '$fn.date.addDays(', insertText: '$fn.date.addDays($json.', detail: 'date, days)', kind: 'helper' },
  { label: '$fn.date.iso()', detail: 'ISO string', kind: 'helper' },
  { label: '$fn.string.upper(', insertText: '$fn.string.upper($json.', detail: 'text)', kind: 'helper' },
  { label: '$fn.string.lower(', insertText: '$fn.string.lower($json.', detail: 'text)', kind: 'helper' },
  { label: '$fn.string.trim(', insertText: '$fn.string.trim($json.', detail: 'text)', kind: 'helper' },
  { label: '$fn.string.capitalize(', insertText: '$fn.string.capitalize($json.', detail: 'text)', kind: 'helper' },
  { label: '$fn.math.round(', insertText: '$fn.math.round($json.', detail: 'number)', kind: 'helper' },
  { label: '$fn.math.sum(', insertText: '$fn.math.sum(', detail: 'a, b, ...)', kind: 'helper' },
  { label: '$fn.random.uuid()', detail: 'random UUID', kind: 'helper' },
  { label: '$fn.hash.sha256(', insertText: '$fn.hash.sha256($json.', detail: 'text)', kind: 'helper' },
  { label: '$fn.json.stringify(', insertText: '$fn.json.stringify($json.', detail: 'value)', kind: 'helper' },
];

/** Finds the `{{...` expression (if any) the caret is currently inside, returning its start offset and typed-so-far text. */
function findActiveExpression(text: string, caret: number): { start: number; query: string } | null {
  const upTo = text.slice(0, caret);
  const openIdx = upTo.lastIndexOf('{{');
  if (openIdx === -1) return null;
  const closeIdx = upTo.lastIndexOf('}}');
  if (closeIdx > openIdx) return null; // already closed before caret
  // Also bail if a `}}` appears between openIdx and caret in the full text incorrectly — handled by closeIdx check above.
  const query = upTo.slice(openIdx + 2);
  if (query.includes('\n')) return null; // don't trigger across newlines
  return { start: openIdx + 2, query };
}

export default function ExpressionAutocomplete({
  value,
  onChange,
  onBlur,
  rows = 10,
  className,
  extraSuggestions = [],
  placeholder,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [expr, setExpr] = useState<{ start: number; query: string } | null>(null);

  const allSuggestions = useMemo(() => [...BASE_SUGGESTIONS, ...extraSuggestions], [extraSuggestions]);

  const filtered = useMemo(() => {
    if (!expr) return [];
    const q = expr.query.trim().toLowerCase();
    if (!q) return allSuggestions.slice(0, 12);
    return allSuggestions.filter((s) => s.label.toLowerCase().includes(q)).slice(0, 12);
  }, [expr, allSuggestions]);

  useEffect(() => {
    setOpen(filtered.length > 0 && expr != null);
    setActiveIndex(0);
  }, [filtered, expr]);

  function updateExprFromCaret() {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    setExpr(findActiveExpression(el.value, caret));
  }

  function acceptSuggestion(s: ExpressionSuggestion) {
    const el = textareaRef.current;
    if (!el || !expr) return;
    const insertText = s.insertText ?? s.label;
    const before = value.slice(0, expr.start);
    const after = value.slice(expr.start + expr.query.length);
    const newValue = `${before}${insertText}${after}`;
    onChange(newValue);
    setOpen(false);
    setExpr(null);
    requestAnimationFrame(() => {
      const pos = expr.start + insertText.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      acceptSuggestion(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setExpr(null);
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(updateExprFromCaret);
        }}
        onKeyUp={(e) => {
          if (!['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'].includes(e.key)) updateExprFromCaret();
        }}
        onClick={updateExprFromCaret}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Let a click on the dropdown register before we close it.
          setTimeout(() => setOpen(false), 120);
          onBlur?.();
        }}
        rows={rows}
        className={className}
      />
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-panel border border-panelBorder rounded-md shadow-lg text-xs">
          {filtered.map((s, i) => (
            <button
              key={s.label + i}
              type="button"
              onMouseDown={(e) => e.preventDefault()} // keep textarea focus so blur-close doesn't win the race
              onClick={() => acceptSuggestion(s)}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-canvas ${
                i === activeIndex ? 'bg-canvas' : ''
              }`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`shrink-0 text-[9px] uppercase tracking-wide px-1 rounded ${
                    s.kind === 'helper'
                      ? 'text-amber-400 border border-amber-400/40'
                      : s.kind === 'node'
                        ? 'text-signal border border-signal/40'
                        : s.kind === 'binary'
                          ? 'text-fuchsia-400 border border-fuchsia-400/40'
                          : 'text-muted border border-panelBorder'
                  }`}
                >
                  {s.kind ?? 'var'}
                </span>
                <span className="font-display truncate text-ink">{s.label}</span>
              </span>
              {s.detail && <span className="shrink-0 text-muted truncate max-w-[45%]">{s.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
