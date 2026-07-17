import { createExecutionQueue, createRedisConnection } from '../queue/queue';
import type { ExecutionJobData } from '@flowforge/shared-types';
import { randomUUID } from 'crypto';

const connection = createRedisConnection();
const queue = createExecutionQueue(connection);

/** BullMQ repeatable jobs are matched by (name, pattern, tz) — using a
 * workflow-unique job NAME (not a custom jobId, which getRepeatableJobs()
 * does not reliably expose) lets us find and remove the right one later. */
function repeatJobName(workflowId: string): string {
  return `execute:schedule:${workflowId}`;
}

/**
 * Registers (or updates) a BullMQ repeatable job for a workflow's Schedule
 * node. Cron pattern comes from the schedule node's params.cron.
 */
export async function registerScheduleForWorkflow(
  workflowId: string,
  userId: string,
  cronPattern: string
): Promise<void> {
  // Remove any existing repeatable job for this workflow first (idempotent
  // re-activation with a possibly different cron pattern).
  await unregisterScheduleForWorkflow(workflowId);

  const jobData: ExecutionJobData = {
    executionId: randomUUID(),
    workflowId,
    userId,
    triggerType: 'schedule',
    triggerPayload: {},
  };
  await queue.add(repeatJobName(workflowId), jobData, {
    repeat: { pattern: cronPattern },
  });
}

export async function unregisterScheduleForWorkflow(workflowId: string): Promise<void> {
  const repeatableJobs = await queue.getRepeatableJobs();
  const targetName = repeatJobName(workflowId);
  const matches = repeatableJobs.filter((j) => j.name === targetName);
  for (const match of matches) {
    await queue.removeRepeatableByKey(match.key);
  }
}
