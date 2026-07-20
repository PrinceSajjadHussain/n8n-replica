/**
 * ResourceLocatorInput — a parameter input that lets the user pick an
 * external resource (a Google Drive file, a Slack channel, a Notion page,
 * etc.) either by:
 *   1. Typing the ID directly (always available, no network call needed).
 *   2. Choosing from a searchable list fetched from a small
 *      `GET /integrations/:nodeType/resources/:resource?credentialId=` endpoint.
 *
 * Matches n8n's audit section 18 approach: `{ value, name }[]` endpoint per
 * integration, generic component that works for any of them.
 *
 * Usage:
 *   <ResourceLocatorInput
 *     nodeType="googleDrive"
 *     resource="files"
 *     credentialId={credentialId}
 *     value={params.fileId as string}
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

interface Props {
  /** Node type (e.g. "googleDrive") — determines which integration endpoint to call. */
  nodeType: string;
  /** Resource kind (e.g. "files", "spreadsheets", "channels"). */
  resource: string;
  /** The currently-selected credential ID, used as a query param for the list endpoint. */
  credentialId: string | null;
  /** Current field value (the stable resource ID). */
  value: string;
  /** Field label shown above the input. */
  label?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
}

// ─── Resource list endpoint ─────────────────────────────────────────────────
//
// The API endpoint convention:
//   GET /integrations/:nodeType/resources/:resource?credentialId=...
// Returns: { items: ResourceItem[] }
//
// This component gracefully degrades if the endpoint doesn't exist (404)
// or the user has no credential: it falls back to a plain text input.

// ─── Component ──────────────────────────────────────────────────────────────

export default function ResourceLocatorInput({
  nodeType,
  resource,
  credentialId,
  value,
  label,
  placeholder = 'Select or enter ID',
  onChange,
  className = '',
}: Props) {
  const [mode, setMode] = useState<'id' | 'list'>('id');
  const [items, setItems] = useState<ResourceItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Derive the display name for the current value from the loaded list.
  const currentName = items?.find((i) => i.value === value)?.name ?? null;

  async function loadItems() {
    if (!credentialId) {
      setError('Select a credential first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(
        `/integrations/${nodeType}/resources/${resource}`,
        { params: { credentialId } }
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

  // When switching to list mode, load items once.
  useEffect(() => {
    if (mode === 'list' && items === null && !loading) {
      loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
    onChange(item.value);
    setOpen(false);
    setSearch('');
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-[11px] text-muted">
          {label}
        </label>
      )}

      <div className="flex items-center gap-1">
        {/* Mode toggle: list picker vs plain-ID input */}
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'id' ? 'list' : 'id'))}
          title={mode === 'id' ? 'Switch to picker' : 'Switch to ID input'}
          className="focus-ring shrink-0 text-[10px] px-1.5 py-1 rounded border border-panelBorder text-muted hover:text-ink hover:border-signal/40"
        >
          {mode === 'id' ? '≡' : '#'}
        </button>

        {mode === 'id' ? (
          /* Direct ID input */
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs text-ink"
          />
        ) : (
          /* Picker input */
          <div className="relative flex-1">
            <input
              type="text"
              value={open ? search : currentName ?? value}
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
                {loading && (
                  <p className="px-3 py-2 text-muted">Loading…</p>
                )}
                {error && (
                  <p className="px-3 py-2 text-alert">{error}</p>
                )}
                {!loading && !error && filtered.length === 0 && (
                  <p className="px-3 py-2 text-muted">No results.</p>
                )}
                {!loading && filtered.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectItem(item)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-canvas ${
                      item.value === value ? 'bg-canvas text-signal' : 'text-ink'
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
                    onClick={() => { loadItems(); }}
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

      {/* Show the resolved name when in ID mode and we have a match */}
      {mode === 'id' && currentName && (
        <p className="text-[10px] text-signal ml-7">✓ {currentName}</p>
      )}
    </div>
  );
}
