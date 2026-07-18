import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/permissions';
import { createFolder, listFolders, renameFolder, deleteFolder, getFolderWorkspace } from '../db/workspaces';
import { getWorkspaceRole, roleAtLeast } from '../db/workspaces';

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

const createSchema = z.object({ name: z.string().min(1), parentId: z.string().nullable().optional() });

/** GET /workspaces/:workspaceId/folders */
foldersRouter.get('/:workspaceId/folders', requireWorkspaceRole('viewer'), async (req, res, next) => {
  try {
    const folders = await listFolders(req.params.workspaceId);
    res.json({ folders });
  } catch (err) {
    next(err);
  }
});

/** POST /workspaces/:workspaceId/folders — editors+ can organize workflows into folders. */
foldersRouter.post('/:workspaceId/folders', requireWorkspaceRole('editor'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const folder = await createFolder(req.params.workspaceId, parsed.data.name, parsed.data.parentId);
    res.status(201).json({ folder });
  } catch (err) {
    next(err);
  }
});

async function assertFolderEditor(req: AuthedRequest, folderId: string): Promise<boolean> {
  const workspaceId = await getFolderWorkspace(folderId);
  if (!workspaceId) return false;
  const role = await getWorkspaceRole(workspaceId, req.userId!);
  return roleAtLeast(role, 'editor');
}

foldersRouter.patch('/folders/:folderId', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (!(await assertFolderEditor(req, req.params.folderId))) return res.status(403).json({ error: 'Insufficient permissions' });
    const folder = await renameFolder(req.params.folderId, parsed.data.name);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json({ folder });
  } catch (err) {
    next(err);
  }
});

foldersRouter.delete('/folders/:folderId', async (req: AuthedRequest, res, next) => {
  try {
    if (!(await assertFolderEditor(req, req.params.folderId))) return res.status(403).json({ error: 'Insufficient permissions' });
    const ok = await deleteFolder(req.params.folderId);
    if (!ok) return res.status(404).json({ error: 'Folder not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
