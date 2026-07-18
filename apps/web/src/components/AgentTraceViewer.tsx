import type { ReactNode } from 'react';

/**
 * AgentTraceViewer — renders the `trace` an `agent` or `agentOrchestrator`
 * node returns in its output as a readable timeline instead of raw JSON.
 *
 * Two shapes are handled, matching apps/worker/src/nodes/agentNode.ts:
 *  - `agent` output:            { answer, trace: [{step,type:'recall'|'tool_call'|'final',...}], sessionId, recalledMemories }
 *  - `agentOrchestrator` output: { goal, plan, subResults, finalAnswer, sessionId,
 *                                  trace: [{stage:'planner'|'subAgent:X'|'reviewer', ...nested agent output}] }
 *
 * Renders nothing (returns null) if `data` doesn't look like agent output,
 * so callers can render it unconditionally alongside a raw-JSON fallback.
 */

type TraceEntry = Record<string, any>;

function isTraceArray(v: unknown): v is TraceEntry[] {
  return Array.isArray(v) && v.length > 0 && v.every((e) => e && typeof e === 'object');
}

export default function AgentTraceViewer({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (!isTraceArray(d.trace)) return null;
  const trace = d.trace as TraceEntry[];
  const isOrchestrator = trace.some((e) => typeof e.stage === 'string');

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-muted">
        Agent reasoning trace{isOrchestrator ? ' (planner → sub-agents → reviewer)' : ''}
      </p>

      {typeof d.finalAnswer === 'string' && (
        <TraceBubble kind="final" title="✅ Final answer">
          {d.finalAnswer}
        </TraceBubble>
      )}
      {typeof d.answer === 'string' && !isOrchestrator && (
        <TraceBubble kind="final" title="✅ Answer">
          {d.answer}
        </TraceBubble>
      )}

      {Array.isArray(d.plan) && d.plan.length > 0 && (
        <div className="text-xs border border-panelBorder rounded-md p-2 bg-canvas">
          <p className="text-[10px] uppercase text-muted mb-1">Plan</p>
          <ul className="space-y-0.5">
            {(d.plan as Array<{ agent: string; task: string }>).map((s, i) => (
              <li key={i} className="text-ink">
                <span className="text-signal">{s.agent}</span>
                <span className="text-muted">: </span>
                {s.task}
              </li>
            ))}
          </ul>
        </div>
      )}

      <TraceEntries entries={trace} />
    </div>
  );
}

function TraceEntries({ entries }: { entries: TraceEntry[] }) {
  return (
    <div className="space-y-2">
      {entries.map((entry, i) => (
        <TraceEntryCard key={i} entry={entry} />
      ))}
    </div>
  );
}

function TraceEntryCard({ entry }: { entry: TraceEntry }) {
  // Orchestrator stage (planner / subAgent:<name> / reviewer) — itself carries
  // a nested agent output, so recurse into its own `trace` array.
  if (typeof entry.stage === 'string') {
    return (
      <div className="border border-panelBorder rounded-md p-2 bg-panel/40">
        <p className="text-[11px] font-display text-signal uppercase tracking-wide mb-1">
          {entry.stage}
          {entry.task ? <span className="text-muted normal-case"> — {String(entry.task)}</span> : null}
        </p>
        {typeof entry.answer === 'string' && (
          <p className="text-xs text-ink whitespace-pre-wrap mb-1">{entry.answer}</p>
        )}
        {isTraceArray(entry.trace) && (
          <div className="pl-3 border-l border-panelBorder ml-1 mt-2">
            <TraceEntries entries={entry.trace as TraceEntry[]} />
          </div>
        )}
      </div>
    );
  }

  if (entry.type === 'recall') {
    const matches = Array.isArray(entry.matches) ? entry.matches : [];
    return (
      <TraceBubble kind="recall" title={`🧠 Long-term recall — "${entry.query ?? ''}"`}>
        {matches.length === 0 ? (
          <span className="text-muted">no relevant memories found</span>
        ) : (
          <ul className="space-y-1">
            {matches.map((m: any, i: number) => (
              <li key={i} className="text-[11px]">
                <span className="text-muted">
                  [{m.role}, score {Number(m.score ?? 0).toFixed(2)}]
                </span>{' '}
                {m.content}
              </li>
            ))}
          </ul>
        )}
      </TraceBubble>
    );
  }

  if (entry.type === 'tool_call') {
    let argsDisplay = entry.args;
    try {
      argsDisplay = JSON.stringify(JSON.parse(entry.args));
    } catch {
      // leave as-is if not valid JSON
    }
    return (
      <TraceBubble kind="tool" title={`🔧 Tool call — ${entry.tool}`}>
        <p className="text-[11px] text-muted mb-1">
          args: <code className="font-display">{String(argsDisplay)}</code>
        </p>
        <pre className="text-[11px] font-display bg-canvas rounded p-1.5 overflow-x-auto">
          {JSON.stringify(entry.result, null, 2)}
        </pre>
      </TraceBubble>
    );
  }

  if (entry.type === 'final') {
    return (
      <TraceBubble kind="final" title="✅ Final">
        {String(entry.content ?? '')}
      </TraceBubble>
    );
  }

  return (
    <TraceBubble kind="other" title={`step ${entry.step ?? ''}`}>
      <pre className="text-[11px] font-display overflow-x-auto">{JSON.stringify(entry, null, 2)}</pre>
    </TraceBubble>
  );
}

function TraceBubble({
  kind,
  title,
  children,
}: {
  kind: 'final' | 'recall' | 'tool' | 'other';
  title: string;
  children: ReactNode;
}) {
  const border = {
    final: 'border-signal/40',
    recall: 'border-fuchsia-400/40',
    tool: 'border-amber/40',
    other: 'border-panelBorder',
  }[kind];
  return (
    <div className={`text-xs border ${border} rounded-md p-2 bg-canvas`}>
      <p className="text-[11px] font-display text-ink mb-1">{title}</p>
      <div className="text-ink whitespace-pre-wrap">{children}</div>
    </div>
  );
}
