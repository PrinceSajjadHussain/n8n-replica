import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface Workflow {
  id: string;
  userId: string;
  name: string;
  nodesJson: unknown;
  edgesJson: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function createWorkflow(
  userId: string,
  name: string,
  nodesJson: unknown,
  edgesJson: unknown
): Promise<Workflow> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "Workflow" (id, "userId", name, "nodesJson", "edgesJson", "isActive", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, false, now())
     RETURNING *`,
    [id, userId, name, JSON.stringify(nodesJson), JSON.stringify(edgesJson)]
  );
  return result.rows[0];
}

export async function listWorkflows(userId: string): Promise<Workflow[]> {
  const result = await pool.query(
    `SELECT * FROM "Workflow" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [userId]
  );
  return result.rows;
}

export async function getWorkflowById(id: string, userId: string): Promise<Workflow | null> {
  const result = await pool.query(
    `SELECT * FROM "Workflow" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}

export async function updateWorkflow(
  id: string,
  userId: string,
  fields: Partial<Pick<Workflow, 'name' | 'nodesJson' | 'edgesJson' | 'isActive'>>
): Promise<Workflow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.nodesJson !== undefined) {
    sets.push(`"nodesJson" = $${idx++}`);
    values.push(JSON.stringify(fields.nodesJson));
  }
  if (fields.edgesJson !== undefined) {
    sets.push(`"edgesJson" = $${idx++}`);
    values.push(JSON.stringify(fields.edgesJson));
  }
  if (fields.isActive !== undefined) {
    sets.push(`"isActive" = $${idx++}`);
    values.push(fields.isActive);
  }
  sets.push(`"updatedAt" = now()`);

  if (sets.length === 1) {
    return getWorkflowById(id, userId);
  }

  values.push(id, userId);
  const result = await pool.query(
    `UPDATE "Workflow" SET ${sets.join(', ')}
     WHERE id = $${idx++} AND "userId" = $${idx++}
     RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteWorkflow(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "Workflow" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}
