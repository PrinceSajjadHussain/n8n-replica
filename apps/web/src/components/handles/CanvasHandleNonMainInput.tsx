import { useState } from 'react';
import { Handle, Position, useNodeConnections, useConnection } from '@xyflow/react';
import CanvasHandlePlus from './CanvasHandlePlus';
import { CONNECTION_TYPE_META, type NodePort } from '../../lib/connectionTypes';
import { useNodeDensity } from '../../lib/nodeDensity';

interface Props {
  nodeId: string;
  port: NodePort;
  leftPercent: number;
  isReadOnly?: boolean;
  onAdd: (port: NodePort) => void;
}

/**
 * Bottom-edge diamond input handle for non-`main` connection types (n8n's
 * CanvasHandleNonMainInput.vue) — e.g. an Agent's Model / Memory / Tool /
 * Output Parser slots. Color comes from the connection type, not the node.
 */
export default function CanvasHandleNonMainInput({ nodeId, port, leftPercent, isReadOnly, onAdd }: Props) {
  const meta = CONNECTION_TYPE_META[port.type];
  const connections = useNodeConnections({ id: nodeId, handleType: 'target', handleId: port.id });
  const isConnected = connections.length > 0;
  const connection = useConnection();
  const isConnecting = connection.inProgress;
  const [hovered, setHovered] = useState(false);
  const density = useNodeDensity();

  const atCapacity = !!port.maxConnections && connections.length >= port.maxConnections;
  const plusVisible = !isReadOnly && !atCapacity && (!isConnecting || hovered);

  return (
    <>
      {density !== 'compact' && (
        <div
          className="absolute whitespace-nowrap text-[10px] pointer-events-none z-10"
          style={{ left: `${leftPercent}%`, bottom: -18, transform: 'translateX(-50%)', color: meta.color }}
          title={port.label ?? meta.label}
        >
          {port.label ?? meta.label}
          {port.required && <span className="text-alert">*</span>}
        </div>
      )}
      <Handle
        type="target"
        position={Position.Bottom}
        id={port.id}
        style={{
          left: `${leftPercent}%`,
          bottom: -5,
          transform: 'translateX(-50%) rotate(45deg)',
          borderRadius: 2,
          borderColor: meta.color,
          background: isConnected ? meta.color : 'rgb(var(--color-panel))',
        }}
        className="!w-[9px] !h-[9px] !border-2 transition-colors"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <div
        className="absolute z-10"
        style={{ left: `${leftPercent}%`, bottom: -30, transform: 'translateX(-50%)' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <CanvasHandlePlus visible={plusVisible} color={meta.color} onClick={() => onAdd(port)} title={`Add ${meta.label}`} />
      </div>
    </>
  );
}
