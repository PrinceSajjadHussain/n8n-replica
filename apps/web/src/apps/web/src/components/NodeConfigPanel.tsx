import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import ExpressionAutocomplete, { type ExpressionSuggestion } from './ExpressionAutocomplete';
import AgentTraceViewer from './AgentTraceViewer';

interface Props {
  nodeId: string;
  nodeType: string;
  label: string;
  params: Record<string, unknown>;
  credentialId: string | null;
  credentials: { id: string; type: string }[];
  retry: { maxAttempts: number; delayMs: number } | null;
  continueOnFail: boolean;
  isPinned: boolean;
  pinnedOutput: unknown;
  /** Labels of other nodes on the canvas, used to power `$node["Label"].json.*` autocomplete. */
  otherNodeLabels?: string[];
  onChange: (updates: {
    label?: string;
    params?: Record<string, unknown>;
    credentialId?: string | null;
    retry?: { maxAttempts: number; delayMs: number } | null;
    continueOnFail?: boolean;
    isPinned?: boolean;
    pinnedOutput?: unknown;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** True if `output` looks like an `agent`/`agentOrchestrator` node result (has a non-empty `trace` array). */
function hasAgentTrace(output: unknown): boolean {
  return (
    !!output &&
    typeof output === 'object' &&
    Array.isArray((output as Record<string, unknown>).trace) &&
    ((output as Record<string, unknown>).trace as unknown[]).length > 0
  );
}

export default function NodeConfigPanel({
  nodeId,
  nodeType,
  label,
  params,
  credentialId,
  credentials,
  retry,
  continueOnFail,
  isPinned,
  pinnedOutput,
  otherNodeLabels = [],
  onChange,
  onDelete,
  onClose,
}: Props) {
  const [localLabel, setLocalLabel] = useState(label);
  const [paramsJson, setParamsJson] = useState(JSON.stringify(params, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('{}');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<unknown>(undefined);
  const [testItems, setTestItems] = useState<Array<{ json: unknown; binary?: Record<string, { mimeType: string; fileName?: string; fileSize?: number }> }> | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  async function handleTestNode() {
    setTestBusy(true);
    setTestError(null);
    setTestResult(undefined);
    setTestItems(null);
    try {
      let parsedInput: unknown = {};
      try {
        parsedInput = testInput.trim() ? JSON.parse(testInput) : {};
      } catch {
        setTestError('Test input is not valid JSON');
        setTestBusy(false);
        return;
      }
      const { data } = await api.post('/nodes/test-run', {
        nodeType,
        params,
        input: parsedInput,
        credentialId,
      });
      setTestResult(data.output);
      setTestItems(data.items ?? null);
    } catch (err: any) {
      setTestError(err?.response?.data?.error ?? 'Test run failed');
    } finally {
      setTestBusy(false);
    }
  }

  useEffect(() => {
    setLocalLabel(label);
    setParamsJson(JSON.stringify(params, null, 2));
    setJsonError(null);
  }, [nodeId]);

  const nodeSuggestions: ExpressionSuggestion[] = otherNodeLabels.flatMap((l) => [
    { label: `$node["${l}"].json`, detail: `output of "${l}"`, kind: 'node' as const },
    { label: `$node["${l}"].binary`, detail: `binary metadata from "${l}"`, kind: 'binary' as const },
  ]);

  function commitParams() {
    try {
      const parsed = JSON.parse(paramsJson);
      setJsonError(null);
      onChange({ params: parsed });
    } catch {
      setJsonError('Invalid JSON — changes not saved yet.');
    }
  }

  return (
    <aside className="w-80 border-l border-panelBorder bg-panel shrink-0 overflow-y-auto flex flex-col">
      <div className="px-4 py-4 border-b border-panelBorder flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-muted font-display">Configure node</p>
        <button onClick={onClose} className="focus-ring text-muted hover:text-ink text-sm">
          ✕
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1">
        <div>
          <label className="block text-xs text-muted mb-1">Label</label>
          <input
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={() => onChange({ label: localLabel })}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Type</label>
          <p className="text-sm text-muted font-display">{nodeType}</p>
        </div>

        {[
          'httpRequest',
          'slack',
          'discord',
          'telegram',
          'notion',
          'github',
          'postgres',
          'email',
          'googleSheets',
          'openai',
          'ragIngest',
          'ragQuery',
          'agent',
          'agentMemory',
          'agentOrchestrator',
          'browserAutomation',
        ].includes(nodeType) && (
          <div>
            <label className="block text-xs text-muted mb-1">Credential</label>
            <select
              value={credentialId ?? ''}
              onChange={(e) => onChange({ credentialId: e.target.value || null })}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type} ({c.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="border-t border-panelBorder pt-4">
          <p className="text-xs uppercase tracking-widest text-muted mb-2">Error handling</p>
          <label className="flex items-center gap-2 text-sm text-ink mb-2">
            <input
              type="checkbox"
              checked={continueOnFail}
              onChange={(e) => onChange({ continueOnFail: e.target.checked })}
            />
            Continue on fail (downstream nodes still run; error is passed as output)
          </label>
          <label className="flex items-center gap-2 text-sm text-ink mb-1">
            <input
              type="checkbox"
              checked={retry != null}
              onChange={(e) =>
                onChange({ retry: e.target.checked ? { maxAttempts: 3, delayMs: 1000 } : null })
              }
            />
            Retry on failure
          </label>
          {retry != null && (
            <div className="flex gap-2 pl-6">
              <div>
                <label className="block text-[10px] text-muted">Max attempts</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={retry.maxAttempts}
                  onChange={(e) => onChange({ retry: { ...retry, maxAttempts: Number(e.target.value) } })}
                  className="focus-ring w-20 bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted">Delay (ms)</label>
                <input
                  type="number"
                  min={0}
                  max={60000}
                  value={retry.delayMs}
                  onChange={(e) => onChange({ retry: { ...retry, delayMs: Number(e.target.value) } })}
                  className="focus-ring w-24 bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs"
                />
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">
            Params (JSON) <span className="text-muted/70 normal-case">— type {'{{'} for expression autocomplete</span>
          </label>
          <ExpressionAutocomplete
            value={paramsJson}
            onChange={setParamsJson}
            onBlur={commitParams}
            rows={10}
            extraSuggestions={nodeSuggestions}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-xs font-display"
          />
          {jsonError && <p className="text-alert text-xs mt-1">{jsonError}</p>}
          <p className="text-muted text-[11px] mt-1">
            {paramHint(nodeType)}
          </p>
          <p className="text-muted text-[11px] mt-2 border-t border-panelBorder pt-2">
            Expressions work in any string param: <code>{'{{$json.field}}'}</code>,{' '}
            <code>{'{{$node["Label"].json.field}}'}</code>, <code>{'{{$binary.data.mimeType}}'}</code>,{' '}
            <code>{'{{$env.NAME}}'}</code>, <code>{'{{$now}}'}</code>. Helper functions:{' '}
            <code>{'{{$fn.date.format($json.createdAt,"YYYY-MM-DD")}}'}</code>,{' '}
            <code>{'{{$fn.string.upper($json.name)}}'}</code>,{' '}
            <code>{'{{$fn.math.round($json.total)}}'}</code>,{' '}
            <code>{'{{$fn.random.uuid()}}'}</code>, <code>{'{{$fn.hash.sha256($json.id)}}'}</code>.
          </p>
        </div>

        <div className="border-t border-panelBorder pt-4">
          <p className="text-xs uppercase tracking-widest text-muted mb-2">Test node</p>
          <label className="block text-[10px] text-muted mb-1">Mock input (JSON)</label>
          <textarea
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            rows={3}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs font-display mb-2"
          />
          <button
            onClick={handleTestNode}
            disabled={testBusy}
            className="focus-ring text-xs px-3 py-1.5 rounded-md border border-signal/40 text-signal hover:bg-signal/10 disabled:opacity-50"
          >
            {testBusy ? 'Running…' : '▶ Run this node in isolation'}
          </button>
          {testError && <p className="text-alert text-xs mt-2">{testError}</p>}
          {testResult !== undefined && (
            <div className="mt-2">
              {hasAgentTrace(testResult) ? (
                <>
                  <AgentTraceViewer data={testResult} />
                  <details className="mt-2">
                    <summary className="text-[10px] uppercase text-muted cursor-pointer select-none">
                      Raw JSON output
                    </summary>
                    <pre className="text-[11px] bg-canvas border border-panelBorder rounded-md p-2 mt-1 max-h-40 overflow-auto">
                      {JSON.stringify(testResult, null, 2)}
                    </pre>
                  </details>
                </>
              ) : (
                <pre className="text-[11px] bg-canvas border border-panelBorder rounded-md p-2 max-h-40 overflow-auto">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              )}
              {testItems?.some((it) => it.binary && Object.keys(it.binary).length > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {testItems.flatMap((it, itemIdx) =>
                    Object.entries(it.binary ?? {}).map(([key, b]) => (
                      <span
                        key={`${itemIdx}-${key}`}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-fuchsia-400/40 text-fuchsia-400"
                        title={`item[${itemIdx}].binary.${key}`}
                      >
                        📎 {key}: {b.fileName ?? b.mimeType} {b.fileSize ? `(${Math.round(b.fileSize / 1024)}KB)` : ''}
                      </span>
                    ))
                  )}
                </div>
              )}
              <button
                onClick={() => onChange({ isPinned: true, pinnedOutput: testResult })}
                className="focus-ring text-xs mt-1 px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink"
              >
                📌 Pin this output
              </button>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-panelBorder">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={isPinned} onChange={(e) => onChange({ isPinned: e.target.checked })} />
              Pin data (freeze this node's output — skips real execution/credential calls on run)
            </label>
            {isPinned && (
              <pre className="text-[11px] bg-canvas border border-panelBorder rounded-md p-2 mt-2 max-h-32 overflow-auto">
                {JSON.stringify(pinnedOutput, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-panelBorder">
        <button
          onClick={onDelete}
          className="focus-ring w-full text-sm text-alert hover:bg-alert/10 rounded-md py-2 transition"
        >
          Delete node
        </button>
      </div>
    </aside>
  );
}

function paramHint(nodeType: string): string {
  switch (nodeType) {
    case 'webhook':
      return 'e.g. { "path": "orders" } — this becomes /webhook/:workflowId/orders';
    case 'schedule':
      return 'e.g. { "cron": "*/5 * * * *" }';
    case 'httpRequest':
      return 'e.g. { "url": "https://api.example.com", "method": "GET" }';
    case 'if':
      return 'e.g. { "field": "amount", "operator": "greaterThan", "value": 100 }';
    case 'set':
      return 'e.g. { "mappings": [{ "targetPath": "summary", "staticValue": "done" }] }';
    case 'code':
      return 'e.g. { "code": "return { doubled: input.value * 2 };" }';
    case 'slack':
      return 'e.g. { "text": "New order received!" } — requires a Slack credential';
    case 'switch':
      return 'e.g. { "field": "status", "cases": [{"handle":"paid","value":"paid"},{"handle":"failed","value":"failed"}], "fallbackToDefault": true } — connect edges from the "paid"/"failed"/"default" handles';
    case 'subWorkflow':
      return 'e.g. { "workflowId": "..." } — runs another saved workflow with this node\'s input as its trigger payload, returns its output. Find the id in that workflow\'s URL.';
    case 'forEachBranch':
      return 'e.g. { "itemsPath": "rows", "subgraph": { "nodes": [...], "edges": [...] }, "parallel": false } — runs a full mini-workflow once per item. A leaf node output of { "__break": true } stops the loop; { "__skip": true } excludes that item.';
    case 'waitForWebhook':
      return 'No params needed. Pauses the run here until POST /webhook-resume/:token is called (the token is in this node\'s live output when it pauses) — e.g. wait for a payment provider callback.';
    case 'humanApproval':
      return 'No params needed. Pauses the run for a person to approve/reject via the Executions view (or POST /executions/:id/approve|reject). Connect the "true"/"false" branch handles to what happens next.';
    case 'wait':
      return 'e.g. { "seconds": 30 } — pauses this branch, then passes input through unchanged';
    case 'forEach':
      return 'e.g. { "itemsPath": "rows", "code": "return { id: item.id, doubled: item.value * 2 };", "batchSize": 10 }';
    case 'discord':
      return 'e.g. { "content": "Deploy finished ✅" } — requires a "discord" credential { "webhookUrl": "..." }';
    case 'telegram':
      return 'e.g. { "chatId": "123456", "text": "Hello" } — requires a "telegram" credential { "botToken": "..." }';
    case 'notion':
      return 'e.g. { "action": "createPage", "databaseId": "...", "properties": {} } — requires a "notion" credential { "apiKey": "secret_..." }';
    case 'github':
      return 'e.g. { "action": "createIssue", "owner": "acme", "repo": "app", "title": "Bug" } — requires a "github" credential { "token": "..." }';
    case 'postgres':
      return 'e.g. { "query": "SELECT * FROM orders WHERE id = $1", "values": [123] } — requires a "postgres" credential { "connectionString": "postgresql://..." }';
    case 'openai':
      return 'e.g. { "prompt": "Summarize: {{input}}", "jsonMode": false } — requires an "openai" credential { "apiKey": "sk-..." }';
    case 'ragIngest':
      return 'e.g. { "namespace": "docs", "source": "url", "url": "https://...", "chunking": { "strategy": "markdown" }, "vectorStore": "pgvector" } — requires an "openai" credential (embeddings). ' +
        '"source": "auto" (default, reads binary from upstream node or params.text/documents) | "text" | "binary" (PDF/DOCX/CSV/HTML from upstream binary) | "url" | "website" ({ "website": { "startUrl", "maxPages", "sameDomainOnly" } } — crawls same-domain links) | "googleDrive" ({ "googleDrive": { "fileId" } }, requires a "google" OAuth credential) | "notion" ({ "notion": { "pageId" } }, requires a "notion" credential) | "confluence" ({ "confluence": { "baseUrl", "pageId" } }, requires a "confluence" credential { email, apiToken }). ' +
        '"chunking.strategy": "fixed" (chunkSize/chunkOverlap chars) | "token" (maxTokens/overlapTokens, default) | "markdown" (splits on headings, keeps a headerPath breadcrumb) | "semantic" (embeds sentences and merges by topic similarity, breakpointThreshold/semanticMaxTokens). ' +
        '"vectorStore": "json" (default, zero-infra) | "pgvector" | "pinecone" | "qdrant" | "weaviate" — configured via env vars, see .env.example.';
    case 'ragQuery':
      return 'e.g. { "namespace": "docs", "query": "refund policy?", "topK": 4, "hybrid": true, "filter": { "sourceType": "pdf" }, "rerank": { "provider": "cohere", "topN": 4 }, "answerWithModel": true } — ' +
        '"hybrid" (default true) fuses BM25 keyword search with vector search via Reciprocal Rank Fusion. "filter" is an exact-match metadata filter (e.g. by fileName/sourceType/docId — whatever the ingest step stamped). ' +
        '"rerank.provider": "none" (default) | "cohere" (requires a "cohere" credential or COHERE_API_KEY) | "llm" (uses the node\'s "openai" credential as a fallback reranker). ' +
        'Output includes "citations": [{ n, source, snippet, metadata }] for a citation viewer, plus "answer" with inline [n] citations when answerWithModel is true.';
    case 'browserAutomation':
      return 'e.g. { "url": "https://example.com", "steps": [{ "action": "click", "selector": "#login" }] } — requires the browser-runner service, see docs/browser-automation.md';
    case 'agent':
      return 'e.g. { "sessionId": "customer-42", "systemPrompt": "You are a support agent.", "prompt": "{{$json.message}}", "tools": [{ "name": "send_slack", "nodeType": "slack", "description": "Post a Slack message", "parameters": { "text": { "type": "string" } } }], "recentTurns": 12, "longTermMemory": true, "recallTopK": 4 } — requires an "openai" credential. Memory persists across runs by sessionId: recent turns are replayed verbatim, older turns are recalled by semantic (vector) search. See docs/ai-agents.md.';
    case 'agentMemory':
      return 'e.g. { "action": "recall", "sessionId": "customer-42", "query": "what did they order last time?", "topK": 5 } — actions: "read" (recent turns), "write" ({ role, content }), "clear", "recall" (vector search over ALL stored turns). An "openai" credential enables embeddings for write/recall.';
    case 'agentOrchestrator':
      return 'e.g. { "goal": "Research and draft a reply", "subAgents": [{ "name": "researcher", "systemPrompt": "...", "tools": [] }, { "name": "writer", "systemPrompt": "..." }] } — planner breaks the goal into subtasks, routes to named sub-agents, reviewer synthesizes a final answer. All stages share memory/sessionId. Output includes a per-stage `trace` — see the reasoning trace below after a test run.';
    default:
      return 'Configure this node\u2019s parameters as JSON.';
  }
}
