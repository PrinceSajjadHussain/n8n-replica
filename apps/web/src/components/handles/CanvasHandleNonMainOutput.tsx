import { Handle, Position, useNodeConnections } from '@xyflow/react';
import { CONNECTION_TYPE_META, type NodePort } from '../../lib/connectionTypes';
import { useNodeDensity } from '../../lib/nodeDensity';

interface Props {
  nodeId: string;
  port: NodePort;
  leftPercent: number;
}

/**
 * Top-edge diamond output handle for non-`main` connection types (n8n's
 * CanvasHandleNonMainOutput.vue) — a provider sub-node (OpenAI, Redis Memory,
 * Structured Output Parser…) plugging its single typed output upward into a
 * parent Agent/Chain node's matching bottom-edge input.
 */
export default function CanvasHandleNonMainOutput({ nodeId, port, leftPercent }: Props) {
  const meta = CONNECTION_TYPE_META[port.type];
  const connections = useNodeConnections({ id: nodeId, handleType: 'source', handleId: port.id });
  const isConnected = connections.length > 0;
  const density = useNodeDensity();

  return (
    <>
      {density !== 'compact' && (
        <div
          className="absolute whitespace-nowrap text-[10px] pointer-events-none z-10"
          style={{ left: `${leftPercent}%`, top: -18, transform: 'translateX(-50%)', color: meta.color }}
          title={port.label ?? meta.label}
        >
          {port.label ?? meta.label}
          {port.required && <span className="text-alert">*</span>}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Top}
        id={port.id}
        style={{
          left: `${leftPercent}%`,
          top: -5,
          transform: 'translateX(-50%) rotate(45deg)',
          borderRadius: 2,
          borderColor: meta.color,
          background: isConnected ? meta.color : 'rgb(var(--color-panel))',
        }}
        className="!w-[9px] !h-[9px] !border-2 transition-colors"
      />
    </>
  );
}
