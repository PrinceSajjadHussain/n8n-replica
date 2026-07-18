import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/permissions';
import {
  createWorkspace,
  listWorkspacesForUser,
  renameWorkspace,
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
} from '../db/workspaces';
import { findUserPublicByEmail } from '../db/users';
import { logActivity } from '../db/activity';

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

/** GET /workspaces — every workspace the caller belongs to, with their role in each. */
workspacesRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const workspaces = await listWorkspacesForUser(req.userId!);
    res.json({ workspaces });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({ name: z.string().min(1) });

workspacesRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const workspace = await createWorkspace(req.userId!, parsed.data.name);
    await logActivity({ workspaceId: workspace.id, userId: req.userId, action: 'workspace.created', metadata: { name: workspace.name } });
    res.status(201).json({ workspace });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.patch('/:id', requireWorkspaceRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const workspace = await renameWorkspace(req.params.id, parsed.data.name);
    await logActivity({ workspaceId: req.params.id, userId: req.userId, action: 'workspace.renamed', metadata: { name: parsed.data.name } });
    res.json({ workspace });
  } catch (err) {
    next(err);
  }
});

/** GET /workspaces/:id/members — list members + roles. Any member can view. */
workspacesRouter.get('/:id/members', requireWorkspaceRole('viewer'), async (req, res, next) => {
  try {
    const members = await listMembers(req.params.id);
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'viewer']),
});

/** POST /workspaces/:id/members — invite an existing user by email. Admins+ only. */
workspacesRouter.post('/:id/members', requireWorkspaceRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const user = await findUserPublicByEmail(parsed.data.email);
    if (!user) return res.status(404).json({ error: 'No user found with that email' });
    const member = await addMember(req.params.id, user.id, parsed.data.role);
    await logActivity({
      workspaceId: req.params.id,
      userId: req.userId,
      action: 'workspace.member_added',
      metadata: { email: parsed.data.email, role: parsed.data.role },
    });
    res.status(201).json({ member });
  } catch (err) {
    next(err);
  }
});

const roleSchema = z.object({ role: z.enum(['admin', 'editor', 'viewer']) });

/** PATCH /workspaces/:id/members/:userId — change a member's role. Admins+ only; owner role is not reassignable here. */
workspacesRouter.patch('/:id/members/:userId', requireWorkspaceRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const ok = await updateMemberRole(req.params.id, req.params.userId, parsed.data.role);
    if (!ok) return res.status(404).json({ error: 'Member not found' });
    await logActivity({
      workspaceId: req.params.id,
      userId: req.userId,
      action: 'workspace.member_role_changed',
      metadata: { targetUserId: req.params.userId, role: parsed.data.role },
    });
    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /workspaces/:id/members/:userId — remove a member. Admins+ only. */
workspacesRouter.delete('/:id/members/:userId', requireWorkspaceRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const ok = await removeMember(req.params.id, req.params.userId);
    if (!ok) return res.status(404).json({ error: 'Member not found' });
    await logActivity({
      workspaceId: req.params.id,
      userId: req.userId,
      action: 'workspace.member_removed',
      metadata: { targetUserId: req.params.userId },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
