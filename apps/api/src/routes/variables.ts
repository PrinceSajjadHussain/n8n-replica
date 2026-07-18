import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { listVariables, createVariable, updateVariable, deleteVariable } from '../db/variables';
import { getWorkspaceRole, roleAtLeast } from '../db/workspaces';

export const variablesRouter = Router();
variablesRouter.use(requireAuth);

/** GET /variables?workspaceId=... — instance-wide variables, plus workspace-scoped ones if workspaceId is given. Referenced in node expressions as {{$vars.KEY}}. */
variablesRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    if (workspaceId) {
      const role = await getWorkspaceRole(workspaceId, req.userId!);
      if (!roleAtLeast(role, 'viewer')) return res.status(role ? 403 : 404).json({ error: 'Workspace not found' });
    }
    const variables = await listVariables(workspaceId);
    res.json({ variables });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  key: z.string().min(1).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Keys must look like an identifier, e.g. API_BASE_URL'),
  value: z.string(),
  workspaceId: z.string().nullable().optional(),
});

variablesRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { key, value, workspaceId } = parsed.data;
    if (workspaceId) {
      const role = await getWorkspaceRole(workspaceId, req.userId!);
      if (!roleAtLeast(role, 'admin')) return res.status(role ? 403 : 404).json({ error: 'Workspace not found' });
    }
    const variable = await createVariable(req.userId!, key, value, workspaceId ?? null);
    res.status(201).json({ variable });
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: 'A variable with that key already exists in this scope' });
    next(err);
  }
});

const updateSchema = z.object({
  key: z.string().min(1).regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  value: z.string().optional(),
});

variablesRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const variable = await updateVariable(req.params.id, parsed.data);
    if (!variable) return res.status(404).json({ error: 'Variable not found' });
    res.json({ variable });
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: 'A variable with that key already exists in this scope' });
    next(err);
  }
});

variablesRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const deleted = await deleteVariable(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Variable not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
