import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import {
  listDataTables,
  getDataTable,
  createDataTable,
  updateDataTable,
  deleteDataTable,
  listDataTableRows,
  createDataTableRow,
  updateDataTableRow,
  deleteDataTableRow,
} from '../db/dataTables';
import { getWorkspaceRole, roleAtLeast } from '../db/workspaces';
import { COLUMN_TYPE_IDS } from '@flowforge/shared-types';

export const dataTablesRouter = Router();
dataTablesRouter.use(requireAuth);

// 25-type catalog (string, number, boolean, date, json, email, url, uuid,
// select, currency, geoPoint, secret, ...) — see packages/shared-types/src/columnTypes.ts
const columnSchema = z.object({
  name: z.string().min(1).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Column names must look like an identifier'),
  type: z.enum(COLUMN_TYPE_IDS as [string, ...string[]]).default('string'),
});

async function requireRole(req: AuthedRequest, workspaceId: string, minRole: 'viewer' | 'editor' | 'admin') {
  const role = await getWorkspaceRole(workspaceId, req.userId!);
  if (!roleAtLeast(role, minRole)) {
    const err = new Error(role ? 'Insufficient permissions' : 'Workspace not found') as Error & { status?: number };
    err.status = role ? 403 : 404;
    throw err;
  }
}

/** GET /data-tables?workspaceId=... — list tables in a workspace. */
dataTablesRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId query param is required' });
    await requireRole(req, workspaceId, 'viewer');
    res.json({ dataTables: await listDataTables(workspaceId) });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  workspaceId: z.string(),
  name: z.string().min(1).max(80),
  columns: z.array(columnSchema).default([]),
});

dataTablesRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await requireRole(req, parsed.data.workspaceId, 'admin');
    const table = await createDataTable(parsed.data.workspaceId, parsed.data.name, parsed.data.columns, req.userId!);
    res.status(201).json({ dataTable: table });
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: 'A Data Table with that name already exists in this workspace' });
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  columns: z.array(columnSchema).optional(),
});

dataTablesRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const table = await getDataTable(req.params.id);
    if (!table) return res.status(404).json({ error: 'Data Table not found' });
    await requireRole(req, table.workspaceId, 'admin');
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.json({ dataTable: await updateDataTable(req.params.id, parsed.data) });
  } catch (err) {
    next(err);
  }
});

dataTablesRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const table = await getDataTable(req.params.id);
    if (!table) return res.status(404).json({ error: 'Data Table not found' });
    await requireRole(req, table.workspaceId, 'admin');
    await deleteDataTable(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Rows — the mini-spreadsheet CRUD backing DataTablesPage.tsx
// ---------------------------------------------------------------------------

dataTablesRouter.get('/:id/rows', async (req: AuthedRequest, res, next) => {
  try {
    const table = await getDataTable(req.params.id);
    if (!table) return res.status(404).json({ error: 'Data Table not found' });
    await requireRole(req, table.workspaceId, 'viewer');
    res.json({ rows: await listDataTableRows(req.params.id) });
  } catch (err) {
    next(err);
  }
});

dataTablesRouter.post('/:id/rows', async (req: AuthedRequest, res, next) => {
  try {
    const table = await getDataTable(req.params.id);
    if (!table) return res.status(404).json({ error: 'Data Table not found' });
    await requireRole(req, table.workspaceId, 'editor');
    const parsed = z.object({ data: z.record(z.unknown()) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.status(201).json({ row: await createDataTableRow(req.params.id, parsed.data.data) });
  } catch (err) {
    next(err);
  }
});

dataTablesRouter.patch('/:id/rows/:rowId', async (req: AuthedRequest, res, next) => {
  try {
    const table = await getDataTable(req.params.id);
    if (!table) return res.status(404).json({ error: 'Data Table not found' });
    await requireRole(req, table.workspaceId, 'editor');
    const parsed = z.object({ data: z.record(z.unknown()) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const row = await updateDataTableRow(req.params.rowId, req.params.id, parsed.data.data);
    if (!row) return res.status(404).json({ error: 'Row not found' });
    res.json({ row });
  } catch (err) {
    next(err);
  }
});

dataTablesRouter.delete('/:id/rows/:rowId', async (req: AuthedRequest, res, next) => {
  try {
    const table = await getDataTable(req.params.id);
    if (!table) return res.status(404).json({ error: 'Data Table not found' });
    await requireRole(req, table.workspaceId, 'editor');
    const ok = await deleteDataTableRow(req.params.rowId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Row not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
