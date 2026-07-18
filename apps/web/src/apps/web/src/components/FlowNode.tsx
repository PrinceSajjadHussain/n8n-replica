import { Handle, Position } from '@xyflow/react';

export type NodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped';

const NODE_ICONS: Record<string, string> = {
  webhook: '⚡',
  schedule: '⏱',
  httpRequest: '🌐',
  if: '⑂',
  merge: '⇶',
  wait: '⏳',
  forEach: '🔁',
  forEachBranch: '🔂',
  subWorkflow: '📦',
  waitForWebhook: '🪝',
  humanApproval: '🧑\u200d⚖️',
  switch: '🔀',
  set: '✎',
  code: '⌨',
  email: '✉',
  slack: '#',
  discord: '🎮',
  telegram: '✈',
  notion: '📓',
  github: '🐙',
  postgres: '🐘',
  googleSheets: '▦',
  openai: '✨',
  ragIngest: '📥',
  ragQuery: '🔎',
  browserAutomation: '🖥',
};

const STATUS_RING: Record<NodeStatus, string> = {
  idle: 'ring-panelBorder',
  running: 'ring-amber animate-pulse',
  success: 'ring-signal',
  failed: 'ring-alert',
  skipped: 'ring-panelBorder opacity-50',
};

export interface FlowNodeData {
  label: string;
  nodeType: string;
  status: NodeStatus;
  [key: string]: unknown;
}

export default function FlowNode({ data, selected }: { data: FlowNodeData; selected: boolean }) {
  const ring = STATUS_RING[data.status] ?? STATUS_RING.idle;

  return (
    <div
      className={`min-w-[160px] rounded-lg bg-panel border border-panelBorder ring-2 ${ring} px-3 py-2 ${
        selected ? 'outline outline-1 outline-signal' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">{NODE_ICONS[data.nodeType] ?? '◆'}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{data.label}</p>
          <p className="text-[10px] text-muted uppercase tracking-wide">{data.nodeType}</p>
        </div>
        {data.isPinned && <span title="Output pinned" className="ml-auto text-xs">📌</span>}
      </div>
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
