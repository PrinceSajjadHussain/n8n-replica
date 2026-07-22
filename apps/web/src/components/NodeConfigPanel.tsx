import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../store/toastStore';
import ExpressionAutocomplete, { type ExpressionSuggestion } from './ExpressionAutocomplete';
import AgentTraceViewer from './AgentTraceViewer';
import CredentialQuickCreateModal from './CredentialQuickCreateModal';
import SwitchCasesEditor from './SwitchCasesEditor';
import IfConditionsEditor from './IfConditionsEditor';
import ParamForm from './Paramform';
import SchemaTreeView from './SchemaTreeView';
import { getParamSchema } from '../lib/paramSchemas';
import { getNodeTypeMeta } from '../lib/nodeTypeMeta';
import { CREDENTIAL_TYPE_META, NODE_TYPE_TO_CREDENTIAL_TYPE, type CredentialType } from '../lib/credentialSchemas';
import { getDefaultMockInput } from '../lib/nodeDefaults';

interface Props {
  nodeId: string;
  nodeType: string;
  label: string;
  params: Record<string, unknown>;
  credentialId: string | null;
  credentials: { id: string; type: string; name?: string; lastTestOk?: boolean | null }[];
  /** Called after a credential is created inline so the parent can refresh its list. */
  onCredentialsRefresh?: () => void;
  retry: { maxAttempts: number; delayMs: number } | null;
  continueOnFail: boolean;
  isPinned: boolean;
  pinnedOutput: unknown;
  /** Freeform per-node note (n8n-style), distinct from canvas-level sticky notes. */
  notes?: string | null;
  /** Labels of other nodes on the canvas, used to power `$node["Label"].json.*` autocomplete. */
  otherNodeLabels?: string[];
  /** Current workflow id, used only to render the webhook node's "final URL" preview. */
  workflowId?: string;
  /** When the canvas is in replay mode, the execution currently being viewed — "Run workflow from here" reuses that execution's cached upstream outputs instead of the latest one. */
  replayExecutionId?: string;
  /** params.path of every other webhook node on the canvas, for the duplicate-path warning. */
  siblingWebhookPaths?: string[];
  /** params.path of every other chatTrigger node on the canvas, for the duplicate-path warning. */
  siblingChatPaths?: string[];
  /** Whether a "Respond to Webhook" node exists anywhere else on the canvas. */
  hasRespondToWebhookNode?: boolean;
  /** Whether the workflow is currently published/active — webhook and chat trigger URL previews use the `/test/...` path while unpublished, matching the API's test/production route split. */
  isWorkflowActive?: boolean;
  /** Opens the floating Test Chat widget for this node (lifted up to CanvasPage so Run can also auto-open it, and so it survives switching node selection). */
  onOpenChatTest?: () => void;
  /** Last-run output for this node — drives SchemaTreeView for drag-to-insert field references. */
  lastRunOutput?: unknown;
  /** Last-run input for this node — used as $json mock context in ExpressionEditorInput live preview. */
  lastRunInput?: unknown;
  /** Per-param expression failures from the node's last real execution (Fix 4 plumbing) — distinct from ExpressionEditorInput's live-preview errors, which only reflect the current unsaved edit. Surfaced as an inline warning list so a failed expression from an actual run is never silently invisible. */
  lastRunExpressionErrors?: { param: string; message: string; type: string }[];
  /** Real recorded output of the node feeding into this one (if any), used to seed the Test Node mock input instead of an empty object. */
  upstreamOutput?: unknown;
  /** Every ancestor node reachable upstream of this one (not just direct parents), each with its own last-run output — powers the "reference any upstream node" dropdown in the I/O panel, matching n8n's node dropdown in the expression schema view. */
  upstreamNodes?: { id: string; label: string; output: unknown }[];
  onChange: (updates: {
    label?: string;
    params?: Record<string, unknown>;
    credentialId?: string | null;
    retry?: { maxAttempts: number; delayMs: number } | null;
    continueOnFail?: boolean;
    isPinned?: boolean;
    pinnedOutput?: unknown;
    notes?: string | null;
    lastRunInput?: unknown;
    lastRunOutput?: unknown;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Inserts an expression string into whichever textarea/input currently has focus (used by both drag-drop and click-to-insert from the schema tree / table). Falls back to the clipboard if nothing is focused. */
function insertIntoFocusedInput(expr: string) {
  const active = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;
    const next = active.value.slice(0, start) + expr + active.value.slice(end);
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      ?? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    nativeInputValueSetter?.call(active, next);
    active.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    navigator.clipboard.writeText(expr).catch(() => {});
  }
}

/**
 * NodeIoPanel — n8n-style Input/Output tabs, each with a Schema / Table / JSON
 * sub-view toggle (matches n8n's node detail view: left pane = upstream
 * input, right pane = this node's own output, both drag-to-insert).
 */
/** Extracts every `.binary` map across a node's output items into a flat, insertable field list — mirrors n8n's dedicated "Binary" tab for file-producing nodes (HTTP Request downloads, File Extract, etc.). */
function extractBinaryFields(
  output: unknown
): { itemIdx: number; key: string; mimeType?: string; fileName?: string; fileSize?: number }[] {
  const items = Array.isArray(output) ? output : output !== undefined ? [output] : [];
  const fields: { itemIdx: number; key: string; mimeType?: string; fileName?: string; fileSize?: number }[] = [];
  items.forEach((item, itemIdx) => {
    const binary = item && typeof item === 'object' ? (item as Record<string, unknown>).binary : undefined;
    if (!binary || typeof binary !== 'object') return;
    for (const [key, meta] of Object.entries(binary as Record<string, unknown>)) {
      const m = (meta ?? {}) as Record<string, unknown>;
      fields.push({
        itemIdx,
        key,
        mimeType: typeof m.mimeType === 'string' ? m.mimeType : undefined,
        fileName: typeof m.fileName === 'string' ? m.fileName : undefined,
        fileSize: typeof m.fileSize === 'number' ? m.fileSize : undefined,
      });
    }
  });
  return fields;
}

function BinaryView({
  output,
  nodeLabel,
  refKind,
  onInsert,
}: {
  output: unknown;
  nodeLabel: string;
  refKind: 'output' | 'input';
  onInsert: (expr: string) => void;
}) {
  const fields = extractBinaryFields(output);
  if (fields.length === 0) {
    return <p className="text-[11px] text-muted px-2 py-3">No binary/file data on this side — run the node first.</p>;
  }
  const root = refKind === 'input' ? '$binary' : `$node["${nodeLabel}"].binary`;
  return (
    <div className="p-2 space-y-1.5 max-h-64 overflow-auto">
      {fields.map((f, i) => {
        const expr = `{{${root}.${f.key}}}`;
        return (
          <div
            key={`${f.itemIdx}-${f.key}-${i}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', expr);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onInsert(expr)}
            title={`Insert: ${expr}`}
            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-panelBorder cursor-pointer hover:bg-signal/10"
          >
            <span className="text-[11px] font-display text-ink truncate">
              📎 {f.fileName ?? f.key} <span className="text-muted">[{f.itemIdx}]</span>
            </span>
            <span className="text-[9px] text-muted shrink-0">
              {f.mimeType ?? ''} {f.fileSize ? `· ${Math.round(f.fileSize / 1024)}KB` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NodeIoPanel({
  nodeLabel,
  input,
  output,
  side,
  view,
  onSideChange,
  onViewChange,
  onInsert,
  upstreamNodes = [],
  refNodeId,
  onRefNodeChange,
}: {
  nodeLabel: string;
  input: unknown;
  output: unknown;
  side: 'input' | 'output';
  view: 'schema' | 'table' | 'json' | 'binary';
  onSideChange: (side: 'input' | 'output') => void;
  onViewChange: (view: 'schema' | 'table' | 'json' | 'binary') => void;
  onInsert: (expr: string) => void;
  /** Ancestor nodes available to reference instead of this node's own input/output. */
  upstreamNodes?: { id: string; label: string; output: unknown }[];
  /** '' = viewing this node's own input/output; otherwise an upstream node id. */
  refNodeId: string;
  onRefNodeChange: (id: string) => void;
}) {
  const viewingUpstream = refNodeId !== '';
  const upstreamNode = upstreamNodes.find((n) => n.id === refNodeId);
  const activeData = viewingUpstream ? upstreamNode?.output : side === 'input' ? input : output;
  const activeLabel = viewingUpstream ? upstreamNode?.label ?? nodeLabel : nodeLabel;
  const activeRefKind: 'output' | 'input' = viewingUpstream ? 'output' : side;
  const hasInput = input !== undefined;
  const hasOutput = output !== undefined;

  const tabBtn = (active: boolean) =>
    `focus-ring flex-1 text-[10px] uppercase tracking-widest px-2 py-1 border-b-2 transition ${
      active ? 'border-signal text-signal' : 'border-transparent text-muted hover:text-ink'
    }`;
  const viewBtn = (active: boolean) =>
    `focus-ring text-[10px] px-2 py-0.5 rounded border transition ${
      active ? 'border-signal/50 text-signal bg-signal/10' : 'border-panelBorder text-muted hover:text-ink'
    }`;

  return (
    <div>
      {/* Reference-node picker — lets you pull the schema/payload of ANY upstream
          ancestor, not just this node's direct input, mirroring n8n's node dropdown
          in the expression editor's schema pane. */}
      {upstreamNodes.length > 0 && (
        <div className="px-2 py-1.5 bg-canvas border-b border-panelBorder">
          <select
            value={refNodeId}
            onChange={(e) => onRefNodeChange(e.target.value)}
            className="focus-ring w-full bg-panel border border-panelBorder rounded-md px-2 py-1 text-[11px]"
          >
            <option value="">This node ({side === 'input' ? 'Input' : 'Output'})</option>
            {upstreamNodes.map((n) => (
              <option key={n.id} value={n.id}>
                Node: {n.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Input / Output tabs — hidden while referencing a specific upstream node,
          since only that node's own output is meaningful there. */}
      {!viewingUpstream && (
        <div className="flex border-b border-panelBorder bg-canvas">
          <button type="button" className={tabBtn(side === 'input')} onClick={() => onSideChange('input')} disabled={!hasInput}>
            Input{!hasInput ? ' —' : ''}
          </button>
          <button type="button" className={tabBtn(side === 'output')} onClick={() => onSideChange('output')} disabled={!hasOutput}>
            Output{!hasOutput ? ' —' : ''}
          </button>
        </div>
      )}

      {/* Schema / Table / JSON / Binary sub-view toggle */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-canvas border-b border-panelBorder">
        <button type="button" className={viewBtn(view === 'schema')} onClick={() => onViewChange('schema')}>Schema</button>
        <button type="button" className={viewBtn(view === 'table')} onClick={() => onViewChange('table')}>Table</button>
        <button type="button" className={viewBtn(view === 'json')} onClick={() => onViewChange('json')}>JSON</button>
        <button type="button" className={viewBtn(view === 'binary')} onClick={() => onViewChange('binary')}>Binary</button>
      </div>

      {view === 'json' ? (
        <div className="p-2">
          {activeData === undefined ? (
            <p className="text-[11px] text-muted px-2 py-3">No data yet — run the node first.</p>
          ) : (
            <pre className="text-[11px] bg-panel border border-panelBorder rounded-md p-2 max-h-64 overflow-auto">
              {JSON.stringify(activeData, null, 2)}
            </pre>
          )}
        </div>
      ) : view === 'binary' ? (
        <BinaryView output={activeData} nodeLabel={activeLabel} refKind={activeRefKind} onInsert={onInsert} />
      ) : (
        <SchemaTreeView
          nodeLabel={activeLabel}
          output={activeData}
          refKind={activeRefKind}
          view={view}
          onInsert={onInsert}
        />
      )}
    </div>
  );
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
  onCredentialsRefresh,
  retry,
  continueOnFail,
  isPinned,
  pinnedOutput,
  notes,
  otherNodeLabels = [],
  workflowId,
  replayExecutionId,
  siblingWebhookPaths = [],
  siblingChatPaths = [],
  hasRespondToWebhookNode = false,
  isWorkflowActive = false,
  onOpenChatTest,
  lastRunOutput,
  lastRunInput,
  lastRunExpressionErrors = [],
  upstreamOutput,
  upstreamNodes = [],
  onChange,
  onDelete,
  onClose,
}: Props) {
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(() => false);
  // n8n-style I/O panel: which side (input coming in / output produced) and
  // which sub-view (field tree / spreadsheet table / raw JSON / binary) is shown.
  const [ioSide, setIoSide] = useState<'input' | 'output'>('output');
  const [ioView, setIoView] = useState<'schema' | 'table' | 'json' | 'binary'>('schema');
  // '' = viewing this node's own input/output; otherwise the id of an upstream
  // ancestor whose own last-run output is being browsed instead.
  const [ioRefNodeId, setIoRefNodeId] = useState('');
  const requiredCredentialType = NODE_TYPE_TO_CREDENTIAL_TYPE[nodeType] as CredentialType | undefined;
  // These node types accept several LLM providers via params.provider (openai/anthropic/gemini/…) — the
  // NODE_TYPE_TO_CREDENTIAL_TYPE entry for them is just a default-selected suggestion, not a strict
  // requirement, so their "+ New credential" modal shouldn't lock the Type dropdown to OpenAI only.
  const MULTI_PROVIDER_NODE_TYPES = new Set([
    'agent',
    'agentMemory',
    'agentOrchestrator',
    'textClassifier',
    'sentimentAnalysis',
    'entityExtractor',
    'summarizer',
    'qaChain',
    'ragIngest',
    'ragQuery',
  ]);
  const credentialTypeIsLocked = !MULTI_PROVIDER_NODE_TYPES.has(nodeType);
  const [localLabel, setLocalLabel] = useState(label);
  const [localNotes, setLocalNotes] = useState(notes ?? '');
  const [paramsJson, setParamsJson] = useState(JSON.stringify(params, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const paramSchema = getParamSchema(nodeType);
  const [showRawJson, setShowRawJson] = useState(!paramSchema);
  const testStorageKey = `session:${workflowId ?? 'wf'}:${nodeId}:testInput`;
  const testModeStorageKey = `session:${workflowId ?? 'wf'}:${nodeId}:testMode`;
  const [testInputMode, setTestInputMode] = useState<'single' | 'array'>(
    () => (sessionStorage.getItem(testModeStorageKey) as 'single' | 'array') || 'single'
  );
  function defaultTestInput(): string {
    const saved = sessionStorage.getItem(testStorageKey);
    if (saved !== null) return saved;
    if (upstreamOutput !== undefined) {
      try {
        return JSON.stringify(upstreamOutput, null, 2);
      } catch {
        // fall through
      }
    }
    const sample = getDefaultMockInput(nodeType);
    if (sample !== undefined) {
      try {
        return JSON.stringify(sample, null, 2);
      } catch {
        // fall through
      }
    }
    return '{}';
  }

  const [testInput, setTestInput] = useState(() => defaultTestInput());
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<unknown>(undefined);
  const [testItems, setTestItems] = useState<Array<{ json: unknown; binary?: Record<string, { mimeType: string; fileName?: string; fileSize?: number }> }> | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [runFromHereBusy, setRunFromHereBusy] = useState(false);
  const [credTestBusy, setCredTestBusy] = useState(false);
  const [credTestResult, setCredTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleTestCredential() {
    if (!credentialId || credentialId === '__new__') return;
    setCredTestBusy(true);
    setCredTestResult(null);
    try {
      const { data } = await api.post(`/credentials/${credentialId}/test`);
      setCredTestResult({ ok: data.ok, message: data.message });
      onCredentialsRefresh?.();
    } catch (err: any) {
      setCredTestResult({ ok: false, message: err?.response?.data?.error ?? 'Test connection failed.' });
    } finally {
      setCredTestBusy(false);
    }
  }

  /**
   * "Run workflow from here" (n8n's "Execute step"/"pin data and continue"
   * pattern). Rather than always running the whole chain from the trigger,
   * this re-runs starting at this node, reusing every *upstream* node's
   * cached output from a past execution — the worker's executor already
   * supports this via POST /executions/:id/retry-from/:nodeId (see
   * executionsRouter), we're just exposing it in the canvas UI. Uses the
   * execution currently open in the replay scrubber if there is one,
   * otherwise falls back to the workflow's most recent execution.
   */
  async function handleRunFromHere() {
    if (!workflowId) return;
    setRunFromHereBusy(true);
    try {
      let sourceExecutionId = replayExecutionId;
      if (!sourceExecutionId) {
        const { data } = await api.get(`/workflows/${workflowId}/executions`);
        sourceExecutionId = data.executions?.[0]?.id;
      }
      if (!sourceExecutionId) {
        toast.error('No past execution to run from yet — run the whole workflow once first.');
        return;
      }
      await api.post(`/executions/${sourceExecutionId}/retry-from/${nodeId}`);
      toast.success(`Running workflow from "${label}"…`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to start run from this node');
    } finally {
      setRunFromHereBusy(false);
    }
  }

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
      // Mirror n8n: a successful manual test "pins" this node's real
      // input/output onto the canvas node, so the next node downstream
      // sees it as `upstreamOutput` and prefills its own test panel with
      // real data instead of `{}` — without this, testing node-by-node
      // never propagates data and every $json.field after the first node
      // resolves to nothing.
      onChange({ lastRunInput: parsedInput, lastRunOutput: data.output });
    } catch (err: any) {
      setTestError(err?.response?.data?.error ?? 'Test run failed');
    } finally {
      setTestBusy(false);
    }
  }

  useEffect(() => {
    setLocalLabel(label);
    setLocalNotes(notes ?? '');
    setParamsJson(JSON.stringify(params, null, 2));
    setJsonError(null);
    setCredTestResult(null);
    setShowRawJson(!paramSchema);
    setTestInput(defaultTestInput());
    setTestInputMode((sessionStorage.getItem(`session:${workflowId ?? 'wf'}:${nodeId}:testMode`) as 'single' | 'array') || 'single');
    setIoRefNodeId('');
    // Auto-open I/O panel when there is upstream or run data to browse
    setSchemaOpen(upstreamNodes.length > 0 || lastRunOutput !== undefined || lastRunInput !== undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  useEffect(() => {
    sessionStorage.setItem(testStorageKey, testInput);
  }, [testInput, testStorageKey]);

  useEffect(() => {
    sessionStorage.setItem(testModeStorageKey, testInputMode);
  }, [testInputMode, testModeStorageKey]);

  useEffect(() => {
    setCredTestResult(null);
  }, [credentialId]);

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

  function commitSwitchParams(nextParams: Record<string, unknown>) {
    setParamsJson(JSON.stringify(nextParams, null, 2));
    setJsonError(null);
    onChange({ params: nextParams });
  }

  function commitIfParams(nextParams: Record<string, unknown>) {
    setParamsJson(JSON.stringify(nextParams, null, 2));
    setJsonError(null);
    onChange({ params: nextParams });
  }

  /** ParamForm edits are the source of truth while the form is shown; keep the Raw JSON textarea's
   *  string mirror in sync so toggling to Raw JSON never shows stale content and toggling back never
   *  loses an edit made while Raw JSON was open (that already flows through commitParams -> params prop). */
  function handleFormChange(nextParams: Record<string, unknown>) {
    setParamsJson(JSON.stringify(nextParams, null, 2));
    setJsonError(null);
    onChange({ params: nextParams });
  }

  const nodeMeta = getNodeTypeMeta(nodeType);

  return (
    <>
    <aside className="w-80 min-h-0 border-l border-panelBorder bg-panel shrink-0 overflow-y-auto flex flex-col">
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
            onBlur={() => {
              let finalLabel = localLabel;
              if (finalLabel && otherNodeLabels.includes(finalLabel)) {
                let n = 2;
                while (otherNodeLabels.includes(`${finalLabel} ${n}`)) n++;
                finalLabel = `${finalLabel} ${n}`;
                setLocalLabel(finalLabel);
              }
              onChange({ label: finalLabel });
            }}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Type</label>
          <p className="text-sm text-muted font-display">{nodeType}</p>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Note</label>
          <textarea
            value={localNotes}
            onChange={(e) => setLocalNotes(e.target.value)}
            onBlur={() => onChange({ notes: localNotes.trim() ? localNotes : null })}
            placeholder="Freeform note for this node (not used in execution)"
            rows={2}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-xs resize-y"
          />
        </div>

        {(
          // Single source of truth: any node type listed in
          // NODE_TYPE_TO_CREDENTIAL_TYPE needs a credential, plus a couple
          // of nodes (browserAutomation) that intentionally have no formal
          // credential *type* yet but still need the generic picker. This
          // used to be a hand-maintained whitelist that fell out of sync
          // with credentialSchemas.ts, so most integrations (LinkedIn,
          // Twitter, Trello, Jira, ...) silently never showed a Credential
          // field at all.
          Object.prototype.hasOwnProperty.call(NODE_TYPE_TO_CREDENTIAL_TYPE, nodeType) ||
          nodeType === 'browserAutomation' ||
          nodeType === 'httpRequest'
        ) && (
          <div>
            <label className="block text-xs text-muted mb-1">Credential</label>
            {(() => {
              // Credentials matching this node's required type are listed first, then the rest
              // (in case a custom/community node reuses a differently-typed credential on purpose).
              const matching = requiredCredentialType
                ? credentials.filter((c) => c.type === requiredCredentialType)
                : credentials;
              const rest = requiredCredentialType
                ? credentials.filter((c) => c.type !== requiredCredentialType)
                : [];
              const selected = credentials.find((c) => c.id === credentialId);
              return (
                <>
                  <select
                    value={credentialId === '__new__' ? '__new__' : credentialId ?? ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setShowCredentialModal(true);
                        return;
                      }
                      onChange({ credentialId: e.target.value || null });
                    }}
                    className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
                  >
                    <option value="">None</option>
                    {matching.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name ?? c.type} {c.lastTestOk === true ? '✓' : c.lastTestOk === false ? '⚠' : ''}
                      </option>
                    ))}
                    {rest.length > 0 && (
                      <optgroup label="Other credentials">
                        {rest.map((c) => (
                          <option key={c.id} value={c.id}>
                            {(CREDENTIAL_TYPE_META[c.type as CredentialType]?.label ?? c.type)}
                            {' — '}
                            {c.name ?? c.id.slice(0, 8)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <option value="__new__">+ New credential…</option>
                  </select>
                  {requiredCredentialType && matching.length === 0 && (
                    <p className="text-alert text-[11px] mt-1">
                      No {CREDENTIAL_TYPE_META[requiredCredentialType].label} credential yet — pick{' '}
                      <button
                        type="button"
                        onClick={() => setShowCredentialModal(true)}
                        className="underline hover:no-underline"
                      >
                        "+ New credential…"
                      </button>{' '}
                      above to create one without leaving the canvas.
                    </p>
                  )}
                  {selected && selected.lastTestOk === false && !credTestResult && (
                    <p className="text-alert text-[11px] mt-1">
                      This credential's last test failed — check it on the Credentials page.
                    </p>
                  )}
                  {credentialId && credentialId !== '__new__' && (
                    <div className="mt-1.5">
                      <button
                        type="button"
                        onClick={handleTestCredential}
                        disabled={credTestBusy}
                        className="focus-ring text-[11px] px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink disabled:opacity-50"
                      >
                        {credTestBusy ? 'Testing…' : '🔌 Test connection'}
                      </button>
                      {credTestResult && (
                        <p className={`text-[11px] mt-1 ${credTestResult.ok ? 'text-signal' : 'text-alert'}`}>
                          {credTestResult.ok ? '✓' : '⚠'} {credTestResult.message}
                        </p>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {showCredentialModal && (
          <CredentialQuickCreateModal
            defaultType={requiredCredentialType}
            lockType={credentialTypeIsLocked}
            onClose={() => setShowCredentialModal(false)}
            onCreated={(cred) => {
              setShowCredentialModal(false);
              onCredentialsRefresh?.();
              onChange({ credentialId: cred.id });
            }}
          />
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
          {nodeType === 'switch' && <SwitchCasesEditor params={params} onCommit={commitSwitchParams} />}
          {(nodeType === 'if' || nodeType === 'filter') && <IfConditionsEditor params={params} onCommit={commitIfParams} />}

          {paramSchema && (paramSchema.fields.length > 0 || nodeType === 'if' || nodeType === 'filter' || nodeType === 'switch') && (
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-widest text-muted">Parameters</p>
              <button
                type="button"
                onClick={() => setShowRawJson((v) => !v)}
                className="focus-ring text-[11px] px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink"
              >
                {showRawJson ? 'Use form' : 'Raw JSON'}
              </button>
            </div>
          )}

          {(lastRunOutput !== undefined || lastRunInput !== undefined || upstreamNodes.length > 0) && (
            <div className="border border-panelBorder rounded-md overflow-hidden mb-2">
              <button
                type="button"
                onClick={() => setSchemaOpen((v) => !v)}
                className="focus-ring w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-widest text-muted hover:text-ink bg-canvas"
              >
                <span>↗ Input / Output — drag to insert</span>
                <span>{schemaOpen ? '▾' : '▸'}</span>
              </button>
              {schemaOpen && (
                <NodeIoPanel
                  nodeLabel={label}
                  input={lastRunInput}
                  output={lastRunOutput}
                  side={ioSide}
                  view={ioView}
                  onSideChange={setIoSide}
                  onViewChange={setIoView}
                  onInsert={insertIntoFocusedInput}
                  upstreamNodes={upstreamNodes}
                  refNodeId={ioRefNodeId}
                  onRefNodeChange={setIoRefNodeId}
                />
              )}
            </div>
          )}

          {lastRunExpressionErrors.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400 grid gap-1">
              <p className="font-medium">
                {lastRunExpressionErrors.length} expression error{lastRunExpressionErrors.length === 1 ? '' : 's'} on the last run
              </p>
              <ul className="list-disc pl-4 grid gap-0.5">
                {lastRunExpressionErrors.map((e, i) => (
                  <li key={`${e.param}-${i}`}>
                    <code className="text-[11px]">{e.param}</code> ({e.type}): {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {paramSchema && paramSchema.fields.length > 0 && !showRawJson && (
            <>
              <ParamForm
                nodeType={nodeType}
                schema={paramSchema}
                params={params}
                onChange={handleFormChange}
                accentColor={nodeMeta.color}
                extraSuggestions={nodeSuggestions}
                mockInput={lastRunInput}
                credentialId={credentialId}
                workflowId={workflowId}
                siblingWebhookPaths={siblingWebhookPaths}
                siblingChatPaths={siblingChatPaths}
                hasRespondToWebhookNode={hasRespondToWebhookNode}
                isWorkflowActive={isWorkflowActive}
              />
            </>
          )}

          {(!paramSchema || showRawJson) && (
            <>
              <label className="block text-xs text-muted mb-1">
                Params (JSON) <span className="text-muted/70 normal-case">— type {'{{$'} for autocomplete</span>
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
              <p className="text-muted text-[11px] mt-1">{paramHint(nodeType)}</p>
            </>
          )}
          <details className="mt-2 border-t border-panelBorder pt-2">
            <summary className="text-muted text-[11px] cursor-pointer hover:text-ink select-none">
              Expression syntax reference ▸
            </summary>
            <div className="mt-1 space-y-1 text-[11px] text-muted">
              <p><code className="text-ink">{'{{$json.field}}'}</code> — current item's JSON field</p>
              <p><code className="text-ink">{'{{$node["Label"].json.field}}'}</code> — another node's output</p>
              <p><code className="text-ink">{'{{$trigger.sessionId}}'}</code> — chatTrigger session ID, works from ANY downstream node</p>
              <p><code className="text-ink">{'{{$trigger.message}}'}</code> — chatTrigger user message, works from ANY downstream node</p>
              <p><code className="text-ink">{'{{$json.field}}'}</code> — field from the IMMEDIATELY upstream node's output</p>
              <p><code className="text-ink">{'{{$env.NAME}}'}</code> — environment variable</p>
              <p><code className="text-ink">{'{{$now}}'}</code> — current ISO timestamp</p>
            </div>
          </details>
        </div>

        <div className="border-t border-panelBorder pt-4">
          <p className="text-xs uppercase tracking-widest text-muted mb-2">Test node</p>
          <div className="flex items-center gap-3 mb-1">
            <label className="flex items-center gap-1.5 text-[11px] text-ink">
              <input
                type="radio"
                checked={testInputMode === 'single'}
                onChange={() => {
                  setTestInputMode('single');
                  if (testInput.trim().startsWith('[')) setTestInput('{}');
                }}
              />
              Single object
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-ink">
              <input
                type="radio"
                checked={testInputMode === 'array'}
                onChange={() => {
                  setTestInputMode('array');
                  if (!testInput.trim().startsWith('[')) setTestInput('[]');
                }}
              />
              Array of items
            </label>
          </div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[10px] text-muted">
              Mock input ({testInputMode === 'array' ? 'JSON array — one entry per item' : 'JSON object'})
            </label>
            {upstreamOutput !== undefined && (
              <button
                type="button"
                onClick={() => {
                  const asString = JSON.stringify(upstreamOutput, null, 2);
                  setTestInput(asString);
                  setTestInputMode(asString.trim().startsWith('[') ? 'array' : 'single');
                }}
                title="Fill this box with the real last output of the connected node upstream"
                className="focus-ring text-[10px] px-1.5 py-0.5 rounded border border-panelBorder text-muted hover:text-ink hover:border-signal/40"
              >
                ⤒ Pull from upstream node
              </button>
            )}
          </div>
          <textarea
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            rows={3}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-2 py-1 text-xs font-display mb-2"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleTestNode}
              disabled={testBusy}
              className="focus-ring text-xs px-3 py-1.5 rounded-md border border-signal/40 text-signal hover:bg-signal/10 disabled:opacity-50"
            >
              {testBusy ? 'Running…' : '▶ Run this node in isolation'}
            </button>
            {workflowId && (
              <button
                onClick={handleRunFromHere}
                disabled={runFromHereBusy}
                title="Runs the real workflow starting at this node, reusing upstream nodes' cached outputs from a past execution instead of re-triggering the whole chain"
                className="focus-ring text-xs px-3 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink hover:border-signal/40 disabled:opacity-50"
              >
                {runFromHereBusy ? 'Starting…' : '⏩ Run workflow from here'}
              </button>
            )}
            {nodeType === 'chatTrigger' && workflowId && onOpenChatTest && (
              <button
                onClick={onOpenChatTest}
                title="Open a chat box to manually send test messages into this workflow's draft graph — no publish needed"
                className="focus-ring text-xs px-3 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink hover:border-signal/40"
              >
                💬 Open Chat
              </button>
            )}
          </div>
          {testError && <p className="text-alert text-xs mt-2">{testError}</p>}
          {testItems && (
            <p className="text-[11px] text-muted mt-2">
              Items out: <span className="text-ink font-display">{testItems.length}</span>
            </p>
          )}
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
    </>
  );
}

function paramHint(nodeType: string): string {
  switch (nodeType) {
    case 'webhook':
      return 'e.g. { "path": "orders" } — this becomes /webhook/:workflowId/orders';
    case 'chatTrigger':
      return 'e.g. { "path": "default", "responseMode": "lastNode" } — this becomes POST /chat/:workflowId/default';
    case 'schedule':
      return 'e.g. { "cron": "*/5 * * * *" }';
    case 'httpRequest':
      return 'e.g. { "url": "https://api.example.com", "method": "GET" }';
    case 'if':
      return 'e.g. { "field": "amount", "operator": "greaterThan", "value": 100 }';
    case 'filter':
      return 'e.g. { "field": "amount", "operator": "greaterThan", "value": 100 } — items that don\'t match the condition(s) are dropped; unlike IF there\'s only one output, no true/false branches';
    case 'compareDatasets':
      return 'e.g. { "matchFields": "id", "compareFields": "status,updatedAt" } — requires two upstream connections (Dataset A, Dataset B). Each output item is tagged _compare: "same" | "different" | "onlyInA" | "onlyInB" — route with a downstream IF/Switch/Filter on that field for a 4-way split.';
    case 'executeWorkflowTrigger':
      return 'e.g. { "inputSchema": [{ "name": "orderId", "type": "string", "required": true }] } — typed entry point for a workflow meant to be called via a subWorkflow node; validates the caller\'s payload against this schema and throws a clear error if it doesn\'t match. Leave inputSchema empty to accept anything.';
    case 'noOp':
      return 'No params. Passes items through completely unchanged — useful as a canvas anchor point.';
    case 'dateTime':
      return 'e.g. { "operation": "format", "sourceField": "createdAt", "format": "date" } — operations: format | addSubtract | difference | now.';
    case 'htmlExtract':
      return 'e.g. { "sourceField": "html", "extractions": [{ "key": "title", "selector": "h1", "multiple": false }] }';
    case 'markdownHtml':
      return 'e.g. { "direction": "toHtml", "sourceField": "markdown", "destinationField": "html" }';
    case 'xmlJson':
      return 'e.g. { "direction": "toJson", "sourceField": "xml", "destinationField": "json" }';
    case 'crypto':
      return 'e.g. { "operation": "hash", "algorithm": "sha256", "sourceField": "payload" } — operations: hash | hmac | sign | randomBytes.';
    case 'compression':
      return 'e.g. { "operation": "gzip", "binaryProperty": "data" } — operations: zip | unzip | gzip | gunzip.';
    case 'textParser':
      return 'e.g. { "operation": "match", "sourceField": "text", "pattern": "\\\\d+", "flags": "g" } — operations: match | matchAll | test | split | replace.';
    case 'set':
      return 'e.g. { "mappings": [{ "targetPath": "summary", "staticValue": "done" }] }';
    case 'code':
      return 'e.g. { "code": "return { doubled: input.value * 2 };" } — also has $getWorkflowStaticData()/$setWorkflowStaticData(data) helpers for small persisted state between runs';
    case 'dataTableRead':
      return 'e.g. { "tableName": "customers", "mode": "list", "filterColumn": "email", "filterValue": "a@b.com" } — "mode": "list" (default, all matching rows) | "get" (first match only). Omit filterColumn to return every row.';
    case 'dataTableWrite':
      return 'e.g. { "tableName": "customers", "operation": "insert", "data": { "email": "a@b.com", "plan": "pro" } } — "operation": "insert" | "update" (requires matchColumn/matchValue + data as the patch) | "delete" (requires matchColumn/matchValue).';
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
      return 'Use the form above. Key fields: sessionId → {{$trigger.sessionId}}, prompt → {{$trigger.message}}. $trigger always resolves to the original chatTrigger payload regardless of chain length. Requires an OpenAI or Gemini credential.';
    case 'agentMemory':
      return 'e.g. { "action": "recall", "sessionId": "customer-42", "query": "what did they order last time?", "topK": 5 } — actions: "read" (recent turns), "write" ({ role, content }), "clear", "recall" (vector search over ALL stored turns). An "openai" credential enables embeddings for write/recall.';
    case 'agentOrchestrator':
      return 'e.g. { "goal": "Research and draft a reply", "subAgents": [{ "name": "researcher", "systemPrompt": "...", "tools": [] }, { "name": "writer", "systemPrompt": "..." }] } — planner breaks the goal into subtasks, routes to named sub-agents, reviewer synthesizes a final answer. All stages share memory/sessionId. Output includes a per-stage `trace` — see the reasoning trace below after a test run.';
    case 'fileExtract':
      return 'e.g. { "format": "csv", "binaryProperty": "data" } — reads an upstream binary attachment and parses it into items. "format": "csv" (one output item per row) | "json" (array -> one item per element, object -> single item) | "text" (whole file as { "text": ... }). Set "dropBinary": true to not carry the original file through to the parsed items.';
    case 'fileConvert':
      return 'e.g. { "format": "csv", "fileName": "export.csv", "binaryProperty": "data" } — flattens all input items\u2019 json into a single downloadable file attached to one output item. "format": "csv" | "json". Send it on via email/HTTP/Slack, or return it from "Respond to Webhook".';
    case 'trello':
      return 'e.g. { "action": "createCard", "listId": "...", "name": "New card" } — requires a "trello" credential { "apiKey", "token" }';
    case 'asana':
      return 'e.g. { "action": "createTask", "projectId": "...", "name": "New task" } — requires an "asana" credential { "accessToken" }';
    case 'clickup':
      return 'e.g. { "action": "createTask", "listId": "...", "name": "New task" } — requires a "clickup" credential { "apiToken" }';
    case 'linear':
      return 'e.g. { "action": "createIssue", "teamId": "...", "title": "Bug" } — requires a "linear" credential { "apiKey" }';
    case 'jira':
      return 'e.g. { "action": "createIssue", "projectKey": "ENG", "summary": "Bug", "issueType": "Task" } — requires a "jira" credential { "siteUrl", "email", "apiToken" }';
    case 'msTeams':
      return 'e.g. { "text": "Deploy finished ✅", "title": "CI" } — requires a "msTeams" credential { "webhookUrl" }';
    case 'outlook':
      return 'e.g. { "action": "sendMail", "to": "a@b.com", "subject": "Hi", "body": "..." } — requires connecting a Microsoft credential';
    case 'googleDrive':
      return 'e.g. { "action": "listFiles", "query": "name contains \'report\'" } — requires connecting a Google credential (drive scope)';
    case 'dropbox':
      return 'e.g. { "action": "listFolder", "path": "" } — requires a "dropbox" credential { "accessToken" }';
    case 'zoom':
      return 'e.g. { "action": "createMeeting", "topic": "Standup", "startTime": "2026-08-01T09:00:00Z" } — requires a "zoom" credential { "accessToken" }';
    case 'mongodb':
      return 'e.g. { "database": "app", "collection": "orders", "action": "find", "filter": { "status": "paid" } } — requires a "mongodb" credential { "connectionString" }';
    case 'mysql':
      return 'e.g. { "query": "SELECT * FROM orders WHERE id = ?", "values": [123] } — requires a "mysql" credential { "connectionString" }';
    case 'sentry':
      return 'e.g. { "action": "listIssues", "projectSlug": "backend", "query": "is:unresolved" } — requires a "sentry" credential { "authToken", "organizationSlug" }';
    case 'pagerduty':
      return 'e.g. { "action": "triggerIncident", "summary": "DB latency spike", "severity": "critical" } — requires a "pagerduty" credential { "routingKey" }';
    case 'datadog':
      return 'e.g. { "action": "submitMetric", "metricName": "flowforge.orders", "value": 1, "tags": ["env:prod"] } — requires a "datadog" credential { "apiKey" }';
    default:
      return 'Configure this node\u2019s parameters as JSON.';
  }
}
