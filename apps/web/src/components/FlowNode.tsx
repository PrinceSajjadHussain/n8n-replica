import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { getNodeTypeMeta } from '../lib/nodeTypeMeta';
import { NODE_TYPE_TO_CREDENTIAL_TYPE } from '../lib/credentialSchemas';
import NodeInspectPopover from './NodeInspectPopover';

export type NodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped';

const STATUS_RING: Record<NodeStatus, string> = {
  idle: 'ring-panelBorder',
  running: 'ring-amber animate-pulse',
  success: 'ring-signal',
  failed: 'ring-alert',
  skipped: 'ring-panelBorder opacity-50',
};

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
  [key: string]: unknown;
}

export default function FlowNode({ data, selected }: { data: FlowNodeData; selected: boolean }) {
  const status = data.status ?? 'idle';
  const ring = STATUS_RING[status] ?? STATUS_RING.idle;
  const meta = getNodeTypeMeta(data.nodeType ?? '');
  const requiresCredential = !!data.nodeType && data.nodeType in NODE_TYPE_TO_CREDENTIAL_TYPE;
  const credentialMissing = requiresCredential && !data.credentialId;
  const [inspectOpen, setInspectOpen] = useState(false);
  const hasRunData = status === 'running' || status === 'success' || status === 'failed';
  const showRunBadge =
    (status === 'success' || status === 'failed') &&
    (typeof data.lastRunDurationMs === 'number' || typeof data.lastRunItemCount === 'number');

  return (
    <div
      className={`relative min-w-[160px] rounded-lg bg-panel border border-panelBorder ring-2 ${ring} px-3 py-2 ${
        selected ? 'outline outline-1 outline-signal' : ''
      }`}
    >
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
      <Handle type="target" position={Position.Left} className="!bg-muted !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <span
          className="relative w-7 h-7 rounded-md flex items-center justify-center text-sm leading-none shrink-0"
          style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}
        >
          {meta.icon}
          {requiresCredential && (
            <span
              title={credentialMissing ? 'Credential required — not attached' : 'Credential attached'}
              className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border border-panel ${
                credentialMissing ? 'bg-amber' : 'bg-signal'
              }`}
            />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{data.label}</p>
          <p className="text-[10px] text-muted uppercase tracking-wide">{data.nodeType}</p>
        </div>
        {data.isPinned && <span title="Output pinned" className="ml-auto text-xs">📌</span>}
      </div>
      {hasRunData && (
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
      {data.nodeType === 'if' && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            style={{ top: '35%' }}
            className="!bg-signal !w-2 !h-2"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            style={{ top: '65%' }}
            className="!bg-alert !w-2 !h-2"
          />
        </>
      )}
      {data.nodeType !== 'if' && (
        <Handle type="source" position={Position.Right} className="!bg-muted !w-2 !h-2" />
      )}
    </div>
  );
}
