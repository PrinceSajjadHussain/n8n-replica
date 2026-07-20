import { Handle, Position, useNodeConnections } from '@xyflow/react';
import type { NodePort } from '../../lib/connectionTypes';

interface Props {
  nodeId: string;
  port: NodePort;
  topPercent: number;
}

/**
 * Left-edge circular input handle for the `main` data pipe (n8n's
 * CanvasHandleMainInput.vue). Rendered as a direct child of FlowNode's
 * `relative` root so absolute positioning is anchored to the node card.
 */
export default function CanvasHandleMainInput({ nodeId, port, topPercent }: Props) {
  const connections = useNodeConnections({ id: nodeId, handleType: 'target', handleId: port.id });
  const isConnected = connections.length > 0;

  return (
    <>
      {port.label && (
        <div
          className="absolute whitespace-nowrap text-[10px] text-muted bg-panel px-1 rounded pointer-events-none z-10"
          style={{ left: -6, top: `${topPercent}%`, transform: 'translate(-100%, -50%)' }}
        >
          {port.label}
          {port.required && <span className="text-alert">*</span>}
        </div>
      )}
      <Handle
        type="target"
        position={Position.Left}
        id={port.id}
        style={{ top: `${topPercent}%`, left: -5 }}
        className={`!w-[9px] !h-[9px] !rounded-full !border-2 transition-colors ${
          isConnected ? '!bg-signal !border-signal' : '!bg-panel !border-muted'
        }`}
      />
    </>
  );
}
