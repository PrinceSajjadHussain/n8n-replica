import { useMemo, useState } from 'react';
import ExpressionAutocomplete, { type ExpressionSuggestion } from './ExpressionAutocomplete';
import type { ParamField, ParamSchema } from '../lib/paramSchemas';
import { describeCron, isValidCron, nextRuns } from '../lib/cronUtils';

interface Props {
  nodeType: string;
  schema: ParamSchema;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  accentColor: string;
  extraSuggestions?: ExpressionSuggestion[];
  workflowId?: string;
  /** params.path values of every other webhook node in this workflow, for the duplicate-path warning. */
  siblingWebhookPaths?: string[];
}

const inputClass =
  'focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm';
const labelClass = 'block text-xs text-muted mb-1';
const helpClass = 'text-muted text-[11px] mt-1';
const errorClass = 'text-alert text-[11px] mt-1';

function setField(params: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  return { ...params, [key]: value };
}

/** Renders one field's control. Kept as a plain function (not a component) so field-level state stays in the parent `params` object — matching the rest of the panel's "form is source of truth" model. */
function FieldControl({
  field,
  params,
  onChange,
  extraSuggestions,
}: {
  field: ParamField;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  extraSuggestions: ExpressionSuggestion[];
}) {
  if (field.visibleIf && !field.visibleIf(params)) return null;
  const raw = params[field.key];
  const value = raw ?? field.default;
  const error = field.validate ? field.validate(value, params) : null;

  switch (field.type) {
    case 'string':
    case 'expression': {
      const strVal = value == null ? '' : String(value);
      return (
        <div>
          <label className={labelClass}>{field.label}</label>
          <ExpressionAutocomplete
            value={strVal}
            onChange={(v) => onChange(setField(params, field.key, v))}
            rows={1}
            placeholder={field.placeholder}
            extraSuggestions={extraSuggestions}
            className={`${inputClass} font-display`}
          />
          {field.help && <p className={helpClass}>{field.help}</p>}
          {error && <p className={errorClass}>{error}</p>}
        </div>
      );
    }
    case 'text': {
      const strVal = value == null ? '' : String(value);
      return (
        <div>
          <label className={labelClass}>
            {field.label}
            {field.key === 'systemPrompt' && <span className="text-muted/70 normal-case"> — {strVal.length} chars</span>}
          </label>
          <ExpressionAutocomplete
            value={strVal}
            onChange={(v) => onChange(setField(params, field.key, v))}
            rows={3}
            placeholder={field.placeholder}
            extraSuggestions={extraSuggestions}
            className={`${inputClass} font-display`}
          />
          {field.help && <p className={helpClass}>{field.help}</p>}
        </div>
      );
    }
    case 'number':
      return (
        <div>
          <label className={labelClass}>{field.label}</label>
          <input
            type="number"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(setField(params, field.key, e.target.value === '' ? undefined : Number(e.target.value)))}
            className={inputClass}
          />
          {field.help && <p className={helpClass}>{field.help}</p>}
        </div>
      );
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(setField(params, field.key, e.target.checked))}
          />
          {field.label}
        </label>
      );
    case 'enum':
      return (
        <div>
          <label className={labelClass}>{field.label}</label>
          <select
            value={value == null ? '' : String(value)}
            onChange={(e) => onChange(setField(params, field.key, e.target.value))}
            className={inputClass}
          >
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {field.help && <p className={helpClass}>{field.help}</p>}
        </div>
      );
    case 'object': {
      const obj = (typeof value === 'object' && value && !Array.isArray(value) ? (value as Record<string, unknown>) : {}) as Record<string, unknown>;
      const rows = Object.entries(obj);
      const commit = (nextRows: [string, unknown][]) => {
        const nextObj: Record<string, unknown> = {};
        for (const [k, v] of nextRows) if (k) nextObj[k] = v;
        onChange(setField(params, field.key, nextObj));
      };
      return (
        <div>
          <label className={labelClass}>{field.label}</label>
          <div className="grid gap-1.5">
            {rows.map(([k, v], i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={k}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = [e.target.value, v];
                    commit(next);
                  }}
                  placeholder="key"
                  className="focus-ring flex-1 min-w-0 bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs font-display"
                />
                <input
                  value={String(v ?? '')}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = [k, e.target.value];
                    commit(next);
                  }}
                  placeholder="value"
                  className="focus-ring flex-1 min-w-0 bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs font-display"
                />
                <button
                  type="button"
                  onClick={() => commit(rows.filter((_, ri) => ri !== i))}
                  className="focus-ring text-xs text-muted hover:text-alert px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => commit([...rows, ['', '']])}
            className="focus-ring text-xs mt-1.5 px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink"
          >
            + Add header
          </button>
          {field.help && <p className={helpClass}>{field.help}</p>}
        </div>
      );
    }
    case 'array': {
      const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      const commit = (next: Record<string, unknown>[]) => onChange(setField(params, field.key, next));
      return (
        <div>
          <label className={labelClass}>{field.label}</label>
          <div className="grid gap-2">
            {items.map((item, i) => (
              <div key={i} className="border border-panelBorder rounded-md p-2 bg-canvas">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-muted uppercase">{field.itemLabel ?? 'item'} {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => commit(items.filter((_, ri) => ri !== i))}
                    className="focus-ring text-xs text-muted hover:text-alert px-1"
                  >
                    ✕
                  </button>
                </div>
                <div className="grid gap-1.5">
                  {field.itemFields.map((sub) => (
                    <FieldControl
                      key={sub.key}
                      field={sub}
                      params={item}
                      onChange={(updatedItem) => {
                        const next = [...items];
                        next[i] = updatedItem;
                        commit(next);
                      }}
                      extraSuggestions={extraSuggestions}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => commit([...items, {}])}
            className="focus-ring text-xs mt-1.5 px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink"
          >
            + Add {field.itemLabel ?? 'item'}
          </button>
          {field.help && <p className={helpClass}>{field.help}</p>}
        </div>
      );
    }
    case 'json': {
      const text = value === undefined ? '' : JSON.stringify(value, null, 2);
      return <JsonFieldEditor field={field} text={text} params={params} onChange={onChange} extraSuggestions={extraSuggestions} />;
    }
    default:
      return null;
  }
}

/** Isolated so the raw text can diverge from the parsed value while the user is mid-edit, without losing keystrokes. */
function JsonFieldEditor({
  field,
  text,
  params,
  onChange,
  extraSuggestions,
}: {
  field: Extract<ParamField, { type: 'json' }>;
  text: string;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  extraSuggestions: ExpressionSuggestion[];
}) {
  const [draft, setDraft] = useState(text);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = dirty ? draft : text;

  function commit() {
    if (!shown.trim()) {
      setDirty(false);
      setErr(null);
      onChange(setField(params, field.key, undefined));
      return;
    }
    try {
      const parsed = JSON.parse(shown);
      setErr(null);
      setDirty(false);
      onChange(setField(params, field.key, parsed));
    } catch {
      setErr('Invalid JSON — not saved yet');
    }
  }

  return (
    <div>
      <label className={labelClass}>{field.label}</label>
      <ExpressionAutocomplete
        value={shown}
        onChange={(v) => {
          setDraft(v);
          setDirty(true);
        }}
        onBlur={commit}
        rows={field.rows ?? 4}
        extraSuggestions={extraSuggestions}
        className={`${inputClass} font-display`}
      />
      {err && <p className={errorClass}>{err}</p>}
      {field.help && <p className={helpClass}>{field.help}</p>}
    </div>
  );
}

export default function ParamForm({
  nodeType,
  schema,
  params,
  onChange,
  accentColor,
  extraSuggestions = [],
  workflowId,
  siblingWebhookPaths = [],
}: Props) {
  return (
    <div className="grid gap-3">
      <p className="text-xs uppercase tracking-widest font-display" style={{ color: accentColor }}>
        Configuration
      </p>

      {schema.fields.map((field) => (
        <FieldControl key={field.key} field={field} params={params} onChange={onChange} extraSuggestions={extraSuggestions} />
      ))}

      {nodeType === 'webhook' && (
        <WebhookGuidedExtras params={params} workflowId={workflowId} siblingPaths={siblingWebhookPaths} />
      )}
      {nodeType === 'schedule' && <ScheduleGuidedExtras params={params} />}
      {nodeType === 'httpRequest' && <HttpRequestGuidedExtras params={params} onChange={onChange} />}
      {nodeType === 'openai' && (
        <OpenAiGuidedExtras params={params} onChange={onChange} />
      )}
    </div>
  );
}

const CONTENT_TYPE_PRESETS: { value: string; label: string; contentType: string | null }[] = [
  { value: 'json', label: 'JSON', contentType: 'application/json' },
  { value: 'form', label: 'Form URL-encoded', contentType: 'application/x-www-form-urlencoded' },
  { value: 'text', label: 'Raw text', contentType: 'text/plain' },
  { value: 'none', label: 'No Content-Type header', contentType: null },
];

function HttpRequestGuidedExtras({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const method = String(params.method ?? 'GET');
  if (['GET', 'DELETE'].includes(method)) return null;
  const headers = (typeof params.headers === 'object' && params.headers ? (params.headers as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const currentContentType = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1];

  function applyPreset(presetValue: string) {
    const preset = CONTENT_TYPE_PRESETS.find((p) => p.value === presetValue);
    const nextHeaders = { ...headers };
    // Remove any existing Content-Type key (case-insensitive) before re-adding, so switching presets
    // doesn't leave a stale duplicate header behind.
    for (const k of Object.keys(nextHeaders)) if (k.toLowerCase() === 'content-type') delete nextHeaders[k];
    if (preset?.contentType) nextHeaders['Content-Type'] = preset.contentType;
    onChange(setField(params, 'headers', nextHeaders));
  }

  return (
    <div className="border-t border-panelBorder pt-3">
      <label className={labelClass}>Body content type</label>
      <select
        value={CONTENT_TYPE_PRESETS.find((p) => p.contentType === currentContentType)?.value ?? 'none'}
        onChange={(e) => applyPreset(e.target.value)}
        className={inputClass}
      >
        {CONTENT_TYPE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <p className={helpClass}>Sets/removes the Content-Type header above. Switching presets replaces any existing Content-Type key.</p>
    </div>
  );
}

function WebhookGuidedExtras({
  params,
  workflowId,
  siblingPaths,
}: {
  params: Record<string, unknown>;
  workflowId?: string;
  siblingPaths: string[];
}) {
  const path = String(params.path ?? '');
  const url = `${window.location.origin.replace(/:\d+$/, '')}/api/webhook/${workflowId ?? ':workflowId'}/${path || ':path'}`;
  const isDuplicate = path.length > 0 && siblingPaths.includes(path);
  const [copied, setCopied] = useState(false);

  return (
    <div className="border-t border-panelBorder pt-3">
      <label className={labelClass}>Final URL preview</label>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 min-w-0 truncate text-[11px] bg-canvas border border-panelBorder rounded-md px-2 py-1.5">
          {url}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(url).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="focus-ring text-xs px-2 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink shrink-0"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {isDuplicate && (
        <p className={errorClass}>
          Another webhook node in this workflow already uses path "{path}" — only one will ever be reachable.
        </p>
      )}
    </div>
  );
}

function ScheduleGuidedExtras({ params }: { params: Record<string, unknown> }) {
  const cron = String(params.cron ?? '');
  const valid = cron.length > 0 && isValidCron(cron);
  const upcoming = useMemo(() => (valid ? nextRuns(cron, 5) : []), [cron, valid]);

  if (!cron) return null;
  return (
    <div className="border-t border-panelBorder pt-3">
      {valid ? (
        <>
          <p className="text-sm text-ink">{describeCron(cron)}</p>
          <p className={labelClass + ' mt-2'}>Next 5 runs</p>
          <ul className="text-[11px] text-muted grid gap-0.5">
            {upcoming.map((d, i) => (
              <li key={i} className="font-display">
                {d.toLocaleString()}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={errorClass}>Invalid cron expression — Activate is disabled until this is fixed.</p>
      )}
    </div>
  );
}

function OpenAiGuidedExtras({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const prompt = String(params.prompt ?? '');
  return (
    <div className="border-t border-panelBorder pt-3">
      <button
        type="button"
        onClick={() => onChange(setField(params, 'prompt', prompt.includes('{{input}}') ? prompt : `${prompt}{{input}}`))}
        className="focus-ring text-xs px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink"
      >
        + Insert {'{{input}}'}
      </button>
      <p className={helpClass}>Inserts a placeholder for the upstream node's JSON output into the prompt above.</p>
    </div>
  );
}

/** Exposes whether `isValidCron` should gate the Activate toggle — used by NodeConfigPanel/CanvasPage for the schedule node without duplicating cron parsing there. */
export function isScheduleCronValid(nodeType: string, params: Record<string, unknown>): boolean {
  if (nodeType !== 'schedule') return true;
  const cron = String(params.cron ?? '');
  return cron.length === 0 || isValidCron(cron);
}
