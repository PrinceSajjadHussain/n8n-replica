import { useEffect, useMemo, useState } from 'react';
import ExpressionAutocomplete, { type ExpressionSuggestion } from './ExpressionAutocomplete';
import ExpressionEditorInput from './ExpressionEditorInput';
import ResourceLocatorInput from './ResourceLocatorInput';
import { api } from '../lib/api';
import type { ParamField, ParamSchema } from '../lib/paramSchemas';
import { describeCron, isValidCron, nextRuns } from '../lib/cronUtils';

interface Props {
  nodeType: string;
  schema: ParamSchema;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  accentColor: string;
  extraSuggestions?: ExpressionSuggestion[];
  /** Last-run input for the current node — passed to ExpressionEditorInput as $json mock context for live preview. */
  mockInput?: unknown;
  /** Current credential id — used by ResourceLocatorInput to fetch resource lists. */
  credentialId?: string | null;
  workflowId?: string;
  /** params.path values of every other webhook node in this workflow, for the duplicate-path warning. */
  siblingWebhookPaths?: string[];
  /** params.path values of every other chatTrigger node in this workflow, for the duplicate-path warning. */
  siblingChatPaths?: string[];
  /** Whether a "Respond to Webhook" node exists anywhere else in this workflow — used to warn when responseMode is set to responseNode but nothing will ever answer it. */
  hasRespondToWebhookNode?: boolean;
  /** Whether the workflow is currently published/active — the webhook/chat "Final URL preview" uses the `/test/...` path while unpublished, matching the API's test vs. production route split. */
  isWorkflowActive?: boolean;
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
  mockInput,
  credentialId,
  nodeType,
}: {
  field: ParamField;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  extraSuggestions: ExpressionSuggestion[];
  mockInput?: unknown;
  credentialId?: string | null;
  nodeType?: string;
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
          <ExpressionEditorInput
            label={field.label}
            value={strVal}
            type="string"
            mockInput={mockInput}
            extraSuggestions={extraSuggestions}
            placeholder={field.placeholder}
            onChange={(v) => onChange(setField(params, field.key, v))}
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
          <ExpressionEditorInput
            label={field.key === 'systemPrompt' ? `${field.label} — ${strVal.length} chars` : field.label}
            value={strVal}
            type="string"
            mockInput={mockInput}
            extraSuggestions={extraSuggestions}
            placeholder={field.placeholder}
            onChange={(v) => onChange(setField(params, field.key, v))}
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
    case 'enum': {
      if (field.loadOptionsFrom) {
        return (
          <DynamicEnumField
            field={field}
            value={value}
            params={params}
            nodeType={nodeType}
            credentialId={credentialId}
            onChange={(v) => onChange(setField(params, field.key, v))}
          />
        );
      }
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
    }
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
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => {
                        const next = [...items];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        commit(next);
                      }}
                      title="Move up"
                      className="focus-ring text-xs text-muted hover:text-ink px-1 disabled:opacity-30 disabled:hover:text-muted"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === items.length - 1}
                      onClick={() => {
                        const next = [...items];
                        [next[i], next[i + 1]] = [next[i + 1], next[i]];
                        commit(next);
                      }}
                      title="Move down"
                      className="focus-ring text-xs text-muted hover:text-ink px-1 disabled:opacity-30 disabled:hover:text-muted"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={items.length <= (field.minItems ?? 0)}
                      onClick={() => commit(items.filter((_, ri) => ri !== i))}
                      title={items.length <= (field.minItems ?? 0) ? `At least ${field.minItems} required` : undefined}
                      className="focus-ring text-xs text-muted hover:text-alert px-1 disabled:opacity-30 disabled:hover:text-muted"
                    >
                      ✕
                    </button>
                  </div>
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
                      mockInput={mockInput}
                      credentialId={credentialId}
                      nodeType={nodeType}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={field.maxItems !== undefined && items.length >= field.maxItems}
            onClick={() => commit([...items, {}])}
            className="focus-ring text-xs mt-1.5 px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted"
          >
            + Add {field.itemLabel ?? 'item'}
          </button>
          {field.minItems !== undefined && items.length < field.minItems && (
            <p className={errorClass}>At least {field.minItems} {field.itemLabel ?? 'item'}{field.minItems === 1 ? '' : 's'} required.</p>
          )}
          {field.maxItems !== undefined && items.length >= field.maxItems && (
            <p className={helpClass}>Maximum of {field.maxItems} reached.</p>
          )}
          {field.help && <p className={helpClass}>{field.help}</p>}
        </div>
      );
    }
    case 'resource': {
      // ResourceLocatorInput: pick an external resource by name/id via a
      // small list endpoint, or type the ID directly. Needs field.resource
      // (e.g. 'files') and field.nodeType (e.g. 'googleDrive') in paramSchemas.
      const resourceNodeType = field.nodeType ?? nodeType ?? '';
      const resourceName = field.resource ?? field.key;
      // Dependent pickers (e.g. Trello listId scoped to the chosen boardId) re-fetch
      // whenever the field they depend on changes — keyed remount is the simplest way
      // to force ResourceLocatorInput to drop its cached list and reload for the new filter.
      // Note: the filter field itself is always a plain string/legacy id even when it's
      // also a resource field, since boardId etc. store { mode, value, ... } — read .value.
      const filterFieldValue = field.filterFromKey ? params[field.filterFromKey] : undefined;
      const filterValue =
        filterFieldValue && typeof filterFieldValue === 'object' && 'value' in (filterFieldValue as Record<string, unknown>)
          ? String((filterFieldValue as Record<string, unknown>).value ?? '')
          : filterFieldValue == null
            ? ''
            : String(filterFieldValue);

      // splitInto fields (e.g. GitHub's owner/repo picker) don't store anything under
      // field.key at all — they're a convenience picker over two ordinary string params.
      // Reconstruct the "owner/repo"-style display value from those two params, and on
      // selection write the two halves straight back into them instead of field.key.
      const displayValue = field.splitInto
        ? (() => {
            const owner = params[field.splitInto!.ownerKey];
            const name = params[field.splitInto!.nameKey];
            return owner && name ? `${owner}/${name}` : '';
          })()
        : value;
      const handleChange = field.splitInto
        ? (v: { value: string }) => {
            const [ownerPart, ...rest] = String(v.value ?? '').split('/');
            const namePart = rest.join('/');
            onChange({
              ...setField(params, field.splitInto!.ownerKey, ownerPart || ''),
              [field.splitInto!.nameKey]: namePart || '',
            });
          }
        : (v: unknown) => onChange(setField(params, field.key, v));

      return (
        <div>
          <ResourceLocatorInput
            key={field.filterFromKey ? `${field.key}:${filterValue}` : field.key}
            nodeType={resourceNodeType}
            resource={resourceName}
            filter={filterValue || undefined}
            modes={field.modes}
            urlExtractRegex={field.urlExtractRegex}
            credentialId={credentialId ?? null}
            value={displayValue}
            label={field.label}
            placeholder={
              field.filterFromKey && !filterValue
                ? `Select a ${field.filterFromKey} first`
                : field.placeholder
            }
            onChange={handleChange}
          />
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

/** Enum field backed by GET /integrations/:nodeType/resources/:loadOptionsFrom (Task 4) —
 *  same endpoint/shape ResourceLocatorInput uses. Falls back to a plain text input if the
 *  fetch fails or no credential is selected yet, so the field is never a dead end. */
function DynamicEnumField({
  field,
  value,
  params,
  nodeType,
  credentialId,
  onChange,
}: {
  field: Extract<ParamField, { type: 'enum' }>;
  value: unknown;
  params: Record<string, unknown>;
  nodeType?: string;
  credentialId?: string | null;
  onChange: (value: string) => void;
}) {
  const [items, setItems] = useState<{ value: string; name: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const filterValue = field.loadOptionsFilterFromKey ? String(params[field.loadOptionsFilterFromKey] ?? '') : '';

  useEffect(() => {
    let cancelled = false;
    if (!credentialId) {
      setItems(null);
      setFailed(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    api
      .get(`/integrations/${nodeType}/resources/${field.loadOptionsFrom}`, {
        params: { credentialId, ...(filterValue ? { filter: filterValue } : {}) },
      })
      .then(({ data }) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeType, field.loadOptionsFrom, credentialId, filterValue]);

  if (!credentialId || failed || (items !== null && items.length === 0 && !loading)) {
    // No credential, fetch failed, or nothing came back — fall back to plain text entry.
    return (
      <div>
        <label className={labelClass}>{field.label}</label>
        <input
          type="text"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={!credentialId ? 'Select a credential first' : field.placeholder}
          className={inputClass}
        />
        {field.help && <p className={helpClass}>{field.help}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className={labelClass}>{field.label}</label>
      <select
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        className={inputClass}
      >
        <option value="">{loading ? 'Loading…' : 'Select…'}</option>
        {(items ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.name}
          </option>
        ))}
      </select>
      {field.help && <p className={helpClass}>{field.help}</p>}
    </div>
  );
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
  mockInput,
  credentialId,
  workflowId,
  siblingWebhookPaths = [],
  siblingChatPaths = [],
  hasRespondToWebhookNode = false,
  isWorkflowActive = false,
}: Props) {
  return (
    <div className="grid gap-3">
      <p className="text-xs uppercase tracking-widest font-display" style={{ color: accentColor }}>
        Configuration
      </p>

      {schema.fields.map((field) => (
        <FieldControl key={field.key} field={field} params={params} onChange={onChange} extraSuggestions={extraSuggestions} mockInput={mockInput} credentialId={credentialId} nodeType={nodeType} />
      ))}

      {nodeType === 'webhook' && (
        <WebhookGuidedExtras
          params={params}
          workflowId={workflowId}
          siblingPaths={siblingWebhookPaths}
          isWorkflowActive={isWorkflowActive}
        />
      )}
      {nodeType === 'chatTrigger' && (
        <ChatGuidedExtras
          params={params}
          workflowId={workflowId}
          siblingPaths={siblingChatPaths}
          hasRespondToWebhookNode={hasRespondToWebhookNode}
          isWorkflowActive={isWorkflowActive}
        />
      )}
      {nodeType === 'set' && <SetGuidedExtras params={params} onChange={onChange} mockInput={mockInput} />}
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

/** The API server's own origin (never the web app's) — every trigger route (`/webhook`, `/chat`, ...) is mounted directly on it with no `/api` prefix. Matches the fallback in lib/api.ts. */
const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function WebhookGuidedExtras({
  params,
  workflowId,
  siblingPaths,
  isWorkflowActive,
}: {
  params: Record<string, unknown>;
  workflowId?: string;
  siblingPaths: string[];
  isWorkflowActive?: boolean;
}) {
  const path = String(params.path ?? '');
  const urlBase = isWorkflowActive ? '/webhook' : '/webhook/test';
  const url = `${API_ORIGIN}${urlBase}/${workflowId ?? ':workflowId'}/${path || ':path'}`;
  const isDuplicate = path.length > 0 && siblingPaths.includes(path);
  const [copied, setCopied] = useState(false);

  return (
    <div className="border-t border-panelBorder pt-3">
      <label className={labelClass}>Final URL preview</label>
      {!isWorkflowActive && (
        <p className={helpClass}>Workflow isn't published yet — this test URL runs your current draft.</p>
      )}
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

function ChatGuidedExtras({
  params,
  workflowId,
  siblingPaths,
  hasRespondToWebhookNode,
  isWorkflowActive,
}: {
  params: Record<string, unknown>;
  workflowId?: string;
  siblingPaths: string[];
  hasRespondToWebhookNode: boolean;
  isWorkflowActive?: boolean;
}) {
  const path = String(params.path ?? 'default');
  const urlBase = isWorkflowActive ? '/chat' : '/chat/test';
  const url = `${API_ORIGIN}${urlBase}/${workflowId ?? ':workflowId'}/${path || 'default'}`;
  const isDuplicate = path.length > 0 && siblingPaths.includes(path);
  const responseMode = String(params.responseMode ?? 'lastNode');
  const [copied, setCopied] = useState(false);

  const examplePayload = `{ "message": "Hello!", "sessionId": "optional-thread-id" }`;

  return (
    <div className="border-t border-panelBorder pt-3 grid gap-3">
      <div>
        <label className={labelClass}>Final URL preview</label>
        {!isWorkflowActive && (
          <p className={helpClass}>Workflow isn't published yet — this test URL runs your current draft.</p>
        )}
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
        <p className={helpClass}>
          POST here with a JSON body like <code className="text-[10px]">{examplePayload}</code>.{' '}
          {isWorkflowActive
            ? 'Reply is held open until the run finishes (default 60s timeout).'
            : "This test path runs against your current draft and works even though the workflow isn't published yet. Reply is held open until the run finishes (default 60s timeout)."}
        </p>
        {isDuplicate && (
          <p className={errorClass}>
            Another chat trigger in this workflow already uses path "{path}" — only one will ever be reachable.
          </p>
        )}
      </div>
      {responseMode === 'responseNode' && !hasRespondToWebhookNode && (
        <p className={errorClass}>
          Response mode is set to "Respond to Webhook", but this workflow has no "Respond to Webhook" node yet — every
          chat message will time out after 60s with no reply. Add one wherever the reply is ready, or switch this
          back to "Reply with final node output".
        </p>
      )}
    </div>
  );
}

/** "Map all fields" — one-click bulk-insert of a mapping row per top-level key in the
 *  upstream item, matching n8n's Set-node shortcut (Task 6). Flattens one level only:
 *  nested objects/arrays pass through as a single value via sourcePath, not expanded. */
function SetGuidedExtras({
  params,
  onChange,
  mockInput,
}: {
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  mockInput?: unknown;
}) {
  // mockInput is either the raw upstream item or an object with a `.json` envelope,
  // depending on what NodeConfigPanel last pinned/ran — accept either shape.
  const upstreamJson =
    mockInput && typeof mockInput === 'object' && 'json' in (mockInput as Record<string, unknown>)
      ? (mockInput as Record<string, unknown>).json
      : mockInput;
  const topLevelKeys =
    upstreamJson && typeof upstreamJson === 'object' && !Array.isArray(upstreamJson)
      ? Object.keys(upstreamJson as Record<string, unknown>)
      : [];

  if (topLevelKeys.length === 0) return null;

  function mapAllFields() {
    const existing = Array.isArray(params.mappings) ? (params.mappings as Record<string, unknown>[]) : [];
    const generated = topLevelKeys.map((key) => ({ targetPath: key, sourcePath: key }));
    const next = existing.length === 0 ? generated : [...existing, ...generated];
    onChange(setField(params, 'mappings', next));
  }

  return (
    <button
      type="button"
      onClick={mapAllFields}
      className="focus-ring text-xs px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink w-fit"
    >
      ↧ Map all fields from upstream
    </button>
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