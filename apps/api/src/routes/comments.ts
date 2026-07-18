import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requireWorkflowRole } from '../middleware/permissions';
import { createComment, listComments, resolveComment, deleteComment, getCommentWorkflowId } from '../db/comments';
import { logActivity } from '../db/activity';
import { getWorkflowById } from '../db/workflows';

export const commentsRouter = Router();
commentsRouter.use(requireAuth);

/** GET /workflows/:id/comments — any workspace member can read the discussion. */
commentsRouter.get('/:id/comments', requireWorkflowRole('viewer'), async (req, res, next) => {
  try {
    const comments = await listComments(req.params.id);
    res.json({ comments });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({ body: z.string().min(1), nodeId: z.string().nullable().optional() });

/** POST /workflows/:id/comments — leave a comment, optionally pinned to a node. */
commentsRouter.post('/:id/comments', requireWorkflowRole('viewer'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const comment = await createComment(req.params.id, req.userId!, parsed.data.body, parsed.data.nodeId);
    const workflow = await getWorkflowById(req.params.id, req.userId!).catch(() => null);
    await logActivity({
      workspaceId: workflow?.workspaceId ?? null,
      workflowId: req.params.id,
      userId: req.userId,
      action: 'comment.created',
      metadata: { nodeId: parsed.data.nodeId ?? null },
    });
    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
});

commentsRouter.patch('/:id/comments/:commentId/resolve', requireWorkflowRole('editor'), async (req, res, next) => {
  try {
    const parsed = z.object({ resolved: z.boolean().default(true) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if ((await getCommentWorkflowId(req.params.commentId)) !== req.params.id) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    const comment = await resolveComment(req.params.commentId, parsed.data.resolved);
    res.json({ comment });
  } catch (err) {
    next(err);
  }
});

commentsRouter.delete('/:id/comments/:commentId', requireWorkflowRole('viewer'), async (req: AuthedRequest, res, next) => {
  try {
    if ((await getCommentWorkflowId(req.params.commentId)) !== req.params.id) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    const ok = await deleteComment(req.params.commentId, req.userId!);
    if (!ok) return res.status(403).json({ error: 'You can only delete your own comments' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
