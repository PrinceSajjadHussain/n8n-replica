import { useState } from 'react';
import { Handle, Position, useNodeConnections, useConnection } from '@xyflow/react';
import CanvasHandlePlus from './CanvasHandlePlus';
import type { NodePort } from '../../lib/connectionTypes';

interface Props {
  nodeId: string;
  port: NodePort;
  topPercent: number;
  runItemCount?: number;
  isReadOnly?: boolean;
  onAdd: (port: NodePort) => void;
}

/**
 * Right-edge circular output handle for the `main` pipe (n8n's
 * CanvasHandleMainOutput.vue): shows the run-data item count once executed,
 * and a hover "+" to add the next node when nothing is connected yet.
 */
export default function CanvasHandleMainOutput({ nodeId, port, topPercent, runItemCount, isReadOnly, onAdd }: Props) {
  const connections = useNodeConnections({ id: nodeId, handleType: 'source', handleId: port.id });
  const isConnected = connections.length > 0;
  const connection = useConnection();
  const isConnecting = connection.inProgress;
  const [hovered, setHovered] = useState(false);

  const showRunBadge = !isConnected && typeof runItemCount === 'number' && runItemCount > 0;
  const plusVisible = !isReadOnly && !isConnected && (!isConnecting || hovered);

  return (
    <>
      {port.label && (
        <div
          className="absolute whitespace-nowrap text-[10px] text-muted bg-panel px-1 rounded pointer-events-none z-10"
          style={{ right: -6, top: `${topPercent}%`, transform: 'translate(100%, -50%)' }}
        >
          {port.required && <span className="text-alert">*</span>}
          {port.label}
        </div>
      )}
      {showRunBadge && (
        <div
          className="absolute whitespace-nowrap text-[10px] text-ink bg-panel px-1 rounded pointer-events-none z-10"
          style={{ right: 14, top: `${topPercent}%`, transform: 'translate(0, calc(-100% - 6px))' }}
        >
          {runItemCount} item{runItemCount === 1 ? '' : 's'}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id={port.id}
        style={{ top: `${topPercent}%`, right: -5 }}
        className={`!w-[9px] !h-[9px] !rounded-full !border-2 transition-colors ${
          isConnected ? '!bg-signal !border-signal' : '!bg-panel !border-muted'
        }`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <div
        className="absolute z-10"
        style={{ right: -24, top: `${topPercent}%`, transform: 'translateY(-50%)' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <CanvasHandlePlus
          visible={plusVisible}
          color="rgb(var(--color-signal))"
          onClick={() => onAdd(port)}
          title="Add node"
        />
      </div>
    </>
  );
}
