import { pool } from './pool';
import { randomUUID } from 'crypto';

export type AlertChannel = 'email' | 'webhook';

export interface AlertConfig {
  id: string;
  workflowId: string;
  channel: AlertChannel;
  target: string;
  onFailure: boolean;
  onSuccess: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
}

export async function createAlertConfig(
  workflowId: string,
  createdBy: string,
  fields: Pick<AlertConfig, 'channel' | 'target'> & Partial<Pick<AlertConfig, 'onFailure' | 'onSuccess' | 'isActive'>>
): Promise<AlertConfig> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "AlertConfig" (id, "workflowId", channel, target, "onFailure", "onSuccess", "isActive", "createdBy")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      id,
      workflowId,
      fields.channel,
      fields.target,
      fields.onFailure ?? true,
      fields.onSuccess ?? false,
      fields.isActive ?? true,
      createdBy,
    ]
  );
  return result.rows[0];
}

export async function listAlertConfigs(workflowId: string): Promise<AlertConfig[]> {
  const result = await pool.query(
    `SELECT * FROM "AlertConfig" WHERE "workflowId" = $1 ORDER BY "createdAt" ASC`,
    [workflowId]
  );
  return result.rows;
}

export async function updateAlertConfig(
  id: string,
  fields: Partial<Pick<AlertConfig, 'target' | 'onFailure' | 'onSuccess' | 'isActive'>>
): Promise<AlertConfig | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (fields.target !== undefined) { sets.push(`target = $${idx++}`); values.push(fields.target); }
  if (fields.onFailure !== undefined) { sets.push(`"onFailure" = $${idx++}`); values.push(fields.onFailure); }
  if (fields.onSuccess !== undefined) { sets.push(`"onSuccess" = $${idx++}`); values.push(fields.onSuccess); }
  if (fields.isActive !== undefined) { sets.push(`"isActive" = $${idx++}`); values.push(fields.isActive); }
  if (sets.length === 0) {
    const result = await pool.query(`SELECT * FROM "AlertConfig" WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }
  values.push(id);
  const result = await pool.query(
    `UPDATE "AlertConfig" SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteAlertConfig(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "AlertConfig" WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function getAlertConfigWorkflowId(id: string): Promise<string | null> {
  const result = await pool.query(`SELECT "workflowId" FROM "AlertConfig" WHERE id = $1`, [id]);
  return result.rows[0]?.workflowId ?? null;
}
