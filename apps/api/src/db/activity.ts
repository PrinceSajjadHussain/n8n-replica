import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface LogActivityInput {
  workspaceId?: string | null;
  workflowId?: string | null;
  userId?: string | null;
  action: string;
  metadata?: Record<string, unknown> | null;
}

/** Records one activity-feed event. Never throws — a logging failure should never break the calling request. */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO "ActivityLog" (id, "workspaceId", "workflowId", "userId", action, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        input.workspaceId ?? null,
        input.workflowId ?? null,
        input.userId ?? null,
        input.action,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );
  } catch (err) {
    console.error('[activity] failed to log activity', input.action, err);
  }
}

export async function listActivityForWorkspace(workspaceId: string, limit = 100) {
  const result = await pool.query(
    `SELECT a.*, u.email AS "userEmail" FROM "ActivityLog" a
     LEFT JOIN "User" u ON u.id = a."userId"
     WHERE a."workspaceId" = $1 ORDER BY a."createdAt" DESC LIMIT $2`,
    [workspaceId, limit]
  );
  return result.rows;
}

export async function listActivityForWorkflow(workflowId: string, limit = 100) {
  const result = await pool.query(
    `SELECT a.*, u.email AS "userEmail" FROM "ActivityLog" a
     LEFT JOIN "User" u ON u.id = a."userId"
     WHERE a."workflowId" = $1 ORDER BY a."createdAt" DESC LIMIT $2`,
    [workflowId, limit]
  );
  return result.rows;
}
