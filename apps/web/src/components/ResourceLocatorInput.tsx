/**
 * ResourceLocatorInput — a parameter input that lets the user pick an
 * external resource (a Google Drive file, a Slack channel, a Notion page,
 * etc.) via three tabs, matching n8n's picker:
 *   1. "List"  — choose from a searchable list fetched from
 *      `GET /integrations/:nodeType/resources/:resource?credentialId=`.
 *   2. "URL"   — paste a link to the resource; the ID is extracted from it
 *      (via the field's `urlExtractRegex`, or a generic last-path-segment
 *      fallback if none is given).
 *   3. "ID"    — type the ID directly. Always available, no network call.
 *
 * The stored value matches n8n's on-disk shape so it round-trips through
 * save/reload without losing the picked display name:
 *   { mode: 'list' | 'url' | 'id', value: string, cachedResultName?: string }
 *
 * For backward compatibility, a plain string value (from before this shape
 * existed) is treated as `{ mode: 'id', value: <string> }`.
 *
 * Usage:
 *   <ResourceLocatorInput
 *     nodeType="googleDrive"
 *     resource="files"
 *     credentialId={credentialId}
 *     value={params.fileId}
 *     label="File"
 *     placeholder="Select a file or paste ID"
 *     onChange={(v) => onChange({ params: { ...params, fileId: v } })}
 *   />
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResourceItem {
  /** The stable ID that will be stored in params. */
  value: string;
  /** Human-readable display name shown in the list. */
  name: string;
}

export type ResourceLocatorMode = 'list' | 'url' | 'id';

/** The n8n-matching on-disk shape this component reads and writes. */
export interface ResourceLocatorValue {
  mode: ResourceLocatorMode;
  value: string;
  /** Display name for `value` — set when picked from the list, or the raw
   *  URL the ID was extracted from when picked via URL mode. Purely
   *  cosmetic: never read by node executors, only rendered back in the UI. */
  cachedResultName?: string;
}

interface Props {
  /** Node type (e.g. "googleDrive") — determines which integration endpoint to call. */
  nodeType: string;
  /** Resource kind (e.g. "files", "spreadsheets", "channels"). */
  resource: string;
  /** The currently-selected credential ID, used as a query param for the list endpoint. */
  credentialId: string | null;
  /** Optional scoping value (e.g. a chosen boardId) sent as `?filter=` — for resources whose
   *  list depends on another field's value, like Trello lists within a board. */
  filter?: string;
  /** Current field value — either the n8n-shaped object, a legacy plain string, or unset. */
  value: unknown;
  /** Which tabs to show. Defaults to ['list', 'id'] — pass 'url' only when `urlExtractRegex`
   *  (or a sensible generic fallback) can actually pull an ID out of that resource's URLs. */
  modes?: ResourceLocatorMode[];
  /** Regex (source string, one capture group) run against a pasted URL to extract the ID.
   *  If omitted, falls back to the last non-empty path segment of the URL. */
  urlExtractRegex?: string;
  /** Field label shown above the input. */
  label?: string;
  placeholder?: string;
  onChange: (value: ResourceLocatorValue) => void;
  className?: string;
}

// ─── Value normalization ─────────────────────────────────────────────────────

function normalize(raw: unknown): ResourceLocatorValue {
  if (raw && typeof raw === 'object' && 'mode' in (raw as Record<string, unknown>) && 'value' in (raw as Record<string, unknown>)) {
    const v = raw as Record<string, unknown>;
    return { mode: (v.mode as ResourceLocatorMode) ?? 'id', value: String(v.value ?? ''), cachedResultName: v.cachedResultName as string | undefined };
  }
  // Legacy plain-string value, or unset.
  return { mode: 'id', value: raw == null ? '' : String(raw) };
}

/** Pulls an ID out of a pasted URL. Tries the field's regex first (its single capture
 *  group is the ID); falls back to the URL's last non-empty path segment, which covers
 *  most REST-ish resource URLs (.../boards/abc123, .../projects/ENG, etc.) without needing
 *  a bespoke pattern for every integration. */
function extractIdFromUrl(url: string, regexSource?: string): string {
  const trimmed = url.trim();
  if (regexSource) {
    try {
      const match = trimmed.match(new RegExp(regexSource));
      if (match?.[1]) return match[1];
    } catch {
      // Malformed regex in the schema — fall through to the generic fallback below.
    }
  }
  try {
    const u = new URL(trimmed);
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length > 0) return segments[segments.length - 1];
  } catch {
    const cleaned = trimmed.split('?')[0].split('#')[0];
    const segments = cleaned.split('/').filter(Boolean);
    if (segments.length > 0) return segments[segments.length - 1];
  }
  return trimmed;
}

const MODE_LABEL: Record<ResourceLocatorMode, string> = { list: 'List', url: 'URL', id: 'ID' };

// ─── Component ──────────────────────────────────────────────────────────────

export default function ResourceLocatorInput({
  nodeType,
  resource,
  credentialId,
  filter,
  value: rawValue,
  modes = ['list', 'id'],
  urlExtractRegex,
  label,
  placeholder = 'Select or enter ID',
  onChange,
  className = '',
}: Props) {
  const stored = normalize(rawValue);
  const [mode, setMode] = useState<ResourceLocatorMode>(stored.mode && modes.includes(stored.mode) ? stored.mode : modes[0]);
  const [items, setItems] = useState<ResourceItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState(stored.mode === 'url' ? stored.cachedResultName ?? '' : '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Derive the display name for the current value from the loaded list, falling back to
  // whatever name was cached at selection time (so it still shows correctly before the
  // list has loaded, e.g. right after reloading a saved workflow).
  const currentName = items?.find((i) => i.value === stored.value)?.name ?? stored.cachedResultName ?? null;

  async function loadItems() {
    if (!credentialId) {
      setError('Select a credential first.');
      return;
    }
    if (filter !== undefined && filter === '') {
      // A dependent resource (filterFromKey set) with nothing selected upstream yet —
      // don't call the endpoint with an empty filter, just show an empty picker.
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(
        `/integrations/${nodeType}/resources/${resource}`,
        { params: { credentialId, ...(filter ? { filter } : {}) } }
      );
      setItems(data.items ?? []);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        // Endpoint not implemented for this nodeType/resource — fall back to ID mode.
        setMode('id');
        setError(null);
      } else {
        setError(err?.response?.data?.error ?? 'Failed to load resources');
      }
    } finally {
      setLoading(false);
    }
  }

  // Dropping the cached list when the scoping filter changes forces a fresh fetch below —
  // belt-and-braces alongside the parent's keyed remount on filterFromKey changes.
  useEffect(() => {
    setItems(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // When switching to list mode (or the filter just cleared the cache above), load items once.
  useEffect(() => {
    if (mode === 'list' && items === null && !loading) {
      loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, items]);

  const filtered = items
    ? search.trim()
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(search.toLowerCase()) ||
            i.value.toLowerCase().includes(search.toLowerCase())
        )
      : items
    : [];

  function selectItem(item: ResourceItem) {
    onChange({ mode: 'list', value: item.value, cachedResultName: item.name });
    setOpen(false);
    setSearch('');
  }

  function commitUrl(url: string) {
    setUrlDraft(url);
    if (!url.trim()) {
      onChange({ mode: 'url', value: '' });
      return;
    }
    const extracted = extractIdFromUrl(url, urlExtractRegex);
    onChange({ mode: 'url', value: extracted, cachedResultName: url.trim() });
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-[11px] text-muted">{label}</label>}

      {modes.length > 1 && (
        <div className="flex items-center gap-0.5">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`focus-ring text-[10px] px-2 py-0.5 rounded border ${
                mode === m
                  ? 'border-signal/50 text-signal bg-signal/5'
                  : 'border-panelBorder text-muted hover:text-ink'
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        {mode === 'id' && (
          /* Direct ID input */
          <input
            ref={inputRef}
            type="text"
            value={stored.value}
            onChange={(e) => onChange({ mode: 'id', value: e.target.value })}
            placeholder={placeholder}
            className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs text-ink"
          />
        )}

        {mode === 'url' && (
          /* Paste-a-URL input — extraction runs live as the user types/pastes. */
          <input
            type="text"
            value={urlDraft}
            onChange={(e) => commitUrl(e.target.value)}
            placeholder="Paste a link to the resource"
            className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs text-ink"
          />
        )}

        {mode === 'list' && (
          /* Picker input */
          <div className="relative flex-1">
            <input
              type="text"
              value={open ? search : currentName ?? stored.value}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!open) setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder={loading ? 'Loading…' : placeholder}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs text-ink"
            />
            {open && (
              <div className="absolute z-30 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-panel border border-panelBorder rounded-md shadow-lg text-xs">
                {loading && <p className="px-3 py-2 text-muted">Loading…</p>}
                {error && <p className="px-3 py-2 text-alert">{error}</p>}
                {!loading && !error && filtered.length === 0 && (
                  <p className="px-3 py-2 text-muted">No results.</p>
                )}
                {!loading &&
                  filtered.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectItem(item)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-canvas ${
                        item.value === stored.value ? 'bg-canvas text-signal' : 'text-ink'
                      }`}
                    >
                      <span className="truncate">{item.name}</span>
                      <span className="shrink-0 text-muted font-display">{item.value}</span>
                    </button>
                  ))}
                <div className="border-t border-panelBorder px-3 py-1.5">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      loadItems();
                    }}
                    className="focus-ring text-[10px] text-muted hover:text-ink"
                  >
                    ↺ Refresh
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Resolved ID confirmation, shown under URL/ID modes once we have a match. */}
      {mode === 'url' && stored.value && (
        <p className="text-[10px] text-signal">→ extracted ID: {stored.value}</p>
      )}
      {mode === 'id' && currentName && <p className="text-[10px] text-signal">✓ {currentName}</p>}
    </div>
  );
}
