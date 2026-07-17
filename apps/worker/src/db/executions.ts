import { pool } from './pool';
import { randomUUID } from 'crypto';
import { decrypt } from './crypto';

export interface WorkflowRow {
  id: string;
  userId: string;
  name: string;
  nodesJson: unknown;
  edgesJson: unknown;
  isActive: boolean;
}

export async function getWorkflow(workflowId: string): Promise<WorkflowRow | null> {
  const result = await pool.query(`SELECT * FROM "Workflow" WHERE id = $1`, [workflowId]);
  return result.rows[0] ?? null;
}

export async function createExecution(
  workflowId: string,
  triggerType: 'manual' | 'webhook' | 'schedule'
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "Execution" (id, "workflowId", status, "triggerType") VALUES ($1, $2, 'running', $3)`,
    [id, workflowId, triggerType]
  );
  return id;
}

export async function finishExecution(
  executionId: string,
  status: 'success' | 'failed'
): Promise<void> {
  await pool.query(
    `UPDATE "Execution" SET status = $1, "finishedAt" = now() WHERE id = $2`,
    [status, executionId]
  );
}

export async function upsertNodeRunStart(
  executionId: string,
  nodeId: string,
  input: unknown
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "ExecutionNodeRun" (id, "executionId", "nodeId", status, input, "startedAt")
     VALUES ($1, $2, $3, 'running', $4, now())`,
    [id, executionId, nodeId, JSON.stringify(input ?? null)]
  );
  return id;
}

export async function finishNodeRunSuccess(nodeRunId: string, output: unknown): Promise<void> {
  await pool.query(
    `UPDATE "ExecutionNodeRun" SET status = 'success', output = $1, "finishedAt" = now() WHERE id = $2`,
    [JSON.stringify(output ?? null), nodeRunId]
  );
}

export async function finishNodeRunFailure(nodeRunId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE "ExecutionNodeRun" SET status = 'failed', error = $1, "finishedAt" = now() WHERE id = $2`,
    [error, nodeRunId]
  );
}

export async function markNodeSkipped(executionId: string, nodeId: string): Promise<void> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "ExecutionNodeRun" (id, "executionId", "nodeId", status)
     VALUES ($1, $2, $3, 'skipped')`,
    [id, executionId, nodeId]
  );
}

export async function getDecryptedCredentialById(
  credentialId: string
): Promise<Record<string, unknown> | null> {
  const result = await pool.query(`SELECT "encryptedData" FROM "Credential" WHERE id = $1`, [
    credentialId,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  return JSON.parse(decrypt(row.encryptedData));
}
