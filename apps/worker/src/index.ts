import 'dotenv/config';
import { Worker } from 'bullmq';
import type { ExecutionJobData } from '@flowforge/shared-types';
import { createRedisConnection, EXECUTION_QUEUE_NAME } from './queue';
import { getWorkflow } from './db/executions';
import { executeWorkflow } from './engine/executor';
import { publishStatus } from './pubsub/publisher';
import './nodes'; // registers all node plugins as a side effect

const connection = createRedisConnection();

const worker = new Worker<ExecutionJobData>(
  EXECUTION_QUEUE_NAME,
  async (job) => {
    const { workflowId, triggerType, triggerPayload } = job.data;
    const workflow = await getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const graph = {
      nodes: workflow.nodesJson as never,
      edges: workflow.edgesJson as never,
    };

    const result = await executeWorkflow(
      workflowId,
      graph,
      triggerType,
      triggerPayload,
      (event) => {
        publishStatus({ workflowId, ...event }).catch((err) =>
          console.error('Failed to publish status event', err)
        );
      }
    );

    return result;
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  }
);

worker.on('completed', (job, result) => {
  console.log(`[worker] job ${job.id} completed:`, result);
});

worker.on('failed', (job, err) => {
  // A job-level failure here means an infrastructure error (e.g. workflow
  // not found), NOT a node-level failure — those are caught inside
  // executeWorkflow and recorded as 'failed' node runs without throwing.
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

console.log('FlowForge worker started, waiting for jobs...');
