import { createRedisConnection } from '../queue';

const publisherConnection = createRedisConnection();

export const STATUS_CHANNEL = 'flowforge:execution-status';

export interface StatusMessage {
  workflowId: string;
  executionId: string;
  nodeId?: string;
  status: string;
  output?: unknown;
  error?: string;
}

export async function publishStatus(message: StatusMessage): Promise<void> {
  await publisherConnection.publish(STATUS_CHANNEL, JSON.stringify(message));
}
