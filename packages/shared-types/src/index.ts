// Shared types used across api, worker, and web

export type NodeType =
  | 'webhook'
  | 'schedule'
  | 'httpRequest'
  | 'if'
  | 'switch'
  | 'merge'
  | 'set'
  | 'code'
  | 'email'
  | 'slack'
  | 'googleSheets';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  params: Record<string, unknown>;
  credentialId?: string | null;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null; // e.g. "true" / "false" for IF nodes
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type ExecutionStatus = 'running' | 'success' | 'failed';
export type NodeRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface ExecutionJobData {
  executionId: string;
  workflowId: string;
  userId: string;
  triggerType: 'manual' | 'webhook' | 'schedule';
  triggerPayload?: unknown;
}

// Socket.IO event payloads
export interface NodeStatusEvent {
  executionId: string;
  nodeId: string;
  status: NodeRunStatus;
  output?: unknown;
  error?: string;
}

export interface ExecutionStatusEvent {
  executionId: string;
  workflowId: string;
  status: ExecutionStatus;
}
