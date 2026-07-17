import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { ExecutionJobData } from '@flowforge/shared-types';

export function createRedisConnection(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null, // required by BullMQ
  });
}

export const EXECUTION_QUEUE_NAME = 'workflow-execution';

export function createExecutionQueue(connection: IORedis): Queue<ExecutionJobData> {
  return new Queue<ExecutionJobData>(EXECUTION_QUEUE_NAME, { connection });
}
