import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { listTags, createTag, deleteTag, getTagsForWorkflow, setWorkflowTags } from '../db/tags';
import { getWorkspaceRole, getWorkflowRole, roleAtLeast } from '../db/workspaces';

export const tagsRouter = Router();
tagsRouter.use(requireAuth);

/** GET /tags?workspaceId=... — instance-wide tags, plus workspace-scoped ones if workspaceId is given. */
tagsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    if (workspaceId) {
      const role = await getWorkspaceRole(workspaceId, req.userId!);
      if (!roleAtLeast(role, 'viewer')) return res.status(role ? 403 : 404).json({ error: 'Workspace not found' });
    }
    const tags = await listTags(workspaceId);
    res.json({ tags });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({ name: z.string().min(1), workspaceId: z.string().nullable().optional() });

tagsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { name, workspaceId } = parsed.data;
    if (workspaceId) {
      const role = await getWorkspaceRole(workspaceId, req.userId!);
      if (!roleAtLeast(role, 'editor')) return res.status(role ? 403 : 404).json({ error: 'Workspace not found' });
    }
    const tag = await createTag(name, workspaceId ?? null);
    res.status(201).json({ tag });
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: 'A tag with that name already exists in this scope' });
    next(err);
  }
});

tagsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const deleted = await deleteTag(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Tag not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/** GET /tags/workflows/:workflowId — tags attached to a workflow. */
tagsRouter.get('/workflows/:workflowId', async (req: AuthedRequest, res, next) => {
  try {
    const role = await getWorkflowRole(req.params.workflowId, req.userId!);
    if (!roleAtLeast(role, 'viewer')) return res.status(role ? 403 : 404).json({ error: 'Workflow not found' });
    const tags = await getTagsForWorkflow(req.params.workflowId);
    res.json({ tags });
  } catch (err) {
    next(err);
  }
});

const setTagsSchema = z.object({ tagIds: z.array(z.string()) });

/** PUT /tags/workflows/:workflowId — replaces the workflow's full tag set. */
tagsRouter.put('/workflows/:workflowId', async (req: AuthedRequest, res, next) => {
  try {
    const role = await getWorkflowRole(req.params.workflowId, req.userId!);
    if (!roleAtLeast(role, 'editor')) return res.status(role ? 403 : 404).json({ error: 'Workflow not found' });
    const parsed = setTagsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await setWorkflowTags(req.params.workflowId, parsed.data.tagIds);
    const tags = await getTagsForWorkflow(req.params.workflowId);
    res.json({ tags });
  } catch (err) {
    next(err);
  }
});
