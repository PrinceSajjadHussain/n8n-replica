import { pool } from './pool';
import { randomUUID } from 'crypto';

export type LogStreamEventType = 'started' | 'completed' | 'failed';

export interface LogStreamConfig {
  id: string;
  workspaceId: string;
  name: string;
  targetUrl: string;
  eventTypes: LogStreamEventType[];
  isActive: boolean;
  headers: Record<string, string> | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_EVENT_TYPES: LogStreamEventType[] = ['started', 'completed', 'failed'];

export async function createLogStreamConfig(
  workspaceId: string,
  createdBy: string,
  fields: {
    name: string;
    targetUrl: string;
    eventTypes?: LogStreamEventType[];
    headers?: Record<string, string> | null;
    isActive?: boolean;
  }
): Promise<LogStreamConfig> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "LogStreamConfig" (id, "workspaceId", name, "targetUrl", "eventTypes", "isActive", headers, "createdBy")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      id,
      workspaceId,
      fields.name,
      fields.targetUrl,
      JSON.stringify(fields.eventTypes ?? DEFAULT_EVENT_TYPES),
      fields.isActive ?? true,
      fields.headers ? JSON.stringify(fields.headers) : null,
      createdBy,
    ]
  );
  return result.rows[0];
}

export async function listLogStreamConfigs(workspaceId: string): Promise<LogStreamConfig[]> {
  const result = await pool.query(
    `SELECT * FROM "LogStreamConfig" WHERE "workspaceId" = $1 ORDER BY "createdAt" ASC`,
    [workspaceId]
  );
  return result.rows;
}

export async function updateLogStreamConfig(
  id: string,
  fields: Partial<{
    name: string;
    targetUrl: string;
    eventTypes: LogStreamEventType[];
    headers: Record<string, string> | null;
    isActive: boolean;
  }>
): Promise<LogStreamConfig | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (fields.name !== undefined) { sets.push(`name = $${idx++}`); values.push(fields.name); }
  if (fields.targetUrl !== undefined) { sets.push(`"targetUrl" = $${idx++}`); values.push(fields.targetUrl); }
  if (fields.eventTypes !== undefined) { sets.push(`"eventTypes" = $${idx++}`); values.push(JSON.stringify(fields.eventTypes)); }
  if (fields.headers !== undefined) { sets.push(`headers = $${idx++}`); values.push(fields.headers ? JSON.stringify(fields.headers) : null); }
  if (fields.isActive !== undefined) { sets.push(`"isActive" = $${idx++}`); values.push(fields.isActive); }
  sets.push(`"updatedAt" = now()`);
  if (sets.length === 1) {
    const result = await pool.query(`SELECT * FROM "LogStreamConfig" WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }
  values.push(id);
  const result = await pool.query(
    `UPDATE "LogStreamConfig" SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteLogStreamConfig(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "LogStreamConfig" WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function getLogStreamConfigWorkspaceId(id: string): Promise<string | null> {
  const result = await pool.query(`SELECT "workspaceId" FROM "LogStreamConfig" WHERE id = $1`, [id]);
  return result.rows[0]?.workspaceId ?? null;
}
