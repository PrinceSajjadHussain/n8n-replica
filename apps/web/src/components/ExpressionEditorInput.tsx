/**
 * ExpressionEditorInput — an "fx" toggle single-line parameter input.
 *
 * Two modes toggled by the "fx" button:
 *   - Static:    A plain text/number/select input (no expression support).
 *   - Expression: A single-line input that wraps the full value in `{{ }}`
 *                 and live-previews the result by calling the API's
 *                 `/expressions/evaluate` endpoint (which uses the same
 *                 isolated-vm sandboxed evaluator from Fix 4).
 *
 * On expression failure the error is shown inline (typed: syntax / runtime /
 * timeout) — never silently blank. This wires up Fix 4's `expressionErrors`
 * plumbing to the per-param UI.
 *
 * Drag-drop support: accepting a field reference dragged from SchemaTreeView
 * fills the expression input automatically.
 *
 * Usage in Paramform.tsx:
 *   <ExpressionEditorInput
 *     value={params.url as string}
 *     label="URL"
 *     type="string"
 *     mockInput={lastRunInput}
 *     onChange={(v) => onChange({ params: { ...params, url: v } })}
 *   />
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import ExpressionAutocomplete, { type ExpressionSuggestion } from './ExpressionAutocomplete';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  value: string;
  label?: string;
  /** Input type hint — controls the static input's type attribute. */
  type?: 'string' | 'number' | 'boolean' | 'url' | 'email';
  /**
   * The node's last-run input — used as `$json` context when live-evaluating
   * the expression preview. Falls back to `{}` when not available.
   */
  mockInput?: unknown;
  /** Extra autocomplete suggestions (upstream node labels, etc.). */
  extraSuggestions?: ExpressionSuggestion[];
  placeholder?: string;
  onChange: (value: string) => void;
  /** Whether the full field value is already an expression (contains `{{ }}`). */
  className?: string;
}

interface EvalResult {
  result?: unknown;
  error?: { message: string; type: string } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** True if the value contains at least one `{{ }}` expression block. */
function isExpression(v: string): boolean {
  return /\{\{.+?\}\}/.test(v);
}

/** Strips outer `{{ }}` if the entire string is a single expression block. */
function unwrapExpression(v: string): string {
  const m = v.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
  return m ? m[1].trim() : v;
}

/** Wraps a bare expression body in `{{ }}`. */
function wrapExpression(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  return `{{${trimmed}}}`;
}

// ─── Debounce hook ───────────────────────────────────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ExpressionEditorInput({
  value,
  label,
  type = 'string',
  mockInput,
  extraSuggestions = [],
  placeholder,
  onChange,
  className = '',
}: Props) {
  // Start in expression mode if the current value already contains {{ }}.
  const [exprMode, setExprMode] = useState(() => isExpression(value));
  // The raw expression body (without outer {{ }}) while in expression mode.
  const [exprBody, setExprBody] = useState(() =>
    isExpression(value) ? unwrapExpression(value) : value
  );
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Debounce evaluation so we don't fire on every keystroke.
  const debouncedBody = useDebounced(exprBody, 400);

  // Live-evaluate the expression whenever the debounced body changes.
  useEffect(() => {
    if (!exprMode || !debouncedBody.trim()) {
      setEvalResult(null);
      return;
    }
    let cancelled = false;
    setEvalBusy(true);
    api
      .post('/expressions/evaluate', {
        expression: wrapExpression(debouncedBody),
        context: { json: mockInput ?? {} },
      })
      .then(({ data }) => {
        if (!cancelled) setEvalResult(data as EvalResult);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setEvalResult({
            error: {
              message: err?.response?.data?.error ?? 'Evaluation failed',
              type: err?.response?.data?.type ?? 'runtime',
            },
          });
        }
      })
      .finally(() => {
        if (!cancelled) setEvalBusy(false);
      });
    return () => { cancelled = true; };
  }, [debouncedBody, exprMode, mockInput]);

  // Commit the expression body back to the parent as the full `{{ }}` value.
  function commitExpr(body: string) {
    const wrapped = body.trim() ? wrapExpression(body.trim()) : '';
    onChange(wrapped);
  }

  function handleToggleMode() {
    if (exprMode) {
      // Switching back to static: strip the {{ }} wrapper.
      const staticVal = unwrapExpression(value);
      setExprMode(false);
      onChange(staticVal);
    } else {
      // Switching to expression: initialise body from current value.
      setExprMode(true);
      setExprBody(value);
      commitExpr(value);
    }
  }

  // Accept drag-dropped field reference from SchemaTreeView.
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const text = e.dataTransfer.getData('text/plain');
    if (!text) return;
    if (!exprMode) {
      setExprMode(true);
    }
    const body = unwrapExpression(text);
    setExprBody(body);
    commitExpr(body);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  // ── Preview text ──────────────────────────────────────────────────────────

  let previewText: string | null = null;
  let previewIsError = false;
  if (evalResult) {
    if (evalResult.error) {
      previewText = `${evalResult.error.type}: ${evalResult.error.message}`;
      previewIsError = true;
    } else if (evalResult.result !== undefined) {
      try {
        const r = evalResult.result;
        previewText = typeof r === 'string' ? r : JSON.stringify(r);
      } catch {
        previewText = String(evalResult.result);
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col gap-0.5 ${className}`} ref={dropZoneRef} onDrop={handleDrop} onDragOver={handleDragOver}>
      {label && (
        <label className="text-[11px] text-muted flex items-center gap-1">
          {label}
          {exprMode && (
            <span className="text-[9px] uppercase tracking-wide text-amber border border-amber/40 px-1 rounded">
              expr
            </span>
          )}
        </label>
      )}

      <div className="flex items-start gap-1">
        {/* fx toggle button */}
        <button
          type="button"
          onClick={handleToggleMode}
          title={exprMode ? 'Switch to static value' : 'Switch to expression mode ({{…}})'}
          className={`focus-ring shrink-0 mt-0.5 text-[10px] font-display px-1.5 py-1 rounded border transition ${
            exprMode
              ? 'border-amber/50 text-amber bg-amber/10'
              : 'border-panelBorder text-muted hover:text-ink hover:border-signal/40'
          }`}
        >
          fx
        </button>

        {exprMode ? (
          /* Expression mode: single-line autocomplete textarea */
          <div className="flex-1 flex flex-col gap-0.5">
            <ExpressionAutocomplete
              value={exprBody}
              onChange={(v) => {
                setExprBody(v);
                commitExpr(v);
              }}
              rows={2}
              extraSuggestions={extraSuggestions}
              placeholder={placeholder ?? '$json.field'}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs font-display resize-none"
            />
            {/* Live preview / error */}
            {evalBusy && (
              <p className="text-[10px] text-muted animate-pulse">evaluating…</p>
            )}
            {!evalBusy && previewText !== null && (
              <p className={`text-[10px] truncate ${previewIsError ? 'text-alert' : 'text-signal'}`}>
                {previewIsError ? '⚠ ' : '→ '}{previewText}
              </p>
            )}
          </div>
        ) : (
          /* Static mode: plain input */
          <input
            type={type === 'boolean' ? 'checkbox' : type === 'number' ? 'number' : type === 'url' ? 'url' : type === 'email' ? 'email' : 'text'}
            value={type === 'boolean' ? undefined : value}
            checked={type === 'boolean' ? Boolean(value) : undefined}
            onChange={(e) => {
              if (type === 'boolean') {
                onChange(String((e.target as HTMLInputElement).checked));
              } else {
                onChange(e.target.value);
              }
            }}
            placeholder={placeholder}
            className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs text-ink"
          />
        )}
      </div>

      {/* Drag-target hint when hovering */}
    </div>
  );
}
