import 'dotenv/config';
import { Worker } from 'bullmq';
import type { QueueJobData, ExecutionJobData, ResumeJobData, TestNodeJobData, RetryJobData } from '@flowforge/shared-types';
import { createRedisConnection, EXECUTION_QUEUE_NAME } from './queue';
import { getWorkflow, getPausedExecution, getDecryptedCredentialById, getExecutionForRetry } from './db/executions';
import { executeWorkflow, resumeExecution, retryFromNode } from './engine/executor';
import { NODE_REGISTRY } from './nodes';
import { normalizeToItems, decodeBinary, makeBinary } from './nodes/types';
import { publishStatus } from './pubsub/publisher';
import './nodes'; // registers all node plugins as a side effect
import { reloadCommunityNodes } from './nodes/communityLoader';

const connection = createRedisConnection();

// Listen for marketplace installs/uninstalls (published by apps/api/src/routes/marketplace.ts)
// and hot-reload community nodes without restarting this worker process.
const reloadSubscriber = createRedisConnection();
void reloadSubscriber.subscribe('flowforge:community-nodes:reload', () => {});
reloadSubscriber.on('message', (channel) => {
  if (channel !== 'flowforge:community-nodes:reload') return;
  const loaded = reloadCommunityNodes();
  console.log(`[community-nodes] reloaded ${loaded.length} package(s) after marketplace change`);
});

const worker = new Worker<QueueJobData>(
  EXECUTION_QUEUE_NAME,
  async (job) => {
    if (job.name === 'testNode') {
      const { nodeType, params, input, credentialId } = job.data as TestNodeJobData;
      const plugin = NODE_REGISTRY[nodeType];
      if (!plugin) throw new Error(`No node plugin registered for type "${nodeType}"`);
      const credential = credentialId ? await getDecryptedCredentialById(credentialId) : null;
      const result = await plugin.execute({
        input,
        items: normalizeToItems(input),
        params,
        credential,
        getBinary: (item, key) => decodeBinary(item, key),
        toBinary: (buffer, mimeType, fileName) => makeBinary(buffer, mimeType, fileName),
      });
      return result;
    }

    if (job.name === 'retryFromNode') {
      const { originalExecutionId, retryNodeId } = job.data as RetryJobData;
      const original = await getExecutionForRetry(originalExecutionId);
      const workflowId = original?.workflowId ?? '';
      const result = await retryFromNode(originalExecutionId, retryNodeId, (event) => {
        publishStatus({ workflowId, ...event }).catch((err) =>
          console.error('Failed to publish status event', err)
        );
      });
      return result;
    }

    if (job.name === 'resume') {
      const { executionId, resumeInput } = job.data as ResumeJobData;
      const paused = await getPausedExecution(executionId);
      const workflowId = paused?.workflowId ?? '';
      const result = await resumeExecution(executionId, resumeInput, (event) => {
        publishStatus({ workflowId, ...event }).catch((err) =>
          console.error('Failed to publish status event', err)
        );
      });
      return result;
    }

    const { workflowId, triggerType, triggerPayload } = job.data as ExecutionJobData;
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
