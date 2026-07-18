import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface DataTable {
  id: string;
  workspaceId: string;
  name: string;
  columns: Array<{ name: string; type: string }>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DataTableRow {
  id: string;
  dataTableId: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export async function listDataTables(workspaceId: string): Promise<DataTable[]> {
  const result = await pool.query(`SELECT * FROM "DataTable" WHERE "workspaceId" = $1 ORDER BY name ASC`, [
    workspaceId,
  ]);
  return result.rows;
}

export async function getDataTable(id: string): Promise<DataTable | null> {
  const result = await pool.query(`SELECT * FROM "DataTable" WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function createDataTable(
  workspaceId: string,
  name: string,
  columns: Array<{ name: string; type: string }>,
  createdBy: string
): Promise<DataTable> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "DataTable" (id, "workspaceId", name, columns, "createdBy", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING *`,
    [id, workspaceId, name, JSON.stringify(columns), createdBy]
  );
  return result.rows[0];
}

export async function updateDataTable(
  id: string,
  fields: { name?: string; columns?: Array<{ name: string; type: string }> }
): Promise<DataTable | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.columns !== undefined) {
    sets.push(`columns = $${idx++}`);
    values.push(JSON.stringify(fields.columns));
  }
  if (sets.length === 0) return getDataTable(id);
  sets.push(`"updatedAt" = now()`);
  values.push(id);
  const result = await pool.query(`UPDATE "DataTable" SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values);
  return result.rows[0] ?? null;
}

export async function deleteDataTable(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "DataTable" WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function listDataTableRows(dataTableId: string): Promise<DataTableRow[]> {
  const result = await pool.query(`SELECT * FROM "DataTableRow" WHERE "dataTableId" = $1 ORDER BY "createdAt" ASC`, [
    dataTableId,
  ]);
  return result.rows;
}

export async function createDataTableRow(dataTableId: string, data: Record<string, unknown>): Promise<DataTableRow> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "DataTableRow" (id, "dataTableId", data, "updatedAt") VALUES ($1, $2, $3, now()) RETURNING *`,
    [id, dataTableId, JSON.stringify(data)]
  );
  return result.rows[0];
}

export async function updateDataTableRow(
  id: string,
  dataTableId: string,
  data: Record<string, unknown>
): Promise<DataTableRow | null> {
  const result = await pool.query(
    `UPDATE "DataTableRow" SET data = $3, "updatedAt" = now() WHERE id = $1 AND "dataTableId" = $2 RETURNING *`,
    [id, dataTableId, JSON.stringify(data)]
  );
  return result.rows[0] ?? null;
}

export async function deleteDataTableRow(id: string, dataTableId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "DataTableRow" WHERE id = $1 AND "dataTableId" = $2`, [
    id,
    dataTableId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
