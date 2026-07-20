import { useEffect, useState } from 'react';

export interface NodeRunSnapshot {
  status: 'running' | 'success' | 'failed' | 'skipped' | 'idle' | 'paused';
  input?: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
  itemCount?: number;
  /** Binary attachment metadata (+ inline base64 `preview` for small image/PDF files), keyed by binary property name — see executor.ts's itemsToBinaryPreview. */
  binary?: unknown;
  /** Per-param expression evaluation errors from this run (Fix 4) — surfaced instead of silently blank values. */
  expressionErrors?: { param: string; message: string; type: string }[];
}

interface BinaryEntry {
  mimeType: string;
  fileName?: string;
  fileSize?: number;
  preview?: string;
}

function formatJson(value: unknown): string {
  if (value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatBytes(n?: number): string {
  if (typeof n !== 'number') return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders one binary attachment as a thumbnail (image), a "PDF" chip
 *  (opens inline via a data: URL when a preview was included), or a plain
 *  file chip with just the metadata when no inline preview was sent. */
function BinaryChip({ name, entry }: { name: string; entry: BinaryEntry }) {
  const isImage = entry.mimeType.startsWith('image/');
  const isPdf = entry.mimeType === 'application/pdf';
  const dataUrl = entry.preview ? `data:${entry.mimeType};base64,${entry.preview}` : undefined;

  return (
    <div className="flex items-center gap-2 rounded-md border border-panelBorder bg-canvas px-2 py-1.5">
      {isImage && dataUrl ? (
        <img src={dataUrl} alt={entry.fileName ?? name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded bg-panel border border-panelBorder flex items-center justify-center text-[10px] flex-shrink-0">
          {isPdf ? '📄' : '📎'}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] truncate">{entry.fileName ?? name}</p>
        <p className="text-[10px] text-muted truncate">
          {entry.mimeType}
          {entry.fileSize ? ` · ${formatBytes(entry.fileSize)}` : ''}
        </p>
      </div>
      {isPdf && dataUrl && (
        <a
          href={dataUrl}
          target="_blank"
          rel="noreferrer"
          className="focus-ring text-[10px] text-signal flex-shrink-0"
        >
          Open
        </a>
      )}
    </div>
  );
}

/** Small copy-to-clipboard affordance shared by every JSON pane in the
 *  popover — flips to a brief "Copied" confirmation, then reverts. */
function CopyButton({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          /* clipboard unavailable (permissions/insecure context) — silently no-op */
        }
      }}
      className={`focus-ring text-[10px] px-1.5 py-0.5 rounded border border-panelBorder text-muted hover:text-ink hover:border-signal/40 ${className}`}
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

/** Skeleton shimmer shown in place of the JSON pane while a `test-run` or
 *  live execution is in flight, instead of a blank pane until data lands. */
function JsonSkeleton() {
  return (
    <div className="flex-1 overflow-hidden m-3 mt-2 bg-canvas border border-panelBorder rounded-md p-2 flex flex-col gap-1.5">
      {[92, 76, 84, 60, 70].map((w, i) => (
        <div key={i} className="h-2.5 rounded bg-panelBorder/60 animate-pulse" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function BinaryPreview({ binary }: { binary: unknown }) {
  if (!binary || typeof binary !== 'object') return null;
  const entries = Object.entries(binary as Record<string, BinaryEntry>);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 mx-3 mt-2">
      {entries.map(([name, entry]) => (
        <BinaryChip key={name} name={name} entry={entry} />
      ))}
    </div>
  );
}

/** n8n-style popover shown when a canvas node's data badge is clicked mid-run
 *  or after a run: lets you flip between the node's input and output JSON. */
export default function NodeInspectPopover({
  label,
  snapshot,
  onClose,
}: {
  label: string;
  snapshot: NodeRunSnapshot;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'input' | 'output'>('output');
  const [itemIndex, setItemIndex] = useState(0);
  const rawBody = tab === 'input' ? snapshot.input : snapshot.error ? snapshot.error : snapshot.output;

  // Per-item drill-down: for a batch result (array of items), let the
  // user step through item N/total instead of dumping the whole array.
  const isBatch = Array.isArray(rawBody) && rawBody.length > 1;
  const clampedIndex = isBatch ? Math.min(itemIndex, (rawBody as unknown[]).length - 1) : 0;
  const body = isBatch ? (rawBody as unknown[])[clampedIndex] : rawBody;

  // Skeleton while a run is in flight and this pane's data hasn't arrived yet.
  const isLoading = snapshot.status === 'running' && body === undefined;

  return (
    <div
      className="absolute z-40 top-full mt-2 left-1/2 -translate-x-1/2 w-80 max-h-80 flex flex-col bg-panel border border-panelBorder rounded-lg shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-panelBorder">
        <p className="text-xs font-medium truncate">{label}</p>
        <button onClick={onClose} className="focus-ring text-muted hover:text-ink text-xs leading-none px-1">
          ✕
        </button>
      </div>
      <div className="flex items-center gap-3 px-3 pt-2 text-[11px] text-muted">
        {typeof snapshot.durationMs === 'number' && <span>{snapshot.durationMs} ms</span>}
        {typeof snapshot.itemCount === 'number' && (
          <span>
            {snapshot.itemCount} item{snapshot.itemCount === 1 ? '' : 's'}
          </span>
        )}
        <span className={snapshot.status === 'failed' ? 'text-alert' : snapshot.status === 'running' || snapshot.status === 'paused' ? 'text-amber' : 'text-signal'}>
          {snapshot.status}
        </span>
      </div>
      <div className="flex gap-1 px-3 pt-2">
        {(['input', 'output'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setItemIndex(0);
            }}
            className={`focus-ring text-[11px] px-2 py-1 rounded-md border ${
              tab === t ? 'border-signal/50 text-signal bg-signal/10' : 'border-panelBorder text-muted hover:text-ink'
            }`}
          >
            {t === 'input' ? 'Input' : snapshot.error ? 'Error' : 'Output'}
          </button>
        ))}
        {isBatch && (
          <div className="ml-auto flex items-center gap-1 text-[10px] text-muted">
            <button
              onClick={() => setItemIndex((i) => Math.max(0, i - 1))}
              disabled={clampedIndex === 0}
              className="focus-ring px-1 rounded border border-panelBorder disabled:opacity-30"
              aria-label="Previous item"
            >
              ‹
            </button>
            <span>
              {clampedIndex + 1}/{(rawBody as unknown[]).length}
            </span>
            <button
              onClick={() => setItemIndex((i) => Math.min((rawBody as unknown[]).length - 1, i + 1))}
              disabled={clampedIndex === (rawBody as unknown[]).length - 1}
              className="focus-ring px-1 rounded border border-panelBorder disabled:opacity-30"
              aria-label="Next item"
            >
              ›
            </button>
          </div>
        )}
      </div>
      <BinaryPreview binary={snapshot.binary} />
      {isLoading ? (
        <JsonSkeleton />
      ) : (
        <div className="relative flex-1 min-h-0 m-3 mt-2">
          <CopyButton value={formatJson(body)} className="absolute top-1.5 right-1.5 bg-panel" />
          <pre className="h-full overflow-auto text-[11px] leading-snug whitespace-pre-wrap break-words bg-canvas border border-panelBorder rounded-md p-2 pr-14">
            {formatJson(body)}
          </pre>
        </div>
      )}
      {snapshot.expressionErrors && snapshot.expressionErrors.length > 0 && (
        <div className="mx-3 mb-3 rounded-md border border-alert/40 bg-alert/5 px-2 py-1.5">
          <p className="text-[10px] font-medium text-alert mb-1">
            {snapshot.expressionErrors.length} expression error{snapshot.expressionErrors.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-1">
            {snapshot.expressionErrors.map((e, i) => (
              <li key={i} className="text-[10px] text-alert/90 leading-snug">
                <span className="font-mono">{e.param || '(root)'}</span> — {e.message}{' '}
                <span className="text-alert/60">[{e.type}]</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
