import { createContext, useContext } from 'react';
import type { NodePort } from './connectionTypes';

export interface HandleAddRequest {
  nodeId: string;
  handleType: 'source' | 'target';
  port: NodePort;
}

export const CanvasHandleAddContext = createContext<(req: HandleAddRequest) => void>(() => {});

/** Consumed by FlowNode's handle "+" buttons to open the node palette pre-filtered to a compatible type. */
export function useCanvasHandleAdd() {
  return useContext(CanvasHandleAddContext);
}
