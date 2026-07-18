import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface DataTableRow {
  id: string;
  dataTableId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Looks up a Data Table by (workspaceId, name) — node params reference a
 * table by name (like a credential by type), not by id, since a workflow
 * moving between workspaces would otherwise carry a dangling id.
 */
async function findTableId(workspaceId: string | null, tableName: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT id FROM "DataTable" WHERE "workspaceId" = $1 AND name = $2`,
    [workspaceId, tableName]
  );
  return result.rows[0]?.id ?? null;
}

export async function listRows(
  workspaceId: string | null,
  tableName: string,
  filter?: { column: string; value: unknown }
): Promise<DataTableRow[]> {
  const tableId = await findTableId(workspaceId, tableName);
  if (!tableId) throw new Error(`Data Table "${tableName}" not found in this workflow's workspace`);
  if (filter?.column) {
    const result = await pool.query(
      `SELECT * FROM "DataTableRow" WHERE "dataTableId" = $1 AND data->>$2 = $3 ORDER BY "createdAt" ASC`,
      [tableId, filter.column, String(filter.value)]
    );
    return result.rows;
  }
  const result = await pool.query(`SELECT * FROM "DataTableRow" WHERE "dataTableId" = $1 ORDER BY "createdAt" ASC`, [
    tableId,
  ]);
  return result.rows;
}

export async function insertRow(
  workspaceId: string | null,
  tableName: string,
  data: Record<string, unknown>
): Promise<DataTableRow> {
  const tableId = await findTableId(workspaceId, tableName);
  if (!tableId) throw new Error(`Data Table "${tableName}" not found in this workflow's workspace`);
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "DataTableRow" (id, "dataTableId", data, "updatedAt") VALUES ($1, $2, $3, now()) RETURNING *`,
    [id, tableId, JSON.stringify(data)]
  );
  return result.rows[0];
}

export async function updateRows(
  workspaceId: string | null,
  tableName: string,
  matchColumn: string,
  matchValue: unknown,
  patch: Record<string, unknown>
): Promise<number> {
  const tableId = await findTableId(workspaceId, tableName);
  if (!tableId) throw new Error(`Data Table "${tableName}" not found in this workflow's workspace`);
  const result = await pool.query(
    `UPDATE "DataTableRow" SET data = data || $4::jsonb, "updatedAt" = now()
     WHERE "dataTableId" = $1 AND data->>$2 = $3`,
    [tableId, matchColumn, String(matchValue), JSON.stringify(patch)]
  );
  return result.rowCount ?? 0;
}

export async function deleteRows(
  workspaceId: string | null,
  tableName: string,
  matchColumn: string,
  matchValue: unknown
): Promise<number> {
  const tableId = await findTableId(workspaceId, tableName);
  if (!tableId) throw new Error(`Data Table "${tableName}" not found in this workflow's workspace`);
  const result = await pool.query(`DELETE FROM "DataTableRow" WHERE "dataTableId" = $1 AND data->>$2 = $3`, [
    tableId,
    matchColumn,
    String(matchValue),
  ]);
  return result.rowCount ?? 0;
}
