import { pool } from './pool';
import { randomUUID } from 'crypto';
import { decrypt } from './crypto';
import { redactForPersistence } from '../utils/redact';

export interface WorkflowRow {
  id: string;
  userId: string;
  name: string;
  nodesJson: unknown;
  edgesJson: unknown;
  isActive: boolean;
  errorWorkflowId?: string | null;
  workspaceId?: string | null;
  staticData?: Record<string, unknown> | null;
}

export async function getWorkflow(workflowId: string): Promise<WorkflowRow | null> {
  const result = await pool.query(`SELECT * FROM "Workflow" WHERE id = $1`, [workflowId]);
  return result.rows[0] ?? null;
}

/**
 * Workflow "static data" — a small persisted JSON blob per workflow,
 * n8n's `$getWorkflowStaticData()` equivalent: lightweight state (e.g. "last
 * processed id") that survives between runs without needing a full Data
 * Table or external DB credential. Read/written from the Code node — see
 * `nodes/codeNode.ts` — and readable from any node's params via the
 * `{{$staticData.KEY}}` expression.
 */
export async function getWorkflowStaticData(workflowId: string): Promise<Record<string, unknown>> {
  const result = await pool.query(`SELECT "staticData" FROM "Workflow" WHERE id = $1`, [workflowId]);
  return (result.rows[0]?.staticData as Record<string, unknown>) ?? {};
}

export async function setWorkflowStaticData(workflowId: string, data: Record<string, unknown>): Promise<void> {
  await pool.query(`UPDATE "Workflow" SET "staticData" = $2 WHERE id = $1`, [workflowId, JSON.stringify(data ?? {})]);
}

/**
 * All variables visible to a workflow (global + its workspace's), flattened
 * into a key->value map for the `$vars` expression context. Workspace-scoped
 * values win over a global variable of the same key.
 */
export async function getVariablesMapForWorkflow(workflowId: string): Promise<Record<string, string>> {
  const result = await pool.query(
    `SELECT v.key, v.value
     FROM "Variable" v
     WHERE v."workspaceId" IS NULL
        OR v."workspaceId" = (SELECT "workspaceId" FROM "Workflow" WHERE id = $1)
     ORDER BY v."workspaceId" NULLS FIRST`,
    [workflowId]
  );
  const map: Record<string, string> = {};
  for (const row of result.rows as { key: string; value: string }[]) {
    map[row.key] = row.value;
  }
  return map;
}

export async function createExecution(
  workflowId: string,
  triggerType: 'manual' | 'webhook' | 'chatTrigger' | 'schedule' | 'emailTrigger' | 'fileWatcher' | 'databaseChange' | 'streamTrigger',
  presetId?: string
): Promise<string> {
  const id = presetId ?? randomUUID();
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
    [id, executionId, nodeId, JSON.stringify(redactForPersistence(input) ?? null)]
  );
  return id;
}

export async function finishNodeRunSuccess(nodeRunId: string, output: unknown): Promise<void> {
  await pool.query(
    `UPDATE "ExecutionNodeRun" SET status = 'success', output = $1, "finishedAt" = now() WHERE id = $2`,
    [JSON.stringify(redactForPersistence(output) ?? null), nodeRunId]
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

export async function markExecutionPaused(
  executionId: string,
  checkpoint: unknown,
  resumeToken: string,
  resumeNodeId: string
): Promise<void> {
  await pool.query(
    `UPDATE "Execution"
     SET status = 'paused', checkpoint = $1, "resumeToken" = $2, "resumeNodeId" = $3, "pausedAt" = now()
     WHERE id = $4`,
    [JSON.stringify(checkpoint), resumeToken, resumeNodeId, executionId]
  );
}

export interface PausedExecutionRow {
  id: string;
  workflowId: string;
  checkpoint: unknown;
  resumeNodeId: string;
  resumeToken: string;
}

export async function getPausedExecution(executionId: string): Promise<PausedExecutionRow | null> {
  const result = await pool.query(
    `SELECT id, "workflowId", checkpoint, "resumeNodeId", "resumeToken" FROM "Execution" WHERE id = $1 AND status = 'paused'`,
    [executionId]
  );
  return result.rows[0] ?? null;
}

export async function getPausedExecutionByToken(resumeToken: string): Promise<PausedExecutionRow | null> {
  const result = await pool.query(
    `SELECT id, "workflowId", checkpoint, "resumeNodeId", "resumeToken" FROM "Execution" WHERE "resumeToken" = $1 AND status = 'paused'`,
    [resumeToken]
  );
  return result.rows[0] ?? null;
}

export async function clearCheckpointAndMarkRunning(executionId: string): Promise<void> {
  await pool.query(
    `UPDATE "Execution" SET status = 'running', "resumeToken" = NULL WHERE id = $1`,
    [executionId]
  );
}

export interface ExecutionNodeRunRow {
  nodeId: string;
  status: 'success' | 'failed' | 'skipped';
  output: unknown;
  input: unknown;
}

/** Fetches an execution's workflowId + the recorded outputs of every node
 *  that finished successfully — used to seed retry-from-node. */
export async function getExecutionForRetry(
  executionId: string
): Promise<{ workflowId: string; nodeRuns: ExecutionNodeRunRow[] } | null> {
  const execResult = await pool.query(`SELECT "workflowId" FROM "Execution" WHERE id = $1`, [executionId]);
  const execution = execResult.rows[0];
  if (!execution) return null;

  const runsResult = await pool.query(
    `SELECT "nodeId", status, output, input FROM "ExecutionNodeRun" WHERE "executionId" = $1`,
    [executionId]
  );
  const rows = runsResult.rows as Array<{
    nodeId: string;
    status: 'success' | 'failed' | 'skipped';
    output: unknown;
    input: unknown;
  }>;
  return {
    workflowId: execution.workflowId,
    nodeRuns: rows.map((r) => ({ nodeId: r.nodeId, status: r.status, output: r.output, input: r.input })),
  };
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
