import type { Server as SocketIOServer } from 'socket.io';

export interface RealtimeStatusEvent {
  workflowId: string;
  executionId: string;
  nodeId?: string;
  status: string;
  output?: unknown;
  input?: unknown;
  error?: string;
  durationMs?: number;
  itemCount?: number;
}

/**
 * One handler per worker-published status (n8n pattern: a dedicated
 * handler file per push event rather than branches in a single switch —
 * a missing handler is then a visible missing export, not a silently
 * dropped `case`). Each handler decides which client-facing event name(s)
 * to emit and to whom.
 */
export type RealtimeStatusHandler = (io: SocketIOServer, ownerId: string, event: RealtimeStatusEvent) => void;

/**
 * Every status handler broadcasts to both the workflow's owner AND any
 * collaborator currently viewing the canvas (the same `workflow:${id}`
 * room presence already uses) — passing an array to `io.to()` broadcasts
 * once per distinct socket, so a socket present in both rooms (e.g. the
 * owner, who is usually also a presence viewer) does not receive a
 * duplicate event.
 */
export function broadcastRooms(ownerId: string, workflowId: string): string[] {
  return [`user:${ownerId}`, `workflow:${workflowId}`];
}
