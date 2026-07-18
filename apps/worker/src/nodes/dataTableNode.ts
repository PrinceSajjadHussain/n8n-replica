import { registerNode } from './types';
import type { NodePlugin } from './types';
import { listRows, insertRow, updateRows, deleteRows } from '../db/dataTables';

/**
 * Data Table: Get/List — reads rows from a workspace's Data Table (see
 * `apps/api/src/routes/dataTables.ts` for the CRUD API and
 * `DataTablesPage.tsx` for the spreadsheet-style browser UI). Make's
 * "Data Store" / n8n's newer "Data Tables" equivalent: a lightweight
 * built-in tabular store workflows can read/write without an external DB
 * credential.
 *
 * params: {
 *   tableName: string,
 *   mode?: 'list' | 'get'   // 'get' returns at most one row (first match)
 *   filterColumn?: string,  // optional — omit to list every row
 *   filterValue?: string,
 * }
 */
export const dataTableReadNode: NodePlugin = {
  type: 'dataTableRead',
  async execute({ params, workspaceId }) {
    const tableName = String(params.tableName ?? '');
    if (!tableName) throw new Error('Data Table: Get/List node: "tableName" param is required');
    const mode = (params.mode as string) ?? 'list';
    const filterColumn = params.filterColumn ? String(params.filterColumn) : undefined;
    const rows = await listRows(
      workspaceId,
      tableName,
      filterColumn ? { column: filterColumn, value: params.filterValue } : undefined
    );
    const asJson = rows.map((r) => ({ id: r.id, ...r.data }));
    if (mode === 'get') {
      return { output: asJson[0] ?? null };
    }
    return { output: asJson };
  },
};
registerNode(dataTableReadNode);

/**
 * Data Table: Insert/Update/Delete — writes to a workspace Data Table.
 *
 * params: {
 *   tableName: string,
 *   operation: 'insert' | 'update' | 'delete',
 *   data?: Record<string, unknown>,   // insert: the row to add; update: the columns to patch
 *   matchColumn?: string,             // update/delete: which column to match rows on
 *   matchValue?: string,
 * }
 */
export const dataTableWriteNode: NodePlugin = {
  type: 'dataTableWrite',
  async execute({ params, workspaceId }) {
    const tableName = String(params.tableName ?? '');
    if (!tableName) throw new Error('Data Table: Insert/Update/Delete node: "tableName" param is required');
    const operation = String(params.operation ?? 'insert');

    if (operation === 'insert') {
      const data = (params.data as Record<string, unknown>) ?? {};
      const row = await insertRow(workspaceId, tableName, data);
      return { output: { id: row.id, ...row.data } };
    }

    const matchColumn = String(params.matchColumn ?? '');
    if (!matchColumn) throw new Error(`Data Table node: "matchColumn" param is required for ${operation}`);

    if (operation === 'update') {
      const patch = (params.data as Record<string, unknown>) ?? {};
      const updated = await updateRows(workspaceId, tableName, matchColumn, params.matchValue, patch);
      return { output: { updated } };
    }

    if (operation === 'delete') {
      const deleted = await deleteRows(workspaceId, tableName, matchColumn, params.matchValue);
      return { output: { deleted } };
    }

    throw new Error(`Data Table node: unknown operation "${operation}" (expected insert/update/delete)`);
  },
};
registerNode(dataTableWriteNode);
