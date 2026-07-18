import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { ExecutionJobData, QueueJobData } from '@flowforge/shared-types';

export function createRedisConnection(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: null, // required by BullMQ
  });
}

export const EXECUTION_QUEUE_NAME = 'workflow-execution';

export function createExecutionQueue(connection: IORedis): Queue<QueueJobData> {
  return new Queue<QueueJobData>(EXECUTION_QUEUE_NAME, { connection });
}
