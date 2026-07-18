import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface LogActivityInput {
  workspaceId?: string | null;
  workflowId?: string | null;
  userId?: string | null;
  action: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Records one activity-feed event. Never throws — a logging failure should never break the calling request.
 *  Doubles as the enterprise audit trail: workspace/workflow-scoped events also carry ipAddress/userAgent
 *  when logged from an HTTP request (see `utils/audit.ts`), and are queryable instance-wide via
 *  `listAuditLog` for SOC2/ISO-style compliance review. */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO "ActivityLog" (id, "workspaceId", "workflowId", "userId", action, metadata, "ipAddress", "userAgent")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        input.workspaceId ?? null,
        input.workflowId ?? null,
        input.userId ?? null,
        input.action,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ]
    );
  } catch (err) {
    console.error('[activity] failed to log activity', input.action, err);
  }
}

export interface AuditLogFilter {
  action?: string;
  userId?: string;
  since?: Date;
  limit?: number;
}

/** Instance-wide audit query (no workspace/workflow scoping) — for the admin
 *  audit-log screen. Requires `admin` system role at the route level. */
export async function listAuditLog(filter: AuditLogFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.action) {
    params.push(filter.action);
    conditions.push(`a.action = $${params.length}`);
  }
  if (filter.userId) {
    params.push(filter.userId);
    conditions.push(`a."userId" = $${params.length}`);
  }
  if (filter.since) {
    params.push(filter.since);
    conditions.push(`a."createdAt" >= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(filter.limit ?? 200);

  const result = await pool.query(
    `SELECT a.*, u.email AS "userEmail" FROM "ActivityLog" a
     LEFT JOIN "User" u ON u.id = a."userId"
     ${where}
     ORDER BY a."createdAt" DESC LIMIT $${params.length}`,
    params
  );
  return result.rows;
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
