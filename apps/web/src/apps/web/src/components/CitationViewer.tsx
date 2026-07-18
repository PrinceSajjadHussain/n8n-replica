/**
 * CitationViewer — renders the `citations`/`answer` a `ragQuery` node
 * returns (see apps/worker/src/nodes/ragNode.ts) as a readable panel:
 * the grounded answer with its [n] markers, followed by the numbered
 * source passages they refer to (score, source label, metadata,
 * snippet). Renders nothing if `data` doesn't look like ragQuery output.
 */

interface Citation {
  n: number;
  id: string;
  score: number;
  text: string;
  snippet: string;
  source: unknown;
  metadata: Record<string, unknown>;
}

function isCitationArray(v: unknown): v is Citation[] {
  return Array.isArray(v) && v.every((e) => e && typeof e === 'object' && typeof (e as Citation).n === 'number');
}

/** Splits an answer string on [n] markers so each citation number can be highlighted inline. */
function renderAnswerWithMarkers(answer: string) {
  const parts = answer.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (m) {
      return (
        <a key={i} href={`#citation-${m[1]}`} className="inline-block px-1 rounded bg-accent/20 text-accent text-xs font-medium align-middle">
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function CitationViewer({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (!isCitationArray(d.citations)) return null;
  const citations = d.citations as Citation[];
  const answer = typeof d.answer === 'string' ? d.answer : null;

  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-widest text-muted">
        RAG result{d.hybrid ? ' · hybrid search' : ''}
        {d.reranked ? ' · reranked' : ''} · {String(d.vectorStore ?? '')}
      </p>

      {answer && (
        <div className="rounded-md border border-panelBorder bg-canvas px-3 py-2.5 text-sm leading-relaxed">
          {renderAnswerWithMarkers(answer)}
        </div>
      )}

      {citations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase text-muted">Sources</p>
          {citations.map((c) => (
            <div key={c.id} id={`citation-${c.n}`} className="rounded-md border border-panelBorder bg-panel px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-medium">
                  [{c.n}] {String(c.source)}
                </span>
                <span className="text-muted shrink-0">score {c.score.toFixed(3)}</span>
              </div>
              <p className="text-muted leading-relaxed">{c.snippet}</p>
              {c.metadata && Object.keys(c.metadata).length > 0 && (
                <details className="mt-1">
                  <summary className="text-[10px] uppercase text-muted cursor-pointer select-none">Metadata</summary>
                  <pre className="text-[10px] font-display mt-1 overflow-x-auto">{JSON.stringify(c.metadata, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
