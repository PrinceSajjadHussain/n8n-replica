import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface WorkflowComment {
  id: string;
  workflowId: string;
  userId: string;
  userEmail: string;
  nodeId: string | null;
  body: string;
  resolvedAt: Date | null;
  createdAt: Date;
}

export async function createComment(
  workflowId: string,
  userId: string,
  body: string,
  nodeId?: string | null
): Promise<WorkflowComment> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "WorkflowComment" (id, "workflowId", "userId", "nodeId", body)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, workflowId, userId, nodeId ?? null, body]
  );
  const result = await pool.query(
    `SELECT c.*, u.email AS "userEmail" FROM "WorkflowComment" c
     JOIN "User" u ON u.id = c."userId" WHERE c.id = $1`,
    [id]
  );
  return result.rows[0];
}

export async function listComments(workflowId: string): Promise<WorkflowComment[]> {
  const result = await pool.query(
    `SELECT c.*, u.email AS "userEmail" FROM "WorkflowComment" c
     JOIN "User" u ON u.id = c."userId"
     WHERE c."workflowId" = $1 ORDER BY c."createdAt" ASC`,
    [workflowId]
  );
  return result.rows;
}

export async function resolveComment(commentId: string, resolved: boolean): Promise<WorkflowComment | null> {
  const result = await pool.query(
    `UPDATE "WorkflowComment" SET "resolvedAt" = $2 WHERE id = $1 RETURNING *`,
    [commentId, resolved ? new Date() : null]
  );
  return result.rows[0] ?? null;
}

export async function deleteComment(commentId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "WorkflowComment" WHERE id = $1 AND "userId" = $2`,
    [commentId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getCommentWorkflowId(commentId: string): Promise<string | null> {
  const result = await pool.query(`SELECT "workflowId" FROM "WorkflowComment" WHERE id = $1`, [commentId]);
  return result.rows[0]?.workflowId ?? null;
}
