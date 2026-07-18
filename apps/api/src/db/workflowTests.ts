import { pool } from './pool';
import { randomUUID } from 'crypto';

export type TestScorer = 'jsonDiff' | 'exactString' | 'contains' | 'similarity';

export interface WorkflowTestCase {
  id: string;
  workflowId: string;
  name: string;
  input: unknown;
  expectedOutput: unknown;
  scorer: TestScorer;
  passThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function listWorkflowTestCases(workflowId: string): Promise<WorkflowTestCase[]> {
  const result = await pool.query(
    `SELECT * FROM "WorkflowTestCase" WHERE "workflowId" = $1 ORDER BY "createdAt" ASC`,
    [workflowId]
  );
  return result.rows;
}

export async function getWorkflowTestCase(id: string): Promise<WorkflowTestCase | null> {
  const result = await pool.query(`SELECT * FROM "WorkflowTestCase" WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function createWorkflowTestCase(
  workflowId: string,
  fields: { name: string; input: unknown; expectedOutput: unknown; scorer: TestScorer; passThreshold: number }
): Promise<WorkflowTestCase> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "WorkflowTestCase"
       (id, "workflowId", name, input, "expectedOutput", scorer, "passThreshold", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING *`,
    [
      id,
      workflowId,
      fields.name,
      JSON.stringify(fields.input),
      JSON.stringify(fields.expectedOutput),
      fields.scorer,
      fields.passThreshold,
    ]
  );
  return result.rows[0];
}

export async function updateWorkflowTestCase(
  id: string,
  fields: Partial<{ name: string; input: unknown; expectedOutput: unknown; scorer: TestScorer; passThreshold: number }>
): Promise<WorkflowTestCase | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.input !== undefined) {
    sets.push(`input = $${idx++}`);
    values.push(JSON.stringify(fields.input));
  }
  if (fields.expectedOutput !== undefined) {
    sets.push(`"expectedOutput" = $${idx++}`);
    values.push(JSON.stringify(fields.expectedOutput));
  }
  if (fields.scorer !== undefined) {
    sets.push(`scorer = $${idx++}`);
    values.push(fields.scorer);
  }
  if (fields.passThreshold !== undefined) {
    sets.push(`"passThreshold" = $${idx++}`);
    values.push(fields.passThreshold);
  }
  if (sets.length === 0) return getWorkflowTestCase(id);
  sets.push(`"updatedAt" = now()`);
  values.push(id);
  const result = await pool.query(
    `UPDATE "WorkflowTestCase" SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteWorkflowTestCase(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "WorkflowTestCase" WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
