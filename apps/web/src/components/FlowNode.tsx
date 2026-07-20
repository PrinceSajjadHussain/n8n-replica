import { useState } from 'react';
import { NodeResizer, useReactFlow, useNodeConnections } from '@xyflow/react';
import { getNodeTypeMeta } from '../lib/nodeTypeMeta';
import { NODE_TYPE_TO_CREDENTIAL_TYPE } from '../lib/credentialSchemas';
import NodeInspectPopover from './NodeInspectPopover';
import NodeNotePopover from './NodeNotePopover';
import NodeIcon from './NodeIcon';
import { useNodeDensity, useCredentialName } from '../lib/nodeDensity';
import { getNodePorts, spreadOffsets, isNonMain, type NodePort } from '../lib/connectionTypes';
import { useCanvasHandleAdd } from '../lib/canvasHandleContext';
import CanvasHandleMainInput from './handles/CanvasHandleMainInput';
import CanvasHandleMainOutput from './handles/CanvasHandleMainOutput';
import CanvasHandleNonMainInput from './handles/CanvasHandleNonMainInput';
import CanvasHandleNonMainOutput from './handles/CanvasHandleNonMainOutput';

export type NodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped' | 'paused';

const STATUS_RING: Record<NodeStatus, string> = {
  idle: 'ring-panelBorder',
  running: 'ring-amber animate-pulse',
  success: 'ring-signal',
  failed: 'ring-alert',
  skipped: 'ring-panelBorder opacity-50',
  paused: 'ring-amber',
};

const MIN_WIDTH = 160;
const MAX_WIDTH = 420;
const COMPACT_WIDTH = 120;
/** Room reserved above/below the node card for a row of non-main (diamond) handles + their labels. */
const NON_MAIN_GUTTER = 34;

export interface FlowNodeData {
  label: string;
  nodeType?: string;
  status?: NodeStatus;
  /** Populated as execution events come in (Phase 3 live debugging). */
  lastRunInput?: unknown;
  lastRunOutput?: unknown;
  lastRunError?: string;
  lastRunDurationMs?: number;
  lastRunItemCount?: number;
  /** Binary attachment metadata (+ inline preview for small images/PDFs) from the most recent run — see executor.ts's itemsToBinaryPreview. */
  lastRunBinary?: unknown;
  /** Whether this node's output is currently pinned (NodeConfigPanel's pinnedOutput), surfaced as a badge. */
  isPinned?: boolean;
  /**
   * User drag-resized card width (Comfortable/Expanded tiers only). UI-only —
   * intentionally not read by handleSave's nodesPayload builder, so it never
   * reaches workflowsRouter.put() or the saved workflow JSON.
   */
  uiWidth?: number;
  /** Freeform per-node note (n8n-style), distinct from canvas-level sticky notes — see NodeConfigPanel's Notes field. Persists across save/reload as plain display metadata. */
  notes?: string | null;
  [key: string]: unknown;
}

/** Truncated one-line preview of a node's last output, for the Expanded tier. */
function previewOutput(output: unknown): string | null {
  if (output === undefined || output === null) return null;
  let text: string;
  if (typeof output === 'string') text = output;
  else {
    try {
      text = JSON.stringify(Array.isArray(output) ? output[0] ?? output : output);
    } catch {
      return null;
    }
  }
  if (!text) return null;
  return text.length > 64 ? `${text.slice(0, 64)}…` : text;
}

export default function FlowNode({ id, data, selected }: { id: string; data: FlowNodeData; selected: boolean }) {
  const density = useNodeDensity();
  const status = data.status ?? 'idle';
  const ring = STATUS_RING[status] ?? STATUS_RING.idle;
  const meta = getNodeTypeMeta(data.nodeType ?? '');
  const requiresCredential = !!data.nodeType && data.nodeType in NODE_TYPE_TO_CREDENTIAL_TYPE;
  const credentialMissing = requiresCredential && !data.credentialId;
  const credentialName = useCredentialName(data.credentialId as string | null | undefined);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const hasNote = typeof data.notes === 'string' && data.notes.trim().length > 0;
  const { updateNodeData } = useReactFlow();
  const incomingConnections = useNodeConnections({ id, handleType: 'target' });
  const requestAdd = useCanvasHandleAdd();
  const hasRunData = status === 'running' || status === 'success' || status === 'failed';
  const showRunBadge =
    (status === 'success' || status === 'failed') &&
    (typeof data.lastRunDurationMs === 'number' || typeof data.lastRunItemCount === 'number');

  const isCompact = density === 'compact';
  const isExpanded = density === 'expanded';
  const resizable = !isCompact; // Comfortable + Expanded only, per spec.
  const outputPreview = isExpanded ? previewOutput(data.lastRunOutput) : null;

  const ports = getNodePorts(data.nodeType);
  const mainInputs = ports.inputs.filter((p) => !isNonMain(p.type));
  const mainOutputs = ports.outputs.filter((p) => !isNonMain(p.type));
  const nonMainInputs = ports.inputs.filter((p) => isNonMain(p.type));
  const nonMainOutputs = ports.outputs.filter((p) => isNonMain(p.type));
  const mainInOffsets = spreadOffsets(mainInputs.length);
  const mainOutOffsets = spreadOffsets(mainOutputs.length);
  const nonMainInOffsets = spreadOffsets(nonMainInputs.length);
  const nonMainOutOffsets = spreadOffsets(nonMainOutputs.length);

  const requiredMissingPorts = ports.inputs.filter((p) => {
    if (!p.required) return false;
    const firstInputId = ports.inputs[0]?.id;
    return !incomingConnections.some((c) => (c.targetHandle ?? firstInputId) === p.id);
  });
  const hasIssues = requiredMissingPorts.length > 0;

  function handleAdd(port: NodePort, handleType: 'source' | 'target') {
    requestAdd({ nodeId: id, handleType, port });
  }

  const widthStyle: React.CSSProperties = isCompact
    ? { width: COMPACT_WIDTH }
    : data.uiWidth
      ? { width: data.uiWidth, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }
      : { minWidth: MIN_WIDTH };

  return (
    <div
      style={{
        marginTop: nonMainOutputs.length ? NON_MAIN_GUTTER : 0,
        marginBottom: nonMainInputs.length ? NON_MAIN_GUTTER : 0,
      }}
    >
      <div
        className={`relative rounded-lg bg-panel border border-panelBorder ring-2 ${ring} ${
          isCompact ? 'px-2 py-1.5' : 'px-3 py-2'
        } shadow-sm hover:shadow-lg hover:-translate-y-px transition-[box-shadow,transform] ${
          selected ? 'outline outline-1 outline-signal' : ''
        }`}
        style={widthStyle}
        title={isCompact ? data.label : undefined}
      >
        {resizable && (
          <NodeResizer
            isVisible={selected}
            minWidth={MIN_WIDTH}
            maxWidth={MAX_WIDTH}
            handleClassName="!w-2 !h-2 !bg-signal !border-0 !rounded-sm"
            lineClassName="!border-signal/40"
            onResizeEnd={(_, params) => {
              updateNodeData(id, { uiWidth: Math.round(params.width) });
            }}
          />
        )}
        {inspectOpen && (
          <NodeInspectPopover
            label={data.label}
            snapshot={{
              status: status,
              input: data.lastRunInput,
              output: data.lastRunOutput,
              error: data.lastRunError,
              durationMs: data.lastRunDurationMs,
              itemCount: data.lastRunItemCount,
              binary: data.lastRunBinary,
            }}
            onClose={() => setInspectOpen(false)}
          />
        )}
        {noteOpen && hasNote && (
          <NodeNotePopover notes={data.notes as string} onClose={() => setNoteOpen(false)} />
        )}

        {/* Main inputs — left edge, circular dot */}
        {mainInputs.map((port, i) => (
          <CanvasHandleMainInput key={port.id} nodeId={id} port={port} topPercent={mainInOffsets[i]} />
        ))}
        {/* Main outputs — right edge, circular dot, run-data badge, hover "+" */}
        {mainOutputs.map((port, i) => (
          <CanvasHandleMainOutput
            key={port.id}
            nodeId={id}
            port={port}
            topPercent={mainOutOffsets[i]}
            runItemCount={!isCompact ? data.lastRunItemCount : undefined}
            onAdd={(p) => handleAdd(p, 'source')}
          />
        ))}
        {/* Non-main (AI sub-node) inputs — bottom edge, diamond, colored by connection type */}
        {nonMainInputs.map((port, i) => (
          <CanvasHandleNonMainInput
            key={port.id}
            nodeId={id}
            port={port}
            leftPercent={nonMainInOffsets[i]}
            onAdd={(p) => handleAdd(p, 'target')}
          />
        ))}
        {/* Non-main (AI sub-node) outputs — top edge, diamond, colored by connection type */}
        {nonMainOutputs.map((port, i) => (
          <CanvasHandleNonMainOutput key={port.id} nodeId={id} port={port} leftPercent={nonMainOutOffsets[i]} />
        ))}

        <div className="flex items-center gap-2">
          <span
            className={`relative rounded-md flex items-center justify-center leading-none shrink-0 ${
              isCompact ? 'w-6 h-6' : 'w-7 h-7'
            }`}
            style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}
          >
            <NodeIcon type={data.nodeType ?? ''} size={isCompact ? 14 : 16} />
            {requiresCredential && (
              <span
                title={credentialMissing ? 'Credential required — not attached' : 'Credential attached'}
                className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border border-panel ${
                  credentialMissing ? 'bg-amber' : 'bg-signal'
                }`}
              />
            )}
            {hasIssues && (
              <span
                title={`Missing required connection${requiredMissingPorts.length > 1 ? 's' : ''}: ${requiredMissingPorts
                  .map((p) => p.label || (isNonMain(p.type) ? p.type : 'input'))
                  .join(', ')}`}
                className="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-full bg-alert border border-panel flex items-center justify-center text-panel leading-none"
                style={{ fontSize: 8 }}
              >
                !
              </span>
            )}
          </span>
          {!isCompact && (
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{data.label}</p>
              <p className="text-[10px] text-muted uppercase tracking-wide">{data.nodeType}</p>
            </div>
          )}
          {isCompact && <p className="text-[11px] font-medium truncate min-w-0">{meta.label}</p>}
          {!isCompact && hasNote && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setNoteOpen((v) => !v);
              }}
              title={data.notes as string}
              className="focus-ring ml-auto text-xs shrink-0 text-muted hover:text-signal"
            >
              🗒️
            </button>
          )}
          {data.isPinned && (
            <span title="Output pinned" className={`text-xs shrink-0 ${!isCompact && hasNote ? '' : 'ml-auto'}`}>
              📌
            </span>
          )}
        </div>
        {isExpanded && requiresCredential && (
          <p className="mt-1 text-[10px] text-muted truncate">
            {credentialMissing ? (
              <span className="text-amber">No credential attached</span>
            ) : (
              <>Using: {credentialName ?? 'attached credential'}</>
            )}
          </p>
        )}
        {isExpanded && hasIssues && (
          <p className="mt-1 text-[10px] text-alert truncate">
            Missing: {requiredMissingPorts.map((p) => p.label || (isNonMain(p.type) ? p.type : 'input')).join(', ')}
          </p>
        )}
        {isExpanded && outputPreview && (
          <p
            className="mt-1 text-[10px] text-muted font-mono truncate bg-canvas rounded px-1.5 py-1 border border-panelBorder"
            title={outputPreview}
          >
            {outputPreview}
          </p>
        )}
        {!isCompact && hasRunData && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setInspectOpen((v) => !v);
            }}
            title="Inspect data"
            className={`focus-ring mt-1 w-full text-[10px] px-1.5 py-0.5 rounded border text-left ${
              status === 'failed'
                ? 'border-alert/40 text-alert bg-alert/10'
                : 'border-panelBorder text-muted hover:text-ink hover:border-signal/40'
            }`}
          >
            {status === 'running' && '⏳ running…'}
            {showRunBadge && (
              <>
                {typeof data.lastRunDurationMs === 'number' && `${data.lastRunDurationMs}ms`}
                {typeof data.lastRunDurationMs === 'number' && typeof data.lastRunItemCount === 'number' && ' · '}
                {typeof data.lastRunItemCount === 'number' &&
                  `${data.lastRunItemCount} item${data.lastRunItemCount === 1 ? '' : 's'}`}
                {status === 'failed' && ' · error'}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
