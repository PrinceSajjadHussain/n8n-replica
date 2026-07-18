import { createRedisConnection } from '../queue';

const publisherConnection = createRedisConnection();

export const STATUS_CHANNEL = 'flowforge:execution-status';

export interface StatusMessage {
  workflowId: string;
  executionId: string;
  nodeId?: string;
  status: string;
  output?: unknown;
  input?: unknown;
  error?: string;
  /** Wall-clock ms the node spent running; set on success/failed emits. */
  durationMs?: number;
  /** Number of items in the node's output items array, when known. */
  itemCount?: number;
}

export async function publishStatus(message: StatusMessage): Promise<void> {
  await publisherConnection.publish(STATUS_CHANNEL, JSON.stringify(message));
}
